# Noskov Fitness: app manual

How the app is built, what every part does, and how to use it. Updated with every change; the change log at the end lists what changed and when.

## 1. What the app is

Noskov Fitness plans and records CrossFit training for a family. The coach plans the program; everyone logs their results on their phone; the app keeps the history, shows each person their own version of the workout and a plan for it, and helps the coach plan the next weeks.

The planning engine is called **Chalkboard**. It proposes workouts from a library of about 3,600 published workouts plus the family's own history, following CrossFit methodology (constantly varied, functional movement at relative intensity). It never posts a workout on its own: the coach approves or changes every proposal.

**Who sees what**

| Role | Sees |
|---|---|
| Coach | Everything: Today, History, Benchmarks, Fitness, Program, Calendar, Analysis, Chalkboard, Settings, Account and Family. Can log results for anyone. |
| Athlete | Today, History, their own Benchmarks column, their own Fitness page, Account. |

The rules are enforced by the server, not only hidden in the menu.

## 2. Architecture

### 2.1 The pieces

```
  Phone or laptop browser
          │  HTTPS
          ▼
  ┌──────────────────────┐        ┌───────────────────────────┐
  │ Web app (React/Vite) │ ─────▶ │ API server (Express)      │
  │ artifacts/           │  JSON  │ artifacts/api-server      │
  │ noskov-fitness       │        │  routes, accounts, AI     │
  └──────────────────────┘        └──────┬──────────┬─────────┘
                                         │          │
                          uses           ▼          ▼  only when ANTHROPIC_API_KEY is set
                 ┌─────────────────────────────┐   ┌──────────────────────────────┐
                 │ lib/fitness-core (pure TS)  │   │ Claude API (Anthropic)       │
                 │  engine, tags, estimates,   │   │  Haiku: coaching notes       │
                 │  warm-ups, knowledge cards  │   │  Sonnet: Ask and Teach       │
                 └─────────────────────────────┘   └──────────────────────────────┘
                 ┌─────────────────────────────┐
                 │ lib/fitness-db (SQL)        │──▶  PostgreSQL (Replit)
                 │  planner I/O, library,      │     schema: lib/db (Drizzle)
                 │  imports, tag refresh       │
                 └─────────────────────────────┘
```

| Part | Folder | What it does |
|---|---|---|
| Web app | `artifacts/noskov-fitness` | All screens. Phone-first. Talks only to the API. |
| API server | `artifacts/api-server` | Sign-in and sessions, every read and coach action, AI calls. One bundled file in production. |
| Engine | `lib/fitness-core` | Pure TypeScript with tests: movement catalog, workout parser, tags, time estimates, work and power, planner, equipment checks, warm-ups, coaching numbers, the knowledge cards and movement facts. |
| Database helpers | `lib/fitness-db` | SQL for the planner (load candidates and history, propose and dry-run), the workout library import, history imports, and the stored-tag refresh. |
| Schema | `lib/db` | The database tables (Drizzle). Replit applies changes on publish. |
| API contract | `lib/api-spec` | OpenAPI file; generates the web app's data hooks (`lib/api-client-react`) and the server's input checks (`lib/api-zod`). |
| Library data | `lib/fitness-db/data/published-library.json.gz` | The published workout archive, cleaned (structure only, no coaching prose or brand names). Bundled into the server. |

### 2.2 Main data

| Table | Holds |
|---|---|
| `athletes`, `groups`, `group_members`, `sessions` | People, the family group, sign-in sessions. |
| `workouts`, `workout_movements`, `movements`, `workout_sources` | Every workout (history, library, coach-made), its movements, and where and when it was published. |
| `results` | Every logged result: who, when, the workout as performed, score, Rx or scaled, notes. Imported history is never edited. |
| `program_days` | The plan: date, workout, status (proposed, approved, done, skipped), location, warm-up, the planner's score and notes, alternatives. |
| `programming_policy` | Settings: targets, weights, rules. |
| `equipment_profiles` | Locations (gym, home garage) with their equipment and weights. |
| `measurements` | Bodyweight and the five work-formula heights (and older body measurements), by date. |
| `athlete_versions`, `coaching_notes`, `plan_edits`, `warm_up_templates` | Per-person versions, cached AI notes, the coach's plan edits, saved warm-ups. |
| `knowledge_state`, `knowledge_events`, `knowledge_questions`, `knowledge_teachings`, `coach_cards` | Chalkboard: the coach's statuses and notes on cards, the change log, questions asked, teachings and the coach's own cards. |

