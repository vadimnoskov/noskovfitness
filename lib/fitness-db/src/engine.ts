/**
 * Database side of the programming engine: loads the picture (history, plan, library, policy, equipment),
 * runs the pure planner from @nf/core, and saves proposed days.
 */
import {
  isHeavyDay, plan, blocked, withDefaults, workMinutes, keyOf, withCap, trainingDatesBetween, addDays,
  type Candidate, type PastDay, type ProgrammingPolicy, type EquipmentProfile, type Workout, type WorkoutTags, powerPoints, weaknessGrid, plannerWeakness, usualVolume, type UsualVolume,
} from '@workspace/fitness-core';
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
  return (await sql`SELECT id, name, items, limits FROM equipment_profiles WHERE group_id = ${groupId} ORDER BY name`) as unknown as EquipmentProfile[];
}

/** Every workout in the library that the engine may propose. */
export async function loadCandidates(): Promise<Candidate[]> {
  const rows = await sql`
    SELECT w.id, w.name, w.structure, w.movements, w.score_type, w.benchmark, w.tags, w.original_text, w.repeat_every_days, w.repeat_until::text AS repeat_until,
      (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (r.score->>'timeSec')::numeric) FROM results r WHERE r.workout_id = w.id AND r.score ? 'timeSec') AS med
    FROM workouts w
    WHERE (w.programmable OR w.repeat_every_days IS NOT NULL) AND jsonb_array_length(w.movements) > 0 AND w.score_type <> 'none'
      AND coalesce(w.name, '') !~* '(warm-?up|lifting$|mobility|stretch)'`;
  return rows.map((r) => {
    const workout: Workout = { id: r.id, name: r.name ?? undefined, structure: withCap(r.structure, r.original_text), movements: r.movements, scoreType: r.score_type };
    return {
      id: r.id, workout, tags: r.tags as WorkoutTags, benchmark: r.benchmark, minutes: workMinutes(workout, r.med ? Number(r.med) : undefined),
      repeat: r.repeat_every_days ? { everyDays: r.repeat_every_days, ...(r.repeat_until ? { until: r.repeat_until } : {}) } : null,
    };
  });
}

