/**
 * One-time import: family + equipment, all BTWB histories, Olga's manual notes, benchmark library, measurements.
 * Idempotent: wipes imported rows (source btwb-import / manual-notes) and reloads.
 * Usage: DATABASE_URL=... tsx packages/db/src/import.ts [dataDir=data/private]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseBtwbRow, deriveTags, keyOf, nameOf, FAMILY_BY_ID, benchmarkOf, normalizeWorkoutName, FEMALE_RX, MISSING_DEFINITIONS, resolve,
  type BtwbRow, type Workout, type MovementRef, type ParsedSession,
} from '@nf/core';
import { sql } from './client';
import { parseCsv } from './csv';

const dir = process.argv[2] ?? 'data/private';
const family = JSON.parse(readFileSync(join(dir, 'family.json'), 'utf8'));
const report: string[] = [];

// ---------- helpers ----------
const movementCache = new Set<string>();
async function ensureMovement(ref: MovementRef) {
  const key = keyOf(ref);
  if (movementCache.has(key)) return key;
  const f = FAMILY_BY_ID[ref.family]!;
  await sql`INSERT INTO movements (key, family, name, modality, pattern, ref) VALUES (${key}, ${ref.family}, ${nameOf(ref)}, ${f.modality}, ${f.pattern}, ${sql.json(ref as never)})
            ON CONFLICT (key) DO NOTHING`;
  movementCache.add(key);
  return key;
}

function signature(w: Workout): string {
  const bm = w.name ? benchmarkOf(w.name) : undefined;
  if (bm) return `bm:${bm.name.toLowerCase()}`;
  const mv = w.movements.map((m) => `${keyOf(m.movement)}:${m.reps ?? ''}:${m.distanceM ?? ''}:${m.calories ?? ''}`).join(',');
  return `w:${normalizeWorkoutName(w.name ?? '')}|${JSON.stringify(w.structure)}|${mv}`;
}

/** Fill in women's Rx loads on a benchmark definition when only the men's load is known. */
function withFemaleRx(w: Workout): Workout {
  const bm = w.name ? benchmarkOf(w.name) : undefined;
  const fx = bm ? FEMALE_RX[bm.name] : undefined;
  if (!fx) return w;
  const inUnit = (lb: number, unit: string) => (unit === 'kg' ? Math.round(lb / 2.20462) : lb); // FEMALE_RX is in lb
  return { ...w, movements: w.movements.map((m) => (m.load && fx[m.movement.family] && m.load.female === undefined ? { ...m, load: { ...m.load, female: inUnit(fx[m.movement.family]!, m.load.unit) } } : m)) };
}

const workoutIds = new Map<string, string>();
async function upsertWorkout(w: Workout): Promise<string> {
  const sig = signature(w);
  const known = workoutIds.get(sig);
  if (known) return known;
  const bm = w.name ? benchmarkOf(w.name) : undefined;
  const def = withFemaleRx({ ...w, name: bm && bm.category !== 'lift' && bm.category !== 'open' ? bm.name : w.name });
  const [row] = await sql`
    INSERT INTO workouts (signature, name, structure, movements, score_type, benchmark, tags, source, original_text)
    VALUES (${sig}, ${def.name ?? null}, ${sql.json(def.structure as never)}, ${sql.json(def.movements as never)}, ${def.scoreType},
            ${bm ? sql.json({ category: bm.category, retestEveryDays: bm.retestEveryDays, label: bm.name }) : null},
            ${sql.json(deriveTags(def) as never)}, ${def.source ?? null}, ${def.originalText ?? null})
    ON CONFLICT (signature) DO UPDATE SET signature = EXCLUDED.signature
    RETURNING id`;
  const id = row!.id as string;
  for (const [i, m] of def.movements.entries()) {
    const key = await ensureMovement(m.movement);
    await sql`INSERT INTO workout_movements (workout_id, position, movement_key) VALUES (${id}, ${i}, ${key}) ON CONFLICT DO NOTHING`;
  }
  workoutIds.set(sig, id);
  return id;
}

async function insertResult(athleteId: string, sex: 'male' | 'female', p: ParsedSession, extra: { uncertain?: boolean } = {}) {
  const workoutId = await upsertWorkout(p.workout);
  const tags = deriveTags(p.workout, { resultSec: p.result.score.timeSec, amrapRounds: p.result.score.rounds, sex });
  await sql`INSERT INTO results (athlete_id, date, workout_id, performed, as_prescribed, completed, score, tags, notes, source, uncertain)
    VALUES (${athleteId}, ${p.result.date}, ${workoutId}, ${sql.json(p.workout as never)}, ${p.result.asPrescribed}, ${p.result.completed},
            ${sql.json(p.result.score as never)}, ${sql.json(tags as never)}, ${p.result.notes ?? null}, ${p.result.source}, ${extra.uncertain ?? false})`;
}

