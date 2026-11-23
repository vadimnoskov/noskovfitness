/**
 * BTWB CSV export → structured Workout + Result.
 * Columns: Date, Formatted Result, Result, Performed, Workout, Description, Notes.
 * The original text is always kept on the workout (originalText) so nothing is lost while the parser improves.
 */
import { resolveSequence } from '../movements/resolver';
import type { MovementPrescription, Result, ScoreType, Structure, Workout, Units } from '../model/types';

export interface BtwbRow { Date: string; 'Formatted Result': string; Result: string; Performed: string; Workout: string; Description: string; Notes: string }

export interface ParsedSession {
  workout: Workout;
  result: Omit<Result, 'id' | 'athleteId' | 'workoutId'>;
  warnings: string[];
}

const KG = 2.20462;
/** Named complexes written as one line expand into their catalog movements (each counts toward the movement map). */
const EXPANSIONS: Record<string, string[]> = {
  'bear complex': ['Power Clean', 'Front Squat', 'Push Press', 'Back Squat', 'Push Press'],
};
const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));

const STRUCTURE_LINE = /^(\d+ rounds?(, each round for time,)? of:?|\d+:\d\d amrap:?|amreps in|sets$|rest|resting|-- then --|then|for time:?|\*|every|prior to|in remaining|complete|post|\d+(-\d+)+ reps( of| for time)?:?|emom|on the minute|alternating|minute \d|round \d)/i;

export function parseTimeSec(s: string): number | undefined {
  const m = s.match(/(?:(\d+)\s*hrs?\s*)?(?:(\d+)\s*mins?\s*)?(?:([\d.]+)\s*secs?)?/);
  if (!m || (!m[1] && !m[2] && !m[3])) return undefined;
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
}

export function parseStructure(name: string, desc: string, scoreType: ScoreType): Structure {
  const n = name.trim();
  const d = desc.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = n.match(/^AMRAP (\d+) mins?/i)) || (m = d.match(/^(\d+):00 amrap/m))) return { kind: 'amrap', minutes: Number(m[1]) };
  if ((m = n.match(/^AMReps (\d+) mins?/i))) return { kind: 'amrap', minutes: Number(m[1]) };
  if ((m = n.match(/^(?:Alt )?EMOM (\d+) mins?/i))) return { kind: 'emom', minutes: Number(m[1]) };
  if ((m = n.match(/^Every (\d+) mins? for (\d+) mins?/i))) return { kind: 'emom', minutes: Number(m[2]), everySec: Number(m[1]) * 60 };
  if (/tabata/i.test(n) || /tabata/.test(d)) return { kind: 'tabata' };
  if ((m = n.match(/^(\d+)x (\d+) mins/i))) return { kind: 'intervals', rounds: Number(m[1]), restSec: 0, workSec: Number(m[2]) * 60, scored: 'reps' };
  if ((m = n.match(/^(\d+)x RFT/i)) || (m = d.match(/^(\d+) rounds, each round for time/m))) {
    const rest = d.match(/rest(?:ing)? (\d+) (min|sec)/);
    return { kind: 'intervals', rounds: Number(m[1]), restSec: rest ? Number(rest[1]) * (rest[2] === 'min' ? 60 : 1) : 0, scored: 'time' };
  }
  if ((m = n.match(/:\s*(\d+(?:-\d+)+)\s*$/))) return { kind: 'sets', scheme: m[1]!.split('-').map(Number) };
  if ((m = n.match(/:\s*(\d+) Rep Max/i))) return { kind: 'max', what: 'load' };
  if (/:\s*Max (Set|Reps)/i.test(n)) return { kind: 'max', what: 'reps' };
  if ((m = n.match(/^(\d+) RFT/i)) || (m = d.match(/^(\d+) rounds( for time)? of/m))) return { kind: 'for-time', rounds: Number(m[1]) };
  if ((m = n.match(/^(\d+(?:-\d+)+)\b/)) || (m = d.match(/^(\d+(?:-\d+)+) reps/m))) return { kind: 'for-time', scheme: m[1]!.split('-').map(Number) };
  if (scoreType === 'load') return { kind: 'max', what: 'load' };
  if (scoreType === 'rounds-reps') return { kind: 'amrap', minutes: Number(d.match(/(\d+) min/)?.[1] ?? 0) };
  if (scoreType === 'reps' && /amreps|max reps/.test(d)) return { kind: 'max', what: 'reps' };
  return { kind: 'for-time' };
}

