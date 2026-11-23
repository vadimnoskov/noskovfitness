import { FAMILIES, FAMILY_BY_ID, type Family, type Implement, type Count, type Start, type Receive, type Style, type Position } from './catalog';

/** A canonical movement: one family plus the attributes that change what the movement is. */
export interface MovementRef {
  family: string;
  implement?: Implement;
  count?: Count;
  start?: Start;
  receive?: Receive;
  style?: Style;
  position?: Position;
  variant?: string;
}

/** How it was prescribed: never part of identity. */
export interface PrescriptionParams {
  unbroken?: boolean;
  weighted?: boolean;
  tempo?: boolean;
  pause?: boolean;
  deficit?: boolean;
  synchronized?: boolean;
  unit?: 'calories' | 'meters';
}

export interface Resolution {
  input: string;
  ref?: MovementRef;
  key?: string;
  name?: string;
  params: PrescriptionParams;
  /** Set when the phrase seems to name several movements (a complex) or nothing in the catalog. */
  review?: 'complex' | 'unknown' | 'ignored' | 'workout';
}

const IMPLEMENT_RX: [Implement, RegExp][] = [
  ['dumbbell', /\b(dumbbells?|dumbells?|db)\b/],
  ['kettlebell', /\b(kettlebells?|kb)\b/],
  ['medball', /\b(medicine ball|med ?ball|medball)\b/],
  ['sandbag', /\bsandbag\b/],
  ['plate', /\b(bumper )?plates?\b/],
  ['parallettes', /\bparall?ett?es?\b/],
  ['rings', /\brings?\b/],
  ['ghd', /\bghd\b/],
  ['air-bike', /\b(assault|echo|air|airdyne)\b/],
  ['bike-erg', /\bbike ?erg\b/],
  ['bar', /\bbar (muscle|dip)/],
  ['box', /\b(bench|box) (dips?|push)/],
  ['barbell', /\bbarbell\b/],
];
const COUNT_RX: [Count, RegExp][] = [
  ['alternating', /\balternating\b/],
  ['single', /\b(single[- ]arm|one[- ]arm|1 arm|single (dumbbell|kettlebell|db|kb)|[lr] one arm)\b/],
  ['double', /\b(double (dumbbell|kettlebell)|dual kettlebell|two arm)\b/],
];
const START_RX: [Start, RegExp][] = [['high-hang', /\bhigh[- ]hang\b/], ['hang', /\bhang\b(?! from)/], ['block', /\bblock\b/]];
const RECEIVE_RX: [Receive, RegExp][] = [['power', /\bpower\b/], ['squat', /\b(squat (clean|snatch)|full (clean|snatch))/], ['split', /\bsplit (clean|snatch)/]];
const STYLE_RX: [Style, RegExp][] = [
  ['strict', /\bstrict\b/], ['butterfly', /\bbutterfly\b/], ['kipping', /\bkipping\b/],
  ['jumping', /\bjumping\b/], ['banded', /\bband(ed)?\b/], ['legless', /\blegless\b/],
];
const POSITION_RX: [Position, RegExp][] = [
  ['front-rack', /\bfront[- ]rack\b/], ['back-rack', /\bback[- ]rack\b/], ['goblet', /\bgoblet\b/], ['suitcase', /\bsuitcase\b/],
  ['farmers', /\bfarmer'?s?\b/], ['bear-hug', /\bbear hug\b/], ['overhead', /\boverhead\b/],
];
/** Family-specific variant detection. */
const VARIANT_RX: Record<string, [string, RegExp][]> = {
  burpee: [['bar-facing', /bar[- ]facing/], ['box-jump-over', /box jump over/], ['box-step-over', /box step over/], ['box', /box jumps?$|box get over/],
    ['lateral-over', /lateral|over (bars?|barbells?|rowers?|dumbbells?|parallettes?|barriers?)/], ['to-target', /target/], ['pull-up', /pull[- ]?ups?/],
    ['broad-jump', /broad jump/], ['over-object', /over|plate jump/]],
  'clean-and-jerk': [['split-jerk', /split jerk/], ['push-jerk', /push jerk/], ['power-jerk', /power jerk/]],
  jerk: [['behind-the-neck', /behind[- ]the[- ]neck/], ['split', /split/], ['push', /push/], ['power', /power jerk/]],
  'push-press': [['behind-the-neck', /behind[- ]the[- ]neck/], ['snatch-grip', /snatch grip/]],
  press: [['half-kneeling', /half kneeling/], ['seated', /seated/], ['z-press', /z press/]],
  'bench-press': [['close-grip', /close grip/], ['incline', /incline/], ['floor', /floor press/]],
  deadlift: [['sumo', /sumo/], ['romanian', /romanian|\brdl\b/], ['single-leg', /single[- ]leg/], ['snatch-grip', /snatch grip/], ['suitcase', /suitcase/], ['clean-grip', /clean deadlift/]],
  'front-squat': [['box', /box/]], 'back-squat': [['box', /box/]],
  'kb-swing': [['russian', /russian/], ['american', /american/]],
  lunge: [['jumping', /jumping/], ['walking', /walking/], ['reverse', /reverse/], ['lateral', /side|lateral/], ['stationary', /stationary/]],
  'split-squat': [['bulgarian', /bulgarian/], ['cyclist', /cyclist/]],
  'step-up': [['step-over', /step[- ]?overs?/], ['russian', /russian/]],
  'bent-row': [['renegade', /renegade/], ['plank', /plank/], ['chest-supported', /chest supported/], ['push-up', /push-up/]],
  sled: [['push-high', /push(es)? high|high handle/], ['push-low', /push(es)? low|low handle/], ['drag', /drag/], ['pull', /pull/]],
  'medball-throw': [['slam', /slam/], ['sit-up-throw', /sit[- ]?up/], ['side-toss', /side/]],
  accessory: [['curl', /curl/], ['rear-delt-fly', /fl(y|ies)/], ['skull-crusher', /skull/], ['kickback', /kick ?back/], ['arm-lift', /arm lift/]],
  hspu: [['pike', /pike/]],
  'handstand-hold': [['freestanding', /freestanding/]],
  'pull-up': [['chest-to-bar', /chest[- ]to[- ]bar/], ['chin-up', /chin[- ]?up|supinated/]],
  'push-up': [['hand-release', /hand[- ]release/], ['feet-elevated', /feet elevated/], ['clapping', /clapping/], ['deficit', /deficit/], ['inchworm', /inchworm/]],
  'sit-up': [['ghd', /ghd/], ['abmat', /abmat/], ['anchored', /anchored/], ['overhead', /overhead/]],
  hollow: [['hollow', /hollow/], ['superman', /superman/]],
  plank: [['side', /side|left|right/], ['shoulder-taps', /taps?/]],
  'hip-extension': [['hip-and-back', /hip & back|hip and back/], ['back', /back/], ['hip', /hip/]],
  'air-squat': [['jumping', /jump/], ['hold', /hold/]],
  'box-jump': [['over', /over/], ['lateral', /lateral/], ['seated', /seated/]],
  'skill-drill': [['pass-through', /pass[- ]?through/], ['toe-taps', /toe taps/], ['skin-the-cat', /skin/], ['shoot-through', /shoot/],
    ['forward-roll', /roll/], ['ring-out', /ring out/], ['candlestick', /candlestick/], ['leg-throws', /leg throw/]],
  'jump-rope': [['double-under', /double[- ]?under|\bdus?\b/], ['triple-under', /triple/], ['crossover', /cross ?over|over[- ]?under/], ['single-under', /single[- ]?under|singles|jump rope/]],
  run: [['shuttle', /shuttle/], ['sprint', /sprint|fast feet/], ['trail', /trail/], ['backward', /backward/], ['lateral-shuffle', /lateral shuffle/]],
};

const PARAM_RX: [keyof PrescriptionParams, RegExp][] = [
  ['unbroken', /\bunbroken\b/], ['weighted', /\bweighted\b/], ['tempo', /\btempo\b/], ['pause', /\bpause\b/],
  ['deficit', /\bdeficit\b/], ['synchronized', /\bsynchronized\b/],
];

const familyRx: [Family, RegExp[]][] = FAMILIES.map((f) => [f, f.match.map((m) => new RegExp(m))]);

export function normalize(raw: string): string {
  let s = raw.toLowerCase().split('|')[0] ?? '';
  s = s.replace(/[+:]/g, ' ').replace(/\(([^)]*)\)s\b/g, '($1)');
  s = s.replace(/^[\d.,/\-\s]+(x\s*)?/, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function firstMatch<T>(table: [T, RegExp][], s: string): T | undefined {
  for (const [v, rx] of table) if (rx.test(s)) return v;
  return undefined;
}

function matchesFamily(s: string): Family[] {
  return familyRx.filter(([, rxs]) => rxs.some((rx) => rx.test(s))).map(([f]) => f);
}

/** Retired or non-movement phrases (decided by the coach, Nov 23 2026): never become movements. */
const IGNORED: RegExp[] = [/virtual shovel/, /obstacle course/, /^death by$/, /^ascending( reps)?$/, /^unbroken$/, /^with$/, /warm-?up$/, /^curtis ps$/];
/** Names of workouts that appear inside descriptions; they belong in the workout library, not the movement catalog. */
const WORKOUT_NAMES: RegExp[] = [/bear complex/];

const SINGLE_WORD_OVERRIDES: Record<string, MovementRef> = {
  'muscle-up': { family: 'muscle-up' },
};

export function resolve(raw: string): Resolution {
  const s = normalize(raw);
  const params: PrescriptionParams = {};
  for (const [k, rx] of PARAM_RX) if (rx.test(s)) (params[k] as boolean) = true;
  if (/\bcal(orie)?s?\b|calories/.test(s)) params.unit = 'calories';
  else if (/\bmeters?\b/.test(s)) params.unit = 'meters';

  if (IGNORED.some((rx) => rx.test(s))) return { input: raw, params, review: 'ignored' };
  if (WORKOUT_NAMES.some((rx) => rx.test(s))) return { input: raw, params, review: 'workout' };
  const fams = matchesFamily(s);
  const fam = fams[0];
  if (!fam) return { input: raw, params, review: 'unknown' };

  const ref: MovementRef = { ...(SINGLE_WORD_OVERRIDES[fam.id] ?? { family: fam.id }) };
  const imp = firstMatch(IMPLEMENT_RX, s);
  if (imp && fam.implements.includes(imp) && imp !== fam.implements[0]) ref.implement = imp;
  const cnt = firstMatch(COUNT_RX, s);
  if (cnt && fam.count?.includes(cnt) && cnt !== fam.defaultCount?.[ref.implement ?? fam.implements[0]!]) ref.count = cnt;
  const st = firstMatch(START_RX, s);
  if (st && fam.start?.includes(st)) ref.start = st;
  const rc = firstMatch(RECEIVE_RX, s);
  if (rc && fam.receive?.includes(rc)) ref.receive = rc;
  const sty = firstMatch(STYLE_RX, s);
  if (sty && fam.style?.includes(sty) && sty !== fam.style[0]) ref.style = sty; // first listed style is the family default (e.g. kipping pull-up)
  const pos = firstMatch(POSITION_RX, s);
  if (pos && fam.position?.includes(pos)) ref.position = pos;
  if (fam.id === 'carry' && !ref.position) ref.position = 'farmers';
  const vr = VARIANT_RX[fam.id];
  const v = vr ? firstMatch(vr, s) : undefined;
  if (v && (fam.variants?.includes(v) ?? false)) ref.variant = v;
  if (fam.id === 'jump-rope' && !ref.variant) ref.variant = 'single-under';
  // Bodyweight-only family matched alongside a loaded movement (e.g. "kettlebell clean lunges") = complex.
  const others = fams.slice(1).filter((f) => !isContainedVariant(fam, f));
  const review = others.length > 0 ? 'complex' : undefined;
  return { input: raw, ref, key: keyOf(ref), name: nameOf(ref), params, ...(review ? { review } : {}) };
}

/** Pairs that legitimately co-match (one family's name contains the other's keyword). */
function isContainedVariant(primary: Family, other: Family): boolean {
  const pairs: Record<string, string[]> = {
    burpee: ['box-jump', 'pull-up', 'broad-jump', 'lateral-jump', 'row', 'push-up', 'lunge', 'run', 'step-up', 'deadlift'],
    sdhp: ['deadlift'],
    cluster: ['thruster', 'clean', 'front-squat', 'burpee', 'goblet-squat'],
    'clean-and-jerk': ['clean', 'jerk', 'push-press'],
    'ground-to-overhead': ['clean'],
    'shoulder-to-overhead': [],
    'snatch-balance': ['snatch'], 'snatch-pull': ['snatch'], 'clean-pull': ['clean', 'pull-up'],
    deadlift: ['clean', 'snatch'],
    'push-press': ['snatch', 'press'],
    'bench-press': ['press'],
    'overhead-squat': ['air-squat'], 'front-squat': ['air-squat'], 'back-squat': ['air-squat'], 'goblet-squat': ['air-squat'],
    snatch: ['air-squat'], clean: ['air-squat'],
    'bent-row': ['push-up', 'plank', 'row'],
    'medball-throw': ['sit-up'],
    lunge: ['overhead-squat', 'carry', 'clean'],
    'step-up': ['box-jump'],
    hspu: ['push-up'],
    'muscle-up': ['pull-up', 'dip'],
    'toes-to-bar': [], 'ring-row': ['row'], 'bar-hang': ['pull-up'], 'bar-pullover': ['pull-up'],
    'air-squat': ['box-jump'], 'box-jump': ['lateral-jump'], 'handstand-hold': [], 'sit-up': ['hip-extension'], hold: ['carry'], carry: ['hold', 'run'], run: ['carry'],
  };
  return pairs[primary.id]?.includes(other.id) ?? false;
}

export function keyOf(r: MovementRef): string {
  const parts = [r.family];
  for (const k of ['implement', 'count', 'start', 'receive', 'style', 'position', 'variant'] as const) if (r[k]) parts.push(`${k}=${r[k]}`);
  return parts.join('|');
}

const title = (s: string) => s.split('-').map((w) => (['to', 'over', 'and'].includes(w) ? w : w[0]!.toUpperCase() + w.slice(1))).join(' ');
const IMPLEMENT_LABEL: Partial<Record<Implement, string>> = {
  'air-bike': 'Air Bike', 'bike-erg': 'Bike Erg', medball: 'Med Ball', parallettes: 'Parallette', rings: 'Ring', bar: 'Bar', box: 'Bench',
};
const COUNT_LABEL: Record<Count, string> = { single: 'Single-arm', double: 'Double', alternating: 'Alternating' };
/** Name used when no variant is set (family default implement made explicit where it matters). */
const DEFAULT_BASE: Record<string, string> = { dip: 'Ring Dip', 'muscle-up': 'Ring Muscle-up', bike: 'Air Bike', row: 'Row', 'hip-extension': 'Back Extension' };
/** Full base names for family:variant (replaces family name). */
const VARIANT_BASE: Record<string, string> = {
  'burpee:bar-facing': 'Bar-facing Burpee', 'burpee:lateral-over': 'Lateral Burpee Over Object', 'burpee:box-jump-over': 'Burpee Box Jump Over',
  'burpee:box-step-over': 'Burpee Box Step-over', 'burpee:box': 'Burpee Box Jump', 'burpee:to-target': 'Burpee to Target', 'burpee:pull-up': 'Burpee Pull-up',
  'burpee:broad-jump': 'Burpee Broad Jump', 'burpee:over-object': 'Burpee Over Object',
  'pull-up:chest-to-bar': 'Chest-to-bar Pull-up', 'pull-up:chin-up': 'Chin-up',
  'sit-up:ghd': 'GHD Sit-up', 'sit-up:abmat': 'AbMat Sit-up', 'sit-up:anchored': 'Anchored Sit-up', 'sit-up:overhead': 'Overhead Sit-up',
  'hip-extension:hip': 'Hip Extension', 'hip-extension:back': 'Back Extension', 'hip-extension:hip-and-back': 'Hip and Back Extension',
  'box-jump:over': 'Box Jump Over', 'box-jump:lateral': 'Lateral Box Jump', 'box-jump:seated': 'Seated Box Jump',
  'step-up:step-over': 'Box Step-over', 'step-up:russian': 'Russian Step-up',
  'air-squat:jumping': 'Jump Squat', 'air-squat:hold': 'Air Squat Hold',
  'hollow:hollow': 'Hollow Hold', 'hollow:superman': 'Superman Hold', 'plank:side': 'Side Plank', 'plank:shoulder-taps': 'Plank Shoulder Taps',
  'sled:push-high': 'Sled Push (high handle)', 'sled:push-low': 'Sled Push (low handle)', 'sled:drag': 'Sled Drag', 'sled:pull': 'Sled Pull',
  'medball-throw:slam': 'Med Ball Slam', 'medball-throw:sit-up-throw': 'Med Ball Sit-up Throw', 'medball-throw:side-toss': 'Med Ball Side Toss',
  'accessory:curl': 'Curl', 'accessory:rear-delt-fly': 'Rear Delt Fly', 'accessory:skull-crusher': 'Skull Crusher', 'accessory:kickback': 'Triceps Kickback', 'accessory:arm-lift': 'Arm Lift',
  'bent-row:renegade': 'Renegade Row', 'bent-row:plank': 'Plank Row', 'bent-row:chest-supported': 'Chest-supported Row', 'bent-row:push-up': 'Push-up Row',
  'handstand-hold:freestanding': 'Freestanding Handstand Hold', 'hspu:pike': 'Pike Push-up',
  'deadlift:romanian': 'Romanian Deadlift', 'deadlift:single-leg': 'Single-leg Deadlift', 'deadlift:snatch-grip': 'Snatch-grip Deadlift', 'deadlift:clean-grip': 'Clean Deadlift',
  'jerk:behind-the-neck': 'Behind-the-neck Jerk', 'jerk:push': 'Push Jerk', 'jerk:split': 'Split Jerk', 'jerk:power': 'Power Jerk',
  'front-squat:box': 'Front Box Squat', 'back-squat:box': 'Box Squat', 'bench-press:floor': 'Floor Press', 'press:z-press': 'Z Press',
  'run:sprint': 'Sprint', 'run:shuttle': 'Shuttle Run', 'run:lateral-shuffle': 'Lateral Shuffle',
};

export function nameOf(r: MovementRef): string {
  const f = FAMILY_BY_ID[r.family];
  if (!f) return r.family;
  if (f.id === 'jump-rope') return { 'single-under': 'Single-under', 'double-under': 'Double-under', 'triple-under': 'Triple-under', crossover: 'Crossover' }[r.variant ?? 'single-under'] ?? 'Jump Rope';
  if (f.id === 'skill-drill' && r.variant) return title(r.variant);
  const pre: string[] = [];
  if (r.style) pre.push(title(r.style));
  if (r.count) pre.push(COUNT_LABEL[r.count]);
  if (r.implement) pre.push(IMPLEMENT_LABEL[r.implement] ?? title(r.implement));
  if (r.position && !(f.id === 'carry')) pre.push(title(r.position));
  if (r.start && r.start !== 'floor') pre.push(title(r.start));
  if (r.receive) pre.push(title(r.receive));
  let base: string;
  if (f.id === 'clean-and-jerk') {
    const jerk = r.variant ? { 'push-jerk': 'Push Jerk', 'split-jerk': 'Split Jerk', 'power-jerk': 'Power Jerk' }[r.variant] : 'Jerk';
    base = `Clean & ${jerk}`;
  } else if (f.id === 'carry') {
    base = `${title(r.position ?? 'farmers')} Carry`.replace('Farmers Carry', "Farmer's Carry");
  } else if (r.variant) {
    base = VARIANT_BASE[`${f.id}:${r.variant}`] ?? `${title(r.variant)} ${f.name}`;
  } else {
    base = (r.implement && ['dip', 'muscle-up', 'bike'].includes(f.id)) ? f.name : (DEFAULT_BASE[f.id] ?? f.name);
  }
  if (f.id === 'bike' && r.implement) base = '';
  return [...pre, base].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

/**
 * Split a phrase that names several movements in a row (a complex such as
 * "hang squat clean front squat squat clean") into catalog movements, in order.
 * Shortest resolvable span wins, extended only while the longer span names a different movement.
 */
export function resolveSequence(raw: string): Resolution[] {
  const single = resolve(raw);
  if (single.review !== 'complex') return [single];
  const out: Resolution[] = [];
  for (const seg of normalize(raw).split(/\s*(?:\/|\+|,|\bthen\b)\s*/).filter(Boolean)) {
    const t = seg.split(' ');
    let i = 0;
    while (i < t.length) {
      let j = i + 1, best: Resolution | undefined;
      for (; j <= t.length; j++) { const r = resolve(t.slice(i, j).join(' ')); if (r.ref && !r.review) { best = r; break; } }
      if (!best) { i++; continue; }
      while (j < t.length) {
        const r = resolve(t.slice(i, j + 1).join(' '));
        if (r.ref && !r.review && r.key !== best.key) { best = r; j++; } else break;
      }
      out.push({ ...best, input: t.slice(i, j).join(' ') });
      i = j;
    }
  }
  return out.length ? out : [single];
}
