/**
 * Derived workout tags: the color-coded day header (modality pattern, load, time, volume, priority) is computed,
 * never typed, so the analysis map is always consistent. A coach override on Workout.tags wins.
 *
 * Thresholds are policy defaults (from the NF-WODs sheet: short < 4 min, medium 4–12, long 12–20, endurance 20+);
 * they live here in one place so they can become editable settings.
 */
import { FAMILY_BY_ID, type Modality } from '../movements/catalog';
import { keyOf } from '../movements/resolver';
import type { Workout, WorkoutTags, TimeDomain, MovementPrescription } from '../model/types';

export const TAG_POLICY = {
  timeDomainMin: { short: 4, medium: 12, long: 20 }, // upper bounds; above long = endurance
  volumeReps: { low: 50, medium: 150 }, // upper bounds of total reps; above = high
  metersPerRep: 10, // a 400 m run counts like 40 reps for volume
  caloriesPerRep: 1,
  /** Load bands for a male athlete, in lb; female bands are scaled by femaleRatio. */
  loadLb: {
    barbell: { light: 95, medium: 155 },
    dumbbell: { light: 35, medium: 50 }, // per dumbbell
    kettlebell: { light: 35, medium: 53 },
    other: { light: 20, medium: 45 }, // med ball, sandbag, plate
  },
  femaleRatio: 0.7,
};

const loadRank = { bodyweight: 0, light: 1, medium: 2, heavy: 3 } as const;

export function distinctMovements(w: Workout): MovementPrescription[] {
  const seen = new Set<string>();
  return w.movements.filter((m) => { const k = keyOf(m.movement); if (seen.has(k)) return false; seen.add(k); return true; });
}

export function modalityPattern(w: Workout): Modality[] {
  return distinctMovements(w).map((m) => FAMILY_BY_ID[m.movement.family]?.modality ?? 'G');
}

function rounds(w: Workout): number {
  const s = w.structure;
  if (s.kind === 'for-time' || s.kind === 'intervals') return s.rounds ?? 1;
  if (s.kind === 'tabata') return s.rounds ?? 1;
  return 1;
}

/** Total work in rep-equivalents for one pass through the prescription (rounds and schemes applied). */
export function totalReps(w: Workout, amrapRounds?: number): number {
  const s = w.structure;
  const scheme = 'scheme' in s && s.scheme ? s.scheme.reduce((a, b) => a + b, 0) : undefined;
  let perPass = 0;
  for (const m of w.movements) {
    if (m.distanceM) perPass += m.distanceM / TAG_POLICY.metersPerRep;
    else if (m.calories) perPass += m.calories / TAG_POLICY.caloriesPerRep;
    else if (m.reps) perPass += m.reps;
    else if (scheme) perPass += scheme;
  }
  if (s.kind === 'amrap') return perPass * (amrapRounds ?? 1);
  if (s.kind === 'sets') return scheme ?? perPass;
  return perPass * rounds(w);
}

export function loadBand(w: Workout, sex: 'male' | 'female' = 'male'): WorkoutTags['load'] {
  if (w.structure.kind === 'sets' || (w.structure.kind === 'max' && w.structure.what === 'load')) return 'heavy';
  let best: WorkoutTags['load'] = 'bodyweight';
  const k = sex === 'female' ? TAG_POLICY.femaleRatio : 1;
  for (const m of w.movements) {
    const lb = (sex === 'female' ? m.load?.female ?? m.load?.male : m.load?.male ?? m.load?.female);
    if (m.load?.percentOf) {
      const b: WorkoutTags['load'] = m.load.percentOf.pct >= 80 ? 'heavy' : 'medium';
      if (loadRank[b] > loadRank[best]) best = b;
      continue;
    }
    if (!lb) continue;
    const lbs = m.load?.unit === 'kg' ? lb * 2.20462 : lb;
    const imp = m.movement.implement ?? FAMILY_BY_ID[m.movement.family]?.implements[0];
    const band = imp === 'barbell' ? TAG_POLICY.loadLb.barbell : imp === 'dumbbell' ? TAG_POLICY.loadLb.dumbbell : imp === 'kettlebell' ? TAG_POLICY.loadLb.kettlebell : TAG_POLICY.loadLb.other;
    const b: WorkoutTags['load'] = lbs <= band.light * k ? 'light' : lbs <= band.medium * k ? 'medium' : 'heavy';
    if (loadRank[b] > loadRank[best]) best = b;
  }
  return best;
}

export function timeDomainOf(minutes: number | undefined): TimeDomain | undefined {
  if (minutes === undefined) return undefined;
  const t = TAG_POLICY.timeDomainMin;
  return minutes < t.short ? 'short' : minutes <= t.medium ? 'medium' : minutes <= t.long ? 'long' : 'endurance';
}

/** Minutes of work: fixed by the structure for time-priority workouts, otherwise from a result or the coach's target. */
export function workMinutes(w: Workout, resultSec?: number): number | undefined {
  const s = w.structure;
  if (s.kind === 'amrap') return s.minutes;
  if (s.kind === 'emom') return s.minutes;
  if (s.kind === 'tabata') return 4 * (s.rounds ?? 1);
  if (s.kind === 'skill-practice') return s.minutes;
  if (s.kind === 'max' && s.minutes) return s.minutes;
  if (resultSec) return resultSec / 60;
  if (w.targetMinutes) return (w.targetMinutes[0] + w.targetMinutes[1]) / 2;
  if (s.kind === 'for-time' && s.capMin) return s.capMin;
  return undefined;
}

export function deriveTags(w: Workout, opts: { resultSec?: number; amrapRounds?: number; sex?: 'male' | 'female' } = {}): WorkoutTags {
  const s = w.structure;
  const pattern = modalityPattern(w);
  const minutes = workMinutes(w, opts.resultSec);
  const reps = totalReps(w, opts.amrapRounds);
  const v = TAG_POLICY.volumeReps;
  const strength = s.kind === 'sets' || (s.kind === 'max' && s.what === 'load');
  const priority: WorkoutTags['priority'] = ['amrap', 'emom', 'tabata'].includes(s.kind) || (s.kind === 'intervals' && s.scored !== 'time') || (s.kind === 'max' && !!s.minutes) ? 'time' : 'task';
  const td = strength ? 'short' : timeDomainOf(minutes) ?? 'medium';
  const pathway: WorkoutTags['pathway'] = strength || (minutes !== undefined && minutes < 2) ? 'phosphagen' : td === 'short' || td === 'medium' ? 'glycolytic' : 'oxidative';
  const computed: WorkoutTags = {
    modalityPattern: pattern,
    movementCount: pattern.length,
    load: loadBand(w, opts.sex),
    volume: reps < v.low ? 'low' : reps <= v.medium ? 'medium' : 'high',
    timeDomain: td,
    priority,
    pathway,
  };
  return { ...computed, ...w.tags };
}

/** Total reps for a for-time workout when every movement is counted in reps ("Time capped: ___ / 180 reps"). */
export function prescribedReps(w: Workout): number | undefined {
  if (w.structure.kind !== 'for-time') return undefined;
  const s = w.structure;
  const scheme = s.scheme ? s.scheme.reduce((a, b) => a + b, 0) : undefined;
  let total = 0;
  for (const m of w.movements) {
    if (m.distanceM || m.calories || m.seconds) return undefined;
    if (m.reps) total += m.reps;
    else if (scheme) total += scheme;
    else return undefined;
  }
  return total * (s.rounds ?? 1);
}
