import { useState, useMemo, memo } from 'react';
import { sel, useStore } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';
import { today, taskTimeStr, fmtTime } from '../lib/constants';
import { getStatusMaps, getCompleteStatus } from '../utils/statusUtils';
import { getDayFreqTagIds } from '../utils/taskGen2Helpers';

const SIDE_PANEL_MOODS = ['top', 'rapid', 'secondhalf', 'followup'];

export default memo(function TaskSidePanel({ tasks, member, S, onOpenTask, hiddenTasks, onRestoreTask }) {
  const { STC, STB } = useMemo(() => getStatusMaps(S.task_statuses), [S.task_statuses]);
  const completeStatus = useMemo(() => getCompleteStatus(S.task_statuses), [S.task_statuses]);
  const [spTab, setSpTab] = useState('tasks');
  const [taskDates, setTaskDates] = useState({});

  const moods = useMemo(() => {
    return SIDE_PANEL_MOODS.map(id => S.moods.find(m => m.id === id)).filter(Boolean);
  }, [S.moods]);

  const groups = useMemo(() => {
    const todayStr = today();
    const memberId = member?.id;
    return moods.map(mood => {
      const ids = (S.tasks || []).filter(t =>
        t.mood === mood.id &&
        t.date === todayStr &&
        t.assignedTo?.includes(memberId) &&
        t.status !== completeStatus &&
        !t.deleted
      );
      return { ...mood, ids };
    });
  }, [moods, S.tasks.length, S.tasks, member, completeStatus]);

  const session = useStore(s => s.session);
  const [routineFilter, setRoutineFilter] = useState('all');

  const routineMembers = useMemo(() => {
    return S.members || [];
  }, [S.members]);

  const ROUTINE_MOOD_ORDER = ['top', 'hero', 'imp', 'creative', 'secondhalf', 'followup', 'rapid', 'share'];

  const routineTemplates = useMemo(() => {
    const dayIds = getDayFreqTagIds(S.freqTags || []);
    if (!dayIds.length) return [];
    const moodOrder = {};
    ROUTINE_MOOD_ORDER.forEach((id, i) => moodOrder[id] = i);
    return (S.templates || []).filter(t => {
      const ids = t.freqIds || (t.freqId ? [t.freqId] : []);
      if (!ids.some(fid => dayIds.includes(fid))) return false;
      if (routineFilter === 'all') return true;
      return (t.assignedTo || []).includes(routineFilter);
    }).sort((a, b) => {
      const ma = moodOrder[a.mood] ?? 99;
      const mb = moodOrder[b.mood] ?? 99;
      return ma - mb;
    });
  }, [S.templates, S.freqTags, routineFilter]);

  const handleOpenRoutine = (tmpl) => {
    onOpenTask({
      date: today(),
      name: tmpl.name,
      clientId: tmpl.clientId,
      mood: tmpl.mood || 'rapid',
      assignedTo: member?.id ? [member.id] : [],
      estH: tmpl.estH || 0,
      estM: tmpl.estM || 0,
      notes: tmpl.notes || '',
      tags: tmpl.tags ? [...tmpl.tags] : [],
      subtasks: (tmpl.subtasks || []).map(s => ({ text: s.text, done: s.completed })),
      links: (tmpl.links || []).map(l => ({ label: l.title || l.label, url: l.url })),
    });
  };

  return (
    <div className="sp">
      <div className="sph" style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', gap: 2, marginBottom: 4 }}>
          <button
            onClick={() => setSpTab('routines')}
            style={{
              flex: 1, padding: '3px 8px', borderRadius: 5, border: 'none',
              fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              background: spTab === 'routines' ? 'var(--accent)' : 'var(--s2)',
              color: spTab === 'routines' ? '#fff' : 'var(--t2)',
            }}
          >Routines</button>
          <button
            onClick={() => setSpTab('tasks')}
            style={{
              flex: 1, padding: '3px 8px', borderRadius: 5, border: 'none',
              fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              background: spTab === 'tasks' ? 'var(--accent)' : 'var(--s2)',
              color: spTab === 'tasks' ? '#fff' : 'var(--t2)',
            }}
          >Tasks</button>
        </div>
        <h4 style={{ fontSize: 11, fontWeight: 800, marginBottom: 2 }}>{member?.name || 'My Tasks'}</h4>
      </div>
      <div className="spb" style={{ flex: 1, overflowY: 'auto', padding: '6px 8px 10px' }}>
        {spTab === 'routines' ? (
          <>
            <select value={routineFilter} onChange={e => setRoutineFilter(e.target.value)}
              style={{ width: '100%', marginBottom: 6, fontSize: 11, padding: '3px 6px', fontFamily: 'inherit', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
              <option value="all">All</option>
              {routineMembers.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            {!routineTemplates.length ? (
              <div style={{ fontSize: 10, color: 'var(--t3)', padding: '8px 2px', fontStyle: 'italic' }}>
                No routines for today
              </div>
            ) : (
              routineTemplates.map(tmpl => {
                const mood = sel.gmood(S, tmpl.mood);
                const client = sel.gc(S, tmpl.clientId);
                const freqLabels = ((tmpl.freqIds && tmpl.freqIds.length ? tmpl.freqIds : [tmpl.freqId]).filter(Boolean))
                  .map(fid => { const f = (S.freqTags || []).find(x => x.id === fid); return f ? f.label : ''; })
                  .filter(Boolean);
                const assignees = (tmpl.assignedTo || [])
                  .map(id => { const m = sel.gm(S, id); return m ? m.name : ''; })
                  .filter(Boolean);
                const timeStr = fmtTime(tmpl.estH || 0, tmpl.estM || 0);
                const dateVal = taskDates[tmpl.id] || today();
                return (
                  <div key={tmpl.id} className="tmpl-card" style={{ padding: '10px 12px', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                      {freqLabels.map((l, i) => (
                        <span key={i} className="tmpl-freq-badge" style={{ fontSize: 9 }}>{l}</span>
                      ))}
                      {client ? <span style={{ fontSize: 10, fontWeight: 700, color: client.color }}>{client.name}</span> : null}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{tmpl.name}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                      {mood ? (
                        <span style={{ padding: '1px 7px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: mood.bg, color: mood.color }}>
                          {mood.icon} {mood.label}
                        </span>
                      ) : null}
                      {assignees.map((n, i) => (
                        <span key={i} style={{ padding: '1px 6px', borderRadius: 20, fontSize: 10, background: 'var(--s2)', border: '1px solid var(--border)', fontWeight: 500 }}>{n}</span>
                      ))}
                      {timeStr ? <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--t2)' }}>{timeStr}</span> : null}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <input type="date" value={dateVal} onChange={e => setTaskDates(d => ({ ...d, [tmpl.id]: e.target.value }))}
                        style={{ fontSize: 11, padding: '3px 6px', width: 130 }} onClick={e => e.stopPropagation()} />
                      <button className="btn btn-sm btn-p" style={{ fontWeight: 700 }}
                        onClick={() => handleOpenRoutine(tmpl)}>
                        {'\u26A1'} Create
                      </button>
                      <button className="btn btn-xs" onClick={() => useUIStore.getState().triggerEditTemplate(tmpl)}>Edit</button>
                    </div>
                  </div>
                );
              })
            )}
          </>
        ) : (
          <>
            {groups.map(g => (
              <div key={g.id} className="sp-mood-group">
                <div className="sp-mood-head">
                  <span style={{ fontSize: 10 }}>{g.icon}</span>
                  <span className="sp-mood-label" style={{ color: g.color }}>{g.label}</span>
                  <span className="sp-mood-cnt" style={{ background: g.color + '22', color: g.color }}>{g.ids.length}</span>
                </div>
                {g.ids.length ? g.ids.map(t => {
                  const client = sel.gc(S, t.clientId);
                  const timeStr = taskTimeStr(t);
                  return (
                    <div key={t.id} className="sp-card" style={{ borderLeftColor: g.color, background: g.bg || '#fafafa' }}
                      onClick={() => onOpenTask(t)}>
                      <div className="sp-card-title">{t.name}</div>
                      {client && <div className="sp-card-client">{client.name}</div>}
                      <div className="sp-card-row">
                        <span className="sp-card-status" style={{ background: STB[t.status], color: STC[t.status] }}>
                          {t.status}
                        </span>
                        {timeStr && <span className="sp-card-time">{timeStr}</span>}
                      </div>
                    </div>
                  );
                }) : (
                  <div style={{ fontSize: 9, color: 'var(--t3)', padding: '3px 2px 4px' }}>No tasks</div>
                )}
              </div>
            ))}
            {hiddenTasks?.length > 0 && (
              <div className="sp-hidden-line">{hiddenTasks.length} hidden task{hiddenTasks.length > 1 ? 's' : ''}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
});