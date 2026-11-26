/**
 * Movement facts: one row per movement family, from the coach's review sheet "Chalkboard - Movement facts"
 * (reviewed November 2026; the coach's comment on Carry applied). Points of performance and common faults for the
 * 13 movements the CrossFit Level 1 Movement Guide covers are summarized in our own words, with the page range.
 */

export interface MovementFacts {
  /** Catalog family id. */
  key: string;
  name: string;
  modality: 'G' | 'W' | 'M';
  pattern: string;
  mainStress: string;
  alsoWorks: string;
  role: string;
  skill: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  station: string;
  easier: string[];
  harder: string[];
  note?: string;
}

export interface MovementGuide {
  key: string;
  /** The L1 name when it differs from the family (e.g. medicine-ball clean for the clean family). */
  title: string;
  pages: string;
  setup: string[];
  execution: string[];
  finish: string[];
  faults: { fault: string; fix: string }[];
}

const split = (s: string) => s.split(';').map((x) => x.trim()).filter(Boolean);
type Row = [key: string, name: string, mod: 'G' | 'W' | 'M', pattern: string, main: string, also: string, role: string, skill: MovementFacts['skill'], impact: MovementFacts['impact'], station: string, easier: string, harder: string, note?: string];

const ROWS: Row[] = [
  ['accessory', 'Accessory', 'W', 'accessory', 'varies', '', 'strength', 'low', 'low', 'varies', '', '', 'Catch-all; rarely programmed'],
  ['carry', 'Carry', 'W', 'carry', 'grip, midline', 'legs', 'strength + metcon', 'low', 'low', 'own (KB/DB)', 'lighter load; shorter distance', 'heavier load; overhead carry', 'Fits strength combinations, alternating with other strength movements. An overhead carry shifts the main stress to midline and overhead.'],
  ['hold', 'Loaded Hold', 'W', 'carry', 'grip, midline', 'overhead', 'strength + metcon', 'low', 'low', 'own (KB/DB/barbell)', 'lighter load; shorter time', 'heavier load; longer time', 'Needs a stated time'],
  ['clean', 'Clean', 'W', 'clean', 'posterior chain, legs', 'pull, grip', 'strength + metcon', 'high', 'low', 'own (barbell/DB)', 'DB clean; hang power clean; muscle clean', 'squat clean; heavier load'],
  ['clean-and-jerk', 'Clean & Jerk', 'W', 'clean jerk', 'posterior chain, overhead', 'legs, pull, grip', 'strength + metcon', 'high', 'low', 'own (barbell/DB)', 'DB clean & jerk; power clean + push press', 'squat clean & split jerk; heavier load'],
  ['ground-to-overhead', 'Ground to Overhead', 'W', 'clean jerk', 'posterior chain, overhead', 'legs, grip', 'metcon', 'medium', 'low', 'own (barbell/DB/plate)', 'DB ground-to-overhead; plate ground-to-overhead', 'heavier load; clean & jerk'],
  ['devil-press', 'Devil Press', 'W', 'full body', 'posterior chain, overhead', 'push, cardio', 'metcon', 'medium', 'low', 'own (pair of DBs)', 'single DB; DB burpee + DB snatch (split)', 'heavier DBs', 'Same pattern as DB snatch: keep apart from snatch days'],
  ['man-maker', 'Man Maker', 'W', 'full body', 'full body', 'push, pull, midline', 'metcon', 'medium', 'low', 'own (pair of DBs)', 'burpee + DB row + DB thruster (split)', 'heavier DBs'],
  ['medball-throw', 'Med Ball Throw / Slam', 'W', 'full body', 'full body, cardio', 'posterior chain', 'metcon', 'low', 'medium', 'own (ball)', 'lighter ball', 'heavier ball'],
  ['tgu', 'Turkish Get-up', 'W', 'full body', 'midline, overhead', 'legs', 'warm-up', 'high', 'low', 'own (KB/DB)', 'half get-up; shoe-on-fist get-up', 'heavier KB', 'Mostly warm-up or practice; in a metcon about once a month'],
  ['deadlift', 'Deadlift', 'W', 'hinge', 'posterior chain', 'grip', 'strength + metcon', 'medium', 'low', 'own (barbell)', 'KB deadlift; DB deadlift; elevated deadlift', 'heavier load'],
  ['good-morning', 'Good Morning', 'W', 'hinge', 'posterior chain', 'midline', 'strength', 'medium', 'low', 'own (barbell)', 'PVC good morning', 'heavier load', 'Accessory strength; rarely a metcon'],
  ['hip-thrust', 'Hip Thrust', 'W', 'hinge', 'posterior chain', '', 'strength', 'low', 'low', 'own (barbell/DB)', 'glute bridge', 'heavier load', 'Accessory strength'],
  ['kb-swing', 'Kettlebell Swing', 'W', 'hinge', 'posterior chain', 'grip, cardio', 'metcon', 'low', 'low', 'own (KB)', 'Russian swing; KB deadlift', 'American swing; heavier KB'],
  ['over-shoulder', 'Over-the-Shoulder', 'W', 'hinge', 'posterior chain', 'grip, legs', 'metcon', 'medium', 'low', 'own (sandbag)', 'lighter sandbag; sandbag to shoulder', 'heavier sandbag', 'Gym only (sandbags)'],
  ['clean-pull', 'Clean Pull', 'W', 'hinge pull', 'posterior chain', 'grip', 'strength', 'medium', 'low', 'own (barbell)', 'hang clean pull', 'heavier load'],
  ['snatch-pull', 'Snatch Pull', 'W', 'hinge pull', 'posterior chain', 'grip', 'strength', 'medium', 'low', 'own (barbell)', 'hang snatch pull', 'heavier load'],
  ['sdhp', 'Sumo Deadlift High Pull', 'W', 'hinge pull', 'posterior chain', 'pull, cardio', 'metcon', 'medium', 'low', 'own (barbell/KB)', 'KB SDHP light; sumo deadlift + upright row (split)', 'heavier load'],
  ['bent-row', 'Bent-over Row', 'W', 'horizontal pull', 'pull', 'posterior chain, grip', 'strength', 'low', 'low', 'own (barbell/DB)', 'DB row; ring row', 'heavier load'],
  ['bench-press', 'Bench Press', 'W', 'horizontal push', 'push', '', 'strength', 'low', 'low', 'own (bench + barbell)', 'DB bench press; push-up', 'heavier load', 'Needs a spotter or safeties when heavy'],
  ['sled', 'Sled Push / Drag', 'W', 'locomotion', 'legs', 'cardio', 'metcon', 'low', 'low', 'own (sled)', 'lighter sled', 'heavier sled', 'Gym only'],
  ['jerk', 'Jerk', 'W', 'press', 'overhead, legs', 'midline', 'strength + metcon', 'high', 'low', 'own (barbell + rack)', 'push press; DB push jerk', 'split jerk; heavier load'],
  ['push-press', 'Push Press', 'W', 'press', 'overhead, push', 'legs', 'strength + metcon', 'medium', 'low', 'own (barbell/DBs)', 'DB push press; strict press lighter', 'push jerk; heavier load'],
  ['shoulder-to-overhead', 'Shoulder to Overhead', 'W', 'press', 'overhead, push', 'legs', 'metcon', 'medium', 'low', 'own (barbell/DBs)', 'DB shoulder-to-overhead; lighter load', 'heavier load'],
  ['press', 'Strict Press', 'W', 'press', 'overhead, push', 'midline', 'strength', 'low', 'low', 'own (barbell/DBs)', 'DB press; PVC press', 'heavier load'],
  ['step-up', 'Box Step-up', 'G', 'single leg', 'legs', 'cardio', 'metcon', 'low', 'low', 'own (box)', 'lower box', 'higher box; weighted step-up', 'Gymnastics with bodyweight, weightlifting when loaded'],
  ['lunge', 'Lunge', 'G', 'single leg', 'legs', 'midline, cardio', 'metcon', 'low', 'medium', 'none', 'reverse lunge; split squat', 'front-rack or overhead lunge; heavier load', 'Gymnastics with bodyweight, weightlifting when loaded'],
  ['split-squat', 'Split Squat', 'W', 'single leg', 'legs', 'midline', 'strength', 'low', 'low', 'none', 'bodyweight split squat', 'Bulgarian split squat; heavier load'],
  ['snatch', 'Snatch', 'W', 'snatch', 'posterior chain, overhead', 'legs, pull, grip', 'strength + metcon', 'high', 'low', 'own (barbell/DB)', 'DB snatch; hang power snatch; muscle snatch', 'squat snatch; heavier load', 'Same pattern as devil press: keep apart'],
  ['back-squat', 'Back Squat', 'W', 'squat', 'legs', 'posterior chain', 'strength', 'medium', 'low', 'own (barbell + rack)', 'goblet squat; air squat', 'heavier load', 'Needs a rack when heavy'],
  ['front-squat', 'Front Squat', 'W', 'squat', 'legs', 'midline', 'strength + metcon', 'medium', 'low', 'own (barbell + rack for heavy)', 'goblet squat; air squat', 'heavier load'],
  ['goblet-squat', 'Goblet Squat', 'W', 'squat', 'legs', 'midline', 'metcon', 'low', 'low', 'own (KB/DB)', 'air squat', 'front squat'],
  ['overhead-squat', 'Overhead Squat', 'W', 'squat overhead', 'overhead, legs', 'midline', 'strength + metcon', 'high', 'low', 'own (barbell)', 'PVC overhead squat; front squat', 'heavier load'],
  ['snatch-balance', 'Snatch Balance', 'W', 'squat overhead', 'overhead, legs', 'midline', 'strength', 'high', 'low', 'own (barbell)', 'PVC / empty bar; drop snatch; overhead squat', 'heavier load', 'Skill/strength day, not a metcon'],
  ['cluster', 'Cluster', 'W', 'squat press', 'legs, overhead', 'posterior chain, cardio', 'metcon', 'high', 'low', 'own (barbell/DBs)', 'DB cluster; clean + thruster (split)', 'heavier load'],
  ['thruster', 'Thruster', 'W', 'squat press', 'legs, overhead', 'cardio', 'metcon', 'medium', 'low', 'own (barbell/DBs)', 'DB thruster; front squat + push press (split)', 'heavier load'],
  ['wall-ball', 'Wall Ball', 'W', 'squat press', 'legs, overhead', 'cardio', 'metcon', 'low', 'low', 'own (ball + wall space)', 'lighter ball / lower target; med-ball thruster', 'heavier ball / higher target'],
  ['hollow', 'Hollow / Superman Hold', 'G', 'core', 'midline', '', 'warm-up + skill', 'low', 'low', 'none', 'tuck hold', 'hollow rock; longer hold'],
  ['l-sit', 'L-sit', 'G', 'core', 'midline', 'push', 'skill', 'high', 'low', 'own (parallettes)', 'tuck sit; one-leg L-sit', 'longer hold'],
  ['mountain-climber', 'Mountain Climber', 'G', 'core', 'midline, cardio', '', 'metcon', 'low', 'medium', 'none', 'slow mountain climber', ''],
  ['plank', 'Plank', 'G', 'core', 'midline', 'push', 'warm-up + skill', 'low', 'low', 'none', 'knee plank', 'weighted plank; ring plank'],
  ['russian-twist', 'Russian Twist', 'G', 'core', 'midline', '', 'warm-up', 'low', 'low', 'none', 'bodyweight', 'with ball or DB', 'Accessory; rarely a metcon'],
  ['sit-up', 'Sit-up', 'G', 'core', 'midline', '', 'metcon', 'low', 'low', 'none (GHD: own)', 'AbMat sit-up; crunch', 'GHD sit-up; weighted sit-up'],
  ['v-up', 'V-up', 'G', 'core', 'midline', '', 'metcon', 'low', 'low', 'none', 'tuck-up', 'weighted V-up'],
  ['knee-raise', 'Hanging Knee Raise', 'G', 'core hang', 'midline', 'grip', 'metcon', 'low', 'low', 'own (bar)', 'lying knee raise', 'knees-to-elbows'],
  ['knees-to-elbows', 'Knees-to-elbows', 'G', 'core hang', 'midline', 'grip, pull', 'metcon', 'medium', 'low', 'own (bar)', 'hanging knee raise', 'toes-to-bar'],
  ['toes-to-bar', 'Toes-to-bar', 'G', 'core hang', 'midline', 'grip, pull', 'metcon', 'medium', 'low', 'own (bar)', 'hanging knee raise; V-up; sit-up', 'strict toes-to-bar'],
  ['burpee', 'Burpee', 'G', 'full body', 'full body, cardio', 'push, legs', 'metcon', 'low', 'high', 'none', 'step-back burpee; burpee without push-up; incline burpee', 'bar-facing burpee; burpee box jump-over; burpee pull-up'],
  ['hip-extension', 'Back Extension', 'G', 'hinge', 'posterior chain', 'midline', 'metcon', 'low', 'low', 'own (GHD)', 'superman hold; good morning', 'hip-back extension; weighted', 'Needs a GHD'],
  ['ring-row', 'Ring Row', 'G', 'horizontal pull', 'pull', 'midline', 'metcon', 'low', 'low', 'own (rings)', 'more upright angle', 'feet elevated; strict pull-up', 'One set of rings: rotation formats only'],
  ['push-up', 'Push-up', 'G', 'horizontal push', 'push', 'midline', 'metcon', 'low', 'low', 'none', 'incline push-up; knee push-up', 'hand-release push-up; deficit push-up; ring push-up'],
  ['handstand-hold', 'Handstand Hold', 'G', 'inversion', 'overhead', 'midline', 'skill', 'medium', 'low', 'own (wall space)', 'pike hold on box; plank', 'freestanding hold', 'Needs a stated time'],
  ['handstand-walk', 'Handstand Walk', 'G', 'inversion', 'overhead', 'midline', 'skill', 'high', 'low', 'own (floor space)', 'wall walk; handstand hold', 'longer distance; obstacles'],
  ['wall-walk', 'Wall Walk', 'G', 'inversion', 'overhead, push', 'midline', 'metcon', 'medium', 'low', 'own (wall space)', 'partial wall walk; inchworm + push-up', ''],
  ['box-jump', 'Box Jump', 'G', 'jump', 'legs', 'cardio', 'metcon', 'low', 'high', 'own (box)', 'step-up; lower box', 'higher box; box jump-over', 'One box: rotation formats only'],
  ['broad-jump', 'Broad Jump', 'G', 'jump', 'legs', 'cardio', 'metcon', 'low', 'high', 'none', '', ''],
  ['jumping-jack', 'Jumping Jack', 'G', 'jump', 'cardio', '', 'warm-up', 'low', 'medium', 'none', 'step jack', '', 'Warm-up material'],
  ['lateral-jump', 'Lateral Jump Over', 'G', 'jump', 'legs, cardio', '', 'metcon', 'low', 'high', 'none', 'lateral step-over', ''],
  ['bear-crawl', 'Crawl (bear / crab)', 'G', 'locomotion', 'midline, cardio', 'push', 'metcon', 'low', 'low', 'none', 'shorter distance', ''],
  ['muscle-up', 'Muscle-up', 'G', 'pull push', 'pull, push', 'midline, grip', 'metcon + skill', 'high', 'medium', 'own (rings or bar)', 'ring row + push-up; jumping muscle-up; low-ring transition', 'strict muscle-up'],
  ['pistol', 'Pistol', 'G', 'single leg', 'legs', 'midline', 'metcon + skill', 'high', 'low', 'none', 'pistol to box; single-leg box squat', 'weighted pistol'],
  ['skill-drill', 'Gymnastics Skill Drill', 'G', 'skill', 'varies', '', 'skill', 'high', 'low', 'varies', '', '', 'Practice blocks, not scored'],
  ['air-squat', 'Air Squat', 'G', 'squat', 'legs', 'cardio', 'metcon', 'low', 'low', 'none', 'box squat', 'jumping squat; pistol'],
  ['bar-hang', 'Bar Hang / Chin-over-bar Hold', 'G', 'vertical pull', 'grip, pull', 'midline', 'skill', 'low', 'low', 'own (bar)', 'shorter hold', 'chin-over-bar hold; weighted'],
  ['bar-pullover', 'Bar Pull-over', 'G', 'vertical pull', 'pull, midline', 'grip', 'skill', 'medium', 'low', 'own (bar)', 'hanging knee raise; kip swing', 'bar muscle-up'],
  ['pull-up', 'Pull-up', 'G', 'vertical pull', 'pull', 'grip, midline', 'metcon + strength', 'medium', 'low', 'own (bar)', 'ring row; jumping pull-up; banded pull-up', 'chest-to-bar; bar muscle-up; weighted'],
  ['rope-climb', 'Rope Climb', 'G', 'vertical pull', 'pull, grip', 'midline, legs', 'metcon', 'high', 'low', 'own (rope)', 'seated rope pull; lying rope pull; partial climb', 'legless rope climb', 'One rope: rotation formats only'],
  ['dip', 'Dip', 'G', 'vertical push', 'push', 'midline', 'metcon + strength', 'medium', 'low', 'own (rings/bar)', 'box dip; banded dip; push-up', 'ring dip; weighted dip'],
  ['hspu', 'Handstand Push-up', 'G', 'vertical push', 'overhead, push', 'midline', 'metcon + skill', 'high', 'low', 'own (wall space)', 'pike push-up; box pike HSPU; seated DB press', 'strict HSPU; deficit HSPU'],
  ['bike', 'Bike', 'M', 'cycle', 'cardio', 'legs', 'metcon', 'low', 'low', 'own (bike)', 'fewer calories', 'more calories', 'Gym only for the family (no bike at home)'],
  ['jump-rope', 'Jump Rope', 'M', 'jump rope', 'cardio', 'legs', 'metcon', 'medium', 'medium', 'own (rope)', 'single-unders; penguin taps', 'double-unders; triple-unders; crossovers'],
  ['run', 'Run', 'M', 'locomotion', 'cardio', 'legs', 'metcon', 'low', 'high', 'none', 'shorter distance; row or bike', 'longer distance; weighted run'],
  ['row', 'Row (erg)', 'M', 'row', 'cardio', 'posterior chain, pull', 'metcon', 'low', 'low', 'own (rower)', 'shorter distance', 'longer distance', 'One rower: rotation formats only'],
  ['ski', 'Ski Erg', 'M', 'ski', 'cardio', 'pull, midline', 'metcon', 'low', 'low', 'own (ski erg)', 'fewer calories', 'more calories', 'Gym only'],
  ['swim', 'Swim', 'M', 'swim', 'cardio', 'pull', 'metcon', 'medium', 'low', 'pool', '', '', 'Needs a pool'],
];

