/**
 * Reader for the published daily-workout archive (one row per day, markdown-ish text, 2001–2025).
 *
 * Keeps the workout only: the prescription (header, movement lines, loads). Coaching prose (stimulus, scaling,
 * intermediate/beginner options, cues, links, athlete results) is dropped: we write our own words.
 * Titles are cleaned of brand names. Anything that doesn't read cleanly is flagged, never guessed.
 */
import type { Workout, MovementPrescription, Structure, ScoreType, Units } from '../model/types';
import { parseLine } from './btwb';
import { resolveSequence, keyOf } from '../movements/resolver';
import { FAMILY_BY_ID, type Implement } from '../movements/catalog';
import { benchmarkOf } from '../workouts/benchmarks';

export interface PublishedRow { title: string; wodRaw: string; url: string; cleanID: string }

export interface PublishedWorkout {
  date: string; // yyyy-mm-dd
  restDay: boolean;
  name?: string;
  open?: string; // e.g. "14.5"
  workout?: Workout;
  /** The cleaned prescription text (no coaching prose), kept for reference and review. */
  text: string;
  /** Dates of earlier days this one says it repeats ("Compare to …"). */
  compareTo: string[];
  flags: string[];
  clean: boolean;
  /** Lines no movement was found in (for the quality report). */
  unknown?: string[];
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  'twenty-one': 21, thirty: 30, forty: 40, fifty: 50, hundred: 100,
};
const words2num = (s: string) => s.replace(/\b(twenty-one|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred)\b/gi, (w) => String(NUM_WORDS[w.toLowerCase()]));

