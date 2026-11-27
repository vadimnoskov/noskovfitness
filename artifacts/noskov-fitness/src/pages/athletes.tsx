/**
 * Athletes (coach): the programs you coach, their athletes, training days and locations (equipment), and adding an
 * athlete. A program is the family's, or a client's own (or a small group of clients).
 */
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetPeople, getGetPeopleQueryKey, usePeopleAction, getGetMeQueryKey } from '@workspace/api-client-react';
import { useMe } from '@/lib/session';
import { setProgram } from '@/lib/program';
import { LOCATION_LIMITS } from '@workspace/fitness-core';

type Item = { implement: string; quantity: number; loads?: { value: number; unit: 'lb' | 'kg'; qty: number }[]; note?: string };
type Location = { id: string; name: string; items: Item[]; limits?: string[] };
type Member = { id: string; name: string; sex: string; units: string; birthYear: number | null; birthDate: string | null; isCoach: boolean; hasPassword: boolean };
type Program = { id: string; name: string; coachId: string | null; family: boolean; trainingDays: number[]; defaultLocation: string | null; members: Member[]; locations: Location[] };
type People = { programs: Program[]; coaches: { id: string; name: string }[] };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Equipment the planner knows, in the order a coach would think of it. */
const EQUIPMENT: [string, string][] = [
  ['barbell', 'Barbell'], ['plate', 'Plates'], ['rack', 'Rack'], ['bench', 'Bench'], ['dumbbell', 'Dumbbells'], ['kettlebell', 'Kettlebells'],
  ['medball', 'Medicine ball'], ['sandbag', 'Sandbag'], ['bar', 'Pull-up bar'], ['rings', 'Rings'], ['p-bars', 'Dip station / parallel bars'],
  ['parallettes', 'Parallettes'], ['box', 'Box'], ['rope', 'Climbing rope'], ['ghd', 'GHD'], ['wall', 'Wall space (handstands, wall balls)'],
  ['jump-rope', 'Jump rope'], ['rower', 'Rower'], ['air-bike', 'Air bike'], ['bike-erg', 'Bike erg'], ['ski-erg', 'Ski erg'], ['sled', 'Sled'],
  ['none', 'Running route'],
];
const FIXED = new Set(['dumbbell', 'kettlebell', 'medball', 'sandbag', 'barbell']);

/** "12kg, 16kg" or "5,10,15 lb x2" → loads (dumbbells come in pairs unless "x1"). */
export function parseLoads(text: string, implement: string, units: 'lb' | 'kg'): Item['loads'] {
  const out: NonNullable<Item['loads']> = [];
  const groupUnit = /kg/i.test(text) && !/lb/i.test(text) ? 'kg' : /lb/i.test(text) && !/kg/i.test(text) ? 'lb' : units;
  const qtyAll = /x\s*(\d+)\s*$/i.exec(text)?.[1];
  for (const part of text.replace(/x\s*\d+\s*$/i, '').split(/[,;]+/)) {
    const m = /(\d+(?:\.\d+)?)\s*(kg|lb)?\s*(?:x\s*(\d+))?/i.exec(part.trim());
    if (!m) continue;
    out.push({ value: Number(m[1]), unit: ((m[2]?.toLowerCase() as 'lb' | 'kg') ?? groupUnit), qty: Number(m[3] ?? qtyAll ?? (implement === 'dumbbell' ? 2 : 1)) });
  }
  return out.length ? out : undefined;
}
const loadsText = (i?: Item) => (i?.loads ?? []).map((l) => `${l.value}${l.unit}${l.qty !== (i?.implement === 'dumbbell' ? 2 : 1) ? ` x${l.qty}` : ''}`).join(', ');
const age = (m: Member) => (m.birthDate ? Math.floor((Date.now() - Date.parse(m.birthDate)) / 31557600000) : m.birthYear ? new Date().getFullYear() - m.birthYear : null);

