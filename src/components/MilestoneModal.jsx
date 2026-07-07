import { useState, useMemo, useRef, useCallback, useEffect, memo } from 'react';
import { DndContext, PointerSensor, TouchSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore, sel } from '../store/useStore';
import { today, uid, getDeadlineClass, getDeadlineLabel } from '../lib/constants';

function getSubstepStatus(substep, allTasks) {
  const links = substep.linkedTasks || [];
  if (links.length === 0) return null;
  const task = allTasks.find(t => t.id === links[0].taskId);
  if (!task || !task.date || task.status === 'Complete' || task.deleted) return null;
  const now = new Date();
  const todayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0];
  const taskDateStr = task.date.split('T')[0];
  if (taskDateStr < todayStr) {
    const d1 = new Date(taskDateStr + 'T00:00:00');
    const d2 = new Date(todayStr + 'T00:00:00');
    const diff = Math.round((d2 - d1) / 86400000);
    return { type: 'overdue', label: `${diff}d late` };
  }
  if (taskDateStr === todayStr) return { type: 'today', label: 'today' };
  return null;
}

function getUrgentCount(substep, allTasks) {
  let count = 0;
  const now = new Date();
  const todayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0];
  for (const link of (substep.linkedTasks || [])) {
    const task = allTasks.find(t => t.id === link.taskId);
    if (!task || !task.date || task.status === 'Complete' || task.deleted) continue;
    const taskDateStr = task.date.split('T')[0];
    if (taskDateStr < todayStr || taskDateStr === todayStr) count++;
  }
  return count;
}

const migrateSS = (ss) => {
  if (ss.linkedTaskId && !ss.linkedTaskIds && !ss.linkedTasks) {
    return {
      ...ss,
      linkedTasks: [{ taskId: ss.linkedTaskId, showOnDashboard: ss.showOnDashboard || false }],
      linkedTaskId: undefined,
      showOnDashboard: undefined
    };
  }
  if (ss.linkedTaskIds && !ss.linkedTasks) {
    return {
      ...ss,
      linkedTasks: ss.linkedTaskIds.map(taskId => ({
        taskId,
        showOnDashboard: ss.showOnDashboard || false
      })),
      linkedTaskIds: undefined,
      showOnDashboard: undefined
    };
  }
  if (!ss.linkedTasks) {
    return { ...ss, linkedTasks: [] };
  }
  return ss;
};

