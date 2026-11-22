import { describe, expect, it } from 'vitest';
import { resolve } from '../src/movements/resolver';
import { FAMILIES } from '../src/movements/catalog';

const name = (s: string) => resolve(s).name;
const key = (s: string) => resolve(s).key;

describe('movement resolver', () => {
  it('collapses spelling variants into one movement', () => {
    const rows = ['Row Calories', 'Row Calorie', 'Row (calories)', 'row (calories)s', 'Rows', 'row (meters)'];
    expect(new Set(rows.map(key))).toEqual(new Set(['row']));
    expect(new Set(['Toes-to-bars', 'toes to bars', 'Toes-to-bar'].map(key)).size).toBe(1);
    expect(new Set(['Pull-ups', 'pull-up', 'Pullups', 'Pull up'].map(key)).size).toBe(1);
  });

  it('keeps prescription details out of identity', () => {
    expect(key('Double Unders (Unbroken)')).toBe(key('Double Unders'));
    expect(resolve('Double Unders (Unbroken)').params.unbroken).toBe(true);
    expect(key('Weighted Strict Pull-ups')).toBe(key('Strict Pull-ups'));
    expect(resolve('Weighted Strict Pull-ups').params.weighted).toBe(true);
    expect(key('Tempo Back Squats')).toBe(key('Back Squats'));
    expect(resolve('Row Calories').params.unit).toBe('calories');
  });

  it('distinguishes genuinely different movements', () => {
    expect(name('Squat Snatches')).toBe('Squat Snatch');
    expect(name('Hang Power Snatches')).toBe('Hang Power Snatch');
    expect(name('High Hang Squat Snatch')).toBe('High Hang Squat Snatch');
    expect(name('Alternating Dumbbell Snatches')).toBe('Alternating Dumbbell Snatch');
    expect(name('Chest-to-bar Pull-ups')).toBe('Chest-to-bar Pull-up');
    expect(name('Strict Pull-ups')).toBe('Strict Pull-up');
    expect(name('Bar Muscle-ups')).toBe('Bar Muscle-up');
    expect(name('Ring Muscle-ups')).toBe('Ring Muscle-up');
    expect(name('Power Clean & Push Jerks')).toBe('Power Clean & Push Jerk');
    expect(name('Sumo Deadlift High-pulls')).toBe('Sumo Deadlift High Pull');
    expect(name('Snatch grip deadlift')).toBe('Snatch-grip Deadlift');
    expect(name('Burpee Box Jump Overs')).toBe('Burpee Box Jump Over');
    expect(name('Bar Facing Burpees')).toBe('Bar-facing Burpee');
    expect(name('GHD Sit-ups')).toBe('GHD Sit-up');
    expect(name('Kettlebell Front Rack Carry')).toBe('Kettlebell Front Rack Carry');
    expect(name('Assault Bike Calories')).toBe('Air Bike');
  });

  it('flags complexes and unknowns for human review instead of guessing silently', () => {
    expect(resolve('hang squat clean front squat squat clean').review).toBe('complex');
    expect(resolve('virtual shovelings').review).toBe('unknown');
  });

  it('every family has a unique id and at least one matcher', () => {
    const ids = FAMILIES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FAMILIES) expect(f.match.length).toBeGreaterThan(0);
  });
});
