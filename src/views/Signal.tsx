import { useState, useMemo, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import useSignal, { type SignalTab } from '../hooks/useSignal';
import { supabase } from '../lib/supabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import * as XLSX from 'xlsx';
import {
  FIELDS, type Source, type ParsedRow,
  autoDetectMapping, applyMapping,
  normalizeDate, upsertMetrics,
} from '../lib/signal-import-pipeline';

function fmtNum(v: number, dec = 0) {
  return v != null && !isNaN(v) ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '\u2014';
}
function fmtMoney(v: number) {
  return v != null && !isNaN(v) ? '$' + fmtNum(v, 2) : '\u2014';
}
function esc(s: unknown) {
  return s === undefined || s === null ? '' : String(s).replace(/[&<>"']/g, (c: string) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
}
function todayInput() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }

const SIDEBAR_ITEMS: { key: SignalTab; label: string; icon: string }[] = [
  { key: 'dashboard',  label: 'Dashboard',        icon: '\u25C9' },
  { key: 'campaigns',  label: 'Campaigns & Ads',  icon: '\u2630' },
  { key: 'add-data',   label: 'Add Data',         icon: '+' },
  { key: 'upload',     label: 'Upload File',      icon: '\u2191' },
  { key: 'analytics',  label: 'Analytics',        icon: '\u25A4' },
  { key: 'settings',   label: 'Settings',          icon: '\u2699' },
];

let tagFieldCounter = 0;
function tagFieldId() { return 'sg-tag-' + (++tagFieldCounter); }

function renderTagBox(fieldId: string, currentTags: string[], placeholder: string): string {
  const tagsHtml = (currentTags || []).map(t =>
    '<span class="chip" style="background:#d8f3dc;color:#2d6a4f;border-radius:20px;padding:3px 9px;font-size:11.5px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap">'
    + esc(t)
    + '<button data-remove-tag="' + esc(t) + '" style="all:unset;cursor:pointer;font-size:11px;opacity:.6">&times;</button></span>'
  ).join('');
  return '<div class="tagbox" id="' + fieldId + '" data-tags=\'' + JSON.stringify(currentTags || []) + '\' style="display:flex;flex-wrap:wrap;gap:5px;border:1px solid #e5e2db;border-radius:6px;padding:5px 6px;background:#fff;min-height:34px;align-items:center">'
    + tagsHtml
    + '<input type="text" placeholder="' + (placeholder || 'Type and press Enter') + '" data-tag-input style="border:none;outline:none;flex:1;min-width:80px;padding:3px 4px;font-size:12.5px;background:transparent">'
    + '</div>';
}

function wireTagBox(fieldId: string, masterList: string[]) {
  const box = document.getElementById(fieldId);
  if (!box) return;
  const input = box.querySelector<HTMLInputElement>('[data-tag-input]');
  if (!input) return;
  function getTags(): string[] { try { return JSON.parse(box.dataset.tags || '[]'); } catch { return []; } }
  function setTags(t: string[]) { box.dataset.tags = JSON.stringify(t); }
  function refreshChips() {
    box.querySelectorAll('.chip').forEach(c => c.remove());
    getTags().forEach(t => {
      const chip = document.createElement('span'); chip.className = 'chip';
      chip.style.cssText = 'background:#d8f3dc;color:#2d6a4f;border-radius:20px;padding:3px 9px;font-size:11.5px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap';
      chip.innerHTML = esc(t) + '<button data-remove-tag="' + esc(t) + '" style="all:unset;cursor:pointer;font-size:11px;opacity:.6">&times;</button>';
      box.insertBefore(chip, input);
    });
  }
  function addTag(val: string) {
    val = val.trim(); if (!val) return;
    const tags = getTags();
    if (!tags.includes(val)) tags.push(val);
    setTags(tags);
    if (!masterList.includes(val)) masterList.push(val);
    refreshChips();
  }
  box.addEventListener('click', (e) => {
    const rm = (e.target as HTMLElement).closest('[data-remove-tag]') as HTMLElement;
    if (rm) { let tags = getTags(); tags = tags.filter(t => t !== rm.dataset.removeTag); setTags(tags); refreshChips(); return; }
    input.focus();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(input.value); input.value = ''; closeSuggest(); }
    else if (e.key === 'Backspace' && !input.value) { let tags = getTags(); tags.pop(); setTags(tags); refreshChips(); }
  });
  let suggestBox: HTMLDivElement | null = null;
  function closeSuggest() { if (suggestBox) { suggestBox.remove(); suggestBox = null; } }
  input.addEventListener('input', () => {
    closeSuggest();
    const val = input.value.trim().toLowerCase();
    if (!val) return;
    const matches = masterList.filter(t => t.toLowerCase().includes(val)).slice(0, 6);
    if (!matches.length) return;
    suggestBox = document.createElement('div'); suggestBox.className = 'tagsuggest';
    suggestBox.style.cssText = 'position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #e5e2db;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.08);z-index:20;max-height:160px;overflow-y:auto';
    suggestBox.innerHTML = matches.map(m => '<div data-pick="' + esc(m) + '" style="padding:6px 10px;font-size:12px;cursor:pointer">' + esc(m) + '</div>').join('');
    box.style.position = 'relative'; box.appendChild(suggestBox);
    suggestBox.querySelectorAll('[data-pick]').forEach(d => d.addEventListener('click', () => { addTag((d as HTMLElement).dataset.pick || ''); input.value = ''; closeSuggest(); }));
  });
  input.addEventListener('blur', () => setTimeout(closeSuggest, 150));
}
function readTagBox(fieldId: string): string[] {
  const box = document.getElementById(fieldId);
  try { return JSON.parse(box?.dataset?.tags || '[]'); } catch { return []; }
}

function openModal(html: string) {
  const box = document.getElementById('sg-modal-box');
  const bg = document.getElementById('sg-modal-bg');
  if (box && bg) { box.innerHTML = html; bg.style.display = 'flex'; }
}
function closeModal() {
  const bg = document.getElementById('sg-modal-bg');
  if (bg) bg.style.display = 'none';
}

const META_DEFS: [string, string][] = [['results','Results'],['spend','Spend'],['reach','Reach'],['impressions','Impressions'],['clicks','Clicks'],['lp_views','LP Views'],['atc','ATC'],['purchases','Purchases'],['frequency','Frequency']];
const SHOPIFY_DEFS: [string, string][] = [['sessions','Sessions'],['orders','Orders'],['order_value','Order Value']];
const PAYMENT_DEFS: [string, string][] = [['gross_amount','Gross Amount'],['transactions','Transactions'],['fees','Fees']];
const UPLOAD_TO_ADDDATA_KEY: Record<string, string> = { landing_page_views: 'lp_views', add_to_cart: 'atc' };

export default function Signal() {
  const h = useSignal();
  const session = useStore(s => s.session);
  const mainRef = useRef<HTMLDivElement>(null);
  const [pendingAddData, setPendingAddData] = useState<{ sub: string; rows: { date: string; adId: string; [k: string]: any }[] } | null>(null);

  return (
    <div style={{ display: 'flex', height: '100%', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif' }}>
      <style>{`
        .sgx input[type=text],.sgx input[type=number],.sgx input[type=date],.sgx input[type=datetime-local],.sgx select,.sgx textarea{
          font-family:inherit;border:1px solid #e5e2db;border-radius:6px;padding:7px 9px;font-size:12.5px;background:#fff;color:#1a1916
        }
        .sgx input:focus,.sgx select:focus,.sgx textarea:focus{outline:none;border-color:#2d6a4f;box-shadow:0 0 0 3px #d8f3dc}
        .sgx textarea{resize:vertical;font-family:inherit}
        .sgx label.f{display:flex;flex-direction:column;gap:4px;font-size:11.5px;color:#6b6860}
        .sgx .sg-modal-overlay{position:fixed;inset:0;background:rgba(10,14,12,.45);z-index:100;display:none;align-items:center;justify-content:center}
        .sgx .sg-modal{background:#fff;border-radius:12px;padding:20px;width:460px;max-width:92vw;max-height:88vh;overflow:auto}
        .sgx .sg-modal h3{margin:0 0 12px;font-size:15px}
        .sgx .sg-modal .rowset{display:flex;flex-direction:column;gap:10px}
        .sgx .sg-modal .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
        .sgx .updrow{border:1px dashed #e5e2db;border-radius:7px;padding:8px 10px;font-size:12px;margin-bottom:6px}
        .sgx .updrow .ts{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;color:#c96a3c;font-size:11px}
        .sgx .updrow .fields{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;margin-top:5px}
        .sgx .updrow .fields div b{color:#6b6860;font-weight:600}
        .sgx .tagbox{display:flex;flex-wrap:wrap;gap:5px;border:1px solid #e5e2db;border-radius:6px;padding:5px 6px;background:#fff;min-height:34px;align-items:center}
        .sgx .tagbox input{border:none;outline:none;flex:1;min-width:80px;padding:3px 4px;font-size:12.5px;background:transparent}
        .sgx .pagehead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;flex-wrap:wrap;gap:10px}
        .sgx .pagehead h2{margin:0 0 4px;font-size:20px}
        .sgx .pagehead p{margin:0;color:#6b6860;font-size:12.5px}
        .sgx table.datatable{border-collapse:collapse;width:100%;font-size:12px;background:#fff}
        .sgx table.datatable th,.sgx table.datatable td{border:1px solid #e5e2db;padding:6px 8px;text-align:right;white-space:nowrap}
        .sgx table.datatable th:first-child,.sgx table.datatable td:first-child{text-align:left}
        .sgx table.datatable thead th{background:#eef1ef;position:sticky;top:0;cursor:pointer;user-select:none;font-weight:600}
        .sgx .num{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
        .sgx .top1{background:#bfe9d3!important} .sgx .top2{background:#d7f0e2!important} .sgx .top3{background:#eaf7f0!important}
        .sgx .bot1{background:#f6c9c1!important} .sgx .bot2{background:#f9dcd5!important} .sgx .bot3{background:#fceee9!important}
        .tablewrap{overflow:auto;border:1px solid #e5e2db;border-radius:10px;max-height:60vh}
        .colmenu{border:1px solid #e5e2db;background:#fff;border-radius:8px;padding:10px;position:absolute;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:30;max-height:280px;overflow:auto}
        .colmenu label{display:flex;gap:6px;align-items:center;font-size:12px;padding:3px 0}
        .grid-entry{width:100%;border-collapse:collapse}
        .grid-entry th,.grid-entry td{border:1px solid #e5e2db;padding:4px}
        .grid-entry input,.grid-entry select{width:100%;border:none;padding:5px 4px;font-size:12px}
        .grid-entry input:focus,.grid-entry select:focus{outline:2px solid #d8f3dc}
        .matchbadge{font-size:10.5px;border-radius:20px;padding:2px 7px}
        .matchbadge.ok{background:#e5f5ec;color:#2d6a4f}
        .matchbadge.no{background:#fbe9e7;color:#b23b3b}
      `}</style>

      <div style={{ width: 230, flexShrink: 0, background: '#141b21', color: '#cfd8d4', display: 'flex', flexDirection: 'column', padding: '16px 0' }}>
        <div style={{ padding: '0 18px 14px', borderBottom: '1px solid #2a343c', marginBottom: 10 }}>
          <div style={{ fontFamily: 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace', fontSize: 11, letterSpacing: '.14em', color: '#7fb8a8', textTransform: 'uppercase' }}>Ops / Attribution</div>
          <div style={{ fontSize: 16, marginTop: 4, color: '#fff', fontWeight: 600 }}>Signal Tracker</div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', padding: '6px 8px', gap: 2, flex: 1, overflowY: 'auto' }}>
          {SIDEBAR_ITEMS.map(item => (
            <button key={item.key} onClick={() => h.setActiveTab(item.key)}
              style={{ all: 'unset', cursor: 'pointer', padding: '9px 12px', borderRadius: 7, fontSize: 13, display: 'flex', alignItems: 'center', gap: 9,
                background: h.activeTab === item.key ? '#1f8a70' : 'transparent', color: h.activeTab === item.key ? '#fff' : '#b7c1bc' }}>
              <span style={{ width: 16, textAlign: 'center', opacity: 0.8 }}>{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        
      </div>

      <div className="sgx" style={{ flex: 1, overflowY: 'auto', padding: '26px 34px 60px', background: '#f5f6f4' }} ref={mainRef}>
        {h.loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b6860' }}>Loading Signal data\u2026</div>
        ) : h.activeTab === 'dashboard' ? <Dashboard h={h} />
          : h.activeTab === 'campaigns' ? <CampaignsTab h={h} />
          : h.activeTab === 'add-data' ? <AddDataTab h={h} pendingAddData={pendingAddData} onPendingConsumed={() => setPendingAddData(null)} />
          : h.activeTab === 'upload' ? <UploadTab h={h} onLoadToAddData={(sub, rows) => { setPendingAddData({ sub, rows }); h.setActiveTab('add-data'); }} />
          : h.activeTab === 'analytics' ? <AnalyticsTab h={h} />
          : h.activeTab === 'settings' ? <SettingsTab h={h} />
          : null}
      </div>

      <div className="sg-modal-overlay" id="sg-modal-bg" style={{ display: 'none' }}
        onClick={e => { if ((e.target as HTMLElement).className === 'sg-modal-overlay') closeModal(); }}>
        <div className="sg-modal" id="sg-modal-box"></div>
      </div>
    </div>
  );
}




function Dashboard({ h }: { h: ReturnType<typeof useSignal> }) {
  const kpis = h.dashboardKpis;
  const accountName = h.accounts.find(a => a.id === h.activeAccountId)?.name || 'selected account';
  const thirtyAgo = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);

  const chartData = useMemo(() => {
    const dateMap: Record<string, { spend: number; orderValue: number }> = {};
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (let i = 29; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); dateMap[d.toISOString().slice(0, 10)] = { spend: 0, orderValue: 0 }; }
    h.metaMetrics.filter(m => m.date >= thirtyAgo).forEach(m => { if (dateMap[m.date]) dateMap[m.date].spend += m.spend || 0; });
    h.shopifyMetrics.filter(s => s.date >= thirtyAgo).forEach(s => { if (dateMap[s.date]) dateMap[s.date].orderValue += s.order_value || 0; });
    return Object.keys(dateMap).sort().map(d => ({ date: d + ' ' + dayNames[new Date(d + 'T12:00:00').getDay()], spend: +dateMap[d].spend.toFixed(2), orderValue: +dateMap[d].orderValue.toFixed(2) }));
  }, [h.metaMetrics, h.shopifyMetrics, thirtyAgo]);

  const activity = useMemo(() => {
    const items: { ts: string; label: string; detail: string }[] = [];
    (h.campaignUpdates || []).forEach(u => {
      const camp = h.campaigns.find(c => c.id === u.campaign_id);
      const fields: string[] = [];
      if (u.budget) fields.push('Budget: ' + u.budget);
      if (u.locations) fields.push('Locations: ' + u.locations);
      if (u.targeting_info) fields.push('Targeting: ' + u.targeting_info);
      if (u.other) fields.push('Other: ' + u.other);
      items.push({ ts: u.created_at || u.ts || '', label: 'Campaign "' + (camp?.name || 'Unknown') + '" updated', detail: fields.join(' \u00B7 ') });
    });
    (h.adUpdates || []).forEach(u => {
      const ad = h.ads.find(a => a.id === u.ad_id);
      const fields: string[] = [];
      if (u.creative_settings) fields.push('Creative: ' + u.creative_settings);
      if (u.other) fields.push('Other: ' + u.other);
      items.push({ ts: u.created_at || u.ts || '', label: 'Ad "' + (ad?.name || 'Unknown') + '" updated', detail: fields.join(' \u00B7 ') });
    });
    return items.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 25);
  }, [h.campaignUpdates, h.adUpdates, h.campaigns, h.ads]);

  const topAdName = kpis.topAd?.name || null;
  const topAdRoas = kpis.topAd?.roas || 0;

  return (
    <div>
      <div className="pagehead"><div><h2>Dashboard</h2><p>{accountName} \u2014 last 30 days snapshot</p></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Spend', val: fmtMoney(kpis.spend) },
          { label: 'Purchases / CPA', val: fmtNum(kpis.purchases) + ' / ' + fmtMoney(kpis.cpa) },
          { label: 'Orders / Value', val: fmtNum(kpis.orders) + ' / ' + fmtMoney(kpis.order_value) },
          { label: 'Blended ROAS', val: kpis.roas ? kpis.roas.toFixed(2) + 'x' : '\u2014' },
          { label: 'CTR', val: kpis.ctr ? kpis.ctr.toFixed(2) + '%' : '\u2014' },
          { label: 'Top ad (ROAS)', val: topAdName ? esc(topAdName) : '\u2014', sub: topAdName ? fmtNum(topAdRoas, 2) + 'x' : 'no data yet' },
        ].map((k, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <div style={{ fontSize: 11, color: '#6b6860', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: i === 5 ? 14 : 18, fontWeight: 700, color: '#1a1916' }}>{k.val}</div>
            {'sub' in k && k.sub && <div style={{ fontSize: 11, color: '#6b6860', marginTop: 2 }}>{k.sub}</div>}
          </div>
        ))}
      </div>
      {chartData.length > 1 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: '18px 20px', marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#1a1916' }}>Spend &amp; Order Value \u2014 last 30 days</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eae8e3" />
              <XAxis dataKey="date" fontSize={11} tick={{ fill: '#6b6860' }} />
              <YAxis fontSize={11} tick={{ fill: '#6b6860' }} />
              <Tooltip />
              <Line type="monotone" dataKey="spend" stroke="#1f8a70" strokeWidth={2} dot={false} name="Spend" />
              <Line type="monotone" dataKey="orderValue" stroke="#c96a3c" strokeWidth={2} dot={false} name="Order Value" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#1a1916' }}>Recent Activity</div>
        {activity.length === 0 && <div style={{ color: '#6b6860', fontSize: 12 }}>No campaign or ad updates logged yet.</div>}
        {activity.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid #eee' }}>
            <span style={{ fontSize: 10, color: '#c96a3c', fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace', whiteSpace: 'nowrap', minWidth: 120 }}>{a.ts ? new Date(a.ts).toLocaleString() : ''}</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.label}</span>
              {a.detail && <div style={{ fontSize: 11, color: '#6b6860', marginTop: 2 }}>{a.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function CampaignsTab({ h }: { h: ReturnType<typeof useSignal> }) {
  const goalTags = useMemo(() => {
    const t = new Set<string>();
    (h.campaigns || []).forEach(c => (c.goal_tags || []).forEach((x: string) => t.add(x)));
    (h.tags || []).filter(tg => tg.kind === 'goal').forEach(tg => t.add(tg.tag));
    return [...t];
  }, [h.campaigns, h.tags]);
  const adTypeTags = useMemo(() => {
    const t = new Set<string>();
    (h.ads || []).forEach(a => (a.type_tags || []).forEach((x: string) => t.add(x)));
    (h.tags || []).filter(tg => tg.kind === 'ad_type').forEach(tg => t.add(tg.tag));
    return [...t];
  }, [h.ads, h.tags]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedAd, setExpandedAd] = useState<string | null>(null);

  const handleDeleteCampaign = async (cid: string) => {
    if (!confirm('Delete campaign and all its ads?')) return;
    await supabase.from('signal_campaigns').delete().eq('id', cid);
    h.refreshCampaignsAndAds();
  };
  const handleDeleteAd = async (aid: string) => {
    if (!confirm('Delete this ad?')) return;
    await supabase.from('signal_ads').delete().eq('id', aid);
    h.refreshCampaignsAndAds();
  };

  const openCreateCampaign = () => {
    const gid = tagFieldId();
    openModal(`<h3>Create Campaign</h3>
      <div class="rowset">
        <label class="f">Campaign Name <input id="sg-cname" type="text" placeholder="e.g. Summer Sale 2025" /></label>
        <label class="f">Goal Tags ${renderTagBox(gid, [], 'Add goal tag\u2026')}</label>
      </div>
      <div class="actions">
        <button onclick="closeModal()">Cancel</button>
        <button id="sg-create-campaign-btn" class="btn btn-sm btn-primary">Create</button>
      </div>`);
    setTimeout(() => { wireTagBox(gid, goalTags);
      document.getElementById('sg-create-campaign-btn')?.addEventListener('click', async () => {
        const inp = document.getElementById('sg-cname') as HTMLInputElement;
        if (!inp?.value?.trim()) return alert('Name required');
        const tags = readTagBox(gid);
        await supabase.from('signal_campaigns').insert({ account_id: h.activeAccountId, name: inp.value.trim(), goal_tags: tags });
        for (const t of tags) {
          if (!goalTags.includes(t)) await supabase.from('signal_tag_master').insert({ account_id: h.activeAccountId, kind: 'goal', tag: t }).catch(() => {});
        }
        closeModal(); h.refreshCampaignsAndAds();
      });
    }, 50);
  };

  const openCreateAd = (campaignId?: string) => {
    const tid = tagFieldId();
    const campOpts = (h.campaigns||[]).map(c => '<option value="'+esc(c.id)+'"'+(campaignId===c.id?' selected':'')+'>'+esc(c.name)+'</option>').join('');
    openModal(`<h3>Create Ad</h3>
      <div class="rowset">
        <label class="f">Ad Name <input id="sg-aname" type="text" placeholder="e.g. FB Video Ad 1" /></label>
        <label class="f">Campaign <select id="sg-acamp">${campOpts}</select></label>
        <label class="f">Type Tags ${renderTagBox(tid, [], 'Add type tag\u2026')}</label>
      </div>
      <div class="actions">
        <button onclick="closeModal()">Cancel</button>
        <button id="sg-create-ad-btn" class="btn btn-sm btn-primary">Create</button>
      </div>`);
    setTimeout(() => { wireTagBox(tid, adTypeTags);
      document.getElementById('sg-create-ad-btn')?.addEventListener('click', async () => {
        const name = (document.getElementById('sg-aname') as HTMLInputElement)?.value?.trim(); if (!name) return alert('Name required');
        const cid = (document.getElementById('sg-acamp') as HTMLSelectElement)?.value;
        const tags = readTagBox(tid);
        await supabase.from('signal_ads').insert({ account_id: h.activeAccountId, campaign_id: cid, name, type_tags: tags });
        for (const t of tags) {
          if (!adTypeTags.includes(t)) await supabase.from('signal_tag_master').insert({ account_id: h.activeAccountId, kind: 'ad_type', tag: t }).catch(() => {});
        }
        closeModal(); h.refreshCampaignsAndAds();
      });
    }, 50);
  };

  const updStyle: React.CSSProperties = { border: '1px dashed #e5e2db', borderRadius: 7, padding: '8px 10px', fontSize: 12, marginBottom: 6 };
  const updTsStyle: React.CSSProperties = { fontFamily: 'ui-monospace,SFMono-Regular,Consolas,monospace', color: '#c96a3c', fontSize: 11 };

  return (
    <div>
      <div className="pagehead">
        <div><h2>Campaigns & Ads</h2><p>Create campaigns, add ads under them, and log timestamped changes over time.</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={openCreateCampaign}>+ New Campaign</button>
        </div>
      </div>
      {(h.campaigns || []).length === 0 && <div style={{ color: '#6b6860', fontSize: 12, padding: 16 }}>No campaigns yet. Click &quot;+ New Campaign&quot; to start.</div>}
      {(h.campaigns || []).map(c => {
        const isOpen = expanded === c.id;
        const campAds = (h.ads || []).filter(a => a.campaign_id === c.id);
        const campUpdates = (h.campaignUpdates || []).filter(u => u.campaign_id === c.id).sort((a, b) => new Date(b.created_at || b.ts).getTime() - new Date(a.created_at || a.ts).getTime());
        return (
          <div key={c.id} style={{ background: '#fff', borderRadius: 10, marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <div onClick={() => setExpanded(isOpen ? null : c.id)}
              style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 14, color: '#6b6860', transition: 'transform .15s', transform: isOpen ? 'rotate(90deg)' : '' }}>{'\u25B6'}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>{c.name}</span>
              {(c.goal_tags || []).length > 0 && <span style={{ fontSize: 10.5, color: '#2d6a4f', background: '#d8f3dc', padding: '2px 8px', borderRadius: 12 }}>{c.goal_tags.join(', ')}</span>}
              <button className="btn btn-sm" style={{ background: 'transparent' }} onClick={(e) => {
                e.stopPropagation();
                const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                const tsLocal = now.toISOString().slice(0, 16);
                openModal(`<h3>+ Update: ${esc(c.name)}</h3>
                  <div class="rowset">
                    <label class="f">Timestamp<input type="datetime-local" id="sg-cupdts" value="${tsLocal}"></label>
                    <label class="f">Budget<input type="text" id="sg-cupdbudget" placeholder="e.g. $500/day"></label>
                    <label class="f">Locations<input type="text" id="sg-cupdloc" placeholder="e.g. US, CA, UK"></label>
                    <label class="f">Targeting Info<textarea id="sg-cupdtarget" rows="2" placeholder="Audience / interest changes"></textarea></label>
                    <label class="f">Other<textarea id="sg-cupdother" rows="2"></textarea></label>
                  </div>
                  <div class="actions">
                    <button onclick="closeModal()">Cancel</button>
                    <button id="sg-save-cupd" class="btn btn-sm btn-primary">Save Update</button>
                  </div>`);
                setTimeout(() => {
                  document.getElementById('sg-save-cupd')?.addEventListener('click', async () => {
                    const budget = (document.getElementById('sg-cupdbudget') as HTMLInputElement)?.value?.trim() || null;
                    const locations = (document.getElementById('sg-cupdloc') as HTMLInputElement)?.value?.trim() || null;
                    const targeting = (document.getElementById('sg-cupdtarget') as HTMLTextAreaElement)?.value?.trim() || null;
                    const other = (document.getElementById('sg-cupdother') as HTMLTextAreaElement)?.value?.trim() || null;
                    const tsInput = (document.getElementById('sg-cupdts') as HTMLInputElement)?.value;
                    const ts = tsInput ? new Date(tsInput).toISOString() : new Date().toISOString();
                    const upd: Record<string, any> = { campaign_id: c.id, ts };
                    if (budget) upd.budget = budget;
                    if (locations) upd.locations = locations;
                    if (targeting) upd.targeting_info = targeting;
                    if (other) upd.other = other;
                    await supabase.from('signal_campaign_updates').insert(upd);
                    closeModal(); h.refreshCampaignsAndAds();
                  });
                }, 50);
              }}>+ Update</button>
              <button className="btn btn-sm btn-primary" style={{ background: 'transparent', color: '#1f8a70' }} onClick={(e) => { e.stopPropagation(); openCreateAd(c.id); }}>+ Ad</button>
              <button style={{ all: 'unset', cursor: 'pointer', fontSize: 14, color: '#c55a4a', opacity: .7 }}
                onClick={(e) => { e.stopPropagation(); handleDeleteCampaign(c.id); }}>{'\u2715'}</button>
            </div>
            {isOpen && (
              <div style={{ borderTop: '1px solid #eef1ef', padding: '8px 16px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b6860', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Campaign update history</div>
                {campUpdates.length === 0 ? (
                  <div style={{ color: '#9a9690', fontSize: 12, marginBottom: 12 }}>No updates logged.</div>
                ) : (
                  <div style={{ marginBottom: 12, maxHeight: 160, overflow: 'auto' }}>
                    {campUpdates.map(u => {
                      const fields: string[] = [];
                      if (u.budget) fields.push('<b>Budget:</b> ' + esc(u.budget));
                      if (u.locations) fields.push('<b>Locations:</b> ' + esc(u.locations));
                      if (u.targeting_info) fields.push('<b>Targeting:</b> ' + esc(u.targeting_info));
                      if (u.other) fields.push('<b>Other:</b> ' + esc(u.other));
                      return <div key={u.id} style={updStyle}>
                        <span style={updTsStyle}>{new Date(u.created_at || u.ts).toLocaleString()}</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', marginTop: 5, fontSize: 12 }}>
                          {fields.map((f, i) => <div key={i} dangerouslySetInnerHTML={{ __html: f }} />)}
                        </div>
                      </div>;
                    })}
                  </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6b6860', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Ads ({campAds.length})</div>
                {campAds.length === 0 && <div style={{ color: '#6b6860', fontSize: 12, padding: '8px 0' }}>No ads yet under this campaign.</div>}
                {campAds.map(a => {
                  const isAdOpen = expandedAd === a.id;
                  const adUpdates = (h.adUpdates || []).filter(u => u.ad_id === a.id).sort((a, b) => new Date(b.created_at || b.ts).getTime() - new Date(a.created_at || a.ts).getTime());
                  return (
                    <div key={a.id} style={{ marginBottom: 4, background: '#fafaf8', borderRadius: 7 }}>
                      <div onClick={() => setExpandedAd(isAdOpen ? null : a.id)}
                        style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', cursor: 'pointer', gap: 8 }}>
                        <span style={{ fontSize: 10, color: '#6b6860', transition: 'transform .15s', transform: isAdOpen ? 'rotate(90deg)' : '' }}>{'\u25B6'}</span>
                        <span style={{ fontSize: 12.5, flex: 1 }}>{a.name || '(unnamed ad)'}</span>
                        {(a.type_tags || []).length > 0 && <span style={{ fontSize: 10.5, color: '#3843a6', background: '#e3e8ff', padding: '1px 8px', borderRadius: 10 }}>{a.type_tags.join(', ')}</span>}
                        <button className="btn btn-sm" style={{ background: 'transparent' }} onClick={(e) => {
                          e.stopPropagation();
                          const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                          const tsLocal = now.toISOString().slice(0, 16);
                          openModal(`<h3>+ Update: ${esc(a.name)}</h3>
                            <div class="rowset">
                              <label class="f">Timestamp<input type="datetime-local" id="sg-aupds" value="${tsLocal}"></label>
                              <label class="f">Creative Settings<textarea id="sg-aupdcreative" rows="2" placeholder="Copy / thumbnail / CTA changes"></textarea></label>
                              <label class="f">Other<textarea id="sg-aupdother" rows="2"></textarea></label>
                            </div>
                            <div class="actions">
                              <button onclick="closeModal()">Cancel</button>
                              <button id="sg-save-aupd" class="btn btn-sm btn-primary">Save Update</button>
                            </div>`);
                          setTimeout(() => {
                            document.getElementById('sg-save-aupd')?.addEventListener('click', async () => {
                              const creative = (document.getElementById('sg-aupdcreative') as HTMLTextAreaElement)?.value?.trim() || null;
                              const other = (document.getElementById('sg-aupdother') as HTMLTextAreaElement)?.value?.trim() || null;
                              const tsInput = (document.getElementById('sg-aupds') as HTMLInputElement)?.value;
                              const ts = tsInput ? new Date(tsInput).toISOString() : new Date().toISOString();
                              const upd: Record<string, any> = { ad_id: a.id, ts };
                              if (creative) upd.creative_settings = creative;
                              if (other) upd.other = other;
                              await supabase.from('signal_ad_updates').insert(upd);
                              closeModal(); h.refreshCampaignsAndAds();
                            });
                          }, 50);
                        }}>+ Update</button>
                        <button className="btn btn-sm" style={{ background: 'transparent' }} onClick={(e) => {
                          e.stopPropagation();
                          const tid = tagFieldId();
                          openModal(`<h3>Edit Ad: ${esc(a.name)}</h3>
                            <div class="rowset">
                              <label class="f">Name <input id="sg-eaname" type="text" value="${esc(a.name)}" /></label>
                              <label class="f">Type Tags ${renderTagBox(tid, a.type_tags||[], 'Add type tag\u2026')}</label>
                            </div>
                            <div class="actions">
                              <button onclick="closeModal()">Cancel</button>
                              <button id="sg-edit-ad-btn" class="btn btn-sm btn-primary">Save</button>
                            </div>`);
                          setTimeout(() => { wireTagBox(tid, adTypeTags);
                            document.getElementById('sg-edit-ad-btn')?.addEventListener('click', async () => {
                              const name = (document.getElementById('sg-eaname') as HTMLInputElement)?.value?.trim(); if (!name) return alert('Name required');
                              const type_tags = readTagBox(tid);
                              const patch: Record<string, any> = {};
                              if (a.name !== name) patch.name = name;
                              if (JSON.stringify((a.type_tags || []).sort()) !== JSON.stringify((type_tags || []).sort())) patch.type_tags = type_tags;
                              if (Object.keys(patch).length > 0) {
                                await supabase.from('signal_ads').update(patch).eq('id', a.id);
                              }
                              closeModal(); h.refreshCampaignsAndAds();
                            });
                          }, 50);
                        }}>Edit</button>
                        <button style={{ all: 'unset', cursor: 'pointer', fontSize: 14, color: '#c55a4a', opacity: .7 }}
                          onClick={(e) => { e.stopPropagation(); handleDeleteAd(a.id); }}>{'\u2715'}</button>
                      </div>
                      {isAdOpen && (
                        <div style={{ padding: '4px 10px 10px 28px' }}>
                          {adUpdates.length === 0 ? (
                            <div style={{ color: '#9a9690', fontSize: 12 }}>No updates logged.</div>
                          ) : adUpdates.map(u => {
                            const fields: string[] = [];
                            if (u.creative_settings) fields.push('<b>Creative:</b> ' + esc(u.creative_settings));
                            if (u.other) fields.push('<b>Other:</b> ' + esc(u.other));
                            return <div key={u.id} style={updStyle}>
                              <span style={updTsStyle}>{new Date(u.created_at || u.ts).toLocaleString()}</span>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', marginTop: 5, fontSize: 12 }}>
                                {fields.map((f, i) => <div key={i} dangerouslySetInnerHTML={{ __html: f }} />)}
                              </div>
                            </div>;
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


function AddDataTab({ h, pendingAddData, onPendingConsumed }: { h: ReturnType<typeof useSignal>; pendingAddData?: { sub: string; rows: { date: string; adId: string; [k: string]: any }[] } | null; onPendingConsumed?: () => void }) {
  type Sub = 'meta' | 'shopify' | 'payment';
  const [sub, setSub] = useState<Sub>('meta');

  interface Row { date: string; adId: string; [k: string]: string | number }
  const blankRow = (): Row => ({ date: todayInput(), adId: '', results: '', spend: '', reach: '', impressions: '', clicks: '', lp_views: '', atc: '', purchases: '', frequency: '', sessions: '', orders: '', order_value: '', gross_amount: '', transactions: '', fees: '' });
  const [rows, setRows] = useState<Row[]>([blankRow()]);

  useEffect(() => {
    if (pendingAddData) {
      setSub(pendingAddData.sub as Sub);
      setRows(pendingAddData.rows);
      onPendingConsumed?.();
    }
  }, [pendingAddData]);

  const defs = sub === 'meta' ? META_DEFS : sub === 'shopify' ? SHOPIFY_DEFS : PAYMENT_DEFS;

  const adMap = useMemo(() => new Map(h.ads.map(a => [a.id, a])), [h.ads]);
  const campMap = useMemo(() => new Map(h.campaigns.map(c => [c.id, c])), [h.campaigns]);

  const campNameFor = (adId: string) => {
    if (!adId) return sub === 'shopify' ? 'Unattributed' : '\u2014';
    const ad = adMap.get(adId);
    return ad ? (campMap.get(ad.campaign_id)?.name || '\u2014') : '\u2014';
  };

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ca = campNameFor(a.adId), cb = campNameFor(b.adId);
      if (ca !== cb) return ca.localeCompare(cb);
      const aa = adMap.get(a.adId)?.name || '', ab = adMap.get(b.adId)?.name || '';
      if (aa !== ab) return aa.localeCompare(ab);
      return (a.date || '').localeCompare(b.date || '');
    });
  }, [rows, adMap, campMap, sub]);

  const updateRow = (i: number, field: string, value: any) => {
    setRows(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: value }; return n; });
  };

  const handleSaveAll = async () => {
    const valid = rows.filter(r => r.date && (sub === 'shopify' || sub === 'payment' || r.adId));
    if (!valid.length) return alert('No valid rows to save.');
    let saved = 0;
    for (const row of valid) {
      const adId = row.adId || null;
      if (sub === 'meta') {
        if (!adId) continue;
        const { error } = await supabase.from('signal_meta_metrics').upsert({
          account_id: h.activeAccountId, ad_id: adId, date: row.date,
          spend: row.spend || 0, reach: row.reach || 0, impressions: row.impressions || 0,
          clicks: row.clicks || 0, landing_page_views: row.lp_views || 0,
          add_to_cart: row.atc || 0, purchases: row.purchases || 0,
          frequency: row.frequency || 0, results: row.results || 0,
        }, { onConflict: 'ad_id,date' });
        if (!error) saved++;
      } else if (sub === 'shopify') {
        const { error } = await supabase.from('signal_shopify_metrics').upsert({
          account_id: h.activeAccountId, ad_id: adId, date: row.date,
          sessions: row.sessions || 0, orders: row.orders || 0, order_value: row.order_value || 0,
        }, { onConflict: 'account_id,date,ad_id' });
        if (!error) saved++;
      } else {
        const { error } = await supabase.from('signal_payment_metrics').upsert({
          account_id: h.activeAccountId, ad_id: adId, date: row.date,
          gross_amount: row.gross_amount || 0, transactions: row.transactions || 0, fees: row.fees || 0,
        }, { onConflict: 'account_id,date,ad_id' });
        if (!error) saved++;
      }
    }
    h.refreshMetrics();
    alert(`Saved ${saved} row(s).`);
    setRows([blankRow()]);
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    all: 'unset', cursor: 'pointer', padding: '8px 4px', marginRight: 16, borderBottom: active ? '2px solid #1f8a70' : '2px solid transparent', borderRadius: 0, background: 'transparent', fontSize: 12.5, fontWeight: active ? 600 : 400, color: active ? '#1a1916' : '#6b6860',
  });

  return (
    <div>
      <div className="pagehead"><div><h2>Add Data</h2><p>Manually key in day-wise numbers per ad. Rows save into the account's dataset.</p></div></div>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e2db', marginBottom: 16 }}>
        {(['meta', 'shopify', 'payment'] as Sub[]).map(s => (
          <button key={s} onClick={() => { setSub(s); setRows([blankRow()]); }} style={tabStyle(sub === s)}>
            {s === 'meta' ? 'Meta' : s === 'shopify' ? 'Shopify' : 'Payment Gateway'}
          </button>
        ))}
      </div>
      {h.ads.length === 0 && (
        <div style={{ background: '#fff8ec', border: '1px solid #f1dfb8', borderRadius: 8, padding: '10px 12px', fontSize: 12, marginBottom: 14 }}>
          No ads exist yet. Add campaigns and ads first in the &quot;Campaigns &amp; Ads&quot; tab, then come back to feed data.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <button className="btn btn-sm" onClick={() => setRows(prev => [...prev, blankRow()])}>+ Add Row</button>
        <button className="btn btn-sm btn-primary" onClick={handleSaveAll}>Save All Rows</button>
      </div>
      <div className="tablewrap">
        <table className="grid-entry">
          <thead><tr>
            <th style={{ textAlign: 'left' }}>Campaign</th><th>Date</th><th>Ad</th>
            {defs.map(([, label]) => <th key={label}>{label}</th>)}
            <th></th>
          </tr></thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr key={i}>
                <td style={{ textAlign: 'left', color: '#6b6860', fontSize: 11 }}>{campNameFor(row.adId)}</td>
                <td><input type="date" value={row.date} onChange={e => updateRow(i, 'date', e.target.value)} /></td>
                <td><select value={row.adId} onChange={e => updateRow(i, 'adId', e.target.value)}>
                  <option value="">Select ad...</option>
                  {sub === 'shopify' && <option value="">— Unattributed (Direct/Organic) —</option>}
                  {h.ads.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select></td>
                {defs.map(([k]) => (
                  <td key={k}><input type="number" step="any" min="0" value={row[k] || ''}
                    onChange={e => updateRow(i, k, parseFloat(e.target.value) || 0)} /></td>
                ))}
                <td><button className="sm ghost" onClick={() => setRows(prev => prev.filter((_, idx) => idx !== i))} style={{ cursor: 'pointer' }}>{'\u2715'}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: '#9a9690', marginTop: 8 }}>
        Tip: for Shopify rows with no linked ad (Direct/Organic/unattributed sales), leave Ad set to &quot;Unattributed&quot;. Rows are grouped by campaign, then ad, then date.
      </p>
    </div>
  );
}


function UploadTab({ h, onLoadToAddData }: { h: ReturnType<typeof useSignal>; onLoadToAddData: (sub: string, rows: { date: string; adId: string; [k: string]: any }[]) => void }) {
  const [source, setSource] = useState<Source>('meta');
  const [step, setStep] = useState<'select' | 'mapping' | 'preview' | 'done'>('select');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [resolutionLog, setResolutionLog] = useState<string[]>([]);
  const [completing, setCompleting] = useState(false);
  const [adMap, setAdMap] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncFrom, setSyncFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0, 10); });
  const [syncTo, setSyncTo] = useState(todayInput());

  const metaConnected = !!(h.metaConn?.ad_account_id);

  const distinctNames = useMemo(() => {
    if (!mapping.ad_name || !rawRows.length) return [];
    const col = mapping.ad_name;
    return [...new Set(rawRows.map(r => String(r[col] || '').trim()).filter(Boolean))];
  }, [rawRows, mapping.ad_name]);

  const nameToCampaign = useMemo(() => {
    const map: Record<string, string> = {};
    if (!mapping.ad_name || !mapping.campaign_name) return map;
    for (const r of rawRows) {
      const n = String(r[mapping.ad_name] || '').trim();
      if (n && !map[n]) map[n] = String(r[mapping.campaign_name] || '').trim();
    }
    return map;
  }, [rawRows, mapping.ad_name, mapping.campaign_name]);

  useEffect(() => {
    if (distinctNames.length === 0) return;
    setAdMap(prev => {
      const next = { ...prev };
      for (const n of distinctNames) {
        if (!(n in next)) {
          const match = h.ads.find(a => a.name.trim().toLowerCase() === n.toLowerCase());
          next[n] = match ? match.id : '';
        }
      }
      return next;
    });
  }, [distinctNames, h.ads]);

  const unmatchedCount = distinctNames.filter(n => !adMap[n]).length;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', header: 1 }) as any;
    if (!json.length) return alert('Empty file');
    const hdr = json[0].map((c: any) => String(c).trim()) as string[];
    const data = json.slice(1).slice(0, 501) as string[][];
    const objRows = data.map((row: string[]) => {
      const o: Record<string, string> = {};
      hdr.forEach((h, i) => { o[h] = row[i] !== undefined ? String(row[i]) : ''; });
      return o;
    });
    setHeaders(hdr); setRawRows(objRows);
    setMapping(autoDetectMapping(source, hdr));
    setStep('mapping');
  };

  useEffect(() => {
    if (headers.length > 0) setMapping(autoDetectMapping(source, headers));
  }, [source]);

  const handleApply = () => {
    const mapped = applyMapping(source, rawRows as ParsedRow[], mapping);
    setRows(mapped);
    setStep('preview');
  };

  const handleAutoCreateAll = () => {
    setAdMap(prev => {
      const next = { ...prev };
      for (const n of distinctNames) { if (!next[n]) next[n] = '__auto__'; }
      return next;
    });
  };

  const doCommit = async (output: 'direct' | 'addData') => {
    setCompleting(true);
    const log: string[] = [];
    try {
      const effectiveMap = { ...adMap };
      let autoCreated = 0;
      for (const n of Object.keys(effectiveMap)) {
        if (effectiveMap[n] === '__auto__') {
          const campName = nameToCampaign[n] || 'Imported';
          let camp = h.campaigns.find(c => c.name.toLowerCase() === campName.toLowerCase());
          if (!camp) {
            const { data: c } = await supabase.from('signal_campaigns').insert({ account_id: h.activeAccountId, name: campName }).select('id').single();
            camp = c as any;
          }
          if (camp) {
            const { data: ad } = await supabase.from('signal_ads').insert({ account_id: h.activeAccountId, campaign_id: camp.id, name: n }).select('id').single();
            if (ad) { effectiveMap[n] = (ad as any).id; autoCreated++; }
          }
        }
      }

      if (output === 'direct') {
        const adIdByName = new Map<string, string | null>();
        for (const [n, id] of Object.entries(effectiveMap)) {
          if (id && id !== '__auto__') adIdByName.set(n, id);
        }
        await upsertMetrics(source, h.activeAccountId, rows, adIdByName);
        log.push('Imported ' + rows.length + ' rows into ' + source + ' metrics');
        if (autoCreated) log.push('Auto-created ' + autoCreated + ' new ad(s)/campaign(s)');
        h.refreshMetrics();
        h.refreshCampaignsAndAds();
        setResolutionLog(log);
        setStep('done');
      } else {
        const built: { date: string; adId: string; [k: string]: any }[] = [];
        for (const r of rows) {
          const adName = r.ad_name ? String(r.ad_name).trim() : '';
          const adId = adName ? (effectiveMap[adName] || '') : '';
          if (adName && !adId) continue;
          const dateStr = normalizeDate(r.date);
          if (!dateStr) continue;
          const row: Record<string, any> = { date: dateStr, adId: adId || '' };
          for (const f of FIELDS[source]) {
            if (f.key === 'date' || f.key === 'ad_name' || f.key === 'campaign_name') continue;
            const addDataKey = UPLOAD_TO_ADDDATA_KEY[f.key] || f.key;
            row[addDataKey] = +r[f.key] || 0;
          }
          built.push(row);
        }
        if (!built.length) {
          setResolutionLog(['Nothing to load \u2014 check the column mapping and ad matches above.']);
          setCompleting(false);
          return;
        }
        onLoadToAddData(source, built);
      }
    } catch (err: any) {
      log.push('Error: ' + (err?.message || 'Unknown'));
      setResolutionLog(log);
    }
    setCompleting(false);
  };

  const handleMetaSync = async () => {
    if (!h.activeAccountId || !syncFrom || !syncTo) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('meta-sync', {
        body: { accountId: h.activeAccountId, since: syncFrom, until: syncTo },
      });
      if (error) throw new Error(error.message || 'Meta sync failed');
      const json = data as any;
      const apiRows: ParsedRow[] = (json.rows || []).map((r: any) => ({
        date: r.date_start || r.date || '',
        ad_name: r.ad_name || '',
        campaign_name: r.campaign_name || '',
        spend: r.spend || 0, results: r.results || 0, reach: r.reach || 0,
        impressions: r.impressions || 0, clicks: r.clicks || 0,
        landing_page_views: r.landing_page_views || 0,
        add_to_cart: r.add_to_cart || 0, purchases: r.purchases || 0,
        frequency: r.frequency || 0,
      }));
      if (!apiRows.length) { alert('No rows returned from Meta for this range.'); setSyncing(false); return; }
      const cols = ['date', 'ad_name', 'campaign_name', 'spend', 'results', 'reach', 'impressions', 'clicks', 'landing_page_views', 'add_to_cart', 'purchases', 'frequency'];
      const autoMapping: Record<string, string> = {};
      cols.forEach(c => { autoMapping[c] = c; });
      setHeaders(cols); setRawRows(apiRows as any); setMapping(autoMapping);
      setRows(apiRows); setFileName('Meta API Sync');
      setStep('preview');
    } catch (err: any) {
      alert('Meta sync failed: ' + (err?.message || 'Unknown error'));
    }
    setSyncing(false);
  };

  const renderCell = (val: unknown) => esc(val != null ? String(val) : '').substring(0, 60) || '\u00A0';

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    all: 'unset', cursor: 'pointer', padding: '8px 14px', fontSize: 12.5, fontWeight: active ? 600 : 400,
    borderBottom: active ? '2px solid #1f8a70' : '2px solid transparent', borderRadius: 0,
    color: active ? '#1a1916' : '#6b6860',
  });

  return (
    <div>
      <div className="pagehead"><div><h2>Upload File</h2><p>Upload an Excel/CSV export or sync from Meta. We auto-detect columns and match ad names.</p></div></div>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #e5e2db', marginBottom: 16 }}>
        {(['meta', 'shopify', 'payment'] as Source[]).map(s => (
          <button key={s} onClick={() => { if (step === 'select') setSource(s); }} style={tabBtnStyle(source === s)}>
            {s === 'meta' ? 'Meta' : s === 'shopify' ? 'Shopify' : 'Payment Gateway'}
          </button>
        ))}
      </div>

      {source === 'meta' && step === 'select' && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Sync directly from Meta</span>
            <span className={'matchbadge ' + (metaConnected ? 'ok' : 'no')}>{metaConnected ? 'connected \u2014 ' + esc(h.metaConn?.ad_account_id || '') : 'not connected'}</span>
          </div>
          {!metaConnected ? (
            <p style={{ fontSize: 11.5, color: '#6b6860', margin: 0 }}>Add your access token and ad account ID in <b>Settings</b> first.</p>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 6 }}>
              <label className="f">From<input type="date" value={syncFrom} onChange={e => setSyncFrom(e.target.value)} /></label>
              <label className="f">To<input type="date" value={syncTo} onChange={e => setSyncTo(e.target.value)} /></label>
              <button className="btn btn-sm btn-primary" disabled={syncing} onClick={handleMetaSync}>{syncing ? 'Fetching...' : 'Fetch from Meta'}</button>
            </div>
          )}
        </div>
      )}

      {step === 'select' && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 30, textAlign: 'center', border: '2px dashed #d2cec7' }}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: '#1a1916' }}>Upload a CSV or Excel file (.xlsx, .xls)</p>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} key={source} />
        </div>
      )}

      {step === 'mapping' && (
        <div>
          <p style={{ fontSize: 12.5, color: '#6b6860', marginBottom: 12 }}>Map columns from <b>{esc(fileName)}</b> to <b>{source}</b> fields</p>
          <div style={{ background: '#fff', borderRadius: 10, padding: 16, overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <table className="grid-entry">
              <thead><tr><th style={{ textAlign: 'left', padding: 6, fontSize: 12 }}>Field</th><th style={{ textAlign: 'left', padding: 6, fontSize: 12 }}>Detected column</th></tr></thead>
              <tbody>
                {FIELDS[source].map(f => {
                  const matchedHeader = mapping[f.key] || '';
                  return (
                    <tr key={f.key}>
                      <td style={{ textAlign: 'left', fontSize: 12 }}>{esc(f.label)}{f.required ? ' *' : ''}</td>
                      <td style={{ textAlign: 'left' }}>
                        <select value={matchedHeader} onChange={e => setMapping(prev => ({ ...prev, [f.key]: e.target.value }))} style={{ maxWidth: 300 }}>
                          <option value="">{'\u2014 Skip \u2014'}</option>
                          {headers.map(h => <option key={h} value={h}>{esc(h)}</option>)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setStep('select')}>Back</button>
            <button className="btn btn-sm btn-primary" onClick={handleApply}>Apply Mapping & Preview</button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div>
          <p style={{ fontSize: 12.5, color: '#6b6860', marginBottom: 12 }}>Preview ({rows.length} rows from <b>{esc(fileName)}</b>)</p>

          <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>1. Confirm column mapping</div>
            <div className="tablewrap" style={{ maxHeight: 200 }}>
              <table className="datatable"><thead><tr><th style={{ textAlign: 'left' }}>Field</th><th style={{ textAlign: 'left' }}>Detected column</th></tr></thead>
                <tbody>{FIELDS[source].filter(f => mapping[f.key]).map(f => (
                  <tr key={f.key}><td style={{ textAlign: 'left' }}>{esc(f.label)}</td><td style={{ textAlign: 'left' }}>{esc(mapping[f.key])}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>

          <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginBottom: 14, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>2. Match ad names to existing ads</div>
            {distinctNames.length === 0 ? (
              <div style={{ color: '#6b6860', fontSize: 12 }}>No ad name column mapped, or no distinct names found.</div>
            ) : (
              <>
                <div style={{ marginBottom: 8 }}>
                  <button className="btn btn-sm" onClick={handleAutoCreateAll}>
                    Auto-create campaigns/ads for all unmatched names
                  </button>
                  {unmatchedCount > 0 && <span style={{ fontSize: 11, color: '#6b6860', marginLeft: 8 }}>{unmatchedCount} unmatched</span>}
                </div>
                <div className="tablewrap" style={{ maxHeight: 240 }}>
                  <table className="datatable"><thead><tr>
                    <th style={{ textAlign: 'left' }}>Name in file</th>
                    <th style={{ textAlign: 'left' }}>Campaign (from file)</th>
                    <th>Match status</th>
                    <th style={{ textAlign: 'left' }}>Link to ad</th>
                  </tr></thead><tbody>
                    {distinctNames.map(n => (
                      <tr key={n}>
                        <td style={{ textAlign: 'left' }}>{esc(n)}</td>
                        <td style={{ textAlign: 'left' }}>{esc(nameToCampaign[n] || '\u2014')}</td>
                        <td>{adMap[n] ? <span className="matchbadge ok">matched</span> : <span className="matchbadge no">no match</span>}</td>
                        <td style={{ textAlign: 'left' }}>
                          <select value={adMap[n] || ''} onChange={e => setAdMap(prev => ({ ...prev, [n]: e.target.value }))}>
                            <option value="">{'\u2014 skip these rows \u2014'}</option>
                            <option value="__auto__">+ Auto-create campaign & ad</option>
                            {h.ads.map(ad => <option key={ad.id} value={ad.id}>{esc(ad.name)}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-sm" onClick={() => setStep('mapping')}>Back</button>
            <button className="btn btn-sm btn-primary" disabled={completing} onClick={() => doCommit('direct')}>
              {completing ? 'Importing...' : 'Import ' + rows.length + ' rows directly'}
            </button>
            <button className="btn btn-sm btn-outline" disabled={completing} onClick={() => doCommit('addData')}>
              Load into Add Data grid for review
            </button>
          </div>
          <p style={{ fontSize: 11, color: '#9a9690', marginTop: 8 }}>
            Auto-create will make a new campaign (from the file's campaign name) and a new ad under it. You can rename/re-tag afterwards in Campaigns & Ads.
          </p>
        </div>
      )}

      {step === 'done' && (
        <div>
          <div style={{ background: '#e5f5ec', borderRadius: 10, padding: 20, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#2d6a4f', margin: '0 0 6px' }}>{'\u2713'} Done</p>
            <p style={{ fontSize: 12.5, color: '#1a1916' }}>{rows.length} rows processed from <b>{esc(fileName)}</b> as <b>{source}</b></p>
          </div>
          {resolutionLog.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 10, padding: 14, marginTop: 12, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Log</div>
              {resolutionLog.map((l, i) => <div key={i} style={{ fontSize: 11.5, color: '#6b6860', padding: '2px 0' }}>{l}</div>)}
            </div>
          )}
          <div style={{ marginTop: 14 }}><button className="btn btn-sm" onClick={() => { setStep('select'); setFileName(''); setRawRows([]); setRows([]); setHeaders([]); setMapping({}); setResolutionLog([]); setAdMap({}); }}>Import Another File</button></div>
        </div>
      )}
    </div>
  );
}


function AnalyticsTab({ h }: { h: ReturnType<typeof useSignal> }) {
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); });
  const [dateTo, setDateTo] = useState(todayInput());
  const [level, setLevel] = useState<'ad' | 'campaign'>('ad');
  const [filterText, setFilterText] = useState('');
  const [sortCol, setSortCol] = useState('spend');
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [showCols, setShowCols] = useState<Record<string, boolean>>({
    name: true, campaignName: true, spend: true, impressions: true, clicks: true,
    ctr: true, purchases: true, cpa: true, orders: true, order_value: true, roas: true,
  });
  const [columnOrder, setColumnOrder] = useState<string[]>([
    'name', 'campaignName', 'spend', 'results', 'reach', 'impressions', 'clicks',
    'lp_views', 'atc', 'purchases', 'frequency', 'sessions', 'orders', 'order_value',
    'cpm', 'ctr', 'cpa', 'costPerSession', 'convPct', 'roas',
  ]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [chartMetric, setChartMetric] = useState('spend');
  const [chartEntity, setChartEntity] = useState('all');
  const [dragCol, setDragCol] = useState<string | null>(null);

  const ALL_COLUMNS: { key: string; label: string }[] = [
    { key: 'name', label: 'Ad' },
    { key: 'campaignName', label: 'Campaign' },
    { key: 'spend', label: 'Spend' },
    { key: 'results', label: 'Results' },
    { key: 'reach', label: 'Reach' },
    { key: 'impressions', label: 'Impressions' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'lp_views', label: 'LP Views' },
    { key: 'atc', label: 'ATC' },
    { key: 'purchases', label: 'Purchases' },
    { key: 'frequency', label: 'Frequency' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'orders', label: 'Orders' },
    { key: 'order_value', label: 'Order Value' },
    { key: 'cpm', label: 'CPM' },
    { key: 'ctr', label: 'CTR %' },
    { key: 'cpa', label: 'CPA' },
    { key: 'costPerSession', label: 'Cost/Session' },
    { key: 'convPct', label: 'Conv %' },
    { key: 'roas', label: 'ROAS' },
  ];

  type Row = {
    key: string; name: string; campaignName: string; isUnattr: boolean;
    spend: number; results: number; reach: number; impressions: number;
    clicks: number; lp_views: number; atc: number; purchases: number;
    frequency: number; sessions: number; orders: number; order_value: number;
    gross_amount: number; transactions: number; fees: number;
    cpm: number; ctr: number; cpa: number; costPerSession: number; convPct: number; roas: number;
  };

  const analyticsRows = useMemo((): Row[] => {
    const inRange = (d: string) => d >= dateFrom && d <= dateTo;
    const meta = h.metaMetrics.filter(m => inRange(m.date));
    const shop = h.shopifyMetrics.filter(m => inRange(m.date));
    const pay = h.paymentMetrics.filter(m => inRange(m.date));
    const adMap = new Map(h.ads.map(a => [a.id, a]));
    const campaignMap = new Map(h.campaigns.map(c => [c.id, c]));

    type G = {
      name: string; campaignName: string; isUnattr: boolean;
      spend: number; results: number; reach: number; impressions: number;
      clicks: number; lp_views: number; atc: number; purchases: number;
      freqReach: number; freqImpr: number;
      sessions: number; orders: number; order_value: number;
      gross_amount: number; transactions: number; fees: number;
    };
    const groups = new Map<string, G>();
    const ensure = (key: string, name: string, campaignName: string, isUnattr: boolean): G => {
      if (!groups.has(key)) groups.set(key, {
        name, campaignName, isUnattr, spend: 0, results: 0, reach: 0, impressions: 0,
        clicks: 0, lp_views: 0, atc: 0, purchases: 0, freqReach: 0, freqImpr: 0,
        sessions: 0, orders: 0, order_value: 0, gross_amount: 0, transactions: 0, fees: 0,
      });
      return groups.get(key)!;
    };

    if (level === 'ad') {
      for (const m of meta) {
        if (!m.ad_id) continue;
        const ad = adMap.get(m.ad_id);
        const camp = ad ? campaignMap.get(ad.campaign_id) : undefined;
        const g = ensure(m.ad_id, ad?.name || m.ad_id, camp?.name || '', false);
        g.spend += m.spend; g.results += m.results; g.reach += m.reach;
        g.impressions += m.impressions; g.clicks += m.clicks;
        g.lp_views += m.landing_page_views; g.atc += m.add_to_cart;
        g.purchases += m.purchases; g.freqReach += m.reach; g.freqImpr += m.impressions;
      }
      for (const s of shop) {
        const key = s.ad_id || '__unattr__';
        const ad = s.ad_id ? adMap.get(s.ad_id) : undefined;
        const camp = ad ? campaignMap.get(ad.campaign_id) : undefined;
        const g = ensure(key, s.ad_id ? (ad?.name || s.ad_id) : 'Unattributed (Direct/Organic)', camp?.name || '', !s.ad_id);
        g.sessions += s.sessions; g.orders += s.orders; g.order_value += s.order_value;
      }
      for (const p of pay) {
        const key = p.ad_id || '__unattr__';
        const ad = p.ad_id ? adMap.get(p.ad_id) : undefined;
        const camp = ad ? campaignMap.get(ad.campaign_id) : undefined;
        const g = ensure(key, p.ad_id ? (ad?.name || p.ad_id) : 'Unattributed (Direct/Organic)', camp?.name || '', !p.ad_id);
        g.gross_amount += p.gross_amount; g.transactions += p.transactions; g.fees += p.fees;
      }
    } else {
      const adToCamp = new Map(h.ads.map(a => [a.id, a.campaign_id]));
      for (const c of h.campaigns) ensure(c.id, c.name, '', false);
      for (const m of meta) {
        const campId = m.ad_id ? adToCamp.get(m.ad_id) : undefined;
        if (!campId) continue;
        const g = groups.get(campId)!;
        if (!g) continue;
        g.spend += m.spend; g.results += m.results; g.reach += m.reach;
        g.impressions += m.impressions; g.clicks += m.clicks;
        g.lp_views += m.landing_page_views; g.atc += m.add_to_cart;
        g.purchases += m.purchases; g.freqReach += m.reach; g.freqImpr += m.impressions;
      }
      for (const s of shop) {
        if (!s.ad_id) {
          const g = ensure('__unattr__', 'Unattributed (Direct/Organic)', '', true);
          g.sessions += s.sessions; g.orders += s.orders; g.order_value += s.order_value;
          continue;
        }
        const campId = adToCamp.get(s.ad_id);
        if (!campId) continue;
        const g = groups.get(campId);
        if (!g) continue;
        g.sessions += s.sessions; g.orders += s.orders; g.order_value += s.order_value;
      }
      for (const p of pay) {
        if (!p.ad_id) {
          const g = ensure('__unattr__', 'Unattributed (Direct/Organic)', '', true);
          g.gross_amount += p.gross_amount; g.transactions += p.transactions; g.fees += p.fees;
          continue;
        }
        const campId = adToCamp.get(p.ad_id);
        if (!campId) continue;
        const g = groups.get(campId);
        if (!g) continue;
        g.gross_amount += p.gross_amount; g.transactions += p.transactions; g.fees += p.fees;
      }
    }

    return Array.from(groups.entries()).map(([k, g]) => {
      const freq = g.freqReach > 0 ? g.freqImpr / g.freqReach : 0;
      return {
        key: k, name: g.name, campaignName: g.campaignName, isUnattr: g.isUnattr,
        spend: g.spend, results: g.results, reach: g.reach, impressions: g.impressions,
        clicks: g.clicks, lp_views: g.lp_views, atc: g.atc, purchases: g.purchases,
        frequency: freq, sessions: g.sessions, orders: g.orders, order_value: g.order_value,
        gross_amount: g.gross_amount, transactions: g.transactions, fees: g.fees,
        cpm: g.impressions > 0 ? (g.spend / g.impressions) * 1000 : 0,
        ctr: g.impressions > 0 ? (g.clicks / g.impressions) * 100 : 0,
        cpa: g.purchases > 0 ? g.spend / g.purchases : 0,
        costPerSession: g.sessions > 0 ? g.spend / g.sessions : 0,
        convPct: g.sessions > 0 ? (g.orders / g.sessions) * 100 : 0,
        roas: g.spend > 0 ? g.order_value / g.spend : 0,
      };
    }).sort((a, b) => b.spend - a.spend);
  }, [h.metaMetrics, h.shopifyMetrics, h.paymentMetrics, h.ads, h.campaigns, dateFrom, dateTo, level]);

  const filteredRows = useMemo(() => {
    if (!filterText) return analyticsRows;
    const lower = filterText.toLowerCase();
    return analyticsRows.filter(r => r.name.toLowerCase().includes(lower) || r.campaignName.toLowerCase().includes(lower));
  }, [analyticsRows, filterText]);

  const sorted = useMemo(() => {
    const arr = [...filteredRows];
    const vals = arr.map((r, i) => ({ i, v: (r as any)[sortCol] ?? 0 }));
    const sortedDesc = [...vals].sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
    const sortedAsc = [...vals].sort((a, b) => (a.v ?? Infinity) - (b.v ?? Infinity));
    const top3 = sortedDesc.slice(0, 3).map(v => v.i);
    const bot3 = sortedAsc.slice(0, 3).map(v => v.i);
    arr.sort((a, b) => {
      const dir = sortDir;
      const vx = (a as any)[sortCol] ?? 0;
      const vy = (b as any)[sortCol] ?? 0;
      if (sortCol === 'name' || sortCol === 'campaignName') return dir * String(vx).localeCompare(String(vy));
      return dir * ((vx as number) - (vy as number));
    });
    return { arr, top3, bot3 };
  }, [filteredRows, sortCol, sortDir]);

  const displayCols = useMemo(() =>
    columnOrder.filter(k => showCols[k] !== false).map(k => ALL_COLUMNS.find(c => c.key === k)).filter(Boolean) as { key: string; label: string }[],
    [columnOrder, showCols]
  );

  const chartData = useMemo(() => {
    const days: string[] = [];
    for (let d = new Date(dateFrom); d <= new Date(dateTo); d.setDate(d.getDate() + 1)) days.push(d.toISOString().slice(0, 10));

    const dayVal = (day: string): number => {
      let metaRows = h.metaMetrics.filter(m => m.date === day);
      let shopRows = h.shopifyMetrics.filter(m => m.date === day);
      if (chartEntity !== 'all') {
        if (level === 'ad') {
          metaRows = metaRows.filter(m => m.ad_id === chartEntity);
          shopRows = shopRows.filter(s => s.ad_id === chartEntity);
        } else {
          const adIds = h.ads.filter(a => a.campaign_id === chartEntity).map(a => a.id);
          metaRows = metaRows.filter(m => m.ad_id && adIds.includes(m.ad_id));
          shopRows = shopRows.filter(s => s.ad_id && adIds.includes(s.ad_id));
        }
      }
      const s = { spend: 0, results: 0, reach: 0, impressions: 0, clicks: 0, lp_views: 0, atc: 0, purchases: 0, sessions: 0, orders: 0, order_value: 0, freqReach: 0, freqImpr: 0 };
      for (const m of metaRows) { s.spend += m.spend; s.results += m.results; s.reach += m.reach; s.impressions += m.impressions; s.clicks += m.clicks; s.lp_views += m.landing_page_views; s.atc += m.add_to_cart; s.purchases += m.purchases; s.freqReach += m.reach; s.freqImpr += m.impressions; }
      for (const sh of shopRows) { s.sessions += sh.sessions; s.orders += sh.orders; s.order_value += sh.order_value; }
      switch (chartMetric) {
        case 'cpm': return s.impressions > 0 ? (s.spend / s.impressions) * 1000 : 0;
        case 'ctr': return s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0;
        case 'cpa': return s.purchases > 0 ? s.spend / s.purchases : 0;
        case 'costPerSession': return s.sessions > 0 ? s.spend / s.sessions : 0;
        case 'convPct': return s.sessions > 0 ? (s.orders / s.sessions) * 100 : 0;
        case 'roas': return s.spend > 0 ? s.order_value / s.spend : 0;
        case 'frequency': return s.freqReach > 0 ? s.freqImpr / s.freqReach : 0;
        default: return (s as any)[chartMetric] ?? 0;
      }
    };
    return days.map(d => ({ date: d, value: +dayVal(d).toFixed(4) }));
  }, [h.metaMetrics, h.shopifyMetrics, h.ads, dateFrom, dateTo, chartMetric, chartEntity, level]);

  const updateMarkers = useMemo(() => {
    const markers: { date: string; label: string }[] = [];
    if (level === 'ad') {
      const ads = chartEntity === 'all' ? h.ads : h.ads.filter(a => a.id === chartEntity);
      for (const ad of ads) {
        for (const u of (h.adUpdates || []).filter(u => u.ad_id === ad.id)) {
          const dd = (u.created_at || u.ts || '').slice(0, 10);
          if (dd >= dateFrom && dd <= dateTo) markers.push({ date: dd, label: `Ad "${ad.name}" updated` });
        }
      }
    } else {
      const camps = chartEntity === 'all' ? h.campaigns : h.campaigns.filter(c => c.id === chartEntity);
      for (const c of camps) {
        for (const u of (h.campaignUpdates || []).filter(u => u.campaign_id === c.id)) {
          const dd = (u.created_at || u.ts || '').slice(0, 10);
          if (dd >= dateFrom && dd <= dateTo) markers.push({ date: dd, label: `Campaign "${c.name}" updated` });
        }
      }
    }
    return markers;
  }, [h.ads, h.campaigns, h.adUpdates, h.campaignUpdates, dateFrom, dateTo, chartEntity, level]);

  const entityOptions = useMemo(() => (level === 'ad' ? h.ads : h.campaigns).map(x => ({ id: x.id, name: x.name })), [h.ads, h.campaigns, level]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === -1 ? 1 : -1);
    else { setSortCol(col); setSortDir(-1); }
  };
  const fmtVal = (v: number, key: string) => {
    if (key === 'ctr' || key === 'convPct') return (v * 100).toFixed(2) + '%';
    if (['cpa', 'spend', 'order_value', 'cpm', 'costPerSession'].includes(key)) return fmtMoney(v);
    if (key === 'roas') return v.toFixed(2) + 'x';
    if (key === 'frequency') return v.toFixed(2);
    return fmtNum(v);
  };
  const handleDragStart = (col: string) => setDragCol(col);
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();
  const handleDrop = (targetCol: string) => {
    if (!dragCol || dragCol === targetCol) return;
    setColumnOrder(prev => {
      const o = [...prev];
      const from = o.indexOf(dragCol); const to = o.indexOf(targetCol);
      o.splice(from, 1); o.splice(to, 0, dragCol);
      return o;
    });
    setDragCol(null);
  };

  return (
    <div>
      <div className="pagehead">
        <div><h2>Analytics</h2><p>Select a date range and level; sort, filter, hide or reorder columns.</p></div>
      </div>
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="f">From<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
        <label className="f">To<input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
        <label className="f">Level<select value={level} onChange={e => { setLevel(e.target.value as 'ad' | 'campaign'); setChartEntity('all'); }}><option value="ad">Ad level</option><option value="campaign">Campaign level</option></select></label>
        <label className="f">Search<input type="text" value={filterText} onChange={e => setFilterText(e.target.value)} placeholder="Filter by name..." /></label>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" onClick={() => setMenuOpen(!menuOpen)}>Columns</button>
          {menuOpen && <div className="colmenu" style={{ right: 0, top: '100%', marginTop: 4 }} onClick={() => setMenuOpen(false)}>
            {ALL_COLUMNS.map(c => <label key={c.key}><input type="checkbox" checked={showCols[c.key] !== false} onChange={e => setShowCols(prev => ({ ...prev, [c.key]: e.target.checked }))} />{c.label}</label>)}
          </div>}
        </div>
      </div>
      {analyticsRows.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 10, padding: 30, textAlign: 'center', color: '#6b6860', fontSize: 13 }}>No analytics data yet. Import or add data to see metrics.</div>
      ) : (
        <div className="tablewrap">
          <table className="datatable">
            <thead>
              <tr>{displayCols.map(c => (
                <th key={c.key}
                  draggable={c.key !== 'name' && c.key !== 'campaignName'}
                  onDragStart={() => handleDragStart(c.key)}
                  onDragOver={handleDragOver}
                  onDrop={() => handleDrop(c.key)}
                  onClick={() => { if (c.key !== 'name' && c.key !== 'campaignName') handleSort(c.key); }}
                  style={{ cursor: c.key !== 'name' && c.key !== 'campaignName' ? 'pointer' : 'default', opacity: dragCol === c.key ? 0.4 : 1 }}>
                  {c.label}{sortCol === c.key ? (sortDir === -1 ? ' \u25BC' : ' \u25B2') : ''}
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {sorted.arr.map((r, i) => {
                let cls = '';
                if (sorted.top3.includes(i)) cls = i === sorted.top3[0] ? 'top1' : i === sorted.top3[1] ? 'top2' : 'top3';
                if (sorted.bot3.includes(i)) cls = i === sorted.bot3[0] ? 'bot1' : i === sorted.bot3[1] ? 'bot2' : 'bot3';
                return (
                  <tr key={r.key + i} className={cls}>
                    {displayCols.map(c => (
                      <td key={c.key} style={{ fontSize: 12, fontFamily: c.key === 'name' || c.key === 'campaignName' ? 'inherit' : 'ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace' }}>
                        {c.key === 'name' || c.key === 'campaignName' ? esc((r as any)[c.key]) : fmtVal((r as any)[c.key] ?? 0, c.key)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {chartData.length > 1 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: '18px 20px', marginTop: 20, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 12.5 }}>Trend</b>
            <select value={chartMetric} onChange={e => setChartMetric(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }}>
              {ALL_COLUMNS.filter(c => c.key !== 'name' && c.key !== 'campaignName').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <select value={chartEntity} onChange={e => setChartEntity(e.target.value)} style={{ fontSize: 12, padding: '4px 8px' }}>
              <option value="all">All (combined)</option>
              {entityOptions.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eae8e3" />
              <XAxis dataKey="date" fontSize={11} tick={{ fill: '#6b6860' }} />
              <YAxis fontSize={11} tick={{ fill: '#6b6860' }} />
              <Tooltip />
              {updateMarkers.map((m, i) => <ReferenceLine key={i} x={m.date} stroke="#c96a3c" strokeDasharray="4 3" />)}
              <Line type="monotone" dataKey="value" stroke="#1f8a70" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          {updateMarkers.length > 0 ? (
            <div style={{ fontSize: 11, color: '#6b6860', marginTop: 8 }}>Dashed orange lines mark: {updateMarkers.map(m => `${m.date} \u2014 ${m.label}`).join(' \u00B7 ')}</div>
          ) : (
            <div style={{ fontSize: 11, color: '#9a9690', marginTop: 8 }}>No campaign/ad updates logged in this range.</div>
          )}
        </div>
      )}
    </div>
  );
}


function SettingsTab({ h }: { h: ReturnType<typeof useSignal> }) {
  const [saving, setSaving] = useState(false);
  const [newGoalTag, setNewGoalTag] = useState('');
  const [newAdTypeTag, setNewAdTypeTag] = useState('');
  const [connToken, setConnToken] = useState('');
  const [connAccountId, setConnAccountId] = useState('');
  const [connVersion, setConnVersion] = useState('v21.0');
  const [connResultType, setConnResultType] = useState('purchase');
  const [connNote, setConnNote] = useState('');
  const [savingConn, setSavingConn] = useState(false);

  useEffect(() => {
    setConnAccountId(h.metaConn?.ad_account_id || '');
    setConnVersion(h.metaConn?.api_version || 'v21.0');
    setConnResultType(h.metaConn?.results_action_type || 'purchase');
    setConnToken('');
    setConnNote('');
  }, [h.metaConn]);

  const goalTags = useMemo(() => {
    return [...new Set((h.tags || []).filter(t => t.kind === 'goal').map(t => t.tag))];
  }, [h.tags]);
  const adTypeTags = useMemo(() => {
    return [...new Set((h.tags || []).filter(t => t.kind === 'ad_type').map(t => t.tag))];
  }, [h.tags]);

  const handleAddTag = async (kind: 'goal' | 'ad_type', value: string) => {
    const tag = value.trim();
    if (!tag) return;
    await supabase.from('signal_tag_master').insert({ account_id: h.activeAccountId, kind, tag }).catch(() => {});
    window.location.reload();
  };

  const handleDeleteTag = async (kind: 'goal' | 'ad_type', tag: string) => {
    await supabase.from('signal_tag_master').delete()
      .eq('account_id', h.activeAccountId).eq('kind', kind).eq('tag', tag);
    window.location.reload();
  };

  const handleSaveMetaConnection = async () => {
    setSavingConn(true);
    try {
      const { error } = await supabase.from('signal_meta_connections').upsert({
        account_id: h.activeAccountId,
        access_token: connToken || null,
        ad_account_id: connAccountId || null,
        api_version: connVersion || 'v21.0',
        results_action_type: connResultType || 'purchase',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'account_id' });
      if (error) throw error;
      alert('Meta connection saved.');
      await h.refreshMetaConn();
    } catch (err: any) {
      alert('Error: ' + (err?.message || 'Unknown'));
    }
    setSavingConn(false);
  };

  return (
    <div>
      <div className="pagehead"><div><h2>Settings</h2><p>Manage tag masters and Meta API connection.</p></div></div>

      <div style={{ background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Tag Masters</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <label className="f">Campaign Goal Tags</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6, minHeight: 30 }}>
              {goalTags.map(t => (
                <span key={t} style={{ background: '#d8f3dc', color: '#2d6a4f', borderRadius: 20, padding: '3px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {esc(t)}
                  <button onClick={() => handleDeleteTag('goal', t)} style={{ all: 'unset', cursor: 'pointer', fontSize: 11, opacity: .6 }}>{'\u00D7'}</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input type="text" value={newGoalTag} onChange={e => setNewGoalTag(e.target.value)}
                placeholder="New goal tag..." onKeyDown={e => { if (e.key === 'Enter') { handleAddTag('goal', newGoalTag); setNewGoalTag(''); } }}
                style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => { handleAddTag('goal', newGoalTag); setNewGoalTag(''); }}>Add</button>
            </div>
          </div>
          <div>
            <label className="f">Ad Type Tags</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6, minHeight: 30 }}>
              {adTypeTags.map(t => (
                <span key={t} style={{ background: '#e3e8ff', color: '#3843a6', borderRadius: 20, padding: '3px 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  {esc(t)}
                  <button onClick={() => handleDeleteTag('ad_type', t)} style={{ all: 'unset', cursor: 'pointer', fontSize: 11, opacity: .6 }}>{'\u00D7'}</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input type="text" value={newAdTypeTag} onChange={e => setNewAdTypeTag(e.target.value)}
                placeholder="New ad type tag..." onKeyDown={e => { if (e.key === 'Enter') { handleAddTag('ad_type', newAdTypeTag); setNewAdTypeTag(''); } }}
                style={{ flex: 1 }} />
              <button className="btn btn-sm" onClick={() => { handleAddTag('ad_type', newAdTypeTag); setNewAdTypeTag(''); }}>Add</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Meta API Connection</div>
        <p style={{ fontSize: 11.5, color: '#6b6860', margin: '0 0 14px' }}>
          One connection per account. The access token is stored securely server-side and is never exposed to the browser.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 520 }}>
          <label className="f">Access Token (long-lived or system-user token)
            <input type="password" value={connToken} onChange={e => setConnToken(e.target.value)}
              placeholder={h.metaConn ? '(token saved — enter new value to replace)' : 'EAAG...'} /></label>
          <label className="f">Ad Account ID
            <input type="text" value={connAccountId} onChange={e => setConnAccountId(e.target.value)} placeholder="act_1234567890" /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="f">API Version
              <input type="text" value={connVersion} onChange={e => setConnVersion(e.target.value)} /></label>
            <label className="f">"Results" Action Type
              <input type="text" value={connResultType} onChange={e => setConnResultType(e.target.value)} placeholder="e.g. purchase, lead" /></label>
          </div>
          <label className="f">Note (e.g. token generated / expiry date)
            <input type="text" value={connNote} onChange={e => setConnNote(e.target.value)} placeholder="Generated 13 Jul 2026, refresh by ~11 Sep" /></label>
        </div>
        <button className="btn btn-sm btn-primary" disabled={savingConn} onClick={handleSaveMetaConnection} style={{ marginTop: 10 }}>
          {savingConn ? 'Saving...' : 'Save Connection'}
        </button>
        {h.metaConn && (
          <span style={{ marginLeft: 10, fontSize: 11.5, color: '#2d6a4f' }}>
            {'\u2713'} Connected &mdash; {esc(h.metaConn.ad_account_id)}
          </span>
        )}
      </div>
    </div>
  );
}

