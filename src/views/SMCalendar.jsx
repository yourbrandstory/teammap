import { useState, useMemo, useCallback } from 'react';
import { useStore, sel } from '../store/useStore';
import { MOOD_PASTEL } from '../lib/constants';
import { getNotesText } from '../utils/notesUtils';
import TaskModal from '../components/TaskModal';

const TODAY = new Date();
const todayDate = TODAY.toISOString().slice(0, 10);
const MINI_DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ACCENT = '#D85A30';
const NAVY_BG = '#26215C';
const NAVY_TEXT = '#EEEDFE';

function monthDays(year, month) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startPad = first.getDay();
  const days = [];
  const prevLast = new Date(year, month, 0).getDate();
  for (let i = startPad - 1; i >= 0; i--) days.push({ day: prevLast - i, other: true });
  for (let d = 1; d <= last.getDate(); d++) days.push({ day: d, other: false });
  const endPad = 7 - (days.length % 7 || 7);
  for (let i = 1; i <= endPad; i++) days.push({ day: i, other: true });
  return days;
}

function dateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function fmtDate(ds) {
  if (!ds) return '';
  const d = new Date(ds + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function memberColor(member) {
  const pastels = ['#E6F1FB','#EAF3DE','#FAEEDA','#FBEAF0','#E1F5EE','#EEEDFE','#FAECE7','#F1EFE8'];
  const idx = member.id ? member.id.charCodeAt(0) % pastels.length : 0;
  return { dot: member.color || '#a09d97', bg: pastels[idx] };
}

export default function SMCalendar() {
  const S = useStore(s => s.S);

  const [baseDate, setBaseDate] = useState(() => new Date(TODAY.getFullYear(), TODAY.getMonth(), 1));
  const [modal, setModal] = useState(null);
  const [memberFilter, setMemberFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [view, setView] = useState('execution');

  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const days = useMemo(() => monthDays(year, month), [year, month]);
  const monthLabel = baseDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const smTagId = useMemo(() => {
    const tag = S.tags.find(t => t.label === 'SM Calendar');
    return tag ? tag.id : null;
  }, [S.tags]);

  const smTasks = useMemo(() => {
    if (!smTagId) return [];
    return S.tasks.filter(t => !t.deleted && t.tags?.includes(smTagId));
  }, [S.tasks, smTagId]);

  const filteredTasks = useMemo(() => {
    let list = smTasks;
    if (memberFilter) list = list.filter(t => t.assignedTo?.includes(memberFilter));
    if (clientFilter) list = list.filter(t => t.clientId === clientFilter);
    return list;
  }, [smTasks, memberFilter, clientFilter]);

  const tasksByDate = useMemo(() => {
    const map = {};
    filteredTasks.forEach(t => {
      if (t.date) {
        if (!map[t.date]) map[t.date] = [];
        map[t.date].push(t);
      }
    });
    const moodOrder = S.moods.map(m => m.id);
    for (const date in map) {
      map[date].sort((a, b) => {
        const ai = moodOrder.indexOf(a.mood);
        const bi = moodOrder.indexOf(b.mood);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    }
    return map;
  }, [filteredTasks, S.moods]);

  const socialCatId = useMemo(() => {
    const cat = (S.serviceCategories || []).find(c => c.label.trim().toLowerCase() === 'social');
    return cat?.id;
  }, [S.serviceCategories]);

  const socialClients = useMemo(() => {
    if (!socialCatId) return [];
    return S.clients
      .filter(c => (c.serviceCategoryIds || []).includes(socialCatId))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [S.clients, socialCatId]);

  const tasksByPostingDate = useMemo(() => {
    const map = {};
    filteredTasks.forEach(t => {
      if (t.postingDate) {
        if (!map[t.postingDate]) map[t.postingDate] = [];
        map[t.postingDate].push(t);
      }
    });
    const moodOrder = S.moods.map(m => m.id);
    for (const date in map) {
      map[date].sort((a, b) => {
        const ai = moodOrder.indexOf(a.mood);
        const bi = moodOrder.indexOf(b.mood);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
    }
    return map;
  }, [filteredTasks, S.moods]);

  const todayTasks = useMemo(() => {
    const map = view === 'execution' ? tasksByDate : tasksByPostingDate;
    return map[todayDate] || [];
  }, [tasksByDate, tasksByPostingDate, view]);

  const openTask = useCallback((t) => setModal(t), []);
  const closeModal = useCallback(() => setModal(null), []);

  const prevMonth = () => setBaseDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setBaseDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  const goToday = () => setBaseDate(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1));

  const goToDate = useCallback((y, m) => {
    setBaseDate(new Date(y, m, 1));
  }, []);

  const toggleMember = useCallback((id) => {
    setMemberFilter(prev => prev === id ? '' : id);
  }, []);

  const postingMonthEmpty = useMemo(() => {
    if (view !== 'posting') return false;
    return !smTasks.some(t => {
      if (!t.postingDate) return false;
      const d = new Date(t.postingDate + 'T12:00:00');
      return d.getFullYear() === year && d.getMonth() === month;
    });
  }, [view, smTasks, year, month]);

  const moodPastel = useCallback((moodId) => {
    if (!moodId) return null;
    const m = S.moods.find(x => x.id === moodId);
    if (!m) return null;
    const pastel = MOOD_PASTEL[m.id];
    if (pastel) return pastel;
    return { bg: m.bg || '#f2f0ec', text: m.color || '#6b6860' };
  }, [S.moods]);

  const mmDays = useMemo(() => monthDays(baseDate.getFullYear(), baseDate.getMonth()), [baseDate]);

  return (
    <div className="smc-outer">
      {/* toggle buttons when panels collapsed */}
      <div className="smc-toggle-row">
        <button className="smc-tog" onClick={() => setLeftOpen(v => !v)}>
          {leftOpen ? '◁' : '▷'}
        </button>
        <button className="smc-tog" onClick={() => setRightOpen(v => !v)}>
          {rightOpen ? '▷' : '◁'}
        </button>
      </div>

      <div className="smc-body">
        {/* ── LEFT SIDEBAR ── */}
        <div className={`smc-left${leftOpen ? '' : ' smc-collapsed'}`}>
          {/* Mini month calendar */}
          <div className="smc-card">
            <div className="smc-mm-head">
              <button className="smc-mm-btn" onClick={prevMonth}>‹</button>
              <span className="smc-mm-label">{baseDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
              <button className="smc-mm-btn" onClick={nextMonth}>›</button>
            </div>
            <div className="smc-mm-grid">
              {MINI_DAYS.map((d, i) => (
                <div key={i} className="smc-mm-dow">{d}</div>
              ))}
              {mmDays.map((d, i) => {
                const ds = dateStr(year, month, d.day);
                const isT = ds === todayDate;
                return (
                  <div
                    key={i}
                    className={`smc-mm-cell${d.other ? ' smc-mm-other' : ''}${isT ? ' smc-mm-today' : ''}`}
                    onClick={() => !d.other && goToDate(year, month)}
                  >
                    {d.day}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Social Media Clients */}
          <div className="smc-card">
            <div className="smc-side-label">Social Media Clients</div>
            <div className="smc-side-list">
              {socialClients.length === 0 ? (
                <div className="smc-side-empty">No clients tagged Social yet — assign categories in Settings</div>
              ) : (
                socialClients.map(c => {
                  const active = clientFilter === c.id;
                  return (
                    <div
                      key={c.id}
                      className={`smc-side-row${active ? ' smc-side-active' : ''}`}
                      onClick={() => setClientFilter(prev => prev === c.id ? '' : c.id)}
                    >
                      <span className="smc-side-dot" style={{ background: c.color || 'var(--t3)' }} />
                      <span className="smc-side-name">{c.name}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>


        </div>

        {/* ── MAIN CALENDAR ── */}
        <div className="smc-main">
          {/* Header */}
          <div className="smc-mh">
            <div className="smc-mh-left">
              <button className="smc-soft-btn" onClick={prevMonth}>‹</button>
              <span className="smc-mh-label">{monthLabel}</span>
              <button className="smc-soft-btn" onClick={nextMonth}>›</button>
            </div>
            <button className="smc-soft-btn smc-today-btn" onClick={goToday}>Today</button>
            <div className="smc-view-toggle">
              <span className={`smc-view-btn${view === 'execution' ? ' active' : ''}`} onClick={() => setView('execution')}>📅 Execution</span>
              <span className={`smc-view-btn${view === 'posting' ? ' active' : ''}`} onClick={() => setView('posting')}>📌 Posting</span>
            </div>
            <div className="smc-mh-chips">
              <button className={`smc-flt${!memberFilter ? ' smc-flt-on' : ''}`} onClick={() => setMemberFilter('')}>All members</button>
              {S.members.map(m => (
                <button key={m.id} className={`smc-flt${memberFilter === m.id ? ' smc-flt-on' : ''}`} onClick={() => toggleMember(m.id)}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>



          {/* Day-of-week header */}
          <div className="smc-dow">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
              <div key={d} className="smc-dow-cell">{d}</div>
            ))}
          </div>

          {postingMonthEmpty && (
            <div className="smc-posting-empty">No posting dates set yet. Add a posting date to tasks tagged with SM Calendar.</div>
          )}

          {/* Grid */}
          <div className="smc-grid">
            {days.map((d, i) => {
              const ds = dateStr(year, month, d.day);
              const isT = ds === todayDate;
              const dayMap = view === 'execution' ? tasksByDate : tasksByPostingDate;
              const tasks = dayMap[ds] || [];

              return (
                <div
                  key={i}
                  className={`smc-cell${d.other ? ' smc-cell-other' : ''}${isT ? ' smc-cell-today' : ''}`}
                >
                  {!d.other && (
                    <>
                      <div className={`smc-cell-num${isT ? ' smc-cell-num-today' : ''}`}>{d.day}</div>
                      {tasks.length > 0 && (
                        <div className="smc-cell-tasks">
                          {tasks.map(t => {
                            const p = moodPastel(t.mood);
                            const moodColor = p?.text || 'var(--t3)';
                            const theMood = t.mood ? S.moods.find(x => x.id === t.mood) : null;
                            const client = t.clientId ? sel.gc(S, t.clientId) : null;
                            const hasLinks = t.links?.length > 0;
                            const hasSubtasks = t.subtasks?.length > 0;
                            const subTotal = t.subtasks?.length || 0;
                            const subDone = t.subtasks?.filter(s => s.done).length || 0;
                            const hasNotes = getNotesText(t.notes).length > 0;
                            const CIRC = 2 * Math.PI * 13;
                            const hasIcons = hasLinks || hasSubtasks || hasNotes;
                            return (
                              <div key={t.id} className="task" style={{ borderLeftColor: moodColor }} onClick={() => openTask(t)}>
                                <div className="task-top">
                                  {theMood && <span className="mood-tag" style={{ background: p?.bg || 'var(--s2)', color: moodColor }}>{theMood.icon} {theMood.label}</span>}
                                  <span className="task-name">{t.name}</span>
                                </div>
                                {(t.assignedTo?.length > 0 || client) && (
                                  <div className="task-meta">
                                    {t.assignedTo?.map(mId => {
                                      const member = sel.gm(S, mId);
                                      return member ? <span key={mId} className="assignee-text">{member.name}</span> : null;
                                    })}
                                    {t.assignedTo?.length > 0 && client && <span className="dot-sep" />}
                                    {client && <span className="client-text" style={{ color: client.color || 'var(--t2)' }}>{client.name}</span>}
                                  </div>
                                )}
                                {t.postingDate && <span className="pd-capsule" title={t.postingDate}>📅 {fmtDate(t.postingDate)}</span>}
                                {view === 'posting' && <span className="posting-badge">📌 Posting</span>}
                                {hasIcons && (
                                  <div className="task-icons">
                                    {hasSubtasks && (
                                      <span className="circ-wrap" style={{ color: moodColor }}>
                                        <svg viewBox="0 0 30 30" width="18" height="18" style={{ display: 'block' }}>
                                          <circle cx="15" cy="15" r="13" fill="none" stroke="var(--s2)" strokeWidth="3.5" />
                                          <circle cx="15" cy="15" r="13" fill="none" stroke="currentColor" strokeWidth="3.5"
                                            strokeDasharray={CIRC} strokeDashoffset={subTotal > 0 ? CIRC * (1 - subDone / subTotal) : CIRC}
                                            strokeLinecap="round" transform="rotate(-90 15 15)" />
                                        </svg>
                                        <span className="circ-label">{subDone}/{subTotal}</span>
                                      </span>
                                    )}
                                    {hasLinks && (
                                      <span className="icon-wrap" onClick={e => { e.stopPropagation(); window.open(t.links[0].url, '_blank'); }}>
                                        <i className="link-icon">🔗</i>
                                        <span className="link-tooltip">{t.links[0].url}</span>
                                      </span>
                                    )}
                                    {hasNotes && <i className="notes-icon">📝</i>}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT PANEL: Today's tasks ── */}
        <div className={`smc-right${rightOpen ? '' : ' smc-collapsed'}`}>
          <div className="smc-card">
            <div className="smc-side-label">{view === 'execution' ? 'Today' : 'Posting Today'} · {TODAY.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
            {todayTasks.length === 0 && (
              <div className="smc-side-empty">No tasks today</div>
            )}
            {todayTasks.map(t => {
              const p = moodPastel(t.mood);
              const moodColor = p?.text || 'var(--t3)';
              const theMood = t.mood ? S.moods.find(x => x.id === t.mood) : null;
              const client = t.clientId ? sel.gc(S, t.clientId) : null;
              const hasTime = t.estH || t.estM;
              const timeLabel = hasTime ? `${t.estH || 0}h${t.estM ? ` ${t.estM}m` : ''}` : 'No fixed time';
              const hasLinks = t.links?.length > 0;
              const hasSubtasks = t.subtasks?.length > 0;
              const subTotal = t.subtasks?.length || 0;
              const subDone = t.subtasks?.filter(s => s.done).length || 0;
              const hasNotes = getNotesText(t.notes).length > 0;
              const CIRC = 2 * Math.PI * 13;
              const hasIcons = hasLinks || hasSubtasks || hasNotes;
              return (
                <div key={t.id} className="smc-today-card" style={{borderLeft:`3px solid ${moodColor}`}} onClick={() => openTask(t)}>
                  <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:3}}>
                    {theMood && <span className="mood-tag" style={{background:p?.bg||'var(--s2)',color:moodColor}}>{theMood.icon} {theMood.label}</span>}
                    <span className="smc-today-time" style={{marginBottom:0}}>{timeLabel}</span>
                  </div>
                  <div className="smc-today-name">{t.name}</div>
                  <div className="smc-today-meta">
                    {t.postingDate && <span className="pd-capsule" title={t.postingDate}>📅 {fmtDate(t.postingDate)}</span>}
                    {client && (
                      <span className="smc-today-tag" style={{ background: (client.color || '#eceae5') + '33', color: client.color || 'var(--t2)' }}>
                        {client.name}
                      </span>
                    )}
                    {t.assignedTo?.map(mId => {
                      const member = sel.gm(S, mId);
                      return member ? (
                        <span key={mId} className="smc-today-tag" style={{ background: (member.color || '#eceae5') + '33', color: member.color || 'var(--t2)' }}>
                          {member.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                  {hasIcons && (
                    <div className="task-icons" style={{marginTop:4}}>
                      {hasSubtasks && (
                        <span className="circ-wrap" style={{ color: moodColor }}>
                          <svg viewBox="0 0 30 30" width="18" height="18" style={{ display: 'block' }}>
                            <circle cx="15" cy="15" r="13" fill="none" stroke="var(--s2)" strokeWidth="3.5" />
                            <circle cx="15" cy="15" r="13" fill="none" stroke="currentColor" strokeWidth="3.5"
                              strokeDasharray={CIRC} strokeDashoffset={subTotal > 0 ? CIRC * (1 - subDone / subTotal) : CIRC}
                              strokeLinecap="round" transform="rotate(-90 15 15)" />
                          </svg>
                          <span className="circ-label">{subDone}/{subTotal}</span>
                        </span>
                      )}
                      {hasLinks && (
                        <span className="icon-wrap" onClick={e => { e.stopPropagation(); window.open(t.links[0].url, '_blank'); }}>
                          <i className="link-icon">🔗</i>
                          <span className="link-tooltip">{t.links[0].url}</span>
                        </span>
                      )}
                      {hasNotes && <i className="notes-icon">📝</i>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {modal && <TaskModal task={modal} onClose={closeModal} />}
    </div>
  );
}
