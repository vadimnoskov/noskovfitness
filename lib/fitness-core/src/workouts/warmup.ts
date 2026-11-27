/**
 * Suggested warm-up for a workout: CrossFit practice, kept short.
 *
 *  1. General (3–5 min): raise temperature, a few bodyweight basics for the joints the day uses.
 *  2. Specific: rehearse today's movements light or simplified, building to workout weight and speed.
 *  3. Primer (short, hard workouts only): one short burst at workout pace, rest, go.
 *
 * Rules: the shorter the workout the more thorough the warm-up; rehearse, don't train (nobody breathing hard);
 * on heavy lifting days the build-up sets are the warm-up; same warm-up for the whole family; garage equipment only.
 *
 * The result is plain text in a small format the coach can edit: heading lines, and "- " lines as items.
 */
import type { Workout, MovementPrescription, WorkoutTags } from '../model/types';
import { FAMILY_BY_ID, type Implement } from '../movements/catalog';
import { distinctMovements, deriveTags } from './tags';

export interface WarmUp {
  minutes: number; general: string[]; specific: string[]; primer?: string;
  /** L2 complex, 2–3 progressive rounds of 5–15 reps, chosen against the workout. */
  complex?: { title: string; rounds: string[] };
  /** Skill segment from the current skill block, with options by level. */
  skill?: { title: string; lines: string[] };
  /** Longer skill practice on the week's lightest day (10–15 min, after the warm-up). */
  practice?: string[];
}
export interface WarmUpOptions {
  /** Date of the session: picks the skill block and rotates the complex. */
  date?: string;
  /** Implements available where the session happens (complexes that need others are skipped). */
  implementsAvailable?: Set<string>;
  /** True on the week's lightest day: add a 10–15 minute skill practice. */
  longPractice?: boolean;
}

const implementOf = (m: MovementPrescription): Implement | undefined => m.movement.implement ?? FAMILY_BY_ID[m.movement.family]?.implements[0];

