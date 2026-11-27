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
  equipmentFor: () => garage, lastWorkoutDate: new Map(), lastMovementDate: new Map(), outline: new Map(), ...over,
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
    expect(row.crowded[0]).toMatch(/1 rower for 4 people/);
  });
  it('counts boxes and rings per person: half the group can stagger, fewer is crowded', () => {
    const bj = mk('bj', 'BJ', '5 rounds of:\n15 Box Jumps, 24 in\n10 Ring Rows', '10 mins').workout;
    const one = checkEquipment(bj, { ...garage, items: [...garage.items, { implement: 'box', quantity: 1 }, { implement: 'rings', quantity: 1 }] }, 4);
    expect(one.ok).toBe(true);
    expect(one.crowded.join(' ')).toMatch(/1 box for 4.*|1 rings for 4/);
    const two = checkEquipment(bj, { ...garage, items: [...garage.items, { implement: 'box', quantity: 2 }, { implement: 'rings', quantity: 2 }] }, 4);
    expect(two.crowded).toEqual([]);
    expect(two.warnings.join(' ')).toMatch(/2 box for 4 people \(stagger/);
  });
  it('prescribes only fixed weights that exist at the location', () => {
    const db = { ...garage, items: [...garage.items, { implement: 'dumbbell' as const, quantity: 4, loads: [{ value: 40, unit: 'lb' as const, qty: 2 }, { value: 50, unit: 'lb' as const, qty: 2 }, { value: 15, unit: 'lb' as const, qty: 2 }] }] };
    const w45 = mk('d45', 'DB', '6 rounds of:\n5 Dumbbell Power Clean & Jerks, 45 lbs\n5 Burpees', '10 mins').workout;
    const c = checkEquipment(w45, db, 4);
    expect(c.ok).toBe(true);
    expect(c.warnings.join(' ')).toMatch(/45 lb → 40 lb or 50 lb/);
    const w30 = mk('d30', 'DB', '6 rounds of:\n5 Dumbbell Power Clean & Jerks, 30 lbs\n5 Burpees', '10 mins').workout;
    expect(checkEquipment(w30, db, 4).problems.join(' ')).toMatch(/no dumbbell near that weight/);
  });
});

describe('movement roles', () => {
  const tgu = mk('tgu', 'FT: TGU', '5 rounds of:\n4 Turkish Get-ups, 24 kg\n20 Air Squats', '12 mins');
  it('allows Turkish get-ups in a metcon occasionally', () => {
    const p = plan(input({ dates: ['2026-12-07'], candidates: [tgu] }));
    expect(p[0]!.candidateId).toBe('tgu');
    expect(p[0]!.score.penalty).toBeLessThan(0.2);
    expect(p[0]!.score.notes.join(' ')).toMatch(/occasional use/);
  });
  it('strongly avoids them again within 4 weeks', () => {
    const tguKey = 'tgu|implement=kettlebell';
    const p = plan(input({ dates: ['2026-12-07'], candidates: [tgu, C.find((c) => c.id === 'kbdu')!], lastMovementDate: new Map([[tguKey, '2026-11-25']]) }));
    expect(p[0]!.candidateId).toBe('kbdu');
    const only = plan(input({ dates: ['2026-12-07'], candidates: [tgu], lastMovementDate: new Map([[tguKey, '2026-11-25']]) }));
    expect(only[0]!.score.notes.join(' ')).toMatch(/again within 4 weeks/);
  });
});

describe('tags', () => {
  it('counts heavy lifting days as their own time domain, whatever the weight', () => {
    expect(C.find((c) => c.id === 'bs')!.tags.timeDomain).toBe('heavy');
    expect(C.find((c) => c.id === 'fran')!.tags.timeDomain).not.toBe('heavy');
  });
  it('classes bodyweight lunges as gymnastics and loaded ones as weightlifting', () => {
    expect(mk('l1', 'L', '50 Walking Lunges', '5 mins').tags.modalityPattern).toEqual(['G']);
    expect(mk('l2', 'L', '50 Dumbbell Walking Lunges, 35 lbs', '5 mins').tags.modalityPattern).toEqual(['W']);
    expect(mk('p1', 'P', '20 Kettlebell Pistols, 16 kg', '5 mins').tags.modalityPattern).toEqual(['W']);
    expect(mk('p2', 'P', '20 Pistols', '5 mins').tags.modalityPattern).toEqual(['G']);
    expect(mk('s1', 'S', '20 Box Step-ups, 24 in, 35 lbs', '5 mins').tags.modalityPattern).toEqual(['W']);
  });
  it('moves heavy days out of a saved "short" target without changing the total', () => {
    const p = withDefaults({ targets: { ...DEFAULT_POLICY.targets, timeDomain: { short: 27, medium: 27, long: 25, endurance: 21 } as never } });
    expect(p.targets.timeDomain).toEqual({ heavy: 22, short: 5, medium: 27, long: 25, endurance: 21 });
  });
});

