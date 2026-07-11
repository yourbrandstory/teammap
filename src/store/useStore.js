import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { useUIStore } from './useUIStore';
import {
  DMOODS, DEFAULT_NAV_ORDER, DEFAULT_NAV_LABELS, DEFAULT_SERVICE_CATEGORIES, DEFAULT_TASK_STATUSES, uid,
} from '../lib/constants';
import { getCompleteStatus, getReviewStatus } from '../utils/statusUtils';
import { validateTaskCreation } from '../utils/taskLimits';

// Module-level deduplication map for broadcast ↔ postgres_changes.
// Maps taskId → setTimeout handle. Prevents redundant processing
// when a broadcast event arrives before the matching Postgres Changes event.
const recentBC = new Map();

function markBroadcast(id) {
  const existing = recentBC.get(id);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => { if (recentBC.get(id) === t) recentBC.delete(id); }, 5000);
  recentBC.set(id, t);
}

function wasBroadcast(id) {
  if (recentBC.has(id)) { clearTimeout(recentBC.get(id)); recentBC.delete(id); return true; }
  return false;
}

const taskFromRow = (r) => {
  const t = {
    id:r.id, name:r.name, clientId:r.client_id, date:r.date, mood:r.mood,
    status:r.status, assignedTo:r.assigned_to||[], tags:r.tags||[],
    estH:r.est_h||0, estM:r.est_m||0, notes:r.notes||'',
    subtasks:r.subtasks||[], links:r.links||[],
    createdBy:r.created_by||null,
    updatedBy:r.updated_by||null,
    isMilestone:!!r.is_milestone, milestoneId:r.milestone_id||null,
    deleted:!!r.deleted, hidden:!!r.hidden, postingDate:r.posting_date||null,
    createdAt:Number(r.created_at)||Date.now(), updatedAt:Number(r.updated_at)||Date.now(),
  };
  if (t.subtasks?.length || t.links?.length) {
    console.log('[taskFromRow] loaded', t.id, { subtasks: t.subtasks.length, links: t.links.length });
  }
  return t;
};
const taskToRow = (t) => ({
  id:t.id, name:t.name, client_id:t.clientId||null, date:t.date, mood:t.mood,
  status:t.status, assigned_to:t.assignedTo||[], tags:t.tags||[],
  est_h:t.estH||0, est_m:t.estM||0, notes:t.notes||'',
  subtasks:t.subtasks||[], links:t.links||[],
  created_by:t.createdBy||null,
  updated_by:t.updatedBy||null,
  is_milestone:!!t.isMilestone, milestone_id:t.milestoneId||null,
  deleted:!!t.deleted, hidden:!!t.hidden, posting_date:t.postingDate||null,
  created_at:t.createdAt||Date.now(), updated_at:t.updatedAt||Date.now(),
});
const memberFromRow = (r) => ({ id:r.id, name:r.name, role:r.role, color:r.color, capacity:r.capacity ?? 6 });
const memberToRow   = (m) => ({ id:m.id, name:m.name, role:m.role, color:m.color, capacity:m.capacity ?? 6 });
const clientFromRow = (r) => ({ id:r.id, name:r.name, industry:r.industry||'', color:r.color, order:r.ord ?? 0, serviceCategoryIds:r.service_category_ids||[] });
const clientToRow   = (c) => ({ id:c.id, name:c.name, industry:c.industry||'', color:c.color, ord:c.order ?? 0, service_category_ids:c.serviceCategoryIds||[] });
const linkFromRow   = (r) => ({ id:r.id, memberId:r.member_id, clientId:r.client_id, roles:r.roles||[] });
const linkToRow     = (l) => ({ id:l.id, member_id:l.memberId, client_id:l.clientId, roles:l.roles||[] });
const msFromRow     = (r) => ({ id:r.id, title:r.title||r.name||'', mood:r.mood||r.color||'', assignedTo:r.assigned_to||[], clientId:r.client_id||'', date:r.date||'', deadline:r.deadline||'', substeps:r.substeps||[], displayMode:r.display_mode||'daily', displayDays:r.display_days||[], deleted:!!r.deleted, notes:r.notes||'', createdAt:Number(r.created_at)||Date.now(), updatedAt:Number(r.updated_at)||Date.now() });
const msToRow       = (m) => ({ id:m.id, name:m.title||m.name||'', title:m.title||'', mood:m.mood||'', assigned_to:m.assignedTo||[], client_id:m.clientId||null, date:m.date||'', deadline:m.deadline||null, substeps:m.substeps||[], display_mode:m.displayMode||'daily', display_days:m.displayDays||[], deleted:!!m.deleted, notes:m.notes||'', description:m.description||'', color:m.mood||m.color||'', created_at:m.createdAt||Date.now(), updated_at:m.updatedAt||Date.now() });
const tagFromRow    = (r) => ({ id:r.id, label:r.label, color:r.color });
const tagToRow      = (t) => ({ id:t.id, label:t.label, color:t.color });

const SESSION_KEY = 'tm-session';
const STATE_KEYS = ['settings','moods','navOrder','navLabels','freqTags','templates','playground','tg2Views','lineUpOrder','lineUpHidden','task_statuses','serviceCategories','memberOrder'];

const EMPTY_S = {
  members:[], clients:[], links:[], tasks:[], milestones:[], tags:[],
  lineUp: {},
  lineUpItemOrder: {},
  moods: JSON.parse(JSON.stringify(DMOODS)),
  settings:{ maxCap:6, weekends:false, spMember:null },
  navOrder:[...DEFAULT_NAV_ORDER], navLabels:{...DEFAULT_NAV_LABELS},
  serviceCategories:[], freqTags:[], task_statuses:[], templates:[], playground:{ tabs:[{ id:'pg1', name:'Sheet 1', data:{} }] },
  tg2Views:[], lineUpOrder:{}, lineUpHidden:{}, memberOrder:[],
};