export const MOVEMENT_FACTS: MovementFacts[] = ROWS.map(([key, name, modality, pattern, mainStress, alsoWorks, role, skill, impact, station, easier, harder, note]) => ({
  key, name, modality, pattern, mainStress, alsoWorks, role, skill, impact, station, easier: split(easier), harder: split(harder), ...(note ? { note } : {}),
}));

/** CrossFit L1 Movement Guide (pp. 170–255), summarized: points of performance and the main faults with their fix. */
export const MOVEMENT_GUIDE: MovementGuide[] = [
  { key: 'air-squat', title: 'Air squat', pages: '171–175',
    setup: ['Shoulder-width stance'], execution: ['Hips go back and down first', 'Lumbar curve held', 'Knees track over the toes'],
    finish: ['Hip crease below the knee', 'Heels down', 'Stand to full hip and knee extension'],
    faults: [{ fault: 'Lumbar curve lost at the bottom', fix: 'Chest up; raise the arms on the way down' }, { fault: 'Weight on the toes', fix: 'Lift the toes slightly, push the hips back and down' }, { fault: 'Not deep enough', fix: 'Cue “lower” and squat to a target below the knee' }, { fault: 'Knees cave in', fix: '“Push your knees out”, or a target outside the knee' }] },
  { key: 'front-squat', title: 'Front squat', pages: '176–177',
    setup: ['Shoulder-width stance', 'Hands just outside the shoulders, loose fingertip grip', 'Elbows high, upper arm parallel to the floor'], execution: ['As the air squat: hips back and down, lumbar curve held, knees over toes'],
    finish: ['Below parallel, heels down, full extension'],
    faults: [{ fault: 'Bar not on the torso', fix: 'Open the grip, bar on the fingertips; “elbows high”' }, { fault: 'Elbows drop in the squat', fix: 'Drive the elbows up through the whole squat' }] },
  { key: 'overhead-squat', title: 'Overhead squat', pages: '178–179',
    setup: ['Wide grip (wide enough for a pass-through)', 'Arms straight, shoulders pushing up into the bar', 'Armpits face forward'], execution: ['As the air squat'],
    finish: ['Below parallel, heels down, full extension', 'Bar stays over the middle of the foot'],
    faults: [{ fault: 'Bar drifts forward', fix: 'Push up into the bar and keep it over mid-foot; armpits forward' }] },
  { key: 'press', title: 'Shoulder press', pages: '180–183',
    setup: ['Hip-width stance', 'Hands just outside the shoulders, full grip', 'Bar on the torso, elbows slightly in front of it'], execution: ['Spine neutral, legs straight, heels down', 'Head moves back so the bar travels straight up'],
    finish: ['Arms locked out, shoulders pushing up', 'Bar over the middle of the foot'],
    faults: [{ fault: 'Over-arching the back', fix: 'Squeeze the glutes and brace the midline' }, { fault: 'Bar finishes forward', fix: 'Push the head through so the bar is over mid-foot' }, { fault: 'Bar arcs around the face', fix: 'Pull the head back and press in a straight line' }] },
  { key: 'push-press', title: 'Push press', pages: '184–187',
    setup: ['As the shoulder press'], execution: ['Dip: torso stays vertical, hips and knees bend', 'Drive: hips and legs extend fast, then the arms press', 'Heels down until hips and knees extend'],
    finish: ['Full hip, knee and arm extension', 'Bar over the middle of the foot'],
    faults: [{ fault: 'Leaning forward in the dip', fix: 'Dip straight down, weight on the heels' }, { fault: 'Pressing before the hips finish', fix: 'Hips first: drive, then press' }] },
  { key: 'jerk', title: 'Push jerk', pages: '188–193',
    setup: ['As the shoulder press'], execution: ['Dip and drive as in the push press', 'Press yourself under the bar, receive in a partial squat with arms locked'],
    finish: ['Stand up fully with the bar locked overhead before lowering it'],
    faults: [{ fault: 'Hips don\'t fully extend in the drive', fix: 'Finish the drive before going under' }, { fault: 'Soft overhead position on the catch', fix: 'Lock the arms and push up into the bar' }, { fault: 'Lowering before standing up', fix: 'Stand all the way, then lower' }] },
  { key: 'deadlift', title: 'Deadlift', pages: '194–200',
    setup: ['Hip- to shoulder-width stance, hands just outside the hips', 'Shoulders over or slightly in front of the bar', 'Arms straight, bar touching the shins, eyes on the horizon'], execution: ['Lumbar curve held', 'Hips and shoulders rise together until the bar passes the knee, then the hips open', 'Bar stays over the middle of the foot, heels down'],
    finish: ['Full hip and knee extension'],
    faults: [{ fault: 'Back rounds', fix: 'Chest up, set the lumbar curve before the pull' }, { fault: 'Hips rise first (stiff-legged)', fix: 'Push the floor away with the legs; hips and chest together' }, { fault: 'Bar drifts away from the legs', fix: 'Keep the bar in contact with the legs the whole way' }] },
  { key: 'sdhp', title: 'Sumo deadlift high pull', pages: '201–206',
    setup: ['Stance a little wider than the shoulders, knees over toes', 'Hands inside the legs, full grip, bar on the shins'], execution: ['Lumbar curve held; deadlift to extension', 'Hips extend fast, then the shoulders shrug, then the arms pull, elbows high'],
    finish: ['Bar just under the chin, elbows above the bar'],
    faults: [{ fault: 'Pulling early with the arms', fix: 'Hips and legs first; arms last' }, { fault: 'Wrong order on the way down', fix: 'Arms straighten before the hips bend' }] },
  { key: 'clean', title: 'Medicine-ball clean', pages: '207–217',
    setup: ['Shoulder-width stance, ball between the feet, palms on the ball', 'Shoulders over the ball, eyes on the horizon'], execution: ['Lumbar curve held; hips extend fast', 'Shrug, then pull under to the front rack'],
    finish: ['Receive in the bottom of the squat, then stand to full extension'],
    faults: [{ fault: 'No full hip extension', fix: 'Finish the jump before pulling under' }, { fault: 'Curling the ball', fix: 'Keep the arms long until the shrug' }, { fault: 'Receiving too high', fix: 'Pull under into a full squat' }] },
  { key: 'pull-up', title: 'Pull-up (kipping)', pages: '219–227',
    setup: ['Hands just outside the shoulders, hang with straight arms'], execution: ['Start the kip from the shoulders, not the legs', 'As the feet swing forward, push the bar down; chest up, eyes forward', 'Pull until the chin clears the bar; push away to start down'],
    finish: ['Return to full arm extension'],
    faults: [{ fault: 'Swing started by the legs', fix: 'Shoulders and hollow/arch drive the kip' }, { fault: 'Dropping straight down from the top', fix: 'Push away from the bar to follow the arc' }, { fault: 'Over-arching or over-swinging', fix: 'Keep the midline tight; smaller kip' }] },
  { key: 'thruster', title: 'Thruster', pages: '228–232',
    setup: ['Shoulder-width stance', 'Full grip, hands just outside the shoulders, bar in the front rack, elbows a little lower than in the front squat'], execution: ['Front squat below parallel, lumbar curve held, knees over toes, elbows off the knees', 'Hips and knees extend fast, then the arms press'],
    finish: ['Full hip, knee and arm extension, bar over mid-foot'],
    faults: [{ fault: 'Pressing before the hips extend', fix: 'Drive out of the squat first' }, { fault: 'Squatting before the bar is back in the rack', fix: 'Bring the bar to the shoulders, then descend' }] },
  { key: 'muscle-up', title: 'Muscle-up', pages: '233–243',
    setup: ['Rings about shoulder width, false grip, hang with straight arms'], execution: ['Pull the rings to the sternum while leaning back', 'Move the chest over the rings, hands and elbows close to the body'],
    finish: ['Press to full support above the rings'],
    faults: [{ fault: 'Losing the false grip', fix: 'Reset the grip; build false-grip hangs' }, { fault: 'Body too upright in the pull', fix: 'Lean back so the rings reach the sternum' }, { fault: 'Elbows flare', fix: 'Keep the rings close to the body through the transition' }] },
  { key: 'snatch', title: 'Snatch', pages: '244–255',
    setup: ['Hip-width stance, hook grip', 'Grip wide enough that the bar sits in the hip crease standing', 'Shoulders slightly in front of the bar, eyes on the horizon'], execution: ['Lumbar curve held; hips and shoulders rise together', 'Heels down until hips and knees extend; hips extend fast', 'Shrug, then pull under; receive at the bottom of an overhead squat'],
    finish: ['Stand to full extension with the bar overhead'],
    faults: [{ fault: 'No full hip extension', fix: 'Finish the jump before the pull under' }, { fault: 'Bar swings out around the body', fix: 'Elbows high and outside; bar close' }, { fault: 'Hips or shoulders rise first', fix: 'Hips and shoulders rise at the same rate off the floor' }] },
];
