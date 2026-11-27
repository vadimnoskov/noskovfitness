/**
 * Work and average power of a logged result, CrossFit's way (L1 Training Guide, "What Is Fitness? Part 2", Table 1;
 * "Fooling Around with Fran", CFJ 2006): work = force × distance, where force is the athlete's bodyweight moved the
 * distance their centre of mass travels, plus the load moved the distance it travels; power = work / time.
 *
 * It is a zero-order estimate (no dynamics, the centre of mass is approximated), and the sources say so. Its errors
 * are the same every time a person does the same workout, so comparisons over time hold.
 *
 * Distances come from the five heights BTWB's work-formula form asks for (squat low, squat high, shoulder, overhead,
 * deadlift/knuckle). Only movements whose travel follows from those heights are counted. A result with any other
 * movement (running, rowing, burpees, sit-ups, …) gets no number rather than a guessed one; `missing` names them.
 */
import type { Workout, MovementPrescription, Result } from '../model/types';
type Sex = 'male' | 'female';

export interface BodyDims {
  /** lb */ weight: number;
  /** All heights in inches, from the ground. */
  squatLow: number; squatHigh: number; shoulder: number; overhead: number; knuckle: number;
}
export const DIM_KINDS = ['weight', 'squat-low', 'squat-high', 'shoulder-height', 'overhead-height', 'knuckle-height'] as const;
export type DimKind = typeof DIM_KINDS[number];
export const DIM_LABELS: Record<DimKind, { label: string; how: string }> = {
  weight: { label: 'Bodyweight', how: 'On a scale, at about the same time of day.' },
  'squat-low': { label: 'Squat low height', how: 'Ground to the bottom of the butt at full squat depth.' },
  'squat-high': { label: 'Squat high height', how: 'Ground to the bottom of the butt cheek, standing.' },
  'shoulder-height': { label: 'Shoulder height', how: 'Ground to the top of the shoulders, standing.' },
  'overhead-height': { label: 'Overhead height', how: 'Ground to the palm, arms extended overhead.' },
  'knuckle-height': { label: 'Deadlift height', how: 'Ground to the knuckles, standing with arms hanging.' },
};

/** Bar height off the floor with full-size (450 mm) plates: the plate radius, 8.86 in. */
export const BAR_FROM_FLOOR_IN = 8.86;

type PerRep = (d: BodyDims, loadLb: number, m: MovementPrescription, sex: Sex) => number | undefined;
/** Hip travel in a squat: squat high minus squat low (the centre-of-mass proxy in the Fran tables). */
const sq = (d: BodyDims) => d.squatHigh - d.squatLow;
/** Hands from shoulders to overhead: the pull-up and press travel. */
const arm = (d: BodyDims) => d.overhead - d.shoulder;
const squatReceive = (m: MovementPrescription) => m.movement.receive === 'squat';

/**
 * Inch-pounds per rep. "source": the distance rule is the one the Fran tables use. "derived": the same rule applied
 * to another movement from the five heights. Families not listed are not counted.
 */
