/**
 * Coach → Chalkboard teaching. The coach explains something in plain words; Chalkboard restates it as cards,
 * proposes any setting changes it clearly implies, lists conflicts with existing cards (taking a position, with
 * sources), and the planner is dry-run on the next four weeks to show which days would change. Nothing is saved
 * until the coach confirms; a confirmed teaching can be undone.
 *
 * - Model: Claude Sonnet 5.5 (restating faithfully and arguing positions needs it); a few cents per teaching.
 * - Privacy: the prompt carries the coach's text, cards and settings. No names or personal results.
 */
import Anthropic from '@anthropic-ai/sdk';
import { sql, getPolicy, savePolicy, planRange } from '@workspace/fitness-db';
import { AREAS, tunableSettings, withSetting, settingAt, addDays, type MergedCard, type ProgrammingPolicy, type KnowledgeCard, type AreaId, type Strength, type CardKind, type LinkRel } from '@workspace/fitness-core';
import { logger } from '../lib/logger';
import { InputError } from './logging';
import { GROUP_ID } from './data';
import { loadAllCards } from './knowledge';
import { relevantCards } from './knowledge-ask';

export const TEACH_MODEL = 'claude-sonnet-5-5';

let client: Anthropic | null | undefined;
const getClient = () => {
  if (client === undefined) client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
  return client;
};

export interface DraftCard { title: string; statement: string; area: AreaId; kind: CardKind; strength: Strength; scope: string; links: { rel: LinkRel; to: string }[] }
export interface Draft {
  understood: string;
  cards: DraftCard[];
  settingChanges: { path: string; value: number | boolean; why: string }[];
  conflicts: { cardId: string; summary: string; position: 'agree' | 'partly' | 'disagree'; reasoning: string }[];
  questions: string[];
}

const AREA_IDS = AREAS.map((a) => a.id);
const SCHEMA = {
  type: 'object',
  properties: {
    understood: { type: 'string', description: 'How Chalkboard understood the teaching, in its own words, 2-4 sentences.' },
    cards: { type: 'array', items: { type: 'object', properties: {
      title: { type: 'string' }, statement: { type: 'string' },
      area: { type: 'string', enum: AREA_IDS }, kind: { type: 'string', enum: ['definition', 'principle', 'rule', 'number', 'method', 'caution'] },
      strength: { type: 'string', enum: ['hard', 'strong', 'guidance', 'info'] }, scope: { type: 'string', description: 'Who it applies to, or "" for everyone.' },
      links: { type: 'array', items: { type: 'object', properties: { rel: { type: 'string', enum: ['refines', 'supports', 'limits', 'conflicts', 'uses', 'related'] }, to: { type: 'string' } }, required: ['rel', 'to'], additionalProperties: false } },
    }, required: ['title', 'statement', 'area', 'kind', 'strength', 'scope', 'links'], additionalProperties: false } },
    settingChanges: { type: 'array', items: { type: 'object', properties: {
      path: { type: 'string' }, value: { anyOf: [{ type: 'number' }, { type: 'boolean' }] }, why: { type: 'string' },
    }, required: ['path', 'value', 'why'], additionalProperties: false } },
    conflicts: { type: 'array', items: { type: 'object', properties: {
      cardId: { type: 'string' }, summary: { type: 'string' }, position: { type: 'string', enum: ['agree', 'partly', 'disagree'] }, reasoning: { type: 'string' },
    }, required: ['cardId', 'summary', 'position', 'reasoning'], additionalProperties: false } },
    questions: { type: 'array', items: { type: 'string' }, description: 'Questions back to the coach when something is ambiguous.' },
  },
  required: ['understood', 'cards', 'settingChanges', 'conflicts', 'questions'],
  additionalProperties: false,
} as const;