// ---------- manual notes → export-style rows ----------
const LIFT_NAME: Record<string, string> = { 'Strict Press': 'Shoulder Press', 'Weighted Pull-up': 'Weighted Pull-up' };
const distLabel = (d: number) => (d === 1609 ? '1 mi' : d === 5000 ? '5 km' : d === 2000 ? '2 km' : `${d} m`);
const fmtTime = (s: number) => `${Math.floor(s / 60)} mins ${+(s % 60).toFixed(1)} secs`;

function manualToRow(r: any): BtwbRow | undefined {
  const base = { Date: r.date, Performed: r.rx === false ? 'modified' : 'prescribed', Notes: r.note ?? '' };
  if (r.what && r.repMax && r.load) {
    const lift = LIFT_NAME[r.what] ?? r.what;
    return { ...base, Workout: `${lift} : ${r.repMax} Rep Max`, Description: `${r.repMax} ${r.what} ${r.load} lbs`, 'Formatted Result': `${r.load} lbs`, Result: String(r.load) };
  }
  if (r.what && r.maxReps) return { ...base, Workout: `${r.what}s : Max Set`, Description: `${r.maxReps} ${r.what}s`, 'Formatted Result': `${r.maxReps} reps`, Result: String(r.maxReps) };
  if (r.what && r.distanceM && r.timeSec) {
    const verb = r.what === 'Row' ? 'Row' : 'Run';
    return { ...base, Workout: `${verb} ${distLabel(r.distanceM)} TT`, Description: `${r.distanceM} m ${verb}s`, 'Formatted Result': fmtTime(r.timeSec), Result: String(r.timeSec * 1000) };
  }
  if (r.what === 'Burpee' && r.reps && r.timeSec) return { ...base, Workout: `Burpees : ${r.reps} Reps for Time`, Description: `${r.reps} Burpees`, 'Formatted Result': fmtTime(r.timeSec), Result: String(r.timeSec * 1000) };
  return undefined;
}

// ---------- run ----------
await sql`TRUNCATE results, athlete_versions, program_days, workout_movements, workouts, measurements, equipment_profiles, group_members, groups, athletes, movements CASCADE`;

for (const a of family.athletes) {
  await sql`INSERT INTO athletes (id, name, birth_year, sex, units, is_coach, can_log_for_others)
            VALUES (${a.id}, ${a.name}, ${a.birthYear}, ${a.sex}, ${a.units}, ${a.isCoach}, ${a.canLogForOthers})`;
}
await sql`INSERT INTO groups (id, name, training_days) VALUES (${family.group.id}, ${family.group.name}, ${family.group.trainingDays})`;
for (const a of family.athletes) await sql`INSERT INTO group_members VALUES (${family.group.id}, ${a.id})`;
for (const e of family.equipment) await sql`INSERT INTO equipment_profiles VALUES (${e.id}, ${family.group.id}, ${e.name}, ${sql.json(e.items)})`;

// Missing benchmark definitions first, so history instances join them.
for (const d of MISSING_DEFINITIONS) {
  const p = parseBtwbRow({ Date: '2000-01-01', Workout: d.name, Description: d.description, 'Formatted Result': d.result, Result: '0', Performed: 'prescribed', Notes: '' }, 'male');
  await upsertWorkout({ ...p.workout, source: 'NF-WODs sheet (Hero/Misc tabs)' });
}

for (const a of family.athletes) {
  if (!a.btwb || !existsSync(join(dir, a.btwb))) continue;
  const rows = parseCsv(readFileSync(join(dir, a.btwb), 'utf8')) as unknown as BtwbRow[];
  rows.sort((x, y) => y.Date.localeCompare(x.Date)); // newest first: the latest instance defines a repeated workout
  let n = 0, skipped = 0;
  for (const r of rows) {
    const p = parseBtwbRow(r, a.sex);
    if (!p.workout.movements.length) { skipped++; continue; }
    await insertResult(a.id, a.sex, p); n++;
  }
  report.push(`${a.name}: ${n} sessions imported, ${skipped} skipped (no movements)`);
}

