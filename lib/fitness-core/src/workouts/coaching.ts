/**
 * Plain coaching notes and result comparisons computed from a person's own history.
 * Deliberately simple and transparent; AI-written notes can build on top of these facts later.
 */
import type { Result, Workout } from '../model/types';
import { prescribedReps } from './tags';
import { scoreText } from './format';

export interface PastResult { date: string; score: Result['score']; rx: boolean; completed: boolean }

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

/** Higher is better for every score type (time is negated; a capped result ranks below any finish). */
export function scoreValue(type: Workout['scoreType'], r: Pick<PastResult, 'score' | 'completed'>): number | undefined {
  const s = r.score;
  switch (type) {
    case 'time':
      if (r.completed && s.timeSec) return -s.timeSec;
      return s.reps !== undefined ? -1e9 + s.reps : undefined; // capped: more reps is better, still below any finish
    case 'rounds-reps': return s.rounds !== undefined ? s.rounds * 1000 + (s.reps ?? 0) : undefined;
    case 'load': return s.loads?.length ? Math.max(...s.loads) : undefined;
    case 'reps': return s.reps;
    case 'distance': return s.distanceM;
    case 'calories': return s.calories;
    default: return undefined;
  }
}

export function bestOf<T extends PastResult>(type: Workout['scoreType'], results: T[]): T | undefined {
  const rx = results.filter((r) => r.rx);
  const pool = rx.length ? rx : results;
  let best: T | undefined, bv = -Infinity;
  for (const r of pool) { const v = scoreValue(type, r); if (v !== undefined && v > bv) { bv = v; best = r; } }
  return best;
}

/** Reps per round of a for-time workout, whether written as a scheme (21-15-9) or line by line (a round restarts when the first movement repeats). */
export function roundReps(w: Workout): number[] | undefined {
  const s = w.structure;
  if (s.kind !== 'for-time') return undefined;
  if (s.scheme && s.scheme.length > 1) return s.scheme.map((r) => r * w.movements.length);
  const first = w.movements[0];
  if (!first || w.movements.some((m) => !m.reps)) return undefined;
  const key = JSON.stringify(first.movement);
  const rounds: number[] = [];
  for (const m of w.movements) {
    if (JSON.stringify(m.movement) === key || !rounds.length) rounds.push(0);
    rounds[rounds.length - 1]! += m.reps!;
  }
  return rounds.length > 1 ? rounds : undefined;
}