const MODEL: Record<string, { basis: 'source' | 'derived'; perRep: PerRep; rule: string }> = {
  thruster: { basis: 'source', rule: 'body × squat travel + load × (squat travel + shoulder-to-overhead)', perRep: (d, l) => d.weight * sq(d) + l * (sq(d) + arm(d)) },
  'pull-up': { basis: 'source', rule: 'body × shoulder-to-overhead', perRep: (d) => d.weight * arm(d) },
  'air-squat': { basis: 'source', rule: 'body × squat travel', perRep: (d) => d.weight * sq(d) },
  'front-squat': { basis: 'derived', rule: '(body + load) × squat travel', perRep: (d, l) => (d.weight + l) * sq(d) },
  'back-squat': { basis: 'derived', rule: '(body + load) × squat travel', perRep: (d, l) => (d.weight + l) * sq(d) },
  'overhead-squat': { basis: 'derived', rule: '(body + load) × squat travel', perRep: (d, l) => (d.weight + l) * sq(d) },
  'goblet-squat': { basis: 'derived', rule: '(body + load) × squat travel', perRep: (d, l) => (d.weight + l) * sq(d) },
  press: { basis: 'derived', rule: 'load × shoulder-to-overhead', perRep: (d, l) => l * arm(d) },
  'push-press': { basis: 'derived', rule: 'load × shoulder-to-overhead', perRep: (d, l) => l * arm(d) },
  jerk: { basis: 'derived', rule: 'load × shoulder-to-overhead', perRep: (d, l) => l * arm(d) },
  'shoulder-to-overhead': { basis: 'derived', rule: 'load × shoulder-to-overhead', perRep: (d, l) => l * arm(d) },
  deadlift: { basis: 'derived', rule: 'load × (knuckle height − bar height); body not counted', perRep: (d, l) => l * (d.knuckle - BAR_FROM_FLOOR_IN) },
  sdhp: { basis: 'derived', rule: 'load × (shoulder height − bar height)', perRep: (d, l) => l * (d.shoulder - BAR_FROM_FLOOR_IN) },
  clean: { basis: 'derived', rule: 'load × (shoulder height − bar height), + body × squat travel when received in a squat',
    perRep: (d, l, m) => l * (d.shoulder - BAR_FROM_FLOOR_IN) + (squatReceive(m) ? d.weight * sq(d) : 0) },
  snatch: { basis: 'derived', rule: 'load × (overhead height − bar height), + body × squat travel when received in a squat',
    perRep: (d, l, m) => l * (d.overhead - BAR_FROM_FLOOR_IN) + (squatReceive(m) ? d.weight * sq(d) : 0) },
  'clean-and-jerk': { basis: 'derived', rule: 'clean + jerk',
    perRep: (d, l, m) => l * (d.shoulder - BAR_FROM_FLOOR_IN) + (squatReceive(m) ? d.weight * sq(d) : 0) + l * arm(d) },
  'ground-to-overhead': { basis: 'derived', rule: 'load × (overhead height − bar height)', perRep: (d, l) => l * (d.overhead - BAR_FROM_FLOOR_IN) },
  'wall-ball': { basis: 'derived', rule: 'body × squat travel + ball × (target − shoulder height in the squat)',
    perRep: (d, l, m, sex) => { const t = (sex === 'female' ? m.heightIn?.female : m.heightIn?.male) ?? (sex === 'female' ? 108 : 120); return d.weight * sq(d) + l * (t - (d.shoulder - sq(d))); } },
  'box-jump': { basis: 'derived', rule: 'body × box height', perRep: (d, _l, m, sex) => { const h = sex === 'female' ? m.heightIn?.female ?? m.heightIn?.male : m.heightIn?.male; return h ? d.weight * h : undefined; } },
  'step-up': { basis: 'derived', rule: '(body + load) × box height', perRep: (d, l, m, sex) => { const h = sex === 'female' ? m.heightIn?.female ?? m.heightIn?.male : m.heightIn?.male; return h ? (d.weight + l) * h : undefined; } },
};
export const WORK_MODEL = Object.fromEntries(Object.entries(MODEL).map(([k, v]) => [k, { basis: v.basis, rule: v.rule }]));

const toLb = (v: number, unit: string) => (unit === 'kg' ? v * 2.20462 : v);
function loadLb(m: MovementPrescription, sex: Sex): number {
  const l = m.load;
  if (!l) return 0;
  const v = sex === 'female' ? l.female ?? l.male : l.male ?? l.female;
  if (v === undefined) return 0;
  const lb = toLb(v, l.unit);
  // Two dumbbells or kettlebells move twice the listed weight.
  const imp = m.movement.implement;
  const pair = (imp === 'dumbbell' || imp === 'kettlebell') && m.movement.count !== 'single' && m.movement.count !== 'alternating';
  return pair ? lb * 2 : lb;
}

export interface WorkResult {
  /** ft-lb, when every movement could be counted. */
  work?: number;
  seconds?: number;
  /** ft-lb per second. */
  power?: number;
  /** Families that kept this result from a number. */
  missing: string[];
  /** Families counted with a "derived" rule. */
  derived: string[];
}

/** One pass through the workout as a list of (movement, reps) in order. */
function pass(w: Workout): { m: MovementPrescription; reps: number }[] | undefined {
  const s = w.structure;
  const scheme = 'scheme' in s && s.scheme ? s.scheme : undefined;
  const out: { m: MovementPrescription; reps: number }[] = [];
  if (scheme) { for (const n of scheme) for (const m of w.movements) out.push({ m, reps: m.reps ?? n }); }
  else for (const m of w.movements) { if (m.reps === undefined) return undefined; out.push({ m, reps: m.reps }); }
  return out;
}

