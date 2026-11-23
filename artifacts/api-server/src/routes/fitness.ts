import { Router, type IRouter } from 'express';
import cookieParser from 'cookie-parser';
import { timingSafeEqual } from 'node:crypto';
import { getGroup, getPolicy, getEquipmentProfiles } from '@workspace/fitness-db';
import { FamilyLoginBody, FitnessActionBody, FitnessActionParams, GetFitnessPageQueryParams, GetFitnessPageResponse, ChangeMyPasswordBody, SetAthletePasswordBody, SetAthletePasswordParams, GetTodayQueryParams, GetHistoryQueryParams, GetWorkoutDetailQueryParams, SearchWorkoutsQueryParams, LogResultBody, DeleteResultParams, SetLoadProfileBody, SetLoadProfileParams, SetAthleteVersionBody } from '@workspace/api-zod';
import { COOKIE } from '../fitness/auth';
import * as accounts from '../fitness/accounts';
import { SESSION_COOKIE, SESSION_DAYS } from '../fitness/accounts';
import * as logging from '../fitness/logging';
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
const cookieParserToken = (req: { cookies?: Record<string, string> }) => req.cookies?.[SESSION_COOKIE];

const isProd = () => process.env.NODE_ENV === 'production';
const cookieOpts = () => ({ httpOnly: true, sameSite: 'lax' as const, secure: isProd(), maxAge: SESSION_DAYS * 86400000, path: '/' });
const tooMany = (key: string) => { const a = failures.get(key); return !!a && a.until > Date.now() && a.count >= 10; };
const fail = (key: string) => {
  const a = failures.get(key);
  if (failures.size > 1000) for (const [k, v] of failures) if (v.until < Date.now()) failures.delete(k);
  failures.set(key, { count: a && a.until > Date.now() ? a.count + 1 : 1, until: Date.now() + 900000 });
};

router.post('/fitness/login', async (req, res) => {
  const parsed = FamilyLoginBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) { res.status(400).json({ error: 'Enter your name and password.' }); return; }
  const key = req.ip ?? 'unknown';
  if (tooMany(key)) { res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' }); return; }
  const found = await accounts.findAthleteByName(parsed.data.name);
  let ok = false;
  if (found?.passwordHash) ok = await accounts.verifyPassword(parsed.data.password, found.passwordHash);
  else if (found?.user.isCoach && process.env.APP_PASSWORD) ok = same(parsed.data.password, process.env.APP_PASSWORD);
  if (!ok) {
    fail(key);
    const noPassword = found && !found.passwordHash && !found.user.isCoach;
    res.status(401).json({ error: noPassword ? `${found!.user.name} doesn't have a password yet. Ask the coach to set one on the Family page.` : "Name or password didn't match." });
    return;
  }
  failures.delete(key);
  res.cookie(SESSION_COOKIE, await accounts.createSession(found!.user.id), cookieOpts());
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true, redirect: !found!.passwordHash ? '/account?setup=1' : safeNext(parsed.data.next) });
});

router.post('/fitness/logout', async (req, res) => {
  await accounts.endSession(cookieParserToken(req));
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true, redirect: '/login' });
});

