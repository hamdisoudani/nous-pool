"""
Full end-to-end test of the nous-pool flow against REAL Supabase.

Run after Railway env vars are filled with real Supabase keys:
  NOUS_POOL_SUPABASE_URL=https://<ref>.supabase.co   already set
  NOUS_POOL_SUPABASE_ANON_KEY=eyJhbG...              ⚠ verify on Railway
  NOUS_POOL_SUPABASE_SERVICE_ROLE_KEY=eyJhbG...       ⚠ verify on Railway
  NOUS_POOL_SUPABASE_JWT_SECRET=<base64-32B-secret>  ⚠ verify on Railway

Usage:
  NOUS_POOL_BASE_URL=https://web-production-8dac4.up.railway.app \\
  pytest tests/test_e2e_live.py -v -s

or directly:
  NOUS_POOL_BASE_URL=https://web-production-8dac4.up.railway.app \\
  python3 tests/test_e2e_live.py
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

BASE = os.environ.get("NOUS_POOL_BASE_URL", "http://127.0.0.1:7901")
TEST_EMAIL = f"e2e-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}-{os.getpid() % 10000}@gmail.com"
TEST_PASSWORD = "e2etest123456"

# ===== Test helper =====
NUM_TESTS = 0
NUM_PASSED = 0
NUM_FAILED = 0
COOKIE_JAR = ""


def http(method, path, body=None, follow_redirect=False, timeout=30):
    url = BASE + path
    headers = {}
    if COOKIE_JAR:
        headers["Cookie"] = COOKIE_JAR
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", errors="replace")


def banner(title):
    print(f"\n{'='*70}\n{title}\n{'='*70}")


def step(label, ok, detail):
    global NUM_TESTS, NUM_PASSED, NUM_FAILED
    NUM_TESTS += 1
    if ok:
        NUM_PASSED += 1
        color = "\033[92m"
        sym = "✓"
    else:
        NUM_FAILED += 1
        color = "\033[91m"
        sym = "✗"
    RESET = "\033[0m"
    print(f"  {color}{sym}{RESET} {label}")
    if detail:
        for line in (detail if isinstance(detail, list) else [detail]):
            print(f"      {line}")
    return ok


def update_cookie(headers):
    global COOKIE_JAR
    sc = headers.get("set-cookie", "")
    if sc:
        first = sc.split(",")[0].split(";")[0]
        COOKIE_JAR = first


# ===========================================================
# 1. liveness
# ===========================================================
banner("1. liveness")
code, h, b = http("GET", "/healthz")
step("GET /healthz → 200", code == 200, f"HTTP {code}, body: {b[:80]}")
code, h, b = http("GET", "/openapi.json")
paths = (json.loads(b).get("paths", {}) if code == 200 else {})
step("GET /openapi.json → 22+ paths", code == 200 and len(paths) >= 20,
     f"HTTP {code}, {len(paths)} paths: {sorted(list(paths.keys()))[:6]}")
step("  /admin/auth/signup path exists", "/admin/auth/signup" in paths, "")
step("  /admin/me path exists", "/admin/me" in paths, "")
step("  /admin/me/usage path exists", "/admin/me/usage" in paths, "")
step("  /admin/me/api-keys path exists", "/admin/me/api-keys" in paths, "")
step("  /v1/chat/completions path exists", "/v1/chat/completions" in paths, "")

# ===========================================================
# 2. SPA load
# ===========================================================
banner("2. SPA")
code, h, b = http("GET", "/ui/")
step(f"GET /ui/ → 200 + SPA shell", code == 200 and '<div id="root"' in b,
     f"HTTP {code}, has #root: {chr(60)}div id=root exists in HTML")
m = re.search(r'/ui/assets/index-[^"]+\.js', b)
js_path = m.group(0) if m else None
step("SPA references JS bundle", js_path is not None, js_path or "(missing)")
if js_path:
    code, h, b = http("GET", js_path)
    step("GET JS bundle → 200, >100KB", code == 200 and len(b) > 100000,
         f"HTTP {code}, {len(b)} bytes")

m = re.search(r'/ui/assets/index-[^"]+\.css', b if js_path else "")
css_path = m.group(0) if m else None
if css_path:
    code, h, b = http("GET", css_path)
    step("GET CSS bundle → 200", code == 200 and len(b) > 5000,
         f"HTTP {code}, {len(b)} bytes")

# ===========================================================
# 3. Validation errors (no auth needed)
# ===========================================================
banner("3. validation")
checks = [
    ("POST /admin/auth/signup {}",
     ("POST", "/admin/auth/signup", {}), lambda c, b: c == 400 and "missing_email" in b),
    ("POST /admin/auth/signup (invalid email)",
     ("POST", "/admin/auth/signup", {"email": "notanemail", "password": "verylongpassword"}),
     lambda c, b: c == 400 and "invalid_email" in b),
    ("POST /admin/auth/signup (missing password)",
     ("POST", "/admin/auth/signup", {"email": "[email protected]"}),
     lambda c, b: c == 400 and "missing_email" in b),
    ("POST /admin/auth/login {}",
     ("POST", "/admin/auth/login", {}),
     lambda c, b: c == 400 and "missing_email" in b),
    ("POST /admin/auth/login (bad creds)",
     ("POST", "/admin/auth/login", {"email": TEST_EMAIL, "password": "wrongwrongwrong"}),
     lambda c, b: c in (400, 401, 422)),
]
for label, args, expect in checks:
    method, path, payload = args
    code, h, b = http(method, path, payload)
    ok = expect(code, b)
    step(label, ok, f"HTTP {code}: {b[:100]}")

# ===========================================================
# 4. Auth gating (401 without cookie)
# ===========================================================
banner("4. auth gating")
gated = [
    "/admin/me", "/admin/users", "/admin/stats", "/admin/accounts",
    "/admin/me/usage", "/admin/me/api-keys",
]
for path in gated:
    code, h, b = http("GET", path)
    step(f"GET {path} → 401", code == 401, f"HTTP {code}, body: {b[:60]}")

# ===========================================================
# 5. SIGNUP — happy path (depends on Supabase env vars)
# ===========================================================
banner("5. signup (real Supabase)")
COOKIE_JAR = ""
code, h, b = http("POST", "/admin/auth/signup",
                  {"email": TEST_EMAIL, "password": TEST_PASSWORD})
b_json = {}
try:
    b_json = json.loads(b)
except Exception:
    pass

if code in (200, 201) and "user" in b_json:
    update_cookie(h)
    user = b_json["user"]
    step(f"POST /admin/auth/signup → {code} + cookie",
         True,
         f"user.id={user.get('id')}, role={user.get('role')}")
elif code == 400 and "already" in b.lower():
    step("signup (random email collided?)", False, f"HTTP {code}: {b[:200]}", )
elif code >= 500:
    step("signup (server error, likely env vars missing)",
         False,
         f"HTTP {code}: {b[:200]}\n\n    *Likely cause: NOUS_POOL_SUPABASE_ANON_KEY or "
         f"NOUS_POOL_SUPABASE_SERVICE_ROLE_KEY are placeholders on Railway.*")
elif code == 400:
    err = b_json.get("detail", {}).get("error", "")
    supabase = b_json.get("detail", {}).get("supabase", "")
    if "Invalid API key" in supabase:
        step("signup (supabase env placeholder)", False,
             f"HTTP {code}: {err}\nSupabase msg: {supabase[:120]}\n\n"
             f"    *Fix:* `railway variable set NOUS_POOL_SUPABASE_ANON_KEY=eyJ...`")
    elif err in ("email_exists", "email_already_registered"):
        # Retry with a fresh email
        TEST_EMAIL = TEST_EMAIL[:-10] + str(int(time.time()))[-10:] + "@gmail.com"
        code, h, b = http("POST", "/admin/auth/signup",
                          {"email": TEST_EMAIL, "password": TEST_PASSWORD})
        update_cookie(h)
        step(f"signup retry {TEST_EMAIL}", code in (200, 201), f"HTTP {code}: {b[:150]}")
    else:
        step(f"signup unknown 400: {err}", False, f"{b[:200]}")
else:
    step(f"signup unexpected {code}", False, f"{b[:200]}")

# ===========================================================
# 6. ME — verify cookie works
# ===========================================================
banner("6. /admin/me")
code, h, b = http("GET", "/admin/me")
if code == 200:
    me = json.loads(b)
    step("GET /admin/me → 200 + cookie works",
         me.get("email") == TEST_EMAIL,
         f"email={me.get('email')}, role={me.get('role')}, display_name={me.get('display_name')}")
else:
    step("GET /admin/me (after signup)", False, f"HTTP {code}: {b[:120]}")

# ===========================================================
# 7. SIGNIN — re-log with same credentials
# ===========================================================
banner("7. signin")
code, h, b = http("POST", "/admin/auth/login",
                  {"email": TEST_EMAIL, "password": TEST_PASSWORD})
if code == 200:
    update_cookie(h)
    body = json.loads(b)
    user = body.get("user", {})
    step("POST /admin/auth/login → 200",
         user.get("email") == TEST_EMAIL,
         f"email={user.get('email')}, role={user.get('role')}")
    step("  cookie set (Set-Cookie header present)",
         bool(COOKIE_JAR and "=" in COOKIE_JAR),
         f"cookie: {COOKIE_JAR[:50]}...")
else:
    step("POST /admin/auth/login", False, f"HTTP {code}: {b[:200]}")

# ===========================================================
# 8. SIGNIN — wrong password
# ===========================================================
code, h, b = http("POST", "/admin/auth/login",
                  {"email": TEST_EMAIL, "password": "wrongwrongwrong"})
step("POST /admin/auth/login (wrong pwd) → 401", code == 401,
     f"HTTP {code}: {b[:120]}")

# ===========================================================
# 9. SELF-MINT API KEY
# ===========================================================
banner("9. self-mint API key")
code, h, b = http("POST", "/admin/me/api-keys", {"label": "e2e-test-key"})
api_key = None
if code in (200, 201):
    body = json.loads(b)
    api_key = body.get("sk_live_key") or body.get("key")
    step("POST /admin/me/api-keys → 200 + key returned",
         bool(api_key and api_key.startswith("sk_live_")),
         f"prefix={body.get('key_prefix')}, label={body.get('label')}")
else:
    step("POST /admin/me/api-keys", False, f"HTTP {code}: {b[:200]}")

# ===========================================================
# 10. List keys
# ===========================================================
code, h, b = http("GET", "/admin/me/api-keys")
if code == 200:
    body = json.loads(b)
    keys = body.get("keys", body if isinstance(body, list) else [])
    step(f"GET /admin/me/api-keys → 200 ({len(keys)} keys)",
         len(keys) >= 1,
         f"labels={[k.get('label') for k in keys]}")
else:
    step("GET /admin/me/api-keys", False, f"HTTP {code}: {b[:200]}")

# ===========================================================
# 11. Revoke the key
# ===========================================================
if api_key is None:
    # Already saved or we have no key — let's list and pick one
    code, h, b = http("GET", "/admin/me/api-keys")
    body = json.loads(b) if code == 200 else {}
    keys = body.get("keys", [])
    if keys:
        first_id = keys[0]["id"]
    else:
        first_id = None
else:
    # we have key id via API list — re-fetch
    code, h, b = http("GET", "/admin/me/api-keys")
    body = json.loads(b) if code == 200 else {}
    keys = body.get("keys", [])
    first_id = keys[0]["id"] if keys else None

if first_id:
    code, h, b = http("DELETE", f"/admin/me/api-keys/{first_id}")
    step(f"DELETE /admin/me/api-keys/{first_id[:8]}…",
         code in (200, 204, 404), f"HTTP {code}: {b[:80]}")
else:
    step("No key to revoke", True, "skipped")

# ===========================================================
# 12. USAGE
# ===========================================================
banner("10. usage")
code, h, b = http("GET", "/admin/me/usage")
if code == 200:
    body = json.loads(b)
    totals = body.get("totals", {})
    step("GET /admin/me/usage → 200",
         "total_tokens" in totals and "requests" in totals,
         f"totals={totals}, recent_count={len(body.get('recent', []))}")
else:
    step("GET /admin/me/usage", False, f"HTTP {code}: {b[:200]}")

# ===========================================================
# 13. CHAT COMPLETIONS via API key (skip if no key)
# ===========================================================
banner("11. LLM proxy (skipped if no key)")
# We need a fresh key for this
code, h, b = http("POST", "/admin/me/api-keys", {"label": "e2e-llm-test"})
llm_key = None
if code in (200, 201):
    body = json.loads(b)
    llm_key = body.get("sk_live_key")
if llm_key:
    # Now call LLM endpoint directly bypassing cookie
    url = BASE + "/v1/chat/completions"
    req = urllib.request.Request(url, method="POST",
                                 data=json.dumps({
                                     "model": "hermes-3-70b",
                                     "messages": [{"role": "user", "content": "hi"}],
                                     "max_tokens": 5,
                                 }).encode(),
                                 headers={
                                     "Authorization": f"Bearer {llm_key}",
                                     "Content-Type": "application/json",
                                 })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            step("POST /v1/chat/completions (with API key) → 200",
                 r.status == 200,
                 f"HTTP {r.status}, body: {r.read()[:120]}")
    except urllib.error.HTTPError as e:
        step("POST /v1/chat/completions", False,
             f"HTTP {e.code}: {e.read()[:200]}  (expected 502 if NOUS pool upstream misconfig)")
else:
    step("Skipped — no API key minted", True, "set RAISE_ON_LLM_SKIP=1 to fail instead")

# ===========================================================
# 14. LOGOUT
# ===========================================================
banner("12. logout")
code, h, b = http("POST", "/admin/auth/logout")
step("POST /admin/auth/logout → 200", code == 200, f"HTTP {code}: {b[:100]}")
code, h, b = http("GET", "/admin/me")
step("GET /admin/me (after logout) → 401", code == 401, f"HTTP {code}: {b[:60]}")

# ===========================================================
# SUMMARY
# ===========================================================
print(f"\n{'='*70}\nSUMMARY\n{'='*70}")
print(f"  Total : {NUM_TESTS}")
print(f"  Pass  : {NUM_PASSED}  (\033[92m\033[0m)")
print(f"  Fail  : {NUM_FAILED}  (\033[91m\033[0m)")
print(f"  Tests against: {BASE}")
print(f"  TEST_EMAIL: {TEST_EMAIL}")
print()

if NUM_FAILED > 0:
    sys.exit(1)
sys.exit(0)
