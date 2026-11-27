import { describe, it, expect } from 'vitest';
import { conditioning, readiness, type GridPoint } from '../src';

const pt = (date: string, minutes: number, factor: number, mod: 'G' | 'W' | 'M' = 'G'): GridPoint =>
  ({ date, minutes, power: 300 * minutes ** -0.3 * factor, id: date + minutes, modalities: [mod] });
const day = (i: number) => new Date(Date.parse('2026-11-27') - i * 86400000).toISOString().slice(0, 10);

// A best year about 2 years ago at 1.0, and now at 0.8.
const pts: GridPoint[] = [];
for (let i = 0; i < 40; i++) pts.push(pt(day(700 + i * 7), [3, 8, 15, 25][i % 4]!, 1.0));
for (let i = 0; i < 12; i++) pts.push(pt(day(i * 6 + 1), [3, 8, 15, 25][i % 4]!, 0.8));

describe('conditioning and readiness', () => {
  it('measures recent results against the best 12 months', () => {
    const c = conditioning(pts, pts.map((p) => p.date), '2026-11-27', null);
    expect(c.fromData).toBeCloseTo(0.8, 1);
    expect(c.level).toBeCloseTo(0.8, 1);
  });
  it('blends with the coach’s estimate, counting it as 3 results', () => {
    const c = conditioning(pts, [], '2026-11-27', 0.5);
    expect(c.level).toBeCloseTo((0.5 * 3 + 0.8 * 10) / 13, 1);
    expect(conditioning([], [], '2026-11-27', 0.75).level).toBe(0.75);
  });
  it('uses a check-in only when it predicts results', () => {
    const recent: GridPoint[] = [];
    const checks: { date: string; feeling: number }[] = [];
    for (let i = 0; i < 14; i++) { const f = (i % 5) + 1; recent.push(pt(day(i * 3 + 2), [3, 8, 15][i % 3]!, 0.8 + f * 0.04)); checks.push({ date: day(i * 3 + 2), feeling: f }); }
    const r = readiness([...pts, ...recent], [...checks, { date: '2026-11-27', feeling: 5 }], '2026-11-27');
    expect(r.checkIn.pairs).toBe(14);
    expect(r.checkIn.used).toBe(true);
    expect(r.checkIn.suggests!).toBeGreaterThan(0);
    const noisy = readiness([...pts, ...recent], checks.map((c, i) => ({ ...c, feeling: [3, 5, 1, 4, 2][i % 5]! })), '2026-11-27');
    expect(noisy.checkIn.used).toBe(false);
  });
});
