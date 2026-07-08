import { useState, useCallback, useMemo, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';
import { today } from '../lib/constants';
import { getFilteredAndSortedTasks, dayProgress } from '../utils/lineUpHelpers';
import { getMilestonesForMemberToday } from '../utils/milestoneHelpers';
import type { DragEndEvent } from '@dnd-kit/core';

type SortMode = 'mood' | 'team' | 'client' | null;
type Filters = { member: string; client: string; mood: string; review: boolean; search: string; status: string };

function getStoredViewMode(): 'priority' | 'compact' {
  try {
    const v = localStorage.getItem('lineupViewMode');
    if (v === 'compact') return 'compact';
    return 'priority';
  } catch { return 'compact'; }
}

function generateItemOrder(tasks: any[], milestones: any[], moods: any[]): string[] {
  const moodOrder = moods.map((m: any) => m.id);
  const tasksByMood: Record<string, any[]> = {};
  tasks.forEach((t: any) => {
    const m = t.mood || '__none__';
    if (!tasksByMood[m]) tasksByMood[m] = [];
    tasksByMood[m].push(t);
  });
  const order: string[] = [];
  moodOrder.forEach((moodId: string) => {
    milestones.filter((ms: any) => ms.mood === moodId).forEach((ms: any) => {
      order.push(`milestone_${ms.id}`);
    });
    (tasksByMood[moodId] || []).forEach((t: any) => {
      order.push(`task_${t.id}`);
    });
  });
  milestones.filter((ms: any) => !ms.mood).forEach((ms: any) => {
    order.push(`milestone_${ms.id}`);
  });
  (tasksByMood['__none__'] || []).forEach((t: any) => {
    order.push(`task_${t.id}`);
  });
  return order;
}

export default function useLineUp() {
  const S = useStore(s => s.S);
  const upsertTask = useStore(s => s.upsertTask);
  const saveLineUp = useStore(s => s.saveLineUp);
  const uiViewState = useUIStore(s => s.viewStates.lu || {});
  const setViewState = useUIStore(s => s.setViewState);

  const [date, setDate] = useState(uiViewState.date || today());
  const [sortMode, setSortMode] = useState<SortMode>((uiViewState.sortMode as SortMode) || 'mood');
  const [filters, setFilters] = useState<Filters>(uiViewState.filters || { member: '', client: '', mood: '', review: false, search: '', status: '' });
  const [panelWidth, setPanelWidth] = useState(uiViewState.panelWidth || 380);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [taskModal, setTaskModal] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'priority' | 'compact'>(getStoredViewMode);

  const handleSetViewMode = useCallback((mode: 'priority' | 'compact') => {
    setViewMode(mode);
    try { localStorage.setItem('lineupViewMode', mode); } catch {}
  }, []);

  // Persist UI state on change
  useEffect(() => {
    setViewState('lu', { date, sortMode, filters, panelWidth });
  }, [date, sortMode, filters, panelWidth, setViewState]);

  const shift = useCallback((days: number) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }, [date]);

  const goToday = useCallback(() => setDate(today()), []);

  const memberKey = filters.member || '__global__';
  const taskOrder = S.lineUp?.[memberKey]?.[date] || [];
  const tasks = getFilteredAndSortedTasks(S, date, filters, sortMode, S.task_statuses, taskOrder);
  const allOnDate = S.tasks.filter((t: any) => t.date === date && !t.deleted);
  const prog = dayProgress(allOnDate, S.task_statuses);

  const totalMins = allOnDate.reduce((a: number, t: any) => a + ((t.estH || 0) * 60 + (t.estM || 0)), 0);

  const memberMilestones = useMemo(() => {
    const memberId = filters.member;
    if (!memberId) return [];
    return getMilestonesForMemberToday(S.milestones, memberId, date);
  }, [S.milestones, filters.member, date]);

  const storedItemOrder = S.lineUpItemOrder?.[memberKey]?.[date] as string[] | undefined;
  const itemOrder = useMemo(() => {
    if (storedItemOrder && storedItemOrder.length) return storedItemOrder;
    return generateItemOrder(tasks, memberMilestones, S.moods);
  }, [storedItemOrder, tasks, memberMilestones, S.moods]);

  const combinedItems = useMemo(() => {
    if (!itemOrder || !itemOrder.length) return [];
    const taskMap: Record<string, any> = {};
    tasks.forEach((t: any) => { taskMap[`task_${t.id}`] = t; });
    const msMap: Record<string, any> = {};
    memberMilestones.forEach((ms: any) => { msMap[`milestone_${ms.id}`] = ms; });
    const items: any[] = [];
    itemOrder.forEach((prefixedId: string) => {
      if (prefixedId.startsWith('milestone_')) {
        const ms = msMap[prefixedId];
        if (ms) items.push({ type: 'milestone', data: ms });
      } else if (prefixedId.startsWith('task_')) {
        const task = taskMap[prefixedId];
        if (task) items.push({ type: 'task', data: task });
      }
    });
    return items;
  }, [itemOrder, tasks, memberMilestones]);

  const setStatus = useCallback(async (taskId: string, status: string) => {
    const t = S.tasks.find((x: any) => x.id === taskId);
    if (t) await upsertTask({ ...t, status });
  }, [S.tasks, upsertTask]);

  const hideTask = useCallback(async (taskId: string) => {
    const t = S.tasks.find((x: any) => x.id === taskId);
    if (t) {
      try { await upsertTask({ ...t, hidden: true }); }
      catch { useUIStore.getState().setToast('Failed to hide task.'); }
    }
  }, [S.tasks, upsertTask]);

  const restoreTask = useCallback(async (taskId: string) => {
    const t = S.tasks.find((x: any) => x.id === taskId);
    if (t) {
      try { await upsertTask({ ...t, hidden: false }); }
      catch { useUIStore.getState().setToast('Failed to restore task.'); }
    }
  }, [S.tasks, upsertTask]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) { setActiveId(null); return; }
    const oldIdx = combinedItems.findIndex(item =>
      (item.type === 'milestone' ? `milestone_${item.data.id}` : `task_${item.data.id}`) === active.id
    );
    const newIdx = combinedItems.findIndex(item =>
      (item.type === 'milestone' ? `milestone_${item.data.id}` : `task_${item.data.id}`) === over.id
    );
    if (oldIdx === -1 || newIdx === -1) { setActiveId(null); return; }
    const newOrder = combinedItems.map(item =>
      item.type === 'milestone' ? `milestone_${item.data.id}` : `task_${item.data.id}`
    );
    const [moved] = newOrder.splice(oldIdx, 1);
    newOrder.splice(newIdx, 0, moved);
    const taskIds = newOrder
      .filter((id: string) => id.startsWith('task_'))
      .map((id: string) => id.slice(5));
    const key = filters.member || '__global__';
    saveLineUp(key, date, taskIds, newOrder);
    setActiveId(null);
  }, [combinedItems, date, saveLineUp, filters.member]);

  const setFilter = useCallback((key: keyof Filters, value: string | boolean) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSetSortMode = useCallback((m: SortMode) => {
    setSortMode(prev => prev === m ? null : m);
  }, []);

  return {
    S, date, sortMode, filters, tasks, allOnDate, prog, totalMins,
    panelWidth, activeId, taskModal, viewMode, memberMilestones, combinedItems, itemOrder,
    setDate, shift, goToday, setSortMode: handleSetSortMode, setFilter,
    setStatus, hideTask, restoreTask,
    handleDragEnd, setActiveId, setTaskModal, setPanelWidth, setViewMode: handleSetViewMode,
  };
}