/** Work and average power for one result, given the person's dims at the time. */
export function resultWork(r: Pick<Result, 'performed' | 'score' | 'completed'>, sex: Sex, d: BodyDims | undefined): WorkResult {
  const w = r.performed;
  const s = w.structure;
  const missing = [...new Set(w.movements.filter((m) => !MODEL[m.movement.family] || m.distanceM || m.calories || (m.seconds && !m.reps)).map((m) => m.movement.family))];
  const derived = [...new Set(w.movements.filter((m) => MODEL[m.movement.family]?.basis === 'derived').map((m) => m.movement.family))];
  if (missing.length || !d) return { missing, derived };
  const seq = pass(w);
  if (!seq?.length) return { missing: ['reps not known'], derived };
  const per = seq.map(({ m, reps }) => ({ reps, inLb: MODEL[m.movement.family]!.perRep(d, loadLb(m, sex), m, sex) }));
  if (per.some((p) => p.inLb === undefined || !(p.inLb > 0))) return { missing: ['a box or target height'], derived };
  const passWork = per.reduce((a, p) => a + p.reps * p.inLb!, 0);
  const passReps = per.reduce((a, p) => a + p.reps, 0);
  // Work for N reps into the sequence (partial rounds walk the movements in order).
  const workForReps = (n: number) => {
    const full = Math.floor(n / passReps);
    let left = n - full * passReps, inLb = full * passWork;
    for (const p of per) { const k = Math.min(left, p.reps); inLb += k * p.inLb!; left -= k; if (!left) break; }
    return inLb;
  };
  let inLb: number | undefined, seconds: number | undefined;
  if (s.kind === 'for-time') {
    const rounds = s.rounds ?? 1;
    if (r.completed && r.score.timeSec) { inLb = passWork * rounds; seconds = r.score.timeSec; }
    else if (!r.completed && s.capMin && r.score.reps !== undefined) { inLb = workForReps(r.score.reps); seconds = s.capMin * 60; }
  } else if (s.kind === 'amrap' && s.minutes) {
    const reps = (r.score.rounds ?? 0) * passReps + (r.score.reps ?? 0);
    if (reps > 0) { inLb = workForReps(reps); seconds = s.minutes * 60; }
  }
  if (inLb === undefined || !seconds) return { missing: s.kind === 'for-time' || s.kind === 'amrap' ? ['score'] : [`format (${s.kind})`], derived };
  const work = inLb / 12;
  return { work: Math.round(work), seconds, power: Math.round((work / seconds) * 10) / 10, missing: [], derived };
}

/** Durations (minutes) the fitness curve is read at, on a log scale. */
export const CURVE_MINUTES = [1, 2, 4, 8, 12, 20, 30, 45, 60];

export interface PowerPoint { minutes: number; power: number; date: string; id: string; name?: string }
/**
 * The power-versus-duration curve (L1: fitness is the area under it): for each duration, the best average power the
 * person held for at least that long. Durations no effort reached are left empty.
 */
export function powerCurve(points: PowerPoint[]): { minutes: number; power: number | null; from?: PowerPoint }[] {
  return CURVE_MINUTES.map((t) => {
    const best = points.filter((p) => p.minutes >= t * 0.9).sort((a, b) => b.power - a.power)[0];
    return { minutes: t, power: best?.power ?? null, from: best };
  });
}
/** Area under the curve on a log-time axis, over the durations both curves reach: a relative fitness number. */
export function curveArea(curve: { minutes: number; power: number | null }[], over = CURVE_MINUTES): number | null {
  const pts = curve.filter((c) => c.power !== null && over.includes(c.minutes));
  if (pts.length < 2) return null;
  let a = 0;
  for (let i = 1; i < pts.length; i++) a += ((pts[i]!.power! + pts[i - 1]!.power!) / 2) * Math.log(pts[i]!.minutes / pts[i - 1]!.minutes);
  return Math.round(a * 10) / 10;
}

/** Latest value of each dim on or before a date (the earliest one if none before). */
export function dimsAt(rows: { kind: string; date: string; value: number; unit: string }[], date: string): BodyDims | undefined {
  const pick = (kind: DimKind) => {
    const k = rows.filter((r) => r.kind === kind).sort((a, b) => a.date.localeCompare(b.date));
    const r = [...k].reverse().find((x) => x.date <= date) ?? k[0];
    if (!r) return undefined;
    return kind === 'weight' ? toLb(r.value, r.unit) : r.unit === 'cm' ? r.value / 2.54 : r.value;
  };
  const [weight, squatLow, squatHigh, shoulder, overhead, knuckle] = DIM_KINDS.map(pick);
  if ([weight, squatLow, squatHigh, shoulder, overhead, knuckle].some((v) => v === undefined)) return undefined;
  return { weight: weight!, squatLow: squatLow!, squatHigh: squatHigh!, shoulder: shoulder!, overhead: overhead!, knuckle: knuckle! };
}

/**
 * Same workout, same loads, two efforts: work is the same, so the change in power is the inverse ratio of the times
 * (L1: "time approximates our change in power output"). Needs no measurements.
 */
export const powerChange = (t1Sec: number, t2Sec: number) => Math.round((t1Sec / t2Sec - 1) * 100);
