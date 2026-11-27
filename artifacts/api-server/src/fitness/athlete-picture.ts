/**
 * The athlete picture from data (Phase 5): body measurements, work and power per result, the power-versus-duration
 * curve (all time and per year), and power changes on repeated workouts.
 */
import { sql } from '@workspace/fitness-db';
import { powerPoints, weaknessGrid, type TimeDomain, type Modality, parseBtwbWeights, DIM_KINDS, DIM_LABELS, WORK_MODEL, DOUBLE_UNDER_IN, powerCurve, curveArea, dimsAt, powerChange, CURVE_MINUTES } from '@workspace/fitness-core';
import { InputError } from './logging';
import type { User } from './accounts';

function allowed(user: User, athleteId: string) {
  if (!user.isCoach && user.id !== athleteId) throw new InputError('You can only see your own numbers.', 403);
}

export async function getMeasurements(user: User, athleteId: string) {
  allowed(user, athleteId);
  const rows = await sql`SELECT kind, date::text AS date, value::float8 AS value, unit FROM measurements WHERE athlete_id = ${athleteId} ORDER BY date DESC`;
  const latest = Object.fromEntries(DIM_KINDS.map((k) => [k, rows.find((r) => r.kind === k) ?? null]));
  const counts: Record<string, number> = {}, range: Record<string, string> = {};
  for (const k of DIM_KINDS) {
    const ds = rows.filter((r) => r.kind === k).map((r) => r.date as string);
    counts[k] = ds.length;
    if (ds.length) range[k] = `${ds[ds.length - 1]} to ${ds[0]}`;
  }
  return { kinds: DIM_KINDS.map((k) => ({ kind: k, ...DIM_LABELS[k] })), latest, counts, range, history: rows.filter((r) => (DIM_KINDS as readonly string[]).includes(r.kind as string)).slice(0, 60) };
}

/** Save one set of measurements (any of the six) for a date. Lengths in in or cm, weight in lb or kg. */
export async function saveMeasurements(user: User, input: { athleteId: string; date: string; lengthUnit: string; weightUnit: string; values: Record<string, number> }) {
  allowed(user, input.athleteId);
  if (!/^\d{4}-\d\d-\d\d$/.test(input.date)) throw new InputError('Choose a valid date.');
  if (!['in', 'cm'].includes(input.lengthUnit) || !['lb', 'kg'].includes(input.weightUnit)) throw new InputError('Unknown unit.');
  const entries = Object.entries(input.values).filter(([, v]) => v !== null && v !== undefined && Number.isFinite(v));
  if (!entries.length) throw new InputError('Enter at least one measurement.');
  for (const [k, v] of entries) {
    if (!(DIM_KINDS as readonly string[]).includes(k)) throw new InputError(`Unknown measurement: ${k}.`);
    const max = k === 'weight' ? (input.weightUnit === 'kg' ? 250 : 550) : (input.lengthUnit === 'cm' ? 280 : 110);
    if (v <= 0 || v > max) throw new InputError(`${DIM_LABELS[k as keyof typeof DIM_LABELS].label} looks wrong.`);
  }
  await sql.begin(async (tx) => {
    for (const [k, v] of entries) {
      const unit = k === 'weight' ? input.weightUnit : input.lengthUnit;
      await tx`INSERT INTO measurements (athlete_id, date, kind, value, unit) VALUES (${input.athleteId}, ${input.date}, ${k}, ${v}, ${unit})
        ON CONFLICT (athlete_id, date, kind) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit`;
    }
  });
  return { ok: true };
}

/** Bodyweight history from a BTWB export. Existing weights on the same dates are replaced; other dates are kept. */
export async function importWeights(user: User, input: { athleteId: string; csv: string }) {
  allowed(user, input.athleteId);
  let rows;
  try { rows = parseBtwbWeights(input.csv); } catch (e) { throw new InputError((e as Error).message); }
  rows = rows.filter((r) => r.value > 0 && r.value < (r.unit === 'kg' ? 250 : 550));
  if (!rows.length) throw new InputError('No weights found in that file.');
  await sql.begin(async (tx) => {
    for (const r of rows) await tx`INSERT INTO measurements (athlete_id, date, kind, value, unit) VALUES (${input.athleteId}, ${r.date}, 'weight', ${r.value}, ${r.unit})
      ON CONFLICT (athlete_id, date, kind) DO UPDATE SET value = EXCLUDED.value, unit = EXCLUDED.unit`;
  });
  return { imported: rows.length, from: rows[0]!.date, to: rows[rows.length - 1]!.date };
}