export function scoreTypeOf(formatted: string): ScoreType {
  const f = formatted.split('|')[0]!.toLowerCase();
  if (/rounds?/.test(f)) return 'rounds-reps';
  if (/(mins?|secs?|hrs?)\b/.test(f)) return 'time';
  if (/\b(lbs?|kg)\b/.test(f)) return 'load';
  if (/\breps?\b/.test(f)) return 'reps';
  if (/^\s*[\d.]+ m\s*$/.test(f)) return 'distance';
  if (/completed/.test(f)) return 'none';
  return 'reps';
}

/** One description line → zero or more movement prescriptions (complexes split into several). */
export function parseLine(line: string, sex: 'male' | 'female'): MovementPrescription[] {
  let raw = line.trim().replace(/^tabata\s+/i, '');
  if (!raw || STRUCTURE_LINE.test(raw)) return [];
  const [main = '', actual] = raw.split('|').map((x) => x.trim());
  let text = main;
  const out: Partial<MovementPrescription> = {};
  // Time-trial style: "500 m Rows 1 min 44 secs", "2000 m Rows", "Rows 2 mins"
  const tt = text.match(/^([\d.]+)\s*(m|km|mi)\s+(.+)$/i);
  if (tt) { out.distanceM = Number(tt[1]) * (tt[2] === 'km' ? 1000 : tt[2] === 'mi' ? 1609 : 1); text = tt[3]!; }
  const trailingTime = text.match(/\s+(\d+\s*(hrs?|mins?|secs?)\b.*)$/i);
  if (trailingTime) { if (!tt) out.seconds = parseTimeSec(trailingTime[1]!); text = text.slice(0, trailingTime.index); }
  const expansion = Object.entries(EXPANSIONS).find(([k]) => new RegExp(k, 'i').test(text));
  const lead = text.match(/^(\d+(?:\.\d+)?)\s+(?!m\b|km\b|mi\b)/);
  if (lead) { out.reps = Number(lead[1]); text = text.slice(lead[0].length); }
  const parts = text.split(',').map((p) => p.trim());
  const name = parts.shift() ?? '';
  for (const p of parts) {
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^([\d.]+)\s*(lbs?|kg|pood)\b/i))) {
      const v = Number(m[1]); const unit: Units = /kg|pood/i.test(m[2]!) ? 'kg' : 'lb';
      const val = /pood/i.test(m[2]!) ? v * 16 : v;
      out.load = { unit, [sex]: val };
    } else if ((m = p.match(/^([\d.]+)%\s*1RM/i))) out.load = { unit: 'lb', percentOf: { movementKey: '', pct: Number(m[1]) } };
    else if ((m = p.match(/^([\d.]+)\s*(m|km|mi|yds?)\b/i))) out.distanceM = Number(m[1]) * ({ km: 1000, mi: 1609, yd: 0.9144, yds: 0.9144 }[m[2]!.toLowerCase()] ?? 1);
    else if ((m = p.match(/^([\d.]+)\s*in\b/i))) out.heightIn = { [sex]: Number(m[1]) };
    else if ((m = p.match(/^([\d.]+)\s*ft\b/i))) out.heightIn = { [sex]: Number(m[1]) * 12 }; // rope or wall-ball target height
    else if ((m = p.match(/^([\d.]+)\s*(secs?|mins?)/i))) out.seconds = Number(m[1]) * (/min/.test(m[2]!) ? 60 : 1);
  }
  // Performed load recorded after the pipe on set lines, e.g. "1 Overhead Squat | 115 lbs"
  if (!out.load && actual) {
    const m = actual.match(/^([\d.]+)\s*(lbs?|kg)/i);
    if (m) out.load = { unit: /kg/i.test(m[2]!) ? 'kg' : 'lb', [sex]: Number(m[1]) };
  }
  const isCal = /calorie|\bcals?\b/i.test(name);
  if (isCal && out.reps) { out.calories = out.reps; delete out.reps; }
  if (expansion) return expansion[1].map((n) => ({ ...out, movement: resolveSequence(n)[0]!.ref! }) as MovementPrescription);
  const seq = resolveSequence(name);
  return seq.filter((r) => r.ref).map((r) => ({ ...out, movement: r.ref!, ...(Object.keys(r.params).length ? { params: r.params } : {}) }) as MovementPrescription);
}

