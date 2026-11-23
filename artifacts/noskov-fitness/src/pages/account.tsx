import { useState, type FormEvent } from 'react';
import { useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useChangeMyPassword, useLogout, useListFamily, getListFamilyQueryKey, useSetAthletePassword, useSetLoadProfile } from '@workspace/api-client-react';
import { useMe } from '@/lib/session';

const errOf = (e: unknown) => (e as { data?: { error?: string } } | null)?.data?.error ?? 'Something went wrong. Try again.';

type Member = { id: string; name: string; sex: 'male' | 'female'; isCoach: boolean; hasPassword: boolean; loadProfile: Record<string, number> | null };
const KINDS = [['dumbbell', 'Dumbbell'], ['kettlebell', 'Kettlebell'], ['barbell', 'Barbell'], ['medball', 'Med ball / wall ball']] as const;
const EXAMPLE: Record<string, [number, number]> = { dumbbell: [50, 35], kettlebell: [53, 35], barbell: [135, 95], medball: [20, 14] };

/** Coach: each person's usual weights as a percent of the standard Rx for their sex. */
function LoadSettings({ people }: { people: Member[] }) {
  const qc = useQueryClient();
  const m = useSetLoadProfile({ mutation: { onSuccess: () => qc.invalidateQueries() } });
  const [saved, setSaved] = useState<string | null>(null);
  const onSubmit = (p: Member) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaved(null);
    m.mutate({ athleteId: p.id, data: Object.fromEntries(KINDS.map(([k]) => [k, Number(f.get(k)) || 100])) }, { onSuccess: () => setSaved(p.id) });
  };
  return (
    <section className="panel">
      <h2>Usual weights</h2>
      <p className="small">Each person's own Rx, as a percent of the standard Rx for their sex. 100% = full Rx. The app rounds to weights that exist where you train that day, shows it to them as their Rx, and you can still change any single day on Today.</p>
      {people.map((p) => (
        <form key={`${p.id}|${JSON.stringify(p.loadProfile)}`} className="loads" onSubmit={onSubmit(p)}>
          <b>{p.name}</b>
          {KINDS.map(([k, label]) => {
            const pct = Math.round((p.loadProfile?.[k] ?? 1) * 100);
            const std = EXAMPLE[k]![p.sex === 'female' ? 1 : 0];
            return (
              <label key={k}>{label}<span className="unit"><input name={k} type="number" inputMode="numeric" min={10} max={150} step={5} defaultValue={pct} />%</span>
                <span className="small">e.g. standard {std} lb → about {Math.max(5, Math.round((std * pct) / 100 / 5) * 5)} lb (rounded to a real weight)</span></label>
            );
          })}
          <button className="btn" type="submit" disabled={m.isPending}>Save {p.name}'s weights</button>
          {saved === p.id ? <span className="ok">Saved</span> : null}
        </form>
      ))}
      {m.isError ? <p className="warn">{errOf(m.error)}</p> : null}
    </section>
  );
}

function FamilyPasswords() {
  const qc = useQueryClient();
  const fam = useListFamily({ query: { queryKey: getListFamilyQueryKey() } });
  const set = useSetAthletePassword({ mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListFamilyQueryKey() }) } });
  const [done, setDone] = useState<string | null>(null);
  const people = (fam.data as { athletes?: Member[] } | undefined)?.athletes ?? [];
  const onSubmit = (id: string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const pw = String(new FormData(form).get('pw') ?? '');
    setDone(null);
    set.mutate({ athleteId: id, data: { newPassword: pw } }, { onSuccess: () => { form.reset(); setDone(id); } });
  };
  return (
    <>
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
    {people.length ? <LoadSettings people={people} /> : null}
    </>
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