describe('lift tests', () => {
  const lift = (id: string, label: string): Candidate => ({ ...C.find((c) => c.id === 'bs')!, id, benchmark: { category: 'lift', retestEveryDays: 90, label } });
  const bs1 = lift('bs1', 'Back Squat 1RM'), bs3 = lift('bs3', 'Back Squat 3RM');
  it('comes due 90 days after the last test of the same lift, any rep max', () => {
    const due = plan(input({ dates: ['2026-12-07'], candidates: [bs1, bs3], lastWorkoutDate: new Map([['bs3', '2026-08-01']]) }));
    expect(due[0]!.score.notes.join(' ')).toMatch(/Back Squat test due \(last 2026-08-01\)/);
    const notDue = plan(input({ dates: ['2026-12-07'], candidates: [bs1, bs3], lastWorkoutDate: new Map([['bs3', '2026-11-01']]) }));
    expect(notDue[0]!.candidateId).toBe('bs1'); // bs3 itself was done recently
    expect(notDue[0]!.score.benchmark).toBe(0);
  });
  it('spaces lift tests at least 14 days apart', () => {
    const dl1 = lift('dl1', 'Deadlift 1RM'), sn1 = lift('sn1', 'Snatch 1RM');
    const p = plan(input({ dates: ['2026-12-07', '2026-12-14', '2026-12-21'], candidates: [bs1, dl1, sn1] }));
    expect(p.map((x) => x.date)).toEqual(['2026-12-07', '2026-12-21']);
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

  it('uses a back-to-back exception (heavy days, same movement) at most once in 4 weeks, and says so', () => {
    const byId = new Map(C.map((c) => [c.id, c]));
    const exceptions: string[] = [];
    for (let i = 1; i < proposals.length; i++) {
      const a = proposals[i - 1]!, b = proposals[i]!;
      if (Date.parse(b.date) - Date.parse(a.date) !== 86400000) continue;
      const ca = byId.get(a.candidateId)!, cb = byId.get(b.candidateId)!;
      const fa = new Set(ca.workout.movements.map((m) => m.movement.family));
      if ((ca.tags.timeDomain === 'heavy' && cb.tags.timeDomain === 'heavy') || cb.workout.movements.some((m) => fa.has(m.movement.family))) {
        exceptions.push(b.date);
        expect(b.score.notes.join(' ')).toMatch(/allowed occasionally/);
      }
    }
    for (let i = 1; i < exceptions.length; i++) expect(Date.parse(exceptions[i]!) - Date.parse(exceptions[i - 1]!)).toBeGreaterThan(28 * 86400000);
  });

  it('blocks a second back-to-back exception within 4 weeks', () => {
    const bs = C.find((c) => c.id === 'bs')!, dl = C.find((c) => c.id === 'dl')!, sn = C.find((c) => c.id === 'snatch')!;
    const window = [toPastDay('2026-11-20', [bs]), toPastDay('2026-11-21', [dl]), toPastDay('2026-12-06', [sn])];
    expect(blocked(bs, '2026-12-07', input(), window, window[2])).toMatch(/exception already used recently/);
    expect(blocked(bs, '2026-12-07', input(), window.slice(2), window[2])).toBeUndefined();
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
    const fran = plan({ ...recent, candidates: [C.find((c) => c.id === 'fran')!, C.find((c) => c.id === 'kbdu')!], policy: withDefaults({ weights: { variety: 10, freshness: 10, weakness: 0, benchmark: 80, outline: 0 } }) });
    expect(fran[0]!.candidateId).toBe('fran');
    expect(fran[0]!.score.notes.some((n) => n.startsWith('benchmark due'))).toBe(true);
  });

  it('closes the biggest variety gap first', () => {
    // History full of short couplets → a long single-modality workout should rank above another couplet.
    const hist = Array.from({ length: 6 }, (_, i) => toPastDay(`2026-11-${String(10 + i * 3).padStart(2, '0')}`, [C.find((c) => c.id === 'kbdu')!]));
    const p = plan(input({ dates: ['2026-12-07'], history: hist, candidates: [C.find((c) => c.id === 'fran')!, C.find((c) => c.id === 'run5k')!], policy: withDefaults({ weights: { variety: 100, freshness: 0, weakness: 0, benchmark: 0, outline: 0 } }) }));
    expect(p[0]!.candidateId).toBe('run5k');
  });
});

describe('coach-set repeats', () => {
  it('repeats a workout every N days despite the 180-day rule, only until the end date', () => {
    const row = { ...C.find((c) => c.id === 'kbdu')!, repeat: { everyDays: 14, until: '2026-12-31' } };
    const others = C.filter((c) => c.id !== 'kbdu');
    const last = new Map([['kbdu', '2026-11-20']]);
    const base = { history: [], policy: DEFAULT_POLICY, equipmentFor: () => garage, lastMovementDate: new Map() };
    expect(blocked(row, '2026-11-27', { ...base, dates: [], candidates: [], lastWorkoutDate: last }, [])).toBe('repeat not due yet');
    expect(blocked(row, '2026-12-05', { ...base, dates: [], candidates: [], lastWorkoutDate: last }, [])).toBeUndefined();
    const p = plan({ ...base, dates: ['2026-12-05'], candidates: [row, ...others], lastWorkoutDate: last });
    expect(p[0]!.candidateId).toBe('kbdu');
    expect(p[0]!.score.notes).toContain('repeat due (every 14 days)');
    // After the end date the normal rule applies again.
    expect(blocked(row, '2027-01-05', { ...base, dates: [], candidates: [], lastWorkoutDate: new Map([['kbdu', '2026-12-20']]) }, [])).toBe('done recently');
  });
});

describe('inserting a day between planned days', () => {
  it('respects the day after as well as the day before', () => {
    // Wednesday already has KB swings + double-unders planned; filling Tuesday must not repeat it or its movements.
    const wed = toPastDay('2026-12-09', [C.find((c) => c.id === 'kbdu')!]);
    const p = plan(input({ dates: ['2026-12-08'], history: [wed], lastWorkoutDate: new Map([['kbdu', '2026-12-09']]) }));
    const pick = C.find((c) => c.id === p[0]!.candidateId)!;
    expect(pick.id).not.toBe('kbdu');
    expect(pick.workout.movements.some((m) => ['kb-swing', 'jump-rope'].includes(m.movement.family))).toBe(false);
    expect(blocked(C.find((c) => c.id === 'cindy')!, '2026-12-08', input({ history: [wed] }), [], undefined, wed)).toBeUndefined();
    expect(blocked(C.find((c) => c.id === 'kbdu')!, '2026-12-08', input({ history: [wed] }), [], undefined, wed)).toBe('same workout tomorrow');
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

describe('exception settings', () => {
  it('moves an old shared rareExceptionDays into both new settings', () => {
    const { heavyExceptionDays: _h, movementExceptionDays: _m, ...old } = DEFAULT_POLICY.rules;
    const p = withDefaults({ rules: { ...old, rareExceptionDays: 21 } as never });
    expect(p.rules.heavyExceptionDays).toBe(21);
    expect(p.rules.movementExceptionDays).toBe(21);
    expect((p.rules as Record<string, unknown>).rareExceptionDays).toBeUndefined();
  });
});

describe('why this workout', () => {
  it('explains the pick: mix against targets, movement freshness and the rules it passed', async () => {
    const { plan, DEFAULT_POLICY } = await import('../src');
    const w = (id: string, fam: string, td: 'short' | 'medium') => ({ id, workout: { id, structure: { kind: 'for-time' as const }, scoreType: 'time' as const, movements: [{ movement: { family: fam }, reps: 30 }] },
      tags: { modalityPattern: ['G' as const], movementCount: 1, load: 'bodyweight' as const, volume: 'low' as const, timeDomain: td, priority: 'task' as const, pathway: 'glycolytic' as const }, minutes: td === 'short' ? 3 : 8 });
    const [p] = plan({ dates: ['2026-12-01'], history: [], candidates: [w('a', 'pull-up', 'short'), w('b', 'push-up', 'medium')], policy: DEFAULT_POLICY,
      equipmentFor: () => ({ id: 'gym', name: 'Gym', items: [{ implement: 'bar', quantity: 4 }] }), lastWorkoutDate: new Map(), lastMovementDate: new Map([['push-up', '2026-11-20']]) });
    const why = p!.score.why!;
    expect(why.mix[0]!.label).toBe('time domain');
    expect(why.mix.some((m) => m.label === 'modality' && m.bucket === 'gymnastics')).toBe(true);
    expect(why.rules.some((r) => /not done before/.test(r))).toBe(true);
    expect(why.rules.some((r) => /equipment checked for 4 people at Gym/.test(r))).toBe(true);
    expect(why.movements.length).toBe(1);
  });
});
