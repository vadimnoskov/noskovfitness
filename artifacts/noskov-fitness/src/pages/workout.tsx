import { useState } from 'react';
import { useParams, useSearch } from 'wouter';
import { useGetWorkoutDetail, getGetWorkoutDetailQueryKey } from '@workspace/api-client-react';
import type { Workout, WorkoutTags } from '@workspace/fitness-core';
import { useMe, localToday } from '@/lib/session';
import { WorkoutCard } from '@/pages/today';
import { LogForm } from '@/components/LogForm';
import { ResultItem, type ResultRow } from '@/components/ResultItem';
import { PageStatus } from '@/lib/api';

/** Best = fastest completed time, most rounds+reps, heaviest load, most reps; Rx results first. */
function bestId(rows: ResultRow[], type: string): string | undefined {
  const pool = rows.filter((r) => r.rx && r.completed).length ? rows.filter((r) => r.rx && r.completed) : rows;
  const s = (r: ResultRow) => r.score as { timeSec?: number; rounds?: number; reps?: number; loads?: number[]; distanceM?: number };
  const v = (r: ResultRow) => type === 'time' ? -(s(r).timeSec ?? Infinity) : type === 'rounds-reps' ? (s(r).rounds ?? 0) * 1000 + (s(r).reps ?? 0)
    : type === 'load' ? Math.max(0, ...(s(r).loads ?? [0])) : (s(r).reps ?? s(r).distanceM ?? 0);
  return rows.length > 1 && pool.length ? pool.reduce((b, r) => (v(r) > v(b) ? r : b)).id : undefined;
}

export default function WorkoutPage() {
  const me = useMe();
  const { id } = useParams<{ id: string }>();
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { a?: string };
  const athleteId = sp.a ?? me?.user.id ?? '';
  const athlete = me?.logFor.find((p) => p.id === athleteId) ?? me?.user;
  const params = { workoutId: id ?? '', ...(athleteId !== me?.user.id ? { athleteId } : {}) };
  const q = useGetWorkoutDetail(params, { query: { enabled: !!me && !!id, queryKey: getGetWorkoutDetailQueryKey(params) } });
  const [logging, setLogging] = useState(false);
  if (!me || !athlete) return <p className="empty">Loading…</p>;
  const data = q.data as { workout: Workout; tags: WorkoutTags; results: ResultRow[] } | undefined;
  if (!data) return <div className="phone-page"><PageStatus q={q} /></div>;
  const best = bestId(data.results, data.workout.scoreType);
  return (
    <div className="phone-page">
      <WorkoutCard workout={data.workout} tags={data.tags} sex={athlete.sex}>
        {logging ? <LogForm workout={data.workout} athlete={athlete} date={localToday()} onSaved={() => setLogging(false)} />
          : <button className="btn primary big" type="button" onClick={() => setLogging(true)}>Log this workout today</button>}
      </WorkoutCard>
      <h2 className="sec">{athlete.id === me.user.id ? 'My results' : `${athlete.name}'s results`} ({data.results.length})</h2>
      {data.results.length === 0 ? <p className="empty">Not done yet.</p> : null}
      <ul className="results">{data.results.map((r) => <ResultItem key={r.id} r={r} sex={athlete.sex} showWorkout={false} best={r.id === best} />)}</ul>
    </div>
  );
}
