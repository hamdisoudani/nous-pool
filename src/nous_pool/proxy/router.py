"""
OpenAI-compatible proxy at /v1/chat/completions.

Flow:
  1. Authenticate via Authorization: Bearer sk_live_*** OR Supabase JWT.
  2. Reserve a pool_account via dispatcher (round-robin).
  3. Forward request to https://inference-api.nousresearch.com/v1/chat/completions
  4. Capture response (or error), write to request_logs.
  5. Release the slot.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, StreamingResponse

from ..auth.deps import AuthContext, current_context
from ..config import load_settings
from . import dispatcher

log = logging.getLogger(__name__)

router = APIRouter()


def _settings():
    return load_settings()


@router.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    ctx: AuthContext | None = Depends(current_context),
) -> Any:
    if ctx is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "missing_or_invalid_credentials",
                    "hint": "Use Bearer sk_live_<...> or Bearer <supabase_jwt>"},
        )

    s = _settings()
    body_bytes = await request.body()
    try:
        payload = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail={"error": "invalid_json"})

    model = payload.get("model", "")
    if not model:
        raise HTTPException(status_code=400, detail={"error": "missing_model"})

    pool = await dispatcher.reserve_pool_account()
    if not pool:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "no_healthy_accounts",
                    "hint": "Admin needs to add at least one pool account"},
        )

    account_id = pool["id"]
    access_token = pool["access_token"]
    inference_base = pool.get("inference_base_url") or s.inference_base_url

    # Forward request
    url = f"{inference_base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }

    started = time.time()
    prompt_tokens = 0
    completion_tokens = 0
    total_tokens = 0
    status_code = 500
    error_msg = None

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=300, write=60, pool=10)) as client:
            upstream = await client.post(url, headers=headers, content=body_bytes, params=request.query_params)
            status_code = upstream.status_code
            response_body = upstream.content

            # Try to extract token counts if present
            try:
                parsed = json.loads(response_body)
                usage = parsed.get("usage", {}) or {}
                prompt_tokens = int(usage.get("prompt_tokens") or 0)
                completion_tokens = int(usage.get("completion_tokens") or 0)
                total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))
            except Exception:
                pass
    except httpx.HTTPError as e:
        status_code = 502
        error_msg = f"upstream_error: {e!s}"[:500]
        response_body = json.dumps({"error": error_msg}).encode()

    latency_ms = int((time.time() - started) * 1000)

    # Write request_log
    try:
        from ..db import supabase_admin
        admin = supabase_admin()
        admin.table("request_logs").insert({
            "user_id": ctx.user_id,
            "api_key_id": ctx.api_key_id,
            "pool_account_id": account_id,
            "model": model,
            "endpoint": "/v1/chat/completions",
            "method": "POST",
            "status_code": status_code,
            "latency_ms": latency_ms,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "error_message": error_msg,
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        }).execute()
        if ctx.api_key_id:
            admin.rpc("increment_api_key_stats", {
                "p_api_key_id": ctx.api_key_id,
                "p_requests": 1,
                "p_prompt_tokens": prompt_tokens,
                "p_completion_tokens": completion_tokens,
            }).execute()
    except Exception as e:
        log.warning(f"failed to write request log: {e}")

    await dispatcher.release_pool_account_slot(
        account_id,
        success=(200 <= status_code < 400),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        error_message=error_msg,
    )

    # Return upstream response
    try:
        return JSONResponse(
            content=json.loads(response_body),
            status_code=status_code,
        )
    except Exception:
        return JSONResponse(
            content={"raw": response_body.decode("utf-8", errors="replace")[:1000]},
            status_code=status_code,
        )