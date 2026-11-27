/**
 * Week outline (Planner v2). The CrossFit Template ("A Theoretical Template", L1) describes 5-day weeks of single
 * elements, couplets and triplets, but calls itself "as much descriptive as prescriptive", and routine is the enemy
 * (Foundations). So the outline does not lay out a fixed sequence of day types. It only makes sure each week has what it
 * needs, on varied days:
 *   - a heavy day ("heavy days at least once a week", L2), and
 *   - an interval or single monostructural day ("the bulk of metabolic training should be interval training", L1).
 * Which open day gets each changes week to week (never the same weekday as the week before); the other days are free,
 * so single elements, couplets, triplets and chippers come from the targets. A workout that fits its day's need gets a
 * bonus (the "week outline" weight); a non-heavy pick on the heavy day costs a penalty (see the planner).
 */
import type { WorkoutTags } from '../model/types';
import type { Modality } from '../movements/catalog';

export type SlotKind = 'heavy' | 'mono';
export interface Slot { kind: SlotKind; elements: Modality[]; label: string }
const HEAVY: Slot = { kind: 'heavy', elements: ['W'], label: 'this week\'s heavy day' };
const MONO: Slot = { kind: 'mono', elements: ['M'], label: 'this week\'s interval or single monostructural day' };

const DAY = 86400000;
export const mondayOf = (d: string) => { const t = Date.parse(d); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10); };
const weekday = (d: string) => (new Date(d).getUTCDay() + 6) % 7;
/** A small deterministic hash, so the same week always gets the same days (re-plans are stable) but weeks differ. */
const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/**
 * The heavy and interval days for each week of open training dates. `heavyWeeks` = Mondays of weeks that already have a
 * heavy day (done or approved): those weeks get no heavy slot.
 */
export function weekOutline(dates: string[], heavyWeeks: Set<string> = new Set()): Map<string, Slot> {
  const out = new Map<string, Slot>();
  const byWeek = new Map<string, string[]>();
  for (const d of [...dates].sort()) { const m = mondayOf(d); byWeek.set(m, [...(byWeek.get(m) ?? []), d]); }
  let prevHeavy = -1, prevMono = -1;
  for (const [monday, ds] of [...byWeek].sort((a, b) => a[0].localeCompare(b[0]))) {
    const h = hash(monday);
    const pick = (avoidWeekday: number, avoidDates: string[], salt: number) => {
      const ok = ds.filter((d) => weekday(d) !== avoidWeekday && !avoidDates.includes(d));
      const pool = ok.length ? ok : ds.filter((d) => !avoidDates.includes(d));
      return pool.length ? pool[(h + salt) % pool.length] : undefined;
    };
    let heavyDay: string | undefined;
    if (!heavyWeeks.has(monday)) { heavyDay = pick(prevHeavy, [], 0); if (heavyDay) { out.set(heavyDay, HEAVY); prevHeavy = weekday(heavyDay); } }
    // The interval day: a different day, and not next to the heavy day when there is room.
    const notNext = heavyDay ? ds.filter((d) => Math.abs(Date.parse(d) - Date.parse(heavyDay!)) <= DAY) : [];
    let monoDay = ds.length > 2 ? pick(prevMono, notNext, 7) : undefined;
    if (!monoDay && ds.length > 1) monoDay = pick(prevMono, heavyDay ? [heavyDay] : [], 7);
    if (monoDay && monoDay !== heavyDay) { out.set(monoDay, MONO); prevMono = weekday(monoDay); }
  }
  return out;
}

/** How well a workout fits its slot, 0–1. */
export function slotFit(slot: Slot, tags: WorkoutTags, structureKind?: string): number {
  const heavy = tags.timeDomain === 'heavy';
  const mods = [...new Set(tags.modalityPattern)];
  if (slot.kind === 'heavy') return heavy ? 1 : 0;
  if (heavy || !mods.every((m) => m === 'M')) return mods.includes('M') && !heavy ? 0.3 : 0;
  return structureKind === 'intervals' || structureKind === 'tabata' || tags.timeDomain === 'short' || tags.timeDomain === 'medium' ? 1 : 0.7;
}
