import { Router, type IRouter } from 'express';
import cookieParser from 'cookie-parser';
import { timingSafeEqual } from 'node:crypto';
import { getGroup, getPolicy, getEquipmentProfiles, sql, importLibrary, libraryCounts, flaggedWorkouts, readLibrary } from '@workspace/fitness-db';
import { FamilyLoginBody, FitnessActionBody, FitnessActionParams, GetFitnessPageQueryParams, GetFitnessPageResponse, ChangeMyPasswordBody, SetAthletePasswordBody, SetAthletePasswordParams, GetTodayQueryParams, GetCoachingNoteQueryParams, SetPlanNoteBody, GetHistoryQueryParams, GetWorkoutDetailQueryParams, SearchWorkoutsQueryParams, LogResultBody, DeleteResultParams, SetLoadProfileBody, SetLoadProfileParams, SetAthleteVersionBody, SetKnowledgeCardBody, AskKnowledgeBody, TeachKnowledgeBody, DecideTeachingBody, SaveMeasurementsBody, ImportWeightsBody, SaveCheckInBody, SetConditioningPriorBody, SetWeaknessesBody } from '@workspace/api-zod';
import { COOKIE } from '../fitness/auth';
import * as accounts from '../fitness/accounts';
import { SESSION_COOKIE, SESSION_DAYS } from '../fitness/accounts';
import * as logging from '../fitness/logging';
import * as data from '../fitness/data';
import { getPlannedDays } from '../fitness/program';
import * as program from '../fitness/program-actions';
import * as settings from '../fitness/settings-actions';
import * as warmups from '../fitness/warmups';
import * as knowledge from '../fitness/knowledge';
import * as knowledgeAsk from '../fitness/knowledge-ask';
import * as teaching from '../fitness/knowledge-teach';
import * as picture from '../fitness/athlete-picture';
import * as people from '../fitness/people';
import { libraryGz, getPublishedProfile } from '../fitness/library-data';

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
  if (user && COACH_SCREENS.has(screen) && !(await data.isCoaching(user))) { res.status(403).json({ error: 'This page is for the coach.' }); return; }
  if ((from && !date(from)) || (to && !date(to))) { res.status(400).json({ error: 'Use a valid YYYY-MM-DD date.' }); return; }
  const latestDate = await data.getLatestDate();
  const start = from ?? `${latestDate.slice(0, 4)}-01-01`, end = to ?? `${latestDate.slice(0, 4)}-12-31`;
  if (start > end || Date.parse(end) - Date.parse(start) > 3660 * 86400000) { res.status(400).json({ error: 'Choose a valid date range of up to 10 years.' }); return; }
  // Coach screens are about one program (the X-Program header; the family's by default).
  let g = data.GROUP_ID;
  if (user && COACH_SCREENS.has(screen) || (user && screen === 'benchmarks' && (user.isCoach || req.get('x-program')))) {
    try { g = await data.programFor(user!, req.get('x-program')); } catch { res.status(403).json({ error: 'You do not coach this program.' }); return; }
  }
  let payload: Record<string, unknown>;
  switch (screen) {
    case 'calendar': payload = { latestDate, days: [...(await data.getDays(start, end, g)).entries()] }; break;
    case 'analysis': { const who = await data.analysisAthlete(g); payload = { latestDate, use: await data.getMovementUse(start, end, who), mix: await data.getMix(start, end, who) }; break; }
    case 'benchmarks': {
      const all = await data.getAthletes(user && !user.isCoach && !req.get('x-program') ? await data.programOfAthlete(user.id) : g);
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
      const group = await getGroup(g);
      if (!group) { res.status(503).json({ error: 'The family data has not been imported yet. Restore the existing private database export to use Program and Settings. No training records have been created or changed.' }); return; }
      const profiles = await getEquipmentProfiles(g);
      payload = screen === 'program'
        ? { days: await getPlannedDays(g, start, end), profiles, group }
        : { policy: await getPolicy(g), profiles, group, published: getPublishedProfile() };
      break;
    }
  }
  res.json(GetFitnessPageResponse.parse(payload!));
});

