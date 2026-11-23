import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearch, useLocation } from 'wouter';
import { useGetToday, getGetTodayQueryKey, useSearchWorkouts, getSearchWorkoutsQueryKey, useSetAthleteVersion } from '@workspace/api-client-react';
import { structureLabel, movementLine, workoutTitle, nameOf, keyOf, scoreText, type Workout, type WorkoutTags } from '@workspace/fitness-core';
import { useMe, localToday, type Person } from '@/lib/session';
import { addDays, longDate } from '@/lib/dates';
import { Chips } from '@/components/Chips';
import { LogForm, rxFor, type Comparison } from '@/components/LogForm';
import { ResultItem, type ResultRow } from '@/components/ResultItem';
import { PageStatus } from '@/lib/api';

type Change = { index: number; from?: number; to: number; unit: string };
type Past = { id: string; date: string; score: Record<string, number>; rx: boolean; completed: boolean; notes: string | null };
type Planned = { dayId: string; status: string; workout: Workout; standard: Workout; changes: Change[]; override: boolean; location?: string; tags: WorkoutTags;
  totalReps?: number; previous: Past[]; previousCount: number; best: Past | null; coaching: string[] };
type TodayData = { date: string; planned: Planned[]; results: ResultRow[] };

export function AthletePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const me = useMe();
  if (!me || me.logFor.length < 2) return null;
  return (
    <div className="seg people" role="group" aria-label="Whose results">
      {me.logFor.map((p) => <button key={p.id} type="button" aria-pressed={p.id === value} onClick={() => onChange(p.id)}>{p.name}</button>)}
    </div>
  );
}

export function WorkoutCard({ workout, tags, sex, children }: { workout: Workout; tags?: WorkoutTags; sex: 'male' | 'female'; children?: React.ReactNode }) {
  const bm = workout.benchmark && workout.benchmark.category !== 'lift';
  return (
    <article className="wcard">
      {tags ? <Chips mods={tags.modalityPattern} load={tags.load} volume={tags.volume} priority={tags.priority} /> : null}
      <h2>{bm ? <span className="bm">★ </span> : null}<Link href={`/workout/${workout.id}`}>{workoutTitle(workout)}</Link></h2>
      <div className="small">{structureLabel(workout.structure)}{workout.structure.kind === 'for-time' && workout.structure.capMin ? <b className="cap"> · Time cap {workout.structure.capMin}:00</b> : null}</div>
      <ul className="mv">{workout.movements.map((m, i) => {
        // Show this person's Rx; where only the other sex's Rx is written, show an estimate and say so.
        const r = rxFor(m, sex);
        const line = r ? movementLine({ ...m, load: { unit: r.unit, [sex]: r.value } }, sex) : movementLine(m, sex);
        return <li key={i}>{line}{r?.estimated ? <span className="small"> (est.)</span> : null}</li>;
      })}</ul>
      {children}
    </article>
  );
}

/** One line per distinct movement whose weight differs from the standard Rx, e.g. "Dumbbell Snatch 20 lb (standard 50/35)". */
function PersonalNote({ p, name }: { p: Planned; name: string }) {
  if (p.workout.version?.kind !== 'personal' || !p.changes.length) return null;
  const seen = new Set<string>();
  const lines = p.changes.filter((c) => { const k = keyOf(p.workout.movements[c.index]!.movement) + c.to; return seen.has(k) ? false : (seen.add(k), true); }).map((c) => {
    return `${nameOf(p.workout.movements[c.index]!.movement)} ${c.to} ${c.unit}${c.from !== undefined ? ` (standard Rx ${c.from} ${c.unit})` : ''}`;
  });
  return <p className="mine">{name === 'Your' ? 'Your' : `${name}'s`} Rx{p.override ? ' for today' : ''}: {lines.join(' · ')}</p>;
}