/** One rehearsal drill per kind of movement. Returns a key (to avoid repeating a drill) and the text. */
function drillFor(m: MovementPrescription): [string, string] | undefined {
  const fam = m.movement.family, impl = implementOf(m), variant = m.movement.variant, style = m.movement.style;
  const bar = impl === 'barbell', db = impl === 'dumbbell' || impl === 'kettlebell';
  switch (fam) {
    case 'snatch': case 'snatch-pull':
      return bar ? ['snatch', 'Burgener drill with an empty bar: 5 each of down-and-up, elbows high, muscle snatch, snatch land, drop snatch']
        : ['db-snatch', 'Light dumbbell, per arm: 5 each of deadlift, hang high pull, hang muscle snatch, snatch'];
    case 'snatch-balance': case 'overhead-squat':
      return ['ohs', '10 overhead squats with a PVC or broomstick, then 5 with the empty bar'];
    case 'clean': case 'clean-and-jerk': case 'clean-pull': case 'ground-to-overhead': case 'cluster':
      return bar ? ['clean', 'Empty bar: 5 each of deadlift, hang high pull, muscle clean, front squat, push press']
        : ['db-clean', 'Light dumbbells: 5 each of deadlift, hang clean, push press'];
    case 'thruster':
      return ['thruster', `${bar ? 'Empty bar' : 'Light dumbbells'}: 5 front squats, 5 push presses, 5 thrusters`];
    case 'wall-ball': return ['wall-ball', '10 easy wall balls to the target'];
    case 'front-squat': case 'back-squat': case 'goblet-squat':
      return ['squat-load', `${bar ? 'Empty bar' : 'Light weight'}: 10 squats, pausing 2 s at the bottom`];
    case 'air-squat': return ['squat', '10 air squats with a 2-second pause at the bottom'];
    case 'deadlift': case 'good-morning': case 'hip-thrust': case 'sdhp':
      return ['hinge', `${bar ? 'Empty bar' : 'Light weight'}: 10 Romanian deadlifts${fam === 'sdhp' ? ', 5 sumo deadlift high pulls' : ''}`];
    case 'kb-swing': return ['swing', '10 kettlebell deadlifts, 10 light swings'];
    case 'push-press': case 'press': case 'jerk': case 'shoulder-to-overhead':
      return ['press', `${bar ? 'Empty bar' : 'Light dumbbells'}: 5 strict presses, 5 push presses${fam === 'jerk' ? ', 5 push jerks' : ''}`];
    case 'bench-press': return ['bench', 'Empty bar: 10 bench presses'];
    case 'hspu': return ['hspu', '5 pike push-ups, 2 kick-ups to the wall, 3 handstand push-ups (or your scaled version)'];
    case 'handstand-walk': case 'handstand-hold': case 'wall-walk':
      return ['handstand', 'Wrist prep (10 wrist rocks), 2 kick-ups, 2 × 10 s wall hold'];
    case 'muscle-up': return ['muscle-up', '5 ring rows, 5 false-grip hangs or kip swings, 3 transitions on low rings'];
    case 'pull-up': case 'bar-pullover':
      return style === 'strict' || m.load ? ['strict-pull', '5 scap pull-ups, 2 × 3 strict pull-ups']
        : ['pull', '5 scap pull-ups, 5 kip swings, 3 pull-ups'];
    case 'rope-climb': return ['rope', '2 foot-lock practices (stand up on the rope), 1 climb to halfway'];
    case 'ring-row': case 'bent-row': return ['row-pull', '10 ring rows'];
    case 'dip': return ['dip', '10 s ring or bar support, 5 dips (or your scaled version)'];
    case 'push-up': return ['push-up', '10 push-ups'];
    case 'toes-to-bar': case 'knees-to-elbows': case 'knee-raise': return ['t2b', '10 kip swings, 5 hanging knee raises'];
    case 'sit-up': case 'v-up': case 'hollow': case 'plank': case 'russian-twist': case 'l-sit': case 'mountain-climber': case 'hip-extension':
      return ['core', '10 hollow rocks, 10 sit-ups'];
    case 'lunge': case 'split-squat': case 'step-up': case 'pistol':
      return ['lunge', fam === 'pistol' ? '5 pistols per leg to a box' : '10 walking lunges'];
    case 'box-jump': case 'broad-jump': case 'lateral-jump':
      return ['jump', fam === 'box-jump' ? '5 box step-ups, then 5 box jumps stepping down' : '5 jumps landing softly, stick each landing'];
    case 'burpee': case 'devil-press': case 'man-maker':
      return ['burpee', variant === 'lateral-over' || variant === 'over-object' ? '5 burpees, then 3 over the dumbbell or object' : '5 easy burpees'];
    case 'jump-rope': return ['rope-skill', m.movement.count === 'double' ? '30 s double-under practice' : '30 s of rope at building pace'];
    case 'run': return ['run', 'Leg swings, 2 × 20 m A-skips, 1 × 100 m build-up to workout pace'];
    case 'carry': case 'hold': return ['carry', '1 light carry length'];
    case 'tgu': return ['tgu', '1 Turkish get-up per side, light'];
    default: return undefined;
  }
}

/** The easy cardio that starts the general part, picked from the day's own cardio when there is one. */
function cardioFor(w: Workout, long: boolean): string {
  const fams = new Set(w.movements.map((m) => m.movement.family));
  const min = long ? 2 : 3;
  if (fams.has('run')) return long ? 'Jog 400 m easy' : 'Jog 3 min easy';
  if (fams.has('row')) return `Row ${min} min easy`;
  if (fams.has('bike')) return `Bike ${min} min easy`;
  if (fams.has('ski')) return `Ski ${min} min easy`;
  return `Jump rope ${min} min easy (singles), or jog`;
}