const actions = { ...program, ...settings, setWarmUp: warmups.setWarmUp, saveWarmUpTemplate: warmups.saveWarmUpTemplate, deleteWarmUpTemplate: warmups.deleteWarmUpTemplate };
router.post('/fitness/actions/:action', async (req, res) => {
  if (!userOf(res) || !(await data.isCoaching(userOf(res)!))) { res.status(403).json({ error: 'Only the coach can change the program and settings.' }); return; }
  const params = FitnessActionParams.safeParse(req.params), body = FitnessActionBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: 'Invalid coach action or form.' }); return; }
  const action = params.data.action;
  const f = new FormData();
  for (const [key, values] of Object.entries(body.data)) for (const value of Array.isArray(values) ? values : [values]) f.append(key, value);
  for (const key of ['date', 'from', 'to']) if (f.has(key) && !date(f.get(key))) { res.status(400).json({ error: 'Choose a valid date.' }); return; }
  for (const key of ['id', 'workoutId']) if (f.has(key) && !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(String(f.get(key)))) { res.status(400).json({ error: 'Invalid workout or day identifier.' }); return; }
  if (['approve', 'unapprove', 'swap', 'setLocation', 'skip', 'neverPropose', 'move'].includes(action) && !f.get('id')) { res.status(400).json({ error: 'Select a program day.' }); return; }
  if (action === 'setWarmUp' && (!f.get('id') || String(f.get('text') ?? '').length > warmups.MAX_WARM_UP)) { res.status(400).json({ error: 'Select a day and keep the warm-up under 4000 characters.' }); return; }
  if (action === 'saveWarmUpTemplate' && (!String(f.get('name') ?? '').trim() || !String(f.get('text') ?? '').trim())) { res.status(400).json({ error: 'Give the warm-up a name and some text.' }); return; }
  if (action === 'deleteWarmUpTemplate' && !/^[\da-f-]{36}$/i.test(String(f.get('templateId') ?? ''))) { res.status(400).json({ error: 'Select a saved warm-up.' }); return; }
  if (action === 'move' && !date(f.get('date'))) { res.status(400).json({ error: 'Choose the new date.' }); return; }
  if (['setCap', 'setRepeat'].includes(action) && !f.get('workoutId')) { res.status(400).json({ error: 'Select a workout.' }); return; }
  if (action === 'setCap' && !(Number(f.get('capMin')) >= 0 && Number(f.get('capMin')) <= 120)) { res.status(400).json({ error: 'Use a time cap between 0 and 120 minutes.' }); return; }
  if (action === 'setRepeat' && (!(Number(f.get('everyDays')) >= 0 && Number(f.get('everyDays')) <= 365) || (f.get('until') && !date(f.get('until'))))) { res.status(400).json({ error: 'Use 0–365 days and a valid end date.' }); return; }
  if (['swap', 'neverPropose'].includes(action) && !f.get('workoutId')) { res.status(400).json({ error: 'Select a workout.' }); return; }
  if (action === 'setLocation' && !f.get('equipmentId')) { res.status(400).json({ error: 'Select a location.' }); return; }
  if (action === 'insert' && !date(f.get('date'))) { res.status(400).json({ error: 'Choose a valid date.' }); return; }
  if (action === 'skip' && !['drop', 'push'].includes(String(f.get('mode')))) { res.status(400).json({ error: 'Choose skip or push forward.' }); return; }
  // The program the action is for (X-Program header), and every program day it names must belong to it.
  let g: string;
  try { g = await data.programFor(userOf(res)!, req.get('x-program')); } catch { res.status(403).json({ error: 'You do not coach this program.' }); return; }
  f.set('group', g);
  if (f.get('id') && action !== 'deleteWarmUpTemplate') {
    const [d] = await sql`SELECT group_id FROM program_days WHERE id = ${String(f.get('id'))}`;
    if (!d || d.group_id !== g) { res.status(404).json({ error: 'That program day is not in this program.' }); return; }
  }
  if (!await getGroup(g)) { res.status(503).json({ error: 'Restore the family database export before changing the program.' }); return; }
  if (['propose', 'replan', 'insert', 'setLocation', 'neverPropose'].includes(action) && !(await getEquipmentProfiles(g)).length) {
    res.status(409).json({ error: 'Add a location with its equipment (Athletes) before proposing workouts.' }); return;
  }
  if (['propose', 'approveAll', 'replan'].includes(action) && !date(f.get('from'))) { res.status(400).json({ error: 'Choose a start date.' }); return; }
  if (['approveAll', 'replan'].includes(action) && (!date(f.get('to')) || String(f.get('from')) > String(f.get('to')))) { res.status(400).json({ error: 'Choose a valid end date.' }); return; }
  await actions[action](f);
  res.json({ ok: true, ...(['savePolicyAction', 'resetPolicyAction', 'usePublishedProfileAction'].includes(action) ? { redirect: '/settings?saved=1' } : {}) });
});


