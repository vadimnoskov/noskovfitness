/**
 * Benchmark library seed, from the NF-WODs sheet tabs (Girls, Hero, Misc WODs, ALL OPEN) and the coach's list.
 * Definitions come from the athletes' history when the workout exists there; the rest are written below in the
 * same text format as a BTWB export so the one parser reads both.
 * Retest intervals are policy defaults the coach can change per benchmark.
 */
export type BenchmarkCategory = 'girl' | 'hero' | 'open' | 'test' | 'lift';

export const RETEST_DAYS: Record<BenchmarkCategory, number> = { girl: 150, hero: 240, open: 730, test: 120, lift: 90 };

export const BENCHMARK_NAMES: Record<Exclude<BenchmarkCategory, 'open' | 'lift'>, string[]> = {
  girl: ['Angie', 'Barbara', 'Chelsea', 'Cindy', 'Diane', 'Elizabeth', 'Fran', 'Grace', 'Helen', 'Isabel', 'Jackie', 'Karen', 'Linda',
    'Mary', 'Nancy', 'Annie', 'Eva', 'Kelly', 'Lynne', 'Nicole', 'Christine', 'Gwen'],
  hero: ['JT', 'Michael', 'Murph', 'Daniel', 'Josh', 'Jason', 'Badger', 'Joshie', 'Nate', 'Randy', 'Tommy V', 'Griff', 'Ryan', 'Erin',
    'Mr. Joshua', 'DT', 'Danny', 'Hansen', 'Tyler', 'Stephen', 'Garrett', 'War Frank', 'McGhee', 'Paul', 'Nutts'],
  test: ['Fight Gone Bad', 'Tabata This!', 'CrossFit Total', 'CrossFit Total II', 'GI Jane', 'Tabata Something Else', 'Tabata Squat',
    'Bear Complex', 'Filthy Fifty', '100 Burpees', 'Rhiannon', 'Nasty Girls', 'Karabel', 'Flight Simulator', 'Baseline',
    'Row 2 km TT', 'Row 500 m TT', 'Row 1000 m TT', 'Row 5 km TT', 'Run 5 km TT', 'Run 1 mi TT', 'Run 400 m TT', 'Strict Pull-ups : Max Set', 'Push-ups : Max Set'],
};

/** Other spellings found in the exports → benchmark name. */
export const BENCHMARK_ALIASES: Record<string, string> = {
  'j.t.': 'JT', 'g.i. jane': 'GI Jane', 'burpees : 100 reps for time': '100 Burpees', 'tabata smth else': 'Tabata Something Else',
  '"tabata" - air squats : 8 x 20 secs / 10 secs': 'Tabata Squat', 'bear complex : 7-7-7-7-7': 'Bear Complex', 'the bear complex': 'Bear Complex',
  'bear complexes': 'Bear Complex', 'row 2k': 'Row 2 km TT', 'run 5k': 'Run 5 km TT',
};

/** Lift tests: "<Lift> : 1 Rep Max" (and 3/5 rep max) are benchmarks for these lifts. */
export const BENCHMARK_LIFTS = ['Back Squat', 'Front Squat', 'Overhead Squat', 'Deadlift', 'Shoulder Press', 'Push Press', 'Push Jerk', 'Bench Press',
  'Clean', 'Power Clean', 'Squat Clean', 'Clean & Jerk', 'Snatch', 'Power Snatch', 'Squat Snatch'];

/** Standard Rx loads (lb) for women where the export only has the men's load. Movement family → load. */
export const FEMALE_RX: Record<string, Record<string, number>> = {
  Fran: { thruster: 65 }, Grace: { 'clean-and-jerk': 95 }, Isabel: { snatch: 95 }, Diane: { deadlift: 155 }, Elizabeth: { clean: 95 },
  Helen: { 'kb-swing': 35 }, Jackie: { thruster: 35 }, Karen: { 'wall-ball': 14 }, Nancy: { 'overhead-squat': 65 }, Kelly: { 'wall-ball': 14 },
  Eva: { 'kb-swing': 53 }, Gwen: {}, DT: { deadlift: 105, clean: 105, jerk: 105 }, Randy: { snatch: 55 }, Murph: {}, Daniel: { thruster: 65 },
  Josh: { 'overhead-squat': 65 }, Badger: { clean: 65 }, Nate: { 'kb-swing': 53 }, 'Tommy V': { thruster: 75 }, Hansen: { 'kb-swing': 53 },
  'Mr. Joshua': { deadlift: 175 }, McGhee: { deadlift: 185 }, Stephen: { deadlift: 65 }, Christine: {}, 'Filthy Fifty': { 'kb-swing': 26, 'push-press': 35, 'wall-ball': 14 },
  'Nasty Girls': { clean: 95 }, 'Fight Gone Bad': { 'wall-ball': 14, sdhp: 55, 'push-press': 55 },
};

