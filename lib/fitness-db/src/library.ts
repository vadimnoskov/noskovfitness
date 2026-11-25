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
  const { builtAt, entries } = readLibrary(gz);
  const existing = await sql`SELECT id, signature, name, structure, movements, score_type, original_text FROM workouts`;
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
  for (const e of entries) {
    const sig = e.key.startsWith('bm:') ? e.key : `p:${e.key}`;
    const name = e.open ? `Open ${e.open}` : e.name;
    const bench = name ? benchmarkOf(name) : undefined;
    const known = bySig.get(sig) ?? byContent.get(contentSignature({ id: '', ...e.workout } as Workout));
    if (known) {
      if (bySig.get(sig) === known && sig.startsWith('p:')) alreadyImported++; else linked++;
      for (const d of e.dates) links.push({ workout_id: known, source: SOURCE, source_date: d });
      continue;
    }
    const def = withFemaleRx({ ...e.workout, ...(name ? { name } : {}) }, bench?.name);
    toInsert.push({ sig, e, def, bench });
  }

  // Movements the new workouts use (the movement table is keyed by the controlled identity).
  const refs = new Map<string, MovementRef>();
  for (const { def } of toInsert) for (const m of def.movements) refs.set(keyOf(m.movement), m.movement);
  const movementRows = [...refs.entries()].filter(([, r]) => FAMILY_BY_ID[r.family]).map(([key, r]) => {
    const f = FAMILY_BY_ID[r.family]!;
    return { key, family: r.family, name: nameOf(r), modality: f.modality, pattern: f.pattern, ref: sql.json(r as never) };
  });
  for (const part of chunk(movementRows, 500)) await sql`INSERT INTO movements ${sql(part)} ON CONFLICT (key) DO NOTHING`;

  for (const part of chunk(toInsert, 300)) {
    const rows = part.map(({ sig, e, def, bench }) => {
      const modern = e.dates.some((d) => d >= '2005-01-01');
      const programmable = e.clean && modern;
      const reason = programmable ? null : (e.flags[0] ?? (modern ? 'not clean' : 'early format (2001–2004)'));
      return {
        signature: sig, name: def.name ?? null, structure: sql.json(def.structure as never), movements: sql.json(def.movements as never),
        score_type: def.scoreType, benchmark: bench && bench.category !== 'lift' ? sql.json({ category: bench.category, retestEveryDays: bench.retestEveryDays, label: bench.name } as never) : null,
        tags: sql.json(deriveTags(def as Workout) as never), source: SOURCE, original_text: e.text, programmable, programmable_reason: reason,
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
  return { builtAt, entries: entries.length, inserted, linked, alreadyImported, ...(await libraryCounts()) };
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