// Every other /fitness route needs a signed-in person. Local development without APP_PASSWORD runs as the coach.
router.use('/fitness', async (req, res, next) => {
  const user = await accounts.userForSession(cookieParserToken(req));
  if (user) { res.locals.user = user; next(); return; }
  if (!isProd() && !process.env.APP_PASSWORD) {
    const coach = await accounts.getCoach().catch(() => undefined);
    if (coach) { res.locals.user = coach; next(); return; }
    if (req.path === '/pages') { next(); return; } // empty development database: let screens show their own message
  }
  if (isProd() && !process.env.APP_PASSWORD) {
    const anyPassword = await accounts.listAthletes().then((a) => a.some((x) => x.hasPassword)).catch(() => false);
    if (!anyPassword) { res.status(503).json({ error: 'APP_PASSWORD is not set. Add it as a secret, then restart.' }); return; }
  }
  res.status(401).json({ error: 'Sign-in required.' });
});
const userOf = (res: { locals: Record<string, unknown> }) => res.locals.user as accounts.User | undefined;
const COACH_SCREENS = new Set(['calendar', 'program', 'analysis', 'settings']);
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
  const user = userOf(res);
  if (user && !user.isCoach && COACH_SCREENS.has(screen)) { res.status(403).json({ error: 'This page is for the coach.' }); return; }
  if ((from && !date(from)) || (to && !date(to))) { res.status(400).json({ error: 'Use a valid YYYY-MM-DD date.' }); return; }
  const latestDate = await data.getLatestDate();
  const start = from ?? `${latestDate.slice(0, 4)}-01-01`, end = to ?? `${latestDate.slice(0, 4)}-12-31`;
  if (start > end || Date.parse(end) - Date.parse(start) > 3660 * 86400000) { res.status(400).json({ error: 'Choose a valid date range of up to 10 years.' }); return; }
  let payload: Record<string, unknown>;
  switch (screen) {
    case 'calendar': payload = { latestDate, days: [...(await data.getDays(start, end)).entries()] }; break;
    case 'analysis': payload = { latestDate, use: await data.getMovementUse(start, end), mix: await data.getMix(start, end) }; break;
    case 'benchmarks': {
      const all = await data.getAthletes();
      const mineOnly = user && !user.isCoach;
      const rows = await data.getBenchmarks();
      payload = {
        rows: mineOnly ? rows.map((r) => ({ ...r, results: (r.results as { athleteId: string }[]).filter((x) => x.athleteId === user.id) })) : rows,
        athletes: mineOnly ? all.filter((a) => a.id === user.id) : all, today: latestDate,
      };
      break;
    }
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
  if (!userOf(res)?.isCoach) { res.status(403).json({ error: 'Only the coach can change the program and settings.' }); return; }
  const params = FitnessActionParams.safeParse(req.params), body = FitnessActionBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: 'Invalid coach action or form.' }); return; }
  const action = params.data.action;
  const f = new FormData();
  for (const [key, values] of Object.entries(body.data)) for (const value of Array.isArray(values) ? values : [values]) f.append(key, value);
  for (const key of ['date', 'from', 'to']) if (f.has(key) && !date(f.get(key))) { res.status(400).json({ error: 'Choose a valid date.' }); return; }
  for (const key of ['id', 'workoutId']) if (f.has(key) && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(String(f.get(key)))) { res.status(400).json({ error: 'Invalid workout or day identifier.' }); return; }
  if (['approve', 'unapprove', 'swap', 'setLocation', 'skip', 'neverPropose', 'move'].includes(action) && !f.get('id')) { res.status(400).json({ error: 'Select a program day.' }); return; }
  if (action === 'move' && !date(f.get('date'))) { res.status(400).json({ error: 'Choose the new date.' }); return; }
  if (['setCap', 'setRepeat'].includes(action) && !f.get('workoutId')) { res.status(400).json({ error: 'Select a workout.' }); return; }
  if (action === 'setCap' && !(Number(f.get('capMin')) >= 0 && Number(f.get('capMin')) <= 120)) { res.status(400).json({ error: 'Use a time cap between 0 and 120 minutes.' }); return; }
  if (action === 'setRepeat' && (!(Number(f.get('everyDays')) >= 0 && Number(f.get('everyDays')) <= 365) || (f.get('until') && !date(f.get('until'))))) { res.status(400).json({ error: 'Use 0–365 days and a valid end date.' }); return; }
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


// ---------- people ----------
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
/** The athlete a request is about: yourself, or someone you may log for. */
const subject = (res: { locals: Record<string, unknown> }, requested?: string) => {
  const user = userOf(res)!;
  const id = requested || user.id;
  if (!logging.canActFor(user, id)) throw new logging.InputError('You can only see your own results.', 403);
  return id;
};

router.get('/fitness/me', async (_req, res) => {
  const user = userOf(res)!;
  const family = (user.canLogForOthers || user.isCoach ? await accounts.listAthletes() : [user]).map((a) => ({ id: a.id, name: a.name, sex: a.sex, units: a.units }));
  res.json({ user, logFor: family, today: new Date().toISOString().slice(0, 10) });
});

router.post('/fitness/account/password', async (req, res) => {
  const user = userOf(res)!;
  const p = ChangeMyPasswordBody.safeParse(req.body);
  if (!p.success) { res.status(400).json({ error: 'Enter your current and new password.' }); return; }
  const problem = accounts.passwordProblem(p.data.newPassword);
  if (problem) { res.status(400).json({ error: problem }); return; }
  const found = await accounts.findAthleteByName(user.name);
  const current = found?.passwordHash ? await accounts.verifyPassword(p.data.currentPassword, found.passwordHash)
    : user.isCoach && !!process.env.APP_PASSWORD && same(p.data.currentPassword, process.env.APP_PASSWORD);
  if (!current) { res.status(401).json({ error: "Your current password didn't match." }); return; }
  await accounts.setPassword(user.id, p.data.newPassword, cookieParserToken(req));
  res.json({ ok: true });
});

router.get('/fitness/athletes', async (_req, res) => {
  if (!userOf(res)!.isCoach) { res.status(403).json({ error: 'Coach only.' }); return; }
  res.json({ athletes: (await accounts.listAthletes()).map(({ id, name, sex, isCoach, hasPassword, loadProfile }) => ({ id, name, sex, isCoach, hasPassword, loadProfile })) });
});

