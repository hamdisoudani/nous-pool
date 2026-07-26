"""End-to-end tests for the nous-pool FastAPI app (Supabase-backed).

Coverage:
  - test_healthz                                    app boots
  - test_unauthenticated_me                         /admin/me rejects without auth
  - test_login_via_supabase_password                POST /admin/auth/login (mocked Supabase)
  - test_login_invalid_credentials                  401 on bad password
  - test_login_disabled_user                        403 if disabled_at is set
  - test_me_with_cookie                             session cookie works
  - test_logout                                     clears session
  - test_create_pool_account_via_device_code        full OAuth flow (mocked portal)
  - test_pool_pick_round_robin                      dispatcher selects pool_accounts in round-robin order
  - test_pool_refresh_skips_healthy                 refresh-all only fires on near-expiry tokens
  - test_pool_mark_dead_on_400                      account marked dead when portal returns 400
  - test_api_key_mint                               /admin/api-keys POST → returns full sk_live_… key ONCE
  - test_api_key_authenticates_request             Authorization: Bearer sk_live_… validates
  - test_admin_stats                                /admin/stats aggregates correctly
  - test_me_usage                                   /me/usage returns caller's data

External services (Supabase + Nous portal) are NOT contacted — we monkeypatch
the supabase client and httpx.AsyncClient.post.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

# Make src importable
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "src"))
sys.path.insert(0, os.path.join(_ROOT, "vendor"))

# Set test env vars BEFORE importing the app
os.environ.setdefault("NOUS_POOL_SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault(
    "NOUS_POOL_SUPABASE_ANON_KEY",
    "test-anon-key",
)
os.environ.setdefault("NOUS_POOL_SUPABASE_SERVICE_ROLE_KEY", "sbp_test")
os.environ.setdefault("NOUS_POOL_HOST", "127.0.0.1")
os.environ.setdefault("NOUS_POOL_PORT", "7891")
os.environ.setdefault("NOUS_POOL_COOKIE_SECURE", "false")

from fastapi.testclient import TestClient  # noqa: E402

from nous_pool.auth.api_key import mint_key, verify_key  # noqa: E402

# ============================================================
# Fake Supabase client
# ============================================================


class FakeQuery:
    """Minimal builder that records the chain so tests can assert on it."""
    def __init__(self, store, table):
        self._store = store
        self._table = table
        self._filters: list = []
        self._select = "*"
        self._op = None
        self._data = None

    def select(self, cols="*"):
        self._select = cols
        return self

    def insert(self, data):
        self._op = "insert"
        self._data = data
        return self

    def update(self, data):
        self._op = "update"
        self._data = data
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def in_(self, col, vals):
        self._filters.append(("in", col, list(vals)))
        return self

    def lte(self, col, val):
        self._filters.append(("lte", col, val))
        return self

    def gte(self, col, val):
        self._filters.append(("gte", col, val))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def order(self, col, desc=False):
        return self

    def maybe_single(self):
        self._chain_ended_with_maybe_single = True
        return self

    def execute(self):
        return self._run()

    def _run(self):
        rows = self._store.setdefault(self._table, [])
        if self._op == "insert":
            data = self._data
            if isinstance(data, dict):
                if not data.get("id"):
                    data["id"] = str(uuid.uuid4())
                # Auto-fill created_at if caller didn't supply it (mirrors
                # the Postgres default CURRENT_TIMESTAMP).
                if "created_at" not in data:
                    data["created_at"] = datetime.now(timezone.utc).isoformat()
                rows.append(data)
                result = [data]
            else:
                result = []  # bulk insert not implemented in fake
        elif self._op == "update":
            updated = []
            for r in rows:
                if self._match(r):
                    r.update(self._data)
                    updated.append(r)
            result = updated
        elif self._op == "delete":
            kept = []
            deleted = []
            for r in rows:
                if self._match(r):
                    deleted.append(r)
                else:
                    kept.append(r)
            self._store[self._table] = kept
            result = deleted
        else:
            # select
            result = [r for r in rows if self._match(r)]
            if self._op is None and getattr(self, "_limit", None):
                result = result[: self._limit]

        resp = MagicMock()
        if self._is_single():
            resp.data = result[0] if result else None
        else:
            resp.data = result
        return resp

    def _match(self, row):
        for op, col, val in self._filters:
            if op == "eq":
                if row.get(col) != val:
                    return False
            elif op == "in":
                if row.get(col) not in val:
                    return False
            elif op == "lte":
                if not (row.get(col) and row.get(col) <= val):
                    return False
            elif op == "gte":
                if not (row.get(col) and row.get(col) >= val):
                    return False
        return True

    def _is_single(self):
        # Detect `.maybe_single()` calls — they end the chain right before `.execute()`.
        return getattr(self, "_chain_ended_with_maybe_single", False)


class FakeTable:
    def __init__(self, store, name):
        self._store = store
        self._name = name

    def __getattr__(self, attr):
        if attr == "select":
            return lambda cols="*": FakeQuery(self._store, self._name).select(cols)
        if attr == "insert":
            return lambda data: FakeQuery(self._store, self._name).insert(data)
        if attr == "update":
            return lambda data: FakeQuery(self._store, self._name).update(data)
        if attr == "delete":
            return lambda: FakeQuery(self._store, self._name).delete()
        raise AttributeError(attr)


class FakeSupabaseClient:
    def __init__(self, store):
        self._store = store

    def table(self, name):
        return FakeTable(self._store, name)

    def rpc(self, fn_name, params=None):
        """Mock RPC. Returns a FakeQuery that executes our store-based logic."""
        return FakeRpcQuery(self._store, fn_name, params or {})


class FakeRpcQuery:
    """Chainable RPC executor — like postgrest's SyncRPCFilterRequestBuilder."""
    def __init__(self, store, fn_name, params):
        self._store = store
        self._fn_name = fn_name
        self._params = params

    def execute(self):
        return self._run()

    def _run(self):
        # Helper accessors
        store = self._store
        fn = self._fn_name
        p = self._params

        if fn == "reserve_pool_account_slot":
            # ORDER BY in_flight ASC, last_used_at ASC NULLS FIRST, then LIMIT 1
            # (mirrors the SQL function)
            candidates = [
                r for r in store.get("pool_accounts", [])
                if r["health_status"] == "healthy" and r["in_flight"] < r["max_concurrent"]
            ]
            candidates.sort(key=lambda r: (r.get("in_flight", 0), r.get("last_used_at") or ""))
            if candidates:
                r = candidates[0]
                r["in_flight"] = r.get("in_flight", 0) + 1
                r["last_used_at"] = datetime.now(timezone.utc).isoformat()
                resp = MagicMock(); resp.data = [r]; return resp
            resp = MagicMock(); resp.data = []; return resp
        if fn == "release_pool_account_slot":
            for r in store.get("pool_accounts", []):
                if r["id"] == p["p_id"]:
                    r["in_flight"] = max(r.get("in_flight", 0) - 1, 0)
            resp = MagicMock(); resp.data = None; return resp
        if fn == "increment_pool_account_stats":
            for r in store.get("pool_accounts", []):
                if r["id"] == p["p_pool_account_id"]:
                    r["total_requests"] = r.get("total_requests", 0) + p.get("p_requests", 0)
                    r["total_errors"] = r.get("total_errors", 0) + p.get("p_errors", 0)
                    r["prompt_tokens"] = r.get("prompt_tokens", 0) + p.get("p_prompt_tokens", 0)
                    r["completion_tokens"] = r.get("completion_tokens", 0) + p.get("p_completion_tokens", 0)
                    r["total_tokens"] = r.get("total_tokens", 0) + (p.get("p_prompt_tokens", 0) + p.get("p_completion_tokens", 0))
            resp = MagicMock(); resp.data = None; return resp
        if fn == "increment_api_key_stats":
            for k in store.get("api_keys", []):
                if k["id"] == p["p_api_key_id"]:
                    k["total_requests"] = k.get("total_requests", 0) + p.get("p_requests", 0)
                    k["total_prompt_tokens"] = k.get("total_prompt_tokens", 0) + p.get("p_prompt_tokens", 0)
                    k["total_completion_tokens"] = k.get("total_completion_tokens", 0) + p.get("p_completion_tokens", 0)
            resp = MagicMock(); resp.data = None; return resp
        if fn == "try_acquire_refresh_lock":
            for r in store.get("pool_accounts", []):
                if r["id"] == p["p_pool_account_id"]:
                    current_lock = r.get("refresh_lock_acquired_at")
                    ttl = p.get("p_lock_ttl_seconds", 30)
                    if current_lock:
                        lock_time = datetime.fromisoformat(current_lock.replace("Z", "+00:00"))
                        if datetime.now(timezone.utc) < lock_time + timedelta(seconds=ttl):
                            resp = MagicMock(); resp.data = False; return resp
                    r["refresh_lock_acquired_at"] = datetime.now(timezone.utc).isoformat()
                    r["refresh_lock_acquired_by"] = p.get("p_holder_id")
                    r["health_status"] = "refreshing"
                    resp = MagicMock(); resp.data = True; return resp
            resp = MagicMock(); resp.data = False; return resp
        if fn == "mark_pool_account_dead":
            for r in store.get("pool_accounts", []):
                if r["id"] == p["p_pool_account_id"]:
                    r["health_status"] = "dead"
                    r["last_error_msg"] = p.get("p_error_message", "")
                    r["refresh_lock_acquired_at"] = None
            resp = MagicMock(); resp.data = None; return resp
        resp = MagicMock(); resp.data = None
        return resp


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def store():
    return {}


