import { useSearch } from 'wouter';
import type { ProgrammingPolicy } from '@workspace/fitness-core';
import { DOW } from '@/lib/dates';
import { usePage, PageStatus, ActionForm } from '@/lib/api';
import { LibrarySection } from '@/components/LibrarySection';

const LABELS: Record<string, string> = {
  movementCount: 'Movements per workout', timeDomain: 'Time domain', priority: 'Priority', load: 'Load', modality: 'Modality (share of movements)',
  '1': '1 (single)', '2-3': '2–3 (couplet, triplet)', '4+': '4 or more', short: 'Short (< 4 min)', medium: 'Medium (4–12)', long: 'Long (12–20)', endurance: 'Endurance (20+)',
  'load.medium': 'Medium', 'load.light': 'Light', 'load.heavy': 'Heavy',
  task: 'Task priority (for time)', time: 'Time priority (AMRAP, EMOM)', bodyweight: 'Bodyweight', light: 'Light', heavy: 'Heavy',
  G: 'Gymnastics', W: 'Weightlifting', M: 'Monostructural', variety: 'Variety gap', freshness: 'Movement freshness', weakness: 'Weakness focus', benchmark: 'Benchmark due',
};

type Profile = ProgrammingPolicy['targets'] & { workouts: number };
type SettingsData = { policy: ProgrammingPolicy; group: { training_days: number[]; default_equipment_id?: string | null }; profiles: { id: string; name: string }[];
  published?: { all: Profile; era: Profile; blend: Profile; eraLabel: string } };

export default function Settings() {
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { saved?: string };
  const q = usePage<SettingsData>({ screen: 'settings' });
  if (!q.data) return <><h1>Programming settings</h1><PageStatus q={q} /></>;
  const { policy, group, profiles, published } = q.data;
  const pub = (g: string, k: string) => (published ? (published.blend as unknown as Record<string, Record<string, number>>)[g]?.[k] : undefined);
  return (
    <>
      <h1>Programming settings</h1>
      <p className="small">Everything the engine uses. Targets are the share (%) of workouts you want in each bucket over the last {policy.windowDays} days; each group should add up to about 100. Version {policy.version}.</p>
      {sp.saved ? <p className="ok">Saved. New proposals use these settings; approved days are not changed.</p> : null}
      {published ? (
        <div className="profile-note">
          <p className="small">
            <b>Measured from the published programming</b> ({published.all.workouts.toLocaleString()} workouts, 2005 on, with the {published.eraLabel} weighted to a quarter):
            shown as "published" next to each target below. For example, {published.blend.priority.task}% of published workouts are for time, {published.blend.load.heavy}% are heavy days,
            and {published.blend.movementCount['1']}% are a single movement.
          </p>
          <ActionForm action="usePublishedProfileAction"><button className="btn">Use the published mix as my targets</button></ActionForm>
        </div>
      ) : null}
      <ActionForm key={policy.version} action="savePolicyAction" className="settings">
        <fieldset><legend>Schedule</legend>
          <div className="bar">{DOW.map((d, i) => <label key={d} className="check"><input type="checkbox" name="trainingDays" value={i + 1} defaultChecked={group.training_days.includes(i + 1)} /> {d}</label>)}</div>
          <label>Default location <select name="defaultEquipmentId" defaultValue={group.default_equipment_id ?? 'gym'}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Variety window (days) <input type="number" name="windowDays" min={7} max={120} defaultValue={policy.windowDays} /></label>
        </fieldset>
        {(Object.entries(policy.targets) as [string, Record<string, number>][]).map(([g, rec]) => {
          const sum = Object.values(rec).reduce((a, b) => a + b, 0);
          return (
            <fieldset key={g}><legend>{LABELS[g]} <span className={sum === 100 ? 'small' : 'warn'}>total {sum}%</span></legend>
              {Object.entries(rec).map(([k, v]) => <label key={k}>{LABELS[`${g}.${k}`] ?? LABELS[k] ?? k} <input type="number" name={`${g}.${k}`} min={0} max={100} defaultValue={v} />%{pub(g, k) !== undefined ? <span className="small pub"> published {pub(g, k)}%</span> : null}</label>)}
            </fieldset>
          );
        })}
        <fieldset><legend>How the engine ranks candidates (relative weights)</legend>
          {Object.entries(policy.weights).map(([k, v]) => <label key={k}>{LABELS[k]} <input type="number" name={`weights.${k}`} min={0} max={100} defaultValue={v} /></label>)}
          <p className="small">Weakness focus has no effect until fitness profiles are built; it is capped so variety always leads.</p>
        </fieldset>
        <fieldset><legend>Rules</legend>
          <label>Don't repeat a workout within (days) <input type="number" name="rules.noRepeatWorkoutDays" min={0} max={730} defaultValue={policy.rules.noRepeatWorkoutDays} /></label>
          <p className="small">Stops the engine proposing the exact same workout again too soon, so variety comes from new workouts rather than favorites. With about 5 workouts a week, 180 days means roughly 130 other workouts before a repeat. 90–180 is a sensible range: lower means familiar workouts come back more often, higher means more novelty. It never blocks you: benchmarks follow their own retest intervals, you can pick any workout for a day yourself, and a workout can be set to repeat on its own schedule (Program → More… → Repeat).</p>
          <label>Max benchmarks per week <input type="number" name="rules.maxBenchmarksPerWeek" min={0} max={7} defaultValue={policy.rules.maxBenchmarksPerWeek} /></label>
          <label>Longest workout (minutes) <input type="number" name="rules.maxMinutes" min={5} max={120} defaultValue={policy.rules.maxMinutes} /></label>
          <label>People training together <input type="number" name="rules.groupSize" min={1} max={30} defaultValue={policy.rules.groupSize} /></label>
          <label className="check"><input type="checkbox" name="rules.noSameMovementConsecutiveDays" defaultChecked={policy.rules.noSameMovementConsecutiveDays} /> No movement on two consecutive days</label>
          <label className="check"><input type="checkbox" name="rules.noConsecutiveHeavyDays" defaultChecked={policy.rules.noConsecutiveHeavyDays} /> No heavy days back to back</label>
        </fieldset>
        <div className="bar"><button className="btn primary" type="submit">Save settings</button></div>
      </ActionForm>
      <ActionForm action="resetPolicyAction"><button className="btn ghost">Reset targets, weights and rules to defaults</button></ActionForm>
      <LibrarySection />
    </>
  );
}
