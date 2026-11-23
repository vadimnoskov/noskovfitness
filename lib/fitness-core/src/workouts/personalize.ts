/**
 * A person's own version of a workout ("their Rx"): the standard Rx for their sex, scaled by their standing load
 * profile, snapped to weights that exist at the day's location. Movements and reps are unchanged here; time-matched
 * reps and movement progressions come later. The standard workout itself is never modified.
 */
import { FAMILY_BY_ID, type Implement } from '../movements/catalog';
import type { EquipmentProfile, LoadKind, LoadProfile, MovementPrescription, Workout } from '../model/types';

const KG = 2.20462;
export const OTHER_SEX_RATIO = 0.7; // women's Rx ≈ 70% of men's when only one is written

export function loadKind(m: MovementPrescription): LoadKind {
  const imp = m.movement.implement ?? FAMILY_BY_ID[m.movement.family]?.implements[0];
  if (imp === 'barbell' || imp === 'dumbbell' || imp === 'kettlebell' || imp === 'medball') return imp;
  return 'other';
}

/** Standard Rx for this sex; estimated from the other sex's Rx when only that is written. */
export function standardRx(m: MovementPrescription, sex: 'male' | 'female'): { value: number; unit: 'lb' | 'kg'; estimated: boolean } | undefined {
  const l = m.load;
  if (!l || l.percentOf) return undefined;
  const mine = sex === 'female' ? l.female : l.male;
  if (mine !== undefined) return { value: mine, unit: l.unit, estimated: false };
  const other = sex === 'female' ? l.male : l.female;
  if (other === undefined) return undefined;
  return { value: sex === 'female' ? other * OTHER_SEX_RATIO : other / OTHER_SEX_RATIO, unit: l.unit, estimated: true };
}

/** Weights that exist at a location for an implement, in the given unit (undefined = not itemized: use steps). */
export function availableWeights(profile: EquipmentProfile | undefined, imp: Implement, unit: 'lb' | 'kg'): number[] | undefined {
  const item = profile?.items.find((i) => i.implement === imp);
  if (!item?.loads?.length) return undefined;
  return item.loads.map((l) => (l.unit === unit ? l.value : unit === 'lb' ? l.value * KG : l.value / KG)).sort((a, b) => a - b);
}

/** Round to a sensible increment, or to the nearest weight that exists. */
export function snap(value: number, kind: LoadKind, unit: 'lb' | 'kg', available?: number[]): number {
  if (available?.length) return available.reduce((b, w) => (Math.abs(w - value) < Math.abs(b - value) ? w : b));
  const step = unit === 'kg' ? (kind === 'kettlebell' ? 2 : 2.5) : kind === 'medball' ? 2 : 5;
  const min = unit === 'kg' ? 2 : kind === 'medball' ? 4 : 5;
  return Math.max(min, Math.round(value / step) * step);
}

export interface Personalized { workout: Workout; changes: { index: number; from?: number; to: number; unit: 'lb' | 'kg' }[] }

/** Build a person's version. `override` (coach's per-day weights by movement index) wins over the profile. */
export function personalize(
  workout: Workout,
  athlete: { id: string; sex: 'male' | 'female'; loadProfile?: LoadProfile | null },
  location?: EquipmentProfile,
  override?: Record<number, number>,
): Personalized {
  const changes: Personalized['changes'] = [];
  const movements = workout.movements.map((m, i) => {
    const rx = standardRx(m, athlete.sex);
    if (!rx) return m;
    const kind = loadKind(m);
    const factor = athlete.loadProfile?.[kind] ?? 1;
    const imp = m.movement.implement ?? FAMILY_BY_ID[m.movement.family]?.implements[0];
    const avail = imp && kind !== 'other' && kind !== 'barbell' ? availableWeights(location, imp, rx.unit) : undefined;
    // The standard Rx for this sex (an estimate is rounded to a real weight); only departures from it are personal.
    const standardMine = rx.estimated ? snap(rx.value, kind, rx.unit, avail) : rx.value;
    const target = override?.[i] ?? (factor === 1 ? standardMine : snap(rx.value * factor, kind, rx.unit, avail));
    const value = Math.round(target * 10) / 10;
    if (value !== standardMine) changes.push({ index: i, from: standardMine, to: value, unit: rx.unit });
    return { ...m, load: { ...m.load!, unit: rx.unit, [athlete.sex]: value } };
  });
  const personal = changes.length > 0;
  return {
    workout: { ...workout, movements, version: personal ? { kind: 'personal', athleteId: athlete.id, source: override ? 'coach' : 'profile' } : { kind: 'standard' } },
    changes,
  };
}
