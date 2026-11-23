/**
 * AI-written coaching notes for Today: a short plan for one person on one program day, in a coach's voice.
 *
 * - Model: Claude Haiku 5.5 at low effort: the cheapest current model, and plenty for a few sentences of advice
 *   built on facts we compute ourselves (targets, checkpoints, warm-up sets). Roughly $0.0003 per note.
 * - Cached in `coaching_notes` per (day, athlete) with a hash of everything the note is based on, so it is written
 *   once and only rewritten when the workout, the person's version or their results change.
 * - Optional: with no ANTHROPIC_API_KEY, or if a call fails, Today keeps the rule-based notes. Never blocks logging.
 * - Privacy: the prompt carries age, sex, the workout and this person's own results and notes; never names or emails.
 */
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { sql } from '@workspace/fitness-db';
import { coachingNotes, nameOf, type PastResult, type Workout } from '@workspace/fitness-core';
import { logger } from '../lib/logger';

export const AI_MODEL = 'claude-haiku-5-5';

export interface AiNote { approach: string; tips: string[] }

export interface NoteInput {
  age?: number;
  sex: 'male' | 'female';
  units: 'lb' | 'kg';
  workoutText: string;
  /** The person's own version of the workout (their Rx), as text lines. */
  versionText: string;
  personalChanges: string[];
  capMin?: number;
  previous: (PastResult & { notes?: string | null })[];
  ruleNotes: string[];
  coachNote?: string;
}

const SYSTEM = `You are an experienced CrossFit coach writing a short plan for one athlete for today's workout.

Method: CrossFit only - constantly varied functional movement at relative intensity; mechanics, then consistency, then intensity. Do not bring in other training methods (no periodisation blocks, RPE/RIR schemes, zone training, bodybuilding splits or the like).

Write for the athlete directly ("you"). Be specific to this workout and this person's history:
- How to approach it: the intended stimulus, how to pace or break up the work, where people usually go wrong.
- Use the numbers you are given (last result, best, target, checkpoints, warm-up sets). Never invent results or numbers that are not supported by the facts.
- If they have done it before, refer to how it went and what to do differently. If not, give a sensible first-time approach.
- For a lift: how to build to the heavy sets and when to stop adding weight.
- For teenagers (under 18): prioritise good positions and full range of motion over load or speed, but keep the tone encouraging, not cautious.
- If there is a time cap, say how to use it.
- If the coach left a note, follow it.

Keep it short and plain: one or two sentences for the overall approach, then 2 to 4 short tips. No headings, no emoji, no medical advice.`;

const SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string', description: 'One or two sentences: the overall approach for today.' },
    tips: { type: 'array', items: { type: 'string' }, description: '2 to 4 short, specific tips.' },
  },
  required: ['approach', 'tips'],
  additionalProperties: false,
} as const;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function resultText(r: PastResult & { notes?: string | null }, units: string) {
  const s = r.score;
  const parts: string[] = [];
  if (s.timeSec && r.completed) parts.push(mmss(s.timeSec));
  if (!r.completed) parts.push(`hit the time cap with ${s.reps ?? '?'} reps`);
  else if (s.rounds !== undefined) parts.push(`${s.rounds} rounds + ${s.reps ?? 0} reps`);
  else if (s.reps !== undefined && !s.timeSec) parts.push(`${s.reps} reps`);
  if (s.loads?.length) parts.push(`sets ${s.loads.join(', ')} ${units}`);
  if (s.distanceM) parts.push(`${s.distanceM} m`);
  if (s.calories) parts.push(`${s.calories} cal`);
  return `${r.date}: ${parts.join(', ') || 'done'} (${r.rx ? 'Rx' : 'scaled'})${r.notes ? ` - their note: "${r.notes.slice(0, 200)}"` : ''}`;
}

/** The facts the note is written from, as the user message. */
export function promptFor(i: NoteInput): string {
  return [
    `Athlete: ${i.age ? `${i.age}-year-old ` : ''}${i.sex}, uses ${i.units}.`,
    `Workout as written:\n${i.workoutText}`,
    `Their version today (their Rx):\n${i.versionText}`,
    i.personalChanges.length ? `Adjusted for them: ${i.personalChanges.join('; ')}.` : '',
    i.capMin ? `Time cap: ${i.capMin} minutes.` : '',
    i.previous.length
      ? `Their earlier results on this workout (newest first):\n${i.previous.slice(0, 6).map((r) => `- ${resultText(r, i.units)}`).join('\n')}`
      : 'They have not done this workout before.',
    i.ruleNotes.length ? `Computed from their history (use these numbers, don't change them):\n${i.ruleNotes.map((n) => `- ${n}`).join('\n')}` : '',
    i.coachNote ? `Coach's note for today: ${i.coachNote}` : '',
  ].filter(Boolean).join('\n\n');
}

