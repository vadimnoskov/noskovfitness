/**
 * Volume-jump warnings for planned workouts (fitness-core volume.ts): per person, against their own most reps of each
 * movement in one workout over the previous 12 months, plus a warning after a layoff. Thresholds are coach settings.
 */
import { sql, getPolicy } from '@workspace/fitness-db';
import { usualVolume, volumeWarnings, type Workout, type Result } from '@workspace/fitness-core';
import { GROUP_ID } from './data';

type Row = Pick<Result, 'performed' | 'score' | 'completed'> & { date: string };

/** Warnings for each (person, date, workout), keyed "athleteId|date". Only dates from `today` on are checked. */
export async function volumeWarningsFor(athletes: { id: string; name: string }[], items: { date: string; workout: Workout }[], today: string, groupId = GROUP_ID) {
  const out = new Map<string, string[]>();
  const todo = items.filter((i) => i.date >= today);
  if (!todo.length || !athletes.length) return out;
  const policy = await getPolicy(groupId);
  const rules = { factor: policy.rules.volumeJumpFactor, minReps: policy.rules.volumeJumpMinReps, layoffDays: policy.rules.returnAfterDays };
  const earliest = todo.reduce((a, i) => (i.date < a ? i.date : a), todo[0]!.date);
  for (const a of athletes) {
    const results = (await sql`SELECT date::text AS date, performed, score, completed FROM results
      WHERE athlete_id = ${a.id} AND date >= ${earliest}::date - 400 ORDER BY date`) as unknown as Row[];
    for (const i of todo) {
      const w = volumeWarnings(i.workout, usualVolume(results, i.date < today ? i.date : today), i.date, rules, today);
      if (w.length) out.set(`${a.id}|${i.date}`, w);
    }
  }
  return out;
}
