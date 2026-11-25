/**
 * Build the bundled workout library from the published daily-workout archive (a CSV export of the spreadsheet).
 *
 *   pnpm --filter @workspace/fitness-db run build:library -- <archive.csv>
 *
 * Writes data/published-library.json.gz: one entry per distinct workout (structure, movements, cleaned
 * prescription text, every date it appeared, flags). No coaching prose, no brand names in titles.
 * The archive CSV itself is not kept in the repository.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePublishedRow, contentSignature, benchmarkOf, type PublishedRow, type Workout } from '@workspace/fitness-core';
import { parseCsv } from './csv';

export interface LibraryEntry {
  /** Stable key: benchmark name, else content signature. */
  key: string;
  name?: string;
  open?: string;
  workout: Omit<Workout, 'id' | 'originalText' | 'source'>;
  text: string;
  dates: string[];
  compareTo: string[];
  flags: string[];
  clean: boolean;
}

const file = process.argv.slice(2).find((a) => !a.startsWith('-'));
if (!file) { console.error('Usage: build:library -- <archive.csv>'); process.exit(1); }
const rows = parseCsv(readFileSync(file, 'utf8')) as unknown as PublishedRow[];
const parsed = rows.map(parsePublishedRow).filter((p) => !p.restDay && p.workout && p.workout.movements.length);

const byKey = new Map<string, LibraryEntry>();
for (const p of parsed.sort((a, b) => a.date.localeCompare(b.date))) {
  const w = p.workout!;
  const bm = w.name ? benchmarkOf(w.name) : undefined;
  const key = bm ? `bm:${bm.name.toLowerCase()}` : contentSignature(w);
  const prev = byKey.get(key);
  const { id: _id, originalText: _t, source: _s, ...def } = w;
  // Keep the most recent clean version as the definition (modern posts carry women's loads and heights).
  const take = !prev || (p.clean && (!prev.clean || p.date > prev.dates.at(-1)!));
  const entry: LibraryEntry = take
    ? { key, ...((w.name ?? prev?.name) ? { name: w.name ?? prev?.name } : {}), ...((p.open ?? prev?.open) ? { open: p.open ?? prev?.open } : {}), workout: def, text: p.text, dates: [...(prev?.dates ?? []), p.date], compareTo: [...new Set([...(prev?.compareTo ?? []), ...p.compareTo])], flags: p.flags, clean: p.clean }
    : { ...prev!, ...((prev!.name ?? w.name) ? { name: prev!.name ?? w.name } : {}), ...((prev!.open ?? p.open) ? { open: prev!.open ?? p.open } : {}), dates: [...prev!.dates, p.date], compareTo: [...new Set([...prev!.compareTo, ...p.compareTo])] };
  byKey.set(key, entry);
}
const entries = [...byKey.values()];
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'published-library.json.gz');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gzipSync(JSON.stringify({ builtAt: new Date().toISOString().slice(0, 10), entries })));
const clean = entries.filter((e) => e.clean).length;
console.log(`${rows.length} days → ${parsed.length} workouts → ${entries.length} distinct (${clean} clean, ${entries.length - clean} flagged, ${entries.filter((e) => e.open).length} Opens) → ${out}`);
