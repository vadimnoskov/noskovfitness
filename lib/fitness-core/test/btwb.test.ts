import { describe, expect, it } from 'vitest';
import { parseBtwbRow, deriveTags, nameOf } from '../src/index';

const row = (Workout: string, Description: string, fr: string, Result = '0', Performed = 'prescribed') =>
  ({ Date: '2025-01-01', 'Formatted Result': fr, Result, Performed, Workout, Description, Notes: '' });

describe('BTWB import', () => {
  it('parses Fran as a 21-15-9 couplet with a time score', () => {
    const p = parseBtwbRow(row('Fran', '21 Thrusters 95 lbs\n21 Pull-ups\n15 Thrusters 95 lbs\n15 Pull-ups\n9 Thrusters 95 lbs\n9 Pull-ups', '5 mins 4 secs', '304000'), 'male');
    expect(p.result.score.timeSec).toBe(304);
    const t = deriveTags(p.workout, { resultSec: 304 });
    expect(t.modalityPattern).toEqual(['W', 'G']);
    expect(t.priority).toBe('task');
    expect(t.timeDomain).toBe('medium');
  });

  it('stores AMRAP rounds and extra reps separately', () => {
    const p = parseBtwbRow(row('Cindy', '5 Pull-ups\n10 Push-ups\n15 Air Squats', '16 rounds + 5 Pull-ups | 485 reps'), 'male');
    expect(p.workout.structure).toEqual({ kind: 'amrap', minutes: 0 });
    expect(p.result.score).toMatchObject({ rounds: 16, reps: 5 });
  });

  it('reads strength sets with per-set loads', () => {
    const p = parseBtwbRow(row('Back Squat : 5-5-5-5-5', 'Sets\n5 Back Squats | 135 lbs\n5 Back Squats | 155 lbs', '4225 lbs | 135 lbs, 155 lbs, 165 lbs, 185 lbs, and 205 lbs'), 'male');
    expect(p.workout.structure).toEqual({ kind: 'sets', scheme: [5, 5, 5, 5, 5] });
    expect(p.workout.movements).toHaveLength(1);
    expect(p.result.score.loads).toEqual([135, 155, 165, 185, 205]);
    expect(deriveTags(p.workout).load).toBe('heavy');
  });

  it('handles time trials, tabata lines and named complexes', () => {
    expect(nameOf(parseBtwbRow(row('Row 2 km TT', '2000 m Rows 7 mins 14 secs', '7 mins 14 secs', '434000'), 'male').workout.movements[0]!.movement)).toBe('Row');
    expect(parseBtwbRow(row('"Tabata" - Air Squats : 8 x 20 secs / 10 secs', 'Tabata Air Squat | 18,18', '144 reps'), 'male').workout.movements).toHaveLength(1);
    const bear = parseBtwbRow(row('Bear Complex : 7-7-7-7-7', '7 Bear Complexes 95 lbs', '575 lbs'), 'male');
    expect(bear.workout.movements.map((m) => nameOf(m.movement))).toEqual(['Power Clean', 'Front Squat', 'Push Press', 'Back Squat', 'Push Press']);
  });

  it('reads EMOM from the description and decimal rounds', () => {
    const p = parseBtwbRow(row('Chelsea', 'Every 1 min for 30 mins:\n5 Pull-ups\n10 Push-ups\n15 Air Squats', '19.0 rounds'), 'male');
    expect(p.workout.structure).toEqual({ kind: 'emom', minutes: 30, everySec: 60 });
    expect(p.result.score.rounds).toBe(19);
  });

  it('marks scaled sessions and converts kg loads', () => {
    const p = parseBtwbRow(row('Deadlift : 1 Rep Max', '1 Deadlift 100 kg', '100 kg', '100', 'modified'), 'male');
    expect(p.result.asPrescribed).toBe(false);
    expect(p.result.score.loads).toEqual([220]);
  });
});