export async function getAthletePicture(user: User, athleteId: string) {
  allowed(user, athleteId);
  const [[athlete], dims, results] = await Promise.all([
    sql`SELECT id, name, sex FROM athletes WHERE id = ${athleteId}`,
    sql`SELECT kind, date::text AS date, value::float8 AS value, unit FROM measurements WHERE athlete_id = ${athleteId}`,
    sql`SELECT r.id, r.date::text AS date, r.workout_id, r.performed, r.score, r.completed, r.as_prescribed, r.tags, coalesce(w.name, r.performed->>'name', '') AS name,
          md5(r.performed::text) AS sig
        FROM results r LEFT JOIN workouts w ON w.id = r.workout_id WHERE r.athlete_id = ${athleteId} ORDER BY r.date`,
  ]);
  if (!athlete) throw new InputError('Unknown athlete.', 404);
  const rows = dims.map((d) => ({ kind: d.kind as string, date: d.date as string, value: d.value as number, unit: d.unit as string }));
  const hasDims = !!dimsAt(rows, '9999-12-31');

  const { points, timed, missing, paces } = powerPoints(results as never, athlete.sex, rows);
  const grid = weaknessGrid(points, results.map((r) => ({ date: r.date as string, timeDomain: (r.tags as { timeDomain?: TimeDomain } | null)?.timeDomain,
    modalities: (r.tags as { modalityPattern?: Modality[] } | null)?.modalityPattern })), new Date().toISOString().slice(0, 10));
  const years = [...new Set(points.map((p) => p.date.slice(0, 4)))].sort();
  const byYear = years.map((y) => {
    const curve = powerCurve(points.filter((p) => p.date.startsWith(y)));
    return { year: y, curve: curve.map((c) => ({ minutes: c.minutes, power: c.power })), points: points.filter((p) => p.date.startsWith(y)).length };
  });
  // Compare years on the durations every year reaches, so the areas are like for like.
  const common = CURVE_MINUTES.filter((t) => byYear.every((y) => y.curve.find((c) => c.minutes === t)?.power !== null));
  const allTime = powerCurve(points);

  // Repeated workouts: same workout, same loads and movements, timed and finished. Power change = time ratio.
  type Row = (typeof results)[number];
  const groups = new Map<string, Row[]>();
  for (const r of results) {
    const s = (r.performed as { structure: { kind: string } }).structure.kind;
    if (s !== 'for-time' || !r.completed || !(r.score as { timeSec?: number }).timeSec) continue;
    const k = `${r.workout_id}|${r.sig}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const repeats = [...groups.values()].filter((g) => g.length >= 2).map((g) => {
    const t = (r: (typeof g)[number]) => (r.score as { timeSec: number }).timeSec;
    const first = g[0]!, last = g[g.length - 1]!, best = [...g].sort((a, b) => t(a) - t(b))[0]!;
    return { workoutId: first.workout_id, name: first.name || 'Unnamed workout', rx: first.as_prescribed, times: g.length,
      first: { date: first.date, sec: t(first) }, best: { date: best.date, sec: t(best) }, last: { date: last.date, sec: t(last) },
      lastVsFirst: powerChange(t(first), t(last)), bestVsFirst: powerChange(t(first), t(best)) };
  }).sort((a, b) => b.last.date.localeCompare(a.last.date));

  return {
    athlete: { id: athlete.id, name: athlete.name }, hasDims,
    coverage: { timed, counted: points.length, missing: [...missing.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([what, n]) => ({ what, n })) },
    allTime: allTime.map((c) => ({ minutes: c.minutes, power: c.power, from: c.from ? { date: c.from.date, name: c.from.name, id: c.from.id } : null })),
    byYear: byYear.map((y) => ({ ...y, area: curveArea(y.curve, common) })), commonMinutes: common,
    points: points.slice(-400), repeats: repeats.slice(0, 40),
    model: [
      { family: 'run, row, ski, bike', basis: 'machine' as const, rule: 'Concept2 formula: watts = 2.80 × speed³ (m/s); a piece inside a mixed workout uses your median speed that year from your pure pieces' },
      { family: 'double-under', basis: 'derived' as const, rule: `body × ${DOUBLE_UNDER_IN} in (matches BTWB)` },
      ...Object.entries(WORK_MODEL).map(([family, v]) => ({ family, ...v })),
    ],
    paces, grid,
  };
}
