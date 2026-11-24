import { sql } from '@workspace/fitness-db';
import { withCap, type Workout, type WorkoutTags, type ScoreBreakdown } from '@workspace/fitness-core';
import { resolveWarmUp, type DayWarmUp } from './warmups';

export interface PlannedDay {
  id: string; date: string; seq: number; status: 'proposed' | 'approved' | 'done' | 'skipped';
  equipmentId: string | null; workoutId: string; name: string | null; benchmark: { category: string; label?: string } | null;
  workout: Workout; tags: WorkoutTags; origin: { by: string; score?: ScoreBreakdown };
  alternatives: { candidateId: string; score: ScoreBreakdown; name?: string | null; tags?: WorkoutTags; workout?: Workout }[];
  warnings: string[];
  repeat: { everyDays: number; until: string | null } | null;
  warmUp: DayWarmUp;
}

export async function getPlannedDays(groupId: string, from: string, to: string): Promise<PlannedDay[]> {
  const rows = await sql`
    SELECT d.id, d.date::text AS date, d.seq, d.status, d.equipment_profile_id, d.origin, d.alternatives, d.warnings,
           w.id AS wid, w.name, w.benchmark, w.structure, w.movements, w.score_type, w.tags, w.original_text, w.repeat_every_days, w.repeat_until::text AS repeat_until,
           d.warm_up AS day_warm_up, w.warm_up AS workout_warm_up
    FROM program_days d JOIN workouts w ON w.id = d.main_workout_id
    WHERE d.group_id = ${groupId} AND d.date BETWEEN ${from} AND ${to} ORDER BY d.date, d.seq`;
  const altIds = [...new Set(rows.flatMap((r) => (r.alternatives as { candidateId: string }[]).map((a) => a.candidateId)))];
  const alts = altIds.length ? await sql`SELECT id, name, structure, movements, score_type, tags FROM workouts WHERE id = ANY(${altIds})` : [];
  const altById = new Map(alts.map((a) => [a.id as string, a]));
  return rows.map((r) => {
    const workout: Workout = { id: r.wid, name: r.name ?? undefined, structure: withCap(r.structure, r.original_text), movements: r.movements, scoreType: r.score_type };
    return {
    id: r.id, date: r.date, seq: r.seq, status: r.status, equipmentId: r.equipment_profile_id, workoutId: r.wid, name: r.name, benchmark: r.benchmark,
    workout, tags: r.tags, origin: r.origin,
    warmUp: resolveWarmUp(workout, r.tags, r.day_warm_up, r.workout_warm_up),
    repeat: r.repeat_every_days ? { everyDays: r.repeat_every_days, until: r.repeat_until } : null,
    warnings: r.warnings,
    alternatives: (r.alternatives as PlannedDay['alternatives']).map((a) => {
      const w = altById.get(a.candidateId);
      return { ...a, name: w?.name, tags: w?.tags, workout: w ? { id: w.id, name: w.name ?? undefined, structure: w.structure, movements: w.movements, scoreType: w.score_type } : undefined };
    }),
  }; });
}
