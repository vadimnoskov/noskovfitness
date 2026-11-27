/**
 * The programming engine. "Varied is not random": for each open training day it looks at what the last weeks
 * (done + already planned) contain, compares that mix to the coach's targets, and ranks candidate workouts by how
 * much they close the gaps. Hard rules filter first. Deterministic: same inputs → same plan.
 * It only proposes; the coach approves or edits.
 */
import type { EquipmentProfile, WorkoutTags, Workout } from '../model/types';
import { keyOf } from '../movements/resolver';
import type { ProgrammingPolicy } from './policy';
import { checkEquipment } from './equipment';

export interface Candidate {
  id: string;
  workout: Workout;
  tags: WorkoutTags;
  benchmark?: { category: string; retestEveryDays: number; label?: string } | null;
  /** Typical minutes (median result or structure); undefined when unknown. */
  minutes?: number;
  /** Coach exception: may repeat every N days (until a date), overriding the general no-repeat rule. */
  repeat?: { everyDays: number; until?: string } | null;
}

/** A coach-set repeat that is active on this date and due (never done, or at least everyDays since last time). */
export function repeatDue(c: Candidate, date: string, last: string | undefined): boolean {
  if (!c.repeat || (c.repeat.until && date > c.repeat.until)) return false;
  return !last || days(last, date) >= c.repeat.everyDays;
}

/** A day already in the picture: done in history or planned. */
export interface PastDay { date: string; workoutIds: string[]; tags: WorkoutTags[]; movementKeys: string[]; heavy: boolean; benchmarkCount: number; liftTestCount?: number }

export interface ScoreBreakdown { variety: number; freshness: number; weakness: number; benchmark: number; penalty: number; total: number; notes: string[] }
export interface Proposal { date: string; candidateId: string; score: ScoreBreakdown; alternatives: { candidateId: string; score: ScoreBreakdown }[]; warnings: string[] }

export interface PlanInput {
  dates: string[];
  history: PastDay[];
  candidates: Candidate[];
  policy: ProgrammingPolicy;
  equipmentFor: (date: string) => EquipmentProfile;
  /** Last date each workout / movement was done (history + plan). */
  lastWorkoutDate: Map<string, string>;
  lastMovementDate: Map<string, string>;
  /** 0..1 per movement family: higher = group is weaker / less exposed there. Empty until fitness profiles exist. */
  weakness?: Map<string, number>;
  alternatives?: number;
  /** Last date each lift was tested, any rep max ("Back Squat" → date). Filled by plan() from lastWorkoutDate when absent. */
  lastLiftTest?: Map<string, string>;
}

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
/** A heavy lifting day is decided by the workout's structure (sets of 1–5, a max), not by the weight on the bar. */
export const isHeavyDay = (t: WorkoutTags) => t.timeDomain === 'heavy';
const isLiftTest = (c: Pick<Candidate, 'benchmark'>) => c.benchmark?.category === 'lift';
/** "Back Squat 1RM" and "Back Squat 3RM" test the same lift. */
export const liftOf = (c: Pick<Candidate, 'benchmark' | 'id'>) => (c.benchmark?.label ?? c.id).replace(/\s+\d+RM$/i, '');

/** Days since this candidate's benchmark was last tested (lifts: any rep max of the same lift), or undefined if never. */
function lastTested(c: Candidate, input: PlanInput): string | undefined {
  return isLiftTest(c) ? input.lastLiftTest?.get(liftOf(c)) ?? input.lastWorkoutDate.get(c.id) : input.lastWorkoutDate.get(c.id);
}
const benchmarkDue = (c: Candidate, date: string, input: PlanInput) => {
  if (!c.benchmark) return false;
  const l = lastTested(c, input);
  return !l || days(l, date) >= (c.benchmark.retestEveryDays ?? 120);
};

