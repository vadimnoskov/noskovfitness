/**
 * Individual Rx (Phase 7): each person's own version of a workout, built to hit the intended stimulus.
 *
 * Starting from their load-personalized version (personalize.ts), it predicts their time with their own pace (their
 * median of actual ÷ estimated time on past workouts) and, when that falls outside the workout's time domain, scales in
 * the L1 order (Scaling: "modify loads, distances, reps before changing the movement"): load first, then volume (rounds,
 * then reps), and only suggests an easier movement. Volume also follows the conditioning level (coach, 2026-11-28):
 * volume = 60% + 40% × level (0.75 → 90%, 0.5 → 80%), for reps and rounds only, never loads, and only when it cuts at least
 * 8% (a level of 0.85 or more leaves the workout as it is).
 *
 * Applied automatically; every change carries its reason, and the coach can switch a person back to the standard
 * workout for a day. Heavy days are not scaled here (their load is the person's own).
 */
import type { Workout, WorkoutTags, MovementPrescription, TimeDomain } from '../model/types';
import { estimateMinutes } from './estimate';
import { FAMILY_BY_ID } from '../movements/catalog';
import { MOVEMENT_FACTS } from '../knowledge/movements';
import { BEGINNER_RULES, beginnerMax } from './starter';
const FACTS = new Map(MOVEMENT_FACTS.map((f) => [f.key, f]));

/** Upper end of each time domain's window, in minutes (endurance uses the coach's 40-minute norm). */
export const WINDOW_MAX: Record<Exclude<TimeDomain, 'heavy'>, number> = { short: 5, medium: 12, long: 20, endurance: 40 };
const WINDOW_MIN: Record<Exclude<TimeDomain, 'heavy'>, number> = { short: 1, medium: 4, long: 12, endurance: 20 };
export const rampFactor = (level: number | null | undefined) => (level === null || level === undefined || level >= 1 ? 1 : Math.max(0.6, 0.6 + 0.4 * Math.max(0, level)));

export interface RxChange { kind: 'load' | 'volume' | 'ramp' | 'teen' | 'beginner'; text: string }
export interface IndividualRx {
  workout: Workout;
  changes: RxChange[];
  /** Predicted minutes on their version before and after scaling (for-time only). */
  predicted?: { before: number; after: number; window: [number, number] };
  /** Easier movements to consider when scaling the volume could not bring it into the window. */
  suggestions: string[];
}

/** A person's pace against the estimate: the median of actual ÷ estimated minutes on their finished for-time results. */
export function paceFactor(results: { performed: Workout; score: { timeSec?: number }; completed: boolean }[]): { factor: number; n: number } {
  const ratios: number[] = [];
  for (const r of results) {
    if (r.performed.structure.kind !== 'for-time' || !r.completed || !r.score.timeSec) continue;
    const est = estimateMinutes(r.performed);
    if (est && est > 0.5) ratios.push(r.score.timeSec / 60 / est);
  }
  if (ratios.length < 5) return { factor: 1, n: ratios.length };
  const s = ratios.sort((a, b) => a - b);
  return { factor: Math.min(3, Math.max(0.5, s[Math.floor(s.length / 2)]!)), n: ratios.length };
}

/** Rounded rep counts: whole numbers under 20, then fives (a movement's 50 → 40, not 48). */
const niceReps = (n: number) => (n <= 1 ? 1 : n < 20 ? Math.max(1, Math.round(n)) : Math.round(n / 5) * 5);
/** Rep-scheme numbers keep single steps (21-15-9 → 17-12-7). */
const schemeReps = (n: number) => Math.max(1, Math.round(n));
const niceDist = (m: number) => (m >= 1000 ? Math.round(m / 100) * 100 : Math.round(m / 50) * 50 || 50);

