import { useState } from 'react';
import { Link, useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetAthletePicture, getGetAthletePictureQueryKey, useGetMeasurements, getGetMeasurementsQueryKey, useSaveMeasurements, useImportWeights, useSetConditioningPrior, useSetWeaknesses } from '@workspace/api-client-react';
import { useMe, localToday, isCoaching } from '@/lib/session';
import { AthletePicker } from '@/pages/today';

type Curve = { minutes: number; power: number | null }[];
type Picture = {
  athlete: { id: string; name: string }; hasDims: boolean;
  coverage: { timed: number; counted: number; missing: { what: string; n: number }[] };
  allTime: (Curve[number] & { from: { date: string; name?: string; id: string } | null })[];
  byYear: { year: string; curve: Curve; points: number; area: number | null }[]; commonMinutes: number[];
  repeats: { workoutId: string; name: string; rx: boolean; times: number; first: { date: string; sec: number }; best: { date: string; sec: number }; last: { date: string; sec: number }; lastVsFirst: number; bestVsFirst: number }[];
  grid: Grid; weaknesses?: Weak;
  conditioning: { level: number | null; fromData: number | null; recentN: number; recentDays: number; prior: number | null; best: { from: string; to: string; n: number } | null; perWeek8: number; perWeekUsual: number };
  readiness: { recent: number | null; recentN: number; checkIns: number; checkIn: { pairs: number; correlation: number | null; used: boolean; today: number | null; suggests: number | null } };
  model: { family: string; basis: 'source' | 'derived' | 'assumed' | 'machine'; rule: string }[];
};
type Cell = { row: string; col: string; n: number; vsCurve: number | null; recent: number | null; prior: number | null; done12m: number; share12m: number;
  confidence: 'good' | 'some' | 'too few'; flag: 'weak' | 'rare' | null; why?: string; examples: { id: string; name?: string; date: string; minutes: number; vsCurve: number }[] };
type Grid = { from: string; to: string; fit: { a: number; b: number } | null; cells: Cell[]; counted: number; done12m: number };
type Meas = { kinds: { kind: string; label: string; how: string }[]; latest: Record<string, { date: string; value: number; unit: string } | null>; counts?: Record<string, number>; range?: Record<string, string> };

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const watts = (p: number) => Math.round(p * 1.3558);
// Categorical slots 1–3 (validated); older years recede to gray, all-time in the primary text ink.
const SERIES = ['#257de0', '#f47230', '#00b894'];
const OLD = '#c8c8c8', INK = '#191919';

/** Fitness: each person's power over duration (L1: fitness is the area under this curve) and the same curve by year (health). */
export default function FitnessPage() {
  const me = useMe();
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { a?: string };
  const [, navigate] = useLocation();
  if (!me) return <p className="empty">Loading…</p>;
  const athlete = (isCoaching(me) ? me.logFor.find((p) => p.id === sp.a) : undefined) ?? me.user;
  return (
    <>
      <h1>{athlete.id === me.user.id ? 'My fitness' : `${athlete.name}'s fitness`}</h1>
      {isCoaching(me) ? <AthletePicker value={athlete.id} onChange={(a) => navigate(a === me.user.id ? '/fitness' : `/fitness?a=${a}`)} /> : null}
      <Body athleteId={athlete.id} lengthUnit={athlete.units === 'kg' ? 'cm' : 'in'} weightUnit={athlete.units} />
    </>
  );
}

