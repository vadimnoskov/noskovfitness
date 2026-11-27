import { sql, checkPlannedDays } from '@workspace/fitness-db';
import { withCap, type Workout, type WorkoutTags, type ScoreBreakdown, amountsMissing } from '@workspace/fitness-core';
import { resolveWarmUp, lightDays, implementsOf, type DayWarmUp } from './warmups';
import { volumeWarningsFor } from './volume';

export interface PlannedDay {
  id: string; date: string; seq: number; status: 'proposed' | 'approved' | 'done' | 'skipped';
  equipmentId: string | null; workoutId: string; name: string | null; benchmark: { category: string; label?: string } | null;
  workout: Workout; tags: WorkoutTags; origin: { by: string; score?: ScoreBreakdown };
  alternatives: { candidateId: string; score: ScoreBreakdown; name?: string | null; tags?: WorkoutTags; workout?: Workout }[];
  warnings: string[];
  /** Volume-jump warnings per person (from today on). */
  volume: { athleteId: string; name: string; warnings: string[] }[];
  /** A planner rule this day breaks where it now sits (e.g. after Push forward or a move); null when fine. */
  ruleIssue: string | null;
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
  const light = await lightDays(groupId, from, to);
  const profs = await sql`SELECT e.id, e.items, g.default_equipment_id FROM equipment_profiles e JOIN groups g ON g.id = ${groupId} WHERE e.group_id = ${groupId}`;
  const profileItems = new Map(profs.map((p) => [p.id as string, p.items]));
  const defaultItems = profs.find((p) => p.id === p.default_equipment_id)?.items;
  const members = await sql`SELECT a.id, a.name FROM athletes a JOIN group_members gm ON gm.athlete_id = a.id WHERE gm.group_id = ${groupId} ORDER BY a.name`;
  const today = new Date().toISOString().slice(0, 10);
  const issues = await checkPlannedDays(groupId, from < today ? today : from, to);
  const vol = await volumeWarningsFor(members as unknown as { id: string; name: string }[],
    rows.filter((r) => r.status === 'proposed' || r.status === 'approved').map((r) => ({ date: r.date as string, workout: { id: r.wid, structure: withCap(r.structure, r.original_text), movements: r.movements, scoreType: r.score_type } as Workout })), today, groupId);
  return rows.map((r) => {
    const base: Workout = { id: r.wid, name: r.name ?? undefined, structure: withCap(r.structure, r.original_text), movements: r.movements, scoreType: r.score_type };
    // Amounts not read from the text: send the workout as written so the coach can read it.
    const workout: Workout = amountsMissing(base).length && r.original_text ? { ...base, originalText: r.original_text } : base;
    return {
    id: r.id, date: r.date, seq: r.seq, status: r.status, equipmentId: r.equipment_profile_id, workoutId: r.wid, name: r.name, benchmark: r.benchmark,
    workout, tags: r.tags, origin: r.origin,
    warmUp: resolveWarmUp(workout, r.tags, r.day_warm_up, r.workout_warm_up, { date: r.date, implementsAvailable: implementsOf(profileItems.get(r.equipment_profile_id) ?? defaultItems), longPractice: light.has(r.date) }),
    repeat: r.repeat_every_days ? { everyDays: r.repeat_every_days, until: r.repeat_until } : null,
    warnings: r.warnings,
    ruleIssue: issues.get(r.id) ?? null,
    volume: r.status === 'proposed' || r.status === 'approved'
      ? members.map((m) => ({ athleteId: m.id as string, name: m.name as string, warnings: vol.get(`${m.id}|${r.date}`) ?? [] })).filter((x) => x.warnings.length) : [],
    alternatives: (r.alternatives as PlannedDay['alternatives']).map((a) => {
      const w = altById.get(a.candidateId);
      return { ...a, name: w?.name, tags: w?.tags, workout: w ? { id: w.id, name: w.name ?? undefined, structure: w.structure, movements: w.movements, scoreType: w.score_type } : undefined };
    }),
  }; });
}
