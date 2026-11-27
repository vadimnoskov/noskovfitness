import { sql } from '@workspace/fitness-db';
import { workMinutes, type Workout, type WorkoutTags, type Result } from '@workspace/fitness-core';

export const COACH_ID = 'vadim';
/** The family's program. Other programs (each coach's own athletes) are groups too; see programFor. */
export const GROUP_ID = 'family';

export interface Program { id: string; name: string; coachId: string | null; members: { id: string; name: string }[] }
/** Every program (group) with its members. */
export async function allPrograms(): Promise<Program[]> {
  const rows = await sql`SELECT g.id, g.name, g.coach_id,
      coalesce(json_agg(json_build_object('id', a.id, 'name', a.name) ORDER BY a.is_coach DESC, a.birth_year NULLS FIRST, a.name) FILTER (WHERE a.id IS NOT NULL), '[]') AS members
    FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id LEFT JOIN athletes a ON a.id = gm.athlete_id
    GROUP BY g.id ORDER BY (g.id = ${GROUP_ID}) DESC, g.name`;
  return rows.map((r) => ({ id: r.id as string, name: r.name as string, coachId: (r.coach_id as string | null) ?? null, members: r.members as Program['members'] }));
}
/** The programs a person coaches: the head coach coaches all of them; another coach only their own. */
export async function programsFor(user: { id: string; isCoach: boolean }): Promise<Program[]> {
  const all = await allPrograms();
  return user.isCoach ? all : all.filter((p) => p.coachId === user.id);
}
/** The program a coach screen or action is about (header X-Program), checked against what the person coaches. */
export async function programFor(user: { id: string; isCoach: boolean }, requested?: string | null): Promise<string> {
  const mine = await programsFor(user);
  // No program chosen yet (or the family's, for a coach of clients only): their first program.
  const id = requested && (requested !== GROUP_ID || user.isCoach) ? requested : user.isCoach ? GROUP_ID : mine[0]?.id ?? GROUP_ID;
  if (!mine.some((p) => p.id === id)) throw Object.assign(new Error('You do not coach this program.'), { status: 403 });
  return id;
}
/** The head coach, or the coach of a program the athlete trains in. */
export async function coachesAthlete(user: { id: string; isCoach: boolean }, athleteId: string): Promise<boolean> {
  if (user.isCoach) return true;
  return (await programsFor(user)).some((p) => p.members.some((m) => m.id === athleteId));
}
/** Anyone who coaches at least one program (Program, Calendar, Analysis, Settings, Athletes). */
export const isCoaching = async (user: { id: string; isCoach: boolean }) => user.isCoach || (await programsFor(user)).length > 0;
/** The program an athlete trains in (their group). */
export async function programOfAthlete(athleteId: string): Promise<string> {
  const [r] = await sql`SELECT group_id FROM group_members WHERE athlete_id = ${athleteId} ORDER BY (group_id = ${GROUP_ID}) DESC, group_id LIMIT 1`;
  return (r?.group_id as string | undefined) ?? GROUP_ID;
}
/**
 * The people someone may see and log for: themselves; everyone, for the head coach; the members of programs they
 * coach; and, for a family member allowed to log for others, the members of their own program (not other clients).
 */
export async function visibleAthleteIds(user: { id: string; isCoach: boolean; canLogForOthers: boolean }): Promise<Set<string>> {
  if (user.isCoach) return new Set((await sql`SELECT id FROM athletes`).map((r) => r.id as string));
  const rows = await sql`SELECT gm.athlete_id FROM group_members gm JOIN groups g ON g.id = gm.group_id
    WHERE g.coach_id = ${user.id}
       OR (${user.canLogForOthers} AND gm.group_id IN (SELECT group_id FROM group_members WHERE athlete_id = ${user.id}))`;
  return new Set([user.id, ...rows.map((r) => r.athlete_id as string)]);
}
const membersOf = async (groupId: string) => (await sql`SELECT athlete_id FROM group_members WHERE group_id = ${groupId}`).map((r) => r.athlete_id as string);

export interface Part {
  workoutId: string;
  name: string | null;
  benchmark: { category: string; label: string } | null;
  workout: Workout;
  tags: WorkoutTags;
  minutes?: number;
  /** Set for days that come from the program rather than history. */
  planStatus?: 'proposed' | 'approved' | 'done' | 'skipped';
  results: { athleteId: string; athlete: string; score: Result['score']; rx: boolean; completed: boolean; notes: string | null }[];
}
export interface Day { date: string; parts: Part[] }

