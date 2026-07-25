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
from datetime import datetime, timezone

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
    skew_threshold = (
        datetime.now(timezone.utc)
        + __import__("datetime").timedelta(seconds=s.pool_token_refresh_skew_seconds)
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


async def get_pool_stats() -> dict:
    """Aggregate stats for admin dashboard."""
    admin = supabase_admin()
    r = admin.rpc("reserve_pool_account_slot").execute()  # warm
    # Just count via direct query
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