### 2.3 How changes reach the app

```
 Claude (writes code + tests)  ──push──▶  GitHub: main
                                              │
               Replit agent: pull, install, schema push (dev), typecheck, tests, check screens
                                              │
                       You: Publish in Replit ─┴─▶ production app + production database
                                              │
           Replit pushes its "Published your App" commit to the replit-local branch;
           Claude merges it into main at the start of the next change.
```

- Nothing is published without you. Replit verification prompts always say "Do not publish".
- Schema changes in development: `pnpm --filter @workspace/db run push`. In production they are applied by Replit's Publish.
- Personal data (names, results, measurements) never goes into git. The knowledge cards and movement facts in the repo are methodology only.

## 3. Using the app day to day

### 3.1 Signing in and accounts

- Everyone signs in with their first name and their own password.
- The coach's first sign-in uses the app password (a Replit secret); then the coach sets their own on Account, and sets each family member's password on Account → Family.
- Account → Family also holds each person's usual weights (their load profile), which shape their version of every workout.

### 3.2 Today

What it's for: the day's workout and everything a person needs to do it.

- **The workout**, as the coach approved it, and **your version** of it: your loads for the standard Rx, snapped to the weights that exist at the day's location (e.g. 45 lb dumbbells become 40 or 50 lb by person). The coach can override a person's version for a day.
- **Warm-up**: the coach's warm-up for that day, else the coach's saved warm-up for this workout, else a suggested one. Suggested warm-ups have a general part, a rehearsal of today's movements at low volume, and a short primer only before short hard workouts. On heavy lifting days the build-up sets are the warm-up. Everyone gets the same warm-up.
- **Plan for today** (collapsed; the target is in its header): the approach and tips, then pacing numbers (target time from your last and best result, checkpoints, warm-up sets for lifts). With the API key set, the approach and tips are written by Claude Haiku from the workout, your version, your earlier results and notes, and the coach's day note. The AI follows CrossFit L1/L2 coaching rules: cues name the body part and direction, positive phrasing, threshold advice, set breaks, never lowering the weight mid-workout, drink when thirsty. Without the key, built-in notes are shown.
- **Your earlier results** on this workout.
- **Log your result** (below).
- The coach can rewrite one person's Plan for today for a day; it replaces the suggested plan until the coach goes back to it.

### 3.3 Logging a result

- Score types: time (or capped with reps at the cap), rounds + reps, per-set loads, reps, distance.
- Mark Rx or scaled; for scaled, note the weights used.
- A time over the time cap is rejected; enter reps at the cap instead.
- After saving, Today shows how it compares with last time and your best.
- Results logged in the app can be deleted by whoever entered them; imported history can't be changed.

### 3.4 History, workout pages and benchmarks

- **History**: your results, newest first, with search.
- **Workout page**: everything about one workout, with all of a person's results on it and their best.
- **Benchmarks**: benchmark workouts and lifts with each person's results over time (athletes see their own column).

### 3.5 Fitness (work, power, health)

What it's for: seeing each person's fitness as numbers, using CrossFit's own definitions (L1 guide, "What Is Fitness? Part 2"; "Fooling Around with Fran"). Everyone sees their own page; the coach can pick anyone.

