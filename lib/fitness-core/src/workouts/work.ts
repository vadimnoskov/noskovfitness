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
/** Box height for a box movement: the workout's, else the standard 24/20 in. */
const boxIn = (m: MovementPrescription, sex: Sex) => (sex === 'female' ? m.heightIn?.female ?? m.heightIn?.male : m.heightIn?.male) ?? (sex === 'female' ? 20 : 24);
/** The body rises from a hinge or squat: lifted from the floor (no hang start) or received in a squat. */
const bodyRises = (m: MovementPrescription) => squatReceive(m) || !m.movement.start || m.movement.start === 'floor';
const squatReceive = (m: MovementPrescription) => m.movement.receive === 'squat';

/**
 * Inch-pounds per rep. "source": the distance rule is the one the Fran tables use. "derived": the same rule applied
 * to another movement from the five heights. Families not listed are not counted.
 */
const MODEL: Record<string, { basis: 'source' | 'derived' | 'assumed'; perRep: PerRep; rule: string }> = {
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
  deadlift: { basis: 'derived', rule: 'load × (knuckle height − bar height) + body × squat travel (the hips rise as in the pull of a clean)', perRep: (d, l) => l * (d.knuckle - BAR_FROM_FLOOR_IN) + d.weight * sq(d) },
  sdhp: { basis: 'derived', rule: 'load × (shoulder height − bar height)', perRep: (d, l) => l * (d.shoulder - BAR_FROM_FLOOR_IN) },
  clean: { basis: 'derived', rule: 'load × (shoulder height − bar height) + body × squat travel when lifted from the floor or received in a squat (matches BTWB within 3%)',
    perRep: (d, l, m) => l * (d.shoulder - BAR_FROM_FLOOR_IN) + (bodyRises(m) ? d.weight * sq(d) : 0) },
  snatch: { basis: 'derived', rule: 'load × (overhead height − bar height) + body × squat travel when lifted from the floor or received in a squat (matches BTWB within 3%)',
    perRep: (d, l, m) => l * (d.overhead - BAR_FROM_FLOOR_IN) + (bodyRises(m) ? d.weight * sq(d) : 0) },
  'clean-and-jerk': { basis: 'derived', rule: 'clean + jerk',
    perRep: (d, l, m) => l * (d.shoulder - BAR_FROM_FLOOR_IN) + (bodyRises(m) ? d.weight * sq(d) : 0) + l * arm(d) },
  'ground-to-overhead': { basis: 'derived', rule: 'load × (overhead height − bar height)', perRep: (d, l) => l * (d.overhead - BAR_FROM_FLOOR_IN) },
  'wall-ball': { basis: 'derived', rule: 'body × squat travel + ball × (target − shoulder height in the squat)',
    perRep: (d, l, m, sex) => { const t = (sex === 'female' ? m.heightIn?.female : m.heightIn?.male) ?? (sex === 'female' ? 108 : 120); return d.weight * sq(d) + l * (t - (d.shoulder - sq(d))); } },
  'box-jump': { basis: 'derived', rule: 'body × box height (24/20 in when not given)', perRep: (d, _l, m, sex) => d.weight * boxIn(m, sex) },
  'step-up': { basis: 'derived', rule: '(body + load) × box height (24/20 in when not given)', perRep: (d, l, m, sex) => (d.weight + l) * boxIn(m, sex) },
  'bench-press': { basis: 'derived', rule: 'load × shoulder-to-overhead (the arm’s length)', perRep: (d, l) => l * arm(d) },
  pistol: { basis: 'derived', rule: 'body × squat travel', perRep: (d) => d.weight * sq(d) },
  'kb-swing': { basis: 'derived', rule: 'load × (shoulder − knuckle height); American: load × (overhead − knuckle height); the hinge is not counted',
    perRep: (d, l, m) => l * ((m.movement.variant === 'american' ? d.overhead : d.shoulder) - d.knuckle) },
  // Assumed: the rule needs a stated fraction or simplification on top of the five heights (for the coach to review).
  burpee: { basis: 'derived', rule: `body × (squat high height + ${6} in jump): lying to standing, then the jump of a double-under (matches BTWB within 2%)`,
    perRep: (d) => d.weight * (d.squatHigh + 6) },
  'push-up': { basis: 'assumed', rule: 'body × half of shoulder-to-overhead (the chest moves an arm’s length, the feet don’t move)', perRep: (d) => d.weight * arm(d) / 2 },
  dip: { basis: 'assumed', rule: 'body × half of shoulder-to-overhead', perRep: (d) => d.weight * arm(d) / 2 },
  hspu: { basis: 'assumed', rule: 'body × half of shoulder-to-overhead (head to lockout)', perRep: (d) => d.weight * arm(d) / 2 },
  'muscle-up': { basis: 'assumed', rule: 'pull-up + dip: body × 1.5 × shoulder-to-overhead', perRep: (d) => d.weight * arm(d) * 1.5 },
  'sit-up': { basis: 'assumed', rule: 'half the body × half the torso (torso = shoulder − squat high height)', perRep: (d) => (d.weight / 2) * ((d.shoulder - d.squatHigh) / 2) },
  lunge: { basis: 'assumed', rule: '(body + load) × half the squat travel (reps only; distance lunges are not counted)', perRep: (d, l) => (d.weight + l) * sq(d) / 2 },
  'rope-climb': { basis: 'assumed', rule: 'body × (15 ft rope − overhead height)', perRep: (d) => d.weight * Math.max(0, 180 - d.overhead) },
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
  /** Families counted with a "derived" or "assumed" rule. */
  derived: string[];
}

