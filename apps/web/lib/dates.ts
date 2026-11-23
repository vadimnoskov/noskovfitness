export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const parse = (s: string) => new Date(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
/** Monday of the week containing s. */
export const weekStart = (s: string) => { const d = parse(s); const wd = (d.getUTCDay() + 6) % 7; return addDays(s, -wd); };
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const short = (s: string) => { const d = parse(s); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`; };
export const longDate = (s: string) => parse(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