router.post('/fitness/athletes/:athleteId/profile', async (req, res) => {
  if (!userOf(res)!.isCoach) { res.status(403).json({ error: 'Only the coach can change load settings.' }); return; }
  const params = SetLoadProfileParams.safeParse(req.params), body = SetLoadProfileBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: 'Enter percentages.' }); return; }
  if (!(await accounts.getAthlete(params.data.athleteId))) { res.status(404).json({ error: 'Unknown family member.' }); return; }
  const profile: Record<string, number> = {};
  for (const [k, v] of Object.entries(body.data)) {
    if (v === undefined || v === null) continue;
    if (!Number.isFinite(v) || v < 10 || v > 150) { res.status(400).json({ error: 'Use percentages between 10 and 150.' }); return; }
    profile[k] = Math.round(v) / 100;
  }
  await accounts.setLoadProfile(params.data.athleteId, profile);
  res.json({ ok: true });
});

router.post('/fitness/athletes/:athleteId/password', async (req, res) => {
  const user = userOf(res)!;
  if (!user.isCoach) { res.status(403).json({ error: 'Only the coach can set passwords.' }); return; }
  const params = SetAthletePasswordParams.safeParse(req.params), body = SetAthletePasswordBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: 'Enter a new password.' }); return; }
  const problem = accounts.passwordProblem(body.data.newPassword);
  if (problem) { res.status(400).json({ error: problem }); return; }
  if (!(await accounts.getAthlete(params.data.athleteId))) { res.status(404).json({ error: 'Unknown family member.' }); return; }
  await accounts.setPassword(params.data.athleteId, body.data.newPassword, params.data.athleteId === user.id ? cookieParserToken(req) : undefined);
  res.json({ ok: true });
});

// ---------- logging and history ----------
const wrap = (fn: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any, next: any) => {
  try { const out = await fn(req, res); if (out !== undefined) res.json(out); }
  catch (e) { if (e instanceof logging.InputError) res.status(e.status).json({ error: e.message }); else next(e); }
};

router.get('/fitness/today', wrap(async (req, res) => {
  const p = GetTodayQueryParams.safeParse(req.query);
  if (!p.success || !date(p.data.date)) throw new logging.InputError('Choose a valid date.');
  return logging.getToday(p.data.date, subject(res, p.data.athleteId));
}));

router.get('/fitness/history', wrap(async (req, res) => {
  const p = GetHistoryQueryParams.safeParse(req.query);
  if (!p.success) throw new logging.InputError('Invalid history filter.');
  return logging.getHistory(subject(res, p.data.athleteId), { q: p.data.q?.slice(0, 80), offset: p.data.offset, limit: p.data.limit });
}));

router.get('/fitness/workout', wrap(async (req, res) => {
  const p = GetWorkoutDetailQueryParams.safeParse(req.query);
  if (!p.success || !UUID.test(p.data.workoutId)) throw new logging.InputError('Invalid workout.');
  return logging.getWorkoutDetail(p.data.workoutId, subject(res, p.data.athleteId));
}));

router.get('/fitness/workout-search', wrap(async (req) => {
  const p = SearchWorkoutsQueryParams.safeParse(req.query);
  if (!p.success) throw new logging.InputError('Type a workout name.');
  return logging.searchWorkouts(p.data.q.slice(0, 80));
}));

router.post('/fitness/results', wrap(async (req, res) => {
  const p = LogResultBody.safeParse(req.body);
  if (!p.success) throw new logging.InputError('Check the result form.');
  const d = p.data;
  if (!date(d.date)) throw new logging.InputError('Choose a valid date.');
  if (d.date > new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)) throw new logging.InputError("You can't log a result in the future.");
  if (!UUID.test(d.workoutId) || (d.dayId && !UUID.test(d.dayId))) throw new logging.InputError('Invalid workout.');
  return logging.logResult(userOf(res)!, { ...d, scaling: d.scaling?.slice(0, 500), notes: d.notes?.slice(0, 1500) } as logging.LogInput);
}));

router.post('/fitness/versions', wrap(async (req, res) => {
  const p = SetAthleteVersionBody.safeParse(req.body);
  if (!p.success || !UUID.test(p.data.dayId)) throw new logging.InputError('Choose a program day and a person.');
  return logging.setAthleteVersion(userOf(res)!, p.data);
}));

router.delete('/fitness/results/:resultId', wrap(async (req, res) => {
  const p = DeleteResultParams.safeParse(req.params);
  if (!p.success || !UUID.test(p.data.resultId)) throw new logging.InputError('Invalid result.');
  return logging.deleteResult(userOf(res)!, p.data.resultId);
}));

router.use((err: any, req: any, res: any, _next: any) => {
  req.log.error({ code: err.code }, 'Fitness request failed');
  const missing = ['42P01', '42703'].includes(err.code);
  res.status(missing ? 503 : 500).json({ error: missing
    ? 'The fitness database is not initialized. Apply the original schema and restore the family database export.'
    : 'The fitness request could not be completed. Please retry; if it continues, check the server logs.' });
});
export default router;
