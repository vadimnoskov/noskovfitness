import { describe, it, expect } from 'vitest';
import { resultWork, powerCurve, curveArea, dimsAt, powerChange, type BodyDims } from '../src';
import type { Workout } from '../src/model/types';

// The L1 / "Fooling Around with Fran" athlete: 200 lb, centre of mass travels 26 in in the thruster, bar 47 in.
const greg: BodyDims = { weight: 200, squatLow: 10, squatHigh: 36, shoulder: 57, overhead: 78, knuckle: 30 };
const fran: Workout = { id: 'f', structure: { kind: 'for-time', scheme: [21, 15, 9] }, scoreType: 'time', movements: [
  { movement: { family: 'thruster', implement: 'barbell' }, load: { male: 95, female: 65, unit: 'lb' } },
  { movement: { family: 'pull-up' } },
] };

describe('work and power', () => {
  it('matches the thruster numbers in the Fran tables', () => {
    const w = resultWork({ performed: fran, score: { timeSec: 168 }, completed: true }, 'male', greg);
    // Thruster: 200 × 26 / 12 = 433 + 95 × 47 / 12 = 372 → 805 ft-lb, as in the source. Pull-up here uses
    // shoulder-to-overhead (21 in → 350 ft-lb; the source measured 24 in → 400).
    expect(w.work).toBe(Math.round(45 * (200 * 26 / 12 + 95 * 47 / 12 + 200 * 21 / 12)));
    expect(w.power).toBeCloseTo(w.work! / 168, 0);
    expect(w.missing).toEqual([]);
  });
  it('gives no number when a movement has no distance rule', () => {
    const w = resultWork({ performed: { ...fran, movements: [...fran.movements, { movement: { family: 'run' }, distanceM: 400 }] }, score: { timeSec: 300 }, completed: true }, 'male', greg);
    expect(w.work).toBeUndefined();
    expect(w.missing).toEqual(['run']);
  });
  it('counts AMRAP rounds and partial reps in order', () => {
    const cindy: Workout = { id: 'c', structure: { kind: 'amrap', minutes: 20 }, scoreType: 'rounds-reps', movements: [
      { movement: { family: 'pull-up' }, reps: 5 }, { movement: { family: 'air-squat' }, reps: 15 }] };
    const w = resultWork({ performed: cindy, score: { rounds: 10, reps: 7 }, completed: true }, 'male', greg);
    const round = 5 * 200 * 21 + 15 * 200 * 26;
    expect(w.work).toBe(Math.round((10 * round + 5 * 200 * 21 + 2 * 200 * 26) / 12));
    expect(w.seconds).toBe(1200);
  });
  it('does not repeat a scheme over movements that already list their reps', () => {
    const expanded: Workout = { ...fran, movements: [21, 15, 9].flatMap((n) => fran.movements.map((m) => ({ ...m, reps: n }))) };
    const a = resultWork({ performed: expanded, score: { timeSec: 168 }, completed: true }, 'male', greg);
    const b = resultWork({ performed: fran, score: { timeSec: 168 }, completed: true }, 'male', greg);
    expect(a.work).toBe(b.work);
  });
  it('leaves out multi-part workouts', () => {
    const w = resultWork({ performed: { ...fran, originalText: '5x 3:00 AMRAP: 3 cleans. Resting 1 min between each AMRAP.' }, score: { timeSec: 60 }, completed: true }, 'male', greg);
    expect(w.missing).toEqual(['multi-part workout']);
  });
  it('uses the female load for women', () => {
    const m = resultWork({ performed: fran, score: { timeSec: 300 }, completed: true }, 'female', greg);
    const f = resultWork({ performed: fran, score: { timeSec: 300 }, completed: true }, 'male', greg);
    expect(m.work!).toBeLessThan(f.work!);
  });
  it('needs all six measurements', () => {
    expect(resultWork({ performed: fran, score: { timeSec: 300 }, completed: true }, 'male', undefined).work).toBeUndefined();
    const rows = [{ kind: 'weight', date: '2025-01-01', value: 90, unit: 'kg' }, { kind: 'weight', date: '2026-01-01', value: 200, unit: 'lb' },
      ...['squat-low', 'squat-high', 'shoulder-height', 'overhead-height', 'knuckle-height'].map((kind, i) => ({ kind, date: '2026-01-01', value: [25, 80, 145, 198, 77][i]!, unit: 'cm' }))];
    const d = dimsAt(rows, '2025-06-01')!;
    expect(Math.round(d.weight)).toBe(198);
    expect(Math.round(d.shoulder)).toBe(57);
    expect(dimsAt(rows.slice(1, 3), '2026-02-01')).toBeUndefined();
  });
  it('builds the power curve and its area', () => {
    const c = powerCurve([{ minutes: 3, power: 300, date: 'a', id: '1' }, { minutes: 20, power: 150, date: 'b', id: '2' }]);
    expect(c.find((x) => x.minutes === 1)!.power).toBe(300);
    expect(c.find((x) => x.minutes === 12)!.power).toBe(150);
    expect(c.find((x) => x.minutes === 30)!.power).toBeNull();
    expect(curveArea(c)).toBeGreaterThan(0);
    expect(powerChange(270, 165)).toBe(64);
  });
});