type Conflict = 'heavy' | 'movement';
/** Back-to-back conflicts between a candidate and a neighbouring day (rules that are avoided, but allowed rarely). */
function conflictsWith(c: Candidate, nb: PastDay, rules: ProgrammingPolicy['rules']): Conflict[] {
  const out: Conflict[] = [];
  if (rules.noConsecutiveHeavyDays && nb.heavy && isHeavyDay(c.tags)) out.push('heavy');
  if (rules.noSameMovementConsecutiveDays) {
    const fams = new Set(nb.movementKeys.map(familyOf));
    if (candidateMovementKeys(c).some((k) => fams.has(familyOf(k)))) out.push('movement');
  }
  return out;
}
/** Was this kind of back-to-back exception already used within its window (consecutive days that conflict)? */
function exceptionUsedRecently(window: PastDay[], date: string, rules: ProgrammingPolicy['rules'], kind: Conflict): boolean {
  const span = kind === 'heavy' ? rules.heavyExceptionDays ?? 28 : rules.movementExceptionDays ?? 28;
  const recent = window.filter((d) => days(d.date, date) <= span).sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < recent.length; i++) {
    const a = recent[i - 1]!, b = recent[i]!;
    if (days(a.date, b.date) !== 1) continue;
    if (kind === 'heavy' && a.heavy && b.heavy) return true;
    if (kind === 'movement') {
      const fa = new Set(a.movementKeys.map(familyOf));
      if (b.movementKeys.some((k) => fa.has(familyOf(k)))) return true;
    }
  }
  return false;
}
const CONFLICT_NOTE: Record<Conflict, string> = { heavy: 'heavy two days in a row', movement: 'same movement as a neighbouring day' };
const mcBucket = (n: number) => (n <= 1 ? '1' : n <= 3 ? '2-3' : '4+') as '1' | '2-3' | '4+';

export function candidateMovementKeys(c: Candidate): string[] {
  return [...new Set(c.workout.movements.map((m) => keyOf(m.movement)))];
}
const familyOf = (key: string) => key.split('|')[0]!;

/** Shares (0..100) of each bucket in the window. */
function windowShares(window: PastDay[]) {
  const t = window.flatMap((d) => d.tags);
  const n = t.length || 1;
  const share = <K extends string>(f: (x: WorkoutTags) => K) => { const m = new Map<K, number>(); for (const x of t) m.set(f(x), (m.get(f(x)) ?? 0) + 100 / n); return m; };
  const mods = t.flatMap((x) => x.modalityPattern);
  const modShare = new Map<string, number>(); for (const m of mods) modShare.set(m, (modShare.get(m) ?? 0) + 100 / (mods.length || 1));
  return { movementCount: share((x) => mcBucket(x.movementCount)), timeDomain: share((x) => x.timeDomain), priority: share((x) => x.priority), load: share((x) => x.load), modality: modShare, n: t.length };
}

