import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetKnowledge, getGetKnowledgeQueryKey, useTeachKnowledge, useDecideTeaching, type TeachDecisionAction } from '@workspace/api-client-react';
import type { MergedCard } from '@workspace/fitness-core';
import { KnowledgeTabs, StatusChip } from '@/pages/knowledge';

type Draft = {
  understood: string;
  cards: { title: string; statement: string; area: string; kind: string; strength: string; scope: string; links: { rel: string; to: string }[] }[];
  settingChanges: { path: string; value: number | boolean; why: string }[];
  conflicts: { cardId: string; summary: string; position: 'agree' | 'partly' | 'disagree'; reasoning: string }[];
  questions: string[];
};
type Preview = { changed: { date: string; before: string; after: string }[]; checked: number; from: string | null; to: string | null };
type Teaching = { id: string; text: string; draft: Draft; preview: Preview | null; status: 'draft' | 'confirmed' | 'discarded' | 'undone'; decision: string | null; at: string };
type Data = { cards: MergedCard[]; settings: Record<string, unknown>; teachings: Teaching[]; areas: { id: string; name: string }[] };

const POSITION = { agree: 'I agree: the card should yield', partly: 'Partly: both hold, with a limit', disagree: 'I disagree: I think the card is right' } as const;
const STATUS = { draft: 'draft', confirmed: 'confirmed', discarded: 'discarded', undone: 'undone' } as const;

