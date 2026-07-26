"""
Pool dispatcher — round-robin across healthy pool_accounts.

Selection algorithm:
  1. SQL function `reserve_pool_account_slot()` uses FOR UPDATE SKIP LOCKED
     to atomically pick one healthy account with capacity (in_flight < max_concurrent).
  2. The picked account's `in_flight` is incremented manually here (since
     the function returns the row, not a reservation).
  3. If the token is near expiry, refresh it inline (with the DB-backed lock).
  4. The caller uses the access_token to proxy the request, then calls
     `release_pool_account_slot()` to decrement in_flight + record stats.
"""
from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone

import httpx

from ..config import Settings, load_settings
from ..db import supabase_admin
from ..oauth import hermes_oauth

log = logging.getLogger(__name__)


def _settings() -> Settings:
    return load_settings()


async def reserve_pool_account() -> dict | None:
    """Atomically pick a healthy pool_account with capacity.

    Returns the row (including access_token + refresh_token) or None if pool empty.
    Caller MUST call release_pool_account_slot(account_id) when done.
    """
    s = _settings()
    admin = supabase_admin()

    # Atomic pick
    r = admin.rpc("reserve_pool_account_slot").execute()
    if not r.data:
        return None
    row = r.data[0]

    # Reserve a concurrency slot
    # The RPC doesn't increment in_flight; we do it here.
    # (Note: in a true high-concurrency setup, this would also need FOR UPDATE.
    # But since we just picked with SKIP LOCKED, we own this row.)
    new_in_flight = (row.get("in_flight") or 0) + 1
    admin.table("pool_accounts").update({
        "in_flight": new_in_flight,
        "last_used_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", row["id"]).execute()
    row["in_flight"] = new_in_flight

    # Refresh if near expiry
    expires_at = datetime.fromisoformat(row["token_expires_at"].replace("Z", "+00:00"))
    skew_threshold = datetime.now(timezone.utc) + timedelta(
        seconds=s.pool_token_refresh_skew_seconds
    )
    if expires_at <= skew_threshold:
        log.info(f"refreshing near-expiry account {row['id']} ({row['account_label']})")
        result = await hermes_oauth.refresh_pool_account_token(row["id"])
        if result["status"] == "ok":
            # Re-fetch row with fresh tokens
            r2 = (
                admin.table("pool_accounts")
                .select("*")
                .eq("id", row["id"])
                .maybe_single()
                .execute()
            )
            if r2.data:
                row = r2.data
        elif result["status"] == "dead":
            log.warning(f"account {row['id']} marked dead during refresh")
            # We already took a concurrency slot above; hand it back before
            # bailing out, otherwise every dead-refresh permanently burns one
            # of this account's max_concurrent slots.
            await release_pool_account_slot(
                row["id"], success=False,
                error_message="marked dead during refresh",
            )
            return None  # caller can retry, will pick a different account

    return row


async def release_pool_account_slot(account_id: str, *, success: bool = True,
                                    prompt_tokens: int = 0, completion_tokens: int = 0,
                                    error_message: str | None = None) -> None:
    """Decrement in_flight and update stats."""
    admin = supabase_admin()
    admin.rpc("release_pool_account_slot", {"p_id": account_id}).execute()
    admin.rpc("increment_pool_account_stats", {
        "p_pool_account_id": account_id,
        "p_requests": 1,
        "p_errors": 0 if success else 1,
        "p_prompt_tokens": prompt_tokens,
        "p_completion_tokens": completion_tokens,
    }).execute()
    if error_message:
        admin.table("pool_accounts").update({
            "last_error_at": datetime.now(timezone.utc).isoformat(),
            "last_error_msg": error_message[:1000],
        }).eq("id", account_id).execute()


# ============================================================
# Upstream model catalogue
# ============================================================

# The catalogue changes rarely but /v1/models is hit on every dashboard load,
# so cache it process-wide. Tuple of (fetched_at_monotonic, models).
_MODELS_CACHE: tuple[float, list[dict]] | None = None
_MODELS_TTL_SECONDS = 600
_models_lock = asyncio.Lock()


async def get_upstream_models(force: bool = False) -> list[dict]:
    """Fetch the upstream model catalogue, cached for _MODELS_TTL_SECONDS.

    Uses any healthy pool account's access token — the catalogue is identical
    per account. Raises RuntimeError when the pool is empty or upstream errors,
    so callers can surface a 503 rather than an empty list that looks like
    "no models exist".
    """
    global _MODELS_CACHE

    now = time.monotonic()
    if not force and _MODELS_CACHE and (now - _MODELS_CACHE[0]) < _MODELS_TTL_SECONDS:
        return _MODELS_CACHE[1]

    async with _models_lock:
        # Another coroutine may have refreshed while we waited on the lock.
        now = time.monotonic()
        if not force and _MODELS_CACHE and (now - _MODELS_CACHE[0]) < _MODELS_TTL_SECONDS:
            return _MODELS_CACHE[1]

        s = _settings()
        admin = supabase_admin()
        # NB: there is no `inference_base_url` column on pool_accounts —
        # elsewhere the code reads it off a select("*") row, where the missing
        # key silently yields None. Naming it in a select() is a hard error.
        r = (
            admin.table("pool_accounts")
            .select("id, access_token, token_expires_at")
            .eq("health_status", "healthy")
            .limit(1)
            .execute()
        )
        rows = r.data or []
        if not rows:
            raise RuntimeError("no healthy pool account to query the catalogue with")

        acct = rows[0]
        # Refresh first if the token is at/near expiry, else upstream 401s.
        try:
            expires_at = datetime.fromisoformat(
                acct["token_expires_at"].replace("Z", "+00:00")
            )
            if expires_at <= datetime.now(timezone.utc) + timedelta(
                seconds=s.pool_token_refresh_skew_seconds
            ):
                await hermes_oauth.refresh_pool_account_token(acct["id"])
                r2 = (
                    admin.table("pool_accounts")
                    .select("access_token")
                    .eq("id", acct["id"])
                    .maybe_single()
                    .execute()
                )
                if r2.data:
                    acct = {**acct, **r2.data}
        except (KeyError, ValueError, AttributeError):
            pass  # malformed timestamp — try the token as-is

        base = s.inference_base_url
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{base}/models",
                headers={"Authorization": f"Bearer {acct['access_token']}"},
            )
        if resp.status_code >= 400:
            raise RuntimeError(f"upstream /models returned {resp.status_code}")

        body = resp.json()
        models = body.get("data", body) if isinstance(body, dict) else body
        if not isinstance(models, list):
            raise RuntimeError("upstream /models returned an unexpected shape")

        _MODELS_CACHE = (time.monotonic(), models)
        log.info(f"cached {len(models)} upstream models")
        return models