export function score(c: Candidate, date: string, input: PlanInput, window: PastDay[], yesterday?: PastDay, tomorrow?: PastDay): ScoreBreakdown {
  const { policy } = input;
  const notes: string[] = [];
  const sh = windowShares(window);
  // Variety: how far below target the candidate's buckets are (positive gap = needed).
  const gap = (target: number, actual = 0) => (target - actual) / 100;
  const parts = [
    gap(policy.targets.movementCount[mcBucket(c.tags.movementCount)], sh.movementCount.get(mcBucket(c.tags.movementCount))),
    gap(policy.targets.timeDomain[c.tags.timeDomain], sh.timeDomain.get(c.tags.timeDomain)),
    gap(policy.targets.priority[c.tags.priority], sh.priority.get(c.tags.priority)),
    gap(policy.targets.load[c.tags.load], sh.load.get(c.tags.load)),
  ];
  const mp = c.tags.modalityPattern;
  parts.push(mp.reduce((a, m) => a + gap(policy.targets.modality[m], sh.modality.get(m)), 0) / (mp.length || 1));
  const variety = Math.max(0, Math.min(1, 0.5 + (parts.reduce((a, b) => a + b, 0) / parts.length) * 2.5));
  const labels = ['movement count', 'time domain', 'priority', 'load', 'modality'];
  parts.forEach((p, i) => { if (p > 0.08) notes.push(`fills ${labels[i]} gap`); });

  // Freshness: movements not used recently score higher; a workout not repeated recently too.
  const keys = candidateMovementKeys(c);
  const fresh = keys.map((k) => { const l = input.lastMovementDate.get(k); return l ? Math.min(1, days(l, date) / 30) : 1; });
  const lw = input.lastWorkoutDate.get(c.id);
  const workoutFresh = lw ? Math.min(1, days(lw, date) / 365) : 1;
  const freshness = 0.7 * (fresh.reduce((a, b) => a + b, 0) / (fresh.length || 1)) + 0.3 * workoutFresh;

  // Weakness: average group weakness of the families involved (0 until profiles exist).
  const wk = input.weakness;
  const weakness = wk && wk.size ? keys.reduce((a, k) => a + (wk.get(familyOf(k)) ?? 0), 0) / (keys.length || 1) : 0;

  // Benchmark: due (or never done) benchmarks score up to 1 by how overdue they are.
  let benchmark = 0; // also used for coach-set repeats below
  if (c.benchmark) {
    const lt = lastTested(c, input);
    const overdue = lt ? days(lt, date) / (c.benchmark.retestEveryDays ?? 120) : 2;
    if (overdue >= 1) {
      benchmark = Math.min(1, 0.5 + (overdue - 1) / 2);
      notes.push(isLiftTest(c) ? `${liftOf(c)} test due${lt ? ` (last ${lt})` : ''}` : `benchmark due${lt ? ` (last ${lt})` : ''}`);
    }
  }

  // Coach-set repeat (e.g. a short testing block): when due, it ranks like a due benchmark.
  if (repeatDue(c, date, lw)) { benchmark = Math.max(benchmark, 1); notes.push(`repeat due (every ${c.repeat!.everyDays} days)`); }

  // Soft penalties.
  let penalty = 0;
  if (yesterday) {
    const ym = new Set(yesterday.tags.flatMap((t) => [...new Set(t.modalityPattern)].sort().join('')));
    if (ym.has([...new Set(mp)].sort().join(''))) { penalty += 0.08; notes.push('same modality mix as previous day'); }
    if (yesterday.tags.some((t) => t.timeDomain === c.tags.timeDomain && t.timeDomain === 'endurance')) penalty += 0.1;
  }
  const eq = checkEquipment(c.workout, input.equipmentFor(date), input.policy.rules.groupSize);
  penalty += Math.min(0.15, eq.warnings.length * 0.04);
  // One box or one set of rings for the whole group: possible, but the stimulus is lost. Strongly avoided.
  if (eq.crowded.length) { penalty += Math.min(0.5, 0.25 * eq.crowded.length); notes.push(...eq.crowded); }
  // Back-to-back heavy days or the same movement on neighbouring days: avoided, allowed rarely (blocked() limits how often).
  for (const [nb, when] of [[yesterday, 'yesterday'], [tomorrow, 'tomorrow']] as const) {
    if (!nb) continue;
    for (const k of conflictsWith(c, nb, input.policy.rules)) { penalty += 0.3; notes.push(`${CONFLICT_NOTE[k]} (${when}): allowed occasionally`); }
  }
  // Low-power, controlled movements (Turkish get-up) are "useful occasionally" in workouts (L2): fine about once a
  // month, strongly avoided more often than that.
  if (inMetcon(c.workout) && c.workout.movements.some((m) => OCCASIONAL_IN_METCON.has(m.movement.family))) {
    const recent = [...input.lastMovementDate].some(([k, d]) => OCCASIONAL_IN_METCON.has(familyOf(k)) && days(d, date) < OCCASIONAL_DAYS);
    if (recent) { penalty += 0.35; notes.push('Turkish get-ups in a metcon again within 4 weeks'); }
    else { penalty += 0.08; notes.push('Turkish get-ups in a metcon: occasional use'); }
  }

  const w = policy.weights;
  const wsum = w.variety + w.freshness + w.weakness + w.benchmark || 1;
  // A coach-set repeat that is due is an explicit instruction: it outranks the engine's own preferences.
  const coachPriority = repeatDue(c, date, lw) ? 0.5 : 0;
  const total = (w.variety * variety + w.freshness * freshness + w.weakness * weakness + w.benchmark * benchmark) / wsum - penalty + coachPriority;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { variety: r(variety), freshness: r(freshness), weakness: r(weakness), benchmark: r(benchmark), penalty: r(penalty), total: r(total), notes };
}

/** Movements done slowly and controlled: mostly warm-up and practice material, in a metcon only occasionally. */
const OCCASIONAL_IN_METCON = new Set(['tgu']);
const OCCASIONAL_DAYS = 28;
const inMetcon = (w: Candidate['workout']) => w.scoreType !== 'load' && w.scoreType !== 'none' && w.structure.kind !== 'sets' && w.structure.kind !== 'skill-practice';

