/**
 * Warm-ups: which one a day shows, and the coach's ways to change it.
 *
 * A day shows, in order: the coach's warm-up for that day, else the coach's saved warm-up for the workout,
 * else the suggested one (rule-based, lib/fitness-core/src/workouts/warmup.ts). Same for the whole family.
 * The coach can also keep their own warm-ups as templates to pick for any day.
 */
import { sql } from '@workspace/fitness-db';
import { suggestWarmUp, warmUpText, type Workout, type WorkoutTags } from '@workspace/fitness-core';

export type WarmUpSource = 'day' | 'workout' | 'suggested';
export interface DayWarmUp { text: string; source: WarmUpSource; suggested: string; minutes: number; workoutText: string | null }

export function resolveWarmUp(workout: Workout, tags: WorkoutTags | undefined, dayText: string | null, workoutText: string | null): DayWarmUp {
  const s = suggestWarmUp(workout, tags ?? undefined);
  const suggested = warmUpText(s);
  const text = dayText?.trim() ? dayText : workoutText?.trim() ? workoutText : suggested;
  const source: WarmUpSource = dayText?.trim() ? 'day' : workoutText?.trim() ? 'workout' : 'suggested';
  return { text, source, suggested, minutes: s.minutes, workoutText: workoutText ?? null };
}

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
