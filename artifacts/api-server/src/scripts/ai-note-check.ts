/**
 * Check the AI coaching notes against the real database:
 *   pnpm --filter @workspace/api-server run check:ai -- --name Vadim [--date 2026-11-24] [--dry]
 * Prints what would be sent and the note Claude writes for that person's first program day on the date.
 * --dry prints the prompt only (no API call, no cost). Never prints the API key.
 */
import { sql } from '@workspace/fitness-db';
import { aiEnabled, promptFor, inputFor, AI_MODEL } from '../fitness/ai-notes';
import { getCoachingNote, coachingNoteArgs } from '../fitness/logging';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const name = arg('name') ?? 'Vadim';
const date = arg('date') ?? new Date().toISOString().slice(0, 10);
const dry = process.argv.includes('--dry');

const [a] = await sql`SELECT id FROM athletes WHERE lower(name) = lower(${name})`;
const [d] = await sql`SELECT id FROM program_days WHERE date = ${date} AND status IN ('proposed','approved','done') ORDER BY seq LIMIT 1`;
if (!a || !d) { console.log(`No ${!a ? `athlete named ${name}` : `program day on ${date}`}.`); process.exit(1); }

const args = await coachingNoteArgs(d.id, a.id);
console.log(`Model: ${AI_MODEL}. API key set: ${aiEnabled() ? 'yes' : 'no'}.`);
if (dry) { console.log(`\nPrompt the app sends:\n\n${promptFor(inputFor(args))}`); process.exit(0); }
if (!aiEnabled()) { console.log('ANTHROPIC_API_KEY is not set: Today shows the built-in notes.'); process.exit(1); }
const t = Date.now();
await sql`DELETE FROM coaching_notes WHERE day_id = ${d.id} AND athlete_id = ${a.id}`;
const r = await getCoachingNote(d.id, a.id);
if (!r.note) { console.log('No note came back (see the server log line above). Today will show the built-in notes.'); process.exit(1); }
console.log(`\nAI note for ${name} on ${date} (${Date.now() - t} ms):\n${r.note.approach}\n${r.note.tips.map((x) => `  - ${x}`).join('\n')}`);
process.exit(0);
