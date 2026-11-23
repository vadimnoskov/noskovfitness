/**
 * Calendar operations on a group's program. Pure functions: they return the new list of days; the caller saves it
 * and asks the planner to re-plan the days that are still only proposed.
 */
export interface SlotDay { id: string; date: string; status: 'proposed' | 'approved' | 'done' | 'skipped'; seq?: number }

const DAY = 86400000;
export const addDays = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const isoWeekday = (s: string) => ((new Date(`${s}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** The next `count` training days starting at `from` (inclusive). */
export function trainingDates(from: string, count: number, trainingDays: number[]): string[] {
  const out: string[] = [];
  for (let d = from; out.length < count; d = addDays(d, 1)) if (trainingDays.includes(isoWeekday(d))) out.push(d);
  return out;
}

/** Training dates between two dates inclusive. */
export function trainingDatesBetween(from: string, to: string, trainingDays: number[]): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (trainingDays.includes(isoWeekday(d))) out.push(d);
  return out;
}

const movable = (d: SlotDay) => d.status === 'proposed' || d.status === 'approved';

/** Skip a day. 'drop': the workout is skipped and the plan continues. 'push': this and all later open days shift to the next training day. */
export function skipDay(days: SlotDay[], id: string, mode: 'drop' | 'push', trainingDays: number[]): SlotDay[] {
  const target = days.find((d) => d.id === id);
  if (!target) return days;
  if (mode === 'drop') return days.map((d) => (d.id === id ? { ...d, status: 'skipped' } : d));
  return pushForward(days, target.date, trainingDays);
}

/** Move every open day on or after `from` to the next training day (the workout planned for `from` happens one training day later). */
export function pushForward(days: SlotDay[], from: string, trainingDays: number[]): SlotDay[] {
  const open = days.filter((d) => d.date >= from && movable(d)).sort((a, b) => a.date.localeCompare(b.date));
  if (!open.length) return days;
  const dates = trainingDates(addDays(open[0]!.date, 1), open.length, trainingDays);
  const moved = new Map(open.map((d, i) => [d.id, dates[i]!]));
  return days.map((d) => (moved.has(d.id) ? { ...d, date: moved.get(d.id)! } : d));
}

/** Insert an extra day (e.g. a Wednesday); seq separates it from an existing workout on the same date. */
export function insertDay(days: SlotDay[], date: string, id: string): SlotDay[] {
  const seq = Math.max(0, ...days.filter((d) => d.date === date).map((d) => d.seq ?? 1)) + 1;
  return [...days, { id, date, status: 'proposed', seq: seq === 1 ? 1 : seq }];
}

export function moveDay(days: SlotDay[], id: string, toDate: string): SlotDay[] {
  return days.map((d) => (d.id === id && movable(d) ? { ...d, date: toDate } : d));
}