/** Teach Chalkboard: explain, see how it understood it, what it would change and what it conflicts with, then decide. */
export function CoachPage() {
  const q = useGetKnowledge({ query: { queryKey: getGetKnowledgeQueryKey() } });
  const qc = useQueryClient();
  const teach = useTeachKnowledge();
  const decide = useDecideTeaching();
  const [text, setText] = useState('');
  const [correction, setCorrection] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const d = q.data as Data | undefined;
  const refresh = () => qc.invalidateQueries({ queryKey: getGetKnowledgeQueryKey() });
  const draft = d?.teachings.find((t) => t.id === current && t.status === 'draft') ?? d?.teachings.find((t) => t.status === 'draft');
  const cardById = new Map((d?.cards ?? []).map((c) => [c.id, c]));
  const areaName = new Map((d?.areas ?? []).map((a) => [a.id, a.name]));
  const err = (teach.error ?? decide.error) as { data?: { error?: string } } | null;

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 10) return;
    setDone(null);
    teach.mutate({ data: { text: text.trim() } }, { onSuccess: (r) => { setCurrent((r as { id: string }).id); setText(''); refresh(); } });
  };
  const correct = () => draft && correction.trim() && teach.mutate({ data: { teachingId: draft.id, correction: correction.trim() } }, { onSuccess: () => { setCorrection(''); refresh(); } });
  const act = (id: string, action: TeachDecisionAction, msg: string) => decide.mutate({ data: { teachingId: id, action } }, {
    onSuccess: (r) => { const kept = (r as { keptSettings?: string[] }).keptSettings; setDone(kept?.length ? `${msg} These settings were changed since and were left as they are: ${kept.join(', ')}.` : msg); setCurrent(null); refresh(); },
  });

  return (
    <>
      <h1>Teach Chalkboard</h1>
      <KnowledgeTabs current="coach" />
      <p className="small">Explain something in your own words. Chalkboard restates it as cards, proposes any setting change it implies, checks the planner's next four weeks for days that would change, and lists conflicts with what it already knows, with its position on each. Nothing is saved until you confirm, and a confirmed teaching can be undone.</p>
      {!draft ? (
        <form onSubmit={send} className="kask">
          <textarea rows={5} aria-label="What to teach" value={text} onChange={(e) => setText(e.target.value)}
            placeholder="E.g. In a small group like our family, weaknesses can also influence which workout we choose, not only warm-ups and skill work. Overall balance still comes first." />
          <div className="row wrap"><button type="submit" className="btn primary" disabled={teach.isPending || text.trim().length < 10}>{teach.isPending ? 'Reading…' : 'Send to Chalkboard'}</button></div>
        </form>
      ) : null}
      {err ? <p className="warn" role="alert">{err.data?.error ?? 'Something went wrong. Try again.'}</p> : null}
      {done ? <p className="ok">{done}</p> : null}

      {draft ? (
        <ol className="steps">
          <li><b>You explained</b><div className="kq" style={{ display: 'block', fontWeight: 400 }}>{draft.text}</div></li>
          <li><b>How I understood it</b><p>{draft.draft.understood}</p>
            {draft.draft.questions.length ? <div className="kopen"><b>Questions for you:</b><ul>{draft.draft.questions.map((x) => <li key={x}>{x}</li>)}</ul></div> : null}
          </li>
          <li><b>Draft card{draft.draft.cards.length === 1 ? '' : 's'}</b>
            {draft.draft.cards.length ? draft.draft.cards.map((c, i) => (
              <div key={i} className="kdraft">
                <div className="row wrap"><span className="kstatus k-proposed">draft</span><span className="tag">{c.strength}</span><span className="small">{areaName.get(c.area) ?? c.area}{c.scope ? ` · ${c.scope}` : ''}</span></div>
                <p><b>{c.title}.</b> {c.statement}</p>
                {c.links.length ? <p className="small">{c.links.map((l, j) => <span key={j}>{j ? ' · ' : ''}{l.rel} → <Link href={`/knowledge/${l.to}`}>{cardById.get(l.to)?.title ?? l.to}</Link></span>)}</p> : null}
              </div>
            )) : <p className="small">No card: correct the draft or discard it.</p>}
          </li>
          <li><b>What would change</b>
            {draft.draft.settingChanges.length ? (
              <>
                <table className="ktable"><thead><tr><th>Setting</th><th>Now</th><th>New</th><th>Why</th></tr></thead>
                  <tbody>{draft.draft.settingChanges.map((s) => <tr key={s.path}><td><code>{s.path}</code></td><td>{String((d?.settings as Record<string, unknown>)[s.path] ?? '')}</td><td><b>{String(s.value)}</b></td><td className="small">{s.why}</td></tr>)}</tbody></table>
                {draft.preview ? (draft.preview.changed.length ? (
                  <><p className="small">Of {draft.preview.checked} open days from {draft.preview.from} to {draft.preview.to}, {draft.preview.changed.length} would get a different workout (the planner is dry-run; nothing is saved):</p>
                    <ul className="small">{draft.preview.changed.map((c) => <li key={c.date}>{c.date}: {c.before} → <b>{c.after}</b></li>)}</ul></>
                ) : <p className="small">The planner's picks for the next {draft.preview.checked} open days would stay the same.</p>) : null}
              </>
            ) : <p className="small">No setting changes: this becomes knowledge Chalkboard cites in answers and on the Map. It changes the planner once a rule uses it.</p>}
          </li>
          <li><b>Conflicts</b>
            {draft.draft.conflicts.length ? draft.draft.conflicts.map((x) => (
              <div key={x.cardId} className={`kconflict k-pos-${x.position}`}>
                <div className="row wrap"><span className="kstatus k-disputed">conflict</span> <Link href={`/knowledge/${x.cardId}`}>{cardById.get(x.cardId)?.title ?? x.cardId}</Link> {cardById.get(x.cardId) ? <StatusChip s={cardById.get(x.cardId)!.status} /> : null}</div>
                <p className="small">{x.summary}</p>
                <p><b>{POSITION[x.position]}.</b> {x.reasoning}</p>
              </div>
            )) : <p className="small">None found in the related cards.</p>}
          </li>
          <li><b>You decide</b>
            <div className="row wrap" style={{ marginTop: 6 }}>
              {draft.draft.conflicts.some((x) => x.position === 'disagree')
                ? <button type="button" className="btn primary" disabled={decide.isPending} onClick={() => act(draft.id, 'override', 'Saved as a coach decision; the conflict stays on record.')}>Confirm as coach decision</button>
                : <button type="button" className="btn primary" disabled={decide.isPending || (!draft.draft.cards.length && !draft.draft.settingChanges.length)} onClick={() => act(draft.id, 'confirm', 'Confirmed and saved.')}>Confirm</button>}
              <button type="button" className="btn" disabled={decide.isPending} onClick={() => act(draft.id, 'discard', 'Discarded.')}>Discard</button>
            </div>
            <label className="knotefield">Or correct it
              <textarea rows={3} value={correction} onChange={(e) => setCorrection(e.target.value)} placeholder="What Chalkboard got wrong, or what to add" />
            </label>
            <button type="button" className="btn sm" disabled={teach.isPending || !correction.trim()} onClick={correct}>{teach.isPending ? 'Reading…' : 'Send correction'}</button>
            {draft.draft.settingChanges.length ? <p className="small">Confirming changes the settings; proposed days are re-planned the next time you propose or re-plan on Program.</p> : null}
          </li>
        </ol>
      ) : null}

      {d?.teachings.some((t) => t.status !== 'draft') ? (
        <section>
          <h2 className="sec">Earlier teachings</h2>
          <ul className="kcards">{d.teachings.filter((t) => t.status !== 'draft').map((t) => (
            <li key={t.id}>
              <div className="small">{t.at.slice(0, 10)} · {STATUS[t.status]}{t.decision === 'override' ? ' (coach decision over a conflict)' : ''}</div>
              <div>{t.text}</div>
              {t.status === 'confirmed' ? <button type="button" className="btn sm ghost" disabled={decide.isPending} onClick={() => act(t.id, 'undo', 'Undone: its cards are off and its settings are back.')}>Undo</button> : null}
            </li>
          ))}</ul>
        </section>
      ) : null}
    </>
  );
}
