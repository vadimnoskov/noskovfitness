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

export interface WarmUp { minutes: number; general: string[]; specific: string[]; primer?: string }

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

export function suggestWarmUp(w: Workout, tags: WorkoutTags = deriveTags(w)): WarmUp {
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
  return { minutes, general, specific, ...(primer ? { primer } : {}) };
}

/** The editable text form: heading lines, "- " item lines. */
export function warmUpText(wu: WarmUp): string {
  const lines = [`General`, ...wu.general.map((g) => `- ${g}`), `Specific`, ...wu.specific.map((s) => `- ${s}`)];
  if (wu.primer) lines.push('Primer', `- ${wu.primer}`);
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
