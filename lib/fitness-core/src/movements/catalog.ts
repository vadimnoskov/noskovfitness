/**
 * Movement catalog: the single source of truth for what a movement IS.
 *
 * Identity rule (prevents BTWB-style duplicates):
 *   movement = family + a small set of controlled attributes (implement, count, start, receive, style, variant, position).
 * How a movement is PRESCRIBED is not identity and lives on the workout:
 *   reps / calories / meters, load, height, unbroken, tempo, pause, deficit, weighted (added load), synchronized.
 *
 * Families list only the attribute values that make sense for them. Anything typed by a coach or imported
 * must resolve to one family + allowed attributes (see resolver.ts); it never creates a movement silently.
 */

export type Modality = 'G' | 'W' | 'M';

export type Implement =
  | 'bodyweight' | 'barbell' | 'dumbbell' | 'kettlebell' | 'medball' | 'sandbag' | 'plate'
  | 'rings' | 'bar' | 'parallettes' | 'box' | 'rope' | 'ghd' | 'wall' | 'sled'
  | 'rower' | 'air-bike' | 'bike-erg' | 'ski-erg' | 'jump-rope' | 'none'
  /** Equipment that is not an implement of a movement but is required by some (checked by the engine). */
  | 'rack' | 'bench' | 'p-bars' | 'pool';

export type Count = 'single' | 'double' | 'alternating';
export type Start = 'floor' | 'hang' | 'high-hang' | 'block';
export type Receive = 'power' | 'squat' | 'split';
export type Style = 'strict' | 'kipping' | 'butterfly' | 'jumping' | 'banded' | 'legless';
export type Position = 'front-rack' | 'back-rack' | 'overhead' | 'goblet' | 'suitcase' | 'farmers' | 'bear-hug';

export interface Family {
  id: string;
  name: string;
  modality: Modality;
  /** Functional pattern used by analysis and balance checks. */
  pattern: string;
  /** Allowed implements; the first one is the default (not shown in the display name). */
  implements: Implement[];
  count?: Count[];
  start?: Start[];
  receive?: Receive[];
  style?: Style[];
  position?: Position[];
  /** Family-specific named variants (e.g. deadlift: sumo, romanian). */
  variants?: string[];
  /** Count assumed when none is written, per implement (e.g. dumbbell snatch = single-arm, switch hands any time). */
  defaultCount?: Partial<Record<Implement, Count>>;
  /** Natural unit for prescription. */
  unit: 'reps' | 'distance' | 'calories' | 'time' | 'distance-or-calories';
  /** Regex sources that identify the family in free text. Checked in catalog order (specific first). */
  match: string[];
}

const BB_DB_KB: Implement[] = ['barbell', 'dumbbell', 'kettlebell'];

