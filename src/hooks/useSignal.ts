import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';

export type SignalTab = 'dashboard' | 'campaigns' | 'add-data' | 'upload' | 'analytics' | 'settings';

export interface SignalAccount {
  id: string;
  name: string;
  is_default: boolean;
  created_at: string;
}

export interface SignalCampaign {
  id: string;
  account_id: string;
  name: string;
  goal_tags: string[];
  created_at: string;
}

export interface SignalAd {
  id: string;
  account_id: string;
  campaign_id: string;
  name: string;
  type_tags: string[];
  created_at: string;
}

export interface SignalMetaMetrics {
  account_id: string;
  ad_id: string;
  date: string;
  results: number;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  landing_page_views: number;
  add_to_cart: number;
  purchases: number;
  frequency: number;
}

export interface SignalShopifyMetrics {
  id: string;
  account_id: string;
  ad_id: string | null;
  date: string;
  sessions: number;
  orders: number;
  order_value: number;
}

export interface SignalPaymentMetrics {
  id: string;
  account_id: string;
  ad_id: string | null;
  date: string;
  gross_amount: number;
  transactions: number;
  fees: number;
}

export interface SignalMetaConnection {
  account_id: string;
  ad_account_id: string;
  api_version: string;
  results_action_type: string;
  updated_at: string;
}

export interface SignalTagMaster {
  id: string;
  account_id: string;
  kind: 'goal' | 'ad_type';
  tag: string;
}

export interface SignalCampaignUpdate {
  id: string;
  campaign_id: string;
  ts: string;
  budget?: string;
  locations?: string;
  targeting_info?: string;
  other?: string;
  created_at: string;
}

export interface SignalAdUpdate {
  id: string;
  ad_id: string;
  ts: string;
  creative_settings?: string;
  other?: string;
  created_at: string;
}

export interface AnalyticsRow {
  key: string;
  name: string;
  campaignName: string;
  isUnattr: boolean;
  spend: number;
  results: number;
  reach: number;
  impressions: number;
  clicks: number;
  lp_views: number;
  atc: number;
  purchases: number;
  frequency: number;
  sessions: number;
  orders: number;
  order_value: number;
  gross_amount: number;
  transactions: number;
  fees: number;
  cpm: number;
  ctr: number;
  cpa: number;
  costPerSession: number;
  convPct: number;
  roas: number;
}