/** Hard rules. Returns the reason a candidate is not allowed on this date, or undefined. */
export function blocked(c: Candidate, date: string, input: PlanInput, window: PastDay[], yesterday?: PastDay, tomorrow?: PastDay): string | undefined {
  const { rules } = input.policy;
  if (!c.workout.movements.length) return 'no movements';
  const lw = input.lastWorkoutDate.get(c.id);
  const due = benchmarkDue(c, date, input);
  const repeating = c.repeat && (!c.repeat.until || date <= c.repeat.until);
  if (repeating && !repeatDue(c, date, lw)) return 'repeat not due yet';
  if (lw && days(lw, date) < rules.noRepeatWorkoutDays && !due && !repeating) return 'done recently';
  if (c.minutes && c.minutes > rules.maxMinutes) return 'too long';
  // Neighbouring days in both directions: a day inserted between planned days must respect the next day too.
  for (const [nb, when] of [[yesterday, 'yesterday'], [tomorrow, 'tomorrow']] as const) {
    if (!nb) continue;
    if (nb.workoutIds.includes(c.id)) return `same workout ${when}`;
    for (const k of conflictsWith(c, nb, rules)) {
      if (exceptionUsedRecently(window, date, rules, k)) return k === 'heavy' ? 'heavy two days in a row (exception already used recently)' : `movement used ${when} (exception already used recently)`;
    }
  }
  if (c.benchmark) {
    const weekStart = new Date(Date.parse(date) - ((new Date(date).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
    const week = window.filter((d) => d.date >= weekStart);
    // Lift tests (1RM, 3RM…) have their own spacing, so they neither crowd out the metcon benchmarks nor turn every
    // heavy day into a max attempt.
    if (isLiftTest(c)) {
      const gap = rules.minDaysBetweenLiftTests ?? 14;
      if (window.some((d) => (d.liftTestCount ?? 0) > 0 && days(d.date, date) < gap)) return `lift test within the last ${gap} days`;
    }
    else if (week.reduce((a, d) => a + d.benchmarkCount, 0) >= rules.maxBenchmarksPerWeek) return 'benchmark limit this week';
  }
  const eq = checkEquipment(c.workout, input.equipmentFor(date), rules.groupSize);
  if (!eq.ok) return eq.problems[0];
  return undefined;
}

export function toPastDay(date: string, picks: Candidate[]): PastDay {
  return {
    date, workoutIds: picks.map((p) => p.id), tags: picks.map((p) => p.tags),
    movementKeys: picks.flatMap(candidateMovementKeys), heavy: picks.some((p) => isHeavyDay(p.tags)),
    benchmarkCount: picks.filter((p) => p.benchmark && !isLiftTest(p)).length,
    liftTestCount: picks.filter(isLiftTest).length,
  };
}

/** Fill the given dates in order; each choice becomes part of the picture for the next. */
export function plan(input: PlanInput): Proposal[] {
  const out: Proposal[] = [];
  const timeline = [...input.history].sort((a, b) => a.date.localeCompare(b.date));
  const lastW = new Map(input.lastWorkoutDate), lastM = new Map(input.lastMovementDate);
  const lastL = new Map(input.lastLiftTest ?? []);
  if (!input.lastLiftTest) for (const c of input.candidates) {
    const d = isLiftTest(c) ? lastW.get(c.id) : undefined;
    if (d && (lastL.get(liftOf(c)) ?? '') < d) lastL.set(liftOf(c), d);
  }
  const local = { ...input, lastWorkoutDate: lastW, lastMovementDate: lastM, lastLiftTest: lastL };
  for (const date of [...input.dates].sort()) {
    const window = timeline.filter((d) => d.date < date && days(d.date, date) <= input.policy.windowDays);
    const prevDay = timeline.filter((d) => d.date < date).at(-1);
    const yesterday = prevDay && days(prevDay.date, date) === 1 ? prevDay : undefined;
    const tomorrow = timeline.find((d) => days(date, d.date) === 1);
    const ranked = input.candidates
      .filter((c) => !blocked(c, date, local, window, yesterday, tomorrow))
      .map((c) => ({ c, s: score(c, date, local, window, yesterday, tomorrow) }))
      .sort((a, b) => b.s.total - a.s.total || a.c.id.localeCompare(b.c.id));
    const best = ranked[0];
    if (!best) continue;
    const eq = checkEquipment(best.c.workout, input.equipmentFor(date), input.policy.rules.groupSize);
    out.push({ date, candidateId: best.c.id, score: best.s, warnings: [...eq.crowded, ...eq.warnings],
      alternatives: ranked.slice(1, 1 + (input.alternatives ?? 4)).map((r) => ({ candidateId: r.c.id, score: r.s })) });
    timeline.push(toPastDay(date, [best.c]));
    lastW.set(best.c.id, date);
    if (isLiftTest(best.c)) lastL.set(liftOf(best.c), date);
    for (const k of candidateMovementKeys(best.c)) lastM.set(k, date);
  }
  return out;
}
