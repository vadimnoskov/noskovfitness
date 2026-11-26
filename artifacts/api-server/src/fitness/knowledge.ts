/**
 * Chalkboard's knowledge for the coach: methodology cards (in code) merged with the coach's statuses and notes
 * (database), the current value of every setting a card names, and how often each rule shaped the plan.
 */
import { sql, getPolicy, getGroup } from '@workspace/fitness-db';
import { METHODOLOGY_CARDS, SOURCES, AREAS, mergeCards, settingAt, firedCounts, type CardState, type CardStatus } from '@workspace/fitness-core';
import { InputError } from './logging';
import { GROUP_ID } from './data';
import { recentQuestions } from './knowledge-ask';

const CARD_IDS = new Set(METHODOLOGY_CARDS.map((c) => c.id));
const STATUSES: ReadonlySet<string> = new Set(['confirmed', 'proposed', 'disputed', 'gap']);

export async function getKnowledge() {
  const [states, policy, group, notesRows, events] = await Promise.all([
    sql`SELECT card_id, status, coach_note, updated_at::text AS updated_at FROM knowledge_state`,
    getPolicy(GROUP_ID),
    getGroup(GROUP_ID),
    // Notes the planner left on days in the last 4 weeks and the current plan ahead.
    sql`SELECT jsonb_array_elements_text(origin->'score'->'notes') AS note FROM program_days
        WHERE group_id = ${GROUP_ID} AND date >= current_date - 28 AND origin ? 'score'`,
    sql`SELECT e.card_id, e.action, e.detail, e.at::text AS at, a.name AS by FROM knowledge_events e
        LEFT JOIN athletes a ON a.id = e.by_athlete ORDER BY e.at DESC LIMIT 30`,
  ]);
  const cards = mergeCards(METHODOLOGY_CARDS, states.map((s): CardState => ({ cardId: s.card_id, status: s.status ?? undefined, coachNote: s.coach_note, updatedAt: s.updated_at })));
  const settings: Record<string, unknown> = {};
  for (const c of cards) for (const p of c.engine?.settings ?? []) {
    settings[p] = p === 'trainingDays' ? group?.training_days : settingAt(policy, p);
  }
  return {
    areas: AREAS, sources: SOURCES, cards, settings,
    fired: firedCounts(METHODOLOGY_CARDS, notesRows.map((r) => r.note as string)),
    events: events.map((e) => ({ cardId: e.card_id, action: e.action, detail: e.detail, at: e.at, by: e.by })),
    questions: await recentQuestions(),
  };
}

/** Change a card's status ("methodology" goes back to the manuals' status) and/or the coach's note on it. */
export async function setKnowledgeCard(input: { cardId: string; status?: string; note?: string }, byAthlete: string) {
  if (!CARD_IDS.has(input.cardId)) throw new InputError('Unknown card.');
  if (input.status && input.status !== 'methodology' && !STATUSES.has(input.status)) throw new InputError('Unknown status.');
  const note = input.note === undefined ? undefined : input.note.trim().slice(0, 2000);
  const [cur] = await sql`SELECT status, coach_note FROM knowledge_state WHERE card_id = ${input.cardId}`;
  const status: CardStatus | null = input.status === undefined ? (cur?.status ?? null) : input.status === 'methodology' ? null : (input.status as CardStatus);
  const coachNote = note === undefined ? (cur?.coach_note ?? null) : note || null;
  await sql.begin(async (tx) => {
    await tx`INSERT INTO knowledge_state (card_id, status, coach_note, updated_at) VALUES (${input.cardId}, ${status}, ${coachNote}, now())
      ON CONFLICT (card_id) DO UPDATE SET status = EXCLUDED.status, coach_note = EXCLUDED.coach_note, updated_at = now()`;
    await tx`INSERT INTO knowledge_events (card_id, action, detail, by_athlete) VALUES (${input.cardId},
      ${input.status !== undefined ? 'status' : 'note'},
      ${tx.json({ from: { status: cur?.status ?? null, note: cur?.coach_note ?? null }, to: { status, note: coachNote } } as never)}, ${byAthlete})`;
  });
  return { ok: true };
}
