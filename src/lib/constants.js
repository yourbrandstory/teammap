// Ported verbatim from TeamMap.html — same constants, same colors, same helpers.
export const COLORS = ['#2d6a4f','#2196c4','#7c3aed','#d97706','#e76f51','#0f7c6c','#be185d','#1d4ed8','#059669','#9333ea'];
export const DAYS = ['M','T','W','T','F','S','S'];
export const CATS = ['Strategy','Operations','Support','Creative','Technical','Finance','Comms'];
export const PRIOS = ['Critical','High','Medium','Low'];
export const PC = { Critical:'#e76f51', High:'#d97706', Medium:'#2d6a4f', Low:'#2196c4' };
export const PB = { Critical:'#fde8e2', High:'#fef3c7', Medium:'#d8f3dc', Low:'#e3f2fd' };
export const CC = { Strategy:'#7c3aed', Operations:'#2196c4', Support:'#2d6a4f', Creative:'#e76f51', Technical:'#0f7c6c', Finance:'#d97706', Comms:'#be185d' };
export const MOOD_ORDER = ['top','hero','imp','creative','rapid','share','secondhalf','followup'];

export const DMOODS = [
  { id:'top', label:'Top', icon:'🔴', color:'#dc2626', bg:'#fee2e2', desc:'Urgent, do first', max:null, hidden:false, cardSize:'narrow' },
  { id:'hero', label:'Hero', icon:'⚡', color:'#c9920a', bg:'#fffbeb', desc:'High impact, max 2/day', max:2, hidden:false, cardSize:'big' },
  { id:'imp', label:'Imp', icon:'⭐', color:'#7c3aed', bg:'#ede9fe', desc:'Important, max 3/day', max:3, hidden:false, cardSize:'big' },
  { id:'creative', label:'Creative', icon:'🎨', color:'#be185d', bg:'#fce7f3', desc:'Creative work', max:null, hidden:false, cardSize:'mid' },
  { id:'rapid', label:'Rapid', icon:'💨', color:'#0f7c6c', bg:'#d1fae5', desc:'Quick tasks', max:null, hidden:true, cardSize:'narrow' },
  { id:'share', label:'Share', icon:'🔗', color:'#2196c4', bg:'#e3f2fd', desc:'To share/handoff', max:null, hidden:true, cardSize:'narrow' },
  { id:'secondhalf', label:'Second Half', icon:'🌤️', color:'#d97706', bg:'#fef3c7', desc:'Second half of the day', max:null, hidden:true, cardSize:'narrow' },
  { id:'followup', label:'Follow Up', icon:'📞', color:'#1d4ed8', bg:'#dbeafe', desc:'Tasks needing follow-up', max:null, hidden:true, cardSize:'narrow' },
];

export const NAV_ICONS = { tkd:'📊', tg2:'💡', lu:'📋', lv:'☷', tk:'☰', ms:'◆', sc:'🗓️', td:'▣', bl:'◯', pg:'◢', kb:'📌', st:'⚙', dl:'📤' };

export const DEFAULT_NAV_ORDER = ['tkd','tg2','lu','lv','tk','ms','sc','dl','td','bl','pg','st'];
export const DEFAULT_NAV_LABELS = {
  tkd:'Task Dashboard', tg2:'Task Gen 2.0', lu:'Line Up', lv:'List View',
  tk:'Tasks & Milestones', ms:'Milestones', sc:'SM Calendar', dl:'Delegated', td:'Team Dashboard', bl:'Builder',
  pg:'Playground', st:'Settings'
};

// ── SM Calendar pastel mood palette (separate from DMOODS colours) ─────────
export const MOOD_PASTEL = {
  top:        { bg:'#E6F1FB', text:'#0C447C' },
  hero:       { bg:'#EAF3DE', text:'#27500A' },
  imp:        { bg:'#FAEEDA', text:'#633806' },
  creative:   { bg:'#FBEAF0', text:'#72243E' },
  rapid:      { bg:'#E1F5EE', text:'#085041' },
  share:      { bg:'#EEEDFE', text:'#26215C' },
  secondhalf: { bg:'#FAECE7', text:'#4A1B0C' },
  followup:   { bg:'#F1EFE8', text:'#2C2C2A' },
};

// ── pure helpers (ported) ───────────────────────────────────────────────────
export const today = () => new Date().toISOString().slice(0,10);
export const fmtD = (d) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '';
export const uid = () => 'x'+(Date.now()+Math.random()).toString(36).replace('.','');
export const ini = (n) => (n||'').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
export const fmtTime = (h,m) => { if(!h&&!m) return ''; const p=[]; if(h)p.push(h+'h'); if(m)p.push(m+'m'); return p.join(' '); };
export const taskTimeStr = (t) => fmtTime(t.estH||0, t.estM||0);

export const DEFAULT_SERVICE_CATEGORIES = [
  { id:'sc_perf',    label:'Performance', color:'#2d6a4f' },
  { id:'sc_social',  label:'Social',      color:'#2196c4' },
  { id:'sc_website', label:'Website',     color:'#7c3aed' },
  { id:'sc_seo',     label:'SEO',         color:'#d97706' },
  { id:'sc_other',   label:'Other',       color:'#e76f51' },
];

export const DEFAULT_TASK_STATUSES = ['Not Started','Stand Up','WIP','Complete','Pass'];

export const STATUS_TEXT_COLORS = ['#a09d97','#e76f51','#2196c4','#2d6a4f','#7c3aed','#d97706','#be185d','#0f7c6c','#1d4ed8','#059669'];
export const STATUS_BG_COLORS = ['#f2f0ec','#fde8e2','#e3f2fd','#d8f3dc','#ede9fe','#fef3c7','#fce7f3','#d1fae5','#dbeafe','#d1fae5'];

// ── Deadline helpers ────────────────────────────────────────
export const getDeadlineClass = (deadline) => {
  if (!deadline) return 'normal';
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(deadline+'T00:00:00');
  const diff = Math.round((d - now) / (1000*60*60*24));
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'overdue';
  if (diff <= 3) return 'soon';
  if (diff <= 7) return 'ok';
  return 'normal';
};
export const getDeadlineLabel = (deadline) => {
  if (!deadline) return '';
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(deadline+'T00:00:00');
  const diff = Math.round((d - now) / (1000*60*60*24));
  if (diff < 0) return `Overdue by ${Math.abs(diff)}d`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  return `Deadline ${d.toLocaleDateString('en-IN',{day:'numeric',month:'short'})}`;
};
export const getDeadlineStatus = (deadline) => {
  if (!deadline) return null;
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(deadline+'T00:00:00'); d.setHours(0,0,0,0);
  const diff = Math.round((d - now) / (1000*60*60*24));
  if (diff < 0) return { type:'overdue', label:`${Math.abs(diff)}d overdue`, days:diff };
  if (diff === 0) return { type:'today', label:'Due today', days:0 };
  if (diff <= 7) return { type:'soon', label:`${diff}d left`, days:diff };
  return null;
};
