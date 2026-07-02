import { getDeadlineClass, getDeadlineLabel } from '../lib/constants';
import { sel } from '../store/useStore';

export default function MilestoneDashCard({ milestone, S, onClick, style = {} }) {
  const total = milestone.substeps.length;
  const done = milestone.substeps.filter(s => s.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  const dlClass = getDeadlineClass(milestone.deadline);
  const dlLabel = getDeadlineLabel(milestone.deadline);
  const mood = milestone.mood ? sel.gmood(S, milestone.mood) : null;
  const client = milestone.clientId ? sel.gc(S, milestone.clientId) : null;

  return (
    <div className="ms-dash-card" style={{ position: 'relative', ...style }} onClick={onClick}>
      <div className="ms-dash-head">
        <span className="ms-dash-badge">◆ MILESTONE</span>
        {dlLabel && <span className={`ms-dash-deadline ${dlClass}`}>{dlLabel}</span>}
      </div>
      <div className="ms-dash-title">{milestone.title}</div>
      <div className="ms-dash-progress">
        <div className="ms-dash-bar"><div className="ms-dash-fill" style={{ width: `${pct}%` }} /></div>
        <span className="ms-dash-pct">{done}/{total} · {pct}%</span>
      </div>
      <div className="ms-dash-meta">
        {mood && <span className="ms-dash-chip" style={{ background: mood.bg, color: mood.color }}>{mood.icon} {mood.label}</span>}
        {client && <span className="ms-dash-chip" style={{ background: (client.color || 'var(--s2)') + '22', color: client.color || 'var(--t2)' }}>{client.name}</span>}
      </div>
    </div>
  );
}
