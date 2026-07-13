import { useState } from 'react';
import { fmtD } from '../lib/constants';
import { getStatusMaps, getStatusesForRole } from '../utils/statusUtils';
import { useStore, sel } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';
import { canCreateTask, canAddTaskToMood } from '../utils/taskLimits';

import useMemberKanban from '../hooks/useMemberKanban';
import TaskModal from '../components/TaskModal';
import MilestoneModal from '../components/MilestoneModal';
import MilestoneDashCard from '../components/MilestoneDashCard';

export default function MemberKanban() {
  const {
    S, date, moodsWithTasks, taskModal, memberId,
    shift, goToday, setDate,
    setStatus, setTaskModal,
  } = useMemberKanban();

  const [msModal, setMsModal] = useState<any>(null);

  // Milestones assigned to the current member, grouped by mood
  const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' });
  const myMilestones = S.milestones.filter((ms: any) =>
    !ms.deleted &&
    (ms.assignedTo || []).includes(memberId) &&
    ms.displayMode !== 'hidden' &&
    (ms.displayMode === 'daily' || (ms.displayMode === 'specific_days' && (ms.displayDays || []).includes(dayName))) &&
    (!ms.date || date >= ms.date) &&
    (!ms.deadline || ms.deadline >= date)
  );
  const milestonesByMood: Record<string, any[]> = {};
  for (const ms of myMilestones) {
    const moodId = ms.mood || '__none__';
    if (!milestonesByMood[moodId]) milestonesByMood[moodId] = [];
    milestonesByMood[moodId].push(ms);
  }

  return (
    <div className="view active" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Date navigator ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        borderBottom: '1px solid var(--border)', background: 'var(--surface)',
        flexShrink: 0, flexWrap: 'wrap',
      }}>
        <span className="stl">Kanban</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="btn btn-sm" style={{ padding: '4px 10px', fontSize: 15, fontWeight: 700 }} onClick={() => shift(-1)}>←</button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ width: 140, fontSize: 12 }} />
          <button className="btn btn-sm" style={{ padding: '4px 10px', fontSize: 15, fontWeight: 700 }} onClick={() => shift(1)}>→</button>
        </div>
        <button className="btn btn-sm" style={{ fontWeight: 700 }} onClick={goToday}>Today</button>
        <span style={{ fontSize: 12, color: 'var(--t2)' }}>{fmtD(date)}</span>
        <div style={{ fontSize: 12, color: 'var(--t3)', marginLeft: 'auto' }}>
          {moodsWithTasks.reduce((a, s) => a + s.tasks.length, 0)} tasks
        </div>
      </div>

      {/* ── Kanban lanes ── */}
      <div style={{
        flex: 1, overflowX: 'auto', overflowY: 'auto', display: 'flex',
        gap: 12, padding: 16, alignItems: 'flex-start',
      }}>
        {moodsWithTasks.length === 0 ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '100%', height: 200, color: 'var(--t3)', fontSize: 14,
          }}>
            No tasks for this date
          </div>
        ) : (
          moodsWithTasks.map(section => {
            const moodMilestones = milestonesByMood[section.id] || [];
            const noMoodMilestones = section.id === moodsWithTasks[0]?.id ? (milestonesByMood['__none__'] || []) : [];
            return (
              <div key={section.id} style={{
                minWidth: 280, maxWidth: 340, flexShrink: 0,
                background: 'var(--surface)', borderRadius: 10,
                border: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column', maxHeight: '100%',
              }}>
                {/* Mood header */}
                <div style={{
                  padding: '10px 14px', borderBottom: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: `${section.bg}88`, borderRadius: '10px 10px 0 0',
                }}>
                  <span style={{ fontSize: 20 }}>{section.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 14, color: section.color }}>{section.label}</span>
                  <span style={{
                    fontSize: 11, color: 'var(--t3)', marginLeft: 'auto',
                    background: 'var(--s2)', padding: '1px 8px', borderRadius: 10,
                  }}>{section.tasks.length}</span>
                </div>

                {/* Milestone cards for this mood */}
                {moodMilestones.length > 0 && (
                  <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {moodMilestones.map(ms => (
                      <MilestoneDashCard
                        key={ms.id}
                        milestone={ms}
                        S={S}
                        onClick={() => setMsModal(ms)}
                      />
                    ))}
                  </div>
                )}

                {/* Milestones without a mood (show in first lane) */}
                {noMoodMilestones.length > 0 && (
                  <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {noMoodMilestones.map(ms => (
                      <MilestoneDashCard
                        key={ms.id}
                        milestone={ms}
                        S={S}
                        onClick={() => setMsModal(ms)}
                      />
                    ))}
                  </div>
                )}

                {/* Task cards */}
                <div style={{
                  flex: 1, overflowY: 'auto', padding: 8,
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  {section.tasks.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--t3)', textAlign: 'center', padding: '20px 0' }}>
                      No {section.label.toLowerCase()} tasks
                    </div>
                  ) : (
                    section.tasks.map((task: any) => (
                      <KanbanCard
                        key={task.id}
                        task={task}
                        client={S.clients.find((c: any) => c.id === task.clientId)}
                        assignees={(task.assignedTo || []).map((id: string) => S.members.find((m: any) => m.id === id)).filter(Boolean)}
                        onOpen={() => setTaskModal(task)}
                        onStatusChange={(s: string) => setStatus(task.id, s)}
                      />
                    ))
                  )}
                </div>

                {/* Add task button */}
                {(() => {
                  const dailyOk = canCreateTask(S, memberId, date);
                  const moodOk = canAddTaskToMood(S, section.id, date, memberId);
                  const disabled = !dailyOk || !moodOk;
                  let label = '+ Task';
                  let title = '';
                  if (!dailyOk && !moodOk) {
                    label = 'Daily limit reached';
                    title = 'Daily task limit reached';
                  } else if (!moodOk) {
                    label = 'Limit reached';
                    title = `${section.label} limit reached`;
                  } else if (!dailyOk) {
                    label = 'Daily limit reached';
                    title = 'Daily task limit reached';
                  }
                  return (
                    <button
                      disabled={disabled}
                      onClick={() => { if (!disabled) setTaskModal({ date, mood: section.id, assignedTo: [memberId] }); }}
                      title={title}
                      style={{
                        width: '100%', minHeight: 44, border: `1px dashed ${disabled ? 'var(--border)' : 'var(--border)'}`,
                        borderRadius: 10, background: disabled ? 'var(--s2)' : 'transparent',
                        color: disabled ? 'var(--t3)' : 'var(--t3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                        transition: 'all .15s', flexShrink: 0, padding: '4px 12px', marginTop: 0,
                        opacity: disabled ? 0.5 : 1,
                      }}
                      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--al)'; } }}
                      onMouseLeave={e => { if (!disabled) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--t3)'; e.currentTarget.style.background = 'transparent'; } }}
                    >
                      {label}
                    </button>
                  );
                })()}
              </div>
            );
          })
        )}
      </div>

      {taskModal && (
        <TaskModal
          task={taskModal}
          onClose={() => setTaskModal(null)}
          onSaveAsTemplate={(d: any) => { useUIStore.getState().triggerSaveAsTemplate(d); }}
        />
      )}
      {msModal && (
        <MilestoneModal
          milestone={msModal.id ? msModal : null}
          onClose={() => setMsModal(null)}
          onOpenTask={(t: any) => setTaskModal(t)}
        />
      )}
    </div>
  );
}

