/**
 * Programming policy: every number the engine uses, in one editable object (stored per group in the database).
 * Default targets are the measured mix of the published programming (2005 on, first half of 2019 weighted to a
 * quarter; see styleProfile), so a new group starts from what CrossFit actually programmed. The coach adjusts them.
 * Heavy lifting days are their own time-domain bucket (about one in five days, i.e. roughly weekly on a 5-day week).
 */
export interface ProgrammingPolicy {
  version: number;
  /** How far back (days) the variety picture looks when choosing the next workout. */
  windowDays: number;
  targets: {
    movementCount: Record<'1' | '2-3' | '4+', number>;
    /** 'heavy' = heavy lifting days (sets of 1–5 or a max), counted apart from the metcon time domains. */
    timeDomain: Record<'heavy' | 'short' | 'medium' | 'long' | 'endurance', number>;
    priority: Record<'task' | 'time', number>;
    load: Record<'bodyweight' | 'light' | 'medium' | 'heavy', number>;
    /** Share of movements by modality across the window. */
    modality: Record<'G' | 'W' | 'M', number>;
  };
  weights: { variety: number; freshness: number; weakness: number; benchmark: number; outline: number };
  rules: {
    /** Do not repeat the same workout within this many days (a due benchmark is the exception). */
    noRepeatWorkoutDays: number;
    /** Avoid the same movement family on consecutive days. Not absolute: allowed once per movementExceptionDays. */
    noSameMovementConsecutiveDays: boolean;
    /** Avoid heavy days back to back (L2: "on occasion may be entirely appropriate"): allowed once per heavyExceptionDays. */
    noConsecutiveHeavyDays: boolean;
    /** How often heavy days may fall back to back (days between exceptions). */
    heavyExceptionDays: number;
    /** How often the same movement family may appear on consecutive days (days between exceptions). */
    movementExceptionDays: number;
    /** Minimum days between lift tests (1RM, 3RM…), so most heavy days stay regular heavy work, not max attempts. */
    minDaysBetweenLiftTests: number;
    /** Volume-jump warning: more than this × a person's most reps of a movement in one workout in 12 months. */
    volumeJumpFactor: number;
    /** …and only from this many reps up (half for jumping pull-ups and GHD sit-ups). */
    volumeJumpMinReps: number;
    /** Days without a logged result after which a person is warned to scale volume for two weeks. */
    returnAfterDays: number;
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
    movementCount: { '1': 31, '2-3': 58, '4+': 11 },
    timeDomain: { heavy: 22, short: 5, medium: 27, long: 25, endurance: 21 },
    priority: { task: 85, time: 15 },
    load: { bodyweight: 42, light: 12, medium: 15, heavy: 31 },
    modality: { G: 44, W: 39, M: 17 },
  },
  weights: { variety: 50, freshness: 20, weakness: 15, benchmark: 15, outline: 20 },
  rules: { noRepeatWorkoutDays: 180, noSameMovementConsecutiveDays: true, noConsecutiveHeavyDays: true, maxBenchmarksPerWeek: 1, maxMinutes: 60, groupSize: 4, heavyExceptionDays: 28, movementExceptionDays: 28, minDaysBetweenLiftTests: 14, volumeJumpFactor: 2, volumeJumpMinReps: 30, returnAfterDays: 30 },
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
      timeDomain: migrateTimeDomain(d.targets.timeDomain, p.targets?.timeDomain),
      priority: { ...d.targets.priority, ...p.targets?.priority },
      load: { ...d.targets.load, ...p.targets?.load },
      modality: { ...d.targets.modality, ...p.targets?.modality },
    },
    weights: { ...d.weights, ...p.weights },
    rules: migrateRules(d.rules, p.rules),
  };
}

/**
 * Saved targets from before heavy days had their own bucket counted them as "short". Split them out: heavy takes
 * the default share (or all of "short" if that is smaller), so each group still adds up the same.
 */
function migrateTimeDomain(d: ProgrammingPolicy['targets']['timeDomain'], saved?: Partial<ProgrammingPolicy['targets']['timeDomain']>) {
  if (!saved) return { ...d };
  if (saved.heavy !== undefined) return { ...d, ...saved };
  const short = saved.short ?? d.short + d.heavy;
  const heavy = Math.min(d.heavy, short);
  return { ...d, ...saved, heavy, short: short - heavy };
}

/** Saved policies from before the split had one rareExceptionDays for both rules: it becomes both new settings. */
function migrateRules(d: ProgrammingPolicy['rules'], saved?: Partial<ProgrammingPolicy['rules']> & { rareExceptionDays?: number }) {
  if (!saved) return { ...d };
  const { rareExceptionDays: old, ...rest } = saved;
  return { ...d, ...rest, ...(old !== undefined ? { heavyExceptionDays: rest.heavyExceptionDays ?? old, movementExceptionDays: rest.movementExceptionDays ?? old } : {}) };
}
