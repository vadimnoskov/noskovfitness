import { describe, it, expect } from 'vitest';
import { weekOutline, slotFit } from '../src';

const tags = (p: ('G' | 'W' | 'M')[], td: 'heavy' | 'short' | 'medium' | 'long', n = p.length) =>
  ({ modalityPattern: p, movementCount: n, load: 'light' as const, volume: 'medium' as const, timeDomain: td, priority: 'task' as const, pathway: 'glycolytic' as const });

describe('week outline', () => {
  it('lays out a 5-day week as 1-2-3-2-1 with a heavy slot', () => {
    const o = weekOutline(['2026-11-30', '2026-12-01', '2026-12-03', '2026-12-04', '2026-12-05']);
    const kinds = ['2026-11-30', '2026-12-01', '2026-12-03', '2026-12-04', '2026-12-05'].map((d) => o.get(d)!.kind);
    expect(kinds.filter((k) => k === 'heavy')).toHaveLength(1);
    expect(kinds[1]).toBe('couplet');
    expect(kinds[2]).toBe('triplet');
  });
  it('rotates the elements week to week', () => {
    const a = weekOutline(['2026-11-30', '2026-12-01', '2026-12-03', '2026-12-04', '2026-12-05']).get('2026-12-01')!.elements.join('');
    const b = weekOutline(['2026-12-07', '2026-12-08', '2026-12-10', '2026-12-11', '2026-12-12']).get('2026-12-08')!.elements.join('');
    expect(a).not.toBe(b);
  });
  it('skips the extra heavy slot when the week already has a heavy day', () => {
    const o = weekOutline(['2026-11-30', '2026-12-01', '2026-12-03', '2026-12-04', '2026-12-05'], new Set(['2026-11-30']));
    expect([...o.values()].some((s) => s.kind === 'heavy')).toBe(false);
  });
  it('scores fit', () => {
    expect(slotFit({ kind: 'heavy', elements: ['W'], label: '' }, tags(['W'], 'heavy'))).toBe(1);
    expect(slotFit({ kind: 'couplet', elements: ['G', 'W'], label: '' }, tags(['W', 'G'], 'medium'))).toBe(1);
    expect(slotFit({ kind: 'couplet', elements: ['G', 'W'], label: '' }, tags(['W', 'G'], 'heavy'))).toBe(0);
    expect(slotFit({ kind: 'mono', elements: ['M'], label: '' }, tags(['M'], 'short'), 'intervals')).toBe(1);
  });
});
