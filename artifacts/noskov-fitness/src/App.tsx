import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import CalendarPage from '@/pages/calendar';
import ProgramPage from '@/pages/program';
import Analysis from '@/pages/analysis';
import Benchmarks from '@/pages/benchmarks';
import Settings from '@/pages/settings';
import { KnowledgeMap, KnowledgeCardPage, KnowledgeAsk } from '@/pages/knowledge';
import { MovementsPage, MovementPage } from '@/pages/movements';
import { CoachPage } from '@/pages/coach';
import Login from '@/pages/login';
import Today from '@/pages/today';
import History from '@/pages/history';
import WorkoutPage from '@/pages/workout';
import Account from '@/pages/account';
import FitnessPage from '@/pages/fitness';
import { SessionProvider, useMe, isCoaching } from '@/lib/session';
import '@/lib/program';
import AthletesPage from '@/pages/athletes';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const TITLES: Record<string, string> = {
  '/today': 'Today', '/history': 'History', '/account': 'Account', '/calendar': 'Program calendar', '/program': 'Program',
  '/analysis': 'Programming analysis', '/athletes': 'Athletes', '/benchmarks': 'Benchmarks', '/settings': 'Programming settings', '/login': 'Sign in',
};

function Layout({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const me = useMe();
  const [menu, setMenu] = useState(false);
  useEffect(() => { document.title = TITLES[path] ? `${TITLES[path]} · Noskov Fitness` : 'Noskov Fitness'; setMenu(false); }, [path]);
  if (path === '/login') return <main>{children}</main>;
  const coach = !!me?.user.isCoach;
  const coaching = isCoaching(me);
  return (
    <>
      <header className="top">
        <Link href="/today" className="brand">Noskov Fitness</Link>
        {/* On phones the menu folds into a button at the top right. */}
        <button type="button" className="menubtn" aria-expanded={menu} aria-controls="mainnav" aria-label="Menu" onClick={() => setMenu(!menu)}>
          <span aria-hidden="true">{menu ? '✕' : '☰'}</span>
        </button>
        <nav aria-label="Main" id="mainnav" className={menu ? 'open' : undefined}>
          <Link href="/today">Today</Link>
          <Link href="/history">History</Link>
          <Link href="/benchmarks">Benchmarks</Link>
          <Link href="/fitness">Fitness</Link>
          {coaching ? (
            <>
              <Link href="/athletes">Athletes</Link>
              <Link href="/program">Program</Link>
              <Link href="/calendar">Calendar</Link>
              <Link href="/analysis">Analysis</Link>
            </>
          ) : null}
          {coach ? <Link href="/knowledge">Chalkboard</Link> : null}
          {coaching ? <Link href="/settings">Settings</Link> : null}
          <Link href="/account">Account</Link>
        </nav>
      </header>
      {/* The program planner uses the whole browser width so each day gets more room on big screens. */}
      <main className={path.startsWith('/program') ? 'full' : undefined}>{children}</main>
    </>
  );
}

/** Planning screens are for the coach only (for now). */
function CoachOnly({ children, any }: { children: ReactNode; any?: boolean }) {
  const me = useMe();
  if (!me) return <p className="empty">Loading…</p>;
  if (!(any ? isCoaching(me) : me.user.isCoach)) return <Redirect to="/today" replace />;
  return <>{children}</>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/"><Redirect to="/today" replace /></Route>
        <Route path="/today" component={Today} />
        <Route path="/history" component={History} />
        <Route path="/workout/:id" component={WorkoutPage} />
        <Route path="/account" component={Account} />
        <Route path="/benchmarks" component={Benchmarks} />
        <Route path="/fitness" component={FitnessPage} />
        <Route path="/athletes"><CoachOnly any><AthletesPage /></CoachOnly></Route>
        <Route path="/calendar"><CoachOnly any><CalendarPage /></CoachOnly></Route>
        <Route path="/program"><CoachOnly any><ProgramPage /></CoachOnly></Route>
        <Route path="/analysis"><CoachOnly any><Analysis /></CoachOnly></Route>
        <Route path="/knowledge/movements/:key"><CoachOnly><MovementPage /></CoachOnly></Route>
        <Route path="/knowledge/movements"><CoachOnly><MovementsPage /></CoachOnly></Route>
        <Route path="/knowledge/coach"><CoachOnly><CoachPage /></CoachOnly></Route>
        <Route path="/knowledge/ask"><CoachOnly><KnowledgeAsk /></CoachOnly></Route>
        <Route path="/knowledge/:id"><CoachOnly><KnowledgeCardPage /></CoachOnly></Route>
        <Route path="/knowledge"><CoachOnly><KnowledgeMap /></CoachOnly></Route>
        <Route path="/settings"><CoachOnly any><Settings /></CoachOnly></Route>
        <Route path="/login" component={Login} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <SessionProvider>
          <Layout><Router /></Layout>
        </SessionProvider>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
