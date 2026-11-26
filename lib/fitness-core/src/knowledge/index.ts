export * from './types';
export { SOURCES, AREAS } from './sources';
export { METHODOLOGY_CARDS } from './cards';
export { MOVEMENT_FACTS, MOVEMENT_GUIDE, type MovementFacts, type MovementGuide } from './movements';
import type { CardStatus, KnowledgeCard } from './types';

/** The coach's layer on a card, stored in the database. */
export interface CardState { cardId: string; status?: CardStatus; coachNote?: string | null; updatedAt?: string }

export type MergedCard = KnowledgeCard & { coachNote?: string | null; changedAt?: string; methodologyStatus: CardStatus };

/** Methodology cards with the coach's status changes and notes on top. */
export function mergeCards(cards: KnowledgeCard[], states: CardState[]): MergedCard[] {
  const byId = new Map(states.map((s) => [s.cardId, s]));
  return cards.map((c) => {
    const s = byId.get(c.id);
    return { ...c, methodologyStatus: c.status, ...(s?.status ? { status: s.status } : {}), ...(s?.coachNote ? { coachNote: s.coachNote } : {}), ...(s?.updatedAt ? { changedAt: s.updatedAt } : {}) };
  });
}

/** Value at a dotted settings path ("rules.rareExceptionDays") in a plain object. */
export function settingAt(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** How many planner notes in a set match each card's notePattern. */
export function firedCounts(cards: KnowledgeCard[], notes: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cards) {
    if (!c.engine?.notePattern) continue;
    const re = new RegExp(c.engine.notePattern, 'i');
    out[c.id] = notes.filter((n) => re.test(n)).length;
  }
  return out;
}
