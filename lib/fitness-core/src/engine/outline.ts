/**
 * Week outline (Planner v2), from the CrossFit Template ("A Theoretical Template", L1; "as much descriptive as
 * prescriptive"). Over a 5-day week it runs single-element, couplet, triplet, couplet, single-element days, rotating
 * monostructural (M), gymnastics (G) and weightlifting (W) over three weeks:
 *   week 1: M · GW · MGW · MG · W     week 2: G · WM · GWM · GW · M     week 3: W · MG · WMG · WM · G
 *
 * The coach chose a soft outline: each open training day gets a slot, and a workout that fits its slot gets a bonus
 * (the "week outline" weight). The targets still decide the overall mix. A single-W day is the week's heavy day; a
 * single-M day is an interval or single-modality conditioning day ("the bulk of metabolic training should be interval
 * training", L1); every week gets a heavy slot unless it already has a heavy day.
 */
import type { WorkoutTags } from '../model/types';
import type { Modality } from '../movements/catalog';

export type SlotKind = 'heavy' | 'mono' | 'single-g' | 'couplet' | 'triplet';
export interface Slot { kind: SlotKind; elements: Modality[]; label: string }

const GRID: Modality[][][] = [
  [['M'], ['G', 'W'], ['M', 'G', 'W'], ['M', 'G'], ['W']],
  [['G'], ['W', 'M'], ['G', 'W', 'M'], ['G', 'W'], ['M']],
  [['W'], ['M', 'G'], ['W', 'M', 'G'], ['W', 'M'], ['G']],
];
const NAME: Record<Modality, string> = { M: 'monostructural', G: 'gymnastics', W: 'weightlifting' };

function slotOf(el: Modality[]): Slot {
  if (el.length === 1) {
    const e = el[0]!;
    if (e === 'W') return { kind: 'heavy', elements: el, label: 'heavy day (single element: weightlifting)' };
    if (e === 'M') return { kind: 'mono', elements: el, label: 'intervals or a single monostructural effort' };
    return { kind: 'single-g', elements: el, label: 'single element: gymnastics' };
  }
  return { kind: el.length === 2 ? 'couplet' : 'triplet', elements: el, label: `${el.length === 2 ? 'couplet' : 'triplet'} (${el.map((x) => NAME[x]).join(' + ')})` };
}

/** Monday of the ISO week, and a week number that runs on across years (for the 3-week rotation). */
const DAY = 86400000;
export const mondayOf = (d: string) => { const t = Date.parse(d); return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10); };
const weekNo = (monday: string) => Math.floor(Date.parse(monday) / (7 * DAY));

/** Which positions of the 5-day grid to use when a week has fewer open days (keeps the 1-2-3-2-1 shape). */
const PICK: Record<number, number[]> = { 1: [2], 2: [1, 2], 3: [0, 2, 4], 4: [0, 1, 2, 4], 5: [0, 1, 2, 3, 4] };

/**
 * A slot for each open training date. `heavyWeeks` = Mondays of weeks that already have a heavy day (done or approved),
 * so they get no extra heavy slot.
 */
export function weekOutline(dates: string[], heavyWeeks: Set<string> = new Set()): Map<string, Slot> {
  const out = new Map<string, Slot>();
  const byWeek = new Map<string, string[]>();
  for (const d of [...dates].sort()) { const m = mondayOf(d); byWeek.set(m, [...(byWeek.get(m) ?? []), d]); }
  for (const [monday, ds] of byWeek) {
    const grid = GRID[weekNo(monday) % 3]!;
    const days = ds.slice(0, 7);
    const idx = days.length > 5 ? [0, 1, 2, 3, 4, ...Array.from({ length: days.length - 5 }, () => 2)] : PICK[days.length]!;
    let slots = idx.map((i) => slotOf(grid[i]!));
    const hasHeavy = heavyWeeks.has(monday) || slots.some((s) => s.kind === 'heavy');
    if (!hasHeavy) {
      // Every week gets a heavy day: the single-element day becomes it, else the first couplet.
      const j = slots.findIndex((s) => s.kind === 'single-g' || s.kind === 'mono');
      const k = j >= 0 ? j : slots.findIndex((s) => s.kind === 'couplet');
      if (k >= 0) slots = slots.map((s, i) => (i === k ? slotOf(['W']) : s));
    } else if (heavyWeeks.has(monday)) {
      // Already heavy this week: the heavy slot becomes a couplet.
      slots = slots.map((s) => (s.kind === 'heavy' ? slotOf(['G', 'W']) : s));
    }
    days.forEach((d, i) => out.set(d, slots[i]!));
  }
  return out;
}

/** How well a workout fits its slot, 0–1. */
export function slotFit(slot: Slot, tags: WorkoutTags, structureKind?: string): number {
  const heavy = tags.timeDomain === 'heavy';
  const mods = [...new Set(tags.modalityPattern)];
  const same = (a: Modality[], b: Modality[]) => a.length === b.length && a.every((x) => b.includes(x));
  switch (slot.kind) {
    case 'heavy': return heavy ? 1 : 0;
    case 'mono':
      if (heavy || !mods.every((m) => m === 'M')) return mods.includes('M') && !heavy ? 0.3 : 0;
      return structureKind === 'intervals' || structureKind === 'tabata' || tags.timeDomain === 'short' || tags.timeDomain === 'medium' ? 1 : 0.7;
    case 'single-g': return !heavy && mods.length === 1 && mods[0] === 'G' ? 1 : 0;
    case 'couplet':
    case 'triplet': {
      if (heavy) return 0;
      const n = slot.kind === 'couplet' ? 2 : 3;
      const count = tags.movementCount === n ? 1 : Math.abs(tags.movementCount - n) === 1 ? 0.5 : 0;
      return count * (same(mods, slot.elements) ? 1 : mods.some((m) => slot.elements.includes(m)) ? 0.6 : 0.3);
    }
  }
}
