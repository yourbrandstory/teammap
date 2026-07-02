import { useState, useMemo } from 'react';
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useStore } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';
import useLineUp from '../hooks/useLineUp';
import { getMilestonesForMemberToday } from '../utils/milestoneHelpers';
import LineUpHeader from '../components/lineup/LineUpHeader';
import LineUpCard from '../components/lineup/LineUpCard';
import HiddenTasksPanel from '../components/HiddenTasksPanel';
import MilestoneDashCard from '../components/MilestoneDashCard';
import MilestoneModal from '../components/MilestoneModal';
import TaskModal from '../components/TaskModal';

export default function LineUp() {
  const session = useStore(s => s.session);
  const isManager = session?.role === 'admin' || session?.role === 'manager';
  const {
    S, date, sortMode, filters, tasks, allOnDate, prog, totalMins,
    panelWidth, activeId, taskModal, viewMode,
    setDate, shift, goToday, setSortMode, setFilter,
    setStatus, hideTask, restoreTask,
    handleDragEnd, setActiveId, setTaskModal, setPanelWidth, setViewMode,
  } = useLineUp();

  const [mobileHiddenOpen, setMobileHiddenOpen] = useState(false);
  const [msModal, setMsModal] = useState(null);

  const activeTask = activeId ? S.tasks.find((t: any) => t.id === activeId) : null;

  const hiddenTasks = useMemo(() => {
    return S.tasks.filter((t: any) => t.date === date && !t.deleted && t.hidden);
  }, [S.tasks, date]);

  const memberMilestones = useMemo(() => {
    const memberId = filters.member;
    if (!memberId) return [];
    return getMilestonesForMemberToday(S.milestones, memberId, date);
  }, [S.milestones, filters.member, date]);

  const combinedItems = useMemo(() => {
    const moodOrder = S.moods.map((m: any) => m.id);
    const tasksByMood: Record<string, any[]> = {};
    tasks.forEach((t: any) => {
      const m = t.mood || '__none__';
      if (!tasksByMood[m]) tasksByMood[m] = [];
      tasksByMood[m].push(t);
    });
    const items: any[] = [];
    moodOrder.forEach((moodId: string) => {
      memberMilestones.filter((ms: any) => ms.mood === moodId).forEach((ms: any) => {
        items.push({ type: 'milestone', data: ms });
      });
      (tasksByMood[moodId] || []).forEach((t: any) => {
        items.push({ type: 'task', data: t });
      });
    });
    (memberMilestones.filter((ms: any) => !ms.mood)).forEach((ms: any) => {
      items.push({ type: 'milestone', data: ms });
    });
    (tasksByMood['__none__'] || []).forEach((t: any) => {
      items.push({ type: 'task', data: t });
    });
    return items;
  }, [memberMilestones, tasks, S.moods]);

  const handleShift = (dir: number, explicitDate?: string) => {
    if (explicitDate !== undefined) { setDate(explicitDate); return; }
    shift(dir);
  };

  return (
    <div className="lu-app">
      <LineUpHeader
        date={date} prog={prog} totalMins={totalMins} sortMode={sortMode}
        S={S} filters={filters} isManager={isManager} viewMode={viewMode}
        onShift={handleShift} onGoToday={goToday}
        onSetSortMode={setSortMode} onSetFilter={setFilter}
        onNewTask={() => setTaskModal({ date })} onSetViewMode={setViewMode} />

      <div className="lu-body">
        <div className="lu-main">
          {!combinedItems.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 200, gap: 8, color: 'var(--t3)' }}>
              <div style={{ fontSize: 36 }}>&#128203;</div>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--t2)' }}>No tasks for this date</p>
            </div>
          ) : (
            <DndContext
              collisionDetection={pointerWithin}
              onDragStart={(e) => setActiveId(e.active.id as string)}
              onDragEnd={handleDragEnd}
              onDragCancel={() => setActiveId(null)}>
              <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                {combinedItems.map(item =>
                  item.type === 'milestone' ? (
                    <MilestoneDashCard key={item.data.id} milestone={item.data} S={S} onClick={() => setMsModal(item.data)} />
                  ) : (
                    <LineUpCard key={item.data.id} task={item.data} S={S}
                      onOpen={setTaskModal}
                      onStatusChange={setStatus}
                      onHide={hideTask}
                      compact={viewMode === 'compact'} />
                  )
                )}
              </SortableContext>
              <DragOverlay>
                {activeTask ? <LineUpCard task={activeTask} S={S} isOverlay compact={viewMode === 'compact'} /> : null}
              </DragOverlay>
            </DndContext>
          )}
        </div>

        <HiddenTasksPanel
          hiddenTasks={hiddenTasks} moods={S.moods} panelWidth={panelWidth}
          onResize={setPanelWidth} onRestore={restoreTask} />
      </div>

      <div className="lu-mobile-hidden">
        <button className="lu-mobile-hidden-toggle" onClick={() => setMobileHiddenOpen(o => !o)}>
          &#128065; Hidden ({hiddenTasks.length})
        </button>

        {mobileHiddenOpen && (
          <div className="lu-mobile-drawer">
            <div className="lu-mobile-drawer-head">
              <span>&#128065; Hidden</span>
              <button className="btn btn-sm" onClick={() => setMobileHiddenOpen(false)}>Close</button>
            </div>
            <div className="lu-mobile-drawer-content">
              {!hiddenTasks.length ? (
                <div style={{ fontSize: 12, color: 'var(--t3)', padding: '12px 6px', textAlign: 'center' }}>No hidden tasks</div>
              ) : hiddenTasks.map((t: any) => {
                const mood = S.moods.find((m: any) => m.id === t.mood);
                return (
                  <div key={t.id} className="lu-hidden-card">
                    <span style={{ fontSize: 13 }}>{mood?.icon || '?'}</span>
                    <span className="lu-title" style={{ flex: 1 }}>{t.name}</span>
                    <button className="lu-restore-btn" onClick={() => { restoreTask(t.id); setMobileHiddenOpen(false); }} title="Bring back to line up">&#8630;</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {taskModal && <TaskModal task={taskModal} onClose={() => setTaskModal(null)} onSaveAsTemplate={(d: any) => { useUIStore.getState().triggerSaveAsTemplate(d); }} />}
      {msModal && <MilestoneModal milestone={msModal} onClose={() => setMsModal(null)} onOpenTask={setTaskModal} onCreateTaskForSubstep={undefined} />}
    </div>
  );
}
