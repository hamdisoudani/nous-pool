"""
Configuration loaded from env vars. NOUS_POOL_* prefixed.

All persistence is in Supabase; we don't have a local SQLite anymore.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


def _get(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    # ===== Supabase =====
    # Project URL: https://<ref>.supabase.co
    supabase_url: str
    # Public anon key (used by frontend + for user auth verification)
    supabase_anon_key: str
    # Service-role key (BACKEND ONLY — never expose to frontend).
    # Bypasses RLS for backend admin operations.
    supabase_service_role_key: str
    # JWT secret used to verify Supabase JWTs (set in Supabase Dashboard → Settings → API → JWT Secret)
    # Optional: supabase-py can verify JWTs without it; we keep this for explicit verification.
    supabase_jwt_secret: str

    # ===== HTTP Server =====
    host: str
    port: int

    # ===== Nous/Hermes OAuth (for pool accounts) =====
    nous_device_code_url: str
    nous_token_url: str
    nous_client_id: str
    nous_scope: str
    inference_base_url: str

    # ===== Cookies =====
    cookie_name: str
    cookie_secure: bool
    cookie_max_age_seconds: int

    # ===== Pool =====
    pool_default_max_concurrent: int
    pool_refresh_lock_ttl_seconds: int
    pool_token_refresh_skew_seconds: int

    # ===== Endpoints =====
    public_base_url: str


def load_settings() -> Settings:
    """Load settings from env. Required vars are checked by main.py on boot."""
    return Settings(
        supabase_url=_get("NOUS_POOL_SUPABASE_URL", ""),
        supabase_anon_key=_get("NOUS_POOL_SUPABASE_ANON_KEY", ""),
        supabase_service_role_key=_get("NOUS_POOL_SUPABASE_SERVICE_ROLE_KEY", ""),
        supabase_jwt_secret=_get("NOUS_POOL_SUPABASE_JWT_SECRET", ""),

        host=_get("NOUS_POOL_HOST", "127.0.0.1"),
        port=int(_get("NOUS_POOL_PORT", "7890")),

        nous_device_code_url=_get(
            "NOUS_POOL_NOUS_DEVICE_CODE_URL",
            "https://portal.nousresearch.com/api/oauth/device/code",
        ),
        nous_token_url=_get(
            "NOUS_POOL_NOUS_TOKEN_URL",
            "https://portal.nousresearch.com/api/oauth/token",
        ),
        nous_client_id=_get("NOUS_POOL_NOUS_CLIENT_ID", "hermes-cli"),
        nous_scope=_get("NOUS_POOL_NOUS_SCOPE", "inference:invoke"),
        inference_base_url=_get(
            "NOUS_POOL_INFERENCE_BASE_URL",
            "https://inference-api.nousresearch.com/v1",
        ),

        cookie_name="nous_pool_session",
        cookie_secure=_get("NOUS_POOL_COOKIE_SECURE", "false").lower() == "true",
        cookie_max_age_seconds=12 * 3600,  # 12 hours, matches Supabase default JWT

        pool_default_max_concurrent=int(_get("NOUS_POOL_POOL_MAX_CONCURRENT", "12")),
        pool_refresh_lock_ttl_seconds=int(_get("NOUS_POOL_POOL_LOCK_TTL", "30")),
        pool_token_refresh_skew_seconds=int(_get("NOUS_POOL_POOL_REFRESH_SKEW", "120")),

        public_base_url=_get("NOUS_POOL_PUBLIC_BASE_URL", "http://localhost:7890"),
    )


def validate_required(s: Settings) -> list[str]:
    """Returns a list of missing required env var names. Empty list = OK."""
    missing = []
    if not s.supabase_url:
        missing.append("NOUS_POOL_SUPABASE_URL")
    if not s.supabase_anon_key:
        missing.append("NOUS_POOL_SUPABASE_ANON_KEY")
    if not s.supabase_service_role_key:
        missing.append("NOUS_POOL_SUPABASE_SERVICE_ROLE_KEY")
    return missing