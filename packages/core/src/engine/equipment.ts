/**
 * Can this workout be done at this location by this many people?
 * Hard problems (missing equipment, load not achievable) exclude the workout; soft ones (shared stations) are warnings.
 */
import { FAMILY_BY_ID, type Implement } from '../movements/catalog';
import type { EquipmentProfile, Workout } from '../model/types';
import { nameOf } from '../movements/resolver';

export interface EquipmentCheck { ok: boolean; problems: string[]; warnings: string[] }

const KG = 2.20462;
const FREE: Implement[] = ['bodyweight', 'none'];

/** Equipment a movement needs beyond its implement (rack for barbell squats/bench, bench for bench press, p-bars for bar dips). */
function requirements(family: string, implement: Implement, variant?: string): Implement[] {
  const req: Implement[] = [];
  if (family === 'sit-up' && variant === 'ghd') req.push('ghd');
  if (family === 'hip-extension' && implement !== 'medball') req.push('ghd');
  if (family === 'dip' && implement === 'bar') return ['p-bars'];
  if (family === 'dip' && implement === 'box') return ['bench'];
  if (!FREE.includes(implement)) req.push(implement);
  if (implement === 'barbell' && ['back-squat', 'front-squat', 'bench-press'].includes(family)) req.push('rack');
  if (family === 'bench-press') req.push('bench');
  if (family === 'wall-ball' || (family === 'hspu' && implement === 'wall')) req.push('wall');
  return req;
}

function boxNeeded(variant?: string) { return !!variant && /box/.test(variant); }

/** Heaviest barbell load buildable from the profile's bars and plates (plates must be loaded in pairs). */
export function maxBarbellLb(p: EquipmentProfile): number {
  const bar = p.items.find((i) => i.implement === 'barbell');
  if (!bar) return 0;
  const barLb = Math.max(...(bar.loads?.map((l) => (l.unit === 'kg' ? l.value * KG : l.value)) ?? [45]));
  const plates = p.items.find((i) => i.implement === 'plate');
  if (!plates) return barLb;
  if (!plates.loads) return Infinity; // full gym: plates not itemized
  return barLb + plates.loads.reduce((a, l) => a + Math.floor(l.qty / 2) * 2 * (l.unit === 'kg' ? l.value * KG : l.value), 0);
}

function heaviest(p: EquipmentProfile, imp: Implement): number {
  const it = p.items.find((i) => i.implement === imp);
  if (!it) return 0;
  if (!it.loads) return Infinity;
  return Math.max(...it.loads.map((l) => (l.unit === 'kg' ? l.value * KG : l.value)));
}

export function checkEquipment(w: Workout, profile: EquipmentProfile, groupSize: number): EquipmentCheck {
  const problems: string[] = [], warnings: string[] = [];
  const have = (imp: Implement) => profile.items.find((i) => i.implement === imp && i.quantity > 0);
  for (const m of w.movements) {
    const f = FAMILY_BY_ID[m.movement.family];
    if (!f) continue;
    const imp = m.movement.implement ?? f.implements[0]!;
    const needs = requirements(f.id, imp, m.movement.variant);
    if (boxNeeded(m.movement.variant) || f.id === 'box-jump' || f.id === 'step-up') needs.push('box');
    for (const n of needs) {
      const item = have(n);
      if (!item) { problems.push(`${nameOf(m.movement)}: no ${n} at ${profile.name}`); continue; }
      const stationShared = ['rower', 'air-bike', 'bike-erg', 'ski-erg', 'rope', 'ghd', 'rack', 'bench', 'rings', 'sled', 'p-bars', 'barbell'].includes(n);
      if (stationShared && item.quantity < groupSize) warnings.push(`${item.quantity} ${n} for ${groupSize} people (stagger or alternate)`);
    }
    const lb = m.load?.male ?? m.load?.female;
    if (lb && !m.load?.percentOf) {
      const need = m.load!.unit === 'kg' ? lb * KG : lb;
      const max = imp === 'barbell' ? maxBarbellLb(profile) : imp === 'dumbbell' || imp === 'kettlebell' || imp === 'medball' ? heaviest(profile, imp) : Infinity;
      if (need > max + 0.5) problems.push(`${nameOf(m.movement)} ${Math.round(need)} lb > heaviest available ${Math.round(max)} lb`);
    }
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)], warnings: [...new Set(warnings)] };
}
