import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLogResult } from '@workspace/api-client-react';
import { nameOf, keyOf, type Workout, type MovementPrescription } from '@workspace/fitness-core';
import type { Person } from '@/lib/session';

const FEMALE_RATIO = 0.7;
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

/** The Rx weight for this person, or an estimate (marked) when only the other sex's Rx is written. */
export function rxFor(m: MovementPrescription, sex: 'male' | 'female'): { value: number; unit: 'lb' | 'kg'; estimated: boolean } | undefined {
  const l = m.load;
  if (!l || l.percentOf) return undefined;
  const mine = sex === 'female' ? l.female : l.male;
  if (mine !== undefined) return { value: mine, unit: l.unit, estimated: false };
  const other = sex === 'female' ? l.male : l.female;
  if (other === undefined) return undefined;
  const v = sex === 'female' ? other * FEMALE_RATIO : other / FEMALE_RATIO;
  return { value: l.unit === 'kg' ? Math.round(v) : round5(v), unit: l.unit, estimated: true };
}

const n = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === '' ? undefined : Number(v));

export function LogForm({ workout, dayId, athlete, date, onSaved }: { workout: Workout; dayId?: string; athlete: Person; date: string; onSaved?: () => void }) {
  const qc = useQueryClient();
  const m = useLogResult();
  const [rx, setRx] = useState(true);
  const [capped, setCapped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const type = workout.scoreType;
  const sets = workout.structure.kind === 'sets' ? workout.structure.scheme : [undefined];
  // One weight box per distinct movement (a 21-15-9 lists the same movement in every round); the value applies to all of them.
  const weighted: { mv: MovementPrescription; i: number; rx: ReturnType<typeof rxFor>; all: number[] }[] = [];
  workout.movements.forEach((mv, i) => {
    const r = rxFor(mv, athlete.sex);
    if (!r) return;
    const same = weighted.find((w) => keyOf(w.mv.movement) === keyOf(mv.movement) && w.rx!.value === r.value && w.rx!.unit === r.unit);
    if (same) same.all.push(i); else weighted.push({ mv, i, rx: r, all: [i] });
  });
  const canCap = type === 'time';

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const min = n(f.get('min')) ?? 0, sec = n(f.get('sec')) ?? 0;
    const score = {
      timeSec: min * 60 + sec || undefined,
      rounds: n(f.get('rounds')), reps: n(f.get('reps')),
      loads: sets.map((_, k) => n(f.get(`set${k}`))).filter((x): x is number => x !== undefined),
      distanceM: n(f.get('distance')), calories: n(f.get('calories')),
    };
    const loads = weighted.flatMap(({ i, rx: r, all }) => all.map((index) => ({ index, value: n(f.get(`load${i}`)) ?? r!.value, unit: r!.unit })));
    m.mutate({ data: {
      athleteId: athlete.id, date, workoutId: workout.id, ...(dayId ? { dayId } : {}),
      asPrescribed: rx, completed: !capped, score, loads,
      scaling: rx ? undefined : String(f.get('scaling') ?? ''), notes: String(f.get('notes') ?? ''),
    } }, {
      onSuccess: () => { qc.invalidateQueries(); onSaved?.(); },
      onError: (err) => setError((err as { data?: { error?: string } }).data?.error ?? 'Could not save. Check your connection and try again.'),
    });
  };

  return (
    <form className="log" onSubmit={onSubmit} aria-busy={m.isPending}>
      <div className="seg" role="group" aria-label="Rx or scaled">
        <button type="button" aria-pressed={rx} onClick={() => setRx(true)}>Rx</button>
        <button type="button" aria-pressed={!rx} onClick={() => setRx(false)}>Scaled</button>
      </div>

      {type === 'time' ? (
        <>
          {!capped ? (
            <div className="row2">
              <label>Minutes<input name="min" inputMode="numeric" pattern="[0-9]*" placeholder="12" required={!capped} /></label>
              <label>Seconds<input name="sec" inputMode="numeric" pattern="[0-9]*" placeholder="34" /></label>
            </div>
          ) : (
            <label>Reps completed at the cap<input name="reps" inputMode="numeric" pattern="[0-9]*" required /></label>
          )}
          {canCap ? <label className="check"><input type="checkbox" checked={capped} onChange={(e) => setCapped(e.target.checked)} /> Hit the time cap (didn't finish)</label> : null}
        </>
      ) : null}
      {type === 'rounds-reps' ? (
        <div className="row2">
          <label>Rounds<input name="rounds" inputMode="numeric" pattern="[0-9]*" required /></label>
          <label>+ Reps<input name="reps" inputMode="numeric" pattern="[0-9]*" placeholder="0" /></label>
        </div>
      ) : null}
      {type === 'load' ? (
        <div className="sets">
          {sets.map((reps, k) => (
            <label key={k}>{sets.length > 1 ? `Set ${k + 1}${reps ? ` · ${reps} reps` : ''}` : 'Heaviest weight'}<span className="unit"><input name={`set${k}`} inputMode="decimal" required={k === 0} />{athlete.units}</span></label>
          ))}
        </div>
      ) : null}
      {type === 'reps' ? <label>Reps<input name="reps" inputMode="numeric" pattern="[0-9]*" required /></label> : null}
      {type === 'distance' ? <label>Distance<span className="unit"><input name="distance" inputMode="decimal" required />m</span></label> : null}
      {type === 'calories' ? <label>Calories<input name="calories" inputMode="numeric" pattern="[0-9]*" required /></label> : null}
      {type === 'none' ? <p className="small">No score for this one: saving marks it done.</p> : null}

      {weighted.length && type !== 'load' ? (
        <fieldset className="weights">
          <legend>Weights used</legend>
          {weighted.map(({ mv, i, rx: r }) => (
            <label key={i}>{nameOf(mv.movement)}{r!.estimated ? <span className="small"> (estimated Rx)</span> : null}
              <span className="unit"><input name={`load${i}`} inputMode="decimal" defaultValue={r!.value} />{r!.unit}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {!rx ? <label>What did you change?<textarea name="scaling" rows={2} placeholder="e.g. jumping pull-ups, 25 lb dumbbells" /></label> : null}
      <label>Notes<textarea name="notes" rows={2} placeholder="How it felt, splits, anything to remember" /></label>
      {error ? <p className="warn" role="alert">{error}</p> : null}
      <button className="btn primary big" type="submit" disabled={m.isPending}>{m.isPending ? 'Saving…' : 'Save result'}</button>
    </form>
  );
}
