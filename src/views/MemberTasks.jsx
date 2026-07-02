import { useState, useMemo, useCallback } from 'react';
import { useStore, sel } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';
import { today, fmtD, taskTimeStr } from '../lib/constants';
import { getStatusMaps, getCompleteStatus, getReviewStatus, getPassStatus } from '../utils/statusUtils';
import { canCreateTask, getDailyActiveCount, getDailyLimit } from '../utils/taskLimits';
import { getNotesText } from '../utils/notesUtils';
import { getMilestonesForMemberToday, filterDashboardTasks, getTaskMilestoneLink } from '../utils/milestoneHelpers';
import Avatar from '../components/Avatar';
import TaskModal from '../components/TaskModal';
import TaskSidePanel from '../components/TaskSidePanel';
import MilestoneModal from '../components/MilestoneModal';
import MilestoneDashCard from '../components/MilestoneDashCard';
import CircProg from '../components/CircProg';

export default function MemberTasks() {
  const S = useStore(s => s.S);
  const session = useStore(s => s.session);
  const memberId = session?.memberId;
  const completeStatus = getCompleteStatus(S.task_statuses);
  const passStatus = getPassStatus(S.task_statuses);
  const reviewStatus = getReviewStatus(S.task_statuses);
  const [dashDate, setDashDate] = useState(today());
  const [modal, setModal] = useState(null);
  const [msModal, setMsModal] = useState(null);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState('myTasks');

  const openTask = useCallback((t) => setModal(t), []);
  const closeModal = useCallback(() => setModal(null), []);
  const handleOpenMilestoneFromTask = useCallback((ms) => {
    closeModal();
    setTimeout(() => setMsModal(ms), 100);
  }, [closeModal]);

  const shift = (days) => {
    const d = new Date(dashDate + 'T12:00:00'); d.setDate(d.getDate() + days);
    setDashDate(d.toISOString().slice(0, 10));
  };

  const myTasks = useMemo(() => {
    if (!memberId) return [];
    return sel.tasksForMD(S, memberId, dashDate);
  }, [S, memberId, dashDate]);

  const me = useMemo(() => S.members.find(m => m.id === memberId), [S, memberId]);
  const visibleTasks = useMemo(() => myTasks.filter(t => t.status !== completeStatus), [myTasks, completeStatus]);
  const hiddenTasks = useMemo(() => myTasks.filter(t => t.hidden), [myTasks]);
  const doneTasks = useMemo(() => myTasks.filter(t => t.status === completeStatus), [myTasks, completeStatus]);
  const total = myTasks.length;
  const doneCount = doneTasks.length;
  const dayPct = total ? Math.round(doneCount / total * 100) : 0;

  const setStatus = useCallback(async (taskId, status) => {
    const task = S.tasks.find(t => t.id === taskId);
    if (task && status !== completeStatus) {
      const { upsertTask } = useStore.getState();
      await upsertTask({ ...task, status });
    }
  }, [S.tasks, completeStatus]);

  const hideTask = useCallback(async (taskId) => {
    const task = S.tasks.find(t => t.id === taskId);
    if (task) {
      try {
        const { upsertTask } = useStore.getState();
        await upsertTask({ ...task, hidden: true });
      } catch {
        useUIStore.getState().setToast('Failed to hide task.');
      }
    }
  }, [S.tasks]);

  return (
    <div className="view active" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── HEADER ── */}
      <div style={{
        padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span className="stl" style={{ whiteSpace: 'nowrap' }}>Tasks</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn btn-sm" style={{ padding: '4px 10px', fontSize: 15, fontWeight: 700 }} onClick={() => shift(-1)}>←</button>
          <input type="date" value={dashDate} onChange={e => setDashDate(e.target.value)} style={{ width: 140, fontSize: 12 }} />
          <button className="btn btn-sm" style={{ padding: '4px 10px', fontSize: 15, fontWeight: 700 }} onClick={() => shift(1)}>→</button>
        </div>
        <button className="btn btn-sm" style={{ fontWeight: 700 }} onClick={() => setDashDate(today())}>Today</button>
        <span style={{ fontSize: 12, color: 'var(--t2)' }}>{fmtD(dashDate)}</span>
        <div style={{ flex: 1, minWidth: 60, maxWidth: 200 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--t3)', marginBottom: 2 }}>
            <span>Day progress</span>
            <span style={{ fontWeight: 700, color: dayPct === 100 ? 'var(--accent)' : 'var(--t2)' }}>{doneCount}/{total} · {dayPct}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--s3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, width: `${dayPct}%`, transition: '.4s',
              background: dayPct === 100 ? 'var(--accent)' : dayPct > 60 ? 'var(--a2)' : 'var(--info)',
            }} />
          </div>
        </div>
        {/* ── View toggle ── */}
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', marginLeft: 'auto', flexShrink: 0 }}>
          <button onClick={() => setViewMode('myTasks')} style={{
            padding: '4px 12px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', border: 'none',
            background: viewMode === 'myTasks' ? 'var(--accent)' : 'transparent',
            color: viewMode === 'myTasks' ? '#fff' : 'var(--t3)',
            transition: '.15s',
          }}>My Tasks</button>
          <button onClick={() => setViewMode('delegated')} style={{
            padding: '4px 12px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', border: 'none',
            background: viewMode === 'delegated' ? 'var(--accent)' : 'transparent',
            color: viewMode === 'delegated' ? '#fff' : 'var(--t3)',
            transition: '.15s',
          }}>Delegated & Assigned</button>
        </div>
      </div>

      {viewMode === 'myTasks' ? (
        <>
          {/* ── MY TASKS BODY (unchanged) ── */}
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            <div className="task-dash-main" style={{ flex: 1, overflow: 'auto', padding: 12 }}>
              {!visibleTasks.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: 'var(--t3)' }}>
                  <div style={{ fontSize: 36 }}>📋</div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>No tasks for this date</p>
                </div>
              ) : (
                <div className="tcols" style={{ minWidth: 360 }}>
                  <MemberTaskCol memberId={memberId} date={dashDate} S={S}
                    tasks={visibleTasks} completeStatus={completeStatus}
                    onOpenTask={openTask} onStatus={setStatus} onHide={hideTask}
                    onOpenMs={setMsModal} />
                </div>
              )}
            </div>

            <TaskSidePanel
              tasks={visibleTasks} member={me} S={S} onOpenTask={openTask} hiddenTasks={hiddenTasks} />
          </div>

          <div className="lu-mobile-hidden">
            <button className="lu-mobile-hidden-toggle" onClick={() => setMobilePanelOpen(o => !o)}>
              👁 Tasks ({hiddenTasks.length} hidden)
            </button>

            {mobilePanelOpen && (
              <div className="lu-mobile-drawer" onClick={() => setMobilePanelOpen(false)}>
                <div className="lu-mobile-drawer-content" onClick={e => e.stopPropagation()}>
                  <div className="lu-mobile-drawer-head">
                    <span>{S.members.find(m => m.id === memberId)?.name || 'My Tasks'}</span>
                    <button className="btn btn-sm" onClick={() => setMobilePanelOpen(false)}>Close</button>
                  </div>
                  <TaskSidePanel
                    memberId={memberId} date={dashDate} S={S} onOpenTask={(t) => { openTask(t); setMobilePanelOpen(false); }} />
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <DelegatedAssignedView
          S={S}
          memberId={memberId}
          dashDate={dashDate}
          completeStatus={completeStatus}
          passStatus={passStatus}
          openTask={openTask}
        />
      )}

      {modal && <TaskModal task={modal} onClose={closeModal} onSaveAsTemplate={(d) => { useUIStore.getState().triggerSaveAsTemplate(d); }} onOpenMilestone={handleOpenMilestoneFromTask} />}
      {msModal && <MilestoneModal milestone={msModal} onClose={() => setMsModal(null)} onOpenTask={openTask} onCreateTaskForSubstep={undefined} />}
    </div>
  );
}