- **Body measurements**: bodyweight and the five heights from BTWB's work-formula form (squat low, squat high, shoulder, overhead, deadlift/knuckle height), with a date. They are only used to compute work, and stay in the app's database. Re-enter bodyweight when it changes; each result uses the measurements in effect on its date.
- **Work and power**: work = bodyweight × how far the centre of mass travels + load × how far the load travels; power = work ÷ time (ft-lb/s, with watts). Counted for finished for-time results and AMRAPs. It is an estimate (the sources call it zero-order), but its errors repeat every time, so comparisons over time hold.
- **Runs, rows, skis and bikes**: Concept2's published formula, watts = 2.80 × speed³ (m/s), and for calories, calories per hour = 4 × watts + 300. BTWB uses the same formula, and the app reproduces its numbers exactly. These need no measurements. BTWB interval logs ("Row, 500 m | 1:30" per piece) use each piece's own time; pieces logged as 0:00 are dropped. Inside a mixed workout the piece's own time isn't known, so it uses the person's median speed that year on pieces of a similar length (an assumption, marked as such).
- **Double-unders and burpees**: double-unders are bodyweight × 6 in per rep; a burpee is bodyweight × (squat high height + the same 6 in jump); cleans, snatches and deadlifts from the floor also count the body rising (bodyweight × squat travel). Each was checked against BTWB results (within 1–3%).
- **Bodyweight history**: the measurements form can import a BTWB measurements export (.csv); each result then uses the weight on its date.
- **Which movements count**: each counted movement has a rule (Fitness → "How each movement's work is counted", and the sheet "Chalkboard – Work formula rules" in Drive, 03). Rules are marked *as in the source*, *derived* (the same rule from the five heights) or *assumed* (needs a stated simplification; for the coach to review). Single-unders, toes-to-bar, carries, swimming and a few others have no rule, so a result that includes them gets no number rather than a guessed one. Multi-part and "every N minutes" workouts, ladder AMRAPs (their score can't be split into rounds), and anything above twice the best power in the Fran tables (676 ft-lb/s; for pure runs and rows, a 9.58 s 100 m) are left out as probably misread.
- **Power over duration**: for each duration (1 to 60 minutes, log scale), the best average power held for at least that long: the all-time curve (dashed), the last three years in colour, older years in gray. Hover or tab to a point to see the workout behind it. Fitness is the area under this curve; health is the curve holding up over the years.
- **By year**: results counted, the area (compared only over durations every year reached, so it's like for like), and power at 1, 4, 12 and 30 minutes.
- **Strengths and weaknesses** (time domain × modality grid, last 3 years): rows are short, medium, long and endurance; columns are gymnastics, weightlifting, run/row/bike and mixed. Each cell shows how that kind of workout compares with the person's usual power for the same modality at the same duration (one shared slope of power against duration, a level per modality), how many results it rests on, how often it was done in the last 12 months, and the trend (the last 12 months against the 2 years before). Tap a cell for the workouts behind it. The level is information only: within one modality it mixes the person with how the modality is measured. Cells are flagged only on what the data shows directly: **Declining** (10 points or more lower in the last 12 months than the 2 years before, 3+ results in each) and **Rarely trained** (at most once in the last 12 months, though it had 3+ results in the 3 years).
- **Repeated workouts**: the same workout with the same loads, finished for time, done two or more times. The work is the same each time, so the change in power is the ratio of the times (L1 guide). Needs no measurements.

## 4. Planning (coach)

### 4.1 Program

What it's for: the weeks ahead.

- Week rows of seven days, three zoom levels (remembered per browser).
- **Propose**: Chalkboard fills the open training days with proposals. Each proposal shows a short why (the gaps it fills, freshness, "benchmark due", rule notes) and up to four alternatives.
- **Approve** a day, or pick an alternative, or any workout from the library.
- **Drag** a workout to another date (it swaps with an open day there).
- **More…** on a day: Move, Location (the equipment check runs again; the workout stays if it fits, otherwise alternatives are refreshed), Time cap, Repeat (the workout comes back every N days, until a date), Warm-up (write one or pick a saved one), Push / Skip, Never propose.
- **Skip → drop**: only that day is skipped; the rest of the plan keeps its dates.
- **Skip → push forward**: that day's workout and every later proposed or approved workout move one training day later, in order. The day you pushed from is left empty and the plan ends one training day later. Nothing is re-planned and the rules are not re-checked on the new dates (planned: flag new rule conflicts after a push).
- **+ Add** fills a rest day; the planner checks the days before and after it.

### 4.2 Calendar and Analysis

- **Calendar**: the history by year, 8 weeks or week, with each day's workout and tags.
- **Analysis**: the mix of recent programming (movements per workout, time domain, priority, load, modality) against the targets, and how often each movement was used.

### 4.3 Settings

- **Schedule**: training days (default Mon, Tue, Thu, Fri, Sat), default location, the variety window (how many days back the planner looks).
- **Targets**: the share of workouts wanted in each bucket. Time domain: heavy day, short (under 4 min), medium (4–12), long (12–20), endurance (20+). Also movements per workout, task or time priority, load, modality. Next to each target is the share measured from the published programming (2005 on, first half of 2019 weighted to a quarter); "Use the published mix as my targets" adopts it.
- **Weights**: how the planner ranks candidates (variety gap, movement freshness, weakness focus, benchmark due).
- **Rules**:
    - Don't repeat a workout within N days (default 180). Benchmarks and coach repeats follow their own schedules.
    - Max benchmarks per week (default 1).
    - Days between lift tests (default 14).
    - Longest workout (default 60 minutes).
    - People training together (default 4; used for the equipment check).
    - Avoid the same movement on two consecutive days, but allow it once every N days (default 28).
    - Avoid heavy days back to back, but allow it once every N days (default 28). The two are separate settings.
- **Workout library**: import or update the published library (safe to repeat); lists the workouts the planner won't propose and why.

### 4.4 How Chalkboard plans (the engine)

For each open training day, in date order:

1. **Candidates**: every programmable workout in the library and history.
2. **Hard filters**: not repeated within the window (unless a due benchmark or coach repeat), not longer than the maximum, equipment exists at the location (fixed weights within one step), benchmark and lift-test limits, and the back-to-back rules when their exception was already used inside its window.
3. **Score**: how much the workout closes the gaps between the recent mix and the targets (variety), how long since its movements were done (freshness), weakness focus, benchmark or lift test due. Weakness focus favours workouts in a cell flagged Declining or Rarely trained on the Fitness grid, averaged over the family, at most once in any 7 days so balance stays first; the day's note says "works a declining or rarely trained area".
4. **Penalties**: same modality mix as yesterday, back-to-back exceptions (allowed rarely, noted on the day), crowded equipment (fewer than half the group can work at once), Turkish get-ups in a metcon (small, or strong if one was done in the last 4 weeks).
5. The best scorer is proposed; the next four are its alternatives. The choice becomes part of the picture for the next day.

**Tags** are computed, never typed: modality pattern (G gymnastics, W weightlifting, M monostructural; modality follows the load, so bodyweight lunges are G), movement count, time domain (heavy days by their structure: sets of 1–5 or a max; the rest by estimated or logged minutes), task or time priority, load, volume.

**Time estimates**: workouts nobody has logged get an estimated duration from per-rep and pace tables, calibrated on the coach's logged results (75% within 1.5× of the real time, 70% in the right time domain). Imported workouts that list every round and also keep the rep scheme are no longer counted ten times over.

**Benchmarks** come due again after: Girls 150 days, Heroes 240, tests 120, Open workouts 730.

**Lift tests**: each lift (back squat, deadlift, snatch…) comes due for a 1RM/3RM/5RM test 90 days after it was last tested, only on heavy days, at most one test every 14 days.

## 5. Chalkboard: what it knows

Chalkboard → the coach menu item. Four tabs: Map, Ask, Coach, Movements.

### 5.1 Map

What it's for: seeing everything Chalkboard works from.

- About 110 **cards** from 75 documents in the CrossFit manuals folder (L1 and L2 guides, Masters and Kids guides, CrossFit Journal articles), plus your own taught cards.
- 18 **areas** (definitions, heavy days, conditioning, scaling…), each with counts by status: **confirmed** (in use), **proposed** (waiting for you), **disputed** (a disagreement to resolve), **gap** (a known unknown). The Open column links the cards that need you.
- **Search** across all cards.
- **Questions Chalkboard couldn't answer** (from Ask) and **Recent changes**.

### 5.2 A card

- The statement, its strength (hard rule, strong, guidance, background) and who it's for.
- **Sources**: document, section or page, and verbatim quotes. Sources that lean on outside bodies (NSCA, ACSM) are marked; only their CrossFit-voiced points are used.
- **What the engine does with it**, whether that's in use now or planned (with the phase), the current value of any setting it names, and how many planned days its rule shaped in the last 4 weeks.
- **Connections** to other cards (refines, supports, limits, conflicts with, uses, related).
- **Your decision**: Confirm, Proposed, Dispute, Mark as gap, back to the manuals' status, and a note. Every change is logged. A status change records your view; it doesn't change the planner by itself. To change how the planner behaves, use Coach.

### 5.3 Ask

What it's for: asking why the plan looks the way it does, or what Chalkboard knows about something.

- Type a question in plain words. The answer comes **only** from the most related cards, your settings and the plan two weeks back and ahead, and links the cards it used.
- If nothing covers the question, it says so plainly, gives a short title for the missing knowledge, and the question appears on the Map under "Questions Chalkboard couldn't answer".
- It points out when a question assumes something the cards contradict.
- Uses Claude Sonnet; about a cent per question. No names or personal results are sent.

### 5.4 Coach (Teach Chalkboard)

What it's for: teaching Chalkboard something new, or correcting it, with a check before anything changes.

1. **You explain** something in your own words (e.g. "For our family, heavy days back to back can happen every three weeks instead of four.").
2. **How I understood it**: Chalkboard restates it, and asks questions if something is unclear.
3. **Draft cards**: one or a few small cards with area, strength, scope and links to existing cards.
4. **What would change**: any setting the teaching implies (now → new, with why). The planner is dry-run on the next four weeks with the new setting and lists the days that would get a different workout. Nothing is saved yet.
5. **Conflicts**: each existing card the teaching contradicts or narrows, with Chalkboard's position: agree (the card should yield), partly (both hold, with a limit), or disagree (it thinks the card is right), with reasons from the card's sources.
6. **You decide**:
    - **Confirm**: the cards become your cards (status confirmed, source "Coach decision" with your words) and the settings change.
    - **Confirm as coach decision**: shown instead of Confirm when Chalkboard disagrees. Same as Confirm, and the overruled card stays linked as a conflict, on record.
    - **Correct it**: write what it got wrong; it redrafts.
    - **Discard**.
7. **Earlier teachings** lists every teaching with its status. **Undo** on a confirmed teaching turns its cards off and puts its settings back, except settings you changed since (those are named and left alone).

Setting changes apply to the next proposals; re-plan on Program to update proposed days.

### 5.5 Movements

- All 75 movements, grouped by pattern (squat, hinge, press, vertical pull…), with a G/W/M filter, search, and how many days the family did each in the last 12 weeks.
- A page per movement: modality, pattern, skill and impact, main stress and what else it works, role (metcon, strength, skill, warm-up), station needs for four people, easier and harder versions, variants and implements, notes.
- For the 13 movements the L1 Movement Guide covers (air squat, front squat, overhead squat, shoulder press, push press, push jerk, deadlift, sumo deadlift high pull, medicine-ball clean, pull-up, thruster, muscle-up, snatch): points of performance (set-up, execution, finish) and common faults with their fix, summarized with the page range.
- Recent workouts that used it, and how many library workouts use it.
- The facts come from the coach's review sheet "Chalkboard - Movement facts". Changes go through Coach.

## 6. Privacy and AI

| What | Sent to Claude? |
|---|---|
| Coaching notes (Today) | The workout, the person's version, age, sex, units, their own earlier results and notes, the coach's note. Never names or emails. Cached; rewritten only when its inputs change. |
| Ask | Cards, settings, the plan (dates, workout names, tags, planner notes). No names or results. |
| Teach | Your explanation, cards, settings. No names or results. |

Without `ANTHROPIC_API_KEY`, coaching notes fall back to built-in ones and Ask and Teach are unavailable.

## 7. Operations

- **Secrets (Replit)**: `DATABASE_URL`, `APP_PASSWORD` (the coach's first-sign-in password), `ANTHROPIC_API_KEY`, `SMOKE_PASSWORD` (for the browser smoke check).
- **Checks**: `pnpm run typecheck` (from the repo root; rebuilds shared types first), `pnpm --filter @workspace/fitness-core test`, the browser smoke check in replit.md.
- **Library**: Settings → Workout library → Update library, or `pnpm --filter @workspace/fitness-db run import:library`.
- **Stored tags** are recomputed automatically once on server start when the way they are computed changes (logged as "Refreshed derived tags").
- **AI note check**: `pnpm --filter @workspace/api-server run check:ai -- --name <first name> --date YYYY-MM-DD` (`--dry` prints the prompt without calling the API).

## 8. Glossary

| Term | Meaning |
|---|---|
| Rx | The workout as prescribed (standard loads). "Your version" is each person's own prescription. |
| Time domain | How long a workout takes: heavy day, short, medium, long, endurance. |
| Modality | G gymnastics (bodyweight), W weightlifting (external load), M monostructural (run, row, bike, rope). |
| Task / time priority | For time (fixed work) / AMRAP or EMOM (fixed time). |
| Benchmark | A named workout repeated irregularly to measure progress (Fran, Cindy, Open workouts, lift maxes). |
| Card | One piece of Chalkboard's knowledge, with sources. |
| Teaching | Something the coach taught Chalkboard on the Coach tab. |
| Proposal | A workout Chalkboard suggests for a day; it becomes the plan only when approved. |

## 9. Change log

| Date | Change |
|---|---|
| 2026-11-28 | Fitness: strengths and weaknesses grid (time domain × modality); the planner's weakness focus now uses it, at most once a week. |
| 2026-11-27 | Time estimates: expanded round-by-round workouts fixed, scale recalibrated; stored tags recomputed on next start. |
| 2026-11-27 | Fitness: burpees and lifts from the floor calibrated against BTWB. |
| 2026-11-27 | Fitness: runs, rows, skis and bikes (Concept2 formula, matches BTWB), double-unders, BTWB interval logs, BTWB bodyweight import. |
| 2026-11-27 | Fitness page: body measurements, work and power per result, power-over-duration curve by year, repeated-workout power changes. |
| 2026-11-26 | Back-to-back exceptions split into two settings (heavy days; same movement), 28 days each. |
| 2026-11-26 | Chalkboard Coach (teach, dry-run preview, conflicts, confirm, undo) and Movements pages. |
| 2026-11-26 | Chalkboard Map, Card and Ask; about 110 methodology cards. |
| 2026-11-26 | Methodology fixes: heavy days as their own category, rare back-to-back exceptions, lift re-tests, modality by load, published defaults, occasional Turkish get-ups, coaching cue rules. |
| 2026-11-25 | Time estimates and the published style profile in Settings. |
| 2026-11-24 | Published workout library (about 3,600 workouts) and library cleanup. |
| Earlier | Accounts and roles, Today and logging, History, Program, Calendar, Analysis, Settings, per-person versions, warm-ups, AI coaching notes, plan edits. |

## 10. What's next

See "Chalkboard: the plan" in Drive (02 Plans and design). Phase 5 is in progress: the Fitness page and the weakness grid are built; next are volume-jump warnings, then conditioning level and readiness. Later: a smoothed fitness curve with the area shaded, and a 3D health view.
