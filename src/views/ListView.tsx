import useListView from '../hooks/useListView';
import { useUIStore } from '../store/useUIStore';
import ListToolbar from '../components/listview/ListToolbar';
import TaskTable from '../components/listview/TaskTable';
import TaskModal from '../components/TaskModal';

export default function ListView() {
  const {
    S, tasks, lvSort, lvFilters, taskModal, activeCount, totalCount,
    setFilter, clearFilters, toggleHideCompleted, sortBy, setSort, openTask, setTaskModal, deleteTask,
  } = useListView();

  return (
    <div className="lv-wrap">
      <ListToolbar
        S={S}
        lvSort={lvSort}
        lvFilters={lvFilters}
        activeCount={activeCount}
        totalCount={totalCount}
        onSetFilter={setFilter}
        onClearFilters={clearFilters}
        onToggleHideCompleted={toggleHideCompleted}
        onSetSort={setSort}
        onNewTask={() => setTaskModal({})}
      />
      <TaskTable
        tasks={tasks}
        S={S}
        lvSort={lvSort}
        onSortBy={sortBy}
        onOpenTask={openTask}
        onDeleteTask={deleteTask}
      />
      {taskModal && (
        <TaskModal
          task={taskModal}
          onClose={() => setTaskModal(null)}
          onSaveAsTemplate={(d: any) => { useUIStore.getState().triggerSaveAsTemplate(d); }}
        />
      )}
    </div>
  );
}
