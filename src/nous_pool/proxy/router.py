"""
OpenAI-compatible proxy at /v1/*.

Flow:
  1. Authenticate via Authorization: Bearer sk_live_*** OR Supabase JWT.
  2. Reserve a pool_account via dispatcher (round-robin).
  3. Forward request to https://inference-api.nousresearch.com/v1/...
  4. Capture response (or error), write to request_logs.
  5. Release the slot.

Streaming: when the body carries `"stream": true` the upstream SSE bytes are
relayed to the client verbatim as they arrive. Usage totals live in the final
`data:` frame, so we parse frames in-flight to keep request_logs accurate —
buffering the whole body would defeat the point of streaming.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, Response, StreamingResponse

from ..auth.deps import AuthContext, current_context
from ..config import load_settings
from . import dispatcher

log = logging.getLogger(__name__)

router = APIRouter()

# Upstream can think for a while before the first token; be generous on read.
_TIMEOUT = httpx.Timeout(connect=10, read=300, write=60, pool=10)


def _settings():
    return load_settings()


def _require_ctx(ctx: AuthContext | None) -> AuthContext:
    if ctx is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "missing_or_invalid_credentials",
                    "hint": "Use Bearer sk_live_<...> or Bearer <supabase_jwt>"},
        )
    return ctx


def _write_log(ctx: AuthContext, request: Request, *, account_id: str, model: str,
               status_code: int, latency_ms: int, usage: dict,
               error_msg: str | None, streamed: bool) -> None:
    """Best-effort request_logs insert + api_key counter bump."""
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))
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
        log.warning(f"failed to write request log (streamed={streamed}): {e}")


class _SseUsageScanner:
    """Extracts the `usage` object from an SSE stream without buffering it all.

    OpenAI-style streams end with a frame carrying token totals. We keep only a
    partial-line remainder between chunks, so memory stays flat regardless of
    response length.
    """

    def __init__(self) -> None:
        self.usage: dict = {}
        self._pending = ""

    def feed(self, chunk: bytes) -> None:
        self._pending += chunk.decode("utf-8", errors="ignore")
        while "\n" in self._pending:
            line, self._pending = self._pending.split("\n", 1)
            line = line.strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                obj = json.loads(payload)
            except ValueError:
                continue
            if isinstance(obj, dict) and isinstance(obj.get("usage"), dict):
                self.usage = obj["usage"]


@router.post("/v1/chat/completions")
async def chat_completions(
    request: Request,
    ctx: AuthContext | None = Depends(current_context),
) -> Any:
    ctx = _require_ctx(ctx)
    s = _settings()

    body_bytes = await request.body()
    try:
        payload = json.loads(body_bytes)
    except Exception:
        raise HTTPException(status_code=400, detail={"error": "invalid_json"})

    model = payload.get("model", "")
    if not model:
        raise HTTPException(status_code=400, detail={"error": "missing_model"})

    wants_stream = bool(payload.get("stream"))

    pool = await dispatcher.reserve_pool_account()
    if not pool:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "no_healthy_accounts",
                    "hint": "Admin needs to add at least one pool account"},
        )

    account_id = pool["id"]
    inference_base = pool.get("inference_base_url") or s.inference_base_url
    url = f"{inference_base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {pool['access_token']}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if wants_stream else "application/json",
    }

    if wants_stream:
        return await _proxy_streaming(
            request, ctx, url, headers, body_bytes, account_id, model
        )
    return await _proxy_buffered(
        request, ctx, url, headers, body_bytes, account_id, model
    )


async def _proxy_buffered(request: Request, ctx: AuthContext, url: str,
                          headers: dict, body_bytes: bytes,
                          account_id: str, model: str) -> Response:
    started = time.time()
    usage: dict = {}
    error_msg: str | None = None
    status_code = 500
    response_body = b""
    content_type = "application/json"

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            upstream = await client.post(
                url, headers=headers, content=body_bytes,
                params=request.query_params,
            )
            status_code = upstream.status_code
            response_body = upstream.content
            content_type = upstream.headers.get("content-type", "application/json")
            try:
                parsed = json.loads(response_body)
                usage = parsed.get("usage") or {}
            except Exception:
                pass
    except httpx.HTTPError as e:
        status_code = 502
        error_msg = f"upstream_error: {e!s}"[:500]
        response_body = json.dumps({"error": error_msg}).encode()
        content_type = "application/json"

    latency_ms = int((time.time() - started) * 1000)
    _write_log(ctx, request, account_id=account_id, model=model,
               status_code=status_code, latency_ms=latency_ms, usage=usage,
               error_msg=error_msg, streamed=False)
    await dispatcher.release_pool_account_slot(
        account_id,
        success=(200 <= status_code < 400),
        prompt_tokens=int(usage.get("prompt_tokens") or 0),
        completion_tokens=int(usage.get("completion_tokens") or 0),
        error_message=error_msg,
    )

    # Relay the upstream bytes untouched — re-serialising would drop fields and
    # mangle any non-JSON error page into an unusable shape.
    return Response(content=response_body, status_code=status_code,
                    media_type=content_type)


async def _proxy_streaming(request: Request, ctx: AuthContext, url: str,
                           headers: dict, body_bytes: bytes,
                           account_id: str, model: str) -> Response:
    """Relay upstream SSE frames to the client as they arrive.

    The upstream response is opened *before* constructing the StreamingResponse
    so the real status code and content-type reach the client, then the body is
    drained inside the generator. Logging and slot release happen in `finally`
    so a client disconnect mid-stream still settles the accounting.
    """
    started = time.time()
    client = httpx.AsyncClient(timeout=_TIMEOUT)

    try:
        req = client.build_request(
            "POST", url, headers=headers, content=body_bytes,
            params=request.query_params,
        )
        upstream = await client.send(req, stream=True)
    except httpx.HTTPError as e:
        await client.aclose()
        error_msg = f"upstream_error: {e!s}"[:500]
        _write_log(ctx, request, account_id=account_id, model=model,
                   status_code=502, latency_ms=int((time.time() - started) * 1000),
                   usage={}, error_msg=error_msg, streamed=True)
        await dispatcher.release_pool_account_slot(
            account_id, success=False, error_message=error_msg)
        return JSONResponse({"error": error_msg}, status_code=502)

    status_code = upstream.status_code
    content_type = upstream.headers.get("content-type", "text/event-stream")

    async def body_iter() -> AsyncIterator[bytes]:
        scanner = _SseUsageScanner()
        error_msg: str | None = None
        try:
            async for chunk in upstream.aiter_bytes():
                scanner.feed(chunk)
                yield chunk
        except Exception as e:  # client disconnect, upstream reset, …
            error_msg = f"stream_interrupted: {e!s}"[:500]
            log.warning(f"stream interrupted for account {account_id}: {e}")
        finally:
            await upstream.aclose()
            await client.aclose()
            latency_ms = int((time.time() - started) * 1000)
            usage = scanner.usage
            _write_log(ctx, request, account_id=account_id, model=model,
                       status_code=status_code, latency_ms=latency_ms,
                       usage=usage, error_msg=error_msg, streamed=True)
            await dispatcher.release_pool_account_slot(
                account_id,
                success=(200 <= status_code < 400 and error_msg is None),
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
                error_message=error_msg,
            )

    return StreamingResponse(
        body_iter(),
        status_code=status_code,
        media_type=content_type,
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ============================================================
# /v1/models — OpenAI-compatible model list
# ============================================================


@router.get("/v1/models")
async def list_models(
    ctx: AuthContext | None = Depends(current_context),
    free: bool = Query(False, description="Only return models with a ':free' id suffix"),
) -> Any:
    """Proxy the upstream catalogue in OpenAI `{object, data[]}` shape.

    `?free=true` narrows it to the zero-cost tier, which is what the pool can
    actually serve without spending credits.
    """
    _require_ctx(ctx)
    try:
        models = await dispatcher.get_upstream_models()
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "models_unavailable", "reason": str(e)[:300]},
        )
    if free:
        models = [m for m in models if str(m.get("id", "")).endswith(":free")]
    return {"object": "list", "data": models}
