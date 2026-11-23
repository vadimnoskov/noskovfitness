import { Link, useSearch } from 'wouter';
import { workoutTitle, movementLine, scoreText, structureLabel } from '@workspace/fitness-core';
import { dayHeader, type Day } from '@/lib/data';
import { addDays, weekStart, DOW, short, longDate } from '@/lib/dates';
import { Chips, Legend } from '@/components/Chips';
import { usePage, PageStatus } from '@/lib/api';

type View = 'year' | '8w' | 'week';
type CalendarData = { latestDate: string; days: [string, Day][] };

export default function CalendarPage() {
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { view?: string; d?: string };
  const view: View = sp.view === 'week' || sp.view === '8w' ? sp.view : 'year';
  const given = sp.d && /^\d{4}-\d\d-\d\d$/.test(sp.d) ? sp.d : undefined;
  const latest = usePage<CalendarData>({ screen: 'calendar' }, !given);
  const anchor = given ?? latest.data?.latestDate;
  const year = anchor?.slice(0, 4) ?? '';
  const [from, to] = !anchor ? ['', ''] : view === 'year' ? [weekStart(`${year}-01-01`), `${year}-12-31`]
    : view === '8w' ? [addDays(weekStart(anchor), -49), addDays(weekStart(anchor), 6)]
    : [weekStart(anchor), addDays(weekStart(anchor), 6)];
  const q = usePage<CalendarData>({ screen: 'calendar', from, to }, !!anchor);

  if (!anchor) return <><h1>Program calendar</h1><PageStatus q={latest} /></>;
  const step = view === 'year' ? 364 : view === '8w' ? 56 : 7;
  const prev = addDays(anchor, -step), next = addDays(anchor, step);
  const href = (v: View, d: string) => `/calendar?view=${v}&d=${d}`;
  const label = view === 'year' ? year : view === '8w' ? `${short(from)} – ${short(to)}, ${to.slice(0, 4)}` : `Week of ${longDate(from)}`;
  const days = q.data ? new Map(q.data.days) : null;

  return (
    <>
      <h1>Program calendar</h1>
      <p className="small">Past days come from the imported history (everyone's results listed under each workout). Future days come from the <Link href="/program">Program</Link>: faded = proposed, solid = approved.</p>
      <div className="bar">
        <Link className="btn" aria-current={view === 'year'} href={href('year', anchor)}>Year</Link>
        <Link className="btn" aria-current={view === '8w'} href={href('8w', anchor)}>8 weeks</Link>
        <Link className="btn" aria-current={view === 'week'} href={href('week', anchor)}>Week</Link>
        <span style={{ flex: 1 }} />
        <Link className="btn" href={href(view, prev)} aria-label="Previous">←</Link>
        <b style={{ minWidth: 160, textAlign: 'center' }}>{label}</b>
        <Link className="btn" href={href(view, next)} aria-label="Next">→</Link>
      </div>
      <Legend />
      {!days ? <PageStatus q={q} /> : (
        <div className="cal" style={{ marginTop: 10 }}>
          {view === 'year' ? <YearGrid from={from} to={to} days={days} /> : view === '8w' ? <EightWeeks from={from} days={days} /> : <Week from={from} days={days} />}
        </div>
      )}
    </>
  );
}
function YearGrid({ from, to, days }: { from: string; to: string; days: Map<string, Day> }) {
  const weeks: string[] = [];
  for (let w = from; w <= to; w = addDays(w, 7)) weeks.push(w);
  const LOAD = { bodyweight: '', light: 'l1', medium: 'l2', heavy: 'l3' } as const;
  return (
    <div className="yr">
      <span />{DOW.map((d) => <span key={d} className="hd">{d}</span>)}
      {weeks.map((w) => [
        <Link key={`week-${w}`} className="wk" href={`/calendar?view=week&d=${w}`}>{short(w)}</Link>,
        ...DOW.map((_, i) => {
          const date = addDays(w, i);
          const day = days.get(date);
          if (!day) return <span key={date} className="d" title={`${date}: no workout`} />;
          const h = dayHeader(day);
          return (
            <Link key={date} className={`d${h.benchmark ? ' b' : ''}${day.parts.every((p) => p.planStatus === 'proposed') ? ' prop' : ''}`} href={`/calendar?view=week&d=${date}`} title={`${date}: ${day.parts.map((p) => workoutTitle({ ...p.workout, name: p.name ?? undefined, benchmark: p.benchmark as never })).join(' + ')}`}>
              {h.mods.map((m, k) => <i key={k} className={m.toLowerCase()} />)}<i className={LOAD[h.load]} style={{ flex: 0.6 }} />
            </Link>
          );
        }),
      ])}
    </div>
  );
}

function title(p: Day['parts'][number]) {
  return workoutTitle({ ...p.workout, name: p.name ?? undefined, benchmark: p.benchmark as never });
}

function EightWeeks({ from, days }: { from: string; days: Map<string, Day> }) {
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(from, i * 7));
  return (
    <div className="ew">
      <div className="lab">Week</div>{DOW.map((d) => <div key={d} className="lab">{d}</div>)}
      {weeks.map((w) => [
        <div key={`week-${w}`} className="lab"><Link href={`/calendar?view=week&d=${w}`}>{short(w)}</Link></div>,
        ...DOW.map((_, i) => {
          const date = addDays(w, i);
          const day = days.get(date);
          if (!day) return <div key={date} className="small">{short(date)}</div>;
          const h = dayHeader(day);
          return (
            <div key={date}>
              <div className="small">{short(date)}</div>
              <Chips {...h} />
              {day.parts.map((p) => <div key={p.workoutId} className={`ttl${p.planStatus === 'proposed' ? ' prop' : ''}`}>{p.benchmark && p.benchmark.category !== 'lift' ? <span className="bm">★ </span> : null}{title(p)}</div>)}
            </div>
          );
        }),
      ])}
    </div>
  );
}

function Week({ from, days }: { from: string; days: Map<string, Day> }) {
  return (
    <div className="week">
      {DOW.map((dn, i) => {
        const date = addDays(from, i);
        const day = days.get(date);
        return (
          <div key={date}>
            <div className="dt">{dn} {short(date)}</div>
            {!day ? <span className="small">No workout</span> : (
              <>
                <Chips {...dayHeader(day)} />
                {day.parts.map((p, k) => (
                  <div key={p.workoutId} className="part">
                    <div className="ttl">{day.parts.length > 1 ? `${String.fromCharCode(65 + k)}. ` : ''}{p.benchmark && p.benchmark.category !== 'lift' ? <span className="bm">★ </span> : null}{p.name && !p.name.includes(':') ? p.name : structureLabel(p.workout.structure)}</div>
                    {p.name && !p.name.includes(':') ? <div className="small">{structureLabel(p.workout.structure)}</div> : null}
                    <ul>{p.workout.movements.map((m, j) => <li key={j}>{movementLine(m)}</li>)}</ul>
                    {p.planStatus ? <div className="small">{p.planStatus}</div> : null}
                    <div className="res">{p.results.map((r) => [<b key={r.athleteId + 'n'}>{r.athlete}</b>, <span key={r.athleteId + 's'} className="sc">{scoreText(r)}{r.rx ? '' : ' (scaled)'}</span>])}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
