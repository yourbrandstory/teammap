import { fmtD } from '../../lib/constants';
import { getCompleteStatus, getPassStatus } from '../../utils/statusUtils';

type SortMode = 'mood' | 'team' | 'client' | null;
type Filters = { member: string; client: string; mood: string; review: boolean; search: string; status: string };

interface Member { id: string; name: string; capacity?: number; }
interface Client { id: string; name: string; }
interface Mood { id: string; icon: string; label: string; hidden?: boolean; visible?: boolean; }
interface Task { id: string; date: string; assignedTo?: string[]; status: string; deleted?: boolean; }
interface S { members: Member[]; clients: Client[]; moods: Mood[]; tasks: Task[]; task_statuses?: { id: string; label: string; order: number }[]; }
interface Prog { done: number; total: number; pct: number; }

interface Props {
  date: string;
  prog: Prog;
  totalMins: number;
  sortMode: SortMode;
  S: S;
  filters: Filters;
  isManager: boolean;
  viewMode: 'priority' | 'compact';
  onShift: (dir: number, val?: string) => void;
  onGoToday: () => void;
  onSetSortMode: (m: SortMode) => void;
  onSetFilter: (k: keyof Filters, v: string | boolean) => void;
  onNewTask: () => void;
  onSetViewMode: (mode: 'priority' | 'compact') => void;
  disableNewTask?: boolean;
}

