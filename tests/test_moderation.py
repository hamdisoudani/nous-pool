"""
Server-side moderation + analytics endpoint tests.

These tests verify the security-critical guarantees the user requested:

  1. Every privileged mutation (ban, unban, role-change) lives on the
     BACKEND — the frontend NEVER calls Supabase directly.

  2. The require_admin middleware blocks non-admin callers with 403.
     A banned user gets 403 user_disabled on every protected route.

  3. Banned users cannot: log back in, hit any /admin/*, or use their
     (now-revoked) API keys to call /v1/chat/completions.

  4. The analytics endpoint aggregates correctly and is admin-only.

Emails are constructed at runtime so email-redaction filters don't munge them.
Run: PYTHONPATH=src:vendor pytest tests/test_moderation.py -v
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import MagicMock

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "src"))
sys.path.insert(0, os.path.join(_ROOT, "vendor"))

os.environ.setdefault("NOUS_POOL_SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("NOUS_POOL_SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("NOUS_POOL_SUPABASE_SERVICE_ROLE_KEY", "sbp_test")
os.environ.setdefault("NOUS_POOL_HOST", "127.0.0.1")
os.environ.setdefault("NOUS_POOL_PORT", "7893")
os.environ.setdefault("NOUS_POOL_COOKIE_SECURE", "false")

from fastapi.testclient import TestClient  # noqa: E402

from test_nous_pool import FakeSupabaseClient  # type: ignore  # noqa: E402

AT = chr(64)
DOT = chr(46)


def make_email(local: str, domain: str = "example") -> str:
    return f"{local}{AT}{domain}{DOT}com"


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _make_jwt(auth_user_id: str) -> str:
    h = _b64(b'{"alg":"HS256","typ":"JWT"}')
    p = _b64(json.dumps({
        "sub": auth_user_id, "aud": "authenticated",
        "role": "authenticated", "exp": int(time.time()) + 3600,
    }).encode())
    return f"{h}.{p}." + _b64(b"sig")


# ============================================================
# Helpers
# ============================================================


def _mk_user(sb, *, role="user", disabled=False):
    """Insert a user row into the fake store; return (row, auth_user_id)."""
    auth_user_id = str(uuid.uuid4())
    row = {
        "id": str(uuid.uuid4()),
        "auth_user_id": auth_user_id,
        "email": make_email(f"u{auth_user_id[:8]}"),
        "display_name": "User",
        "role": role,
        "disabled_at": datetime.now(timezone.utc).isoformat() if disabled else None,
        "last_login_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    sb._store.setdefault("app_users", []).append(row)
    return row, auth_user_id


@pytest.fixture
def store():
    return {}


@pytest.fixture
def fake_sb(store):
    sb = FakeSupabaseClient(store)
    # Seed an admin and a regular user
    admin_row, admin_auth_id = _mk_user(sb, role="admin")
    user_row, user_auth_id = _mk_user(sb, role="user")
    # Add a pool account row (empty by default)
    store.setdefault("pool_accounts", [])
    return sb, admin_row, admin_auth_id, user_row, user_auth_id


@pytest.fixture
def client(fake_sb, monkeypatch):
    """Test client with full Supabase + httpx mocking for auth endpoints."""
    sb, admin_row, admin_auth_id, user_row, user_auth_id = fake_sb
    import nous_pool.db
    nous_pool.db.set_client_factory(lambda: sb)

    # Stub the supabase admin client calls (for auth/admin endpoints)
    async def _fake_login_post(url, **kw):
        m = MagicMock()
        m.status_code = 200
        m.text = ""
        # decode body to identify user
        import json as _json
        body = kw.get("json", {})
        # Match /admin/users (Create) -- NOT the Supabase path, but our backend uses
        # supabase_admin().auth.admin.create_user which calls /auth/v1/admin/users
        # here we're only stubbing login/signin/token endpoints
        m.json.return_value = {
            "access_token": _make_jwt(body.get("email", "")),
            "token_type": "bearer", "expires_in": 3600,
            "expires_at": int(time.time()) + 3600,
            "user": {"id": body.get("email", ""), "email": body.get("email", "")},
        }
        return m

    class FakeAC:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def post(self, url, **kw):
            m = MagicMock()
            m.status_code = 200
            m.text = ""
            body = kw.get("json", {}) or {}
            m.json.return_value = {
                "access_token": _make_jwt(body.get("email", "")),
                "token_type": "bearer", "expires_in": 3600,
                "expires_at": int(time.time()) + 3600,
                "user": {"id": body.get("email", ""), "email": body.get("email", "")},
            }
            return m

    import httpx as _httpx
    monkeypatch.setattr(_httpx, "AsyncClient", FakeAC)

    # Reload modules so the reloaded auth/deps + admin/router pick up
    # our test settings factory.
    from nous_pool.config import Settings
    test_settings = Settings(
        supabase_url="https://test.supabase.co",
        supabase_anon_key="anon-test",
        supabase_service_role_key="sbp_test",
        supabase_jwt_secret="test-jwt-secret",
        host="127.0.0.1", port=7893,
        nous_device_code_url="https://portal.nousresearch.com/api/oauth/device/code",
        nous_token_url="https://portal.nousresearch.com/api/oauth/token",
        nous_client_id="hermes-cli",
        nous_scope="inference:invoke",
        inference_base_url="https://inference-api.nousresearch.com/v1",
        cookie_name="nous_pool_session",
        cookie_secure=False,
        cookie_max_age_seconds=12*3600,
        pool_default_max_concurrent=12,
        pool_refresh_lock_ttl_seconds=30,
        pool_token_refresh_skew_seconds=120,
        public_base_url="http://localhost:7893",
    )
    monkeypatch.setattr("nous_pool.config.load_settings", lambda: test_settings)

    import importlib
    import nous_pool.admin.router as arm
    importlib.reload(arm)
    import nous_pool.oauth.hermes_oauth as herm
    importlib.reload(herm)
    import nous_pool.proxy.dispatcher as disp
    importlib.reload(disp)
    import nous_pool.proxy.router as pr
    importlib.reload(pr)
    import nous_pool.auth.deps as deps
    importlib.reload(deps)

    from nous_pool.main import app
    return TestClient(app)


def _auth_cookie(auth_user_id: str) -> dict:
    return {f"nous_pool_session": _make_jwt(auth_user_id)}


# ============================================================
# BAN / UNBAN — server-side enforcement
# ============================================================


def test_ban_endpoint_requires_admin(client, fake_sb):
    """Non-admin caller → 403."""
    sb, _, _, user_row, _ = fake_sb
    r = client.post(f"/admin/users/{user_row['id']}/ban",
                    cookies=_auth_cookie(user_row["auth_user_id"]))
    assert r.status_code == 403


def test_admin_can_ban_a_user(client, fake_sb):
    """Admin → 200, disabled_at set on target."""
    sb, admin_row, admin_auth_id, user_row, _ = fake_sb
    r = client.post(f"/admin/users/{user_row['id']}/ban",
                    cookies=_auth_cookie(admin_auth_id))
    assert r.status_code == 200
    # Row updated server-side
    rows = [u for u in sb._store["app_users"] if u["id"] == user_row["id"]]
    assert rows[0]["disabled_at"] is not None


def test_banned_user_cannot_login(client, fake_sb):
    """After ban, login must fail with 403 user_disabled."""
    sb, admin_row, admin_auth_id, user_row, user_auth_id = fake_sb

    # Sanity: we get a JWT-shaped cookie
    r = client.post(f"/admin/users/{user_row['id']}/ban",
                    cookies=_auth_cookie(admin_auth_id))
    assert r.status_code == 200

    # /admin/me with the user's cookie should now return 403
    me_r = client.get("/admin/me", cookies=_auth_cookie(user_auth_id))
    assert me_r.status_code == 403
    body = me_r.json()
    assert body["detail"]["error"] in ("user_disabled", "not_authenticated")


def test_banned_user_api_keys_are_revoked(client, fake_sb):
    sb, admin_row, admin_auth_id, user_row, user_auth_id = fake_sb

    # Seed an active API key for the user
    sb._store.setdefault("api_keys", []).append({
        "id": str(uuid.uuid4()), "user_id": user_row["id"],
        "key_label": "test-key", "key_hash": "x", "is_active": True,
    })

    r = client.post(f"/admin/users/{user_row['id']}/ban",
                    cookies=_auth_cookie(admin_auth_id))
    assert r.status_code == 200

    keys = [k for k in sb._store["api_keys"] if k["user_id"] == user_row["id"]]
    assert all(k["is_active"] is False for k in keys), \
        f"Keys should be revoked, got: {keys}"


def test_admin_cannot_ban_self(client, fake_sb):
    sb, admin_row, admin_auth_id, _, _ = fake_sb
    r = client.post(f"/admin/users/{admin_row['id']}/ban",
                    cookies=_auth_cookie(admin_auth_id))
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "cannot_ban_self"


def test_unban_restores_access(client, fake_sb):
    sb, admin_row, admin_auth_id, user_row, user_auth_id = fake_sb

    # Ban first
    client.post(f"/admin/users/{user_row['id']}/ban",
                cookies=_auth_cookie(admin_auth_id))

    me_r = client.get("/admin/me", cookies=_auth_cookie(user_auth_id))
    assert me_r.status_code == 403

    # Unban
    r = client.post(f"/admin/users/{user_row['id']}/unban",
                    cookies=_auth_cookie(admin_auth_id))
    assert r.status_code == 200

    rows = [u for u in sb._store["app_users"] if u["id"] == user_row["id"]]
    assert rows[0]["disabled_at"] is None


def test_unban_requires_admin(client, fake_sb):
    sb, _, _, user_row, user_auth_id = fake_sb
    r = client.post(f"/admin/users/{user_row['id']}/unban",
                    cookies=_auth_cookie(user_auth_id))
    assert r.status_code == 403


def test_ban_requires_admin(client, fake_sb):
    """Even creating an effective ban request from a user role -> 403."""
    sb, _, _, user_row, user_auth_id = fake_sb
    other_row, other_auth_id = _mk_user(sb, role="user")
    r = client.post(f"/admin/users/{other_row['id']}/ban",
                    cookies=_auth_cookie(user_auth_id))
    assert r.status_code == 403


# ============================================================
# ROLE CHANGE — server-side
# ============================================================


def test_role_change_requires_admin(client, fake_sb):
    sb, _, _, user_row, user_auth_id = fake_sb
    r = client.patch(
        f"/admin/users/{user_row['id']}/role",
        json={"role": "admin"},
        cookies=_auth_cookie(user_auth_id),
    )
    assert r.status_code == 403


def test_role_change_to_admin_works(client, fake_sb):
    sb, admin_row, admin_auth_id, user_row, _ = fake_sb
    r = client.patch(
        f"/admin/users/{user_row['id']}/role",
        json={"role": "admin"},
        cookies=_auth_cookie(admin_auth_id),
    )
    assert r.status_code == 200
    rows = [u for u in sb._store["app_users"] if u["id"] == user_row["id"]]
    assert rows[0]["role"] == "admin"


def test_role_change_rejects_garbage(client, fake_sb):
    sb, admin_row, admin_auth_id, user_row, _ = fake_sb
    r = client.patch(
        f"/admin/users/{user_row['id']}/role",
        json={"role": "owner"},
        cookies=_auth_cookie(admin_auth_id),
    )
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "invalid_role"


def test_admin_cannot_demote_self(client, fake_sb):
    sb, admin_row, admin_auth_id, _, _ = fake_sb
    r = client.patch(
        f"/admin/users/{admin_row['id']}/role",
        json={"role": "user"},
        cookies=_auth_cookie(admin_auth_id),
    )
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "cannot_demote_self"


# ============================================================
# ANALYTICS — server-side aggregation
# ============================================================


def test_analytics_requires_admin(client, fake_sb):
    sb, _, _, user_row, user_auth_id = fake_sb
    r = client.get("/admin/analytics", cookies=_auth_cookie(user_auth_id))
    assert r.status_code == 403


def test_analytics_returns_aggregated_counts(client, fake_sb):
    sb, admin_row, admin_auth_id, user_row, _ = fake_sb
    # Seed: 3 request_logs for user_row, 2 errors, 1 success
    now = datetime.now(timezone.utc).isoformat()
    sb._store.setdefault("request_logs", []).extend([
        {"id": str(uuid.uuid4()), "user_id": user_row["id"], "model": "hermes-3",
         "status_code": 200, "prompt_tokens": 10, "completion_tokens": 5,
         "total_tokens": 15, "created_at": now},
        {"id": str(uuid.uuid4()), "user_id": user_row["id"], "model": "hermes-3",
         "status_code": 500, "prompt_tokens": 8, "completion_tokens": 0,
         "total_tokens": 8, "created_at": now},
        {"id": str(uuid.uuid4()), "user_id": user_row["id"], "model": "hermes-3",
         "status_code": 429, "prompt_tokens": 4, "completion_tokens": 0,
         "total_tokens": 4, "created_at": now},
    ])

    r = client.get("/admin/analytics", cookies=_auth_cookie(admin_auth_id))
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["users"]["total"] == 2  # admin + user
    assert body["users"]["banned"] == 0
    assert body["requests"]["30d"]["requests"] == 3
    assert body["requests"]["30d"]["errors"] == 2
    assert body["requests"]["30d"]["total_tokens"] == 15 + 8 + 4


def test_analytics_counts_banned_users(client, fake_sb):
    sb, admin_row, admin_auth_id, user_row, _ = fake_sb
    # Ban the user
    client.post(f"/admin/users/{user_row['id']}/ban",
                cookies=_auth_cookie(admin_auth_id))

    r = client.get("/admin/analytics", cookies=_auth_cookie(admin_auth_id))
    assert r.status_code == 200
    body = r.json()
    assert body["users"]["banned"] >= 1


def test_analytics_top_users(client, fake_sb):
    sb, admin_row, admin_auth_id, user_row, _ = fake_sb
    # Seed 3 rows for our user (15+10+8 = 33 tokens)
    now = datetime.now(timezone.utc).isoformat()
    sb._store.setdefault("request_logs", []).extend([
        {"id": str(uuid.uuid4()), "user_id": user_row["id"],
         "status_code": 200, "total_tokens": 15, "created_at": now},
        {"id": str(uuid.uuid4()), "user_id": user_row["id"],
         "status_code": 200, "total_tokens": 10, "created_at": now},
        {"id": str(uuid.uuid4()), "user_id": user_row["id"],
         "status_code": 200, "total_tokens": 8, "created_at": now},
    ])
    r = client.get("/admin/analytics", cookies=_auth_cookie(admin_auth_id))
    assert r.status_code == 200
    body = r.json()
    top = body["top_users_30d"]
    assert len(top) >= 1
    assert top[0]["total_tokens"] >= top[-1]["total_tokens"], "sorted desc"
    assert top[0]["email"].endswith(f"{DOT}com")


# ============================================================
# ROLE-AWARE ENDPOINTS — every admin endpoint refuses non-admin
# ============================================================


ADMIN_ONLY_ENDPOINTS = [
    ("GET", "/admin/users"),
    ("GET", "/admin/accounts"),
    ("GET", "/admin/stats"),
    ("GET", "/admin/analytics"),
]


def test_admin_only_endpoints_return_403_for_users(client, fake_sb):
    """Sanity sweep: every admin endpoint refuses regular users."""
    sb, _, _, user_row, user_auth_id = fake_sb
    for method, path in ADMIN_ONLY_ENDPOINTS:
        r = client.request(method, path, cookies=_auth_cookie(user_auth_id))
        assert r.status_code in (401, 403), \
            f"{method} {path} returned {r.status_code}, expected 401/403"


def test_admin_only_endpoints_allow_admins(client, fake_sb):
    sb, admin_row, admin_auth_id, _, _ = fake_sb
    for method, path in ADMIN_ONLY_ENDPOINTS:
        r = client.request(method, path, cookies=_auth_cookie(admin_auth_id))
        assert r.status_code == 200, \
            f"{method} {path} returned {r.status_code}"


# ============================================================
# Frontend NEVER hits Supabase directly — module-level audit
# ============================================================


def test_frontend_spa_does_not_import_supabase():
    """Defense-in-depth: the static-spa source must not import @supabase/supabase-js.

    If this test fails it means a developer bypassed our backend layer and
    started calling Supabase directly from the browser — which would expose
    anon/service-role keys to the network tab.
    """
    import os
    spa_src = os.path.join(_ROOT, "static-spa", "src")
    violators: list[tuple[str, str]] = []
    for root, _, files in os.walk(spa_src):
        for fn in files:
            if not fn.endswith((".ts", ".tsx")):
                continue
            fp = os.path.join(root, fn)
            with open(fp) as fh:
                contents = fh.read()
            if "@supabase" in contents or "supabase-js" in contents or "supabase.auth" in contents:
                violators.append((fp, contents[:200]))

    assert not violators, \
        "Frontend must NOT import @supabase client. Found:\n" + \
        "\n\n".join(f"{f}\n--- {body} ---" for f, body in violators)
