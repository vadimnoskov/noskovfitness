import { describe, it, expect } from 'vitest';
import { weekOutline, slotFit } from '../src';

const tags = (p: ('G' | 'W' | 'M')[], td: 'heavy' | 'short' | 'medium' | 'long', n = p.length) =>
  ({ modalityPattern: p, movementCount: n, load: 'light' as const, volume: 'medium' as const, timeDomain: td, priority: 'task' as const, pathway: 'glycolytic' as const });
// Twelve weeks of Mon, Tue, Thu, Fri, Sat.
const weeks = Array.from({ length: 12 }, (_, w) => [0, 1, 3, 4, 5].map((d) => new Date(Date.parse('2026-11-30') + (w * 7 + d) * 86400000).toISOString().slice(0, 10)));
const wd = (d: string) => (new Date(d).getUTCDay() + 6) % 7;

describe('week outline', () => {
  const o = weekOutline(weeks.flat());
  it('gives every week one heavy day and one interval day, on different days', () => {
    for (const w of weeks) {
      const kinds = w.map((d) => o.get(d)?.kind);
      expect(kinds.filter((k) => k === 'heavy')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'mono')).toHaveLength(1);
    }
  });
  it('varies the weekday: never the same as the week before, and no fixed sequence of day types', () => {
    const heavyDays = weeks.map((w) => wd(w.find((d) => o.get(d)?.kind === 'heavy')!));
    for (let i = 1; i < heavyDays.length; i++) expect(heavyDays[i]).not.toBe(heavyDays[i - 1]);
    expect(new Set(heavyDays).size).toBeGreaterThanOrEqual(3);
    // Most days carry no slot at all: the targets decide them.
    expect([...o.values()].length).toBe(24);
  });
  it('skips the heavy slot when the week already has a heavy day', () => {
    const o2 = weekOutline(weeks[0]!, new Set(['2026-11-30']));
    expect([...o2.values()].some((s) => s.kind === 'heavy')).toBe(false);
  });
  it('scores fit', () => {
    expect(slotFit({ kind: 'heavy', elements: ['W'], label: '' }, tags(['W'], 'heavy'))).toBe(1);
    expect(slotFit({ kind: 'heavy', elements: ['W'], label: '' }, tags(['W', 'G'], 'medium'))).toBe(0);
    expect(slotFit({ kind: 'mono', elements: ['M'], label: '' }, tags(['M'], 'short'), 'intervals')).toBe(1);
  });
});