/**
 * Machines and running: Concept2's published relation between pace and power on its rowers, watts = 2.80 × speed³
 * (speed in m/s), which BTWB also applies to running (checked against BTWB's own figures for logged runs and rows:
 * identical). Work over a distance is then 2.80 × speed² × metres.
 * Calories use Concept2's calorie formula, calories per hour = 4 × watts + 300.
 */
export const MONO = new Set(['run', 'row', 'ski', 'bike']);
const J_PER_FTLB = 1.3558;
const C2 = 2.8;
export const monoPowerW = (metresPerSec: number) => C2 * metresPerSec ** 3;
/** Speed (m/s) at which calories accrue at `calPerSec` on a Concept2 machine. */
const speedForCalRate = (calPerSec: number) => Math.cbrt(Math.max(0, (calPerSec * 3600 - 300) / 4) / C2);
/** Joules for a distance or calorie segment done at `v` m/s. */
function monoJoules(m: MovementPrescription, v: number): number | undefined {
  if (m.distanceM) return C2 * v * v * m.distanceM;
  if (m.calories) { const watts = monoPowerW(v); return watts * ((m.calories * 3600) / (4 * watts + 300)); }
  return undefined;
}

const MULTI_PART = /\b\d+\s*x\s*\d+:\d\d|\bevery \d+(:\d\d)? ?min|\b\d+\s*x\s*\d+\s*(m|cal)\b|\brest(ing)?\b[^.\n]{0,20}\b(between|in between|then)\b|-- ?then ?--|\bthen,? in the remaining time\b/i;
/**
 * Twice the best average power in the Fran tables (338 ft-lb/s, an elite athlete at about 2:30). Anything above it is
 * almost certainly a workout read wrongly from its text, so it is left out rather than shown. Pure runs and rows use
 * the power of a 9.58 s 100 m instead (about 2,350 ft-lb/s by the formula above).
 */
export const MAX_PLAUSIBLE = 676;
export const MAX_PLAUSIBLE_MONO = Math.round(monoPowerW(100 / 9.58) / J_PER_FTLB);

const isMono = (m: MovementPrescription) => MONO.has(m.movement.family) && !!(m.distanceM || m.calories);
const isDoubleUnder = (m: MovementPrescription) => m.movement.family === 'jump-rope' && m.movement.variant === 'double-under';
/** Double-unders: bodyweight × 6 in per rep, which matches BTWB's figures on logged results. */
export const DOUBLE_UNDER_IN = 6;

/** One pass through the workout as a list of (movement, reps) in order. Distance and calorie pieces count as one rep. */
function pass(w: Workout): { m: MovementPrescription; reps: number }[] | undefined {
  const s = w.structure;
  const scheme = 'scheme' in s && s.scheme ? s.scheme : undefined;
  const out: { m: MovementPrescription; reps: number }[] = [];
  // Calories count as reps in an AMRAP score (as BTWB counts them); a distance counts as one.
  const unit = (m: MovementPrescription) => (isMono(m) ? m.calories ?? 1 : m.reps);
  // A scheme (21-15-9) gives the reps of movements that have none; when every movement has its own reps the list is
  // already the full sequence (imports often expand "10-9-8…" into one entry per round).
  if (scheme && w.movements.some((m) => unit(m) === undefined)) { for (const n of scheme) for (const m of w.movements) out.push({ m, reps: unit(m) ?? n }); }
  else for (const m of w.movements) { const r = unit(m); if (r === undefined) return undefined; out.push({ m, reps: r }); }
  return out;
}

