-- ============================================================================
-- Fix Signal RLS: remove TO authenticated restriction
--
-- PROBLEM:
--   Signal tables have policies scoped to the `authenticated` PostgreSQL role,
--   but the app uses custom auth (members table). Supabase Auth is fire-and-forget
--   (signInWithPassword / signUp both catch errors silently). If Supabase Auth
--   fails, the client has no JWT and requests go out as `anon` role.
--   The `TO authenticated` policies don't apply to `anon`, so all Signal queries 401.
--
--   Core Teammap tables (tasks, milestones, etc.) work because their RLS on
--   the live DB is permissive (no role restriction). Signal tables, created
--   purely through migrations, are the only ones locked to `authenticated`.
--
-- FIX:
--   Drop all signal table policies and recreate without role restriction.
--   USING(true) WITH CHECK(true) applies to ALL roles (anon + authenticated).
--   Authorization is handled at the app level (session checks in useStore.js).
-- ============================================================================

DO $$
DECLARE
  tbl text;
  pol_name text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'signal_accounts', 'signal_campaigns', 'signal_ads', 'signal_meta_metrics',
    'signal_shopify_metrics', 'signal_payment_metrics',
    'signal_campaign_updates', 'signal_ad_updates',
    'signal_meta_connections', 'signal_tag_master'
  ]) LOOP
    -- Drop every existing policy on this table (including the TO authenticated ones)
    FOR pol_name IN SELECT policyname FROM pg_policies WHERE tablename = tbl AND schemaname = 'public' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
    END LOOP;

    -- Create a single permissive policy for ALL roles (no TO <role> restriction)
    -- This matches how core Teammap tables work on the live database.
    EXECUTE format(
      'CREATE POLICY "%s open" ON public.%I FOR ALL USING (true) WITH CHECK (true)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Ensure anon + authenticated can use the tables at the DB grant level
-- (the original migration only granted to authenticated)
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'signal_accounts', 'signal_campaigns', 'signal_ads', 'signal_meta_metrics',
    'signal_shopify_metrics', 'signal_payment_metrics',
    'signal_campaign_updates', 'signal_ad_updates',
    'signal_meta_connections', 'signal_tag_master'
  ]) LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon;', tbl);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', tbl);
  END LOOP;
END $$;


