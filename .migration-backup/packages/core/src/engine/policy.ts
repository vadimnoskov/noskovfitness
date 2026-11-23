/**
 * Programming policy: every number the engine uses, in one editable object (stored per group in the database).
 * Defaults follow the coach's brief and CrossFit's "constantly varied" principle: mostly couplets and triplets,
 * some single-modality days, fewer long chippers; all time domains and loads represented; task and time priority mixed.
 * These are starting points the coach adjusts, not CrossFit-official ratios.
 */
export interface ProgrammingPolicy {
  version: number;
  /** How far back (days) the variety picture looks when choosing the next workout. */
  windowDays: number;
  targets: {
    movementCount: Record<'1' | '2-3' | '4+', number>;
    timeDomain: Record<'short' | 'medium' | 'long' | 'endurance', number>;
    priority: Record<'task' | 'time', number>;
    load: Record<'bodyweight' | 'light' | 'medium' | 'heavy', number>;
    /** Share of movements by modality across the window. */
    modality: Record<'G' | 'W' | 'M', number>;
  };
  weights: { variety: number; freshness: number; weakness: number; benchmark: number };
  rules: {
    /** Do not repeat the same workout within this many days (a due benchmark is the exception). */
    noRepeatWorkoutDays: number;
    noSameMovementConsecutiveDays: boolean;
    noConsecutiveHeavyDays: boolean;
    maxBenchmarksPerWeek: number;
    /** Longest workout the engine proposes on a normal day, minutes. */
    maxMinutes: number;
    /** Movements on a fixed-equipment station (e.g. 1 rower) shared by more people than this count as a warning. */
    groupSize: number;
  };
}

export const DEFAULT_POLICY: ProgrammingPolicy = {
  version: 1,
  windowDays: 42,
  targets: {
    movementCount: { '1': 20, '2-3': 65, '4+': 15 },
    timeDomain: { short: 25, medium: 35, long: 25, endurance: 15 },
    priority: { task: 60, time: 40 },
    load: { bodyweight: 25, light: 25, medium: 30, heavy: 20 },
    modality: { G: 35, W: 40, M: 25 },
  },
  weights: { variety: 50, freshness: 20, weakness: 15, benchmark: 15 },
  rules: { noRepeatWorkoutDays: 180, noSameMovementConsecutiveDays: true, noConsecutiveHeavyDays: true, maxBenchmarksPerWeek: 1, maxMinutes: 60, groupSize: 4 },
};

/** Fill any missing fields from the defaults (older saved policies keep working when new settings are added). */
export function withDefaults(p: Partial<ProgrammingPolicy> | null | undefined): ProgrammingPolicy {
  const d = DEFAULT_POLICY;
  if (!p) return structuredClone(d);
  return {
    version: p.version ?? d.version,
    windowDays: p.windowDays ?? d.windowDays,
    targets: {
      movementCount: { ...d.targets.movementCount, ...p.targets?.movementCount },
      timeDomain: { ...d.targets.timeDomain, ...p.targets?.timeDomain },
      priority: { ...d.targets.priority, ...p.targets?.priority },
      load: { ...d.targets.load, ...p.targets?.load },
      modality: { ...d.targets.modality, ...p.targets?.modality },
    },
    weights: { ...d.weights, ...p.weights },
    rules: { ...d.rules, ...p.rules },
  };
}
