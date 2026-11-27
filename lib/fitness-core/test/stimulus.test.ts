import { describe, it, expect } from 'vitest';
import { stimulusFor, splitReps } from '../src';
import type { Workout } from '../src/model/types';

const fran: Workout = { id: 'f', structure: { kind: 'for-time', scheme: [21, 15, 9] }, scoreType: 'time', movements: [
  { movement: { family: 'thruster', implement: 'barbell' }, load: { male: 95, female: 65, unit: 'lb' } }, { movement: { family: 'pull-up' } }] };
const tags = (td: 'short' | 'medium' | 'heavy') => ({ modalityPattern: ['W' as const, 'G' as const], movementCount: 2, load: 'medium' as const, volume: 'medium' as const, timeDomain: td, priority: 'task' as const, pathway: 'glycolytic' as const });

describe('stimulus', () => {
  it('matches the Fran lesson plan breaks: 21 → 3, 15 → 2, 9 → 1', () => {
    const s = stimulusFor(fran, tags('medium'));
    const pu = s.breaks.filter((b) => b.movement === 'Pull-up').map((b) => [b.reps, b.maxBreaks]);
    expect(pu).toEqual([[21, 3], [15, 2], [9, 1]]);
    expect(splitReps(21, 4)).toEqual([6, 5, 5, 5]);
  });
  it('uses the person’s own time for the window and gives checkpoints per set', () => {
    const s = stimulusFor(fran, tags('medium'), { bestSec: 300 });
    expect(s.window).toEqual({ min: 4.5, max: 5.5, from: 'your results' });
    expect(s.checkpoints).toHaveLength(3);
    expect(s.checkpoints[0]).toMatch(/^after the 21s 2:20/);
  });
  it('gives heavy days the strength intent and no window', () => {
    const s = stimulusFor({ ...fran, structure: { kind: 'sets', scheme: [3, 3, 3, 3, 3] } }, tags('heavy'));
    expect(s.intent).toMatch(/^Heavy day/);
    expect(s.window).toBeNull();
    expect(s.breaks).toEqual([]);
  });
  it('skips easy movements and estimates AMRAP rounds', () => {
    const cindy: Workout = { id: 'c', structure: { kind: 'amrap', minutes: 20 }, scoreType: 'rounds-reps', movements: [
      { movement: { family: 'pull-up' }, reps: 5 }, { movement: { family: 'push-up' }, reps: 10 }, { movement: { family: 'air-squat' }, reps: 15 }] };
    const s = stimulusFor(cindy, undefined);
    expect(s.breaks.map((b) => b.movement)).toEqual(['Push-up']);
    expect(s.rounds!.min).toBeGreaterThan(5);
  });
});
