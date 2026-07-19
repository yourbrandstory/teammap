-- ============================================================================
-- Signal tables (ad/campaign tracker) — ported from adtrack-hub
-- Table names match adtrack-hub exactly (no signal_ prefix).
-- RLS follows adtrack-hub's owns_account() pattern with Teammap's admin/manager roles.
-- ============================================================================

-- accounts
CREATE TABLE IF NOT EXISTS public.signal_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.signal_accounts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_accounts TO authenticated;
GRANT ALL ON public.signal_accounts TO service_role;
DROP POLICY IF EXISTS "sg accounts access" ON public.signal_accounts;
CREATE POLICY "sg accounts access" ON public.signal_accounts
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());

-- helper: check access (admin/manager can see everything)
-- NOTE: not used by current RLS policies (they use is_admin()/is_manager() directly),
-- but kept for potential future use and API-level checks.
CREATE OR REPLACE FUNCTION public.sg_has_access(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM public.signal_accounts WHERE id = _account_id)
    AND (is_admin() OR is_manager())
$$;

-- tag master
CREATE TABLE IF NOT EXISTS public.signal_tag_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.signal_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('goal','ad_type')),
  tag text NOT NULL,
  UNIQUE(account_id, kind, tag)
);
CREATE INDEX IF NOT EXISTS idx_sg_tag_master_account ON public.signal_tag_master(account_id);
ALTER TABLE public.signal_tag_master ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_tag_master TO authenticated;
GRANT ALL ON public.signal_tag_master TO service_role;
DROP POLICY IF EXISTS "sg tags access" ON public.signal_tag_master;
CREATE POLICY "sg tags access" ON public.signal_tag_master
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());

-- campaigns
CREATE TABLE IF NOT EXISTS public.signal_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.signal_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  goal_tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sg_campaigns_account ON public.signal_campaigns(account_id);
ALTER TABLE public.signal_campaigns ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_campaigns TO authenticated;
GRANT ALL ON public.signal_campaigns TO service_role;
DROP POLICY IF EXISTS "sg campaigns access" ON public.signal_campaigns;
CREATE POLICY "sg campaigns access" ON public.signal_campaigns
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());

-- campaign updates
CREATE TABLE IF NOT EXISTS public.signal_campaign_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.signal_campaigns(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  budget text,
  locations text,
  targeting_info text,
  other text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sg_camp_upd_campaign ON public.signal_campaign_updates(campaign_id, ts DESC);
ALTER TABLE public.signal_campaign_updates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_campaign_updates TO authenticated;
GRANT ALL ON public.signal_campaign_updates TO service_role;
DROP POLICY IF EXISTS "sg campaign updates access" ON public.signal_campaign_updates;
CREATE POLICY "sg campaign updates access" ON public.signal_campaign_updates
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());

-- ads
CREATE TABLE IF NOT EXISTS public.signal_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.signal_accounts(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.signal_campaigns(id) ON DELETE CASCADE,
  name text NOT NULL,
  type_tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sg_ads_account ON public.signal_ads(account_id);
CREATE INDEX IF NOT EXISTS idx_sg_ads_campaign ON public.signal_ads(campaign_id);
ALTER TABLE public.signal_ads ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_ads TO authenticated;
GRANT ALL ON public.signal_ads TO service_role;
DROP POLICY IF EXISTS "sg ads access" ON public.signal_ads;
CREATE POLICY "sg ads access" ON public.signal_ads
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());

-- ad updates
CREATE TABLE IF NOT EXISTS public.signal_ad_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_id uuid NOT NULL REFERENCES public.signal_ads(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL DEFAULT now(),
  creative_settings text,
  other text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sg_ad_upd_ad ON public.signal_ad_updates(ad_id, ts DESC);
ALTER TABLE public.signal_ad_updates ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_ad_updates TO authenticated;
GRANT ALL ON public.signal_ad_updates TO service_role;
DROP POLICY IF EXISTS "sg ad updates access" ON public.signal_ad_updates;
CREATE POLICY "sg ad updates access" ON public.signal_ad_updates
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());

