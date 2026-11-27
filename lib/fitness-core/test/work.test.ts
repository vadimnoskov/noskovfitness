import { describe, it, expect } from 'vitest';
import { resultWork, powerCurve, curveArea, dimsAt, powerChange, parseBtwbWeights, intervalPieces, type BodyDims } from '../src';
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
    const w = resultWork({ performed: { ...fran, movements: [...fran.movements, { movement: { family: 'carry' }, distanceM: 50 }] }, score: { timeSec: 300 }, completed: true }, 'male', greg);
    expect(w.work).toBeUndefined();
    expect(w.missing).toEqual(['carry']);
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

describe('runs, rows and double-unders', () => {
  const run = (m: number, t: number) => resultWork({ performed: { id: 'r', structure: { kind: 'for-time' }, scoreType: 'time', movements: [{ movement: { family: 'run' }, distanceM: m }] }, score: { timeSec: t }, completed: true }, 'male', undefined);
  it('uses the Concept2 formula, watts = 2.80 × speed³, with no measurements', () => {
    expect(run(400, 80).power).toBeCloseTo((2.8 * 5 ** 3) / 1.3558, 1); // 5 m/s → 350 W
    const row = resultWork({ performed: { id: 'w', structure: { kind: 'for-time' }, scoreType: 'time', movements: [{ movement: { family: 'row' }, distanceM: 2000 }] }, score: { timeSec: 480 }, completed: true }, 'male', undefined);
    expect(row.power).toBeCloseTo((2.8 * (2000 / 480) ** 3) / 1.3558, 1); // 2:00 per 500 m
  });
  it('counts double-unders as bodyweight × 6 in', () => {
    const w = resultWork({ performed: { id: 'd', structure: { kind: 'for-time' }, scoreType: 'time', movements: [{ movement: { family: 'jump-rope', variant: 'double-under' }, reps: 100 }] }, score: { timeSec: 60 }, completed: true }, 'male', { ...greg, weight: 150 });
    expect(w.power).toBeCloseTo((150 * 0.5 * 100) / 60, 1);
  });
  it('uses the person’s usual pace for a row inside a mixed workout', () => {
    const jackie: Workout = { id: 'j', structure: { kind: 'for-time' }, scoreType: 'time', movements: [
      { movement: { family: 'row' }, distanceM: 1000 }, { movement: { family: 'thruster', implement: 'barbell' }, reps: 50, load: { male: 45, unit: 'lb' } }, { movement: { family: 'pull-up' }, reps: 30 }] };
    expect(resultWork({ performed: jackie, score: { timeSec: 450 }, completed: true }, 'male', greg).missing).toEqual(['row pace']);
    const w = resultWork({ performed: jackie, score: { timeSec: 450 }, completed: true }, 'male', greg, { row: 4 });
    const rowFtLb = 2.8 * 16 * 1000 / 1.3558;
    const body = (50 * (200 * 26 + 45 * 47) + 30 * 200 * 21) / 12;
    expect(w.work).toBe(Math.round(rowFtLb + body));
  });
});

describe('BTWB weight export', () => {
  it('reads dates and weights', () => {
    const rows = parseBtwbWeights('DateTime,Height,Weight,Neck,Abdomen,Hip,Upper Arm,Body Fat Percentage,Notes\n2026-11-26 11:00:00 -0500,69 in,194 lbs,,,,,,""\n2019-04-29 10:19:51 -0400,69 in,174.8 lbs,,,,,,\n2019-04-01 10:19:51 -0400,69 in,,,,,,,\n');
    expect(rows).toEqual([{ date: '2019-04-29', value: 174.8, unit: 'lb' }, { date: '2026-11-26', value: 194, unit: 'lb' }]);
    expect(() => parseBtwbWeights('a,b\n1,2')).toThrow();
  });
});

describe('BTWB interval logs', () => {
  it('uses each piece and drops pieces logged as 0:00', () => {
    const text = 'Intervals\nRow, 250 m | 0:50\nRow, 250 m | 0:50\nRow, 250 m | 0:00';
    expect(intervalPieces(text)).toEqual([{ metres: 250, sec: 50 }, { metres: 250, sec: 50 }]);
    const w = resultWork({ performed: { id: 'i', originalText: text, structure: { kind: 'for-time' }, scoreType: 'time', movements: [{ movement: { family: 'row' }, distanceM: 250 }] }, score: { timeSec: 100 }, completed: true }, 'male', undefined);
    expect(w.power).toBeCloseTo(2.8 * 125 / 1.3558, 0);
    expect(intervalPieces('Intervals : rest 3 mins\nRow, 500 m | 1:30')).toEqual([{ metres: 500, sec: 90 }]);
  });
});

describe('burpees and lifts from the floor', () => {
  it('counts a burpee as bodyweight × (squat high height + 6 in)', () => {
    const w = resultWork({ performed: { id: 'b', structure: { kind: 'for-time' }, scoreType: 'time', movements: [{ movement: { family: 'burpee' }, reps: 100 }] }, score: { timeSec: 400 }, completed: true }, 'male', greg);
    expect(w.work).toBe(Math.round((100 * 200 * (36 + 6)) / 12));
  });
  it('counts the body rising in a snatch from the floor, not from the hang', () => {
    const one = (start?: 'hang') => resultWork({ performed: { id: 's', structure: { kind: 'for-time' }, scoreType: 'time', movements: [
      { movement: { family: 'snatch', implement: 'dumbbell', count: 'alternating', ...(start ? { start } : {}) }, reps: 10, load: { male: 50, unit: 'lb' } }] }, score: { timeSec: 60 }, completed: true }, 'male', greg).work!;
    expect(one() - one('hang')).toBe(Math.round((10 * 200 * 26) / 12));
  });
});