/** Notes for today's attempt, from the newest-first list of this person's previous results on this workout. */
export function coachingNotes(w: Workout, previous: PastResult[]): string[] {
  const notes: string[] = [];
  const last = previous[0], best = bestOf(w.scoreType, previous);
  const cap = w.structure.kind === 'for-time' ? w.structure.capMin : undefined;
  if (!last) {
    notes.push('First time on this one: start at a pace you can hold, then push the second half.');
    if (cap) notes.push(`Time cap ${cap}:00. Break it into chunks early rather than redlining in round one.`);
    if (w.scoreType === 'load') notes.push('Build in small jumps: empty bar ×10, then about 40%, 60%, 75% of your best guess for 1–3 reps before the working sets.');
    return notes;
  }
  notes.push(`Last time (${last.date}): ${scoreText(last)}${last.rx ? '' : ' scaled'}.${best && best !== last ? ` Best: ${scoreText(best)} (${best.date}).` : ''}`);
  const s = w.structure;
  if (w.scoreType === 'time') {
    const ref = best?.completed && best.score.timeSec ? best.score.timeSec : last.completed ? last.score.timeSec : undefined;
    if (ref) {
      const target = Math.max(60, ref - 15);
      notes.push(`Target: under ${mmss(target)}.`);
      const segs = roundReps(w);
      if (segs && segs.length > 1) {
        const total = segs.reduce((a, b) => a + b, 0);
        let t = 0;
        const splits = segs.map((reps) => { t += (target * reps) / total; return mmss(t); });
        notes.push(`Rough checkpoints for ${segs.length} rounds: ${splits.join(' · ')}.`);
      } else if (s.kind === 'for-time' && s.rounds && s.rounds > 1) {
        notes.push(`About ${mmss(target / s.rounds)} per round.`);
      }
    } else if (!last.completed && last.score.reps !== undefined) {
      const total = prescribedReps(w);
      notes.push(`You were capped at ${last.score.reps}${total ? ` of ${total}` : ''} reps. Aim for ${last.score.reps + Math.max(5, Math.round(last.score.reps * 0.05))}+ today${cap ? ` inside the ${cap}:00 cap` : ''}.`);
    }
  } else if (w.scoreType === 'rounds-reps' && s.kind === 'amrap' && s.minutes) {
    const ref = best ?? last;
    const target = (ref.score.rounds ?? 0) + 1;
    notes.push(`Target: ${target} rounds, about ${mmss((s.minutes * 60) / target)} per round. Settle into that pace in the first two rounds.`);
  } else if (w.scoreType === 'load') {
    const top = Math.max(...(last.score.loads ?? [0]));
    const bestTop = best ? Math.max(...(best.score.loads ?? [0])) : top;
    if (top > 0) {
      notes.push(`Warm-up: empty bar ×10, ${round5(top * 0.4)} ×5, ${round5(top * 0.6)} ×3, ${round5(top * 0.75)} ×2.`);
      if (s.kind === 'sets' && s.scheme.length > 1) {
        const first = round5(top * 0.9), goal = round5(Math.max(top + 5, Math.min(bestTop, top + 15)));
        const step = (goal - first) / (s.scheme.length - 1);
        notes.push(`Working sets: ${s.scheme.map((_, i) => round5(first + step * i)).join(' · ')} (aim to finish at ${goal}).`);
      } else notes.push(`Aim for ${round5(top + 5)}${bestTop > top ? `; your best is ${bestTop}` : ''}.`);
    }
  } else if (w.scoreType === 'reps' && last.score.reps !== undefined) {
    notes.push(`Target: ${last.score.reps + 2}+ reps.`);
  }
  return notes;
}

export interface Comparison { vsLast?: string; vsBest?: string; isBest: boolean; count: number }

/** How a new result compares with this person's earlier results on the same workout (newest first). */
export function compareResult(type: Workout['scoreType'], now: PastResult, previous: PastResult[]): Comparison {
  const v = scoreValue(type, now);
  const describe = (other: PastResult): string | undefined => {
    const o = scoreValue(type, other);
    if (v === undefined || o === undefined) return undefined;
    if (type === 'time' && now.completed && other.completed) {
      const d = (other.score.timeSec ?? 0) - (now.score.timeSec ?? 0);
      return d === 0 ? 'same time' : `${mmss(Math.abs(d))} ${d > 0 ? 'faster' : 'slower'}`;
    }
    if (type === 'time' && now.completed !== other.completed) return now.completed ? 'finished this time (capped before)' : 'capped this time (finished before)';
    if (type === 'time') {
      const d = (now.score.reps ?? 0) - (other.score.reps ?? 0);
      return d === 0 ? 'same reps at the cap' : `${Math.abs(d)} ${d > 0 ? 'more' : 'fewer'} reps at the cap`;
    }
    const d = v - o;
    if (d === 0) return 'same score';
    if (type === 'load') return `${Math.abs(d)} ${d > 0 ? 'heavier' : 'lighter'}`;
    return d > 0 ? 'higher score' : 'lower score';
  };
  const last = previous[0], best = bestOf(type, previous);
  const bestV = best ? scoreValue(type, best) : undefined;
  return {
    ...(last ? { vsLast: describe(last) } : {}),
    ...(best ? { vsBest: describe(best) } : {}),
    isBest: v !== undefined && (bestV === undefined || v > bestV) && (now.rx || !previous.some((p) => p.rx)),
    count: previous.length,
  };
}
