import 'server-only';
import { sql } from '@nf/db';
import { workMinutes, type Workout, type WorkoutTags, type Result } from '@nf/core';

export const COACH_ID = 'vadim';
export const GROUP_ID = 'family';

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
export async function getDays(from: string, to: string): Promise<Map<string, Day>> {
  const rows = await sql`
    SELECT r.date::text AS date, r.workout_id, w.name, w.benchmark, r.performed, r.tags, r.score, r.as_prescribed, r.completed, r.notes,
           r.athlete_id, a.name AS athlete, r.created_at
    FROM results r JOIN workouts w ON w.id = r.workout_id JOIN athletes a ON a.id = r.athlete_id
    WHERE r.date BETWEEN ${from} AND ${to}
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
    WHERE d.group_id = ${GROUP_ID} AND d.date BETWEEN ${from} AND ${to} AND d.status IN ('proposed','approved')`;
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
  return r!.d as string;
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

export async function getAthletes() {
  return sql`SELECT id, name, sex FROM athletes ORDER BY CASE id WHEN 'vadim' THEN 1 WHEN 'olga' THEN 2 WHEN 'sasha' THEN 3 ELSE 4 END`;
}
