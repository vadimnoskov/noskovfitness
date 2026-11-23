# Noskov Fitness

CrossFit workout programming and tracking for the family. This is a faithful port of the imported app, not a redesign.

## Run & Operate

- Start the managed workflows `artifacts/noskov-fitness: web` and `artifacts/api-server: API Server`.
- Do not start dev commands at the workspace root.
- `pnpm --filter @workspace/fitness-core test` — original engine, resolver, and importer tests
- `pnpm --filter @workspace/noskov-fitness typecheck` — frontend check
- `pnpm --filter @workspace/scripts test:fitness-ui` — browser smoke check against the running development workflows (requires password-free development access).
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — PostgreSQL connection string. `APP_PASSWORD` is required in production.

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