/** `tags` should be the workout's stored tags when known (their time domain comes from real results). */
/** The last specific step: rehearse the workout itself in a way that fits its format. */
function closingLine(w: Workout, heavy: boolean, long: boolean): string {
  if (heavy) return 'Then build up with the sets in the plan: they are the rest of the warm-up';
  switch (w.structure.kind) {
    case 'tabata': return 'Then 2 × 10 s of the workout movement at building pace';
    case 'emom': case 'intervals': return 'Then 1 easy interval of each station, about half the reps';
    case 'amrap': return 'Then 1 easy round at workout weight';
    default: return long ? 'Then 1 easy round at about a quarter of the reps; start the workout a little easier, the first round finishes the warm-up'
      : 'Then 1–2 easy rounds at about a quarter of the reps, building to workout weight';
  }
}

// ───────────── Complexes (L2 Training Guide, "Example Warm-Ups to Address Weaknesses", pp. 61–62)
const COMPLEXES: Record<string, { title: string; needs?: string; rounds: string[] }> = {
  barbell: { title: 'Barbell complex (empty bar or light), 5–10 reps each', needs: 'barbell', rounds: ['Round 1: deadlift, hang power clean, front squat, press, thruster', 'Round 2: deadlift, hang power snatch, overhead squat, snatch'] },
  dumbbell: { title: 'Dumbbell complex (one or two light dumbbells), 5–10 reps each', needs: 'dumbbell', rounds: ['Round 1: deadlift, hang power clean, front squat, press, thruster', 'Round 2: deadlift, hang power snatch, overhead squat, snatch, Turkish get-up'] },
  kettlebell: { title: 'Kettlebell complex (light), 5–10 reps each', needs: 'kettlebell', rounds: ['Swing, clean, clean and press, snatch, Turkish get-up (2 rounds, a little harder the second time)'] },
  rings: { title: 'Rings routine: go down the list, leave out what you can\'t do well yet', needs: 'rings', rounds: ['Tuck or pike to inverted hang, skin the cat', 'Strict muscle-up to support to L-sit (or ring rows and support holds)', 'Ring swings; front-lever and back-lever attempts if you have them'] },
  parallettes: { title: 'Parallettes routine: go down the list, leave out what you can\'t do well yet', needs: 'parallettes', rounds: ['Push-up or dive-bomber push-up; shoot-through to push-up to frog stand', 'L-sit pass-through to tuck planche or to shoulder stand', 'Tuck up or press to handstand; handstand pirouette walk if you have it'] },
  bbw: { title: 'Basic Body Weight, 5–10 reps each, each round a little harder', rounds: ['Round 1: squat, push-up, sit-up, strict pull-up, hip extension', 'Round 2: lunge, strict dip, V-up, kipping pull-up, back extension', 'Round 3 (as skill allows): pistol, handstand push-up, toes-to-bar, strict muscle-up, hip and back extension'] },
};
const hashStr = (str: string) => { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** The complex that complements the workout (L2 template: weightlifting warm-ups on gymnastics days and vice versa). */
function complexFor(tags: WorkoutTags, date: string, have?: Set<string>) {
  const mods = new Set(tags.modalityPattern);
  const kind = mods.has('W') && !mods.has('G') ? ['rings', 'parallettes'] : mods.has('G') && !mods.has('W') ? ['barbell', 'dumbbell', 'kettlebell'] : ['bbw'];
  const usable = kind.filter((k) => !COMPLEXES[k]!.needs || !have || have.has(COMPLEXES[k]!.needs!));
  const pick = usable.length ? usable[hashStr(date) % usable.length]! : 'bbw';
  return COMPLEXES[pick]!;
}

// ───────────── Skill blocks (coach, 2026-11-28: handstands and muscle-up / pull-up strength first; 5-week blocks)
const BLOCK_WEEKS = 5;
const SKILLS = {
  handstand: {
    title: 'Handstand',
    uses: ['hspu', 'handstand-walk', 'handstand-hold', 'wall-walk'],
    weeks: ['holds and lines', 'kick-ups and a safe exit', 'shoulder taps and weight shifts', 'walks and pirouettes', 'pressing: negatives and kipping practice'],
    levels: ['Building: hollow hold and plank 3 × 20 s, then 3 × 5 s holds against a wall or box', 'Wall: kick up to the wall 3–5 times, holds 3 × 20–30 s, practise the exit (pirouette or forward roll)', 'Free: freestanding kick-up attempts and the week\'s focus, 5–8 short tries with full rest'],
    source: 'L1 handstand progression: hollow and plank strength, short wall holds, an exit strategy, then freestanding; headstand, kick-up to wall, parallettes, pirouettes, walks, presses',
  },
  muscleUp: {
    title: 'Muscle-up and pull-up strength',
    uses: ['pull-up', 'muscle-up', 'dip', 'ring-row', 'rope-climb'],
    weeks: ['strict pull-ups', 'strict dips and support holds', 'slow negatives', 'kip swings and hip drive', 'false grip and transitions'],
    levels: ['Building: ring rows and box-supported dips, 3 × 5, slow and strict', 'Strict: strict pull-ups and dips 3 × 3–5, well short of failure (muscle-up practice starts around 15 strict of each)', 'Transitions: low-ring or banded transition drills, 3–5 strict or kipping attempts with full rest'],
    source: 'L1 gymnastics benchmarks: muscle-up practice begins around 15 strict pull-ups and 15 dips',
  },
} as const;
type SkillKey = keyof typeof SKILLS;

/** The skill block for a date: 5-week blocks alternating handstand and muscle-up / pull-up strength, and the week in it. */
export function skillBlock(date: string): { skill: SkillKey; week: number } {
  // Weeks counted from Mondays, so a block never changes in the middle of a training week.
  const t = Date.parse(date), monday = t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000;
  const weekNo = Math.round((monday - Date.parse('1970-01-05')) / (7 * 86400000));
  const block = Math.floor(weekNo / BLOCK_WEEKS);
  return { skill: block % 2 === 0 ? 'handstand' : 'muscleUp', week: weekNo % BLOCK_WEEKS };
}

function skillSegment(w: Workout, date: string, long: boolean): { title: string; lines: string[]; practice?: string[] } {
  const fams = new Set(w.movements.map((m) => m.movement.family));
  const b = skillBlock(date);
  // No pre-fatigue (L1): if today's workout already works this skill, practise the other one today.
  const other: SkillKey = b.skill === 'handstand' ? 'muscleUp' : 'handstand';
  const usesBlock = SKILLS[b.skill].uses.some((f) => fams.has(f));
  const usesOther = SKILLS[other].uses.some((f) => fams.has(f));
  const key: SkillKey = usesBlock && !usesOther ? other : b.skill;
  const sk = SKILLS[key];
  const focus = sk.weeks[b.week]!;
  const light = usesBlock && usesOther;
  const lines = [
    `This week's focus: ${focus}${key !== b.skill ? ` (today's workout already works ${SKILLS[b.skill].title.toLowerCase()}, so this one instead)` : ''}.`,
    ...sk.levels.map((l) => `- ${l}`),
    light ? 'Today\'s workout uses these muscles: technique only, 2–3 easy reps per set.' : 'About 5 minutes, quality only, never to failure.',
  ];
  const practice = long ? [`${sk.title}, 10–15 minutes after the warm-up or after the workout: 6–8 short sets of the week's focus at your level, full rest between sets, stop when quality drops.`] : undefined;
  return { title: `Skill: ${sk.title} (week ${b.week + 1} of ${BLOCK_WEEKS})`, lines: [...lines, `Source: ${sk.source}.`], ...(practice ? { practice } : {}) };
}

export function suggestWarmUp(w: Workout, tags: WorkoutTags = deriveTags(w), opts: WarmUpOptions = {}): WarmUp {
  const heavy = w.scoreType === 'load';
  // Over ~20 min the first round finishes the warm-up; under ~12 min the workout is hard from the first second.
  const long = !heavy && tags.timeDomain === 'endurance';
  const short = !heavy && (tags.timeDomain === 'short' || tags.timeDomain === 'medium');
  const ms = distinctMovements(w);
  const patterns = new Set(ms.map((m) => FAMILY_BY_ID[m.movement.family]?.pattern));
  const overhead = ['snatch', 'squat-overhead', 'press', 'vertical-push', 'inversion', 'clean-jerk', 'squat-press'].some((p) => patterns.has(p));
  const pulling = ['vertical-pull', 'pull-push', 'core-hang'].some((p) => patterns.has(p));

  const basics = ['10 air squats', '5 inchworms with a push-up'];
  if (overhead) basics.push('10 pass-throughs with a PVC or broomstick');
  if (patterns.has('hinge') || patterns.has('hinge-pull')) basics.push('10 good mornings (hands behind head)');
  if (pulling) basics.push('5 scap pull-ups');
  const general = [cardioFor(w, long), `${long ? '1 round' : '2 rounds'}: ${basics.join(', ')}`];

  const drills = ms.map(drillFor).filter((d): d is [string, string] => !!d);
  // The Olympic-lift drills already start with a deadlift: no separate hinge drill on those days.
  const olyDay = drills.some(([k]) => ['snatch', 'clean', 'db-snatch', 'db-clean'].includes(k));
  const seen = new Set<string>(), specific: string[] = [];
  for (const [k, text] of drills) {
    if (seen.has(k) || (olyDay && k === 'hinge')) continue;
    seen.add(k); specific.push(text);
    if (specific.length === 3) break;
  }
  specific.push(closingLine(w, heavy, long));

  const primer = short ? '30 s at workout pace, rest 2–3 min, then go' : undefined;
  const minutes = (long ? 3 : 5) + Math.min(3, specific.length - 1) * 2 + (heavy ? 0 : 2) + (primer ? 3 : 0);
  if (!opts.date) return { minutes, general, specific, ...(primer ? { primer } : {}) };
  // Complex: on heavy days the build-up sets are the warm-up, so no complex.
  const complex = heavy || tags.timeDomain === 'heavy' ? undefined : complexFor(tags, opts.date, opts.implementsAvailable);
  const sk = skillSegment(w, opts.date, !!opts.longPractice && tags.timeDomain !== 'heavy');
  return {
    minutes: minutes + (complex ? 4 : 0) + 5, general, specific, ...(primer ? { primer } : {}),
    ...(complex ? { complex: { title: complex.title, rounds: complex.rounds } } : {}),
    skill: { title: sk.title, lines: sk.lines }, ...(sk.practice ? { practice: sk.practice } : {}),
  };
}

/** The editable text form: heading lines, "- " item lines. */
export function warmUpText(wu: WarmUp): string {
  const lines = [`General`, ...wu.general.map((g) => `- ${g}`)];
  if (wu.complex) lines.push('Complex', `${wu.complex.title}.`, ...wu.complex.rounds.map((r) => `- ${r}`));
  if (wu.skill) lines.push('Skill', `${wu.skill.title}.`, ...wu.skill.lines);
  lines.push(`Specific`, ...wu.specific.map((s) => `- ${s}`));
  if (wu.primer) lines.push('Primer', `- ${wu.primer}`);
  if (wu.practice) lines.push('Skill practice', ...wu.practice.map((p) => `- ${p}`));
  return lines.join('\n');
}

/** Parse the small text format (used for warm-ups and edited plans) into blocks for display. */
export function parseNoteText(text: string): { heading?: string; items: string[]; paragraphs: string[] }[] {
  const blocks: { heading?: string; items: string[]; paragraphs: string[] }[] = [];
  let cur: (typeof blocks)[number] | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^[-•*]\s+(.*)$/.exec(line);
    if (item) { if (!cur) blocks.push(cur = { items: [], paragraphs: [] }); cur.items.push(item[1]!); continue; }
    // A short line without a full stop, followed by items, reads as a heading.
    if (line.length <= 40 && !/[.!?]$/.test(line)) { blocks.push(cur = { heading: line.replace(/:$/, ''), items: [], paragraphs: [] }); continue; }
    if (!cur || cur.items.length) blocks.push(cur = { items: [], paragraphs: [] });
    cur.paragraphs.push(line);
  }
  return blocks;
}
