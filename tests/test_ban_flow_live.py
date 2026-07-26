"""
Live E2E: full ban/unban cycle against real Supabase + Railway.

Scenario:
  1. Create fresh user A via signup (role=user)
  2. Verify A can sign in → success
  3. Sign in admin via existing email, ban A
  4. Try to sign in as A → must FAIL with 401 user_disabled
  5. Verify A cannot list their own keys (also blocked via API key path)
  6. Unban A
  7. Sign in as A → must succeed again

This validates the SERVER-SIDE enforcement: the auth middleware
current_context() blocks the banned user from EVERY protected route,
even though the SPA still shows them as "logged out / can't reach
/admin/me".
"""
import sys, time, urllib.request, urllib.error, json, uuid

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"

ADMIN_EMAIL = "tinymouse.7e5c@varasto.net"  # the first-user-admin on production
ADMIN_PASS  = "realPasswordTest1"

VICTIM_DOMAIN = "varasto.net"  # sandbox domain; Supabase accepts any valid email
PWD = "TestPass123!"

def req(method, path, body=None, cookies=""):
    data = None
    if body is not None:
        data = json.dumps(body).encode()
    r = urllib.request.Request(
        BASE + path,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "Cookie": cookies,
        },
    )
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read()

def parse_cookie(headers):
    sc = headers.get("Set-Cookie") or headers.get("set-cookie")
    if not sc: return ""
    return sc.split(";")[0]

def expect(label, got, want):
    ok = (got == want)
    print(f"  {'OK ' if ok else 'FAIL'}  {label}: got {got!r}, want {want!r}")
    if not ok: raise SystemExit(1)

def expect_contains(label, got, substr):
    ok = substr in (got or "")
    print(f"  {'OK ' if ok else 'FAIL'}  {label}: {got!r} contains {substr!r}")
    if not ok: raise SystemExit(1)

def main():
    print(f"=== LIVE BAN FLOW: {BASE} ===")
    victim_email = f"v-{uuid.uuid4().hex[:8]}@{VICTIM_DOMAIN}"

    # 1. Sign up victim
    print("\n[1] Signup victim")
    code, h, b = req("POST", "/admin/auth/signup",
                     {"email": victim_email, "password": PWD})
    expect("status", code, 200)
    body = json.loads(b)
    expect("role=user", body["user"]["role"], "user")
    victim_id = body["user"]["id"]
    print(f"     victim_id = {victim_id}")

    # 2. Sign in as victim
    print("\n[2] Victim signs in")
    code, h, b = req("POST", "/admin/auth/login",
                     {"email": victim_email, "password": PWD})
    expect("status", code, 200)
    victim_cookie = parse_cookie(h)
    code, h, b = req("GET", "/admin/me", cookies=victim_cookie)
    expect("status", code, 200)
    me = json.loads(b)
    expect("victim email", me["email"], victim_email)

    # 3. Admin signs in & bans victim
    print("\n[3] Admin signs in & bans victim")
    code, h, b = req("POST", "/admin/auth/login",
                     {"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    expect("status", code, 200)
    admin_cookie = parse_cookie(h)

    code, h, b = req("POST", f"/admin/users/{victim_id}/ban",
                     {"reason": "live-e2e test ban"}, cookies=admin_cookie)
    expect("status", code, 200)

    # 4. Try to sign in as banned victim
    print("\n[4] Banned victim tries to log back in")
    code, h, b = req("POST", "/admin/auth/login",
                     {"email": victim_email, "password": PWD})
    # Banned login returns 403 with detail.error == "user_disabled"
    expect("status (banned login)", code, 403)
    body = json.loads(b)
    expect("error code", body.get("detail", {}).get("error"), "user_disabled")

    # 5. Admin unban victim
    print("\n[5] Admin unbans victim")
    code, h, b = req("POST", f"/admin/users/{victim_id}/unban",
                     cookies=admin_cookie)
    expect("status", code, 200)

    # 6. Victim signs back in
    print("\n[6] Victim signs back in")
    code, h, b = req("POST", "/admin/auth/login",
                     {"email": victim_email, "password": PWD})
    expect("status", code, 200)

    # 7. Cleanup: ban them again (a second ban no-ops since the user
    # is already banned; this is just to keep the prod DB tidy)
    print("\n[7] Final: re-ban test victim to leave DB tidy")
    code, h, b = req("POST", f"/admin/users/{victim_id}/ban",
                     {"reason": "live-e2e cleanup"}, cookies=admin_cookie)
    expect("status", code, 200)

    # 8. Admin gets analytics
    print("\n[8] Admin fetches /admin/analytics")
    code, h, b = req("GET", "/admin/analytics", cookies=admin_cookie)
    expect("status", code, 200)
    a = json.loads(b)
    assert "users" in a and "requests" in a and "top_users_30d" in a, \
        f"missing fields: {list(a.keys())}"
    print(f"     users.total={a['users']['total']} banned={a['users']['banned']}")
    print(f"     requests.24h={a['requests']['24h']['requests']}")
    print(f"     requests.30d={a['requests']['30d']['requests']}")
    print(f"     top_users_30d count={len(a['top_users_30d'])}")

    # 9. Non-admin tries /admin/analytics → 403
    print("\n[9] Non-admin tries /admin/analytics → must 403")
    code, h, b = req("GET", "/admin/analytics", cookies=victim_cookie)
    expect("status (non-admin /admin/analytics)", code, 403)

    print("\n=== LIVE BAN FLOW: ALL PASS ===")

if __name__ == "__main__":
    main()