export default function AthletesPage() {
  const q = useGetPeople({ query: { queryKey: getGetPeopleQueryKey() } });
  const d = q.data as People | undefined;
  return (
    <>
      <h1>Athletes</h1>
      <p className="small">Each program has its own coach, training days, locations and programming settings. Chalkboard plans each program on its own; every athlete's Today shows their program's day.</p>
      {!d ? <p className="empty">{q.isError ? "Couldn't load athletes." : 'Loading…'}</p> : (
        <>
          {d.programs.map((p) => <ProgramBlock key={p.id} p={p} coaches={d.coaches} />)}
          <AddAthlete programs={d.programs} coaches={d.coaches} />
        </>
      )}
    </>
  );
}

function useAct() {
  const qc = useQueryClient();
  const m = usePeopleAction();
  const [error, setError] = useState<string | null>(null);
  const run = (action: 'addAthlete' | 'editAthlete' | 'editProgram' | 'saveLocation' | 'importHistory', data: Record<string, string | string[]>, after?: (r: Record<string, unknown>) => void) => {
    setError(null);
    m.mutate({ action, data }, {
      onSuccess: (r) => { qc.invalidateQueries({ queryKey: getGetPeopleQueryKey() }); qc.invalidateQueries({ queryKey: getGetMeQueryKey() }); after?.(r as Record<string, unknown>); },
      onError: (e) => setError((e as { data?: { error?: string } }).data?.error ?? 'Could not save.'),
    });
  };
  return { run, error, pending: m.isPending };
}

function ProgramBlock({ p, coaches }: { p: Program; coaches: People['coaches'] }) {
  const me = useMe();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { run, error, pending } = useAct();
  const open = (to: string) => { setProgram(p.id); qc.invalidateQueries(); navigate(to); };
  const coachName = p.family ? 'head coach' : coaches.find((c) => c.id === p.coachId)?.name ?? 'head coach';
  return (
    <section className="program">
      <h2 className="sec">{p.name}</h2>
      <p className="small">Coach: {coachName} · Training days: {p.trainingDays.map((d) => DAYS[d - 1]).join(', ')} · Default location: {p.locations.find((l) => l.id === p.defaultLocation)?.name ?? 'none yet'}</p>
      <div className="row wrap">
        <button type="button" className="btn sm" onClick={() => open('/program')}>Open program</button>
        <button type="button" className="btn sm" onClick={() => open('/settings')}>Programming settings</button>
        <button type="button" className="btn ghost sm" onClick={() => setEditing(!editing)}>{editing ? 'Close' : 'Edit days and coach'}</button>
      </div>
      {editing ? (
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          run('editProgram', { programId: p.id, name: String(f.get('name') ?? ''), trainingDays: f.getAll('trainingDays').map(String), coachId: String(f.get('coachId') ?? ''), defaultLocation: String(f.get('defaultLocation') ?? '') }, () => setEditing(false));
        }}>
          <label>Name <input name="name" defaultValue={p.name} /></label>
          <fieldset className="row wrap"><legend className="small">Usual training days (Chalkboard plans these; move any day on Program)</legend>
            {DAYS.map((d, i) => <label key={d} className="small"><input type="checkbox" name="trainingDays" value={i + 1} defaultChecked={p.trainingDays.includes(i + 1)} /> {d}</label>)}</fieldset>
          {!p.family && me?.user.isCoach ? <label>Coach <select name="coachId" defaultValue={p.coachId ?? ''}>{coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : null}
          {p.locations.length ? <label>Default location <select name="defaultLocation" defaultValue={p.defaultLocation ?? ''}>{p.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label> : null}
          <button type="submit" className="btn sm" disabled={pending}>Save</button>
          {error ? <p className="warn">{error}</p> : null}
        </form>
      ) : null}
      <ul className="members">
        {p.members.map((m) => (
          <li key={m.id}><b>{m.name}</b> <span className="small">{[m.sex, age(m) !== null ? `${age(m)} y` : null, m.units, m.hasPassword ? 'can sign in' : 'no sign-in yet'].filter(Boolean).join(' · ')}</span>{' '}
            <Link href={`/today?a=${m.id}`}>Today</Link> · <Link href={`/history?a=${m.id}`}>History</Link> · <Link href={`/fitness?a=${m.id}`}>Fitness</Link>
            {!p.family ? <ImportHistory athleteId={m.id} name={m.name} /> : null}</li>
        ))}
      </ul>
      <h3 className="small">Locations</h3>
      {p.locations.map((l) => <LocationEditor key={l.id} programId={p.id} loc={l} units={(p.members[0]?.units as 'lb' | 'kg') ?? 'lb'} />)}
      <LocationEditor programId={p.id} units={(p.members[0]?.units as 'lb' | 'kg') ?? 'lb'} />
    </section>
  );
}