const SYSTEM = `You are Chalkboard, the programming engine of a family CrossFit app. The coach is teaching you something. Turn it into knowledge you can use, and check it against what you already know.

Rules:
- Restate faithfully in "understood". Don't add ideas the coach didn't express. If something is ambiguous, ask in "questions" instead of guessing.
- Write one or a few small cards: each a single idea, plain language, a title of a few words and a statement of one to four sentences. Pick the area, kind, strength and scope that fit. Link cards to existing card ids only (from the list given).
- Propose a settingChange only when the teaching clearly implies a value for one of the listed settings, with the exact path, a value of the same type, and why. Otherwise leave settingChanges empty: knowledge without a setting is fine.
- Conflicts: list every existing card the teaching contradicts or narrows. For each, take a position: agree (the teaching is right and the card should yield), partly (both hold, with a limit you state), or disagree (you think the card is right). Explain with the card's sources. Don't agree just to please the coach; don't disagree for its own sake.
- CrossFit methodology only. Never bring in other training systems.
- No names or personal details in cards.`;

type Settings = ReturnType<typeof tunableSettings>;

function validate(d: Draft, cards: MergedCard[], settings: Settings): Draft {
  const ids = new Set(cards.map((c) => c.id));
  const byPath = new Map(settings.map((s) => [s.path, s.value]));
  return {
    understood: String(d.understood ?? '').trim(),
    questions: (d.questions ?? []).map(String).filter(Boolean).slice(0, 5),
    cards: (d.cards ?? []).slice(0, 5).map((c) => ({
      title: String(c.title).trim().slice(0, 120), statement: String(c.statement).trim().slice(0, 1200),
      area: (AREA_IDS as string[]).includes(c.area) ? c.area : 'coaching', kind: c.kind, strength: c.strength, scope: String(c.scope ?? '').trim(),
      links: (c.links ?? []).filter((l) => ids.has(l.to)),
    })).filter((c) => c.title && c.statement),
    settingChanges: (d.settingChanges ?? []).filter((s) => {
      const cur = byPath.get(s.path);
      if (cur === undefined || typeof cur !== typeof s.value) return false;
      return typeof s.value !== 'number' || (Number.isFinite(s.value) && s.value >= 0 && s.value <= 730);
    }).slice(0, 6),
    conflicts: (d.conflicts ?? []).filter((x) => ids.has(x.cardId)).slice(0, 8),
  };
}

/** The days in the next four weeks whose pick would change with the draft's settings (nothing is saved). */
async function previewDraft(draft: Draft) {
  if (!draft.settingChanges.length) return { changed: [], checked: 0, from: null, to: null };
  const policy = await getPolicy(GROUP_ID);
  let next: ProgrammingPolicy = policy;
  for (const s of draft.settingChanges) next = withSetting(next, s.path, s.value);
  const from = new Date().toISOString().slice(0, 10), to = addDays(from, 27);
  const [now, after] = await Promise.all([planRange(GROUP_ID, from, to), planRange(GROUP_ID, from, to, { policy: next })]);
  const name = new Map(now.candidates.map((c) => [c.id, c.workout.name ?? '']));
  const a = new Map(now.proposals.map((p) => [p.date, p.candidateId])), b = new Map(after.proposals.map((p) => [p.date, p.candidateId]));
  const dates = [...new Set([...a.keys(), ...b.keys()])].sort();
  const changed = dates.filter((d) => a.get(d) !== b.get(d)).map((d) => ({
    date: d, before: a.get(d) ? name.get(a.get(d)!) || 'a workout' : 'no workout', after: b.get(d) ? name.get(b.get(d)!) || 'a workout' : 'no workout',
  }));
  return { changed, checked: dates.length, from, to };
}