function Body({ athleteId, lengthUnit, weightUnit }: { athleteId: string; lengthUnit: 'in' | 'cm'; weightUnit: 'lb' | 'kg' }) {
  const q = useGetAthletePicture({ athleteId }, { query: { queryKey: getGetAthletePictureQueryKey({ athleteId }) } });
  const p = q.data as Picture | undefined;
  if (q.isLoading) return <p className="empty">Loading…</p>;
  if (!p) return <p className="warn">Couldn't load this page.</p>;
  return (
    <>
      <p className="small">Work is force × distance: your bodyweight times how far your centre of mass travels, plus the load times how far it travels. Power is work divided by time. Fitness is the area under your best power across durations; health is that curve holding up over the years. These are the definitions in the CrossFit Level 1 guide.</p>
      <Measurements athleteId={athleteId} lengthUnit={lengthUnit} weightUnit={weightUnit} open={!p.hasDims} />
      {!p.hasDims ? <p className="kopen">Runs and rows are counted without measurements. Enter all six measurements above to count the other movements.</p> : null}
      {p.conditioning ? <Condition p={p} athleteId={athleteId} /> : null}
      {p.grid ? <GridSection g={p.grid} /> : null}
      {p.weaknesses ? <WeaknessSection w={p.weaknesses} athleteId={athleteId} /> : null}
      {p.coverage.counted ? <CurveSection p={p} /> : null}
      <Repeats p={p} />
      <Model p={p} />
    </>
  );
}

function Measurements({ athleteId, lengthUnit, weightUnit, open }: { athleteId: string; lengthUnit: 'in' | 'cm'; weightUnit: 'lb' | 'kg'; open: boolean }) {
  const q = useGetMeasurements({ athleteId }, { query: { queryKey: getGetMeasurementsQueryKey({ athleteId }) } });
  const save = useSaveMeasurements();
  const imp = useImportWeights();
  const [impMsg, setImpMsg] = useState<string | null>(null);
  // Open on first view when measurements are missing; never folded away by a save or an import.
  const [startOpen] = useState(open);
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [date, setDate] = useState(localToday());
  const [ok, setOk] = useState(false);
  const m = q.data as Meas | undefined;
  if (!m) return null;
  const err = save.error as { data?: { error?: string } } | null;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const values = Object.fromEntries(Object.entries(vals).filter(([, v]) => v.trim()).map(([k, v]) => [k, Number(v)]));
    save.mutate({ data: { athleteId, date, lengthUnit, weightUnit, values } }, { onSuccess: () => {
      setOk(true); setVals({});
      qc.invalidateQueries({ queryKey: getGetMeasurementsQueryKey({ athleteId }) });
      qc.invalidateQueries({ queryKey: getGetAthletePictureQueryKey({ athleteId }) });
    } });
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setImpMsg(`Reading ${f.name}…`);
    imp.mutate({ data: { athleteId, csv: await f.text() } }, {
      onSuccess: (r) => { const x = r as { imported: number; from: string; to: string }; setImpMsg(`Imported ${x.imported} weights, ${x.from} to ${x.to}.`); qc.invalidateQueries({ queryKey: getGetMeasurementsQueryKey({ athleteId }) }); qc.invalidateQueries({ queryKey: getGetAthletePictureQueryKey({ athleteId }) }); },
      onError: (e) => setImpMsg((e as { data?: { error?: string } }).data?.error ?? 'Could not import that file.'),
    });
  };
  return (
    <details className="card" open={startOpen}>
      <summary><b>Body measurements</b> <span className="small">({m.kinds.filter((k) => m.latest[k.kind]).length} of 6 entered)</span></summary>
      <p className="small">Used only to compute work and power; kept in the app's database. Re-enter bodyweight when it changes; the heights rarely change for adults.</p>
      <form onSubmit={submit} className="measform">
        <label>Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {m.kinds.map((k) => {
          const cur = m.latest[k.kind];
          return (
            <label key={k.kind}>{k.label} ({k.kind === 'weight' ? weightUnit : lengthUnit})
              <input type="number" step="0.1" inputMode="decimal" value={vals[k.kind] ?? ''} placeholder={cur ? `${cur.value} ${cur.unit}` : ''}
                onChange={(e) => { setOk(false); setVals({ ...vals, [k.kind]: e.target.value }); }} />
              <span className="small">{k.how}{cur ? ` Last: ${cur.value} ${cur.unit} on ${cur.date}.` : ''}</span>
            </label>
          );
        })}
        <div className="row wrap"><button type="submit" className="btn primary" disabled={save.isPending || !Object.values(vals).some((v) => v.trim())}>Save</button></div>
        {err ? <p className="warn" role="alert">{err.data?.error ?? 'Could not save.'}</p> : null}
        {ok ? <p className="ok">Saved.</p> : null}
      </form>
      <label className="small" style={{ display: 'block', marginTop: 10 }}>Or import bodyweight history from a BTWB measurements export (.csv):{' '}
        <input type="file" accept=".csv,text/csv,text/plain,text/comma-separated-values,application/vnd.ms-excel" disabled={imp.isPending} onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {impMsg ? <p className="small" role="status">{impMsg}</p> : null}
      <p className="small">Bodyweights stored: {m.counts?.weight ?? 0}{m.counts?.weight ? ` (${m.range?.weight})` : ''}.</p>
    </details>
  );
}