/** A location's equipment: tick what is there, how many, and the weights of fixed-weight implements. */
function LocationEditor({ programId, loc, units }: { programId: string; loc?: Location; units: 'lb' | 'kg' }) {
  const [open, setOpen] = useState(false);
  const { run, error, pending } = useAct();
  const has = (k: string) => loc?.items.find((i) => i.implement === k);
  if (!open) return <p><button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>{loc ? `${loc.name}: ${loc.items.length} kinds of equipment · edit` : '+ Add a location'}</button></p>;
  return (
    <form className="stack loc" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const items: Item[] = EQUIPMENT.filter(([k]) => f.get(`on.${k}`) === 'on').map(([k]) => {
        const loads = FIXED.has(k) ? parseLoads(String(f.get(`loads.${k}`) ?? ''), k, units) : undefined;
        const note = String(f.get(`note.${k}`) ?? '').trim();
        return { implement: k, quantity: Math.max(1, Number(f.get(`qty.${k}`)) || 1), ...(loads ? { loads } : {}), ...(note ? { note } : {}) };
      });
      run('saveLocation', { programId, locationId: loc?.id ?? '', name: String(f.get('name') ?? ''), items: JSON.stringify(items), limits: f.getAll('limits').map(String) }, () => setOpen(false));
    }}>
      <label>Location name <input name="name" defaultValue={loc?.name ?? ''} placeholder="e.g. Building gym" required /></label>
      <table className="equip"><thead><tr><th>Equipment</th><th>How many</th><th>Weights / notes</th></tr></thead><tbody>
        {EQUIPMENT.map(([k, label]) => {
          const i = has(k);
          return (
            <tr key={k}>
              <td><label><input type="checkbox" name={`on.${k}`} defaultChecked={!!i} /> {label}</label></td>
              <td><input type="number" name={`qty.${k}`} min={1} defaultValue={i?.quantity ?? 1} style={{ width: 64 }} /></td>
              <td>{FIXED.has(k) ? <input name={`loads.${k}`} defaultValue={loadsText(i)} placeholder={k === 'dumbbell' ? 'e.g. 10, 15, 20, 25 lb (pairs)' : 'e.g. 12kg, 16kg'} /> : null}
                <input name={`note.${k}`} defaultValue={i?.note ?? ''} placeholder="note" /></td>
            </tr>
          );
        })}
      </tbody></table>
      <p className="small">Weights: list them separated by commas, with lb or kg; dumbbells count as pairs unless you add "x1".</p>
      <fieldset className="stack"><legend className="small">What this place can't do</legend>
        {LOCATION_LIMITS.map((l) => <label key={l.key} className="small"><input type="checkbox" name="limits" value={l.key} defaultChecked={!!loc?.limits?.includes(l.key)} /> {l.label}</label>)}
      </fieldset>
      <div className="row"><button type="submit" className="btn sm" disabled={pending}>Save location</button><button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Cancel</button></div>
      {error ? <p className="warn">{error}</p> : null}
    </form>
  );
}