/** Scale a workout's volume by f (0.5–1): rounds first, else the rep scheme, else each movement's reps/distance/calories. */
export function scaleVolume(w: Workout, f: number): { workout: Workout; text: string } | undefined {
  if (f >= 0.97) return undefined;
  const s = w.structure;
  // Rounds first, but only when dropping whole rounds lands close to the cut needed (5 rounds at 0.89 would be 4 = 0.8,
  // far more than needed); otherwise the reps and distances are trimmed instead.
  if (s.kind === 'for-time' && s.rounds && s.rounds > 2) {
    const r = Math.max(1, Math.round(s.rounds * f));
    if (r < s.rounds && r / s.rounds >= f - 0.05) return { workout: { ...w, structure: { ...s, rounds: r } }, text: `${s.rounds} rounds → ${r}` };
  }
  if ((s.kind === 'amrap' || s.kind === 'emom') && s.minutes > 5) {
    const m = Math.max(5, Math.round(s.minutes * f));
    if (m < s.minutes) return { workout: { ...w, structure: { ...s, minutes: m } }, text: `${s.minutes} min → ${m}` };
  }
  if (s.kind === 'intervals' && s.rounds > 2) {
    const r = Math.max(2, Math.round(s.rounds * f));
    if (r < s.rounds) return { workout: { ...w, structure: { ...s, rounds: r } }, text: `${s.rounds} intervals → ${r}` };
  }
  if ('scheme' in s && s.scheme && s.kind === 'for-time') {
    const scheme = s.scheme.map((n) => schemeReps(n * f));
    if (scheme.join() !== s.scheme.join()) return { workout: { ...w, structure: { ...s, scheme } }, text: `${s.scheme.join('-')} → ${scheme.join('-')}` };
  }
  const parts: string[] = [];
  const movements = w.movements.map((m): MovementPrescription => {
    if (m.reps && m.reps > 1) { const r = niceReps(m.reps * f); if (r < m.reps) { parts.push(`${FAMILY_BY_ID[m.movement.family]?.name ?? m.movement.family} ${m.reps} → ${r}`); return { ...m, reps: r }; } }
    if (m.distanceM && m.distanceM > 100) { const d = niceDist(m.distanceM * f); if (d < m.distanceM) { parts.push(`${FAMILY_BY_ID[m.movement.family]?.name ?? m.movement.family} ${m.distanceM} m → ${d} m`); return { ...m, distanceM: d }; } }
    if (m.calories && m.calories > 5) { const c = Math.round(m.calories * f); if (c < m.calories) { parts.push(`${FAMILY_BY_ID[m.movement.family]?.name ?? m.movement.family} ${m.calories} cal → ${c}`); return { ...m, calories: c }; } }
    return m;
  });
  return parts.length ? { workout: { ...w, movements }, text: parts.join(', ') } : undefined;
}

/** Lower the loads of a version by f, rounded to 5 lb / 2.5 kg (not below half the standard). */
function scaleLoads(w: Workout, f: number): { workout: Workout; text: string } | undefined {
  const parts: string[] = [];
  const movements = w.movements.map((m): MovementPrescription => {
    const l = m.load;
    if (!l || l.percentOf) return m;
    const step = l.unit === 'kg' ? 2.5 : 5;
    const down = (v?: number) => (v === undefined ? v : Math.max(step, Math.round((v * f) / step) * step));
    const male = down(l.male), female = down(l.female);
    if (male === l.male && female === l.female) return m;
    parts.push(`${FAMILY_BY_ID[m.movement.family]?.name ?? m.movement.family} ${l.male ?? l.female} → ${male ?? female} ${l.unit}`);
    return { ...m, load: { ...l, male, female } };
  });
  return parts.length ? { workout: { ...w, movements }, text: parts.join(', ') } : undefined;
}

/**
 * The person's Individual Rx for a workout. `version` = their load-personalized workout; `tags` = the standard workout's
 * tags (its intended time domain); `pace` = paceFactor; `level` = conditioning level (null = unknown).
 */
/** A heavy day of single-rep attempts: a 1-rep max, or sets of singles. */
export function isSingleRepMax(w: Workout): boolean {
  const s = w.structure;
  if (s.kind === 'sets') return s.scheme.length > 0 && s.scheme.every((n) => n <= 1);
  if (s.kind === 'max' && s.what === 'load') {
    const m = /(\d+)\s*(?:-|\s)?\s*(?:rep max|rm\b)/i.exec(w.name ?? '');
    return !m || Number(m[1]) <= 1;
  }
  return false;
}
/** Teens (under 18): heavy 2–3s instead of single-rep maxes (Kids guide; coach, 2026-11-26). */
export const TEEN_HEAVY_SCHEME = [3, 3, 2, 2, 2];

/**
 * `beginnerDay`: day of a beginner's starter period (starter.ts), when the coach marked them new to this training:
 * half volume for the first 2 weeks (scale-beginner-half) and no single-rep max in the first 4 (heavy-beginner-reps).
 */
