import { useState } from 'react';
import { today, fmtTime } from '../../lib/constants';
import { sel } from '../../store/useStore';
import type { Template } from '../../utils/taskGen2Helpers';
import { getNotesText } from '../../utils/notesUtils';

interface Props {
  template: Template;
  S: any;
  compact?: boolean;
  createConfirm: string | null;
  onCreateTask: (tmplId: string, date: string) => void;
  onEdit: (tmpl: Template) => void;
  onDelete: (id: string) => void;
}

export default function TemplateCard({ template, S, compact, createConfirm, onCreateTask, onEdit, onDelete }: Props) {
  const [taskDate, setTaskDate] = useState(today());
  const mood = sel.gmood(S, template.mood);
  const client = sel.gc(S, template.clientId);
  const freqLabels = ((template.freqIds && template.freqIds.length ? template.freqIds : [template.freqId]).filter(Boolean) as string[])
    .map((fid: string) => { const f = (S.freqTags || []).find((x: any) => x.id === fid); return f ? f.label : ''; })
    .filter(Boolean);
  const assignees = (template.assignedTo || [])
    .map((id: string) => { const m = sel.gm(S, id); return m ? m.name : ''; })
    .filter(Boolean);
  const timeStr = fmtTime(template.estH || 0, template.estM || 0);
  const isConfirming = createConfirm === template.id;

  if (compact) {
    return (
      <div className="tmpl-card tmpl-card--compact" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 5 }}>
            {freqLabels.map((l, i) => (
              <span key={i} className="tmpl-freq-badge" style={{ fontSize: 10 }}>{l}</span>
            ))}
            {client ? <span style={{ fontSize: 11, fontWeight: 700, color: client.color }}>{client.name}</span> : null}
            <span style={{ fontSize: 13, fontWeight: 700 }}>{template.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {mood ? (
              <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: mood.bg, color: mood.color }}>
                {mood.icon} {mood.label}
              </span>
            ) : null}
            {assignees.map((n, i) => (
              <span key={i} style={{ padding: '1px 7px', borderRadius: 20, fontSize: 11, background: 'var(--s2)', border: '1px solid var(--border)', fontWeight: 500 }}>{n}</span>
            ))}
            {timeStr ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t2)' }}>{timeStr}</span> : null}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <input type="date" value={taskDate} onChange={e => setTaskDate(e.target.value)}
            style={{ fontSize: 12, padding: '4px 8px', width: 140 }} onClick={e => e.stopPropagation()} />
          <button
            className="btn btn-sm btn-p"
            style={{ fontWeight: 700, whiteSpace: 'nowrap' }}
            onClick={() => onCreateTask(template.id, taskDate)}
            disabled={isConfirming}
          >
            {isConfirming ? '\u2713 Created!' : '\u26A1 Create'}
          </button>
          <button className="btn btn-xs" onClick={() => onEdit(template)}>Edit</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tmpl-card">
      <div className="tmpl-card-head">
        {freqLabels.length
          ? freqLabels.map((l, i) => <span key={i} className="tmpl-freq-badge">{l}</span>)
          : <span className="tmpl-freq-badge" style={{ background: 'var(--t3)' }}>Custom</span>}
        <span style={{ fontSize: 16 }}>{mood ? mood.icon : '\uD83D\uDCCC'}</span>
        <span className="tmpl-card-head-title" style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{template.name}</span>
        {timeStr ? (
          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'var(--s2)', border: '1px solid var(--border)', fontWeight: 700, color: 'var(--t2)' }}>
            {timeStr}
          </span>
        ) : null}
        <button className="btn btn-xs" onClick={() => onEdit(template)}>Edit</button>
        <button className="btn btn-xs btn-d" onClick={() => onDelete(template.id)}>&#10005;</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        {mood ? (
          <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: mood.bg, color: mood.color }}>
            {mood.icon} {mood.label}
          </span>
        ) : null}
        {assignees.map((n, i) => (
          <span key={i} style={{ padding: '2px 8px', borderRadius: 20, fontSize: 11, background: 'var(--s2)', border: '1px solid var(--border)', fontWeight: 500 }}>{n}</span>
        ))}
        {getNotesText(template.notes) ? (
          <span style={{ fontSize: 11, color: 'var(--t2)', fontStyle: 'italic' }}>
            &ldquo;{getNotesText(template.notes).slice(0, 40)}{getNotesText(template.notes).length > 40 ? '…' : ''}&rdquo;
          </span>
        ) : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input type="date" value={taskDate} onChange={e => setTaskDate(e.target.value)}
          style={{ fontSize: 12, padding: '5px 9px', width: 150 }} onClick={e => e.stopPropagation()} />
        <button
          className="btn btn-sm btn-p"
          style={{ fontWeight: 700 }}
          onClick={() => onCreateTask(template.id, taskDate)}
          disabled={isConfirming}
        >
          {isConfirming ? '\u2713 Created!' : '\u26A1 Create task'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>&rarr; adds to Task Dashboard</span>
      </div>
    </div>
  );
}