function AddAthlete({ programs, coaches }: { programs: Program[]; coaches: People['coaches'] }) {
  const me = useMe();
  const [program, setProgramChoice] = useState('new');
  const [done, setDone] = useState<string | null>(null);
  const { run, error, pending } = useAct();
  return (
    <section>
      <h2 className="sec">Add an athlete</h2>
      <form className="stack" onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget, f = new FormData(form);
        const data: Record<string, string | string[]> = {};
        for (const k of ['name', 'sex', 'birthDate', 'units', 'program', 'coachId']) data[k] = String(f.get(k) ?? '');
        data.trainingDays = f.getAll('trainingDays').map(String);
        run('addAthlete', data, () => { setDone(String(f.get('name'))); form.reset(); setProgramChoice('new'); });
      }}>
        <label>Name <input name="name" required placeholder="First and last name" /></label>
        <label>Sex (for Rx loads) <select name="sex" required defaultValue=""><option value="" disabled>Choose</option><option value="female">Female</option><option value="male">Male</option></select></label>
        <label>Birth date <input type="date" name="birthDate" /></label>
        <label>Units <select name="units" defaultValue="lb"><option value="lb">lb</option><option value="kg">kg</option></select></label>
        <label>Program <select name="program" value={program} onChange={(e) => setProgramChoice(e.target.value)}>
          <option value="new">A new program of their own</option>
          {programs.map((p) => <option key={p.id} value={p.id}>Join {p.name}</option>)}
        </select></label>
        {program === 'new' ? (
          <>
            <fieldset className="row wrap"><legend className="small">Usual training days</legend>
              {DAYS.map((d, i) => <label key={d} className="small"><input type="checkbox" name="trainingDays" value={i + 1} defaultChecked={[1, 2, 4, 5].includes(i + 1)} /> {d}</label>)}</fieldset>
            {me?.user.isCoach ? <label>Coach <select name="coachId" defaultValue={me.user.id}>{coaches.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> : null}
            <p className="small">After adding, add the location where they train (its equipment) under their program.</p>
          </>
        ) : null}
        <button type="submit" className="btn" disabled={pending}>Add athlete</button>
        {error ? <p className="warn">{error}</p> : null}
        {done ? <p className="ok">{done} added.</p> : null}
      </form>
    </section>
  );
}

/** Upload a client's BTWB export CSV (or rows in the same columns) into their history. Re-uploading skips duplicates. */
function ImportHistory({ athleteId, name }: { athleteId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const { run, error, pending } = useAct();
  if (!open) return <> · <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>Import history</button></>;
  return (
    <div className="stack loc">
      <p className="small">Import {name}'s BTWB history: the CSV from BTWB's "export my data" (columns Date, Formatted Result, Result, Performed, Workout, Description, Notes). Results already there are skipped.</p>
      <input type="file" accept=".csv,text/csv,text/plain" disabled={pending} onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setReport(null);
        run('importHistory', { athleteId, csv: await file.text() }, (r) => {
          const x = r as { imported?: number; duplicates?: number; skipped?: { date: string; workout: string; why: string }[]; from?: string; to?: string };
          setReport(`${x.imported ?? 0} results imported${x.from ? ` (${x.from} to ${x.to})` : ''}; ${x.duplicates ?? 0} already there; ${x.skipped?.length ?? 0} skipped${x.skipped?.length ? `: ${x.skipped.slice(0, 8).map((s) => `${s.date} ${s.workout} (${s.why})`).join('; ')}` : ''}.`);
        });
      }} />
      {pending ? <p className="small">Importing…</p> : null}
      {report ? <p className="ok">{report}</p> : null}
      {error ? <p className="warn">{error}</p> : null}
      <button type="button" className="btn ghost sm" onClick={() => setOpen(false)}>Close</button>
    </div>
  );
}