let client: Anthropic | null | undefined;
const getClient = () => {
  if (client === undefined) client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  return client;
};
export const aiEnabled = () => !!getClient();
/** Tests: swap the client. */
export function setClientForTests(c: Anthropic | null) { client = c; }

/** Ask Claude for a note. Returns undefined on any failure (the caller keeps the rule-based notes). */
export async function writeNote(input: NoteInput): Promise<AiNote | undefined> {
  const c = getClient();
  if (!c) return undefined;
  try {
    const res = await c.messages.create({
      model: AI_MODEL,
      max_tokens: 4000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: promptFor(input) }],
    }, { timeout: 30_000, maxRetries: 1 });
    if (res.stop_reason !== 'end_turn') { logger.warn({ stop: res.stop_reason }, 'coaching note not finished'); return undefined; }
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    if (!text) return undefined;
    const parsed = JSON.parse(text) as AiNote;
    if (typeof parsed.approach !== 'string' || !Array.isArray(parsed.tips)) return undefined;
    return { approach: parsed.approach.trim(), tips: parsed.tips.map((t) => String(t).trim()).filter(Boolean).slice(0, 5) };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) logger.error('ANTHROPIC_API_KEY was rejected; coaching notes fall back to the built-in ones');
    else if (err instanceof Anthropic.RateLimitError) logger.warn('Anthropic rate limit; coaching note skipped');
    else if (err instanceof Anthropic.APIError) logger.warn({ status: err.status }, 'Anthropic API error; coaching note skipped');
    else logger.warn({ err: (err as Error).message }, 'coaching note failed');
    return undefined;
  }
}

const versionLines = (w: Workout, sex: 'male' | 'female') => w.movements.map((m) => {
  const amount = m.reps ? `${m.reps} ` : m.distanceM ? `${m.distanceM} m ` : m.calories ? `${m.calories} cal ` : m.seconds ? `${m.seconds} s ` : '';
  const l = m.load && !m.load.percentOf ? (sex === 'female' ? m.load.female ?? m.load.male : m.load.male ?? m.load.female) : undefined;
  return `${amount}${nameOf(m.movement)}${l ? ` @ ${l} ${m.load!.unit}` : ''}`;
}).join('\n');

export interface NoteArgs {
  dayId: string; athleteId: string; birthYear?: number | null; date: string; sex: 'male' | 'female'; units: 'lb' | 'kg';
  workoutText: string; version: Workout; changes: string[]; previous: (PastResult & { notes?: string | null })[]; coachNote?: string | null;
}

/** Everything the note is written from. */
export function inputFor(args: NoteArgs): NoteInput {
  const capMin = args.version.structure.kind === 'for-time' ? args.version.structure.capMin : undefined;
  const input: NoteInput = {
    age: args.birthYear ? Number(args.date.slice(0, 4)) - args.birthYear : undefined,
    sex: args.sex, units: args.units, workoutText: args.workoutText, versionText: versionLines(args.version, args.sex),
    personalChanges: args.changes, capMin, previous: args.previous,
    ruleNotes: coachingNotes(args.version, args.previous), coachNote: args.coachNote ?? undefined,
  };
  return input;
}

/** The cached note for this person and day, writing it when missing or out of date. */
export async function noteFor(args: NoteArgs): Promise<{ note: AiNote | null; model?: string }> {
  if (!aiEnabled()) return { note: null };
  const input = inputFor(args);
  const hash = createHash('sha256').update(AI_MODEL + SYSTEM + promptFor(input)).digest('hex');
  const [cached] = await sql`SELECT note, model FROM coaching_notes WHERE day_id = ${args.dayId} AND athlete_id = ${args.athleteId} AND input_hash = ${hash}`;
  if (cached) return { note: cached.note as AiNote, model: cached.model as string };
  const note = await writeNote(input);
  if (!note) return { note: null };
  await sql`INSERT INTO coaching_notes (day_id, athlete_id, input_hash, note, model) VALUES (${args.dayId}, ${args.athleteId}, ${hash}, ${sql.json(note as never)}, ${AI_MODEL})
    ON CONFLICT (day_id, athlete_id) DO UPDATE SET input_hash = EXCLUDED.input_hash, note = EXCLUDED.note, model = EXCLUDED.model, created_at = now()`;
  return { note, model: AI_MODEL };
}
