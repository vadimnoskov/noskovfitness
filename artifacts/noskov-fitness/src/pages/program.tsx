import { Link, useSearch } from 'wouter';
import { movementLine, structureLabel, workoutTitle, type ScoreBreakdown } from '@workspace/fitness-core';
import type { PlannedDay } from '@/lib/data';
import { addDays, weekStart, longDate, DOW } from '@/lib/dates';
import { Chips } from '@/components/Chips';
import { usePage, PageStatus, ActionForm } from '@/lib/api';

const today = () => new Date().toISOString().slice(0, 10);

type ProgramData = { days: PlannedDay[]; profiles: { id: string; name: string }[]; group: { training_days: number[]; default_equipment_id?: string | null } };

export default function ProgramPage() {
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { from?: string; weeks?: string };
  const from = sp.from && /^\d{4}-\d\d-\d\d$/.test(sp.from) ? sp.from : weekStart(today());
  const weeks = Math.min(8, Math.max(1, Number(sp.weeks) || 4));
  const to = addDays(from, weeks * 7 - 1);
  const q = usePage<ProgramData>({ screen: 'program', from, to });
  if (!q.data) return <><h1>Program</h1><PageStatus q={q} /></>;
  const { days, profiles, group } = q.data;
  const proposed = days.filter((d) => d.status === 'proposed').length;
  const trainingNames = group.training_days.map((d) => DOW[d - 1]).join(', ');

  return (
    <>
      <h1>Program</h1>
      <p className="small">The engine proposes a workout for each training day ({trainingNames}); you approve, swap, move or skip. Approved days are kept when you re-plan. Settings for targets and rules are on the <Link href="/settings">Settings</Link> page.</p>

      <div className="panel">
        <ActionForm key={from + weeks} action="propose" className="bar">
          <label>From <input type="date" name="from" defaultValue={from} required /></label>
          <label>Weeks <select name="weeks" defaultValue={String(weeks)}>{[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
          <button className="btn primary" type="submit">Propose workouts</button>
        </ActionForm>
        <div className="bar">
          <ActionForm action="approveAll"><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><button className="btn" disabled={!proposed}>Approve all {proposed} proposed</button></ActionForm>
          <ActionForm action="replan"><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><button className="btn" disabled={!proposed}>Re-plan proposed days</button></ActionForm>
          <ActionForm action="insert" className="bar" style={{ margin: 0 }}><label>Extra day <input type="date" name="date" min={from} required /></label><button className="btn">Add workout</button></ActionForm>
        </div>
        <div className="bar small">
          <Link className="btn" href={`/program?from=${addDays(from, -7 * weeks)}&weeks=${weeks}`}>← Earlier</Link>
          <span>{longDate(from)} – {longDate(to)}</span>
          <Link className="btn" href={`/program?from=${addDays(from, 7 * weeks)}&weeks=${weeks}`}>Later →</Link>
        </div>
      </div>

      {!days.length ? <p className="empty">No workouts planned in this range yet. Choose a start date and press "Propose workouts".</p> : null}
      <div className="days">
        {days.map((d) => <DayCard key={d.id} d={d} profiles={profiles.map((p) => ({ id: p.id, name: p.name }))} />)}
      </div>
    </>
  );
}

function ScoreBars({ s }: { s?: ScoreBreakdown }) {
  if (!s) return null;
  const rows: [string, number][] = [['variety', s.variety], ['freshness', s.freshness], ['benchmark', s.benchmark], ['weakness', s.weakness]];
  return (
    <div className="score" title={`total ${s.total}${s.penalty ? `, penalty ${s.penalty}` : ''}`}>
      {rows.map(([k, v]) => <div key={k} className="sr"><span>{k}</span><div className="trk"><div className="fill" style={{ width: `${Math.round(v * 100)}%` }} /></div></div>)}
      {s.notes.length ? <div className="small">{s.notes.join(' · ')}</div> : null}
    </div>
  );
}

function DayCard({ d, profiles }: { d: PlannedDay; profiles: { id: string; name: string }[] }) {
  const title = workoutTitle({ ...d.workout, benchmark: d.benchmark as never });
  const isBm = d.benchmark && d.benchmark.category !== 'lift';
  return (
    <article className={`day ${d.status}`}>
      <header>
        <div><b>{longDate(d.date)}</b> <span className={`status ${d.status}`}>{d.status}</span>{d.origin.by === 'coach' ? <span className="small"> · your choice</span> : null}</div>
        <ActionForm action="setLocation" className="loc">
          <input type="hidden" name="id" value={d.id} />
          <select name="equipmentId" defaultValue={d.equipmentId ?? ''} aria-label="Location">{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <button className="btn sm">Set</button>
        </ActionForm>
      </header>
      <Chips mods={d.tags.modalityPattern} load={d.tags.load} volume={d.tags.volume} priority={d.tags.priority} />
      <h3>{isBm ? <span className="bm">★ </span> : null}{title}</h3>
      <div className="small">{structureLabel(d.workout.structure)}</div>
      <ul className="mv">{d.workout.movements.map((m, i) => <li key={i}>{movementLine(m)}</li>)}</ul>
      {d.warnings.length ? <p className="warn">{d.warnings.join(' · ')}</p> : null}
      {d.origin.by === 'engine' ? <ScoreBars s={d.origin.score} /> : null}
      <div className="actions">
        {d.status === 'proposed' ? <ActionForm action="approve"><input type="hidden" name="id" value={d.id} /><button className="btn primary">Approve</button></ActionForm> : null}
        {d.status === 'approved' ? <ActionForm action="unapprove"><input type="hidden" name="id" value={d.id} /><button className="btn">Back to proposed</button></ActionForm> : null}
        {d.status !== 'done' && d.status !== 'skipped' ? (
          <>
            <ActionForm action="skip"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="mode" value="push" /><button className="btn" title="Move this and all later open days to the next training day">Push forward</button></ActionForm>
            <ActionForm action="skip"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="mode" value="drop" /><button className="btn">Skip</button></ActionForm>
          </>
        ) : null}
        {d.status === 'proposed' ? <ActionForm action="neverPropose"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="workoutId" value={d.workoutId} /><button className="btn ghost" title="Exclude this workout from future proposals">Never propose</button></ActionForm> : null}
      </div>
      {d.alternatives.length && d.status !== 'done' ? (
        <details className="alts">
          <summary>Alternatives ({d.alternatives.length})</summary>
          {d.alternatives.map((a) => a.workout && a.tags ? (
            <ActionForm key={a.candidateId} action="swap" className="alt">
              <input type="hidden" name="id" value={d.id} /><input type="hidden" name="workoutId" value={a.candidateId} />
              <div>
                <Chips mods={a.tags.modalityPattern} load={a.tags.load} volume={a.tags.volume} priority={a.tags.priority} />
                <b>{workoutTitle({ ...a.workout })}</b>
                <div className="small">{a.workout.movements.slice(0, 5).map((m) => movementLine(m)).join(' · ')} · score {a.score.total}{a.score.notes.length ? ` · ${a.score.notes.join(', ')}` : ''}</div>
              </div>
              <button className="btn sm">Use this</button>
            </ActionForm>
          ) : null)}
        </details>
      ) : null}
    </article>
  );
}
