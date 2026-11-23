import { useState, type FormEvent } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useFamilyLogin } from '@workspace/api-client-react';

export default function Login() {
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { error?: string; next?: string };
  const [, navigate] = useLocation();
  const [failed, setFailed] = useState(false);
  const login = useFamilyLogin();
  const next = sp.next ?? '/';
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setFailed(false);
    login.mutate({ data: { password: String(f.get('password') ?? ''), next: String(f.get('next') ?? '/') } }, {
      onSuccess: (r) => {
        const to = r.redirect ?? next;
        navigate(to.startsWith('/') && !to.startsWith('//') ? to : '/');
      },
      onError: () => setFailed(true),
    });
  };
  const err = login.error as { status?: number; data?: { error?: string } } | null;
  return (
    <form onSubmit={onSubmit} aria-busy={login.isPending} style={{ maxWidth: 360, margin: '10vh auto', display: 'grid', gap: 12 }}>
      <h1>Noskov Fitness</h1>
      <label htmlFor="pw" style={{ display: 'block' }}>Family password</label>
      <input id="pw" name="password" type="password" autoComplete="current-password" autoFocus required />
      <input type="hidden" name="next" value={next} />
      {failed && err?.status !== 401 ? <p className="warn">{err?.data?.error ?? 'Sign in failed. Try again.'}</p>
        : sp.error || failed ? <p className="warn">That password didn't match.</p> : null}
      <button className="btn primary" type="submit" disabled={login.isPending}>Sign in</button>
    </form>
  );
}
