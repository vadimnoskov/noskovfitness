/**
 * Result logging and personal history. Prescription and performance stay separate: the workout is never edited;
 * a result stores exactly what this person did (including scaled loads) in `performed`.
 */
import { volumeWarningsFor } from './volume';
import { sql } from '@workspace/fitness-db';
import { nameOf, deriveTags, personalize, withCap, coachingNotes, compareResult, bestOf, prescribedReps, type PastResult, type Workout, type Result, type MovementPrescription, type ScoreType, type LoadProfile, type EquipmentProfile } from '@workspace/fitness-core';
import type { User } from './accounts';
import { GROUP_ID } from './data';
import { noteFor, type NoteArgs } from './ai-notes';
import { resolveWarmUp } from './warmups';

export class InputError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

const workoutOf = (r: Record<string, any>): Workout => ({
  id: r.id, name: r.name ?? undefined, structure: r.structure, movements: r.movements, scoreType: r.score_type,
  ...(r.benchmark ? { benchmark: r.benchmark } : {}),
});

/** Who may this user log or view results for? */
export function canActFor(user: User, athleteId: string) {
  return user.id === athleteId || user.canLogForOthers || user.isCoach;
}

/** A person, their standing load setting, and the equipment at a program day's location. */
async function personFor(athleteId: string) {
  const [a] = await sql`SELECT id, name, sex, units, load_profile FROM athletes WHERE id = ${athleteId}`;
  if (!a) throw new InputError('Unknown athlete.');
  return { id: a.id as string, name: a.name as string, sex: a.sex as 'male' | 'female', units: a.units as 'lb' | 'kg', loadProfile: (a.load_profile as LoadProfile | null) ?? null };
}

/** The person's own version (their Rx) of a program day's workout: profile + location + the coach's override for that day. */
export async function versionFor(dayId: string, athleteId: string) {
  const [d] = await sql`
    SELECT d.id, d.status, d.equipment_profile_id, d.warm_up AS day_warm_up, w.warm_up AS workout_warm_up, w.id AS wid, w.name, w.structure, w.movements, w.score_type, w.benchmark, w.tags, w.original_text,
           e.id AS eid, e.name AS ename, e.items, v.changes AS override
    FROM program_days d JOIN workouts w ON w.id = d.main_workout_id
    LEFT JOIN equipment_profiles e ON e.id = d.equipment_profile_id
    LEFT JOIN athlete_versions v ON v.day_id = d.id AND v.athlete_id = ${athleteId}
    WHERE d.id = ${dayId} AND d.group_id = ${GROUP_ID}`;
  if (!d) throw new InputError('Program day not found.');
  const person = await personFor(athleteId);
  const standard = workoutOf({ id: d.wid, name: d.name, structure: withCap(d.structure, d.original_text), movements: d.movements, score_type: d.score_type, benchmark: d.benchmark });
  const location: EquipmentProfile | undefined = d.eid ? { id: d.eid, name: d.ename, items: d.items } : undefined;
  const override = Array.isArray(d.override) && d.override.length
    ? Object.fromEntries((d.override as { index: number; to: number }[]).map((o) => [o.index, o.to])) : undefined;
  const v = personalize(standard, person, location, override);
  return { day: d, person, standard, version: v.workout, changes: v.changes, override: !!override, location: location?.name };
}

/** The planned workout(s) for a date, as this person's own version, plus what they already logged that day. */
export async function getToday(date: string, athleteId: string) {
  const days = await sql`
    SELECT d.id FROM program_days d
    WHERE d.group_id = ${GROUP_ID} AND d.date = ${date} AND d.status IN ('proposed','approved','done') ORDER BY d.seq`;
  const planned = [];
  for (const d of days) {
    const v = await versionFor(d.id, athleteId);
    const history = await previousOn(v.standard.id, athleteId, date);
    planned.push({
      dayId: d.id, status: v.day.status, workout: v.version, standard: v.standard, changes: v.changes, override: v.override, location: v.location, tags: v.day.tags,
      totalReps: prescribedReps(v.version), previous: history.slice(0, 5), previousCount: history.length,
      best: bestOf(v.standard.scoreType, history) ?? null, coaching: coachingNotes(v.version, history),
      warmUp: resolveWarmUp(v.standard, v.day.tags, v.day.day_warm_up, v.day.workout_warm_up),
      volumeWarnings: v.day.status === 'done' ? [] : (await volumeWarningsFor([{ id: athleteId, name: v.person.name }], [{ date, workout: v.version }], date)).get(`${athleteId}|${date}`) ?? [],
    });
  }
  const results = await myResults(athleteId, sql`r.date = ${date}`);
  return { date, planned, results };
}

