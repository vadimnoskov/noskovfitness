import type { Workout, WorkoutTags, Result, ScoreBreakdown } from '@workspace/fitness-core';

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


export interface PlannedDay {
  id: string; date: string; seq: number; status: 'proposed' | 'approved' | 'done' | 'skipped';
  equipmentId: string | null; workoutId: string; name: string | null; benchmark: { category: string; label?: string } | null;
  workout: Workout; tags: WorkoutTags; origin: { by: string; score?: ScoreBreakdown };
  alternatives: { candidateId: string; score: ScoreBreakdown; name?: string | null; tags?: WorkoutTags; workout?: Workout }[];
  warnings: string[];
  volume?: { athleteId: string; name: string; warnings: string[] }[];
}
