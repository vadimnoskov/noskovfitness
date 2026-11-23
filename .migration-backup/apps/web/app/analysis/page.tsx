import Link from 'next/link';
import { getLatestDate, getMovementUse, getMix } from '@/lib/data';
import { addDays, weekStart, short } from '@/lib/dates';
import type { WorkoutTags } from '@nf/core';

export const dynamic = 'force-dynamic';
const WINDOWS = { '4w': 4, '12w': 12, '52w': 52 } as const;
/** Draft targets; these become editable programming policy. */
const TARGETS = {
  movements: { '1': 20, '2–3': 65, '4+': 15 },
  timeDomain: { short: 25, medium: 35, long: 25, endurance: 15 },
  priority: { task: 60, time: 40 },
  load: { bodyweight: 25, light: 25, medium: 30, heavy: 20 },
};
const MOD_NAME = { G: 'Gymnastics', W: 'Weightlifting', M: 'Monostructural' } as const;

export default async function Analysis({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const sp = await searchParams;
  const win = (sp.w && sp.w in WINDOWS ? sp.w : '12w') as keyof typeof WINDOWS;
  const n = WINDOWS[win];
  const end = await getLatestDate();
  const start = addDays(weekStart(end), -7 * (n - 1));
  const per = n === 52 ? 4 : 1; // year: 13 columns of 4 weeks
  const cols = Math.ceil(n / per);
  const colStart = (c: number) => addDays(start, c * 7 * per);
  const colOf = (d: string) => Math.min(cols - 1, Math.floor((Date.parse(d) - Date.parse(start)) / 86400000 / 7 / per));

  const use = await getMovementUse(start, end);
  const byMv = new Map<string, { name: string; modality: 'G' | 'W' | 'M'; cells: number[]; total: number; last: string }>();
  for (const u of use) {
    const r = byMv.get(u.key) ?? { name: u.name, modality: u.modality, cells: Array(cols).fill(0), total: 0, last: '' };
    r.cells[colOf(u.date)]++; r.total++; if (u.date > r.last) r.last = u.date;
    byMv.set(u.key, r);
  }
  const mix = (await getMix(start, end)).map((r) => r.tags as WorkoutTags);
  const N = mix.length || 1;
  const pct = (f: (t: WorkoutTags) => boolean) => Math.round((mix.filter(f).length / N) * 100);
  const sections: [string, [string, number, number][]][] = [
    ['Movements per workout', [['1', pct((t) => t.movementCount === 1), TARGETS.movements['1']], ['2–3', pct((t) => t.movementCount >= 2 && t.movementCount <= 3), TARGETS.movements['2–3']], ['4+', pct((t) => t.movementCount >= 4), TARGETS.movements['4+']]]],
    ['Time domain', (Object.keys(TARGETS.timeDomain) as (keyof typeof TARGETS.timeDomain)[]).map((k) => [k, pct((t) => t.timeDomain === k), TARGETS.timeDomain[k]])],
    ['Priority', (['task', 'time'] as const).map((k) => [k, pct((t) => t.priority === k), TARGETS.priority[k]])],
    ['Load', (Object.keys(TARGETS.load) as (keyof typeof TARGETS.load)[]).map((k) => [k, pct((t) => t.load === k), TARGETS.load[k]])],
  ];
  const combos = new Map<string, number>();
  for (const t of mix) { const k = [...new Set(t.modalityPattern)].sort().join(''); combos.set(k, (combos.get(k) ?? 0) + 1); }

  return (
    <>
      <h1>Programming analysis</h1>
      <p className="small">Vadim's sessions from {short(start)} to {short(end)}, {end.slice(0, 4)} ({mix.length} workouts). Targets are drafts until you set them.</p>
      <div className="bar">{(Object.keys(WINDOWS) as (keyof typeof WINDOWS)[]).map((k) => <Link key={k} className="btn" aria-current={k === win} href={`/analysis?w=${k}`}>{k === '52w' ? 'Year' : `Last ${WINDOWS[k]} weeks`}</Link>)}</div>
      <div className="grid2">
        <div className="scroll" style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 8 }}>
          <table className="heat">
            <thead><tr><th>Movement</th>{Array.from({ length: cols }, (_, c) => <th key={c} className="n">{short(colStart(c))}</th>)}<th className="n">Total</th><th className="n">Last</th></tr></thead>
            <tbody>
              {(['G', 'W', 'M'] as const).map((mod) => [
                <tr key={mod} className="grp"><td colSpan={cols + 3}><i className={`chip ${mod.toLowerCase()}`}>{mod}</i> {MOD_NAME[mod]}</td></tr>,
                ...[...byMv.values()].filter((r) => r.modality === mod).sort((a, b) => b.total - a.total).map((r) => (
                  <tr key={r.name}><td>{r.name}</td>
                    {r.cells.map((k, c) => <td key={c} style={{ background: k ? `color-mix(in srgb, var(--V3) ${Math.min(100, k * 30)}%, transparent)` : undefined, color: k > 2 ? '#fff' : undefined }}>{k || ''}</td>)}
                    <td className="n"><b>{r.total}</b></td><td className="n">{short(r.last)}</td></tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
        <div>
          {sections.map(([title, rows]) => (
            <div key={title} className="bars" style={{ marginBottom: 16 }}>
              <h2 style={{ marginTop: 0 }}>{title}</h2>
              {rows.map(([l, v, t]) => <div key={l} className="row"><span>{l}</span><div className="trk"><div className="fill" style={{ width: `${v}%` }} /><div className="tgt" style={{ left: `${t}%` }} title={`target ${t}%`} /></div><b>{v}%</b></div>)}
            </div>
          ))}
          <div className="bars"><h2 style={{ marginTop: 0 }}>Modality combinations</h2>
            {[...combos.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <div key={k} className="row"><span>{[...k].map((c) => <i key={c} className={`chip ${c.toLowerCase()}`} style={{ marginRight: 2 }}>{c}</i>)}</span><div className="trk"><div className="fill" style={{ width: `${Math.round((v / N) * 100)}%` }} /></div><b>{Math.round((v / N) * 100)}%</b></div>)}
          </div>
          <p className="small">Black bar = actual share. Dashed red line = draft target.</p>
        </div>
      </div>
    </>
  );
}