function MemberTaskCol({ memberId, date, S, tasks, completeStatus, onOpenTask, onStatus, onHide, onOpenMs }) {
  const dailyActive = getDailyActiveCount(S, memberId, date);
  const dailyCap = getDailyLimit(S, memberId);
  const member = S.members.find(m => m.id === memberId);
  const capColor = dailyActive > dailyCap ? '#e76f51' : dailyActive === dailyCap ? '#d97706' : 'var(--t2)';
  const limitReached = dailyActive >= dailyCap;

  const memberMilestones = useMemo(() =>
    getMilestonesForMemberToday(S.milestones, memberId, date),
    [S.milestones, memberId, date]
  );

  const visibleTasks = useMemo(() =>
    filterDashboardTasks(tasks, S.milestones),
    [tasks, S.milestones]
  );

  const visibleMoods = S.moods.filter(m => !m.hidden);

  const moodMins = (moodId) => visibleTasks.filter(t => t.mood === moodId).reduce((a, t) => a + ((t.estH || 0) * 60 + (t.estM || 0)), 0);
  const hm = (m) => m ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + m % 60 + 'm' : ''}` : null;

  const handleAddTask = useCallback((moodId) => {
    if (limitReached) {
      useUIStore.getState().setToast(`Task limit reached. You already have ${dailyActive}/${dailyCap} active tasks. Complete or pass an existing task before creating another.`);
      return;
    }
    onOpenTask({ date, mood: moodId || '', assignedTo: [memberId] });
  }, [limitReached, dailyActive, dailyCap, memberId, date, onOpenTask]);

  const plusBtn = (moodId, moodColor) => (
    <button disabled={limitReached}
      onClick={(e) => { e.stopPropagation(); handleAddTask(moodId); }}
      title={limitReached ? `Daily task limit reached (${dailyActive}/${dailyCap})` : ''}
      style={{
        width: 16, height: 16, borderRadius: '50%', background: moodColor + '22',
        border: `1px solid ${moodColor}44`, color: moodColor, fontSize: 11, lineHeight: 1,
        cursor: limitReached ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: 'center', flexShrink: 0, padding: 0, fontFamily: 'inherit',
        marginLeft: 'auto', opacity: limitReached ? 0.5 : 1,
      }}>+</button>
  );

  const addTaskBtn = (moodId) => (
    <button className="addbtn" disabled={limitReached}
      title={limitReached ? `Daily task limit reached (${dailyActive}/${dailyCap})` : ''}
      style={{ fontSize: 11, flexShrink: 0, opacity: limitReached ? 0.5 : 1, cursor: limitReached ? 'not-allowed' : 'pointer' }}
      onClick={() => handleAddTask(moodId)}>+ Task</button>
  );

  return (
    <div className="tcol">
      <div className="tcolh" style={{ borderTop: `3px solid ${member?.color || 'var(--accent)'}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 800, flex: 1 }}>{member?.name || 'My Tasks'}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: capColor }}>{dailyActive}/{dailyCap}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 3 }}>
          <span style={{ color: 'var(--t3)' }}>{tasks.length} active</span>
        </div>
      </div>
      <div className="tcolb">
        {memberMilestones.filter(ms => !ms.mood).map(ms => (
          <MilestoneDashCard key={ms.id} milestone={ms} S={S} onClick={() => onOpenMs?.(ms)} />
        ))}
        {visibleMoods.map(mood => {
          const moodMs = memberMilestones.filter(ms => ms.mood === mood.id);
          const mt = visibleTasks.filter(t => t.mood === mood.id);
          const isHero = mood.id === 'hero', isImp = mood.id === 'imp';
          const secClass = isHero ? 'hero-sec' : isImp ? 'imp-sec' : 'other-sec';
          const secStyle = isHero ? { background: mood.bg, border: `2px solid ${mood.color}55` }
            : isImp ? { background: mood.bg + '88', border: `1.5px solid ${mood.color}44` } : {};

          return (
            <div key={mood.id} className={`msec ${secClass}`} style={secStyle}>
              <div className="msec-head" style={{ background: isHero ? mood.color + '15' : isImp ? mood.color + '10' : 'transparent' }}>
                <span style={{ fontSize: isHero ? 13 : isImp ? 12 : 11 }}>{mood.icon}</span>
                <span className="msec-label" style={{ color: mood.color, fontSize: isHero ? 11 : isImp ? 10.5 : 10 }}>{mood.label}</span>
                <span className="msec-cnt" style={{ background: mood.color + '22', color: mood.color }}>
                  {mt.length}
                </span>
                {hm(moodMins(mood.id)) && <span style={{ fontSize: 9, color: mood.color, marginLeft: hm(moodMins(mood.id)) ? 2 : 'auto', fontWeight: 700, opacity: 0.7 }}>{hm(moodMins(mood.id))}</span>}
                {plusBtn(mood.id, mood.color)}
              </div>
              <div className="msec-tasks">
                {moodMs.map(ms => (
                  <MilestoneDashCard key={ms.id} milestone={ms} S={S} onClick={() => onOpenMs?.(ms)} />
                ))}
                {mt.length ? mt.map(t => <MTaskCard key={t.id} task={t} S={S} onOpenTask={onOpenTask} onStatus={onStatus} onHide={onHide} />)
                  : !moodMs.length ? <div style={{ fontSize: 10, color: 'var(--t3)', padding: '5px 4px', fontStyle: 'italic' }}>No active {mood.label}</div> : null}
              </div>
              {addTaskBtn(mood.id)}
            </div>
          );
        })}

        <button className="addbtn" disabled={limitReached}
          title={limitReached ? `Daily task limit reached (${dailyActive}/${dailyCap})` : ''}
          style={{ fontSize: 11, flexShrink: 0, opacity: limitReached ? 0.5 : 1, cursor: limitReached ? 'not-allowed' : 'pointer', marginTop: 8 }}
          onClick={() => handleAddTask()}>+ Task</button>
      </div>
    </div>
  );
}

