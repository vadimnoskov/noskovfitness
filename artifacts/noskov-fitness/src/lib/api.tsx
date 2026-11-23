import { useEffect, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useGetFitnessPage, getGetFitnessPageQueryKey, useFitnessAction, type GetFitnessPageParams, type FitnessForm } from '@workspace/api-client-react';

type Action = Parameters<ReturnType<typeof useFitnessAction>['mutate']>[0]['action'];

const statusOf = (e: unknown) => (e && typeof e === 'object' && 'status' in e ? Number((e as { status: unknown }).status) : 0);
const messageOf = (e: unknown) => {
  const data = e && typeof e === 'object' && 'data' in e ? (e as { data: unknown }).data : null;
  if (data && typeof data === 'object' && 'error' in data) return String((data as { error: unknown }).error);
  return e instanceof Error ? e.message : 'Something went wrong.';
};

export function loginHref() {
  const here = window.location.pathname + window.location.search;
  return `/login?next=${encodeURIComponent(here)}`;
}

/** Typed page loader. Redirects to /login on 401. */
export function usePage<T>(params: GetFitnessPageParams, enabled = true) {
  const q = useGetFitnessPage(params, { query: { enabled, retry: false, queryKey: getGetFitnessPageQueryKey(params) } });
  const [, navigate] = useLocation();
  const unauth = statusOf(q.error) === 401;
  useEffect(() => { if (unauth) navigate(loginHref()); }, [unauth, navigate]);
  return { ...q, data: q.data as T | undefined };
}

export function PageStatus({ q }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown } }) {
  if (q.error) {
    if (statusOf(q.error) === 401) return <p className="empty">Signing in…</p>;
    return (
      <div className="panel" role="alert">
        <p className="warn">{messageOf(q.error)}</p>
        <div className="bar"><button className="btn" type="button" onClick={() => q.refetch()}>Retry</button></div>
      </div>
    );
  }
  return <p className="empty">Loading…</p>;
}

function toForm(f: FormData): FitnessForm {
  const out: FitnessForm = {};
  for (const k of new Set(f.keys())) {
    const all = f.getAll(k).map(String);
    out[k] = all.length > 1 ? all : all[0]!;
  }
  return out;
}

/** Replacement for a Next server-action form: posts the form fields as JSON to /api/fitness/actions/{action}. */
export function ActionForm({ action, className, style, children }: { action: Action; className?: string; style?: CSSProperties; children: ReactNode }) {
  const m = useFitnessAction();
  const [, navigate] = useLocation();
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (m.isPending) return;
    m.mutate({ action, data: toForm(new FormData(e.currentTarget)) }, {
      // A fresh document also reinitializes uncontrolled settings inputs after reset,
      // matching the original server-action navigation and avoiding stale form values.
      onSuccess: (r) => { window.location.assign(r.redirect ?? window.location.href); },
      onError: (err) => { if (statusOf(err) === 401) navigate(loginHref()); },
    });
  };
  return (
    <form onSubmit={onSubmit} className={className} style={style} aria-busy={m.isPending}>
      {children}
      {m.isError && statusOf(m.error) !== 401 ? <p className="warn" role="alert">{messageOf(m.error)}</p> : null}
    </form>
  );
}
