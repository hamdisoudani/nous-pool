# Nous Pool

Open-source OpenAI-compatible proxy that pools multiple Nous/Hermes OAuth accounts behind a single endpoint.

- **/v1/chat/completions** — drop-in OpenAI-compatible proxy
- **Single login page** for users AND admins — promote to admin in Supabase Studio
- **Round-robin** across healthy pool accounts, automatic token refresh
- **Per-user API keys** (`sk_live_…`) with rate-limit hooks
- **MIT licensed** — self-host on any Postgres + Auth provider (Supabase, self-hosted Supabase, etc.)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (SPA — React + Vite)                                   │
│  ┌────────────────┐   ┌──────────────┐   ┌──────────────────┐   │
│  │ LoginPage      │──▶│ /admin/me    │   │ /admin/*         │   │
│  │ (email+pass)   │   │ /me/usage    │   │ (admin only)     │   │
│  └────────────────┘   └──────────────┘   └──────────────────┘   │
└────────────────────┬────────────────────────────────────────────┘
                     │  HTTP cookie (nous_pool_session)
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  FastAPI backend (this repo)                                    │
│                                                                 │
│  /admin/auth/login     → Supabase signInWithPassword → cookie    │
│  /admin/me             → reads app_users.role                    │
│  /admin/users          → list users (admin)                     │
│  /admin/api-keys       → mint / list / revoke sk_live_ keys     │
│  /admin/accounts/add   → start Hermes device-code flow          │
│  /admin/accounts/*     → pool account CRUD + refresh            │
│  /admin/stats          → whole-pool aggregates                   │
│  /me/usage             → caller's own usage                      │
│  /v1/chat/completions  → forward to inference-api.nousresearch.com │
└────────┬─────────────────────────────────────┬───────────────────┘
         │                                     │
         ▼                                     ▼
┌─────────────────────────────┐   ┌────────────────────────────────┐
│  Supabase (Postgres + Auth) │   │  Nous Research portal          │
│  - auth.users (Supabase)    │   │  - oauth/device/code           │
│  - app_users (our shadow)   │   │  - oauth/token (refresh)       │
│  - api_keys                 │   │  - inference-api/v1            │
│  - pool_accounts            │   └────────────────────────────────┘
│  - request_logs             │
│  - oauth_flows              │
└─────────────────────────────┘
```

## Quickstart

### 1. Create a Supabase project

1. Sign up at https://supabase.com/dashboard/
2. Create a new project (note the project ref — e.g. `abcdefghijkl`)
3. Go to **Settings → API** and copy:
   - Project URL (`https://<ref>.supabase.co`)
   - `anon` `public` key (for browser)
   - `service_role` `secret` key (for backend — **keep this private**)
   - JWT secret (for verifying Supabase JWTs)

### 2. Apply the database migration

```bash
# One-shot: push the migration to your Supabase project
supabase db push

# OR push via the API directly (e.g. from CI)
curl -X POST \
  -H "Authorization: Bearer sbp_..." \
  -H "Content-Type: application/json" \
  "https://api.supabase.com/v1/projects/<ref>/database/query" \
  --data @supabase/migrations/0001_initial.sql.json
```

This creates:
- `public.app_users` — shadow table tied to `auth.users`
- `public.api_keys` — `sk_live_…` keys (argon2id hashed)
- `public.pool_accounts` — Hermes/NOUS OAuth tokens
- `public.request_logs` — every proxy call
- `public.oauth_flows` — in-flight device-code polls
- RLS policies on every table
- Atomic RPCs for stats, refresh locks, and slot reservations
- A trigger that auto-creates an `app_users` row when someone signs up

### 3. Configure the backend

Copy `.env.example` to `.env` and fill in:

```bash
NOUS_POOL_SUPABASE_URL=https://<ref>.supabase.co
NOUS_POOL_SUPABASE_ANON_KEY=eyJ...
NOUS_POOL_SUPABASE_SERVICE_ROLE_KEY=sbp_...
NOUS_POOL_HOST=0.0.0.0
NOUS_POOL_PORT=7890
NOUS_POOL_PUBLIC_BASE_URL=http://localhost:7890
```

### 4. Run the backend

```bash
# Install deps into vendor/
PYTHONPATH=src:vendor python3 -m pip install --target vendor --break-system-packages \
    fastapi uvicorn httpx python-dotenv argon2-cffi supabase pydantic-settings

# Boot the server
PYTHONPATH=src:vendor python3 -m uvicorn --app-dir src nous_pool.main:app \
    --host 0.0.0.0 --port 7890
```

### 5. Build and serve the SPA

```bash
cd static-spa
npm install
npm run build    # output → ../static/
```

The backend serves the SPA at `/ui`. Vite is configured to output there.

### 6. Create the first admin

The backend has no register endpoint by design — operators control who exists.

**Option A — sign up via the UI, then promote yourself:**
1. Visit `/ui/login`, sign up with your email + a password
2. In Supabase Studio → Table Editor → `public.app_users`, change your `role` from `user` to `admin`

**Option B — use the Supabase Dashboard SQL editor:**
```sql
UPDATE public.app_users
SET role = 'admin'
WHERE email = '[email protected]';
```

After that you can sign in and you'll see the admin tabs.

### 7. Add a pool account

As admin, go to **Pool accounts → + Add account**, type a label, and click **Start device-code flow**. The page shows a URL and a user code. Open the URL in your browser, log in to the NOUS portal, enter the code, and approve. The page polls automatically and the account joins the round-robin pool within seconds.

### 8. Mint an API key

Go to **Users**, click a user, click **+ Mint key**. The full `sk_live_…` key is shown **once** — copy it immediately. Users can use it like an OpenAI API key:

```bash
curl http://localhost:7890/v1/chat/completions \
  -H "Authorization: Bearer sk_live_xxxxxxxxxx_yyyyyyyyyyy" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "stepfun/step-3.7-flash:free",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

---

## API reference

### Auth

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/admin/auth/login` | POST | none | `{"email", "password"}` → sets `nous_pool_session` cookie |
| `/admin/auth/logout` | POST | session | clears cookie |
| `/admin/me` | GET | session | returns `{id, email, role}` |

### Admin

| Endpoint | Method | Description |
|---|---|---|
| `/admin/users` | GET | list all users (read-only) |
| `/admin/api-keys` | POST | mint a new `sk_live_…` key for a user |
| `/admin/api-keys?user_id=…` | GET | list keys for a user |
| `/admin/api-keys/{key_id}` | DELETE | revoke a key |
| `/admin/accounts/add` | POST | start a device-code OAuth flow → `{flow_id, user_code, verification_uri}` |
| `/admin/accounts/flow/{flow_id}` | GET | status of in-flight flow |
| `/admin/accounts/flow/{flow_id}/poll` | POST | one poll attempt |
| `/admin/accounts` | GET | list pool accounts |
| `/admin/accounts/{id}/refresh` | POST | force-refresh one account's token |
| `/admin/accounts/refresh-all` | POST | refresh all near-expiry accounts |
| `/admin/accounts/{id}` | DELETE | remove account from pool |
| `/admin/stats` | GET | whole-pool aggregates |

### User self-service

| Endpoint | Method | Description |
|---|---|---|
| `/me/usage` | GET | caller's own usage (last 30d + daily breakdown) |

### Proxy

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | OpenAI-compatible chat completion |

Auth for the proxy: either `Authorization: Bearer sk_live_…` or `Authorization: Bearer <Supabase JWT>`.

---

## Promoting users to admin

There's no API endpoint for this — by design. Open Supabase Studio → Table Editor → `app_users` and change the `role` column from `user` to `admin`. Or via SQL:

```sql
UPDATE public.app_users SET role = 'admin' WHERE email = '[email protected]';
```

Disabling users:

```sql
UPDATE public.app_users SET disabled_at = NOW() WHERE email = '[email protected]';
```

(`null` = active, timestamp = disabled since)

---

## Local development

```bash
# Backend
PYTHONPATH=src:vendor python3 -m uvicorn --app-dir src nous_pool.main:app --reload --port 7890

# Frontend (Vite dev server with HMR)
cd static-spa
npm run dev    # proxies API calls to :7890
```

## Deployment notes

- The backend stores nothing locally — all state is in Supabase. You can run multiple replicas behind a load balancer; refresh locks are DB-backed so they work across replicas.
- For a production deploy, set `NOUS_POOL_COOKIE_SECURE=true` so the session cookie only travels over HTTPS.
- Don't put the backend on the public internet without a reverse proxy that terminates TLS.

## License

MIT — see [LICENSE](./LICENSE).