export default function MilestoneModal({ milestone, onClose, onOpenTask, onCreateTaskForSubstep }) {
  const S = useStore(s => s.S);
  const upsertMilestone = useStore(s => s.upsertMilestone);
  const delMilestone = useStore(s => s.delMilestone);
  const softDeleteTask = useStore(s => s.softDeleteTask);

  const isEdit = !!milestone;
  const [m, setM] = useState(() => milestone ? {
    ...milestone,
    substeps: (milestone.substeps || []).map(migrateSS),
    displayMode: milestone.displayMode || 'daily',
    displayDays: milestone.displayDays || [],
  } : {
    id: null, title: '', mood: '', assignedTo: [], clientId: '', date: today(), deadline: '',
    substeps: [], displayMode: 'daily', displayDays: [], notes: '',
  });
  const [tab, setTab] = useState(0);
  const [expandedSS, setExpandedSS] = useState({});
  const [taskSearch, setTaskSearch] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [triedSave, setTriedSave] = useState(false);

  const milestoneIdRef = useRef(milestone?.id || null);
  const [saveStatus, setSaveStatus] = useState(milestone?.id ? 'idle' : 'idle');
  const debounceRef = useRef(null);
  const fieldsRef = useRef({});
  const lastSnapshot = useRef('');
  const retryCount = useRef(0);
  const mountedRef = useRef(true);
  const hasEverHadRequiredFields = useRef(false);
  const saveStatusTimer = useRef(null);
  const saveQueue = useRef(Promise.resolve());

  const ssSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 5 } }),
  );
  const taskSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleSSDragEnd = useCallback((event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    setM(prev => {
      const oldIdx = prev.substeps.findIndex(s => s.id === active.id);
      const newIdx = prev.substeps.findIndex(s => s.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      return { ...prev, substeps: arrayMove(prev.substeps, oldIdx, newIdx) };
    });
  }, []);

  const handleTaskDragEnd = useCallback((ssId, event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;
    setM(prev => ({
      ...prev,
      substeps: prev.substeps.map(s => {
        if (s.id !== ssId) return s;
        const oldIdx = s.linkedTasks.findIndex(lt => lt.taskId === active.id);
        const newIdx = s.linkedTasks.findIndex(lt => lt.taskId === over.id);
        if (oldIdx === -1 || newIdx === -1) return s;
        return { ...s, linkedTasks: arrayMove(s.linkedTasks, oldIdx, newIdx) };
      })
    }));
  }, []);

  // Initialize snapshot on first render to prevent auto-save on mount for existing milestones
  if (milestone?.id && lastSnapshot.current === '') {
    lastSnapshot.current = JSON.stringify([
      (milestone.title || '').trim(), milestone.mood || '', [...(milestone.assignedTo || [])].sort(),
      milestone.clientId || '', milestone.date || '', milestone.deadline || '',
      JSON.stringify(milestone.substeps || []), milestone.displayMode || 'daily', [...(milestone.displayDays || [])].sort(),
      milestone.notes || '',
    ]);
  }

  useEffect(() => { return () => { mountedRef.current = false; }; }, []);

  // Keep a ref with the latest field values (no stale closures in debounce callbacks)
  useEffect(() => {
    fieldsRef.current = {
      title: m.title, mood: m.mood, assignedTo: [...(m.assignedTo || [])],
      clientId: m.clientId || '', date: m.date, deadline: m.deadline || '',
      substeps: (m.substeps || []).map(s => ({ ...s })),
      displayMode: m.displayMode, displayDays: [...(m.displayDays || [])],
      notes: m.notes || '',
    };
  });

  const doSave = useCallback((overrideSubsteps) => {
    const result = saveQueue.current.catch(() => {}).then(async () => {
      const f = fieldsRef.current;
      const currentId = milestoneIdRef.current;
      if (!f.title?.trim() || !f.clientId || !f.assignedTo?.length) return null;

      const substepsToSave = overrideSubsteps !== undefined
        ? overrideSubsteps.map(s => ({ ...s }))
        : f.substeps.map(s => ({ ...s }));

      const snapshot = JSON.stringify([
        f.title.trim(), f.mood || '', [...f.assignedTo].sort(),
        f.clientId || '', f.date || '', f.deadline || '',
        JSON.stringify(substepsToSave), f.displayMode || 'daily', [...f.displayDays].sort(),
        f.notes || '',
      ]);
      if (snapshot === lastSnapshot.current && currentId && !overrideSubsteps) return null;

      if (mountedRef.current) setSaveStatus('saving');

      const payload = {
        ...(currentId ? { id: currentId } : {}),
        title: f.title.trim(), mood: f.mood || '', assignedTo: [...f.assignedTo],
        clientId: f.clientId || null, date: f.date || '', deadline: f.deadline || null,
        substeps: substepsToSave,
        displayMode: f.displayMode || 'daily', displayDays: [...f.displayDays],
        notes: f.notes || '',
      };
      payload.deleted = false;

      try {
        const saved = await upsertMilestone(payload);
        if (!currentId) {
          milestoneIdRef.current = saved.id;
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
        console.error('[Milestone AutoSave] failed:', err);
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
  }, [upsertMilestone]);

  const flushSave = useCallback(() => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    return doSave();
  }, [doSave]);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(), 600);
  }, [doSave]);

  // Auto-save: debounce on any field change (mirrors TaskModal pattern)
  useEffect(() => {
    const f = { title: m.title, mood: m.mood, assignedTo: m.assignedTo };
    if (!f.title?.trim() || !m.clientId || !f.assignedTo?.length) return;
    if (!milestoneIdRef.current && !hasEverHadRequiredFields.current) {
      hasEverHadRequiredFields.current = true;
      flushSave();
      return;
    }
    scheduleSave();
  }, [m, scheduleSave, flushSave]);

  const subTotal = m.substeps.length;
  const subDone = m.substeps.filter(s => s.done).length;
  const subPct = subTotal ? Math.round(subDone / subTotal * 100) : 0;

  const allTasks = useMemo(() => {
    const sorted = S.tasks.filter(t => !t.deleted && t.status !== 'Complete');
    sorted.sort((a, b) => {
      const aTime = a.updatedAt || a.createdAt || 0;
      const bTime = b.updatedAt || b.createdAt || 0;
      return bTime - aTime;
    });
    return sorted;
  }, [S.tasks]);

  const searchResults = useMemo(() => {
    if (!searchQ.trim()) return allTasks;
    const q = searchQ.toLowerCase();
    return allTasks.filter(t => {
      const nameMatch = t.name.toLowerCase().includes(q);
      const clientMatch = sel.gc(S, t.clientId)?.name?.toLowerCase().includes(q);
      return nameMatch || clientMatch;
    });
  }, [allTasks, searchQ, S]);

  const close = async () => {
    if (m.title.trim() && m.clientId && m.assignedTo.length) {
      await flushSave();
    }
    onClose?.();
  };

  const updateField = (field, value) => setM(prev => ({ ...prev, [field]: value }));

  const toggleAssign = (mid) => {
    setM(prev => ({
      ...prev,
      assignedTo: prev.assignedTo.includes(mid)
        ? prev.assignedTo.filter(id => id !== mid)
        : [...prev.assignedTo, mid]
    }));
  };

  const setClient = (cid) => {
    setM(prev => ({ ...prev, clientId: prev.clientId === cid ? '' : cid }));
  };

  const toggleSubstep = (ssId) => {
    const cur = fieldsRef.current.substeps || [];
    const newSubsteps = cur.map(s => s.id === ssId ? { ...s, done: !s.done } : s);
    setM(prev => ({ ...prev, substeps: newSubsteps }));
    doSave(newSubsteps);
  };

  const updateSubstepTitle = (ssId, title) => {
    setM(prev => ({
      ...prev,
      substeps: prev.substeps.map(s => s.id === ssId ? { ...s, title } : s)
    }));
  };

  const addSubstep = () => {
    const newSs = { id: uid(), title: '', done: false, linkedTasks: [] };
    const cur = fieldsRef.current.substeps || [];
    const newSubsteps = [...cur, newSs];
    setM(prev => ({ ...prev, substeps: newSubsteps }));
    setExpandedSS(prev => ({ ...prev, [newSs.id]: true }));
    doSave(newSubsteps);
  };

  const removeSubstep = (ssId) => {
    const cur = fieldsRef.current.substeps || [];
    const newSubsteps = cur.filter(s => s.id !== ssId);
    setM(prev => ({ ...prev, substeps: newSubsteps }));
    doSave(newSubsteps);
  };

  const linkTaskToSubstep = (ssId, taskId) => {
    const cur = fieldsRef.current.substeps || [];
    const newSubsteps = cur.map(s => s.id === ssId ? {
      ...s,
      linkedTasks: [...(s.linkedTasks||[]), { taskId, showOnDashboard: true }]
    } : s);
    setM(prev => ({ ...prev, substeps: newSubsteps }));
    setTaskSearch(null);
    setSearchQ('');
    doSave(newSubsteps);
  };

  const unlinkFromSubstep = (ssId, taskId) => {
    const cur = fieldsRef.current.substeps || [];
    const newSubsteps = cur.map(s => s.id === ssId ? { ...s, linkedTasks: (s.linkedTasks||[]).filter(lt => lt.taskId !== taskId) } : s);
    setM(prev => ({ ...prev, substeps: newSubsteps }));
    doSave(newSubsteps);
  };

  const toggleTaskDashVisibility = (ssId, taskId) => {
    const cur = fieldsRef.current.substeps || [];
    const newSubsteps = cur.map(s => s.id === ssId ? {
      ...s,
      linkedTasks: (s.linkedTasks||[]).map(lt =>
        lt.taskId === taskId ? { ...lt, showOnDashboard: !lt.showOnDashboard } : lt
      )
    } : s);
    setM(prev => ({ ...prev, substeps: newSubsteps }));
    doSave(newSubsteps);
  };

  const toggleDisplayDays = (day) => {
    setM(prev => ({
      ...prev,
      displayDays: prev.displayDays.includes(day)
        ? prev.displayDays.filter(d => d !== day)
        : [...prev.displayDays, day]
    }));
  };

  const save = async () => {
    if (!m.title.trim() || !m.clientId || !m.assignedTo.length) {
      setTriedSave(true);
      return;
    }
    await flushSave();
    close();
  };

  const handleDeleteMilestone = async () => {
    const substepCount = m.substeps?.length || 0;
    if (!confirm(`Delete milestone?\n\nThis will permanently delete '${m.title}'${substepCount > 0 ? ` and all ${substepCount} substeps` : ''}.`)) return;

    const allLinkedTaskIds = [...new Set(
      (m.substeps || []).flatMap(ss => (ss.linkedTasks || []).map(lt => lt.taskId)).filter(Boolean)
    )];

    if (allLinkedTaskIds.length > 0) {
      let detail = '';
      if (allLinkedTaskIds.length <= 5) {
        detail = '\n\n' + allLinkedTaskIds.map(tid => {
          const task = S.tasks.find(t => t.id === tid);
          return `- "${task?.name || tid}"`;
        }).join('\n');
      }
      const deleteTasks = confirm(
        `Also delete linked tasks?\n\nThis milestone has ${allLinkedTaskIds.length} linked task${allLinkedTaskIds.length > 1 ? 's' : ''} across its substeps. Do you want to permanently delete them too, or keep them as regular tasks?` +
        detail +
        `\n\nPress OK to delete tasks too, or Cancel to keep them as regular tasks.`
      );
      if (deleteTasks) {
        for (const tid of allLinkedTaskIds) { await softDeleteTask(tid); }
      }
    }
    await delMilestone(m.id);
    onClose?.();
  };

  const handleOpenTask = (taskId) => {
    const task = S.tasks.find(t => t.id === taskId);
    if (task && onOpenTask) onOpenTask(task);
  };

  const handleDeleteTask = (ssId, ltObj) => {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    softDeleteTask(ltObj.taskId);
    const cur = fieldsRef.current.substeps || [];
    const newSubsteps = cur.map(s => s.id === ssId ? { ...s, linkedTasks: (s.linkedTasks||[]).filter(lt => lt.taskId !== ltObj.taskId) } : s);
    setM(prev => ({ ...prev, substeps: newSubsteps }));
    doSave(newSubsteps);
  };

  const handleCreateAndLink = (ssId) => {
    const taskData = {
      date: m.date,
      mood: m.mood,
      assignedTo: m.assignedTo.slice(),
      clientId: m.clientId,
    };
    if (onCreateTaskForSubstep) {
      onCreateTaskForSubstep(ssId, taskData, (taskId) => {
        linkTaskToSubstep(ssId, taskId);
      });
    }
  };

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dlClass = getDeadlineClass(m.deadline);
  const dlLabel = getDeadlineLabel(m.deadline);

  const tabs = [
    { idx: 0, label: 'Essentials' },
    { idx: 1, label: 'Substeps' + (subTotal > 0 ? ` (${subTotal})` : '') },
    { idx: 2, label: 'Settings' },
  ];

  return (
    <div className="mbg" style={{zIndex:300}} onClick={close}>
      <div className="modal modal-lg ms-modal" style={{display:'flex',flexDirection:'column',overflow:'hidden',padding:26,background:'var(--surface)',borderRadius:24}} onClick={e => e.stopPropagation()}>

        <h2 style={{marginBottom:4}}>{isEdit ? 'Edit Milestone' : 'New Milestone'}</h2>
        <div style={{fontSize:11,color:'var(--warn)',marginBottom:10}}>* Title, Client, and Assignee are required</div>

        {isEdit && (milestone.createdAt || milestone.updatedAt) && (
          <div style={{fontSize:11,color:'var(--t2)',marginBottom:10,lineHeight:1.6}}>
            {milestone.createdAt && <span>Created by: {S.members.find(m=>m.id===milestone.createdBy)?.name || 'Unknown'} &bull; {fmtDT(milestone.createdAt)}</span>}
          </div>
        )}

        <label className="fl" style={{marginTop:0}}>TITLE *</label>
        <input type="text" placeholder="What's the milestone?" value={m.title}
          onChange={e=>updateField('title',e.target.value)}
          style={{width:'100%',fontSize:14,padding:'9px 12px',border:'1.5px solid var(--border)',borderRadius:'var(--r)',outline:'none',fontFamily:'inherit',background:'var(--surface)',color:'var(--text)'}}
          onFocus={e=>e.target.style.borderColor='var(--accent)'}
          onBlur={e=>e.target.style.borderColor='var(--border)'} />

        <div className="modal-section-tabs" style={{marginTop:14}}>
          {tabs.map(t => (
            <button key={t.idx} className={`modal-section-tab${tab===t.idx?' active':''}`} onClick={()=>setTab(t.idx)}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{flex:1,overflowY:'auto',padding:'16px 0',minHeight:220}}>

          {/* ── SLIDE 0: Essentials ── */}
          <div className={`modal-section${tab===0?' active':''}`}>
            <label className="fl">Mood</label>
            <div className="mood-pick-row">
              {S.moods.map(mood => {
                const on = m.mood === mood.id;
                return (
                  <div key={mood.id} className={`mood-opt-btn${on?' on':''}`}
                    style={on?{background:mood.bg,color:mood.color,borderColor:mood.color,borderWidth:2}:{}}
                    onClick={() => { updateField('mood',mood.id); setTriedSave(false); }}>
                    {mood.icon} {mood.label}
                  </div>
                );
              })}
            </div>

            <label className="fl">Assign to *</label>
            <div className="ttag-row horizontal-scroll" style={triedSave&&!m.assignedTo.length?{outline:'2px solid var(--warn)',borderRadius:8,padding:4}:{}}>
              {S.members.map(mem => (
                <div key={mem.id} className={`ttagopt${m.assignedTo.includes(mem.id)?' on':''}`}
                  onClick={()=>{ toggleAssign(mem.id); setTriedSave(false); }}
                  style={m.assignedTo.includes(mem.id)?{borderColor:mem.color,background:mem.color+'22',color:mem.color}:{}}>
                  <span className="av" style={{width:16,height:16,borderRadius:'50%',fontSize:8,background:mem.color,color:'#fff',display:'inline-flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {mem.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                  </span>
                  {mem.name}
                </div>
              ))}
            </div>
            {triedSave && !m.assignedTo.length && <div style={{fontSize:11,color:'var(--warn)',marginTop:4}}>Select at least one member</div>}

            <label className="fl">Client / Project *</label>
            <div className="ttag-row horizontal-scroll" style={triedSave&&!m.clientId?{outline:'2px solid var(--warn)',borderRadius:8,padding:4}:{}}>
              {sel.scl(S).map(c => {
                const on = m.clientId === c.id;
                const col = c.color || 'var(--accent)';
                return (
                  <div key={c.id} onClick={()=>{setClient(c.id); setTriedSave(false);}}
                    className={`ms-client-chip${on?' on':''}`}
                    style={on?{borderColor:col,background:col+'18',color:col}:{}}>
                    {c.name}
                  </div>
                );
              })}
            </div>
            {triedSave && !m.clientId && <div style={{fontSize:11,color:'var(--warn)',marginTop:4}}>Select a client</div>}

            <label className="fl">Date</label>
            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:6,flexWrap:'wrap'}}>
              <input type="date" value={m.date} onChange={e=>updateField('date',e.target.value)} style={{width:150}} />
              <button className="btn btn-xs" onClick={()=>updateField('date',today())}>Today</button>
              <button className="btn btn-xs" onClick={() => {
                const d = new Date(); d.setDate(d.getDate()+1);
                updateField('date',d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));
              }}>Tomorrow</button>
              <button className="btn btn-xs" onClick={() => {
                const d = new Date(); d.setDate(d.getDate()-1);
                updateField('date',d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));
              }}>Yesterday</button>
            </div>

            <label className="fl">Deadline</label>
            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:6}}>
              <input type="date" value={m.deadline} onChange={e=>updateField('deadline',e.target.value)} style={{width:150}} />
              {m.deadline && (
                <span className={`ms-deadline-info ${dlClass}`} style={{marginTop:0,padding:'6px 10px',fontSize:11}}>
                  {dlLabel || 'Deadline set'}
                </span>
              )}
            </div>
          </div>

          {/* ── SLIDE 1: Substeps ── */}
          <div className={`modal-section${tab===1?' active':''}`} style={{position:'relative'}}>
            <label className="fl">Notes</label>
            <textarea placeholder="Add any notes about this milestone…" value={m.notes || ''}
              onChange={e=>updateField('notes',e.target.value)}
              style={{width:'100%',fontSize:14,padding:'9px 12px',border:'1.5px solid var(--border)',borderRadius:'var(--r)',outline:'none',fontFamily:'inherit',background:'var(--surface)',color:'var(--text)',resize:'vertical',minHeight:70,marginBottom:12}}
              onFocus={e=>e.target.style.borderColor='var(--accent)'}
              onBlur={e=>e.target.style.borderColor='var(--border)'} />

            {subTotal > 0 && (
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                <div style={{flex:1,height:5,background:'var(--s3)',borderRadius:3,overflow:'hidden'}}>
                  <div style={{height:'100%',background:'var(--accent)',borderRadius:3,transition:'.3s',width:`${subPct}%`}} />
                </div>
                <span style={{fontSize:11,color:'var(--t2)',fontWeight:700,whiteSpace:'nowrap'}}>{subDone}/{subTotal} done</span>
              </div>
            )}

            <DndContext sensors={ssSensors} collisionDetection={closestCenter} onDragEnd={handleSSDragEnd}>
              <SortableContext items={m.substeps.map(s => s.id)} strategy={verticalListSortingStrategy}>
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {m.substeps.map(ss => (
                    <SortableSubstep
                      key={ss.id}
                      ss={ss}
                      expanded={!!expandedSS[ss.id]}
                      S={S}
                      taskSensors={taskSensors}
                      onToggleExpand={() => setExpandedSS(prev => ({ ...prev, [ss.id]: !prev[ss.id] }))}
                      onToggleDone={() => toggleSubstep(ss.id)}
                      onUpdateTitle={(e) => updateSubstepTitle(ss.id, e.target.value)}
                      onRemove={() => removeSubstep(ss.id)}
                      onTaskDragEnd={handleTaskDragEnd}
                      onLinkTask={() => { setTaskSearch(ss.id); setSearchQ(''); }}
                      onCreateTask={() => handleCreateAndLink(ss.id)}
                      onOpenTask={handleOpenTask}
                      onDeleteTask={(ltObj) => handleDeleteTask(ss.id, ltObj)}
                      onToggleDashVis={(taskId) => toggleTaskDashVisibility(ss.id, taskId)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {subTotal === 0 && (
              <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'40px 20px',gap:16}}>
                <span style={{fontSize:13,color:'var(--t3)',textAlign:'center',lineHeight:1.5}}>
                  No substeps yet — break this milestone into smaller steps
                </span>
                <button className="btn btn-p" onClick={addSubstep} style={{fontSize:13,padding:'8px 16px'}}>+ Add substep</button>
              </div>
            )}
            {subTotal > 0 && (
              <button className="ms-add-ss-btn" onClick={addSubstep}>+ Add substep</button>
            )}

            {taskSearch && (
              <div className="ms-task-overlay">
                <div className="ms-to-head">
                  <input type="text" placeholder="Search tasks by name or client…" value={searchQ} onChange={e=>setSearchQ(e.target.value)} autoFocus />
                  <button className="btn btn-sm btn-g" onClick={()=>{setTaskSearch(null);setSearchQ('');}}>Close</button>
                </div>
                <div className="ms-to-list">
                  {searchResults.map(t => {
                    const tm = sel.gmood(S, t.mood);
                    const tc = sel.gc(S, t.clientId);
                    return (
                      <div key={t.id} className="ms-task-opt" onClick={()=>linkTaskToSubstep(taskSearch, t.id)}>
                        <span className="ms-to-mood">{tm?.icon||''}</span>
                        <span className="ms-to-name">{t.name}</span>
                        {tc && <span className="ms-to-client">{tc.name}</span>}
                        <span className="ms-to-date">{t.date||''}</span>
                      </div>
                    );
                  })}
                  {searchResults.length === 0 && <span className="ms-to-empty">No tasks found</span>}
                </div>
              </div>
            )}
          </div>

          {/* ── SLIDE 2: Settings ── */}
          <div className={`modal-section${tab===2?' active':''}`}>
            <label className="fl">Show on Task Dashboard</label>
            <div className="ttag-row horizontal-scroll">
              {[
                { value: 'daily', label: '📅 Daily' },
                { value: 'specific_days', label: '📅 Specific days' },
                { value: 'hidden', label: '👁 Hidden' },
              ].map(opt => (
                <div key={opt.value}
                  className={`ttagopt${m.displayMode===opt.value?' on':''}`}
                  onClick={()=>updateField('displayMode',opt.value)}>
                  {opt.label}
                </div>
              ))}
            </div>

            {m.displayMode === 'specific_days' && (
              <>
                <label className="fl">Show on these days</label>
                <div className="ms-day-row">
                  {dayNames.map(d => (
                    <button key={d}
                      className={`ms-day-chip${m.displayDays.includes(d)?' on':''}`}
                      onClick={()=>toggleDisplayDays(d)}>
                      {d}
                    </button>
                  ))}
                </div>
              </>
            )}

            <label className="fl">Deadline</label>
            <div style={{background:'var(--s2)',borderRadius:'var(--r)',padding:'12px 14px',marginTop:6}}>
              {m.deadline ? (
                <span className={`ms-deadline-info ${dlClass}`} style={{marginTop:0,padding:0,background:'transparent'}}>
                  {dlLabel || 'Deadline set'}
                </span>
              ) : (
                <span style={{fontSize:12,color:'var(--t3)',fontWeight:600}}>No deadline set</span>
              )}
            </div>

            {isEdit && (
              <div className="ms-del-section">
                <button className="ms-del-btn" onClick={handleDeleteMilestone}>🗑 Delete milestone</button>
              </div>
            )}
          </div>

        </div>

        <div className="modal-footer" style={{flexShrink:0,marginTop:0}}>
          <div className="modal-footer-left">
            {isEdit && <button className="btn btn-d" onClick={handleDeleteMilestone}>🗑 Delete</button>}
            <button className="modal-close-text" onClick={close}>Close</button>
          </div>
          <div className="modal-footer-right">
            {saveStatus === 'saving' && <span style={{fontSize:12,color:'var(--t3)',fontWeight:600,marginRight:8}}>Saving…</span>}
            {saveStatus === 'saved' && <span style={{fontSize:12,color:'var(--accent)',fontWeight:600,marginRight:8}}>Auto-saved</span>}
            {saveStatus === 'error' && <span style={{fontSize:12,color:'var(--warn)',fontWeight:600,marginRight:8}}>Couldn't save. Retrying…</span>}
            <button className="btn btn-p" onClick={save} disabled={!m.title.trim()}
              style={{opacity:m.title.trim()?1:.5}}>Save milestone</button>
          </div>
        </div>

      </div>
    </div>
  );
}

function SortableSubstep({ ss, expanded, S, taskSensors, onToggleExpand, onToggleDone, onUpdateTitle, onRemove, onTaskDragEnd, onLinkTask, onCreateTask, onOpenTask, onDeleteTask, onToggleDashVis }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ss.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(isDragging ? { boxShadow: '0 4px 12px rgba(0,0,0,0.15)' } : {}),
  };
  const status = getSubstepStatus(ss, S.tasks);
  const urgentCount = getUrgentCount(ss, S.tasks);

  return (
    <div ref={setNodeRef} style={style} className={`ms-ss-card${isDragging ? ' dragging' : ''}`}>
      <div className="ms-ss-card-head" onClick={onToggleExpand}>
        <span className="ms-ss-drag-handle" {...attributes} {...listeners} onClick={e => e.stopPropagation()}>
          ⠿
        </span>
        <div className={`ms-ss-chk${ss.done?' checked':''}`} onClick={e=>{e.stopPropagation();onToggleDone();}}>
          {ss.done ? '✓' : ''}
        </div>
        <span className={`ms-ss-title${ss.done?' done':''}`}>{ss.title || 'Untitled'}</span>
        {ss.linkedTasks?.length > 0 && (
          <span className="ms-ss-linked">
            🔗 {ss.linkedTasks.length} task{ss.linkedTasks.length > 1 ? 's' : ''}
            {urgentCount > 0 && <span className="ss-notif-dot">{urgentCount}</span>}
          </span>
        )}
        {status && status.type === 'overdue' && <span className="ss-status-dot ss-status-overdue">● {status.label}</span>}
        {status && status.type === 'today' && <span className="ss-status-dot ss-status-today">● {status.label}</span>}
        <span className="ms-ss-expand">{expanded ? '▲' : '▼'}</span>
      </div>
      <div className={`ms-ss-card-body${expanded ? ' expanded' : ''}`}>
        <div className="ms-ss-card-body-inner">
          {expanded && (
            <>
              <input type="text" placeholder="Substep title" value={ss.title} onChange={onUpdateTitle} />

              <div className="ms-ss-link-section">
                <label className="ms-ss-link-label">LINKED TASKS</label>

                {(ss.linkedTasks||[]).length > 0 && (
                  <DndContext sensors={taskSensors} collisionDetection={closestCenter} onDragEnd={(e) => onTaskDragEnd(ss.id, e)}>
                    <SortableContext items={(ss.linkedTasks||[]).map(lt => lt.taskId)} strategy={verticalListSortingStrategy}>
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        {(ss.linkedTasks||[]).map(ltObj => {
                          const lt = S.tasks.find(t => t.id === ltObj.taskId);
                          const tm = lt ? sel.gmood(S, lt.mood) : null;
                          const tc = lt ? sel.gc(S, lt.clientId) : null;
                          return lt ? (
                            <SortableLinkedTask
                              key={ltObj.taskId}
                              ltObj={ltObj}
                              lt={lt}
                              tm={tm}
                              tc={tc}
                              ssId={ss.id}
                              onOpen={onOpenTask}
                              onDelete={onDeleteTask}
                              onToggleDashVis={onToggleDashVis}
                            />
                          ) : (
                            <span key={ltObj.taskId} style={{color:'var(--warn)',fontSize:12}}>Task not found (id: {ltObj.taskId})</span>
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}

                <div className="ms-ss-link-btns">
                  <button onClick={onLinkTask}>🔍 Link existing task</button>
                  <button onClick={onCreateTask}>+ Create new task</button>
                </div>
              </div>

              <button className="ms-ss-remove" onClick={onRemove}>🗑 Remove substep</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const SortableLinkedTask = memo(function SortableLinkedTask({ ltObj, lt, tm, tc, ssId, onOpen, onDelete, onToggleDashVis }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ltObj.taskId });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(isDragging ? { boxShadow: '0 4px 12px rgba(0,0,0,0.15)' } : {}),
  };

  const mergedStyle = { ...style, borderLeft: `3px solid ${tm?.color||'var(--accent)'}` };

  return (
    <div ref={setNodeRef} style={mergedStyle} className={`linked-task-card${isDragging ? ' dragging' : ''}`}>
      <div className="linked-task-top">
        <span className="linked-task-drag-handle" {...attributes} {...listeners} onClick={e => e.stopPropagation()}>
          ⠿
        </span>
        <span className="linked-task-mood">{tm?.icon||''}</span>
        <span className="linked-task-name">{lt.name}</span>
        <button className="icon-btn edit" title="Open task" onClick={()=>onOpen(lt.id)}>✎</button>
      </div>
      <div className="linked-task-meta">
        {tc && <span className="linked-task-client" style={{background:(tc.color||'var(--s2)')+'22',color:tc.color||'var(--t2)'}}>{tc.name}</span>}
        {tm && <span className="linked-task-mood-tag" style={{background:tm.bg,color:tm.color}}>{tm.icon} {tm.label}</span>}
        <span className="linked-task-status">{lt.status}</span>
        <span className="linked-task-date">{lt.date||''}</span>
      </div>
      <label className="show-dash-toggle">
        <input type="checkbox" checked={ltObj.showOnDashboard}
          onChange={() => onToggleDashVis(ltObj.taskId)} />
        Show on Task Dashboard
      </label>
    </div>
  );
});

function fmtDT(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
