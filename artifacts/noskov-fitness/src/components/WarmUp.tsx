import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFitnessAction, useGetWarmUpTemplates, getGetWarmUpTemplatesQueryKey } from '@workspace/api-client-react';
import { parseNoteText } from '@workspace/fitness-core';

export type DayWarmUp = { text: string; source: 'day' | 'workout' | 'suggested'; suggested: string; minutes: number; workoutText: string | null };
type Template = { id: string; name: string; body: string };

/** Show the small note format: heading lines, "- " items, plain paragraphs. */
export function NoteText({ text }: { text: string }) {
  return (
    <>
      {parseNoteText(text).map((b, i) => (
        <div className="nb" key={i}>
          {b.heading ? <div className="nh">{b.heading}</div> : null}
          {b.paragraphs.map((p, j) => <p key={j}>{p}</p>)}
          {b.items.length ? <ul>{b.items.map((t, j) => <li key={j}>{t}</li>)}</ul> : null}
        </div>
      ))}
    </>
  );
}

const SOURCE: Record<DayWarmUp['source'], string> = { day: "Coach's warm-up for today", workout: "Coach's warm-up for this workout", suggested: 'Suggested' };

/** The warm-up on Today: closed by default (the workout comes first), with an edit button for the coach. */
export function WarmUpBox({ dayId, warmUp, coach }: { dayId: string; warmUp: DayWarmUp; coach: boolean }) {
  const [editing, setEditing] = useState(false);
  return (
    <details className="warmup">
      <summary><b>Warm-up</b> <span className="small">· about {warmUp.minutes} min{warmUp.source !== 'suggested' ? ` · ${SOURCE[warmUp.source]}` : ''}</span></summary>
      {editing ? <WarmUpEditor dayId={dayId} warmUp={warmUp} onDone={() => setEditing(false)} />
        : <>
          <NoteText text={warmUp.text} />
          {coach ? <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Edit warm-up</button> : null}
        </>}
    </details>
  );
}

/** Coach: change a day's warm-up (this day, or every time this workout is programmed), or use a saved one. */
export function WarmUpEditor({ dayId, warmUp, onDone, reload }: { dayId: string; warmUp: DayWarmUp; onDone?: () => void; reload?: boolean }) {
  const qc = useQueryClient();
  const m = useFitnessAction();
  const [text, setText] = useState(warmUp.text);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tq = useGetWarmUpTemplates({ query: { queryKey: getGetWarmUpTemplatesQueryKey(), staleTime: 60_000 } });
  const templates = ((tq.data as { templates?: Template[] } | undefined)?.templates) ?? [];
  const [picked, setPicked] = useState('');

  const run = (action: 'setWarmUp' | 'saveWarmUpTemplate' | 'deleteWarmUpTemplate', data: Record<string, string>, after?: () => void) => {
    setError(null);
    m.mutate({ action, data }, {
      onSuccess: () => {
        after?.();
        if (reload) window.location.reload();
        else { qc.invalidateQueries(); onDone?.(); }
      },
      onError: (e) => setError((e as { data?: { error?: string } }).data?.error ?? 'Could not save.'),
    });
  };
  const saveTemplate = () => {
    setError(null);
    m.mutate({ action: 'saveWarmUpTemplate', data: { name, text } }, {
      onSuccess: () => { setName(''); qc.invalidateQueries({ queryKey: getGetWarmUpTemplatesQueryKey() }); },
      onError: (e) => setError((e as { data?: { error?: string } }).data?.error ?? 'Could not save.'),
    });
  };

  return (
    <div className="wu-edit" aria-busy={m.isPending}>
      <p className="small">One item per line starting with "- ". A short line without "-" is a heading (General, Specific, Primer).</p>
      <textarea rows={Math.min(16, Math.max(6, text.split('\n').length + 1))} value={text} onChange={(e) => setText(e.target.value)} aria-label="Warm-up text" />
      <div className="row wrap">
        <button type="button" className="btn primary sm" disabled={m.isPending} onClick={() => run('setWarmUp', { id: dayId, text, scope: 'day' })}>Save for this day</button>
        <button type="button" className="btn sm" disabled={m.isPending} onClick={() => run('setWarmUp', { id: dayId, text, scope: 'workout' })}>Save for this workout, every time</button>
        {onDone ? <button type="button" className="btn ghost sm" onClick={onDone}>Cancel</button> : null}
      </div>
      <div className="row wrap">
        <button type="button" className="btn ghost sm" onClick={() => setText(warmUp.suggested)}>Start from the suggested one</button>
        {warmUp.source === 'day' ? <button type="button" className="btn ghost sm" disabled={m.isPending} onClick={() => run('setWarmUp', { id: dayId, text: '', scope: 'day' })}>Remove this day's warm-up</button> : null}
        {warmUp.workoutText ? <button type="button" className="btn ghost sm" disabled={m.isPending} onClick={() => run('setWarmUp', { id: dayId, text: '', scope: 'workout' })}>Forget the workout's saved warm-up</button> : null}
      </div>
      <div className="row wrap">
        <label className="grow">Your saved warm-ups
          <select value={picked} onChange={(e) => { setPicked(e.target.value); const t = templates.find((x) => x.id === e.target.value); if (t) setText(t.body); }}>
            <option value="">{templates.length ? 'Pick one to fill the box…' : 'None saved yet'}</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {picked ? <button type="button" className="btn ghost sm" disabled={m.isPending} onClick={() => { m.mutate({ action: 'deleteWarmUpTemplate', data: { templateId: picked } }, { onSuccess: () => { setPicked(''); qc.invalidateQueries({ queryKey: getGetWarmUpTemplatesQueryKey() }); } }); }}>Delete it</button> : null}
      </div>
      <div className="row wrap">
        <label className="grow">Save this text as<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Burgener + bar complex" maxLength={60} /></label>
        <button type="button" className="btn sm" disabled={m.isPending || !name.trim() || !text.trim()} onClick={saveTemplate}>Save to my warm-ups</button>
      </div>
      {error ? <p className="warn" role="alert">{error}</p> : null}
    </div>
  );
}
