import { useEffect, useState, type DragEvent } from 'react';
import { Link, useSearch } from 'wouter';
import { WarmUpEditor, type DayWarmUp } from '@/components/WarmUp';
import { useFitnessAction, useSearchWorkouts, getSearchWorkoutsQueryKey } from '@workspace/api-client-react';
import { movementLine, structureLabel, workoutTitle, type ScoreBreakdown, type Workout } from '@workspace/fitness-core';
import type { PlannedDay as BasePlannedDay } from '@/lib/data';
import { addDays, weekStart, longDate, short, DOW } from '@/lib/dates';
import { Chips } from '@/components/Chips';
import { usePage, PageStatus, ActionForm } from '@/lib/api';

type PlannedDay = BasePlannedDay & { repeat?: { everyDays: number; until: string | null } | null; warmUp: DayWarmUp };
type ProgramData = { days: PlannedDay[]; profiles: { id: string; name: string }[]; group: { training_days: number[]; default_equipment_id?: string | null } };
type Profile = { id: string; name: string };

const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const ZOOMS = ['Compact', 'Normal', 'Detailed'] as const;

/** Run a coach action from code (drag & drop, pick a workout) and reload, like the form-based actions do. */
function useRun() {
  const m = useFitnessAction();
  const run = (action: Parameters<typeof m.mutate>[0]['action'], data: Record<string, string>) =>
    m.mutate({ action, data }, { onSuccess: () => window.location.reload() });
  return { run, pending: m.isPending, error: m.error as { data?: { error?: string } } | null };
}

