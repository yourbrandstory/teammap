import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

serve(async (req: Request) => {
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
    const body = await req.json();
    const { accountId, accessToken, adAccountId, apiVersion, resultsActionType } = body;
    if (!accountId) {
      return new Response(JSON.stringify({ error: 'accountId is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    const { error } = await supabase.from('signal_meta_connections').upsert({
      account_id: accountId,
      access_token: accessToken || null,
      ad_account_id: adAccountId || null,
      api_version: apiVersion || 'v21.0',
      results_action_type: resultsActionType || 'purchase',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'account_id' });

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    console.error('[meta-connect]', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
});