/** The program's history (its members' results, one entry per date) plus its planned days, from `from` on. */
async function loadPicture(groupId: string, from: string, exclude?: { from: string; to: string }) {
  const res = await sql`
    SELECT r.date::text AS date, w.id, w.tags, w.benchmark, array_agg(DISTINCT wm.movement_key) AS keys
    FROM results r JOIN workouts w ON w.id = r.workout_id JOIN workout_movements wm ON wm.workout_id = w.id
    WHERE r.date >= ${from} AND r.athlete_id IN (SELECT athlete_id FROM group_members WHERE group_id = ${groupId})
    GROUP BY r.date, w.id`;
  const planned = await sql`
    SELECT d.date::text AS date, w.id, w.tags, w.benchmark, array_agg(DISTINCT wm.movement_key) AS keys
    FROM program_days d JOIN workouts w ON w.id = d.main_workout_id JOIN workout_movements wm ON wm.workout_id = w.id
    WHERE d.group_id = ${groupId} AND d.status IN ('approved','proposed') AND d.date >= ${from}
      ${exclude ? sql`AND NOT (d.status = 'proposed' AND d.date BETWEEN ${exclude.from} AND ${exclude.to})` : sql``}
    GROUP BY d.date, w.id`;
  const byDate = new Map<string, PastDay>();
  const lastWorkout = new Map<string, string>(), lastMovement = new Map<string, string>();
  for (const r of [...res, ...planned]) {
    const d: PastDay = byDate.get(r.date) ?? { date: r.date, workoutIds: [], tags: [], movementKeys: [], heavy: false, benchmarkCount: 0, liftTestCount: 0 };
    if (!d.workoutIds.includes(r.id)) {
      d.workoutIds.push(r.id); d.tags.push(r.tags); d.movementKeys.push(...r.keys);
      d.heavy ||= isHeavyDay(r.tags);
      if (r.benchmark && r.benchmark.category !== 'lift') d.benchmarkCount++;
      if (r.benchmark?.category === 'lift') d.liftTestCount = (d.liftTestCount ?? 0) + 1;
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
export async function proposeRange(groupId: string, from: string, to: string, opts: { extraDates?: string[] } = {}) {
  const { proposals, policy, dates, profileFor } = await planRange(groupId, from, to, opts);
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

/**
 * What the planner would propose for the open days in [from, to] (nothing is saved). `policy` overrides the saved one,
 * e.g. to preview a setting change before the coach confirms it.
 */
/**
 * Weakness-grid cells the group's training should lean into a little (see plannerWeakness in fitness-core). Built from
 * each member's own results and measurements; empty when nobody has enough data.
 */
export async function groupWeakness(groupId: string, asOf: string): Promise<Map<string, number>> {
  return (await groupPicture(groupId, asOf)).weaknessCells;
}

/** Per-member inputs the planner needs from results: the weakness grid (group) and each person's usual volume. */
export async function groupPicture(groupId: string, asOf: string): Promise<{ weaknessCells: Map<string, number>; usualVolumes: UsualVolume[] }> {
  const members = await sql`SELECT a.id, a.sex FROM athletes a JOIN group_members gm ON gm.athlete_id = a.id WHERE gm.group_id = ${groupId}`;
  const grids = [];
  const usualVolumes: UsualVolume[] = [];
  for (const m of members) {
    const [results, dims] = await Promise.all([
      sql`SELECT id, date::text AS date, workout_id, performed, score, completed, tags FROM results
          WHERE athlete_id = ${m.id} AND date > ${asOf}::date - 1100 AND date <= ${asOf} ORDER BY date`,
      sql`SELECT kind, date::text AS date, value::float8 AS value, unit FROM measurements WHERE athlete_id = ${m.id}`,
    ]);
    const { points } = powerPoints(results as never, m.sex, dims as never);
    const grid = weaknessGrid(points, results.map((r) => ({ date: r.date, timeDomain: r.tags?.timeDomain, modalities: r.tags?.modalityPattern })), asOf);
    if (grid.fit) grids.push(grid);
    usualVolumes.push(usualVolume(results as never, asOf));
  }
  return { weaknessCells: plannerWeakness(grids), usualVolumes };
}

/** For each published workout, the workouts published 1–3 days after it (any date it appeared on). */
let publishedNextCache: { at: number; map: Map<string, Set<string>> } | undefined;
export async function loadPublishedNext(): Promise<Map<string, Set<string>>> {
  if (publishedNextCache && Date.now() - publishedNextCache.at < 10 * 60 * 1000) return publishedNextCache.map;
  const rows = await sql`SELECT DISTINCT a.workout_id AS a, b.workout_id AS b FROM workout_sources a
    JOIN workout_sources b ON b.source = a.source AND b.source_date > a.source_date AND b.source_date <= a.source_date + 3 AND b.workout_id <> a.workout_id
    WHERE a.source = 'published'`;
  const map = new Map<string, Set<string>>();
  for (const r of rows) { const set = map.get(r.a) ?? new Set<string>(); set.add(r.b); map.set(r.a, set); }
  publishedNextCache = { at: Date.now(), map };
  return map;
}

export async function planRange(groupId: string, from: string, to: string, opts: { extraDates?: string[]; policy?: ProgrammingPolicy } = {}) {
  const [saved, group, profiles, candidates] = await Promise.all([getPolicy(groupId), getGroup(groupId), getEquipmentProfiles(groupId), loadCandidates()]);
  const policy = opts.policy ?? saved;
  // Workout history reaches back a year so "not repeated within N days" sees older repeats.
  const { history, lastWorkout, lastMovement } = await loadPicture(groupId, addDays(from, -Math.max(policy.windowDays, policy.rules.noRepeatWorkoutDays)), { from, to });
  const existing = await sql`SELECT date::text AS date, status, equipment_profile_id FROM program_days WHERE group_id = ${groupId} AND date BETWEEN ${from} AND ${to}`;
  const fixed = new Set(existing.filter((d) => d.status !== 'proposed').map((d) => d.date));
  const locByDate = new Map(existing.map((d) => [d.date, d.equipment_profile_id as string | null]));
  // Re-plan every training day plus any date that already has a proposed workout (the coach moved or added one there,
  // e.g. a Wednesday that is not a usual training day): re-planning must never silently drop a day.
  const proposedDates = existing.filter((d) => d.status === 'proposed').map((d) => d.date as string);
  const dates = [...new Set([...trainingDatesBetween(from, to, group.training_days), ...proposedDates, ...(opts.extraDates ?? [])])].filter((d) => !fixed.has(d)).sort();
  const defaultProfile = profiles.find((p) => p.id === group.default_equipment_id) ?? profiles[0]!;
  const profileFor = (date: string) => profiles.find((p) => p.id === locByDate.get(date)) ?? defaultProfile;
  const [{ weaknessCells, usualVolumes }, publishedNext] = await Promise.all([groupPicture(groupId, from), loadPublishedNext()]);
  const proposals = plan({ dates, history, candidates, policy, equipmentFor: profileFor, lastWorkoutDate: lastWorkout, lastMovementDate: lastMovement, weaknessCells, usualVolumes, publishedNext, alternatives: 4 });
  return { proposals, policy, dates, profileFor, candidates };
}

/**
 * Fresh engine alternatives for one program day (e.g. after its location changed), keeping its workout.
 * The engine's own top pick for the date becomes the first alternative when it differs from the current workout.
 */
export async function refreshAlternatives(groupId: string, dayId: string) {
  const [day] = await sql`SELECT date::text AS date, equipment_profile_id, main_workout_id FROM program_days WHERE id = ${dayId} AND group_id = ${groupId}`;
  if (!day) return;
  const [policy, profiles, candidates] = await Promise.all([getPolicy(groupId), getEquipmentProfiles(groupId), loadCandidates()]);
  const { history, lastWorkout, lastMovement } = await loadPicture(groupId, addDays(day.date, -Math.max(policy.windowDays, policy.rules.noRepeatWorkoutDays)), { from: day.date, to: day.date });
  const profile = profiles.find((p) => p.id === day.equipment_profile_id) ?? profiles[0]!;
  const [{ weaknessCells, usualVolumes }, publishedNext] = await Promise.all([groupPicture(groupId, day.date), loadPublishedNext()]);
  const [p] = plan({ dates: [day.date], history, candidates, policy, equipmentFor: () => profile, lastWorkoutDate: lastWorkout, lastMovementDate: lastMovement, weaknessCells, usualVolumes, publishedNext, alternatives: 5 });
  if (!p) return;
  const options = [{ candidateId: p.candidateId, score: p.score }, ...p.alternatives].filter((a) => a.candidateId !== day.main_workout_id).slice(0, 4);
  await sql`UPDATE program_days SET alternatives = ${sql.json(options as never)}, updated_at = now() WHERE id = ${dayId}`;
}

export { keyOf };

/**
 * Re-check the planner's rules on the planned days in [from, to] as they now sit, e.g. after Push forward, a drag or a
 * swap moved them: back-to-back heavy days or movements beyond their exception, benchmarks per week, lift-test spacing,
 * the same workout two days running, equipment at the day's location. Returns the first broken rule per day id.
 */
export async function checkPlannedDays(groupId: string, from: string, to: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const [policy, group, profiles] = await Promise.all([getPolicy(groupId), getGroup(groupId), getEquipmentProfiles(groupId)]);
  const days = await sql`
    SELECT d.id, d.date::text AS date, d.equipment_profile_id, w.id AS wid, w.name, w.structure, w.movements, w.score_type, w.tags, w.benchmark, w.original_text
    FROM program_days d JOIN workouts w ON w.id = d.main_workout_id
    WHERE d.group_id = ${groupId} AND d.status IN ('proposed','approved') AND d.date BETWEEN ${from} AND ${to}`;
  if (!days.length) return out;
  const [{ history }, publishedNext] = await Promise.all([loadPicture(groupId, addDays(from, -policy.windowDays)), loadPublishedNext()]);
  const byDate = new Map(history.map((h) => [h.date, h]));
  const defaultProfile = profiles.find((p) => p.id === group?.default_equipment_id) ?? profiles[0]!;
  for (const d of days) {
    const c: Candidate = { id: d.wid, workout: { id: d.wid, name: d.name ?? undefined, structure: withCap(d.structure, d.original_text), movements: d.movements, scoreType: d.score_type }, tags: d.tags, benchmark: d.benchmark };
    const window = history.filter((h) => h.date < d.date && h.date >= addDays(d.date, -policy.windowDays));
    const near = (n: number) => byDate.get(addDays(d.date, n));
    const profile = profiles.find((p) => p.id === d.equipment_profile_id) ?? defaultProfile;
    const reason = blocked(c, d.date, { dates: [], history, candidates: [], policy, equipmentFor: () => profile, lastWorkoutDate: new Map(), lastMovementDate: new Map(), publishedNext }, window, near(-1), near(1));
    if (reason && reason !== 'too long' && reason !== 'repeat not due yet') out.set(d.id, reason);
  }
  return out;
}