export const useStore = create((set, get) => ({
  session: null,
  role: null,
  loading: true,
  isAuthLoading: true,
  saveFlash: 0,
  _rtChannel: null,
  _bcChannel: null,
  _syncInterval: null,
  _lastRealtimeEvent: 0,

  S: JSON.parse(JSON.stringify(EMPTY_S)),

  // ── Login: members query + persist session to localStorage ───────────────
  login: async (selectedRole, email, password) => {
    const roleFilter = selectedRole === 'manager' ? ['admin','manager'] : ['member'];
    const { data, error } = await supabase
      .from('members')
      .select('id, name, role, color')
      .eq('email', email)
      .eq('password', password)
      .in('role', roleFilter)
      .maybeSingle();

    if (error) return { error: 'Database error. Please try again.' };
    if (!data) return { error: selectedRole === 'manager'
      ? 'No manager found with that email and password.'
      : 'No member found with that email and password.' };

    // Persist session to localStorage (survives page refresh, PWA close/reopen)
    const session = { memberId: data.id, role: data.role, name: data.name, color: data.color };
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}

    // Establish Supabase Auth session (RLS on pg_sheets requires this)
    // Silently ignore errors — this app uses custom auth via the members table
    try { await supabase.auth.signInWithPassword({ email, password }).catch(() => {}); } catch (e) {}
    try { await supabase.auth.signUp({ email, password }).catch(() => {}); } catch (e) {}

    set({ session, role: data.role, loading: true, isAuthLoading: false });
    await get().loadAll();
    return {};
  },

  // ── Restore session from localStorage (survives refresh, PWA close/reopen) ─
  restoreSession: async () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.memberId && parsed.role) {
          const session = {
            memberId: parsed.memberId,
            role: parsed.role,
            name: parsed.name || '',
            color: parsed.color || '',
          };
          set({ session, role: parsed.role, loading: true, isAuthLoading: false });
          try { await supabase.auth.getSession(); } catch (e) {} // Restore Supabase Auth session from storage
          await get().loadAll();
          return;
        }
      }
    } catch (e) {
      try { localStorage.removeItem(SESSION_KEY); } catch {}
    }
    set({ isAuthLoading: false, loading: false });
  },

  setSession: (session) => set({ session }),

  // ── Auth state listener (handles external sign-outs) ───────────────────────
  _authSubscription: null,
  initAuthListener: () => {
    let subscription = null;
    try {
      const result = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          try { localStorage.removeItem(SESSION_KEY); } catch {}
          const ch = get()._rtChannel;
          if (ch) { supabase.removeChannel(ch); }
          const bc = get()._bcChannel;
          if (bc) { supabase.removeChannel(bc); }
          get()._stopPeriodicSync();
          set({
            session: null, role: null,
    S: JSON.parse(JSON.stringify(EMPTY_S)),
            loading: false, isAuthLoading: false, _rtChannel: null, _bcChannel: null,
          });
        }
      });
      subscription = result.data.subscription;
    } catch (e) {}
    set({ _authSubscription: subscription });
    set({ _authSubscription: subscription });
  },

  // ── Explicit logout — clears localStorage + resets state ──────────────────
  signOut: async () => {
    useUIStore.getState().clearUIState();
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    const ch = get()._rtChannel;
    if (ch) { supabase.removeChannel(ch); }
    const bc = get()._bcChannel;
    if (bc) { supabase.removeChannel(bc); }
    get()._stopPeriodicSync();
    try { await supabase.auth.signOut().catch(() => {}); } catch (e) {}
    set({
      session: null, role: null,
      S: JSON.parse(JSON.stringify(EMPTY_S)),
      loading: false, isAuthLoading: false, _rtChannel: null, _bcChannel: null,
    });
  },

  // ── boot: pull all data (no Supabase Auth dependency) ──────────────────────
  loadAll: async (force) => {
    const cur = get().S;
    if (!force && cur?.tasks?.length) {
      get()._subscribeRealtime();
      get()._subscribeBroadcast();
      get()._startPeriodicSync();
      return;
    }
    set({ loading: true });

    if (!get().session) { set({ loading:false }); return; }

    console.log('[loadAll] fetching data…');
    const [members, clients] = await Promise.all([
      supabase.from('members').select('*'),
      supabase.from('clients').select('*'),
    ]);
    const [links, tags] = await Promise.all([
      supabase.from('links').select('*'),
      supabase.from('tags').select('*'),
    ]);
    const [tasks, milestones] = await Promise.all([
      supabase.from('tasks').select('*'),
      supabase.from('milestones').select('*'),
    ]);
    const [svcCats] = await Promise.all([
      supabase.from('service_categories').select('*'),
    ]);
    const [st] = await Promise.all([
      supabase.from('app_state').select('*'),
    ]);
    const [lineUpRows] = await Promise.all([
      supabase.from('line_up').select('*'),
    ]);

    console.log('[loadAll] tasks raw from DB:', tasks.data?.length, 'rows');
    if (tasks.data?.length) {
      const sample = tasks.data[0];
      console.log('[loadAll] sample task columns:', Object.keys(sample));
      console.log('[loadAll] sample subtasks:', sample.subtasks);
      console.log('[loadAll] sample links:', sample.links);
    }



    const S = JSON.parse(JSON.stringify(EMPTY_S));
    S.members    = (members.data||[]).map(memberFromRow);
    S.clients    = (clients.data||[]).map(clientFromRow);
    S.links      = (links.data||[]).map(linkFromRow);
    S.tasks      = (tasks.data||[]).map(taskFromRow);
    S.milestones = (milestones.data||[]).map(msFromRow);
    S.tags       = (tags.data||[]).map(tagFromRow);
    S.serviceCategories = (svcCats.data||[]).map(tagFromRow);

    // ── Seed service categories if empty ──
    if (!S.serviceCategories.length) {
      S.serviceCategories = JSON.parse(JSON.stringify(DEFAULT_SERVICE_CATEGORIES));
      for (const sc of S.serviceCategories) {
        supabase.from('service_categories').upsert(sc).then();
      }
    }

    // ── Seed "SM Calendar" tag if missing ──
    if (!S.tags.find(t => t.label === 'SM Calendar')) {
      const smTag = { id: uid(), label: 'SM Calendar', color: '#7c3aed' };
      S.tags = [...S.tags, smTag];
      supabase.from('tags').upsert({ id: smTag.id, label: smTag.label, color: smTag.color }).then();
    }

    let hasAppStateMoods = false;
    (st.data||[]).forEach(r => { if (STATE_KEYS.includes(r.key)) { S[r.key] = r.value; if (r.key === 'moods') hasAppStateMoods = true; } });
    // Load per-member line_up data, with fallback to legacy app_state lineUpOrder
    (lineUpRows.data||[]).forEach(r => {
      if (!S.lineUp[r.member_id]) S.lineUp[r.member_id] = {};
      S.lineUp[r.member_id][r.date] = r.task_order || [];
      if (r.item_order) {
        if (!S.lineUpItemOrder[r.member_id]) S.lineUpItemOrder[r.member_id] = {};
        S.lineUpItemOrder[r.member_id][r.date] = r.item_order;
      }
    });
    if (S.lineUpOrder && Object.keys(S.lineUpOrder).length && !S.lineUp.__global__) {
      S.lineUp.__global__ = { ...S.lineUpOrder };
    }

    // ── Sort members by saved memberOrder ──
    if (S.memberOrder && S.memberOrder.length) {
      const orderIdx = new Map(S.memberOrder.map((id, i) => [id, i]));
      S.members.sort((a, b) => (orderIdx.get(a.id) ?? Infinity) - (orderIdx.get(b.id) ?? Infinity));
    }

    // ── Ensure 'ms' (Milestones) exists in saved navOrder for existing users ──
    if (S.navOrder && !S.navOrder.includes('ms')) {
      const tkIdx = S.navOrder.indexOf('tk');
      if (tkIdx >= 0) {
        S.navOrder = [...S.navOrder.slice(0, tkIdx + 1), 'ms', ...S.navOrder.slice(tkIdx + 1)];
      } else {
        S.navOrder = [...S.navOrder, 'ms'];
      }
      supabase.from('app_state').upsert({ key: 'navOrder', value: S.navOrder }).then();
    }
    if (S.navLabels && !S.navLabels.ms) {
      S.navLabels = { ...S.navLabels, ms: 'Milestones' };
      supabase.from('app_state').upsert({ key: 'navLabels', value: S.navLabels }).then();
    }

    // ── Ensure 'sc' (SM Calendar) exists in saved navOrder for existing users ──
    if (S.navOrder && !S.navOrder.includes('sc')) {
      const msIdx = S.navOrder.indexOf('ms');
      if (msIdx >= 0) {
        S.navOrder = [...S.navOrder.slice(0, msIdx + 1), 'sc', ...S.navOrder.slice(msIdx + 1)];
      } else {
        S.navOrder = [...S.navOrder, 'sc'];
      }
      supabase.from('app_state').upsert({ key: 'navOrder', value: S.navOrder }).then();
    }
    if (S.navLabels && !S.navLabels.sc) {
      S.navLabels = { ...S.navLabels, sc: 'SM Calendar' };
      supabase.from('app_state').upsert({ key: 'navLabels', value: S.navLabels }).then();
    }

    // ── Rename 'Task Gen 2.0' to 'Routines' in navLabels ──
    if (S.navLabels && S.navLabels.tg2 === 'Task Gen 2.0') {
      S.navLabels = { ...S.navLabels, tg2: 'Routines' };
      supabase.from('app_state').upsert({ key: 'navLabels', value: S.navLabels }).then();
    }

    const subtaskCount = S.tasks.reduce((a, t) => a + (t.subtasks?.length || 0), 0);
    const linkCount = S.tasks.reduce((a, t) => a + (t.links?.length || 0), 0);
    const tasksWithSubtasks = S.tasks.filter(t => t.subtasks?.length > 0).length;
    const tasksWithLinks = S.tasks.filter(t => t.links?.length > 0).length;
    console.log('[loadAll] done', { tasks: S.tasks.length, tasksWithSubtasks, tasksWithLinks, subtasks: subtaskCount, links: linkCount });

    // ── Moods: prefer app_state (preserves array order), fall back to moods table, then DMOODS
    if (hasAppStateMoods) {
      // Loaded from app_state on line 233 — use as-is, preserving drag order
      S.moods = S.moods.map(m => ({
        ...m,
        hidden: m.hidden !== undefined ? m.hidden : false,
      }));
    } else {
      const { data: moodRows } = await supabase.from('moods').select('*');
      if (moodRows && moodRows.length > 0) {
        S.moods = moodRows;
      } else {
        S.moods = JSON.parse(JSON.stringify(DMOODS));
      }
      // Seed app_state so future loads read saved order from here
      supabase.from('app_state').upsert({ key: 'moods', value: S.moods }).then();
    }

    if (!S.settings) S.settings = { maxCap:6, weekends:false, spMember:S.members[0]?.id || null };
    if (S.settings.spMember == null) S.settings.spMember = S.members[0]?.id || null;
    if (!S.task_statuses || !S.task_statuses.length) {
      S.task_statuses = DEFAULT_TASK_STATUSES.map((label, i) => ({ id: uid(), label, order: i }));
      supabase.from('app_state').upsert({ key: 'task_statuses', value: S.task_statuses }).then();
    }

    set({ S, loading:false });
    get()._subscribeRealtime();
    get()._subscribeBroadcast();
    get()._startPeriodicSync();
  },

  _subscribeRealtime: () => {
    const existing = get()._rtChannel;
    if (existing) { supabase.removeChannel(existing); }
    const channel = supabase.channel('tasks-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        (payload) => {
          const { new: row, eventType } = payload;
          const rid = row?.id;
          if (rid && wasBroadcast(rid)) {
            set({ _lastRealtimeEvent: Date.now() });
            return;
          }
          if (rid) markBroadcast(rid);
          get()._patchS((next) => {
            if (eventType === 'DELETE') {
              next.tasks = next.tasks.filter(t => t.id !== rid);
            } else if (row) {
              const task = taskFromRow(row);
              const i = next.tasks.findIndex(t => t.id === task.id);
              if (i >= 0) {
                next.tasks = next.tasks.map((t, idx) => idx === i ? task : t);
              } else {
                next.tasks = [...next.tasks, task];
              }
            }
          });
          set({ _lastRealtimeEvent: Date.now() });
        }
      )
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'line_up' },
        (payload) => {
          const row = payload.new;
          if (!row?.member_id || !row?.date) return;
          const mid = row.member_id;
          const date = row.date;
          const taskOrder = row.task_order || [];
          set((s) => {
            const next = { ...s };
            const S = { ...next.S, lineUp: { ...next.S.lineUp } };
            if (!S.lineUp[mid]) S.lineUp[mid] = {};
            S.lineUp[mid] = { ...S.lineUp[mid], [date]: taskOrder };
            next.S = S;
            return next;
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Realtime] tasks + line_up channel subscribed');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[Realtime] tasks channel error — will retry in 10s');
          setTimeout(() => { try { get()._subscribeRealtime(); } catch {} }, 10000);
        } else if (status === 'TIMED_OUT') {
          console.warn('[Realtime] tasks channel timed out — retrying');
          setTimeout(() => { try { get()._subscribeRealtime(); } catch {} }, 5000);
        }
      });
    set({ _rtChannel: channel });
  },

  _startPeriodicSync: () => {
    const existing = get()._syncInterval;
    if (existing) { clearInterval(existing); }
    const interval = setInterval(async () => {
      const now = Date.now();
      const lastEvent = get()._lastRealtimeEvent;
      // Only sync if no realtime events in the last 25 seconds (subscription may be down)
      if (now - lastEvent < 25000) return;
      console.log('[Sync] No realtime events recently — fetching latest tasks');
      const { data } = await supabase
        .from('tasks')
        .select('*')
        .gt('updated_at', lastEvent - 60000);
      if (data?.length) {
        get()._patchS((next) => {
          data.forEach((row) => {
            const task = taskFromRow(row);
            const i = next.tasks.findIndex(t => t.id === task.id);
            if (i >= 0) { next.tasks = next.tasks.map((t, idx) => idx === i ? task : t); }
            else { next.tasks = [...next.tasks, task]; }
          });
        });
      }
    }, 30000);
    set({ _syncInterval: interval });
  },

  _stopPeriodicSync: () => {
    const interval = get()._syncInterval;
    if (interval) { clearInterval(interval); set({ _syncInterval: null }); }
  },

  // ── Broadcast channel (fast path — direct WebSocket, <100ms) ──────────────
  _subscribeBroadcast: () => {
    if (get()._bcChannel) return;
    const ch = supabase.channel('tasks-bc');
    ch.on('broadcast', { event: '*' }, (payload) => {
      const { row, id: pid, e: eventType } = payload.payload;
      const rid = row?.id || pid;
      if (!rid) return;
      // Deduplicate: skip if already processed via Postgres Changes
      if (wasBroadcast(rid)) return;
      markBroadcast(rid);
      get()._patchS((next) => {
        if (eventType === 'DELETE') {
          next.tasks = next.tasks.filter(t => t.id !== rid);
        } else if (row) {
          const task = taskFromRow(row);
          const i = next.tasks.findIndex(t => t.id === task.id);
          if (i >= 0) {
            next.tasks = next.tasks.map((t, idx) => idx === i ? task : t);
          } else {
            next.tasks = [...next.tasks, task];
          }
        }
      });
    });
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Broadcast] channel ready');
      }
    });
    set({ _bcChannel: ch });
  },

  _broadcast: async (eventType, row) => {
    const ch = get()._bcChannel;
    if (!ch) return;
    try {
      await ch.send({
        type: 'broadcast',
        event: 't',
        payload: { row, id: row?.id, e: eventType },
      });
    } catch {}
  },

  _afterMutate: (task, eventType) => {
    const id = task?.id;
    if (!id) return;
    markBroadcast(id);
    get()._broadcast(eventType, task);
  },

  flashSaved: () => set((s)=>({ saveFlash: s.saveFlash+1 })),

  _patchS: (mutator) => {
    const S = get().S;
    const next = { ...S };
    mutator(next);
    set({ S: next });
    get().flashSaved();
  },
  _persistState: async (key) => {
    const value = get().S[key];
    const { error } = await supabase.from('app_state').upsert({ key, value });
    if (error) console.error('persist', key, error);
  },

  // ── Activity logging ──────────────────────────────────────────────────────
  _addActivity: async (taskId, activities) => {
    const session = get().session;
    if (!session?.memberId || !activities.length) return;
    const rows = activities.map(a => ({
      task_id: taskId,
      action: a.action,
      field: a.field || null,
      old_value: a.oldValue ?? null,
      new_value: a.newValue ?? null,
      user_id: session.memberId,
    }));
    const { error } = await supabase.from('task_activity').insert(rows);
    if (error) console.error('[activity] insert error:', error);
  },

  loadTaskActivity: async (taskId) => {
    const { data } = await supabase
      .from('task_activity')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(200);
    const members = get().S.members;
    return (data || []).map(r => ({
      id: r.id,
      taskId: r.task_id,
      action: r.action,
      field: r.field,
      oldValue: r.old_value,
      newValue: r.new_value,
      userId: r.user_id,
      userName: members.find(m => m.id === r.user_id)?.name || 'Unknown',
      createdAt: Number(r.created_at) || Date.now(),
    }));
  },

  // ── TASKS ─────────────────────────────────────────────────────────────────
  upsertTask: async (task) => {
    const now = Date.now();
    const session = get().session;
    const existing = get().S.tasks.find(x => x.id === task.id);
    const ts = get().S.task_statuses;
    const defaultStatus = ts?.length ? ts.sort((a,b)=>a.order-b.order)[0].label : 'Not Started';
    const t = { estH:0, estM:0, tags:[], assignedTo:[], notes:'', status:defaultStatus,
      subtasks:[], links:[], isMilestone:false, milestoneId:null, deleted:false,
      ...(existing || {}), ...task };
    const isNew = !t.id;
    if (isNew) {
      t.id = uid(); t.createdAt = now; t.createdBy = session?.memberId || null;
      for (const mid of (t.assignedTo || [])) {
        const result = validateTaskCreation(get().S, mid, t.mood, t.date, t.id);
        if (!result.valid) throw new Error(result.error);
      }
    }
    if (session?.role === 'member' && t.status === getCompleteStatus(get().S.task_statuses)) {
      t.status = getReviewStatus(get().S.task_statuses);
    }
    t.updatedBy = session?.memberId || null;
    t.updatedAt = now;
    get()._patchS((S) => {
      const i = S.tasks.findIndex(x => x.id === t.id);
      S.tasks = i >= 0 ? S.tasks.map(x => x.id === t.id ? t : x) : [...S.tasks, t];
    });

    // ── Detect changes and log activity ──
    const activities = [];
    if (isNew) {
      activities.push({ action: 'created', field: null, oldValue: null, newValue: null });
    } else if (existing) {
      const f = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
      if (f(existing.name, t.name)) activities.push({ action: 'updated', field: 'name', oldValue: existing.name, newValue: t.name });
      if (f(existing.status, t.status)) {
        activities.push({ action: 'status_changed', field: 'status', oldValue: existing.status, newValue: t.status });
        if (t.status === getReviewStatus(get().S.task_statuses)) {
          activities.push({ action: 'marked_for_review', field: 'status', oldValue: existing.status, newValue: t.status });
        }
      }
      if (f(existing.mood, t.mood)) activities.push({ action: 'mood_changed', field: 'mood', oldValue: existing.mood, newValue: t.mood });
      if (f(existing.date, t.date)) activities.push({ action: 'date_changed', field: 'date', oldValue: existing.date, newValue: t.date });
      if (f(existing.notes, t.notes)) activities.push({ action: 'notes_updated', field: 'notes', oldValue: existing.notes, newValue: t.notes });
      if (f(existing.clientId, t.clientId)) activities.push({ action: 'client_changed', field: 'client', oldValue: existing.clientId, newValue: t.clientId });
      if (f(existing.assignedTo, t.assignedTo)) activities.push({ action: 'assigned_changed', field: 'assigned', oldValue: existing.assignedTo, newValue: t.assignedTo });
      if (f(existing.hidden, t.hidden)) activities.push({ action: t.hidden ? 'hidden' : 'unhidden', field: 'hidden', oldValue: existing.hidden, newValue: t.hidden });
      // Subtask diffs
      const os = existing.subtasks || []; const ns = t.subtasks || [];
      ns.forEach(s => { if (!os.find(o => o.text === s.text && o.done === s.done)) activities.push({ action: s.done ? 'subtask_completed' : 'subtask_added', field: 'subtasks', oldValue: null, newValue: s.text }); });
      os.forEach(s => { if (!ns.find(n => n.text === s.text)) activities.push({ action: 'subtask_deleted', field: 'subtasks', oldValue: s.text, newValue: null }); });
      // Link diffs
      const ol = existing.links || []; const nl = t.links || [];
      nl.forEach(l => { if (!ol.find(o => o.url === l.url)) activities.push({ action: 'link_added', field: 'links', oldValue: null, newValue: l.url }); });
      ol.forEach(l => { if (!nl.find(n => n.url === l.url)) activities.push({ action: 'link_removed', field: 'links', oldValue: l.url, newValue: null }); });
      // Tag diffs
      const ot = existing.tags || []; const nt = t.tags || [];
      nt.forEach(tg => { if (!ot.includes(tg)) activities.push({ action: 'tag_added', field: 'tags', oldValue: null, newValue: tg }); });
      ot.forEach(tg => { if (!nt.includes(tg)) activities.push({ action: 'tag_removed', field: 'tags', oldValue: tg, newValue: null }); });
    }
    if (activities.length) get()._addActivity(t.id, activities);

    const row = taskToRow(t);
    let error = null, result = null;
    try {
      if (isNew) {
        result = await supabase.from('tasks').insert(row).select();
      } else {
        const { id: rowId, created_at, created_by, ...data } = row;
        result = await supabase.from('tasks').update(data).eq('id', rowId).select();
      }
    } catch (e) { error = e; }
    if (result && result.error) error = result.error;
    if (error) throw error;
    // Reconcile with server version + broadcast to other clients
    const serverRow = result?.data?.[0];
    if (serverRow) {
      const serverTask = taskFromRow(serverRow);
      get()._patchS((next) => {
        const i = next.tasks.findIndex(x => x.id === serverTask.id);
        if (i >= 0) next.tasks = next.tasks.map((x, idx) => idx === i ? serverTask : x);
      });
      get()._afterMutate(serverRow, isNew ? 'INSERT' : 'UPDATE');
    }
    return t;
  },
  // Lightweight subtask-only update — no activity log, but update local state
  patchTaskSubtasks: async (taskId, subtasks) => {
    const now = Date.now();
    const session = get().session;
    get()._patchS((next) => {
      next.tasks = next.tasks.map(t => t.id === taskId ? { ...t, subtasks, updatedAt: now } : t);
    });
    const result = await supabase.from('tasks')
      .update({ subtasks, updated_by: session?.memberId || null, updated_at: now })
      .eq('id', taskId)
      .select();
    const error = result?.error;
    if (error) console.error('[patchTaskSubtasks] failed:', error);
    const serverRow = result?.data?.[0];
    if (serverRow) get()._afterMutate(serverRow, 'UPDATE');
  },

  setTaskStatus: async (taskId, status) => {
    const session = get().session;
    if (session?.role === 'member' && status === getCompleteStatus(get().S.task_statuses)) {
      return;
    }
    let updated=null;
    get()._patchS((S) => {
      S.tasks = S.tasks.map(t => t.id===taskId ? (updated={...t,status,updatedAt:Date.now()}) : t);
    });
    if (updated) {
      const result = await supabase.from('tasks')
        .update({ status, updated_by: session?.memberId || null, updated_at: updated.updatedAt }).eq('id', taskId).select();
      const serverRow = result?.data?.[0];
      if (serverRow) get()._afterMutate(serverRow, 'UPDATE');
      const activities = [{ action: 'status_changed', field: 'status', oldValue: updated.status, newValue: status }];
      if (status === getReviewStatus(get().S.task_statuses)) {
        activities.push({ action: 'marked_for_review', field: 'status', oldValue: updated.status, newValue: status });
      }
      get()._addActivity(taskId, activities);
    }
  },
  softDeleteTask: async (taskId) => {
    const session = get().session;
    const S = get().S;
    const task = S.tasks.find(t => t.id === taskId);
    if (!session || !task) return;
    const isAdminOrManager = session.role === 'admin' || session.role === 'manager';
    if (!isAdminOrManager && task.createdBy !== session.memberId) {
      console.warn('[softDeleteTask] Permission denied: only admin/manager or task creator can delete.');
      return;
    }
    get()._patchS((S)=>{ S.tasks = S.tasks.map(t=>t.id===taskId?{...t,deleted:true,updatedAt:Date.now()}:t); });
    const result = await supabase.from('tasks').update({ deleted:true, updated_by: session?.memberId || null, updated_at:Date.now() }).eq('id', taskId).select();
    const serverRow = result?.data?.[0];
    if (serverRow) get()._afterMutate(serverRow, 'UPDATE');
    get()._addActivity(taskId, [{ action: 'deleted', field: null, oldValue: null, newValue: null }]);
  },
  recoverTask: async (taskId) => {
    const session = get().session;
    get()._patchS((S)=>{ S.tasks = S.tasks.map(t=>t.id===taskId?{...t,deleted:false,updatedAt:Date.now()}:t); });
    const result = await supabase.from('tasks').update({ deleted:false, updated_by: session?.memberId || null, updated_at:Date.now() }).eq('id', taskId).select();
    const serverRow = result?.data?.[0];
    if (serverRow) get()._afterMutate(serverRow, 'UPDATE');
    get()._addActivity(taskId, [{ action: 'recovered', field: null, oldValue: null, newValue: null }]);
  },
  purgeTask: async (taskId) => {
    get()._patchS((S)=>{ S.tasks = S.tasks.filter(t=>t.id!==taskId); });
    await supabase.from('tasks').delete().eq('id', taskId);
    get()._afterMutate({ id: taskId }, 'DELETE');
  },

  // ── MEMBERS ───────────────────────────────────────────────────────────────
  upsertMember: async (m) => {
    if (!m.id) m={ ...m, id:uid() };
    get()._patchS((S)=>{ const i=S.members.findIndex(x=>x.id===m.id);
      S.members = i>=0 ? S.members.map(x=>x.id===m.id?m:x) : [...S.members,m]; });
    await supabase.from('members').upsert(memberToRow(m));
    return m;
  },
  delMember: async (id) => {
    get()._patchS((S)=>{ S.members=S.members.filter(x=>x.id!==id); S.links=S.links.filter(l=>l.memberId!==id); });
    await supabase.from('links').delete().eq('member_id', id);
    await supabase.from('members').delete().eq('id', id);
  },

  // ── CLIENTS ───────────────────────────────────────────────────────────────
  upsertClient: async (c) => {
    if (!c.id) c={ order:0, ...c, id:uid() };
    get()._patchS((S)=>{ const i=S.clients.findIndex(x=>x.id===c.id);
      S.clients = i>=0 ? S.clients.map(x=>x.id===c.id?c:x) : [...S.clients,c]; });
    await supabase.from('clients').upsert(clientToRow(c));
    return c;
  },
  delClient: async (id) => {
    get()._patchS((S)=>{ S.clients=S.clients.filter(x=>x.id!==id); S.links=S.links.filter(l=>l.clientId!==id); });
    await supabase.from('links').delete().eq('client_id', id);
    await supabase.from('clients').delete().eq('id', id);
  },

  // ── LINKS ─────────────────────────────────────────────────────────────────
  upsertLink: async (l) => {
    if (!l.id) l={ roles:[], ...l, id:uid() };
    get()._patchS((S)=>{ const i=S.links.findIndex(x=>x.id===l.id);
      S.links = i>=0 ? S.links.map(x=>x.id===l.id?l:x) : [...S.links,l]; });
    await supabase.from('links').upsert(linkToRow(l));
    return l;
  },
  delLink: async (id) => {
    get()._patchS((S)=>{ S.links=S.links.filter(x=>x.id!==id); });
    await supabase.from('links').delete().eq('id', id);
  },

  // ── MILESTONES ────────────────────────────────────────────────────────────
  upsertMilestone: async (m) => {
    const now = Date.now();
    const existing = get().S.milestones.find(x => x.id === m.id);
    const isNew = !m.id;
    if (isNew) {
      m = { substeps:[], displayMode:'daily', displayDays:[], deleted:false, ...m, id:uid(), createdAt:now, updatedAt:now };
    } else {
      m = { ...(existing||{}), ...m, updatedAt:now };
    }
    get()._patchS((S)=>{
      const i=S.milestones.findIndex(x=>x.id===m.id);
      S.milestones = i>=0 ? S.milestones.map(x=>x.id===m.id?m:x) : [...S.milestones,m];
    });
    const row = msToRow(m);
    console.log('[upsertMilestone] table=milestones op='+(isNew?'insert':'update')+' id='+m.id+' title='+m.title);
    console.log('[upsertMilestone] payload:', JSON.stringify(row, null, 2));
    let { error } = await supabase.from('milestones').upsert(row).select();
    if (error && (error.code === '42703' || /column .+ does not exist/i.test(error.message))) {
      const colMatch = error.message.match(/column "([^"]+)"/);
      const badCol = colMatch?.[1];
      if (badCol && row[badCol] !== undefined) {
        console.warn('[upsertMilestone] column "'+badCol+'" missing, retrying without it');
        const { [badCol]: _, ...rest } = row;
        const retry = await supabase.from('milestones').upsert(rest).select();
        error = retry.error;
        if (!retry.error) {
          console.log('[upsertMilestone] saved without column "'+badCol+'"');
        } else if (retry.error.code === '42703' || /column .+ does not exist/i.test(retry.error.message)) {
          console.warn('[upsertMilestone] multiple columns missing, falling back to old schema');
          const oldRow = { id:m.id, name:m.title||m.name||'', description:m.description||'', assigned_to:m.assignedTo||[], color:m.mood||m.color||'', created_at:m.createdAt||Date.now() };
          const fb = await supabase.from('milestones').upsert(oldRow).select();
          error = fb.error;
          if (!fb.error) {
            console.log('[upsertMilestone] saved with old schema (title/substeps not persisted until migration runs)');
          }
        }
      } else {
        console.warn('[upsertMilestone] new-schema columns missing, falling back to old schema');
        const oldRow = { id:m.id, name:m.title||m.name||'', description:m.description||'', assigned_to:m.assignedTo||[], color:m.mood||m.color||'', created_at:m.createdAt||Date.now() };
        const fb = await supabase.from('milestones').upsert(oldRow).select();
        error = fb.error;
        if (!fb.error) {
          console.log('[upsertMilestone] saved with old schema (title/substeps not persisted until migration runs)');
        }
      }
    } else if (error) {
      console.error('[upsertMilestone] error.code:', error.code);
      console.error('[upsertMilestone] error.message:', error.message);
      console.error('[upsertMilestone] error.details:', error.details);
      console.error('[upsertMilestone] error.hint:', error.hint);
    }
    return m;
  },
  delMilestone: async (id) => {
    const now = Date.now();
    get()._patchS((S)=>{ S.milestones=S.milestones.map(x=>x.id===id?{...x,deleted:true,updatedAt:now}:x); });
    const { error } = await supabase.from('milestones').update({ deleted:true, updated_at:now }).eq('id', id);
    if (error && (error.code === '42703' || /column .+ does not exist/i.test(error.message))) {
      console.warn('[delMilestone] new-schema columns missing, using hard delete');
      await supabase.from('milestones').delete().eq('id', id);
    }
  },

  // ── TAGS ──────────────────────────────────────────────────────────────────
  upsertTag: async (t) => {
    if (!t.id) t={ ...t, id:uid() };
    get()._patchS((S)=>{ const i=S.tags.findIndex(x=>x.id===t.id);
      S.tags = i>=0 ? S.tags.map(x=>x.id===t.id?t:x) : [...S.tags,t]; });
    await supabase.from('tags').upsert(tagToRow(t));
    return t;
  },
  delTag: async (id) => {
    get()._patchS((S)=>{ S.tags=S.tags.filter(x=>x.id!==id); });
    await supabase.from('tags').delete().eq('id', id);
  },

  // ── SERVICE CATEGORIES ───────────────────────────────────────────────────
  upsertServiceCategory: async (sc) => {
    if (!sc.id) sc={ ...sc, id:uid() };
    get()._patchS((S)=>{ const i=S.serviceCategories.findIndex(x=>x.id===sc.id);
      S.serviceCategories = i>=0 ? S.serviceCategories.map(x=>x.id===sc.id?sc:x) : [...S.serviceCategories,sc]; });
    await supabase.from('service_categories').upsert(tagToRow(sc));
    return sc;
  },
  delServiceCategory: async (id) => {
    get()._patchS((S)=>{ S.serviceCategories=S.serviceCategories.filter(x=>x.id!==id); });
    await supabase.from('service_categories').delete().eq('id', id);
  },

  // ── CONFIG SINGLETONS (app_state) ─────────────────────────────────────────
  updateSettings: async (patch) => {
    get()._patchS((S)=>{ S.settings = { ...S.settings, ...patch }; });
    await get()._persistState('settings');
  },
  setMoods: async (moods) => {
    get()._patchS((S)=>{ S.moods=moods; });
    await Promise.all([
      get()._persistState('moods'),
      supabase.from('moods').upsert(moods.map(m => ({
        id: m.id, label: m.label, icon: m.icon, color: m.color, bg: m.bg,
        desc: m.desc, max: m.max, cardSize: m.cardSize, hidden: m.hidden,
      }))),
    ]);
  },
  setNavOrder: async (order) => { get()._patchS((S)=>{ S.navOrder=order; }); await get()._persistState('navOrder'); },
  setNavLabels: async (labels) => { get()._patchS((S)=>{ S.navLabels=labels; }); await get()._persistState('navLabels'); },
  resetNav: async () => {
    get()._patchS((S)=>{ S.navOrder=[...DEFAULT_NAV_ORDER]; S.navLabels={...DEFAULT_NAV_LABELS}; });
    await get()._persistState('navOrder'); await get()._persistState('navLabels');
  },
  setStateKey: async (key, value) => { get()._patchS((S)=>{ S[key]=value; }); await get()._persistState(key); },

  // ── LINE UP (per-member, persisted to line_up table, realtime) ─────────────
  saveLineUp: async (memberId, date, taskOrder, itemOrder) => {
    const now = Date.now();
    set((s) => {
      const S = { ...s.S, lineUp: { ...s.S.lineUp }, lineUpItemOrder: { ...s.S.lineUpItemOrder } };
      if (!S.lineUp[memberId]) S.lineUp[memberId] = {};
      S.lineUp[memberId] = { ...S.lineUp[memberId], [date]: taskOrder };
      if (itemOrder) {
        if (!S.lineUpItemOrder[memberId]) S.lineUpItemOrder[memberId] = {};
        S.lineUpItemOrder[memberId] = { ...S.lineUpItemOrder[memberId], [date]: itemOrder };
      }
      // Keep legacy lineUpOrder in sync for components that still read it
      if (memberId === '__global__') {
        S.lineUpOrder = { ...s.S.lineUpOrder, [date]: taskOrder };
      } else if (itemOrder && memberId === '__global__') {
        S.lineUpOrder = { ...s.S.lineUpOrder, [date]: itemOrder };
      }
      return { ...s, S };
    });
    get().flashSaved();
    const upsertData = { member_id: memberId, date, task_order: taskOrder, updated_at: now };
    if (itemOrder) upsertData.item_order = itemOrder;
    const { error } = await supabase.from('line_up').upsert(
      upsertData,
      { onConflict: 'member_id,date' }
    );
    if (error) console.error('[saveLineUp] error:', error);
  },

  // ── JSON import / export ──────────────────────────────────────────────────
  exportJSON: () => {
    const S = get().S;
    const blob = new Blob([JSON.stringify(S, null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'teammap-backup.json';
    a.click();
  },
  importJSON: async (raw) => {
    const S = JSON.parse(JSON.stringify(EMPTY_S));
    Object.assign(S, raw);
    if (!S.moods || !S.moods.length) S.moods = JSON.parse(JSON.stringify(DMOODS));
    if (S.moods && S.moods.length) {
      S.moods = S.moods.map(m => ({ ...m, hidden: m.hidden !== undefined ? m.hidden : (m.visible !== undefined ? !m.visible : false) }));
    }
    if (!S.tags) S.tags = [];
    if (!S.serviceCategories) S.serviceCategories = JSON.parse(JSON.stringify(DEFAULT_SERVICE_CATEGORIES));
    if (!S.settings) S.settings = { maxCap:6, weekends:false, spMember:S.members?.[0]?.id||null };

    const lineUpRows = [];
    if (S.lineUp) {
      for (const memberId of Object.keys(S.lineUp)) {
        for (const date of Object.keys(S.lineUp[memberId] || {})) {
          const row = { member_id: memberId, date, task_order: S.lineUp[memberId][date] };
          if (S.lineUpItemOrder?.[memberId]?.[date]) {
            row.item_order = S.lineUpItemOrder[memberId][date];
          }
          lineUpRows.push(row);
        }
      }
    }
    const chunks = [
      supabase.from('members').upsert((S.members||[]).map(memberToRow)),
      supabase.from('clients').upsert((S.clients||[]).map(clientToRow)),
      supabase.from('links').upsert((S.links||[]).map(linkToRow)),
      supabase.from('milestones').upsert((S.milestones||[]).map(msToRow)),
      supabase.from('tags').upsert((S.tags||[]).map(tagToRow)),
      supabase.from('service_categories').upsert((S.serviceCategories||[]).map(tagToRow)),
      ...(S.tasks?.length ? [supabase.from('tasks').upsert(S.tasks.map(taskToRow))] : []),
      ...(lineUpRows.length ? [supabase.from('line_up').upsert(lineUpRows, { onConflict: 'member_id,date' })] : []),
      ...STATE_KEYS.map(k => supabase.from('app_state').upsert({ key:k, value:S[k] })),
    ];
    const results = await Promise.all(chunks);
    const errs = results.map(r=>r.error).filter(Boolean);
    if (errs.length) { console.error('importJSON errors', errs); throw errs[0]; }

    set({ S });
    return true;
  },
}));

export const sel = {
  gm:  (S,id)=>S.members.find(m=>m.id===id),
  gc:  (S,id)=>S.clients.find(c=>c.id===id),
  gmood:(S,id)=>S.moods.find(m=>m.id===id)||S.moods[0],
  gtag:(S,id)=>S.tags?S.tags.find(t=>t.id===id):null,
  scl: (S)=>[...S.clients].sort((a,b)=>(a.order||0)-(b.order||0)),
  tasksOnDate:(S,d)=>S.tasks.filter(t=>t.date===d&&!t.deleted),
  tasksForMD:(S,mid,d)=>S.tasks.filter(t=>t.date===d&&!t.deleted&&t.assignedTo&&t.assignedTo.includes(mid)),
};
