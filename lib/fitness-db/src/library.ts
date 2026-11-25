/**
 * Import the bundled workout library (data/published-library.json.gz) into the database. Additive and idempotent:
 * - a workout already in the database (same benchmark name, or same content as one from your history) is linked, not duplicated;
 * - new workouts are inserted with source 'published'; clean ones from 2005 on are programmable, the rest are kept for
 *   reference with the reason they are not proposed;
 * - every published appearance is recorded in workout_sources (for era weighting and anti-copy).
 * Nothing existing is edited: no names, results or settings change.
 */
import { gunzipSync } from 'node:zlib';
import { contentSignature, deriveTags, keyOf, nameOf, benchmarkOf, FAMILY_BY_ID, FEMALE_RX, withCap, type Workout, type MovementRef } from '@workspace/fitness-core';
import { sql } from './client';

interface Entry {
  key: string; name?: string; open?: string; text: string; dates: string[]; compareTo: string[]; flags: string[]; clean: boolean;
  workout: Omit<Workout, 'id'>;
}
export interface LibraryReport {
  builtAt: string; entries: number; inserted: number; linked: number; alreadyImported: number;
  /** Earlier published imports nothing used yet, replaced by this import's reading. */
  replaced: number;
  /** Already imported and unused: details refreshed from this import's reading. */
  refreshed: number;
  programmable: number; notProgrammable: number; opens: number; reasons: { reason: string; count: number }[];
}

const SOURCE = 'published';
const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Women's Rx for known benchmarks when the definition only has the men's load. */
function withFemaleRx(w: Omit<Workout, 'id'>, benchName?: string): Omit<Workout, 'id'> {
  const fx = benchName ? FEMALE_RX[benchName] : undefined;
  if (!fx) return w;
  return { ...w, movements: w.movements.map((m) => (m.load && fx[m.movement.family] && m.load.female === undefined
    ? { ...m, load: { ...m.load, female: m.load.unit === 'kg' ? Math.round(fx[m.movement.family]! / 2.20462) : fx[m.movement.family]! } } : m)) };
}

export function readLibrary(gz: Uint8Array): { builtAt: string; entries: Entry[] } {
  return JSON.parse(gunzipSync(gz).toString('utf8'));
}

