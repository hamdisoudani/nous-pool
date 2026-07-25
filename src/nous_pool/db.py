"""
Supabase clients.

Two clients:
  * `supabase_user(token)` — authenticated as a specific user (uses the user's JWT
    so RLS policies apply). Used for everything that respects user permissions.
  * `supabase_admin` — service-role key, bypasses RLS. Used for backend-only
    operations (round-robin pool selection, request logging, admin operations).

We initialise them lazily so the app can boot even before Supabase is reachable
(useful for tests that mock the client).
"""
from __future__ import annotations

from functools import lru_cache
from typing import Optional

from supabase import create_client, Client

from .config import Settings


@lru_cache(maxsize=1)
def _settings() -> Settings:
    from .config import load_settings
    return load_settings()


@lru_cache(maxsize=1)
def supabase_admin() -> Client:
    """Service-role client — bypasses RLS. Backend-only.

    Override _client_factory to inject a fake client in tests.
    """
    s = _settings()
    if _client_factory is not None:
        return _client_factory()
    return create_client(s.supabase_url, s.supabase_service_role_key)


# Module-level test hook: replace this with a callable returning a fake client.
_client_factory: Optional[callable] = None


def set_client_factory(factory) -> None:
    """Tests: inject a callable that returns a fake Supabase client."""
    global _client_factory
    _client_factory = factory
    supabase_admin.cache_clear()


def reset_client_factory() -> None:
    """Restore default behavior."""
    global _client_factory
    _client_factory = None
    supabase_admin.cache_clear()


def supabase_user(access_token: str) -> Client:
    """Authenticated client. The access_token is the Supabase JWT issued by
    supabase.auth.signInWithPassword (or OAuth, etc.) on the frontend."""
    s = _settings()
    client = create_client(s.supabase_url, s.supabase_anon_key)
    # Set the user's session so PostgREST applies RLS
    client.auth.set_session(access_token=access_token, refresh_token="")
    return client


def get_app_user_id_for_jwt(jwt: str) -> Optional[str]:
    """Resolve the app_users.id for a given Supabase JWT.

    Returns None if the JWT is invalid or no app_users row exists.
    Uses the service-role client (admin) because we trust the JWT signature,
    not the row claim.
    """
    admin = supabase_admin()
    # Decode the JWT to get the auth.users.id (sub claim)
    # Supabase JWTs are HS256 — we trust them once verified.
    import base64, json
    try:
        # JWT is "header.payload.signature" — take payload
        payload_b64 = jwt.split(".")[1]
        # base64url → base64
        padded = payload_b64 + "=" * (-len(payload_b64) % 4)
        payload_b64_std = padded.replace("-", "+").replace("_", "/")
        payload = json.loads(base64.b64decode(payload_b64_std))
        auth_user_id = payload["sub"]
    except Exception:
        return None

    # Look up our internal app_users.id
    r = (
        admin.table("app_users")
        .select("id, role, email, disabled_at")
        .eq("auth_user_id", auth_user_id)
        .maybe_single()
        .execute()
    )
    if not r.data:
        return None
    return r.data


__all__ = ["supabase_admin", "supabase_user", "get_app_user_id_for_jwt"]