/** The AI-written plan for one person on one program day (null when AI notes are off or the call failed). */
export async function getCoachingNote(dayId: string, athleteId: string): Promise<{ note: { approach: string; tips: string[] } | null; model?: string; edited?: string }> {
  const [e] = await sql`SELECT body FROM plan_edits WHERE day_id = ${dayId} AND athlete_id = ${athleteId}`;
  if (e) return { note: null, edited: e.body as string };
  return noteFor(await coachingNoteArgs(dayId, athleteId));
}

/** Coach's own text for one person's plan on a day; empty text removes it (back to the AI or built-in plan). */
export async function setPlanNote(dayId: string, athleteId: string, text: string) {
  const body = text.replace(/\r\n/g, '\n').trim();
  const [d] = await sql`SELECT id FROM program_days WHERE id = ${dayId} AND group_id = ${GROUP_ID}`;
  if (!d) throw new InputError('Program day not found.');
  if (!body) await sql`DELETE FROM plan_edits WHERE day_id = ${dayId} AND athlete_id = ${athleteId}`;
  else await sql`INSERT INTO plan_edits (day_id, athlete_id, body) VALUES (${dayId}, ${athleteId}, ${body})
    ON CONFLICT (day_id, athlete_id) DO UPDATE SET body = EXCLUDED.body, edited_at = now()`;
  return { ok: true };
}

/** The facts an AI note for this person and day is written from. */
export async function coachingNoteArgs(dayId: string, athleteId: string): Promise<NoteArgs> {
  const v = await versionFor(dayId, athleteId);
  const [a] = await sql`SELECT birth_year FROM athletes WHERE id = ${athleteId}`;
  const [d] = await sql`SELECT d.date::text AS date, d.coach_note, w.original_text FROM program_days d JOIN workouts w ON w.id = d.main_workout_id WHERE d.id = ${dayId}`;
  const previous = await previousOn(v.standard.id, athleteId, d!.date);
  return {
    dayId, athleteId, birthYear: a?.birth_year ?? null, date: d!.date, sex: v.person.sex, units: v.person.units,
    workoutText: (d!.original_text as string | null) ?? workoutTitleText(v.standard), version: v.version, changes: v.changes.map((c) => `${nameOf(v.standard.movements[c.index]!.movement)} ${c.from ?? '?'} → ${c.to} ${c.unit}`),
    previous, coachNote: d!.coach_note,
  };
}
const workoutTitleText = (w: Workout) => [w.name, ...w.movements.map((m) => `${m.reps ?? ''} ${nameOf(m.movement)}`.trim())].filter(Boolean).join('\n');

/** This person's earlier results on a workout (before a date), newest first, in the shape coaching and comparison use. */
async function previousOn(workoutId: string, athleteId: string, before: string): Promise<(PastResult & { id: string; notes: string | null })[]> {
  const rows = await sql`SELECT id, date::text AS date, score, as_prescribed, completed, notes FROM results
    WHERE workout_id = ${workoutId} AND athlete_id = ${athleteId} AND date < ${before} ORDER BY date DESC, created_at DESC LIMIT 50`;
  return rows.map((r) => ({ id: r.id, date: r.date, score: r.score, rx: r.as_prescribed, completed: r.completed, notes: r.notes }));
}

/** Coach sets (or resets) one person's weights for one program day. */
export async function setAthleteVersion(user: User, input: { dayId: string; athleteId: string; reset?: boolean; loads?: { index: number; value: number }[] }) {
  if (!user.isCoach) throw new InputError('Only the coach can change a version.', 403);
  if (input.reset) { await sql`DELETE FROM athlete_versions WHERE day_id = ${input.dayId} AND athlete_id = ${input.athleteId}`; return { ok: true }; }
  const base = await versionFor(input.dayId, input.athleteId);
  const override = (input.loads ?? []).map((l) => ({ index: Math.floor(l.index), to: num(l.value, 2000) })).filter((o): o is { index: number; to: number } => o.to !== undefined && o.index >= 0 && o.index < base.standard.movements.length);
  const v = personalize(base.standard, base.person, undefined, Object.fromEntries(override.map((o) => [o.index, o.to])));
  await sql`INSERT INTO athlete_versions (day_id, athlete_id, workout, changes) VALUES (${input.dayId}, ${input.athleteId}, ${sql.json(v.workout as never)}, ${sql.json(override as never)})
    ON CONFLICT (day_id, athlete_id) DO UPDATE SET workout = EXCLUDED.workout, changes = EXCLUDED.changes`;
  return { ok: true };
}

