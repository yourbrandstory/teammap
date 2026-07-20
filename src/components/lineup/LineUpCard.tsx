import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { taskTimeStr } from '../../lib/constants';
import { getCardSize } from '../../utils/lineUpHelpers';
import { getStatusMaps, getStatusesForRole } from '../../utils/statusUtils';
import { getNotesText } from '../../utils/notesUtils';
import { useStore } from '../../store/useStore';
import CircProg from '../CircProg';
import CompactTaskCard from './CompactTaskCard';

interface Task {
  id: string; name: string; mood: string; status: string; clientId?: string;
  assignedTo?: string[]; isMilestone?: boolean; notes?: string;
  estH?: number; estM?: number;
  subtasks?: { text: string; done: boolean }[];
  links?: { label: string; url: string }[];
}
interface Member { id: string; name: string; color: string; }
interface Client { id: string; name: string; color: string; }
interface Mood { id: string; icon: string; label: string; color: string; bg: string; }
interface S { members: Member[]; clients: Client[]; moods: Mood[]; task_statuses?: { id: string; label: string; order: number }[]; }

interface Props {
  task: Task;
  S: S;
  onOpen: (t: any) => void;
  onStatusChange: (id: string, s: string) => void;
  onHide: (id: string) => void;
  onDelete?: (id: string) => void;
  isOverlay?: boolean;
  compact?: boolean;
}

export default function LineUpCard({ task, S, onOpen, onStatusChange, onHide, onDelete, isOverlay, compact }: Props) {
  const [linkPop, setLinkPop] = useState(false);
  const session = useStore(ss => ss.session);
  const role = session?.role || 'member';
  const cardSize = getCardSize(task.mood, S.moods);
  const isNarrow = cardSize === 'narrow';
  const isBig = cardSize === 'big';
  const mood = S.moods.find(m => m.id === task.mood);
  const client = S.clients.find(c => c.id === task.clientId);
  const moodColor = mood?.color || '#888';
  const moodBg = mood?.bg || '#f2f0ec';
  const assignees = (task.assignedTo || []).map(id => S.members.find(m => m.id === id)).filter(Boolean) as Member[];
  const timeStr = taskTimeStr(task as any);
  const hasLinks = task.links && task.links.length > 0;
  const hasSubtasks = task.subtasks && task.subtasks.length > 0;
  const subTotal = task.subtasks?.length || 0;
  const subDone = task.subtasks?.filter(Boolean).filter(s => s.done).length || 0;
  const { STATS, STC, STB } = getStatusMaps(S.task_statuses);
  const roleStatuses = getStatusesForRole(S.task_statuses, role);

  let sortable: any = {};
  if (!isOverlay) {
    const hook = useSortable({ id: task.id });
    sortable = {
      ref: hook.setNodeRef,
      style: {
        transform: CSS.Transform.toString(hook.transform),
        transition: hook.transition,
        opacity: hook.isDragging ? 0.4 : 1,
      },
      handleProps: { ...hook.attributes, ...hook.listeners },
    };
  }

  if (compact) {
    return (
      <CompactTaskCard
        task={task}
        mood={mood}
        moodColor={moodColor}
        moodBg={moodBg}
        onOpen={onOpen}
        onHide={onHide}
        onDelete={onDelete}
        sortableRef={sortable.ref}
        sortableStyle={sortable.style}
        sortableHandleProps={sortable.handleProps}
        isOverlay={isOverlay}
      />
    );
  }

  return (
    <div ref={sortable.ref} style={sortable.style}
      className={`lu-card size-${cardSize}`}
      onClick={() => onOpen(task)}>
      <div className="lu-mood-bar" style={{ background: moodColor }} />
      {!isOverlay && (
        <span className="lu-drag-handle" {...sortable.handleProps} onClick={e => e.stopPropagation()}>
          &#8942;
        </span>
      )}
      <div className="lu-mood-chip" style={{ background: moodBg }}>
        <span className="lu-mood-icon">{mood?.icon || '?'}</span>
        {!isNarrow && <span className="lu-mood-name" style={{ color: moodColor }}>{mood?.label || ''}</span>}
      </div>
      <div className="lu-info">
        <div className="lu-title">{task.isMilestone ? '\u{1F3C1} ' : ''}{task.name}</div>
        {!isNarrow && (
          <div className="lu-meta-row">
            {client && <span className="lu-meta-chip" style={{ background: `${client.color}15`, color: client.color }}>{client.name}</span>}
            {assignees.map(m => (
              <span key={m.id} className="lu-meta-chip" style={{ background: `${m.color}12`, color: m.color }}>{m.name}</span>
            ))}
            {!compact && (
              <select className="lu-status-sel"
                style={{ background: STB[task.status], color: STC[task.status], borderColor: `${STC[task.status]}33` }}
                onClick={e => e.stopPropagation()}
                onChange={e => { e.stopPropagation(); onStatusChange(task.id, e.target.value); }}
                value={task.status}>
                {roleStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {timeStr && <span className="lu-time-chip">{timeStr}</span>}
          </div>
        )}
        {!compact && isBig && getNotesText(task.notes) && (
          <div className="lu-notes-preview">{getNotesText(task.notes)}</div>
        )}
        {!compact && !isNarrow && (hasLinks || hasSubtasks) && (
          <div className="card-icon-row lu-card-icon-row">
            {hasLinks && (
              <span className="card-icon-pill link-pill" aria-label={`${task.links!.length} link(s)`}
                onClick={e => { e.stopPropagation(); setLinkPop(p => !p); }}>
                🔗 {task.links!.length}
                {linkPop && (
                  <span className="card-link-pop" onClick={e => e.stopPropagation()}>
                    {task.links!.map((ln, i) => (
                      <span key={i} className="card-link-item" onClick={() => window.open(ln.url, '_blank', 'noopener,noreferrer')}>
                        {ln.label || ln.url}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            )}
            {hasSubtasks && subTotal > 0 && (
              <CircProg done={subDone} total={subTotal} />
            )}
          </div>
        )}
      </div>
      <div className="lu-actions">
        {(!isNarrow || compact) && <button className="lu-open-btn" onClick={e => { e.stopPropagation(); onOpen(task); }}>Open</button>}
        {onDelete && <button className="lu-del-btn" onClick={e => { e.stopPropagation(); onDelete(task.id); }} title="Delete">&#128465;</button>}
        <button className="lu-hide-btn" onClick={e => { e.stopPropagation(); onHide(task.id); }} title="Hide">&#10005;</button>
      </div>
    </div>
  );
}