// ---------- people ----------
function wrap(fn: (req: any, res: any) => Promise<unknown>) {
  return async (req: any, res: any, next: any) => {
    try { const out = await fn(req, res); if (out !== undefined) res.json(out); }
    catch (e) { if (e instanceof logging.InputError) res.status(e.status).json({ error: e.message }); else next(e); }
  };
}
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
/** The athlete a request is about: yourself, or someone you may log for. */
const subject = async (res: { locals: Record<string, unknown> }, requested?: string) => {
  const user = userOf(res)!;
  const id = requested || user.id;
  if (!await logging.canActFor(user, id)) throw new logging.InputError('You can only see your own results.', 403);
  return id;
};

router.get('/fitness/me', async (_req, res) => {
  const user = userOf(res)!;
  // Everyone this person may see, each with their program; and the programs they coach (for the program picker).
  const visible = await data.visibleAthleteIds(user);
  const programs = await data.allPrograms();
  const programOf = new Map(programs.flatMap((p) => p.members.map((m) => [m.id, p.id] as const)));
  const logFor = (await accounts.listAthletes()).filter((a) => visible.has(a.id))
    .map((a) => ({ id: a.id, name: a.name, sex: a.sex, units: a.units, program: programOf.get(a.id) ?? data.GROUP_ID }));
  const coaches = await data.programsFor(user);
  res.json({ user, logFor, programs: programs.filter((p) => logFor.some((a) => a.program === p.id)).map((p) => ({ id: p.id, name: p.name, coached: coaches.some((c) => c.id === p.id) })),
    today: new Date().toISOString().slice(0, 10) });
});

router.get('/fitness/people', wrap(async (_req, res) => people.getPeople(userOf(res)!)));
router.post('/fitness/people/:action', wrap(async (req, res) => {
  const body = FitnessActionBody.safeParse(req.body);
  if (!body.success) throw new logging.InputError('Invalid form.');
  return people.peopleAction(userOf(res)!, String(req.params.action), body.data);
}));

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

router.get('/fitness/today', wrap(async (req, res) => {
  const p = GetTodayQueryParams.safeParse(req.query);
  if (!p.success || !date(p.data.date)) throw new logging.InputError('Choose a valid date.');
  return logging.getToday(p.data.date, await subject(res, p.data.athleteId));
}));

router.get('/fitness/coaching-note', wrap(async (req, res) => {
  const p = GetCoachingNoteQueryParams.safeParse(req.query);
  if (!p.success || !UUID.test(p.data.dayId)) throw new logging.InputError('Select a program day.');
  return logging.getCoachingNote(p.data.dayId, await subject(res, p.data.athleteId));
}));

router.post('/fitness/plan-note', wrap(async (req, res) => {
  const user = userOf(res)!;
  const p = SetPlanNoteBody.safeParse(req.body);
  if (!p.success || !UUID.test(p.data.dayId) || p.data.text.length > 4000) throw new logging.InputError('Select a day and keep the plan under 4000 characters.');
  if (!(await data.coachesAthlete(user, p.data.athleteId))) throw new logging.InputError('Only the coach can edit the plan.', 403);
  return logging.setPlanNote(p.data.dayId, p.data.athleteId, p.data.text);
}));

router.get('/fitness/warm-up-templates', wrap(async (_req, res) => {
  if (!userOf(res) || !(await data.isCoaching(userOf(res)!))) throw new logging.InputError('Only the coach can see saved warm-ups.', 403);
  return { templates: await warmups.listWarmUpTemplates() };
}));

router.get('/fitness/knowledge', wrap(async (_req, res) => {
  if (!userOf(res)?.isCoach) throw new logging.InputError("Only the coach can see Chalkboard's knowledge.", 403);
  return knowledge.getKnowledge();
}));

router.get('/fitness/picture', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user) throw new logging.InputError('Sign in first.', 401);
  return picture.getAthletePicture(user, String(req.query.athleteId ?? ''));
}));
router.get('/fitness/measurements', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user) throw new logging.InputError('Sign in first.', 401);
  return picture.getMeasurements(user, String(req.query.athleteId ?? ''));
}));
router.post('/fitness/measurements', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user) throw new logging.InputError('Sign in first.', 401);
  const body = SaveMeasurementsBody.safeParse(req.body);
  if (!body.success) throw new logging.InputError('Check the measurements form.');
  return picture.saveMeasurements(user, body.data);
}));

router.post('/fitness/measurements/import', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user) throw new logging.InputError('Sign in first.', 401);
  const body = ImportWeightsBody.safeParse(req.body);
  if (!body.success) throw new logging.InputError('Choose a BTWB export file.');
  return picture.importWeights(user, body.data);
}));

