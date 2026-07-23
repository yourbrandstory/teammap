import { useEffect, useState, useRef, useCallback, memo, useMemo } from 'react';
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { COLORS, today, uid } from '../lib/constants';
import { useStore, sel } from '../store/useStore';
import { getStatusMaps, getDefaultStatus, getCompleteStatus, getPassStatus, getStatusesForRole, canDeleteTask } from '../utils/statusUtils';
import { validateTaskCreation, getMoodLimit } from '../utils/taskLimits';
import Avatar from './Avatar';
import RichTextEditor from './RichTextEditor';
import MilestoneModal from './MilestoneModal';

const DRAFT_KEY = 'tm_task_draft';

function ensureSubtaskIds(raw) {
  return (raw || []).map((s, i) => ({ ...s, id: s.id || uid(), order: s.order ?? i }));
}

function loadDraft(taskId) {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d._taskId === taskId ? d : null;
  } catch { return null; }
}

function saveDraft(data) {
  try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch {}
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY); } catch {}
}

export default function TaskModal({ task = {}, onClose, onSave, fromCellText = '', onSaveAsTemplate, readonlyAssignee = false, onOpenMilestone }) {
  const S = useStore(s => s.S);
  const session = useStore(s => s.session);
  const { STATS } = getStatusMaps(S.task_statuses);
  const roleStatuses = getStatusesForRole(S.task_statuses, session?.role);
  const upsertTask = useStore(s => s.upsertTask);
  const upsertTag = useStore(s => s.upsertTag);
  const softDeleteTask = useStore(s => s.softDeleteTask);
  const upsertMilestone = useStore(s => s.upsertMilestone);

  const isEdit = !!task.id;
  const draftId = task.id || '__new__';
  const draft = useRef(task.id ? loadDraft(draftId) : null);

  const initVal = (field, fallback) => draft.current?.[field] ?? fallback;

  const [name, setName] = useState(initVal('name', task.name || ''));
  const [mood, setMood] = useState(initVal('mood', task.mood || ''));
  const [assigned, setAssigned] = useState(initVal('assigned', task.assignedTo ? [...task.assignedTo] : []));
  const [clientId, setClientId] = useState(initVal('clientId', task.clientId || ''));
  const [date, setDate] = useState(initVal('date', task.date || today()));
  const [postingDate, setPostingDate] = useState(initVal('postingDate', task.postingDate || ''));
  const [status, setStatus] = useState(initVal('status', task.status || getDefaultStatus(S.task_statuses)));
  const [estH, setEstH] = useState(initVal('estH', task.estH || ''));
  const [estM, setEstM] = useState(initVal('estM', task.estM || ''));
  const [notes, setNotes] = useState(initVal('notes', task.notes || ''));
  const [tags, setTags] = useState(initVal('tags', task.tags ? [...task.tags] : []));
  const [newTag, setNewTag] = useState('');
  const [err, setErr] = useState({});
  const [nudgeMsg, setNudgeMsg] = useState('');
  const [subtasks, setSubtasks] = useState(ensureSubtaskIds(initVal('subtasks', task.subtasks ? task.subtasks.map(s => ({ ...s })) : [])));
  const [links, setLinks] = useState(initVal('links', task.links ? task.links.map(l => ({ ...l })) : []));
  const [newSubtask, setNewSubtask] = useState('');
  const [newLinkLabel, setNewLinkLabel] = useState('');
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const loadTaskActivity = useStore(s => s.loadTaskActivity);
  const [tDetailTab, setTDetailTab] = useState('sub');
  const [activity, setActivity] = useState([]);
  const [s3Tab, setS3Tab] = useState('milestone');
  const [linkMsId, setLinkMsId] = useState('');
  const [linkSsId, setLinkSsId] = useState('');
  const [showMsPicker, setShowMsPicker] = useState(false);
  const [msSearch, setMsSearch] = useState('');
  const [newSubstepTitle, setNewSubstepTitle] = useState('');
  const [showNewSubstepInput, setShowNewSubstepInput] = useState(false);
  const [msModal, setMsModal] = useState(null);
  const taskIdRef = useRef(task.id || null);
  const [saveStatus, setSaveStatus] = useState(task.id ? 'idle' : 'idle');
  const debounceRef = useRef(null);
  const fieldsRef = useRef({});
  const lastSnapshot = useRef('');
  const retryCount = useRef(0);
  const mountedRef = useRef(true);
  const hasEverHadRequiredFields = useRef(false);
  const saveStatusTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());

  // Initialize snapshot on first render to prevent auto-save on mount for existing tasks
  if (task.id && lastSnapshot.current === '') {
    lastSnapshot.current = JSON.stringify([
      name.trim(), mood, [...assigned].sort(),
      clientId || '', date || '', postingDate || '', status, String(estH), String(estM),
      notes, [...tags].sort(),
      subtasks.map(x => x.text + String(x.done)).sort().join('|'),
      links.map(x => x.url).sort().join('|'),
    ]);
  }

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  const taskNameRef = useRef(null);

  // Reactive limit check
  const limitError = (() => {
    if (!assigned.length || !mood) return null;
    const d = date || today();
    for (const mid of assigned) {
      const r = validateTaskCreation(S, mid, mood, d, task.id);
      if (!r.valid) return r.error;
    }
    return null;
  })();

  const [tab, setTab] = useState('essentials');
  const hasDetailContent = isEdit && (task.notes || (task.tags?.length > 0) || (task.subtasks?.length > 0) || (task.links?.length > 0));

  const linkedMilestones = useMemo(() => {
    const tid = task.id || taskIdRef.current;
    if (!tid) return [];
    const results = [];
    for (const ms of S.milestones) {
      for (const ss of (ms.substeps || []).filter(Boolean)) {
        if ((ss.linkedTasks || []).some(lt => lt.taskId === tid)) {
          results.push({ milestone: ms, substep: ss });
        }
      }
    }
    return results;
  }, [task.id, S.milestones]);

  const filteredMilestones = useMemo(() => {
    let result;
    if (!msSearch.trim()) {
      result = S.milestones.filter(m => !m.deleted);
    } else {
      const q = msSearch.toLowerCase().trim();
      result = S.milestones.filter(m => {
        if (m.deleted) return false;
        if (m.title.toLowerCase().includes(q)) return true;
        const clientName = m.clientId ? (sel.gc(S, m.clientId)?.name || '').toLowerCase() : '';
        if (clientName.includes(q)) return true;
        const assigneeNames = (m.assignedTo || []).map(id => (sel.gm(S, id)?.name || '').toLowerCase());
        if (assigneeNames.some(n => n.includes(q))) return true;
        return false;
      });
    }
    return result.sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [msSearch, S.milestones, S]);

  useEffect(() => { taskNameRef.current?.focus(); }, []);

  useEffect(() => {
    if (task.id) loadTaskActivity(task.id).then(setActivity);
  }, [task.id, loadTaskActivity]);

  // Keep a ref with the latest field values (no stale closures in debounce callbacks)
  useEffect(() => {
    fieldsRef.current = { name, mood, assigned: [...assigned], clientId, date, postingDate, status, estH, estM, notes, tags: [...tags], subtasks: subtasks.map(s => ({...s})), links: links.map(l => ({...l})) };
  });

  const doSave = useCallback(() => {
    const result = saveQueue.current.catch(() => {}).then(async () => {
      const f = fieldsRef.current;
      const currentId = taskIdRef.current;
      if (!f.name.trim() || !f.mood || !f.assigned.length) return null;

      const snapshot = JSON.stringify([
        f.name.trim(), f.mood, [...f.assigned].sort(),
        f.clientId || '', f.date || '', f.postingDate || '', f.status, String(f.estH), String(f.estM),
        f.notes, [...f.tags].sort(),
        f.subtasks.map(x => x.text + String(x.done)).sort().join('|'),
        f.links.map(x => x.url).sort().join('|'),
      ]);
      if (snapshot === lastSnapshot.current && currentId) return null;

      if (mountedRef.current) setSaveStatus('saving');

      const payload = {
        ...(currentId ? { id: currentId } : {}),
        name: f.name.trim(), clientId: f.clientId || null, date: f.date || today(),
        postingDate: f.postingDate || null, mood: f.mood, status: f.status, assignedTo: [...f.assigned], tags: [...f.tags],
        estH: parseInt(f.estH) || 0, estM: parseInt(f.estM) || 0, notes: f.notes,
        subtasks: f.subtasks.map(s => ({ ...s })),
        links: f.links.map(l => ({ ...l })),
        isMilestone: !!task.isMilestone, milestoneId: task.milestoneId || null,
      };

      const isManager = session?.role === 'admin' || session?.role === 'manager';
      const allDone = f.subtasks.filter(Boolean).length && f.subtasks.filter(Boolean).every(s => s.done);
      const cStatus = getCompleteStatus(S.task_statuses);
      if (allDone && isManager && f.status !== cStatus) {
        payload.status = cStatus;
      }

      try {
        const saved = await upsertTask(payload);
        if (!currentId) {
          taskIdRef.current = saved.id;
          if (onSave) onSave(saved);
        }
        retryCount.current = 0;
        lastSnapshot.current = snapshot;
        if (mountedRef.current) {
          setSaveStatus('saved');
          clearTimeout(saveStatusTimer.current);
          saveStatusTimer.current = setTimeout(() => {
            if (mountedRef.current) setSaveStatus(prev => prev === 'saved' ? 'idle' : prev);
          }, 2000);
        }
        return saved;
      } catch (err) {
        console.error('[AutoSave] failed:', err);
        if (mountedRef.current) setSaveStatus('error');
        if (retryCount.current < 3) {
          retryCount.current++;
          setTimeout(() => { if (mountedRef.current) doSave(); }, 3000);
        }
        return null;
      }
    });
    saveQueue.current = result;
    return result;
  }, [S, session, upsertTask]);

  const flushSave = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    return doSave();
  }, [doSave]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(), 600);
  }, [doSave]);

  function nudgeMissingFields(hasName, hasMood, hasAssignee) {
    const tn = document.getElementById('tn');
    const mp = document.getElementById('mprow');
    const ta = document.getElementById('tarow');
    if (!hasName && tn) {
      tn.classList.add('nudge-shake');
      tn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => tn.classList.remove('nudge-shake'), 600);
    }
    if (!hasMood && mp) {
      mp.classList.add('nudge-flash');
      setTimeout(() => mp.classList.remove('nudge-flash'), 600);
    }
    if (!hasAssignee && ta) {
      ta.classList.add('nudge-flash');
      setTimeout(() => ta.classList.remove('nudge-flash'), 600);
    }
    setNudgeMsg('Add a task name, mood and assignee — then you\'re good to go');
    setTimeout(() => setNudgeMsg(''), 3000);
  }

  const tryCloseModal = useCallback(() => {
    if (limitError) return;
    if (showMsPicker) {
      setNudgeMsg('Please select a milestone substep before closing.');
      setTimeout(() => setNudgeMsg(''), 3000);
      return;
    }
    const hasName = name.trim().length > 0;
    const hasMood = !!mood;
    const hasAssignee = assigned.length > 0;
    if (hasName && hasMood && hasAssignee) {
      flushSave().then(saved => {
        if (!saved && !taskIdRef.current) return;
        clearDraft();
        onClose();
      });
    } else {
      nudgeMissingFields(hasName, hasMood, hasAssignee);
    }
  }, [name, mood, assigned, flushSave, onClose, limitError, showMsPicker]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onEsc = (e) => {
      const target = e.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable;
      if (isTyping) return;
      if (e.key === 'Escape') tryCloseModal();
    };
    document.addEventListener('keydown', onEsc);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onEsc);
    };
  }, [tryCloseModal]);

  // Auto-save: debounce on any field change
  useEffect(() => {
    if (limitError) return;
    const f = { name, mood, assigned };
    if (!f.name.trim() || !f.mood || !f.assigned.length) return;
    if (!taskIdRef.current && !hasEverHadRequiredFields.current) {
      hasEverHadRequiredFields.current = true;
      flushSave();
      return;
    }
    scheduleSave();
  }, [name, mood, assigned, clientId, date, postingDate, status, estH, estM, notes, tags, subtasks, links, scheduleSave, flushSave]);

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    const d = Math.floor(h / 24);
    return d + 'd ago';
  }

  function fmtDT(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function actDesc(a) {
    const n = a.userName;
    switch (a.action) {
      case 'created': return n + ' created this task';
      case 'updated': return n + ' changed title';
      case 'status_changed': return n + ' changed status' + (a.newValue ? ' to ' + a.newValue : '');
      case 'marked_for_review': return n + ' marked this task for review';
      case 'mood_changed': return n + ' changed mood';
      case 'date_changed': return n + ' changed date' + (a.newValue ? ' to ' + a.newValue : '');
      case 'notes_updated': return n + ' updated notes';
      case 'client_changed': return n + ' changed client';
      case 'assigned_changed': return n + ' updated assignees';
      case 'hidden': return n + ' hid this task';
      case 'unhidden': return n + ' unhid this task';
      case 'deleted': return n + ' moved this task to deleted';
      case 'recovered': return n + ' recovered this task';
      case 'subtask_added': return n + ' added subtask' + (a.newValue ? ' "' + a.newValue + '"' : '');
      case 'subtask_completed': return n + ' completed subtask' + (a.newValue ? ' "' + a.newValue + '"' : '');
      case 'subtask_deleted': return n + ' removed subtask' + (a.oldValue ? ' "' + a.oldValue + '"' : '');
      case 'link_added': return n + ' added link' + (a.newValue ? ' ' + a.newValue : '');
      case 'link_removed': return n + ' removed link' + (a.oldValue ? ' ' + a.oldValue : '');
      case 'tag_added': return n + ' added a tag';
      case 'tag_removed': return n + ' removed a tag';
      default: return n + ' performed ' + a.action;
    }
  }

  // auto-save draft on every meaningful change
  useEffect(() => {
    saveDraft({
      _taskId: draftId,
      name, mood, assigned, clientId, date, postingDate, status,
      estH, estM, notes, tags, subtasks, links,
      newTag, newSubtask, newLinkLabel, newLinkUrl, tDetailTab,
    });
  }, [name, mood, assigned, clientId, date, postingDate, status, estH, estM, notes, tags, subtasks, links, newTag, newSubtask, newLinkLabel, newLinkUrl, tDetailTab, draftId]);

  const toggle = (arr, set, id) =>
    set(arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id]);

  const dateOffset = (days) => {
    const d = new Date((date || today()) + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  };

  const addTagInline = async () => {
    const label = newTag.trim();
    if (!label) return;
    let existing = S.tags.find(t => t.label.toLowerCase() === label.toLowerCase());
    if (!existing) {
      existing = { id: uid(), label, color: COLORS[S.tags.length % COLORS.length] };
      await upsertTag(existing);
    }
    if (!tags.includes(existing.id)) setTags([...tags, existing.id]);
    setNewTag('');
  };

  const addSubtaskInline = () => {
    const text = newSubtask.trim();
    if (!text) return;
    setSubtasks([...subtasks, { text, done: false, id: uid(), order: subtasks.length }]);
    setNewSubtask('');
  };

  const toggleSubtask = useCallback((i) => {
    setSubtasks((prev) => prev.map((s, idx) => idx === i ? { ...s, done: !s.done } : s));
  }, []);

  const editSubtaskText = useCallback((i, text) => {
    text = text.trim();
    if (text) {
      setSubtasks(prev => prev.map((s, idx) => idx === i ? { ...s, text } : s));
    }
  }, []);

  const delSubtask = useCallback((i) => {
    setSubtasks(prev => prev.filter((_, idx) => idx !== i));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    setSubtasks((prev) => {
      const oldIdx = prev.findIndex(s => s.id === active.id);
      const newIdx = prev.findIndex(s => s.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      return arrayMove(prev, oldIdx, newIdx).map((s, i) => ({ ...s, order: i }));
    });
  };

  const addLinkInline = () => {
    const url = newLinkUrl.trim();
    if (!url) return;
    const label = newLinkLabel.trim();
    setLinks([...links, { label, url }]);
    setNewLinkLabel('');
    setNewLinkUrl('');
  };

  const delLink = (i) => {
    setLinks(links.filter((_, idx) => idx !== i));
  };

  const handleLinkTask = async () => {
    const tid = task.id || taskIdRef.current;
    if (!linkSsId || !linkMsId || !tid) return;
    const ms = S.milestones.find(m => m.id === linkMsId);
    if (!ms) return;
    const updated = {
      ...ms,
      substeps: ms.substeps.map(s => s.id === linkSsId ? {
        ...s,
        linkedTasks: [...(s.linkedTasks||[]), { taskId: tid, showOnDashboard: false }]
      } : s)
    };
    await upsertMilestone(updated);
    setLinkMsId('');
    setLinkSsId('');
    setShowMsPicker(false);
    setShowNewSubstepInput(false);
    setNewSubstepTitle('');
  };

  const handleAddNewSubstep = async () => {
    if (!newSubstepTitle.trim() || !linkMsId) return;
    const ms = S.milestones.find(m => m.id === linkMsId);
    if (!ms) return;
    const newSs = { id: uid(), title: newSubstepTitle.trim(), done: false, linkedTasks: [] };
    const updated = { ...ms, substeps: [...(ms.substeps || []), newSs] };
    await upsertMilestone(updated);
    setLinkSsId(newSs.id);
    setShowNewSubstepInput(false);
    setNewSubstepTitle('');
  };

  const handleOpenPicker = () => {
    setLinkMsId('');
    setLinkSsId('');
    setShowMsPicker(true);
  };

  const handleCancelPicker = () => {
    setLinkMsId('');
    setLinkSsId('');
    setShowMsPicker(false);
    setShowNewSubstepInput(false);
    setNewSubstepTitle('');
  };

  const handleUnlinkTask = async (msId, ssId) => {
    const tid = task.id || taskIdRef.current;
    if (!tid || !msId || !ssId) return;
    const { milestones } = useStore.getState().S;
    const ms = milestones.find(m => m.id === msId);
    if (!ms) return;
    const updated = {
      ...ms,
      substeps: ms.substeps.map(s => s.id === ssId ? {
        ...s,
        linkedTasks: (s.linkedTasks||[]).filter(lt => lt.taskId !== tid)
      } : s)
    };
    try {
      await upsertMilestone(updated);
    } catch (err) {
      console.error('[UnlinkTask] upsertMilestone FAILED', err);
    }
  };

  const handleMoveTask = async (msId, fromSsId, toSsId) => {
    const tid = task.id || taskIdRef.current;
    if (!tid || !msId || !fromSsId || !toSsId || fromSsId === toSsId) return;
    const ms = S.milestones.find(m => m.id === msId);
    if (!ms) return;
    const updated = {
      ...ms,
      substeps: ms.substeps.map(s => {
        if (s.id === fromSsId) {
          return { ...s, linkedTasks: (s.linkedTasks||[]).filter(lt => lt.taskId !== tid) };
        }
        if (s.id === toSsId) {
          return { ...s, linkedTasks: [...(s.linkedTasks||[]), { taskId: tid, showOnDashboard: false }] };
        }
        return s;
      })
    };
    try {
      await upsertMilestone(updated);
    } catch (err) {
      console.error('[MoveTask] upsertMilestone FAILED', err);
    }
  };

  const del = async () => {
    if (!confirm('Delete this task? It moves to Deleted Tasks where you can recover it.')) return;
    await softDeleteTask(task.id);
    clearDraft();
    onClose();
  };

  return (<>
    <div className="mbg" onMouseDown={(e)=>e.target===e.currentTarget&&tryCloseModal()}>
      <div className="modal modal-lg" onMouseDown={e=>e.stopPropagation()}>
        <h2 style={{marginBottom:4}}>{isEdit ? 'Edit task' : 'New task'}</h2>
        {fromCellText && (
          <div style={{fontSize:12,color:'var(--t2)',marginBottom:10,fontStyle:'italic'}}>
            From cell: &ldquo;{fromCellText}&rdquo;
          </div>
        )}
        <div style={{fontSize:11,color:'var(--warn)',marginBottom:10}}>* Task name, assigned to &amp; mood are required</div>

        {nudgeMsg && <div className="nudge-banner">{nudgeMsg}</div>}

        {isEdit && (task.createdBy || task.updatedBy) && (
          <div style={{fontSize:11,color:'var(--t2)',marginBottom:10,lineHeight:1.6}}>
            {task.createdBy && <span>Created by: {S.members.find(m=>m.id===task.createdBy)?.name || 'Unknown'} &bull; {fmtDT(task.createdAt)}</span>}
            {task.createdBy && task.updatedBy && <br />}
            {task.updatedBy && task.updatedAt !== task.createdAt && <span>Last updated by: {S.members.find(m=>m.id===task.updatedBy)?.name || 'Unknown'} &bull; {fmtDT(task.updatedAt)}</span>}
          </div>
        )}

        <label className="fl" style={{marginTop:0}}>Task name *</label>
        <input ref={taskNameRef} id="tn" type="text" placeholder="What needs to be done?" value={name}
          className={err.name?'req':''} onChange={e=>setName(e.target.value)} />

        {/* ── Section tabs ── */}
        <div className="modal-section-tabs">
          <button className={`modal-section-tab${tab==='essentials'?' active':''}`} onClick={()=>setTab('essentials')}>Section 1 &mdash; Essentials</button>
          <button className={`modal-section-tab${tab==='details'?' active':''}`} onClick={()=>setTab('details')}>
            Section 2 &mdash; Details
            {hasDetailContent && <span className="badge-dot" />}
          </button>
          <button className={`modal-section-tab${tab==='s3'?' active':''}`} onClick={()=>setTab('s3')}>
            Section 3 &mdash; More
            {linkedMilestones.length > 0 && <span className="s3-count-badge">{linkedMilestones.length}</span>}
          </button>
        </div>

        {/* ── Section 1 — Essentials ── */}
        <div className={`modal-section${tab==='essentials'?' active':''}`}>
          <label className="fl">Mood *</label>
          <div id="mprow" className="mood-pick-row horizontal-scroll" style={err.mood?{outline:'2px solid var(--warn)',borderRadius:8,padding:4}:{}}>
            {S.moods.map(m => {
              const on = mood === m.id;
              const moodLimit = m.max;
              const moodFull = moodLimit !== null && assigned.length > 0 && (() => {
                const d = date || today();
                const c = S.tasks.filter(t =>
                  t.assignedTo?.some(a => assigned.includes(a)) &&
                  t.date === d && !t.deleted &&
                  t.status !== getCompleteStatus(S.task_statuses) &&
                  t.status !== getPassStatus(S.task_statuses) &&
                  t.mood === m.id && t.id !== task.id
                ).length;
                return c >= moodLimit;
              })();
              return (
                <div key={m.id} className={`mood-opt-btn${on?' on':''}`}
                  style={{
                    ...(on?{background:m.bg,color:m.color,borderColor:m.color,borderWidth:2}:{}),
                    ...(moodFull && !on ? {opacity:0.4,cursor:'not-allowed'} : {}),
                  }}
                  onClick={() => { if (!moodFull) setMood(m.id); }}>
                  {m.icon} {m.label}{moodLimit !== null ? <span style={{fontSize:9,opacity:.6}}> max{moodLimit}</span> : null}
                  {moodFull ? <span style={{fontSize:9,marginLeft:4,color:'var(--warn)'}}>full</span> : null}
                </div>
              );
            })}
          </div>

          <label className="fl">Assign to *</label>
          {readonlyAssignee ? (
            <div className="ttag-row horizontal-scroll">
              {assigned.map(id => {
                const m = S.members.find(m => m.id === id);
                return m ? (
                  <div key={id} className="ttagopt on" style={{cursor:'default',opacity:0.8}}>
                    <Avatar name={m.name} color={m.color} size={16} /> {m.name}
                  </div>
                ) : null;
              })}
            </div>
          ) : (
            <div id="tarow" className="ttag-row horizontal-scroll" style={err.assigned?{outline:'2px solid var(--warn)',borderRadius:8,padding:4}:{}}>
              {S.members.map(m => (
                <div key={m.id} className={`ttagopt${assigned.includes(m.id)?' on':''}`}
                  onClick={()=>toggle(assigned,setAssigned,m.id)}>
                  <Avatar name={m.name} color={m.color} size={16} /> {m.name}
                </div>
              ))}
            </div>
          )}

          <label className="fl">Client / Project</label>
          <div className="ttag-row horizontal-scroll">
            {sel.scl(S).map(c => {
              const on = clientId === c.id;
              return (
                <div key={c.id} onClick={()=>setClientId(on?'':c.id)}
                  className={`ttagopt${on?' on':''}`}
                  style={on?{borderColor:c.color,background:c.color+'18',color:c.color}:{}}>
                  {c.name}
                </div>
              );
            })}
          </div>

          <label className="fl">Date</label>
          <div style={{display:'flex',alignItems:'center',gap:6,marginTop:6,flexWrap:'wrap'}}>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{width:150}} />
            <button className="btn btn-xs" onClick={()=>setDate(today())}>Today</button>
            <button className="btn btn-xs" onClick={()=>dateOffset(1)}>Tomorrow</button>
            <button className="btn btn-xs" onClick={()=>dateOffset(-1)}>Yesterday</button>
          </div>

          <div style={{display:'flex',gap:16,alignItems:'flex-start',marginTop:6}}>
            <div style={{flex:1,minWidth:0}}>
              <label className="fl" style={{marginTop:0}}>Status</label>
              <select value={status} onChange={e=>setStatus(e.target.value)} style={{width:'100%',maxWidth:200}}>
                {roleStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{flexShrink:0}}>
              <label className="fl" style={{marginTop:0}}>Est. time</label>
              <div style={{display:'flex',gap:6,alignItems:'center',marginTop:6}}>
                <input type="number" min="0" max="99" placeholder="0" value={estH}
                  onChange={e=>setEstH(e.target.value)} style={{width:58}} /> <span style={{fontSize:12,color:'var(--t2)'}}>h</span>
                <input type="number" min="0" max="59" placeholder="0" value={estM}
                  onChange={e=>setEstM(e.target.value)} style={{width:58}} /> <span style={{fontSize:12,color:'var(--t2)'}}>m</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 2 — Details ── */}
        <div className={`modal-section${tab==='details'?' active':''}`}>
          <label className="fl" style={{marginTop:0}}>Notes</label>
          <RichTextEditor value={notes} onChange={setNotes} />

          <label className="fl">Tags</label>
          <div className="tag-chip-pick horizontal-scroll">
            {(S.tags||[]).map(tg => (
              <div key={tg.id} className={`tcp${tags.includes(tg.id)?' on':''}`}
                onClick={()=>toggle(tags,setTags,tg.id)}>{tg.label}</div>
            ))}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:6}}>
            <input type="text" placeholder="Type new tag + Enter" value={newTag}
              onChange={e=>setNewTag(e.target.value)}
              onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); addTagInline(); } }}
              style={{flex:1,padding:'5px 9px'}} />
            <button className="btn btn-sm" onClick={addTagInline}>+ Tag</button>
          </div>

          <label className="fl">Posting date</label>
          <div style={{display:'flex',alignItems:'center',gap:6,marginTop:6,flexWrap:'wrap'}}>
            <input type="date" value={postingDate} onChange={e=>setPostingDate(e.target.value)} style={{width:150}} />
            <button className="btn btn-xs" onClick={()=>setPostingDate(today())}>Today</button>
            <button className="btn btn-xs" onClick={()=>{
              const d = new Date((postingDate||today()) + 'T12:00:00');
              d.setDate(d.getDate() + 1);
              setPostingDate(d.toISOString().slice(0, 10));
            }}>Tomorrow</button>
            <button className="btn btn-xs" onClick={()=>setPostingDate('')}>Clear</button>
          </div>
          <div style={{fontSize:10,color:'var(--t3)',marginTop:4}}>Used in SM Calendar posting view</div>

          {/* ── Subtasks, Links & Activity tabs ── */}
          <div className="tdetail-tabs">
            <div className={`tdetail-tab${tDetailTab==='sub'?' active':''}`} onClick={()=>setTDetailTab('sub')}>
              ☑ Subtasks {subtasks.length ? `(${subtasks.filter(Boolean).filter(s=>s.done).length}/${subtasks.length})` : ''}
            </div>
            <div className={`tdetail-tab${tDetailTab==='links'?' active':''}`} onClick={()=>setTDetailTab('links')}>
              🔗 Links {links.length ? `(${links.length})` : ''}
            </div>
            <div className={`tdetail-tab${tDetailTab==='act'?' active':''}`} onClick={()=>setTDetailTab('act')}>
              📋 Activity {activity.length ? `(${activity.length})` : ''}
            </div>
          </div>

          {/* ── Subtasks tab content ── */}
          <div className={`tdetail-tab-content${tDetailTab==='sub'?' active':''}`}>
            {subtasks.length > 0 && (
              <div className="subtask-progress-mini">
                <div className="subtask-bar-track">
                  <div className="subtask-bar-fill" style={{width:`${Math.round(subtasks.filter(Boolean).filter(s=>s.done).length/subtasks.length*100)}%`}} />
                </div>
                <span style={{fontSize:11,color:'var(--t2)',fontWeight:700,whiteSpace:'nowrap'}}>
                  {subtasks.filter(Boolean).filter(s=>s.done).length}/{subtasks.length}
                </span>
              </div>
            )}
            <div className="subtask-dnd-wrap">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={subtasks.map(s => s.id)} strategy={verticalListSortingStrategy}>
                  {subtasks.map((s, i) => (
                    <SortableSubtaskRow
                      key={s.id}
                      subtask={s}
                      index={i}
                      onToggle={toggleSubtask}
                      onEdit={editSubtaskText}
                      onDelete={delSubtask}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
            <div className="subtask-add-row">
              <input type="text" placeholder="Add a subtask + Enter" value={newSubtask}
                onChange={e=>setNewSubtask(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addSubtaskInline();}}}
                style={{flex:1,fontSize:13}} />
              <button className="btn btn-sm" onClick={addSubtaskInline}>+ Add</button>
            </div>
          </div>

          {/* ── Links tab content ── */}
          <div className={`tdetail-tab-content${tDetailTab==='links'?' active':''}`}>
            <div>
              {links.map((l, i) => {
                let safeUrl = l.url;
                if (!/^https?:\/\//i.test(safeUrl)) safeUrl = 'https://' + safeUrl;
                return (
                  <div key={i} className="link-row">
                    <span style={{flexShrink:0}}>🔗</span>
                    <a href={safeUrl} target="_blank" rel="noopener noreferrer">{l.label || l.url}</a>
                    <button className="link-del" onClick={()=>delLink(i)}>✕</button>
                  </div>
                );
              })}
            </div>
            <div className="link-add-row">
              <input type="text" placeholder="Label (optional)" value={newLinkLabel}
                onChange={e=>setNewLinkLabel(e.target.value)} style={{width:140,fontSize:12}} />
              <input type="text" placeholder="https://…" value={newLinkUrl}
                onChange={e=>setNewLinkUrl(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addLinkInline();}}}
                style={{flex:1,fontSize:12}} />
              <button className="btn btn-sm" onClick={addLinkInline}>+ Add</button>
            </div>
          </div>

          {/* ── Activity tab content ── */}
          <div className={`tdetail-tab-content${tDetailTab==='act'?' active':''}`}>
            {activity.length === 0 && (
              <div style={{fontSize:12,color:'var(--t3)',padding:'12px 0'}}>No activity yet.</div>
            )}
            {activity.map(a => (
              <div key={a.id} style={{display:'flex',alignItems:'baseline',gap:8,padding:'5px 0',fontSize:12,borderBottom:'1px solid var(--b3)'}}>
                <span style={{color:'var(--t3)',whiteSpace:'nowrap',flexShrink:0}}>{timeAgo(a.createdAt)}</span>
                <span style={{color:'var(--t1)'}}>{actDesc(a)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Section 3 — More ── */}
        <div className={`modal-section${tab==='s3'?' active':''}`}>
          <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap'}}>
            {[
              { id:'milestone', label:'Milestone' },
              { id:'checklist', label:'Checklist' },
              { id:'batch', label:'Batch task' },
            ].map(st => {
              const isActive = st.id === 'milestone';
              return (
                <button key={st.id}
                  className={`s3-subtab${s3Tab===st.id?' active':''}${!isActive?' coming-soon':''}`}
                  onClick={isActive ? () => setS3Tab(st.id) : undefined}>
                  {st.label}
                </button>
              );
            })}
          </div>

          {s3Tab === 'milestone' && (
            <div>
              {!(task.id || taskIdRef.current) ? (
                <div style={{color:'var(--t3)',padding:'8px 0',fontSize:12}}>Save the task first to link it to a milestone.</div>
              ) : showMsPicker ? (
                <div>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--t2)'}}>{linkMsId ? 'Select substep' : 'Link to milestone'}</span>
                    <button className="btn btn-xs" onClick={handleCancelPicker} style={{marginLeft:'auto'}}>Cancel</button>
                  </div>
                  {!linkMsId ? (
                    <div className="search-wrap">
                      <div className="search-bar">
                        <i style={{fontSize:12,color:'var(--t3)'}}>🔍</i>
                        <input type="text" placeholder="Search milestones..." value={msSearch}
                          onChange={e => setMsSearch(e.target.value)} autoFocus />
                      </div>
                      <div className="search-results">
                        {filteredMilestones.map(m => {
                          const client = m.clientId ? sel.gc(S, m.clientId) : null;
                          const assignees = (m.assignedTo || []).map(id => sel.gm(S, id)).filter(Boolean);
                          const total = (m.substeps||[]).filter(Boolean).length;
                          const done = (m.substeps||[]).filter(Boolean).filter(s => s.done).length;
                          return (
                            <div key={m.id} className="search-item" onClick={() => { setLinkMsId(m.id); setLinkSsId(''); setMsSearch(''); }}>
                              <div className="search-item-name">{m.title}</div>
                              <div className="search-item-meta">
                                {assignees.length > 0 && <span>{assignees.map(a => a.name).join(', ')}</span>}
                                {client && <span className="search-item-client">{client.name}</span>}
                                <span className="search-item-progress">{done}/{total} done</span>
                              </div>
                            </div>
                          );
                        })}
                        {filteredMilestones.length === 0 && (
                          <div style={{padding:'20px',textAlign:'center',color:'var(--t3)',fontSize:12}}>No milestones match your search.</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <button className="btn btn-xs" onClick={() => { setLinkMsId(''); setLinkSsId(''); setShowNewSubstepInput(false); setNewSubstepTitle(''); }} style={{marginBottom:8}}>← Back</button>
                      <label className="fl" style={{marginTop:0}}>Select substep</label>
                      <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:8}}>
                        {(S.milestones.find(m => m.id === linkMsId)?.substeps||[]).map(ss => (
                          <label key={ss.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 10px',borderRadius:6,border:'1px solid var(--border)',cursor:'pointer',background:linkSsId===ss.id?'var(--al)':'var(--surface)'}}>
                            <input type="radio" name="ss" checked={linkSsId===ss.id} onChange={()=>setLinkSsId(ss.id)} />
                            <span style={{fontSize:13}}>{ss.title || '(Untitled)'}</span>
                          </label>
                        ))}
                        {!showNewSubstepInput ? (
                          <button className="ms-empty-btn" style={{fontSize:12,padding:'6px 10px',marginTop:4,textAlign:'left'}} onClick={() => setShowNewSubstepInput(true)}>
                            + New substep
                          </button>
                        ) : (
                          <div style={{display:'flex',alignItems:'center',gap:4,marginTop:4}}>
                            <input type="text" placeholder="Substep title…" value={newSubstepTitle}
                              onChange={e => setNewSubstepTitle(e.target.value)} style={{flex:1,fontSize:12}} autoFocus />
                            <button className="btn btn-xs" disabled={!newSubstepTitle.trim()} onClick={handleAddNewSubstep}>Add</button>
                            <button className="btn btn-xs btn-g" onClick={() => { setShowNewSubstepInput(false); setNewSubstepTitle(''); }}>✕</button>
                          </div>
                        )}
                      </div>
                      <button className="btn btn-sm" disabled={!linkSsId} onClick={handleLinkTask}>Link Task</button>
                    </>
                  )}
                </div>
              ) : linkedMilestones.length > 0 ? (
                <>
                  {linkedMilestones.map(link => {
                    const total = (link.milestone.substeps||[]).filter(Boolean).length;
                    const done = (link.milestone.substeps||[]).filter(Boolean).filter(s => s.done).length;
                    return (
                      <div key={link.milestone.id+'_'+link.substep.id} className="ms-card">
                        <div className="ms-card-row">
                          <div className="ms-card-icon-sq"><i>◆</i></div>
                          <span className="ms-card-tag">◆ MILESTONE</span>
                          <span className="ms-card-title">{link.milestone.title}</span>
                        </div>
                        <div className="ms-card-divider" />
                        <div className="ms-card-row">
                          <div className="ms-card-icon-sq ms-card-icon-grey"><i>⊞</i></div>
                          <span className="ms-card-sub-label">SUBSTEP</span>
                          <span className="ms-card-sub-name">{link.substep.title}</span>
                        </div>
                        <div className="ms-card-row" style={{marginTop:4}}>
                          <span style={{fontSize:10,color:'var(--t2)',fontWeight:600}}>Progress: {done}/{total}</span>
                        </div>
                        <div className="ms-card-actions">
                          <button className="ms-card-btn" onClick={() => setMsModal(link.milestone)}>
                            <i>✎</i> Edit milestone
                          </button>
                          {link.milestone.substeps.length > 1 && (
                            <select value="" className="ms-card-select"
                              onChange={(e) => { const to = e.target.value; if (to) handleMoveTask(link.milestone.id, link.substep.id, to); }}
                            >
                              <option value="" disabled>⇄ Move to…</option>
                              {link.milestone.substeps.filter(Boolean).filter(s => s.id !== link.substep.id).map(s => (
                                <option key={s.id} value={s.id}>{s.title || '(Untitled)'}</option>
                              ))}
                            </select>
                          )}
                          <button className="ms-card-btn ms-card-btn-unlink" onClick={() => handleUnlinkTask(link.milestone.id, link.substep.id)}>
                            <i>⊘</i> Unlink
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <button className="ms-empty-btn" onClick={handleOpenPicker} style={{marginTop:8}}>
                    <i>+</i> Add another milestone
                  </button>
                </>
              ) : (
                <div className="ms-empty">
                  <div style={{fontSize:28,color:'var(--t3)',lineHeight:1}}><i>◆</i></div>
                  <p>This task is not linked to any milestone yet.</p>
                  <button className="ms-empty-btn" onClick={handleOpenPicker}>
                    <i>+</i> Link to a milestone
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {limitError && <div style={{marginTop:10,padding:'8px 12px',background:'#d32f2f22',border:'1px solid #d32f2f',borderRadius:6,color:'#d32f2f',fontSize:13,fontWeight:600}}>
          {limitError}
        </div>}
        <div className="modal-footer">
          <div className="modal-footer-left">
            {isEdit && canDeleteTask(session, task) && <button className="btn btn-d" onClick={del}>🗑 Delete</button>}
            <button className="modal-close-text" onClick={tryCloseModal}>Close</button>
          </div>
          <div className="modal-footer-right">
            {saveStatus === 'saving' && <span style={{fontSize:12,color:'var(--t3)',fontWeight:600}}>Saving…</span>}
            {saveStatus === 'saved' && <span style={{fontSize:12,color:'var(--accent)',fontWeight:600}}>Auto-saved</span>}
            {saveStatus === 'error' && <span style={{fontSize:12,color:'var(--warn)',fontWeight:600}}>Couldn't save. Retrying…</span>}
            <button className="btn" disabled={(!isEdit && (!name.trim() || !mood || !assigned.length)) || !!limitError} onClick={tryCloseModal}>Save Task</button>
            {onSaveAsTemplate && (
              <button className="btn btn-outline" onClick={() => onSaveAsTemplate({
                name, clientId, mood, assignedTo: [...assigned],
                estH: parseInt(estH) || 0, estM: parseInt(estM) || 0,
                notes, tags: [...tags],
                subtasks: subtasks.map(s => ({ ...s })),
                links: links.map(l => ({ ...l })),
              })}>Save as Template</button>
            )}
          </div>
        </div>
      </div>
    </div>
    {msModal && (
      <MilestoneModal
        milestone={msModal}
        onClose={() => setMsModal(null)}
      />
    )}
  </>);
}

const SortableSubtaskRow = memo(function SortableSubtaskRow({ subtask, index, onToggle, onEdit, onDelete }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: subtask.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(isDragging ? { boxShadow: '0 4px 12px rgba(0,0,0,0.15)' } : {}),
  };

  return (
    <div ref={setNodeRef} style={style} className={`subtask-row${subtask.done ? ' done' : ''}${isDragging ? ' dragging' : ''}`}>
      <span className="subtask-drag-handle" {...attributes} {...listeners} onClick={e => e.stopPropagation()}>
        ⋮⋮
      </span>
      <div className={`subtask-check${subtask.done ? ' checked' : ''}`} onClick={(e) => { e.stopPropagation(); onToggle(index); }}>
        {subtask.done ? '✓' : ''}
      </div>
      <span className="subtask-text"
        contentEditable suppressContentEditableWarning
        onBlur={(e) => onEdit(index, e.currentTarget.textContent)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}>
        {subtask.text}
      </span>
      <button className="subtask-del" onClick={(e) => { e.stopPropagation(); onDelete(index); }}>✕</button>
    </div>
  );
});
