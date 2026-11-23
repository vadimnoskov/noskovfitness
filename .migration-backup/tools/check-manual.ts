import { readFileSync } from 'node:fs';
import { resolve } from '../packages/core/src/movements/resolver';
const d = JSON.parse(readFileSync('data/private/manual_results.json', 'utf8'));
const seen = new Map<string, string>();
for (const r of d.results) if (r.what) { const x = resolve(r.what); seen.set(r.what, `${x.name ?? '??'}${x.review ? ' [' + x.review + ']' : ''}${Object.keys(x.params).length ? ' ' + JSON.stringify(x.params) : ''}`); }
for (const [k, v] of seen) console.log(k.padEnd(24), '->', v);
console.log('results', d.results.length, 'uncertain', d.results.filter((r: any) => r.uncertain).length, 'measurements', d.measurements.length);
