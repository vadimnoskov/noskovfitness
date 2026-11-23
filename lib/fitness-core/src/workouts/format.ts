import { nameOf } from '../movements/resolver';
import type { MovementPrescription, Structure, Workout, Result } from '../model/types';

export function structureLabel(s: Structure): string {
  switch (s.kind) {
    case 'amrap': return s.minutes ? `AMRAP ${s.minutes} min` : 'AMRAP';
    case 'emom': return s.everySec && s.everySec !== 60 ? `Every ${s.everySec / 60} min for ${s.minutes} min` : `EMOM ${s.minutes} min`;
    case 'for-time': return s.scheme ? `${s.scheme.join('-')} for time` : s.rounds && s.rounds > 1 ? `${s.rounds} rounds for time` : 'For time';
    case 'intervals': return `${s.rounds} intervals${s.restSec ? `, rest ${s.restSec >= 60 ? `${s.restSec / 60} min` : `${s.restSec} s`}` : ''}`;
    case 'tabata': return 'Tabata';
    case 'sets': return s.scheme.join('-');
    case 'max': return s.what === 'load' ? 'Max load' : s.what === 'reps' ? 'Max reps' : 'Max distance';
    case 'skill-practice': return `Practice ${s.minutes} min`;
  }
}

function loadText(m: MovementPrescription, sex: 'male' | 'female'): string {
  const l = m.load;
  if (!l) return '';
  if (l.percentOf) return ` @ ${l.percentOf.pct}%`;
  const v = sex === 'female' ? l.female ?? l.male : l.male ?? l.female;
  const other = sex === 'female' ? l.male : l.female;
  if (v === undefined) return '';
  return other !== undefined && other !== v && sex === 'male' ? ` ${v}/${other} ${l.unit}` : ` ${v} ${l.unit}`;
}

export function movementLine(m: MovementPrescription, sex: 'male' | 'female' = 'male'): string {
  const name = nameOf(m.movement);
  const qty = m.calories ? `${m.calories} cal ` : m.reps ? `${m.reps} ` : '';
  const dist = m.distanceM ? (m.distanceM >= 1000 ? ` ${+(m.distanceM / 1000).toFixed(2)} km` : m.distanceM === 1609 ? ' 1 mi' : ` ${Math.round(m.distanceM)} m`) : '';
  return `${qty}${name}${dist}${loadText(m, sex)}`.trim();
}

/** Compact one-line title, e.g. "AMRAP 20 min: Pull-up / Push-up / Air Squat". */
export function workoutTitle(w: Pick<Workout, 'name' | 'structure' | 'movements' | 'benchmark'>): string {
  if (w.benchmark || (w.name && !/^(AMRAP|AMReps|FT|\d+x? RFT|\d+ RF|Every|Alt EMOM|EMOM|Chipper|Lifting|Complex|\d+-\d+)/i.test(w.name) && !w.name.includes(':'))) return w.name ?? '';
  // Strength and max tests are already clearly named ("Press : 2 Rep Max", "Back Squat : 5-5-5-5-5").
  if (w.name && / : (\d+ Rep Max|\d+(-\d+)+|Max Set|\d+ Reps for Time)$/i.test(w.name)) return w.name.replace(' : ', ': ');
  const seen = new Set<string>();
  const names = w.movements.map((m) => nameOf(m.movement)).filter((n) => (seen.has(n) ? false : (seen.add(n), true)));
  if (w.structure.kind === 'sets' || w.structure.kind === 'max') return `${names.join(' + ')} ${structureLabel(w.structure)}`;
  return `${structureLabel(w.structure)}: ${names.join(' / ')}`;
}

export function scoreText(r: Pick<Result, 'score' | 'completed'>): string {
  const s = r.score;
  if (s.timeSec !== undefined) { const m = Math.floor(s.timeSec / 60), sec = Math.round(s.timeSec % 60); return `${m}:${String(sec).padStart(2, '0')}${r.completed ? '' : ' (capped)'}`; }
  if (s.rounds !== undefined) return `${s.rounds} rds${s.reps ? ` + ${s.reps}` : ''}`;
  if (s.loads?.length) return s.loads.length > 1 ? `${Math.max(...s.loads)} lb top (${s.loads.join(', ')})` : `${s.loads[0]} lb`;
  if (s.reps !== undefined) return `${s.reps} reps`;
  if (s.distanceM !== undefined) return `${s.distanceM} m`;
  return 'done';
}
