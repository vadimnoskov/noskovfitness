/**
 * Ask Chalkboard: the coach asks in plain words; the answer comes only from the knowledge cards, the current
 * settings and the plan (last two weeks and next two weeks), with the cards it used. If nothing covers the
 * question, it says so instead of answering from general knowledge.
 *
 * - Model: Claude Sonnet 5.5 (answers must weigh several cards and sometimes disagree); a question costs about a cent.
 * - Privacy: the prompt carries cards, settings and the group plan (dates, workout names, tags, planner notes).
 *   No names, emails or personal results.
 */
import Anthropic from '@anthropic-ai/sdk';
import { sql, getPolicy } from '@workspace/fitness-db';
import { METHODOLOGY_CARDS, AREAS, mergeCards, settingAt, type MergedCard, type CardState } from '@workspace/fitness-core';
import { logger } from '../lib/logger';
import { InputError } from './logging';
import { GROUP_ID } from './data';

export const ASK_MODEL = 'claude-sonnet-5-5';
const MAX_CARDS = 24;

let client: Anthropic | null | undefined;
const getClient = () => {
  if (client === undefined) client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  return client;
};
/** Tests: swap the client. */
export function setAskClientForTests(c: Anthropic | null) { client = c; }

export interface AskAnswer { answer: string; cardIds: string[]; covered: boolean; gap: string }

const SYSTEM = `You are Chalkboard, the programming engine of a family CrossFit app, answering the coach's question about what you know and why the plan looks the way it does.

Rules:
- Answer ONLY from the knowledge cards, settings and plan data in the message. Never use outside knowledge, other training methods or general fitness advice. CrossFit methodology only.
- Cite every card you rely on by its id in cardIds. Mention sources by their plain names in the answer only when it helps (e.g. "the L2 guide says…").
- If the cards and data do not cover the question, say so plainly in one or two sentences, set covered to false, and put a short title for the missing knowledge in gap (e.g. "Pacing a 2K row"). Otherwise set covered to true and gap to "".
- If the coach's question assumes something the cards contradict, say so politely and explain with the cards. Do not just agree.
- Card statuses matter: "confirmed" is in use; "proposed" is waiting for the coach; "disputed" has open disagreement; "gap" is a known unknown. Say when an answer rests on a proposed or disputed card.
- For questions about a planned day, use the plan rows (date, workout, day type, the planner's notes) and the cards those notes point to.
- Plain, short answers: two to six sentences, no headings, no emoji, no markdown tables.`;

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The answer for the coach, in plain words.' },
    cardIds: { type: 'array', items: { type: 'string' }, description: 'Ids of the cards the answer relies on.' },
    covered: { type: 'boolean', description: 'Whether the cards and data cover the question.' },
    gap: { type: 'string', description: 'When not covered: a short title for the missing knowledge. Otherwise empty.' },
  },
  required: ['answer', 'cardIds', 'covered', 'gap'],
  additionalProperties: false,
} as const;

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 || /\d/.test(w));
/** Crude stemming: "rowing", "rows", "rowed" → "row"; then the first five letters. */
const stem = (w: string) => (w.length > 4 ? w.replace(/(ing|ers|er|ed|es|s)$/, '') : w).slice(0, 5);
const STOP = new Set(['what', 'why', 'how', 'the', 'and', 'for', 'are', 'you', 'does', 'did', 'about', 'with', 'this', 'that', 'know', 'should', 'when', 'which', 'our', 'have', 'from', 'into', 'there', 'their', 'than', 'then', 'they']);