/** Training history (and later the program) for the group between two dates, grouped by day. */
export async function getDays(from: string, to: string, groupId = GROUP_ID): Promise<Map<string, Day>> {
  const members = await membersOf(groupId);
  const rows = await sql`
    SELECT r.date::text AS date, r.workout_id, w.name, w.benchmark, r.performed, r.tags, r.score, r.as_prescribed, r.completed, r.notes,
           r.athlete_id, a.name AS athlete, r.created_at
    FROM results r JOIN workouts w ON w.id = r.workout_id JOIN athletes a ON a.id = r.athlete_id
    WHERE r.date BETWEEN ${from} AND ${to} AND r.athlete_id IN ${sql(members.length ? members : [''])}
    ORDER BY r.date, r.created_at DESC`;
  const days = new Map<string, Day>();
  for (const r of rows) {
    const day: Day = days.get(r.date) ?? { date: r.date, parts: [] };
    days.set(r.date, day);
    let part = day.parts.find((p) => p.workoutId === r.workout_id);
    if (!part) {
      // The coach's (or first athlete's) performance defines the day's part.
      part = { workoutId: r.workout_id, name: r.name, benchmark: r.benchmark, workout: r.performed, tags: r.tags, minutes: workMinutes(r.performed, r.score.timeSec), results: [] };
      day.parts.push(part);
    }
    part.results.push({ athleteId: r.athlete_id, athlete: r.athlete, score: r.score, rx: r.as_prescribed, completed: r.completed, notes: r.notes });
  }
  const planned = await sql`
    SELECT d.date::text AS date, d.status, w.id, w.name, w.benchmark, w.structure, w.movements, w.score_type, w.tags
    FROM program_days d JOIN workouts w ON w.id = d.main_workout_id
    WHERE d.group_id = ${groupId} AND d.date BETWEEN ${from} AND ${to} AND d.status IN ('proposed','approved')`;
  for (const r of planned) {
    const day: Day = days.get(r.date) ?? { date: r.date, parts: [] };
    days.set(r.date, day);
    if (day.parts.some((p) => p.workoutId === r.id)) continue;
    const workout = { id: r.id, name: r.name ?? undefined, structure: r.structure, movements: r.movements, scoreType: r.score_type };
    day.parts.push({ workoutId: r.id, name: r.name, benchmark: r.benchmark, workout, tags: r.tags, minutes: workMinutes(workout), planStatus: r.status, results: [] });
  }
  // Strength / practice parts first, the metcon last (like "A." and "B." in the sheet).
  for (const d of days.values()) d.parts.sort((a, b) => strengthRank(a) - strengthRank(b));
  return days;
}
const strengthRank = (p: Part) => (p.workout.structure.kind === 'sets' || (p.workout.structure.kind === 'max' && p.workout.structure.what === 'load') ? 0 : 1);

/** Combined header for a day, as in the sheet: one modality letter per movement, heaviest load, total time, main part's priority. */
export function dayHeader(d: Day) {
  const mods = d.parts.flatMap((p) => p.tags.modalityPattern);
  const rank = { bodyweight: 0, light: 1, medium: 2, heavy: 3 } as const;
  const load = d.parts.map((p) => p.tags.load).reduce((a, b) => (rank[b] > rank[a] ? b : a), 'bodyweight' as WorkoutTags['load']);
  const vrank = { low: 0, medium: 1, high: 2 } as const;
  const volume = d.parts.map((p) => p.tags.volume).reduce((a, b) => (vrank[b] > vrank[a] ? b : a), 'low' as WorkoutTags['volume']);
  const metcon = d.parts.filter((p) => strengthRank(p) === 1);
  const minutes = metcon.reduce((a, p) => a + (p.minutes ?? 0), 0);
  const main = metcon.at(-1) ?? d.parts.at(-1)!;
  return { mods, load, volume, minutes: minutes ? Math.round(minutes) : undefined, priority: main.tags.priority, benchmark: d.parts.some((p) => p.benchmark && p.benchmark.category !== 'lift') };
}

export async function getLatestDate(): Promise<string> {
  const [r] = await sql`SELECT max(date)::text AS d FROM results`;
  return (r?.d as string | null) ?? new Date().toISOString().slice(0, 10);
}

export async function getMovementUse(from: string, to: string, athleteId = COACH_ID) {
  return sql`
    SELECT r.date::text AS date, m.key, m.name, m.modality, m.family
    FROM results r JOIN workout_movements wm ON wm.workout_id = r.workout_id JOIN movements m ON m.key = wm.movement_key
    WHERE r.athlete_id = ${athleteId} AND r.date BETWEEN ${from} AND ${to}`;
}

export async function getMix(from: string, to: string, athleteId = COACH_ID) {
  return sql`SELECT r.date::text AS date, r.tags FROM results r WHERE r.athlete_id = ${athleteId} AND r.date BETWEEN ${from} AND ${to}`;
}

export async function getBenchmarks() {
  return sql`
    SELECT w.id, w.name, w.benchmark, w.structure, w.movements, w.score_type,
      coalesce(json_agg(json_build_object('athlete', a.name, 'athleteId', r.athlete_id, 'date', r.date::text, 'score', r.score, 'rx', r.as_prescribed, 'completed', r.completed)
        ORDER BY r.date DESC) FILTER (WHERE r.id IS NOT NULL), '[]') AS results
    FROM workouts w LEFT JOIN results r ON r.workout_id = w.id LEFT JOIN athletes a ON a.id = r.athlete_id
    WHERE w.benchmark IS NOT NULL GROUP BY w.id ORDER BY w.name`;
}

export async function getAthletes(groupId = GROUP_ID) {
  return sql`SELECT a.id, a.name, a.sex FROM athletes a JOIN group_members gm ON gm.athlete_id = a.id AND gm.group_id = ${groupId}
    ORDER BY a.is_coach DESC, CASE a.sex WHEN 'female' THEN 0 ELSE 1 END, a.birth_year NULLS FIRST, a.name`;
}
/** The person whose results stand for a program in Analysis: the coach in the family, else the first member. */
export async function analysisAthlete(groupId: string) {
  if (groupId === GROUP_ID) return COACH_ID;
  return (await membersOf(groupId))[0] ?? COACH_ID;
}
