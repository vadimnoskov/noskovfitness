/**
 * Stored tags are derived data. When the derivation changes (heavy days became their own time-domain category;
 * modality now follows the implement), the stored copies are recomputed once. Cheap check first, so a normal start
 * does no work.
 */
import { deriveTags, movementModality, type Workout, type MovementRef } from '@workspace/fitness-core';
import { sql } from './client';

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** True when stored tags predate the current derivation. */
export async function tagsAreStale(): Promise<boolean> {
  const [w] = await sql`
    SELECT EXISTS (SELECT 1 FROM workouts WHERE coalesce(tags->>'timeDomain', '') <> 'heavy'
      AND (structure->>'kind' = 'sets' OR (structure->>'kind' = 'max' AND structure->>'what' = 'load'))) AS stale`;
  if (w!.stale) return true;
  const [m] = await sql`SELECT EXISTS (SELECT 1 FROM movements WHERE family IN ('lunge', 'step-up') AND modality = 'W'
      AND coalesce(ref->>'implement', 'bodyweight') = 'bodyweight') AS stale`;
  return Boolean(m!.stale);
}

/** Recompute workout, result and movement tags. Returns how many rows changed. */
export async function refreshDerivedTags(): Promise<{ workouts: number; results: number; movements: number }> {
  const ws = await sql`SELECT id, name, structure, movements, score_type, tags, tags_override, target_minutes FROM workouts`;
  const wUpd: { id: string; tags: unknown }[] = [];
  for (const r of ws) {
    const w: Workout = { id: r.id, name: r.name ?? undefined, structure: r.structure, movements: r.movements, scoreType: r.score_type,
      ...(r.tags_override ? { tags: r.tags_override } : {}),
      ...(r.target_minutes?.length === 2 ? { targetMinutes: [Number(r.target_minutes[0]), Number(r.target_minutes[1])] as [number, number] } : {}) };
    const t = deriveTags(w);
    if (JSON.stringify(t) !== JSON.stringify(r.tags)) wUpd.push({ id: r.id, tags: t });
  }
  for (const part of chunk(wUpd, 500)) {
    await sql`UPDATE workouts w SET tags = x.tags FROM jsonb_to_recordset(${sql.json(part as never)}) AS x(id uuid, tags jsonb) WHERE w.id = x.id`;
  }

  const rs = await sql`SELECT r.id, r.performed, r.score, r.tags, a.sex FROM results r JOIN athletes a ON a.id = r.athlete_id`;
  const rUpd: { id: string; tags: unknown }[] = [];
  for (const r of rs) {
    const t = deriveTags(r.performed as Workout, { resultSec: r.score?.timeSec, amrapRounds: r.score?.rounds, sex: r.sex });
    if (JSON.stringify(t) !== JSON.stringify(r.tags)) rUpd.push({ id: r.id, tags: t });
  }
  for (const part of chunk(rUpd, 500)) {
    await sql`UPDATE results r SET tags = x.tags FROM jsonb_to_recordset(${sql.json(part as never)}) AS x(id uuid, tags jsonb) WHERE r.id = x.id`;
  }

  const ms = await sql`SELECT key, ref, modality FROM movements`;
  let movements = 0;
  for (const m of ms) {
    const mod = movementModality({ movement: m.ref as MovementRef });
    if (mod !== m.modality) { await sql`UPDATE movements SET modality = ${mod} WHERE key = ${m.key}`; movements++; }
  }
  return { workouts: wUpd.length, results: rUpd.length, movements };
}
