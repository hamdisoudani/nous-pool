# Nous Pool Proxy — Build Spec

**Status:** Locked for implementation
**Stack:** FastAPI + SQLModel (Pydantic v2) + SQLite + Argon2 + httpx
**Date:** 2026-07-25

## What this is

A standalone HTTP service. Operators drop it on a VPS, register Nous/Hermes
accounts into a pool from an admin UI, and hand out `sk-...` API keys to users
who route requests round-robin through the pool.

Exposes an **OpenAI-compatible** base URL, so any tool that talks OpenAI
(`openai` SDK, curl, langchain-openai, …) just works.

## Architecture

```
                ┌──────────────────────────────────────────────────┐
                │                   Nous Pool                       │
                │                                                    │
                │  ┌─────────────────┐    ┌────────────────────────┐ │
                │  │  Admin API       │    │  Proxy API             │ │
                │  │  /admin/*        │    │  /v1/chat/completions  │ │
                │  │  (admin JWT)     │    │  /v1/models            │ │
                │  │  • add_account   │    │  /v1/embeddings        │ │
   Admin  ───────┼─▶│  • rm_account    │    │  (user sk-… JWT)       │ │
   (browser)     │  │  • list_accounts │    │                        │ │
                │  │  • list_users    │    │  Round-robin pick ──▶   │ │
                │  │  • create_user   │    │                        │ │
                │  │  • revoke_key    │    └────────────┬───────────┘ │
                │  └─────────────────┘                  │             │
                │                                       │             │
                │  ┌────────────────────────────────────▼─────────┐   │
                │  │  Account Pool (SQLite-backed)                │   │
                │  │  Account 1: Hermes OAuth (auto-refresh)      │   │
                │  │  Account 2: Hermes OAuth                      │   │
                │  │  Account N: Hermes OAuth                      │   │
                │  │  Round-robin with health-skip on 429/402/5xx  │   │
                │  └──────────────────────────────────────────────┘   │
                │                          │                          │
                └──────────────────────────┼──────────────────────────┘
                                           ▼
                               inference-api.nousresearch.com/v1
```

## Components

1. **Database** (SQLite, file-based, atomic writes)
   - `users`        — id, email, password_hash, role, created_at
   - `api_keys`     — id, user_id, prefix, hash, label, created_at, last_used_at, revoked_at
   - `accounts`     — id, name, portal_base_url, inference_base_url, client_id, oauth_state_json, status, added_by, added_at
   - `request_log`  — id, api_key_id, account_id, upstream_model, status, latency_ms, cost, ts

2. **Auth** (Argon2 + JWT)
   - User password hashing: argon2id
   - Session JWT (admin panel): 12h HS256
   - API key: `sk-...` prefix + sha256-hashed rest + plain-text prefix stored for UI display
   - Bearer scheme for both admin and proxy

3. **Proxy** (OpenAI-compatible)
   - Endpoints: `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/v1/models`
   - Auth: `Authorization: Bearer sk_live_…`
   - Selection: round-robin with health-skip (skip accounts currently in 429/402/5xx backoff window)
   - Per-request: resolve access token via `NousOAuthClient`, forward, log result

4. **Admin API** (role: admin)
   - `POST /admin/auth/login`         — get JWT cookie for admin UI
   - `GET  /admin/accounts`            — list pooled accounts
   - `POST /admin/accounts`            — add an account (paste Hermes nous_auth.json OR run device-code login flow)
   - `DELETE /admin/accounts/{id}`     — remove account
   - `POST /admin/accounts/{id}/refresh` — force refresh token now
   - `GET  /admin/accounts/{id}/status`  — JWT expiry, last refresh, success rate
   - `GET  /admin/users`               — list users (with metrics)
   - `POST /admin/users`               — create user (returns one-time sk-…)
   - `DELETE /admin/users/{id}`        — delete user
   - `POST /admin/users/{id}/keys`     — mint new sk-…
   - `DELETE /admin/keys/{id}`         — revoke sk-…
   - `GET  /admin/stats`               — aggregate (req/min, error rate, cost)

5. **Admin UI** (SPA, served from `/admin/*`)
   - Vite + React + shadcn/ui
   - Single page: tabs = Accounts | Users | Stats
   - Account addition: paste-auth-json form OR device-code flow trigger
   - User creation: returns the sk-… in a copy-to-clipboard dialog
   - Health indicators: green/yellow/red per account

6. **Bootstrap**
   - First-run setup screen at `/admin/setup` if no admin user exists
   - Creates the first admin from env vars (`NOUS_POOL_ADMIN_EMAIL`, `NOUS_POOL_ADMIN_PASSWORD`) OR via web form

## Security decisions

