/**
 * Import one athlete's BTWB history (the BTWB "export my data" CSV, or rows typed in the same columns) without touching
 * anyone else's records. Used for new clients. Each workout joins its library or history twin when the same workout
 * already exists (same signature as the family import); results already present (same athlete, date and workout)
 * are skipped, so importing the same file twice adds nothing.
 */
import { parseBtwbRow, deriveTags, movementModality, keyOf, nameOf, FAMILY_BY_ID, benchmarkOf, normalizeWorkoutName, type BtwbRow, type Workout, type MovementRef } from '@workspace/fitness-core';
import { sql } from './client';
import { parseCsv } from './csv';

/** Same signature as the family import (import.ts), so a client's Fran is the family's Fran. */
export function workoutSignature(w: Workout): string {
  const bm = w.name ? benchmarkOf(w.name) : undefined;
  if (bm) return `bm:${bm.name.toLowerCase()}`;
  const mv = w.movements.map((m) => `${keyOf(m.movement)}:${m.reps ?? ''}:${m.distanceM ?? ''}:${m.calories ?? ''}`).join(',');
  return `w:${normalizeWorkoutName(w.name ?? '')}|${JSON.stringify(w.structure)}|${mv}`;
}

async function ensureMovement(ref: MovementRef) {
  const key = keyOf(ref);
  const f = FAMILY_BY_ID[ref.family]!;
  await sql`INSERT INTO movements (key, family, name, modality, pattern, ref) VALUES (${key}, ${ref.family}, ${nameOf(ref)}, ${movementModality({ movement: ref })}, ${f.pattern}, ${sql.json(ref as never)})
            ON CONFLICT (key) DO NOTHING`;
  return key;
}

async function workoutId(w: Workout): Promise<string> {
  const sig = workoutSignature(w);
  const [found] = await sql`SELECT id FROM workouts WHERE signature = ${sig}`;
  if (found) return found.id as string;
  const bm = w.name ? benchmarkOf(w.name) : undefined;
  const def = { ...w, name: bm && bm.category !== 'lift' && bm.category !== 'open' ? bm.name : w.name };
  const [row] = await sql`
    INSERT INTO workouts (signature, name, structure, movements, score_type, benchmark, tags, source, original_text)
    VALUES (${sig}, ${def.name ?? null}, ${sql.json(def.structure as never)}, ${sql.json(def.movements as never)}, ${def.scoreType},
            ${bm ? sql.json({ category: bm.category, retestEveryDays: bm.retestEveryDays, label: bm.name }) : null},
            ${sql.json(deriveTags(def) as never)}, 'client history', ${def.originalText ?? null})
    ON CONFLICT (signature) DO UPDATE SET signature = EXCLUDED.signature RETURNING id`;
  const id = row!.id as string;
  for (const [i, m] of def.movements.entries()) {
    const key = await ensureMovement(m.movement);
    await sql`INSERT INTO workout_movements (workout_id, position, movement_key) VALUES (${id}, ${i}, ${key}) ON CONFLICT DO NOTHING`;
  }
  return id;
}

export interface HistoryImport { imported: number; duplicates: number; skipped: { date: string; workout: string; why: string }[]; from?: string; to?: string }

/** Import BTWB CSV text for one athlete. `enteredBy` is the coach doing it. */
export async function importAthleteHistory(athleteId: string, csv: string, enteredBy: string): Promise<HistoryImport> {
  const [a] = await sql`SELECT sex FROM athletes WHERE id = ${athleteId}`;
  if (!a) throw new Error('Unknown athlete.');
  const sex = a.sex as 'male' | 'female';
  const rows = (parseCsv(csv) as unknown as BtwbRow[]).filter((r) => r.Date && r.Workout);
  const out: HistoryImport = { imported: 0, duplicates: 0, skipped: [] };
  for (const r of rows) {
    if (!/^\d{4}-\d\d-\d\d$/.test(r.Date)) { out.skipped.push({ date: r.Date, workout: r.Workout, why: 'date is not YYYY-MM-DD' }); continue; }
    const p = parseBtwbRow({ ...r, 'Formatted Result': r['Formatted Result'] ?? '', Result: r.Result ?? '', Performed: r.Performed || 'prescribed', Description: r.Description ?? '', Notes: r.Notes ?? '' }, sex);
    if (!p.workout.movements.length) { out.skipped.push({ date: r.Date, workout: r.Workout, why: 'no movements recognized' }); continue; }
    const id = await workoutId(p.workout);
    const [dup] = await sql`SELECT 1 FROM results WHERE athlete_id = ${athleteId} AND date = ${p.result.date} AND workout_id = ${id}`;
    if (dup) { out.duplicates++; continue; }
    const tags = deriveTags(p.workout, { resultSec: p.result.score.timeSec, amrapRounds: p.result.score.rounds, sex });
    await sql`INSERT INTO results (athlete_id, date, workout_id, performed, as_prescribed, completed, score, tags, notes, source, entered_by)
      VALUES (${athleteId}, ${p.result.date}, ${id}, ${sql.json(p.workout as never)}, ${p.result.asPrescribed}, ${p.result.completed},
              ${sql.json(p.result.score as never)}, ${sql.json(tags as never)}, ${p.result.notes ?? null}, 'btwb-import', ${enteredBy})`;
    out.imported++;
    if (!out.from || p.result.date < out.from) out.from = p.result.date;
    if (!out.to || p.result.date > out.to) out.to = p.result.date;
  }
  return out;
}
