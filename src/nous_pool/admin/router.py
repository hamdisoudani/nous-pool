"""
Admin + Auth + Stats API.

Auth: HTTP-only cookie `nous_pool_session` containing the Supabase access JWT
      OR `Authorization: Bearer *** Supabase JWT.

The login flow is:
  POST /admin/auth/login { email, password } → Supabase REST signInWithPassword
  → set cookie → return user record.

Admin operations live under /admin/* and require role=admin.

User self-service operations live under /me/* and accept admin OR user role.

Pool account operations:
  POST /admin/accounts/add      { label }   → start device-code, return URL+code
  GET  /admin/accounts/poll/{flow_id}       → single poll attempt
  GET  /admin/accounts/flow/{flow_id}       → status
  GET  /admin/accounts                      → list pool_accounts
  POST /admin/accounts/{id}/refresh         → force-refresh single account
  POST /admin/accounts/refresh-all          → refresh all near-expiry

API key operations (admin):
  POST /admin/api-keys { user_id, label }   → mint a new key
  GET  /admin/api-keys?user_id=             → list keys
  DELETE /admin/api-keys/{id}               → revoke

Stats:
  GET /admin/stats                          → global aggregates + per-user table
  GET /me/usage                             → caller's own usage
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Body, Cookie, Depends, HTTPException, Header, Query, Request, Response, status
from fastapi.responses import JSONResponse

from ..auth.api_key import mint_key
from ..auth.deps import AuthContext, current_context, require_admin, require_user
from ..config import load_settings
from ..db import supabase_admin
from ..oauth import hermes_oauth
from ..proxy import dispatcher

log = logging.getLogger(__name__)

router = APIRouter()


def _settings():
    return load_settings()


# ============================================================
# /admin/auth/* — login, logout, me
# ============================================================


@router.post("/admin/auth/login")
async def login(body: dict, response: Response):
    """Sign in via Supabase email/password, set session cookie.

    The frontend redirects to Google sign-in via supabase.auth.signInWithOAuth
    OR signs in via supabase.auth.signInWithPassword. This endpoint is here
    for the email/password path AND so curl/scripts can log in without
    touching Supabase JS SDK.
    """
    s = _settings()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")
    if not email or not password:
        raise HTTPException(400, {"error": "missing_email_or_password"})

    # Call Supabase Auth REST: /auth/v1/token?grant_type=password
    import httpx
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            f"{s.supabase_url}/auth/v1/token?grant_type=password",
            headers={
                "apikey": s.supabase_anon_key,
                "Content-Type": "application/json",
            },
            json={"email": email, "password": password},
        )
    if r.status_code >= 400:
        raise HTTPException(401, {"error": "invalid_credentials", "supabase": r.text[:200]})
    data = r.json()
    access_token = data["access_token"]

    # Look up our app_users row
    auth_user_id = data["user"]["id"]
    admin = supabase_admin()
    user_r = (
        admin.table("app_users")
        .select("id, auth_user_id, email, role, display_name, disabled_at, last_login_at")
        .eq("auth_user_id", auth_user_id)
        .maybe_single()
        .execute()
    )
    user = user_r.data
    if not user:
        # Trigger should have created it — but if it didn't, create it now.
        # (Sign-ups via direct email go through the trigger; sign-ups via admin
        # signUp() don't always. Be safe.)
        ins = admin.table("app_users").insert({
            "auth_user_id": auth_user_id,
            "email": email,
            "role": "user",
            "display_name": data["user"].get("user_metadata", {}).get("display_name"),
        }).execute()
        if ins.data:
            user = ins.data[0]

    if not user:
        raise HTTPException(500, {"error": "user_record_missing"})

    if user.get("disabled_at"):
        raise HTTPException(403, {"error": "user_disabled"})

    # Update last_login_at
    admin.table("app_users").update({
        "last_login_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", user["id"]).execute()

    # Set HttpOnly cookie
    response.set_cookie(
        key=s.cookie_name,
        value=access_token,
        max_age=s.cookie_max_age_seconds,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )

    return {
        "user": {
            "id": user["id"],
            "email": user["email"],
            "role": user["role"],
            "display_name": user.get("display_name"),
        },
        "expires_at": data.get("expires_at"),
    }


@router.post("/admin/auth/logout")
async def logout(response: Response, _: AuthContext = Depends(require_user)):
    s = _settings()
    response.delete_cookie(s.cookie_name, path="/")
    return {"ok": True}


@router.post("/admin/auth/signup")
async def signup(body: dict, response: Response):
    """Self-service sign-up via Supabase email/password.

    The trigger `handle_new_auth_user` on auth.users creates the `app_users`
    row at default `role='user'`. The trigger `bootstrap_first_admin` on
    `app_users` promotes the very first signup to admin so the operator
    doesn't have to manually intervene before the system is usable.

    No admin token required to call this — anyone can sign up.
    """
    s = _settings()
    email = body.get("email", "").strip().lower()
    password = body.get("password", "")
    display_name = (body.get("display_name") or email.split("@")[0]).strip()

    if not email or not password:
        raise HTTPException(400, {"error": "missing_email_or_password"})
    if "@" not in email or "." not in email:
        raise HTTPException(400, {"error": "invalid_email"})
    if len(password) < 8:
        raise HTTPException(400, {"error": "password_too_short"})
    if len(password) > 72:
        # bcrypt limit (Supabase Auth uses bcrypt internally)
        raise HTTPException(400, {"error": "password_too_long"})

    import httpx
    async with httpx.AsyncClient(timeout=20) as client:
        # 1) Create the auth.users row. email_confirm: True skips the
        #    confirmation email flow (typical for self-hosted, since we
        #    don't have SMTP set up). If you DO want confirmation emails
        #    later, set NOUS_POOL_REQUIRE_EMAIL_CONFIRM=false or similar
        #    env and switch to False here.
        r = await client.post(
            f"{s.supabase_url}/auth/v1/admin/users",
            headers={
                "apikey": s.supabase_service_role_key,
                "Authorization": f"Bearer {s.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            json={
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"display_name": display_name},
            },
        )
    if r.status_code >= 400:
        body_err = r.text[:300]
        # Friendly messages for common cases
        if "already been registered" in body_err or "already exists" in body_err.lower():
            raise HTTPException(409, {"error": "email_already_registered"})
        if "password" in body_err.lower() and ("weak" in body_err.lower() or "short" in body_err.lower()):
            raise HTTPException(400, {"error": "weak_password", "supabase": body_err})
        raise HTTPException(400, {"error": "signup_failed", "supabase": body_err})
    auth_user_id = r.json().get("id")
    if not auth_user_id:
        raise HTTPException(500, {"error": "signup_no_user_id"})

    # 2) Sign in immediately to mint a session JWT.
    import httpx as _httpx
    async with _httpx.AsyncClient(timeout=15) as client:
        r2 = await client.post(
            f"{s.supabase_url}/auth/v1/token?grant_type=password",
            headers={
                "apikey": s.supabase_anon_key,
                "Content-Type": "application/json",
            },
            json={"email": email, "password": password},
        )
    if r2.status_code >= 400:
        # Auth row exists but sign-in failed (e.g. email_confirm needed in
        # the future). Tell the user to log in manually.
        raise HTTPException(201, {"status": "created_signin_required"})

    access_token = r2.json()["access_token"]

    # 3) Look up our app_users row — created by handle_new_auth_user trigger;
    #    role may have been bumped to admin by bootstrap_first_admin if this
    #    is the very first signup.
    admin = supabase_admin()
    # Tiny delay because trigger is async (NOT actually; triggers are sync),
    # but be defensive — retry once if not found.
    user = None
    for _ in range(3):
        user_r = (
            admin.table("app_users")
            .select("id, auth_user_id, email, role, display_name, disabled_at, last_login_at")
            .eq("auth_user_id", auth_user_id)
            .maybe_single()
            .execute()
        )
        user = user_r.data
        if user:
            break
        import asyncio
        await asyncio.sleep(0.2)

    if not user:
        # Trigger didn't fire for some reason — create the row manually.
        ins = admin.table("app_users").insert({
            "auth_user_id": auth_user_id,
            "email": email,
            "display_name": display_name,
            "role": "user",
        }).execute()
        user = ins.data[0] if ins.data else None

    if not user:
        raise HTTPException(500, {"error": "app_user_record_missing"})

    # First-user bootstrap: if there are zero admins in app_users, promote
    # this new user to admin. Mirrors bootstrap_first_admin in SQL but
    # runs in code so we don't depend on the DB trigger being installed.
    admin_count_r = (
        admin.table("app_users")
        .select("id")
        .eq("role", "admin")
        .limit(1)
        .execute()
    )
    if not (admin_count_r.data or []):
        # No admins exist yet — make this newcomer the operator admin.
        upd = admin.table("app_users").update({"role": "admin"}).eq("id", user["id"]).execute()
        if upd.data:
            user["role"] = "admin"

    admin.table("app_users").update({
        "last_login_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", user["id"]).execute()

    response.set_cookie(
        key=s.cookie_name,
        value=access_token,
        max_age=s.cookie_max_age_seconds,
        httponly=True,
        secure=s.cookie_secure,
        samesite="lax",
        path="/",
    )

    return {
        "user": {
            "id": user["id"],
            "email": user["email"],
            "role": user["role"],
            "display_name": user.get("display_name"),
            "avatar_url": None,
            "disabled_at": user.get("disabled_at"),
            "last_login_at": user.get("last_login_at"),
            "created_at": user.get("created_at") or datetime.now(timezone.utc).isoformat(),
        },
        "expires_at": r2.json().get("expires_at"),
    }


@router.get("/admin/me")
async def me(ctx: AuthContext = Depends(require_user)):
    admin = supabase_admin()
    r = (
        admin.table("app_users")
        .select("id, auth_user_id, email, display_name, role, disabled_at, last_login_at, created_at")
        .eq("id", ctx.user_id)
        .maybe_single()
        .execute()
    )
    row = r.data
    if not row:
        # Safe fallback if the trigger hasn't materialised yet
        return {
            "id": ctx.user_id,
            "email": ctx.email,
            "display_name": None,
            "avatar_url": None,
            "role": ctx.role,
            "disabled_at": None,
            "last_login_at": None,
            "created_at": None,
            "active_api_keys_count": 0,
        }
    return {
        "id": row["id"],
        "email": row["email"],
        "display_name": row.get("display_name"),
        "avatar_url": None,
        "role": row["role"],
        "disabled_at": row.get("disabled_at"),
        "last_login_at": row.get("last_login_at"),
        "created_at": row.get("created_at"),
        # Active-API-key count (separate small query; cheap on indexed user_id).
        "active_api_keys_count": _count_active_keys(ctx.user_id),
    }


def _count_active_keys(user_id: str) -> int:
    """Return count of active (non-revoked) API keys for a user."""
    try:
        r = (
            supabase_admin()
            .table("api_keys")
            .select("id, is_active")
            .eq("user_id", user_id)
            .execute()
        )
        return sum(1 for k in (r.data or []) if k.get("is_active"))
    except Exception:
        return 0


# ============================================================
# /admin/users/* — list users (admin can promote roles via Studio)
# ============================================================


@router.get("/admin/users")
async def list_users(_: AuthContext = Depends(require_admin)):
    """List all app_users. Admin promotes roles in Supabase Studio."""
    admin = supabase_admin()
    r = (
        admin.table("app_users")
        .select("id, auth_user_id, email, display_name, role, disabled_at, last_login_at, created_at, updated_at")
        .order("created_at", desc=False)
        .execute()
    )
    rows = r.data or []
    out = []
    for u in rows:
        out.append({
            "id": u["id"],
            "email": u["email"],
            "display_name": u.get("display_name"),
            "role": u["role"],
            "disabled_at": u.get("disabled_at"),
            "last_login_at": u.get("last_login_at"),
            "created_at": u.get("created_at"),
            "active_keys_count": 0,  # TODO: secondary query for counts
        })
    return {"users": out}


# ============================================================
# /admin/accounts/* — pool account management
# ============================================================


@router.post("/admin/accounts/add")
async def start_add_account(body: dict, ctx: AuthContext = Depends(require_admin)):
    """Start a new Hermes device-code flow. Returns URL + code for the admin."""
    label = body.get("label", "").strip()
    if not label:
        raise HTTPException(400, {"error": "missing_label"})
    flow = await hermes_oauth.start_device_code_flow(label, ctx.user_id)
    return flow


@router.get("/admin/accounts/flow/{flow_id}")
async def get_flow(flow_id: str, _: AuthContext = Depends(require_admin)):
    """Status of an in-flight device-code flow (does NOT poll)."""
    admin = supabase_admin()
    r = (
        admin.table("oauth_flows")
        .select("id, account_label, user_code, verification_uri, status, expires_at, error_message, pool_account_id, created_at")
        .eq("id", flow_id)
        .maybe_single()
        .execute()
    )
    if not r.data:
        raise HTTPException(404, {"error": "flow_not_found"})
    return r.data


@router.post("/admin/accounts/flow/{flow_id}/poll")
async def poll_flow(flow_id: str, _: AuthContext = Depends(require_admin)):
    """One poll attempt. Returns the updated flow row."""
    return await hermes_oauth.poll_device_code_once(flow_id)


@router.get("/admin/accounts")
async def list_pool_accounts(_: AuthContext = Depends(require_admin)):
    """All pool_accounts with stats — for admin dashboard."""
    admin = supabase_admin()
    r = (
        admin.table("pool_accounts")
        .select("""
            id, account_label, health_status, weight,
            total_requests, total_errors, prompt_tokens, completion_tokens, total_tokens,
            in_flight, max_concurrent,
            last_used_at, last_error_at, last_error_msg,
            token_expires_at, supported_models, created_at, updated_at
        """)
        .order("created_at", desc=False)
        .execute()
    )
    return {"accounts": r.data or []}


@router.post("/admin/accounts/{account_id}/refresh")
async def refresh_account(account_id: str, _: AuthContext = Depends(require_admin)):
    result = await hermes_oauth.refresh_pool_account_token(account_id)
    return result


@router.post("/admin/accounts/refresh-all")
async def refresh_all_accounts(_: AuthContext = Depends(require_admin)):
    return await hermes_oauth.refresh_all_due()


@router.delete("/admin/accounts/{account_id}")
async def delete_pool_account(account_id: str, _: AuthContext = Depends(require_admin)):
    admin = supabase_admin()
    admin.table("pool_accounts").delete().eq("id", account_id).execute()
    return {"ok": True}


# ============================================================
# /admin/api-keys/* — admin mints keys for users
# ============================================================


@router.post("/admin/api-keys")
async def mint(body: dict, _: AuthContext = Depends(require_admin)):
    """Admin mints an API key for a user. Returns the full key ONCE."""
    user_id = body.get("user_id")
    label = body.get("label", "default")
    if not user_id:
        raise HTTPException(400, {"error": "missing_user_id"})

    full_key, visible_prefix, key_hash = mint_key(label)
    admin = supabase_admin()
    r = (
        admin.table("api_keys")
        .insert({
            "user_id": user_id,
            "key_hash": key_hash,
            "key_prefix": visible_prefix,
            "key_label": label,
        })
        .execute()
    )
    if not r.data:
        raise HTTPException(500, {"error": "insert_failed"})
    return {
        "id": r.data[0]["id"],
        "sk_live_key": full_key,
        "prefix": visible_prefix,
        "label": label,
        "warning": "Save this key now. It will never be shown again.",
    }


@router.get("/admin/api-keys")
async def list_keys(user_id: str = Query(...), _: AuthContext = Depends(require_admin)):
    admin = supabase_admin()
    r = (
        admin.table("api_keys")
        .select("id, user_id, key_prefix, key_label, is_active, last_used_at, total_requests, total_prompt_tokens, total_completion_tokens, created_at, expires_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return r.data or []


@router.delete("/admin/api-keys/{key_id}")
async def revoke_key(key_id: str, _: AuthContext = Depends(require_admin)):
    admin = supabase_admin()
    admin.table("api_keys").update({"is_active": False}).eq("id", key_id).execute()
    return {"ok": True}


# ============================================================
# /admin/stats — aggregate admin stats
# /me/usage — caller's own usage
# ============================================================


@router.get("/admin/stats")
async def admin_stats(_: AuthContext = Depends(require_admin)):
    admin = supabase_admin()
    # users
    users_r = admin.table("app_users").select("id, email, role, created_at, last_login_at, disabled_at").execute()
    users = users_r.data or []
    # api_keys aggregate
    keys_r = admin.table("api_keys").select("id, user_id, is_active, total_requests, total_prompt_tokens, total_completion_tokens").execute()
    keys = keys_r.data or []
    active_keys = sum(1 for k in keys if k["is_active"])
    # pool accounts
    pool_r = admin.table("pool_accounts").select("id, health_status, total_requests, total_errors, total_tokens, in_flight").execute()
    pool = pool_r.data or []
    # request logs aggregate (last 30 days for cost estimate)
    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    logs_r = (
        admin.table("request_logs")
        .select("user_id, pool_account_id, model, total_tokens, status_code, created_at")
        .gte("created_at", since)
        .execute()
    )
    logs = logs_r.data or []
    total_requests = len(logs)
    total_tokens = sum(l.get("total_tokens") or 0 for l in logs)
    success_requests = sum(1 for l in logs if 200 <= (l.get("status_code") or 0) < 400)

    return {
        "users": {
            "total": len(users),
            "active": sum(1 for u in users if not u.get("disabled_at")),
            "admins": sum(1 for u in users if u["role"] == "admin"),
            "disabled": sum(1 for u in users if u.get("disabled_at")),
        },
        "api_keys": {
            "total": len(keys),
            "active": active_keys,
            "total_requests": sum(k.get("total_requests") or 0 for k in keys),
            "total_prompt_tokens": sum(k.get("total_prompt_tokens") or 0 for k in keys),
            "total_completion_tokens": sum(k.get("total_completion_tokens") or 0 for k in keys),
        },
        "pool": {
            "total_accounts": len(pool),
            "healthy_accounts": sum(1 for p in pool if p["health_status"] == "healthy"),
            "dead_accounts": sum(1 for p in pool if p["health_status"] == "dead"),
            "total_requests": sum(p.get("total_requests") or 0 for p in pool),
            "total_errors": sum(p.get("total_errors") or 0 for p in pool),
            "total_tokens": sum(p.get("total_tokens") or 0 for p in pool),
            "in_flight": sum(p.get("in_flight") or 0 for p in pool),
        },
        "traffic_30d": {
            "total_requests": total_requests,
            "successful_requests": success_requests,
            "error_rate_pct": round((1 - success_requests / total_requests) * 100, 2) if total_requests else 0,
            "total_tokens": total_tokens,
        },
        "per_user": [
            {
                "user_id": u["id"],
                "email": u["email"],
                "role": u["role"],
                "active_keys_count": sum(1 for k in keys if k["user_id"] == u["id"] and k["is_active"]),
                "last_login_at": u.get("last_login_at"),
                "disabled_at": u.get("disabled_at"),
            }
            for u in users
        ],
    }


@router.get("/me/usage")
async def my_usage(ctx: AuthContext = Depends(require_user)):
    """Return caller's own usage summary."""
    admin = supabase_admin()
    since_30 = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    since_7 = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    logs_r = (
        admin.table("request_logs")
        .select("model, status_code, total_tokens, prompt_tokens, completion_tokens, created_at")
        .eq("user_id", ctx.user_id)
        .gte("created_at", since_30)
        .execute()
    )
    logs = logs_r.data or []
    total_req = len(logs)
    success = sum(1 for l in logs if 200 <= (l.get("status_code") or 0) < 400)
    total_tok = sum(l.get("total_tokens") or 0 for l in logs)
    prompt_tok = sum(l.get("prompt_tokens") or 0 for l in logs)
    completion_tok = sum(l.get("completion_tokens") or 0 for l in logs)

    # Daily breakdown (last 7 days)
    daily: dict[str, dict] = {}
    for i in range(7):
        d = (datetime.now(timezone.utc) - timedelta(days=i)).date().isoformat()
        daily[d] = {"date": d, "requests": 0, "tokens": 0}
    for l in logs:
        if l.get("created_at") and l["created_at"] >= since_7:
            d = l["created_at"][:10]
            if d in daily:
                daily[d]["requests"] += 1
                daily[d]["tokens"] += l.get("total_tokens") or 0

    return {
        "user_id": ctx.user_id,
        "email": ctx.email,
        "total_requests_30d": total_req,
        "successful_requests_30d": success,
        "error_rate_pct": round((1 - success / total_req) * 100, 2) if total_req else 0,
        "total_tokens_30d": total_tok,
        "prompt_tokens_30d": prompt_tok,
        "completion_tokens_30d": completion_tok,
        "daily": sorted(daily.values(), key=lambda x: x["date"]),
    }