async function myResults(athleteId: string, where: any, limit = 200, offset = 0) {
  const rows = await sql`
    SELECT r.id, r.date::text AS date, r.score, r.as_prescribed, r.completed, r.notes, r.source, r.performed, r.day_id,
           r.entered_by, w.id AS workout_id, w.name, w.structure, w.movements, w.score_type, w.benchmark
    FROM results r JOIN workouts w ON w.id = r.workout_id
    WHERE r.athlete_id = ${athleteId} AND ${where}
    ORDER BY r.date DESC, r.created_at DESC, r.id LIMIT ${limit} OFFSET ${offset}`;
  return rows.map((r) => ({
    id: r.id, date: r.date, score: r.score as Result['score'], rx: r.as_prescribed, completed: r.completed, notes: r.notes,
    source: r.source, editable: r.source === 'app', dayId: r.day_id, performed: r.performed as Workout,
    workout: workoutOf({ id: r.workout_id, name: r.name, structure: r.structure, movements: r.movements, score_type: r.score_type, benchmark: r.benchmark }),
  }));
}

export async function getHistory(athleteId: string, opts: { q?: string; offset?: number; limit?: number }) {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 40));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const q = opts.q?.trim();
  const where = sql`TRUE
    ${q ? sql`AND (w.name ILIKE ${'%' + q + '%'} OR w.original_text ILIKE ${'%' + q + '%'} OR w.movements::text ILIKE ${'%' + q.toLowerCase().replace(/\s+/g, '-') + '%'})` : sql``}`;
  const results = await myResults(athleteId, where, limit + 1, offset);
  const [{ total } = { total: 0 }] = await sql`SELECT count(*)::int AS total FROM results WHERE athlete_id = ${athleteId}`;
  return { results: results.slice(0, limit), more: results.length > limit, total };
}

export async function getWorkoutDetail(workoutId: string, athleteId: string) {
  const [w] = await sql`SELECT id, name, structure, movements, score_type, benchmark, tags, original_text FROM workouts WHERE id = ${workoutId}`;
  if (!w) throw new InputError('Workout not found.', 404);
  const results = await myResults(athleteId, sql`r.workout_id = ${workoutId}`);
  return { workout: workoutOf({ ...w, structure: withCap(w.structure, w.original_text) }), tags: w.tags, originalText: w.original_text, results };
}

export async function searchWorkouts(q: string) {
  const term = q.trim();
  if (term.length < 2) return { workouts: [] };
  const rows = await sql`
    SELECT w.id, w.name, w.structure, w.movements, w.score_type, w.benchmark, count(r.id)::int AS times
    FROM workouts w LEFT JOIN results r ON r.workout_id = w.id
    WHERE w.name ILIKE ${'%' + term + '%'} OR w.original_text ILIKE ${'%' + term + '%'}
    GROUP BY w.id ORDER BY (w.benchmark IS NOT NULL) DESC, count(r.id) DESC, w.name LIMIT 20`;
  return { workouts: rows.map((r) => ({ workout: workoutOf(r), times: r.times })) };
}

// ---------- logging ----------

export interface LogInput {
  athleteId: string; date: string; workoutId: string; dayId?: string;
  asPrescribed: boolean; completed: boolean;
  score: { timeSec?: number; rounds?: number; reps?: number; loads?: number[]; distanceM?: number; calories?: number };
  /** Weights actually used, per movement index, in the athlete's units. */
  loads?: { index: number; value: number; unit?: 'lb' | 'kg' }[];
  /** What was changed when not Rx (e.g. "jumping pull-ups, 35 lb"). */
  scaling?: string;
  notes?: string;
}

const num = (v: unknown, max: number) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new InputError('Check the numbers in your score.');
  return n;
};

