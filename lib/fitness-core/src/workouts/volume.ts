/**
 * Volume-jump warnings (L1 Training Guide, "Mitigate clients' risk of rhabdomyolysis", pp. 151–152): increase volume
 * slowly and gradually; jumping pull-ups and full-range GHD sit-ups (prolonged eccentric) carry the most risk; scale
 * reps for athletes who don't use a movement routinely, whatever their experience; and (L1, scaling) after a month or
 * more off, scale volume for at least two weeks. The guide gives "no exact rules for total volume", so the threshold
 * is a coach setting: warn when a workout asks for more than `factor` × the person's most reps of that movement in one
 * workout in the last 12 months.
 */
import type { Workout, MovementPrescription, Result } from '../model/types';
import { estimateMinutes } from './estimate';
import { FAMILY_BY_ID } from '../movements/catalog';

/** Movements counted separately: the two the L1 names for prolonged eccentric work. */
export function volumeKey(m: MovementPrescription): string {
  const f = m.movement.family;
  if (f === 'pull-up' && m.movement.style === 'jumping') return 'pull-up:jumping';
  if (f === 'sit-up' && m.movement.implement === 'ghd') return 'sit-up:ghd';
  if (f === 'jump-rope' && m.movement.variant === 'double-under') return 'jump-rope:du';
  return f;
}
export const ECCENTRIC_KEYS = new Set(['pull-up:jumping', 'sit-up:ghd']);
export const volumeLabel = (key: string) => {
  if (key === 'pull-up:jumping') return 'jumping pull-ups';
  if (key === 'sit-up:ghd') return 'GHD sit-ups';
  if (key === 'jump-rope:du') return 'double-unders';
  if (key === 'jump-rope') return 'jump-rope reps';
  const name = (FAMILY_BY_ID[key]?.name ?? key).toLowerCase();
  return /s$/.test(name) ? name : /(ch|sh|x)$/.test(name) ? `${name}es` : `${name}s`;
};

/** One pass through the movements as (key, reps); undefined when a movement's reps aren't known. Distance and time pieces are skipped. */
function pass(w: Workout): { key: string; reps: number }[] | undefined {
  const s = w.structure;
  const scheme = 'scheme' in s && s.scheme ? s.scheme : undefined;
  const repMoves = w.movements.filter((m) => !m.distanceM && !m.calories && !(m.seconds && !m.reps));
  const out: { key: string; reps: number }[] = [];
  if (scheme && repMoves.some((m) => m.reps === undefined)) { for (const n of scheme) for (const m of repMoves) out.push({ key: volumeKey(m), reps: m.reps ?? n }); }
  else for (const m of repMoves) { if (m.reps === undefined) return undefined; out.push({ key: volumeKey(m), reps: m.reps }); }
  return out;
}
const total = (seq: { key: string; reps: number }[], times = 1) => {
  const out = new Map<string, number>();
  for (const x of seq) out.set(x.key, (out.get(x.key) ?? 0) + x.reps * times);
  return out;
};
/** The first n reps of a repeating sequence, by movement. */
function walk(seq: { key: string; reps: number }[], n: number) {
  const per = seq.reduce((a, x) => a + x.reps, 0);
  const out = total(seq, Math.floor(n / per));
  let left = n - Math.floor(n / per) * per;
  for (const x of seq) { const k = Math.min(left, x.reps); if (k) out.set(x.key, (out.get(x.key) ?? 0) + k); left -= k; if (!left) break; }
  return out;
}

/**
 * Reps a workout asks for, by movement. AMRAPs are estimated from the time estimate of one round (marked `estimated`);
 * EMOMs share the minutes between their movements; strength sets add up the scheme.
 */
