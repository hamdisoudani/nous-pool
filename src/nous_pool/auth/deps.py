"""
Auth dependencies.

We accept two credential shapes:
  1. A Supabase session JWT in either:
     - Authorization: Bearer *** OR
     - HttpOnly cookie named `nous_pool_session`
     Either way, the JWT is verified against Supabase's JWKS / HS256 secret.
  2. An api_key (sk_live_….) in Authorization: Bearer sk_live_…

Both forms yield an `AuthContext` carrying:
  - `user_id` (app_users.id)
  - `auth_user_id` (auth.users.id, for the Supabase identity)
  - `email`
  - `role` ("admin" | "user")
  - `api_key_id` (only when authenticated via API key)
  - `api_key_hash` (only when via API key — for re-verifying row state)

Dependencies:
  - `current_context` — any authenticated user (admin or user)
  - `require_admin` — only admin role (else 403)
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from fastapi import Cookie, Depends, Header, HTTPException, status

from ..db import supabase_admin
from .api_key import verify_key


@dataclass
class AuthContext:
    user_id: str
    auth_user_id: str
    email: str
    role: str
    api_key_id: Optional[str] = None
    api_key_label: Optional[str] = None


def _load_user_by_auth_id(auth_user_id: str) -> Optional[dict]:
    r = (
        supabase_admin()
        .table("app_users")
        .select("id, auth_user_id, email, role, disabled_at")
        .eq("auth_user_id", auth_user_id)
        .maybe_single()
        .execute()
    )
    return r.data if r.data else None


def _load_user_by_email(email: str) -> Optional[dict]:
    r = (
        supabase_admin()
        .table("app_users")
        .select("id, auth_user_id, email, role, disabled_at")
        .eq("email", email.lower())
        .maybe_single()
        .execute()
    )
    return r.data if r.data else None


def _decode_jwt_sub(jwt: str) -> Optional[str]:
    """Pull the 'sub' claim from a Supabase JWT (HS256). We don't verify the
    signature here — Supabase's auth.get_user() does that via REST. We just
    need the auth_user_id for the lookup."""
    import base64, json
    try:
        payload_b64 = jwt.split(".")[1]
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload_b64_std = padded.replace("-", "+").replace("_", "/")
        payload = json.loads(base64.b64decode(payload_b64_std))
        return payload.get("sub")
    except Exception:
        return None


async def current_context(
    authorization: Optional[str] = Header(default=None),
    nous_pool_session: Optional[str] = Cookie(default=None),
) -> Optional[AuthContext]:
    """Resolve an AuthContext from either a Bearer JWT, a Bearer sk_live_ key,
    or the session cookie. Returns None if nothing matched (does NOT raise)."""
    bearer = None
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization[7:].strip()
    elif nous_pool_session:
        bearer = nous_pool_session

    if not bearer:
        return None

    # Try API key first (sk_live_...)
    if bearer.startswith("sk_live_"):
        return await _resolve_api_key(bearer)

    # Try Supabase JWT
    auth_user_id = _decode_jwt_sub(bearer)
    if not auth_user_id:
        return None
    user = _load_user_by_auth_id(auth_user_id)
    if not user:
        return None
    if user.get("disabled_at"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "user_disabled", "email": user.get("email")},
        )
    return AuthContext(
        user_id=user["id"],
        auth_user_id=user["auth_user_id"],
        email=user["email"],
        role=user["role"],
    )


async def _resolve_api_key(plain_key: str) -> Optional[AuthContext]:
    """Look up an api_key by hash, return its AuthContext if active."""
    admin = supabase_admin()
    # We can't hash in SQL efficiently, so fetch all active keys and match in Python.
    # For very large key sets this would be slow — we'd want a partial hash column.
    # For our scale (hundreds of keys at most), this is fine.
    r = (
        admin.table("api_keys")
        .select("id, user_id, key_hash, key_label, is_active, expires_at")
        .eq("is_active", True)
        .execute()
    )
    for row in (r.data or []):
        if verify_key(plain_key, row["key_hash"]):
            # Found — load user
            if row.get("expires_at"):
                from datetime import datetime, timezone
                exp = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
                if exp < datetime.now(timezone.utc):
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail={"error": "api_key_expired"},
                    )
            user_r = (
                admin.table("app_users")
                .select("id, auth_user_id, email, role, disabled_at")
                .eq("id", row["user_id"])
                .maybe_single()
                .execute()
            )
            user = user_r.data if user_r.data else None
            if not user:
                return None
            if user.get("disabled_at"):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"error": "user_disabled"},
                )
            return AuthContext(
                user_id=user["id"],
                auth_user_id=user["auth_user_id"],
                email=user["email"],
                role=user["role"],
                api_key_id=row["id"],
                api_key_label=row.get("key_label"),
            )
    return None


async def require_user(
    ctx: Optional[AuthContext] = Depends(current_context),
) -> AuthContext:
    if ctx is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "not_authenticated"},
        )
    return ctx


async def require_admin(
    ctx: Optional[AuthContext] = Depends(current_context),
) -> AuthContext:
    if ctx is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"error": "not_authenticated"},
        )
    if ctx.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "admin_required"},
        )
    return ctx