import { readdirSync, readFileSync } from 'node:fs';
import { sql } from './client';
const dir = new URL('../migrations/', import.meta.url);
await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
const done = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name as string));
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  await sql.begin(async (tx) => { await tx.unsafe(readFileSync(new URL(f, dir), 'utf8').replace(/CREATE TABLE schema_migrations[^;]*;/, '')); await tx`INSERT INTO schema_migrations (name) VALUES (${f})`; });
  console.log('applied', f);
}
await sql.end();