| Concern | Decision |
|---|---|
| Passwords | argon2id with default params |
| JWT secret | Random 256-bit at first run, persisted in `data/jwt_secret.bin` |
| API key | `sk_live_<prefix8>_<secret32>`, stored as sha256 hash; prefix shown in UI |
| Admin JWT | httpOnly+secure+sameSite=strict cookie, 12h |
| OAuth refresh tokens | Stored per-account in `accounts.oauth_state_json` (atomic write per account — different from proxy's single-file lock) |
| CORS | Allow origins from `NOUS_POOL_CORS_ORIGINS` env |
| Rate limit | Per-sk key: configurable; default no limit (admin-set) |
| `/v1/*` auth | Required, no anonymous requests |
| `/admin/*` auth | Required, role=admin |

## File layout

```
nous-pool/
├── SPEC.md                      ← this file
├── README.md
├── pyproject.toml               ← project metadata, deps
├── .env.example
├── data/                        ← runtime data (gitignored)
│   ├── pool.db                  ← SQLite
│   └── jwt_secret.bin
├── src/nous_pool/
│   ├── main.py                  ← FastAPI app, lifespan, SPA mount
│   ├── config.py                ← Pydantic Settings
│   ├── db.py                    ← SQLModel engine + init
│   ├── models.py                ← SQLModel ORM
│   ├── auth/
│   │   ├── password.py          ← argon2 hash/verify
│   │   ├── jwt_session.py       ← admin JWT cookie
│   │   ├── api_key.py           ← sk-… mint/verify
│   │   └── deps.py              ← FastAPI dependencies
│   ├── admin/
│   │   ├── router.py            ← /admin/* endpoints
│   │   └── accounts.py          ← AccountPool (round-robin, health)
│   ├── proxy/
│   │   ├── router.py            ← /v1/* endpoints
│   │   └── dispatcher.py        ← account selection + fallback
│   ├── oauth/
│   │   ├── client.py            ← wraps NousOAuthClient per account
│   │   └── device_login.py      ← background device-code poller
│   └── stats.py                 ← in-memory counters + aggregate queries
├── frontend/                    ← Vite + React + shadcn (separate worktree)
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── pages/
│       │   ├── Accounts.tsx
│       │   ├── Users.tsx
│       │   └── Stats.tsx
│       └── components/...
├── tests/
│   ├── test_auth.py
│   ├── test_proxy_round_robin.py
│   ├── test_admin_accounts.py
│   └── test_oauth_refresh.py
└── scripts/
    ├── run_dev.sh               ← uvicorn --reload
    ├── build_frontend.sh        ← npm run build → ../src/nous_pool/static
    └── seed_admin.py            ← bootstrap admin user from env
```

## What I will NOT build this round (deferred)

- ❌ Production rate-limiting (per-user token-bucket) — admin UI slider control only
- ❌ Multiple agent-instance support (instance registration) — single-instance
- ❌ Multi-tenancy beyond users (orgs) — keep flat
- ❌ Per-account cost projection — just log cost upstream returns
- ❌ Webhooks for account-failed-refresh alerts — basic UI badge only
- ❌ TLS termination — front with nginx in prod
- ❌ Observability stack — just logs + the /admin/stats endpoint
- ❌ Device-code login UI — first version = paste-an-auth-json flow only

## Open questions for the user

1. ❓ Should the admin **setup screen** be: env-var bootstrap OR web form?
   → **Defaulting to BOTH**: env wins if set; otherwise web form on first run.

2. ❓ API-key prefix scheme:
   → **Defaulting to `sk_live_<8chars>_<32chars>`** (Stripe-style).

3. ❓ Round-robin vs least-recently-used vs cost-weighted?
   → **Defaulting to round-robin** (matches your spec).

4. ❓ SPA mount path — `/admin` or `/` (root)?
   → **Defaulting to `/admin`** so the API can later get its own landing page.

5. ❓ Should this ship as a Docker image or venv+systemd?
   → **Defaulting to venv + systemd unit** for now; Dockerfile in v2.

## Verification plan

1. `python3 -m pytest` — auth, db, round-robin selection, refresh, proxy pass-through
2. Start with seed admin, call admin API end-to-end via curl
3. Start the proxy, hit `/v1/models` with `sk_...` token, confirm 200 + upstream response
4. Mount SPA at `/admin` and verify it loads
5. Login as admin in SPA, add an account via paste-auth-json, send a chat completion, verify log entry

## Migration plan from existing `nous-openai-proxy`

The existing single-account proxy at `~/.hermes/skills/infrastructure/nous-openai-proxy/` is **kept as the lightweight option**. The new `nous-pool/` is a different skill targeting multi-account pooling.

The `NousOAuthClient` module from the skill is reused verbatim under
`src/nous_pool/oauth/client.py` (one instance per account, not one globally).

---

**Owner:** Dinzab / Hermes
**Build target:** v0.1.0 — single-instance, SQLite, no Docker
**Public on:** Port 7890 (configurable)
