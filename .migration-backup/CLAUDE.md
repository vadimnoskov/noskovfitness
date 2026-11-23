# Noskov Fitness

CrossFit-only workout programming and tracking app (family first; later groups, a dumbbell-only track, public track).
Methodology rule: CrossFit only (constantly varied functional movements at relatively high intensity). Do not introduce
other strength & conditioning methodologies unless the coach explicitly asks.

## Layout
- `packages/core` — pure TypeScript domain: movement catalog + resolver (`src/movements`), domain types (`src/model`),
  derived workout tags (`src/workouts/tags.ts`), benchmark library (`src/workouts/benchmarks.ts`), BTWB import parser (`src/import`).
  Tests: `npm test -w @nf/core`.
- `packages/db` — PostgreSQL schema (`migrations/`), migrate + import scripts.
- `tools/` — one-off reports used while building the movement library.
- `data/private/` — personal exports and notes; **git-ignored**, lives in Google Drive (NoskovFitness_app).

## Rules that must hold
- A movement = family + controlled attributes. Prescription details (reps, load, unbroken, tempo, cal/m) never create a movement.
  Unknown text is flagged for review, never silently added.
- Coach decisions (Nov 2026): plain Snatch/Clean = athlete's choice of receive; Pull-up/HSPU default kipping allowed; Dip = ring dip;
  Muscle-up = ring; unspecified dumbbell snatch = single-arm (alternating is separate); complexes are workouts made of catalog movements.
- Prescription and performance are separate records; history is never rewritten. Rounds and extra reps are stored separately.
- One main workout per day; optional short practice part first; heavy lifting never paired with an intense metcon.

## Local database
`DATABASE_URL=postgres://nf:nf@localhost:5432/noskovfitness`; `npx tsx packages/db/src/migrate.ts`; `npx tsx packages/db/src/import.ts`.
