import { useState, type FormEvent } from 'react';
import { useSearch } from 'wouter';
import { useFamilyLogin } from '@workspace/api-client-react';

export default function Login() {
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { next?: string };
  const [error, setError] = useState<string | null>(null);
  const login = useFamilyLogin();
  const next = sp.next ?? '/';
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    login.mutate({ data: { name: String(f.get('name') ?? ''), password: String(f.get('password') ?? ''), next } }, {
      // Full load so the whole app starts fresh as the signed-in person.
      onSuccess: (r) => { const to = r.redirect ?? next; window.location.assign(to.startsWith('/') && !to.startsWith('//') ? to : '/'); },
      onError: (err) => setError((err as { data?: { error?: string } }).data?.error ?? 'Sign in failed. Check your connection and try again.'),
    });
  };
  return (
    <form className="login" onSubmit={onSubmit} aria-busy={login.isPending}>
      <h1>Noskov Fitness</h1>
      <label>Your name<input name="name" autoComplete="username" autoCapitalize="words" autoFocus required placeholder="e.g. Olga" /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {error ? <p className="warn" role="alert">{error}</p> : null}
      <button className="btn primary big" type="submit" disabled={login.isPending}>{login.isPending ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}
