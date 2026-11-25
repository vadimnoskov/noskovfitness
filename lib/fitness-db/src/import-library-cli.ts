/** Import the bundled workout library into DATABASE_URL (same as the coach's Settings button). Safe to re-run. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importLibrary } from './library';
import { sql } from './client';

const gz = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'published-library.json.gz'));
const t = Date.now();
console.log(JSON.stringify(await importLibrary(gz), null, 1), `\n${((Date.now() - t) / 1000).toFixed(1)} s`);
await sql.end();
