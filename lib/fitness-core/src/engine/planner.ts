/**
 * The programming engine. "Varied is not random": for each open training day it looks at what the last weeks
 * (done + already planned) contain, compares that mix to the coach's targets, and ranks candidate workouts by how
 * much they close the gaps. Hard rules filter first. Deterministic: same inputs → same plan.
 * It only proposes; the coach approves or edits.
 */
import { cellKey, gridColumn, GRID_COL_LABEL } from '../workouts/weakness';
import { plannedReps, volumeLabel, type UsualVolume } from '../workouts/volume';
import type { EquipmentProfile, WorkoutTags, Workout } from '../model/types';
import { keyOf } from '../movements/resolver';
import { FAMILY_BY_ID } from '../movements/catalog';
import type { ProgrammingPolicy } from './policy';
import { checkEquipment } from './equipment';
import { weekOutline, slotFit, mondayOf, type Slot } from './outline';

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

/**
 * How many days in a row would follow the published order if this candidate is picked: 1 = no link, 2 = it was published
 * right after the previous training day's workout, 3 = after the previous two as well (a copied stretch).
 */
export function publishedChain(c: Candidate, date: string, input: Pick<PlanInput, 'publishedNext'>, window: PastDay[]): number {
  const next = input.publishedNext;
  if (!next?.size) return 1;
  const before = window.filter((d) => d.date < date).slice(-2);
  const prev = before.at(-1), prev2 = before.length > 1 ? before[0] : undefined;
  if (!prev || days(prev.date, date) > 4) return 1;
  const linked = prev.workoutIds.filter((p) => next.get(p)?.has(c.id));
  if (!linked.length) return 1;
  if (prev2 && days(prev2.date, prev.date) <= 4 && prev2.workoutIds.some((q) => linked.some((p) => next.get(q)?.has(p)))) return 3;
  return 2;
}

const repsCache = new WeakMap<Candidate, Map<string, number> | null>();
/**
 * How many family members a candidate would ask for a volume jump: more than volumeJumpFactor × their most reps of a
 * movement in one workout in 12 months (from volumeJumpMinReps up). Undefined unless that is at least half of the people
 * with history of that movement.
 */
export function volumeJumpFor(c: Candidate, input: Pick<PlanInput, 'usualVolumes' | 'policy'>): { people: number; of: number; what: string } | undefined {
  const usual = input.usualVolumes;
  if (!usual?.length) return undefined;
  if (!repsCache.has(c)) repsCache.set(c, plannedReps(c.workout)?.reps ?? null);
  const reps = repsCache.get(c);
  if (!reps) return undefined;
  const factor = input.policy.rules.volumeJumpFactor ?? 2, min = input.policy.rules.volumeJumpMinReps ?? 30;
  let worst: { people: number; of: number; what: string } | undefined;
  for (const [k, n] of reps) {
    if (n < min) continue;
    const known = usual.filter((u) => (u.most.get(k) ?? 0) > 0);
    const jumped = known.filter((u) => n > factor * u.most.get(k)!);
    if (known.length && jumped.length * 2 >= known.length && (!worst || jumped.length > worst.people)) worst = { people: jumped.length, of: known.length, what: `${n} ${volumeLabel(k)}` };
  }
  return worst;
}

/** A coach-set repeat that is active on this date and due (never done, or at least everyDays since last time). */
export function repeatDue(c: Candidate, date: string, last: string | undefined): boolean {
  if (!c.repeat || (c.repeat.until && date > c.repeat.until)) return false;
  return !last || days(last, date) >= c.repeat.everyDays;
}

/** A day already in the picture: done in history or planned. */
export interface PastDay { date: string; workoutIds: string[]; tags: WorkoutTags[]; movementKeys: string[]; heavy: boolean; benchmarkCount: number; liftTestCount?: number }

