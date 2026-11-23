import { describe, expect, it } from 'vitest';
import { parseBtwbRow, coachingNotes, compareResult, prescribedReps, capFromText } from '../src/index';

const row = (Workout: string, Description: string, fr: string) => parseBtwbRow({ Date: '2025-01-01', Workout, Description, 'Formatted Result': fr, Result: '0', Performed: 'prescribed', Notes: '' }, 'male').workout;
const fran = row('Fran', '21 Thrusters 95 lbs\n21 Pull-ups\n15 Thrusters 95 lbs\n15 Pull-ups\n9 Thrusters 95 lbs\n9 Pull-ups', '5 mins');
const w241 = row('24.1', '21 Dumbbell Snatches, 50 lbs\n21 Lateral Burpee Over Dumbbells\n15 Dumbbell Snatches, 50 lbs\n15 Lateral Burpee Over Dumbbells\n9 Dumbbell Snatches, 50 lbs\n9 Lateral Burpee Over Dumbbells\nTime cap: 15 mins', '14 mins');

describe('time caps', () => {
  it('reads the cap from the workout text and counts total reps', () => {
    expect(capFromText('Time cap: 15 mins')).toBe(15);
    expect(capFromText('For Time (15 Min Cap):')).toBe(15);
    expect(w241.structure).toMatchObject({ kind: 'for-time', capMin: 15 });
    expect(prescribedReps(w241)).toBe(90);
  });
});

describe('coaching notes', () => {
  it('uses last and best results to set a target with checkpoints', () => {
    const notes = coachingNotes(fran, [{ date: '2025-07-13', score: { timeSec: 304 }, rx: true, completed: true }, { date: '2021-12-17', score: { timeSec: 240 }, rx: true, completed: true }]);
    expect(notes[0]).toContain('Last time (2025-07-13): 5:04');
    expect(notes[0]).toContain('Best: 4:00');
    expect(notes.join(' ')).toMatch(/Target: under 3:45/);
    expect(notes.join(' ')).toMatch(/checkpoints for 3 rounds: 1:45 · 3:00 · 3:45/);
  });
  it('gives warm-up and working sets for strength from the last top set', () => {
    const bs = row('Back Squat : 5-5-5-5-5', 'Sets\n5 Back Squats', '1000 lbs');
    const notes = coachingNotes(bs, [{ date: '2026-01-22', score: { loads: [135, 155, 165, 185, 205] }, rx: true, completed: true }]);
    expect(notes.join(' ')).toMatch(/Warm-up: empty bar ×10, 80 ×5, 125 ×3, 155 ×2/);
    expect(notes.join(' ')).toMatch(/Working sets: 185 · .* · 210/);
  });
  it('says something useful the first time', () => {
    expect(coachingNotes(w241, [])[0]).toMatch(/First time/);
  });
});

describe('comparison after logging', () => {
  it('compares with last and best and spots a new best', () => {
    const prev = [{ date: '2025-07-13', score: { timeSec: 304 }, rx: true, completed: true }, { date: '2021-12-17', score: { timeSec: 240 }, rx: true, completed: true }];
    expect(compareResult('time', { date: 'now', score: { timeSec: 289 }, rx: true, completed: true }, prev)).toEqual({ vsLast: '0:15 faster', vsBest: '0:49 slower', isBest: false, count: 2 });
    expect(compareResult('time', { date: 'now', score: { reps: 150 }, rx: true, completed: false }, prev).vsLast).toBe('capped this time (finished before)');
    const capped = [{ date: 'd', score: { reps: 140 }, rx: true, completed: false }];
    expect(compareResult('time', { date: 'now', score: { reps: 150 }, rx: true, completed: false }, capped).vsLast).toBe('10 more reps at the cap');
    expect(compareResult('time', { date: 'now', score: { timeSec: 230 }, rx: true, completed: true }, prev).isBest).toBe(true);
    expect(compareResult('time', { date: 'now', score: { reps: 80 }, rx: true, completed: false }, prev).isBest).toBe(false);
  });
});
