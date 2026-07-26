"""
Hermes/NOUS device-code OAuth flow + token refresh.

State lives in Supabase (public.oauth_flows for in-flight polls,
public.pool_accounts for completed). The portal lives at
https://portal.nousresearch.com/api/oauth/* — endpoints documented in
ak arouter's generate_device_code.py.

Operator flow (from AdminAccounts UI):
  1. POST /admin/accounts/add {label} → we POST to portal, get device_code
     and user_code. Insert oauth_flow row. Return URL + code to UI.
  2. UI shows URL + code to admin. Admin opens URL, logs in to portal,
     enters user_code, approves.
  3. Background task polls portal with device_code + grant_type=device_code
     until we get tokens.
  4. Save tokens to pool_accounts row. Mark oauth_flow as success.
  5. Account is now in the pool.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from ..config import Settings, load_settings
from ..db import supabase_admin

log = logging.getLogger(__name__)


def _settings() -> Settings:
    return load_settings()


# ============================================================
# Portal calls
# ============================================================


async def _portal_post(path: str, form: dict, headers: dict | None = None) -> dict[str, Any]:
    s = _settings()
    url = f"https://portal.nousresearch.com{path}"
    data = urlencode(form)
    hdrs = {"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "nous-pool/1.0"}
    if headers:
        hdrs.update(headers)
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.post(url, content=data, headers=hdrs)
        except httpx.HTTPError as e:
            raise RuntimeError(f"portal network error: {e}") from e
    if r.status_code >= 400:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text}")
    try:
        return r.json()
    except Exception as e:
        raise RuntimeError(f"portal returned non-JSON: {r.text[:200]}") from e


# ============================================================
# Initiate device-code flow
# ============================================================


async def start_device_code_flow(account_label: str, initiated_by_user_id: str) -> dict:
    """POST to portal, store oauth_flow row, return {flow_id, user_code, verification_uri}."""
    s = _settings()
    resp = await _portal_post(
        "/api/oauth/device/code",
        {"client_id": s.nous_client_id, "scope": s.nous_scope},
    )
    user_code = resp["user_code"]
    device_code = resp["device_code"]
    interval = int(resp.get("interval", 5))
    expires_in = int(resp.get("expires_in", 600))
    verification_uri = (
        f"https://portal.nousresearch.com/manage-subscription?user_code={user_code}"
    )
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    admin = supabase_admin()
    r = (
        admin.table("oauth_flows")
        .insert({
            "account_label": account_label,
            "device_code": device_code,
            "user_code": user_code,
            "verification_uri": verification_uri,
            "poll_interval_seconds": interval,
            "expires_at": expires_at.isoformat(),
            "status": "pending",
            "initiated_by": initiated_by_user_id,
        })
        .execute()
    )
    if not r.data:
        raise RuntimeError("failed to insert oauth_flow")
    flow_id = r.data[0]["id"]
    return {
        "flow_id": flow_id,
        "user_code": user_code,
        "verification_uri": verification_uri,
        "expires_in": expires_in,
        "interval": interval,
    }


# ============================================================
# Poll for token completion
# ============================================================


async def poll_device_code_once(flow_id: str) -> dict:
    """Try to exchange device_code for tokens. Returns the row state.

    If status=='success', tokens were obtained and a pool_account row was created.
    Otherwise status is one of: pending, expired, error, cancelled.
    """
    s = _settings()
    admin = supabase_admin()
    flow_r = (
        admin.table("oauth_flows")
        .select("*")
        .eq("id", flow_id)
        .maybe_single()
        .execute()
    )
    flow = flow_r.data if flow_r.data else None
    if not flow:
        raise RuntimeError("flow not found")
    if flow["status"] != "pending":
        return flow  # already resolved

    # Check expiry
    expires_at = datetime.fromisoformat(flow["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        admin.table("oauth_flows").update({
            "status": "expired",
        }).eq("id", flow_id).execute()
        return {**flow, "status": "expired"}

    try:
        token_resp = await _portal_post(
            "/api/oauth/token",
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
                "device_code": flow["device_code"],
                "client_id": s.nous_client_id,
            },
        )
    except RuntimeError as e:
        msg = str(e)
        if "authorization_pending" in msg or "slow_down" in msg:
            return flow  # still pending
        if "expired_token" in msg:
            admin.table("oauth_flows").update({
                "status": "expired",
            }).eq("id", flow_id).execute()
            return {**flow, "status": "expired"}
        admin.table("oauth_flows").update({
            "status": "error",
            "error_message": msg[:500],
        }).eq("id", flow_id).execute()
        return {**flow, "status": "error", "error_message": msg[:500]}

    # Success — create pool_accounts row
    access_token = token_resp["access_token"]
    refresh_token = token_resp.get("refresh_token", "")
    expires_in = int(token_resp.get("expires_in", 900))
    token_expires_at = (
        datetime.now(timezone.utc)
        + timedelta(seconds=expires_in - s.pool_token_refresh_skew_seconds)
    ).isoformat()
    inference_base_url = token_resp.get(
        "inference_base_url",
        "https://inference-api.nousresearch.com/v1",
    )

    acct_r = (
        admin.table("pool_accounts")
        .insert({
            "account_label": flow["account_label"],
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_expires_at": token_expires_at,
            "token_scope": s.nous_scope,
            "health_status": "healthy",
            "weight": 1.0,
            "max_concurrent": s.pool_default_max_concurrent,
            "supported_models": await _detect_models_for_token(access_token),
        })
        .execute()
    )
    pool_account_id = acct_r.data[0]["id"] if acct_r.data else None

    admin.table("oauth_flows").update({
        "status": "success",
        "pool_account_id": pool_account_id,
    }).eq("id", flow_id).execute()

    return {
        **flow,
        "status": "success",
        "pool_account_id": pool_account_id,
        "access_token": access_token,
    }


async def poll_until_resolved(flow_id: str, max_wait_seconds: int = 600) -> dict:
    """Poll until the flow resolves (success / expired / error)."""
    s = _settings()
    start = time.time()
    last_interval = 5
    while time.time() - start < max_wait_seconds:
        flow = await poll_device_code_once(flow_id)
        if flow["status"] != "pending":
            return flow
        interval = last_interval
        try:
            interval = int(flow.get("poll_interval_seconds", last_interval))
        except Exception:
            pass
        last_interval = interval
        await asyncio.sleep(interval)
    return {"status": "timeout"}


# ============================================================
# Refresh
# ============================================================


async def refresh_pool_account_token(pool_account_id: str) -> dict:
    """Refresh an account's access_token via its refresh_token.

    Uses the SQL `try_acquire_refresh_lock` RPC for cross-instance locking.
    Returns the updated pool_account row, or marks the account dead on 400/401.
    """
    s = _settings()
    admin = supabase_admin()
    import uuid
    holder_id = str(uuid.uuid4())

    lock_r = admin.rpc("try_acquire_refresh_lock", {
        "p_pool_account_id": pool_account_id,
        "p_holder_id": holder_id,
        "p_lock_ttl_seconds": s.pool_refresh_lock_ttl_seconds,
    }).execute()
    if not lock_r.data:
        # Already locked by someone else — skip
        return {"status": "skipped", "reason": "lock_held"}

    # Read refresh token
    r = (
        admin.table("pool_accounts")
        .select("id, refresh_token, account_label")
        .eq("id", pool_account_id)
        .maybe_single()
        .execute()
    )
    if not r.data:
        return {"status": "error", "reason": "not_found"}
    refresh_token = r.data["refresh_token"]

    try:
        token_resp = await _portal_post(
            "/api/oauth/token",
            {
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": s.nous_client_id,
            },
            headers={"x-nous-refresh-token": refresh_token},
        )
    except RuntimeError as e:
        msg = str(e)
        # 400 invalid_grant → mark dead
        if "400" in msg or "invalid_grant" in msg.lower() or "401" in msg:
            admin.rpc("mark_pool_account_dead", {
                "p_pool_account_id": pool_account_id,
                "p_error_message": msg[:500],
            }).execute()
            return {"status": "dead", "reason": msg[:500]}
        # Otherwise just release the lock and bail
        admin.table("pool_accounts").update({
            "refresh_lock_acquired_at": None,
            "refresh_lock_acquired_by": None,
            "health_status": "healthy",
        }).eq("id", pool_account_id).execute()
        return {"status": "error", "reason": msg[:500]}

    access_token = token_resp["access_token"]
    new_refresh = token_resp.get("refresh_token", refresh_token)
    expires_in = int(token_resp.get("expires_in", 900))
    token_expires_at = (
        datetime.now(timezone.utc)
        + timedelta(seconds=expires_in - s.pool_token_refresh_skew_seconds)
    ).isoformat()

    admin.table("pool_accounts").update({
        "access_token": access_token,
        "refresh_token": new_refresh,
        "token_expires_at": token_expires_at,
        "health_status": "healthy",
        "refresh_lock_acquired_at": None,
        "refresh_lock_acquired_by": None,
        "last_error_at": None,
        "last_error_msg": None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", pool_account_id).execute()

    return {"status": "ok"}


async def refresh_all_due() -> dict:
    """Find all accounts whose tokens are within the refresh skew window
    and refresh them. Returns {refreshed, skipped, dead}."""
    s = _settings()
    admin = supabase_admin()
    threshold = (
        datetime.now(timezone.utc) + timedelta(seconds=s.pool_token_refresh_skew_seconds)
    ).isoformat()

    r = (
        admin.table("pool_accounts")
        .select("id, health_status, token_expires_at")
        .lte("token_expires_at", threshold)
        .in_("health_status", ["healthy", "degraded"])
        .execute()
    )
    accounts = r.data or []
    refreshed = 0
    dead = 0
    skipped = 0
    for a in accounts:
        result = await refresh_pool_account_token(a["id"])
        if result["status"] == "ok":
            refreshed += 1
        elif result["status"] == "dead":
            dead += 1
        else:
            skipped += 1
    return {"refreshed": refreshed, "dead": dead, "skipped": skipped, "considered": len(accounts)}


# ============================================================
# Helpers
# ============================================================


async def _detect_models_for_token(access_token: str) -> list[str]:
    """Return the ':free' model ids this token can reach, from GET /v1/models.

    Previously this fired a real chat completion at a hardcoded candidate list.
    That was slow (up to 6 x 20s of *synchronous* httpx inside an async handler,
    blocking the whole event loop) and wrong — most of those ids no longer
    exist upstream, so a healthy account looked like it supported one model.
    """
    s = _settings()
    base = s.inference_base_url
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"{base}/models",
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if r.status_code >= 400:
            log.warning(f"model detection: upstream returned {r.status_code}")
            return []
        body = r.json()
        models = body.get("data", body) if isinstance(body, dict) else body
        return sorted(
            str(m.get("id"))
            for m in models
            if str(m.get("id", "")).endswith(":free")
        )
    except Exception as e:
        log.warning(f"model detection failed: {e}")
        return []