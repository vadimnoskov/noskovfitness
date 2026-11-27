/**
 * Calibrate ESTIMATE_SCALE (fitness-core/src/workouts/estimate.ts) on the coach's logged Rx timed results:
 * scale = median(actual minutes / raw table estimate). Prints the new scale and the accuracy it gives
 * (share within ×1.5 and ×2 of the actual time, share in the same time domain), next to the current scale's.
 *
 *   DATABASE_URL=... pnpm --filter @workspace/fitness-db run calibrate:estimate
 *
 * Read-only: it changes nothing in the database or the code.
 */
import { estimateMinutes, timeDomainOf, ESTIMATE_SCALE, type Workout } from '@workspace/fitness-core';
import { sql } from './client';

const rows = await sql`
  SELECT r.performed, (r.score->>'timeSec')::numeric AS sec
  FROM results r JOIN athletes a ON a.id = r.athlete_id
  WHERE a.is_coach AND r.as_prescribed AND r.completed AND NOT r.uncertain
    AND (r.score->>'timeSec')::numeric > 0
    AND r.performed->'structure'->>'kind' IN ('for-time', 'intervals')`;
await sql.end();

const pts: { raw: number; actual: number; w: Workout }[] = [];
for (const r of rows) {
  const w = r.performed as Workout;
  const raw = estimateMinutes(w, 1);
  if (raw && raw > 0) pts.push({ raw, actual: Number(r.sec) / 60, w });
}
if (!pts.length) { console.log('No usable results.'); process.exit(0); }

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const i = s.length >> 1; return s.length % 2 ? s[i]! : (s[i - 1]! + s[i]!) / 2; };
const scale = Math.round(median(pts.map((p) => p.actual / p.raw)) * 100) / 100;
const pct = (n: number) => `${Math.round((100 * n) / pts.length)}%`;
const report = (k: number) => {
  let x15 = 0, x2 = 0, td = 0;
  for (const p of pts) {
    const est = estimateMinutes(p.w, k)!;
    const r = Math.max(est / p.actual, p.actual / est);
    if (r <= 1.5) x15++;
    if (r <= 2) x2++;
    if (timeDomainOf(est) === timeDomainOf(p.actual)) td++;
  }
  return { scale: k, within1_5: pct(x15), within2: pct(x2), sameTimeDomain: pct(td) };
};
console.log({ results: pts.length, of: rows.length, medianScale: scale });
console.table([report(ESTIMATE_SCALE), ...(scale !== ESTIMATE_SCALE ? [report(scale)] : [])]);
