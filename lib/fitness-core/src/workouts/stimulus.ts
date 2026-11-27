/**
 * The intended stimulus for a workout, as shown on Today: what kind of effort it is, a completion window, suggested set
 * breaks and checkpoints. Modelled on the L1 lesson plans (Fran, pp. 88–91: "managing extremely high heart rate"; aim
 * under 10 minutes; break the 21s no more than 3 times, the 15s twice, the 9s once), the L2's "forecast a completion
 * window", the L1's three metabolic pathways, and the L2 heavy-day guidance.
 *
 * Generalised from Fran: on demanding movements, at most about one break per 7 reps (21 → 3, 15 → 2, 9 → 1). Easy,
 * cyclical movements (air squats, sit-ups, jump rope, rowing…) get no break advice.
 */
import type { Workout, WorkoutTags, MovementPrescription } from '../model/types';
import { estimateMinutes } from './estimate';
import { FAMILY_BY_ID } from '../movements/catalog';

export interface Stimulus {
  /** One line: the kind of effort. */
  intent: string;
  /** Minutes: the expected finish for a for-time workout. Null for AMRAPs, heavy days and unknown estimates. */
  window: { min: number; max: number; from: 'estimate' | 'your results' } | null;
  /** AMRAPs: the expected rounds. */
  rounds: { min: number; max: number } | null;
  breaks: { movement: string; reps: number; maxBreaks: number; example: string }[];
  checkpoints: string[];
  /** When to scale: e.g. "if your version would take more than 15 minutes, scale reps or load". */
  scaleIf?: string;
  sources: string[];
}

