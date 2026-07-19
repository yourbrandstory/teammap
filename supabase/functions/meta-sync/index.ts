// Meta API sync edge function
// Uses service_role to read access_token from signal_meta_connections
// (the access_token column is revoked from authenticated role).

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

interface SyncInput {
  accountId: string;
  since: string;
  until: string;
}

interface MetaRow {
  date: string;
  ad_name: string;
  campaign_name: string;
  ad_id_meta: string;
  spend: number;
  reach: number;
  impressions: number;
  clicks: number;
  frequency: number;
  landing_page_views: number;
  add_to_cart: number;
  purchases: number;
  results: number;
}

serve(async (req: Request) => {
  // CORS headers for browser requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, apikey, x-client-info',
      },
    });
  }

  try {
    const body: SyncInput = await req.json();
    const { accountId, since, until } = body;
    if (!accountId || !since || !until) {
      return new Response(JSON.stringify({ error: 'accountId, since, and until are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Create Supabase admin client (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    // Read the meta connection (service_role bypasses column-level security)
    const { data: conn, error: connError } = await supabase
      .from('signal_meta_connections')
      .select('*')
      .eq('account_id', accountId)
      .single();

    if (connError || !conn) {
      return new Response(JSON.stringify({ error: 'Meta connection not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const accessToken = conn.access_token;
    const adAccountId = conn.ad_account_id;
    const apiVersion = conn.api_version || 'v21.0';
    const resultsAction = conn.results_action_type || 'purchase';

    if (!accessToken || !adAccountId) {
      return new Response(JSON.stringify({ error: 'Meta connection incomplete (missing token or ad account ID)' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Build Graph API URL
    const fields = [
      'ad_id', 'ad_name', 'campaign_name', 'date_start',
      'spend', 'reach', 'impressions', 'clicks', 'frequency', 'actions',
    ].join(',');

    const timeRange = JSON.stringify({ since, until });
    let url = `https://graph.facebook.com/${apiVersion}/act_${adAccountId}/insights` +
      `?level=ad&time_increment=1&fields=${encodeURIComponent(fields)}` +
      `&time_range=${encodeURIComponent(timeRange)}&limit=200&access_token=${accessToken}`;

    // Fetch with pagination
    const allRows: MetaRow[] = [];
    let pageCount = 0;

    while (url) {
      const resp = await fetch(url);
      const json = await resp.json();

      if (json.error) {
        throw new Error(`Meta API error: ${json.error.message || JSON.stringify(json.error)}`);
      }

      for (const r of (json.data || [])) {
        // Build action map
        const actionMap: Record<string, number> = {};
        for (const a of (r.actions || [])) {
          actionMap[a.action_type] = parseFloat(a.value) || 0;
        }

        allRows.push({
          date: r.date_start || '',
          ad_name: r.ad_name || '',
          campaign_name: r.campaign_name || '',
          ad_id_meta: r.ad_id || '',
          spend: parseFloat(r.spend) || 0,
          reach: parseFloat(r.reach) || 0,
          impressions: parseFloat(r.impressions) || 0,
          clicks: parseFloat(r.clicks) || 0,
          frequency: parseFloat(r.frequency) || 0,
          landing_page_views: actionMap['landing_page_view'] || 0,
          add_to_cart: actionMap['add_to_cart'] || actionMap['offsite_conversion.fb_pixel_add_to_cart'] || 0,
          purchases: actionMap['purchase'] || actionMap['offsite_conversion.fb_pixel_purchase'] || 0,
          results: actionMap[resultsAction] || 0,
        });
      }

      pageCount++;
      url = json.paging?.next || '';
    }

    return new Response(JSON.stringify({ rows: allRows, pageCount }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[meta-sync]', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
});
