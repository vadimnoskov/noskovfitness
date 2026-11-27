/**
 * The athlete picture from results: power points for every countable result, and the weakness grid (time domain ×
 * modality) built from them.
 *
 * Method. Each result's power is compared with the person's own typical power for that modality at that duration:
 * log(power) = level(modality) + slope × log(minutes), fitted over the window. The slope (how fast power falls as
 * efforts get longer) is shared; each modality has its own level, because gymnastics, weightlifting and machines are
 * measured by different rules (body travel, bar travel, the Concept2 formula). A cell's score is the median distance
 * of its results from that curve, so it compares a time domain with the rest of the same modality. How often a cell is trained also counts: CrossFit treats what you avoid as
 * a weakness (Foundations: athletes are weakest at the margins of their exposure).
 */
import type { Modality } from '../movements/catalog';
import type { Result, TimeDomain } from '../model/types';
import { resultWork, monoSpeed, dimsAt, type PowerPoint, type PaceFor } from './work';

export type GridRow = Exclude<TimeDomain, 'heavy'>;
export type GridCol = 'G' | 'W' | 'M' | 'mixed';
export const GRID_ROWS: GridRow[] = ['short', 'medium', 'long', 'endurance'];
export const GRID_COLS: GridCol[] = ['G', 'W', 'M', 'mixed'];
export const GRID_COL_LABEL: Record<GridCol, string> = { G: 'Gymnastics', W: 'Weightlifting', M: 'Run, row, bike', mixed: 'Mixed' };
export const GRID_ROW_LABEL: Record<GridRow, string> = { short: 'Short (under 4 min)', medium: 'Medium (4–12)', long: 'Long (12–20)', endurance: 'Endurance (20+)' };

export const gridColumn = (pattern: readonly Modality[]): GridCol => { const s = new Set(pattern); return s.size === 1 ? ([...s][0] as GridCol) : 'mixed'; };
export const gridRow = (minutes: number): GridRow => (minutes < 4 ? 'short' : minutes < 12 ? 'medium' : minutes < 20 ? 'long' : 'endurance');
export const cellKey = (row: GridRow, col: GridCol) => `${row}|${col}`;

type ResultRow = Pick<Result, 'performed' | 'score' | 'completed'> & { id: string; date: string; workout_id?: string | null; name?: string; tags?: { modalityPattern?: Modality[] } | null };
type DimRow = { kind: string; date: string; value: number; unit: string };
export interface GridPoint extends PowerPoint { modalities: Modality[] }

/**
 * Power for every countable for-time or AMRAP result. A run or row inside a mixed workout uses the person's median speed
 * that year on pure pieces of a similar length (half to double), else any length that year, else any year.
 */
export function powerPoints(results: ResultRow[], sex: 'male' | 'female', dims: DimRow[]) {
  const speeds = new Map<string, { year: string; v: number; metres: number }[]>();
  for (const r of results) {
    const m = monoSpeed(r);
    if (m) speeds.set(m.family, [...(speeds.get(m.family) ?? []), { year: r.date.slice(0, 4), v: m.speed, metres: m.metres }]);
  }
  const pacesFor = (date: string): PaceFor => (family, metres) => {
    const list = speeds.get(family) ?? [];
    const near = metres ? list.filter((x) => x.metres >= metres / 2 && x.metres <= metres * 2) : list;
    const year = (l: typeof list) => l.filter((x) => x.year === date.slice(0, 4));
    for (const l of [year(near), near, year(list), list]) { const v = median(l.map((x) => x.v)); if (v) return v; }
    return undefined;
  };
  const points: GridPoint[] = [];
  const missing = new Map<string, number>();
  let timed = 0;
  for (const r of results) {
    const kind = r.performed.structure.kind;
    if (kind !== 'for-time' && kind !== 'amrap') continue;
    timed++;
    const w = resultWork(r, sex, dimsAt(dims, r.date), pacesFor(r.date));
    if (w.power && w.seconds) {
      points.push({ minutes: Math.round((w.seconds / 60) * 10) / 10, power: w.power, date: r.date, id: r.workout_id ?? r.id, name: r.name || undefined,
        modalities: r.tags?.modalityPattern ?? [] });
    } else for (const m of w.missing) missing.set(m, (missing.get(m) ?? 0) + 1);
  }
  const paces = Object.fromEntries([...speeds].map(([f, l]) => [f, { n: l.length, medianSec500: Math.round(500 / median(l.map((x) => x.v))!) }]));
  return { points, timed, missing, paces };
}

export function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const a = [...xs].sort((x, y) => x - y), i = a.length >> 1;
  return a.length % 2 ? a[i]! : (a[i - 1]! + a[i]!) / 2;
}
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

export interface GridCell {
  row: GridRow; col: GridCol;
  /** Results with a power number in the window. */
  n: number;
  /** Median distance from the person's own curve, in % (−12 = 12% below their usual power at that duration). */
  vsCurve: number | null;
  /** The same for the last 12 months and the 24 months before, when each has at least 3 results. */
  recent: number | null; prior: number | null;
  /** Workouts of this kind in the last 12 months (all results, counted or not) and their share. */
  done12m: number; share12m: number;
  confidence: 'good' | 'some' | 'too few';
  /** weak = declining (the last 12 months below the 2 years before); rare = dropped out of training. */
  flag: 'weak' | 'rare' | null;
  /** Why it is flagged, in plain words. */
  why?: string;
  examples: { id: string; name?: string; date: string; minutes: number; vsCurve: number }[];
}
export interface WeaknessGrid { from: string; to: string; fit: { a: number; b: number } | null; cells: GridCell[]; counted: number; done12m: number }

