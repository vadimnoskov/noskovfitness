import { useState, type FormEvent } from 'react';
import { useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useChangeMyPassword, useLogout, useListFamily, getListFamilyQueryKey, useSetAthletePassword } from '@workspace/api-client-react';
import { useMe } from '@/lib/session';

const errOf = (e: unknown) => (e as { data?: { error?: string } } | null)?.data?.error ?? 'Something went wrong. Try again.';

function FamilyPasswords() {
  const qc = useQueryClient();
  const fam = useListFamily({ query: { queryKey: getListFamilyQueryKey() } });
  const set = useSetAthletePassword({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListFamilyQueryKey() }) } });
  const [done, setDone] = useState<string | null>(null);
  const people = (fam.data as { athletes?: { id: string; name: string; isCoach: boolean; hasPassword: boolean }[] } | undefined)?.athletes ?? [];
  const onSubmit = (id: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const pw = String(new FormData(form).get('pw') ?? '');
    setDone(null);
    set.mutate({ athleteId: id, data: { newPassword: pw } }, { onSuccess: () => { form.reset(); setDone(id); } });
  };
  return (
    <section className="panel">
      <h2>Family</h2>
      <p className="small">Set each person's password, then tell them in person. They sign in with their first name. Setting a new password signs that person out on their other devices.</p>
      {people.filter((p) => !p.isCoach).map((p) => (
        <form key={p.id} className="famrow" onSubmit={onSubmit(p.id)}>
          <div><b>{p.name}</b> <span className={p.hasPassword ? 'small' : 'warn'}>{p.hasPassword ? 'password set' : 'no password yet'}</span></div>
          <input name="pw" type="text" autoComplete="off" minLength={8} required placeholder="New password (8+ characters)" aria-label={`New password for ${p.name}`} />
          <button className="btn" type="submit" disabled={set.isPending}>Set</button>
          {done === p.id ? <span className="ok">Saved</span> : null}
        </form>
      ))}
      {set.isError ? <p className="warn">{errOf(set.error)}</p> : null}
    </section>
  );
}

export default function Account() {
  const me = useMe();
  const setup = new URLSearchParams(useSearch()).get('setup') === '1';
  const change = useChangeMyPassword();
  const logout = useLogout();
  const [ok, setOk] = useState(false);
  if (!me) return <p className="empty">Loading…</p>;
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    setOk(false);
    if (f.get('newPassword') !== f.get('again')) { change.reset(); window.alert("The new passwords don't match."); return; }
    change.mutate({ data: { currentPassword: String(f.get('currentPassword')), newPassword: String(f.get('newPassword')) } }, { onSuccess: () => { form.reset(); setOk(true); } });
  };
  return (
    <div className="phone-page">
      <h1>{me.user.name}</h1>
      {setup && !me.user.hasPassword ? <p className="panel warn">You signed in with the family password. Set your own password now; after that the family password no longer works for you.</p> : null}
      <section className="panel">
        <h2>{me.user.hasPassword ? 'Change password' : 'Set your password'}</h2>
        <form className="stack-form" onSubmit={onSubmit}>
          <label>{me.user.hasPassword ? 'Current password' : 'Family password'}<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
          <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={8} required /></label>
          <label>New password again<input name="again" type="password" autoComplete="new-password" minLength={8} required /></label>
          {change.isError ? <p className="warn">{errOf(change.error)}</p> : null}
          {ok ? <p className="ok">Password saved. Other devices were signed out.</p> : null}
          <button className="btn primary big" type="submit" disabled={change.isPending}>Save password</button>
        </form>
      </section>
      {me.user.isCoach ? <FamilyPasswords /> : null}
      <button className="btn big" type="button" onClick={() => logout.mutate(undefined, { onSuccess: () => window.location.assign('/login') })}>Sign out</button>
    </div>
  );
}
