/**
 * Athletes and programs (coach). A program is a group with its own coach, training days, locations (equipment) and
 * programming settings: the family's program, and one for each client (or a small group of clients). Each athlete
 * trains in one program; Today, the planner and Individual Rx follow it.
 */
import { sql } from '@workspace/fitness-db';
import type { EquipmentItem } from '@workspace/fitness-core';
import { InputError } from './logging';
import type { User } from './accounts';
import { programsFor, GROUP_ID } from './data';

const IMPLEMENTS = new Set(['bodyweight', 'barbell', 'dumbbell', 'kettlebell', 'medball', 'sandbag', 'plate', 'rings', 'bar', 'parallettes', 'box', 'rope', 'ghd',
  'wall', 'sled', 'rower', 'air-bike', 'bike-erg', 'ski-erg', 'jump-rope', 'none', 'rack', 'bench', 'p-bars']);
const str = (f: Record<string, unknown>, k: string) => (typeof f[k] === 'string' ? (f[k] as string).trim() : '');
const DAY = /^\d{4}-\d\d-\d\d$/;

async function mayCoach(user: User, groupId: string) {
  if (!(await programsFor(user)).some((p) => p.id === groupId)) throw new InputError('You do not coach this program.', 403);
}
/** A short id from a name ("Saad Muntazim" → "saad"), unique among existing ids. */
async function newId(table: 'athletes' | 'groups' | 'equipment_profiles', name: string) {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'x';
  const taken = new Set((await sql`SELECT id FROM ${sql(table)} WHERE id LIKE ${`${base}%`}`).map((r) => r.id as string));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
const trainingDays = (v: unknown) => {
  const days = (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  return [...new Set(days)].sort();
};

/** Every program the person coaches, with members, locations and settings. */
export async function getPeople(user: User) {
  const programs = await programsFor(user);
  const ids = programs.map((p) => p.id);
  if (!ids.length) return { programs: [], coaches: [] };
  const [groups, members, locations, coaches] = await Promise.all([
    sql`SELECT id, training_days, default_equipment_id FROM groups WHERE id IN ${sql(ids)}`,
    sql`SELECT gm.group_id, a.id, a.name, a.sex, a.units, a.birth_year, a.birth_date::text AS birth_date, a.is_coach, (a.password_hash IS NOT NULL) AS has_password
        FROM group_members gm JOIN athletes a ON a.id = gm.athlete_id WHERE gm.group_id IN ${sql(ids)} ORDER BY a.is_coach DESC, a.birth_year NULLS FIRST, a.name`,
    sql`SELECT id, group_id, name, items FROM equipment_profiles WHERE group_id IN ${sql(ids)} ORDER BY name`,
    // Who can coach a program: the family's adults (the head coach, and family members who log for others).
    sql`SELECT a.id, a.name FROM athletes a JOIN group_members gm ON gm.athlete_id = a.id AND gm.group_id = ${GROUP_ID} WHERE a.is_coach OR a.can_log_for_others ORDER BY a.is_coach DESC, a.name`,
  ]);
  return {
    coaches: user.isCoach ? coaches : coaches.filter((c) => c.id === user.id),
    programs: programs.map((p) => {
      const g = groups.find((x) => x.id === p.id)!;
      return {
        id: p.id, name: p.name, coachId: p.coachId, family: p.id === GROUP_ID,
        trainingDays: g.training_days as number[], defaultLocation: (g.default_equipment_id as string | null) ?? null,
        members: members.filter((m) => m.group_id === p.id).map((m) => ({ id: m.id, name: m.name, sex: m.sex, units: m.units, birthYear: m.birth_year, birthDate: m.birth_date, isCoach: m.is_coach, hasPassword: m.has_password })),
        locations: locations.filter((l) => l.group_id === p.id).map((l) => ({ id: l.id, name: l.name, items: l.items })),
      };
    }),
  };
}

/** Add an athlete, into an existing program or a new one of their own. */
async function addAthlete(user: User, f: Record<string, unknown>) {
  const name = str(f, 'name'), sex = str(f, 'sex'), units = str(f, 'units') || 'lb', birthDate = str(f, 'birthDate');
  const birthYear = birthDate ? Number(birthDate.slice(0, 4)) : Number(str(f, 'birthYear')) || null;
  if (name.length < 2 || name.length > 60) throw new InputError('Enter the athlete\'s name.');
  if (!['male', 'female'].includes(sex)) throw new InputError('Choose male or female (used for Rx loads).');
  if (!['lb', 'kg'].includes(units)) throw new InputError('Choose lb or kg.');
  if (birthDate && (!DAY.test(birthDate) || !Number.isFinite(Date.parse(birthDate)))) throw new InputError('Enter the birth date as YYYY-MM-DD.');
  if (birthYear !== null && !(birthYear > 1920 && birthYear <= new Date().getFullYear())) throw new InputError('Check the birth year.');
  if ((await sql`SELECT 1 FROM athletes WHERE lower(name) = lower(${name})`).length) throw new InputError('Someone with that name already exists (names are used to sign in).');
  let groupId = str(f, 'program');
  if (groupId && groupId !== 'new') await mayCoach(user, groupId);
  const id = await newId('athletes', name.split(/\s+/)[0]!);
  await sql.begin(async (tx) => {
    if (!groupId || groupId === 'new') {
      groupId = await newId('groups', name.split(/\s+/)[0]!);
      const coach = user.isCoach && str(f, 'coachId') ? str(f, 'coachId') : user.id;
      const days = trainingDays(f.trainingDays);
      await tx`INSERT INTO groups (id, name, training_days, coach_id) VALUES (${groupId}, ${name}, ${days.length ? days : [1, 2, 4, 5]}, ${coach})`;
    }
    await tx`INSERT INTO athletes (id, name, birth_year, birth_date, sex, units, is_coach, can_log_for_others)
      VALUES (${id}, ${name}, ${birthYear}, ${birthDate || null}, ${sex}, ${units}, false, false)`;
    await tx`INSERT INTO group_members (group_id, athlete_id) VALUES (${groupId}, ${id})`;
  });
  return { ok: true, athleteId: id, programId: groupId };
}

/** Change a client's details (not the family's: those come from the family import). */
async function editAthlete(user: User, f: Record<string, unknown>) {
  const id = str(f, 'athleteId');
  const [m] = await sql`SELECT group_id FROM group_members WHERE athlete_id = ${id}`;
  if (!m) throw new InputError('Unknown athlete.', 404);
  await mayCoach(user, m.group_id as string);
  const birthDate = str(f, 'birthDate');
  if (birthDate && !DAY.test(birthDate)) throw new InputError('Enter the birth date as YYYY-MM-DD.');
  const units = str(f, 'units');
  await sql`UPDATE athletes SET
      birth_date = coalesce(${birthDate || null}::date, birth_date),
      birth_year = coalesce(${birthDate ? Number(birthDate.slice(0, 4)) : Number(str(f, 'birthYear')) || null}, birth_year),
      units = coalesce(${['lb', 'kg'].includes(units) ? units : null}, units)
    WHERE id = ${id}`;
  return { ok: true };
}

/** A program's name, coach, training days and default location. */
async function editProgram(user: User, f: Record<string, unknown>) {
  const id = str(f, 'programId');
  await mayCoach(user, id);
  const days = trainingDays(f.trainingDays);
  const coach = user.isCoach && id !== GROUP_ID ? str(f, 'coachId') || null : null;
  const loc = str(f, 'defaultLocation');
  if (loc && !(await sql`SELECT 1 FROM equipment_profiles WHERE id = ${loc} AND group_id = ${id}`).length) throw new InputError('Choose one of this program\'s locations.');
  await sql`UPDATE groups SET
      name = coalesce(${str(f, 'name') || null}, name),
      training_days = coalesce(${days.length ? days : null}, training_days),
      coach_id = coalesce(${coach}, coach_id),
      default_equipment_id = coalesce(${loc || null}, default_equipment_id)
    WHERE id = ${id}`;
  return { ok: true };
}

/** Add or change a location (its equipment) for a program. `items` is JSON: [{implement, quantity, loads?, note?}]. */
async function saveLocation(user: User, f: Record<string, unknown>) {
  const groupId = str(f, 'programId'), name = str(f, 'name');
  await mayCoach(user, groupId);
  if (name.length < 2) throw new InputError('Name the location.');
  let items: EquipmentItem[];
  try { items = JSON.parse(str(f, 'items') || '[]'); } catch { throw new InputError('The equipment list could not be read.'); }
  if (!Array.isArray(items) || items.some((i) => !IMPLEMENTS.has(i?.implement) || !(Number(i.quantity) >= 0))) throw new InputError('Unknown equipment in the list.');
  const clean = items.filter((i) => Number(i.quantity) > 0).map((i) => ({
    implement: i.implement, quantity: Math.round(Number(i.quantity)),
    ...(Array.isArray(i.loads) && i.loads.length ? { loads: i.loads.filter((l) => Number(l.value) > 0 && Number(l.qty) > 0).map((l) => ({ value: Number(l.value), unit: l.unit === 'kg' ? 'kg' : 'lb', qty: Math.round(Number(l.qty)) })) } : {}),
    ...(i.note ? { note: String(i.note).slice(0, 200) } : {}),
  }));
  let id = str(f, 'locationId');
  if (id) {
    const [l] = await sql`SELECT group_id FROM equipment_profiles WHERE id = ${id}`;
    if (!l || l.group_id !== groupId) throw new InputError('Unknown location.', 404);
    await sql`UPDATE equipment_profiles SET name = ${name}, items = ${sql.json(clean as never)} WHERE id = ${id}`;
  } else {
    id = await newId('equipment_profiles', `${groupId}-${name}`);
    await sql`INSERT INTO equipment_profiles (id, group_id, name, items) VALUES (${id}, ${groupId}, ${name}, ${sql.json(clean as never)})`;
    await sql`UPDATE groups SET default_equipment_id = ${id} WHERE id = ${groupId} AND default_equipment_id IS NULL`;
  }
  return { ok: true, locationId: id };
}

export const PEOPLE_ACTIONS = { addAthlete, editAthlete, editProgram, saveLocation } as const;
export async function peopleAction(user: User, action: string, f: Record<string, unknown>) {
  const fn = PEOPLE_ACTIONS[action as keyof typeof PEOPLE_ACTIONS];
  if (!fn) throw new InputError('Unknown action.', 404);
  if (!user.isCoach && !(await programsFor(user)).length) throw new InputError('Only a coach can do this.', 403);
  return fn(user, f);
}
