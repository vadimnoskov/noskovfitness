import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import CalendarPage from '@/pages/calendar';
import ProgramPage from '@/pages/program';
import Analysis from '@/pages/analysis';
import Benchmarks from '@/pages/benchmarks';
import Settings from '@/pages/settings';
import Login from '@/pages/login';
import Today from '@/pages/today';
import History from '@/pages/history';
import WorkoutPage from '@/pages/workout';
import Account from '@/pages/account';
import { SessionProvider, useMe } from '@/lib/session';

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const TITLES: Record<string, string> = {
  '/today': 'Today', '/history': 'History', '/account': 'Account', '/calendar': 'Program calendar', '/program': 'Program',
  '/analysis': 'Programming analysis', '/benchmarks': 'Benchmarks', '/settings': 'Programming settings', '/login': 'Sign in',
};

function Layout({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const me = useMe();
  useEffect(() => { document.title = TITLES[path] ? `${TITLES[path]} · Noskov Fitness` : 'Noskov Fitness'; }, [path]);
  if (path === '/login') return <main>{children}</main>;
  const coach = !!me?.user.isCoach;
  return (
    <>
      <header className="top">
        <Link href="/today" className="brand">Noskov Fitness</Link>
        <nav aria-label="Main">
          <Link href="/today">Today</Link>
          <Link href="/history">History</Link>
          <Link href="/benchmarks">Benchmarks</Link>
          {coach ? (
            <>
              <Link href="/program">Program</Link>
              <Link href="/calendar">Calendar</Link>
              <Link href="/analysis">Analysis</Link>
              <Link href="/settings">Settings</Link>
            </>
          ) : null}
          <Link href="/account">{me ? me.user.name : 'Account'}</Link>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}

/** Planning screens are for the coach only (for now). */
function CoachOnly({ children }: { children: ReactNode }) {
  const me = useMe();
  if (!me) return <p className="empty">Loading…</p>;
  if (!me.user.isCoach) return <Redirect to="/today" replace />;
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
        <Route path="/calendar"><CoachOnly><CalendarPage /></CoachOnly></Route>
        <Route path="/program"><CoachOnly><ProgramPage /></CoachOnly></Route>
        <Route path="/analysis"><CoachOnly><Analysis /></CoachOnly></Route>
        <Route path="/settings"><CoachOnly><Settings /></CoachOnly></Route>
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
