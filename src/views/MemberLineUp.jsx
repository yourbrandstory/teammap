import { useState, useMemo, useCallback, useEffect } from 'react';
import { useStore, sel } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';
import { today } from '../lib/constants';
import { dayProgress } from '../utils/lineUpHelpers';
import { getCompleteStatus, getReviewStatus, canDeleteTask } from '../utils/statusUtils';
import { canCreateTask, getDailyActiveCount, getDailyLimit } from '../utils/taskLimits';
import { getMilestonesForMemberToday } from '../utils/milestoneHelpers';
import LineUpHeader from '../components/lineup/LineUpHeader';
import LineUpCard from '../components/lineup/LineUpCard';
import HiddenTasksPanel from '../components/HiddenTasksPanel';
import MilestoneDashCard from '../components/MilestoneDashCard';
import MilestoneModal from '../components/MilestoneModal';
import TaskModal from '../components/TaskModal';

export default function MemberLineUp() {
  const S = useStore(s => s.S);
  const session = useStore(s => s.session);
  const memberId = session?.memberId;
  const softDeleteTask = useStore(s => s.softDeleteTask);
  const uiViewState = useUIStore(s => s.viewStates.mlu || {});
  const setViewState = useUIStore(s => s.setViewState);

  const [date, setDate] = useState(uiViewState.date || today());
  const [sortMode, setSortMode] = useState(uiViewState.sortMode || 'mood');
  const [filters, setFilters] = useState(uiViewState.filters || { client: '', mood: '', review: false, search: '', status: '' });
  const [panelWidth, setPanelWidth] = useState(uiViewState.panelWidth || 380);
  const [mobileHiddenOpen, setMobileHiddenOpen] = useState(false);
  const [taskModal, setTaskModal] = useState(null);
  const [msModal, setMsModal] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    try {
      const v = localStorage.getItem('lineupViewMode');
      if (v === 'compact') return 'compact';
      return 'priority';
    } catch { return 'compact'; }
  });

  // Persist UI state on change
  useEffect(() => {
    setViewState('mlu', { date, sortMode, filters, panelWidth });
  }, [date, sortMode, filters, panelWidth, setViewState]);

  const shift = useCallback((days, explicitDate) => {
    if (explicitDate !== undefined) { setDate(explicitDate); return; }
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }, [date]);

  const goToday = useCallback(() => setDate(today()), []);

  // Assigned tasks on this date (for progress, includes Complete)
  // Ordered using the same drag order as the Manager Line Up (lineUpOrder only)
  const myTasksOnDate = useMemo(() => {
    if (!memberId) return [];
    const myTasks = sel.tasksForMD(S, memberId, date);
    const order = S.lineUp?.[memberId]?.[date] || S.lineUpOrder?.[date] || [];
    const ordered = [];
    const remaining = [...myTasks];
    order.forEach(id => {
      const idx = remaining.findIndex(t => t.id === id);
      if (idx !== -1) ordered.push(remaining.splice(idx, 1)[0]);
    });
    return [...ordered, ...remaining];
  }, [S, memberId, date, S.lineUpOrder]);

  // Active tasks (exclude Complete and hidden, then apply filters, then sort)
  const completeStatus = getCompleteStatus(S.task_statuses);
  const activeTasks = useMemo(() => {
    let tasks = myTasksOnDate.filter(t => t.status !== completeStatus && !t.hidden);
    if (filters.client) tasks = tasks.filter(t => t.clientId === filters.client);
    if (filters.mood) tasks = tasks.filter(t => t.mood === filters.mood);
    if (filters.status) tasks = tasks.filter(t => t.status === filters.status);
    if (filters.review) {
      const reviewLabel = getReviewStatus(S.task_statuses);
      tasks = tasks.filter(t => t.status === reviewLabel);
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      tasks = tasks.filter(t => t.name.toLowerCase().includes(q));
    }
    // Apply sort after all filters
    if (sortMode === 'client') {
      return [...tasks].sort((a, b) => {
        const ca = S.clients.find(c => c.id === a.clientId);
        const cb = S.clients.find(c => c.id === b.clientId);
        return (ca?.name || '').localeCompare(cb?.name || '');
      });
    }
    if (sortMode === 'mood') {
      const moodOrder = S.moods.map(m => m.id);
      return [...tasks].sort((a, b) => moodOrder.indexOf(a.mood) - moodOrder.indexOf(b.mood));
    }
    return tasks;
  }, [myTasksOnDate, completeStatus, filters, S.task_statuses, sortMode, S.clients, S.moods]);

  const memberMilestones = useMemo(() => {
    if (!memberId) return [];
    return getMilestonesForMemberToday(S.milestones, memberId, date);
  }, [S.milestones, memberId, date]);

  const combinedItems = useMemo(() => {
    const moodOrder = S.moods.map(m => m.id);
    const getMoodIndex = (moodId) => {
      const i = moodOrder.indexOf(moodId);
      return i === -1 ? 99 : i;
    };
    const items = [
      ...activeTasks.map(t => ({ type: 'task', data: t, moodIndex: getMoodIndex(t.mood) })),
      ...memberMilestones.map(ms => ({ type: 'milestone', data: ms, moodIndex: getMoodIndex(ms.mood), isMilestone: true })),
    ];
    items.sort((a, b) => {
      if (a.moodIndex !== b.moodIndex) return a.moodIndex - b.moodIndex;
      if (a.isMilestone && !b.isMilestone) return -1;
      if (!a.isMilestone && b.isMilestone) return 1;
      return 0;
    });
    return items;
  }, [activeTasks, memberMilestones, S.moods]);

  const prog = useMemo(() => dayProgress(myTasksOnDate, S.task_statuses), [myTasksOnDate, S.task_statuses]);

  const totalMins = useMemo(() => {
    return myTasksOnDate.reduce((a, t) => a + ((t.estH || 0) * 60 + (t.estM || 0)), 0);
  }, [myTasksOnDate]);

  // Daily task limit
  const canCreateTaskBool = canCreateTask(S, memberId, date);
  const dailyActiveCount = getDailyActiveCount(S, memberId, date);
  const dailyLimit = getDailyLimit(S, memberId);

  // Only hidden tasks assigned to this member
  const myHiddenTasks = useMemo(() => {
    return myTasksOnDate.filter(t => t.hidden);
  }, [myTasksOnDate]);

  const setStatus = useCallback(async (taskId, status) => {
    const task = S.tasks.find(t => t.id === taskId);
    if (task) {
      const { upsertTask } = useStore.getState();
      await upsertTask({ ...task, status });
    }
  }, [S.tasks]);

  const hideTask = useCallback(async (taskId) => {
    const task = S.tasks.find(t => t.id === taskId);
    if (task) {
      try {
        const { upsertTask } = useStore.getState();
        await upsertTask({ ...task, hidden: true });
      } catch {
        useUIStore.getState().setToast('Failed to hide task — column may be missing.');
      }
    }
  }, [S.tasks]);

  const restoreTask = useCallback(async (taskId) => {
    const task = S.tasks.find(t => t.id === taskId);
    if (task) {
      try {
        const { upsertTask } = useStore.getState();
        await upsertTask({ ...task, hidden: false });
      } catch {
        useUIStore.getState().setToast('Failed to restore task — column may be missing.');
      }
    }
  }, [S.tasks]);

  const handleDelete = useCallback(async (taskId) => {
    await softDeleteTask(taskId);
  }, [softDeleteTask]);

  const setFilter = useCallback((key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSetSortMode = useCallback((m) => {
    setSortMode(prev => prev === m ? null : m);
  }, []);

  const handleSetViewMode = useCallback((mode) => {
    setViewMode(mode);
    try { localStorage.setItem('lineupViewMode', mode === 'priority' ? 'priority' : 'compact'); } catch {}
  }, []);

  return (
    <div className="lu-app">
      <LineUpHeader
        date={date} prog={prog} totalMins={totalMins} sortMode={sortMode}
        S={S} filters={{ ...filters, member: '' }} isManager={false}
        onShift={shift} onGoToday={goToday}
        onSetSortMode={handleSetSortMode} onSetFilter={setFilter}
        onNewTask={() => setTaskModal({ date, assignedTo: [memberId] })} viewMode={viewMode} onSetViewMode={handleSetViewMode} disableNewTask={!canCreateTaskBool} />

      {/* Daily task limit indicator */}
      {(() => {
        const capColor = dailyActiveCount > dailyLimit ? '#e76f51' : dailyActiveCount === dailyLimit ? '#d97706' : 'var(--t2)';
        return (
          <div className="lu-daily-limit">
            <span className="lu-daily-limit-label">Your daily limit:</span>
            <span style={{ fontWeight: 700, color: capColor }}>{dailyActiveCount}/{dailyLimit}</span>
          </div>
        );
      })()}

      <div className="lu-body">
        <div className="lu-main">
          {!combinedItems.length ? (
            <div className="lu-empty-state">
              <div className="lu-empty-icon">&#128203;</div>
              <p className="lu-empty-text">No tasks for this date</p>
            </div>
          ) : (
            combinedItems.map(item => {
              if (item.type === 'milestone') {
                return (
                  <MilestoneDashCard
                    key={item.data.id}
                    milestone={item.data}
                    S={S}
                    onClick={() => setMsModal(item.data)}
                  />
                );
              }
              return (
                <LineUpCard
                  key={item.data.id}
                  task={item.data}
                  S={S}
                  onOpen={setTaskModal}
                  onStatusChange={setStatus}
                  onHide={hideTask}
                  onDelete={canDeleteTask(session, item.data) ? handleDelete : undefined}
                  compact={viewMode === 'compact'}
                />
              );
            })
          )}
        </div>

        <HiddenTasksPanel
          hiddenTasks={myHiddenTasks} moods={S.moods} panelWidth={panelWidth}
          onResize={setPanelWidth} onRestore={restoreTask} />
      </div>

      <div className="lu-mobile-hidden">
        <button className="lu-mobile-hidden-toggle" onClick={() => setMobileHiddenOpen(o => !o)}>
          &#128065; Hidden ({myHiddenTasks.length})
        </button>

        {mobileHiddenOpen && (
          <div className="lu-mobile-drawer">
            <div className="lu-mobile-drawer-head">
              <span>&#128065; Hidden</span>
              <button className="btn btn-sm" onClick={() => setMobileHiddenOpen(false)}>Close</button>
            </div>
            <div className="lu-mobile-drawer-content">
              {!myHiddenTasks.length ? (
                <div className="lu-hidden-empty">No hidden tasks</div>
              ) : myHiddenTasks.map(t => {
                const mood = S.moods.find(m => m.id === t.mood);
                return (
                  <div key={t.id} className="lu-hidden-card">
                    <span className="lu-hidden-mood-icon">{mood?.icon || '?'}</span>
                    <span className="lu-title" style={{ flex: 1 }}>{t.name}</span>
                    <button className="lu-restore-btn" onClick={() => { restoreTask(t.id); setMobileHiddenOpen(false); }} title="Bring back to line up">&#8630;</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {taskModal && <TaskModal task={taskModal} onClose={() => setTaskModal(null)} onSaveAsTemplate={(d) => { useUIStore.getState().triggerSaveAsTemplate(d); }} />}
      {msModal && <MilestoneModal milestone={msModal} onClose={() => setMsModal(null)} onOpenTask={setTaskModal} onCreateTaskForSubstep={undefined} />}
    </div>
  );
}
