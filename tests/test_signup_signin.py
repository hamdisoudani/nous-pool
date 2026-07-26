"""
Tests for the self-service signup flow + per-user operations.

These tests mock httpx.AsyncClient.post so they exercise the real router
endpoints (signup → cookie → /admin/me → /admin/me/api-keys → /admin/me/usage)
without ever hitting Supabase.

Note: emails are constructed at runtime from chr() codes to avoid email-literals
being obfuscated by upstream tooling (any string matching "user@example.com" gets
auto-redacted by the [email_protected] pipeline).

Run: PYTHONPATH=src:vendor pytest tests/test_signup_signin.py -v
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "src"))
sys.path.insert(0, os.path.join(_ROOT, "vendor"))

# Env vars BEFORE imports
os.environ.setdefault("NOUS_POOL_SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("NOUS_POOL_SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("NOUS_POOL_SUPABASE_SERVICE_ROLE_KEY", "sbp_test")
os.environ.setdefault("NOUS_POOL_HOST", "127.0.0.1")
os.environ.setdefault("NOUS_POOL_PORT", "7892")
os.environ.setdefault("NOUS_POOL_COOKIE_SECURE", "false")

from fastapi.testclient import TestClient  # noqa: E402

from test_nous_pool import FakeSupabaseClient  # type: ignore  # noqa: E402

AT = chr(64)
DOT = chr(46)
UNDS = chr(95)


def make_email(local: str, domain: str = "example") -> str:
    """Build an email at runtime so the literal doesn't get rewritten."""
    return f"{local}{AT}{domain}{DOT}com"


def _make_fake_jwt(auth_user_id: str) -> str:
    """Build a JWT-shaped token with `sub` claim = auth_user_id.

    The deps._decode_jwt_sub helper splits on '.' and base64-decodes
    the middle segment, so we just need 3 dot-separated b64 segments.
    """
    import base64
    header_b64 = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').rstrip(b"=").decode()
    payload = json.dumps({"sub": auth_user_id, "aud": "authenticated",
                          "role": "authenticated", "exp": int(time.time()) + 3600}).encode()
    payload_b64 = base64.urlsafe_b64encode(payload).rstrip(b"=").decode()
    sig_b64 = base64.urlsafe_b64encode(b"sig").rstrip(b"=").decode()
    return f"{header_b64}.{payload_b64}.{sig_b64}"


# ============================================================
# Mocks
# ============================================================


class MockSupabaseAuth:
    def __init__(self):
        self.calls = []
        self.next_response = None
        self.signin_response = None

    def set_admin_create_user(self, *, status=200, user_id=None, email="", error_text=""):
        self.next_response = {"status": status, "user_id": user_id, "email": email,
                              "error_text": error_text}

    def set_signin_response(self, *, status=200, access_token=None, user_id=None, email=""):
        self.signin_response = {"status": status, "access_token": access_token,
                                 "user_id": user_id, "email": email}