/** The cards most related to the question (simple keyword overlap, title words count double). */
export function relevantCards(question: string, cards: MergedCard[], n = MAX_CARDS): MergedCard[] {
  const q = new Set(words(question).filter((w) => !STOP.has(w)).map(stem));
  if (!q.size) return [];
  const scored = cards.map((c) => {
    const title = words(c.title).map(stem), body = words(`${c.statement} ${c.open ?? ''} ${c.coachNote ?? ''} ${c.engine?.does ?? ''}`).map(stem);
    let s = 0;
    for (const w of title) if (q.has(w)) s += 2;
    for (const w of new Set(body)) if (q.has(w)) s += 1;
    return { c, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  return scored.slice(0, n).map((x) => x.c);
}

const cardText = (c: MergedCard, settings: (p: string) => unknown) => [
  `[${c.id}] ${c.title} (status: ${c.status}; strength: ${c.strength}${c.scope ? `; for: ${c.scope}` : ''})`,
  c.statement,
  c.open ? `Open: ${c.open}` : '',
  c.coachNote ? `Coach's note: ${c.coachNote}` : '',
  c.engine ? `Engine: ${c.engine.does} (${c.engine.state === 'built' ? 'in use' : 'planned'})${c.engine.settings?.length ? `; settings: ${c.engine.settings.map((p) => `${p}=${JSON.stringify(settings(p))}`).join(', ')}` : ''}` : '',
  `Sources: ${c.sources.map((s) => `${s.doc}${s.where ? ` (${s.where})` : ''}${s.quote ? ` "${s.quote}"` : ''}`).join('; ')}`,
  c.links?.length ? `Links: ${c.links.map((l) => `${l.rel} ${l.to}`).join(', ')}` : '',
].filter(Boolean).join('\n');

/** Answer a question and remember it. */
export async function ask(question: string, byAthlete: string): Promise<AskAnswer & { id: string }> {
  const q = question.trim();
  if (q.length < 3 || q.length > 1000) throw new InputError('Ask a question of up to 1,000 characters.');
  const c = getClient();
  if (!c) throw new InputError('Ask needs the ANTHROPIC_API_KEY secret.', 503);

  const [states, policy, plan] = await Promise.all([
    sql`SELECT card_id, status, coach_note FROM knowledge_state`,
    getPolicy(GROUP_ID),
    sql`SELECT d.date::text AS date, to_char(d.date, 'Dy') AS dow, d.status, coalesce(w.name, '') AS name, w.tags->>'timeDomain' AS td,
          w.tags->'modalityPattern' AS mods, coalesce(d.origin->'score'->'notes', '[]'::jsonb) AS notes
        FROM program_days d JOIN workouts w ON w.id = d.main_workout_id
        WHERE d.group_id = ${GROUP_ID} AND d.date BETWEEN current_date - 14 AND current_date + 14 ORDER BY d.date, d.seq`,
  ]);
  const cards = mergeCards(METHODOLOGY_CARDS, states.map((s): CardState => ({ cardId: s.card_id, status: s.status ?? undefined, coachNote: s.coach_note })));
  // Cards the plan's notes point to are always relevant to questions about the plan.
  const planNotes = plan.flatMap((r) => r.notes as string[]);
  const noteCards = cards.filter((x) => x.engine?.notePattern && planNotes.some((n) => new RegExp(x.engine!.notePattern!, 'i').test(n)));
  const picked = [...new Map([...relevantCards(q, cards), ...noteCards].map((x) => [x.id, x])).values()].slice(0, MAX_CARDS + 6);
  const setting = (p: string) => settingAt(policy, p);

  const content = [
    `Question from the coach: ${q}`,
    `\nAreas of knowledge: ${AREAS.map((a) => a.name).join('; ')}.`,
    `\nKnowledge cards (${picked.length} most related of ${cards.length}):\n\n${picked.map((x) => cardText(x, setting)).join('\n\n') || '(none matched the question)'}`,
    `\nPlan, two weeks back and ahead (date, day, status, workout, day type, modalities, planner notes):\n${plan.map((r) => `${r.date} ${r.dow} ${r.status} | ${r.name || '(unnamed)'} | ${r.td ?? '?'} | ${(r.mods as string[] | null)?.join('') ?? ''} | ${(r.notes as string[]).join('; ')}`).join('\n') || '(no planned days)'}`,
  ].join('\n');

  let out: AskAnswer;
  try {
    const res = await c.messages.create({
      model: ASK_MODEL, max_tokens: 4000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM, messages: [{ role: 'user', content }],
    }, { timeout: 60_000, maxRetries: 1 });
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    if (res.stop_reason !== 'end_turn' || !text) throw new Error(`stop ${res.stop_reason}`);
    const p = JSON.parse(text) as AskAnswer;
    const known = new Set(cards.map((x) => x.id));
    out = { answer: String(p.answer).trim(), cardIds: (p.cardIds ?? []).filter((id) => known.has(id)), covered: !!p.covered, gap: p.covered ? '' : String(p.gap ?? '').trim() };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) logger.error('ANTHROPIC_API_KEY was rejected; Ask is unavailable');
    else logger.warn({ err: (err as Error).message }, 'Ask failed');
    throw new InputError('Chalkboard could not answer right now. Try again in a moment.', 502);
  }
  const [row] = await sql`INSERT INTO knowledge_questions (question, answer, card_ids, covered, gap, model, by_athlete)
    VALUES (${q}, ${out.answer}, ${out.cardIds}, ${out.covered}, ${out.gap || null}, ${ASK_MODEL}, ${byAthlete}) RETURNING id`;
  return { id: row!.id as string, ...out };
}

export async function recentQuestions(limit = 30) {
  const rows = await sql`SELECT id, question, answer, card_ids, covered, gap, at::text AS at FROM knowledge_questions ORDER BY at DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, question: r.question, answer: r.answer, cardIds: r.card_ids as string[], covered: r.covered, gap: r.gap, at: r.at }));
}