# ============================================================
# /admin/me/* — caller-scoped operations
# ============================================================


@router.get("/admin/me/usage")
async def me_usage(ctx: AuthContext = Depends(require_user)):
    """Return caller's own usage summary over the past 30 days."""
    admin = supabase_admin()
    since_30 = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    logs_r = (
        admin.table("request_logs")
        .select("model, status_code, total_tokens, prompt_tokens, completion_tokens, created_at")
        .eq("user_id", ctx.user_id)
        .gte("created_at", since_30)
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    logs = logs_r.data or []
    total_req = len(logs)
    error_count = sum(1 for l in logs if (l.get("status_code") or 0) >= 400)
    total_tok = sum(l.get("total_tokens") or 0 for l in logs)
    prompt_tok = sum(l.get("prompt_tokens") or 0 for l in logs)
    completion_tok = sum(l.get("completion_tokens") or 0 for l in logs)

    return {
        "period": {"days": 30},
        "totals": {
            "requests": total_req,
            "errors": error_count,
            "prompt_tokens": prompt_tok,
            "completion_tokens": completion_tok,
            "total_tokens": total_tok,
        },
        "by_day": [],  # bundled inline; optional future expansion
        "recent": [
            {
                "id": l.get("id") or f"{l['created_at']}-{l['model']}",
                "model": l.get("model") or "unknown",
                "created_at": l.get("created_at"),
                "status_code": l.get("status_code") or 0,
                "tokens": l.get("total_tokens") or 0,
            }
            for l in logs[:20]
        ],
    }


@router.get("/admin/me/api-keys")
async def list_my_api_keys(ctx: AuthContext = Depends(require_user)):
    """List API keys for the current user."""
    admin = supabase_admin()
    r = (
        admin.table("api_keys")
        .select("id, user_id, key_prefix, key_label, is_active, last_used_at, total_requests, created_at, expires_at")
        .eq("user_id", ctx.user_id)
        .order("created_at", desc=True)
        .execute()
    )
    rows = r.data or []
    return {
        "keys": [
            {
                "id": k["id"],
                "user_id": k["user_id"],
                "key_prefix": k["key_prefix"],
                "label": k.get("key_label") or "",
                "is_active": k.get("is_active"),
                "last_used_at": k.get("last_used_at"),
                "total_requests": k.get("total_requests") or 0,
                "created_at": k["created_at"],
            }
            for k in rows
        ]
    }


@router.post("/admin/me/api-keys")
async def create_my_api_key(body: dict, ctx: AuthContext = Depends(require_user)):
    """Mint a new API key for the current user. Returns full key ONCE."""
    from ..auth.api_key import mint_key
    label = (body.get("label") or "default").strip()
    if not label:
        raise HTTPException(400, {"error": "missing_label"})

    full_key, visible_prefix, key_hash = mint_key(label)
    admin = supabase_admin()
    r = (
        admin.table("api_keys")
        .insert({
            "user_id": ctx.user_id,
            "key_hash": key_hash,
            "key_prefix": visible_prefix,
            "key_label": label,
            "is_active": True,
        })
        .execute()
    )
    if not r.data:
        raise HTTPException(500, {"error": "insert_failed"})
    return {
        "id": r.data[0]["id"],
        "user_id": ctx.user_id,
        "key_prefix": visible_prefix,
        "label": label,
        "sk_live_key": full_key,
        "is_active": True,
        "total_requests": 0,
        "created_at": r.data[0]["created_at"],
        "last_used_at": None,
    }


@router.delete("/admin/me/api-keys/{key_id}")
async def revoke_my_api_key(key_id: str, ctx: AuthContext = Depends(require_user)):
    """Revoke (deactivate) one of the caller's API keys. Idempotent."""
    admin = supabase_admin()
    r = (
        admin.table("api_keys")
        .update({"is_active": False})
        .eq("id", key_id)
        .eq("user_id", ctx.user_id)  # only your own keys
        .execute()
    )
    if not r.data:
        raise HTTPException(404, {"error": "key_not_found"})
    return {"ok": True}


# ============================================================
# Health
# ============================================================


@router.get("/healthz")
async def healthz():
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat()}


