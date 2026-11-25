/**
 * Style profile: the mix of a body of programming in the same buckets the planner's targets use
 * (movement count, time domain, priority, load, modality). Measured from the published workouts it shows what
 * well-built programming actually looks like, and can be adopted as the targets.
 */
import type { WorkoutTags } from '../model/types';
import type { ProgrammingPolicy } from './policy';

type Targets = ProgrammingPolicy['targets'];
const mcBucket = (n: number) => (n <= 1 ? '1' : n <= 3 ? '2-3' : '4+') as '1' | '2-3' | '4+';

/** Shares that add up to exactly 100 (largest-remainder rounding). */
function percents<K extends string>(keys: readonly K[], weights: Map<K, number>): Record<K, number> {
  const total = keys.reduce((a, k) => a + (weights.get(k) ?? 0), 0) || 1;
  const raw = keys.map((k) => ({ k, v: ((weights.get(k) ?? 0) * 100) / total }));
  const out = Object.fromEntries(raw.map(({ k, v }) => [k, Math.floor(v)])) as Record<K, number>;
  let left = 100 - raw.reduce((a, { v }) => a + Math.floor(v), 0);
  for (const { k } of [...raw].sort((a, b) => (b.v % 1) - (a.v % 1))) { if (left-- <= 0) break; out[k]++; }
  return out;
}

export function styleProfile(items: { tags: WorkoutTags; weight: number }[]): Targets & { workouts: number } {
  const add = <K extends string>(m: Map<K, number>, k: K, w: number) => m.set(k, (m.get(k) ?? 0) + w);
  const mc = new Map<'1' | '2-3' | '4+', number>(), td = new Map<keyof Targets['timeDomain'], number>(), pr = new Map<keyof Targets['priority'], number>();
  const ld = new Map<keyof Targets['load'], number>(), mo = new Map<'G' | 'W' | 'M', number>();
  for (const { tags: t, weight: w } of items) {
    add(mc, mcBucket(t.movementCount), w); add(td, t.timeDomain, w); add(pr, t.priority, w); add(ld, t.load, w);
    const mods = t.modalityPattern;
    for (const m of mods) add(mo, m, w); // every movement counts once, as in the planner's window shares
  }
  return {
    workouts: items.length,
    movementCount: percents(['1', '2-3', '4+'] as const, mc),
    timeDomain: percents(['short', 'medium', 'long', 'endurance'] as const, td),
    priority: percents(['task', 'time'] as const, pr),
    load: percents(['bodyweight', 'light', 'medium', 'heavy'] as const, ld),
    modality: percents(['G', 'W', 'M'] as const, mo),
  };
}
