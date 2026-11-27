/**
 * Personal weakness work in the warm-up (Phase 7). L2 ("Weaknesses"): well-varied programming already addresses
 * weaknesses; extra weakness work goes in the warm-up or a skill session, without pre-fatiguing the workout. The L1
 * ("What Is Fitness? Part 2"): pursue what you don't want to see come out of the hopper.
 *
 * Finding them. A person's weakest skills show in what they scale. Results only say whether a workout was done as
 * prescribed or modified, not which movement was changed, so each skill movement's workouts are compared with the
 * person's own overall rate: a movement whose workouts they modify far more often than their usual is a likely weakness.
 * Movements that come along with a stronger one (thrusters in every Fran that was scaled for the pull-ups) are explained
 * away: the strongest movement is taken first and its workouts set aside before the next is measured.
 *
 * Only skill movements count (gymnastics of medium or high skill, push-ups and double-unders). Loads that are lighter
 * than Rx are a strength matter and are already handled by each person's version.
 */
import type { Workout } from '../model/types';
import { FAMILY_BY_ID } from '../movements/catalog';
import { MOVEMENT_FACTS, MOVEMENT_GUIDE } from '../knowledge/movements';

const FACTS = new Map(MOVEMENT_FACTS.map((f) => [f.key, f]));
const GUIDE = new Map(MOVEMENT_GUIDE.map((g) => [g.key, g]));

/** The movement keys that count as skills: medium/high-skill gymnastics, push-ups, double-unders. */
export function skillKey(m: Workout['movements'][number]): string | undefined {
  const f = m.movement.family;
  if (f === 'jump-rope') return m.movement.variant === 'double-under' ? 'jump-rope:du' : undefined;
  if (f === 'skill-drill') return undefined;
  const facts = FACTS.get(f);
  if (!facts || facts.modality !== 'G') return undefined;
  return facts.skill !== 'low' || f === 'push-up' ? f : undefined;
}
const nameOf = (key: string) => (key === 'jump-rope:du' ? 'Double-under' : FACTS.get(key)?.name ?? FAMILY_BY_ID[key]?.name ?? key);
const familyOf = (key: string) => (key === 'jump-rope:du' ? 'jump-rope' : key);

export interface MovementWeakness {
  key: string; name: string;
  /** Workouts with the movement in the window, and how many of them were modified. */
  n: number; modified: number;
  /** Share modified for this movement and for all the person's workouts (0–1). */
  rate: number; baseline: number;
  /** Date of the last modified workout with it. */
  last: string;
}

export const WEAKNESS_RULES = { windowMonths: 24, minWorkouts: 4, minRate: 0.6, minAboveBaseline: 0.25, max: 3 };

/** The person's skill weaknesses from their results (most telling first, at most 3). */
export function movementWeaknesses(results: { date: string; performed: Workout; asPrescribed: boolean }[], asOf: string, rules = WEAKNESS_RULES): MovementWeakness[] {
  const from = new Date(Date.parse(asOf));
  from.setUTCMonth(from.getUTCMonth() - rules.windowMonths);
  const since = from.toISOString().slice(0, 10);
  const rows = results.filter((r) => r.date >= since && r.date <= asOf).map((r) => ({ date: r.date, mod: !r.asPrescribed, keys: new Set(r.performed.movements.map(skillKey).filter((k): k is string => !!k)) }));
  if (!rows.length) return [];
  const baseline = rows.filter((r) => r.mod).length / rows.length;
  const out: MovementWeakness[] = [];
  let left = rows;
  while (out.length < rules.max) {
    const by = new Map<string, { n: number; modified: number; last: string }>();
    for (const r of left) for (const k of r.keys) { const c = by.get(k) ?? { n: 0, modified: 0, last: '' }; c.n++; if (r.mod) { c.modified++; if (r.date > c.last) c.last = r.date; } by.set(k, c); }
    let best: MovementWeakness | undefined;
    for (const [key, c] of by) {
      const rate = c.modified / c.n;
      if (c.n < rules.minWorkouts || rate < rules.minRate || rate < baseline + rules.minAboveBaseline) continue;
      // Most telling: the furthest above their usual, then the most evidence.
      if (!best || rate > best.rate || (rate === best.rate && c.n > best.n)) best = { key, name: nameOf(key), n: c.n, modified: c.modified, rate, baseline, last: c.last };
    }
    if (!best) break;
    out.push(best);
    left = left.filter((r) => !r.keys.has(best!.key));
  }
  return out;
}