/** "Plan for today" (coaching notes) and this person's recent results on the same workout. */
function PlanAndHistory({ p, self, name }: { p: Planned; self: boolean; name: string }) {
  return (
    <>
      {p.coaching.length ? (
        <div className="plan"><b>Plan for today</b><ul>{p.coaching.map((c, i) => <li key={i}>{c}</li>)}</ul></div>
      ) : null}
      {p.previousCount ? (
        <div className="prev">
          <b>{self ? 'Your' : `${name}'s`} results on this workout ({p.previousCount})</b>
          <ul>{p.previous.map((r) => (
            <li key={r.id}><span className="rdate">{r.date}</span> <b>{scoreText(r as never)}</b> <span className={`tag ${r.rx ? 'rx' : 'sc'}`}>{r.rx ? 'Rx' : 'Scaled'}</span>{!r.completed ? <span className="tag">Capped</span> : null}{p.best?.id === r.id && p.previousCount > 1 ? <span className="tag best">Best</span> : null}</li>
          ))}</ul>
          {p.best && !p.previous.some((r) => r.id === p.best!.id) ? <div className="small">Best: {scoreText(p.best as never)} ({p.best.date})</div> : null}
          {p.previousCount > p.previous.length ? <Link className="small" href={`/workout/${p.workout.id}`}>See all {p.previousCount}</Link> : null}
        </div>
      ) : null}
    </>
  );
}

function SavedBanner({ c }: { c: Comparison }) {
  const parts = [c.isBest ? (c.count ? 'New personal best' : 'First result recorded') : null, c.vsLast ? `vs last time${c.vsBest === c.vsLast && !c.isBest ? ' and your best' : ''}: ${c.vsLast}` : null, !c.isBest && c.vsBest && c.vsBest !== c.vsLast ? `vs your best: ${c.vsBest}` : null].filter(Boolean);
  return <p className={`saved${c.isBest ? ' pr' : ''}`} role="status">Saved{parts.length ? `: ${parts.join(' · ')}` : '.'}</p>;
}

/** Coach: change one person's weights for this day only (their standing setting stays as is). */
function VersionEditor({ p, athlete }: { p: Planned; athlete: Person }) {
  const qc = useQueryClient();
  const m = useSetAthleteVersion({ mutation: { onSuccess: () => qc.invalidateQueries() } });
  const groups: { key: string; name: string; indices: number[]; value: number; unit: string }[] = [];
  p.workout.movements.forEach((mv, i) => {
    const v = mv.load?.[athlete.sex];
    if (v === undefined || mv.load?.percentOf) return;
    const key = keyOf(mv.movement);
    const g = groups.find((x) => x.key === key);
    if (g) g.indices.push(i); else groups.push({ key, name: nameOf(mv.movement), indices: [i], value: v, unit: mv.load!.unit });
  });
  if (!groups.length) return null;
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const loads = groups.flatMap((g) => g.indices.map((index) => ({ index, value: Number(f.get(g.key)) })));
    m.mutate({ data: { dayId: p.dayId, athleteId: athlete.id, loads } });
  };
  return (
    <details className="ver">
      <summary>Adjust {athlete.name}'s weights for this day</summary>
      <form className="log" onSubmit={onSubmit}>
        {groups.map((g) => (
          <label key={g.key}>{g.name}<span className="unit"><input name={g.key} inputMode="decimal" defaultValue={g.value} required />{g.unit}</span></label>
        ))}
        <button className="btn primary" type="submit" disabled={m.isPending}>Save for this day</button>
        {p.override ? <button className="btn ghost" type="button" disabled={m.isPending} onClick={() => m.mutate({ data: { dayId: p.dayId, athleteId: athlete.id, reset: true } })}>Back to {athlete.name}'s usual setting</button> : null}
        <p className="small">Their usual setting is on Account → Family.</p>
      </form>
    </details>
  );
}