export function plannedReps(w: Workout): { reps: Map<string, number>; estimated: boolean } | undefined {
  const s = w.structure;
  if (s.kind === 'sets') {
    const sets = s.scheme.reduce((a, b) => a + b, 0);
    return { reps: new Map(w.movements.map((m) => [volumeKey(m), sets])), estimated: false };
  }
  const seq = pass(w);
  if (!seq?.length) return undefined;
  if (s.kind === 'for-time') return { reps: total(seq, s.rounds ?? 1), estimated: false };
  if (s.kind === 'intervals') return { reps: total(seq, s.rounds), estimated: false };
  if (s.kind === 'emom') return { reps: total(seq, Math.max(1, Math.floor(s.minutes / Math.max(1, w.movements.length)))), estimated: false };
  if (s.kind === 'amrap') {
    const round = estimateMinutes({ ...w, structure: { kind: 'for-time' } });
    if (!round) return undefined;
    return { reps: total(seq, Math.max(1, Math.round(s.minutes / round))), estimated: true };
  }
  return undefined;
}

/** Reps actually done in a logged result, by movement (for-time, capped, AMRAP, EMOM, intervals, strength sets). */
export function doneReps(r: Pick<Result, 'performed' | 'score' | 'completed'>): Map<string, number> | undefined {
  const w = r.performed, s = w.structure;
  if (s.kind === 'sets') return plannedReps(w)?.reps;
  const seq = pass(w);
  if (!seq?.length) return undefined;
  if (s.kind === 'for-time') {
    if (r.completed) return total(seq, s.rounds ?? 1);
    return r.score.reps !== undefined ? walk(seq, r.score.reps) : undefined;
  }
  if (s.kind === 'amrap') {
    const per = seq.reduce((a, x) => a + x.reps, 0);
    const n = (r.score.rounds ?? 0) * per + (r.score.reps ?? 0);
    return n > 0 ? walk(seq, n) : undefined;
  }
  if (s.kind === 'emom' || s.kind === 'intervals') return plannedReps(w)?.reps;
  return undefined;
}

export interface UsualVolume { most: Map<string, number>; lastDate?: string }
/** Each movement's most reps in one workout over the 12 months before `asOf`, and the person's last training date. */
export function usualVolume(results: (Pick<Result, 'performed' | 'score' | 'completed'> & { date: string })[], asOf: string): UsualVolume {
  const from = new Date(Date.parse(asOf) - 365 * 86400000).toISOString().slice(0, 10);
  const most = new Map<string, number>();
  let lastDate: string | undefined;
  for (const r of results) {
    if (r.date >= asOf) continue;
    if (!lastDate || r.date > lastDate) lastDate = r.date;
    if (r.date < from) continue;
    for (const [k, n] of doneReps(r) ?? []) most.set(k, Math.max(most.get(k) ?? 0, n));
  }
  return { most, lastDate };
}

export interface VolumeRules { factor: number; minReps: number; layoffDays: number }
export const DEFAULT_VOLUME_RULES: VolumeRules = { factor: 2, minReps: 30, layoffDays: 30 };

/**
 * Plain-language warnings for one person and one planned workout on `date`. The layoff is counted up to `today` (the
 * app only knows logged results), and shown on planned days in the two weeks from today.
 */
export function volumeWarnings(w: Workout, usual: UsualVolume, date: string, rules: VolumeRules = DEFAULT_VOLUME_RULES, today = date): string[] {
  const out: string[] = [];
  if (usual.lastDate) {
    const off = Math.round((Date.parse(today) - Date.parse(usual.lastDate)) / 86400000);
    const ahead = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
    if (off >= rules.layoffDays && ahead < 14) out.push(`no results logged for ${off} days: if that was time off, scale volume for the first two weeks back`);
  }
  const p = plannedReps(w);
  if (!p) return out;
  for (const [k, n] of p.reps) {
    const ecc = ECCENTRIC_KEYS.has(k);
    // Prolonged-eccentric movements warn at half the usual threshold.
    const min = ecc ? rules.minReps / 2 : rules.minReps, factor = ecc ? Math.max(1, rules.factor * 0.75) : rules.factor;
    if (n < min) continue;
    const most = usual.most.get(k) ?? 0;
    const about = p.estimated ? 'about ' : '';
    if (!most) out.push(`${about}${n} ${volumeLabel(k)}: none in the last 12 months${ecc ? ' (prolonged eccentric: start low)' : ''}`);
    else if (n > factor * most) out.push(`${about}${n} ${volumeLabel(k)}: ${Math.round((n / most) * 10) / 10}× the most in one workout in the last 12 months (${most})${ecc ? ' (prolonged eccentric)' : ''}`);
  }
  return out;
}