/* ── DELEGATED & ASSIGNED VIEW ── */
function DelegatedAssignedView({ S, memberId, dashDate, completeStatus, passStatus, openTask }) {
  const { STC, STB } = getStatusMaps(S.task_statuses);

  const { assignedToMe, delegatedByMe } = useMemo(() => {
    if (!memberId) return { assignedToMe: [], delegatedByMe: [] };

    const assignedToMe = S.tasks.filter(t =>
      !t.deleted &&
      t.date === dashDate &&
      t.assignedTo.includes(memberId) &&
      t.createdBy !== memberId
    );

    const delegatedByMe = S.tasks.filter(t =>
      !t.deleted &&
      t.date === dashDate &&
      t.assignedTo.length > 0 &&
      !t.assignedTo.includes(memberId) &&
      t.createdBy === memberId
    );

    return { assignedToMe, delegatedByMe };
  }, [S.tasks, memberId, dashDate]);

  const createdAtExists = useMemo(() => S.tasks.some(t => t.createdBy), [S.tasks]);

  const groupedBySender = useMemo(() => {
    if (!createdAtExists) return [];
    const groups = {};
    assignedToMe.forEach(t => {
      const senderId = t.createdBy;
      if (!groups[senderId]) groups[senderId] = [];
      groups[senderId].push(t);
    });
    return Object.entries(groups)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([senderId, tasks]) => ({ sender: sel.gm(S, senderId), tasks }));
  }, [assignedToMe, S, createdAtExists]);

  const cardHover = (e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; };
  const cardLeave = (e) => { e.currentTarget.style.boxShadow = 'none'; };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
      {/* ── Summary stat cards ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', borderRadius: 8, background: '#fff',
          border: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 22 }}>↙</span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)', lineHeight: 1.2 }}>{assignedToMe.length}</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 500 }}>Assigned to me</div>
          </div>
        </div>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', borderRadius: 8, background: '#fff',
          border: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 22 }}>↗</span>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)', lineHeight: 1.2 }}>{delegatedByMe.length}</div>
            <div style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 500 }}>Delegated by me</div>
          </div>
        </div>
      </div>

      {/* ── SECTION 1: Assigned to me ── */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--t3)',
          marginBottom: 10, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          ↙ Assigned to me
          <span style={{
            fontSize: 9, fontWeight: 600, color: 'var(--t3)', background: 'var(--s2)',
            padding: '1px 7px', borderRadius: 8,
          }}>
            {assignedToMe.length}
          </span>
        </div>

        {assignedToMe.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--t3)', padding: '12px 0' }}>No tasks assigned to you for this date</div>
        ) : !createdAtExists ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--t3)', fontStyle: 'italic', marginBottom: 10 }}>
              Task source tracking coming soon — showing all assigned tasks
            </div>
            {assignedToMe.map(t => <TaskCard key={t.id} task={t} S={S} STC={STC} STB={STB} onClick={() => openTask(t)} />)}
          </>
        ) : (
          groupedBySender.map(({ sender, tasks }) => (
            <div key={sender?.id || 'unknown'} style={{ marginBottom: 16 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', marginBottom: 8, background: 'var(--s2)',
                borderRadius: 6,
              }}>
                <Avatar name={sender?.name || '?'} color={sender?.color || 'var(--t3)'} size={18} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--t2)' }}>
                  From {sender?.name || 'Unknown'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--t3)', marginLeft: 'auto' }}>
                  {tasks.length} task{tasks.length > 1 ? 's' : ''}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {tasks.map(t => <TaskCard key={t.id} task={t} S={S} STC={STC} STB={STB} onClick={() => openTask(t)} />)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── SECTION 2: Delegated by me ── */}
      <div>
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--t3)',
          marginBottom: 10, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          ↗ Delegated by me
          <span style={{
            fontSize: 9, fontWeight: 600, color: 'var(--t3)', background: 'var(--s2)',
            padding: '1px 7px', borderRadius: 8,
          }}>
            {delegatedByMe.length}
          </span>
        </div>

        {delegatedByMe.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--t3)', padding: '12px 0' }}>You haven't delegated any tasks for this date</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {delegatedByMe.map(t => {
              const assignee = sel.gm(S, t.assignedTo[0]);
              const mood = sel.gmood(S, t.mood);
              const client = sel.gc(S, t.clientId);
              const hasSubtasks = t.subtasks?.length > 0;
              const subTotal = t.subtasks?.length || 0;
              const subDone = t.subtasks?.filter(s => s.done).length || 0;
              const hasLinks = t.links?.length > 0;
              return (
                <div key={t.id} onClick={() => openTask(t)}
                  onMouseOver={cardHover} onMouseOut={cardLeave}
                  style={{
                    background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
                    borderLeft: `3px solid ${mood?.color || 'var(--t3)'}`,
                    padding: '10px 14px', cursor: 'pointer',
                    transition: 'box-shadow .15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{mood?.icon || '📋'}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </span>
                    <span style={{
                      padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                      whiteSpace: 'nowrap', background: STB[t.status], color: STC[t.status],
                    }}>
                      {t.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, flexWrap: 'wrap' }}>
                    {client && (
                      <span style={{
                        padding: '2px 8px', borderRadius: 4,
                        background: (mood?.color || 'var(--t3)') + '18',
                        color: mood?.color || 'var(--t3)', fontWeight: 600,
                      }}>
                        {client.name}
                      </span>
                    )}
                    <span style={{ color: 'var(--t3)' }}>{t.date}</span>
                    {assignee && (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        padding: '2px 10px', borderRadius: 12,
                        background: (assignee.color || 'var(--t3)') + '16',
                        color: assignee.color || 'var(--t3)', fontWeight: 600,
                      }}>
                        → {assignee.name}
                      </span>
                    )}
                    {hasSubtasks && (
                      <CircProg done={subDone} total={subTotal} />
                    )}
                    {hasLinks && (
                      <span style={{ color: 'var(--t3)', fontSize: 10 }}>🔗 {t.links.length}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, S, STC, STB, onClick }) {
  const mood = sel.gmood(S, task.mood);
  const client = sel.gc(S, task.clientId);
  const sender = sel.gm(S, task.createdBy);
  const hasSubtasks = task.subtasks?.length > 0;
  const subTotal = task.subtasks?.length || 0;
  const subDone = task.subtasks?.filter(s => s.done).length || 0;
  const hasLinks = task.links?.length > 0;
  const msLink = useMemo(() => getTaskMilestoneLink(task.id, S.milestones), [task.id, S.milestones]);
  const cardHover = (e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; };
  const cardLeave = (e) => { e.currentTarget.style.boxShadow = 'none'; };
  return (
    <div onClick={onClick}
      onMouseOver={cardHover} onMouseOut={cardLeave}
      style={{
        background: '#fff', border: '1px solid var(--border)', borderRadius: 8,
        borderLeft: `3px solid ${mood?.color || 'var(--t3)'}`,
        padding: '10px 14px', cursor: 'pointer',
        transition: 'box-shadow .15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>{mood?.icon || '📋'}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--t1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.name}
        </span>
        <span style={{
          padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
          whiteSpace: 'nowrap', background: STB[task.status], color: STC[task.status],
        }}>
          {task.status}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, flexWrap: 'wrap' }}>
        {client && (
          <span style={{
            padding: '2px 8px', borderRadius: 4,
            background: (mood?.color || 'var(--t3)') + '18',
            color: mood?.color || 'var(--t3)', fontWeight: 600,
          }}>
            {client.name}
          </span>
        )}
        <span style={{ color: 'var(--t3)' }}>{task.date}</span>
        {msLink && <div className="task-ms-badge"><i>◆</i> <span className="ms-m-letter">M</span>{msLink.milestone.title.length > 20 ? msLink.milestone.title.slice(0, 20) + '…' : msLink.milestone.title}</div>}
        {sender && (
          <span style={{ color: 'var(--t3)', fontWeight: 500 }}>
            from {sender.name}
          </span>
        )}
        {hasSubtasks && (
          <CircProg done={subDone} total={subTotal} />
        )}
        {hasLinks && (
          <span style={{ color: 'var(--t3)', fontSize: 10 }}>🔗 {task.links.length}</span>
        )}
      </div>
    </div>
  );
}

const MTaskCard = ({ task, S, onOpenTask, onStatus, onHide }) => {
  const { STC, STB, STATS } = getStatusMaps(useStore.getState().S.task_statuses);
  const cStatus = getCompleteStatus(useStore.getState().S.task_statuses);
  const memberStatuses = STATS.filter(s => s !== cStatus);
  const currentIdx = memberStatuses.indexOf(task.status);
  const nextStatus = memberStatuses[(currentIdx + 1) % memberStatuses.length];
  const mood = sel.gmood(S, task.mood);
  const client = sel.gc(S, task.clientId);
  const timeStr = taskTimeStr(task);
  const isHero = task.mood === 'hero', isTop = task.mood === 'top', isImp = task.mood === 'imp';
  const extra = isHero ? ' hero' : isImp ? ' imp-card' : isTop ? ' top' : ' light';
  const [linkPop, setLinkPop] = useState(false);
  const hasNotes = getNotesText(task.notes).length > 0;
  const hasLinks = task.links?.length > 0;
  const hasSubtasks = task.subtasks?.length > 0;
  const subTotal = task.subtasks?.length || 0;
  const subDone = task.subtasks?.filter(s => s.done).length || 0;
  const msLink = useMemo(() => getTaskMilestoneLink(task.id, S.milestones), [task.id, S.milestones]);

  return (
    <div className={`tcard${extra}`} onClick={() => onOpenTask(task)}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 2 }}>
        <div className="tcn" style={{ flex: 1 }}>{task.isMilestone ? '🏁 ' : ''}{task.name}</div>
      </div>
      {client && <div className="tcc" style={{ color: mood?.color || 'var(--t2)', fontWeight: 600 }}>{client.name}</div>}
      <div className="tcs-row">
        {onStatus && (
          <span className="tcs" style={{ background: STB[task.status], color: STC[task.status] }}
            onClick={(e) => { e.stopPropagation(); onStatus(task.id, nextStatus); }}>
            {task.status} ▼
          </span>
        )}
        {timeStr && <span className="ttime">{timeStr}</span>}
        {onHide && (
          <button className="tcard-hide" onClick={(e) => { e.stopPropagation(); onHide(task.id); }}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: 'var(--t3)', padding: '0 4px' }}
            title="Hide">✕</button>
        )}
      </div>
      {msLink && <div className="task-ms-badge"><i>◆</i> <span className="ms-m-letter">M</span>{msLink.milestone.title.length > 20 ? msLink.milestone.title.slice(0, 20) + '…' : msLink.milestone.title}</div>}
      {task.tags?.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>
          {task.tags.map(tid => { const tg = sel.gtag(S, tid); return tg ? <span key={tid} className="ttag-chip">{tg.label}</span> : null; })}
        </div>
      )}
      {(hasNotes || hasLinks || hasSubtasks) && (
        <div className="card-icon-row">
          {hasNotes && (
            <span className="card-icon-pill notes-pill" aria-label="Has notes">
              📝<span className="card-pill-tip">{getNotesText(task.notes)}</span>
            </span>
          )}
          {hasLinks && (
            <span className="card-icon-pill link-pill" aria-label={`${task.links.length} link(s)`}
              onClick={e => { e.stopPropagation(); setLinkPop(p => !p); }}>
              🔗 {task.links.length}
              {linkPop && (
                <span className="card-link-pop" onClick={e => e.stopPropagation()}>
                  {task.links.map((ln, i) => (
                    <span key={i} className="card-link-item" onClick={() => window.open(ln.url, '_blank', 'noopener,noreferrer')}>
                      {ln.label || ln.url}
                    </span>
                  ))}
                </span>
              )}
            </span>
          )}
          {hasSubtasks && (
            <CircProg done={subDone} total={subTotal} />
          )}
        </div>
      )}
    </div>
  );
};