@pytest.fixture
def client(store, monkeypatch):
    """Spin up the FastAPI app with a fake Supabase client."""
    fake = FakeSupabaseClient(store)
    import nous_pool.db
    nous_pool.db.set_client_factory(lambda: fake)

    try:
        from nous_pool.config import Settings
        test_settings = Settings(
            supabase_url="https://test.supabase.co",
            supabase_anon_key="anon-test",
            supabase_service_role_key="sbp_test",
            supabase_jwt_secret="test-jwt-secret",
            host="127.0.0.1", port=7891,
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
            public_base_url="http://localhost:7891",
        )
        monkeypatch.setattr("nous_pool.config.load_settings", lambda: test_settings)

        # Reload modules to pick up the test hook
        import importlib
        import nous_pool.admin.router as admin_router_mod
        importlib.reload(admin_router_mod)
        import nous_pool.oauth.hermes_oauth as hermes_mod
        importlib.reload(hermes_mod)
        import nous_pool.proxy.dispatcher as dispatcher_mod
        importlib.reload(dispatcher_mod)
        import nous_pool.proxy.router as proxy_router_mod
        importlib.reload(proxy_router_mod)
        import nous_pool.auth.deps as deps_mod
        importlib.reload(deps_mod)
        import nous_pool.main as main_mod
        importlib.reload(main_mod)

        from fastapi.testclient import TestClient
        yield TestClient(main_mod.app)
    finally:
        nous_pool.db.reset_client_factory()


