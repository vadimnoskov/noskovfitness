import { describe, expect, it } from 'vitest';
import { METHODOLOGY_CARDS, SOURCES, AREAS, mergeCards, settingAt, firedCounts, DEFAULT_POLICY } from '../src/index';

describe('knowledge cards', () => {
  const ids = new Set(METHODOLOGY_CARDS.map((c) => c.id));
  it('have unique ids, known areas and sources', () => {
    expect(ids.size).toBe(METHODOLOGY_CARDS.length);
    const areas = new Set(AREAS.map((a) => a.id));
    for (const c of METHODOLOGY_CARDS) {
      expect(areas.has(c.area), c.id).toBe(true);
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      for (const s of c.sources) expect(SOURCES[s.doc], `${c.id} → ${s.doc}`).toBeDefined();
    }
  });
  it('link only to existing cards', () => {
    for (const c of METHODOLOGY_CARDS) for (const l of c.links ?? []) expect(ids.has(l.to), `${c.id} → ${l.to}`).toBe(true);
  });
  it('name settings that exist in the policy', () => {
    for (const c of METHODOLOGY_CARDS) for (const p of c.engine?.settings ?? []) {
      if (p === 'trainingDays') continue; // group setting, not policy
      expect(settingAt(DEFAULT_POLICY, p), `${c.id} → ${p}`).toBeDefined();
    }
  });
  it('explain what is open on every gap and disputed card', () => {
    for (const c of METHODOLOGY_CARDS) if (c.status === 'gap' || c.status === 'disputed') expect(c.open, c.id).toBeTruthy();
  });
  it('carry the planner notes that match their rules', () => {
    const counts = firedCounts(METHODOLOGY_CARDS, ['heavy two days in a row (yesterday): allowed occasionally', 'Back Squat test due (last 2026-08-01)', 'benchmark due']);
    expect(counts['heavy-back-to-back']).toBe(1);
    expect(counts['heavy-lift-retests']).toBe(1);
    expect(counts['var-benchmarks']).toBe(1);
  });
  it('merge the coach\'s status and note on top', () => {
    const [m] = mergeCards(METHODOLOGY_CARDS.filter((c) => c.id === 'cond-lsd'), [{ cardId: 'cond-lsd', status: 'confirmed', coachNote: 'Long effort every two weeks.' }]);
    expect(m!.status).toBe('confirmed');
    expect(m!.methodologyStatus).toBe('disputed');
    expect(m!.coachNote).toMatch(/two weeks/);
  });
});

import { MOVEMENT_FACTS, MOVEMENT_GUIDE, FAMILIES } from '../src/index';
describe('movement facts', () => {
  it('cover catalog families and point only at known ones', () => {
    const fam = new Set(FAMILIES.map((f) => f.id));
    const facts = new Set(MOVEMENT_FACTS.map((m) => m.key));
    expect(facts.size).toBe(MOVEMENT_FACTS.length);
    for (const k of facts) expect(fam.has(k), k).toBe(true);
    const missing = [...fam].filter((k) => !facts.has(k));
    expect(missing).toEqual([]);
    for (const g of MOVEMENT_GUIDE) expect(facts.has(g.key), g.key).toBe(true);
  });
});

import { tunableSettings, withSetting } from '../src/index';
describe('teachable settings', () => {
  it('lists numbers and switches with their paths, and replaces one value', () => {
    const t = tunableSettings(DEFAULT_POLICY);
    expect(t.find((x) => x.path === 'rules.heavyExceptionDays')?.value).toBe(28);
    expect(t.find((x) => x.path === 'targets.timeDomain.heavy')?.value).toBe(22);
    expect(t.some((x) => x.path === 'version')).toBe(false);
    const p = withSetting(DEFAULT_POLICY, 'rules.heavyExceptionDays', 21);
    expect(p.rules.heavyExceptionDays).toBe(21);
    expect(DEFAULT_POLICY.rules.heavyExceptionDays).toBe(28);
  });
});
