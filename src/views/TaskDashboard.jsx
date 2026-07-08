import { useState, useCallback, useEffect, useMemo, memo, useRef } from 'react';
import { useStore, sel } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';
import { today, fmtD, taskTimeStr, getDeadlineClass, getDeadlineLabel, getDeadlineStatus } from '../lib/constants';
import { getStatusMaps, getCompleteStatus, getStandUpStatus, getReviewStatus, getPassStatus } from '../utils/statusUtils';
import { getNotesText } from '../utils/notesUtils';
import { getTaskMilestoneLinks } from '../utils/milestoneHelpers';
import Avatar from '../components/Avatar';
import TaskModal from '../components/TaskModal';
import StatusPopup from '../components/StatusPopup';
import CircProg from '../components/CircProg';
import TaskSidePanel from '../components/TaskSidePanel';
import MilestoneModal from '../components/MilestoneModal';

const minsOf = (t) => (t.estH||0)*60 + (t.estM||0);
const hm = (m) => m ? `${Math.floor(m/60)}h${m%60?' '+m%60+'m':''}` : null;

function isTaskHiddenBySubstep(taskId, milestones) {
  if (!milestones) return false;
  for (const ms of milestones) {
    if (ms.deleted) continue;
    for (const ss of (ms.substeps || [])) {
      const link = (ss.linkedTasks || []).find(lt => lt.taskId === taskId);
      if (link) {
        return !link.showOnDashboard;
      }
    }
  }
  return false;
}

function filterDashboardTasks(tasks, milestones) {
  if (!milestones || !milestones.length) return tasks;
  return tasks.filter(t => !isTaskHiddenBySubstep(t.id, milestones));
}

function getMemberStats(S, memberId, date, completeStatus, passStatus, reviewStatus) {
  const allTasks = filterDashboardTasks(sel.tasksForMD(S, memberId, date), S.milestones);
  const activeCount = filterDashboardTasks(S.tasks.filter(t =>
    t.assignedTo?.includes(memberId) && t.date === date && !t.deleted &&
    t.status !== completeStatus && t.status !== passStatus
  ), S.milestones).length;
  const reviewPendingCount = allTasks.filter(t => t.status === reviewStatus).length;
  const doneCount = allTasks.filter(t => t.status === completeStatus).length;
  const total = allTasks.length;
  const completionPercent = total ? Math.round(doneCount / total * 100) : 0;
  const estimatedTime = hm(allTasks.reduce((a, t) => a + minsOf(t), 0));
  return { activeCount, reviewPendingCount, completionPercent, estimatedTime, doneCount };
}