export interface ScoreBreakdown { variety: number; freshness: number; weakness: number; benchmark: number; outline?: number; penalty: number; total: number; notes: string[]; why?: Why }
/** The facts behind a pick, for the "why this workout" card. Only the chosen workout carries it. */
export interface Why {
  /** Each part of the mix this workout belongs to: its share of the recent window against the target (%). */
  mix: { label: string; bucket: string; recent: number; target: number }[];
  windowDays: number; windowWorkouts: number;
  /** Its movements and how many days since each was last done (null = not within lookbackDays). */
  movements: { name: string; daysSince: number | null }[];
  lookbackDays: number;
  /** When this workout was last done or planned (null = never). */
  lastDone: string | null;
  /** Rules it was checked against, in plain words. */
  rules: string[];
}
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
  /** Weakness-grid cells to favour (key "row|col", e.g. "long|G"), 0–1: see plannerWeakness. */
  weaknessCells?: Map<string, number>;
  /** Each family member's usual volume (most reps of each movement in one workout, last 12 months): see usualVolume. */
  usualVolumes?: UsualVolume[];
  /** For each workout, the workouts published 1–3 days after it (anti-copy: see publishedChain). */
  publishedNext?: Map<string, Set<string>>;
  /** Most recent date a workout longer than rules.longMinutes was done or planned (set by plan()). */
  lastLongDate?: string;
  /** Week outline slots by date (see weekOutline); computed from the open dates when absent. */
  outline?: Map<string, Slot>;
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
const MIX_LABEL: Record<string, string> = { movementCount: 'movements per workout', timeDomain: 'time domain', priority: 'task or time priority', load: 'load', modality: 'modality' };
const BUCKET_LABEL: Record<string, string> = { '1': 'single movement', '2-3': 'couplet or triplet', '4+': 'four or more', heavy: 'heavy day', task: 'for time (task priority)', time: 'AMRAP/EMOM (time priority)',
  G: 'gymnastics', W: 'weightlifting', M: 'monostructural', bodyweight: 'bodyweight' };

