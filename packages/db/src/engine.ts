/**
 * Database side of the programming engine: loads the picture (history, plan, library, policy, equipment),
 * runs the pure planner from @nf/core, and saves proposed days.
 */
import {
  plan, withDefaults, workMinutes, keyOf, trainingDatesBetween, addDays,
  type Candidate, type PastDay, type ProgrammingPolicy, type EquipmentProfile, type Workout, type WorkoutTags,
} from '@nf/core';
import { sql } from './client';

export async function getPolicy(groupId: string): Promise<ProgrammingPolicy> {
  const [r] = await sql`SELECT policy FROM programming_policy WHERE group_id = ${groupId}`;
  return withDefaults(r?.policy);
}
export async function savePolicy(groupId: string, p: ProgrammingPolicy) {
  await sql`INSERT INTO programming_policy (group_id, policy) VALUES (${groupId}, ${sql.json(p as never)})
            ON CONFLICT (group_id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`;
}

export async function getGroup(groupId: string) {
  const [g] = await sql`SELECT id, name, training_days, default_equipment_id FROM groups WHERE id = ${groupId}`;
  return g as { id: string; name: string; training_days: number[]; default_equipment_id: string | null };
}

export async function getEquipmentProfiles(groupId: string): Promise<EquipmentProfile[]> {
  return (await sql`SELECT id, name, items FROM equipment_profiles WHERE group_id = ${groupId} ORDER BY name`) as unknown as EquipmentProfile[];
}

/** Every workout in the library that the engine may propose. */
export async function loadCandidates(): Promise<Candidate[]> {
  const rows = await sql`
    SELECT w.id, w.name, w.structure, w.movements, w.score_type, w.benchmark, w.tags,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (r.score->>'timeSec')::numeric) FROM results r WHERE r.workout_id = w.id AND r.score ? 'timeSec') AS med
    FROM workouts w
    WHERE w.programmable AND jsonb_array_length(w.movements) > 0 AND w.score_type <> 'none'
      AND coalesce(w.name, '') !~* '(warm-?up|lifting$|mobility|stretch)'`;
  return rows.map((r) => {
    const workout: Workout = { id: r.id, name: r.name ?? undefined, structure: r.structure, movements: r.movements, scoreType: r.score_type };
    return { id: r.id, workout, tags: r.tags as WorkoutTags, benchmark: r.benchmark, minutes: workMinutes(workout, r.med ? Number(r.med) : undefined) };
  });
}

/** Group history (all athletes' results, one entry per date) plus planned days, from `from` on. */
async function loadPicture(groupId: string, from: string, excludeProposedFrom?: string) {
  const res = await sql`
    SELECT r.date::text AS date, w.id, w.tags, w.benchmark, array_agg(DISTINCT wm.movement_key) AS keys
    FROM results r JOIN workouts w ON w.id = r.workout_id JOIN workout_movements wm ON wm.workout_id = w.id
    WHERE r.date >= ${from} GROUP BY r.date, w.id`;
  const planned = await sql`
    SELECT d.date::text AS date, w.id, w.tags, w.benchmark, array_agg(DISTINCT wm.movement_key) AS keys
    FROM program_days d JOIN workouts w ON w.id = d.main_workout_id JOIN workout_movements wm ON wm.workout_id = w.id
    WHERE d.group_id = ${groupId} AND d.status IN ('approved','proposed') AND d.date >= ${from}
      ${excludeProposedFrom ? sql`AND NOT (d.status = 'proposed' AND d.date >= ${excludeProposedFrom})` : sql``}
    GROUP BY d.date, w.id`;
  const byDate = new Map<string, PastDay>();
  const lastWorkout = new Map<string, string>(), lastMovement = new Map<string, string>();
  for (const r of [...res, ...planned]) {
    const d: PastDay = byDate.get(r.date) ?? { date: r.date, workoutIds: [], tags: [], movementKeys: [], heavy: false, benchmarkCount: 0 };
    if (!d.workoutIds.includes(r.id)) {
      d.workoutIds.push(r.id); d.tags.push(r.tags); d.movementKeys.push(...r.keys);
      d.heavy ||= r.tags.load === 'heavy';
      if (r.benchmark && r.benchmark.category !== 'lift') d.benchmarkCount++;
    }
    byDate.set(r.date, d);
    if ((lastWorkout.get(r.id) ?? '') < r.date) lastWorkout.set(r.id, r.date);
    for (const k of r.keys) if ((lastMovement.get(k) ?? '') < r.date) lastMovement.set(k, r.date);
  }
  return { history: [...byDate.values()], lastWorkout, lastMovement };
}

/**
 * Propose workouts for every open training day in [from, to]. Existing proposed days in the range are replaced;
 * approved and done days are kept and taken into account.
 */
export async function proposeRange(groupId: string, from: string, to: string) {
  const [policy, group, profiles, candidates] = await Promise.all([getPolicy(groupId), getGroup(groupId), getEquipmentProfiles(groupId), loadCandidates()]);
  // Workout history reaches back a year so "not repeated within N days" sees older repeats.
  const { history, lastWorkout, lastMovement } = await loadPicture(groupId, addDays(from, -Math.max(policy.windowDays, policy.rules.noRepeatWorkoutDays)), from);
  const existing = await sql`SELECT date::text AS date, status, equipment_profile_id FROM program_days WHERE group_id = ${groupId} AND date BETWEEN ${from} AND ${to}`;
  const fixed = new Set(existing.filter((d) => d.status !== 'proposed').map((d) => d.date));
  const locByDate = new Map(existing.map((d) => [d.date, d.equipment_profile_id as string | null]));
  const dates = trainingDatesBetween(from, to, group.training_days).filter((d) => !fixed.has(d));
  const defaultProfile = profiles.find((p) => p.id === group.default_equipment_id) ?? profiles[0]!;
  const profileFor = (date: string) => profiles.find((p) => p.id === locByDate.get(date)) ?? defaultProfile;
  const proposals = plan({ dates, history, candidates, policy, equipmentFor: profileFor, lastWorkoutDate: lastWorkout, lastMovementDate: lastMovement, alternatives: 4 });
  await sql.begin(async (tx) => {
    await tx`DELETE FROM program_days WHERE group_id = ${groupId} AND status = 'proposed' AND date BETWEEN ${from} AND ${to}`;
    for (const p of proposals) {
      await tx`INSERT INTO program_days (group_id, date, status, equipment_profile_id, main_workout_id, origin, alternatives, warnings)
        VALUES (${groupId}, ${p.date}, 'proposed', ${profileFor(p.date).id}, ${p.candidateId},
          ${tx.json({ by: 'engine', score: p.score, policyVersion: policy.version } as never)}, ${tx.json(p.alternatives as never)}, ${tx.json(p.warnings)})`;
    }
  });
  return { planned: proposals.length, skippedDates: dates.length - proposals.length };
}

export { keyOf };
