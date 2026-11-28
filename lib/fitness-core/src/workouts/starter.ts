/**
 * Starter tests for a new athlete (coach-approved 2026-11-28), drawn only from the knowledge cards:
 *  - charter-mci: mechanics, then consistency, then intensity: a movement check of the L1 foundational movements first;
 *  - scale-beginner-half: beginners do half intensity and volume for two weeks (and scale for at least a month);
 *  - heavy-beginner-reps: no single-rep max for beginners (a 1RM day becomes a 3RM day); heavy 5s instead;
 *  - skill-muscle-up-prereq: gymnastics benchmarks (strict pull-ups, push-ups, dips max sets);
 *  - var-benchmark-set: a short and a longer conditioning test (Tabata squats, Cindy) and a 1-mile run (2 km row
 *    where there is no running route);
 *  - assess-quarterly: re-test each quarterly and keep the results on one page.
 *
 * Every test is an existing library benchmark (same workout as in everyone's history), so results join the history,
 * Individual Rx and the benchmark re-test rules.
 */
import type { Workout } from '../model/types';
import { MOVEMENT_GUIDE } from '../knowledge/movements';
import { isSingleRepMax } from './rx';

/** One test slot: library workout names in order of preference (the first one the location allows is used). */
export interface StarterTest { key: string; label: string; names: string[]; cards: string[]; what: string; kind: 'strength' | 'gymnastics' | 'conditioning' }

export const STARTER_TESTS: StarterTest[] = [
  { key: 'squat-5rm', label: 'Back squat, heavy 5', names: ['Back Squat : 5 Rep Max'], cards: ['heavy-beginner-reps'], what: 'strength', kind: 'strength' },
  { key: 'pull-ups', label: 'Strict pull-ups, max set', names: ['Strict Pull-ups : Max Set'], cards: ['skill-muscle-up-prereq'], what: 'pulling strength and stamina', kind: 'gymnastics' },
  { key: 'deadlift-5rm', label: 'Deadlift, heavy 5', names: ['Deadlift : 5 Rep Max'], cards: ['heavy-beginner-reps'], what: 'strength', kind: 'strength' },
  { key: 'push-ups', label: 'Push-ups, max set', names: ['Push-ups : Max Set'], cards: ['skill-muscle-up-prereq'], what: 'pushing stamina', kind: 'gymnastics' },
  { key: 'press-5rm', label: 'Shoulder press, heavy 5', names: ['Shoulder Press : 5 Rep Max'], cards: ['heavy-beginner-reps'], what: 'strength', kind: 'strength' },
  { key: 'dips', label: 'Dips, max set', names: ['Bar Dips : Max Set', 'Ring Dips : Max Set'], cards: ['skill-muscle-up-prereq'], what: 'pushing strength and stamina', kind: 'gymnastics' },
  { key: 'cindy', label: 'Cindy', names: ['Cindy'], cards: ['var-benchmark-set'], what: 'longer conditioning (20 minutes)', kind: 'conditioning' },
  { key: 'mile', label: '1-mile run (2 km row without a running route)', names: ['Run 1 mi TT', 'Row 2 km TT'], cards: ['var-benchmark-set'], what: 'monostructural endurance', kind: 'conditioning' },
  { key: 'tabata-squat', label: 'Tabata squats', names: ['Tabata Squat'], cards: ['var-benchmark-set'], what: 'short conditioning (4 minutes)', kind: 'conditioning' },
];

/** Sessions, in order: a heavy lift with a gymnastics max set, alternating with a conditioning test. */
export const STARTER_SESSIONS: string[][] = [
  ['squat-5rm', 'pull-ups'], ['cindy'], ['deadlift-5rm', 'push-ups'], ['mile'], ['press-5rm', 'dips'], ['tabata-squat'],
];

/** Gymnastics benchmarks (L1 Gymnastics): levels for the max sets. */
export const GYMNASTICS_LEVELS: Record<string, number[]> = { 'pull-ups': [20, 25, 30], 'push-ups': [50, 75, 100], dips: [20, 30, 40, 50] };
/** Muscle-up practice starts around 15 strict pull-ups and 15 dips. */
export const MUSCLE_UP_START = 15;

/** The L1 foundational movements for the movement check, with their Movement Guide pages. */
export const FOUNDATIONAL_MOVEMENTS = MOVEMENT_GUIDE.slice(0, 9).map((g) => ({ key: g.key, name: g.title, pages: g.pages }));
export type ScreenMark = 'good' | 'needs-work' | 'not-here';

/** Beginner rules by day of the program (day 0 = the starter tests' first day). */
export const BEGINNER_RULES = { halfVolumeDays: 14, noSingleMaxDays: 28, conditioningTestsFrom: 14 };

