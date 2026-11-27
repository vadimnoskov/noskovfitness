/**
 * The program a coach is working on (the family's, or a client's). Coach screens (Program, Calendar, Analysis,
 * Settings, Benchmarks) show that program; every request carries it as the X-Program header, and the server checks the
 * coach may see it.
 */
import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setExtraHeadersGetter } from '@workspace/api-client-react';
import { useMe } from '@/lib/session';

const KEY = 'nf_program';
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) || 'family'; } catch { return 'family'; } };
setExtraHeadersGetter(() => ({ 'x-program': read() }));

export function setProgram(id: string) {
  try { localStorage.setItem(KEY, id); } catch { /* private mode: stays for this page only */ }
  listeners.forEach((l) => l());
}
export function useProgram(): string {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, read, () => 'family');
}

/** "Program: …" picker for coach screens; hidden when the person coaches only one program. */
export function ProgramPicker() {
  const me = useMe();
  const qc = useQueryClient();
  const current = useProgram();
  const mine = me?.programs?.filter((p) => p.coached) ?? [];
  if (mine.length < 2) return null;
  return (
    <label className="programpick">Program{' '}
      <select value={mine.some((p) => p.id === current) ? current : mine[0]!.id} onChange={(e) => { setProgram(e.target.value); qc.invalidateQueries(); }}>
        {mine.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}
