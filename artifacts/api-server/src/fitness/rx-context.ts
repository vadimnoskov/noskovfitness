/**
 * What Individual Rx needs about a person: their pace against the estimate and their conditioning level. Cached for a
 * minute, since Today asks for it once per planned workout.
 */
import { sql } from '@workspace/fitness-db';
import { paceFactor, powerPoints, conditioning, type Workout } from '@workspace/fitness-core';

const cache = new Map<string, { at: number; v: { pace: number; paceN: number; level: number | null } }>();

export async function rxContext(athleteId: string): Promise<{ pace: number; paceN: number; level: number | null }> {
  const hit = cache.get(athleteId);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const [[a], results, dims] = await Promise.all([
    sql`SELECT sex, conditioning_prior FROM athletes WHERE id = ${athleteId}`,
    sql`SELECT id, date::text AS date, workout_id, performed, score, completed, tags FROM results
        WHERE athlete_id = ${athleteId} AND date > current_date - 1830 ORDER BY date`,
    sql`SELECT kind, date::text AS date, value::float8 AS value, unit FROM measurements WHERE athlete_id = ${athleteId}`,
  ]);
  if (!a) return { pace: 1, paceN: 0, level: null };
  const recent = results.filter((r) => (r.date as string) > new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10));
  const p = paceFactor(recent.map((r) => ({ performed: r.performed as Workout, score: r.score as { timeSec?: number }, completed: r.completed as boolean })));
  const { points } = powerPoints(results as never, a.sex, dims as never);
  const c = conditioning(points, results.map((r) => r.date as string), new Date().toISOString().slice(0, 10), a.conditioning_prior ?? null);
  const v = { pace: p.factor, paceN: p.n, level: c.level };
  cache.set(athleteId, { at: Date.now(), v });
  return v;
}
export const forgetRxContext = (athleteId: string) => cache.delete(athleteId);
