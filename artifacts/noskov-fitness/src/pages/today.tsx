import { useState } from 'react';
import { Link, useSearch, useLocation } from 'wouter';
import { useGetToday, getGetTodayQueryKey, useSearchWorkouts, getSearchWorkoutsQueryKey } from '@workspace/api-client-react';
import { structureLabel, movementLine, workoutTitle, type Workout, type WorkoutTags } from '@workspace/fitness-core';
import { useMe, localToday, type Person } from '@/lib/session';
import { addDays, longDate } from '@/lib/dates';
import { Chips } from '@/components/Chips';
import { LogForm, rxFor } from '@/components/LogForm';
import { ResultItem, type ResultRow } from '@/components/ResultItem';
import { PageStatus } from '@/lib/api';

type Planned = { dayId: string; status: string; workout: Workout; tags: WorkoutTags };
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
      <div className="small">{structureLabel(workout.structure)}</div>
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
              {p.status === 'proposed' ? <p className="small">Proposed by the engine; the coach hasn't approved it yet.</p> : null}
              {logging === p.dayId
                ? <LogForm workout={p.workout} dayId={p.dayId} athlete={athlete} date={date} onSaved={() => setLogging(null)} />
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
