import { scoreText, structureLabel, movementLine } from '@workspace/fitness-core';
import { short } from '@/lib/dates';
import { usePage, PageStatus } from '@/lib/api';
import { ProgramPicker } from '@/lib/program';

const CATS = [['girl', 'The Girls'], ['hero', 'Heroes'], ['test', 'Tests and notable workouts'], ['lift', 'Lifts'], ['open', 'CrossFit Open']] as const;

type R = { athlete: string; athleteId: string; date: string; score: any; rx: boolean; completed: boolean };

type BenchmarkRow = { id: string; name: string; benchmark: { category: string; label?: string; retestEveryDays: number }; structure: any; movements: any[]; score_type: string; results: unknown };
type BenchmarksData = { rows: BenchmarkRow[]; athletes: { id: string; name: string; sex?: string }[]; today: string };

export default function Benchmarks() {
  const q = usePage<BenchmarksData>({ screen: 'benchmarks' });
  if (!q.data) return <><h1>Benchmarks</h1><ProgramPicker /><PageStatus q={q} /></>;
  const { rows, athletes, today } = q.data;
  return (
    <>
      <h1>Benchmarks</h1><ProgramPicker />
      <p className="small">{rows.length} benchmark workouts from your sheet's Girls, Hero, Misc WODs and Open tabs, plus lift tests. "Due" means the last test by anyone in the group is older than the retest interval. The engine will use this to place benchmarks into the program.</p>
      {CATS.map(([cat, label]) => {
        const list = rows.filter((r) => r.benchmark.category === cat);
        return (
          <section key={cat}>
            <h2>{label} <span className="small">({list.length})</span></h2>
            <div className="scroll"><table>
              <thead><tr><th>Workout</th><th>Retest</th>{athletes.map((a) => <th key={a.id}>{a.name}: last / best</th>)}</tr></thead>
              <tbody>{list.map((w) => {
                const res = w.results as R[];
                const last = res[0]?.date;
                const due = !last || (Date.parse(today) - Date.parse(last)) / 86400000 > w.benchmark.retestEveryDays;
                return (
                  <tr key={w.id}>
                    <td><b>{w.benchmark.label ?? w.name}</b><div className="small" title={w.movements.map((m: any) => movementLine(m)).join(' · ')}>{structureLabel(w.structure)} · {w.movements.slice(0, 4).map((m: any) => movementLine(m)).join(' · ')}{w.movements.length > 4 ? ' …' : ''}</div></td>
                    <td className={due ? 'due' : 'small'}>{due ? 'due' : `in ${Math.round(w.benchmark.retestEveryDays - (Date.parse(today) - Date.parse(last!)) / 86400000)} d`}</td>
                    {athletes.map((a) => {
                      const mine = res.filter((r) => r.athleteId === a.id);
                      if (!mine.length) return <td key={a.id} className="small">—</td>;
                      const best = bestOf(mine, w.score_type);
                      return <td key={a.id}><span>{scoreText(mine[0]!)}</span> <span className="small">{short(mine[0]!.date)}{mine[0]!.date.slice(2, 4) !== today.slice(2, 4) ? `/${mine[0]!.date.slice(2, 4)}` : ''}</span>{best && best !== mine[0] ? <div className="small">best {scoreText(best)} ({best.date.slice(0, 4)})</div> : null}{mine.length > 1 ? <div className="small">{mine.length}×</div> : null}</td>;
                    })}
                  </tr>
                );
              })}</tbody>
            </table></div>
          </section>
        );
      })}
    </>
  );
}

function bestOf(rs: R[], type: string): R | undefined {
  const rx = rs.filter((r) => r.rx && r.completed);
  const pool = rx.length ? rx : rs;
  const val = (r: R) => type === 'time' ? -(r.score.timeSec ?? Infinity) : type === 'rounds-reps' ? (r.score.rounds ?? 0) * 1000 + (r.score.reps ?? 0) : type === 'load' ? Math.max(0, ...(r.score.loads ?? [0])) : (r.score.reps ?? r.score.distanceM ?? 0);
  return pool.reduce<R | undefined>((b, r) => (!b || val(r) > val(b) ? r : b), undefined);
}