export default function Today() {
  const me = useMe();
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { d?: string; a?: string };
  const [, navigate] = useLocation();
  const date = sp.d && /^\d{4}-\d\d-\d\d$/.test(sp.d) ? sp.d : localToday();
  const athleteId = sp.a ?? me?.user.id ?? '';
  const athlete: Person | undefined = me?.logFor.find((p) => p.id === athleteId) ?? me?.user;
  const go = (d: string, a = athleteId) => navigate(`/today?d=${d}${a && a !== me?.user.id ? `&a=${a}` : ''}`);
  const params = { date, ...(athleteId && athleteId !== me?.user.id ? { athleteId } : {}) };
  const q = useGetToday(params, { query: { enabled: !!me, queryKey: getGetTodayQueryKey(params), retry: false } });
  const [logging, setLogging] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, Comparison>>({});
  const [other, setOther] = useState('');
  const search = useSearchWorkouts({ q: other }, { query: { enabled: other.trim().length >= 2, queryKey: getSearchWorkoutsQueryKey({ q: other }) } });
  const [picked, setPicked] = useState<Workout | null>(null);

  if (!me || !athlete) return <p className="empty">Loading…</p>;
  const data = q.data as TodayData | undefined;
  const isToday = date === localToday();
  return (
    <div className="phone-page">
      <div className="datebar">
        <button className="btn" type="button" onClick={() => go(addDays(date, -1))} aria-label="Previous day">←</button>
        <div><b>{isToday ? 'Today' : longDate(date)}</b>{isToday ? <div className="small">{longDate(date)}</div> : <button className="linkish" type="button" onClick={() => go(localToday())}>Back to today</button>}</div>
        <button className="btn" type="button" onClick={() => go(addDays(date, 1))} aria-label="Next day" disabled={date >= addDays(localToday(), 1)}>→</button>
      </div>
      <AthletePicker value={athlete.id} onChange={(a) => go(date, a)} />
      {!data ? <PageStatus q={q} /> : (
        <>
          {data.planned.length === 0 ? <p className="empty">No workout planned for this day.</p> : null}
          {data.planned.map((p) => (
            <WorkoutCard key={p.dayId} workout={p.workout} tags={p.tags} sex={athlete.sex}>
              <PersonalNote p={p} name={athlete.id === me.user.id ? 'Your' : athlete.name} />
              {p.status === 'proposed' ? <p className="small">Proposed by the engine; the coach hasn't approved it yet.</p> : null}
              {me.user.isCoach ? <VersionEditor key={`${p.dayId}|${athlete.id}|${JSON.stringify(p.workout.movements.map((x) => x.load))}`} p={p} athlete={athlete} /> : null}
              <PlanAndHistory p={p} self={athlete.id === me.user.id} name={athlete.name} />
              {saved[p.dayId] ? <SavedBanner c={saved[p.dayId]!} /> : null}
              {logging === p.dayId
                ? <LogForm workout={p.workout} dayId={p.dayId} athlete={athlete} date={date} totalReps={p.totalReps} onSaved={(c) => { setLogging(null); if (c) setSaved((x) => ({ ...x, [p.dayId]: c })); }} />
                : <button className="btn primary big" type="button" onClick={() => setLogging(p.dayId)}>Log {athlete.id === me.user.id ? 'my' : `${athlete.name}'s`} result</button>}
            </WorkoutCard>
          ))}
          {data.results.length ? (
            <section>
              <h2 className="sec">Logged {isToday ? 'today' : 'this day'}</h2>
              <ul className="results">{data.results.map((r) => <ResultItem key={r.id} r={r} sex={athlete.sex} />)}</ul>
            </section>
          ) : null}
          <details className="otherlog">
            <summary>Log a different workout</summary>
            {picked ? (
              <WorkoutCard workout={picked} sex={athlete.sex}>
                <LogForm workout={picked} athlete={athlete} date={date} onSaved={() => { setPicked(null); setOther(''); }} />
                <button className="btn ghost" type="button" onClick={() => setPicked(null)}>Choose another</button>
              </WorkoutCard>
            ) : (
              <>
                <label>Find a workout<input type="search" value={other} onChange={(e) => setOther(e.target.value)} placeholder="Fran, Murph, back squat…" /></label>
                <ul className="picks">
                  {((search.data as { workouts?: { workout: Workout; times: number }[] } | undefined)?.workouts ?? []).map(({ workout, times }) => (
                    <li key={workout.id}><button type="button" onClick={() => setPicked(workout)}><b>{workoutTitle(workout)}</b><span className="small">{structureLabel(workout.structure)}{times ? ` · done ${times}×` : ''}</span></button></li>
                  ))}
                </ul>
              </>
            )}
          </details>
        </>
      )}
    </div>
  );
}
