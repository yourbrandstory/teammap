import { useState, useCallback, useMemo, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';
import type { LVFilters, LVSort } from '../utils/listViewHelpers';
import { filterAndSortTasks, toggleSort, DEFAULT_FILTERS, DEFAULT_SORT } from '../utils/listViewHelpers';

export default function useListView(memberFilter?: string) {
  const S = useStore(s => s.S);
  const softDeleteTask = useStore(s => s.softDeleteTask);
  const uiViewState = useUIStore(s => s.viewStates.lv || {});
  const setViewState = useUIStore(s => s.setViewState);

  const [lvSort, setLvSort] = useState<LVSort>(uiViewState.lvSort || DEFAULT_SORT);
  const [lvFilters, setLvFilters] = useState<LVFilters>({
    ...(uiViewState.lvFilters || DEFAULT_FILTERS),
    ...(memberFilter ? { member: memberFilter } : {}),
  });
  const [taskModal, setTaskModal] = useState<any>(null);

  useEffect(() => {
    setViewState('lv', { lvSort, lvFilters });
  }, [lvSort, lvFilters, setViewState]);

  const lookup = useMemo(() => ({
    members: S.members,
    clients: S.clients,
    moods: S.moods,
    tags: S.tags,
  }), [S.members, S.clients, S.moods, S.tags]);

  const tasks = useMemo(() =>
    filterAndSortTasks(S.tasks, lvFilters, lvSort, lookup, S.task_statuses),
    [S.tasks, lvFilters, lvSort, lookup],
  );

  const activeCount = tasks.length;
  const totalCount = useMemo(() =>
    S.tasks.filter((t: any) => !t.deleted).length,
    [S.tasks],
  );

  const setFilter = useCallback((key: string, value: string) => {
    if (key === 'member' && memberFilter) return;
    setLvFilters(prev => ({ ...prev, [key]: value }));
  }, [memberFilter]);

  const clearFilters = useCallback(() => {
    setLvFilters(prev => ({
      search: '', dateRange: 'all', member: memberFilter || '', client: '', mood: '', status: '', tag: '',
      hideCompleted: prev.hideCompleted,
    }));
  }, [memberFilter]);

  const toggleHideCompleted = useCallback(() => {
    setLvFilters(prev => ({ ...prev, hideCompleted: !prev.hideCompleted }));
  }, []);

  const sortBy = useCallback((col: string) => {
    setLvSort(prev => toggleSort(prev, col));
  }, []);

  const setSort = useCallback((col: string, dir: 'asc' | 'desc') => {
    setLvSort({ col, dir });
  }, []);

  const openTask = useCallback((task: any) => {
    setTaskModal(task);
  }, []);

  const deleteTask = useCallback(async (taskId: string) => {
    await softDeleteTask(taskId);
  }, [softDeleteTask]);

  return {
    S, tasks, lvSort, lvFilters, taskModal, activeCount, totalCount,
    setFilter, clearFilters, toggleHideCompleted, sortBy, setSort, openTask, setTaskModal, deleteTask,
  };
}
