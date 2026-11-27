import { describe, expect, it } from 'vitest';
import { parsePublishedRow, estimateMinutes, styleProfile, deriveTags } from '../src/index';

const w = (txt: string) => parsePublishedRow({ title: '', url: '', cleanID: '20190101', wodRaw: txt }).workout!;

describe('time estimates', () => {
  it('puts classic benchmarks in the right time domain', () => {
    const fran = estimateMinutes(w('21-15-9 reps for time of:\nThrusters\nPull-ups\n♀ 65 lb ♂ 95 lb'))!;
    expect(fran).toBeGreaterThan(2.5); expect(fran).toBeLessThan(7);
    const helen = estimateMinutes(w('3 rounds for time of:\nRun 400 meters\n21 kettlebell swings\n12 pull-ups'))!;
    expect(helen).toBeGreaterThan(7); expect(helen).toBeLessThan(15);
    const murphish = estimateMinutes(w('For time:\nRun 1 mile\n100 pull-ups\n200 push-ups\n300 squats\nRun 1 mile'))!;
    expect(murphish).toBeGreaterThan(35);
  });
  it('does not repeat a scheme over a movement list that is already expanded round by round', () => {
    const fran = w('21-15-9 reps for time of:\nThrusters\nPull-ups\n♀ 65 lb ♂ 95 lb');
    const s = fran.structure as { scheme?: number[] };
    expect(s.scheme).toEqual([21, 15, 9]);
    // As imports store it: the scheme kept, and one entry per round with its own reps.
    const expanded = { ...fran, movements: s.scheme!.flatMap((n) => fran.movements.map((m) => ({ ...m, reps: n }))) };
    expect(expanded.movements).toHaveLength(6);
    expect(estimateMinutes(expanded)).toBe(estimateMinutes(fran));
  });
  it('uses fixed times for AMRAPs and caps, and does not estimate strength sets', () => {
    expect(estimateMinutes(w('Complete as many rounds as possible in 20 minutes of:\n5 pull-ups\n10 push-ups\n15 squats'))).toBe(20);
    expect(estimateMinutes(w('Back squat 5-5-5-5-5 reps'))).toBeUndefined();
    expect(estimateMinutes(w('For time:\n150 wall-ball shots\nTime cap: 5 minutes'))).toBeLessThanOrEqual(5);
    expect(deriveTags(w('21-15-9 reps for time of:\nThrusters\nPull-ups\n♀ 65 lb ♂ 95 lb')).timeDomain).toBe('medium');
  });
});

describe('style profile', () => {
  it('returns shares in the targets\' buckets that add up to 100', () => {
    const t = deriveTags(w('21-15-9 reps for time of:\nThrusters\nPull-ups\n♀ 65 lb ♂ 95 lb'));
    const s = deriveTags(w('Back squat 5-5-5-5-5 reps'));
    const p = styleProfile([{ tags: t, weight: 3 }, { tags: s, weight: 1 }]);
    expect(p.movementCount).toEqual({ '1': 25, '2-3': 75, '4+': 0 });
    expect(Object.values(p.load).reduce((a, b) => a + b, 0)).toBe(100);
    expect(p.load.heavy).toBe(25);
  });
});
