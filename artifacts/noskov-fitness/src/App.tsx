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

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

function Layout({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  useEffect(() => {
    const titles: Record<string, string> = { '/calendar': 'Program calendar', '/program': 'Program', '/analysis': 'Programming analysis', '/benchmarks': 'Benchmarks', '/settings': 'Programming settings', '/login': 'Sign in' };
    document.title = titles[path] ? `${titles[path]} · Noskov Fitness` : 'Noskov Fitness';
  }, [path]);
  return (
    <>
      <header className="top">
        <Link href="/calendar" className="brand">Noskov Fitness</Link>
        <nav aria-label="Main">
          <Link href="/program">Program</Link>
          <Link href="/calendar">Calendar</Link>
          <Link href="/analysis">Analysis</Link>
          <Link href="/benchmarks">Benchmarks</Link>
          <Link href="/settings">Settings</Link>
        </nav>
      </header>
      <main>{children}</main>
    </>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/"><Redirect to="/calendar" replace /></Route>
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/program" component={ProgramPage} />
        <Route path="/analysis" component={Analysis} />
        <Route path="/benchmarks" component={Benchmarks} />
        <Route path="/settings" component={Settings} />
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
        <Layout><Router /></Layout>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
