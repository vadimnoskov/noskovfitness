import { readFileSync } from 'node:fs';
import { parseBtwbRow, deriveTags, type BtwbRow } from '../packages/core/src/index';
function csv(text: string): BtwbRow[] { // RFC4180 parser (quoted multi-line fields)
  const rows: string[][] = []; let row: string[] = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i]!;
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c; }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...b] = rows; return b.map((r) => Object.fromEntries(h!.map((k, i) => [k, r[i] ?? ''])) as unknown as BtwbRow);
}
const who = process.argv[2] ?? 'vadim'; const sex = who === 'sasha' ? 'female' : 'male';
const rows = csv(readFileSync(`data/private/btwb_${who}.csv`, 'utf8'));
const kinds: Record<string, number> = {}, tds: Record<string, number> = {}, loads: Record<string, number> = {}; let noMv = 0;
for (const r of rows) { const p = parseBtwbRow(r, sex); kinds[p.workout.structure.kind] = (kinds[p.workout.structure.kind] ?? 0) + 1; if (p.warnings.length) noMv++;
  const t = deriveTags(p.workout, { resultSec: p.result.score.timeSec, amrapRounds: p.result.score.rounds, sex }); tds[t.timeDomain] = (tds[t.timeDomain] ?? 0) + 1; loads[t.load] = (loads[t.load] ?? 0) + 1; }
console.log(who, rows.length, 'no movements:', noMv, kinds, tds, loads);
for (const n of (process.argv[3] ?? '').split(',').filter(Boolean)) { const r = rows.filter((x) => x.Workout === n).pop(); if (!r) continue; const p = parseBtwbRow(r, sex);
  console.log('\n##', n, JSON.stringify(p.workout.structure), JSON.stringify(p.result.score)); for (const m of p.workout.movements) console.log('  ', JSON.stringify(m));
  console.log('  tags', JSON.stringify(deriveTags(p.workout, { resultSec: p.result.score.timeSec, amrapRounds: p.result.score.rounds, sex }))); }
