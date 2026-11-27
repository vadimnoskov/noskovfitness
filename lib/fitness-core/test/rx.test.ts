import { describe, it, expect } from 'vitest';
import { individualRx, scaleVolume, rampFactor, paceFactor, estimateMinutes } from '../src';
import type { Workout } from '../src/model/types';

const tags = (td: 'short' | 'medium' | 'long' | 'endurance' | 'heavy') => ({ modalityPattern: ['G' as const], movementCount: 2, load: 'bodyweight' as const, volume: 'medium' as const, timeDomain: td, priority: 'task' as const, pathway: 'glycolytic' as const });
const rounds = (n: number): Workout => ({ id: 'r', structure: { kind: 'for-time', rounds: n }, scoreType: 'time', movements: [{ movement: { family: 'pull-up' }, reps: 10 }, { movement: { family: 'push-up' }, reps: 20 }, { movement: { family: 'air-squat' }, reps: 30 }] });

describe('Individual Rx', () => {
  it('ramps volume by conditioning level: 60% + 40% × level', () => {
    expect(rampFactor(0.75)).toBeCloseTo(0.9);
    expect(rampFactor(0.5)).toBeCloseTo(0.8);
    expect(rampFactor(1)).toBe(1);
    expect(rampFactor(null)).toBe(1);
    const rx = individualRx(rounds(5), tags('long'), 1, 0.5);
    expect(rx.workout.structure).toMatchObject({ rounds: 4 });
    expect(rx.changes[0]!.kind).toBe('ramp');
  });
  it('scales volume when the predicted time is outside the window, and says why', () => {
    const w = rounds(10);
    const est = estimateMinutes(w)!;
    const rx = individualRx(w, tags('medium'), 1, null);
    expect(est).toBeGreaterThan(13);
    expect(rx.changes.some((c) => c.kind === 'volume' && /window is 4–12/.test(c.text))).toBe(true);
    expect(rx.predicted!.after).toBeLessThan(rx.predicted!.before);
  });
  it('takes the larger of window and ramp reductions, not both', () => {
    const rx = individualRx(rounds(10), tags('medium'), 1, 0.9);
    expect(rx.changes.filter((c) => c.kind === 'ramp')).toHaveLength(0);
  });
  it('leaves heavy days alone and scales schemes', () => {
    expect(individualRx({ ...rounds(1), structure: { kind: 'sets', scheme: [3, 3, 3] } }, tags('heavy'), 1, 0.25).changes).toEqual([]);
    const v = scaleVolume({ ...rounds(1), structure: { kind: 'for-time', scheme: [21, 15, 9] }, movements: [{ movement: { family: 'thruster' } }] }, 0.8)!;
    expect(v.text).toBe('21-15-9 → 17-12-7');
  });
  it('measures pace from finished for-time results', () => {
    const w = rounds(3), est = estimateMinutes(w)!;
    const res = Array.from({ length: 6 }, () => ({ performed: w, score: { timeSec: est * 60 * 1.3 }, completed: true }));
    expect(paceFactor(res).factor).toBeCloseTo(1.3, 1);
    expect(paceFactor(res.slice(0, 3)).factor).toBe(1);
  });
});

describe('Individual Rx rounding', () => {
  it('does not trim for small ramps, and rounds bigger rep counts to fives', () => {
    const w: Workout = { id: 'j', structure: { kind: 'for-time' }, scoreType: 'time', movements: [{ movement: { family: 'air-squat' }, reps: 50 }, { movement: { family: 'push-up' }, reps: 20 }] };
    const tg = { modalityPattern: ['G' as const], movementCount: 2, load: 'bodyweight' as const, volume: 'medium' as const, timeDomain: 'long' as const, priority: 'task' as const, pathway: 'oxidative' as const };
    expect(individualRx(w, tg, 1, 0.88).changes).toEqual([]);
    const rx = individualRx(w, tg, 1, 0.5);
    expect(rx.workout.movements.map((m) => m.reps)).toEqual([40, 16]);
  });
});
