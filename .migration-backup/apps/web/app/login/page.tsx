import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { COOKIE, tokenFor } from '@/lib/auth';

async function login(f: FormData) {
  'use server';
  const pw = process.env.APP_PASSWORD ?? '';
  const next = String(f.get('next') ?? '/');
  if (!pw || String(f.get('password') ?? '') !== pw) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  (await cookies()).set(COOKIE, await tokenFor(pw), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 60, path: '/' });
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <form action={login} style={{ maxWidth: 360, margin: '10vh auto', display: 'grid', gap: 12 }}>
      <h1>Noskov Fitness</h1>
      <label htmlFor="pw" style={{ display: 'block' }}>Family password</label>
      <input id="pw" name="password" type="password" autoComplete="current-password" autoFocus required />
      <input type="hidden" name="next" value={sp.next ?? '/'} />
      {sp.error ? <p className="warn">That password didn't match.</p> : null}
      <button className="btn primary" type="submit">Sign in</button>
    </form>
  );
}