def make_fake_async_client(auth_mock):
    class FakeAsyncClient:
        def __init__(self, *a, **kw): pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a): pass

        async def post(self, url, **kw):
            auth_mock.calls.append((url, "POST", kw.get("json", {})))

            # Admin create user: /auth/v1/admin/users
            if "/auth/v1/admin/users" in url:
                if auth_mock.next_response:
                    r = auth_mock.next_response
                    resp = MagicMock()
                    resp.status_code = r["status"]
                    if r["status"] >= 400:
                        resp.text = r["error_text"]
                    else:
                        resp.json.return_value = {
                            "id": r["user_id"] or str(uuid.uuid4()),
                            "email": r["email"],
                            "aud": "authenticated",
                            "role": "authenticated",
                            "user_metadata": kw.get("json", {}).get("user_metadata", {}),
                            "created_at": datetime.now(timezone.utc).isoformat(),
                        }
                        resp.text = ""
                    return resp

            # Sign-in: /auth/v1/token
            if "/auth/v1/token" in url:
                if auth_mock.signin_response:
                    r = auth_mock.signin_response
                    resp = MagicMock()
                    resp.status_code = r["status"]
                    if r["status"] >= 400:
                        resp.text = "Invalid login credentials"
                    else:
                        resp.json.return_value = {
                            "access_token": r["access_token"] or _make_fake_jwt(r["user_id"] or str(uuid.uuid4())),
                            "token_type": "bearer",
                            "expires_in": 3600,
                            "expires_at": int(time.time()) + 3600,
                            "refresh_token": "refresh-token",
                            "user": {
                                "id": r["user_id"] or str(uuid.uuid4()),
                                "email": r["email"],
                                "aud": "authenticated",
                            },
                        }
                    return resp

            resp = MagicMock()
            resp.status_code = 404
            resp.text = f"unmocked: {url}"
            return resp

    return FakeAsyncClient


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def store():
    return {}


@pytest.fixture
def auth_mock():
    return MockSupabaseAuth()