export default function ProgramPage() {
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { from?: string; weeks?: string };
  const from = weekStart(sp.from && /^\d{4}-\d\d-\d\d$/.test(sp.from) ? sp.from : localToday());
  const weeks = Math.min(8, Math.max(1, Number(sp.weeks) || 2));
  const to = addDays(from, weeks * 7 - 1);
  const [zoom, setZoom] = useState<number>(() => { try { return Number(localStorage.getItem('nf-program-zoom') ?? 1); } catch { return 1; } });
  useEffect(() => { try { localStorage.setItem('nf-program-zoom', String(zoom)); } catch { /* private mode */ } }, [zoom]);
  const q = usePage<ProgramData>({ screen: 'program', from, to });
  const { run, pending, error } = useRun();
  const [dragId, setDragId] = useState<string | null>(null);
  if (!q.data) return <><h1>Program</h1><PageStatus q={q} /></>;
  const { days, profiles, group } = q.data;
  const proposed = days.filter((d) => d.status === 'proposed').length;
  const trainingNames = group.training_days.map((d) => DOW[d - 1]).join(', ');
  const today = localToday();

  const onDrop = (date: string) => (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || dragId;
    setDragId(null);
    if (id) run('move', { id, date });
  };

  return (
    <>
      <h1>Program</h1>
      <p className="small">The engine proposes a workout for each training day ({trainingNames}). Approve, or drag a workout to another day: onto an empty day it moves (the old day becomes rest), onto another workout the two swap. "More…" on each day has move, time cap, repeat, pick any workout and alternatives. Targets and rules are in <Link href="/settings">Settings</Link>.</p>

      <div className="panel">
        <ActionForm key={from + weeks} action="propose" className="bar">
          <label>From <input type="date" name="from" defaultValue={from} required /></label>
          <label>Weeks <select name="weeks" defaultValue={String(weeks)}>{[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
          <button className="btn primary" type="submit">Propose workouts</button>
        </ActionForm>
        <div className="bar">
          <ActionForm action="approveAll"><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><button className="btn" disabled={!proposed}>Approve all {proposed} proposed</button></ActionForm>
          <ActionForm action="replan"><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><button className="btn" disabled={!proposed}>Re-plan proposed days</button></ActionForm>
          <span style={{ flex: 1 }} />
          <span className="zoom" role="group" aria-label="Zoom">
            <button className="btn sm" type="button" onClick={() => setZoom(Math.max(0, zoom - 1))} disabled={zoom === 0} aria-label="Zoom out">−</button>
            <span className="small">{ZOOMS[zoom]}</span>
            <button className="btn sm" type="button" onClick={() => setZoom(Math.min(2, zoom + 1))} disabled={zoom === 2} aria-label="Zoom in">+</button>
          </span>
        </div>
        <div className="bar small">
          <Link className="btn" href={`/program?from=${addDays(from, -7 * weeks)}&weeks=${weeks}`}>← Earlier</Link>
          <span>{longDate(from)} – {longDate(to)}</span>
          <Link className="btn" href={`/program?from=${addDays(from, 7 * weeks)}&weeks=${weeks}`}>Later →</Link>
          {[1, 2, 4].map((w) => <Link key={w} className="btn" aria-current={w === weeks} href={`/program?from=${from}&weeks=${w}`}>{w} wk</Link>)}
        </div>
        {error ? <p className="warn" role="alert">{error.data?.error ?? 'That change could not be saved.'}</p> : null}
      </div>

      <div className={`pweeks z${zoom}`} aria-busy={pending}>
        <div className="pw-head"><span />{DOW.map((d) => <span key={d}>{d}</span>)}</div>
        {Array.from({ length: weeks }, (_, w) => addDays(from, w * 7)).map((ws) => (
          <div key={ws} className="pw-row">
            <span className="pw-label">{short(ws)}</span>
            {DOW.map((_, i) => {
              const date = addDays(ws, i);
              const here = days.filter((d) => d.date === date && d.status !== 'skipped');
              const skipped = days.filter((d) => d.date === date && d.status === 'skipped');
              return (
                <div key={date} className={`pw-cell${date === today ? ' today' : ''}${dragId ? ' droppable' : ''}`}
                  onDragOver={(e) => { if (dragId) e.preventDefault(); }} onDrop={onDrop(date)}>
                  <div className="pw-date">{short(date)}</div>
                  {here.map((d) => (
                    <DayCard key={d.id} d={d} zoom={zoom} profiles={profiles} run={run}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', d.id); e.dataTransfer.effectAllowed = 'move'; setDragId(d.id); }}
                      onDragEnd={() => setDragId(null)} />
                  ))}
                  {!here.length ? (
                    <div className="pw-rest">
                      <span className="small">Rest{skipped.length ? ' (skipped)' : ''}</span>
                      {date >= today ? <button className="btn sm" type="button" disabled={pending} onClick={() => run('insert', { date })}>+ Add</button> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
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

/** Search the whole library and put any workout on this day (the no-repeat rule doesn't apply to your own choices). */
function PickAny({ d, run }: { d: PlannedDay; run: ReturnType<typeof useRun>['run'] }) {
  const [q, setQ] = useState('');
  const s = useSearchWorkouts({ q }, { query: { enabled: q.trim().length >= 2, queryKey: getSearchWorkoutsQueryKey({ q }) } });
  const list = (s.data as { workouts?: { workout: Workout; times: number }[] } | undefined)?.workouts ?? [];
  return (
    <div className="pick">
      <label>Pick any workout<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Fran, Murph, deadlift…" /></label>
      <ul>{list.map(({ workout, times }) => (
        <li key={workout.id}><button type="button" onClick={() => run('swap', { id: d.id, workoutId: workout.id })}><b>{workoutTitle(workout)}</b><span className="small">{structureLabel(workout.structure)}{times ? ` · done ${times}×` : ''}</span></button></li>
      ))}</ul>
    </div>
  );
}

function DayCard({ d, zoom, profiles, run, onDragStart, onDragEnd }: {
  d: PlannedDay; zoom: number; profiles: Profile[]; run: ReturnType<typeof useRun>['run'];
  onDragStart: (e: DragEvent) => void; onDragEnd: () => void;
}) {
  const title = workoutTitle({ ...d.workout, benchmark: d.benchmark as never });
  const isBm = d.benchmark && d.benchmark.category !== 'lift';
  const open = d.status === 'proposed' || d.status === 'approved';
  const cap = d.workout.structure.kind === 'for-time' ? d.workout.structure.capMin : undefined;
  return (
    <article className={`pday ${d.status}`} draggable={open} onDragStart={onDragStart} onDragEnd={onDragEnd} title={open ? 'Drag to another day' : undefined}>
      <div className="pday-top">
        <span className={`status ${d.status}`}>{d.status}</span>
        {d.origin.by === 'coach' ? <span className="small">your choice</span> : null}
        {d.repeat ? <span className="small" title="Repeats on a schedule you set">↻ {d.repeat.everyDays}d</span> : null}
      </div>
      <Chips mods={d.tags.modalityPattern} load={d.tags.load} volume={d.tags.volume} priority={d.tags.priority} />
      <h3>{isBm ? <span className="bm">★ </span> : null}{title}</h3>
      {zoom >= 1 ? (
        <>
          <div className="small">{structureLabel(d.workout.structure)}{cap ? ` · cap ${cap}:00` : ''}</div>
          <ul className="mv">{d.workout.movements.slice(0, zoom === 2 ? 40 : 6).map((m, i) => <li key={i}>{movementLine(m)}</li>)}{zoom < 2 && d.workout.movements.length > 6 ? <li className="small">+{d.workout.movements.length - 6} more</li> : null}</ul>
        </>
      ) : null}
      {zoom === 2 && d.warnings.length ? <p className="warn">{d.warnings.join(' · ')}</p> : null}
      {zoom === 2 && d.origin.by === 'engine' ? <ScoreBars s={d.origin.score} /> : null}
      <div className="actions">
        {d.status === 'proposed' ? <ActionForm action="approve"><input type="hidden" name="id" value={d.id} /><button className="btn primary sm">Approve</button></ActionForm> : null}
        {d.status === 'approved' ? <ActionForm action="unapprove"><input type="hidden" name="id" value={d.id} /><button className="btn sm">Unapprove</button></ActionForm> : null}
      </div>
      {open ? (
        <details className="more">
          <summary>More…</summary>
          <details className="wu">
            <summary>Warm-up{d.warmUp.source !== 'suggested' ? ' (coach\'s)' : ''}</summary>
            <WarmUpEditor dayId={d.id} warmUp={d.warmUp} reload />
          </details>
          <ActionForm action="move" className="row">
            <input type="hidden" name="id" value={d.id} />
            <label>Move to <input type="date" name="date" defaultValue={d.date} required /></label>
            <button className="btn sm">Move</button>
          </ActionForm>
          <p className="small">If that day already has a workout, the two swap.</p>
          <ActionForm action="setLocation" className="row">
            <input type="hidden" name="id" value={d.id} />
            <label>Location <select name="equipmentId" defaultValue={d.equipmentId ?? ''}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <button className="btn sm">Set</button>
          </ActionForm>
          {d.workout.structure.kind === 'for-time' ? (
            <ActionForm action="setCap" className="row">
              <input type="hidden" name="workoutId" value={d.workoutId} />
              <label>Time cap <input type="number" name="capMin" min={0} max={120} defaultValue={cap ?? ''} placeholder="min" /> min</label>
              <button className="btn sm">Save</button>
            </ActionForm>
          ) : null}
          <ActionForm action="setRepeat" className="row wrap">
            <input type="hidden" name="workoutId" value={d.workoutId} />
            <label>Repeat every <input type="number" name="everyDays" min={0} max={365} defaultValue={d.repeat?.everyDays ?? ''} placeholder="days" /> days</label>
            <label>until <input type="date" name="until" defaultValue={d.repeat?.until ?? ''} /></label>
            <button className="btn sm">Save</button>
          </ActionForm>
          <p className="small">An exception to the no-repeat rule for this workout only (e.g. a 6-week test block). 0 removes it.</p>
          <div className="row">
            <ActionForm action="skip"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="mode" value="push" /><button className="btn sm" title="Move this and all later open days to the next training day">Push forward</button></ActionForm>
            <ActionForm action="skip"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="mode" value="drop" /><button className="btn sm">Skip (rest)</button></ActionForm>
            {d.status === 'proposed' ? <ActionForm action="neverPropose"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="workoutId" value={d.workoutId} /><button className="btn ghost sm" title="Exclude this workout from future proposals">Never propose</button></ActionForm> : null}
          </div>
          <PickAny d={d} run={run} />
          {d.alternatives.length ? (
            <div className="alts">
              <b className="small">Engine's alternatives</b>
              {d.alternatives.map((a) => a.workout && a.tags ? (
                <ActionForm key={a.candidateId} action="swap" className="alt">
                  <input type="hidden" name="id" value={d.id} /><input type="hidden" name="workoutId" value={a.candidateId} />
                  <div>
                    <Chips mods={a.tags.modalityPattern} load={a.tags.load} volume={a.tags.volume} priority={a.tags.priority} />
                    <b>{workoutTitle({ ...a.workout })}</b>
                    <div className="small">{a.workout.movements.slice(0, 4).map((m) => movementLine(m)).join(' · ')}{a.score.notes.length ? ` · ${a.score.notes.join(', ')}` : ''}</div>
                  </div>
                  <button className="btn sm">Use</button>
                </ActionForm>
              ) : null)}
            </div>
          ) : null}
        </details>
      ) : null}
    </article>
  );
}