/** The "why" for a chosen workout: where it sits in the mix, how fresh its movements are, and the rules it passed. */
export function explain(c: Candidate, date: string, input: PlanInput, window: PastDay[], yesterday?: PastDay, tomorrow?: PastDay): Why {
  const { policy } = input;
  const sh = windowShares(window);
  const r = (x: number | undefined) => Math.round(x ?? 0);
  const b = (k: string) => BUCKET_LABEL[k] ?? k;
  const mix: Why['mix'] = [
    { label: MIX_LABEL.timeDomain!, bucket: b(c.tags.timeDomain), recent: r(sh.timeDomain.get(c.tags.timeDomain)), target: policy.targets.timeDomain[c.tags.timeDomain] },
    { label: MIX_LABEL.movementCount!, bucket: b(mcBucket(c.tags.movementCount)), recent: r(sh.movementCount.get(mcBucket(c.tags.movementCount))), target: policy.targets.movementCount[mcBucket(c.tags.movementCount)] },
    { label: MIX_LABEL.priority!, bucket: b(c.tags.priority), recent: r(sh.priority.get(c.tags.priority)), target: policy.targets.priority[c.tags.priority] },
    { label: MIX_LABEL.load!, bucket: b(c.tags.load), recent: r(sh.load.get(c.tags.load)), target: policy.targets.load[c.tags.load] },
    ...[...new Set(c.tags.modalityPattern)].map((m) => ({ label: MIX_LABEL.modality!, bucket: b(m), recent: r(sh.modality.get(m)), target: policy.targets.modality[m] })),
  ];
  const byFam = new Map<string, number | null>();
  for (const k of candidateMovementKeys(c)) {
    const l = input.lastMovementDate.get(k), d = l ? days(l, date) : null, f = familyOf(k);
    const prev = byFam.get(f);
    byFam.set(f, prev === undefined ? d : prev === null ? d : d === null ? prev : Math.min(prev, d));
  }
  const rules: string[] = [];
  const lw = input.lastWorkoutDate.get(c.id);
  const repeating = c.repeat && (!c.repeat.until || date <= c.repeat.until);
  if (repeating) rules.push(`coach repeat: every ${c.repeat!.everyDays} days`);
  else if (c.benchmark && benchmarkDue(c, date, input)) rules.push(`${isLiftTest(c) ? 'lift test' : 'benchmark'} due again (every ${c.benchmark.retestEveryDays} days)`);
  else rules.push(lw ? `not done in the last ${policy.rules.noRepeatWorkoutDays} days (last ${lw})` : `not done before (the no-repeat window is ${policy.rules.noRepeatWorkoutDays} days)`);
  if (c.minutes) rules.push(c.minutes > (policy.rules.longMinutes ?? 40)
    ? `about ${Math.round(c.minutes)} min: a long one, allowed once in ${policy.rules.longEveryDays ?? 90} days (none in that time)`
    : `about ${Math.round(c.minutes)} min, within ${policy.rules.longMinutes ?? 40} minutes`);
  const conflicts = [yesterday, tomorrow].flatMap((nb) => (nb ? conflictsWith(c, nb, policy.rules) : []));
  if (conflicts.includes('heavy')) rules.push(`next to another heavy day: the once-every-${policy.rules.heavyExceptionDays}-days exception`);
  else if (isHeavyDay(c.tags)) rules.push('no heavy day next to it');
  if (conflicts.includes('movement')) rules.push(`shares a movement with the next or previous day: the once-every-${policy.rules.movementExceptionDays}-days exception`);
  else rules.push('no movement shared with the day before or after');
  if (c.benchmark && !isLiftTest(c)) rules.push(`within ${policy.rules.maxBenchmarksPerWeek} benchmark${policy.rules.maxBenchmarksPerWeek === 1 ? '' : 's'} a week`);
  if (isLiftTest(c)) rules.push(`no other lift test within ${policy.rules.minDaysBetweenLiftTests} days`);
  rules.push(`equipment checked for ${policy.rules.groupSize} people at ${input.equipmentFor(date).name}`);
  if (input.publishedNext?.size) rules.push(publishedChain(c, date, input, window) === 2 ? 'follows the published order of the previous day (two in a row is allowed; three is not)' : 'does not continue a stretch of the published programming');
  const slot = input.outline?.get(date);
  if (slot) rules.push(`week outline (soft): this day's slot is ${slot.label}; ${slotFit(slot, c.tags, c.workout.structure.kind) >= 0.99 ? 'it fits' : 'it does not fit, the mix needed something else'}`);
  return {
    mix, windowDays: policy.windowDays, windowWorkouts: sh.n,
    movements: [...byFam].map(([f, d]) => ({ name: FAMILY_BY_ID[f]?.name ?? f, daysSince: d })),
    lastDone: lw ?? null, rules, lookbackDays: Math.max(policy.windowDays, policy.rules.noRepeatWorkoutDays),
  };
}

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
  const famWeak = wk && wk.size ? keys.reduce((a, k) => a + (wk.get(familyOf(k)) ?? 0), 0) / (keys.length || 1) : 0;
  // Weakness grid: the candidate's own time domain × modality cell (heavy days are not on the grid).
  const td = c.tags.timeDomain;
  // Gradual: at most one day in any 7 leans into a flagged cell, so balance across the targets stays first.
  const inFlagged = (t: WorkoutTags) => t.timeDomain !== 'heavy' && (input.weaknessCells?.get(cellKey(t.timeDomain, gridColumn(t.modalityPattern))) ?? 0) > 0;
  const leanedThisWeek = window.some((d) => days(d.date, date) < 7 && days(d.date, date) > -7 && d.tags.some(inFlagged));
  const cellWeak = td !== 'heavy' && !leanedThisWeek ? input.weaknessCells?.get(cellKey(td, gridColumn(c.tags.modalityPattern))) ?? 0 : 0;
  if (cellWeak > 0 && td !== 'heavy') notes.push(`works a declining or rarely trained area (${td}, ${GRID_COL_LABEL[gridColumn(c.tags.modalityPattern)].toLowerCase()})`);
  const weakness = Math.max(famWeak, cellWeak);

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
  // Two days in the published order: allowed (it can be chance) but nudged away from.
  if (publishedChain(c, date, input, window) === 2) { penalty += 0.1; notes.push('follows the published order of the previous day'); }
    // Volume-aware: a big jump over their usual for at least half the family (L1: increase volume gradually).
  const jump = volumeJumpFor(c, input);
  if (jump) { penalty += 0.4; notes.push(`big volume jump for ${jump.people} of ${jump.of} (${jump.what})`); }
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
  // Week outline (soft): a bonus for fitting this day's slot.
  const slot = input.outline?.get(date);
  const outline = slot ? slotFit(slot, c.tags, c.workout.structure.kind) : 0;
  if (slot && outline >= 0.99) notes.push(`fits the week outline: ${slot.label}`);
  // Heavy days at least once a week (L2, strong): a non-heavy pick on the week's heavy day costs a penalty.
  if (slot?.kind === 'heavy' && outline < 0.99 && (w.outline ?? 0) > 0) penalty += 0.25;
  // …and the other days of that week lean away from a second heavy day.
  if (isHeavyDay(c.tags) && slot?.kind !== 'heavy' && (w.outline ?? 0) > 0) {
    const mon = mondayOf(date);
    const hd = [...(input.outline ?? [])].find(([d, sl]) => sl.kind === 'heavy' && d !== date && mondayOf(d) === mon)?.[0];
    if (hd) { penalty += 0.3; notes.push(`this week's heavy day is ${hd}`); }
  }
  const wo = slot ? w.outline ?? 0 : 0;
  const wsum = w.variety + w.freshness + w.weakness + w.benchmark + wo || 1;
  // A coach-set repeat that is due is an explicit instruction: it outranks the engine's own preferences.
  const coachPriority = repeatDue(c, date, lw) ? 0.5 : 0;
  const total = (w.variety * variety + w.freshness * freshness + w.weakness * weakness + w.benchmark * benchmark + wo * outline) / wsum - penalty + coachPriority;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { variety: r(variety), freshness: r(freshness), weakness: r(weakness), benchmark: r(benchmark), outline: r(outline), penalty: r(penalty), total: r(total), notes };
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
  // Never reproduce a stretch of the published programming: three days in the published order.
  if (publishedChain(c, date, input, window) >= 3) return 'would copy three days in a row from the published programming';
  // Long workouts (over 40 minutes by default) only once in a while (coach, 2026-11-28).
  const longMin = rules.longMinutes ?? 40, longEvery = rules.longEveryDays ?? 90;
  if (c.minutes && c.minutes > longMin && input.lastLongDate && days(input.lastLongDate, date) < longEvery && days(input.lastLongDate, date) > -longEvery)
    return `a workout over ${longMin} minutes within ${longEvery} days`;
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
  const heavyWeeks = new Set(timeline.filter((d) => d.heavy).map((d) => mondayOf(d.date)));
  const minutesById = new Map(input.candidates.map((c) => [c.id, c.minutes]));
  const longMin = input.policy.rules.longMinutes ?? 40;
  const isLong = (id: string) => (minutesById.get(id) ?? 0) > longMin;
  const lastLong = input.lastLongDate ?? timeline.filter((d) => d.workoutIds.some(isLong)).at(-1)?.date;
  const local: PlanInput = { ...input, lastWorkoutDate: lastW, lastMovementDate: lastM, lastLiftTest: lastL, outline: input.outline ?? weekOutline(input.dates, heavyWeeks), lastLongDate: lastLong };
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
    out.push({ date, candidateId: best.c.id, score: { ...best.s, why: explain(best.c, date, local, window, yesterday, tomorrow) }, warnings: [...eq.crowded, ...eq.warnings],
      alternatives: ranked.slice(1, 1 + (input.alternatives ?? 4)).map((r) => ({ candidateId: r.c.id, score: r.s })) });
    timeline.push(toPastDay(date, [best.c]));
    lastW.set(best.c.id, date);
    if (isLong(best.c.id)) local.lastLongDate = date;
    if (isLiftTest(best.c)) lastL.set(liftOf(best.c), date);
    for (const k of candidateMovementKeys(best.c)) lastM.set(k, date);
  }
  return out;
}
