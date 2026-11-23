import { proposeRange } from '../packages/db/src/engine';
import { sql } from '../packages/db/src/client';
const t0 = Date.now();
console.log(await proposeRange('family', '2026-11-23', '2027-01-03'), `${Date.now() - t0} ms`);
const rows = await sql`SELECT d.date::text, to_char(d.date,'Dy') dow, w.name, w.tags->>'load' load, w.tags->>'timeDomain' td, w.tags->'modalityPattern' mp, d.origin->'score'->>'total' s, d.origin->'score'->'notes' notes, d.warnings
  FROM program_days d JOIN workouts w ON w.id = d.main_workout_id ORDER BY d.date`;
for (const r of rows) console.log(r.date, r.dow, (r.name ?? '').slice(0, 55).padEnd(55), r.mp.join(''), r.load, r.td, r.s, JSON.stringify(r.notes), r.warnings.length ? JSON.stringify(r.warnings) : '');
await sql.end();
