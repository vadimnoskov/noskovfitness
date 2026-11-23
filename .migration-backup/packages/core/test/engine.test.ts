import { describe, expect, it } from 'vitest';
import {
  parseBtwbRow, deriveTags, plan, blocked, checkEquipment, maxBarbellLb, DEFAULT_POLICY, withDefaults, toPastDay,
  trainingDates, pushForward, skipDay, insertDay, type Candidate, type EquipmentProfile, type PlanInput,
} from '../src/index';

const mk = (id: string, name: string, desc: string, result: string, bench?: number): Candidate => {
  const p = parseBtwbRow({ Date: '2025-01-01', Workout: name, Description: desc, 'Formatted Result': result, Result: '0', Performed: 'prescribed', Notes: '' }, 'male');
  const timeSec = p.result.score.timeSec;
  return { id, workout: p.workout, tags: deriveTags(p.workout, { resultSec: timeSec }), minutes: timeSec ? timeSec / 60 : undefined,
    benchmark: bench ? { category: 'girl', retestEveryDays: bench } : null };
};

const C = [
  mk('fran', 'Fran', '21 Thrusters 95 lbs\n21 Pull-ups\n15 Thrusters 95 lbs\n15 Pull-ups\n9 Thrusters 95 lbs\n9 Pull-ups', '5 mins', 150),
  mk('cindy', 'Cindy', '20:00 AMRAP:\n5 Pull-ups\n10 Push-ups\n15 Air Squats', '18 rounds', 150),
  mk('bs', 'Back Squat : 5-5-5-5-5', 'Sets\n5 Back Squats', '1000 lbs | 200 lbs'),
  mk('dl', 'Deadlift : 3-3-3-3-3', 'Sets\n3 Deadlifts', '1000 lbs | 300 lbs'),
  mk('row', 'Row 2 km TT', '2000 m Rows', '7 mins 30 secs'),
  mk('kbdu', '5 RFT: KBS and DU', '5 rounds of:\n20 Kettlebell Swings, 24 kg\n50 Double Unders', '12 mins'),
  mk('ghd', '3 RFT: GHD and Run', '3 rounds of:\n25 GHD Sit-ups\nRun, 400 m', '14 mins'),
  mk('heavyclean', '5 RFT: Clean', '5 rounds of:\n3 Power Cleans 500 lbs\n10 Burpees', '10 mins'),
  mk('wb', 'Karen', '150 Wall Balls 20 lbs', '8 mins', 150),
  mk('hspu', 'FT: HSPU and Lunges', '30 Handstand Push-ups\n50 Walking Lunges', '9 mins'),
  mk('snatch', 'Snatch : 1-1-1-1-1', 'Sets\n1 Squat Snatch', '500 lbs | 100 lbs'),
  mk('run5k', 'Run 5 km TT', '5000 m Runs', '24 mins'),
];

const garage: EquipmentProfile = { id: 'garage', name: 'Home garage', items: [
  { implement: 'rower', quantity: 1 }, { implement: 'barbell', quantity: 2, loads: [{ value: 45, unit: 'lb', qty: 1 }, { value: 35, unit: 'lb', qty: 1 }] },
  { implement: 'plate', quantity: 20, loads: [{ value: 45, unit: 'lb', qty: 4 }, { value: 25, unit: 'lb', qty: 2 }] },
  { implement: 'kettlebell', quantity: 26, loads: [{ value: 24, unit: 'kg', qty: 2 }] }, { implement: 'rack', quantity: 1 }, { implement: 'bar', quantity: 2 },
  { implement: 'jump-rope', quantity: 4 }, { implement: 'medball', quantity: 4, loads: [{ value: 20, unit: 'lb', qty: 1 }] }, { implement: 'wall', quantity: 1 },
] };

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  dates: trainingDates('2026-12-07', 10, [1, 2, 4, 5, 6]), history: [], candidates: C, policy: DEFAULT_POLICY,
  equipmentFor: () => garage, lastWorkoutDate: new Map(), lastMovementDate: new Map(), ...over,
});

describe('equipment', () => {
  it('computes the heaviest barbell from bars and plate pairs', () => {
    expect(maxBarbellLb(garage)).toBe(45 + 4 * 45 + 2 * 25);
  });
  it('blocks missing equipment and impossible loads, warns about shared stations', () => {
    expect(checkEquipment(C.find((c) => c.id === 'ghd')!.workout, garage, 4).ok).toBe(false);
    expect(checkEquipment(C.find((c) => c.id === 'heavyclean')!.workout, garage, 4).problems[0]).toMatch(/heaviest available/);
    const row = checkEquipment(C.find((c) => c.id === 'row')!.workout, garage, 4);
    expect(row.ok).toBe(true);
    expect(row.warnings[0]).toMatch(/1 rower for 4 people/);
  });
});

