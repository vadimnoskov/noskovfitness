import { Router, type IRouter } from 'express';
import cookieParser from 'cookie-parser';
import { timingSafeEqual } from 'node:crypto';
import { getGroup, getPolicy, getEquipmentProfiles } from '@workspace/fitness-db';
import { FamilyLoginBody, FitnessActionBody, FitnessActionParams, GetFitnessPageQueryParams, GetFitnessPageResponse } from '@workspace/api-zod';
import { COOKIE, tokenFor } from '../fitness/auth';
import * as data from '../fitness/data';
import { getPlannedDays } from '../fitness/program';
import * as program from '../fitness/program-actions';
import * as settings from '../fitness/settings-actions';

const router: IRouter = Router();
router.use(cookieParser());
router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const safeNext = (value: unknown) => typeof value === 'string' && /^\/(?![\\/])/.test(value) && !/[\r\n\\]/.test(value) ? value : '/';
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const failures = new Map<string, { count: number; until: number }>();

router.post('/fitness/login', async (req, res) => {
  const parsed = FamilyLoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Enter the family password.' }); return; }
  const password = process.env.APP_PASSWORD;
  if (!password) { res.status(503).json({ error: 'APP_PASSWORD is not set. Add the family password in Secrets, then restart.' }); return; }
  const key = req.ip ?? 'unknown';
  const attempt = failures.get(key);
  if (attempt && attempt.until > Date.now() && attempt.count >= 10) { res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }); return; }
  if (!same(parsed.data.password, password)) {
    if (failures.size > 1000) for (const [ip, v] of failures) if (v.until < Date.now()) failures.delete(ip);
    failures.set(key, { count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1, until: Date.now() + 900000 });
    res.status(401).json({ error: "That password didn't match." }); return;
  }
  failures.delete(key);
  res.cookie(COOKIE, await tokenFor(password), { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 60 * 60 * 24 * 60 * 1000, path: '/' });
  res.json({ ok: true, redirect: safeNext(parsed.data.next) });
});

router.use('/fitness', async (req, res, next) => {
  const password = process.env.APP_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === 'production') { res.status(503).json({ error: 'APP_PASSWORD is not set. Add it as a secret, then restart.' }); return; }
    next(); return;
  }
  if (!same(String(req.cookies?.[COOKIE] ?? ''), await tokenFor(password))) {
    res.status(401).json({ error: 'Family sign-in required.' }); return;
  }
  next();
});
router.use('/fitness', (req, res, next) => {
  if (req.method !== 'GET') {
    const origin = req.get('origin');
    const host = req.get('x-forwarded-host') ?? req.get('host');
    if (origin && new URL(origin).host !== host) { res.status(403).json({ error: 'Cross-site requests are not allowed.' }); return; }
  }
  next();
});

const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
router.get('/fitness/pages', async (req, res) => {
  const parsed = GetFitnessPageQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: 'Unknown fitness screen.' }); return; }
  const { screen, from, to } = parsed.data;
  if ((from && !date(from)) || (to && !date(to))) { res.status(400).json({ error: 'Use a valid YYYY-MM-DD date.' }); return; }
  const latestDate = await data.getLatestDate();
  const start = from ?? `${latestDate.slice(0, 4)}-01-01`, end = to ?? `${latestDate.slice(0, 4)}-12-31`;
  if (start > end || Date.parse(end) - Date.parse(start) > 3660 * 86400000) { res.status(400).json({ error: 'Choose a valid date range of up to 10 years.' }); return; }
  let payload: Record<string, unknown>;
  switch (screen) {
    case 'calendar': payload = { latestDate, days: [...(await data.getDays(start, end)).entries()] }; break;
    case 'analysis': payload = { latestDate, use: await data.getMovementUse(start, end), mix: await data.getMix(start, end) }; break;
    case 'benchmarks': payload = { rows: await data.getBenchmarks(), athletes: await data.getAthletes(), today: latestDate }; break;
    case 'program':
    case 'settings': {
      const group = await getGroup(data.GROUP_ID);
      if (!group) { res.status(503).json({ error: 'The family data has not been imported yet. Restore the existing private database export to use Program and Settings. No training records have been created or changed.' }); return; }
      const profiles = await getEquipmentProfiles(data.GROUP_ID);
      payload = screen === 'program'
        ? { days: await getPlannedDays(data.GROUP_ID, start, end), profiles, group }
        : { policy: await getPolicy(data.GROUP_ID), profiles, group };
      break;
    }
  }
  res.json(GetFitnessPageResponse.parse(payload!));
});

const actions = { ...program, ...settings };
router.post('/fitness/actions/:action', async (req, res) => {
  const params = FitnessActionParams.safeParse(req.params), body = FitnessActionBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: 'Invalid coach action or form.' }); return; }
  const action = params.data.action;
  const f = new FormData();
  for (const [key, values] of Object.entries(body.data)) for (const value of Array.isArray(values) ? values : [values]) f.append(key, value);
  for (const key of ['date', 'from', 'to']) if (f.has(key) && !date(f.get(key))) { res.status(400).json({ error: 'Choose a valid date.' }); return; }
  for (const key of ['id', 'workoutId']) if (f.has(key) && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(String(f.get(key)))) { res.status(400).json({ error: 'Invalid workout or day identifier.' }); return; }
  if (['approve', 'unapprove', 'swap', 'setLocation', 'skip', 'neverPropose'].includes(action) && !f.get('id')) { res.status(400).json({ error: 'Select a program day.' }); return; }
  if (['swap', 'neverPropose'].includes(action) && !f.get('workoutId')) { res.status(400).json({ error: 'Select a workout.' }); return; }
  if (action === 'setLocation' && !f.get('equipmentId')) { res.status(400).json({ error: 'Select a location.' }); return; }
  if (action === 'insert' && !date(f.get('date'))) { res.status(400).json({ error: 'Choose a valid date.' }); return; }
  if (action === 'skip' && !['drop', 'push'].includes(String(f.get('mode')))) { res.status(400).json({ error: 'Choose skip or push forward.' }); return; }
  if (!await getGroup(data.GROUP_ID)) { res.status(503).json({ error: 'Restore the family database export before changing the program.' }); return; }
  if (['propose', 'replan', 'insert', 'setLocation', 'neverPropose'].includes(action) && !(await getEquipmentProfiles(data.GROUP_ID)).length) {
    res.status(409).json({ error: 'Import the family equipment profiles before proposing workouts.' }); return;
  }
  if (['propose', 'approveAll', 'replan'].includes(action) && !date(f.get('from'))) { res.status(400).json({ error: 'Choose a start date.' }); return; }
  if (['approveAll', 'replan'].includes(action) && (!date(f.get('to')) || String(f.get('from')) > String(f.get('to')))) { res.status(400).json({ error: 'Choose a valid end date.' }); return; }
  await actions[action](f);
  res.json({ ok: true, ...(['savePolicyAction', 'resetPolicyAction'].includes(action) ? { redirect: '/settings?saved=1' } : {}) });
});

router.use((err: any, req: any, res: any, _next: any) => {
  req.log.error({ code: err.code }, 'Fitness request failed');
  const missing = ['42P01', '42703'].includes(err.code);
  res.status(missing ? 503 : 500).json({ error: missing
    ? 'The fitness database is not initialized. Apply the original schema and restore the family database export.'
    : 'The fitness request could not be completed. Please retry; if it continues, check the server logs.' });
});
export default router;
