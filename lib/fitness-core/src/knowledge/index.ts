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

/** Value at a dotted settings path ("rules.heavyExceptionDays") in a plain object. */
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

/** Every policy value the coach may change by teaching (numbers and on/off rules), with its current value. */
export function tunableSettings(policy: unknown): { path: string; value: number | boolean }[] {
  const out: { path: string; value: number | boolean }[] = [];
  const walk = (o: unknown, pre: string) => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const p = pre ? `${pre}.${k}` : k;
      if (p === 'version') continue;
      if (typeof v === 'number' || typeof v === 'boolean') out.push({ path: p, value: v });
      else walk(v, p);
    }
  };
  walk(policy, '');
  return out;
}

/** A copy of `obj` with the value at a dotted path replaced. */
export function withSetting<T>(obj: T, path: string, value: unknown): T {
  const copy = structuredClone(obj) as Record<string, unknown>;
  const keys = path.split('.');
  let o = copy;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys.at(-1)!] = value;
  return copy as T;
}