const isoOf = (yymmdd: string) => {
  const yy = Number(yymmdd.slice(0, 2));
  return `${yy > 50 ? 19 : 20}${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
};

/** Brand names stay out of anything we show. */
export function cleanTitle(name: string): string {
  return name.replace(/\bCrossFit\s+Games\s+Open\b/gi, 'Open').replace(/\bCrossFit\s+Games\b/gi, 'Games').replace(/\bCrossFit\b\s*/gi, '').replace(/\s{2,}/g, ' ').replace(/^[\s:–-]+|[\s:–-]+$/g, '').trim();
}

function stripMarkup(s: string): string {
  return s
    .replace(/<a [^>]*>(.*?)<\/a>/gi, '$1').replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__/g, '').replace(/[​ ]/g, ' ')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#8220;|&#8221;|&quot;/g, '"').replace(/&#8217;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ');
}

// Where the prescription ends: everything after is commentary, coaching or results.
const END = /^(post\b|compare to|scroll for|_{3,}|-{3,}|stimulus|scaling|intermediate option|beginner option|resources|coaching cues|find a gym|scaled option|scaling option|related|watch|video|read|featured|demo|in memory|we |this workout|today'?s workout|note:|notes:)/i;
const LOAD_LINE = /^(♀|♂)|♀.*♂|♂.*♀|^_?(men|women)\b.*\d/i;
const IGNORE_LINE = /^(rest\b|resting\b|then\b|followed by|and then|practice\b|warm|cool|stretch|choose\b|score\b|time cap|tie[- ]?break|each round|start\b|begin\b|switch\b|the clock|or$|etc|scroll\b|guest programmer|meet guest|_|\*|for a downloadable|use as many|add your|set up|try to|touch and go|in this workout|the tabata|tabata score|hero workout of your choice|if you|athletes|note)/i;

type Header = { structure: Structure; scoreType: ScoreType; movementFromHeader?: string };

function readHeader(lines: string[]): { h?: Header; used: number } {
  const first = words2num(lines[0] ?? '').toLowerCase().replace(/-\s*and\s*/g, '-').replace(/(\d),?\s+and\s*(\d)/g, '$1-$2').replace(/,\s*(\d)/g, ' $1');
  const both = words2num(lines.slice(0, 2).join(' ')).toLowerCase().replace(/-\s*and\s*/g, '-');
  let m: RegExpMatchArray | null;
  // "With a pair of dumbbells, 5 rounds for time of:" → the header after the setup phrase.
  if (/^with [^,]+, /i.test(lines[0] ?? '')) {
    const inner = readHeader([lines[0]!.replace(/^with [^,]+,\s*/i, ''), ...lines.slice(1)]);
    if (inner.h) return inner;
  }
  // "Back squat, 1 rep" (a set of max lifts, like the Total)
  if (/^[a-z][a-z -]+, 1 rep\.?$/i.test(lines[0] ?? '')) return { h: { structure: { kind: 'max', what: 'load' }, scoreType: 'load' }, used: 0 };
  // "30 clean and jerks for time", "135 pound squat clean and jerk, 30 reps"
  if ((m = (lines[0] ?? '').match(/^(\d+ .+?),? for time\.?:?$/i))) return { h: { structure: { kind: 'for-time' }, scoreType: 'time', movementFromHeader: m[1]! }, used: 1 };
  // "Thruster 3-2-2-2-1-1-1 reps", "Back squat 5-5-5-5-5 reps"
  if ((m = (lines[0] ?? '').match(/^(.+?)\s*,?\s+(\d+(?:\s*-\s*\d+){2,})\s*reps?\b/i)) && !/rounds?|for time/i.test(m[1]!)) {
    return { h: { structure: { kind: 'sets', scheme: m[2]!.split('-').map((x) => Number(x.trim())) }, scoreType: 'load', movementFromHeader: m[1]!.trim() }, used: 1 };
  }
  if ((m = first.match(/^(.+?),?\s+(\d+)\s*(?:rep max|rm)\b/i)) || (m = first.match(/^(?:find your |establish a )?(\d+)[- ]rep(?:etition)? max(?:imum)? (?:of |in )?(?:the )?(.+)/i))) {
    const mv = /^\d+$/.test(m[1]!) ? m[2]! : m[1]!;
    return { h: { structure: { kind: 'max', what: 'load' }, scoreType: 'load', movementFromHeader: mv.trim() }, used: 1 };
  }
  if ((m = both.match(/(?:as many|as much|max)(?: rounds| reps| work| calories)?(?: and reps)?(?: as possible| as you can)? in (\d+) min|as many (?:rounds|reps)(?: and reps)? in (\d+) minutes(?: as possible| as you can)?|in (\d+) minutes as possible|amrap(?: in)? (\d+)|(\d+)[- ]minute amrap/))) {
    const min = Number(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5]);
    return { h: { structure: { kind: 'amrap', minutes: min }, scoreType: /as many reps/.test(both) ? 'reps' : 'rounds-reps' }, used: /of:?\s*$|:$/.test(lines[0]!.trim()) || !/as many|amrap/.test(lines[1]?.toLowerCase() ?? '') ? 1 : 2 };
  }
  if ((m = first.match(/^every (\d+) minutes? for (\d+) (?:rounds|sets)/))) {
    return { h: { structure: { kind: 'emom', minutes: Number(m[1]) * Number(m[2]), everySec: Number(m[1]) * 60 }, scoreType: 'none' }, used: 1 };
  }
  if ((m = first.match(/^(\d+) (\d+)[- ]minute rounds/))) {
    return { h: { structure: { kind: 'intervals', rounds: Number(m[1]), workSec: Number(m[2]) * 60, restSec: 0, scored: 'reps' }, scoreType: 'reps' }, used: 1 };
  }
  if ((m = first.match(/^for (\d+) minutes(?: complete)?:?$/))) return { h: { structure: { kind: 'amrap', minutes: Number(m[1]) }, scoreType: 'reps' }, used: 1 };
  if ((m = first.match(/^every minute for (\d+) minutes/))) return { h: { structure: { kind: 'emom', minutes: Number(m[1]) }, scoreType: 'none' }, used: 1 };
  if (/^for (?:max )?load:?$/.test(first)) return { h: { structure: { kind: 'max', what: 'load' }, scoreType: 'load' }, used: 1 };
  if (/^for (?:total |max )?reps:?$/.test(first)) return { h: { structure: { kind: 'max', what: 'reps' }, scoreType: 'reps' }, used: 1 };
  if ((m = first.match(/^(?:on a (\d+)[- ]minute clock|in front of a clock set for (\d+) minutes|in (\d+) minutes),?(?: complete)?:?/))) {
    const cap = Number(m[1] ?? m[2] ?? m[3]);
    const rest = lines[0]!.replace(/^[^,:]*[,:]\s*(complete:?)?\s*/i, '');
    const inner = rest && rest !== lines[0] ? readHeader([rest, ...lines.slice(1)]) : { used: 0 } as { h?: Header; used: number };
    if (inner.h && inner.h.structure.kind === 'for-time') return { h: { ...inner.h, structure: { ...inner.h.structure, capMin: cap } }, used: 1 };
    return { h: { structure: { kind: 'amrap', minutes: cap }, scoreType: 'reps' }, used: 1 };
  }
  if ((m = both.match(/every minute on the minute for (\d+) minutes|emom (?:for )?(\d+)|every (\d+) minutes? for (\d+) minutes/))) {
    const minutes = Number(m[1] ?? m[2] ?? m[4]);
    return { h: { structure: { kind: 'emom', minutes, ...(m[3] ? { everySec: Number(m[3]) * 60 } : {}) }, scoreType: 'none' }, used: 1 };
  }
  if (/tabata/.test(first)) return { h: { structure: { kind: 'tabata' }, scoreType: 'reps' }, used: /^tabata [a-z]/.test(first) ? 0 : 1 };
  if ((m = first.match(/^(\d+) rounds?,? (?:each )?for time/)) && /each|rest/.test(both)) {
    const rest = words2num(lines.join(' ')).toLowerCase().match(/rest(?:ing)? (\d+) (minutes?|seconds?)/);
    return { h: { structure: { kind: 'intervals', rounds: Number(m[1]), restSec: rest ? Number(rest[1]) * (rest[2]!.startsWith('min') ? 60 : 1) : 0, scored: 'time' }, scoreType: 'time' }, used: 1 };
  }
  // "21-15-9 reps for time of", "30-25-20-15-10-5 rep rounds of", "3 rounds, 9-6-3 reps"
  if ((m = first.match(/(\d+(?:\s*-\s*\d+)+)\s*reps?\b/))) {
    return { h: { structure: { kind: 'for-time', scheme: m[1]!.split('-').map((x) => Number(x.trim())) }, scoreType: 'time' }, used: 1 };
  }
  if ((m = first.match(/^(?:complete |perform )?(\d+)(?:-\d+)? rounds?(?: of this circuit)?(?: for time)?(?: of)?:?/))) return { h: { structure: { kind: 'for-time', rounds: Number(m[1]) }, scoreType: 'time' }, used: 1 };
  if (/^for time:?$|^for time of:?$|^for time\b/.test(first)) return { h: { structure: { kind: 'for-time' }, scoreType: 'time' }, used: 1 };
  if (/^(max(?:imum)? reps|max rep|as many reps)/.test(first)) return { h: { structure: { kind: 'max', what: 'reps' }, scoreType: 'reps' }, used: 1 };
  return { used: 0 };
}

/** Turn one published movement line into the "21 Thrusters, 95 lbs" style the line parser reads. */
export function normalizeLine(line: string): string {
  let s = words2num(line).replace(/\(([^)]*)\)/g, (_, inner: string) => (/\d+\s*\/\s*\d+/.test(inner) ? ` ${inner} ` : ' ')).replace(/\s+/g, ' ').trim();
  s = s.replace(/(\d),(\d{3})\b/g, '$1$2').replace(/\.$/, '').replace(/\b(\d+) 1\/2\b/g, '$1.5');
  // "1.5 pood Kettlebell X 21 swings" → "21 Kettlebell swings, 1.5 pood"
  s = s.replace(/^(\d+(?:\.\d+)?\s*(?:pood|pounds?|lbs?|kg)\.?\s+)?(.+?)\s+x\s+(\d+)\s+(.+)$/i, (all, load, a, n, b) => (/^\d/.test(a) && !load ? all : `${n} ${a} ${b}${load ? `, ${load.trim()}` : ''}`));
  // "15-ft. rope climbs, 3 ascents" → "3 Rope Climbs, 15 ft"
  s = s.replace(/^(\d+)[- ]?(?:ft|feet|foot)\.?\s+(legless )?rope climbs?,?\s*(\d+)\s*(?:ascents?|reps?)?$/i, '$3 $2Rope Climbs, $1 ft');
  // "20/30 Echo bike calories", "500/400-meter row": a women's/men's pair, the men's (larger) is the standard
  s = s.replace(/^(\d+)\/(\d+)(?=[- ]?(?:meters?\b|m\b|cal|\s))/i, (_, a, b) => String(Math.max(Number(a), Number(b))));
  s = s.replace(/^(\d+)\s+(.+?)\s+cal(?:orie)?s?\.?$/i, '$1 $2 Calories');
  s = s.replace(/\bbody[- ]?weight\b/gi, 'bodyweight');
  let m: RegExpMatchArray | null;
  // "1 mile run", "Run 1 mile"
  s = s.replace(/\b(\d+(?:\.\d+)?)[- ]?miles?\b/gi, (_, n) => `${Math.round(Number(n) * 1609)} meters`);
  s = s.replace(/\b(\d+(?:\.\d+)?)[- ]?k\b(?= (run|row))/gi, (_, n) => `${Number(n) * 1000} meters`);
  s = s.replace(/^(run|row|swim|ski|bike)\s+(\d+(?:\.\d+)?)\s*k\b/i, (_, a, n) => `${a} ${Number(n) * 1000} meters`);
  s = s.replace(/\b(\d+)\/\d+(?=[- ]?(?:meter|m\b|cal))/gi, '$1'); // "500/400-meter row", "21/15-calorie bike": the first number is the men's
  s = s.replace(/wall[- ]?ball(?: shot)?s?\b/gi, 'Wall Balls').replace(/\b(?:one|single|1)[- ]legged squats?\b|\bsingle[- ]leg squats?\b/gi, 'Pistols');
  s = s.replace(/\b(\d+)[- ]?(?:ft|feet|foot)\.?\s+(walking lunges?|handstand walk|overhead walking lunges?|bear crawl|farmer'?s? (?:carry|walk))/i, (_, n, mv) => `${mv}, ${Math.round(Number(n) * 0.3048)} m`);
  s = s.replace(/\b(push|bench|shoulder|strict|sots|floor)-press/gi, '$1 press').replace(/\brope ascents?\b/gi, 'Rope Climbs');
  s = s.replace(/^(.+?)\s+(\d+)\s*cal(?:orie)?s?\.?$/i, '$2-calorie $1').replace(/^(row|bike|ski|echo bike|assault bike)\s+for\s+/i, '$1 ');
  // "400-meter run", "100-meter sprint", "500-meter row"
  if ((m = s.match(/^(\d+)[- ]?(?:meters?|m)\s+(run|sprint|row|swim|bike|ski|farmer'?s carry|walking lunge|.+?)$/i))) return `${/sprint/i.test(m[2]!) ? 'Run' : m[2]}, ${m[1]} m`;
  // "Run 400 meters", "Row 500 meters"
  if ((m = s.match(/^(run|row|swim|bike|ski|sprint|.+?)\s+(\d+)\s*(?:meters?|m)\b(.*)$/i)) && !/^\d/.test(m[1]!)) return `${/sprint/i.test(m[1]!) ? 'Run' : m[1]}, ${m[2]} m${m[3]?.trim() ? ` ${m[3].trim()}` : ''}`;
  // "25-calorie row", "50 calorie Echo bike"
  if ((m = s.match(/^(\d+)[- ]?cal(?:orie)?s?\.?\b\s*(.+)$/i))) return `${m[1]} ${m[2]} Calories`;
  // "1-minute handstand hold", "30-second plank"
  if ((m = s.match(/^(\d+)[- ]?(minute|second)s?\s+(.+)$/i))) return `${m[3]}, ${Number(m[1]) * (m[2]!.toLowerCase() === 'minute' ? 60 : 1)} secs`;
  // "135 pound Deadlift, 15 reps" / "135-lb. deadlifts" / "165 pound barbell Thrusters"
  if ((m = s.match(/^(\d+(?:\.\d+)?)[- ]?(pound|lb|lbs|kg|pood)\.?s?\s+(?:barbell |dumbbell |db |kettlebell |kb )?(.+?)(?:,\s*(\d+)\s*reps?)?$/i))) {
    const unit = /kg|pood/i.test(m[2]!) ? (/pood/i.test(m[2]!) ? `${Number(m[1]) * 16} kg` : `${m[1]} kg`) : `${m[1]} lbs`;
    return `${m[4] ? `${m[4]} ` : ''}${m[3]}, ${unit}`;
  }
  // "21 thrusters 95/65 lb" or "21 thrusters (95/65)"
  if ((m = s.match(/^(.*?)\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*(lb|lbs|pounds?|kg)?\.?\s*(.*)$/i)) && m[1]) {
    const unit = /kg/i.test(m[4] ?? '') ? 'kg' : 'lbs';
    return `${m[1].trim()}${m[5] ? ` ${m[5]}` : ''}, ${m[2]} ${unit} /F${m[3]}`;
  }
  // "21 thrusters, 95 pounds", "21 deadlifts @ 225 lb"
  s = s.replace(/\s*[@,]?\s*(\d+(?:\.\d+)?)[- ]?(pounds?|lbs?|lb\.)\b\.?/i, ', $1 lbs').replace(/\s*[@,]?\s*(\d+(?:\.\d+)?)[- ]?kg\b\.?/i, ', $1 kg');
  // "15 reps of X" → "15 X"
  s = s.replace(/^(\d+) reps? of /i, '$1 ');
  return s;
}

type LoadPart = { value: number; unit: Units | 'in' | 'ft'; noun: string };
function readLoadLine(line: string): { female: LoadPart[]; male: LoadPart[] } {
  const parts = (txt: string): LoadPart[] => [...words2num(txt).matchAll(/(\d+(?:\.\d+)?)[- ]?(lbs?|pounds?|kg|pood|in(?:ch(?:es)?)?|"|ft|foot|feet)\.?\s*([a-z][a-z.'-]*(?: [a-z][a-z-]*){0,2})?/gi)]
    .map((m) => {
      const u = m[2]!.toLowerCase();
      const unit: LoadPart['unit'] = /kg|pood/.test(u) ? 'kg' : /^in|"/.test(u) ? 'in' : /^f/.test(u) ? 'ft' : 'lb';
      return { value: /pood/.test(u) ? Number(m[1]) * 16 : Number(m[1]), unit, noun: (m[3] ?? '').toLowerCase() };
    });
  const fIdx = line.search(/♀|\bwomen\b/i), mIdx = line.search(/♂|\bmen\b/i);
  if (fIdx < 0 && mIdx < 0) return { female: [], male: [] };
  if (fIdx >= 0 && mIdx >= 0) {
    const [a, b] = fIdx < mIdx ? [line.slice(fIdx, mIdx), line.slice(mIdx)] : [line.slice(fIdx), line.slice(mIdx, fIdx)];
    return { female: parts(a), male: parts(b) };
  }
  return fIdx >= 0 ? { female: parts(line.slice(fIdx)), male: [] } : { female: [], male: parts(line.slice(mIdx)) };
}

const NOUN_IMPLEMENT: [RegExp, Implement | 'box' | 'target'][] = [
  [/\bdbs?\b|dumbbell/, 'dumbbell'], [/\bkb|kettlebell/, 'kettlebell'], [/medicine|med[- ]?ball|ball\b/, 'medball'], [/target/, 'target'],
  [/box/, 'box'], [/sandbag/, 'sandbag'], [/plate/, 'plate'], [/barbell|bar\b/, 'barbell'], [/vest/, 'none'],
];

/** Attach ♀/♂ load lines to the movements they belong to. */
function applyLoadLines(mv: MovementPrescription[], lines: string[], flags: string[]) {
  const implOf = (m: MovementPrescription) => m.movement.implement ?? FAMILY_BY_ID[m.movement.family]?.implements[0];
  for (const line of lines) {
    const { female, male } = readLoadLine(line);
    for (const [sex, list] of [['female', female], ['male', male]] as const) {
      for (const p of list) {
        const kind = NOUN_IMPLEMENT.find(([rx]) => rx.test(p.noun))?.[1];
        if (p.unit === 'in' || p.unit === 'ft') {
          const inches = p.unit === 'ft' ? p.value * 12 : p.value;
          const target = mv.filter((m) => (kind === 'target' ? m.movement.family === 'wall-ball' : kind === 'box' ? /box|step-up/.test(m.movement.family + (m.movement.variant ?? '')) : true));
          for (const m of target.length ? target : []) m.heightIn = { ...m.heightIn, [sex]: inches };
          continue;
        }
        const loadable = mv.filter((m) => {
          const imp = implOf(m);
          if (kind && kind !== 'target' && kind !== 'box') return imp === kind;
          return imp && !['bodyweight', 'none', 'box', 'rings', 'bar', 'rope', 'rower', 'jump-rope', 'air-bike', 'bike-erg', 'ski-erg', 'wall', 'ghd', 'parallettes', 'p-bars', 'sled'].includes(imp);
        });
        if (!loadable.length) { flags.push(`load "${p.value} ${p.unit} ${p.noun}" matched no movement`); continue; }
        for (const m of loadable) m.load = { ...(m.load ?? { unit: p.unit as Units }), unit: (m.load?.unit ?? p.unit) as Units, [sex]: p.value };
      }
    }
  }
}

export function parsePublishedRow(row: PublishedRow): PublishedWorkout {
  const date = isoOf(row.cleanID.slice(2));
  const raw = row.wodRaw ?? '';
  const compareTo = [...new Set([...raw.matchAll(/compare to[^\n]*/gi)].flatMap((m) => [...m[0].matchAll(/\b(\d{6})\b/g)].map((x) => isoOf(x[1]!))))];
  const restDay = /^\s*\**\s*rest day/i.test(raw);
  const base: PublishedWorkout = { date, restDay, text: '', compareTo, flags: [], clean: false };
  if (restDay) return base;

  // Name: a short bold or quoted first line ("**Sham**", '"Stephen"', "**[CrossFit Total](…)**").
  const firstRaw = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const nameMatch = firstRaw.match(/^"?\*\*"?(.+?)"?\*\*"?\s*$/) ?? firstRaw.match(/^"([^"]{2,40})"\s*$/);
  let name = nameMatch ? cleanTitle(stripMarkup(nameMatch[1]!).replace(/^"|"$/g, '')) : undefined;

  const all = stripMarkup(raw).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (nameMatch) all.shift();
  const end = all.findIndex((l) => END.test(l));
  const body = (end >= 0 ? all.slice(0, end) : all).filter((l) => !/^\|/.test(l));
  const text = [name, ...body].filter(Boolean).join('\n');
  const flags: string[] = [];

  const open = (`${row.title} ${name ?? ''} ${body.slice(0, 2).join(' ')}`.match(/\bopen\b[^\n]*?\b(1[1-9]|2[0-6])\.(\d)\b|\b(1[1-9]|2[0-6])\.(\d)\b[^\n]*\bopen\b/i));
  // Also "Workout 14.1" posted in Feb–Apr of 2014: the label's year matches the posting year.
  const yy = date.slice(2, 4), month = Number(date.slice(5, 7));
  const label = !open && month >= 2 && month <= 4 ? `${row.title} ${name ?? ''} ${body.slice(0, 3).join(' ')}`.match(new RegExp(`(?:workout|event|^|\\s)${yy}\\.(\\d)\\b`, 'i')) : null;
  const openId = open ? `${open[1] ?? open[3]}.${open[2] ?? open[4]}` : label ? `${yy}.${label[1]}` : undefined;
  if (openId) name = `Open ${openId}`;

  // A plain title line before the header ("Mary", '"Michael"', "Workout 14.5", "Regional Event 4").
  while (body.length > 1 && IGNORE_LINE.test(body[0]!) && !/^rest\b/i.test(body[0]!)) body.shift(); // "Guest programmer – …"
  const titleLike = (l: string) => /^"[^"]{2,40}"$/.test(l) || (/^[A-Za-z][^:,]{0,38}$/.test(l) && l.split(' ').length <= 5 && !parseLine(normalizeLine(l), 'male').length)
    || /^\d{4} .*(event|workout|regional|qualifier|games)|^(open |)workout \d+\.\d|event \d+$|quarterfinal|semifinal/i.test(l);
  if (body.length > 1 && titleLike(body[0]!) && !readHeader([body[0]!]).h && readHeader(body.slice(1)).h) {
    const t = cleanTitle(body.shift()!.replace(/^"|"$/g, ''));
    if (!name && t) name = t;
  }
  const loadLines = body.filter((l) => LOAD_LINE.test(l));
  let lines = body.filter((l) => !LOAD_LINE.test(l));
  if (!lines.length) return { ...base, name, text, flags: ['no prescription found'] };

  const { h, used } = readHeader(lines);
  // No header is fine for a single effort ("Run 5,000 meters", "Deadlift 1-1-1"); flagged once we know there is more than one movement.
  const header = h ?? { structure: { kind: 'for-time' } as Structure, scoreType: 'time' as ScoreType };
  lines = lines.slice(used);
  if (header.movementFromHeader) lines = [header.movementFromHeader, ...lines];

  // A second header further down means a multi-part day (e.g. strength, then a metcon).
  if (lines.some((l, i) => i > 0 && readHeader([l]).h && !/^\d/.test(l.replace(/^(\d+(?:-\d+)+)/, '')) && readHeader([l]).h?.structure.kind !== 'sets') && h) flags.push('multi-part day');

  const movements: MovementPrescription[] = [];
  const unknown: string[] = [];
  for (const l of lines) {
    if (IGNORE_LINE.test(l) || /:$/.test(l) && !/\d/.test(l)) continue;
    const n = normalizeLine(l);
    const fem = n.match(/ \/F(\d+(?:\.\d+)?)$/);
    const parsed = parseLine(n.replace(/ \/F\d+(?:\.\d+)?$/, ''), 'male');
    if (fem) for (const p of parsed) if (p.load) p.load = { ...p.load, female: Number(fem[1]) };
    if (!parsed.length) {
      if (l.split(/\s+/).length > 7 || /^[a-z]/.test(l) && /\.$/.test(l)) continue; // a sentence: coaching note, not a movement
      if (/\brest\b|^repeat|^part \d|^round \d|^\d+(?:[-/]\d+)+$|^(minutes?|seconds?) \d/i.test(l)) continue; // rest, repeat, set markers
      const name = n.replace(/^\d+\s+/, '').split(',')[0]!;
      if (resolveSequence(name).every((r) => r.review === 'ignored')) continue;
      unknown.push(l);
      continue;
    }
    movements.push(...parsed);
  }
  if (!h && movements.length > 1) flags.push('format not recognized');
  if (unknown.length) flags.push(`not understood: ${unknown.slice(0, 3).map((u) => `"${u.slice(0, 50)}"`).join(', ')}`);
  applyLoadLines(movements, loadLines, flags);
  if (!movements.length) flags.push('no movements recognized');
  if (header.structure.kind === 'amrap' && !header.structure.minutes) flags.push('AMRAP without a time');
  if (Number(date.slice(0, 4)) < 2005) flags.push('early format (2001–2004)');

  // Post line tells the score when the header didn't.
  const post = (end >= 0 ? all[end] : '') ?? '';
  let scoreType = header.scoreType;
  if (!h) scoreType = /post loads?/i.test(post) ? 'load' : /post rounds/i.test(post) ? 'rounds-reps' : /post (total )?reps/i.test(post) ? 'reps' : 'time';
  if (header.structure.kind === 'emom') scoreType = /post loads?/i.test(post) ? 'load' : /post (total )?reps/i.test(post) ? 'reps' : 'none';

  const bm = name ? benchmarkOf(name) : undefined;
  const workout: Workout = {
    id: '', name: bm?.name ?? name ?? undefined, structure: header.structure, movements, scoreType,
    source: 'published', originalText: text,
  };
  const clean = flags.length === 0;
  return { date, restDay, name: workout.name, ...(openId ? { open: openId } : {}), workout, text, compareTo, flags, clean, ...(unknown.length ? { unknown } : {}) };
}

/** Same workout regardless of its name or source: structure + movements + reps + the men's load. */
export function contentSignature(w: Workout): string {
  const lb = (m: Workout['movements'][number]) => (m.load?.male === undefined ? '' : Math.round(m.load.unit === 'kg' ? m.load.male * 2.20462 : m.load.male));
  const mv = w.movements.map((m) => `${keyOf(m.movement)}:${m.reps ?? ''}:${m.distanceM ?? ''}:${m.calories ?? ''}:${m.seconds ?? ''}:${lb(m)}`).join(',');
  const { capMin: _cap, ...s } = w.structure as Structure & { capMin?: number };
  return `c:${JSON.stringify(s)}|${mv}`;
}
