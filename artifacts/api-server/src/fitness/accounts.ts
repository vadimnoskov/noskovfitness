/**
 * Per-person accounts. Passwords are stored as scrypt hashes; a session is a random token in an HTTP-only cookie,
 * stored server-side only as its SHA-256 hash so it can be revoked (sign out, password change).
 *
 * First sign-in: the coach signs in with their name and the family password (APP_PASSWORD) until they set their own,
 * then sets everyone else's password on the Family page.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { sql } from '@workspace/fitness-db';
import type { LoadProfile } from '@workspace/fitness-core';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };
export const SESSION_COOKIE = 'nf_sid';
export const SESSION_DAYS = 90;

export interface User { id: string; name: string; sex: 'male' | 'female'; units: 'lb' | 'kg'; isCoach: boolean; canLogForOthers: boolean; hasPassword: boolean; loadProfile: LoadProfile | null }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !n || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { ...PARAMS, N: Number(n) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordProblem(pw: unknown): string | undefined {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 200) return 'That password is too long.';
  return undefined;
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

const toUser = (r: Record<string, unknown>): User => ({
  id: r.id as string, name: r.name as string, sex: r.sex as User['sex'], units: r.units as User['units'],
  isCoach: !!r.is_coach, canLogForOthers: !!r.can_log_for_others, hasPassword: !!r.password_hash,
  loadProfile: (r.a_load as LoadProfile | null) ?? null,
});

export async function findAthleteByName(name: string) {
  const [r] = await sql`SELECT id, name, sex, units, is_coach, can_log_for_others, password_hash, load_profile AS a_load FROM athletes WHERE lower(name) = lower(${name.trim()})`;
  return r ? { user: toUser(r), passwordHash: (r.password_hash as string | null) ?? null } : undefined;
}

export async function getAthlete(id: string): Promise<User | undefined> {
  const [r] = await sql`SELECT id, name, sex, units, is_coach, can_log_for_others, password_hash, load_profile AS a_load FROM athletes WHERE id = ${id}`;
  return r ? toUser(r) : undefined;
}

export async function getCoach(): Promise<User | undefined> {
  const [r] = await sql`SELECT id, name, sex, units, is_coach, can_log_for_others, password_hash, load_profile AS a_load FROM athletes WHERE is_coach ORDER BY id LIMIT 1`;
  return r ? toUser(r) : undefined;
}

export async function listAthletes(): Promise<User[]> {
  const rows = await sql`SELECT id, name, sex, units, is_coach, can_log_for_others, password_hash, load_profile AS a_load FROM athletes
    ORDER BY is_coach DESC, CASE sex WHEN 'female' THEN 0 ELSE 1 END, birth_year NULLS FIRST, name`;
  return rows.map(toUser);
}

export async function createSession(athleteId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await sql`INSERT INTO sessions (token_hash, athlete_id, expires_at) VALUES (${tokenHash(token)}, ${athleteId}, now() + ${`${SESSION_DAYS} days`}::interval)`;
  // Opportunistic cleanup of expired sessions.
  await sql`DELETE FROM sessions WHERE expires_at < now()`;
  return token;
}

export async function userForSession(token: string | undefined): Promise<User | undefined> {
  if (!token) return undefined;
  const [r] = await sql`SELECT a.id, a.name, a.sex, a.units, a.is_coach, a.can_log_for_others, a.password_hash, a.load_profile AS a_load
    FROM sessions s JOIN athletes a ON a.id = s.athlete_id WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > now()`;
  return r ? toUser(r) : undefined;
}

export async function endSession(token: string | undefined) {
  if (token) await sql`DELETE FROM sessions WHERE token_hash = ${tokenHash(token)}`;
}

/** Set a password and sign the person out everywhere else (keepToken stays signed in). */
export async function setPassword(athleteId: string, password: string, keepToken?: string) {
  await sql`UPDATE athletes SET password_hash = ${await hashPassword(password)} WHERE id = ${athleteId}`;
  await sql`DELETE FROM sessions WHERE athlete_id = ${athleteId} ${keepToken ? sql`AND token_hash <> ${tokenHash(keepToken)}` : sql``}`;
}

/** Save a person's standing load setting (fractions of the standard Rx; 1 = full Rx entries are dropped). */
export async function setLoadProfile(athleteId: string, profile: LoadProfile) {
  const clean = Object.fromEntries(Object.entries(profile).filter(([, v]) => typeof v === 'number' && v !== 1));
  await sql`UPDATE athletes SET load_profile = ${Object.keys(clean).length ? sql.json(clean) : null} WHERE id = ${athleteId}`;
}
