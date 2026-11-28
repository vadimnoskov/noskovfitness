/**
 * Starter tests for a new athlete (fitness-core starter.ts): schedule them on the program's first training days, keep
 * the movement check, and show each test's last result and when it is due again (quarterly).
 */
import { sql, getGroup, getEquipmentProfiles, proposeRange } from '@workspace/fitness-db';
import { starterPlan, starterStatus, checkEquipment, withCap, scoreText, trainingDatesBetween, FOUNDATIONAL_MOVEMENTS, STARTER_TESTS, BEGINNER_RULES, type Workout, type ScreenMark } from '@workspace/fitness-core';
import { InputError } from './logging';
import { coachesAthlete, programOfAthlete } from './data';
import type { User } from './accounts';

export interface Starter { from?: string; beginner?: boolean; screen?: Record<string, ScreenMark>; screenDate?: string }
const DAY = /^\d{4}-\d\d-\d\d$/;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const str = (f: Record<string, unknown>, k: string) => (typeof f[k] === 'string' ? (f[k] as string).trim() : '');
const NAMES = [...new Set(STARTER_TESTS.flatMap((t) => t.names))];

async function mayCoach(user: User, athleteId: string) {
  if (!(await coachesAthlete(user, athleteId))) throw new InputError('You do not coach this athlete.', 403);
}
export async function starterOf(athleteId: string): Promise<Starter | null> {
  const [a] = await sql`SELECT starter FROM athletes WHERE id = ${athleteId}`;
  return (a?.starter as Starter | null) ?? null;
}

/** The starter section of the athlete picture. */
export async function getStarter(athleteId: string, today: string) {
  const [starter, last, days] = await Promise.all([
    starterOf(athleteId),
    sql`SELECT DISTINCT ON (w.name) w.name, r.date::text AS date, r.score, r.completed FROM results r JOIN workouts w ON w.id = r.workout_id
        WHERE r.athlete_id = ${athleteId} AND w.name IN ${sql(NAMES)} ORDER BY w.name, r.date DESC`,
    sql`SELECT d.id, d.date::text AS date, d.seq, d.status, d.origin->>'test' AS test, w.name FROM program_days d JOIN workouts w ON w.id = d.main_workout_id
        WHERE d.group_id = ${await programOfAthlete(athleteId)} AND d.origin->>'by' = 'starter' AND d.status IN ('proposed','approved','done') ORDER BY d.date, d.seq`,
  ]);
  const map = new Map(last.map((r) => [r.name as string, { date: r.date as string, text: scoreText({ score: r.score, completed: r.completed }), reps: (r.score as { reps?: number })?.reps }]));
  return {
    starter, rules: BEGINNER_RULES,
    tests: starterStatus(map, today),
    scheduled: days.map((d) => ({ id: d.id as string, date: d.date as string, status: d.status as string, test: d.test as string, name: d.name as string })),
    movements: FOUNDATIONAL_MOVEMENTS,
  };
}

/**
 * Put the starter tests on the athlete's program from `from` (the next 5 weeks of training days), as approved days,
 * then re-plan the open days around them. Only for a program of one: in a shared program they would change everyone's days.
 */