export default function useSignal() {
  const session = useStore(s => s.session);
  const [activeTab, setActiveTab] = useState<SignalTab>('dashboard');
  const [accounts, setAccounts] = useState<SignalAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string>('');
  const [campaigns, setCampaigns] = useState<SignalCampaign[]>([]);
  const [ads, setAds] = useState<SignalAd[]>([]);
  const [metaConn, setMetaConn] = useState<SignalMetaConnection | null>(null);
  const [tags, setTags] = useState<SignalTagMaster[]>([]);
  const [metaMetrics, setMetaMetrics] = useState<SignalMetaMetrics[]>([]);
  const [shopifyMetrics, setShopifyMetrics] = useState<SignalShopifyMetrics[]>([]);
  const [paymentMetrics, setPaymentMetrics] = useState<SignalPaymentMetrics[]>([]);
  const [campaignUpdates, setCampaignUpdates] = useState<SignalCampaignUpdate[]>([]);
  const [adUpdates, setAdUpdates] = useState<SignalAdUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dataSince, setDataSince] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const previouslyFetched = useRef<string>('');

  // Restore UI state
  useEffect(() => {
    const vs = useUIStore.getState().viewStates?.signal;
    if (vs?.activeTab) setActiveTab(vs.activeTab);
    if (vs?.activeAccountId) setActiveAccountId(vs.activeAccountId);
  }, []);

  const persistUI = useCallback((patch: Record<string, unknown>) => {
    const current = useUIStore.getState().viewStates?.signal || {};
    useUIStore.getState().setViewState('signal', { ...current, ...patch });
  }, []);

  const handleSetActiveTab = useCallback((tab: SignalTab) => {
    setActiveTab(tab);
    persistUI({ activeTab: tab });
  }, [persistUI]);

  const handleSetActiveAccount = useCallback((id: string) => {
    setActiveAccountId(id);
    persistUI({ activeAccountId: id });
  }, [persistUI]);

  // Load accounts on mount
  useEffect(() => {
    loadAccounts();
  }, []);

  // Load dependent data when account changes
  useEffect(() => {
    if (activeAccountId && activeAccountId !== previouslyFetched.current) {
      previouslyFetched.current = activeAccountId;
      loadAccountData(activeAccountId);
    } else if (activeAccountId) {
      setLoading(false);
    }
  }, [activeAccountId]);

  async function loadAccounts() {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('signal_accounts')
      .select('*')
      .order('name');
    if (err) { setError(err.message); setLoading(false); return; }
    let list = (data || []) as SignalAccount[];
    if (list.length === 0) {
      const { data: created } = await supabase
        .from('signal_accounts')
        .insert({ name: 'Homepick', is_default: true })
        .select('*')
        .single();
      if (created) list = [created as SignalAccount];
    }
    setAccounts(list);
    if (list.length > 0) {
      const defaultAcct = list.find(a => a.is_default) || list[0];
      setActiveAccountId(defaultAcct.id);
    } else {
      setLoading(false);
    }
  }

  async function loadAccountData(accountId: string) {
    setLoading(true);
    setError('');
    try {
      const [cRes, aRes, mRes, tRes, cuRes, auRes] = await Promise.all([
        supabase.from('signal_campaigns').select('*').eq('account_id', accountId).order('created_at', { ascending: false }),
        supabase.from('signal_ads').select('*').eq('account_id', accountId).order('name'),
        supabase.from('signal_meta_connections').select('account_id,ad_account_id,api_version,results_action_type,updated_at').eq('account_id', accountId).maybeSingle(),
        supabase.from('signal_tag_master').select('*').eq('account_id', accountId).order('tag'),
        supabase.from('signal_campaign_updates')
          .select('*,signal_campaigns!inner(account_id)')
          .eq('signal_campaigns.account_id', accountId)
          .order('ts', { ascending: false })
          .limit(50),
        supabase.from('signal_ad_updates')
          .select('*,signal_ads!inner(account_id)')
          .eq('signal_ads.account_id', accountId)
          .order('ts', { ascending: false })
          .limit(50),
      ]);

      if (cRes.error) throw cRes.error;
      if (aRes.error) throw aRes.error;
      if (tRes.error) throw tRes.error;

      const camps = (cRes.data || []) as SignalCampaign[];
      const adList = (aRes.data || []) as SignalAd[];
      setCampaigns(camps);
      setAds(adList);
      setTags((tRes.data || []) as SignalTagMaster[]);
      setMetaConn(mRes.data ? (mRes.data as SignalMetaConnection) : null);
      setCampaignUpdates((cuRes.data || []) as SignalCampaignUpdate[]);
      setAdUpdates((auRes.data || []) as SignalAdUpdate[]);

      // Load metrics
      const today = new Date().toISOString().slice(0, 10);
      const [mmRes, smRes, pmRes] = await Promise.all([
        supabase.from('signal_meta_metrics').select('*').eq('account_id', accountId).gte('date', dataSince).lte('date', today).order('date', { ascending: false }),
        supabase.from('signal_shopify_metrics').select('*').eq('account_id', accountId).gte('date', dataSince).lte('date', today).order('date', { ascending: false }),
        supabase.from('signal_payment_metrics').select('*').eq('account_id', accountId).gte('date', dataSince).lte('date', today).order('date', { ascending: false }),
      ]);
      if (mmRes.error) throw mmRes.error;
      if (smRes.error) throw smRes.error;
      if (pmRes.error) throw pmRes.error;
      setMetaMetrics((mmRes.data || []) as SignalMetaMetrics[]);
      setShopifyMetrics((smRes.data || []) as SignalShopifyMetrics[]);
      setPaymentMetrics((pmRes.data || []) as SignalPaymentMetrics[]);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load account data');
    }
    setLoading(false);
  }

  const refreshMetrics = useCallback(async () => {
    if (!activeAccountId) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      const [mmRes, smRes, pmRes] = await Promise.all([
        supabase.from('signal_meta_metrics').select('*').eq('account_id', activeAccountId).gte('date', dataSince).lte('date', today).order('date', { ascending: false }),
        supabase.from('signal_shopify_metrics').select('*').eq('account_id', activeAccountId).gte('date', dataSince).lte('date', today).order('date', { ascending: false }),
        supabase.from('signal_payment_metrics').select('*').eq('account_id', activeAccountId).gte('date', dataSince).lte('date', today).order('date', { ascending: false }),
      ]);
      if (!mmRes.error) setMetaMetrics((mmRes.data || []) as SignalMetaMetrics[]);
      if (!smRes.error) setShopifyMetrics((smRes.data || []) as SignalShopifyMetrics[]);
      if (!pmRes.error) setPaymentMetrics((pmRes.data || []) as SignalPaymentMetrics[]);
    } catch {}
  }, [activeAccountId, dataSince]);

  const refreshCampaignsAndAds = useCallback(async () => {
    if (!activeAccountId) return;
    try {
      const [cRes, aRes] = await Promise.all([
        supabase.from('signal_campaigns').select('*').eq('account_id', activeAccountId).order('created_at', { ascending: false }),
        supabase.from('signal_ads').select('*').eq('account_id', activeAccountId).order('name'),
      ]);
      if (!cRes.error) setCampaigns((cRes.data || []) as SignalCampaign[]);
      if (!aRes.error) setAds((aRes.data || []) as SignalAd[]);
    } catch {}
  }, [activeAccountId]);

  const refreshAccounts = useCallback(async () => {
    await loadAccounts();
  }, []);

  const refreshMetaConn = useCallback(async () => {
    if (!activeAccountId) return;
    const { data } = await supabase
      .from('signal_meta_connections')
      .select('account_id,ad_account_id,api_version,results_action_type,updated_at')
      .eq('account_id', activeAccountId)
      .maybeSingle();
    setMetaConn(data ? (data as SignalMetaConnection) : null);
  }, [activeAccountId]);

  // Analytics aggregation
  const analyticsRows = useMemo((): AnalyticsRow[] => {
    if (!metaMetrics.length && !shopifyMetrics.length && !paymentMetrics.length) return [];

    const adMap = new Map(ads.map(a => [a.id, a]));
    const campaignMap = new Map(campaigns.map(c => [c.id, c]));

    const groups = new Map<string, {
      name: string; campaignName: string;
      spend: number; results: number; reach: number; impressions: number;
      clicks: number; lp_views: number; atc: number; purchases: number;
      frequencySum: number; frequencyCount: number;
      sessions: number; orders: number; order_value: number;
      gross_amount: number; transactions: number; fees: number;
    }>();

    for (const m of metaMetrics) {
      if (!m.ad_id) continue;
      const key = m.ad_id;
      if (!groups.has(key)) {
        const ad = adMap.get(m.ad_id);
        const camp = ad ? campaignMap.get(ad.campaign_id) : undefined;
        groups.set(key, {
          name: ad?.name || m.ad_id, campaignName: camp?.name || '',
          spend: 0, results: 0, reach: 0, impressions: 0,
          clicks: 0, lp_views: 0, atc: 0, purchases: 0,
          frequencySum: 0, frequencyCount: 0,
          sessions: 0, orders: 0, order_value: 0,
          gross_amount: 0, transactions: 0, fees: 0,
        });
      }
      const g = groups.get(key)!;
      g.spend += m.spend;
      g.results += m.results;
      g.reach += m.reach;
      g.impressions += m.impressions;
      g.clicks += m.clicks;
      g.lp_views += m.landing_page_views;
      g.atc += m.add_to_cart;
      g.purchases += m.purchases;
      g.frequencySum += m.frequency;
      g.frequencyCount++;
    }

    for (const s of shopifyMetrics) {
      const key = s.ad_id || '__unattr__';
      if (!groups.has(key)) {
        groups.set(key, {
          name: s.ad_id ? (adMap.get(s.ad_id)?.name || s.ad_id) : 'Unattributed',
          campaignName: '',
          spend: 0, results: 0, reach: 0, impressions: 0,
          clicks: 0, lp_views: 0, atc: 0, purchases: 0,
          frequencySum: 0, frequencyCount: 0,
          sessions: 0, orders: 0, order_value: 0,
          gross_amount: 0, transactions: 0, fees: 0,
        });
      }
      const g = groups.get(key)!;
      g.sessions += s.sessions;
      g.orders += s.orders;
      g.order_value += s.order_value;
    }

    for (const p of paymentMetrics) {
      const key = p.ad_id || '__unattr__';
      if (!groups.has(key)) {
        groups.set(key, {
          name: p.ad_id ? (adMap.get(p.ad_id)?.name || p.ad_id) : 'Unattributed',
          campaignName: '',
          spend: 0, results: 0, reach: 0, impressions: 0,
          clicks: 0, lp_views: 0, atc: 0, purchases: 0,
          frequencySum: 0, frequencyCount: 0,
          sessions: 0, orders: 0, order_value: 0,
          gross_amount: 0, transactions: 0, fees: 0,
        });
      }
      const g = groups.get(key)!;
      g.gross_amount += p.gross_amount;
      g.transactions += p.transactions;
      g.fees += p.fees;
    }

    const rows: AnalyticsRow[] = [];
    for (const [key, g] of groups) {
      const isUnattr = key === '__unattr__' || key === '';
      const freq = g.frequencyCount > 0 ? g.frequencySum / g.frequencyCount : 0;
      rows.push({
        key,
        name: g.name,
        campaignName: g.campaignName,
        isUnattr,
        spend: g.spend,
        results: g.results,
        reach: g.reach,
        impressions: g.impressions,
        clicks: g.clicks,
        lp_views: g.lp_views,
        atc: g.atc,
        purchases: g.purchases,
        frequency: freq,
        sessions: g.sessions,
        orders: g.orders,
        order_value: g.order_value,
        gross_amount: g.gross_amount,
        transactions: g.transactions,
        fees: g.fees,
        cpm: g.impressions > 0 ? (g.spend / g.impressions) * 1000 : 0,
        ctr: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0,
        cpa: g.purchases > 0 ? g.spend / g.purchases : 0,
        costPerSession: g.sessions > 0 ? g.spend / g.sessions : 0,
        convPct: g.sessions > 0 ? (g.orders / g.sessions) * 100 : 0,
        roas: g.spend > 0 ? g.order_value / g.spend : 0,
      });
    }

    return rows.sort((a, b) => b.spend - a.spend);
  }, [metaMetrics, shopifyMetrics, paymentMetrics, ads, campaigns]);

  // Dashboard KPIs
  const dashboardKpis = useMemo(() => {
    const total = analyticsRows.reduce((a, r) => ({
      spend: a.spend + r.spend,
      purchases: a.purchases + r.purchases,
      orders: a.orders + r.orders,
      sessions: a.sessions + r.sessions,
      order_value: a.order_value + r.order_value,
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
      results: a.results + r.results,
    }), { spend: 0, purchases: 0, orders: 0, sessions: 0, order_value: 0, impressions: 0, clicks: 0, results: 0 });

    const topAd = analyticsRows.filter(r => r.spend > 0).length > 0
      ? analyticsRows.filter(r => r.spend > 0).reduce((a, b) => a.roas > b.roas ? a : b)
      : null;

    return {
      ...total,
      cpa: total.purchases > 0 ? total.spend / total.purchases : 0,
      roas: total.spend > 0 ? total.order_value / total.spend : 0,
      ctr: total.impressions > 0 ? (total.clicks / total.impressions) * 100 : 0,
      cpm: total.impressions > 0 ? (total.spend / total.impressions) * 1000 : 0,
      topAd,
    };
  }, [analyticsRows]);

  return {
    accounts, activeAccountId, setActiveAccountId: handleSetActiveAccount,
    refreshAccounts, refreshMetaConn,
    campaigns, ads, refreshCampaignsAndAds,
    metaConn,
    tags,
    metaMetrics, shopifyMetrics, paymentMetrics,
    campaignUpdates, adUpdates,
    refreshMetrics,
    analyticsRows,
    dashboardKpis,
    dataSince, setDataSince,
    activeTab, setActiveTab: handleSetActiveTab,
    loading, error,
  };
}
