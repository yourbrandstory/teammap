import { useState, useCallback, useMemo, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';
import { today } from '../lib/constants';
import { getFilteredAndSortedTasks, dayProgress } from '../utils/lineUpHelpers';
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
    const ids = tasks.map(t => t.id);
    const oldIdx = ids.indexOf(active.id as string);
    const newIdx = ids.indexOf(over.id as string);
    if (oldIdx === -1 || newIdx === -1) { setActiveId(null); return; }
    ids.splice(oldIdx, 1);
    ids.splice(newIdx, 0, active.id as string);
    const key = filters.member || '__global__';
    saveLineUp(key, date, ids);
    setActiveId(null);
  }, [tasks, date, saveLineUp, filters.member]);

  const setFilter = useCallback((key: keyof Filters, value: string | boolean) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSetSortMode = useCallback((m: SortMode) => {
    setSortMode(prev => prev === m ? null : m);
  }, []);

  return {
    S, date, sortMode, filters, tasks, allOnDate, prog, totalMins,
    panelWidth, activeId, taskModal, viewMode,
    setDate, shift, goToday, setSortMode: handleSetSortMode, setFilter,
    setStatus, hideTask, restoreTask,
    handleDragEnd, setActiveId, setTaskModal, setPanelWidth, setViewMode: handleSetViewMode,
  };
}
