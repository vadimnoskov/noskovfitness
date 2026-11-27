/**
 * Conditioning level and readiness, from each person's own results (Phase 5).
 *
 * Results are compared with the person's own power for that modality at that duration, as on the weakness grid
 * (log power = level per modality + one slope × log minutes, fitted over the window), so different workouts can be
 * compared with each other.
 *
 * Conditioning level (0–1): the person's recent results (last 90 days; 180 if fewer than 4) against their best
 * 12 months in the window, as a share. The coach's starting estimate counts as 3 results' worth, so a handful of
 * results moves it only part of the way and 10+ recent results mostly decide it. It feeds the volume ramp in
 * Individual Rx (Phase 7).
 *
 * Readiness: the last 3 weeks of results against the person's usual over the past year. The one-tap check-in
 * ("How do you feel today?" 1–5) counts only when it has shown it predicts that person's results: at least 10 days
 * with both a check-in and a result, and a correlation of 0.2 or more. Until then it is recorded and shown, not used.
 */
import type { Modality } from '../movements/catalog';
import { gridColumn, median, type GridPoint, type GridCol } from './weakness';

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

/** Each point's distance from the person's own curve (log ratio), fitted over the points given. */
export function residuals(points: GridPoint[]): { p: GridPoint; r: number }[] {
  const pts = points.filter((p) => p.minutes > 0 && p.power > 0 && p.modalities.length);
  if (pts.length < 8) return [];
  const byCol = new Map<GridCol, GridPoint[]>();
  for (const p of pts) { const c = gridColumn(p.modalities as Modality[]); byCol.set(c, [...(byCol.get(c) ?? []), p]); }
  let sxy = 0, sxx = 0;
  const means = new Map<GridCol, { mx: number; my: number }>();
  for (const [c, ps] of byCol) {
    const mx = ps.reduce((s, p) => s + Math.log(p.minutes), 0) / ps.length, my = ps.reduce((s, p) => s + Math.log(p.power), 0) / ps.length;
    means.set(c, { mx, my });
    for (const p of ps) { sxy += (Math.log(p.minutes) - mx) * (Math.log(p.power) - my); sxx += (Math.log(p.minutes) - mx) ** 2; }
  }
  const b = sxx ? sxy / sxx : 0;
  return pts.map((p) => { const m = means.get(gridColumn(p.modalities as Modality[]))!; return { p, r: Math.log(p.power) - (m.my + b * (Math.log(p.minutes) - m.mx)) }; });
}

export interface Conditioning {
  /** 0–1, the blend of data and the coach's estimate; null when neither exists. */
  level: number | null;
  /** From results alone, and how many recent results it rests on. */
  fromData: number | null; recentN: number; recentDays: number;
  prior: number | null;
  /** The best 12 months it is compared with. */
  best: { from: string; to: string; n: number } | null;
  /** Training days per week, last 8 weeks and the 12 months before them. */
  perWeek8: number; perWeekUsual: number;
}

/** `days` = dates with any logged result (for consistency); `points` = results with a power number (5 years is plenty). */
export function conditioning(points: GridPoint[], days: string[], asOf: string, prior: number | null): Conditioning {
  const rs = residuals(points.filter((p) => p.date > addDays(asOf, -5 * 365) && p.date <= asOf));
  let recentDays = 90;
  let recent = rs.filter((x) => x.p.date > addDays(asOf, -90));
  if (recent.length < 4) { recentDays = 180; recent = rs.filter((x) => x.p.date > addDays(asOf, -180)); }
  // Best 12-month median, stepping the window by a month; windows with fewer than 6 results don't count.
  let best: Conditioning['best'] = null, bestMed = -Infinity;
  if (rs.length) {
    const first = rs.reduce((a, x) => (x.p.date < a ? x.p.date : a), asOf);
    for (let end = asOf; end >= addDays(first, 365); end = addDays(end, -30)) {
      const w = rs.filter((x) => x.p.date > addDays(end, -365) && x.p.date <= end);
      const m = w.length >= 6 ? median(w.map((x) => x.r)) : undefined;
      if (m !== undefined && m > bestMed) { bestMed = m; best = { from: addDays(end, -365), to: end, n: w.length }; }
    }
  }
  const recMed = recent.length >= 3 ? median(recent.map((x) => x.r)) : undefined;
  const fromData = recMed !== undefined && best ? Math.min(1, Math.max(0, Math.exp(recMed - bestMed))) : null;
  const n = fromData === null ? 0 : Math.min(recent.length, 10);
  const level = fromData === null ? prior : prior === null ? fromData : (prior * 3 + fromData * n) / (3 + n);
  const uniq = [...new Set(days)];
  const perWeek8 = uniq.filter((d) => d > addDays(asOf, -56) && d <= asOf).length / 8;
  const perWeekUsual = uniq.filter((d) => d > addDays(asOf, -56 - 365) && d <= addDays(asOf, -56)).length / (365 / 7);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { level: level === null ? null : r2(level), fromData: fromData === null ? null : r2(fromData), recentN: recent.length, recentDays,
    prior, best, perWeek8: r2(perWeek8), perWeekUsual: r2(perWeekUsual) };
}

export interface Readiness {
  /** Last 3 weeks' results against the person's usual over the past year, in % (null with fewer than 2 results). */
  recent: number | null; recentN: number;
  checkIn: { pairs: number; correlation: number | null; used: boolean; today: number | null; suggests: number | null };
}

/** `checkIns` = the person's check-ins (date, feeling 1–5). */
export function readiness(points: GridPoint[], checkIns: { date: string; feeling: number }[], asOf: string): Readiness {
  const rs = residuals(points.filter((p) => p.date > addDays(asOf, -365) && p.date <= asOf));
  const usual = median(rs.map((x) => x.r)) ?? 0;
  const last = rs.filter((x) => x.p.date > addDays(asOf, -21));
  const recMed = last.length >= 2 ? median(last.map((x) => x.r)) : undefined;
  // Check-in vs that day's result, against the usual: does feeling predict the day?
  const byDate = new Map(checkIns.map((c) => [c.date, c.feeling]));
  const pairs = rs.filter((x) => byDate.has(x.p.date)).map((x) => ({ f: byDate.get(x.p.date)!, r: x.r - usual }));
  let correlation: number | null = null, slope = 0;
  if (pairs.length >= 3) {
    const mf = pairs.reduce((s, x) => s + x.f, 0) / pairs.length, mr = pairs.reduce((s, x) => s + x.r, 0) / pairs.length;
    const sfr = pairs.reduce((s, x) => s + (x.f - mf) * (x.r - mr), 0), sff = pairs.reduce((s, x) => s + (x.f - mf) ** 2, 0), srr = pairs.reduce((s, x) => s + (x.r - mr) ** 2, 0);
    if (sff > 0 && srr > 0) { correlation = Math.round((sfr / Math.sqrt(sff * srr)) * 100) / 100; slope = sfr / sff; }
    const used0 = pairs.length >= 10 && (correlation ?? 0) >= 0.2;
    const today = byDate.get(asOf) ?? null;
    return { recent: recMed === undefined ? null : Math.round((Math.exp(recMed - usual) - 1) * 100), recentN: last.length,
      checkIn: { pairs: pairs.length, correlation, used: used0, today, suggests: used0 && today !== null ? Math.round((Math.exp(slope * (today - mf)) - 1) * 100) : null } };
  }
  return { recent: recMed === undefined ? null : Math.round((Math.exp(recMed - usual) - 1) * 100), recentN: last.length,
    checkIn: { pairs: pairs.length, correlation, used: false, today: byDate.get(asOf) ?? null, suggests: null } };
}
