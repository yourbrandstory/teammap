export function getMilestonesForMemberToday(milestones, memberId, dateStr) {
  const dayName = new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  return (milestones || []).filter(ms =>
    !ms.deleted &&
    ms.assignedTo?.includes(memberId) &&
    ms.displayMode !== 'hidden' &&
    (ms.displayMode === 'daily' ||
      (ms.displayMode === 'specific_days' && ms.displayDays?.includes(dayName))) &&
    (!ms.date || dateStr >= ms.date) &&
    (!ms.deadline || ms.deadline >= dateStr)
  );
}

export function isTaskHiddenBySubstep(taskId, milestones) {
  if (!milestones) return false;
  for (const ms of milestones) {
    if (ms.deleted) continue;
    for (const ss of (ms.substeps || [])) {
      const link = (ss.linkedTasks || []).find(lt => lt.taskId === taskId);
      if (link) {
        return !link.showOnDashboard;
      }
    }
  }
  return false;
}

export function filterDashboardTasks(tasks, milestones) {
  if (!milestones || !milestones.length) return tasks;
  return tasks.filter(t => !isTaskHiddenBySubstep(t.id, milestones));
}