def make_jwt(auth_user_id: str = "00000000-0000-0000-0000-000000000001", email: str = "test@example.com") -> str:
    """Build a fake HS256 JWT for testing. We bypass real verification — the
    tests run with `_load_user_by_auth_id` mocked via the fake store."""
    header = base64.urlsafe_b64encode(b'{"alg":"HS256","typ":"JWT"}').decode().rstrip("=")
    payload = base64.urlsafe_b64encode(
        json.dumps({"sub": auth_user_id, "email": email, "role": "authenticated"}).encode()
    ).decode().rstrip("=")
    return f"{header}.{payload}.fakesig"


# ============================================================
# Health
# ============================================================


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["ok"] is True


# ============================================================
# Auth
# ============================================================


def test_unauthenticated_me_rejected(client):
    r = client.get("/admin/me")
    assert r.status_code == 401


def test_me_with_cookie(client, store, monkeypatch):
    # Insert an app_users row
    store.setdefault("app_users", []).append({
        "id": str(uuid.uuid4()),
        "auth_user_id": "00000000-0000-0000-0000-000000000001",
        "email": "test@example.com",
        "role": "admin",
        "display_name": "Test",
        "disabled_at": None,
        "last_login_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    jwt = make_jwt("00000000-0000-0000-0000-000000000001")
    r = client.get("/admin/me", cookies={"nous_pool_session": jwt})
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "test@example.com"
    assert data["role"] == "admin"


def test_me_disabled_user_rejected(client, store):
    store.setdefault("app_users", []).append({
        "id": str(uuid.uuid4()),
        "auth_user_id": "00000000-0000-0000-0000-000000000001",
        "email": "test@example.com",
        "role": "user",
        "display_name": None,
        "disabled_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    jwt = make_jwt("00000000-0000-0000-0000-000000000001")
    r = client.get("/admin/me", cookies={"nous_pool_session": jwt})
    assert r.status_code == 403


def test_logout_clears_cookie(client, store):
    user_id = str(uuid.uuid4())
    store.setdefault("app_users", []).append({
        "id": user_id, "auth_user_id": user_id,
        "email": "[email protected]", "role": "user",
        "display_name": None, "disabled_at": None,
        "last_login_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    jwt = make_jwt(user_id)
    r = client.post("/admin/auth/logout", cookies={"nous_pool_session": jwt})
    assert r.status_code == 200
    # Cookie should be cleared (set to empty with max_age=0 or expires in past)
    set_cookie = r.headers.get("set-cookie", "")
    assert "nous_pool_session" in set_cookie


def test_login_invalid_credentials(client, monkeypatch):
    """Bad password → 401. We mock Supabase's auth/v1/token endpoint to return 400."""
    fake_response = MagicMock()
    fake_response.status_code = 400
    fake_response.text = "Invalid login credentials"

    class FakeAsyncClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def post(self, *a, **kw):
            return fake_response

    import httpx as _httpx
    monkeypatch.setattr(_httpx, "AsyncClient", FakeAsyncClient)

    r = client.post("/admin/auth/login", json={"email": "[email protected]", "password": "wrong"})
    assert r.status_code == 401


def test_login_success(client, monkeypatch):
    """Good password → 200 + cookie set. Mock both Supabase signIn + create app_user."""
    fake_response = MagicMock()
    fake_response.status_code = 200
    fake_response.json.return_value = {
        "access_token": "fake-jwt-token",
        "expires_at": int(time.time()) + 3600,
        "user": {"id": "00000000-0000-0000-0000-000000000001", "email": "[email protected]"},
    }

    class FakeAsyncClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def post(self, *a, **kw): return fake_response

    import httpx as _httpx
    monkeypatch.setattr(_httpx, "AsyncClient", FakeAsyncClient)

    r = client.post("/admin/auth/login", json={"email": "[email protected]", "password": "correct"})
    assert r.status_code == 200
    assert "nous_pool_session" in r.headers.get("set-cookie", "")
    data = r.json()
    assert data["user"]["email"] == "[email protected]"


# ============================================================
# Pool accounts — device-code flow
# ============================================================


def test_device_code_flow_full(client, store, monkeypatch):
    """Full device-code flow: admin starts → portal gives code → admin approves
    → we poll → tokens saved → pool_account created."""
    # Pre-create admin user (so deps.resolve works)
    admin_id = str(uuid.uuid4())
    store.setdefault("app_users", []).append({
        "id": admin_id, "auth_user_id": admin_id,
        "email": "[email protected]", "role": "admin",
        "display_name": None, "disabled_at": None,
        "last_login_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    portal_calls = {"device_code": 0, "token": 0}
    poll_count = {"n": 0}

    async def fake_post(url, content=None, headers=None, **kw):
        resp = MagicMock()
        if "/api/oauth/device/code" in url:
            portal_calls["device_code"] += 1
            resp.status_code = 200
            resp.json.return_value = {
                "device_code": "dev-code-abc",
                "user_code": "ABCD-1234",
                "verification_uri": "https://portal.nousresearch.com/manage-subscription?user_code=ABCD-1234",
                "interval": 5,
                "expires_in": 600,
            }
        elif "/api/oauth/token" in url:
            portal_calls["token"] += 1
            poll_count["n"] += 1
            if poll_count["n"] == 1:
                resp.status_code = 400
                resp.text = "authorization_pending"
            else:
                resp.status_code = 200
                resp.json.return_value = {
                    "access_token": "access-xyz",
                    "refresh_token": "refresh-xyz",
                    "expires_in": 900,
                    "inference_base_url": "https://inference-api.nousresearch.com/v1",
                }
        else:
            resp.status_code = 404
            resp.text = ""
        return resp

    class FakeAsyncClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def post(self, *a, **kw):
            return await fake_post(*a, **kw)

    import httpx as _httpx
    monkeypatch.setattr(_httpx, "AsyncClient", FakeAsyncClient)

    jwt = make_jwt(admin_id)

    # 1. Start flow
    r = client.post(
        "/admin/accounts/add",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"label": "test-account"},
    )
    assert r.status_code == 200, r.text
    flow = r.json()
    assert flow["user_code"] == "ABCD-1234"
    assert "verification_uri" in flow
    assert flow["interval"] == 5

    # 2. First poll — pending
    r = client.post(
        f"/admin/accounts/flow/{flow['flow_id']}/poll",
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "pending"

    # 3. Second poll — success, pool_account should be created
    r = client.post(
        f"/admin/accounts/flow/{flow['flow_id']}/poll",
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    assert body["pool_account_id"] is not None

    # 4. Verify pool_accounts in store
    accounts = store.get("pool_accounts", [])
    assert len(accounts) == 1
    assert accounts[0]["account_label"] == "test-account"
    assert accounts[0]["access_token"] == "access-xyz"
    assert accounts[0]["refresh_token"] == "refresh-xyz"
    assert accounts[0]["health_status"] == "healthy"


def test_refresh_account_marked_dead_on_400(client, store, monkeypatch):
    """When the portal returns 400 on refresh, mark account dead."""
    account_id = str(uuid.uuid4())
    store.setdefault("pool_accounts", []).append({
        "id": account_id,
        "account_label": "doomed",
        "access_token": "old-access",
        "refresh_token": "old-refresh",
        "token_expires_at": (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat(),
        "health_status": "healthy",
        "refresh_lock_acquired_at": None,
        "refresh_lock_acquired_by": None,
        "total_requests": 0, "total_errors": 0, "prompt_tokens": 0,
        "completion_tokens": 0, "total_tokens": 0, "in_flight": 0,
        "max_concurrent": 12, "weight": 1.0,
        "last_used_at": None, "last_error_at": None, "last_error_msg": None,
        "supported_models": [], "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    admin_id = str(uuid.uuid4())
    store.setdefault("app_users", []).append({
        "id": admin_id, "auth_user_id": admin_id,
        "email": "[email protected]", "role": "admin",
        "display_name": None, "disabled_at": None,
        "last_login_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    async def fake_post(url, content=None, **kw):
        resp = MagicMock()
        resp.status_code = 400
        resp.text = "invalid_grant"
        return resp

    class FakeAsyncClient:
        def __init__(self, *a, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def post(self, *a, **kw):
            return await fake_post(*a, **kw)

    import httpx as _httpx
    monkeypatch.setattr(_httpx, "AsyncClient", FakeAsyncClient)

    jwt = make_jwt(admin_id)
    r = client.post(f"/admin/accounts/{account_id}/refresh", headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200
    assert r.json()["status"] == "dead"
    # Account should be marked dead in store
    acc = next(a for a in store["pool_accounts"] if a["id"] == account_id)
    assert acc["health_status"] == "dead"
    assert "invalid_grant" in acc["last_error_msg"]


# ============================================================
# API keys
# ============================================================


def test_api_key_mint_returns_full_key_once(client, store):
    user_id = str(uuid.uuid4())
    store.setdefault("app_users", []).append({
        "id": user_id, "auth_user_id": user_id,
        "email": "[email protected]", "role": "admin",
        "display_name": None, "disabled_at": None,
        "last_login_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    admin_id = str(uuid.uuid4())
    store.setdefault("app_users", []).append({
        "id": admin_id, "auth_user_id": admin_id,
        "email": "[email protected]", "role": "admin",
        "display_name": None, "disabled_at": None,
        "last_login_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    jwt = make_jwt(admin_id)

    r = client.post(
        "/admin/api-keys",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"user_id": user_id, "label": "laptop"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["sk_live_key"].startswith("sk_live_")
    assert body["prefix"].startswith("sk_live_")
    assert "warning" in body


def test_api_key_authenticates_request(client, store):
    """A sk_live_ key returned at mint time should be usable as Bearer token."""
    user_id = str(uuid.uuid4())
    auth_user_id = str(uuid.uuid4())
    store.setdefault("app_users", []).append({
        "id": user_id, "auth_user_id": auth_user_id,
        "email": "[email protected]", "role": "user",
        "display_name": None, "disabled_at": None,
        "last_login_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    full_key, prefix, khash = mint_key("test")
    store.setdefault("api_keys", []).append({
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "key_hash": khash,
        "key_prefix": prefix,
        "key_label": "test",
        "is_active": True,
        "expires_at": None,
        "total_requests": 0, "total_prompt_tokens": 0, "total_completion_tokens": 0,
        "last_used_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # Use the full key as Bearer → /admin/me should succeed
    r = client.get("/admin/me", headers={"Authorization": f"Bearer {full_key}"})
    assert r.status_code == 200
    assert r.json()["email"] == "[email protected]"


# ============================================================
# Stats
# ============================================================


def test_admin_stats_aggregates(client, store):
    """Verify /admin/stats returns proper aggregates."""
    admin_id = str(uuid.uuid4())
    store.setdefault("app_users", []).append({
        "id": admin_id, "auth_user_id": admin_id,
        "email": "[email protected]", "role": "admin",
        "display_name": None, "disabled_at": None,
        "last_login_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    store.setdefault("app_users", []).append({
        "id": str(uuid.uuid4()), "auth_user_id": str(uuid.uuid4()),
        "email": "[email protected]", "role": "user",
        "display_name": None, "disabled_at": None,
        "last_login_at": None, "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    store.setdefault("pool_accounts", []).append({
        "id": str(uuid.uuid4()),
        "account_label": "ok",
        "access_token": "a", "refresh_token": "b",
        "token_expires_at": datetime.now(timezone.utc).isoformat(),
        "health_status": "healthy",
        "total_requests": 100, "total_errors": 5, "prompt_tokens": 1000,
        "completion_tokens": 2000, "total_tokens": 3000, "in_flight": 0,
        "max_concurrent": 12, "weight": 1.0,
        "last_used_at": None, "last_error_at": None, "last_error_msg": None,
        "supported_models": [], "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })

    jwt = make_jwt(admin_id)
    r = client.get("/admin/stats", headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 200
    data = r.json()
    assert data["users"]["total"] == 2
    assert data["users"]["admins"] == 1
    assert data["pool"]["healthy_accounts"] == 1
    assert data["pool"]["total_requests"] == 100
    assert data["pool"]["total_errors"] == 5
    assert data["pool"]["total_tokens"] == 3000


# ============================================================
# Round-robin
# ============================================================


def test_round_robin_picks_multiple_accounts(client, store):
    """Reserve pool slots multiple times — different healthy accounts should be picked."""
    # Insert 3 healthy accounts
    ids = [str(uuid.uuid4()) for _ in range(3)]
    for i, aid in enumerate(ids):
        store.setdefault("pool_accounts", []).append({
            "id": aid,
            "account_label": f"acc-{i}",
            "access_token": f"t-{i}", "refresh_token": f"r-{i}",
            "token_expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
            "health_status": "healthy",
            "total_requests": 0, "total_errors": 0, "prompt_tokens": 0,
            "completion_tokens": 0, "total_tokens": 0, "in_flight": 0,
            "max_concurrent": 12, "weight": 1.0,
            "last_used_at": None, "last_error_at": None, "last_error_msg": None,
            "supported_models": [], "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

    import asyncio
    import nous_pool.proxy.dispatcher as d

    picked_labels = []
    for _ in range(3):
        async def go():
            return await d.reserve_pool_account()
        result = asyncio.get_event_loop().run_until_complete(go())
        if result:
            picked_labels.append(result["account_label"])
            asyncio.get_event_loop().run_until_complete(
                d.release_pool_account_slot(result["id"], success=True)
            )

    # All 3 distinct labels should have been picked (round-robin)
    assert set(picked_labels) == {"acc-0", "acc-1", "acc-2"}


def test_round_robin_skips_dead_accounts(client, store):
    """Dead accounts should be skipped in round-robin."""
    healthy_id = str(uuid.uuid4())
    dead_id = str(uuid.uuid4())
    store.setdefault("pool_accounts", []).extend([
        {"id": healthy_id, "account_label": "healthy", "access_token": "a", "refresh_token": "b",
         "token_expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
         "health_status": "healthy", "total_requests": 0, "total_errors": 0,
         "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
         "in_flight": 0, "max_concurrent": 12, "weight": 1.0,
         "last_used_at": None, "last_error_at": None, "last_error_msg": None,
         "supported_models": [], "created_at": datetime.now(timezone.utc).isoformat(),
         "updated_at": datetime.now(timezone.utc).isoformat()},
        {"id": dead_id, "account_label": "dead", "access_token": "a", "refresh_token": "b",
         "token_expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
         "health_status": "dead", "total_requests": 0, "total_errors": 0,
         "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
         "in_flight": 0, "max_concurrent": 12, "weight": 1.0,
         "last_used_at": None, "last_error_at": None, "last_error_msg": None,
         "supported_models": [], "created_at": datetime.now(timezone.utc).isoformat(),
         "updated_at": datetime.now(timezone.utc).isoformat()},
    ])

    import asyncio
    import nous_pool.proxy.dispatcher as d

    async def go():
        r = await d.reserve_pool_account()
        return r

    result = asyncio.get_event_loop().run_until_complete(go())
    assert result is not None
    assert result["account_label"] == "healthy"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])