const W = 640, H = 320, L = 52, R = 70, T = 16, B = 40;
function CurveSection({ p }: { p: Picture }) {
  const recent = p.byYear.slice(-3);
  const older = p.byYear.slice(0, -3);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...p.allTime.map((c) => c.power ?? 0));
  const yMax = Math.ceil(max / 50) * 50;
  const lx = (t: number) => L + (Math.log(t) / Math.log(60)) * (W - L - R);
  const ly = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const path = (c: Curve) => c.filter((x) => x.power !== null).map((x, i) => `${i ? 'L' : 'M'}${lx(x.minutes).toFixed(1)},${ly(x.power!).toFixed(1)}`).join(' ');
  const last = (c: Curve) => [...c].reverse().find((x) => x.power !== null);
  const ticks = [1, 2, 4, 8, 12, 20, 30, 60];
  const pct = p.coverage.timed ? Math.round((p.coverage.counted / p.coverage.timed) * 100) : 0;
  const h = hover !== null ? p.allTime[hover] : null;
  return (
    <section>
      <h2 className="sec">Power over duration</h2>
      <p className="small">Best average power held for at least each duration. Computed for {p.coverage.counted} of {p.coverage.timed} timed and AMRAP results ({pct}%); the rest include movements with no distance rule (most often: {p.coverage.missing.slice(0, 4).map((m) => `${m.what} ${m.n}`).join(', ')}).</p>
      <div className="row wrap small" aria-label="Legend">
        <span><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={INK} strokeWidth="2" strokeDasharray="4 3" /></svg> All time</span>
        {recent.map((y, i) => <span key={y.year}><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={SERIES[i]} strokeWidth="2" /></svg> {y.year}</span>)}
        {older.length ? <span><svg width="18" height="8"><line x1="0" y1="4" x2="18" y2="4" stroke={OLD} strokeWidth="2" /></svg> {older[0]!.year}–{older[older.length - 1]!.year}</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Power versus duration, all time and by year" onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={ly(yMax * f)} y2={ly(yMax * f)} stroke="#e6e6e6" /><text x={L - 6} y={ly(yMax * f) + 4} textAnchor="end" fontSize="11" fill="#666">{Math.round(yMax * f)}</text></g>)}
        {ticks.map((t) => <text key={t} x={lx(t)} y={H - B + 16} textAnchor="middle" fontSize="11" fill="#666">{t}</text>)}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#666">minutes (log scale)</text>
        <text x={12} y={T + 4} fontSize="11" fill="#666" transform={`rotate(-90 12 ${T + 4})`} textAnchor="end">ft-lb/s</text>
        {older.map((y) => <path key={y.year} d={path(y.curve)} fill="none" stroke={OLD} strokeWidth="1.5" />)}
        {recent.map((y, i) => <path key={y.year} d={path(y.curve)} fill="none" stroke={SERIES[i]} strokeWidth="2" />)}
        <path d={path(p.allTime)} fill="none" stroke={INK} strokeWidth="2" strokeDasharray="5 4" />
        {recent.map((y) => { const e = last(y.curve); return e ? <text key={y.year} x={lx(e.minutes) + 6} y={ly(e.power!) + 4} fontSize="11" fill={INK}>{y.year}</text> : null; })}
        {p.allTime.map((c, i) => c.power !== null ? (
          <g key={c.minutes} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}>
            <rect x={lx(c.minutes) - 14} y={T} width={28} height={H - T - B} fill="transparent" />
            <circle cx={lx(c.minutes)} cy={ly(c.power)} r={hover === i ? 5 : 4} fill={INK} stroke="#fff" strokeWidth="2" />
          </g>) : null)}
        {h && h.power !== null ? <line x1={lx(h.minutes)} x2={lx(h.minutes)} y1={T} y2={H - B} stroke="#999" strokeDasharray="2 3" /> : null}
      </svg>
      <p className="small" aria-live="polite" style={{ minHeight: '1.4em' }}>{h && h.power !== null && h.from
        ? <>At {h.minutes} min: <b>{h.power} ft-lb/s</b> ({watts(h.power)} W), from <Link href={`/workout/${h.from.id}`}>{h.from.name ?? 'a workout'}</Link> on {h.from.date}.</>
        : 'Hover or tab to a point to see the effort behind it.'}</p>
      <table className="ktable">
        <thead><tr><th>Year</th><th>Results counted</th><th>Area ({p.commonMinutes.length >= 2 ? `${p.commonMinutes[0]}–${p.commonMinutes[p.commonMinutes.length - 1]} min` : 'not comparable'})</th>{[1, 4, 12, 30].map((t) => <th key={t}>{t} min</th>)}</tr></thead>
        <tbody>{[...p.byYear].reverse().map((y) => (
          <tr key={y.year}><td>{y.year}</td><td>{y.points}</td><td>{y.area ?? '–'}</td>{[1, 4, 12, 30].map((t) => <td key={t}>{y.curve.find((c) => c.minutes === t)?.power ?? '–'}</td>)}</tr>
        ))}</tbody>
      </table>
      <p className="small">The area compares years only over the durations every year reached, so it is like for like. A year with few results counted can look weaker than it was.</p>
    </section>
  );
}

