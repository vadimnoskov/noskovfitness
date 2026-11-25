import { getPublishedProfile } from './library-data';
import { sql, savePolicy, getPolicy } from '@workspace/fitness-db';
import { DEFAULT_POLICY, type ProgrammingPolicy } from '@workspace/fitness-core';
import { GROUP_ID } from './data';

const num = (f: FormData, k: string, fallback: number) => { const v = Number(f.get(k)); return Number.isFinite(v) && v >= 0 ? v : fallback; };

export async function savePolicyAction(f: FormData) {
  const cur = await getPolicy(GROUP_ID);
  const t = cur.targets;
  const group = <K extends string>(name: string, rec: Record<K, number>) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, num(f, `${name}.${k}`, v as number)])) as Record<K, number>;
  const next: ProgrammingPolicy = {
    version: cur.version + 1,
    windowDays: num(f, 'windowDays', cur.windowDays),
    targets: { movementCount: group('movementCount', t.movementCount), timeDomain: group('timeDomain', t.timeDomain), priority: group('priority', t.priority), load: group('load', t.load), modality: group('modality', t.modality) },
    weights: group('weights', cur.weights),
    rules: {
      noRepeatWorkoutDays: num(f, 'rules.noRepeatWorkoutDays', cur.rules.noRepeatWorkoutDays),
      noSameMovementConsecutiveDays: f.get('rules.noSameMovementConsecutiveDays') === 'on',
      noConsecutiveHeavyDays: f.get('rules.noConsecutiveHeavyDays') === 'on',
      maxBenchmarksPerWeek: num(f, 'rules.maxBenchmarksPerWeek', cur.rules.maxBenchmarksPerWeek),
      maxMinutes: num(f, 'rules.maxMinutes', cur.rules.maxMinutes),
      groupSize: num(f, 'rules.groupSize', cur.rules.groupSize),
    },
  };
  await savePolicy(GROUP_ID, next);
  const days = f.getAll('trainingDays').map(Number).filter((d) => d >= 1 && d <= 7);
  await sql`UPDATE groups SET training_days = ${days.length ? days : [1, 2, 4, 5, 6]}, default_equipment_id = ${String(f.get('defaultEquipmentId') ?? 'gym')} WHERE id = ${GROUP_ID}`;
}

/** Adopt the measured style profile of the published programming (preferred era weighted) as the targets. */
export async function usePublishedProfileAction() {
  const cur = await getPolicy(GROUP_ID);
  const { workouts: _n, ...targets } = getPublishedProfile().blend;
  await savePolicy(GROUP_ID, { ...cur, version: cur.version + 1, targets });
}

export async function resetPolicyAction() {
  const cur = await getPolicy(GROUP_ID);
  await savePolicy(GROUP_ID, { ...structuredClone(DEFAULT_POLICY), version: cur.version + 1 });
}
