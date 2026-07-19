-- Grant full CRUD access on all signal tables to any authenticated user.
-- The app handles authorization at the application level (useStore.js session checks).
-- is_admin()/is_manager() rely on auth.uid() matching profiles.id, but the app
-- uses custom auth (members table), so Supabase Auth uid never matches.
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
      'CREATE POLICY "%s auth all" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      tbl, tbl
    );
  END LOOP;
END $$;
