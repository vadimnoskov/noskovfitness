/**
 * Warm-ups: which one a day shows, and the coach's ways to change it.
 *
 * A day shows, in order: the coach's warm-up for that day, else the coach's saved warm-up for the workout,
 * else the suggested one (rule-based, lib/fitness-core/src/workouts/warmup.ts). Same for the whole family.
 * The coach can also keep their own warm-ups as templates to pick for any day.
 */
import { sql } from '@workspace/fitness-db';
import { suggestWarmUp, warmUpText, estimateMinutes, withCap, mondayOf, type Workout, type WorkoutTags, type WarmUpOptions } from '@workspace/fitness-core';

export type WarmUpSource = 'day' | 'workout' | 'suggested';
export interface DayWarmUp { text: string; source: WarmUpSource; suggested: string; minutes: number; workoutText: string | null }

export function resolveWarmUp(workout: Workout, tags: WorkoutTags | undefined, dayText: string | null, workoutText: string | null, opts: WarmUpOptions = {}): DayWarmUp {
  const s = suggestWarmUp(workout, tags ?? undefined, opts);
  const suggested = warmUpText(s);
  const text = dayText?.trim() ? dayText : workoutText?.trim() ? workoutText : suggested;
  const source: WarmUpSource = dayText?.trim() ? 'day' : workoutText?.trim() ? 'workout' : 'suggested';
  return { text, source, suggested, minutes: s.minutes, workoutText: workoutText ?? null };
}

/**
 * The lightest planned day of each week in [from, to]: the non-heavy proposed or approved day with the shortest estimated
 * workout, if that is 12 minutes or less. Its warm-up adds a 10–15 minute skill practice (coach: not every week is fine).
 */
export async function lightDays(groupId: string, from: string, to: string): Promise<Set<string>> {
  const rows = await sql`SELECT d.date::text AS date, w.structure, w.movements, w.score_type, w.tags, w.original_text
    FROM program_days d JOIN workouts w ON w.id = d.main_workout_id
    WHERE d.group_id = ${groupId} AND d.status IN ('proposed','approved') AND d.date BETWEEN (${from}::date - 6) AND (${to}::date + 6)`;
  const best = new Map<string, { date: string; min: number }>();
  for (const r of rows) {
    if (r.tags?.timeDomain === 'heavy') continue;
    const min = estimateMinutes({ id: '', structure: withCap(r.structure, r.original_text), movements: r.movements, scoreType: r.score_type });
    if (!min) continue;
    const wk = mondayOf(r.date);
    const cur = best.get(wk);
    if (!cur || min < cur.min) best.set(wk, { date: r.date, min });
  }
  return new Set([...best.values()].filter((b) => b.min <= 12).map((b) => b.date));
}
/** Implements at a location (for picking a warm-up complex). */
export const implementsOf = (items: { implement: string; quantity: number }[] | null | undefined) =>
  items ? new Set(items.filter((i) => i.quantity > 0).map((i) => i.implement)) : undefined;

const str = (f: FormData, k: string) => String(f.get(k) ?? '');
export const MAX_WARM_UP = 4000;
const clean = (t: string) => t.replace(/\r\n/g, '\n').trim().slice(0, MAX_WARM_UP);

/**
 * Coach changes a day's warm-up. scope=day: this day only (empty text = back to the workout's saved or suggested one).
 * scope=workout: save as the workout's warm-up for every time it is programmed (empty = forget it), and clear this
 * day's own text so the saved one shows.
 */
export async function setWarmUp(f: FormData) {
  const id = str(f, 'id'), text = clean(str(f, 'text')), scope = str(f, 'scope') === 'workout' ? 'workout' : 'day';
  if (scope === 'day') {
    await sql`UPDATE program_days SET warm_up = ${text || null}, updated_at = now() WHERE id = ${id}`;
    return;
  }
  await sql.begin(async (tx) => {
    const [d] = await tx`UPDATE program_days SET warm_up = NULL, updated_at = now() WHERE id = ${id} RETURNING main_workout_id`;
    if (d) await tx`UPDATE workouts SET warm_up = ${text || null} WHERE id = ${d.main_workout_id}`;
  });
}

export async function saveWarmUpTemplate(f: FormData) {
  const name = str(f, 'name').trim().slice(0, 60), text = clean(str(f, 'text'));
  if (!name || !text) return;
  await sql`INSERT INTO warm_up_templates (name, body) VALUES (${name}, ${text}) ON CONFLICT (name) DO UPDATE SET body = EXCLUDED.body`;
}

export async function deleteWarmUpTemplate(f: FormData) {
  await sql`DELETE FROM warm_up_templates WHERE id = ${str(f, 'templateId')}`;
}

export async function listWarmUpTemplates() {
  return (await sql`SELECT id, name, body FROM warm_up_templates ORDER BY lower(name)`).map((r) => ({ id: r.id as string, name: r.name as string, body: r.body as string }));
}
