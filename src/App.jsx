import { useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import Nav from './components/Nav';
import Login from './views/Login';
import MemberView from './views/MemberView';
import TaskDashboard from './views/TaskDashboard';
import Toast from './components/Toast';
import { useStore } from './store/useStore';
import { useUIStore } from './store/useUIStore';

const Settings = lazy(() => import('./views/Settings'));
const TeamDashboard = lazy(() => import('./views/TeamDashboard'));
const Builder = lazy(() => import('./views/Builder'));
const TasksMilestones = lazy(() => import('./views/TasksMilestones'));
const ListView = lazy(() => import('./views/ListView'));
const TaskGen2 = lazy(() => import('./views/TaskGen2'));
const LineUp = lazy(() => import('./views/LineUp'));
const Playground = lazy(() => import('./views/Playground'));
const DelegatedView = lazy(() => import('./views/DelegatedView'));
const MilestonesView = lazy(() => import('./views/MilestonesView'));
const SMCalendar = lazy(() => import('./views/SMCalendar'));
const Signal = lazy(() => import('./views/Signal'));

const ALL_VIEWS = {
  tkd: TaskDashboard,
  st:  Settings,
  td:  TeamDashboard,
  bl:  Builder,
  tk:  TasksMilestones,
  lv:  ListView,
  tg2: TaskGen2,
  lu:  LineUp,
  pg:  Playground,
  dl:  DelegatedView,
  sc:  SMCalendar,
  ms:  MilestonesView,
  sg:  Signal,
};

function LoadingFallback() {
  return <div className="view active" style={{display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,color:'var(--t3)'}}>Loading…</div>;
}

const MANAGER_ROLES = ['admin', 'manager'];

export default function App() {
  const session = useStore(s => s.session);
  const role = useStore(s => s.role);
  const loading = useStore(s => s.loading);
  const isAuthLoading = useStore(s => s.isAuthLoading);
  const login = useStore(s => s.login);

  const defaultView = 'tkd';

  const uiView = useUIStore(s => s.view);
  const setView = useUIStore(s => s.setView);
  const uiScrollPositions = useUIStore(s => s.scrollPositions);
  const setScrollPosition = useUIStore(s => s.setScrollPosition);

  const view = uiView;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    if (!ALL_VIEWS[view]) {
      setView(defaultView);
    }
  }, [view, setView]);

  const handleSwitch = useCallback((v) => {
    if (v === viewRef.current) return;
    if (!ALL_VIEWS[v]) return;
    const el = document.querySelector('.view.active');
    if (el) {
      setScrollPosition(viewRef.current, el.scrollTop);
    }
    setView(v);
  }, [setView, setScrollPosition]);

  // Restore scroll when switching to a view that has saved scroll
  useEffect(() => {
    const el = document.querySelector('.view.active');
    if (el && uiScrollPositions[view] != null) {
      el.scrollTop = uiScrollPositions[view];
    }
  }, [view, uiScrollPositions]);

  // Track scroll on the active view only
  useEffect(() => {
    const el = document.querySelector('.view.active');
    if (!el) return;
    const handler = () => {
      setScrollPosition(view, el.scrollTop);
    };
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [view, setScrollPosition]);

  if (isAuthLoading) {
    return <div style={{display:'flex',height:'100vh',alignItems:'center',justifyContent:'center',color:'var(--t2)'}}>Loading…</div>;
  }

  if (loading) {
    return <div style={{display:'flex',height:'100vh',alignItems:'center',justifyContent:'center',color:'var(--t2)'}}>Loading…</div>;
  }

  if (!session) {
    return <Login onLogin={login} />;
  }

  // Member role → restricted member view
  if (role && !MANAGER_ROLES.includes(role)) {
    return <MemberView />;
  }

  // Manager/admin role → full dashboard
  // All views stay mounted — inactive ones are hidden with display:none.
  // This preserves each view's local state (scroll position, open modals, form input, etc.)
  return (
    <div className="app">
      <Nav current={view} onSwitch={handleSwitch} />
      {Object.entries(ALL_VIEWS).map(([key, View]) => (
        <div key={key} style={{ display: view === key ? '' : 'none' }} className={`view${view === key ? ' active' : ''}`}>
          <Suspense fallback={<LoadingFallback />}>
            <View />
          </Suspense>
        </div>
      ))}
      <Toast />
    </div>
  );
}
