import { useState, useMemo, useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import useSignal, { type SignalTab } from '../hooks/useSignal';
import { supabase } from '../lib/supabase';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import * as XLSX from 'xlsx';
import {
  FIELDS, type Source, type ParsedRow,
  autoDetectMapping, applyMapping,
  buildResolutions, commitResolutions, upsertMetrics,
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


export default function Signal() {
  const h = useSignal();
  const session = useStore(s => s.session);
  const mainRef = useRef<HTMLDivElement>(null);

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
        <div style={{ padding: '0 12px', marginBottom: 14 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', color: '#7d8a86', margin: '0 6px 6px' }}>Account</div>
          <select value={h.activeAccountId} onChange={e => h.setActiveAccountId(e.target.value)}
            style={{ width: '100%', background: '#1d2830', color: '#fff', border: '1px solid #33403a', borderRadius: 6, padding: '8px 6px', fontSize: 13 }}>
            {h.accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.is_default ? ' (Default)' : ''}</option>)}
          </select>
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
        <div style={{ padding: '10px 14px 0', borderTop: '1px solid #2a343c', marginTop: 8 }}>
          <div style={{ fontSize: 11, color: '#8ea89c', lineHeight: 1.5 }}>
            {session?.user?.email ? <span style={{ fontSize: 12 }}>{session.user.email}</span> : <span style={{ color: '#e0a15b' }}>Not connected</span>}
          </div>
        </div>
      </div>

      <div className="sgx" style={{ flex: 1, overflowY: 'auto', padding: '26px 34px 60px', background: '#f5f6f4' }} ref={mainRef}>
        {h.loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#6b6860' }}>Loading Signal data\u2026</div>
        ) : !h.activeAccountId && h.accounts.length === 0 ? (
          <NoAccounts />
        ) : h.activeTab === 'dashboard' ? <Dashboard h={h} />
          : h.activeTab === 'campaigns' ? <CampaignsTab h={h} />
          : h.activeTab === 'add-data' ? <AddDataTab h={h} />
          : h.activeTab === 'upload' ? <UploadTab h={h} />
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

function NoAccounts() {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const handleCreate = async () => {
    if (!name.trim()) return; setCreating(true);
    await supabase.from('signal_accounts').insert({ name: name.trim() });
    setName(''); setCreating(false); window.location.reload();
  };
  return (
    <div style={{ padding: 40, textAlign: 'center', color: '#6b6860' }}>
      <p style={{ fontSize: 16, marginBottom: 16 }}>No Signal accounts yet. Create one to get started.</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Account name\u2026" style={{ padding: '6px 10px', fontSize: 13 }} />
        <button className="btn btn-sm" disabled={!name.trim() || creating} onClick={handleCreate}>Create Account</button>
      </div>
    </div>
  );
}


function Dashboard({ h }: { h: ReturnType<typeof useSignal> }) {
  const kpis = h.dashboardKpis;
  const accountName = h.accounts.find(a => a.id === h.activeAccountId)?.name || 'selected account';
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const chartData = useMemo(() => {
    const dateMap: Record<string, { spend: number; orderValue: number }> = {};
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    for (let i = 6; i >= 0; i--) { const d = new Date(Date.now() - i * 86400000); dateMap[d.toISOString().slice(0, 10)] = { spend: 0, orderValue: 0 }; }
    h.metaMetrics.filter(m => m.date >= weekAgo).forEach(m => { if (dateMap[m.date]) dateMap[m.date].spend += m.spend || 0; });
    h.shopifyMetrics.filter(s => s.date >= weekAgo).forEach(s => { if (dateMap[s.date]) dateMap[s.date].orderValue += s.order_value || 0; });
    return Object.keys(dateMap).sort().map(d => ({ date: d + ' ' + dayNames[new Date(d + 'T12:00:00').getDay()], spend: +dateMap[d].spend.toFixed(2), orderValue: +dateMap[d].orderValue.toFixed(2) }));
  }, [h.metaMetrics, h.shopifyMetrics, weekAgo]);

  const activity = useMemo(() => {
    const items: { ts: string; label: string; detail: string }[] = [];
    h.metaMetrics.slice(0, 30).forEach(m => items.push({ ts: m.date, label: 'Meta: ' + (h.ads.find(a => a.id === m.ad_id)?.name || m.ad_id.slice(0,8)), detail: '$' + (m.spend||0).toFixed(0) + ' / ' + (m.purchases||0) + ' pur' }));
    h.shopifyMetrics.slice(0, 20).forEach(s => items.push({ ts: s.date, label: 'Shopify' + (s.ad_id ? ': ' + (h.ads.find(a => a.id === s.ad_id)?.name || s.ad_id.slice(0,8)) : ' (unattr)'), detail: (s.orders||0) + ' orders / $' + (s.order_value||0).toFixed(0) }));
    return items.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 12);
  }, [h.metaMetrics, h.shopifyMetrics, h.ads]);

  return (
    <div>
      <div className="pagehead"><div><h2>Dashboard</h2><p>Aggregated view for {accountName}</p></div></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Spend', val: fmtMoney(kpis.spend) },
          { label: 'Purchases / CPA', val: fmtNum(kpis.purchases) + ' / ' + fmtMoney(kpis.cpa) },
          { label: 'Orders / Value', val: fmtNum(kpis.orders) + ' / ' + fmtMoney(kpis.order_value) },
          { label: 'Blended ROAS', val: kpis.roas ? kpis.roas.toFixed(2) + 'x' : '\u2014' },
          { label: 'CTR', val: kpis.ctr ? kpis.ctr.toFixed(2) + '%' : '\u2014' },
          { label: 'CPM', val: kpis.cpm ? fmtMoney(kpis.cpm) : '\u2014' },
        ].map((k, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <div style={{ fontSize: 11, color: '#6b6860', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1916' }}>{k.val}</div>
          </div>
        ))}
      </div>
      {chartData.length > 1 && (
        <div style={{ background: '#fff', borderRadius: 10, padding: '18px 20px', marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#1a1916' }}>Spend vs Order Value (7 days)</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eae8e3" />
              <XAxis dataKey="date" fontSize={11} tick={{ fill: '#6b6860' }} />
              <YAxis fontSize={11} tick={{ fill: '#6b6860' }} />
              <Tooltip />
              <Line type="monotone" dataKey="spend" stroke="#e76f51" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="orderValue" stroke="#2a9d8f" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ background: '#fff', borderRadius: 10, padding: '14px 18px', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#1a1916' }}>Recent Activity</div>
        {activity.length === 0 && <div style={{ color: '#6b6860', fontSize: 12 }}>No activity yet.</div>}
        {activity.map((a, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid #eee' }}>
            <span style={{ flex: 1, fontSize: 12.5 }}>{a.label}</span>
            <span style={{ fontSize: 11, color: '#6b6860' }}>{a.detail}</span>
            <span style={{ fontSize: 10, color: '#9a9690' }}>{a.ts}</span>
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
  const [tab, setTab] = useState<'campaign' | 'ad'>('campaign');

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

  const openCreateAd = () => {
    const tid = tagFieldId();
    openModal(`<h3>Create Ad</h3>
      <div class="rowset">
        <label class="f">Ad Name <input id="sg-aname" type="text" placeholder="e.g. FB Video Ad 1" /></label>
        <label class="f">Campaign <select id="sg-acamp">${(h.campaigns||[]).map(c => '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('')}</select></label>
        <label class="f">Type Tags ${renderTagBox(tid, [], 'Add type tag\u2026')}</label>
      </div>
      <div class="actions">
        <button onclick="closeModal()">Cancel</button>
        <button id="sg-create-ad-btn" class="btn btn-sm btn-primary">Create</button>
      </div>`);
    setTimeout(() => { wireTagBox(tid, adTypeTags);
      document.getElementById('sg-create-ad-btn')?.addEventListener('click', async () => {
        const name = (document.getElementById('sg-aname') as HTMLInputElement)?.value?.trim(); if (!name) return alert('Name required');
        const campaign_id = (document.getElementById('sg-acamp') as HTMLSelectElement)?.value;
        const tags = readTagBox(tid);
        await supabase.from('signal_ads').insert({ account_id: h.activeAccountId, campaign_id, name, type_tags: tags });
        for (const t of tags) {
          if (!adTypeTags.includes(t)) await supabase.from('signal_tag_master').insert({ account_id: h.activeAccountId, kind: 'ad_type', tag: t }).catch(() => {});
        }
        closeModal(); h.refreshCampaignsAndAds();
      });
    }, 50);
  };

  const openCampaignLog = (c: any) => {
    const updates = (h.campaignUpdates || []).filter(u => u.campaign_id === c.id).sort((a, b) => new Date(b.created_at || b.ts).getTime() - new Date(a.created_at || a.ts).getTime());
    const rows = updates.map(u => ({
      ts: u.created_at || u.ts || '',
      budget: u.budget || null,
      locations: u.locations || null,
      targeting: u.targeting_info || null,
      other: u.other || null,
    }));
    openModal(`<h3>Update Log: ${esc(c.name)}</h3>
      ${rows.length === 0 ? '<p style="color:#6b6860;font-size:12px">No updates recorded.</p>' : rows.map(r => {
        const fields: string[] = [];
        if (r.budget) fields.push('<div><b>Budget</b> ' + esc(r.budget) + '</div>');
        if (r.locations) fields.push('<div><b>Locations</b> ' + esc(r.locations) + '</div>');
        if (r.targeting) fields.push('<div><b>Targeting</b> ' + esc(r.targeting) + '</div>');
        if (r.other) fields.push('<div><b>Notes</b> ' + esc(r.other) + '</div>');
        return '<div class="updrow"><div class="ts">' + (r.ts || '').slice(0,16) + '</div><div class="fields">' + (fields.length ? fields.join('') : '<span style="color:#6b6860">snapshot</span>') + '</div></div>';
      }).join('')}
      <div class="actions"><button onclick="closeModal()">Close</button></div>`);
  };

  const openAdLog = (a: any) => {
    const updates = (h.adUpdates || []).filter(u => u.ad_id === a.id).sort((a, b) => new Date(b.created_at || b.ts).getTime() - new Date(a.created_at || a.ts).getTime());
    const rows = updates.map(u => ({
      ts: u.created_at || u.ts || '',
      creative: u.creative_settings || null,
      other: u.other || null,
    }));
    openModal(`<h3>Update Log: ${esc(a.name)}</h3>
      ${rows.length === 0 ? '<p style="color:#6b6860;font-size:12px">No updates recorded.</p>' : rows.map(r => {
        const fields: string[] = [];
        if (r.creative) fields.push('<div><b>Creative</b> ' + esc(r.creative) + '</div>');
        if (r.other) fields.push('<div><b>Notes</b> ' + esc(r.other) + '</div>');
        return '<div class="updrow"><div class="ts">' + (r.ts || '').slice(0,16) + '</div><div class="fields">' + (fields.length ? fields.join('') : '<span style="color:#6b6860">snapshot</span>') + '</div></div>';
      }).join('')}
      <div class="actions"><button onclick="closeModal()">Close</button></div>`);
  };

  return (
    <div>
      <div className="pagehead">
        <div><h2>Campaigns & Ads</h2><p>Manage campaigns, ads, and their metadata</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sm" onClick={openCreateCampaign}>+ Campaign</button>
          <button className="btn btn-sm btn-primary" onClick={openCreateAd}>+ Ad</button>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4, background: '#eef1ef', borderRadius: 8, padding: 3, width: 'fit-content', marginBottom: 16 }}>
          <button onClick={() => setTab('campaign')} style={{ all: 'unset', cursor: 'pointer', padding: '6px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: tab === 'campaign' ? 600 : 400, background: tab === 'campaign' ? '#fff' : 'transparent', color: tab === 'campaign' ? '#1a1916' : '#6b6860' }}>Campaigns</button>
          <button onClick={() => setTab('ad')} style={{ all: 'unset', cursor: 'pointer', padding: '6px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: tab === 'ad' ? 600 : 400, background: tab === 'ad' ? '#fff' : 'transparent', color: tab === 'ad' ? '#1a1916' : '#6b6860' }}>Ads</button>
        </div>
        {(h.campaigns || []).map(c => {
          const isOpen = expanded === c.id;
          const campAds = (h.ads || []).filter(a => a.campaign_id === c.id);
          return (
            <div key={c.id} style={{ background: '#fff', borderRadius: 10, marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
              <div onClick={() => setExpanded(isOpen ? null : c.id)}
                style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 14, color: '#6b6860', transition: 'transform .15s', transform: isOpen ? 'rotate(90deg)' : '' }}>{'\u25B6'}</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>{c.name}</span>
                {(c.goal_tags || []).length > 0 && <span style={{ fontSize: 10.5, color: '#2d6a4f', background: '#d8f3dc', padding: '2px 8px', borderRadius: 12 }}>{c.goal_tags.join(', ')}</span>}
                <span style={{ fontSize: 11, color: '#6b6860' }}>{campAds.length} ad{campAds.length !== 1 ? 's' : ''}</span>
                <button className="btn btn-sm" style={{ background: 'transparent' }} onClick={(e) => { e.stopPropagation(); openCampaignLog(c); }}>Log</button>
                <button style={{ all: 'unset', cursor: 'pointer', fontSize: 14, color: '#c55a4a', opacity: .7 }}
                  onClick={(e) => { e.stopPropagation(); handleDeleteCampaign(c.id); }}>{'\u2715'}</button>
              </div>
              {isOpen && (
                <div style={{ borderTop: '1px solid #eef1ef', padding: '8px 16px 14px' }}>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <button className="btn btn-sm btn-outline" onClick={() => {
                      const gid = tagFieldId();
                      openModal(`<h3>Edit Campaign: ${esc(c.name)}</h3>
                        <div class="rowset">
                          <label class="f">Name <input id="sg-ecname" type="text" value="${esc(c.name)}" /></label>
                          <label class="f">Goal Tags ${renderTagBox(gid, c.goal_tags||[], 'Add goal tag\u2026')}</label>
                          <label class="f">Budget <input id="sg-ecbudget" type="text" placeholder="Enter budget value" /></label>
                          <label class="f">Locations <input id="sg-ecloc" type="text" placeholder="e.g. US, CA, UK" /></label>
                          <label class="f">Targeting Info <input id="sg-ectarget" type="text" placeholder="e.g. age 25-45, interest: sports" /></label>
                          <label class="f">Update Notes <textarea id="sg-ecnotes" rows="2" placeholder="Why this change?"></textarea></label>
                        </div>
                        <div class="actions">
                          <button onclick="closeModal()">Cancel</button>
                          <button id="sg-edit-camp-btn" class="btn btn-sm btn-primary">Save Update</button>
                        </div>`);
                      setTimeout(() => { wireTagBox(gid, goalTags);
                        document.getElementById('sg-edit-camp-btn')?.addEventListener('click', async () => {
                          const name = (document.getElementById('sg-ecname') as HTMLInputElement)?.value?.trim(); if (!name) return alert('Name required');
                          const goal_tags = readTagBox(gid);
                          const budget = (document.getElementById('sg-ecbudget') as HTMLInputElement)?.value?.trim() || null;
                          const locations = (document.getElementById('sg-ecloc') as HTMLInputElement)?.value?.trim() || null;
                          const targeting = (document.getElementById('sg-ectarget') as HTMLInputElement)?.value?.trim() || null;
                          const notes = (document.getElementById('sg-ecnotes') as HTMLTextAreaElement)?.value?.trim() || null;
                          const patch: Record<string, any> = {};
                          if (c.name !== name) patch.name = name;
                          if (JSON.stringify((c.goal_tags || []).sort()) !== JSON.stringify((goal_tags || []).sort())) patch.goal_tags = goal_tags;
                          if (Object.keys(patch).length > 0) {
                            await supabase.from('signal_campaigns').update(patch).eq('id', c.id);
                          }
                          const hasUpdateFields = budget || locations || targeting || notes;
                          if (hasUpdateFields) {
                            const upd: Record<string, any> = { campaign_id: c.id };
                            if (budget) upd.budget = budget;
                            if (locations) upd.locations = locations;
                            if (targeting) upd.targeting_info = targeting;
                            if (notes) upd.other = notes;
                            await supabase.from('signal_campaign_updates').insert(upd);
                          }
                          closeModal(); h.refreshCampaignsAndAds();
                        });
                      }, 50);
                    }}>Edit</button>
                  </div>
                  {campAds.length === 0 && <div style={{ color: '#6b6860', fontSize: 12, padding: '8px 0' }}>No ads in this campaign.</div>}
                  {campAds.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', marginBottom: 4, background: '#fafaf8', borderRadius: 7, gap: 8 }}>
                      <span style={{ fontSize: 12.5, flex: 1 }}>{a.name || '(unnamed ad)'}</span>
                      {(a.type_tags || []).length > 0 && <span style={{ fontSize: 10.5, color: '#3843a6', background: '#e3e8ff', padding: '1px 8px', borderRadius: 10 }}>{a.type_tags.join(', ')}</span>}
                      <button className="btn btn-sm" style={{ background: 'transparent' }} onClick={() => openAdLog(a)}>Log</button>
                      <button className="btn btn-sm" style={{ background: 'transparent' }} onClick={() => {
                        const tid = tagFieldId();
                        openModal(`<h3>Edit Ad: ${esc(a.name)}</h3>
                          <div class="rowset">
                            <label class="f">Name <input id="sg-eaname" type="text" value="${esc(a.name)}" /></label>
                            <label class="f">Type Tags ${renderTagBox(tid, a.type_tags||[], 'Add type tag\u2026')}</label>
                            <label class="f">Creative Settings <input id="sg-eacreative" type="text" placeholder="e.g. video, 15s, landscape" /></label>
                            <label class="f">Update Notes <textarea id="sg-eanotes" rows="2" placeholder="Why this change?"></textarea></label>
                          </div>
                          <div class="actions">
                            <button onclick="closeModal()">Cancel</button>
                            <button id="sg-edit-ad-btn" class="btn btn-sm btn-primary">Save Update</button>
                          </div>`);
                        setTimeout(() => { wireTagBox(tid, adTypeTags);
                          document.getElementById('sg-edit-ad-btn')?.addEventListener('click', async () => {
                            const name = (document.getElementById('sg-eaname') as HTMLInputElement)?.value?.trim(); if (!name) return alert('Name required');
                            const type_tags = readTagBox(tid);
                            const creative = (document.getElementById('sg-eacreative') as HTMLInputElement)?.value?.trim() || null;
                            const notes = (document.getElementById('sg-eanotes') as HTMLTextAreaElement)?.value?.trim() || null;
                            const patch: Record<string, any> = {};
                            if (a.name !== name) patch.name = name;
                            if (JSON.stringify((a.type_tags || []).sort()) !== JSON.stringify((type_tags || []).sort())) patch.type_tags = type_tags;
                            if (Object.keys(patch).length > 0) {
                              await supabase.from('signal_ads').update(patch).eq('id', a.id);
                            }
                            const hasUpdateFields = creative || notes;
                            if (hasUpdateFields) {
                              const upd: Record<string, any> = { ad_id: a.id };
                              if (creative) upd.creative_settings = creative;
                              if (notes) upd.other = notes;
                              await supabase.from('signal_ad_updates').insert(upd);
                            }
                            closeModal(); h.refreshCampaignsAndAds();
                          });
                        }, 50);
                      }}>Edit</button>
                      <button style={{ all: 'unset', cursor: 'pointer', fontSize: 14, color: '#c55a4a', opacity: .7 }}
                        onClick={() => handleDeleteAd(a.id)}>{'\u2715'}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


function AddDataTab({ h }: { h: ReturnType<typeof useSignal> }) {
  const [date, setDate] = useState(todayInput());
  const [campaignId, setCampaignId] = useState('');
  const [adId, setAdId] = useState('');
  const [spend, setSpend] = useState('');
  const [impressions, setImpressions] = useState('');
  const [clicks, setClicks] = useState('');
  const [purchases, setPurchases] = useState('');
  const [orders, setOrders] = useState('');
  const [orderValue, setOrderValue] = useState('');
  const [saving, setSaving] = useState(false);

  const adOptions = useMemo(() => (h.ads || []).filter(a => !campaignId || a.campaign_id === campaignId), [h.ads, campaignId]);

  const handleSave = async () => {
    if (!adId) { alert('Select an ad'); return; }
    setSaving(true);
    await Promise.all([
      supabase.from('signal_meta_metrics').upsert({
        account_id: h.activeAccountId, ad_id: adId, date,
        spend: parseFloat(spend) || 0, impressions: parseInt(impressions) || 0,
        clicks: parseInt(clicks) || 0, purchases: parseInt(purchases) || 0,
        results: 0, reach: 0, landing_page_views: 0, add_to_cart: 0, frequency: 0,
      }, { onConflict: 'ad_id,date' }),
      supabase.from('signal_shopify_metrics').upsert({
        account_id: h.activeAccountId, ad_id: adId, date,
        sessions: 0, orders: parseInt(orders) || 0, order_value: parseFloat(orderValue) || 0,
      }, { onConflict: 'account_id,date,ad_id' }),
    ]);
    setSaving(false); h.refreshMetrics();
    setSpend(''); setImpressions(''); setClicks(''); setPurchases('');
    setOrders(''); setOrderValue('');
    alert('Metrics saved');
  };

  return (
    <div>
      <div className="pagehead"><div><h2>Add Data</h2><p>Manually enter ad performance metrics</p></div></div>
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, maxWidth: 500, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="f">Date <input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
          <label className="f">Campaign <select value={campaignId} onChange={e => { setCampaignId(e.target.value); setAdId(''); }}>
            <option value="">All campaigns</option>
            {(h.campaigns||[]).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
          <label className="f">Ad <select value={adId} onChange={e => setAdId(e.target.value)}>
            <option value="">Select an ad</option>
            {adOptions.map(a => <option key={a.id} value={a.id}>{a.name || a.id?.slice(0,8)}</option>)}
          </select></label>
          <div style={{ borderTop: '1px solid #eef1ef', margin: '4px 0' }} />
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#6b6860' }}>Meta Metrics</div>
          <label className="f">Spend ($) <input type="number" step="0.01" min="0" value={spend} onChange={e => setSpend(e.target.value)} /></label>
          <label className="f">Impressions <input type="number" min="0" value={impressions} onChange={e => setImpressions(e.target.value)} /></label>
          <label className="f">Clicks <input type="number" min="0" value={clicks} onChange={e => setClicks(e.target.value)} /></label>
          <label className="f">Purchases <input type="number" min="0" value={purchases} onChange={e => setPurchases(e.target.value)} /></label>
          <div style={{ borderTop: '1px solid #eef1ef', margin: '4px 0' }} />
          <div style={{ fontSize: 11.5, fontWeight: 600, color: '#6b6860' }}>Shopify Metrics</div>
          <label className="f">Orders <input type="number" min="0" value={orders} onChange={e => setOrders(e.target.value)} /></label>
          <label className="f">Order Value ($) <input type="number" step="0.01" min="0" value={orderValue} onChange={e => setOrderValue(e.target.value)} /></label>
          <button className="btn btn-sm btn-primary" disabled={saving || !adId} onClick={handleSave}>Save Metrics</button>
          <p style={{ fontSize: 11, color: '#9a9690', margin: 0 }}>Uses upsert: existing data for this ad+date will be merged.</p>
        </div>
      </div>
    </div>
  );
}


function UploadTab({ h }: { h: ReturnType<typeof useSignal> }) {
  const [source, setSource] = useState<Source>('meta');
  const [step, setStep] = useState<'select' | 'mapping' | 'preview' | 'done'>('select');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [resolutionLog, setResolutionLog] = useState<string[]>([]);
  const [completing, setCompleting] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '', header: 1 }) as any;
    if (!json.length) return alert('Empty file');
    const hdr = json[0].map((c: any) => String(c).trim()) as string[];
    const data = json.slice(1).slice(0, 101) as string[][];
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
    if (headers.length > 0) {
      setMapping(autoDetectMapping(source, headers));
    }
  }, [source]);

  const handleApply = () => {
    const mapped = applyMapping(source, rawRows as ParsedRow[], mapping);
    const valid = mapped.filter(r => r.ad_name && String(r.ad_name).trim());
    if (!valid.length) return alert('No rows with valid ad names after mapping.');
    setRows(valid);
    setStep('preview');
  };

  const handleCommit = async () => {
    setCompleting(true);
    const existing: { id: string; name: string; campaign_id: string; campaign_name: string }[] = (h.ads || []).map(a => {
      const c = (h.campaigns || []).find(c => c.id === a.campaign_id);
      return { id: a.id, name: a.name, campaign_id: a.campaign_id, campaign_name: c?.name || '' };
    });
    const resolutions = buildResolutions(rows, existing, source !== 'meta');
    const log: string[] = [];
    try {
      const adIdByName = await commitResolutions(h.activeAccountId, resolutions);
      await upsertMetrics(source, h.activeAccountId, rows, adIdByName);
      log.push('Committed ' + rows.length + ' rows to ' + source + ' metrics');
      setResolutionLog(log);
      h.refreshMetrics();
      setStep('done');
    } catch (err: any) {
      log.push('Error: ' + (err?.message || 'Unknown'));
      setResolutionLog(log);
    }
    setCompleting(false);
  };

  const renderCell = (val: unknown) => esc(val != null ? String(val) : '').substring(0, 60) || '\u00A0';

  return (
    <div>
      <div className="pagehead"><div><h2>Upload File</h2><p>Import CSV or Excel ad metrics</p></div></div>
      {step === 'select' && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 30, textAlign: 'center', border: '2px dashed #d2cec7' }}>
          <p style={{ margin: '0 0 14px', fontSize: 14, color: '#1a1916' }}>Upload a CSV or Excel file (.xlsx, .xls)</p>
          <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'center', gap: 8 }}>
            {(['meta', 'shopify', 'payment'] as Source[]).map(s => (
              <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5 }}>
                <input type="radio" name="source" checked={source === s} onChange={() => setSource(s)} />
                {s === 'meta' ? 'Meta Ads' : s === 'shopify' ? 'Shopify' : 'Payments'}
              </label>
            ))}
          </div>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} key={source} />
        </div>
      )}
      {step === 'mapping' && (
        <div>
          <p style={{ fontSize: 12.5, color: '#6b6860', marginBottom: 12 }}>Map columns from <b>{esc(fileName)}</b> to <b>{source}</b> fields</p>
          <div style={{ background: '#fff', borderRadius: 10, padding: 16, overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <table className="grid-entry">
              <thead><tr>{headers.map(h => <th key={h} style={{ textAlign: 'left', padding: 6, fontSize: 12 }}>{esc(h)}</th>)}</tr></thead>
              <tbody>
                {rawRows.slice(0, 5).map((r, i) => (
                  <tr key={i}>{headers.map(h => <td key={h} style={{ fontSize: 11.5 }}>{renderCell(r[h])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ background: '#fff', borderRadius: 10, padding: 16, marginTop: 12, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Column Mapping</span>
              <select value={source} onChange={e => setSource(e.target.value as Source)} style={{ fontSize: 12, padding: '4px 8px' }}>
                <option value="meta">Meta Ads</option>
                <option value="shopify">Shopify</option>
                <option value="payment">Payments</option>
              </select>
            </div>
            {FIELDS[source].map(f => {
              const matchedHeader = Object.entries(mapping).find(([k]) => k === f.key)?.[1];
              return (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, fontSize: 12.5 }}>
                  <span style={{ minWidth: 120, fontWeight: 500 }}>{esc(f.label)}{f.required ? ' *' : ''}</span>
                  <span style={{ color: '#9a9690' }}>{'\u2192'}</span>
                  <select value={matchedHeader || ''}
                    onChange={e => setMapping(prev => ({ ...prev, [f.key]: e.target.value }))}
                    style={{ flex: 1, maxWidth: 250 }}>
                    <option value="">\u2014 Skip \u2014</option>
                    {headers.map(h => <option key={h} value={h} selected={matchedHeader === h}>{esc(h)}</option>)}
                  </select>
                  <span className={'matchbadge ' + (matchedHeader ? 'ok' : 'no')}>
                    {matchedHeader ? 'mapped' : 'missing'}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setStep('select')}>Back</button>
            <button className="btn btn-sm btn-primary" onClick={handleApply}>Apply Mapping & Preview</button>
          </div>
        </div>
      )}
      {step === 'preview' && (
        <div>
          <p style={{ fontSize: 12.5, color: '#6b6860', marginBottom: 12 }}>Preview ({rows.length} rows) \u2014 ready to commit as <b>{source}</b></p>
          <div className="tablewrap">
            <table className="datatable" style={{ fontSize: 11.5 }}>
              <thead><tr>{FIELDS[source].filter(f => mapping[f.key]).map(f => <th key={f.key}>{esc(f.label)}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>{FIELDS[source].filter(f => mapping[f.key]).map(f => <td key={f.key}>{renderCell(r[f.key])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setStep('mapping')}>Back</button>
            <button className="btn btn-sm btn-primary" disabled={completing} onClick={handleCommit}>{completing ? 'Committing\u2026' : 'Commit to Database'}</button>
          </div>
        </div>
      )}
      {step === 'done' && (
        <div>
          <div style={{ background: '#e5f5ec', borderRadius: 10, padding: 20, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 600, color: '#2d6a4f', margin: '0 0 6px' }}>{'\u2713'} Import Complete</p>
            <p style={{ fontSize: 12.5, color: '#1a1916' }}>{rows.length} rows committed from <b>{esc(fileName)}</b> as <b>{source}</b></p>
          </div>
          {resolutionLog.length > 0 && (
            <div style={{ background: '#fff', borderRadius: 10, padding: 14, marginTop: 12, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Log</div>
              {resolutionLog.map((l, i) => <div key={i} style={{ fontSize: 11.5, color: '#6b6860', padding: '2px 0' }}>{l}</div>)}
            </div>
          )}
          <div style={{ marginTop: 14 }}><button className="btn btn-sm" onClick={() => { setStep('select'); setFileName(''); setRawRows([]); setRows([]); setHeaders([]); setMapping({}); setResolutionLog([]); }}>Import Another File</button></div>
        </div>
      )}
    </div>
  );
}


function AnalyticsTab({ h }: { h: ReturnType<typeof useSignal> }) {
  const [sortCol, setSortCol] = useState<string>('spend');
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCols, setShowCols] = useState<Record<string, boolean>>({
    name: true, campaignName: true, spend: true, impressions: true, clicks: true,
    ctr: true, purchases: true, cpa: true, orders: true, order_value: true, roas: true,
  });

  const COLUMNS: { key: string; label: string }[] = [
    { key: 'name', label: 'Ad' },
    { key: 'campaignName', label: 'Campaign' },
    { key: 'spend', label: 'Spend' },
    { key: 'impressions', label: 'Impressions' },
    { key: 'clicks', label: 'Clicks' },
    { key: 'ctr', label: 'CTR' },
    { key: 'purchases', label: 'Purchases' },
    { key: 'cpa', label: 'CPA' },
    { key: 'orders', label: 'Orders' },
    { key: 'order_value', label: 'Order Value' },
    { key: 'roas', label: 'ROAS' },
    { key: 'cpm', label: 'CPM' },
    { key: 'sessions', label: 'Sessions' },
    { key: 'frequency', label: 'Freq' },
    { key: 'convPct', label: 'Conv %' },
  ];

  const displayCols = COLUMNS.filter(c => showCols[c.key] !== false);

  const sorted = useMemo(() => {
    const arr = [...h.analyticsRows];
    const top3: number[] = []; const bot3: number[] = [];
    const vals = arr.map((r, i) => ({ i, v: (r as any)[sortCol] ?? 0 }));
    vals.sort((a, b) => b.v - a.v);
    vals.slice(0, 3).forEach(v => top3.push(v.i));
    vals.slice(-3).forEach(v => bot3.push(v.i));
    arr.sort((a, b) => sortDir * ((((a as any)[sortCol] ?? 0) as number) - (((b as any)[sortCol] ?? 0) as number)));
    return { arr, top3, bot3 };
  }, [h.analyticsRows, sortCol, sortDir]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === -1 ? 1 : -1);
    else { setSortCol(col); setSortDir(-1); }
  };

  const fmtVal = (v: number, key: string) => {
    if (key === 'ctr' || key === 'convPct') return (v * 100).toFixed(2) + '%';
    if (key === 'cpa' || key === 'spend' || key === 'order_value' || key === 'cpm') return fmtMoney(v);
    if (key === 'roas') return v.toFixed(2) + 'x';
    return fmtNum(v);
  };

  return (
    <div>
      <div className="pagehead">
        <div><h2>Analytics</h2><p>Aggregated performance metrics with derived formulas</p></div>
        <div style={{ position: 'relative', display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative' }}>
            <button className="btn btn-sm" onClick={() => setMenuOpen(!menuOpen)}>Columns</button>
            {menuOpen && <div className="colmenu" style={{ right: 0, top: '100%', marginTop: 4 }} onClick={() => setMenuOpen(false)}>
              {COLUMNS.map(c => <label key={c.key}><input type="checkbox" checked={showCols[c.key] !== false} onChange={e => setShowCols(prev => ({ ...prev, [c.key]: e.target.checked }))} />{c.label}</label>)}
            </div>}
          </div>
        </div>
      </div>
      {h.analyticsRows.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 10, padding: 30, textAlign: 'center', color: '#6b6860', fontSize: 13 }}>
          No analytics data yet. Import or add data to see metrics.
        </div>
      ) : (
        <div className="tablewrap">
          <table className="datatable">
            <thead>
              <tr>{displayCols.map(c => (
                <th key={c.key} onClick={() => { if (c.key !== 'name' && c.key !== 'campaignName') handleSort(c.key); }}
                  style={{ cursor: c.key !== 'name' && c.key !== 'campaignName' ? 'pointer' : 'default' }}>
                  {c.label}{sortCol === c.key ? (sortDir === -1 ? '\u25BC' : '\u25B2') : ''}
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
    </div>
  );
}


function SettingsTab({ h }: { h: ReturnType<typeof useSignal> }) {
  const activeAccount = h.accounts.find(a => a.id === h.activeAccountId);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (activeAccount) setEditName(activeAccount.name || '');
  }, [activeAccount]);

  const handleSave = async () => {
    if (!editName.trim()) return;
    setSaving(true);
    await supabase.from('signal_accounts').update({ name: editName.trim() }).eq('id', h.activeAccountId);
    setSaving(false);
    h.refreshAccounts();
    alert('Account updated');
  };

  const handleSetDefault = async () => {
    await supabase.from('signal_accounts').update({ is_default: true }).eq('id', h.activeAccountId);
    await supabase.from('signal_accounts').update({ is_default: false }).neq('id', h.activeAccountId);
    h.refreshAccounts();
  };

  return (
    <div>
      <div className="pagehead"><div><h2>Settings</h2><p>Account configuration</p></div></div>
      <div style={{ background: '#fff', borderRadius: 10, padding: 20, maxWidth: 500, boxShadow: '0 1px 3px rgba(0,0,0,.04)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label className="f">Account Name <input type="text" value={editName} onChange={e => setEditName(e.target.value)} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-primary" disabled={saving || !editName.trim()} onClick={handleSave}>Save</button>
            {!activeAccount?.is_default && <button className="btn btn-sm btn-outline" onClick={handleSetDefault}>Set as Default</button>}
          </div>
        </div>
        <hr style={{ border: 'none', borderTop: '1px solid #eef1ef', margin: '20px 0' }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: '#c55a4a' }}>Danger Zone</div>
          <button className="btn btn-sm" style={{ border: '1px solid #f6c9c1', color: '#c55a4a' }}
            onClick={async () => {
              if (!confirm('Delete account and ALL its data?')) return;
              if (!confirm('This cannot be undone. Continue?')) return;
              await supabase.from('signal_accounts').delete().eq('id', h.activeAccountId);
              window.location.reload();
            }}>Delete Account & All Data</button>
        </div>
      </div>
    </div>
  );
}