export default function TaskDashboard() {
  const S = useStore(s => s.S);
  const session = useStore(s => s.session);
  const isManager = session?.role === 'admin' || session?.role === 'manager';
  const completeStatus = getCompleteStatus(S.task_statuses);
  const passStatus = getPassStatus(S.task_statuses);
  const standUpStatus = getStandUpStatus(S.task_statuses);
  const reviewStatus = getReviewStatus(S.task_statuses);
  const updateSettings = useStore(s => s.updateSettings);
  const uiViewState = useUIStore(s => s.viewStates.tkd || {});
  const setViewState = useUIStore(s => s.setViewState);
  const [dashDate, setDashDate] = useState(uiViewState.dashDate || today());
  const [modal, setModal] = useState(null);
  const [msModal, setMsModal] = useState(null);
  const [stPop, setStPop] = useState(null);
  const [drawers, setDrawers] = useState(uiViewState.drawers || {});
  const [reviewFilter, setReviewFilter] = useState(uiViewState.reviewFilter || false);

  // Mobile state
  const [mobileMemberIdx, setMobileMemberIdx] = useState(0);
  const [mobileSheet, setMobileSheet] = useState(null);
  const [expandedCards, setExpandedCards] = useState(uiViewState.expandedCards || {});

  useEffect(() => {
    setViewState('tkd', { dashDate, drawers, expandedCards, reviewFilter });
  }, [dashDate, drawers, expandedCards, reviewFilter, setViewState]);

  const openTask = useCallback((t) => setModal(t), []);
  const openMs = useCallback((ms) => setMsModal(ms), []);
  const closeMs = useCallback(() => setMsModal(null), []);
  const openStatus = useCallback((s) => setStPop(s), []);
  const closeModal = useCallback(() => setModal(null), []);
  const closeStatus = useCallback(() => setStPop(null), []);
  const handleOpenMilestoneFromTask = useCallback((ms) => {
    closeModal();
    setTimeout(() => openMs(ms), 100);
  }, [closeModal, openMs]);
  const linkAfterCreateRef = useRef(null);

  const handleCreateTaskForSubstep = useCallback((ssId, taskData, linkCallback) => {
    sessionStorage.removeItem('tm_task_draft');
    linkAfterCreateRef.current = { ssId, linkCallback };
    setModal(taskData);
  }, []);

  const handleTaskSave = useCallback((savedTask) => {
    const pending = linkAfterCreateRef.current;
    if (pending && savedTask?.id) {
      pending.linkCallback(savedTask.id);
    }
    linkAfterCreateRef.current = null;
  }, []);

  const shift = (days) => {
    const d = new Date(dashDate+'T12:00:00'); d.setDate(d.getDate()+days);
    setDashDate(d.toISOString().slice(0,10));
  };

  const allTasks = filterDashboardTasks(sel.tasksOnDate(S, dashDate), S.milestones);
  const total = allTasks.length;
  const done = allTasks.filter(t=>t.status===completeStatus).length;
  const dayPct = total ? Math.round(done/total*100) : 0;
  const reviewCount = allTasks.filter(t=>t.status===reviewStatus).length;
  const spM = sel.gm(S, S.settings.spMember) || S.members[0];
  const spTasks = useMemo(() => spM ? filterDashboardTasks(sel.tasksForMD(S, spM.id, dashDate), S.milestones) : [], [S, spM, dashDate]);

  const mobileMember = S.members[mobileMemberIdx] || S.members[0];
  const VISIBLE_MEMBER_LIMIT = 5;
  const showMoreMembers = S.members.length > VISIBLE_MEMBER_LIMIT;
  const visibleMembers = showMoreMembers ? S.members.slice(0, VISIBLE_MEMBER_LIMIT) : S.members;

  return (
    <div className="view active" style={{display:'flex'}}>
      {/* ── DESKTOP HEADER ── */}
      <div className="td-desk-header" style={{padding:'10px 16px',borderBottom:'1px solid var(--border)',background:'var(--surface)',
        display:'flex',alignItems:'center',gap:10,flexShrink:0,flexWrap:'wrap'}}>
        <span className="stl" style={{whiteSpace:'nowrap'}}>Task Dashboard</span>
        <div style={{display:'flex',alignItems:'center',gap:4}}>
          <button className="btn btn-sm" style={{padding:'4px 10px',fontSize:15,fontWeight:700}} onClick={()=>shift(-1)}>←</button>
          <input type="date" value={dashDate} onChange={e=>setDashDate(e.target.value)} style={{width:140,fontSize:12}} />
          <button className="btn btn-sm" style={{padding:'4px 10px',fontSize:15,fontWeight:700}} onClick={()=>shift(1)}>→</button>
        </div>
        <button className="btn btn-sm" style={{fontWeight:700}} onClick={()=>setDashDate(today())}>Today</button>
        <span style={{fontSize:12,color:'var(--t2)'}}>{fmtD(dashDate)}</span>
        <div style={{flex:1,display:'flex',alignItems:'center',gap:8,minWidth:0}}>
          <div style={{flex:1,minWidth:60,maxWidth:200}}>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'var(--t3)',marginBottom:2}}>
              <span>Day progress</span>
              <span style={{fontWeight:700,color:dayPct===100?'var(--accent)':'var(--t2)'}}>{done}/{total} · {dayPct}%</span>
            </div>
            <div style={{height:6,background:'var(--s3)',borderRadius:3,overflow:'hidden'}}>
              <div style={{height:'100%',borderRadius:3,width:`${dayPct}%`,transition:'.4s',
                background:dayPct===100?'var(--accent)':dayPct>60?'var(--a2)':'var(--info)'}} />
            </div>
          </div>
        </div>
        {isManager && (
          <button
            onClick={() => setReviewFilter(v => !v)}
            style={{
              display:'flex',alignItems:'center',gap:4,padding:'4px 10px',borderRadius:6,border:'none',
              background:reviewFilter?'var(--al)':'var(--warn)',
              color:reviewFilter?'var(--accent)':'#fff',fontSize:11,fontWeight:700,cursor:'pointer',
              fontFamily:'inherit',whiteSpace:'nowrap',flexShrink:0,
            }}
          >
            {reviewFilter ? '✕ ' : ''}Needs Review ({reviewCount})
          </button>
        )}
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          <span style={{fontSize:11,color:'var(--t3)'}}>Side panel:</span>
          <select style={{width:110,fontSize:12,padding:'4px 8px'}} value={S.settings.spMember||''}
            onChange={e=>updateSettings({ spMember:e.target.value })}>
            {S.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button className="btn btn-sm btn-p" onClick={()=>setModal({ date:dashDate })}>+ Quick add</button>
        </div>
      </div>

      {/* ── DESKTOP BODY ── */}
      <div className="td-desk-body task-dash" style={{flex:1,overflow:'hidden'}}>
        <div className="task-dash-main">
          <div className="tcols">
            {S.members.map(m => (
              <TeamCol key={m.id} member={m} date={dashDate} S={S}
                reviewStatus={reviewStatus} reviewFilter={reviewFilter}
                drawerOpen={!!drawers[m.id]} toggleDrawer={()=>setDrawers(d=>({...d,[m.id]:!d[m.id]}))}
                onOpenTask={openTask} onStatus={openStatus} onOpenMs={openMs} />
            ))}
          </div>
        </div>
        <TaskSidePanel tasks={spTasks} member={spM} S={S} onOpenTask={openTask} />
      </div>

      {/* ── MOBILE LAYOUT ── */}
      <div className="td-mobile">
        {/* Mobile header: date nav + add button */}
        <div className="td-mob-header">
          <div className="td-mob-date-row">
            <button className="td-mob-date-btn" onClick={()=>shift(-1)}>←</button>
            <input type="date" value={dashDate} onChange={e=>setDashDate(e.target.value)} className="td-mob-date-input" />
            <button className="td-mob-date-btn" onClick={()=>shift(1)}>→</button>
            <button className="td-mob-today-btn" onClick={()=>setDashDate(today())}>Today</button>
          </div>
          <button className="td-mob-add-btn" onClick={()=>setModal({ date:dashDate })}>+</button>
        </div>

        {/* Day progress */}
        <div className="td-mob-day-progress">
          <span className="td-mob-day-progress-date">{fmtD(dashDate)}</span>
          <span className="td-mob-day-progress-stats">{done}/{total} &middot; {dayPct}%</span>
          <div className="td-mob-day-progress-track">
            <div className="td-mob-day-progress-fill" style={{
              width:`${dayPct}%`,
              background:dayPct===100?'var(--accent)':dayPct>60?'var(--a2)':'var(--info)'
            }} />
          </div>
        </div>

        {/* Member selector strip */}
        <div className="td-mob-member-strip">
          {visibleMembers.map((m, i) => {
            const stats = getMemberStats(S, m.id, dashDate, completeStatus, passStatus, reviewStatus);
            return (
              <button key={m.id}
                className={`td-mob-member-chip${i === mobileMemberIdx ? ' active' : ''}`}
                onClick={() => { setMobileMemberIdx(i); setExpandedCards({}); }}>
                <Avatar name={m.name} color={m.color} size={24} />
                <span className="td-mob-member-name">{m.name.split(' ')[0]}</span>
                <div className="member-summary">
                  {stats.activeCount} active{stats.doneCount ? ` · ${stats.doneCount}✓` : ''}
                </div>
              </button>
            );
          })}
          {showMoreMembers && (
            <button className="td-mob-member-chip td-mob-member-more" onClick={() => setMobileSheet('members')}>
              <span style={{fontSize:14,fontWeight:800}}>+{S.members.length - VISIBLE_MEMBER_LIMIT}</span>
              <span className="td-mob-member-name">More</span>
            </button>
          )}
        </div>

        {/* Single member column */}
        <div className="td-mob-col">
          {mobileMember && (
            <TeamColMobile
              member={mobileMember} date={dashDate} S={S}
              expandedCards={expandedCards}
              onToggleExpand={(id) => setExpandedCards(c => ({...c, [id]: !c[id]}))}
              onOpenTask={openTask} onStatus={openStatus} onOpenMs={openMs}
            />
          )}
        </div>
      </div>

      {/* ── MOBILE FAB ── */}
      <button className="td-fab" onClick={()=>openTask({ date:dashDate })}>+</button>

      {/* ── MOBILE BOTTOM SHEET ── */}
      {mobileSheet && (
        <div className="td-mob-sheet-overlay" onClick={() => setMobileSheet(null)}>
          <div className="td-mob-sheet" onClick={e => e.stopPropagation()}>
            <div className="td-mob-sheet-head">
              <span>{mobileSheet === 'members' ? 'All members' : 'Quick view'}</span>
              <button className="btn btn-sm btn-g" onClick={() => setMobileSheet(null)}>Close</button>
            </div>
            <div className="td-mob-sheet-body">
              {mobileSheet === 'members' ? (
                /* Full member list */
                S.members.map((m, i) => {
                  const stats = getMemberStats(S, m.id, dashDate, completeStatus, passStatus, reviewStatus);
                  const mcap = m.capacity ?? 6;
                  const mc = stats.activeCount > mcap ? '#e76f51' : stats.activeCount === mcap ? '#d97706' : 'var(--t3)';
                  return (
                    <button key={m.id}
                      className={`td-mob-member-row${i === mobileMemberIdx ? ' active' : ''}`}
                      onClick={() => { setMobileMemberIdx(i); setMobileSheet(null); setExpandedCards({}); }}>
                      <Avatar name={m.name} color={m.color} size={32} />
                      <span style={{fontWeight:600}}>{m.name}</span>
                      <span style={{fontSize:11,color:mc,fontWeight:700,marginLeft:'auto'}}>{stats.activeCount}/{mcap}</span>
                      <span style={{fontSize:12,color:'var(--t3)',marginLeft:8}}>{m.role}</span>
                    </button>
                  );
                })
              ) : (
                /* Side panel content */
                <>
                  {/* Day progress */}
                  <div className="td-mob-sheet-section">
                    <div className="td-mob-sheet-label">Day progress</div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12,marginBottom:4}}>
                      <span>{done}/{total} complete</span>
                      <span style={{fontWeight:700}}>{dayPct}%</span>
                    </div>
                    <div style={{height:6,background:'var(--s3)',borderRadius:3,overflow:'hidden'}}>
                      <div style={{height:'100%',borderRadius:3,width:`${dayPct}%`,transition:'.4s',
                        background:dayPct===100?'var(--accent)':dayPct>60?'var(--a2)':'var(--info)'}} />
                    </div>
                  </div>

                  {/* Side panel member selector */}
                  <div className="td-mob-sheet-section">
                    <div className="td-mob-sheet-label">Quick view member</div>
                    <select style={{width:'100%',fontSize:13,padding:'8px 11px'}} value={S.settings.spMember||''}
                      onChange={e => { updateSettings({ spMember:e.target.value }); setMobileSheet(null); }}>
                      {S.members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </div>

                  {/* Side panel content */}
                  <div className="td-mob-sheet-section" style={{flex:1,overflowY:'auto'}}>
                    <TaskSidePanel tasks={spTasks} member={spM} S={S} onOpenTask={(t) => { openTask(t); setMobileSheet(null); }} />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE MEMBER SUMMARY STRIP ── */}
      <div className="td-mob-summary">
        <button className="td-mob-summary-btn" onClick={() => setMobileSheet('progress')}>
          <span className="td-mob-summary-pct">{dayPct}%</span>
          <span className="td-mob-summary-bar" style={{width:`${dayPct}%`,background:dayPct===100?'var(--accent)':dayPct>60?'var(--a2)':'var(--info)'}} />
        </button>
      </div>

      {stPop && <StatusPopup taskId={stPop.taskId} anchorRect={stPop.rect} onClose={closeStatus} />}
      {msModal && <MilestoneModal milestone={msModal.id ? msModal : null} onClose={closeMs} onOpenTask={openTask} onCreateTaskForSubstep={handleCreateTaskForSubstep} />}
      {modal && <TaskModal task={modal} onClose={closeModal} onSave={handleTaskSave} onSaveAsTemplate={(d) => { useUIStore.getState().triggerSaveAsTemplate(d); }} onOpenMilestone={handleOpenMilestoneFromTask} />}
    </div>
  );
}

/* ── DESKTOP TEAM COL ── */
const TeamCol = memo(function TeamCol({ member, date, S, reviewStatus, reviewFilter, drawerOpen, toggleDrawer, onOpenTask, onStatus, onOpenMs }) {
  const completeStatus = getCompleteStatus(S.task_statuses);
  const passStatus = getPassStatus(S.task_statuses);
  const standUpStatus = getStandUpStatus(S.task_statuses);
  const allTasks = filterDashboardTasks(sel.tasksForMD(S, member.id, date), S.milestones);
  const stats = getMemberStats(S, member.id, date, completeStatus, passStatus, reviewStatus);

  const dayName = new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'});
  const msForMember = (S.milestones||[]).filter(ms => !ms.deleted && ms.assignedTo?.includes(member.id) && ms.displayMode !== 'hidden' && (ms.displayMode === 'daily' || (ms.displayMode === 'specific_days' && ms.displayDays?.includes(dayName))) && (!ms.date || date >= ms.date) && (!ms.deadline || ms.deadline >= date));
  const noMoodMilestones = msForMember.filter(ms => !ms.mood);
  const milestonesByMood = {};
  msForMember.filter(ms => ms.mood).forEach(ms => {
    if (!milestonesByMood[ms.mood]) milestonesByMood[ms.mood] = [];
    milestonesByMood[ms.mood].push(ms);
  });
  const baseVisible = allTasks.filter(t=>t.status!==completeStatus);
  const reviewVisible = reviewFilter ? baseVisible.filter(t=>t.status===reviewStatus) : baseVisible;
  const dailyCap = member.capacity ?? 6;
  const limitReached = stats.activeCount >= dailyCap;
  const capColor = stats.activeCount > dailyCap ? '#e76f51' : stats.activeCount === dailyCap ? '#d97706' : 'var(--t3)';
  const setToast = useUIStore(s => s.setToast);
  const handleAddTask = useCallback((moodId) => {
    if (limitReached) {
      setToast(`Task limit reached.\n\n${member.name} already has ${stats.activeCount}/${dailyCap} active tasks for today.\n\nComplete, pass, move, or reassign an existing task before creating another.`);
      return;
    }
    onOpenTask({ date, mood: moodId, assignedTo: [member.id] });
  }, [limitReached, stats.activeCount, dailyCap, member.name, date, onOpenTask, setToast]);
  const doneCount = allTasks.filter(t=>t.status===completeStatus).length;

  const visibleMoods = S.moods.filter(m => !m.hidden);
  const hiddenMoods = S.moods.filter(m => m.hidden);
  const hiddenTasks = reviewVisible.filter(t =>
    hiddenMoods.some(m => m.id === t.mood)
  );
  const visibleTasks = reviewVisible.filter(t => !hiddenMoods.some(m => m.id === t.mood));
  const suTasks = visibleTasks.filter(t=>t.status===standUpStatus);

  return (
    <div className="tcol">
      <div className="tcolh" style={{borderTop:`3px solid ${member.color}`}}>
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4}}>
          <Avatar name={member.name} color={member.color} size={22} />
          <span style={{fontSize:12,fontWeight:800,flex:1}}>{member.name}</span>
          <span style={{fontSize:10,fontWeight:600,color:capColor}}>{stats.activeCount}/{dailyCap}</span>
          <span style={{fontSize:10,color:'var(--t3)',marginLeft:4}}>{stats.estimatedTime||''}</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:10,marginBottom:3}}>
          <span style={{color:'var(--t3)'}}>
            {reviewVisible.length} active{doneCount?` · ${doneCount}✓`:''}
            {stats.reviewPendingCount > 0 && !reviewFilter ? <span style={{color:'var(--warn)',fontWeight:700,marginLeft:4}}>· {stats.reviewPendingCount} review{stats.reviewPendingCount>1?'s':''} pending</span> : ''}
            {reviewFilter && stats.reviewPendingCount === 0 ? <span style={{color:'var(--t2)',marginLeft:4}}>— no reviews</span> : ''}
          </span>
          <span style={{fontWeight:700,color:stats.completionPercent===100?'var(--accent)':'var(--t2)'}}>{stats.completionPercent}%</span>
        </div>
        <div style={{height:5,background:'var(--s3)',borderRadius:3,overflow:'hidden',marginBottom:4}}>
          <div style={{height:'100%',borderRadius:3,background:stats.completionPercent===100?'#2d6a4f':stats.completionPercent>60?'#52b788':'#2196c4',width:`${stats.completionPercent}%`,transition:'.5s'}} />
        </div>
      </div>

      <div className="tcolb">
        {noMoodMilestones.map(ms => {
          const total = ms.substeps.length;
          const done = ms.substeps.filter(s => s.done).length;
          const pct = total ? Math.round(done/total*100) : 0;
          const dlClass = getDeadlineClass(ms.deadline);
          const dlLabel = getDeadlineLabel(ms.deadline);
          const mood = ms.mood ? sel.gmood(S, ms.mood) : null;
          const client = ms.clientId ? sel.gc(S, ms.clientId) : null;
          const summary = getMilestoneSummary(ms, S.tasks);
          return (
            <div key={ms.id} className="ms-dash-card" style={{position:'relative'}} onClick={() => onOpenMs?.(ms)}>
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
              <div className="ms-dash-title">{ms.title}</div>
              <div className="ms-dash-progress">
                <div className="ms-dash-bar"><div className="ms-dash-fill" style={{width:`${pct}%`}} /></div>
                <span className="ms-dash-pct">{done}/{total} · {pct}%</span>
                <DlBadge deadline={ms.deadline} />
              </div>
              <div className="ms-dash-meta">
                {mood && <span className="ms-dash-chip" style={{background:mood.bg,color:mood.color}}>{mood.icon} {mood.label}</span>}
                {client && <span className="ms-dash-chip" style={{background:(client.color||'var(--s2)')+'22',color:client.color||'var(--t2)'}}>{client.name}</span>}
              </div>
            </div>
          );
        })}
        {msForMember.filter(ms => ms.mood && hiddenMoods.some(m => m.id === ms.mood)).map(ms => {
          const total = ms.substeps.length;
          const done = ms.substeps.filter(s => s.done).length;
          const pct = total ? Math.round(done/total*100) : 0;
          const dlClass = getDeadlineClass(ms.deadline);
          const dlLabel = getDeadlineLabel(ms.deadline);
          const m = ms.mood ? sel.gmood(S, ms.mood) : null;
          const client = ms.clientId ? sel.gc(S, ms.clientId) : null;
          const summary = getMilestoneSummary(ms, S.tasks);
          return (
            <div key={ms.id} className="ms-dash-card" style={{position:'relative'}} onClick={() => onOpenMs?.(ms)}>
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
              <div className="ms-dash-title">{ms.title}</div>
              <div className="ms-dash-progress">
                <div className="ms-dash-bar"><div className="ms-dash-fill" style={{width:`${pct}%`}} /></div>
                <span className="ms-dash-pct">{done}/{total} · {pct}%</span>
                <DlBadge deadline={ms.deadline} />
              </div>
              <div className="ms-dash-meta">
                {m && <span className="ms-dash-chip" style={{background:m.bg,color:m.color}}>{m.icon} {m.label}</span>}
                {client && <span className="ms-dash-chip" style={{background:(client.color||'var(--s2)')+'22',color:client.color||'var(--t2)'}}>{client.name}</span>}
              </div>
            </div>
          );
        })}
        {hiddenTasks.length > 0 && (
          <div className="hidden-drawer" style={{marginBottom:6}}>
            <button
              onClick={toggleDrawer}
              style={{
                width:'100%',display:'flex',alignItems:'center',gap:6,padding:'5px 8px',
                border:'1px dashed var(--border)',borderRadius:6,background:'transparent',
                color:'var(--t2)',fontSize:11,fontWeight:600,cursor:'pointer',
                fontFamily:'inherit',textAlign:'left',
              }}>
              {drawerOpen ? '▲ Hide' : `+${hiddenTasks.length} more (${hiddenMoods.map(m => m.label).join(', ')})`}
            </button>

            {drawerOpen && (
              <div className="hidden-drawer-content" style={{marginTop:4}}>
                {hiddenMoods.map(mood => {
                  const moodTasks = hiddenTasks.filter(t => t.mood === mood.id);
                  if (!moodTasks.length) return null;
                  const mid = mood.id;
                  const moodMins = allTasks.filter(t=>t.mood===mid).reduce((a,t)=>a+minsOf(t),0);
                  return (
                    <div key={mid} className="msec" style={{marginTop:4}}>
                      <div className="msec-head" style={{background:'transparent'}}>
                        <span style={{fontSize:10}}>{mood.icon}</span>
                        <span className="msec-label" style={{color:mood.color,fontSize:9.5}}>{mood.label}</span>
                        <span className="msec-cnt" style={{background:mood.color+'22',color:mood.color}}>
                          {moodTasks.length}
                        </span>
                        {hm(moodMins) && <span style={{fontSize:9,color:mood.color,marginLeft:'auto',fontWeight:700,opacity:.7}}>{hm(moodMins)}</span>}
                        <button disabled={limitReached}
                          onClick={(e)=>{e.stopPropagation();handleAddTask(mid);}}
                          title={limitReached?`Daily task limit reached (${stats.activeCount}/${dailyCap})`:''}
                          style={{width:16,height:16,borderRadius:'50%',background:mood.color+'22',border:`1px solid ${mood.color}44`,
                            color:mood.color,fontSize:11,lineHeight:1,cursor:limitReached?'not-allowed':'pointer',display:'flex',alignItems:'center',
                            justifyContent:'center',flexShrink:0,padding:0,fontFamily:'inherit',marginLeft:'auto',opacity:limitReached?0.5:1}}>+</button>
                      </div>
                      <div className="msec-tasks">
                        {moodTasks.map(t => <TCard key={t.id} task={t} member={member} moods={S.moods} clients={S.clients} tags={S.tags} taskStatuses={S.task_statuses} members={S.members} milestones={S.milestones} onOpenTask={onOpenTask} onStatus={onStatus} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {suTasks.length>0 && (
          <div className="msec su-sec">
            <div className="su-head">🗣 Stand Up <span style={{fontSize:9,background:'var(--warn)',color:'#fff',padding:'1px 5px',borderRadius:8,marginLeft:2}}>{suTasks.length}</span></div>
            <div className="msec-tasks">{suTasks.map(t => <TCard key={t.id} task={t} member={member} moods={S.moods} clients={S.clients} tags={S.tags} taskStatuses={S.task_statuses} members={S.members} milestones={S.milestones} onOpenTask={onOpenTask} onStatus={onStatus} />)}</div>
          </div>
        )}

        {visibleMoods.map(mood => {
          const mid = mood.id;
          const mt = visibleTasks.filter(t=>t.mood===mid && t.status!==standUpStatus);
          const moodMilestones = milestonesByMood[mid] || [];
          if ((mid==='top'||mid==='creative') && !mt.length && !moodMilestones.length) return null;
          const isHero=mid==='hero', isImp=mid==='imp', isTop=mid==='top';
          const secClass = isHero?'hero-sec':isImp?'imp-sec':isTop?'top-sec':'other-sec';
          const moodMins = allTasks.filter(t=>t.mood===mid).reduce((a,t)=>a+minsOf(t),0);
          const totalMoodCount = allTasks.filter(t=>t.mood===mid).length;
          const doneInMood = totalMoodCount - allTasks.filter(t=>t.mood===mid && t.status!==completeStatus).length;
          const secStyle = isHero?{background:mood.bg,border:`2px solid ${mood.color}55`}
            : isImp?{background:mood.bg+'88',border:`1.5px solid ${mood.color}44`} : {};
          const headBg = isHero?mood.color+'15':isImp?mood.color+'10':'transparent';
          return (
            <div key={mid} className={`msec ${secClass}`} style={secStyle}>
              <div className="msec-head" style={{background:headBg}}>
                <span style={{fontSize:isHero?13:isImp?12:11}}>{mood.icon}</span>
                <span className="msec-label" style={{color:mood.color,fontSize:isHero?11:isImp?10.5:10}}>{mood.label}</span>
                <span className="msec-cnt" style={{background:mood.color+'22',color:mood.color}}>
                  {mt.length}{mood.max?`/${mood.max}`:''}{doneInMood?<span style={{opacity:.55,fontSize:8}}> {doneInMood}✓</span>:null}
                </span>
                {hm(moodMins) && <span style={{fontSize:9,color:mood.color,marginLeft:'auto',fontWeight:700,opacity:.7}}>{hm(moodMins)}</span>}
                <button disabled={limitReached}
                  onClick={(e)=>{e.stopPropagation();handleAddTask(mid);}}
                  title={limitReached?`Daily task limit reached (${stats.activeCount}/${dailyCap})`:''}
                  style={{width:16,height:16,borderRadius:'50%',background:mood.color+'22',border:`1px solid ${mood.color}44`,
                    color:mood.color,fontSize:11,lineHeight:1,cursor:limitReached?'not-allowed':'pointer',display:'flex',alignItems:'center',
                    justifyContent:'center',flexShrink:0,padding:0,fontFamily:'inherit',marginLeft:hm(moodMins)?2:'auto',opacity:limitReached?0.5:1}}>+</button>
              </div>
              <div className="msec-tasks">
                {moodMilestones.map(ms => {
                  const mTotal = ms.substeps.length;
                  const mDone = ms.substeps.filter(s => s.done).length;
                  const mPct = mTotal ? Math.round(mDone/mTotal*100) : 0;
                  const mDlClass = getDeadlineClass(ms.deadline);
                  const mDlLabel = getDeadlineLabel(ms.deadline);
                  const mMood = ms.mood ? sel.gmood(S, ms.mood) : null;
                  const mClient = ms.clientId ? sel.gc(S, ms.clientId) : null;
                  const summary = getMilestoneSummary(ms, S.tasks);
                  return (
                    <div key={ms.id} className="ms-dash-card" style={{position:'relative'}} onClick={() => onOpenMs?.(ms)}>
                              <div className="ms-dash-head">
                        <span className="ms-dash-badge">◆ MILESTONE</span>
                        {mDlLabel && <span className={`ms-dash-deadline ${mDlClass}`}>{mDlLabel}</span>}
                      </div>
                      {(summary.overdue > 0 || summary.dueToday > 0) && (
                        <div className="ms-dash-summary">
                          {summary.overdue > 0 && <span className="ms-sum-overdue">● {summary.overdue} overdue</span>}
                          {summary.dueToday > 0 && <span className="ms-sum-today">● {summary.dueToday} due today</span>}
                        </div>
                      )}
                      <div className="ms-dash-title">{ms.title}</div>
                      <div className="ms-dash-progress">
                        <div className="ms-dash-bar"><div className="ms-dash-fill" style={{width:`${mPct}%`}} /></div>
                        <span className="ms-dash-pct">{mDone}/{mTotal} · {mPct}%</span>
                        <DlBadge deadline={ms.deadline} />
                      </div>
                      <div className="ms-dash-meta">
                        {mMood && <span className="ms-dash-chip" style={{background:mMood.bg,color:mMood.color}}>{mMood.icon} {mMood.label}</span>}
                        {mClient && <span className="ms-dash-chip" style={{background:(mClient.color||'var(--s2)')+'22',color:mClient.color||'var(--t2)'}}>{mClient.name}</span>}
                      </div>
                    </div>
                  );
                })}
                {mt.length ? mt.map(t => <TCard key={t.id} task={t} member={member} moods={S.moods} clients={S.clients} tags={S.tags} taskStatuses={S.task_statuses} members={S.members} milestones={S.milestones} onOpenTask={onOpenTask} onStatus={onStatus} />)
                  : !moodMilestones.length ? <div style={{fontSize:10,color:'var(--t3)',padding:'5px 4px',fontStyle:'italic'}}>No active {mood.label}</div> : null}
              </div>

            </div>
          );
        })}

        <button className="addbtn" disabled={limitReached}
          title={limitReached?`Daily task limit reached (${stats.activeCount}/${dailyCap})`:''}
          style={{fontSize:11,flexShrink:0,opacity:limitReached?0.5:1,cursor:limitReached?'not-allowed':'pointer'}}
          onClick={()=>handleAddTask()}>+ Task</button>
      </div>
    </div>
  );
});

/* ── CIRCULAR SUBTASK PROGRESS ── */

/* ── DESKTOP TASK CARD ── */
const TCard = memo(function TCard({ task, member, moods, clients, tags, taskStatuses, members, milestones, onOpenTask, onStatus }) {
  const { STC, STB } = useMemo(() => getStatusMaps(taskStatuses), [taskStatuses]);
  const mood = useMemo(() => moods.find(m => m.id === task.mood), [moods, task.mood]);
  const isHero=task.mood==='hero', isTop=task.mood==='top', isImp=task.mood==='imp';
  const isLight=!isHero&&!isImp&&!isTop;
  const client = useMemo(() => clients.find(c => c.id === task.clientId), [clients, task.clientId]);
  const timeStr = taskTimeStr(task);
  const extra = isHero?' hero':isImp?' imp-card':isTop?' top':isLight?' light':'';
  const [linkPop, setLinkPop] = useState(false);
  const notesText = getNotesText(task.notes);
  const hasNotes = notesText.length > 0;
  const hasLinks = task.links?.length > 0;
  const hasSubtasks = task.subtasks?.length > 0;
  const subTotal = task.subtasks?.length || 0;
  const subDone = task.subtasks?.filter(s => s.done).length || 0;
  const msLinks = useMemo(() => getTaskMilestoneLinks(task.id, milestones), [task.id, milestones]);

  return (
    <div className={`tcard${extra}`} onClick={()=>onOpenTask(task)}>
      <div style={{display:'flex',alignItems:'flex-start',gap:4,marginBottom:2}}>
        <div className="tcn" style={{flex:1}}>{task.isMilestone?'🏁 ':''}{task.name}</div>
      </div>
      {client && <div className="tcc" style={{color:mood?.color||'var(--t2)',fontWeight:600}}>{client.name}</div>}
      <div className="tcs-row">
        <span className="tcs" style={{background:STB[task.status],color:STC[task.status]}}
          onClick={(e)=>{e.stopPropagation();onStatus({ taskId:task.id, rect:e.target.getBoundingClientRect() });}}>
          {task.status} ▼
        </span>
        {timeStr && <span className="ttime">{timeStr}</span>}
      </div>
      {msLinks.length > 0 && msLinks.map((msLink, idx) => (
        <div key={msLink.milestone.id+'_'+idx} className="task-ms-badge" style={idx > 0 ? {marginTop: 2} : {}}>
          <i>◆</i> <span className="ms-m-letter">M</span>
          {msLink.milestone.title.length > 20 ? msLink.milestone.title.slice(0, 20) + '…' : msLink.milestone.title}
        </div>
      ))}
      {task.tags?.length>0 && (
        <div style={{display:'flex',gap:3,flexWrap:'wrap',marginTop:3}}>
          {task.tags.map(tid => { const tg = tags.find(t=>t.id===tid); return tg ? <span key={tid} className="ttag-chip">{tg.label}</span> : null; })}
        </div>
      )}
      {task.assignedTo?.length>1 && (
        <div style={{display:'flex',gap:3,flexWrap:'wrap',marginTop:3}}>
          {task.assignedTo.filter(id=>id!==member.id).map(id => { const m = members.find(x=>x.id===id); return m ? (
            <span key={id} style={{fontSize:9,padding:'1px 5px',borderRadius:4,background:'var(--s2)',
              border:'1px solid var(--border)',fontWeight:600,color:'var(--t2)'}}>{m.name}</span>) : null; })}
        </div>
      )}
      {(hasNotes || hasLinks || hasSubtasks) && (
        <div className="card-icon-row">
          {hasNotes && (
            <span className="card-icon-pill notes-pill" aria-label="Has notes">
              📝<span className="card-pill-tip">{notesText}</span>
            </span>
          )}
          {hasLinks && (
            <span className="card-icon-pill link-pill" aria-label={`${task.links.length} link(s)`}
              onClick={e=>{e.stopPropagation();setLinkPop(p=>!p);}}>
              🔗 {task.links.length}
              {linkPop && (
                <span className="card-link-pop" onClick={e=>e.stopPropagation()}>
                  {task.links.map((ln,i) => (
                    <span key={i} className="card-link-item" onClick={()=>window.open(ln.url,'_blank','noopener,noreferrer')}>
                      {ln.label||ln.url}
                    </span>
                  ))}
                </span>
              )}
            </span>
          )}
          {hasSubtasks && <CircProg done={subDone} total={subTotal} />}
        </div>
      )}
    </div>
  );
});

/* ── DEADLINE BADGE ── */
const DlIcon = ({ type }) => {
  const icons = {
    overdue: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.29 3.86l-8.3 14.34A1 1 0 0 0 2.76 20h18.48a1 1 0 0 0 .77-1.8l-8.3-14.34a1 1 0 0 0-1.72 0z"/></svg>,
    today: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    soon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
  };
  return icons[type] || null;
};
function getMilestoneSummary(milestone, allTasks) {
  let overdue = 0;
  let dueToday = 0;
  const now = new Date();
  const todayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0];
  for (const ss of (milestone.substeps || [])) {
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

const DlBadge = ({ deadline }) => {
  const status = getDeadlineStatus(deadline);
  if (!status) return null;
  return <span className={`ms-dash-deadline-badge ${status.type}`}><DlIcon type={status.type} />{status.label}</span>;
};

/* ── MOBILE TEAM COL ── */
const TeamColMobile = memo(function TeamColMobile({ member, date, S, expandedCards, onToggleExpand, onOpenTask, onStatus, onOpenMs }) {
  const completeStatus = getCompleteStatus(S.task_statuses);
  const standUpStatus = getStandUpStatus(S.task_statuses);
  const allTasks = filterDashboardTasks(sel.tasksForMD(S, member.id, date), S.milestones);
  const visible = allTasks.filter(t=>t.status!==completeStatus);
  const doneCount = allTasks.filter(t=>t.status===completeStatus).length;
  const pct = allTasks.length ? Math.round(doneCount/allTasks.length*100) : 0;
  const totalDisp = hm(allTasks.reduce((a,t)=>a+minsOf(t),0));
  const [overflowOpen, setOverflowOpen] = useState(false);
  const passStatus = getPassStatus(S.task_statuses);
  const dailyActive = S.tasks.filter(t => t.assignedTo?.includes(member.id) && t.date === date && !t.deleted && t.status !== completeStatus && t.status !== passStatus).length;
  const dailyCap = member.capacity ?? 6;
  const limitReached = dailyActive >= dailyCap;
  const setToast = useUIStore(s => s.setToast);
  const handleAddTask = useCallback((moodId) => {
    if (limitReached) {
      setToast(`Task limit reached.\n\n${member.name} already has ${dailyActive}/${dailyCap} active tasks for today.\n\nComplete, pass, move, or reassign an existing task before creating another.`);
      return;
    }
    onOpenTask({ date, mood: moodId, assignedTo: [member.id] });
  }, [limitReached, dailyActive, dailyCap, member.name, date, onOpenTask, setToast]);

  const dayName = new Date(date+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'});
  const msForMember = (S.milestones||[]).filter(ms => !ms.deleted && ms.assignedTo?.includes(member.id) && ms.displayMode !== 'hidden' && (ms.displayMode === 'daily' || (ms.displayMode === 'specific_days' && ms.displayDays?.includes(dayName))) && (!ms.date || date >= ms.date) && (!ms.deadline || ms.deadline >= date));
  const noMoodMilestones = msForMember.filter(ms => !ms.mood);
  const milestonesByMood = {};
  msForMember.filter(ms => ms.mood).forEach(ms => {
    if (!milestonesByMood[ms.mood]) milestonesByMood[ms.mood] = [];
    milestonesByMood[ms.mood].push(ms);
  });
  const visibleMoods = S.moods.filter(m => !m.hidden);
  const hiddenMoods = S.moods.filter(m => m.hidden);
  const hiddenTasks = useMemo(() => {
    return visible.filter(t =>
      t.status !== standUpStatus && hiddenMoods.some(m => m.id === t.mood)
    );
  }, [visible, hiddenMoods, standUpStatus]);
  const visibleTasks = visible.filter(t => !hiddenMoods.some(m => m.id === t.mood));
  const suTasks = visibleTasks.filter(t=>t.status===standUpStatus);

  return (
    <div className="td-mob-col-inner">
        {noMoodMilestones.map(ms => {
          const total = ms.substeps.length;
          const done = ms.substeps.filter(s => s.done).length;
          const pct = total ? Math.round(done/total*100) : 0;
          const dlClass = getDeadlineClass(ms.deadline);
          const dlLabel = getDeadlineLabel(ms.deadline);
          const mood = ms.mood ? sel.gmood(S, ms.mood) : null;
          const client = ms.clientId ? sel.gc(S, ms.clientId) : null;
          const summary = getMilestoneSummary(ms, S.tasks);
          return (
            <div key={ms.id} className="ms-dash-card" style={{position:'relative'}} onClick={() => onOpenMs?.(ms)}>
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
              <div className="ms-dash-title">{ms.title}</div>
              <div className="ms-dash-progress">
                <div className="ms-dash-bar"><div className="ms-dash-fill" style={{width:`${pct}%`}} /></div>
                <span className="ms-dash-pct">{done}/{total} · {pct}%</span>
                <DlBadge deadline={ms.deadline} />
              </div>
              <div className="ms-dash-meta">
                {mood && <span className="ms-dash-chip" style={{background:mood.bg,color:mood.color}}>{mood.icon} {mood.label}</span>}
                {client && <span className="ms-dash-chip" style={{background:(client.color||'var(--s2)')+'22',color:client.color||'var(--t2)'}}>{client.name}</span>}
              </div>
            </div>
          );
        })}
        {msForMember.filter(ms => ms.mood && hiddenMoods.some(m => m.id === ms.mood)).map(ms => {
          const total = ms.substeps.length;
          const done = ms.substeps.filter(s => s.done).length;
          const pct = total ? Math.round(done/total*100) : 0;
          const dlClass = getDeadlineClass(ms.deadline);
          const dlLabel = getDeadlineLabel(ms.deadline);
          const m = ms.mood ? sel.gmood(S, ms.mood) : null;
          const client = ms.clientId ? sel.gc(S, ms.clientId) : null;
          const summary = getMilestoneSummary(ms, S.tasks);
          return (
            <div key={ms.id} className="ms-dash-card" style={{position:'relative'}} onClick={() => onOpenMs?.(ms)}>
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
              <div className="ms-dash-title">{ms.title}</div>
              <div className="ms-dash-progress">
                <div className="ms-dash-bar"><div className="ms-dash-fill" style={{width:`${pct}%`}} /></div>
                <span className="ms-dash-pct">{done}/{total} · {pct}%</span>
                <DlBadge deadline={ms.deadline} />
              </div>
              <div className="ms-dash-meta">
                {m && <span className="ms-dash-chip" style={{background:m.bg,color:m.color}}>{m.icon} {m.label}</span>}
                {client && <span className="ms-dash-chip" style={{background:(client.color||'var(--s2)')+'22',color:client.color||'var(--t2)'}}>{client.name}</span>}
              </div>
            </div>
          );
        })}
        {hiddenTasks.length > 0 && (
          <div className="hidden-drawer" style={{marginBottom:6}}>
            <button
              onClick={() => setOverflowOpen(o => !o)}
              style={{
                width:'100%',display:'flex',alignItems:'center',gap:6,padding:'5px 8px',
                border:'1px dashed var(--border)',borderRadius:6,background:'transparent',
                color:'var(--t2)',fontSize:11,fontWeight:600,cursor:'pointer',
                fontFamily:'inherit',textAlign:'left',marginBottom:3,
              }}>
              {overflowOpen ? '▲ Hide' : `+${hiddenTasks.length} more (${hiddenMoods.map(m => m.label).join(', ')})`}
            </button>

            {overflowOpen && (
              <div className="hidden-drawer-content">
                {hiddenMoods.map(mood => {
                  const moodTasks = hiddenTasks.filter(t => t.mood === mood.id);
                  if (!moodTasks.length) return null;
                  const mid = mood.id;
                  const moodMins = allTasks.filter(t=>t.mood===mid).reduce((a,t)=>a+minsOf(t),0);
                  return (
                    <div key={mid} className="msec" style={{marginTop:4}}>
                      <div className="msec-head" style={{background:'transparent',padding:'2px 4px'}}>
                        <span style={{fontSize:10}}>{mood.icon}</span>
                        <span className="msec-label" style={{color:mood.color,fontSize:9}}>{mood.label}</span>
                        <span className="msec-cnt" style={{background:mood.color+'22',color:mood.color,fontSize:9}}>
                          {moodTasks.length}
                        </span>
                        {hm(moodMins) && <span style={{fontSize:8,color:mood.color,marginLeft:'auto',fontWeight:700,opacity:.7}}>{hm(moodMins)}</span>}
                        <button disabled={limitReached}
                          onClick={(e)=>{e.stopPropagation();handleAddTask(mid);}}
                          title={limitReached?`Daily task limit reached (${dailyActive}/${dailyCap})`:''}
                          style={{width:22,height:22,borderRadius:'50%',background:mood.color+'22',border:`1px solid ${mood.color}44`,
                            color:mood.color,fontSize:14,lineHeight:1,cursor:limitReached?'not-allowed':'pointer',display:'flex',alignItems:'center',
                            justifyContent:'center',flexShrink:0,padding:0,fontFamily:'inherit',marginLeft:'auto',opacity:limitReached?0.5:1}}>+</button>
                      </div>
                      <div className="msec-tasks">
                        {moodTasks.map(t => <MobileTaskCard key={t.id} task={t} member={member} moods={S.moods} clients={S.clients} tags={S.tags} taskStatuses={S.task_statuses} members={S.members} milestones={S.milestones} expanded={expandedCards[t.id]} onToggleExpand={onToggleExpand} onOpenTask={onOpenTask} onStatus={onStatus} />)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      {/* Stand Up */}
      {suTasks.length>0 && (
        <div className="msec su-sec" style={{marginBottom:6}}>
          <div className="su-head" style={{padding:'4px 6px'}}>🗣 Stand Up <span style={{fontSize:9,background:'var(--warn)',color:'#fff',padding:'1px 6px',borderRadius:8,marginLeft:2}}>{suTasks.length}</span></div>
          <div className="msec-tasks" style={{maxHeight:100,overflowY:'auto'}}>{suTasks.map(t => <MobileTaskCard key={t.id} task={t} member={member} moods={S.moods} clients={S.clients} tags={S.tags} taskStatuses={S.task_statuses} members={S.members} milestones={S.milestones} expanded={expandedCards[t.id]} onToggleExpand={onToggleExpand} onOpenTask={onOpenTask} onStatus={onStatus} />)}</div>
        </div>
      )}

      {visibleMoods.map(mood => {
        const mid = mood.id;
        const mt = visibleTasks.filter(t=>t.mood===mid && t.status!==standUpStatus);
        const moodMilestones = milestonesByMood[mid] || [];
        if ((mid==='top'||mid==='creative') && !mt.length && !moodMilestones.length) return null;
        const isHero=mid==='hero', isImp=mid==='imp', isTop=mid==='top';
        const secClass = isHero?'hero-sec':isImp?'imp-sec':isTop?'top-sec':'other-sec';
        const moodMins = allTasks.filter(t=>t.mood===mid).reduce((a,t)=>a+minsOf(t),0);
        const totalMoodCount = allTasks.filter(t=>t.mood===mid).length;
        const doneInMood = totalMoodCount - allTasks.filter(t=>t.mood===mid && t.status!==completeStatus).length;
        const secStyle = isHero?{background:mood.bg,border:`2px solid ${mood.color}55`,padding:4}
          : isImp?{background:mood.bg+'88',border:`1.5px solid ${mood.color}44`,padding:3} : {};
        const headBg = isHero?mood.color+'15':isImp?mood.color+'10':'transparent';
        return (
          <div key={mid} className={`msec ${secClass}`} style={{...secStyle,marginBottom:3}}>
            <div className="msec-head" style={{background:headBg,padding:'2px 4px'}}>
              <span style={{fontSize:isHero?12:isImp?11:10}}>{mood.icon}</span>
              <span className="msec-label" style={{color:mood.color,fontSize:isHero?10:isImp?9.5:9}}>{mood.label}</span>
              <span className="msec-cnt" style={{background:mood.color+'22',color:mood.color,fontSize:9}}>
                {mt.length}{mood.max?`/${mood.max}`:''}
              </span>
              {hm(moodMins) && <span style={{fontSize:8,color:mood.color,marginLeft:'auto',fontWeight:700,opacity:.7}}>{hm(moodMins)}</span>}
              <button disabled={limitReached}
                onClick={(e)=>{e.stopPropagation();handleAddTask(mid);}}
                title={limitReached?`Daily task limit reached (${dailyActive}/${dailyCap})`:''}
                style={{width:22,height:22,borderRadius:'50%',background:mood.color+'22',border:`1px solid ${mood.color}44`,
                  color:mood.color,fontSize:14,lineHeight:1,cursor:limitReached?'not-allowed':'pointer',display:'flex',alignItems:'center',
                  justifyContent:'center',flexShrink:0,padding:0,fontFamily:'inherit',marginLeft:hm(moodMins)?2:'auto',opacity:limitReached?0.5:1}}>+</button>
            </div>
            <div className="msec-tasks" style={{maxHeight:isHero?160:isImp?120:80,overflowY:'auto'}}>
              {moodMilestones.map(ms => {
                const mTotal = ms.substeps.length;
                const mDone = ms.substeps.filter(s => s.done).length;
                const mPct = mTotal ? Math.round(mDone/mTotal*100) : 0;
                const mDlClass = getDeadlineClass(ms.deadline);
                const mDlLabel = getDeadlineLabel(ms.deadline);
                const mMood = ms.mood ? sel.gmood(S, ms.mood) : null;
                const mClient = ms.clientId ? sel.gc(S, ms.clientId) : null;
                const summary = getMilestoneSummary(ms, S.tasks);
                return (
                  <div key={ms.id} className="ms-dash-card" style={{position:'relative'}} onClick={() => onOpenMs?.(ms)}>
                            <div className="ms-dash-head">
                      <span className="ms-dash-badge">◆ MILESTONE</span>
                      {mDlLabel && <span className={`ms-dash-deadline ${mDlClass}`}>{mDlLabel}</span>}
                    </div>
                    {(summary.overdue > 0 || summary.dueToday > 0) && (
                      <div className="ms-dash-summary">
                        {summary.overdue > 0 && <span className="ms-sum-overdue">● {summary.overdue} overdue</span>}
                        {summary.dueToday > 0 && <span className="ms-sum-today">● {summary.dueToday} due today</span>}
                      </div>
                    )}
                    <div className="ms-dash-title">{ms.title}</div>
                    <div className="ms-dash-progress">
                      <div className="ms-dash-bar"><div className="ms-dash-fill" style={{width:`${mPct}%`}} /></div>
                      <span className="ms-dash-pct">{mDone}/{mTotal} · {mPct}%</span>
                      <DlBadge deadline={ms.deadline} />
                    </div>
                    <div className="ms-dash-meta">
                      {mMood && <span className="ms-dash-chip" style={{background:mMood.bg,color:mMood.color}}>{mMood.icon} {mMood.label}</span>}
                      {mClient && <span className="ms-dash-chip" style={{background:(mClient.color||'var(--s2)')+'22',color:mClient.color||'var(--t2)'}}>{mClient.name}</span>}
                    </div>
                  </div>
                );
              })}
              {mt.length ? mt.map(t => <MobileTaskCard key={t.id} task={t} member={member} moods={S.moods} clients={S.clients} tags={S.tags} taskStatuses={S.task_statuses} members={S.members} milestones={S.milestones} expanded={expandedCards[t.id]} onToggleExpand={onToggleExpand} onOpenTask={onOpenTask} onStatus={onStatus} />)
                : !moodMilestones.length ? <div style={{fontSize:10,color:'var(--t3)',padding:'4px 4px',fontStyle:'italic'}}>No active {mood.label}</div> : null}
            </div>
          </div>
        );
      })}

        <button className="addbtn" disabled={limitReached}
          title={limitReached?`Daily task limit reached (${dailyActive}/${dailyCap})`:''}
          style={{fontSize:11,marginTop:4,flexShrink:0,opacity:limitReached?0.5:1,cursor:limitReached?'not-allowed':'pointer'}}
          onClick={()=>handleAddTask()}>+ Task</button>
    </div>
  );
});

/* ── MOBILE TASK CARD (simplified, expandable) ── */
const MobileTaskCard = memo(function MobileTaskCard({ task, member, moods, clients, tags, taskStatuses, members, milestones, expanded, onToggleExpand, onOpenTask, onStatus }) {
  const { STC, STB } = useMemo(() => getStatusMaps(taskStatuses), [taskStatuses]);
  const mood = useMemo(() => moods.find(m => m.id === task.mood), [moods, task.mood]);
  const client = useMemo(() => clients.find(c => c.id === task.clientId), [clients, task.clientId]);
  const timeStr = taskTimeStr(task);
  const [linkPop, setLinkPop] = useState(false);
  const notesText = getNotesText(task.notes);
  const hasNotes = notesText.length > 0;
  const hasLinks = task.links?.length > 0;
  const hasSubtasks = task.subtasks?.length > 0;
  const subTotal = task.subtasks?.length || 0;
  const subDone = task.subtasks?.filter(s => s.done).length || 0;
  const msLinks = useMemo(() => getTaskMilestoneLinks(task.id, milestones), [task.id, milestones]);

  return (
    <div className="td-mob-card" onClick={() => onOpenTask(task)}>
      <div className="td-mob-card-main">
        <div className="td-mob-card-name">{task.isMilestone?'🏁 ':''}{task.name}</div>
        <div className="td-mob-card-meta">
          {client && <span style={{color:mood?.color||'var(--t2)',fontWeight:600}}>{client.name}</span>}
          <span className="tcs" style={{background:STB[task.status],color:STC[task.status],fontSize:10,padding:'2px 7px',borderRadius:4,fontWeight:700}}
            onClick={(e)=>{e.stopPropagation();onStatus({ taskId:task.id, rect:e.target.getBoundingClientRect() });}}>
            {task.status} ▼
          </span>
          {timeStr && <span className="ttime" style={{fontSize:10}}>{timeStr}</span>}
        </div>
      </div>
      {msLinks.length > 0 && msLinks.map((msLink, idx) => (
        <div key={msLink.milestone.id+'_'+idx} className="task-ms-badge" style={idx > 0 ? {marginTop: 2} : {}}>
          <i>◆</i> <span className="ms-m-letter">M</span>
          {msLink.milestone.title.length > 20 ? msLink.milestone.title.slice(0, 20) + '…' : msLink.milestone.title}
        </div>
      ))}
      {task.tags?.length > 0 || task.assignedTo?.length > 1 ? (
        <button className="td-mob-card-expand" onClick={(e)=>{e.stopPropagation();onToggleExpand(task.id);}}>
          {expanded ? '▲' : '···'}
        </button>
      ) : null}
      {expanded && (task.tags?.length > 0 || task.assignedTo?.length > 1) && (
        <div className="td-mob-card-detail" onClick={e => e.stopPropagation()}>
          {task.tags?.length > 0 && (
            <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:4}}>
              {task.tags.map(tid => { const tg = tags.find(t=>t.id===tid); return tg ? <span key={tid} className="ttag-chip">{tg.label}</span> : null; })}
            </div>
          )}
          {task.assignedTo?.length > 1 && (
            <div style={{display:'flex',gap:4,flexWrap:'wrap',fontSize:10,color:'var(--t2)'}}>
              {task.assignedTo.filter(id=>id!==member.id).map(id => { const m = members?.find(x=>x.id===id); return m ? (
                <span key={id} style={{padding:'2px 7px',borderRadius:4,background:'var(--s2)',border:'1px solid var(--border)',fontWeight:600}}>{m.name}</span>) : null; })}
            </div>
          )}
        </div>
      )}
      {(hasNotes || hasLinks || hasSubtasks) && (
        <div className="card-icon-row mob">
          {hasNotes && (
            <span className="card-icon-pill notes-pill" aria-label="Has notes">
              📝<span className="card-pill-tip">{notesText}</span>
            </span>
          )}
          {hasLinks && (
            <span className="card-icon-pill link-pill" aria-label={`${task.links.length} link(s)`}
              onClick={e=>{e.stopPropagation();setLinkPop(p=>!p);}}>
              🔗 {task.links.length}
              {linkPop && (
                <span className="card-link-pop" onClick={e=>e.stopPropagation()}>
                  {task.links.map((ln,i) => (
                    <span key={i} className="card-link-item" onClick={()=>window.open(ln.url,'_blank','noopener,noreferrer')}>
                      {ln.label||ln.url}
                    </span>
                  ))}
                </span>
              )}
            </span>
          )}
          {hasSubtasks && <CircProg done={subDone} total={subTotal} />}
        </div>
      )}
    </div>
  );
});
