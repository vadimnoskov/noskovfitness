import { describe, it, expect } from 'vitest';
import { starterPlan, starterStatus, starterDay, beginnerMax, FOUNDATIONAL_MOVEMENTS, STARTER_TESTS, individualRx, type Workout } from '../src';

// Synthetic training dates: Mon, Tue, Thu, Fri for three weeks.
const dates = ['2030-01-07', '2030-01-08', '2030-01-10', '2030-01-11', '2030-01-14', '2030-01-15', '2030-01-17', '2030-01-18', '2030-01-21', '2030-01-22', '2030-01-24'];
const all = () => true;

describe('starter tests', () => {
  it('uses the nine L1 foundational movements for the movement check', () => {
    expect(FOUNDATIONAL_MOVEMENTS.map((m) => m.key)).toEqual(['air-squat', 'front-squat', 'overhead-squat', 'press', 'push-press', 'jerk', 'deadlift', 'sdhp', 'clean']);
  });

  it('places six sessions on the first training days, two tests on lift days', () => {
    const p = starterPlan(dates, all, { beginner: false });
    expect(p.notPossible).toEqual([]);
    const byDate = [...new Set(p.slots.map((s) => s.date))];
    expect(byDate).toEqual(dates.slice(0, 6));
    expect(p.slots.filter((s) => s.date === dates[0]).map((s) => [s.name, s.seq])).toEqual([['Back Squat : 5 Rep Max', 1], ['Strict Pull-ups : Max Set', 2]]);
    expect(p.slots.find((s) => s.test.key === 'cindy')!.date).toBe(dates[1]);
  });

  it('beginners: lifts and max sets first, conditioning tests from day 14', () => {
    const p = starterPlan(dates, all, { beginner: true });
    const cond = p.slots.filter((s) => s.test.kind === 'conditioning').map((s) => s.date);
    expect(cond.every((d) => d >= '2030-01-21')).toBe(true);
    expect(p.slots.filter((s) => s.test.kind !== 'conditioning').every((s) => s.date < '2030-01-21')).toBe(true);
  });

  it('falls back to a row without a running route and reports what the location cannot do', () => {
    const p = starterPlan(dates, (n) => n !== 'Run 1 mi TT' && n !== 'Shoulder Press : 5 Rep Max', { beginner: false });
    expect(p.slots.find((s) => s.test.key === 'mile')!.name).toBe('Row 2 km TT');
    expect(p.notPossible.map((x) => x.test.key)).toEqual(['press-5rm']);
    // The press day keeps its dips.
    expect(p.slots.some((s) => s.test.key === 'dips')).toBe(true);
  });

  it('reports tests that did not fit in the range', () => {
    const p = starterPlan(dates.slice(0, 2), all, { beginner: false });
    expect(p.slots).toHaveLength(3);
    expect(p.notPossible.length).toBe(STARTER_TESTS.length - 3);
  });

  it('shows when each test is due again (quarterly) and the gymnastics level', () => {
    const last = new Map([['Strict Pull-ups : Max Set', { date: '2030-01-01', text: '12 reps', reps: 12 }], ['Push-ups : Max Set', { date: '2030-01-01', text: '55 reps', reps: 55 }]]);
    const s = starterStatus(last, '2030-02-01');
    const pull = s.find((x) => x.key === 'pull-ups')!;
    expect(pull.due).toBe(false);
    expect(pull.dueOn).toBe('2030-04-02');
    expect(pull.level).toMatch(/below the first benchmark \(20\); muscle-up work starts around 15/);
    expect(s.find((x) => x.key === 'push-ups')!.level).toMatch(/benchmark 1 of 3/);
    expect(s.find((x) => x.key === 'cindy')!.due).toBe(true);
    expect(starterStatus(last, '2030-04-02').find((x) => x.key === 'pull-ups')!.due).toBe(true);
  });

  it('counts starter days from the first day', () => {
    expect(starterDay('2030-01-07', '2030-01-07')).toBe(0);
    expect(starterDay('2030-01-07', '2030-01-21')).toBe(14);
    expect(starterDay('2030-01-07', '2030-01-06')).toBeUndefined();
    expect(starterDay(null, '2030-01-06')).toBeUndefined();
  });
});

const lift = (name: string): Workout => ({ id: 'x', name, structure: { kind: 'max', what: 'load' }, movements: [{ movement: { family: 'back-squat' } }], scoreType: 'load' });
const amrap: Workout = { id: 'y', name: 'AMRAP 20', structure: { kind: 'amrap', minutes: 20 }, scoreType: 'rounds-reps',
  movements: [{ movement: { family: 'pull-up' }, reps: 10 }, { movement: { family: 'push-up' }, reps: 20 }, { movement: { family: 'air-squat' }, reps: 30 }] };

describe('beginner Individual Rx', () => {
  it('a 1-rep max becomes a 3-rep max in the first four weeks', () => {
    expect(beginnerMax(lift('Back Squat : 1 Rep Max'))!.name).toBe('Back Squat : 3 Rep Max');
    expect(beginnerMax(lift('Back Squat : 5 Rep Max'))).toBeUndefined();
    const r = individualRx(lift('Back Squat : 1 Rep Max'), { timeDomain: 'heavy' } as never, 1, null, 30, 10);
    expect(r.workout.name).toBe('Back Squat : 3 Rep Max');
    expect(r.changes[0]!.kind).toBe('beginner');
    expect(individualRx(lift('Back Squat : 1 Rep Max'), { timeDomain: 'heavy' } as never, 1, null, 30, 28).changes).toEqual([]);
  });

  it('half volume in the first two weeks, not after', () => {
    const r = individualRx(amrap, { timeDomain: 'long' } as never, 1, null, 30, 3);
    expect(r.changes.map((c) => c.kind)).toContain('beginner');
    expect((r.workout.structure as { minutes: number }).minutes).toBeLessThan(20);
    expect(individualRx(amrap, { timeDomain: 'long' } as never, 1, null, 30, 14).changes).toEqual([]);
  });
});
