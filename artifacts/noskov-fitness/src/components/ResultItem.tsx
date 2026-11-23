import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useDeleteResult } from '@workspace/api-client-react';
import { scoreText, workoutTitle, nameOf, type Workout } from '@workspace/fitness-core';
import { longDate } from '@/lib/dates';

export interface ResultRow {
  id: string; date: string; score: Record<string, unknown>; rx: boolean; completed: boolean; notes: string | null;
  editable: boolean; workout: Workout; performed: Workout; source: string;
}

export function ResultItem({ r, sex, showWorkout = true, best = false }: { r: ResultRow; sex: 'male' | 'female'; showWorkout?: boolean; best?: boolean }) {
  const qc = useQueryClient();
  const del = useDeleteResult({ mutation: { onSuccess: () => qc.invalidateQueries() } });
  // Distinct movement + weight (a 21-15-9 repeats the same movement every round).
  const loads = [...new Set(r.performed.movements.filter((m) => m.load && !m.load.percentOf).map((m) => {
    const v = sex === 'female' ? m.load!.female ?? m.load!.male : m.load!.male ?? m.load!.female;
    return v === undefined ? '' : `${nameOf(m.movement)} ${v} ${m.load!.unit}`;
  }).filter(Boolean))];
  return (
    <li className="result">
      <div className="rtop">
        <span className="rdate">{longDate(r.date)}</span>
        <span className={`tag ${r.rx ? 'rx' : 'sc'}`}>{r.rx ? 'Rx' : 'Scaled'}</span>
        {!r.completed ? <span className="tag">Capped</span> : null}
        {best ? <span className="tag best">Best</span> : null}
      </div>
      {showWorkout ? <Link className="rwork" href={`/workout/${r.workout.id}`}>{workoutTitle(r.workout)}</Link> : null}
      <div className="rscore">{scoreText(r as never)}</div>
      {loads.length && r.workout.scoreType !== 'load' ? <div className="small">{loads.join(' · ')}</div> : null}
      {r.notes ? <div className="rnotes">{r.notes}</div> : null}
      {r.editable ? (
        <button className="btn ghost sm" type="button" disabled={del.isPending}
          onClick={() => { if (window.confirm('Delete this result?')) del.mutate({ resultId: r.id }); }}>Delete</button>
      ) : null}
    </li>
  );
}
