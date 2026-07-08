import { fmtD, taskTimeStr } from '../../lib/constants';
import { getStatusMaps } from '../../utils/statusUtils';
import { sel } from '../../store/useStore';

interface Props {
  task: any;
  S: any;
  onOpen: (task: any) => void;
  onDelete: (taskId: string) => void;
}

function getTaskMilestones(taskId: string, milestones: any[]) {
  if (!taskId || !milestones) return [];
  const results: any[] = [];
  for (const ms of milestones) {
    if (ms.deleted) continue;
    for (const ss of (ms.substeps || [])) {
      if ((ss.linkedTasks || []).some((lt: any) => lt.taskId === taskId)) {
        results.push(ms);
        break;
      }
    }
  }
  return results;
}

export default function TaskRow({ task, S, onOpen, onDelete }: Props) {
  const mood = sel.gmood(S, task.mood);
  const client = sel.gc(S, task.clientId);
  const assignees = (task.assignedTo || [])
    .map((id: string) => { const m = sel.gm(S, id); return m ? m.name : ''; })
    .filter(Boolean);
  const taskTags = (task.tags || [])
    .map((tid: string) => { const tg = sel.gtag(S, tid); return tg ? tg.label : ''; })
    .filter(Boolean);
  const msList = getTaskMilestones(task.id, S.milestones);
  const timeStr = taskTimeStr(task);
  const { STC, STB } = getStatusMaps(S.task_statuses);

  return (
    <tr onClick={() => onOpen(task)}>
      <td style={{ color: 'var(--t2)', whiteSpace: 'nowrap' }}>{fmtD(task.date)}</td>
      <td className="wrap">
        <span style={{ fontWeight: 600 }}>{task.isMilestone ? '\u{1F3A6} ' : ''}{task.name}</span>
      </td>
      <td>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          background: mood.bg, color: mood.color,
        }}>
          {mood.icon} {mood.label}
        </span>
      </td>
      <td>
        <span style={{
          padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          background: STB[task.status], color: STC[task.status],
        }}>
          {task.status}
        </span>
      </td>
      <td style={{ fontWeight: 500 }}>
        {client
          ? <span style={{ color: client.color, fontWeight: 600 }}>{client.name}</span>
          : <span style={{ color: 'var(--t3)' }}>&mdash;</span>}
      </td>
      <td>
        {assignees.length
          ? assignees.map((n: string, i: number) => (
              <span key={i} style={{
                display: 'inline-block', padding: '1px 6px', borderRadius: 10,
                fontSize: 11, background: 'var(--s2)', marginRight: 3, fontWeight: 500,
              }}>{n}</span>
            ))
          : <span style={{ color: 'var(--t3)' }}>&mdash;</span>}
      </td>
      <td style={{ fontWeight: 600, color: 'var(--t2)' }}>
        {timeStr || <span style={{ color: 'var(--t3)' }}>&mdash;</span>}
      </td>
      <td>
        {taskTags.length
          ? taskTags.map((l: string, i: number) => (
              <span key={i} style={{
                display: 'inline-block', padding: '1px 6px', borderRadius: 10,
                fontSize: 11, background: 'var(--s3)', marginRight: 2,
              }}>{l}</span>
            ))
          : <span style={{ color: 'var(--t3)' }}>&mdash;</span>}
      </td>
      <td style={{ fontSize: 11, color: 'var(--t2)' }}>
        {msList.length > 0 ? (
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {msList.map(ms => (
              <span key={ms.id} style={{
                display: 'inline-block', padding: '1px 6px', borderRadius: 10,
                fontSize: 10, background: 'var(--s3)', fontWeight: 600,
                whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis',
              }} title={ms.title}>
                ◆ {ms.title}
              </span>
            ))}
          </span>
        ) : (
          <span style={{ color: 'var(--t3)' }}>&mdash;</span>
        )}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-xs btn-d" onClick={() => onDelete(task.id)}>&#128465;</button>
      </td>
    </tr>
  );
}
