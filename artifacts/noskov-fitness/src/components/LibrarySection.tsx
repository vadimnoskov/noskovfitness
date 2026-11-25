import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGetLibrary, getGetLibraryQueryKey, useImportLibrary } from '@workspace/api-client-react';

type Report = {
  published: number; bundled: number; builtAt: string; programmable: number; notProgrammable: number; opens: number;
  reasons: { reason: string; count: number }[]; flagged: { id: string; name: string | null; text: string; reason: string; last: string | null }[]; offset: number;
};
type ImportResult = { inserted: number; linked: number; alreadyImported: number; entries: number; replaced: number };

/** Coach: the workout library, the import button, and what the engine will not propose (and why). */
export function LibrarySection() {
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const q = useGetLibrary({ offset }, { query: { queryKey: getGetLibraryQueryKey({ offset }) } });
  const imp = useImportLibrary();
  const [result, setResult] = useState<ImportResult | null>(null);
  const r = q.data as Report | undefined;
  if (!r) return null;
  const run = () => imp.mutate(undefined, { onSuccess: (x) => { setResult(x as ImportResult); qc.invalidateQueries(); } });
  return (
    <section className="library">
      <h2 className="sec">Workout library</h2>
      <p className="small">
        {r.bundled.toLocaleString()} published workouts come with the app (built {r.builtAt}). In the database: {r.published.toLocaleString()} added from it,
        {' '}{r.programmable.toLocaleString()} of them can be proposed; {r.notProgrammable.toLocaleString()} are kept for reference only. Opens in the library: {r.opens}.
        {' '}Workouts that match your own history are linked to it, not duplicated. Coaching text and brand names are not kept.
      </p>
      <button type="button" className="btn primary" disabled={imp.isPending} onClick={run}>{imp.isPending ? 'Importing…' : r.published ? 'Update library' : 'Import library'}</button>
      {result ? <p className="ok">Done: {result.inserted} added, {result.replaced} older readings removed, {result.linked} matched your history, {result.alreadyImported} already in the library (refreshed unless in use).</p> : null}
      {imp.isError ? <p className="warn" role="alert">Import failed. Nothing was changed; try again.</p> : null}
      {r.notProgrammable ? (
        <details className="flagged">
          <summary>Not proposed ({r.notProgrammable.toLocaleString()}): {r.reasons.map((x) => `${x.reason} ${x.count}`).join(' · ')}</summary>
          <ul>{r.flagged.map((f) => (
            <li key={f.id}><div className="small"><b>{f.reason}</b>{f.last ? ` · last posted ${f.last}` : ''}</div><pre>{f.text}</pre></li>
          ))}</ul>
          <div className="row wrap">
            {offset > 0 ? <button type="button" className="btn sm" onClick={() => setOffset(Math.max(0, offset - 100))}>← Newer</button> : null}
            {offset + 100 < r.notProgrammable ? <button type="button" className="btn sm" onClick={() => setOffset(offset + 100)}>Older →</button> : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