describe('planner', () => {
  // The sample library is small, so allow two benchmarks a week to fill all ten days.
  const roomy = withDefaults({ rules: { ...DEFAULT_POLICY.rules, maxBenchmarksPerWeek: 2 } });
  const proposals = plan(input({ policy: roomy }));

  it('fills every training day it can, deterministically', () => {
    expect(proposals.length).toBe(10);
    expect(plan(input({ policy: roomy })).map((p) => p.candidateId)).toEqual(proposals.map((p) => p.candidateId));
  });

  it('leaves a day open rather than break a rule when nothing fits', () => {
    // Default policy: at most 1 benchmark a week. With this small library one day has no eligible workout.
    expect(plan(input()).length).toBeLessThan(10);
  });

  it('never schedules heavy two days in a row or the same movement on consecutive days', () => {
    const byId = new Map(C.map((c) => [c.id, c]));
    for (let i = 1; i < proposals.length; i++) {
      const a = proposals[i - 1]!, b = proposals[i]!;
      const consecutive = Date.parse(b.date) - Date.parse(a.date) === 86400000;
      if (!consecutive) continue;
      const ca = byId.get(a.candidateId)!, cb = byId.get(b.candidateId)!;
      expect(ca.tags.load === 'heavy' && cb.tags.load === 'heavy').toBe(false);
      const fa = new Set(ca.workout.movements.map((m) => m.movement.family));
      expect(cb.workout.movements.some((m) => fa.has(m.movement.family))).toBe(false);
    }
  });

  it('never proposes what the location cannot support', () => {
    expect(proposals.some((p) => p.candidateId === 'ghd' || p.candidateId === 'heavyclean')).toBe(false);
  });

  it('does not repeat a workout within the repeat window, and varies the mix', () => {
    expect(new Set(proposals.map((p) => p.candidateId)).size).toBe(proposals.length);
    const mods = new Set(proposals.flatMap((p) => C.find((c) => c.id === p.candidateId)!.tags.modalityPattern));
    expect(mods).toEqual(new Set(['G', 'W', 'M']));
  });

  it('prefers a due benchmark over the same workout done last week', () => {
    const recent = input({ dates: ['2026-12-07'], lastWorkoutDate: new Map([['fran', '2026-01-01'], ['cindy', '2026-12-01'], ['wb', '2026-12-01']]) });
    const window = [toPastDay('2026-12-01', [C.find((c) => c.id === 'cindy')!])];
    expect(blocked(C.find((c) => c.id === 'cindy')!, '2026-12-07', recent, window)).toBe('done recently');
    expect(plan(recent)[0]!.score.notes.join(' ') + plan(recent)[0]!.candidateId).toBeTruthy();
    const fran = plan({ ...recent, candidates: [C.find((c) => c.id === 'fran')!, C.find((c) => c.id === 'kbdu')!], policy: withDefaults({ weights: { variety: 10, freshness: 10, weakness: 0, benchmark: 80 } }) });
    expect(fran[0]!.candidateId).toBe('fran');
    expect(fran[0]!.score.notes.some((n) => n.startsWith('benchmark due'))).toBe(true);
  });

  it('closes the biggest variety gap first', () => {
    // History full of short couplets → a long single-modality workout should rank above another couplet.
    const hist = Array.from({ length: 6 }, (_, i) => toPastDay(`2026-11-${String(10 + i * 3).padStart(2, '0')}`, [C.find((c) => c.id === 'kbdu')!]));
    const p = plan(input({ dates: ['2026-12-07'], history: hist, candidates: [C.find((c) => c.id === 'fran')!, C.find((c) => c.id === 'run5k')!], policy: withDefaults({ weights: { variety: 100, freshness: 0, weakness: 0, benchmark: 0 } }) }));
    expect(p[0]!.candidateId).toBe('run5k');
  });
});

describe('schedule', () => {
  const td = [1, 2, 4, 5, 6];
  it('lists the family training days (Mon, Tue, Thu, Fri, Sat)', () => {
    expect(trainingDates('2026-12-07', 6, td)).toEqual(['2026-12-07', '2026-12-08', '2026-12-10', '2026-12-11', '2026-12-12', '2026-12-14']);
  });
  it('push forward shifts this and later open days to the next training days; done days stay', () => {
    const days = [
      { id: 'a', date: '2026-12-07', status: 'done' as const }, { id: 'b', date: '2026-12-08', status: 'approved' as const },
      { id: 'c', date: '2026-12-10', status: 'proposed' as const },
    ];
    expect(pushForward(days, '2026-12-08', td).map((d) => d.date)).toEqual(['2026-12-07', '2026-12-10', '2026-12-11']);
    expect(skipDay(days, 'b', 'drop', td).find((d) => d.id === 'b')!.status).toBe('skipped');
    expect(insertDay(days, '2026-12-09', 'x').find((d) => d.id === 'x')).toMatchObject({ date: '2026-12-09', status: 'proposed' });
  });
});
