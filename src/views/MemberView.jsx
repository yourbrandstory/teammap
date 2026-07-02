import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useStore } from '../store/useStore';
import { getCompleteStatus, getPassStatus } from '../utils/statusUtils';
import MemberLineUp from './MemberLineUp';
import MemberPlayground from './MemberPlayground';
import MemberKanban from './MemberKanban';
import MemberTasks from './MemberTasks';
import MemberSentView from './MemberSentView';
import MilestonesView from './MilestonesView';
import Toast from '../components/Toast';

const TABS = [
  { id: 'tk', label: 'Tasks', icon: '🗂️' },
  { id: 'lu', label: 'Line Up', icon: '📋' },
  { id: 'ms', label: 'Milestones', icon: '◆' },
  { id: 'pg', label: 'Playground', icon: '◢' },
  { id: 'kb', label: 'Kanban', icon: '📌' },
  { id: 'sn', label: 'Sent', icon: '📤' },
];

export default function MemberView() {
  const [tab, setTab] = useState('tk');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const memberSession = useStore(s => s.session);
  const signOut = useStore(s => s.signOut);
  const S = useStore(s => s.S);
  const memberId = memberSession?.memberId;
  const completeStatus = getCompleteStatus(S.task_statuses);
  const passStatus = getPassStatus(S.task_statuses);

  const sentPendingCount = useMemo(() => {
    if (!memberId) return 0;
    return S.tasks.filter(t =>
      !t.deleted &&
      t.createdBy === memberId &&
      t.assignedTo.length > 0 &&
      !t.assignedTo.includes(memberId) &&
      t.status !== completeStatus &&
      t.status !== passStatus
    ).length;
  }, [S.tasks, memberId, completeStatus, passStatus]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) && !e.target.closest('.nav-hamburger')) {
        closeMenu();
      }
    };
    const onEsc = (e) => {
      const target = e.target;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable;
      if (isTyping) return;
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen, closeMenu]);

  const handleTab = (id) => {
    setTab(id);
    closeMenu();
  };

  return (
    <div className="app member-app">
      {/* ── Member nav bar ── */}
      <div className="nav" style={{display:'flex',alignItems:'center'}}>
        <button className="nav-hamburger" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
          {menuOpen ? '✕' : '☰'}
        </button>
        <div className="nav-brand" style={{fontSize:16}}>Team<span>Map</span></div>
        <div className="nav-desktop-items" style={{display:'flex',alignItems:'center',gap:0,marginLeft:16}}>
          {TABS.map(t => (
            <div key={t.id} className={`nt${tab===t.id?' active':''}`} onClick={() => setTab(t.id)} style={{ position: 'relative' }}>
              <span>{t.icon}</span> {t.label}
              {t.id === 'sn' && sentPendingCount > 0 && (
                <span style={{
                  position: 'absolute', top: 2, right: 2, fontSize: 9,
                  background: 'var(--warn)', color: '#fff', borderRadius: 8,
                  padding: '1px 5px', fontWeight: 700, lineHeight: 1.3,
                }}>
                  {sentPendingCount}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="ns" />
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'0 12px'}}>
          <span style={{fontSize:12,color:'var(--t2)'}}>
            {memberSession?.name || 'Member'}
          </span>
          <button className="btn btn-sm" style={{color:'var(--warn)'}} onClick={signOut}>
            Log out
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="nav-mobile-menu" ref={menuRef}>
          <div className="nav-mobile-close-row">
            <span className="nav-mobile-title">Menu</span>
            <button className="nav-mobile-x" onClick={closeMenu} onTouchStart={closeMenu} aria-label="Close menu">✕</button>
          </div>
          {TABS.map(t => (
            <div key={t.id} className={`nav-mobile-item${tab===t.id?' active':''}`} onClick={() => handleTab(t.id)}>
              <span style={{fontSize:16,width:24,textAlign:'center'}}>{t.icon}</span>
              <span>{t.label}</span>
              {t.id === 'sn' && sentPendingCount > 0 && (
                <span style={{
                  marginLeft: 'auto', fontSize: 10,
                  background: 'var(--warn)', color: '#fff', borderRadius: 8,
                  padding: '1px 6px', fontWeight: 700,
                }}>
                  {sentPendingCount}
                </span>
              )}
            </div>
          ))}
          <div style={{borderTop:'1px solid var(--border)',margin:'8px 0'}} />
          <div className="nav-mobile-item" onClick={() => { closeMenu(); signOut(); }} style={{color:'var(--warn)'}}>
            <span style={{fontSize:16,width:24,textAlign:'center'}}>🚪</span>
            <span>Log out</span>
          </div>
        </div>
      )}

      {/* ── Tab content — all mounted, inactive hidden with display:none ── */}
      <div className="member-tab-content" style={{ display: tab === 'lu' ? '' : 'none' }}><MemberLineUp /></div>
      <div className="member-tab-content" style={{ display: tab === 'ms' ? '' : 'none' }}><MilestonesView memberFilter={memberId} hideNewButton /></div>
      <div className="member-tab-content" style={{ display: tab === 'pg' ? '' : 'none' }}><MemberPlayground /></div>
      <div className="member-tab-content" style={{ display: tab === 'kb' ? '' : 'none' }}><MemberKanban /></div>
      <div className="member-tab-content" style={{ display: tab === 'tk' ? '' : 'none' }}><MemberTasks /></div>
      <div className="member-tab-content" style={{ display: tab === 'sn' ? '' : 'none' }}><MemberSentView /></div>
      <Toast />
    </div>
  );
}
