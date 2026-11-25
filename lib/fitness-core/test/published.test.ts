import { describe, expect, it } from 'vitest';
import { parsePublishedRow, cleanTitle, contentSignature } from '../src/index';

const day = (cleanID: string, wodRaw: string) => parsePublishedRow({ title: '', url: '', cleanID, wodRaw });

describe('published workout archive', () => {
  it('reads an old-style Fran with written-out numbers and an inline load', () => {
    const r = day('20080724', '**Fran**\n\nThree rounds, 21-15- and 9 reps, for time of:  \n95 pound Thruster  \nPull-ups  \n\nPost time to comments.');
    expect(r.clean).toBe(true);
    expect(r.name).toBe('Fran');
    expect(r.workout!.structure).toEqual({ kind: 'for-time', scheme: [21, 15, 9] });
    expect(r.workout!.movements.map((m) => m.movement.family)).toEqual(['thruster', 'pull-up']);
    expect(r.workout!.movements[0]!.load).toMatchObject({ male: 95 });
  });
  it('reads a modern day: drops the coaching text, attaches ♀/♂ loads and heights', () => {
    const r = day('20181103', 'Karen\n\nFor time:  \n150 wall-ball shots  \nMen: 20-lb. ball to 10-ft. target  \nWomen: 14-lb. ball to 9-ft. target\n\nScroll for scaling options.\n\n**Stimulus and Strategy:** go fast');
    expect(r.clean).toBe(true);
    expect(r.workout!.movements[0]).toMatchObject({ reps: 150, movement: { family: 'wall-ball' }, load: { male: 20, female: 14 }, heightIn: { male: 120, female: 108 } });
    expect(r.text).not.toMatch(/Stimulus|Scroll/);
  });
  it('reads intervals with rest, AMRAPs and set schemes', () => {
    expect(day('20141002', '10 rounds, each for time of:  \nRow 250 meters  \nRest 2 minutes\n\nPost times').workout!.structure).toEqual({ kind: 'intervals', rounds: 10, restSec: 120, scored: 'time' });
    expect(day('20070108', 'Complete as many rounds in 20 minutes as you can of:  \n65 pound Thruster, 12 reps  \n10 Pull-ups').workout!.structure).toEqual({ kind: 'amrap', minutes: 20 });
    const s = day('20060724', 'Thruster 3-2-2-2-1-1-1-1-1 reps  \n\nPost loads to comments.');
    expect(s.workout).toMatchObject({ structure: { kind: 'sets', scheme: [3, 2, 2, 2, 1, 1, 1, 1, 1] }, scoreType: 'load' });
  });
  it('skips rest days, keeps "compare to" links and flags what it cannot read', () => {
    expect(day('20250911', '**Rest Day**\n\nSome article').restDay).toBe(true);
    expect(day('20220802', 'Run 5,000 meters  \nPost time to comments.  \nCompare to [210325](https://x/210325).').compareTo).toEqual(['2021-03-25']);
    expect(day('20100101', 'For time:\n10 frobnicators\n20 burpees').clean).toBe(false);
  });
  it('reads the cleanup-round patterns', () => {
    const tu = day('20250910', '4 rounds for time of:  \n10 triple-unders  \n20 chest-to-bar pull-ups  \n30 wall-balls shots\n♀ 14-lb medicine ball to a 9-foot target  \n♂ 20-lb medicine ball to a 10-foot target');
    expect(tu.clean).toBe(true);
    expect(tu.workout!.movements[0]!.movement).toMatchObject({ family: 'jump-rope', variant: 'triple-under' });
    const alt = day('20250909', 'Every minute on the minute, alternating, for 12 minutes, complete:  \nOdd minutes: 10 unbroken deadlifts  \nEven minutes: 7 shuttle runs (25 feet out and 25 feet back)');
    expect(alt.workout!.structure).toEqual({ kind: 'emom', minutes: 12 });
    expect(alt.workout!.movements.map((m) => m.movement.family)).toEqual(['deadlift', 'run']);
    const pistols = day('20250905', '3 rounds for time of:  \n10 ring muscle-ups  \n20 alternating weighted single-leg squats  \n400-meter run\n♀ 20-lb dumbbell  \n♂ 35-lb dumbbell');
    expect(pistols.workout!.movements[1]).toMatchObject({ movement: { family: 'pistol', implement: 'dumbbell' }, load: { male: 35, female: 20 } });
    const ots = day('20250903', 'Complete as many rounds and reps as possible in 10 minutes of:  \n5 toes-to-bars  \n3 sandbag over-the-shoulders  \n1 wall walk\n♀ 100-lb sandbag  \n♂ 150-lb sandbag');
    expect(ots.workout!.movements[1]).toMatchObject({ movement: { family: 'over-shoulder' }, load: { male: 150, female: 100 } });
    const tabatas = day('20250804', 'For total reps:\nTabata GHD sit-ups\nTabata Echo bike calories\nTabata GHD hip extensions\nTabata Echo bike calories\nA Tabata interval is 20 seconds of work followed by 10 seconds of rest for 8 intervals.');
    expect(tabatas.clean).toBe(true);
    expect(tabatas.workout!.structure).toEqual({ kind: 'tabata', rounds: 4 });
    const lumber = day('20091205', '"Lumberjack 20"\n20 Deadlifts (275lbs)\nRun 400m\n20 KB swings (2pood)');
    expect(lumber.workout!.movements[0]).toMatchObject({ reps: 20, load: { male: 275 } });
  });
  it('keeps brand names out of titles and matches the same workout across sources', () => {
    expect(cleanTitle('24.1 Rx\'d - CrossFit Games Open')).toBe("24.1 Rx'd - Open");
    expect(cleanTitle('CrossFit Total')).toBe('Total');
    const a = day('20080724', 'Three rounds, 21-15- and 9 reps, for time of:  \n95 pound Thruster  \nPull-ups').workout!;
    const b = day('20210624', '21-15-9 reps for time of:  \nThrusters  \nPull-ups  \n♀ 65 lb. ♂ 95 lb.').workout!;
    expect(contentSignature(a)).toBe(contentSignature(b));
  });
});
