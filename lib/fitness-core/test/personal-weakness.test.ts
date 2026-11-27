import { describe, it, expect } from 'vitest';
import type { Workout } from '../src/model/types';
import { movementWeaknesses, weaknessList, weaknessWork, skillKey, SKILL_MOVEMENTS } from '../src/workouts/personal-weakness';

const wo = (...fams: string[]): Workout => ({ id: 'x', structure: { kind: 'for-time' }, scoreType: 'time', movements: fams.map((f) => ({ movement: f === 'du' ? { family: 'jump-rope', variant: 'double-under' } : { family: f } })) } as Workout);
const res = (date: string, w: Workout, rx: boolean) => ({ date, performed: w, asPrescribed: rx });

describe('movementWeaknesses', () => {
  const rows = [
    // HSPU workouts are nearly always modified; thrusters only come along with them.
    ...[1, 2, 3, 4, 5].map((i) => res(`2026-0${i}-01`, wo('hspu', 'thruster', 'pull-up'), false)),
    res('2026-06-01', wo('hspu'), true),
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => res(`2026-0${i}-15`, wo('pull-up', 'air-squat'), true)),
    ...[1, 2, 3, 4].map((i) => res(`2025-0${i}-10`, wo('du', 'deadlift'), i !== 1)),
  ];
  it('finds the movement modified far more often than usual, and explains away the ones that come with it', () => {
    const w = movementWeaknesses(rows, '2026-11-27');
    expect(w.map((x) => x.key)).toEqual(['hspu']);
    expect(w[0]).toMatchObject({ n: 6, modified: 5, last: '2026-05-01' });
  });
  it('only counts results inside the window', () => {
    expect(movementWeaknesses(rows, '2030-01-01')).toEqual([]);
  });
  it('counts skill movements only', () => {
    expect(skillKey({ movement: { family: 'thruster' } } as never)).toBeUndefined();
    expect(skillKey({ movement: { family: 'air-squat' } } as never)).toBeUndefined();
    expect(skillKey({ movement: { family: 'jump-rope', variant: 'double-under' } } as never)).toBe('jump-rope:du');
    expect(SKILL_MOVEMENTS.some((m) => m.key === 'muscle-up')).toBe(true);
  });
});

describe('weaknessWork', () => {
  const list = weaknessList(['muscle-up', 'pistol'], [{ key: 'hspu', name: 'Handstand Push-up', n: 6, modified: 5, rate: 5 / 6, baseline: 0.1, last: '2026-05-01' }]);
  it('puts the coach\'s choices first, then results', () => {
    expect(list.map((x) => [x.key, x.from])).toEqual([['muscle-up', 'coach'], ['pistol', 'coach'], ['hspu', 'results']]);
  });
  it('skips movements in today\'s workout, same-pattern movements and the day\'s skill block', () => {
    const w = weaknessWork(list, wo('pistol', 'row'), '2026-12-01', ['muscle-up', 'pull-up']);
    expect(w?.title).toBe('Weakness work: Handstand Push-up');
    expect(w?.lines.at(-1)).toMatch(/must not take anything/);
    expect(weaknessWork(list, wo('hspu', 'pistol', 'muscle-up'), '2026-12-01')).toBeUndefined();
  });
  it('rotates by date among what is left', () => {
    const keys = new Set(['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06'].map((d) => weaknessWork(list, wo('row'), d)?.title));
    expect(keys.size).toBeGreaterThan(1);
  });
});
