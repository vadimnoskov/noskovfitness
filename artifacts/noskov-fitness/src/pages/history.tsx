import { useState } from 'react';
import { useSearch, useLocation } from 'wouter';
import { useGetHistory, getGetHistoryQueryKey } from '@workspace/api-client-react';
import { useMe, type Person } from '@/lib/session';
import { ResultItem, type ResultRow } from '@/components/ResultItem';
import { AthletePicker } from '@/pages/today';
import { PageStatus } from '@/lib/api';

const PAGE = 40;
type HistoryData = { results: ResultRow[]; more: boolean; total: number };

/** One block of results; the last block offers "Show more", which adds the next block. */
function Chunk({ athlete, self, q, page, last, onMore }: { athlete: Person; self: boolean; q: string; page: number; last: boolean; onMore: () => void }) {
  const params = { ...(self ? {} : { athleteId: athlete.id }), ...(q ? { q } : {}), limit: PAGE, offset: page * PAGE };
  const res = useGetHistory(params, { query: { queryKey: getGetHistoryQueryKey(params) } });
  const data = res.data as HistoryData | undefined;
  if (!data) return <PageStatus q={res} />;
  return (
    <>
      {page === 0 ? <p className="small">{q ? `${data.results.length}${data.more ? '+' : ''} matching` : `${data.total} results in total`}</p> : null}
      {page === 0 && data.results.length === 0 ? <p className="empty">Nothing found.</p> : null}
      <ul className="results">{data.results.map((r) => <ResultItem key={r.id} r={r} sex={athlete.sex} />)}</ul>
      {last && data.more ? <button className="btn big" type="button" onClick={onMore}>Show more</button> : null}
    </>
  );
}

export default function History() {
  const me = useMe();
  const sp = Object.fromEntries(new URLSearchParams(useSearch())) as { a?: string };
  const [, navigate] = useLocation();
  const [q, setQ] = useState('');
  const [pages, setPages] = useState(1);
  if (!me) return <p className="empty">Loading…</p>;
  const athlete = me.logFor.find((p) => p.id === (sp.a ?? me.user.id)) ?? me.user;
  const self = athlete.id === me.user.id;
  const term = q.trim();
  return (
    <div className="phone-page">
      <h1>{self ? 'My history' : `${athlete.name}'s history`}</h1>
      <AthletePicker value={athlete.id} onChange={(a) => { setPages(1); navigate(a === me.user.id ? '/history' : `/history?a=${a}`); }} />
      <label className="searchbox">Search<input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPages(1); }} placeholder="Workout or movement, e.g. Helen, deadlift" /></label>
      {Array.from({ length: pages }, (_, i) => (
        <Chunk key={`${athlete.id}|${term}|${i}`} athlete={athlete} self={self} q={term} page={i} last={i === pages - 1} onMore={() => setPages(pages + 1)} />
      ))}
    </div>
  );
}