# ============================================================
# /admin/users/* — server-side moderation (ban / unban / role)
# ============================================================
# All three endpoints are admin-only via the require_admin middleware.
# Frontend NEVER calls Supabase directly — every privileged mutation
# (ban, unban, role change) goes through here.
# ============================================================


def _user_response(u: dict, active_keys_count: int = 0) -> dict:
    """Build the canonical /admin/user response shape — NEVER include
    internal columns like auth_user_id or hashed passwords."""
    return {
        "id": u["id"],
        "email": u["email"],
        "display_name": u.get("display_name"),
        "role": u["role"],
        "disabled_at": u.get("disabled_at"),
        "last_login_at": u.get("last_login_at"),
        "created_at": u.get("created_at"),
        "active_keys_count": active_keys_count,
    }


@router.post("/admin/users/{user_id}/ban")
async def ban_user(
    user_id: str,
    body: dict = {},
    ctx: AuthContext = Depends(require_admin),
):
    """Ban a user: set disabled_at to now() and revoke ALL of their API keys.

    Server-side enforcement: subsequent logins will fail (auth/deps.py
    `current_context` returns 403 user_disabled), and any active API key
    that was already in the wild will also fail (api key path checks
    disabled_at too).

    Admin cannot ban themselves (prevents lock-out).
    """
    if user_id == ctx.user_id:
        raise HTTPException(400, {"error": "cannot_ban_self"})

    reason = (body or {}).get("reason") or None
    now = datetime.now(timezone.utc).isoformat()

    # 1) Disable user
    r = (
        supabase_admin()
        .table("app_users")
        .update({"disabled_at": now})
        .eq("id", user_id)
        .is_("disabled_at", "null")  # only ban active users
        .execute()
    )
    if not r.data:
        raise HTTPException(404, {"error": "user_not_found_or_already_disabled"})

    # 2) Revoke all of their API keys (best-effort; logged not fatal)
    supabase_admin().table("api_keys").update(
        {"is_active": False}
    ).eq("user_id", user_id).eq("is_active", True).execute()

    return {"ok": True, "user_id": user_id, "disabled_at": now, "reason": reason}


