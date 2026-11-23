import { describe, expect, it } from 'vitest';
import { parseBtwbRow, personalize, type EquipmentProfile } from '../src/index';

const w241 = parseBtwbRow({ Date: '2024-03-01', Workout: '24.1', Description: '21 Dumbbell Snatches, 50 lbs\n21 Lateral Burpee Over Dumbbells\n15 Dumbbell Snatches, 50 lbs\n15 Lateral Burpee Over Dumbbells', 'Formatted Result': '12 mins', Result: '0', Performed: 'prescribed', Notes: '' }, 'male').workout;
const garage: EquipmentProfile = { id: 'garage', name: 'Home garage', items: [{ implement: 'dumbbell', quantity: 16, loads: [5, 10, 15, 20, 25, 35, 40, 50].map((value) => ({ value, unit: 'lb' as const, qty: 2 })) }] };
const lb = (w: ReturnType<typeof personalize>, sex: 'male' | 'female') => w.workout.movements[0]!.load?.[sex];

describe('personal versions (each person\'s Rx)', () => {
  it('keeps the standard Rx for someone without a profile', () => {
    const v = personalize(w241, { id: 'vadim', sex: 'male' });
    expect(lb(v, 'male')).toBe(50);
    expect(v.workout.version?.kind).toBe('standard');
    expect(v.changes).toEqual([]);
  });
  it('estimates the women\'s Rx when only the men\'s is written', () => {
    const olga = personalize(w241, { id: 'olga', sex: 'female' });
    expect(lb(olga, 'female')).toBe(35);
    expect(olga.workout.version?.kind).toBe('standard'); // an estimated standard Rx is still the standard, not personal
  });
  it('scales by the load profile and snaps to weights that exist at the location', () => {
    const sasha = personalize(w241, { id: 'sasha', sex: 'female', loadProfile: { dumbbell: 0.6 } }, garage);
    expect(lb(sasha, 'female')).toBe(20); // 35 × 0.6 = 21 → 20 lb dumbbell
    expect(sasha.workout.version).toEqual({ kind: 'personal', athleteId: 'sasha', source: 'profile' });
    const anton = personalize(w241, { id: 'anton', sex: 'male', loadProfile: { dumbbell: 0.5 } }, garage);
    expect(lb(anton, 'male')).toBe(25); // 50 × 0.5
    // No 30 lb dumbbell in the garage: 50 × 0.6 = 30 snaps to the nearest that exists (25 or 35).
    expect([25, 35]).toContain(lb(personalize(w241, { id: 'x', sex: 'male', loadProfile: { dumbbell: 0.6 } }, garage), 'male'));
  });
  it('lets the coach override a day\'s weight, and leaves the standard workout untouched', () => {
    const v = personalize(w241, { id: 'anton', sex: 'male', loadProfile: { dumbbell: 0.5 } }, garage, { 0: 20, 2: 20 });
    expect(v.workout.movements[0]!.load?.male).toBe(20);
    expect(v.workout.version?.source).toBe('coach');
    expect(w241.movements[0]!.load?.male).toBe(50);
  });
});