/**
 * Work and average power for one result, given the person's dims at the time. `paces` (m/s by family: run, row…) is
 * the person's own usual speed, used for the run or row inside a mixed workout, where only the total time is known.
 */
export type PaceFor = (family: string, metres?: number) => number | undefined;
export function resultWork(r: Pick<Result, 'performed' | 'score' | 'completed'>, sex: Sex, d: BodyDims | undefined, paces: Record<string, number> | PaceFor = {}): WorkResult {
  const paceFor: PaceFor = typeof paces === 'function' ? paces : (f) => paces[f];
  const w = r.performed;
  const s = w.structure;
  const counted = (m: MovementPrescription) => isMono(m) || isDoubleUnder(m) || (!!MODEL[m.movement.family] && !m.distanceM && !m.calories && !(m.seconds && !m.reps));
  const missing = [...new Set(w.movements.filter((m) => !counted(m)).map((m) => m.movement.family))];
  const derived = [...new Set(w.movements.filter((m) => !isMono(m) && (isDoubleUnder(m) || (MODEL[m.movement.family]?.basis ?? 'source') !== 'source')).map((m) => m.movement.family))];
  if (MULTI_PART.test(w.originalText ?? '')) return { missing: ['multi-part workout'], derived };
  if (missing.length) return { missing, derived };

  // A run, row, ski or bike on its own: power straight from the pace, no measurements needed.
  if (w.movements.length && w.movements.every((m) => isMono(m) && m.movement.family === w.movements[0]!.movement.family)) {
    const pure = pureMono(r);
    if (pure) return pure.power > MAX_PLAUSIBLE_MONO ? { missing: ['implausible (check how the workout was read)'], derived } : { ...pure, missing: [], derived };
  }
  if (!d) return { missing: [], derived };
  const seq = pass(w);
  if (!seq?.length) return { missing: ['reps not known'], derived };
  const lacking = new Set<string>();
  const per = seq.map(({ m, reps }) => {
    if (isMono(m)) {
      const v = paceFor(m.movement.family, m.distanceM);
      if (!v) { lacking.add(`${m.movement.family} pace`); return { reps, inLb: undefined }; }
      return { reps, inLb: (monoJoules(m, v)! / J_PER_FTLB) * 12 / reps };
    }
    if (isDoubleUnder(m)) return { reps, inLb: d.weight * DOUBLE_UNDER_IN };
    return { reps, inLb: MODEL[m.movement.family]!.perRep(d, loadLb(m, sex), m, sex) };
  });
  if (lacking.size) return { missing: [...lacking], derived };
  if (per.some((p) => p.inLb === undefined || !(p.inLb > 0))) return { missing: ['a load or height'], derived };
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
    // A ladder AMRAP (the same movements again with more reps each rung) has no fixed round, so its score is ambiguous.
    const fams = w.movements.map((m) => m.movement.family);
    if (new Set(fams).size < fams.length) return { missing: ['ladder AMRAP'], derived };
    const reps = (r.score.rounds ?? 0) * passReps + (r.score.reps ?? 0);
    if (reps > 0) { inLb = workForReps(reps); seconds = s.minutes * 60; }
  }
  if (inLb === undefined || !seconds) return { missing: s.kind === 'for-time' || s.kind === 'amrap' ? ['score'] : [`format (${s.kind})`], derived };
  const work = inLb / 12;
  if (work / seconds > MAX_PLAUSIBLE) return { missing: ['implausible (check how the workout was read)'], derived };
  return { work: Math.round(work), seconds, power: Math.round((work / seconds) * 10) / 10, missing: [], derived };
}

