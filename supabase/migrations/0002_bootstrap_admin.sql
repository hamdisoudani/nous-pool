-- ============================================================
-- 0002_bootstrap_admin.sql
-- Promote the very first app_users row to admin automatically.
-- Subsequent users keep role='user' and must be promoted manually
-- via Studio.
--
-- Uses AFTER INSERT trigger on app_users, NOT auth.users, so we can
-- safely detect "first app_users row" without race conditions on
-- SIGNUP-attempts that don't create an app_users row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.bootstrap_first_admin()
RETURNS TRIGGER AS $$
DECLARE
    user_count integer;
BEGIN
    -- Only fire if this is the very first app_users row AND there are
    -- zero admins yet. Any direct promotion to admin in Studio
    -- bypasses this for subsequent inserts.
    SELECT COUNT(*) INTO user_count FROM public.app_users;
    IF user_count = 0 THEN
        NEW.role := 'admin';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
   SET search_path = public, pg_catalog;

DROP TRIGGER IF EXISTS bootstrap_first_admin ON public.app_users;
CREATE TRIGGER bootstrap_first_admin
    BEFORE INSERT ON public.app_users
    FOR EACH ROW EXECUTE FUNCTION public.bootstrap_first_admin();

-- Comment for operators:
COMMENT ON FUNCTION public.bootstrap_first_admin() IS
  'Promotes the first-ever app_users row to admin. All subsequent inserts default to user (handled by handle_new_auth_user).';
