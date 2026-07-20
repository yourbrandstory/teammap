import { useState, useMemo, useCallback, useRef } from 'react';
import { useStore, sel } from '../store/useStore';
import { getDeadlineClass, getDeadlineLabel } from '../lib/constants';
import MilestoneModal from '../components/MilestoneModal';
import TaskModal from '../components/TaskModal';

export default function MilestonesView({ memberFilter, hideNewButton }) {
  const S = useStore(s => s.S);
  const upsertMilestone = useStore(s => s.upsertMilestone);
  const delMilestone = useStore(s => s.delMilestone);
  const softDeleteTask = useStore(s => s.softDeleteTask);
  const [modal, setModal] = useState(null);
  const [taskModal, setTaskModal] = useState(null);
  const [clientFilter, setClientFilter] = useState('');
  const linkAfterCreateRef = useRef(null);
  const openTask = useCallback((t) => setTaskModal(t), []);
  const closeTask = useCallback(() => setTaskModal(null), []);

  const toggleVisibility = useCallback(async (ms) => {
    const newMode = ms.displayMode === 'hidden' ? 'daily' : 'hidden';
    await upsertMilestone({ ...ms, displayMode: newMode });
  }, [upsertMilestone]);

  const handleDeleteMilestone = useCallback(async (ms) => {
    const substepCount = ms.substeps?.length || 0;
    if (!confirm(`Delete milestone?\n\nThis will permanently delete '${ms.title}'${substepCount > 0 ? ` and all ${substepCount} substeps` : ''}.`)) return;

    const allLinkedTaskIds = [...new Set(
      (ms.substeps || []).flatMap(ss => (ss.linkedTasks || []).map(lt => lt.taskId)).filter(Boolean)
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
    await delMilestone(ms.id);
    if (modal?.id === ms.id) setModal(null);
  }, [S.tasks, softDeleteTask, delMilestone, modal]);

  const handleCreateTaskForSubstep = useCallback((ssId, taskData, linkCallback) => {
    sessionStorage.removeItem('tm_task_draft');
    linkAfterCreateRef.current = { ssId, linkCallback };
    setTaskModal(taskData);
  }, []);

  const handleTaskSave = useCallback((savedTask) => {
    const pending = linkAfterCreateRef.current;
    if (pending && savedTask?.id) {
      pending.linkCallback(savedTask.id);
    }
    linkAfterCreateRef.current = null;
  }, []);

  const activeMilestones = useMemo(() => {
    let ms = S.milestones.filter(m => !m.deleted);
    if (memberFilter) {
      ms = ms.filter(m => (m.assignedTo || []).includes(memberFilter));
    }
    return ms.sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });
  }, [S.milestones, memberFilter]);

  const filteredMilestones = useMemo(() => {
    if (!clientFilter) return activeMilestones;
    return activeMilestones.filter(m => m.clientId === clientFilter);
  }, [activeMilestones, clientFilter]);

  const clients = useMemo(() => {
    const usedIds = new Set(activeMilestones.map(m => m.clientId).filter(Boolean));
    return S.clients.filter(c => usedIds.has(c.id));
  }, [activeMilestones, S.clients]);

  const clientMap = useMemo(() => {
    const map = {};
    S.clients.forEach(c => { map[c.id] = c; });
    return map;
  }, [S.clients]);

  return (
    <div className="mv-wrap">
      <div className="mv-header">
        <span className="stl">◆ Milestones</span>
        {!hideNewButton && <button className="mv-new-btn" onClick={() => setModal({})}>+ New Milestone</button>}
      </div>

      {clients.length > 0 && (
        <div className="mv-filter-row">
          <button className={`mv-filter-chip${!clientFilter ? ' on' : ''}`} onClick={() => setClientFilter('')}>All</button>
          {clients.map(c => (
            <button key={c.id} className={`mv-filter-chip${clientFilter === c.id ? ' on' : ''}`} onClick={() => setClientFilter(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="mv-body">
        {filteredMilestones.length === 0 && (
          <div className="mv-empty">
            {clientFilter ? 'No milestones for this client' : 'No milestones yet. Click "+ New Milestone" to create one.'}
          </div>
        )}

        {filteredMilestones.map(ms => {
          const dlClass = getDeadlineClass(ms.deadline);
          const dlLabel = getDeadlineLabel(ms.deadline);
          const safeSS = (ms.substeps || []).filter(Boolean);
          const total = safeSS.length;
          const done = safeSS.filter(s => s.done).length;
          const pct = total ? Math.round(done / total * 100) : 0;
          const client = ms.clientId ? sel.gc(S, ms.clientId) : null;
          const mood = ms.mood ? sel.gmood(S, ms.mood) : null;
          const visibleSS = safeSS.slice(0, 3);
          const moreSS = safeSS.length - 3;

          return (
            <div key={ms.id} className="mv-card" onClick={() => setModal(ms)}>
              <button className={`mv-visibility-btn${ms.displayMode === 'hidden' ? ' hidden-state' : ''}`}
                title={ms.displayMode === 'hidden' ? 'Show on dashboard' : 'Hide from dashboard'}
                onClick={e => { e.stopPropagation(); toggleVisibility(ms); }}>
                {ms.displayMode === 'hidden' ? '🚫' : '👁'}
              </button>
              <button className="mv-del-card-btn" title="Delete milestone"
                onClick={e => { e.stopPropagation(); handleDeleteMilestone(ms); }}>
                🗑
              </button>
              <div className="mv-badge-row">
                <span className="mv-badge">◆ MILESTONE</span>
                {dlLabel && <span className={`mv-deadline ${dlClass}`}>{dlLabel}</span>}
              </div>
              <div className="mv-title">{ms.title}</div>
              {total > 0 && (
                <div className="mv-progress-row">
                  <div className="mv-bar"><div className="mv-fill" style={{width:`${pct}%`}} /></div>
                  <span className="mv-pct">{done}/{total} · {pct}%</span>
                </div>
              )}
              <div className="mv-meta-row">
                {client && (
                  <span className="mv-meta-chip" style={{background:(client.color||'var(--s2)')+'22',color:client.color||'var(--t2)'}}>
                    {client.name}
                  </span>
                )}
                {mood && (
                  <span className="mv-meta-chip" style={{background:mood.bg,color:mood.color}}>
                    {mood.icon} {mood.label}
                  </span>
                )}
                {ms.assignedTo.length > 0 && (
                  <div className="mv-assign-av">
                    {ms.assignedTo.map(mid => {
                      const mem = sel.gm(S, mid);
                      return mem ? (
                        <span key={mid} className="av" style={{background:mem.color,color:'#fff'}} title={mem.name}>
                          {mem.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
              {visibleSS.length > 0 && (
                <div className="mv-substeps-mini">
                  {visibleSS.map(ss => (
                    <div key={ss.id} className="mv-ss-item">
                      <span className={`mv-ss-dot${ss.done?' done':''}`} />
                      <span className={`mv-ss-text${ss.done?' done':''}`}>{ss.title}</span>
                    </div>
                  ))}
                  {moreSS > 0 && <span className="mv-ss-more">+{moreSS} more</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {modal && <MilestoneModal milestone={modal.id ? modal : null} onClose={() => setModal(null)} onOpenTask={openTask} onCreateTaskForSubstep={handleCreateTaskForSubstep} />}
      {taskModal && <TaskModal task={taskModal} onClose={closeTask} onSave={handleTaskSave} />}
    </div>
  );
}