const EASY = new Set(['air-squat', 'sit-up', 'jump-rope', 'jumping-jack', 'mountain-climber', 'hollow', 'plank', 'run', 'row', 'bike', 'ski', 'swim', 'carry', 'walk', 'step-up', 'lunge', 'russian-twist', 'v-up', 'hip-extension']);
const mmss = (min: number) => { const s = Math.round(min * 60); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const round1 = (x: number) => Math.round(x * 2) / 2;

/** Split n reps into k nearly equal sets, biggest first (21, 4 → 6-5-5-5). */
export function splitReps(n: number, k: number): number[] {
  const base = Math.floor(n / k), extra = n % k;
  return Array.from({ length: k }, (_, i) => base + (i < extra ? 1 : 0));
}

function intentOf(tags: WorkoutTags | undefined, w: Workout): string {
  const td = tags?.timeDomain;
  if (td !== 'heavy' && (w.structure.kind === 'sets' || w.structure.kind === 'max')) return 'Sets of a bodyweight movement: quality reps with full range, rest between sets as needed, end a set when the form breaks. Not a heavy day unless the movement is weighted.';
  if (td === 'heavy') return 'Heavy day, strength: 3–5 warm-up sets building up, then working sets of 1–5 reps at about 80–85% of your max or more. Rest as long as you need, 2–5 minutes. End the set when the form breaks.';
  if (w.structure.kind === 'intervals' || w.structure.kind === 'tabata') return 'Intervals: every work piece hard and about the same pace; the rest is part of the workout, so keep it as written.';
  switch (td) {
    case 'short': return 'Sprint, under 4 minutes: close to all-out from the start, very few breaks. Expect it to hurt; that is the point.';
    case 'medium': return 'Hard and fast, 4–12 minutes: a pace you can barely hold, with short, planned breaks before you need them.';
    case 'long': return 'Sustained, 12–20 minutes: a hard pace you can keep. Break sets early and keep the rests short and steady.';
    case 'endurance': return 'Long, 20 minutes or more: steady and repeatable. Keep moving; small rests, no long stops.';
    default: return 'Move well first, then fast.';
  }
}

/** Reps per set for each movement, in order, for one pass (scheme numbers or the movement's own reps). */
function setsOf(w: Workout): { m: MovementPrescription; reps: number }[] {
  const s = w.structure;
  const scheme = 'scheme' in s && s.scheme ? s.scheme : undefined;
  const repMoves = w.movements.filter((m) => !m.distanceM && !m.calories && !(m.seconds && !m.reps));
  if (scheme && repMoves.some((m) => m.reps === undefined)) return scheme.flatMap((n) => repMoves.map((m) => ({ m, reps: m.reps ?? n })));
  return repMoves.filter((m) => m.reps).map((m) => ({ m, reps: m.reps! }));
}

/**
 * Stimulus for a workout (the person's own version). `bestSec`/`lastSec` are the person's earlier times on it, which
 * replace the estimate for the window.
 */
export function stimulusFor(w: Workout, tags: WorkoutTags | undefined, prior?: { bestSec?: number; lastSec?: number }): Stimulus {
  const sources = ['L1: three metabolic pathways', 'L1 lesson plan: Fran'];
  const s = w.structure;
  const out: Stimulus = { intent: intentOf(tags, w), window: null, rounds: null, breaks: [], checkpoints: [], sources };
  if (tags?.timeDomain === 'heavy') { out.sources = ['L2: heavy days']; return out; }
  if (s.kind === 'sets' || s.kind === 'max') { out.sources = ['L1: points of performance and threshold training']; return out; }

  // Window: the person's own times if any, else the calibrated estimate.
  const est = estimateMinutes(w);
  if (s.kind === 'for-time') {
    const ref = prior?.bestSec ?? prior?.lastSec;
    if (ref) { const m = ref / 60; out.window = { min: round1(m * 0.9), max: round1(m * 1.1), from: 'your results' }; }
    else if (est) out.window = { min: round1(est * 0.8), max: round1(est * 1.25), from: 'estimate' };
    if (out.window && s.capMin) out.window.max = Math.min(out.window.max, s.capMin);
    if (out.window && tags?.timeDomain) {
      const limit = { short: 5, medium: 15, long: 25, endurance: undefined, heavy: undefined }[tags.timeDomain];
      if (limit) out.scaleIf = `if your version would take more than about ${limit} minutes, scale reps or load so it stays a ${tags.timeDomain} workout`;
    }
  } else if (s.kind === 'amrap' && s.minutes) {
    const roundMin = estimateMinutes({ ...w, structure: { kind: 'for-time' } });
    if (roundMin) { const r = s.minutes / roundMin; out.rounds = { min: Math.max(1, Math.floor(r * 0.8)), max: Math.max(1, Math.ceil(r * 1.2)) }; }
  }

  // Set breaks on demanding movements: at most about one break per 7 reps.
  const seen = new Set<string>();
  for (const { m, reps } of setsOf(w)) {
    const f = m.movement.family;
    if (EASY.has(f) || FAMILY_BY_ID[f]?.modality === 'M' || reps < 9) continue;
    const key = `${f}|${reps}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const maxBreaks = Math.max(1, Math.round(reps / 7));
    out.breaks.push({ movement: FAMILY_BY_ID[f]?.name ?? f, reps, maxBreaks, example: splitReps(reps, maxBreaks + 1).join('-') });
  }

  // Checkpoints from the window's middle, round by round (for-time with several rounds or a rep scheme).
  if (out.window && s.kind === 'for-time') {
    const mid = (out.window.min + out.window.max) / 2;
    const scheme = 'scheme' in s && s.scheme ? s.scheme : undefined;
    const parts = scheme ?? (s.rounds && s.rounds > 1 ? Array(s.rounds).fill(1) : undefined);
    if (parts && parts.length > 1) {
      const total = parts.reduce((a: number, b: number) => a + b, 0);
      let t = 0;
      out.checkpoints = parts.map((p: number, i: number) => { t += (mid * p) / total; return `${scheme ? `after the ${p}s` : `round ${i + 1}`} ${mmss(t)}`; });
    }
  }
  return out;
}