function Repeats({ p }: { p: Picture }) {
  if (!p.repeats.length) return null;
  return (
    <section>
      <h2 className="sec">Repeated workouts</h2>
      <p className="small">Same workout, same loads, finished for time. The work is the same each time, so the change in power is the ratio of the times (L1 guide); no measurements needed.</p>
      <table className="ktable">
        <thead><tr><th>Workout</th><th>Times</th><th>First</th><th>Best</th><th>Latest</th><th>Latest vs first</th></tr></thead>
        <tbody>{p.repeats.map((r) => (
          <tr key={`${r.workoutId}${r.first.date}`}>
            <td><Link href={`/workout/${r.workoutId}`}>{r.name}</Link>{r.rx ? '' : <span className="small"> (scaled)</span>}</td><td>{r.times}</td>
            <td>{mmss(r.first.sec)} <span className="small">{r.first.date.slice(0, 7)}</span></td>
            <td>{mmss(r.best.sec)} <span className="small">{r.best.date.slice(0, 7)}</span></td>
            <td>{mmss(r.last.sec)} <span className="small">{r.last.date.slice(0, 7)}</span></td>
            <td><b>{r.lastVsFirst > 0 ? '+' : ''}{r.lastVsFirst}%</b> power</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}

const BASIS = { machine: 'Concept2’s published formula (BTWB uses it too)', source: 'as in the L1 / Fran tables', derived: 'same rule, from the five heights', assumed: 'needs an assumption (review)' } as const;
function Model({ p }: { p: Picture }) {
  return (
    <details className="card">
      <summary><b>How each movement's work is counted</b></summary>
      <p className="small">Movements not listed (single-unders, toes-to-bar, carries, swimming…) have no distance rule, so a result that includes them gets no power number rather than a guessed one.</p>
      <table className="ktable"><thead><tr><th>Movement</th><th>Rule</th><th>Basis</th></tr></thead>
        <tbody>{p.model.map((m) => <tr key={m.family}><td>{m.family}</td><td className="small">{m.rule}</td><td className="small">{BASIS[m.basis]}</td></tr>)}</tbody></table>
    </details>
  );
}

const ROWS = [['short', 'Short', 'under 4 min'], ['medium', 'Medium', '4–12 min'], ['long', 'Long', '12–20 min'], ['endurance', 'Endurance', '20+ min']] as const;
const COLS = [['G', 'Gymnastics'], ['W', 'Weightlifting'], ['M', 'Run, row, bike'], ['mixed', 'Mixed']] as const;
const signed = (x: number) => `${x > 0 ? '+' : ''}${x}%`;
/** Weaknesses with evidence: each cell compares results with the person's own usual power at that duration. */
function GridSection({ g }: { g: Grid }) {
  const [open, setOpen] = useState<string | null>(null);
  const cell = (r: string, c: string) => g.cells.find((x) => x.row === r && x.col === c)!;
  const sel = open ? g.cells.find((x) => `${x.row}|${x.col}` === open) : undefined;
  const flagged = g.cells.filter((c) => c.flag);
  return (
    <section>
      <h2 className="sec">Strengths and weaknesses</h2>
      <p className="small">Last 3 years ({g.from} to {g.to}), {g.counted} results with a power number. The big number compares that kind of workout with your usual power for the same modality at the same duration (+5% = 5% above your usual). It is for information only: within one modality it mixes you with how the modality is measured. Cells are flagged only on two things the data shows directly: <b>Declining</b>, 10 points or more lower in the last 12 months than in the 2 years before; and <b>Rarely trained</b>, done at most once in the last 12 months though it was part of your training before.</p>
      {!g.fit ? <p className="kopen">Not enough results with a power number yet (8 needed).</p> : (
        <>
          <div className="gridwrap"><table className="wgrid">
            <thead><tr><th></th>{COLS.map(([k, l]) => <th key={k}>{l}</th>)}</tr></thead>
            <tbody>{ROWS.map(([r, label, sub]) => (
              <tr key={r}><th scope="row">{label}<div className="small">{sub}</div></th>
                {COLS.map(([c]) => {
                  const x = cell(r, c);
                  const k = `${r}|${c}`;
                  return (
                    <td key={c} className={`wc ${x.flag ? `w-${x.flag}` : ''} ${x.confidence === 'too few' ? 'w-thin' : ''}`}>
                      <button type="button" aria-pressed={open === k} onClick={() => setOpen(open === k ? null : k)}
                        aria-label={`${label} ${c}: ${x.vsCurve === null || x.confidence === 'too few' ? 'not enough data' : signed(x.vsCurve)}, ${x.n} results${x.flag ? `, ${x.flag === 'weak' ? 'declining' : 'rarely trained'}` : ''}`}>
                        <b>{x.confidence === 'too few' || x.vsCurve === null ? '–' : signed(x.vsCurve)}</b>
                        <span className="small">{x.n} result{x.n === 1 ? '' : 's'} · {x.done12m} in 12 mo</span>
                        {x.recent !== null && x.prior !== null ? <span className="small">trend {signed(x.prior)} → {signed(x.recent)}</span> : null}
                        {x.flag ? <span className={`wflag`}>{x.flag === 'weak' ? 'Declining' : 'Rarely trained'}</span> : null}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}</tbody>
          </table></div>
          {flagged.length ? (
            <ul className="small">{flagged.map((c) => <li key={`${c.row}${c.col}`}><b>{ROWS.find((r) => r[0] === c.row)![1]} {COLS.find((x) => x[0] === c.col)![1].toLowerCase()}</b>: {c.flag === 'weak' ? 'declining' : 'rarely trained'}, {c.why}.</li>)}</ul>
          ) : <p className="small">Nothing is declining or has dropped out of training.</p>}
          {sel ? (
            <div className="card">
              <b>{ROWS.find((r) => r[0] === sel.row)![1]} · {COLS.find((x) => x[0] === sel.col)![1]}</b>
              <span className="small"> — {sel.n} results, confidence: {sel.confidence}{sel.recent !== null ? `; last 12 months ${signed(sel.recent)}` : ''}{sel.prior !== null ? `, before ${signed(sel.prior)}` : ''}</span>
              {sel.examples.length ? <ul className="small">{sel.examples.map((e) => <li key={e.id + e.date}><Link href={`/workout/${e.id}`}>{e.name ?? 'Workout'}</Link> · {e.date} · {e.minutes} min · {signed(e.vsCurve)}</li>)}</ul> : <p className="small">No results here in the last 3 years.</p>}
            </div>
          ) : <p className="small">Tap a cell to see the workouts behind it.</p>}
          <p className="small">The planner leans a little toward declining and rarely trained cells (for the family, averaged over everyone) (the "weakness focus" weight in Settings); balance across the targets still comes first.</p>
        </>
      )}
    </section>
  );
}

/** Conditioning level (0–1) and readiness, with how each was worked out. */
function Condition({ p, athleteId }: { p: Picture; athleteId: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const set = useSetConditioningPrior();
  const [val, setVal] = useState('');
  const c = p.conditioning, r = p.readiness;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const v = val.trim() === '' ? null : Number(val);
    set.mutate({ data: { athleteId, prior: v } }, { onSuccess: () => { setVal(''); qc.invalidateQueries({ queryKey: getGetAthletePictureQueryKey({ athleteId }) }); } });
  };
  return (
    <section>
      <h2 className="sec">Conditioning and readiness</h2>
      <div className="row wrap" style={{ gap: 24 }}>
        <div><div className="small">Conditioning level</div><div className="bignum">{c.level === null ? '–' : c.level.toFixed(2)}</div></div>
        <div><div className="small">Lately (last 3 weeks)</div><div className="bignum">{r.recent === null ? '–' : `${r.recent > 0 ? '+' : ''}${r.recent}%`}</div></div>
        <div><div className="small">Training days per week</div><div className="bignum">{c.perWeek8.toFixed(1)}</div><div className="small">usual {c.perWeekUsual.toFixed(1)}</div></div>
      </div>
      <ul className="small">
        <li><b>Conditioning level</b> (0–1): {c.fromData !== null && c.best
          ? <>your results in the last {c.recentDays} days ({c.recentN}) are at {pct(c.fromData)} of your best 12 months ({c.best.from} to {c.best.to}, {c.best.n} results), each compared with your usual power for that kind of workout and duration.</>
          : <>not enough recent results with a power number to measure it.</>}
          {c.prior !== null ? <> The coach's starting estimate, {c.prior.toFixed(2)}, counts as 3 results{c.fromData !== null ? `; with ${Math.min(c.recentN, 10)} recent results the blend is ${c.level?.toFixed(2)}` : ''}.</> : null}
          {' '}It will set how much volume and complexity your own version of each workout gets (Individual Rx, Phase 7).</li>
        <li><b>Lately</b>: your last 3 weeks of results ({r.recentN}) against your usual over the past year{r.recent === null ? ' (needs at least 2 results)' : ''}.</li>
        <li><b>Check-in</b> ("How do you feel today?" on Today): {r.checkIns} so far; {r.checkIn.pairs} on days with a result.{' '}
          {r.checkIn.used
            ? <>It predicts your results (correlation {r.checkIn.correlation}), so it is used{r.checkIn.suggests !== null ? `: today's answer suggests about ${r.checkIn.suggests > 0 ? '+' : ''}${r.checkIn.suggests}% vs your usual` : ''}.</>
            : <>Not used yet: it counts once at least 10 check-ins match a result that day and they line up (correlation 0.2 or more{r.checkIn.correlation !== null ? `; now ${r.checkIn.correlation}` : ''}).</>}</li>
      </ul>
      {me?.user.isCoach || (isCoaching(me) && athleteId !== me?.user.id) ? (
        <form className="row wrap" onSubmit={save}>
          <label className="small">Coach's starting estimate (0–1){c.prior !== null ? `, now ${c.prior.toFixed(2)}` : ''}: <input type="number" min={0} max={1} step={0.05} value={val} onChange={(e) => setVal(e.target.value)} placeholder={c.prior === null ? 'e.g. 0.75' : String(c.prior)} style={{ width: 90 }} /></label>
          <button type="submit" className="btn sm" disabled={set.isPending}>{val.trim() === '' && c.prior !== null ? 'Clear' : 'Save'}</button>
        </form>
      ) : null}
    </section>
  );
}

type Weak = { chosen: string[]; list: { key: string; name: string; why: string; from: 'coach' | 'results' }[]; options: { key: string; name: string }[];
  suggestions: { key: string; name: string; why: string; recent: boolean }[] };
/** Skill weaknesses for warm-up weakness work: the coach's list, what the results show, and suggestions. */
function WeaknessSection({ w, athleteId }: { w: Weak; athleteId: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const set = useSetWeaknesses();
  const [pick, setPick] = useState('');
  const coach = !!me?.user.isCoach || (isCoaching(me) && athleteId !== me?.user.id);
  const save = (keys: string[]) => set.mutate({ data: { athleteId, keys } }, { onSuccess: () => { setPick(''); qc.invalidateQueries({ queryKey: getGetAthletePictureQueryKey({ athleteId }) }); } });
  const left = w.options.filter((o) => !w.chosen.includes(o.key));
  const older = w.suggestions.filter((s) => !s.recent);
  return (
    <section>
      <h2 className="sec">Weakness work</h2>
      <p className="small">One of these goes into the warm-up on Today, about 5 minutes, rotating day to day. It is skipped when the workout already has that movement or one like it, so it never tires you for the workout (L2: weakness work belongs in the warm-up).</p>
      {w.list.length ? <ul>{w.list.map((x) => (
        <li key={x.key}><b>{x.name}</b> <span className="small">({x.why})</span>
          {coach && x.from === 'coach' ? <> <button type="button" className="btn sm" disabled={set.isPending} onClick={() => save(w.chosen.filter((k) => k !== x.key))}>Remove</button></> : null}</li>))}</ul>
        : <p className="small">None yet.</p>}
      {older.length ? (
        <>
          <p className="small">Older evidence (more than 2 years ago; not used unless the coach adds it):</p>
          <ul className="small">{older.map((s) => (
            <li key={s.key}>{s.name}: {s.why}
              {coach ? <> <button type="button" className="btn sm" disabled={set.isPending} onClick={() => save([...w.chosen, s.key])}>Add</button></> : null}</li>))}</ul>
        </>
      ) : null}
      {!w.list.some((x) => x.from === 'results') ? <p className="small">The last 2 years of results show no skill movement whose workouts were modified much more often than usual.</p> : null}
      {coach ? (
        <form className="row wrap" onSubmit={(e) => { e.preventDefault(); if (pick) save([...w.chosen, pick]); }}>
          <label className="small">Add a weakness: <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a movement</option>{left.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</select></label>
          <button type="submit" className="btn sm" disabled={!pick || set.isPending}>Add</button>
        </form>
      ) : null}
    </section>
  );
}