export default function LineUpHeader({ date, prog, totalMins, sortMode, S, filters, isManager, viewMode,
  onShift, onGoToday, onSetSortMode, onSetFilter, onNewTask, onSetViewMode, disableNewTask }: Props) {
  const totalStr = totalMins
    ? `${Math.floor(totalMins / 60)}h${totalMins % 60 ? ' ' + totalMins % 60 + 'm' : ''}`
    : '0h';

  const sortModes = (isManager ? ['mood', 'team', 'client'] : ['mood', 'client']) as Exclude<SortMode, null>[];
  const cStatus = getCompleteStatus(S.task_statuses);
  const pStatus = getPassStatus(S.task_statuses);

  const progressContent = (
    <div className="lu-hdr-progress">
      <div className="lu-hdr-progress-head">
        <span>Day progress</span>
        <span style={{ fontWeight: 700, color: prog.pct === 100 ? 'var(--accent)' : 'var(--t2)' }}>
          {prog.done}/{prog.total} &middot; {prog.pct}%
        </span>
      </div>
      <div className="lu-hdr-progress-track">
        <div className="lu-hdr-progress-fill" style={{
          background: prog.pct === 100 ? 'var(--accent)' : prog.pct > 60 ? 'var(--a2)' : 'var(--info)',
          width: `${prog.pct}%`
        }} />
      </div>
    </div>
  );

  return (
    <div className="lu-hdr">
      {/* ── DESKTOP ── */}
      <div className="lu-desk-wrap">
        {/* ROW 1 — Navigation | Progress | Sort | Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, width: '100%', flexWrap: 'nowrap' }}>
          {/* Navigation group */}
          <div className="lu-hdr-nav-group">
            <div className="lu-hdr-date-nav">
              <button className="btn btn-sm" style={{ padding: '4px 10px', fontSize: 15, fontWeight: 700 }} onClick={() => onShift(-1)}>&#8592;</button>
              <input type="date" value={date} onChange={e => onShift(0, e.target.value)} className="lu-hdr-date-input" />
              <button className="btn btn-sm" style={{ padding: '4px 10px', fontSize: 15, fontWeight: 700 }} onClick={() => onShift(1)}>&#8594;</button>
            </div>
            <button className="btn btn-sm" onClick={onGoToday} style={{ fontWeight: 700 }}>Today</button>
            <div className="lu-hdr-view-toggle">
              <button className={`btn btn-xs${viewMode === 'priority' ? ' btn-p' : ''}`} onClick={() => onSetViewMode('priority')}>Standard</button>
              <button className={`btn btn-xs${viewMode === 'compact' ? ' btn-p' : ''}`} onClick={() => onSetViewMode('compact')}>Compact</button>
            </div>
            <button className="btn btn-sm btn-p" onClick={onNewTask} disabled={disableNewTask} title={disableNewTask ? 'Daily task limit reached' : ''}>+ New task</button>
          </div>

          {/* Progress group */}
          <div className="lu-hdr-progress-group">
            <span className="lu-hdr-date-text">{fmtD(date)}</span>
            <div className="lu-hdr-progress-wrap">
              <div className="lu-hdr-progress-head">
                <span style={{ fontWeight: 700, color: prog.pct === 100 ? 'var(--accent)' : 'var(--t2)' }}>
                  {prog.done}/{prog.total} &middot; {prog.pct}%
                </span>
              </div>
              <div className="lu-hdr-progress-track">
                <div className="lu-hdr-progress-fill" style={{
                  background: prog.pct === 100 ? 'var(--accent)' : prog.pct > 60 ? 'var(--a2)' : 'var(--info)',
                  width: `${prog.pct}%`
                }} />
              </div>
            </div>
            <span className="lu-time-chip">&#9201; {totalStr}</span>
          </div>

          {/* Sort group */}
          <div className="sort-group">
            <span className="lu-hdr-sort-label">Sort:</span>
            {sortModes.map(m => (
              <button key={m} className={`btn btn-xs${sortMode === m ? ' btn-p' : ''}`} onClick={() => onSetSortMode(m)}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>

          {/* Filter group */}
          <div className="filter-group">
            {isManager && (
              <select className="fsel" value={filters.member} onChange={e => onSetFilter('member', e.target.value)}>
                <option value="">All members</option>
                {S.members.map(m => {
                  const dailyCount = (S.tasks || []).filter(t =>
                    t.assignedTo?.includes(m.id) &&
                    t.date === date &&
                    !t.deleted &&
                    t.status !== cStatus &&
                    t.status !== pStatus
                  ).length;
                  const lim = m.capacity ?? 6;
                  return <option key={m.id} value={m.id}>{m.name} ({dailyCount}/{lim})</option>;
                })}
              </select>
            )}
            <select className="fsel" value={filters.client} onChange={e => onSetFilter('client', e.target.value)}>
              <option value="">All clients</option>
              {S.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="fsel" value={filters.mood} onChange={e => onSetFilter('mood', e.target.value)}>
              <option value="">All moods</option>
              {S.moods.filter(m => !m.hidden).map(m => <option key={m.id} value={m.id}>{m.icon} {m.label}</option>)}
            </select>
            <select className="fsel" value={filters.status} onChange={e => onSetFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {(S.task_statuses || []).sort((a: any, b: any) => a.order - b.order).map((s: any) => (
                <option key={s.id} value={s.label}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ROW 2 — Review & Search */}
        <div className="search-row">
          <button
            className={`btn btn-sm${filters.review ? ' btn-p' : ''}`}
            onClick={() => onSetFilter('review', !filters.review)}
            style={{ width: 110, flexShrink: 0 }}
          >
            Review{filters.review ? ' ✕' : ''}
          </button>
          <input
            className="fsel"
            type="text"
            placeholder="Search tasks..."
            value={filters.search}
            onChange={e => onSetFilter('search', e.target.value)}
          />
        </div>
      </div>

      {/* ── MOBILE ── */}
      <div className="lu-mob-wrap">
        <div className="mobile-date-row">
          <button className="btn btn-sm" style={{ padding: '4px 10px', fontSize: 15, fontWeight: 700, flexShrink: 0 }} onClick={() => onShift(-1)}>&#8592;</button>
          <input type="date" value={date} onChange={e => onShift(0, e.target.value)} className="mobile-date-picker" />
          <button className="btn btn-sm" style={{ padding: '4px 10px', fontSize: 15, fontWeight: 700, flexShrink: 0 }} onClick={() => onShift(1)}>&#8594;</button>
        </div>

        <div className="mobile-action-row">
          <button className="btn btn-sm today-btn" onClick={onGoToday} style={{ fontWeight: 700, flexShrink: 0 }}>Today</button>
          <div className="view-toggle">
            <button className={`btn btn-xs${viewMode === 'priority' ? ' btn-p' : ''}`} onClick={() => onSetViewMode('priority')}>Priority</button>
            <button className={`btn btn-xs${viewMode === 'compact' ? ' btn-p' : ''}`} onClick={() => onSetViewMode('compact')}>Compact</button>
          </div>
          <span className="lu-hdr-sort-label">Sort:</span>
          {sortModes.map(m => (
            <button key={m} className={`btn btn-xs${sortMode === m ? ' btn-p' : ''}`} onClick={() => onSetSortMode(m)} style={{ flexShrink: 0 }}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
          <button className="btn btn-sm btn-p new-task-btn" onClick={onNewTask} disabled={disableNewTask} title={disableNewTask ? 'Daily task limit reached' : ''} style={{ flexShrink: 0 }}>+ New task</button>
        </div>

        <div className="lu-mob-info-row">
          <span className="lu-hdr-date-text">{fmtD(date)}</span>
        </div>

        <div className="lu-mob-progress-row">
          {progressContent}
          <span className="lu-time-chip">&#9201; {totalStr}</span>
        </div>

        <div className="lu-mob-filter-row">
          {isManager && (
            <select className="fsel" value={filters.member} onChange={e => onSetFilter('member', e.target.value)}>
              <option value="">All members</option>
              {S.members.map(m => {
                const dailyCount = (S.tasks || []).filter(t =>
                  t.assignedTo?.includes(m.id) &&
                  t.date === date &&
                  !t.deleted &&
                  t.status !== cStatus &&
                  t.status !== pStatus
                ).length;
                const lim = m.capacity ?? 6;
                return <option key={m.id} value={m.id}>{m.name} ({dailyCount}/{lim})</option>;
              })}
            </select>
          )}
          <select className="fsel" value={filters.client} onChange={e => onSetFilter('client', e.target.value)}>
            <option value="">All clients</option>
            {S.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="fsel" value={filters.mood} onChange={e => onSetFilter('mood', e.target.value)}>
            <option value="">All moods</option>
            {S.moods.filter(m => !m.hidden).map(m => <option key={m.id} value={m.id}>{m.icon} {m.label}</option>)}
          </select>
          <select className="fsel" value={filters.status} onChange={e => onSetFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {(S.task_statuses || []).sort((a: any, b: any) => a.order - b.order).map((s: any) => (
              <option key={s.id} value={s.label}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="lu-mob-review-row">
          <button
            className={`btn btn-sm${filters.review ? ' btn-p' : ''}`}
            onClick={() => onSetFilter('review', !filters.review)}
            style={{ flexShrink: 0 }}
          >
            Review{filters.review ? ' ✕' : ''}
          </button>
          <input
            className="fsel"
            type="text"
            placeholder="Search tasks..."
            value={filters.search}
            onChange={e => onSetFilter('search', e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