/** Collapse repeated identical set lines ("1 Overhead Squat | 115 lbs" ×7) into one line; order within a line is kept. */
function collapseSets(lines: MovementPrescription[][], s: Structure): MovementPrescription[] {
  if (s.kind !== 'sets' && s.kind !== 'max') return lines.flat();
  const seen = new Set<string>(); const out: MovementPrescription[] = [];
  for (const line of lines) {
    const sig = line.map((m) => JSON.stringify(m.movement)).join('+');
    if (!line.length || seen.has(sig)) continue;
    seen.add(sig);
    out.push(...line.map((m) => ({ movement: m.movement, ...(m.params ? { params: m.params } : {}) })));
  }
  return out;
}

export function parseScore(formatted: string, resultRaw: string, type: ScoreType, units: Units): Result['score'] {
  const [head = '', tail] = formatted.split('|').map((x) => x.trim());
  const score: Result['score'] = {};
  if (type === 'time') score.timeSec = Number(resultRaw) > 0 ? Number(resultRaw) / 1000 : parseTimeSec(head);
  if (type === 'rounds-reps') {
    score.rounds = Number(head.match(/(\d+)\s*rounds?/)?.[1] ?? 0);
    const extra = [...head.matchAll(/\+\s*(\d+)\s+(?!m\b)([A-Za-z])/g)].reduce((a, m) => a + Number(m[1]), 0);
    score.reps = extra;
  }
  if (type === 'reps') score.reps = Number(head.match(/([\d.]+)/)?.[1] ?? resultRaw);
  if (type === 'distance') score.distanceM = Number(head.match(/([\d.]+)/)?.[1]);
  if (type === 'load') {
    const conv = (v: number, u: string) => (u.startsWith('kg') && units === 'lb' ? Math.round(v * KG) : v);
    const sets = tail ? [...tail.matchAll(/([\d.]+)\s*(lbs?|kg)/g)].map((m) => conv(Number(m[1]), m[2]!)) : [];
    const h = head.match(/([\d.]+)\s*(lbs?|kg)/);
    score.loads = sets.length ? sets : h ? [conv(Number(h[1]), h[2]!)] : [];
  }
  return score;
}

export function parseBtwbRow(row: BtwbRow, sex: 'male' | 'female', units: Units = 'lb'): ParsedSession {
  const warnings: string[] = [];
  const scoreType = scoreTypeOf(row['Formatted Result']);
  const structure = parseStructure(row.Workout, row.Description, scoreType);
  const movements = collapseSets(row.Description.split('\n').map((l) => parseLine(l, sex)), structure);
  if (!movements.length) warnings.push('no movements recognized');
  const workout: Workout = {
    id: '',
    name: row.Workout.trim(),
    structure,
    movements,
    scoreType: structure.kind === 'sets' ? 'load' : scoreType,
    source: 'BTWB import',
    originalText: row.Description,
  };
  const score = parseScore(row['Formatted Result'], row.Result, scoreType, units);
  const result: ParsedSession['result'] = {
    date: row.Date,
    performed: workout,
    asPrescribed: row.Performed === 'prescribed',
    completed: !row['Formatted Result'].trim().startsWith('*'),
    score,
    ...(row.Notes?.trim() ? { notes: row.Notes.trim() } : {}),
    source: 'btwb-import',
  };
  return { workout, result, warnings };
}
