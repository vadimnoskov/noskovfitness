import { useMemo, useState } from 'react';
import { Link, useParams, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { localToday } from '@/lib/session';
import { useGetKnowledge, getGetKnowledgeQueryKey, useSetKnowledgeCard, useAskKnowledge, type KnowledgeCardInput } from '@workspace/api-client-react';
import type { Area, MergedCard, Source, CardStatus } from '@workspace/fitness-core';

type KnowledgeData = {
  areas: Area[]; sources: Record<string, Source>; cards: MergedCard[]; settings: Record<string, unknown>;
  fired: Record<string, number>;
  questions: { id: string; question: string; answer: string; cardIds: string[]; covered: boolean; gap: string | null; at: string }[];
  events: { cardId: string; action: string; at: string; by: string | null; detail: { to?: { status: string | null; note: string | null } } }[];
};

const STATUS_LABEL: Record<CardStatus, string> = { confirmed: 'confirmed', proposed: 'proposed', disputed: 'disputed', gap: 'gap' };
const STATUS_HELP: Record<CardStatus, string> = {
  confirmed: 'in use', proposed: 'waiting for you', disputed: 'conflict to resolve', gap: 'known unknown',
};
const STRENGTH_LABEL = { hard: 'hard rule', strong: 'strong', guidance: 'guidance', info: 'background' } as const;
const REL_LABEL = { refines: 'Refines', supports: 'Supports', limits: 'Limits', conflicts: 'Conflicts with', uses: 'Uses', related: 'Related' } as const;

export function StatusChip({ s }: { s: CardStatus }) {
  return <span className={`kstatus k-${s}`}>{STATUS_LABEL[s]}</span>;
}

function useKnowledge() {
  const q = useGetKnowledge({ query: { queryKey: getGetKnowledgeQueryKey() } });
  return { q, d: q.data as KnowledgeData | undefined };
}

/** Map: every area with counts by status and its open questions; search across all cards. */
export function KnowledgeMap() {
  const { q, d } = useKnowledge();
  const sp = new URLSearchParams(useSearch());
  const [term, setTerm] = useState(sp.get('q') ?? '');
  const [area, setArea] = useState<string | null>(sp.get('area'));
  const found = useMemo(() => {
    if (!d) return [];
    const t = term.trim().toLowerCase();
    return d.cards.filter((c) => (!area || c.area === area) && (!t || `${c.title} ${c.statement} ${c.open ?? ''} ${c.coachNote ?? ''}`.toLowerCase().includes(t)));
  }, [d, term, area]);
  if (!d) return <><h1>What Chalkboard knows</h1><p className="small">{q.isError ? 'Could not load the knowledge.' : 'Loading…'}</p></>;
  const count = (a: string, s: CardStatus) => d.cards.filter((c) => c.area === a && c.status === s).length;
  const total = (s: CardStatus) => d.cards.filter((c) => c.status === s).length;
  const name = new Map(d.areas.map((a) => [a.id, a.name]));
  return (
    <>
      <h1>What Chalkboard knows</h1>
      <KnowledgeTabs current="map" />
      <p className="small">Every principle, rule and number the engine works from, with its sources. {d.cards.length} cards: {total('confirmed')} confirmed, {total('proposed')} proposed, {total('disputed')} disputed, {total('gap')} gaps. Change a card's status or add a note on its page.</p>
      <p className="small klegend">{(['confirmed', 'proposed', 'disputed', 'gap'] as CardStatus[]).map((s) => <span key={s}><StatusChip s={s} /> {STATUS_HELP[s]}</span>)}</p>
      <div className="row wrap ksearch">
        <input type="search" aria-label="Search the knowledge" placeholder="Search: heavy, pull-up, warm-up…" value={term} onChange={(e) => setTerm(e.target.value)} />
        {area ? <button type="button" className="btn sm" onClick={() => setArea(null)}>All areas</button> : null}
      </div>
      {term || area ? (
        <section>
          <h2 className="sec">{area ? name.get(area as never) : 'Search results'} <span className="small">({found.length})</span></h2>
          <CardList cards={found} />
        </section>
      ) : (
        <div className="scroll"><table className="ktable">
          <thead><tr><th>Area</th><th className="n">Confirmed</th><th className="n">Proposed</th><th className="n">Disputed</th><th className="n">Gaps</th><th>Open</th></tr></thead>
          <tbody>{d.areas.map((a) => {
            const open = d.cards.filter((c) => c.area === a.id && (c.status === 'proposed' || c.status === 'disputed' || c.status === 'gap'));
            return (
              <tr key={a.id}>
                <td><button type="button" className="linkish" onClick={() => setArea(a.id)}><b>{a.name}</b></button><div className="small">{a.blurb}</div></td>
                <td className="n">{count(a.id, 'confirmed') || ''}</td><td className="n">{count(a.id, 'proposed') || ''}</td>
                <td className="n">{count(a.id, 'disputed') || ''}</td><td className="n">{count(a.id, 'gap') || ''}</td>
                <td className="small">{open.map((c, i) => <span key={c.id}>{i ? ' · ' : ''}<Link href={`/knowledge/${c.id}`}>{c.title}</Link></span>)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
      {d.questions.some((x) => !x.covered) ? (
        <section>
          <h2 className="sec">Questions Chalkboard couldn't answer</h2>
          <ul className="small">{d.questions.filter((x) => !x.covered).slice(0, 10).map((x) => <li key={x.id}>{x.at.slice(0, 10)} · “{x.question}”{x.gap ? <> → gap: <b>{x.gap}</b></> : null}</li>)}</ul>
        </section>
      ) : null}
      {d.events.length ? (
        <section>
          <h2 className="sec">Recent changes</h2>
          <ul className="small">{d.events.slice(0, 10).map((e, i) => {
            const c = d.cards.find((x) => x.id === e.cardId);
            return <li key={i}>{e.at.slice(0, 10)} · {e.by ?? 'coach'} · {e.action === 'status' ? `status → ${e.detail.to?.status ?? 'methodology'}` : 'note'} · <Link href={`/knowledge/${e.cardId}`}>{c?.title ?? e.cardId}</Link></li>;
          })}</ul>
        </section>
      ) : null}
    </>
  );
}

function CardList({ cards }: { cards: MergedCard[] }) {
  if (!cards.length) return <p className="small">Nothing matches.</p>;
  return (
    <ul className="kcards">{cards.map((c) => (
      <li key={c.id}>
        <Link href={`/knowledge/${c.id}`}><b>{c.title}</b></Link> <StatusChip s={c.status} />
        <div className="small">{c.statement.length > 220 ? `${c.statement.slice(0, 220)}…` : c.statement}</div>
      </li>
    ))}</ul>
  );
}

const fmt = (v: unknown) => (Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} ${typeof x === 'object' ? JSON.stringify(x) : x}`).join(' · ') : String(v));
const DOW = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** One card: statement, sources, what the engine does with it, connections, and the coach's controls. */
export function KnowledgeCardPage() {
  const { id } = useParams<{ id: string }>();
  const { q, d } = useKnowledge();
  const qc = useQueryClient();
  const save = useSetKnowledgeCard();
  const [note, setNote] = useState<string | null>(null);
  if (!d) return <p className="small">{q.isError ? 'Could not load the knowledge.' : 'Loading…'}</p>;
  const c = d.cards.find((x) => x.id === id);
  if (!c) return <><p>Unknown card.</p><Link href="/knowledge">← Back to the map</Link></>;
  const byId = new Map(d.cards.map((x) => [x.id, x]));
  const incoming = d.cards.flatMap((x) => (x.links ?? []).filter((l) => l.to === c.id).map((l) => ({ from: x, rel: l.rel })));
  const area = d.areas.find((a) => a.id === c.area);
  const send = (body: Omit<KnowledgeCardInput, 'cardId'>) => save.mutate({ data: { cardId: c.id, ...body } }, { onSuccess: () => { setNote(null); qc.invalidateQueries({ queryKey: getGetKnowledgeQueryKey() }); } });
  const history = d.events.filter((e) => e.cardId === c.id);
  return (
    <article className="kcard">
      <p className="small"><Link href="/knowledge">What Chalkboard knows</Link> › <Link href={`/knowledge?area=${c.area}`}>{area?.name}</Link></p>
      <h1>{c.title}</h1>
      <p className="row wrap"><StatusChip s={c.status} /><span className="tag">{STRENGTH_LABEL[c.strength]}</span>{c.scope ? <span className="tag">{c.scope}</span> : null}
        {c.status !== c.methodologyStatus ? <span className="small">(manuals: {c.methodologyStatus})</span> : null}</p>
      <p className="kstatement">{c.statement}</p>
      {c.open ? <p className="kopen"><b>Open:</b> {c.open}</p> : null}
      {c.coachNote ? <p className="knote"><b>Your note:</b> {c.coachNote}</p> : null}

      {c.engine ? (
        <section>
          <h2 className="sec">What the engine does with it</h2>
          <p>{c.engine.does} <span className="small">{c.engine.state === 'built' ? '· in use now' : `· planned${c.engine.phase ? `, phase ${c.engine.phase}` : ''}`}</span></p>
          {c.engine.settings?.length ? <p className="small">Current settings: {c.engine.settings.map((p) => `${p} = ${p === 'trainingDays' ? (d.settings[p] as number[] | undefined)?.map((n) => DOW[n]).join(', ') : fmt(d.settings[p])}`).join(' · ')} <Link href="/settings">Settings</Link></p> : null}
          {d.fired[c.id] !== undefined ? <p className="small">Shaped {d.fired[c.id]} planned day{d.fired[c.id] === 1 ? '' : 's'} in the last 4 weeks and the current plan.</p> : null}
        </section>
      ) : null}

      <section>
        <h2 className="sec">Sources</h2>
        <ul>{c.sources.map((s, i) => {
          const src = d.sources[s.doc];
          return (
            <li key={i}>
              <b>{src?.title ?? s.doc}</b>{src?.author ? `, ${src.author}` : ''}{src?.year ? ` (${src.year})` : ''}{s.where ? ` · ${s.where}` : ''}
              {s.quote ? <blockquote>“{s.quote}”</blockquote> : null}
              {src?.caution ? <div className="small">Note: {src.caution}</div> : null}
            </li>
          );
        })}</ul>
      </section>

      {(c.links?.length || incoming.length) ? (
        <section>
          <h2 className="sec">Connections</h2>
          <ul>
            {(c.links ?? []).map((l, i) => <li key={`o${i}`}>{REL_LABEL[l.rel]} → <Link href={`/knowledge/${l.to}`}>{byId.get(l.to)?.title ?? l.to}</Link> {byId.get(l.to) ? <StatusChip s={byId.get(l.to)!.status} /> : null}</li>)}
            {incoming.map((x, i) => <li key={`i${i}`}><Link href={`/knowledge/${x.from.id}`}>{x.from.title}</Link> {REL_LABEL[x.rel].toLowerCase()} this</li>)}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="sec">Your decision</h2>
        <div className="row wrap">
          {(['confirmed', 'proposed', 'disputed', 'gap'] as CardStatus[]).map((s) => (
            <button key={s} type="button" className="btn sm" aria-current={c.status === s} disabled={save.isPending} onClick={() => send({ status: s })}>{s === 'confirmed' ? 'Confirm' : s === 'proposed' ? 'Proposed' : s === 'disputed' ? 'Dispute' : 'Mark as gap'}</button>
          ))}
          {c.status !== c.methodologyStatus ? <button type="button" className="btn sm ghost" disabled={save.isPending} onClick={() => send({ status: 'methodology' })}>Back to the manuals' status</button> : null}
        </div>
        <label className="knotefield">Note
          <textarea rows={3} value={note ?? c.coachNote ?? ''} onChange={(e) => setNote(e.target.value)} placeholder="Your view, a correction, or what to decide later" />
        </label>
        <div className="row wrap"><button type="button" className="btn primary sm" disabled={save.isPending || note === null} onClick={() => send({ note: note ?? '' })}>Save note</button></div>
        <p className="small">Teaching Chalkboard in your own words, with conflict checks, comes with the Coach screen (next phase). Changing a status here does not change the engine's behaviour yet.</p>
        {save.isError ? <p className="warn" role="alert">Not saved. Try again.</p> : null}
        {history.length ? <ul className="small">{history.map((e, i) => <li key={i}>{e.at.slice(0, 16).replace('T', ' ')} · {e.by ?? 'coach'} · {e.action === 'status' ? `status → ${e.detail.to?.status ?? 'methodology'}` : `note${e.detail.to?.note ? '' : ' removed'}`}</li>)}</ul> : null}
      </section>
    </article>
  );
}

export function KnowledgeTabs({ current }: { current: 'map' | 'ask' | 'movements' | 'coach' }) {
  return (
    <p className="row wrap ktabs">
      <Link href="/knowledge" className="btn sm" aria-current={current === 'map'}>Map</Link>
      <Link href="/knowledge/ask" className="btn sm" aria-current={current === 'ask'}>Ask</Link>
      <Link href="/knowledge/coach" className="btn sm" aria-current={current === 'coach'}>Coach</Link>
      <Link href="/knowledge/movements" className="btn sm" aria-current={current === 'movements'}>Movements</Link>
    </p>
  );
}

type Answer = { id: string; answer: string; cardIds: string[]; covered: boolean; gap: string };

/** Ask: questions answered only from the cards and the plan, with the cards used. */
export function KnowledgeAsk() {
  const { q, d } = useKnowledge();
  const qc = useQueryClient();
  const ask = useAskKnowledge();
  const [text, setText] = useState('');
  const [last, setLast] = useState<(Answer & { question: string }) | null>(null);
  const titles = new Map((d?.cards ?? []).map((c) => [c.id, c]));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const question = text.trim();
    if (question.length < 3) return;
    ask.mutate({ data: { question, today: localToday() } }, { onSuccess: (r) => { setLast({ ...(r as Answer), question }); setText(''); qc.invalidateQueries({ queryKey: getGetKnowledgeQueryKey() }); } });
  };
  const err = ask.error as { data?: { error?: string } } | null;
  const shown = (d?.questions ?? []).filter((x) => x.id !== last?.id);
  const Cited = ({ ids }: { ids: string[] }) => ids.length ? (
    <div className="small kcited">Cards: {ids.map((id, i) => <span key={id}>{i ? ' · ' : ''}<Link href={`/knowledge/${id}`}>{titles.get(id)?.title ?? id}</Link>{titles.get(id) && titles.get(id)!.status !== 'confirmed' ? <> <StatusChip s={titles.get(id)!.status} /></> : null}</span>)}</div>
  ) : null;
  return (
    <>
      <h1>Ask Chalkboard</h1>
      <KnowledgeTabs current="ask" />
      <p className="small">Answers come only from Chalkboard's cards, your settings and the plan (two weeks back and ahead), with the cards used. If nothing covers the question, it says so and the question is listed as a gap on the Map.</p>
      <form onSubmit={submit} className="kask">
        <textarea rows={3} aria-label="Your question" value={text} onChange={(e) => setText(e.target.value)} placeholder="Why is Thursday a heavy day? · How often should we do long efforts? · What do you know about muscle-up progressions?" />
        <div className="row wrap"><button type="submit" className="btn primary" disabled={ask.isPending || text.trim().length < 3}>{ask.isPending ? 'Thinking…' : 'Ask'}</button></div>
      </form>
      {ask.isError ? <p className="warn" role="alert">{err?.data?.error ?? 'Chalkboard could not answer right now.'}</p> : null}
      {last ? (
        <div className="kqa">
          <div className="kq">{last.question}</div>
          <div className="ka">{last.answer}{!last.covered ? <div className="kopen small">Not covered yet{last.gap ? `: ${last.gap}` : ''}. Listed as a gap on the Map.</div> : null}<Cited ids={last.cardIds} /></div>
        </div>
      ) : null}
      {!d ? <p className="small">{q.isError ? 'Could not load the knowledge.' : 'Loading…'}</p> : shown.length ? (
        <section>
          <h2 className="sec">Earlier questions</h2>
          {shown.map((x) => (
            <div className="kqa" key={x.id}>
              <div className="kq">{x.question} <span className="small">{x.at.slice(0, 10)}</span></div>
              <div className="ka">{x.answer}{!x.covered ? <div className="kopen small">Not covered{x.gap ? `: ${x.gap}` : ''}.</div> : null}<Cited ids={x.cardIds} /></div>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