const manualPath = join(dir, 'manual_results.json');
if (existsSync(manualPath)) {
  const manual = JSON.parse(readFileSync(manualPath, 'utf8'));
  let n = 0; const skipped: string[] = [];
  for (const r of manual.results) {
    const a = family.athletes.find((x: any) => x.id === r.a)!;
    const date: string | null = r.date && /^\d{4}-\d\d-\d\d$/.test(r.date) ? r.date : r.date && /^\d{4}/.test(r.date) ? `${r.date.slice(0, 4)}-07-01` : null;
    const uncertain = !!r.uncertain || (date !== null && date !== r.date);
    if (!date) { skipped.push(`${r.a}: ${r.what ?? r.workout} (no date)`); continue; }
    const row = manualToRow({ ...r, date });
    if (row) { await insertResult(a.id, a.sex, { ...parseBtwbRow(row, a.sex), result: { ...parseBtwbRow(row, a.sex).result, source: 'manual-notes' } }, { uncertain }); n++; continue; }
    if (r.what === 'Broad Jump') {
      const mv = resolve('Broad Jump').ref!;
      const w: Workout = { id: '', name: 'Broad Jump : Max Distance', structure: { kind: 'max', what: 'distance' }, movements: [{ movement: mv }], scoreType: 'distance', source: 'manual-notes' };
      await insertResult(a.id, a.sex, { workout: w, result: { date, performed: w, asPrescribed: true, completed: true, score: { distanceM: +(r.distanceIn * 0.0254).toFixed(3) }, notes: r.note, source: 'manual-notes' }, warnings: [] }, { uncertain }); n++;
      continue;
    }
    if (r.workout && (r.timeSec || r.rounds !== undefined || r.reps)) {
      const bm = benchmarkOf(r.workout);
      const existing = bm ? workoutIds.get(`bm:${bm.name.toLowerCase()}`) : undefined;
      const score = { ...(r.timeSec ? { timeSec: r.timeSec } : {}), ...(r.rounds !== undefined ? { rounds: r.rounds } : {}), ...(r.reps !== undefined ? { reps: r.reps } : {}) };
      if (existing) {
        const [w] = await sql`SELECT name, structure, movements, score_type FROM workouts WHERE id = ${existing}`;
        const performed: Workout = { id: existing, name: w!.name, structure: w!.structure, movements: w!.movements, scoreType: w!.score_type };
        const tags = deriveTags(performed, { resultSec: r.timeSec, amrapRounds: r.rounds, sex: a.sex });
        await sql`INSERT INTO results (athlete_id, date, workout_id, performed, as_prescribed, completed, score, tags, notes, source, uncertain)
          VALUES (${a.id}, ${date}, ${existing}, ${sql.json(performed as never)}, ${r.rx !== false}, true, ${sql.json(score)}, ${sql.json(tags as never)}, ${r.note ?? null}, 'manual-notes', ${uncertain})`;
        n++;
      } else skipped.push(`${r.a}: ${r.workout} (workout not in library yet; kept in notes)`);
      continue;
    }
    skipped.push(`${r.a}: ${r.what ?? r.workout} (no score)`);
  }
  report.push(`Manual notes: ${n} results imported; skipped ${skipped.length}: ${skipped.join('; ')}`);
  for (const m of manual.measurements) await sql`INSERT INTO measurements VALUES (${m.a}, ${m.date}, ${m.kind}, ${m.value}, ${m.unit}) ON CONFLICT DO NOTHING`;
}

// Workout-level tags use the typical (median) Rx time so for-time workouts get a time domain.
const timed = await sql`SELECT w.id, w.name, w.structure, w.movements, w.score_type, percentile_cont(0.5) WITHIN GROUP (ORDER BY (r.score->>'timeSec')::numeric) AS med
  FROM workouts w JOIN results r ON r.workout_id = w.id WHERE r.as_prescribed AND r.score ? 'timeSec' GROUP BY w.id`;
for (const w of timed) {
  const tags = deriveTags({ id: w.id, name: w.name, structure: w.structure, movements: w.movements, scoreType: w.score_type }, { resultSec: Number(w.med) });
  await sql`UPDATE workouts SET tags = ${sql.json(tags as never)} WHERE id = ${w.id}`;
}

const [c] = await sql`SELECT (SELECT count(*) FROM workouts) w, (SELECT count(*) FROM workouts WHERE benchmark IS NOT NULL) b, (SELECT count(*) FROM results) r,
  (SELECT count(*) FROM movements) m, (SELECT count(*) FROM measurements) me`;
report.push(`Totals: ${c!.w} workouts (${c!.b} benchmarks), ${c!.r} results, ${c!.m} movements in use, ${c!.me} measurements`);
console.log(report.join('\n'));
await sql.end();