export const FAMILIES: Family[] = [
  // ---------- Composite / specific names first ----------
  { id: 'burpee', name: 'Burpee', modality: 'G', pattern: 'full-body', implements: ['bodyweight', 'dumbbell', 'plate'], unit: 'reps',
    variants: ['bar-facing', 'lateral-over', 'box-jump-over', 'box-step-over', 'to-target', 'pull-up', 'broad-jump', 'over-object', 'box'],
    match: ['burpee'] },
  { id: 'sdhp', name: 'Sumo Deadlift High Pull', modality: 'W', pattern: 'hinge-pull', implements: ['barbell', 'kettlebell', 'dumbbell'], unit: 'reps',
    match: ['sumo deadlift high[- ]?pull', '\\bsdhp\\b'] },
  { id: 'cluster', name: 'Cluster', modality: 'W', pattern: 'squat-press', implements: BB_DB_KB, start: ['floor', 'hang'], unit: 'reps',
    match: ['cluster', 'squat clean thruster', 'clean[- ]to[- ]thruster', 'burpee-clean-thruster'] },
  { id: 'devil-press', name: 'Devil Press', modality: 'W', pattern: 'full-body', implements: ['dumbbell'], count: ['double', 'single', 'alternating'], unit: 'reps',
    match: ['devil press'] },
  { id: 'man-maker', name: 'Man Maker', modality: 'W', pattern: 'full-body', implements: ['dumbbell'], unit: 'reps', match: ['man[- ]?makers?', 'woman makers?'] },
  { id: 'tgu', name: 'Turkish Get-up', modality: 'W', pattern: 'full-body', implements: ['kettlebell', 'dumbbell'], unit: 'reps', match: ['turkish get'] },
  { id: 'wall-ball', name: 'Wall Ball', modality: 'W', pattern: 'squat-press', implements: ['medball'], unit: 'reps', match: ['wall ?balls?', 'wallballs?'] },
  { id: 'kb-swing', name: 'Kettlebell Swing', modality: 'W', pattern: 'hinge', implements: ['kettlebell', 'dumbbell'], count: ['double', 'single'],
    variants: ['russian', 'american'], unit: 'reps', match: ['swings?\\b'] },
  { id: 'snatch-balance', name: 'Snatch Balance', modality: 'W', pattern: 'squat-overhead', implements: ['barbell'], unit: 'reps', match: ['snatch balance'] },
  { id: 'snatch-pull', name: 'Snatch Pull', modality: 'W', pattern: 'hinge-pull', implements: ['barbell'], unit: 'reps', match: ['snatch pulls?'] },
  { id: 'clean-pull', name: 'Clean Pull', modality: 'W', pattern: 'hinge-pull', implements: ['barbell'], unit: 'reps', match: ['clean pull(?!.*under)'] },
  { id: 'clean-and-jerk', name: 'Clean & Jerk', modality: 'W', pattern: 'clean-jerk', implements: BB_DB_KB, count: ['double', 'single', 'alternating'],
    start: ['floor', 'hang'], receive: ['power', 'squat', 'split'], variants: ['push-jerk', 'split-jerk', 'power-jerk'], unit: 'reps',
    match: ['clean (&|and) (push |split |power )?jerk', 'clean-?and-?jerk', '\\bc&j\\b', 'clean,? (push |split )?jerk'] },
  { id: 'over-shoulder', name: 'Over-the-Shoulder', modality: 'W', pattern: 'hinge', implements: ['sandbag', 'medball'], unit: 'reps',
    match: ['over[- ]the[- ]shoulders?', 'over[- ]shoulders?', '\\bots\\b'] },
  { id: 'ground-to-overhead', name: 'Ground to Overhead', modality: 'W', pattern: 'clean-jerk', implements: ['barbell', 'dumbbell', 'plate', 'sandbag'], unit: 'reps',
    match: ['ground[- ]to[- ]overhead', 'floor[- ]to[- ]overhead', 'clean[- ]to[- ]overhead'] },
  { id: 'shoulder-to-overhead', name: 'Shoulder to Overhead', modality: 'W', pattern: 'press', implements: BB_DB_KB, count: ['double', 'single', 'alternating'], unit: 'reps',
    match: ['shoulder[- ]to[- ]overhead', '\\bs2oh\\b', '\\bstoh\\b'] },
  { id: 'deadlift', name: 'Deadlift', modality: 'W', pattern: 'hinge', implements: ['barbell', 'dumbbell', 'kettlebell', 'sandbag'], count: ['double', 'single'],
    variants: ['sumo', 'romanian', 'single-leg', 'snatch-grip', 'suitcase', 'clean-grip'], unit: 'reps',
    match: ['deadlifts?', '\\brdl\\b', 'clean deadlift'] },
  { id: 'push-press', name: 'Push Press', modality: 'W', pattern: 'press', implements: BB_DB_KB, count: ['double', 'single', 'alternating'],
    variants: ['behind-the-neck', 'snatch-grip'], unit: 'reps', match: ['push press'] },
  { id: 'thruster', name: 'Thruster', modality: 'W', pattern: 'squat-press', implements: ['barbell', 'dumbbell', 'kettlebell', 'medball'], count: ['double', 'single'], unit: 'reps',
    match: ['thrusters?'] },
  { id: 'overhead-squat', name: 'Overhead Squat', modality: 'W', pattern: 'squat-overhead', implements: ['barbell', 'dumbbell', 'kettlebell', 'plate'], count: ['double', 'single'], unit: 'reps',
    match: ['overhead squat', '\\bohs\\b'] },
  { id: 'front-squat', name: 'Front Squat', modality: 'W', pattern: 'squat', implements: ['barbell', 'dumbbell', 'kettlebell', 'medball', 'sandbag'], count: ['double', 'single'],
    variants: ['box'], unit: 'reps', match: ['front (box )?squat', 'front rack squats?', '(dumbbell|db|kettlebell|sandbag) squats?$', 'dumbbell squat$'] },
  { id: 'back-squat', name: 'Back Squat', modality: 'W', pattern: 'squat', implements: ['barbell', 'dumbbell'], variants: ['box'], unit: 'reps',
    match: ['back (box )?squat', '^box squats?$', 'tempo back squat'] },
  { id: 'goblet-squat', name: 'Goblet Squat', modality: 'W', pattern: 'squat', implements: ['kettlebell', 'dumbbell', 'medball', 'plate'], unit: 'reps',
    match: ['goblet squat', 'bear hug squat', 'zercher squat', 'plate squats?'] },
  { id: 'snatch', name: 'Snatch', modality: 'W', pattern: 'snatch', implements: BB_DB_KB, count: ['single', 'alternating', 'double'],
    start: ['floor', 'hang', 'high-hang', 'block'], receive: ['power', 'squat', 'split'], defaultCount: { dumbbell: 'single', kettlebell: 'single' },
    unit: 'reps', match: ['snatch(es)?\\b'] },
  { id: 'clean', name: 'Clean', modality: 'W', pattern: 'clean', implements: ['barbell', 'dumbbell', 'kettlebell', 'medball', 'sandbag', 'plate'],
    count: ['double', 'single', 'alternating'], start: ['floor', 'hang', 'high-hang', 'block'], receive: ['power', 'squat', 'split'], unit: 'reps',
    match: ['cleans?\\b(?! ?&| and)'] },
  { id: 'jerk', name: 'Jerk', modality: 'W', pattern: 'press', implements: BB_DB_KB, count: ['double', 'single', 'alternating'],
    variants: ['push', 'split', 'power', 'behind-the-neck'], unit: 'reps', match: ['jerks?\\b'] },
  { id: 'press', name: 'Strict Press', modality: 'W', pattern: 'press', implements: BB_DB_KB, count: ['double', 'single', 'alternating'],
    variants: ['half-kneeling', 'seated', 'z-press'], unit: 'reps', match: ['shoulder press', 'strict press', '^press(es)?$', 'z press', 'kettlebell press', 'dumbbell press'] },
  { id: 'bench-press', name: 'Bench Press', modality: 'W', pattern: 'horizontal-push', implements: ['barbell', 'dumbbell'], count: ['double', 'single'],
    variants: ['close-grip', 'incline', 'floor'], unit: 'reps', match: ['bench press', 'floor press'] },
  { id: 'good-morning', name: 'Good Morning', modality: 'W', pattern: 'hinge', implements: ['barbell'], unit: 'reps', match: ['good ?mornings?'] },
  { id: 'hip-thrust', name: 'Hip Thrust', modality: 'W', pattern: 'hinge', implements: ['barbell', 'dumbbell'], unit: 'reps', match: ['hip thrust'] },
  { id: 'lunge', name: 'Lunge', modality: 'W', pattern: 'single-leg', implements: ['bodyweight', 'barbell', 'dumbbell', 'kettlebell', 'medball', 'plate', 'sandbag'],
    count: ['double', 'single'], position: ['front-rack', 'back-rack', 'overhead', 'goblet', 'suitcase'],
    variants: ['walking', 'reverse', 'stationary', 'jumping', 'lateral'], unit: 'reps', match: ['lunges?\\b', 'cossack squats?'] },
  { id: 'split-squat', name: 'Split Squat', modality: 'W', pattern: 'single-leg', implements: ['bodyweight', 'dumbbell', 'kettlebell', 'barbell'],
    variants: ['bulgarian', 'cyclist'], unit: 'reps', match: ['split squat', 'cyclist squat'] },
  { id: 'step-up', name: 'Box Step-up', modality: 'W', pattern: 'single-leg', implements: ['bodyweight', 'dumbbell', 'kettlebell', 'barbell', 'medball', 'sandbag'],
    count: ['double', 'single'], position: ['front-rack', 'goblet', 'suitcase'], variants: ['step-over', 'russian'], unit: 'reps',
    match: ['step[- ]?ups?', 'step[- ]?overs?', 'russian step'] },
  { id: 'carry', name: 'Carry', modality: 'W', pattern: 'carry', implements: ['dumbbell', 'kettlebell', 'barbell', 'plate', 'sandbag', 'medball'],
    count: ['double', 'single'], position: ['farmers', 'suitcase', 'front-rack', 'overhead', 'bear-hug'], unit: 'distance',
    match: ['carry', 'farmer', 'waiter', 'overhead walk', 'front rack walk', 'pinch walk'] },
  { id: 'hold', name: 'Loaded Hold', modality: 'W', pattern: 'carry', implements: ['dumbbell', 'kettlebell', 'barbell', 'plate'], count: ['double', 'single'],
    position: ['front-rack', 'overhead', 'suitcase'], unit: 'time', match: ['(rack|overhead|suitcase|kettlebell) holds?', 'dumbbell hold'] },
  { id: 'bent-row', name: 'Bent-over Row', modality: 'W', pattern: 'horizontal-pull', implements: ['barbell', 'dumbbell', 'kettlebell'], count: ['double', 'single', 'alternating'],
    variants: ['renegade', 'plank', 'chest-supported', 'push-up'], unit: 'reps', match: ['bent over (barbell |single arm |db |dumbbell )*rows?', 'renegade rows?', 'plank rows?', 'chest supported', '(dumbbell|db|kettlebell) rows?', 'push-up dumbbell rows?'] },
  { id: 'sled', name: 'Sled Push / Drag', modality: 'W', pattern: 'locomotion', implements: ['sled'], variants: ['push-high', 'push-low', 'drag', 'pull'], unit: 'distance',
    match: ['sled', 'prowler'] },
  { id: 'medball-throw', name: 'Med Ball Throw / Slam', modality: 'W', pattern: 'full-body', implements: ['medball'], variants: ['slam', 'sit-up-throw', 'side-toss'], unit: 'reps',
    match: ['ball slam', 'slam balls?', 'ball .*throws?', 'sit[- ]?up throws?', 'toss'] },
  { id: 'accessory', name: 'Accessory', modality: 'W', pattern: 'accessory', implements: ['dumbbell', 'barbell', 'plate'],
    variants: ['curl', 'rear-delt-fly', 'skull-crusher', 'kickback', 'arm-lift', 'triceps-extension', 'cable-row', 'windmill'], unit: 'reps', match: ['curls?', 'flies', 'skull', 'kick ?back', 'arm lift', 'tricep extension', 'pulley rows?', 'windmills?'] },

  // ---------- Gymnastics ----------
  { id: 'hspu', name: 'Handstand Push-up', modality: 'G', pattern: 'vertical-push', implements: ['wall', 'parallettes', 'plate'], style: ['kipping', 'strict'],
    variants: ['pike'], unit: 'reps', match: ['handstand push', '\\bhspu', 'pike push'] },
  { id: 'handstand-walk', name: 'Handstand Walk', modality: 'G', pattern: 'inversion', implements: ['bodyweight'], unit: 'distance', match: ['handstand walk'] },
  { id: 'handstand-hold', name: 'Handstand Hold', modality: 'G', pattern: 'inversion', implements: ['wall', 'bodyweight'], variants: ['freestanding', 'shoulder-taps'], unit: 'time',
    match: ['handstand hold', '^handstands?$', 'candlestick to handstand', 'wall facing shoulder tap', 'handstand (shoulder|hip) (touch|tap)'] },
  { id: 'wall-walk', name: 'Wall Walk', modality: 'G', pattern: 'inversion', implements: ['wall'], unit: 'reps', match: ['wall walk', 'wall climb'] },
  { id: 'muscle-up', name: 'Muscle-up', modality: 'G', pattern: 'pull-push', implements: ['rings', 'bar'], style: ['kipping', 'strict', 'jumping'], unit: 'reps',
    match: ['muscle[- ]?ups?'] },
  { id: 'bar-hang', name: 'Bar Hang / Chin-over-bar Hold', modality: 'G', pattern: 'vertical-pull', implements: ['bar', 'rings'], unit: 'time',
    match: ['hang from pull', 'pull-up bar hang', 'dead hang', 'chin over bar hold', 'ring hold', '^bar hang'] },
  { id: 'pull-up', name: 'Pull-up', modality: 'G', pattern: 'vertical-pull', implements: ['bar', 'rings'], style: ['kipping', 'strict', 'butterfly', 'jumping', 'banded'],
    variants: ['chest-to-bar', 'chin-up'], unit: 'reps', match: ['pull[- ]?ups?', 'chin[- ]?ups?', 'chest[- ]to[- ]bar'] },
  { id: 'bar-pullover', name: 'Bar Pull-over', modality: 'G', pattern: 'vertical-pull', implements: ['bar'], unit: 'reps', match: ['pull[- ]?over', 'circle overs?'] },
  { id: 'rope-climb', name: 'Rope Climb', modality: 'G', pattern: 'vertical-pull', implements: ['rope'], style: ['legless'], unit: 'reps', match: ['rope climb'] },
  { id: 'ring-row', name: 'Ring Row', modality: 'G', pattern: 'horizontal-pull', implements: ['rings'], unit: 'reps', match: ['ring rows?', 'inverted (ring )?rows?', 'supine ring'] },
  { id: 'dip', name: 'Dip', modality: 'G', pattern: 'vertical-push', implements: ['rings', 'bar', 'parallettes', 'box'], style: ['kipping', 'strict'], unit: 'reps',
    match: ['dips?\\b'] },
  { id: 'push-up', name: 'Push-up', modality: 'G', pattern: 'horizontal-push', implements: ['bodyweight', 'rings', 'parallettes', 'dumbbell', 'box'],
    variants: ['hand-release', 'feet-elevated', 'clapping', 'deficit', 'inchworm'], unit: 'reps', match: ['push[- ]?ups?'] },
  { id: 'toes-to-bar', name: 'Toes-to-bar', modality: 'G', pattern: 'core-hang', implements: ['bar', 'rings'], style: ['kipping', 'strict'], unit: 'reps',
    match: ['toes[- ]?t(o|hrough)[- ]?(bar|ring)', '\\bttb\\b', '\\bt2b\\b'] },
  { id: 'knees-to-elbows', name: 'Knees-to-elbows', modality: 'G', pattern: 'core-hang', implements: ['bar'], unit: 'reps', match: ['knees?[- ]to[- ]elbow', '\\bk2e\\b', '\\bkte\\b'] },
  { id: 'knee-raise', name: 'Hanging Knee Raise', modality: 'G', pattern: 'core-hang', implements: ['bar'], unit: 'reps', match: ['knee raise', 'knee[- ]?ups?'] },
  { id: 'sit-up', name: 'Sit-up', modality: 'G', pattern: 'core', implements: ['bodyweight', 'medball', 'dumbbell', 'kettlebell', 'plate'],
    variants: ['abmat', 'ghd', 'anchored', 'overhead'], unit: 'reps', match: ['sit[- ]?ups?'] },
  { id: 'v-up', name: 'V-up', modality: 'G', pattern: 'core', implements: ['bodyweight', 'plate'], variants: ['tuck-up', 'leg-raise'], unit: 'reps',
    match: ['v[- ]ups?', 'tuck[- ]?ups?', 'knees[- ]to[- ]chests?', '(lying|anchored) leg raises?'] },
  { id: 'hollow', name: 'Hollow / Superman Hold', modality: 'G', pattern: 'core', implements: ['bodyweight'], variants: ['hollow', 'superman'], unit: 'time',
    match: ['hollow', 'superm[ae]n'] },
  { id: 'plank', name: 'Plank', modality: 'G', pattern: 'core', implements: ['bodyweight', 'dumbbell', 'rings', 'plate'], variants: ['side', 'shoulder-taps'], unit: 'time',
    match: ['plank', 'forward lean rest', '\\bflr\\b', '^shoulder taps?$'] },
  { id: 'russian-twist', name: 'Russian Twist', modality: 'G', pattern: 'core', implements: ['bodyweight', 'dumbbell', 'medball'], unit: 'reps', match: ['russian twist'] },
  { id: 'l-sit', name: 'L-sit', modality: 'G', pattern: 'core', implements: ['parallettes', 'rings', 'bodyweight'], unit: 'time', match: ['l-sit', 'tuck l sit', 'tuck hold'] },
  { id: 'hip-extension', name: 'Back Extension', modality: 'G', pattern: 'hinge', implements: ['ghd', 'medball'], variants: ['back', 'hip', 'hip-and-back'], unit: 'reps',
    match: ['back extension', 'hip extension', 'hip & back', 'gh raise'] },
  { id: 'air-squat', name: 'Air Squat', modality: 'G', pattern: 'squat', implements: ['bodyweight'], variants: ['jumping', 'hold'], unit: 'reps',
    match: ['air squat', '^squats?$', 'squat jumps?', 'squat hold', 'jumping (air )?squat'] },
  { id: 'pistol', name: 'Pistol', modality: 'G', pattern: 'single-leg', implements: ['bodyweight', 'kettlebell', 'dumbbell', 'plate'], unit: 'reps',
    match: ['pistol', 'one legged squat', 'single-leg squat'] },
  { id: 'box-jump', name: 'Box Jump', modality: 'G', pattern: 'jump', implements: ['box', 'plate'], variants: ['over', 'lateral', 'seated'], unit: 'reps',
    match: ['box jump', 'plate jump', 'box get over'] },
  { id: 'broad-jump', name: 'Broad Jump', modality: 'G', pattern: 'jump', implements: ['bodyweight'], unit: 'reps', variants: ['vertical'], match: ['broad jump', 'long jump', 'vertical jump'] },
  { id: 'lateral-jump', name: 'Lateral Jump Over', modality: 'G', pattern: 'jump', implements: ['barbell', 'parallettes', 'bodyweight'], unit: 'reps',
    match: ['lateral (bar|barbell|box|parallete|parallette) jump', 'lateral jumps? over', 'parallet+e lateral', 'barrier hop', 'tuck jump', 'speed skater', 'hurdle jumps?', 'object jumps?', 'jump overs?'] },
  { id: 'mountain-climber', name: 'Mountain Climber', modality: 'G', pattern: 'core', implements: ['bodyweight'], unit: 'reps', match: ['mountain climber'] },
  { id: 'bear-crawl', name: 'Crawl (bear / crab)', modality: 'G', pattern: 'locomotion', implements: ['bodyweight'], unit: 'distance', match: ['bear crawl', 'crab walk'] },
  { id: 'jumping-jack', name: 'Jumping Jack', modality: 'G', pattern: 'jump', implements: ['bodyweight'], unit: 'reps', match: ['jumping jack'] },
  { id: 'skill-drill', name: 'Gymnastics Skill Drill', modality: 'G', pattern: 'skill', implements: ['parallettes', 'rings', 'bodyweight', 'bar'],
    variants: ['pass-through', 'toe-taps', 'skin-the-cat', 'shoot-through', 'forward-roll', 'ring-out', 'candlestick', 'leg-throws', 'hands-to-feet', 'support-hold', 'iron-cross'], unit: 'reps',
    match: ['pass[- ]?through', 'toe taps?', 'skin[- ]the[- ]cat', 'shoot[- ]?through', 'forward rolls?', 'ring outs?', 'candle ?sticks?', 'leg throws?', 'hands[- ]to[- ]feet', 'support hold', 'iron cross'] },

  // ---------- Monostructural ----------
  { id: 'jump-rope', name: 'Jump Rope', modality: 'M', pattern: 'jump-rope', implements: ['jump-rope'], variants: ['single-under', 'double-under', 'crossover', 'triple-under'], unit: 'reps',
    match: ['double[- ]?unders?', 'triple[- ]?unders?', '\\bdus?\\b', 'single[- ]?unders?', 'jump rope', 'cross ?overs?', 'over[- ]?unders?'] },
  { id: 'run', name: 'Run', modality: 'M', pattern: 'locomotion', implements: ['none', 'medball', 'plate', 'sandbag'],
    variants: ['shuttle', 'sprint', 'trail', 'backward', 'lateral-shuffle'], unit: 'distance',
    match: ['^runs?\\b', '\\bruns?$', 'run \\(', 'shuttle', 'sprint', 'trail run', 'road run', 'backward run', 'lateral shuffle', 'medicine ball run', 'med ball run', 'plate run', 'fast feet'] },
  { id: 'row', name: 'Row (erg)', modality: 'M', pattern: 'row', implements: ['rower'], unit: 'distance-or-calories',
    match: ['^rows?$', '^rows? (calories?|\\(calories\\)|\\(meters\\))', '^row ?calories?', '^row \\(', 'rowing'] },
  { id: 'bike', name: 'Bike', modality: 'M', pattern: 'cycle', implements: ['air-bike', 'bike-erg'], unit: 'distance-or-calories',
    match: ['assault bike', 'echo bike', 'air bike', 'airdyne', 'bike erg', '^bikes?\\b', 'bike calories?'] },
  { id: 'ski', name: 'Ski Erg', modality: 'M', pattern: 'ski', implements: ['ski-erg'], unit: 'distance-or-calories', match: ['ski ?erg'] },
  { id: 'swim', name: 'Swim', modality: 'M', pattern: 'swim', implements: ['none'], unit: 'distance', match: ['swim'] },
];

export const FAMILY_BY_ID: Record<string, Family> = Object.fromEntries(FAMILIES.map((f) => [f.id, f]));