/** Benchmarks not present in the history, written as export-style rows. */
export const MISSING_DEFINITIONS: { name: string; description: string; result: string }[] = [
  { name: 'Mary', description: '20:00 AMRAP:\n5 Handstand Push-ups\n10 Pistols\n15 Pull-ups', result: '0 rounds' },
  { name: 'Jason', description: '100 Air Squats\n5 Muscle-ups\n75 Air Squats\n10 Muscle-ups\n50 Air Squats\n15 Muscle-ups\n25 Air Squats\n20 Muscle-ups', result: '0 mins' },
  { name: 'Joshie', description: '3 rounds of:\n21 Single Arm Dumbbell Squat Snatches, 40 lbs\n21 Strict Pull-ups\n21 Single Arm Dumbbell Squat Snatches, 40 lbs\n21 Strict Pull-ups', result: '0 mins' },
  { name: 'Tommy V', description: '21 Thrusters 115 lbs\n12 Rope Climbs, 15 ft\n15 Thrusters 115 lbs\n9 Rope Climbs, 15 ft\n9 Thrusters 115 lbs\n6 Rope Climbs, 15 ft', result: '0 mins' },
  { name: 'Ryan', description: '5 rounds of:\n7 Muscle-ups\n21 Burpee to Targets', result: '0 mins' },
  { name: 'Hansen', description: '5 rounds of:\n30 Kettlebell Swings, 32 kg\n30 Burpees\n30 GHD Sit-ups', result: '0 mins' },
  { name: 'Stephen', description: '30-25-20-15-10-5 reps of:\nGHD Sit-up\nBack Extension\nKnees-to-elbows\nRomanian Deadlift, 95 lbs', result: '0 mins' },
  { name: 'Garrett', description: '3 rounds of:\n75 Air Squats\n25 Ring Handstand Push-ups\n25 Strict Pull-ups', result: '0 mins' },
  { name: 'War Frank', description: '3 rounds of:\n25 Muscle-ups\n100 Air Squats\n35 GHD Sit-ups', result: '0 mins' },
  { name: 'Paul', description: '5 rounds of:\n50 Double Unders\n35 Knees-to-elbows\nBarbell Overhead Walk, 20 yd, 185 lbs', result: '0 mins' },
  { name: 'CrossFit Total II', description: 'Sets\n1 Clean\n1 Bench Press\n1 Overhead Squat', result: '0 lbs' },
];

export function normalizeWorkoutName(n: string): string {
  return n.toLowerCase().replace(/[“”]/g, '"').replace(/\s+-\s+crossfit games open$/, '').replace(/ rx'd$/, '').replace(/^"([^"]+)"$/, '$1').replace(/\s+/g, ' ').trim();
}

const BY_NORMAL = new Map<string, { name: string; category: BenchmarkCategory }>();
for (const [cat, names] of Object.entries(BENCHMARK_NAMES)) for (const n of names) BY_NORMAL.set(normalizeWorkoutName(n), { name: n, category: cat as BenchmarkCategory });
for (const [alias, n] of Object.entries(BENCHMARK_ALIASES)) { const b = BY_NORMAL.get(normalizeWorkoutName(n)); if (b) BY_NORMAL.set(normalizeWorkoutName(alias), b); }

/** Benchmark identity for a workout name, if it is one. */
export function benchmarkOf(workoutName: string): { name: string; category: BenchmarkCategory; retestEveryDays: number } | undefined {
  const n = normalizeWorkoutName(workoutName);
  const hit = BY_NORMAL.get(n);
  if (hit) return { ...hit, retestEveryDays: RETEST_DAYS[hit.category] };
  const open = workoutName.match(/^(\d\d\.\d[A-Z]?(?: \/ \d\d\.\d[A-Z]?)*)\b.*crossfit games open/i);
  if (open) return { name: `Open ${open[1]}`, category: 'open', retestEveryDays: RETEST_DAYS.open };
  const lift = workoutName.match(/^(.+?) : (1|3|5) Rep Max$/);
  if (lift && BENCHMARK_LIFTS.includes(lift[1]!)) return { name: `${lift[1]} ${lift[2]}RM`, category: 'lift', retestEveryDays: RETEST_DAYS.lift };
  return undefined;
}