@router.post("/admin/users/{user_id}/unban")
async def unban_user(
    user_id: str,
    _: AuthContext = Depends(require_admin),
):
    """Restore access (clears disabled_at). Does NOT auto-restore revoked keys."""
    r = (
        supabase_admin()
        .table("app_users")
        .update({"disabled_at": None})
        .eq("id", user_id)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, {"error": "user_not_found"})
    return {"ok": True, "user_id": user_id, "disabled_at": None}


@router.patch("/admin/users/{user_id}/role")
async def set_user_role(
    user_id: str,
    body: dict,
    ctx: AuthContext = Depends(require_admin),
):
    """Promote / demote a user. Admin cannot demote themselves.

    Body: {"role": "user" | "admin"}
    """
    if user_id == ctx.user_id:
        raise HTTPException(400, {"error": "cannot_demote_self"})
    new_role = (body or {}).get("role")
    if new_role not in ("user", "admin"):
        raise HTTPException(400, {"error": "invalid_role"})

    r = (
        supabase_admin()
        .table("app_users")
        .update({"role": new_role})
        .eq("id", user_id)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, {"error": "user_not_found"})
    return {"ok": True, "user_id": user_id, "role": new_role}


# ============================================================
# /admin/analytics — site-wide aggregates (admin only)
# ============================================================