/** Draft (or refine) a teaching. */
export async function teach(input: { text: string; teachingId?: string; correction?: string }, byAthlete: string) {
  const c = getClient();
  if (!c) throw new InputError('Teaching needs the ANTHROPIC_API_KEY secret.', 503);
  const prev = input.teachingId ? (await sql`SELECT id, text, draft, status FROM knowledge_teachings WHERE id = ${input.teachingId}`)[0] : undefined;
  if (input.teachingId && (!prev || prev.status !== 'draft')) throw new InputError('That teaching is no longer a draft.');
  const text = (prev?.text as string | undefined) ?? input.text.trim();
  if (text.length < 10 || text.length > 4000) throw new InputError('Explain it in 10 to 4,000 characters.');
  const correction = input.correction?.trim();

  const [cards, policy] = await Promise.all([loadAllCards(), getPolicy(GROUP_ID)]);
  const settings = tunableSettings(policy);
  const related = relevantCards(`${text} ${correction ?? ''}`, cards, 30);
  const content = [
    `The coach's teaching:\n${text}`,
    prev && correction ? `\nYour previous draft:\n${JSON.stringify(prev.draft)}\n\nThe coach's correction:\n${correction}` : '',
    `\nAreas: ${AREAS.map((a) => `${a.id} (${a.name})`).join('; ')}`,
    `\nSettings you may propose changes to (path = current value):\n${settings.map((s) => `${s.path} = ${s.value}`).join('\n')}`,
    `\nExisting cards most related to this teaching:\n\n${related.map((x) => `[${x.id}] ${x.title} (${x.origin === 'coach' ? 'coach card; ' : ''}status ${x.status}, ${x.strength})\n${x.statement}\nSources: ${x.sources.map((s) => `${s.doc}${s.where ? ` (${s.where})` : ''}${s.quote ? ` "${s.quote}"` : ''}`).join('; ')}`).join('\n\n') || '(none)'}`,
  ].filter(Boolean).join('\n');

  let draft: Draft;
  try {
    const res = await c.messages.create({
      model: TEACH_MODEL, max_tokens: 8000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM, messages: [{ role: 'user', content }],
    }, { timeout: 90_000, maxRetries: 1 });
    const out = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
    if (res.stop_reason !== 'end_turn' || !out) throw new Error(`stop ${res.stop_reason}`);
    draft = validate(JSON.parse(out) as Draft, cards, settings);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'teaching draft failed');
    throw new InputError('Chalkboard could not read that right now. Try again in a moment.', 502);
  }
  const preview = await previewDraft(draft);
  if (prev) {
    await sql`UPDATE knowledge_teachings SET draft = ${sql.json(draft as never)}, preview = ${sql.json(preview as never)} WHERE id = ${prev.id}`;
    return { id: prev.id as string, text, draft, preview };
  }
  const [row] = await sql`INSERT INTO knowledge_teachings (text, draft, preview, by_athlete) VALUES (${text}, ${sql.json(draft as never)}, ${sql.json(preview as never)}, ${byAthlete}) RETURNING id`;
  return { id: row!.id as string, text, draft, preview };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/**
 * Confirm a draft: its cards become coach cards, its setting changes are saved. "override" keeps the conflicts
 * on record as conflict links (the coach decided against a card Chalkboard defended).
 */
