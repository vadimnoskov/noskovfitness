/**
 * Resolve every movement phrase found in the BTWB exports against the catalog.
 * Input:  data/private/movement_phrases.tsv  (count \t phrase \t example) from tools/extract_movements.py
 * Output: data/private/movement_resolution.json + a console summary.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from '../packages/core/src/movements/resolver';
import { FAMILY_BY_ID } from '../packages/core/src/movements/catalog';

const rows = readFileSync('data/private/movement_phrases.tsv', 'utf8').trim().split('\n').map((l) => {
  const [n, phrase, example] = l.split('\t');
  return { n: Number(n), phrase: phrase!, example: example ?? '' };
});

type Canon = { key: string; name: string; family: string; modality: string; n: number; aliases: { phrase: string; n: number }[] };
const canon = new Map<string, Canon>();
const review: { phrase: string; n: number; kind: string; guess?: string }[] = [];
let total = 0, ok = 0;
for (const r of rows) {
  total += r.n;
  const res = resolve(r.phrase);
  if (!res.ref || res.review === 'unknown') { review.push({ phrase: r.phrase, n: r.n, kind: 'unknown' }); continue; }
  if (res.review === 'complex') review.push({ phrase: r.phrase, n: r.n, kind: 'complex', guess: res.name });
  ok += r.n;
  const c = canon.get(res.key!) ?? { key: res.key!, name: res.name!, family: res.ref.family, modality: FAMILY_BY_ID[res.ref.family]!.modality, n: 0, aliases: [] };
  c.n += r.n; c.aliases.push({ phrase: r.phrase, n: r.n });
  canon.set(res.key!, c);
}
const list = [...canon.values()].sort((a, b) => b.n - a.n);
const families = new Set(list.map((c) => c.family));
writeFileSync('data/private/movement_resolution.json', JSON.stringify({ total, resolved: ok, phrases: rows.length, canonical: list, review }, null, 1));
console.log(`phrases ${rows.length} | mentions ${total} | resolved ${ok} (${((ok / total) * 100).toFixed(1)}%)`);
console.log(`canonical movements ${list.length} in ${families.size} families`);
console.log(`unknown ${review.filter((r) => r.kind === 'unknown').length} phrases (${review.filter((r) => r.kind === 'unknown').reduce((a, r) => a + r.n, 0)} mentions), complex ${review.filter((r) => r.kind === 'complex').length}`);