-- meta metrics
CREATE TABLE IF NOT EXISTS public.signal_meta_metrics (
  account_id uuid NOT NULL REFERENCES public.signal_accounts(id) ON DELETE CASCADE,
  ad_id uuid NOT NULL REFERENCES public.signal_ads(id) ON DELETE CASCADE,
  date date NOT NULL,
  results numeric NOT NULL DEFAULT 0,
  spend numeric NOT NULL DEFAULT 0,
  reach numeric NOT NULL DEFAULT 0,
  impressions numeric NOT NULL DEFAULT 0,
  clicks numeric NOT NULL DEFAULT 0,
  landing_page_views numeric NOT NULL DEFAULT 0,
  add_to_cart numeric NOT NULL DEFAULT 0,
  purchases numeric NOT NULL DEFAULT 0,
  frequency numeric NOT NULL DEFAULT 0,
  PRIMARY KEY (ad_id, date)
);
CREATE INDEX IF NOT EXISTS idx_sg_meta_metrics_account ON public.signal_meta_metrics(account_id, date);
ALTER TABLE public.signal_meta_metrics ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_meta_metrics TO authenticated;
GRANT ALL ON public.signal_meta_metrics TO service_role;
DROP POLICY IF EXISTS "sg meta metrics access" ON public.signal_meta_metrics;
CREATE POLICY "sg meta metrics access" ON public.signal_meta_metrics
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());

-- shopify metrics
CREATE TABLE IF NOT EXISTS public.signal_shopify_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.signal_accounts(id) ON DELETE CASCADE,
  ad_id uuid REFERENCES public.signal_ads(id) ON DELETE CASCADE,
  date date NOT NULL,
  sessions numeric NOT NULL DEFAULT 0,
  orders numeric NOT NULL DEFAULT 0,
  order_value numeric NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sg_shopify_unique ON public.signal_shopify_metrics (account_id, date, COALESCE(ad_id::text, 'unattributed'));
CREATE INDEX IF NOT EXISTS idx_sg_shopify_account ON public.signal_shopify_metrics(account_id, date);
ALTER TABLE public.signal_shopify_metrics ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_shopify_metrics TO authenticated;
GRANT ALL ON public.signal_shopify_metrics TO service_role;
DROP POLICY IF EXISTS "sg shopify metrics access" ON public.signal_shopify_metrics;
CREATE POLICY "sg shopify metrics access" ON public.signal_shopify_metrics
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());

-- payment metrics
CREATE TABLE IF NOT EXISTS public.signal_payment_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.signal_accounts(id) ON DELETE CASCADE,
  ad_id uuid REFERENCES public.signal_ads(id) ON DELETE CASCADE,
  date date NOT NULL,
  gross_amount numeric NOT NULL DEFAULT 0,
  transactions numeric NOT NULL DEFAULT 0,
  fees numeric NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sg_payment_unique ON public.signal_payment_metrics (account_id, date, COALESCE(ad_id::text, 'unattributed'));
CREATE INDEX IF NOT EXISTS idx_sg_payment_account ON public.signal_payment_metrics(account_id, date);
ALTER TABLE public.signal_payment_metrics ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.signal_payment_metrics TO authenticated;
GRANT ALL ON public.signal_payment_metrics TO service_role;
DROP POLICY IF EXISTS "sg payment metrics access" ON public.signal_payment_metrics;
CREATE POLICY "sg payment metrics access" ON public.signal_payment_metrics
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());

-- meta connections
CREATE TABLE IF NOT EXISTS public.signal_meta_connections (
  account_id uuid PRIMARY KEY REFERENCES public.signal_accounts(id) ON DELETE CASCADE,
  access_token text,
  ad_account_id text,
  api_version text NOT NULL DEFAULT 'v21.0',
  results_action_type text NOT NULL DEFAULT 'purchase',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.signal_meta_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.signal_meta_connections FROM authenticated;
GRANT SELECT(account_id, ad_account_id, api_version, results_action_type, updated_at)
  ON public.signal_meta_connections TO authenticated;
GRANT INSERT(account_id, ad_account_id, api_version, results_action_type)
  ON public.signal_meta_connections TO authenticated;
GRANT UPDATE(account_id, ad_account_id, api_version, results_action_type, updated_at)
  ON public.signal_meta_connections TO authenticated;
GRANT ALL ON public.signal_meta_connections TO service_role;
DROP POLICY IF EXISTS "sg meta connections access" ON public.signal_meta_connections;
CREATE POLICY "sg meta connections access" ON public.signal_meta_connections
  FOR ALL TO authenticated
  USING (is_admin() OR is_manager())
  WITH CHECK (is_admin() OR is_manager());