router.post('/fitness/checkin', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user) throw new logging.InputError('Sign in first.', 401);
  const body = SaveCheckInBody.safeParse(req.body);
  if (!body.success) throw new logging.InputError('Choose 1 to 5.');
  return picture.saveCheckIn(user, body.data);
}));
router.post('/fitness/conditioning-prior', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user) throw new logging.InputError('Sign in first.', 401);
  const body = SetConditioningPriorBody.safeParse(req.body);
  if (!body.success) throw new logging.InputError('Use a number from 0 to 1.');
  return picture.setConditioningPrior(user, body.data);
}));

router.post('/fitness/weaknesses', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user) throw new logging.InputError('Sign in first.', 401);
  const body = SetWeaknessesBody.safeParse(req.body);
  if (!body.success) throw new logging.InputError('Choose movements from the list.');
  return picture.setWeaknesses(user, body.data);
}));

router.get('/fitness/knowledge/movements', wrap(async (_req, res) => {
  if (!userOf(res)?.isCoach) throw new logging.InputError('Coach only.', 403);
  return knowledge.getMovements();
}));
router.get('/fitness/knowledge/movement', wrap(async (req, res) => {
  if (!userOf(res)?.isCoach) throw new logging.InputError('Coach only.', 403);
  return knowledge.getMovement(String(req.query.key ?? ''));
}));

router.post('/fitness/knowledge/ask', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user?.isCoach) throw new logging.InputError('Only the coach can ask Chalkboard (for now).', 403);
  const body = AskKnowledgeBody.safeParse(req.body);
  if (!body.success) throw new logging.InputError('Write a question.');
  const g = await data.programFor(user, req.get('x-program')).catch(() => data.GROUP_ID);
  const today = body.data.today && /^\d{4}-\d\d-\d\d$/.test(body.data.today) ? body.data.today : undefined;
  return knowledgeAsk.ask(body.data.question, user.id, g, today);
}));

router.post('/fitness/knowledge/teach', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user?.isCoach) throw new logging.InputError('Only the coach can teach Chalkboard.', 403);
  const body = TeachKnowledgeBody.safeParse(req.body);
  if (!body.success || (body.data.teachingId && !UUID.test(body.data.teachingId))) throw new logging.InputError('Explain what to teach.');
  return teaching.teach({ text: body.data.text ?? '', teachingId: body.data.teachingId, correction: body.data.correction }, user.id);
}));
router.post('/fitness/knowledge/teach/decide', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user?.isCoach) throw new logging.InputError('Only the coach can decide.', 403);
  const body = DecideTeachingBody.safeParse(req.body);
  if (!body.success || !UUID.test(body.data.teachingId)) throw new logging.InputError('Choose a teaching and an action.');
  const { teachingId: id, action } = body.data;
  return action === 'discard' ? teaching.discardTeaching(id) : action === 'undo' ? teaching.undoTeaching(id, user.id) : teaching.confirmTeaching(id, action === 'override' ? 'override' : 'agree', user.id);
}));

router.post('/fitness/knowledge/card', wrap(async (req, res) => {
  const user = userOf(res);
  if (!user?.isCoach) throw new logging.InputError('Only the coach can change the knowledge.', 403);
  const body = SetKnowledgeCardBody.safeParse(req.body);
  if (!body.success) throw new logging.InputError('Choose a card and a valid status.');
  return knowledge.setKnowledgeCard(body.data, user.id);
}));

router.get('/fitness/library', wrap(async (req, res) => {
  if (!userOf(res)?.isCoach) throw new logging.InputError('Only the coach can see the workout library report.', 403);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const [counts, flagged, [n]] = await Promise.all([libraryCounts(), flaggedWorkouts(100, offset), sql`SELECT count(*)::int AS c FROM workouts WHERE source = 'published'`]);
  return { ...counts, published: n!.c, bundled: readLibrary(libraryGz).entries.length, builtAt: readLibrary(libraryGz).builtAt, flagged, offset };
}));

router.post('/fitness/library/import', wrap(async (_req, res) => {
  if (!userOf(res)?.isCoach) throw new logging.InputError('Only the coach can import the workout library.', 403);
  return importLibrary(libraryGz);
}));

router.get('/fitness/history', wrap(async (req, res) => {
  const p = GetHistoryQueryParams.safeParse(req.query);
  if (!p.success) throw new logging.InputError('Invalid history filter.');
  return logging.getHistory(await subject(res, p.data.athleteId), { q: p.data.q?.slice(0, 80), offset: p.data.offset, limit: p.data.limit });
}));

router.get('/fitness/workout', wrap(async (req, res) => {
  const p = GetWorkoutDetailQueryParams.safeParse(req.query);
  if (!p.success || !UUID.test(p.data.workoutId)) throw new logging.InputError('Invalid workout.');
  return logging.getWorkoutDetail(p.data.workoutId, await subject(res, p.data.athleteId));
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