/** A single run, row, ski or bike piece (one or more rounds): its time, distance or calories give the pace directly. */
function pureMono(r: Pick<Result, 'performed' | 'score' | 'completed'>): { work: number; seconds: number; power: number; speed: number } | undefined {
  const w = r.performed, s = w.structure;
  // BTWB interval logs list every piece with its own time ("Row, 500 m | 1:30"); use them, dropping pieces logged as 0:00.
  const pieces = intervalPieces(w.originalText);
  if (pieces) {
    let joules = 0, secs = 0;
    for (const p of pieces) { const v = p.metres / p.sec; joules += C2 * v * v * p.metres; secs += p.sec; }
    const power = joules / secs / J_PER_FTLB;
    return { work: Math.round(power * secs), seconds: Math.round(secs * 10) / 10, power: Math.round(power * 10) / 10, speed: Math.cbrt(joules / secs / C2) };
  }
  const rounds = s.kind === 'for-time' ? s.rounds ?? 1 : 1;
  const metres = w.movements.reduce((a, m) => a + (m.distanceM ?? 0), 0) * rounds;
  const cals = w.movements.reduce((a, m) => a + (m.calories ?? 0), 0) * rounds;
  let seconds: number | undefined, v: number | undefined;
  if (s.kind === 'for-time' && r.completed && r.score.timeSec) {
    seconds = r.score.timeSec;
    v = metres ? metres / seconds : cals ? speedForCalRate(cals / seconds) : undefined;
  } else if ((s.kind === 'amrap' || s.kind === 'max') && 'minutes' in s && s.minutes) {
    seconds = s.minutes * 60;
    if (r.score.distanceM) v = r.score.distanceM / seconds;
    else if (r.score.calories) v = speedForCalRate(r.score.calories / seconds);
  }
  if (!seconds || !v) return undefined;
  const watts = monoPowerW(v);
  const power = watts / J_PER_FTLB;
  return { work: Math.round(power * seconds), seconds, power: Math.round(power * 10) / 10, speed: v };
}
/** The pieces of a BTWB interval log ("Intervals\nRow, 500 m | 1:30\n…"), or undefined when the text isn't one. */
export function intervalPieces(text?: string): { metres: number; sec: number }[] | undefined {
  if (!text || !/^Intervals\b/.test(text.trim())) return undefined;
  const out: { metres: number; sec: number }[] = [];
  for (const l of text.split('\n').slice(1)) {
    const m = /^\s*(?:Run|Row|Ski|Bike)[^,]*,\s*([\d,.]+)\s*(m|km)\s*\|\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/i.exec(l);
    if (!m) { if (l.trim()) return undefined; continue; }
    const metres = Number(m[1]!.replace(/,/g, '')) * (m[2]!.toLowerCase() === 'km' ? 1000 : 1);
    const sec = Number(m[3] ?? 0) * 60 + Number(m[4]);
    if (sec > 0 && metres > 0) out.push({ metres, sec });
  }
  return out.length ? out : undefined;
}

/** Speed (m/s) of a pure run, row, ski or bike result, for the person's usual pace; undefined for anything else. */
export function monoSpeed(r: Pick<Result, 'performed' | 'score' | 'completed'>): { family: string; speed: number; metres: number } | undefined {
  const ms = r.performed.movements;
  if (!ms.length || !ms.every((m) => isMono(m) && m.distanceM && m.movement.family === ms[0]!.movement.family)) return undefined;
  const p = pureMono(r);
  // The length of one piece: an interval log's average piece, else the prescribed distance.
  const pieces = intervalPieces(r.performed.originalText);
  const metres = pieces ? pieces.reduce((a, x) => a + x.metres, 0) / pieces.length : ms[0]!.distanceM!;
  return p ? { family: ms[0]!.movement.family, speed: p.speed, metres } : undefined;
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

/**
 * BTWB's body-measurement export (DateTime, Height, Weight, … e.g. "2019-04-29 10:19:51 -0400,69 in,174.8 lbs") as
 * bodyweight rows by date. One row per date (the last one listed); rows without a weight are skipped.
 */
export function parseBtwbWeights(csv: string): { date: string; value: number; unit: 'lb' | 'kg' }[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const head = (lines.shift() ?? '').split(',').map((h) => h.trim().toLowerCase());
  const di = head.indexOf('datetime'), wi = head.indexOf('weight');
  if (di < 0 || wi < 0) throw new Error('This is not a BTWB measurements export (no DateTime and Weight columns).');
  const out = new Map<string, { date: string; value: number; unit: 'lb' | 'kg' }>();
  for (const l of lines) {
    const c = l.split(',');
    const date = (c[di] ?? '').trim().slice(0, 10);
    const m = /^([\d.]+)\s*(lbs?|kg)/i.exec((c[wi] ?? '').trim());
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || !m) continue;
    out.set(date, { date, value: Number(m[1]), unit: m[2]!.toLowerCase().startsWith('kg') ? 'kg' : 'lb' });
  }
  return [...out.values()].sort((a, b) => a.date.localeCompare(b.date));
}