/** Keep only the score fields that make sense for this workout's score type. */
export function cleanScore(type: ScoreType, s: LogInput['score'], completed: boolean): Result['score'] {
  const out: Result['score'] = {};
  const timeSec = num(s.timeSec, 6 * 3600), rounds = num(s.rounds, 1000), reps = num(s.reps, 100000);
  const distanceM = num(s.distanceM, 500000), calories = num(s.calories, 10000);
  const loads = (s.loads ?? []).map((l) => num(l, 2000)).filter((l): l is number => l !== undefined);
  switch (type) {
    case 'time':
      if (completed) { if (!timeSec) throw new InputError('Enter your time.'); out.timeSec = timeSec; }
      else { if (reps === undefined) throw new InputError('Enter the reps you completed before the time cap.'); out.reps = reps; if (timeSec) out.timeSec = timeSec; }
      break;
    case 'rounds-reps':
      if (rounds === undefined) throw new InputError('Enter the rounds you completed.');
      out.rounds = Math.floor(rounds); out.reps = Math.floor(reps ?? 0);
      break;
    case 'load':
      if (!loads.length) throw new InputError('Enter at least one weight.');
      out.loads = loads;
      break;
    case 'reps': if (reps === undefined) throw new InputError('Enter your reps.'); out.reps = reps; break;
    case 'distance': if (!distanceM) throw new InputError('Enter the distance.'); out.distanceM = distanceM; break;
    case 'calories': if (!calories) throw new InputError('Enter the calories.'); out.calories = calories; break;
    case 'none': break;
  }
  return out;
}

export async function logResult(user: User, input: LogInput) {
  if (!canActFor(user, input.athleteId)) throw new InputError('You can only log your own results.', 403);
  const [athlete] = await sql`SELECT id, sex, units FROM athletes WHERE id = ${input.athleteId}`;
  if (!athlete) throw new InputError('Unknown athlete.');
  const [w] = await sql`SELECT id, name, structure, movements, score_type, benchmark FROM workouts WHERE id = ${input.workoutId}`;
  if (!w) throw new InputError('Workout not found.', 404);
  if (input.dayId) {
    const [d] = await sql`SELECT id FROM program_days WHERE id = ${input.dayId} AND group_id = ${GROUP_ID}`;
    if (!d) throw new InputError('Program day not found.');
  }
  const workout = workoutOf(w);
  const sex = athlete.sex as 'male' | 'female';
  // What was actually done: the prescription with this athlete's loads (Rx for their sex, or the scaled loads entered).
  const movements: MovementPrescription[] = workout.movements.map((m, i) => {
    // The weights actually used (the form pre-fills the Rx for this person's sex; scaled weights replace it).
    const scaled = input.loads?.find((l) => l.index === i);
    if (scaled) {
      const value = num(scaled.value, 2000);
      if (value === undefined) return m;
      return { ...m, load: { ...(m.load ?? {}), unit: scaled.unit ?? (athlete.units as 'lb' | 'kg'), [sex]: value } };
    }
    return m;
  });
  // Which version was done: their own (personal) Rx when logged "as prescribed" against a program day, else the standard.
  const mine = input.dayId && input.asPrescribed ? (await versionFor(input.dayId, input.athleteId)).version.version : undefined;
  const performed: Workout = { ...workout, movements, ...(mine ? { version: mine } : {}) };
  const score = cleanScore(workout.scoreType, input.score, input.completed);
  const tags = deriveTags(performed, { resultSec: score.timeSec, amrapRounds: score.rounds, sex });
  const notes = [input.scaling?.trim() ? `Scaled: ${input.scaling.trim()}` : '', input.notes?.trim() ?? ''].filter(Boolean).join('\n').slice(0, 2000) || null;
  const [row] = await sql`
    INSERT INTO results (athlete_id, date, day_id, workout_id, performed, as_prescribed, completed, score, tags, notes, source, entered_by)
    VALUES (${input.athleteId}, ${input.date}, ${input.dayId ?? null}, ${input.workoutId}, ${sql.json(performed as never)}, ${input.asPrescribed},
            ${input.completed}, ${sql.json(score as never)}, ${sql.json(tags as never)}, ${notes}, 'app', ${user.id})
    RETURNING id`;
  const earlier = await previousOn(input.workoutId, input.athleteId, input.date);
  const comparison = compareResult(workout.scoreType, { date: input.date, score, rx: input.asPrescribed, completed: input.completed }, earlier);
  return { ok: true, id: row!.id as string, comparison };
}

/** Only results entered in the app can be deleted (imported history is never rewritten). */
export async function deleteResult(user: User, id: string) {
  const [r] = await sql`SELECT athlete_id, source FROM results WHERE id = ${id}`;
  if (!r) throw new InputError('Result not found.', 404);
  if (r.source !== 'app') throw new InputError('Imported history cannot be deleted here.', 403);
  if (!canActFor(user, r.athlete_id)) throw new InputError('You can only delete your own results.', 403);
  await sql`DELETE FROM results WHERE id = ${id}`;
  return { ok: true };
}