/**
 * The grid over the 3 years up to `asOf`. `exposure` lists every result in the window (counted or not) with its stored
 * time domain and modality pattern, for how often each cell is trained.
 */
export function weaknessGrid(points: GridPoint[], exposure: { date: string; timeDomain?: TimeDomain; modalities?: Modality[] }[], asOf: string): WeaknessGrid {
  const from = addDays(asOf, -3 * 365), yearAgo = addDays(asOf, -365);
  const pts = points.filter((p) => p.date >= from && p.date <= asOf && p.minutes > 0 && p.power > 0 && p.modalities.length);
  // log(power) = level[column] + slope · log(minutes): one slope (how power falls as efforts get longer) shared by all
  // columns, and a level per column, since each modality is measured by its own rule. Fitted by least squares with the
  // column levels as fixed effects (centre within each column, then one slope).
  let fit: WeaknessGrid['fit'] = null;
  const level = new Map<GridCol, number>();
  if (pts.length >= 8) {
    const byCol = new Map<GridCol, GridPoint[]>();
    for (const p of pts) { const c = gridColumn(p.modalities); byCol.set(c, [...(byCol.get(c) ?? []), p]); }
    let sxy = 0, sxx = 0;
    const means = new Map<GridCol, { mx: number; my: number }>();
    for (const [c, ps] of byCol) {
      const mx = ps.reduce((s, p) => s + Math.log(p.minutes), 0) / ps.length, my = ps.reduce((s, p) => s + Math.log(p.power), 0) / ps.length;
      means.set(c, { mx, my });
      for (const p of ps) { sxy += (Math.log(p.minutes) - mx) * (Math.log(p.power) - my); sxx += (Math.log(p.minutes) - mx) ** 2; }
    }
    const b = sxx ? sxy / sxx : 0;
    for (const [c, m] of means) level.set(c, m.my - b * m.mx);
    const all = pts.map((p) => level.get(gridColumn(p.modalities))!);
    fit = { a: all.reduce((s, x) => s + x, 0) / all.length, b };
  }
  const resid = (p: GridPoint) => (fit ? Math.exp(Math.log(p.power) - (level.get(gridColumn(p.modalities))! + fit.b * Math.log(p.minutes))) - 1 : 0);
  const exp12 = exposure.filter((e) => e.date > yearAgo && e.date <= asOf && e.timeDomain && e.timeDomain !== 'heavy' && e.modalities?.length);
  const pct = (x: number | undefined) => (x === undefined ? null : Math.round(x * 100));

  const cells: GridCell[] = [];
  for (const row of GRID_ROWS) for (const col of GRID_COLS) {
    const inCell = pts.filter((p) => gridRow(p.minutes) === row && gridColumn(p.modalities) === col);
    const rs = inCell.map(resid);
    const recentRs = inCell.filter((p) => p.date > yearAgo).map(resid), priorRs = inCell.filter((p) => p.date <= yearAgo).map(resid);
    const done = exp12.filter((e) => e.timeDomain === row && gridColumn(e.modalities!) === col).length;
    cells.push({
      row, col, n: inCell.length, vsCurve: fit ? pct(median(rs)) : null,
      recent: fit && recentRs.length >= 3 ? pct(median(recentRs)) : null, prior: fit && priorRs.length >= 3 ? pct(median(priorRs)) : null,
      done12m: done, share12m: exp12.length ? Math.round((done / exp12.length) * 100) : 0,
      confidence: inCell.length >= 8 ? 'good' : inCell.length >= 4 ? 'some' : 'too few', flag: null,
      examples: inCell.map((p) => ({ id: p.id, name: p.name, date: p.date, minutes: p.minutes, vsCurve: Math.round(resid(p) * 100) }))
        .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6),
    });
  }
  // Declining: the same kind of workout, measured by the same rule in both periods, at least 10 points lower in the last
  // 12 months than in the 2 years before (3+ results in each). The level against the curve is shown but not flagged:
  // within one modality it mixes the person with how the modality is measured.
  for (const c of cells) if (c.recent !== null && c.prior !== null && c.recent <= c.prior - 10) {
    c.flag = 'weak'; c.why = `${c.prior - c.recent} points lower in the last 12 months than in the 2 years before (${c.n} results)`;
  }
  // Rarely trained: done at most once in the last 12 months, though it was part of training before (3+ results in the
  // window), so it has dropped out rather than never being part of the style.
  for (const c of cells) if (!c.flag && c.done12m <= 1 && c.n >= 3) {
    c.flag = 'rare'; c.why = `done ${c.done12m} time${c.done12m === 1 ? '' : 's'} in the last 12 months, ${c.n} in the 3 years`;
  }
  return { from, to: asOf, fit, cells, counted: pts.length, done12m: exp12.length };
}

/**
 * Planner input: how much each cell should be favoured, 0–1, averaged over the people who train together. Declining
 * cells score by how much they dropped (30 points = 1); rarely trained cells score 0.25.
 */
export function plannerWeakness(grids: WeaknessGrid[]): Map<string, number> {
  const out = new Map<string, number>();
  if (!grids.length) return out;
  for (const row of GRID_ROWS) for (const col of GRID_COLS) {
    let sum = 0;
    for (const g of grids) {
      const c = g.cells.find((x) => x.row === row && x.col === col);
      if (c?.flag === 'weak') sum += Math.min(1, (c.prior! - c.recent!) / 30);
      else if (c?.flag === 'rare') sum += 0.25;
    }
    const v = sum / grids.length;
    if (v > 0) out.set(cellKey(row, col), Math.round(v * 100) / 100);
  }
  return out;
}
