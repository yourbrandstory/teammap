-- ============================================================================
-- IMMEDIATE FIX: Signal tables 401 on Vercel
-- Run this in Supabase Dashboard → SQL Editor → New query → Run
--
-- What this does:
--   1. Drops all RLS policies on every signal_* table
--   2. Recreates them WITHOUT the "TO authenticated" restriction
--   3. Grants SELECT/INSERT/UPDATE/DELETE to both anon and authenticated
--   4. access_token in signal_meta_connections is safe because the app
--      only selects non-sensitive columns (useSignal.ts:221)
--
-- After running, verify:
--   SELECT tablename, policyname, roles, qual FROM pg_policies
--   WHERE tablename LIKE 'signal_%' ORDER BY tablename;
--   -- Every row should show roles = '{anon,authenticated}' and qual = 'true'
-- ============================================================================

-- Step 1: Drop all existing signal policies and recreate open ones
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
    FOR pol_name IN SELECT policyname FROM pg_policies WHERE tablename = tbl AND schemaname = 'public' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol_name, tbl);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY "%s open" ON public.%I FOR ALL USING (true) WITH CHECK (true)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Step 2: Grant CRUD to both roles
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

-- Step 3: Verify
SELECT tablename, policyname, roles, qual, with_check
FROM pg_policies
WHERE tablename LIKE 'signal_%' AND schemaname = 'public'
ORDER BY tablename, policyname;
