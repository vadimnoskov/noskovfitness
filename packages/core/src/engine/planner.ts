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
}

/** A day already in the picture: done in history or planned. */
export interface PastDay { date: string; workoutIds: string[]; tags: WorkoutTags[]; movementKeys: string[]; heavy: boolean; benchmarkCount: number }

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
}

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const isHeavy = (t: WorkoutTags) => t.load === 'heavy';
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

export function score(c: Candidate, date: string, input: PlanInput, window: PastDay[], yesterday?: PastDay): ScoreBreakdown {
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
  let benchmark = 0;
  if (c.benchmark && c.benchmark.category !== 'lift') {
    const overdue = lw ? days(lw, date) / c.benchmark.retestEveryDays : 2;
    if (overdue >= 1) { benchmark = Math.min(1, 0.5 + (overdue - 1) / 2); notes.push(`benchmark due${lw ? ` (last ${lw})` : ''}`); }
  }

  // Soft penalties.
  let penalty = 0;
  if (yesterday) {
    const ym = new Set(yesterday.tags.flatMap((t) => [...new Set(t.modalityPattern)].sort().join('')));
    if (ym.has([...new Set(mp)].sort().join(''))) { penalty += 0.08; notes.push('same modality mix as previous day'); }
    if (yesterday.tags.some((t) => t.timeDomain === c.tags.timeDomain && t.timeDomain === 'endurance')) penalty += 0.1;
  }
  const eq = checkEquipment(c.workout, input.equipmentFor(date), input.policy.rules.groupSize);
  penalty += Math.min(0.15, eq.warnings.length * 0.04);

  const w = policy.weights;
  const wsum = w.variety + w.freshness + w.weakness + w.benchmark || 1;
  const total = (w.variety * variety + w.freshness * freshness + w.weakness * weakness + w.benchmark * benchmark) / wsum - penalty;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { variety: r(variety), freshness: r(freshness), weakness: r(weakness), benchmark: r(benchmark), penalty: r(penalty), total: r(total), notes };
}

/** Hard rules. Returns the reason a candidate is not allowed on this date, or undefined. */
export function blocked(c: Candidate, date: string, input: PlanInput, window: PastDay[], yesterday?: PastDay): string | undefined {
  const { rules } = input.policy;
  if (!c.workout.movements.length) return 'no movements';
  const lw = input.lastWorkoutDate.get(c.id);
  const due = c.benchmark && c.benchmark.category !== 'lift' && (!lw || days(lw, date) >= c.benchmark.retestEveryDays);
  if (lw && days(lw, date) < rules.noRepeatWorkoutDays && !due) return 'done recently';
  if (c.minutes && c.minutes > rules.maxMinutes) return 'too long';
  if (yesterday) {
    if (rules.noSameMovementConsecutiveDays) {
      const y = new Set(yesterday.movementKeys.map(familyOf));
      if (candidateMovementKeys(c).some((k) => y.has(familyOf(k)))) return 'movement used yesterday';
    }
    if (rules.noConsecutiveHeavyDays && yesterday.heavy && isHeavy(c.tags)) return 'heavy two days in a row';
  }
  if (c.benchmark && c.benchmark.category !== 'lift') {
    const weekStart = new Date(Date.parse(date) - ((new Date(date).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
    const thisWeek = window.filter((d) => d.date >= weekStart).reduce((a, d) => a + d.benchmarkCount, 0);
    if (thisWeek >= rules.maxBenchmarksPerWeek) return 'benchmark limit this week';
  }
  const eq = checkEquipment(c.workout, input.equipmentFor(date), rules.groupSize);
  if (!eq.ok) return eq.problems[0];
  return undefined;
}

export function toPastDay(date: string, picks: Candidate[]): PastDay {
  return {
    date, workoutIds: picks.map((p) => p.id), tags: picks.map((p) => p.tags),
    movementKeys: picks.flatMap(candidateMovementKeys), heavy: picks.some((p) => isHeavy(p.tags)),
    benchmarkCount: picks.filter((p) => p.benchmark && p.benchmark.category !== 'lift').length,
  };
}

/** Fill the given dates in order; each choice becomes part of the picture for the next. */
export function plan(input: PlanInput): Proposal[] {
  const out: Proposal[] = [];
  const timeline = [...input.history].sort((a, b) => a.date.localeCompare(b.date));
  const lastW = new Map(input.lastWorkoutDate), lastM = new Map(input.lastMovementDate);
  const local = { ...input, lastWorkoutDate: lastW, lastMovementDate: lastM };
  for (const date of [...input.dates].sort()) {
    const window = timeline.filter((d) => d.date < date && days(d.date, date) <= input.policy.windowDays);
    const prevDay = timeline.filter((d) => d.date < date).at(-1);
    const yesterday = prevDay && days(prevDay.date, date) === 1 ? prevDay : undefined;
    const ranked = input.candidates
      .filter((c) => !blocked(c, date, local, window, yesterday))
      .map((c) => ({ c, s: score(c, date, local, window, yesterday) }))
      .sort((a, b) => b.s.total - a.s.total || a.c.id.localeCompare(b.c.id));
    const best = ranked[0];
    if (!best) continue;
    const eq = checkEquipment(best.c.workout, input.equipmentFor(date), input.policy.rules.groupSize);
    out.push({ date, candidateId: best.c.id, score: best.s, warnings: eq.warnings,
      alternatives: ranked.slice(1, 1 + (input.alternatives ?? 4)).map((r) => ({ candidateId: r.c.id, score: r.s })) });
    timeline.push(toPastDay(date, [best.c]));
    lastW.set(best.c.id, date);
    for (const k of candidateMovementKeys(best.c)) lastM.set(k, date);
  }
  return out;
}
