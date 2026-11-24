import { describe, expect, it } from 'vitest';
import { parseBtwbRow, suggestWarmUp, warmUpText, parseNoteText, deriveTags } from '../src/index';

const row = (Workout: string, Description: string, fr = '10 mins') => parseBtwbRow({ Date: '2025-01-01', Workout, Description, 'Formatted Result': fr, Result: '0', Performed: 'prescribed', Notes: '' }, 'male').workout;

describe('suggested warm-ups', () => {
  it('rehearses the day\'s movements and primes a short, hard workout', () => {
    const w = suggestWarmUp(row('Fran', '21 Thrusters 95 lbs\n21 Pull-ups\n15 Thrusters 95 lbs\n15 Pull-ups\n9 Thrusters 95 lbs\n9 Pull-ups', '5 mins'));
    expect(w.general[1]).toMatch(/pass-throughs/);
    expect(w.specific.join(' | ')).toMatch(/thrusters.*\|.*kip swings/);
    expect(w.primer).toBeDefined();
    expect(w.minutes).toBeGreaterThanOrEqual(10);
    expect(w.minutes).toBeLessThanOrEqual(16);
  });
  it('starts a running workout with a jog and keeps a long workout\'s warm-up shorter, with no primer', () => {
    const dh = row('Double Helen', '3 rounds of:\nRun, 800 m\n42 Kettlebell Swings, 1.5 pood\n24 Pull-ups', '30 mins');
    const w = suggestWarmUp(dh, deriveTags(dh, { resultSec: 1800 }));
    expect(w.general[0]).toMatch(/Jog 400 m/);
    expect(w.general[1]).toMatch(/^1 round:/);
    expect(w.primer).toBeUndefined();
    expect(w.specific.join(' ')).toMatch(/A-skips.*swings|swings.*A-skips/s);
  });
  it('gives a 12–20 minute workout the full warm-up without a primer', () => {
    const w241 = row('24.1', '21 Dumbbell Snatches, 50 lbs\n21 Lateral Burpee Over Dumbbells\nTime cap: 15 mins', '14 mins');
    const w = suggestWarmUp(w241, deriveTags(w241, { resultSec: 14 * 60 }));
    expect(w.general[1]).toMatch(/^2 rounds:/);
    expect(w.specific.at(-1)).toMatch(/1–2 easy rounds/);
    expect(w.primer).toBeUndefined();
  });
  it('treats the build-up sets as the warm-up on a heavy lifting day', () => {
    const w = suggestWarmUp(row('Back Squat', 'Back Squat 5-5-5-5-5', '225 lbs'));
    expect(w.primer).toBeUndefined();
    expect(w.specific.at(-1)).toMatch(/build up with the sets/);
  });
  it('uses the Burgener drill for barbell snatches and a dumbbell drill for dumbbell snatches', () => {
    expect(suggestWarmUp(row('Isabel', '30 Snatches, 135 lbs', '4 mins')).specific[0]).toMatch(/Burgener/);
    expect(suggestWarmUp(row('24.1', '21 Dumbbell Snatches, 50 lbs\n21 Lateral Burpee Over Dumbbells\nTime cap: 15 mins', '12 mins')).specific[0]).toMatch(/Light dumbbell, per arm/);
  });
});

describe('note text format', () => {
  it('round-trips headings and items, and keeps plain paragraphs', () => {
    const blocks = parseNoteText(warmUpText({ minutes: 10, general: ['Jog'], specific: ['Drill'], primer: 'Go' }));
    expect(blocks.map((b) => b.heading)).toEqual(['General', 'Specific', 'Primer']);
    expect(blocks[1]!.items).toEqual(['Drill']);
    const plan = parseNoteText('Go out steady and hold pace.\n- Break pull-ups early\n- Breathe at the top of the thruster');
    expect(plan[0]!.paragraphs).toEqual(['Go out steady and hold pace.']);
    expect(plan[0]!.items).toHaveLength(2);
  });
});