@router.get("/admin/analytics")
async def admin_analytics(_: AuthContext = Depends(require_admin)):
    """Site-wide analytics dashboard data:
      - Total users (active vs banned)
      - Total API keys (active vs revoked)
      - Pool accounts (active vs disabled)
      - Request stats: 24h, 7d, 30d totals (requests, errors, prompt/completion tokens)
      - Recent error rate
      - Top users by token usage (last 30 days)

    All SQL aggregates are computed in the backend (Supabase Postgrest).
    The frontend just receives the JSON and renders it. NEVER queries Supabase directly.
    """
    admin = supabase_admin()
    now = datetime.now(timezone.utc)
    last_24h = (now - timedelta(hours=24)).isoformat()
    last_7d = (now - timedelta(days=7)).isoformat()
    last_30d = (now - timedelta(days=30)).isoformat()

    # -- User counts (one query, one round trip) --
    users_r = (
        admin.table("app_users")
        .select("id, role, disabled_at")
        .execute()
    )
    users = users_r.data or []
    total_users = len(users)
    active_users = sum(1 for u in users if not u.get("disabled_at"))
    banned_users = total_users - active_users
    admin_count = sum(1 for u in users if u.get("role") == "admin")

    # -- API key counts --
    keys_r = (
        admin.table("api_keys")
        .select("id, is_active")
        .execute()
    )
    keys = keys_r.data or []
    total_keys = len(keys)
    active_keys = sum(1 for k in keys if k.get("is_active"))

    # -- Pool account counts --
    accts_r = (
        admin.table("pool_accounts")
        .select("id, health_status")
        .execute()
    )
    accts = accts_r.data or []
    pool_active = sum(1 for a in accts if (a.get("health_status") or "") == "healthy")
    pool_disabled = sum(1 for a in accts if (a.get("health_status") or "") == "disabled")
    pool_dead = sum(1 for a in accts if (a.get("health_status") or "") == "dead")

    # -- Request totals across three windows --
    def agg(since: str):
        r = (
            admin.table("request_logs")
            .select("status_code, prompt_tokens, completion_tokens, total_tokens")
            .gte("created_at", since)
            .limit(5000)
            .execute()
        )
        rows = r.data or []
        return {
            "requests": len(rows),
            "errors": sum(1 for r in rows if (r.get("status_code") or 0) >= 400),
            "prompt_tokens": sum((r.get("prompt_tokens") or 0) for r in rows),
            "completion_tokens": sum((r.get("completion_tokens") or 0) for r in rows),
            "total_tokens": sum((r.get("total_tokens") or 0) for r in rows),
        }

    requests_24h = agg(last_24h)
    requests_7d = agg(last_7d)
    requests_30d = agg(last_30d)

    # -- Top users by token usage (last 30d) --
    top_users_r = (
        admin.table("request_logs")
        .select("user_id, total_tokens")
        .gte("created_at", last_30d)
        .limit(5000)
        .execute()
    )
    by_user: dict[str, int] = {}
    for r in (top_users_r.data or []):
        uid = r.get("user_id")
        if not uid:
            continue
        by_user[uid] = by_user.get(uid, 0) + (r.get("total_tokens") or 0)

    # Hydrate user emails for the top 5
    top_user_ids = sorted(by_user, key=by_user.get, reverse=True)[:5]
    email_by_id = {}
    if top_user_ids:
        emails_r = (
            admin.table("app_users")
            .select("id, email")
            .in_("id", top_user_ids)
            .execute()
        )
        for u in (emails_r.data or []):
            email_by_id[u["id"]] = u["email"]

    top_users = [
        {
            "user_id": uid,
            "email": email_by_id.get(uid, "<deleted>"),
            "total_tokens": by_user[uid],
        }
        for uid in top_user_ids
    ]

    return {
        "ts": now.isoformat(),
        "users": {
            "total": total_users,
            "active": active_users,
            "banned": banned_users,
            "admins": admin_count,
        },
        "api_keys": {
            "total": total_keys,
            "active": active_keys,
            "revoked": total_keys - active_keys,
        },
        "pool_accounts": {
            "total": len(accts),
            "active": pool_active,
            "disabled": pool_disabled,
            "dead": pool_dead,
        },
        "requests": {
            "24h": requests_24h,
            "7d": requests_7d,
            "30d": requests_30d,
        },
        "top_users_30d": top_users,
    }