function KanbanCard({ task, client, assignees, onOpen, onStatusChange }: {
  task: any;
  client: any;
  assignees: any[];
  onOpen: () => void;
  onStatusChange: (s: string) => void;
}) {
  const S = useStore(s => s.S);
  const session = useStore(s => s.session);
  const role = session?.role || 'member';
  const { STATS, STC, STB } = getStatusMaps(S.task_statuses);
  const roleStatuses = getStatusesForRole(S.task_statuses, role);
  const timeStr = ((task.estH || 0) + (task.estM || 0))
    ? `${task.estH || 0}h${task.estM ? ' ' + task.estM + 'm' : ''}`
    : '';

  return (
    <div
      onClick={onOpen}
      style={{
        background: 'var(--bg)', borderRadius: 8, border: '1px solid var(--border)',
        padding: '8px 10px', cursor: 'pointer', fontSize: 13,
        transition: 'box-shadow .15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,.08)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, lineHeight: 1.4 }}>{task.name}</div>
      {(client || assignees.length > 0 || timeStr) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
          {client && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${client.color}15`, color: client.color }}>
              {client.name}
            </span>
          )}
          {assignees.map((m: any) => (
            <span key={m.id} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${m.color}12`, color: m.color }}>
              {m.name}
            </span>
          ))}
          {timeStr && (
            <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: 'var(--s2)', color: 'var(--t3)' }}>
              {timeStr}
            </span>
          )}
        </div>
      )}
      <select
        style={{
          fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)',
          background: STB[task.status], color: STC[task.status], width: '100%', marginTop: 4,
        }}
        onClick={e => e.stopPropagation()}
        onChange={e => { e.stopPropagation(); onStatusChange(e.target.value); }}
        value={task.status}
      >
        {roleStatuses.map((s: string) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>
  );
}