export interface StarterSlot { date: string; seq: number; test: StarterTest; name: string }
export interface StarterPlan { slots: StarterSlot[]; notPossible: { test: StarterTest; why: string }[] }

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/**
 * Place the sessions on the program's training dates from `dates` (sorted). `allowed(name)` says whether a library
 * workout can be done at the location (equipment and limits) and exists; the first allowed name of each test is used.
 * Beginners do the lifts and max sets in the first two weeks and the conditioning tests from day 14 on (half volume
 * first, per scale-beginner-half); the days between stay open for the normal plan.
 */
export function starterPlan(dates: string[], allowed: (name: string) => boolean, opts: { beginner: boolean }): StarterPlan {
  const byKey = new Map(STARTER_TESTS.map((t) => [t.key, t]));
  const notPossible: StarterPlan['notPossible'] = [];
  const sessions: { tests: { test: StarterTest; name: string }[]; conditioning: boolean }[] = [];
  for (const keys of STARTER_SESSIONS) {
    const tests = [];
    for (const k of keys) {
      const test = byKey.get(k)!;
      const name = test.names.find(allowed);
      if (name) tests.push({ test, name });
      else notPossible.push({ test, why: 'not possible at this location (equipment or limits)' });
    }
    if (tests.length) sessions.push({ tests, conditioning: tests.every((t) => t.test.kind === 'conditioning') });
  }
  const order = opts.beginner ? [...sessions.filter((s) => !s.conditioning), ...sessions.filter((s) => s.conditioning)] : sessions;
  const slots: StarterSlot[] = [];
  if (!dates.length) return { slots, notPossible };
  const start = dates[0]!;
  let i = 0;
  for (const s of order) {
    if (opts.beginner && s.conditioning) while (i < dates.length && dates[i]! < addDays(start, BEGINNER_RULES.conditioningTestsFrom)) i++;
    const date = dates[i++];
    if (!date) { for (const t of s.tests) notPossible.push({ test: t.test, why: 'no training day left in the range' }); continue; }
    s.tests.forEach((t, n) => slots.push({ date, seq: n + 1, test: t.test, name: t.name }));
  }
  return { slots, notPossible };
}

/** Day of the starter period on `date` (0 = first day), or undefined before it starts. */
export function starterDay(from: string | undefined | null, date: string): number | undefined {
  if (!from) return undefined;
  const n = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
  return n >= 0 ? n : undefined;
}

/** A beginner's single-rep max becomes a 3-rep max (heavy-beginner-reps), during the first four weeks. */
export function beginnerMax(w: Workout): Workout | undefined {
  if (!isSingleRepMax(w)) return undefined;
  const name = w.name ? w.name.replace(/\b1 Rep Max\b|\b1RM\b/i, '3 Rep Max') : undefined;
  if (w.structure.kind === 'sets') return { ...w, name: name ? `${name} (beginner: 3s)` : undefined, structure: { ...w.structure, scheme: w.structure.scheme.map(() => 3) } };
  return { ...w, name: name && name !== w.name ? name : w.name ? `${w.name} (beginner: 3-rep max)` : undefined };
}

export interface StarterStatus { key: string; label: string; what: string; last?: { date: string; text: string }; due: boolean; dueOn?: string; level?: string }

/** Quarterly re-test (assess-quarterly): when each test was last done and whether it is due again. */
export const RETEST_EVERY_DAYS = 91;
export function starterStatus(last: Map<string, { date: string; text: string; reps?: number }>, today: string): StarterStatus[] {
  return STARTER_TESTS.map((t) => {
    const hit = t.names.map((n) => last.get(n)).filter(Boolean).sort((a, b) => b!.date.localeCompare(a!.date))[0];
    const dueOn = hit ? addDays(hit.date, RETEST_EVERY_DAYS) : undefined;
    const lv = GYMNASTICS_LEVELS[t.key];
    let level: string | undefined;
    if (lv && hit?.reps !== undefined) {
      const reached = lv.filter((x) => hit.reps! >= x).length;
      level = reached ? `benchmark ${reached} of ${lv.length} (${lv.join(' / ')})` : `below the first benchmark (${lv[0]})`;
      if ((t.key === 'pull-ups' || t.key === 'dips') && hit.reps < MUSCLE_UP_START) level += `; muscle-up work starts around ${MUSCLE_UP_START}`;
    }
    return { key: t.key, label: t.label, what: t.what, ...(hit ? { last: { date: hit.date, text: hit.text } } : {}), due: !hit || dueOn! <= today, ...(dueOn ? { dueOn } : {}), ...(level ? { level } : {}) };
  });
}
