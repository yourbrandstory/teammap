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
    for (const ss of (ms.substeps || []).filter(Boolean)) {
      const link = (ss.linkedTasks || []).filter(Boolean).find(lt => lt.taskId === taskId);
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

/** Return all milestone-substep links for a task (many-to-many). */
export function getTaskMilestoneLinks(taskId, milestones) {
  if (!taskId || !milestones) return [];
  const results = [];
  for (const ms of milestones) {
    if (ms.deleted) continue;
    for (const ss of (ms.substeps || []).filter(Boolean)) {
      const link = (ss.linkedTasks || []).filter(Boolean).find(lt => lt.taskId === taskId);
      if (link) results.push({ milestone: ms, substep: ss, link });
    }
  }
  return results;
}

/** @deprecated Use getTaskMilestoneLinks (plural) which returns an array. Kept for backward compat. */
export function getTaskMilestoneLink(taskId, milestones) {
  const links = getTaskMilestoneLinks(taskId, milestones);
  return links.length > 0 ? links[0] : null;
}