export async function scheduleStarter(user: User, f: Record<string, unknown>) {
  const athleteId = str(f, 'athleteId'), from = str(f, 'from'), beginner = str(f, 'beginner') === '1';
  await mayCoach(user, athleteId);
  if (!DAY.test(from)) throw new InputError('Choose the first day.');
  const groupId = await programOfAthlete(athleteId);
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM group_members WHERE group_id = ${groupId}`;
  if (n > 1) throw new InputError('Starter tests are scheduled for a program of one athlete; in a shared program they would change everyone\'s days.');
  const to = addDays(from, 34);
  const [group, profiles, existing, rows] = await Promise.all([
    getGroup(groupId), getEquipmentProfiles(groupId),
    sql`SELECT date::text AS date, status, equipment_profile_id, origin->>'by' AS by FROM program_days WHERE group_id = ${groupId} AND date BETWEEN ${from} AND ${to}`,
    sql`SELECT DISTINCT ON (name) id, name, structure, movements, score_type, original_text FROM workouts WHERE name IN ${sql(NAMES)} ORDER BY name, (benchmark IS NOT NULL) DESC, created_at`,
  ]);
  if (!profiles.length) throw new InputError('Add the athlete\'s location (equipment) on Athletes first.');
  const profile = profiles.find((p) => p.id === group.default_equipment_id) ?? profiles[0]!;
  const workouts = new Map(rows.map((r) => [r.name as string, { id: r.id as string, name: r.name as string, structure: withCap(r.structure, r.original_text), movements: r.movements, scoreType: r.score_type } as Workout]));
  // Days the coach already fixed (approved or done, other than earlier starter days) stay as they are.
  const fixed = new Set(existing.filter((d) => d.status !== 'proposed' && d.by !== 'starter').map((d) => d.date as string));
  const dates = trainingDatesBetween(from, to, group.training_days).filter((d) => !fixed.has(d));
  const plan = starterPlan(dates, (name) => { const w = workouts.get(name); return !!w && checkEquipment(w, profile, 1).ok; }, { beginner });
  if (!plan.slots.length) throw new InputError('None of the starter tests can be done at this program\'s location.');
  await sql.begin(async (tx) => {
    // Re-scheduling replaces earlier starter days that are not done yet.
    await tx`DELETE FROM program_days WHERE group_id = ${groupId} AND origin->>'by' = 'starter' AND status IN ('proposed','approved') AND date >= ${from}`;
    const used = [...new Set(plan.slots.map((s) => s.date))];
    await tx`DELETE FROM program_days WHERE group_id = ${groupId} AND status = 'proposed' AND date IN ${tx(used)}`;
    for (const s of plan.slots) {
      await tx`INSERT INTO program_days (group_id, date, seq, status, equipment_profile_id, main_workout_id, origin, alternatives, warnings)
        VALUES (${groupId}, ${s.date}, ${s.seq}, 'approved', ${profile.id}, ${workouts.get(s.name)!.id},
          ${tx.json({ by: 'starter', test: s.test.key, cards: s.test.cards } as never)}, ${tx.json([] as never)}, ${tx.json([] as never)})`;
    }
    const prev = (await tx`SELECT starter FROM athletes WHERE id = ${athleteId}`)[0]?.starter as Starter | null;
    await tx`UPDATE athletes SET starter = ${tx.json({ ...(prev ?? {}), from: plan.slots[0]!.date, beginner } as never)} WHERE id = ${athleteId}`;
  });
  // The open days in the period, planned around the tests.
  await proposeRange(groupId, from, addDays(plan.slots[plan.slots.length - 1]!.date, 0));
  return { ok: true, scheduled: plan.slots.map((s) => ({ date: s.date, test: s.test.label, workout: s.name })), notPossible: plan.notPossible.map((x) => ({ test: x.test.label, why: x.why })) };
}

/** The movement check: each foundational movement marked good, needs work, or not possible at this location. */
export async function saveScreen(user: User, f: Record<string, unknown>) {
  const athleteId = str(f, 'athleteId'), date = str(f, 'date');
  await mayCoach(user, athleteId);
  if (!DAY.test(date)) throw new InputError('Choose the date of the check.');
  let marks: Record<string, string>;
  try { marks = JSON.parse(str(f, 'marks') || '{}'); } catch { throw new InputError('The movement check could not be read.'); }
  const keys = new Set(FOUNDATIONAL_MOVEMENTS.map((m) => m.key));
  const screen = Object.fromEntries(Object.entries(marks).filter(([k, v]) => keys.has(k) && ['good', 'needs-work', 'not-here'].includes(v)));
  const prev = await starterOf(athleteId);
  await sql`UPDATE athletes SET starter = ${sql.json({ ...(prev ?? {}), screen, screenDate: date } as never)} WHERE id = ${athleteId}`;
  return { ok: true };
}

/** Stop the beginner rules early (or undo a scheduling): future starter days that are not done are removed too. */
export async function clearStarter(user: User, f: Record<string, unknown>) {
  const athleteId = str(f, 'athleteId');
  await mayCoach(user, athleteId);
  const groupId = await programOfAthlete(athleteId);
  const today = str(f, 'today') || new Date().toISOString().slice(0, 10);
  await sql`DELETE FROM program_days WHERE group_id = ${groupId} AND origin->>'by' = 'starter' AND status IN ('proposed','approved') AND date >= ${today}`;
  const prev = await starterOf(athleteId);
  await sql`UPDATE athletes SET starter = ${prev?.screen ? sql.json({ screen: prev.screen, screenDate: prev.screenDate } as never) : null} WHERE id = ${athleteId}`;
  return { ok: true };
}
