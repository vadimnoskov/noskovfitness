import { describe, it, expect } from 'vitest';
import { weaknessGrid, plannerWeakness, gridColumn, gridRow, type GridPoint } from '../src';

// A person whose power follows 300 × minutes^-0.3, except long gymnastics, 25% below.
const make = (minutes: number, mod: ('G' | 'W' | 'M')[], date: string, factor = 1): GridPoint =>
  ({ minutes, power: 300 * minutes ** -0.3 * factor, date, id: `${minutes}${mod}${date}`, modalities: mod });
const pts: GridPoint[] = [];
for (let i = 0; i < 6; i++) {
  const d = `2026-0${(i % 9) + 1}-1${i % 9}`;
  pts.push(make(2, ['G'], d), make(8, ['G'], d), make(15, ['G'], d, 0.75), make(30, ['G'], d));
  pts.push(make(2, ['W'], d), make(8, ['W'], d), make(15, ['W'], d), make(6, ['W', 'G'], d), make(25, ['M'], d));
}

const expo = (ps: GridPoint[]) => ps.map((p) => ({ date: p.date, timeDomain: gridRow(p.minutes), modalities: p.modalities }));

describe('weakness grid', () => {
  it('classifies rows and columns', () => {
    expect(gridColumn(['W', 'W'])).toBe('W');
    expect(gridColumn(['W', 'G'])).toBe('mixed');
    expect(gridRow(3.9)).toBe('short');
    expect(gridRow(12)).toBe('long');
  });
  it('shows the level against the curve without flagging it', () => {
    const g = weaknessGrid(pts, expo(pts), '2026-11-27');
    const longG = g.cells.find((c) => c.row === 'long' && c.col === 'G')!;
    expect(longG.vsCurve!).toBeLessThan(-15);
    expect(longG.flag).toBeNull();
  });
  it('flags a cell that declined against its own earlier results', () => {
    const older = [1, 2, 3, 4].map((i) => make(15, ['G'], `2025-0${i}-01`, 1.1));
    const g = weaknessGrid([...pts, ...older], expo([...pts, ...older]), '2026-11-27');
    const longG = g.cells.find((c) => c.row === 'long' && c.col === 'G')!;
    expect(longG.flag).toBe('weak');
    expect(longG.recent! - longG.prior!).toBeLessThan(-10);
  });
  it('flags cells that dropped out of training', () => {
    const old = [...pts, ...[1, 2, 3].map((i) => make(25, ['M'], `2024-0${i}-01`))].filter((p) => !(p.modalities[0] === 'M' && p.date >= '2026'));
    const g = weaknessGrid(old, expo(old), '2026-11-27');
    expect(g.cells.find((c) => c.row === 'endurance' && c.col === 'M')!.flag).toBe('rare');
  });
  it('turns flags into planner weights', () => {
    const older = [1, 2, 3, 4].map((i) => make(15, ['G'], `2025-0${i}-01`, 1.1));
    const m = plannerWeakness([weaknessGrid([...pts, ...older], expo([...pts, ...older]), '2026-11-27')]);
    expect(m.get('long|G')).toBeGreaterThan(0.5);
    expect(m.has('long|W')).toBe(false);
  });
});