export async function importLibrary(gz: Uint8Array): Promise<LibraryReport> {
  const { builtAt, entries: all } = readLibrary(gz);
  // 2001–2004 workouts (odd formats) stay in the bundled file for measuring principles, not in the library.
  const entries = all.filter((e) => e.dates.some((d) => d >= '2005-01-01'));
  // A changed reading of a workout replaces the earlier import (rows whose signature is no longer in the dataset), as long
  // as nothing uses it: no results, no program days or alternatives, no coach settings. Anything in use stays as it is.
  const current = entries.map((e) => (e.key.startsWith('bm:') ? e.key : `p:${e.key}`));
  const replaced = await sql`DELETE FROM workouts w WHERE w.source = ${SOURCE} AND NOT (w.signature = ANY(${current}))
      AND NOT EXISTS (SELECT 1 FROM results r WHERE r.workout_id = w.id)
      AND NOT EXISTS (SELECT 1 FROM program_days d WHERE d.main_workout_id = w.id OR d.practice_workout_id = w.id
                      OR d.alternatives @> jsonb_build_array(jsonb_build_object('candidateId', w.id::text)))
      AND w.warm_up IS NULL AND w.repeat_every_days IS NULL AND coalesce(w.programmable_reason, '') <> 'excluded by coach'
    RETURNING id`;
  const existing = await sql`SELECT id, signature, name, structure, movements, score_type, original_text, source FROM workouts`;
  const publishedIds = new Set(existing.filter((r) => r.source === SOURCE).map((r) => r.id as string));
  const bySig = new Map(existing.map((r) => [r.signature as string, r.id as string]));
  const byContent = new Map<string, string>();
  for (const r of existing) {
    const w = { id: r.id, name: r.name ?? undefined, structure: withCap(r.structure, r.original_text), movements: r.movements, scoreType: r.score_type } as Workout;
    const c = contentSignature(w);
    if (!byContent.has(c)) byContent.set(c, r.id as string);
  }

  let inserted = 0, linked = 0, alreadyImported = 0;
  const links: { workout_id: string; source: string; source_date: string }[] = [];
  const toInsert: { sig: string; e: Entry; def: Omit<Workout, 'id'>; bench?: ReturnType<typeof benchmarkOf> }[] = [];
  const toRefresh: { id: string; sig: string; e: Entry; def: Omit<Workout, 'id'>; bench?: ReturnType<typeof benchmarkOf> }[] = [];
  for (const e of entries) {
    const sig = e.key.startsWith('bm:') ? e.key : `p:${e.key}`;
    const name = e.open ? `Open ${e.open}` : e.name;
    const bench = name ? benchmarkOf(name) : undefined;
    const known = bySig.get(sig) ?? byContent.get(contentSignature({ id: '', ...e.workout } as Workout));
    const def = withFemaleRx({ ...e.workout, ...(name ? { name } : {}) }, bench?.name);
    if (known) {
      if (publishedIds.has(known) && bySig.get(sig) === known) { alreadyImported++; toRefresh.push({ id: known, sig, e, def, bench }); } else linked++;
      for (const d of e.dates) links.push({ workout_id: known, source: SOURCE, source_date: d });
      continue;
    }
    toInsert.push({ sig, e, def, bench });
  }

  // Movements the new workouts use (the movement table is keyed by the controlled identity).
  const refs = new Map<string, MovementRef>();
  for (const { def } of [...toInsert, ...toRefresh]) for (const m of def.movements) refs.set(keyOf(m.movement), m.movement);
  const movementRows = [...refs.entries()].filter(([, r]) => FAMILY_BY_ID[r.family]).map(([key, r]) => {
    const f = FAMILY_BY_ID[r.family]!;
    return { key, family: r.family, name: nameOf(r), modality: f.modality, pattern: f.pattern, ref: sql.json(r as never) };
  });
  for (const part of chunk(movementRows, 500)) await sql`INSERT INTO movements ${sql(part)} ON CONFLICT (key) DO NOTHING`;

  const fields = (e: Entry, def: Omit<Workout, 'id'>, bench?: ReturnType<typeof benchmarkOf>) => {
    const modern = e.dates.some((d) => d >= '2005-01-01');
    const programmable = e.clean && modern;
    const reason = programmable ? null : (e.flags.find((f) => !f.startsWith('early format')) ?? (modern ? 'not clean' : 'early format (2001–2004)'));
    return {
      name: def.name ?? null, structure: def.structure, movements: def.movements, score_type: def.scoreType,
      benchmark: bench && bench.category !== 'lift' ? { category: bench.category, retestEveryDays: bench.retestEveryDays, label: bench.name } : null,
      tags: deriveTags(def as Workout), original_text: e.text, programmable, programmable_reason: reason,
    };
  };

  // Same workout, newer reading (flags, text, women's loads): refresh it in place when nothing uses it.
  let refreshed = 0;
  for (const part of chunk(toRefresh, 500)) {
    const data = part.map(({ id, e, def, bench }) => ({ id, ...fields(e, def, bench) }));
    const ids = await sql`UPDATE workouts w SET name = x.name, structure = x.structure, movements = x.movements, score_type = x.score_type,
        benchmark = x.benchmark, tags = x.tags, original_text = x.original_text, programmable = x.programmable, programmable_reason = x.programmable_reason
      FROM jsonb_to_recordset(${sql.json(data as never)}) AS x(id uuid, name text, structure jsonb, movements jsonb, score_type text, benchmark jsonb,
        tags jsonb, original_text text, programmable boolean, programmable_reason text)
      WHERE w.id = x.id
        AND NOT EXISTS (SELECT 1 FROM results r WHERE r.workout_id = w.id)
        AND NOT EXISTS (SELECT 1 FROM program_days d WHERE d.main_workout_id = w.id OR d.practice_workout_id = w.id)
        AND w.warm_up IS NULL AND w.repeat_every_days IS NULL AND coalesce(w.programmable_reason, '') <> 'excluded by coach'
      RETURNING w.id`;
    refreshed += ids.length;
  }

  for (const part of chunk(toInsert, 300)) {
    const rows = part.map(({ sig, e, def, bench }) => {
      const f = fields(e, def, bench);
      return {
        signature: sig, name: f.name, structure: sql.json(f.structure as never), movements: sql.json(f.movements as never), score_type: f.score_type,
        benchmark: f.benchmark ? sql.json(f.benchmark as never) : null, tags: sql.json(f.tags as never), source: SOURCE,
        original_text: f.original_text, programmable: f.programmable, programmable_reason: f.programmable_reason,
      };
    });
    const ids = await sql`INSERT INTO workouts ${sql(rows)} ON CONFLICT (signature) DO UPDATE SET signature = EXCLUDED.signature RETURNING id, signature`;
    const idBySig = new Map(ids.map((r) => [r.signature as string, r.id as string]));
    const wm: { workout_id: string; position: number; movement_key: string }[] = [];
    for (const { sig, e, def } of part) {
      const id = idBySig.get(sig)!;
      def.movements.forEach((m, i) => { if (FAMILY_BY_ID[m.movement.family]) wm.push({ workout_id: id, position: i, movement_key: keyOf(m.movement) }); });
      for (const d of e.dates) links.push({ workout_id: id, source: SOURCE, source_date: d });
    }
    for (const p of chunk(wm, 1000)) await sql`INSERT INTO workout_movements ${sql(p)} ON CONFLICT DO NOTHING`;
    inserted += part.length;
  }
  const uniqueLinks = [...new Map(links.map((l) => [`${l.workout_id}|${l.source_date}`, l])).values()];
  for (const p of chunk(uniqueLinks, 1000)) await sql`INSERT INTO workout_sources ${sql(p)} ON CONFLICT DO NOTHING`;
  return { builtAt, entries: entries.length, inserted, linked, alreadyImported, refreshed, replaced: replaced.length, ...(await libraryCounts()) };
}