export async function confirmTeaching(id: string, decision: 'agree' | 'override', byAthlete: string) {
  const [t] = await sql`SELECT id, text, draft, status, created_at::text AS created FROM knowledge_teachings WHERE id = ${id}`;
  if (!t || t.status !== 'draft') throw new InputError('That teaching is no longer a draft.');
  const draft = t.draft as Draft;
  if (!draft.cards.length && !draft.settingChanges.length) throw new InputError('Nothing to save: correct the draft or discard it.');
  const disagreements = draft.conflicts.filter((x) => x.position === 'disagree');
  if (disagreements.length && decision !== 'override') throw new InputError('Chalkboard disagrees with part of this. Confirm it as a coach decision to keep the conflict on record, or correct it.');
  const day = new Date().toISOString().slice(0, 10);
  const before = await getPolicy(GROUP_ID);
  let after: ProgrammingPolicy = before;
  for (const s of draft.settingChanges) after = withSetting(after, s.path, s.value);
  await sql.begin(async (tx) => {
    for (const [i, c] of draft.cards.entries()) {
      const cardId = `coach-${slug(c.title) || 'card'}-${String(id).slice(0, 6)}${i ? `-${i}` : ''}`;
      const links = [...c.links, ...(decision === 'override' ? disagreements.map((x) => ({ rel: 'conflicts' as const, to: x.cardId })) : [])];
      const body: KnowledgeCard = {
        id: cardId, area: c.area, title: c.title, statement: c.statement, kind: c.kind, strength: c.strength, status: 'confirmed',
        sources: [{ doc: 'coach', where: decision === 'override' ? `${day} (coach decision, overruling a card)` : day, quote: String(t.text).slice(0, 300) }],
        ...(links.length ? { links } : {}), ...(c.scope ? { scope: c.scope } : {}),
        ...(draft.settingChanges.length ? { engine: { does: `Sets ${draft.settingChanges.map((s) => `${s.path} to ${s.value}`).join(', ')}.`, state: 'built' as const, settings: draft.settingChanges.map((s) => s.path) } } : {}),
        origin: 'coach', teachingId: id,
      };
      await tx`INSERT INTO coach_cards (id, body, teaching_id) VALUES (${cardId}, ${tx.json(body as never)}, ${id})`;
      await tx`INSERT INTO knowledge_events (card_id, action, detail, by_athlete) VALUES (${cardId}, 'taught', ${tx.json({ teachingId: id, decision } as never)}, ${byAthlete})`;
    }
    await tx`UPDATE knowledge_teachings SET status = 'confirmed', decision = ${decision}, decided_at = now(),
      policy_before = ${draft.settingChanges.length ? tx.json(before as never) : null}, policy_after = ${draft.settingChanges.length ? tx.json(after as never) : null} WHERE id = ${id}`;
  });
  if (draft.settingChanges.length) await savePolicy(GROUP_ID, { ...after, version: before.version + 1 });
  return { ok: true, settingsChanged: draft.settingChanges.length };
}

export async function discardTeaching(id: string) {
  await sql`UPDATE knowledge_teachings SET status = 'discarded', decided_at = now() WHERE id = ${id} AND status = 'draft'`;
  return { ok: true };
}

/** Undo a confirmed teaching: its cards are deactivated and each setting it changed goes back, unless changed since. */
export async function undoTeaching(id: string, byAthlete: string) {
  const [t] = await sql`SELECT id, draft, status, policy_before, policy_after FROM knowledge_teachings WHERE id = ${id}`;
  if (!t || t.status !== 'confirmed') throw new InputError('Only a confirmed teaching can be undone.');
  const draft = t.draft as Draft;
  const now = await getPolicy(GROUP_ID);
  let restored = now;
  const kept: string[] = [];
  for (const s of draft.settingChanges) {
    if (settingAt(now, s.path) === settingAt(t.policy_after, s.path)) restored = withSetting(restored, s.path, settingAt(t.policy_before, s.path));
    else kept.push(s.path);
  }
  await sql.begin(async (tx) => {
    const ids = await tx`UPDATE coach_cards SET active = false WHERE teaching_id = ${id} RETURNING id`;
    for (const r of ids) await tx`INSERT INTO knowledge_events (card_id, action, detail, by_athlete) VALUES (${r.id}, 'undone', ${tx.json({ teachingId: id } as never)}, ${byAthlete})`;
    await tx`UPDATE knowledge_teachings SET status = 'undone', decided_at = now() WHERE id = ${id}`;
  });
  if (restored !== now) await savePolicy(GROUP_ID, { ...restored, version: now.version + 1 });
  return { ok: true, keptSettings: kept };
}

export async function recentTeachings(limit = 20) {
  const rows = await sql`SELECT id, text, draft, preview, status, decision, created_at::text AS at FROM knowledge_teachings ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, text: r.text, draft: r.draft, preview: r.preview, status: r.status, decision: r.decision, at: r.at }));
}