export function individualRx(version: Workout, tags: WorkoutTags | undefined, pace: number, level: number | null, age?: number | null, beginnerDay?: number): IndividualRx {
  const out: IndividualRx = { workout: version, changes: [], suggestions: [] };
  const td = tags?.timeDomain;
  // Teens: a single-rep max day becomes heavy 3s and 2s at the same lift, unless the coach approves a true 1RM.
  if (age !== undefined && age !== null && age < 18 && (td === 'heavy' || version.structure.kind === 'max' || version.structure.kind === 'sets') && isSingleRepMax(version)) {
    out.workout = { ...version, name: version.name ? `${version.name} (teen: heavy 3-3-2-2-2)` : undefined, structure: { kind: 'sets', scheme: TEEN_HEAVY_SCHEME }, scoreType: 'load' };
    out.changes.push({ kind: 'teen', text: `single-rep max → work up to heavy sets of ${TEEN_HEAVY_SCHEME.join('-')}, no single max attempt: teens do heavy 2–3s, and a true 1RM needs the coach's approval` });
    return out;
  }
  if (beginnerDay !== undefined && beginnerDay < BEGINNER_RULES.noSingleMaxDays && isSingleRepMax(version)) {
    const b = beginnerMax(version);
    if (b) {
      out.workout = b;
      out.changes.push({ kind: 'beginner', text: 'single-rep max → 3-rep max: beginners practise mechanics with more reps in their first month (L1, Scaling)' });
      return out;
    }
  }
  if (!td || td === 'heavy' || version.structure.kind === 'sets' || version.structure.kind === 'max') return out;
  let w = version;
  let windowF = 1;
  // 1. The stimulus window (for-time workouts, where the time is the person's).
  if (w.structure.kind === 'for-time') {
    const est = estimateMinutes(w);
    if (est) {
      const max = WINDOW_MAX[td], min = WINDOW_MIN[td];
      const before = Math.round(est * pace * 10) / 10;
      let after = before;
      if (before > max * 1.1) {
        // Load first: up to 15% lighter on loaded movements (only counts where the load slows the reps).
        const lighter = scaleLoads(w, 0.85);
        if (lighter) {
          const e2 = (estimateMinutes(lighter.workout) ?? est) * pace;
          // Only worth it when lighter loads close at least half of the gap; otherwise the reps go, not the Rx weights.
          if (after - e2 >= (after - max) / 2) { w = lighter.workout; after = Math.round(e2 * 10) / 10; out.changes.push({ kind: 'load', text: `${lighter.text}: lighter so the reps keep moving (predicted ${before} min, window ${min}–${max})` }); }
        }
        if (after > max * 1.1) {
          const f = Math.max(0.5, max / after);
          const v = scaleVolume(w, f);
          if (v) {
            w = v.workout;
            const e3 = (estimateMinutes(w) ?? est) * pace;
            out.changes.push({ kind: 'volume', text: `${v.text}: predicted ${after} min for you, the window is ${min}–${max}` });
            windowF = f;
            after = Math.round(e3 * 10) / 10;
          }
        }
        if (after > max * 1.25) {
          for (const m of w.movements) {
            const f = FACTS.get(m.movement.family);
            if (f?.easier.length) out.suggestions.push(`${f.name}: ${f.easier.slice(0, 3).join(', ')}`);
          }
          if (!out.suggestions.length) out.suggestions.push('still longer than the window: consider an easier version of the hardest movement');
        }
      }
      out.predicted = { before, after, window: [min, max] };
    }
  }
  // 2. The conditioning ramp: volume = 60% + 40% × level.
  // The larger of the two reductions applies, not both: only the part beyond the window scaling.
  const half = beginnerDay !== undefined && beginnerDay < BEGINNER_RULES.halfVolumeDays;
  const r = half ? 0.5 : rampFactor(level);
  // Small ramps (under 8% less) are not worth changing a workout for.
  if (r <= 0.92 && r < windowF - 0.03) {
    const v = scaleVolume(w, r / windowF);
    if (v) {
      w = v.workout;
      out.changes.push(half ? { kind: 'beginner', text: `${v.text}: half volume in a beginner's first 2 weeks (L1, Scaling, p. 78; day ${beginnerDay! + 1})` }
        : { kind: 'ramp', text: `${v.text}: conditioning level ${level!.toFixed(2)} → ${Math.round(r * 100)}% volume` });
    }
  }
  out.workout = w;
  return out;
}
