# Noskov Fitness

CrossFit workout programming and tracking for the family. This is a faithful port of the imported app, not a redesign.

## Run & Operate

- Start the managed workflows `artifacts/noskov-fitness: web` and `artifacts/api-server: API Server`.
- Do not start dev commands at the workspace root.
- `pnpm --filter @workspace/fitness-core test` — original engine, resolver, and importer tests
- `pnpm --filter @workspace/noskov-fitness typecheck` — frontend check
- `SMOKE_NAME=Vadim SMOKE_PASSWORD="$SMOKE_PASSWORD" pnpm --filter @workspace/scripts test:fitness-ui` — browser smoke check against the running development workflows. With `APP_PASSWORD` set it signs in as the coach from these environment variables (use the coach's own development password once one is set). Never put passwords in code. If sign-in fails, the check prints the app's message; once the coach has set an own development password, put it in a `SMOKE_PASSWORD` secret and run with `SMOKE_PASSWORD="$SMOKE_PASSWORD"`.
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — PostgreSQL connection string. `APP_PASSWORD` is required in production. `ANTHROPIC_API_KEY` (secret) turns on AI coaching notes.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: Vite frontend, esbuild ESM server bundle

## Where things live

- `artifacts/noskov-fitness` — original screens ported to Vite/React.
- `artifacts/api-server/src/fitness` — original SQL readers and coaching actions.
- `lib/fitness-core` — original pure domain engine and tests.
- `lib/fitness-db` — original PostgreSQL helpers, legacy migrations, and import tools.
- `lib/db/src/schema/fitness.ts` — imported schema for Replit schema management.
- `.migration-backup` — untouched imported project; not the running app.

## Architecture decisions

- Per-person accounts: everyone signs in with their first name and own password (scrypt hashes in `athletes.password_hash`; server-side sessions in `sessions`, cookie `nf_sid`, 90 days). `APP_PASSWORD` is only the coach's first-sign-in password until the coach sets their own; the coach then sets family passwords on Account → Family. Local development without `APP_PASSWORD` runs as the coach.
- Roles: the coach (`is_coach`) sees everything and can log for anyone (`can_log_for_others`). Athletes see Today, History, their own Benchmarks column and Account; Program, Calendar, Analysis, Settings and all coach actions are coach-only (enforced in the API, not just hidden).
- Personal versions (each person's Rx): standard Rx for their sex × their usual-weights setting (`athletes.load_profile`, set on Account → Family), snapped to weights available at the day's location, with optional coach overrides per day (`athlete_versions`). Logged "Rx" against a program day records `performed.version`. The standard workout is never modified.
- Program page: week rows of 7 days with three zoom levels (saved per browser). The coach drags a workout to another date (swaps with an open day there) or uses More… → Move, Location, Time cap, Repeat, Push/Skip/Never propose, or picks any workout from the library. "+ Add" fills a rest day; the engine checks the days before and after it.
- Time caps live in `workouts.structure.capMin` (coach-set) or are read from the workout text ("Time cap: 15 mins"). Logging rejects a time over the cap and asks for reps at the cap instead.
- No-repeat window (Settings, default 180 days) applies to all workouts except benchmarks (own intervals) and workouts with a coach repeat (`workouts.repeat_every_days`, optional `repeat_until`), e.g. a retest every 4 weeks.
- Today shows each person's earlier results on the workout, a short plan (target from last/best, pacing checkpoints, warm-up sets for lifts) and, after saving, how the result compares with last time and their best. The numbers are rule-based (`lib/fitness-core/src/workouts/coaching.ts`).
- AI coaching notes (`artifacts/api-server/src/fitness/ai-notes.ts`): with `ANTHROPIC_API_KEY` set, Today loads a short plan written by Claude Haiku 5.5 (low effort, JSON output) from the workout, the person's version, their earlier results and notes, the rule-based numbers and the coach's day note. CrossFit-only instructions. Sent: age, sex, units, workout and results; never names. Cached in `coaching_notes` per day and person and rewritten only when its inputs change. Without the key, or on any API error, Today shows the rule-based notes. Check it with `pnpm --filter @workspace/api-server run check:ai -- --name Vadim --date YYYY-MM-DD` (`--dry` prints the prompt and makes no API call).
- Workout library (published archive): `lib/fitness-db/data/published-library.json.gz` holds about 3,600 distinct published workouts (structure, movements, cleaned prescription text, every date they appeared; no coaching prose, no brand names in titles). It is bundled into the API server (esbuild base64 loader). The coach adds it to the database on Settings → Workout library ("Import library" / "Update library"); this is additive and safe to repeat. Workouts matching your history (same benchmark name or same content) are linked, not duplicated. Only workouts posted from 2005 on are added (2001–2004 stay in the file for measuring principles). Clean ones can be proposed; the rest are kept for reference with a reason. "Update library" also removes earlier imports whose reading changed and refreshes the details of unchanged ones, but never touches a workout that has results, program days or alternatives, or coach settings (warm-up, repeat, excluded). Every appearance is stored in `workout_sources`. From the command line: `pnpm --filter @workspace/fitness-db run import:library`. Rebuilding the dataset needs the archive CSV (not in the repository): `pnpm --filter @workspace/fitness-db run build:library -- <archive.csv>`.
- Methodology rules (from the CrossFit L1/L2 review): heavy lifting days (sets of 1–5, max lifts) are their own time-domain category ("heavy"), decided by the workout's structure, not the weight. Modality follows the implement: bodyweight lunges/step-ups are G, loaded ones W, a pistol holding a kettlebell W. Heavy days back to back and the same movement family on consecutive days are avoided but allowed once per `rareExceptionDays` (default 28; the day's notes say so). Lift tests (1RM/3RM/5RM from history) come due 90 days after the same lift was last tested and are spaced at least `minDaysBetweenLiftTests` (default 14) apart. Default targets are the measured published mix. Stored tags are derived data: on server start, if they predate the current derivation they are recomputed once (`lib/fitness-db/src/tags-refresh.ts`, logged as "Refreshed derived tags").
- Chalkboard's knowledge (coach page "Chalkboard", `/knowledge`): about 110 methodology cards written from the coach's manuals (CrossFit L1/L2, Masters and Kids guides, CrossFit Journal), each with sources (quotes verbatim), strength, status, links and what the engine does with it (`lib/fitness-core/src/knowledge/`). The cards live in code; the coach's status changes and notes live in `knowledge_state`, every change in `knowledge_events`. The Map shows areas with counts and open questions; each card shows its current settings and how many planned days its rule shaped (from the planner's notes). Nothing personal goes in the card files. Ask (`/knowledge/ask`, `artifacts/api-server/src/fitness/knowledge-ask.ts`): the coach's questions are answered by Claude Sonnet 5.5 only from the most related cards, the current settings and the plan (two weeks back and ahead), with the cards used; uncovered questions are saved as gaps (`knowledge_questions`) and listed on the Map. Needs ANTHROPIC_API_KEY; about a cent per question; no names or personal results are sent.
- Time estimates (`lib/fitness-core/src/workouts/estimate.ts`): workouts nobody has logged get an estimated duration (per-rep and pace tables, calibrated ×1.26 on the coach's logged Rx results: 74% within ×1.5). It feeds the time-domain tags; AMRAP/EMOM/Tabata use their fixed time, caps bound the estimate, strength sets are not estimated.
- Style profile: Settings shows, next to each target, the share measured from the published programming (clean workouts from 2005 on; the first half of 2019 weighted to a quarter of the total). "Use the published mix as my targets" adopts it (`usePublishedProfileAction`).
- Display titles never show the "CrossFit" brand name (`workoutTitle` cleans imported names).
- Equipment rules: boxes, rings, pull-up bars, machines and barbells count one per person. If fewer than half the group can work at once, the workout is strongly avoided ("crowded"); otherwise it's a stagger warning. Dumbbells, kettlebells and medicine balls must exist near the prescribed weight at the location (within one step, shown as e.g. "45 lb → 40 lb or 50 lb"). Turkish get-ups are allowed in a metcon occasionally (small penalty), strongly avoided if one was done in the last 4 weeks.
- Today: "Plan for today" is collapsed by default, with the target in its header; opened, it shows the approach and tips, then the pacing numbers.
- Coach plan edits: on Today the coach can rewrite one person's "Plan for today" for a day (`plan_edits`); it replaces the AI or built-in plan for that person and day until the coach goes back to the suggested plan.
- Warm-ups: each day shows, in order, the coach's warm-up for that day (`program_days.warm_up`), the coach's saved warm-up for the workout (`workouts.warm_up`), or a suggested one (`lib/fitness-core/src/workouts/warmup.ts`, rule-based: general, specific rehearsal of the day's movements, primer only before short hard workouts; build-up sets are the warm-up on lifting days). Same warm-up for the whole family. The coach edits it on Today or Program → More… → Warm-up, and can keep named warm-ups (`warm_up_templates`). Text format for warm-ups and edited plans: short heading lines, "- " item lines, plain paragraphs.
- The server bundle includes `@opentelemetry/api` (needed by the Anthropic SDK); keep it out of the esbuild externals.
- Results logged in the app have `source = 'app'` and `entered_by`; only these can be deleted. Imported history (btwb-import, manual-notes) is never edited or deleted.
- Keep PostgreSQL records and original domain logic unchanged; do not replace training history with sample workouts.
- Use Replit's Publish flow for production schema changes, never custom startup or deployment DDL. Original migration tools are retained for legacy compatibility, not production hooks.

## Product

Today (planned workout + phone-first result logging: time/capped, rounds+reps, per-set loads, reps, distance, Rx/scaled with weights used), personal History with search, workout pages with all of a person's results and their best, Account (password, sign out; coach: Family passwords). Coach: program proposals, approval, alternatives, location changes, pushing/skipping workouts, history calendar (year/8 weeks/week), programming analysis, benchmark history, and policy/schedule settings.

## User preferences

Preserve the original app and its CrossFit-only methodology. Do not introduce other training methodologies unless the coach asks.

## Gotchas

- The private database export and source CSVs were not included in the imported repository. Restore the user's existing private export only with authorization and inspect it first. Never fabricate history or run the destructive history importer on startup/publish. Keep private exports out of Git and deployments.
- A movement is family + controlled attributes, never prescription details. Flag unknown movements rather than silently adding them.
- Keep prescription and performance separate; never rewrite history. Store rounds and extra reps separately.
- One main workout per day, optional short practice first; do not pair heavy lifting with an intense metcon.
- Original coaching defaults: unspecified snatch/clean permits athlete's choice of receive; pull-ups/HSPU permit kipping; dip = ring dip; muscle-up = ring; unspecified dumbbell snatch = single-arm, alternating separate. Complexes are workouts of catalog movements.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
