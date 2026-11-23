import { sql, proposeRange, getGroup } from '@workspace/fitness-db';
import { pushForward, type SlotDay } from '@workspace/fitness-core';
import { GROUP_ID } from './data';

const done = () => {};
const str = (f: FormData, k: string) => String(f.get(k) ?? '');

export async function propose(f: FormData) {
  const from = str(f, 'from'), weeks = Math.min(8, Math.max(1, Number(str(f, 'weeks')) || 2));
  const to = new Date(Date.parse(from) + (weeks * 7 - 1) * 86400000).toISOString().slice(0, 10);
  await proposeRange(GROUP_ID, from, to);
  done();
}

export async function approve(f: FormData) {
  await sql`UPDATE program_days SET status = 'approved', updated_at = now() WHERE id = ${str(f, 'id')} AND status = 'proposed'`;
  done();
}

export async function approveAll(f: FormData) {
  await sql`UPDATE program_days SET status = 'approved', updated_at = now() WHERE group_id = ${GROUP_ID} AND status = 'proposed' AND date BETWEEN ${str(f, 'from')} AND ${str(f, 'to')}`;
  done();
}

export async function unapprove(f: FormData) {
  await sql`UPDATE program_days SET status = 'proposed', updated_at = now() WHERE id = ${str(f, 'id')} AND status = 'approved'`;
  done();
}

/** Coach picks one of the engine's alternatives (or any library workout by id). */
export async function swap(f: FormData) {
  const id = str(f, 'id'), workoutId = str(f, 'workoutId');
  if (!workoutId) return;
  await sql`UPDATE program_days SET main_workout_id = ${workoutId}, origin = ${sql.json({ by: 'coach', swappedFrom: 'engine-alternative' })}, updated_at = now() WHERE id = ${id}`;
  done();
}

export async function setLocation(f: FormData) {
  const id = str(f, 'id'), loc = str(f, 'equipmentId');
  const [d] = await sql`UPDATE program_days SET equipment_profile_id = ${loc}, updated_at = now() WHERE id = ${id} RETURNING date::text AS date, status`;
  // A proposed day is re-planned for the new location; an approved one keeps the coach's choice.
  if (d && d.status === 'proposed') await proposeRange(GROUP_ID, d.date, d.date);
  done();
}

async function slots(): Promise<SlotDay[]> {
  return (await sql`SELECT id, date::text AS date, status, seq FROM program_days WHERE group_id = ${GROUP_ID}`) as unknown as SlotDay[];
}
async function saveDates(before: SlotDay[], after: SlotDay[]) {
  const prev = new Map(before.map((d) => [d.id, d]));
  const changed = after.filter((d) => prev.get(d.id)?.date !== d.date || prev.get(d.id)?.status !== d.status);
  await sql.begin(async (tx) => {
    // Move in two steps so the (group, date, seq) uniqueness never collides mid-update.
    for (const d of changed) await tx`UPDATE program_days SET seq = seq + 100 WHERE id = ${d.id}`;
    for (const d of changed) await tx`UPDATE program_days SET date = ${d.date}, status = ${d.status}, seq = seq - 100, updated_at = now() WHERE id = ${d.id}`;
  });
}

export async function skip(f: FormData) {
  const id = str(f, 'id'), mode = str(f, 'mode');
  if (mode === 'drop') { await sql`UPDATE program_days SET status = 'skipped', updated_at = now() WHERE id = ${id}`; done(); return; }
  const group = await getGroup(GROUP_ID);
  const before = await slots();
  const day = before.find((d) => d.id === id);
  if (!day) return;
  await saveDates(before, pushForward(before, day.date, group.training_days));
  done();
}

/** Add a workout on a day that is not a normal training day (e.g. a Wednesday). */
export async function insert(f: FormData) {
  const date = str(f, 'date');
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return;
  await proposeRange(GROUP_ID, date, date, { extraDates: [date] });
  done();
}

export async function neverPropose(f: FormData) {
  await sql`UPDATE workouts SET programmable = false, programmable_reason = 'excluded by coach' WHERE id = ${str(f, 'workoutId')}`;
  const [d] = await sql`SELECT date::text AS date, status FROM program_days WHERE id = ${str(f, 'id')}`;
  if (d?.status === 'proposed') await proposeRange(GROUP_ID, d.date, d.date);
  done();
}

export async function replan(f: FormData) {
  await proposeRange(GROUP_ID, str(f, 'from'), str(f, 'to'));
  done();
}
