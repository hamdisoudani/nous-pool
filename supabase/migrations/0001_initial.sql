-- nous-pool initial schema
-- Adapts ak arouter schema for our use case:
--   * pool_accounts (was: accounts in ak arouter) — Hermes/NOUS OAuth tokens
--   * app_users (was: accounts.user-data in ak arouter) — SaaS user records
--   * api_keys — our sk_live_… keys for end users
--   * request_logs — every /v1/* call
--   * oauth_flows — in-flight device-code polls (so admin can add accounts)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- app_users: each Supabase Auth user gets ONE row here
-- role is set by the operator manually in Studio
-- ============================================================
CREATE TABLE IF NOT EXISTS app_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    disabled_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_users_auth_user ON app_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_app_users_role ON app_users(role);

-- ============================================================
-- pool_accounts: NOUS/Hermes OAuth tokens to fan out across
-- Adapted from ak arouter's `accounts` table — renamed for clarity.
-- ============================================================
CREATE TABLE IF NOT EXISTS pool_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Account label (e.g. "[email protected]")
    account_label TEXT NOT NULL,

    -- OAuth tokens (managed by backend, encrypted at rest by Supabase)
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    token_scope TEXT DEFAULT 'inference:invoke',

    -- Health / state
    health_status TEXT NOT NULL DEFAULT 'healthy'
        CHECK (health_status IN ('healthy', 'degraded', 'dead', 'refreshing')),
    weight REAL NOT NULL DEFAULT 1.0,

    -- Stats — ak arouter style counters
    total_requests BIGINT NOT NULL DEFAULT 0,
    total_errors BIGINT NOT NULL DEFAULT 0,
    prompt_tokens BIGINT NOT NULL DEFAULT 0,
    completion_tokens BIGINT NOT NULL DEFAULT 0,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    in_flight INT NOT NULL DEFAULT 0,
    max_concurrent INT NOT NULL DEFAULT 12,

    -- Concurrency / refresh lock
    refresh_lock_acquired_at TIMESTAMPTZ,
    refresh_lock_acquired_by UUID, -- which backend instance holds the lock

    -- Last activity
    last_used_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    last_error_msg TEXT,

    -- Misc
    supported_models TEXT[] DEFAULT ARRAY[]::TEXT[],  -- detected at link time
    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pool_accounts_health ON pool_accounts(health_status);
CREATE INDEX IF NOT EXISTS idx_pool_accounts_last_used ON pool_accounts(last_used_at);

-- ============================================================
-- api_keys: sk_live_<8>_<32> keys for end-user API access
-- hash stored, prefix shown in admin UI, secret returned ONCE
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,

    key_hash TEXT NOT NULL,           -- argon2id hash of "sk_live_<8>_<32>"
    key_prefix TEXT NOT NULL,         -- e.g. "sk_live_abcdefgh" (visible in UI)
    key_label TEXT,                   -- operator-set name

    scopes TEXT[] NOT NULL DEFAULT ARRAY['chat:completion', 'models:list'],
    allowed_models TEXT[],            -- null = all models

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,

    -- Stats
    total_requests BIGINT NOT NULL DEFAULT 0,
    total_prompt_tokens BIGINT NOT NULL DEFAULT 0,
    total_completion_tokens BIGINT NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,

    CONSTRAINT unique_key_hash UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- ============================================================
-- request_logs: every /v1/* proxy call
-- ============================================================
CREATE TABLE IF NOT EXISTS request_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    pool_account_id UUID REFERENCES pool_accounts(id) ON DELETE SET NULL,

    model TEXT NOT NULL,
    endpoint TEXT NOT NULL DEFAULT '/v1/chat/completions',
    method TEXT NOT NULL DEFAULT 'POST',

    status_code INT,
    latency_ms INT,
    prompt_tokens INT,
    completion_tokens INT,
    total_tokens INT,

    error_message TEXT,

    -- Client info
    ip_address INET,
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_logs_user ON request_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_pool_account ON request_logs(pool_account_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_request_logs_model ON request_logs(model);

-- ============================================================
-- oauth_flows: in-flight device-code polls for adding new
-- pool accounts. Operator clicks "Add account", we POST
-- to portal, get a device_code, store it here, return URL
-- to the operator who approves it. We poll for completion.
-- ============================================================
CREATE TABLE IF NOT EXISTS oauth_flows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Proposed account label (often = email of the human adding it)
    account_label TEXT NOT NULL,
    -- State from portal
    device_code TEXT NOT NULL,
    user_code TEXT NOT NULL,        -- shown to the human, e.g. "ABCD-1234"
    verification_uri TEXT NOT NULL, -- e.g. https://portal.nousresearch.com/manage-subscription?user_code=...
    poll_interval_seconds INT NOT NULL DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL,
    -- Status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'success', 'expired', 'error', 'cancelled')),
    error_message TEXT,
    -- Once completed, the pool_account_id that was created
    pool_account_id UUID REFERENCES pool_accounts(id) ON DELETE SET NULL,
    initiated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_flows_status ON oauth_flows(status);
CREATE INDEX IF NOT EXISTS idx_oauth_flows_device_code ON oauth_flows(device_code);

-- ============================================================
-- RLS policies
-- ============================================================
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_flows ENABLE ROW LEVEL SECURITY;

-- app_users: each user reads their own row; admins (service_role) can manage all
DROP POLICY IF EXISTS "Users read own row" ON app_users;
CREATE POLICY "Users read own row" ON app_users
    FOR SELECT USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "Service role manages app_users" ON app_users;
CREATE POLICY "Service role manages app_users" ON app_users
    FOR ALL USING (auth.role() = 'service_role');

-- api_keys: own keys only
DROP POLICY IF EXISTS "Users see own keys" ON api_keys;
CREATE POLICY "Users see own keys" ON api_keys
    FOR SELECT USING (
        user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Service role manages api_keys" ON api_keys;
CREATE POLICY "Service role manages api_keys" ON api_keys
    FOR ALL USING (auth.role() = 'service_role');

-- request_logs: own logs only
DROP POLICY IF EXISTS "Users see own logs" ON request_logs;
CREATE POLICY "Users see own logs" ON request_logs
    FOR SELECT USING (
        user_id IN (SELECT id FROM app_users WHERE auth_user_id = auth.uid())
    );

DROP POLICY IF EXISTS "Service role inserts request_logs" ON request_logs;
CREATE POLICY "Service role inserts request_logs" ON request_logs
    FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- pool_accounts: backend-only
DROP POLICY IF EXISTS "Service role manages pool_accounts" ON pool_accounts;
CREATE POLICY "Service role manages pool_accounts" ON pool_accounts
    FOR ALL USING (auth.role() = 'service_role');

-- oauth_flows: backend-only
DROP POLICY IF EXISTS "Service role manages oauth_flows" ON oauth_flows;
CREATE POLICY "Service role manages oauth_flows" ON oauth_flows
    FOR ALL USING (auth.role() = 'service_role');

-- ============================================================
-- FUNCTIONS
-- ============================================================

-- Auto-create app_users row on first login, default role='user'
-- The operator will UPDATE role='admin' manually for admins.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.app_users (auth_user_id, email, display_name, role)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
        'user'
    )
    ON CONFLICT (auth_user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Note: Supabase Auth already triggers on auth.users when an admin creates
-- a user via signUp, so this fires automatically.

-- Generic updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public, pg_catalog;

CREATE TRIGGER set_updated_at_app_users
    BEFORE UPDATE ON app_users
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_pool_accounts
    BEFORE UPDATE ON pool_accounts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_oauth_flows
    BEFORE UPDATE ON oauth_flows
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Atomic RPC: increment request + tokens on a pool account
-- Used by the dispatcher after each proxy call completes.
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_pool_account_stats(
    p_pool_account_id UUID,
    p_requests INT DEFAULT 1,
    p_errors INT DEFAULT 0,
    p_prompt_tokens INT DEFAULT 0,
    p_completion_tokens INT DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.pool_accounts
    SET total_requests = total_requests + p_requests,
        total_errors = total_errors + p_errors,
        prompt_tokens = prompt_tokens + p_prompt_tokens,
        completion_tokens = completion_tokens + p_completion_tokens,
        total_tokens = total_tokens + (p_prompt_tokens + p_completion_tokens),
        last_used_at = NOW(),
        updated_at = NOW()
    WHERE id = p_pool_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

-- ============================================================
-- Atomic RPC: increment request + tokens on an api_key
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_api_key_stats(
    p_api_key_id UUID,
    p_requests INT DEFAULT 1,
    p_prompt_tokens INT DEFAULT 0,
    p_completion_tokens INT DEFAULT 0
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.api_keys
    SET total_requests = total_requests + p_requests,
        total_prompt_tokens = total_prompt_tokens + p_prompt_tokens,
        total_completion_tokens = total_completion_tokens + p_completion_tokens,
        last_used_at = NOW()
    WHERE id = p_api_key_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

-- ============================================================
-- Atomic RPC: increment in_flight counter (called on dispatch)
-- Decrements when call completes. Used by round-robin to skip busy accounts.
-- ============================================================
CREATE OR REPLACE FUNCTION public.reserve_pool_account_slot()
RETURNS SETOF public.pool_accounts AS $$
    SELECT *
    FROM public.pool_accounts
    WHERE health_status = 'healthy'
      AND in_flight < max_concurrent
    ORDER BY last_used_at NULLS FIRST, id
    LIMIT 1
    FOR UPDATE SKIP LOCKED;
$$ LANGUAGE sql SECURITY DEFINER
   SET search_path = public, pg_catalog;

CREATE OR REPLACE FUNCTION public.release_pool_account_slot(p_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.pool_accounts
    SET in_flight = GREATEST(in_flight - 1, 0)
    WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

-- ============================================================
-- Atomic RPC: try to acquire the refresh lock for a pool account
-- Returns true if caller got the lock (and should refresh),
-- false if someone else already has it OR token isn't close to expiry.
-- ============================================================
CREATE OR REPLACE FUNCTION public.try_acquire_refresh_lock(
    p_pool_account_id UUID,
    p_holder_id UUID,
    p_lock_ttl_seconds INT DEFAULT 30
)
RETURNS BOOLEAN AS $$
DECLARE
    current_lock TIMESTAMPTZ;
BEGIN
    SELECT refresh_lock_acquired_at INTO current_lock
    FROM public.pool_accounts
    WHERE id = p_pool_account_id
    FOR UPDATE;

    IF current_lock IS NOT NULL
       AND current_lock + (p_lock_ttl_seconds || ' seconds')::INTERVAL > NOW() THEN
        RETURN FALSE;  -- lock still held (TTL not expired)
    END IF;

    UPDATE public.pool_accounts
    SET refresh_lock_acquired_at = NOW(),
        refresh_lock_acquired_by = p_holder_id,
        health_status = 'refreshing',
        updated_at = NOW()
    WHERE id = p_pool_account_id;
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

-- ============================================================
-- Mark a pool account as dead (called when portal returns 400/401)
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_pool_account_dead(
    p_pool_account_id UUID,
    p_error_message TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.pool_accounts
    SET health_status = 'dead',
        last_error_at = NOW(),
        last_error_msg = p_error_message,
        refresh_lock_acquired_at = NULL,
        refresh_lock_acquired_by = NULL,
        updated_at = NOW()
    WHERE id = p_pool_account_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;