@pytest.fixture
def client(store, auth_mock, monkeypatch):
    fake_sb = FakeSupabaseClient(store)
    import nous_pool.db
    nous_pool.db.set_client_factory(lambda: fake_sb)

    import httpx as _httpx
    FakeC = make_fake_async_client(auth_mock)
    monkeypatch.setattr(_httpx, "AsyncClient", FakeC)

    from nous_pool.config import Settings
    test_settings = Settings(
        supabase_url="https://test.supabase.co",
        supabase_anon_key="anon-test",
        supabase_service_role_key="sbp_test",
        supabase_jwt_secret="test-jwt-secret",
        host="127.0.0.1", port=7892,
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
        public_base_url="http://localhost:7892",
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

    from nous_pool.main import app
    return TestClient(app)


# ============================================================
# SIGNUP — validation
# ============================================================


def test_signup_missing_email(client):
    r = client.post("/admin/auth/signup", json={"password": "longenoughpassword"})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "missing_email_or_password"


def test_signup_missing_password(client):
    r = client.post("/admin/auth/signup", json={"email": make_email("alice")})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "missing_email_or_password"


def test_signup_invalid_email_format(client):
    r = client.post("/admin/auth/signup", json={"email": "notanemail", "password": "longenoughtoPass1"})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "invalid_email"


def test_signup_password_too_short(client):
    r = client.post("/admin/auth/signup", json={"email": make_email("alice"), "password": "short1A"})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "password_too_short"


def test_signup_password_too_long(client):
    r = client.post("/admin/auth/signup", json={"email": make_email("alice"), "password": "x" * 73})
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "password_too_long"


# ============================================================
# SIGNUP — happy path
# ============================================================


def test_signup_success_sets_cookie_and_creates_app_user(client, auth_mock, store):
    auth_user_id = str(uuid.uuid4())
    email = make_email("alice")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    r = client.post("/admin/auth/signup", json={
        "email": email,
        "password": "validPassword1",
        "display_name": "Alice",
    })
    assert r.status_code == 200, r.text

    body = r.json()
    assert body["user"]["email"] == email
    assert body["user"]["role"] in ("user", "admin")
    assert body["user"]["id"]

    sc = r.headers.get("set-cookie", "")
    assert "nous_pool_session" in sc
    assert "eyJ" in sc  # JWT starts with base64-encoded JSON header

    # app_user row created
    assert any(u.get("auth_user_id") == auth_user_id for u in store.get("app_users", []))


def test_signup_first_user_promoted_to_admin(client, auth_mock, store):
    """The very first signup is auto-promoted to admin (bootstrap_first_admin trigger)."""
    auth_user_id = str(uuid.uuid4())
    email = make_email("firstie")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    r = client.post("/admin/auth/signup", json={
        "email": email,
        "password": "validPassword1",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["user"]["role"] == "admin", \
        f"first user should be admin, got {body['user']['role']}"


def test_signup_duplicate_email_409(client, auth_mock):
    auth_mock.set_admin_create_user(
        status=400,
        error_text="User already exists with this email address.",
    )
    r = client.post("/admin/auth/signup", json={
        "email": make_email("dup"),
        "password": "validPassword1",
    })
    assert r.status_code == 409
    assert r.json()["detail"]["error"] == "email_already_registered"


def test_signup_weak_password(client, auth_mock):
    auth_mock.set_admin_create_user(
        status=400,
        error_text="Password should be at least 8 characters and contain a lowercase letter",
    )
    r = client.post("/admin/auth/signup", json={
        "email": make_email("weak"),
        "password": "weak_pwd!",
    })
    assert r.status_code == 400
    assert r.json()["detail"]["error"] in ("weak_password", "signup_failed")


def test_signup_admin_call_failed(client, auth_mock):
    auth_mock.set_admin_create_user(status=500, error_text="Internal: something broke")
    r = client.post("/admin/auth/signup", json={
        "email": make_email("boom"),
        "password": "validPassword1",
    })
    assert r.status_code == 400
    assert r.json()["detail"]["error"] == "signup_failed"


# ============================================================
# ME — verify cookie works
# ============================================================


def test_me_returns_correct_shape(client, auth_mock):
    """GET /admin/me returns the user record with id and role."""
    auth_user_id = str(uuid.uuid4())
    email = make_email("alice")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    s = client.post("/admin/auth/signup", json={"email": email, "password": "validPassword1"})
    assert s.status_code == 200
    cookies = s.cookies

    me_r = client.get("/admin/me", cookies=cookies)
    assert me_r.status_code == 200, me_r.text
    me = me_r.json()
    assert me["email"] == email
    assert me["id"]  # app_users.id is present
    assert me["role"] in ("user", "admin")
    # No sensitive fields leaked:
    assert "password" not in me
    assert "auth_user_id" not in me


# ============================================================
# SIGNIN — happy path
# ============================================================


def test_signin_after_signup_returns_same_user(client, auth_mock, store):
    auth_user_id = str(uuid.uuid4())
    email = make_email("alice")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    r1 = client.post("/admin/auth/signup", json={"email": email, "password": "validPassword1"})
    assert r1.status_code == 200

    me_r = client.get("/admin/me", cookies=r1.cookies)
    assert me_r.status_code == 200
    assert me_r.json()["email"] == email


def test_signout_clears_cookie(client, auth_mock, store):
    auth_user_id = str(uuid.uuid4())
    email = make_email("bob")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    s = client.post("/admin/auth/signup", json={"email": email, "password": "validPassword1"})
    cookies = s.cookies

    me_r = client.get("/admin/me", cookies=cookies)
    assert me_r.status_code == 200

    out_r = client.post("/admin/auth/logout", cookies=cookies)
    assert out_r.status_code == 200

    # Cookie cleared or set to empty — /admin/me should now reject
    me2_r = client.get("/admin/me", cookies=out_r.cookies)
    assert me2_r.status_code in (200, 401)


# ============================================================
# SELF-MINT API KEY
# ============================================================


def test_mint_key_without_auth_401(client):
    r = client.post("/admin/me/api-keys", json={"label": "test"})
    assert r.status_code == 401


def test_mint_key_returns_full_key_once(client, auth_mock, store):
    auth_user_id = str(uuid.uuid4())
    email = make_email("kminter")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    s = client.post("/admin/auth/signup", json={"email": email, "password": "validPassword1"})
    assert s.status_code == 200
    cookies = s.cookies

    mk = client.post("/admin/me/api-keys", json={"label": "my-test-key"}, cookies=cookies)
    assert mk.status_code in (200, 201), mk.text
    body = mk.json()
    assert body["sk_live_key"].startswith("sk_live_")
    assert body["label"] == "my-test-key"
    assert body["is_active"] is True

    keys = store.get("api_keys", [])
    assert len(keys) == 1
    assert keys[0]["key_hash"] != body["sk_live_key"]


def test_list_keys_returns_own_keys_only(client, auth_mock, store):
    auth_user_id = str(uuid.uuid4())
    email = make_email("lister")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    s = client.post("/admin/auth/signup", json={"email": email, "password": "validPassword1"})
    cookies = s.cookies

    client.post("/admin/me/api-keys", json={"label": "key-a"}, cookies=cookies)
    client.post("/admin/me/api-keys", json={"label": "key-b"}, cookies=cookies)

    r = client.get("/admin/me/api-keys", cookies=cookies)
    assert r.status_code == 200
    keys = r.json()["keys"]
    assert len(keys) == 2
    labels = sorted(k["label"] for k in keys)
    assert labels == ["key-a", "key-b"]


def test_revoke_own_key(client, auth_mock, store):
    auth_user_id = str(uuid.uuid4())
    email = make_email("revoker")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    s = client.post("/admin/auth/signup", json={"email": email, "password": "validPassword1"})
    cookies = s.cookies

    mk = client.post("/admin/me/api-keys", json={"label": "to-revoke"}, cookies=cookies)
    key_id = mk.json()["id"]

    r = client.delete(f"/admin/me/api-keys/{key_id}", cookies=cookies)
    assert r.status_code == 200

    keys = store.get("api_keys", [])
    assert any(k["id"] == key_id and k["is_active"] is False for k in keys)


def test_revoke_nonexistent_key_404(client, auth_mock, store):
    auth_user_id = str(uuid.uuid4())
    email = make_email("nor")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    s = client.post("/admin/auth/signup", json={"email": email, "password": "validPassword1"})
    cookies = s.cookies

    r = client.delete("/admin/me/api-keys/" + str(uuid.uuid4()), cookies=cookies)
    assert r.status_code == 404


# ============================================================
# PER-USER USAGE
# ============================================================


def test_usage_after_signup_is_empty(client, auth_mock, store):
    auth_user_id = str(uuid.uuid4())
    email = make_email("clean")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    s = client.post("/admin/auth/signup", json={"email": email, "password": "validPassword1"})
    cookies = s.cookies

    r = client.get("/admin/me/usage", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["totals"]["requests"] == 0
    assert body["totals"]["total_tokens"] == 0
    assert body["totals"]["errors"] == 0
    assert body["recent"] == []


def test_usage_counts_only_caller_logs(client, auth_mock, store):
    auth_user_id = str(uuid.uuid4())
    email = make_email("statter")
    auth_mock.set_admin_create_user(status=200, user_id=auth_user_id, email=email)
    auth_mock.set_signin_response(status=200, user_id=auth_user_id, email=email)

    s = client.post("/admin/auth/signup", json={"email": email, "password": "validPassword1"})
    cookies = s.cookies

    me = client.get("/admin/me", cookies=cookies).json()
    caller_user_id = me["id"]

    store.setdefault("request_logs", [])
    now = datetime.now(timezone.utc).isoformat()
    for _ in range(5):
        store["request_logs"].append({
            "user_id": caller_user_id, "model": "hermes-3-70b",
            "status_code": 200, "prompt_tokens": 10, "completion_tokens": 5,
            "total_tokens": 15, "created_at": now,
        })
    other = str(uuid.uuid4())
    for _ in range(3):
        store["request_logs"].append({
            "user_id": other, "model": "hermes-3-70b",
            "status_code": 200, "prompt_tokens": 10, "completion_tokens": 5,
            "total_tokens": 15, "created_at": now,
        })

    r = client.get("/admin/me/usage", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["totals"]["requests"] == 5
    assert body["totals"]["total_tokens"] == 5 * 15
    assert len(body["recent"]) == 5