/** The skill movements the coach can choose from (the same set the detection counts). */
export const SKILL_MOVEMENTS: { key: string; name: string }[] = [
  ...MOVEMENT_FACTS.filter((f) => f.modality === 'G' && f.key !== 'skill-drill' && (f.skill !== 'low' || f.key === 'push-up')).map((f) => ({ key: f.key, name: f.name })),
  { key: 'jump-rope:du', name: 'Double-under' },
].sort((a, b) => a.name.localeCompare(b.name));

/** One weakness to work on, with why it is on the list. */
export interface WeaknessItem { key: string; name: string; why: string; from: 'coach' | 'results' }
const pct = (x: number) => `${Math.round(x * 100)}%`;
export const detectedWhy = (w: MovementWeakness) => `modified ${w.modified} of ${w.n} workouts with ${w.name.toLowerCase()}s (all workouts: ${pct(w.baseline)}), last ${w.last}`;

/** The person's list: the coach's choices first, then what the last 2 years of results show (not already listed). */
export function weaknessList(coachKeys: string[], detected: MovementWeakness[]): WeaknessItem[] {
  const out: WeaknessItem[] = coachKeys.filter((k) => SKILL_MOVEMENTS.some((m) => m.key === k)).map((k) => ({ key: k, name: nameOf(k), why: 'chosen by the coach', from: 'coach' as const }));
  for (const w of detected) if (!coachKeys.includes(w.key)) out.push({ key: w.key, name: w.name, why: `your results: ${detectedWhy(w)}`, from: 'results' });
  return out;
}

export interface WeaknessWork { title: string; lines: string[]; why: string; source: string }

const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * Today's weakness work for one person: one of their weaknesses, rotating by date, about 5 minutes inside the warm-up.
 * Skipped when today's workout has that movement or another with the same pattern (no pre-fatigue; the rehearsal covers
 * it), or when the family's skill block already works it today (`skipKeys`).
 */
export function weaknessWork(weaknesses: WeaknessItem[], today: Workout, date: string, skipKeys: Iterable<string> = []): WeaknessWork | undefined {
  if (!weaknesses.length) return undefined;
  const skip = new Set(skipKeys);
  const fams = new Set(today.movements.map((m) => m.movement.family));
  const patterns = new Set(today.movements.map((m) => FAMILY_BY_ID[m.movement.family]?.pattern).filter(Boolean));
  const ok = weaknesses.filter((w) => {
    const f = familyOf(w.key);
    return !skip.has(f) && !fams.has(f) && !(FAMILY_BY_ID[f]?.pattern && patterns.has(FAMILY_BY_ID[f]!.pattern));
  });
  if (!ok.length) return undefined;
  const w = ok[hash(date) % ok.length]!;
  const facts = FACTS.get(familyOf(w.key));
  const steps = facts?.easier ?? [];
  const guide = GUIDE.get(familyOf(w.key));
  const lines = [
    w.key === 'jump-rope:du' ? `- 4–6 short tries of 10–20 s with full rest: double-unders, or ${steps.join(' or ')} until they are smooth`
      : steps.length ? `- 2–3 easy sets of 3–5 reps of the hardest version you can do with good form (the full ${w.name.toLowerCase()}, or ${steps.join(', or ')})` : `- 2–3 easy sets of 3–5 reps of the full ${w.name.toLowerCase()} or the closest version you can do well`,
    ...(guide?.faults[0] ? [`- Focus: ${guide.faults[0].fix.charAt(0).toLowerCase()}${guide.faults[0].fix.slice(1)}`] : []),
    '- About 5 minutes, quality only: stop well before you tire, it must not take anything from the workout',
  ];
  return { title: `Weakness work: ${w.name}`, lines, why: w.why, source: 'L2: weakness work goes in the warm-up, without pre-fatigue; L1: pursue what you don\'t want to see come out of the hopper' };
}
