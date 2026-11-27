import { describe, it, expect } from 'vitest';
import { plannedReps, doneReps, usualVolume, volumeWarnings, volumeKey } from '../src';
import type { Workout } from '../src/model/types';

const ft = (movements: Workout['movements'], extra: Partial<Workout['structure']> = {}): Workout => ({ id: 'w', structure: { kind: 'for-time', ...extra } as Workout['structure'], scoreType: 'time', movements });
const pu = (reps?: number, style?: 'jumping') => ({ movement: { family: 'pull-up', ...(style ? { style } : {}) }, ...(reps ? { reps } : {}) });

describe('volume warnings', () => {
  it('counts planned reps with schemes and rounds', () => {
    expect(plannedReps(ft([pu(), { movement: { family: 'thruster' } }], { scheme: [21, 15, 9] }))!.reps.get('pull-up')).toBe(45);
    expect(plannedReps(ft([pu(20)], { rounds: 5 }))!.reps.get('pull-up')).toBe(100);
    expect(volumeKey(pu(10, 'jumping'))).toBe('pull-up:jumping');
  });
  it('counts done reps for capped and AMRAP results', () => {
    const amrap: Workout = { id: 'a', structure: { kind: 'amrap', minutes: 20 }, scoreType: 'rounds-reps', movements: [pu(5), { movement: { family: 'push-up' }, reps: 10 }] };
    expect(doneReps({ performed: amrap, score: { rounds: 10, reps: 7 }, completed: true })!.get('push-up')).toBe(102);
  });
  it('warns on a jump over the usual, on a movement not done in a year, and after a layoff', () => {
    const hist = [{ date: '2026-10-20', performed: ft([pu(40)]), score: { timeSec: 300 }, completed: true }];
    const u = usualVolume(hist, '2026-11-01');
    expect(u.most.get('pull-up')).toBe(40);
    expect(volumeWarnings(ft([pu(50)], { rounds: 2 }), u, '2026-11-01')[0]).toMatch(/^100 pull-ups: 2.5×/);
    expect(volumeWarnings(ft([pu(70)]), u, '2026-11-01')).toEqual([]);
    expect(volumeWarnings(ft([{ movement: { family: 'sit-up', implement: 'ghd' }, reps: 20 }]), u, '2026-11-01')[0]).toMatch(/GHD sit-ups: none in the last 12 months/);
    expect(volumeWarnings(ft([pu(10)]), u, '2026-12-15')[0]).toMatch(/no results logged for 56 days/);
    // Counted to today, and only on the next two weeks of planned days.
    expect(volumeWarnings(ft([pu(10)]), u, '2026-11-05', undefined, '2026-11-01')).toEqual([]);
    expect(volumeWarnings(ft([pu(10)]), u, '2027-01-30', undefined, '2026-12-15')).toEqual([]);
  });
});