/** Counts for the quality report (from the database, so it reflects any later changes too). */
export async function libraryCounts(): Promise<Pick<LibraryReport, 'programmable' | 'notProgrammable' | 'opens' | 'reasons'>> {
  const [c] = await sql`SELECT count(*) FILTER (WHERE programmable)::int AS p, count(*) FILTER (WHERE NOT programmable)::int AS n,
      (SELECT count(*)::int FROM workouts WHERE benchmark->>'category' = 'open') AS opens FROM workouts WHERE source = ${SOURCE}`;
  const reasons = await sql`SELECT regexp_replace(regexp_replace(coalesce(programmable_reason, 'other'), ':.*$', ''), '"[^"]*"', '…', 'g') AS reason, count(*)::int AS count
    FROM workouts WHERE source = ${SOURCE} AND NOT programmable GROUP BY 1 ORDER BY 2 DESC`;
  return { programmable: c!.p, notProgrammable: c!.n, opens: c!.opens, reasons: reasons.map((r) => ({ reason: r.reason as string, count: r.count as number })) };
}

/** Flagged published workouts for review: newest first. */
export async function flaggedWorkouts(limit = 200, offset = 0) {
  return (await sql`SELECT w.id, w.name, w.original_text, w.programmable_reason, (SELECT max(source_date)::text FROM workout_sources s WHERE s.workout_id = w.id) AS last
    FROM workouts w WHERE w.source = ${SOURCE} AND NOT w.programmable ORDER BY last DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`)
    .map((r) => ({ id: r.id as string, name: r.name as string | null, text: r.original_text as string, reason: r.programmable_reason as string, last: r.last as string | null }));
}
