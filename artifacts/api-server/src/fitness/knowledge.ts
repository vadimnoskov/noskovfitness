/**
 * Chalkboard's knowledge for the coach: methodology cards (in code) merged with the coach's statuses and notes
 * (database), the current value of every setting a card names, and how often each rule shaped the plan.
 */
import { sql, getPolicy, getGroup } from '@workspace/fitness-db';
import { METHODOLOGY_CARDS, SOURCES, AREAS, MOVEMENT_FACTS, MOVEMENT_GUIDE, FAMILY_BY_ID, mergeCards, settingAt, firedCounts, type CardState, type CardStatus, type KnowledgeCard } from '@workspace/fitness-core';
import { InputError } from './logging';
import { GROUP_ID } from './data';
import { recentQuestions } from './knowledge-ask';
import { recentTeachings } from './knowledge-teach';

const STATUSES: ReadonlySet<string> = new Set(['confirmed', 'proposed', 'disputed', 'gap']);

/** Methodology cards plus the coach's active cards, with the coach's statuses and notes on top. */
export async function loadAllCards() {
  const [states, coach] = await Promise.all([
    sql`SELECT card_id, status, coach_note, updated_at::text AS updated_at FROM knowledge_state`,
    sql`SELECT id, body, teaching_id FROM coach_cards WHERE active`,
  ]);
  const coachCards = coach.map((r) => ({ ...(r.body as KnowledgeCard), id: r.id as string, origin: 'coach' as const, ...(r.teaching_id ? { teachingId: r.teaching_id as string } : {}) }));
  return mergeCards([...METHODOLOGY_CARDS, ...coachCards], states.map((x): CardState => ({ cardId: x.card_id, status: x.status ?? undefined, coachNote: x.coach_note, updatedAt: x.updated_at })));
}

export async function getKnowledge() {
  const [cards, policy, group, notesRows, events] = await Promise.all([
    loadAllCards(),
    getPolicy(GROUP_ID),
    getGroup(GROUP_ID),
    // Notes the planner left on days in the last 4 weeks and the current plan ahead.
    sql`SELECT jsonb_array_elements_text(origin->'score'->'notes') AS note FROM program_days
        WHERE group_id = ${GROUP_ID} AND date >= current_date - 28 AND origin ? 'score'`,
    sql`SELECT e.card_id, e.action, e.detail, e.at::text AS at, a.name AS by FROM knowledge_events e
        LEFT JOIN athletes a ON a.id = e.by_athlete ORDER BY e.at DESC LIMIT 30`,
  ]);
  const settings: Record<string, unknown> = {};
  for (const c of cards) for (const p of c.engine?.settings ?? []) {
    settings[p] = p === 'trainingDays' ? group?.training_days : settingAt(policy, p);
  }
  return {
    areas: AREAS, sources: SOURCES, cards, settings,
    fired: firedCounts(cards, notesRows.map((r) => r.note as string)),
    events: events.map((e) => ({ cardId: e.card_id, action: e.action, detail: e.detail, at: e.at, by: e.by })),
    questions: await recentQuestions(),
    teachings: await recentTeachings(),
  };
}

/** Change a card's status ("methodology" goes back to the manuals' status) and/or the coach's note on it. */
export async function setKnowledgeCard(input: { cardId: string; status?: string; note?: string }, byAthlete: string) {
  if (!(await loadAllCards()).some((c) => c.id === input.cardId)) throw new InputError('Unknown card.');
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


/** Movement list: the coach's facts plus how often the family has been done (all athletes) in the last 12 weeks. */
export async function getMovements() {
  const use = await sql`
    SELECT m.family, count(DISTINCT r.date)::int AS days, max(r.date)::text AS last
    FROM results r JOIN workout_movements wm ON wm.workout_id = r.workout_id JOIN movements m ON m.key = wm.movement_key
    WHERE r.date >= current_date - 84 GROUP BY m.family`;
  const byFam = new Map(use.map((u) => [u.family as string, { days: u.days as number, last: u.last as string }]));
  const guide = new Set(MOVEMENT_GUIDE.map((g) => g.key));
  return { movements: MOVEMENT_FACTS.map((f) => ({ ...f, use12w: byFam.get(f.key)?.days ?? 0, last: byFam.get(f.key)?.last ?? null, hasGuide: guide.has(f.key) })) };
}

/** One movement: facts, the L1 points of performance (when covered), catalog variants, recent and library workouts. */
export async function getMovement(key: string) {
  const facts = MOVEMENT_FACTS.find((f) => f.key === key);
  if (!facts) throw new InputError('Unknown movement.');
  const fam = FAMILY_BY_ID[key];
  const [recent, [lib], [last]] = await Promise.all([
    sql`SELECT DISTINCT ON (w.id) w.id, coalesce(w.name, '') AS name, r.date::text AS date
        FROM results r JOIN workouts w ON w.id = r.workout_id JOIN workout_movements wm ON wm.workout_id = w.id JOIN movements m ON m.key = wm.movement_key
        WHERE m.family = ${key} ORDER BY w.id, r.date DESC`,
    sql`SELECT count(DISTINCT w.id)::int AS n FROM workouts w JOIN workout_movements wm ON wm.workout_id = w.id JOIN movements m ON m.key = wm.movement_key
        WHERE m.family = ${key} AND w.programmable`,
    sql`SELECT max(r.date)::text AS d, count(DISTINCT r.date) FILTER (WHERE r.date >= current_date - 84)::int AS days
        FROM results r JOIN workout_movements wm ON wm.workout_id = r.workout_id JOIN movements m ON m.key = wm.movement_key WHERE m.family = ${key}`,
  ]);
  return {
    facts, guide: MOVEMENT_GUIDE.find((g) => g.key === key) ?? null,
    catalog: fam ? { implements: fam.implements, variants: fam.variants ?? [], unit: fam.unit } : null,
    recent: [...recent].sort((a, b) => (b.date as string).localeCompare(a.date as string)).slice(0, 12).map((r) => ({ id: r.id, name: r.name, date: r.date })),
    libraryWorkouts: lib!.n, last: last!.d, use12w: last!.days,
    cards: METHODOLOGY_CARDS.filter((c) => c.area === 'movements' || new RegExp(`\\b${facts.name.split(/[ /(]/)[0]}`, 'i').test(`${c.title} ${c.statement}`)).map((c) => ({ id: c.id, title: c.title })).slice(0, 8),
  };
}
