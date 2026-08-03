// DB verification for the Milestone save-path fix.
// Replicates the EXACT payload the modal's doSave builds + the EXACT
// upsertMilestone() store logic (with the fixed column-strip parsing),
// then verifies each edited field at the DB level (simulating hard reload).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const getEnv = (k) => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '';
const SUPABASE_URL = getEnv('VITE_SUPABASE_URL');
const SUPABASE_KEY = getEnv('VITE_SUPABASE_ANON_KEY');

const H = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY, 'Content-Type': 'application/json' };

async function rest(method, path2, body) {
  const res = await fetch(SUPABASE_URL + path2, {
    method,
    headers: { ...H, Prefer: 'return=representation,resolution=merge-duplicates' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + JSON.stringify(data));
  return data;
}

// ---- replicate sanitizeSubsteps / msToRow from useStore.js ----
const sanitizeSubsteps = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.filter(Boolean).map(ss => {
    if (typeof ss !== 'object') return null;
    const clean = { ...ss, id: ss.id || null, done: !!ss.done, title: ss.title || '', linkedTasks: Array.isArray(ss.linkedTasks) ? ss.linkedTasks.filter(Boolean).map(lt => (lt && typeof lt === 'object') ? { taskId: lt.taskId || null, showOnDashboard: !!lt.showOnDashboard } : null).filter(Boolean) : [] };
    return clean.id ? clean : null;
  }).filter(Boolean);
};
const msToRow = (m) => ({ id:m.id, name:m.title||m.name||'', title:m.title||'', mood:m.mood||'', assigned_to:m.assignedTo||[], client_id:m.clientId||null, date:m.date||'', deadline:m.deadline||null, substeps:m.substeps||[], display_mode:m.displayMode||'daily', display_days:m.displayDays||[], deleted:!!m.deleted, notes:m.notes||'', description:m.description||'', color:m.mood||m.color||'', created_at:m.createdAt||Date.now(), updated_at:m.updatedAt||Date.now(), label_id:m.labelId||'milestone' });

// ---- replicate FIXED column detection ----
const extractBadColumn = (msg) => {
  if (!msg || typeof msg !== 'string') return null;
  let m = msg.match(/Could not find the ['"]([^'"]+)['"] column/);
  if (m) return m[1];
  m = msg.match(/column\s+["']?([A-Za-z_][A-Za-z0-9_.]*)["']?\s+/);
  if (m) { const name = m[1]; const i = name.lastIndexOf('.'); return i >= 0 ? name.slice(i + 1) : name; }
  return null;
};
const isColumnError = (err) => {
  const msg = err?.message || '';
  return err?.code === '42703' || err?.code === 'PGRST204'
    || /column\s+.*\bdoes not exist/i.test(msg)
    || /Could not find the .* column of .* in the schema cache/i.test(msg);
};

// ---- replicate upsertMilestone (with fix) ----
async function upsertMilestone(m) {
  const now = Date.now();
  if (!m.id) {
    m = { substeps:[], displayMode:'daily', displayDays:[], deleted:false, ...m, id: m.id || ('test-' + Math.random().toString(36).slice(2, 10)), createdAt:now, updatedAt:now };
  } else {
    m = { ...m, updatedAt:now };
  }
  m = { ...m, substeps: sanitizeSubsteps(m.substeps || []) };
  let row = msToRow(m);
  let error = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await rest('POST', '/rest/v1/milestones?select=*', row);
    // emulate supabase-js: errors throw with .code/.message; success returns data
    error = null;
    const saved = Array.isArray(result) ? result[0] : result;
    if (!error) {
      if (attempt > 0) {
        await rest('PATCH', '/rest/v1/milestones?id=eq.' + m.id, { description: JSON.stringify({ substeps: m.substeps || [] }) });
      }
      const savedSubsteps = saved?.substeps;
      const sentSubsteps = m.substeps || [];
      if (savedSubsteps && JSON.stringify(savedSubsteps) !== JSON.stringify(sentSubsteps)) {
        await rest('PATCH', '/rest/v1/milestones?id=eq.' + m.id, { substeps: sentSubsteps, updated_at: now });
      }
      return saved;
    }
    if (!isColumnError(error)) throw error;
    const badCol = extractBadColumn(error.message);
    if (!badCol || row[badCol] === undefined) throw error;
    const { [badCol]: _, ...cleanedRow } = row;
    row = cleanedRow;
  }
  throw error || new Error('unknown');
}

async function main() {
  const title = 'DB-VERIFY-' + Date.now();
  // 1. create milestone exactly like the modal would (new milestone)
  const created = await upsertMilestone({
    title, mood: '', assignedTo: ['xmqg0g3te87'], clientId: 'idmom03dfd73',
    date: '2026-07-01', deadline: '', substeps: [], displayMode: 'daily', displayDays: [],
    notes: '', labelId: 'milestone',
  });
  const id = created.id;
  console.log('CREATED milestone id=' + id + ' title=' + title);
  console.log('  DB after create: mood=' + JSON.stringify(created.mood) + ' deadline=' + JSON.stringify(created.deadline) + ' display_mode=' + created.display_mode + ' display_days=' + JSON.stringify(created.display_days));

  // simulate the modal's local milestone object after load (msFromRow shape)
  let m = {
    id, title, mood: '', assignedTo: ['xmqg0g3te87'], clientId: 'idmom03dfd73',
    date: '2026-07-01', deadline: '', substeps: [], displayMode: 'daily', displayDays: [],
    notes: '', labelId: 'milestone',
  };

  // 2. MOOD edit (direct saveNow path)
  m = { ...m, mood: 'hero' };
  const afterMood = await upsertMilestone(m);
  console.log('\nMOOD EDIT -> mood set to "hero"');
  console.log('  DB after save: mood=' + JSON.stringify(afterMood.mood) + ' color=' + JSON.stringify(afterMood.color));
  const reload1 = await rest('GET', '/rest/v1/milestones?id=eq.' + id + '&select=id,mood,deadline,display_mode,display_days,substeps');
  console.log('  RELOAD (fresh SELECT): mood=' + JSON.stringify(reload1[0]?.mood) + ' <= expected "hero"');

  // 3. DEADLINE edit
  m = { ...m, deadline: '2026-09-30' };
  const afterDeadline = await upsertMilestone(m);
  console.log('\nDEADLINE EDIT -> deadline set to "2026-09-30"');
  console.log('  DB after save: deadline=' + JSON.stringify(afterDeadline.deadline));
  const reload2 = await rest('GET', '/rest/v1/milestones?id=eq.' + id + '&select=id,mood,deadline,display_mode,display_days');
  console.log('  RELOAD (fresh SELECT): mood=' + JSON.stringify(reload2[0]?.mood) + ' deadline=' + JSON.stringify(reload2[0]?.deadline) + ' <= mood must still be "hero"');

  // 4. "appears on specific days" edit (display_mode + display_days)
  m = { ...m, displayMode: 'specific_days', displayDays: ['Mon', 'Wed', 'Fri'] };
  const afterDays = await upsertMilestone(m);
  console.log('\nDISPLAY DAYS EDIT -> specific_days [Mon,Wed,Fri]');
  console.log('  DB after save: display_mode=' + afterDays.display_mode + ' display_days=' + JSON.stringify(afterDays.display_days));
  const reload3 = await rest('GET', '/rest/v1/milestones?id=eq.' + id + '&select=id,mood,deadline,display_mode,display_days');
  console.log('  RELOAD (fresh SELECT): mood=' + JSON.stringify(reload3[0]?.mood) + ' deadline=' + JSON.stringify(reload3[0]?.deadline) + ' display_mode=' + reload3[0]?.display_mode + ' display_days=' + JSON.stringify(reload3[0]?.display_days));

  // 5. REGRESSION: substeps link/unlink/move through the SAME full-payload save
  m = { ...m, substeps: [
    { id: 'ss-a', done: false, title: 'Step A', linkedTasks: [{ taskId: 't1', showOnDashboard: false }] },
    { id: 'ss-b', done: false, title: 'Step B', linkedTasks: [{ taskId: 't2', showOnDashboard: false }] },
  ] };
  await upsertMilestone(m); // add/link
  const afterLink = await rest('GET', '/rest/v1/milestones?id=eq.' + id + '&select=substeps');
  console.log('\nSUBSTEPS (link) -> DB substeps=' + JSON.stringify(afterLink[0]?.substeps));

  m = { ...m, substeps: m.substeps.map(s => s.id === 'ss-a'
    ? { ...s, linkedTasks: (s.linkedTasks || []).filter(lt => lt.taskId !== 't1') }
    : s) };
  await upsertMilestone(m); // unlink
  const afterUnlink = await rest('GET', '/rest/v1/milestones?id=eq.' + id + '&select=substeps');
  console.log('SUBSTEPS (unlink t1 from A) -> DB substeps=' + JSON.stringify(afterUnlink[0]?.substeps));

  m = { ...m, substeps: m.substeps.map(s => {
    if (s.id === 'ss-b') return { ...s, linkedTasks: [...(s.linkedTasks || []), { taskId: 't3', showOnDashboard: true }] };
    return s;
  }) };
  await upsertMilestone(m); // move-to-substep (link t3 into B with dash visibility)
  const afterMove = await rest('GET', '/rest/v1/milestones?id=eq.' + id + '&select=substeps,mood,deadline,display_mode,display_days');
  console.log('SUBSTEPS (move t3 into B) -> DB substeps=' + JSON.stringify(afterMove[0]?.substeps));
  console.log('  AND all fields still intact after substeps ops: mood=' + JSON.stringify(afterMove[0]?.mood) + ' deadline=' + JSON.stringify(afterMove[0]?.deadline) + ' display_mode=' + afterMove[0]?.display_mode + ' display_days=' + JSON.stringify(afterMove[0]?.display_days));

  // 6. cleanup
  await rest('DELETE', '/rest/v1/milestones?id=eq.' + id);
  const gone = await rest('GET', '/rest/v1/milestones?id=eq.' + id + '&select=id');
  console.log('\nCLEANUP: test milestone deleted, gone=' + JSON.stringify(gone));
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