# Upstream model objects carry ~20 fields each (benchmarks, aliases, pricing
# tiers, hugging_face_id, …). The dashboard renders a handful, so narrow them
# here: a smaller payload, and an upstream change to a field we don't use can't
# reshape our response.
_MODALITY_ORDER = ("text", "image", "video", "audio", "file")


def _sort_modalities(mods: list[str]) -> list[str]:
    """Canonical modality order.

    Upstream is inconsistent about ordering — the same set comes back as
    ["text","image","file"] on one model and ["file","image","text"] on the
    next. Sorting means the UI badges don't reshuffle between rows.
    """
    known = [m for m in _MODALITY_ORDER if m in mods]
    return known + sorted(m for m in mods if m not in _MODALITY_ORDER)


def normalize_model(m: dict) -> dict:
    """Flatten one upstream model object into the shape the dashboard renders.

    Every field degrades to None/[]/False rather than assuming the nested dicts
    exist: `architecture` is an empty object on 12 of the 289 current upstream
    entries, and `input_modalities` is explicitly null on 13 more.
    """
    arch = m.get("architecture") or {}
    top = m.get("top_provider") or {}
    reasoning = m.get("reasoning") or {}
    params = m.get("supported_parameters") or []

    def _int_or_none(v) -> int | None:
        return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None

    # Upstream reports two context numbers and they disagree — stepfun advertises
    # context_length 262144 while its serving provider caps at 256000. The
    # provider's figure is what a request is actually measured against, so it
    # wins; the top-level value is the fallback when no provider is named.
    ctx = _int_or_none(top.get("context_length")) or _int_or_none(m.get("context_length"))

    return {
        "id": m.get("id"),
        "name": m.get("name") or m.get("id"),
        "description": (m.get("description") or "").strip() or None,
        "context_length": ctx,
        "max_completion_tokens": _int_or_none(top.get("max_completion_tokens")),
        "input_modalities": _sort_modalities([str(x) for x in (arch.get("input_modalities") or [])]),
        "output_modalities": _sort_modalities([str(x) for x in (arch.get("output_modalities") or [])]),
        # e.g. "text+image+video->text" — a compact human-readable summary that
        # upstream already computes for us.
        "modality": arch.get("modality"),
        "supports_reasoning": bool(reasoning),
        "reasoning_required": bool(reasoning.get("mandatory")),
        "supports_tools": "tools" in params,
        "supports_structured_outputs": "structured_outputs" in params,
        "is_moderated": bool(top.get("is_moderated")),
    }


async def get_free_models() -> list[dict]:
    """Normalized metadata for every ':free' model, sorted by id.

    Empty list if upstream is unreachable — callers treat this as informational,
    not load-bearing, so a cold cache degrades to "no models listed" instead of
    failing the whole dashboard.
    """
    try:
        models = await get_upstream_models()
    except RuntimeError as e:
        log.warning(f"could not load free models: {e}")
        return []
    free = [m for m in models if str(m.get("id", "")).endswith(":free")]
    return sorted(
        (normalize_model(m) for m in free),
        key=lambda m: str(m.get("id") or ""),
    )


async def get_pool_stats() -> dict:
    """Aggregate stats for admin dashboard."""
    admin = supabase_admin()
    r2 = (
        admin.table("pool_accounts")
        .select("id, health_status, total_requests, total_errors, prompt_tokens, completion_tokens, total_tokens, in_flight, max_concurrent, last_used_at, last_error_msg")
        .execute()
    )
    rows = r2.data or []
    healthy = sum(1 for r in rows if r["health_status"] == "healthy")
    total_req = sum(r.get("total_requests") or 0 for r in rows)
    total_err = sum(r.get("total_errors") or 0 for r in rows)
    total_tok = sum(r.get("total_tokens") or 0 for r in rows)
    return {
        "total_accounts": len(rows),
        "healthy_accounts": healthy,
        "total_requests": total_req,
        "total_errors": total_err,
        "error_rate_pct": round((total_err / total_req * 100), 2) if total_req else 0.0,
        "total_tokens": total_tok,
        "accounts": [
            {
                "id": r["id"],
                "account_label": None,  # populated by /admin/accounts handler
                "health_status": r["health_status"],
                "total_requests": r["total_requests"],
                "total_errors": r["total_errors"],
                "total_tokens": r["total_tokens"],
                "in_flight": r["in_flight"],
                "max_concurrent": r["max_concurrent"],
                "last_used_at": r.get("last_used_at"),
                "last_error_msg": r.get("last_error_msg"),
            }
            for r in rows
        ],
    }