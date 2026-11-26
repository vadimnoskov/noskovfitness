import { useMemo, useState } from 'react';
import { Link, useParams } from 'wouter';
import { useGetKnowledgeMovements, getGetKnowledgeMovementsQueryKey, useGetKnowledgeMovement, getGetKnowledgeMovementQueryKey } from '@workspace/api-client-react';
import type { MovementFacts, MovementGuide } from '@workspace/fitness-core';
import { KnowledgeTabs } from '@/pages/knowledge';

type ListItem = MovementFacts & { use12w: number; last: string | null; hasGuide: boolean };
type Detail = {
  facts: MovementFacts; guide: MovementGuide | null; catalog: { implements: string[]; variants: string[]; unit: string } | null;
  recent: { id: string; name: string; date: string }[]; libraryWorkouts: number; last: string | null; use12w: number; cards: { id: string; title: string }[];
};
const MOD: Record<string, string> = { G: 'Gymnastics', W: 'Weightlifting', M: 'Monostructural' };

/** All movements, grouped by pattern, with the coach's facts and recent use. */
export function MovementsPage() {
  const q = useGetKnowledgeMovements({ query: { queryKey: getGetKnowledgeMovementsQueryKey() } });
  const [term, setTerm] = useState('');
  const [mod, setMod] = useState<string>('');
  const items = (q.data as { movements: ListItem[] } | undefined)?.movements;
  const groups = useMemo(() => {
    const t = term.trim().toLowerCase();
    const list = (items ?? []).filter((m) => (!mod || m.modality === mod) && (!t || `${m.name} ${m.pattern} ${m.mainStress} ${m.alsoWorks} ${m.easier.join(' ')} ${m.harder.join(' ')} ${m.note ?? ''}`.toLowerCase().includes(t)));
    const by = new Map<string, ListItem[]>();
    for (const m of list) by.set(m.pattern, [...(by.get(m.pattern) ?? []), m]);
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items, term, mod]);
  return (
    <>
      <h1>Movements</h1>
      <KnowledgeTabs current="movements" />
      <p className="small">Facts from your review sheet, versions from easiest to hardest, and points of performance from the L1 Movement Guide where it covers the movement. "12 wk" counts the days anyone in the family did it.</p>
      <div className="row wrap ksearch">
        <input type="search" aria-label="Search movements" placeholder="Search: hinge, overhead, rings…" value={term} onChange={(e) => setTerm(e.target.value)} />
        {['', 'G', 'W', 'M'].map((m) => <button key={m} type="button" className="btn sm" aria-current={mod === m} onClick={() => setMod(m)}>{m ? MOD[m] : 'All'}</button>)}
      </div>
      {!items ? <p className="small">{q.isError ? 'Could not load movements.' : 'Loading…'}</p> : groups.map(([pattern, ms]) => (
        <section key={pattern}>
          <h2 className="sec">{pattern}</h2>
          <div className="scroll"><table className="ktable">
            <thead><tr><th>Movement</th><th>Main stress</th><th>Role</th><th>Skill</th><th className="n">12 wk</th></tr></thead>
            <tbody>{ms.map((m) => (
              <tr key={m.key}>
                <td><Link href={`/knowledge/movements/${m.key}`}><b>{m.name}</b></Link> <span className="tag">{m.modality}</span>{m.hasGuide ? <span className="small"> · L1 guide</span> : null}</td>
                <td className="small">{m.mainStress}</td><td className="small">{m.role}</td><td className="small">{m.skill}</td>
                <td className="n">{m.use12w || ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </section>
      ))}
    </>
  );
}

/** One movement. */
export function MovementPage() {
  const { key } = useParams<{ key: string }>();
  const q = useGetKnowledgeMovement({ key }, { query: { queryKey: getGetKnowledgeMovementQueryKey({ key }) } });
  const d = q.data as Detail | undefined;
  if (!d) return <p className="small">{q.isError ? 'Unknown movement.' : 'Loading…'}</p>;
  const f = d.facts, g = d.guide;
  return (
    <article className="kcard">
      <p className="small"><Link href="/knowledge">What Chalkboard knows</Link> › <Link href="/knowledge/movements">Movements</Link></p>
      <h1>{f.name}</h1>
      <p className="row wrap"><span className="tag">{MOD[f.modality]}{f.key === 'lunge' || f.key === 'step-up' ? ' (bodyweight)' : ''}</span><span className="tag">{f.pattern}</span><span className="tag">skill {f.skill}</span><span className="tag">impact {f.impact}</span></p>
      <table className="ktable"><tbody>
        <tr><th>Main stress</th><td>{f.mainStress}</td></tr>
        {f.alsoWorks ? <tr><th>Also works</th><td>{f.alsoWorks}</td></tr> : null}
        <tr><th>Role</th><td>{f.role}</td></tr>
        <tr><th>Station (4 people)</th><td>{f.station}</td></tr>
        {f.easier.length ? <tr><th>Easier</th><td>{f.easier.join(' → ')}</td></tr> : null}
        {f.harder.length ? <tr><th>Harder</th><td>{f.harder.join(' → ')}</td></tr> : null}
        {d.catalog?.variants.length ? <tr><th>Variants</th><td>{d.catalog.variants.join(', ')}</td></tr> : null}
        {d.catalog ? <tr><th>Implements</th><td>{d.catalog.implements.join(', ')}</td></tr> : null}
        {f.note ? <tr><th>Note</th><td>{f.note}</td></tr> : null}
      </tbody></table>

      {g ? (
        <section>
          <h2 className="sec">Points of performance <span className="small">({g.title}, L1 Movement Guide pp. {g.pages}, summarized)</span></h2>
          <div className="kpop">
            <div><b>Set-up</b><ul>{g.setup.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div><b>Execution</b><ul>{g.execution.map((x) => <li key={x}>{x}</li>)}</ul></div>
            <div><b>Finish</b><ul>{g.finish.map((x) => <li key={x}>{x}</li>)}</ul></div>
          </div>
          <h3>Common faults</h3>
          <table className="ktable"><thead><tr><th>Fault</th><th>Fix</th></tr></thead>
            <tbody>{g.faults.map((x) => <tr key={x.fault}><td>{x.fault}</td><td>{x.fix}</td></tr>)}</tbody></table>
        </section>
      ) : <p className="small">The L1 Movement Guide doesn't cover this movement.</p>}

      <section>
        <h2 className="sec">In your training</h2>
        <p className="small">{d.use12w ? `Done on ${d.use12w} day${d.use12w === 1 ? '' : 's'} in the last 12 weeks` : 'Not done in the last 12 weeks'}{d.last ? ` · last ${d.last}` : ''} · {d.libraryWorkouts.toLocaleString()} workouts in the library use it.</p>
        {d.recent.length ? <ul className="small">{d.recent.map((r) => <li key={r.id}>{r.date} · <Link href={`/workout/${r.id}`}>{r.name || 'Workout'}</Link></li>)}</ul> : null}
      </section>
      {d.cards.length ? (
        <section><h2 className="sec">Related cards</h2><ul className="small">{d.cards.map((c) => <li key={c.id}><Link href={`/knowledge/${c.id}`}>{c.title}</Link></li>)}</ul></section>
      ) : null}
      <p className="small">Changes to a movement's facts go through the Coach screen, so Chalkboard can check what they affect.</p>
    </article>
  );
}
