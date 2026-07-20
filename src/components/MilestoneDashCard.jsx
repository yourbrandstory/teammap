import { getDeadlineClass, getDeadlineLabel, getDeadlineStatus } from '../lib/constants';
import { sel } from '../store/useStore';

function getMilestoneSummary(milestone, allTasks) {
  let overdue = 0;
  let dueToday = 0;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  for (const ss of (milestone.substeps || []).filter(Boolean)) {
    for (const link of (ss.linkedTasks || [])) {
      const task = allTasks.find(t => t.id === link.taskId);
      if (!task || !task.date || task.status === 'Complete' || task.deleted) continue;
      const taskDateStr = task.date.split('T')[0];
      if (taskDateStr < todayStr) overdue++;
      else if (taskDateStr === todayStr) dueToday++;
    }
  }
  return { overdue, dueToday };
}

const DlIcon = ({ type }) => {
  const icons = {
    overdue: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86l-8.3 14.34A1 1 0 0 0 2.76 20h18.48a1 1 0 0 0 .77-1.8l-8.3-14.34a1 1 0 0 0-1.72 0z"/></svg>,
    today: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    soon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  };
  return icons[type] || null;
};

export default function MilestoneDashCard({ milestone, S, onClick, style = {} }) {
  const substeps = (milestone.substeps || []).filter(Boolean);
  const total = substeps.length;
  const done = substeps.filter(s => s.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const dlClass = getDeadlineClass(milestone.deadline);
  const dlLabel = getDeadlineLabel(milestone.deadline);
  const dlStatus = getDeadlineStatus(milestone.deadline);
  const mood = milestone.mood ? sel.gmood(S, milestone.mood) : null;
  const client = milestone.clientId ? sel.gc(S, milestone.clientId) : null;
  const summary = getMilestoneSummary(milestone, S.tasks);

  return (
    <div className="ms-dash-card" style={{ position: 'relative', ...style }} onClick={onClick}>
      <div className="ms-dash-head">
        <span className="ms-dash-badge">◆ MILESTONE</span>
        {dlLabel && <span className={`ms-dash-deadline ${dlClass}`}>{dlLabel}</span>}
      </div>
      {(summary.overdue > 0 || summary.dueToday > 0) && (
        <div className="ms-dash-summary">
          {summary.overdue > 0 && <span className="ms-sum-overdue">● {summary.overdue} overdue</span>}
          {summary.overdue > 0 && summary.dueToday > 0 && <span className="ms-sum-sep">·</span>}
          {summary.dueToday > 0 && <span className="ms-sum-today">● {summary.dueToday} due today</span>}
        </div>
      )}
      <div className="ms-dash-title">{milestone.title}</div>
      <div className="ms-dash-progress">
        <div className="ms-dash-bar"><div className="ms-dash-fill" style={{ width: `${pct}%` }} /></div>
        <span className="ms-dash-pct">{done}/{total} · {pct}%</span>
        {dlStatus && <span className={`ms-dash-deadline-badge ${dlStatus.type}`}><DlIcon type={dlStatus.type} />{dlStatus.label}</span>}
      </div>
      <div className="ms-dash-meta">
        {mood && <span className="ms-dash-chip" style={{ background: mood.bg, color: mood.color }}>{mood.icon} {mood.label}</span>}
        {client && <span className="ms-dash-chip" style={{ background: (client.color || 'var(--s2)') + '22', color: client.color || 'var(--t2)' }}>{client.name}</span>}
      </div>
    </div>
  );
}
