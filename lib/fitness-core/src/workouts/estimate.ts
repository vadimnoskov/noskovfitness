/**
 * How long a workout takes a fit, experienced athlete at the standard Rx: an estimate for workouts nobody has logged,
 * so the engine can tell a 4-minute sprint from a 30-minute chipper. Fixed-time formats (AMRAP, EMOM, Tabata) are
 * exact; strength sets are not estimated (they are "short" by definition).
 *
 * The per-rep and pace numbers are deliberately simple; ESTIMATE_SCALE is calibrated on our own logged results.
 */
import type { Workout, MovementPrescription } from '../model/types';
import { FAMILY_BY_ID } from '../movements/catalog';

/** Seconds per rep at Rx by movement family (unloaded families at bodyweight). */
const SEC_PER_REP: Record<string, number> = {
  'air-squat': 1.3, 'push-up': 1.6, 'sit-up': 1.7, 'pull-up': 1.8, burpee: 3.6, 'box-jump': 2.4, 'jumping-jack': 0.7, 'mountain-climber': 0.6,
  'wall-ball': 2.6, 'kb-swing': 1.9, thruster: 2.8, deadlift: 2.6, clean: 3.6, 'clean-and-jerk': 5.0, snatch: 4.2, 'push-press': 2.2,
  'shoulder-to-overhead': 2.4, press: 2.6, jerk: 3.2, 'front-squat': 2.8, 'back-squat': 2.8, 'overhead-squat': 3.2, 'goblet-squat': 2.4,
  'sdhp': 2.2, cluster: 4.0, 'devil-press': 5.0, 'man-maker': 7.0, tgu: 18, 'over-shoulder': 4.5, 'ground-to-overhead': 3.5,
  'toes-to-bar': 2.0, 'knees-to-elbows': 2.0, 'knee-raise': 1.6, 'v-up': 1.6, hollow: 1.2, 'hip-extension': 1.8, 'russian-twist': 0.8,
  'muscle-up': 4.5, hspu: 2.8, dip: 1.8, 'rope-climb': 20, 'ring-row': 1.6, 'bent-row': 2.2, 'bar-pullover': 2.5,
  lunge: 2.0, 'split-squat': 2.4, 'step-up': 2.2, pistol: 3.0, 'broad-jump': 3.0, 'lateral-jump': 1.0, 'jump-rope': 0.5,
  'bench-press': 2.6, 'good-morning': 2.4, 'hip-thrust': 2.4, 'snatch-balance': 4.0, 'snatch-pull': 2.6, 'clean-pull': 2.6, 'medball-throw': 2.5,
  'wall-walk': 12, 'handstand-walk': 3.0,
};
/** Seconds per meter for distance work. */
const SEC_PER_M: Record<string, number> = { run: 0.27, row: 0.23, bike: 0.11, ski: 0.25, swim: 1.1, carry: 0.6, lunge: 1.4, 'handstand-walk': 2.0, sled: 1.0, 'bear-crawl': 1.2 };
/** Seconds per calorie on machines. */
const SEC_PER_CAL: Record<string, number> = { row: 4.0, bike: 3.3, ski: 4.5 };
const TRANSITION_SEC = 4;
/**
 * Calibrated on 782 of the coach's logged Rx timed results (median actual / table estimate = 1.26).
 * With it: 74% of estimates within ×1.5 of the actual time, 89% within ×2, 66% in the same time domain.
 * Measured before the expanded-scheme fix (TAGS_VERSION 2); re-run with `pnpm --filter @workspace/fitness-db run
 * calibrate:estimate` against the real results and update both lines (and MANUAL.md 4.4) if they move.
 */
export const ESTIMATE_SCALE = 1.26;

function movementSec(m: MovementPrescription, schemeReps?: number): number {
  const f = m.movement.family;
  if (m.distanceM) return m.distanceM * (SEC_PER_M[f] ?? 0.5);
  if (m.calories) return m.calories * (SEC_PER_CAL[f] ?? 4);
  if (m.seconds && !m.reps) return m.seconds;
  const reps = m.reps ?? schemeReps ?? (FAMILY_BY_ID[f]?.modality === 'M' ? 0 : 10);
  let per = SEC_PER_REP[f] ?? (FAMILY_BY_ID[f]?.modality === 'G' ? 2.2 : 3.0);
  // Heavier than usual loads slow each rep (rough: +1% per lb above a moderate load for barbell lifts).
  const lb = m.load?.male !== undefined ? (m.load.unit === 'kg' ? m.load.male * 2.20462 : m.load.male) : undefined;
  if (lb && (m.movement.implement ?? FAMILY_BY_ID[f]?.implements[0]) === 'barbell') per *= 1 + Math.max(0, lb - 135) / 100;
  return reps * per + (m.seconds ?? 0);
}

/**
 * Estimated minutes of work, or undefined when it doesn't apply (strength sets, maxes, skill practice).
 * `scale` is for calibration only (pass 1 to get the raw table estimate).
 */
export function estimateMinutes(w: Workout, scale = ESTIMATE_SCALE): number | undefined {
  const s = w.structure;
  if (s.kind === 'amrap' || s.kind === 'emom' || s.kind === 'skill-practice') return s.minutes || undefined;
  if (s.kind === 'tabata') return 4 * (s.rounds ?? 1);
  if (s.kind === 'sets' || s.kind === 'max') return undefined;
  if (!w.movements.length) return undefined;
  const scheme = 'scheme' in s && s.scheme ? s.scheme : undefined;
  let pass = 0;
  // A scheme (21-15-9 Fran) gives the reps of movements that have none. When every movement has its own reps the list
  // is already the full sequence (imports often expand "10-9-8…" into one entry per round), so the scheme is ignored.
  if (scheme && w.movements.some((m) => !m.reps && !m.distanceM && !m.calories && !m.seconds)) {
    for (const n of scheme) for (const m of w.movements) pass += movementSec(m, m.reps ? undefined : n) + TRANSITION_SEC;
  } else {
    for (const m of w.movements) pass += movementSec(m) + TRANSITION_SEC;
  }
  const rounds = s.kind === 'for-time' || s.kind === 'intervals' ? s.rounds ?? 1 : 1;
  let sec = pass * rounds;
  // Fatigue: longer efforts slow down (about +10% per doubling past 5 minutes).
  if (sec > 300) sec *= 1 + 0.1 * Math.log2(sec / 300);
  if (s.kind === 'intervals') sec += (s.restSec ?? 0) * Math.max(0, rounds - 1);
  let min = (sec * scale) / 60;
  if (s.kind === 'for-time' && s.capMin) min = Math.min(min, s.capMin);
  return Math.round(min * 10) / 10;
}
