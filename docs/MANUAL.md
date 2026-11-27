# Noskov Fitness: app manual

How the app is built, what every part does, and how to use it. Updated with every change; the change log at the end lists what changed and when.

## 1. What the app is

Noskov Fitness plans and records CrossFit training for a family. The coach plans the program; everyone logs their results on their phone; the app keeps the history, shows each person their own version of the workout and a plan for it, and helps the coach plan the next weeks.

The planning engine is called **Chalkboard**. It proposes workouts from a library of about 3,600 published workouts plus the family's own history, following CrossFit methodology (constantly varied, functional movement at relative intensity). It never posts a workout on its own: the coach approves or changes every proposal.

**Who sees what**

| Role | Sees |
|---|---|
| Head coach | Everything: Today, History, Benchmarks, Fitness, Athletes, Program, Calendar, Analysis, Chalkboard, Settings, Account and Family, for every program. Can log results for anyone. |
| Coach of a program | Athletes, and Today, History and Fitness for the athletes in the programs they coach. |
| Athlete | Today, History, their own Benchmarks column, their own Fitness page, Account. A family member allowed to log for others can do so only within their own program, never for another coach's clients. |

The rules are enforced by the server, not only hidden in the menu.

On a phone the menu folds into the ☰ button at the top right; your own settings are under **Account**.

**Programs.** Athletes train in programs: the family's, and one for each client (or a small group of clients). Each program has its own coach, usual training days, locations (equipment) and programming settings, and Chalkboard plans each one separately. On Today, History and Fitness the **Athlete** dropdown (grouped by program) chooses whose page it is; on Program, Calendar, Analysis, Settings and Benchmarks the **Program** dropdown chooses the program (it shows only for someone who coaches more than one).

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
| `athletes`, `groups`, `group_members`, `sessions` | People (with the coach's starting conditioning estimate), the family group, sign-in sessions. |
| `check_ins` | One-tap readiness check-ins (1–5), one per person per day. |
| `workouts`, `workout_movements`, `movements`, `workout_sources` | Every workout (history, library, coach-made), its movements, and where and when it was published. |
| `results` | Every logged result: who, when, the workout as performed, score, Rx or scaled, notes. Imported history is never edited. |
| `program_days` | The plan: date, workout, status (proposed, approved, done, skipped), location, warm-up, the planner's score and notes, alternatives. |
| `programming_policy` | Settings: targets, weights, rules. |
| `equipment_profiles` | Locations (gym, home garage) with their equipment and weights. |
| `measurements` | Bodyweight and the five work-formula heights (and older body measurements), by date. |
| `athlete_versions`, `coaching_notes`, `plan_edits`, `warm_up_templates` | Per-person versions (the coach's weights and the standard-workout switch), cached AI notes, the coach's plan edits, saved warm-ups. |
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
- **Warm-up** (closed by default, so the day's workout comes first; tap to open): the coach's warm-up for that day, else the coach's saved warm-up for this workout, else a suggested one. Suggested warm-ups have:
    - **General**: easy cardio and a few bodyweight basics.
    - **Complex** (L2, "Example Warm-Ups to Address Weaknesses"): 2–3 progressive rounds of 5–15 reps, chosen against the day's workout: a barbell, dumbbell or kettlebell complex on gymnastics days, a rings or parallettes routine on weightlifting days, Basic Body Weight rounds otherwise. The implement rotates and only equipment at the day's location is used. None on heavy days (the build-up sets are the warm-up).
    - **Skill** (about 5 minutes): from the current 5-week skill block, alternating handstands and muscle-up / pull-up strength, with a different focus each week and three levels to pick from (building, wall/strict, free/transitions). If the day's workout already works the block's skill, the other one is practised that day, so the warm-up never tires the workout.
    - **Specific**: a rehearsal of today's movements at low volume, and a short primer only before short hard workouts.
    - **Skill practice** (10–15 minutes, the week's lightest day only): on the non-heavy day with the shortest workout, if it is 12 minutes or less. Weeks without such a day have none.
    Everyone gets the same warm-up; the levels let each person choose.
- **Plan for today** (collapsed; the target is in its header): the approach and tips, then pacing numbers (target time from your last and best result, checkpoints, warm-up sets for lifts). With the API key set, the approach and tips are written by Claude Haiku from the workout, your version, your earlier results and notes, and the coach's day note. The AI follows CrossFit L1/L2 coaching rules: cues name the body part and direction, positive phrasing, threshold advice, set breaks, never lowering the weight mid-workout, drink when thirsty. Without the key, built-in notes are shown.
- **Check-in**: "How do you feel today?" one tap, 1 (rough) to 5 (great); tap the chosen number again to clear it. Optional. The coach can check in for someone on their Today.
- **Your version (Individual Rx)**: your own version of the workout is scaled to hit its intended stimulus, and each change is listed with its reason. Your time is predicted from your own pace (the median of your actual ÷ estimated times on your last 2 years of finished timed workouts; the estimate alone with fewer than 5). If that falls outside the workout's time domain (short up to 5 minutes, medium 4–12, long 12–20, endurance 20–40), your version is scaled in the L1 order: lighter loads first (up to 15%, and only when that closes at least half of the gap), then fewer rounds or reps (to no less than half); easier movements are only suggested. Volume also follows your conditioning level: 60% + 40% × level (0.75 → 90%, 0.5 → 80%), on reps, rounds and AMRAP minutes, never loads, only when it cuts at least 8%, and not on top of a larger cut for the window. Heavy days are not scaled. The coach can switch a person to the standard reps and rounds for the day ("Use the standard reps and rounds…", and back).
- **Teens' heavy days**: for anyone under 18 (age counted from the birth year, as the youngest it can be), a 1-rep-max day or sets of singles becomes heavy sets of 3-3-2-2-2 at the same lift, with no single max attempt (Kids guide; coach). 3- and 5-rep max days are not changed. The coach can allow a true 1-rep max for that teen on that day ("Allow a true 1-rep max for … today", and back).
- **Weakness work**: a short box under the warm-up, also closed by default, with about 5 minutes of work on one of your skill weaknesses (L2: weakness work belongs in the warm-up, without pre-fatigue). It does the hardest version you can do with good form, 2–3 easy sets of 3–5 reps, never to fatigue. The movement rotates day to day through your list and is skipped when the workout already has that movement or one with the same pattern, or when the family skill block works it that day. The box says why the movement is on your list.
- **Stimulus**: the intended effort, from the time domain (sprint under 4 minutes, hard and fast 4–12, sustained 12–20, long 20+, intervals, or a heavy day with sets of 1–5 at about 80–85%+ and long rests); a completion window (from your own earlier times on this workout, ±10%, else the calibrated estimate) with when to scale; expected rounds for an AMRAP; suggested set breaks on demanding movements (at most about one break per 7 reps, as in the L1 Fran lesson plan: 21 → 3, 15 → 2, 9 → 1, with an example split); and checkpoints per round or per set. Easy movements (air squats, sit-ups, rowing…) get no break advice.
- **Volume warning** (when it applies): the workout asks for far more of a movement than this person's usual (more than the set multiple of their most reps of it in one workout in the last 12 months), or for a movement they haven't done in 12 months, or they have logged nothing for a month (scale volume for the first two weeks back). Jumping pull-ups and GHD sit-ups warn sooner. Source: L1, mitigating rhabdo risk (pp. 151–152): increase volume gradually; the guide gives no exact numbers, so the thresholds are settings.
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
- **Conditioning and readiness**:
    - **Conditioning level** (0–1): the person's results in the last 90 days (180 if fewer than 4) against their best 12 months in the last 5 years, each result compared with their usual power for that kind of workout and duration (as on the grid). The coach's starting estimate (set here, coach only) counts as 3 results' worth, so a few results move it part of the way and 10+ recent results mostly decide it. It will set how much volume and complexity each person's own version gets (Individual Rx, Phase 7).
    - **Lately**: the last 3 weeks of results against the person's usual over the past year.
    - **Training days per week**: the last 8 weeks against the 12 months before.
    - **Check-in**: how many there are, how many fall on days with a result, and whether they are used yet. A check-in counts only once at least 10 match a result that day and they line up (correlation 0.2 or more); then today's answer shows what it suggests.
- **Strengths and weaknesses** (time domain × modality grid, last 3 years): rows are short, medium, long and endurance; columns are gymnastics, weightlifting, run/row/bike and mixed. Each cell shows how that kind of workout compares with the person's usual power for the same modality at the same duration (one shared slope of power against duration, a level per modality), how many results it rests on, how often it was done in the last 12 months, and the trend (the last 12 months against the 2 years before). Tap a cell for the workouts behind it. The level is information only: within one modality it mixes the person with how the modality is measured. Cells are flagged only on what the data shows directly: **Declining** (10 points or more lower in the last 12 months than the 2 years before, 3+ results in each) and **Rarely trained** (at most once in the last 12 months, though it had 3+ results in the 3 years).
- **Weakness work** (skill weaknesses for the warm-up): the person's list. It holds the coach's choices first, then skill movements that the last 2 years of results point to. A movement is pointed to when at least 4 of its workouts were done, 60% or more of them were modified, and that is 25 points or more above the person's usual share of modified workouts. Results only record "prescribed" or "modified", not which movement was changed, so movements that only came along with a stronger one are explained away (the strongest is taken first and its workouts set aside). Only skill movements count: gymnastics of medium or high skill, push-ups and double-unders. Lighter loads are a strength matter and are handled by each person's version. Older evidence (more than 2 years ago) is listed for the coach to add, and is not used otherwise. The coach adds and removes movements here.
- **Repeated workouts**: the same workout with the same loads, finished for time, done two or more times. The work is the same each time, so the change in power is the ratio of the times (L1 guide). Needs no measurements.

## 4. Planning (coach)

### 4.0 Athletes and programs

Athletes (menu) lists the programs you coach: each with its coach, usual training days, default location, athletes (with links to their Today, History and Fitness) and locations.
- **Open program** / **Programming settings** switch the Program and Settings pages to that program.
- **Edit days and coach**: name, usual training days (the planner plans those; any day can still be moved on Program), coach (head coach only; the family program is always the head coach's) and default location.
- **Locations**: tick the equipment there, how many, and the weights of fixed-weight implements (e.g. "12kg, 16kg"; dumbbells count as pairs unless "x1"). The planner only proposes workouts the location can do: runs need a running route, swims a pool, step-ups go onto a bench where there is no box (noted when the Rx height differs). Under "What this place can't do": **no barbell overhead** (a fixed-path rack or low ceiling: no barbell snatches, jerks, presses, push presses, thrusters, overhead squats; seated presses and dumbbell overhead work stay), **strict only on the bar** (pull-ups, toes-to-bar, knees-to-elbows done strict and noted on the day; no bar muscle-ups), **no running route**.
- **Import history** (clients): upload the athlete's BTWB export CSV (columns Date, Formatted Result, Result, Performed, Workout, Description, Notes). Each workout joins the same workout already in the library; results already there are skipped, so the same file can be uploaded again safely. The report lists what was imported and anything skipped.
- **Add an athlete**: name, sex (for Rx loads), birth date, units, and either a new program of their own (training days, coach) or an existing program. Then add their location. Names are used to sign in, so they must be unique; a sign-in password is set later on Account → Family.

### 4.1 Program

What it's for: the weeks ahead.

- Week rows of seven days, three zoom levels (remembered per browser).
- **Propose**: Chalkboard fills the open training days with proposals. Each proposal shows a short why (the gaps it fills, freshness, "benchmark due", rule notes) and up to four alternatives.
- **Approve** a day, or pick an alternative, or any workout from the library.
- **Drag** a workout to another date (it swaps with an open day there).
- **More…** on a day: Move, Location (the equipment check runs again; the workout stays if it fits, otherwise alternatives are refreshed), Time cap, Repeat (the workout comes back every N days, until a date), Warm-up (write one or pick a saved one), Push / Skip, Never propose.
- **Skip → drop**: only that day is skipped; the rest of the plan keeps its dates.
- **Skip → push forward**: that day's workout and every later proposed or approved workout move one training day later, in order. The day you pushed from is left empty and the plan ends one training day later. Nothing is re-planned; instead every day is re-checked where it now sits (see below).
- **+ Add** fills a rest day; the planner checks the days before and after it.
- **Why this workout** (on each proposed or approved day, tap to open): the deciding points (gaps it fills, benchmark or lift test due, a declining or rarely trained area, any penalty); the mix over the planner's window (time domain, movements per workout, task or time priority, load, modality), each as its recent share against your target; how many days since each of its movements was last done; and the rules it was checked against (not repeated within the window or due again, the time limit, heavy-day and same-movement neighbours, benchmarks per week, lift-test spacing, equipment for the group at that location). Days you picked yourself say so; days proposed before this feature ask you to re-plan to get an explanation.
- **Rule check**: every proposed and approved day from today on is re-checked against the planner's rules where it now sits (after Push forward, a drag, a swap or an added day): back-to-back heavy days or the same movement two days running beyond their once-every-N-days exception, too many benchmarks in a week, lift tests too close together, the same workout two days running, missing equipment at the day's location. A day that breaks one shows "Breaks a rule here: …" and a one-tap fix, **Re-plan this day** (for an approved day, **Unapprove and re-plan this day**).
- **Volume warnings**: proposed and approved days from today on show who would face a volume jump (tap to see the details at normal zoom; listed in full at the largest zoom). The same warning appears on that person's Today.

### 4.2 Calendar and Analysis

- **Calendar**: the history by year, 8 weeks or week, with each day's workout and tags.
- **Analysis**: the mix of recent programming (movements per workout, time domain, priority, load, modality) against the targets, and how often each movement was used.

### 4.3 Settings

- **Schedule**: training days (default Mon, Tue, Thu, Fri, Sat), default location, the variety window (how many days back the planner looks).
- **Targets**: the share of workouts wanted in each bucket. Time domain: heavy day, short (under 4 min), medium (4–12), long (12–20), endurance (20+). Also movements per workout, task or time priority, load, modality. Next to each target is the share measured from the published programming (2005 on, first half of 2019 weighted to a quarter); "Use the published mix as my targets" adopts it.
- **Weights**: how the planner ranks candidates (variety gap, movement freshness, weakness focus, benchmark due, week outline).
- **Rules**:
    - Don't repeat a workout within N days (default 180). Benchmarks and coach repeats follow their own schedules.
    - Max benchmarks per week (default 1).
    - Days between lift tests (default 14).
    - Longest workout, ever (default 60 minutes); and workouts longer than 40 minutes at most once every 90 days (both numbers are settings), so the large majority stay within 40 minutes.
    - People training together (default 4; used for the equipment check).
    - Avoid the same movement on two consecutive days, but allow it once every N days (default 28).
    - Avoid heavy days back to back, but allow it once every N days (default 28). The two are separate settings.
    - Volume warnings: warn when a workout asks for more than N× a person's most reps of a movement in one workout in 12 months (default 2), from this many reps up (default 30; half for jumping pull-ups and GHD sit-ups); and after this many days with nothing logged (default 30).
- **Workout library**: import or update the published library (safe to repeat); lists the workouts the planner won't propose and why.

### 4.4 How Chalkboard plans (the engine)

Each program is planned on its own: its history is its members' results and its own planned days. For each open training day, in date order:

1. **Candidates**: every programmable workout in the library and history.
2. **Hard filters**: not repeated within the window (unless a due benchmark or coach repeat), not longer than the maximum (and over 40 minutes only once in 90 days), never a third day in a row in the order the workouts were published (the library supplies single workouts, not weeks; two in a row costs a small penalty), equipment exists at the location (fixed weights within one step), benchmark and lift-test limits, and the back-to-back rules when their exception was already used inside its window.
3. **Score**: how much the workout closes the gaps between the recent mix and the targets (variety), how long since its movements were done (freshness), weakness focus, benchmark or lift test due. Weakness focus favours workouts in a cell flagged Declining or Rarely trained on the Fitness grid, averaged over the family, at most once in any 7 days so balance stays first; the day's note says "works a declining or rarely trained area".
4. **Penalties**: a big volume jump for at least half of the program (more than the volume-warning multiple of their most reps of a movement in one workout in 12 months, or, when nobody has done the movement in 12 months, twice the warning threshold of it; strong, noted on the day as "big volume jump for N of M"); for new clients and long gaps, a high-skill movement nobody in the program has done in 12 months ("mechanics first", L1) and a 1-rep max of a lift nobody has done in 12 months ("build up with heavy 3-5s first"), both strong; same modality mix as yesterday, back-to-back exceptions (allowed rarely, noted on the day), crowded equipment (fewer than half the group can work at once), Turkish get-ups in a metcon (small, or strong if one was done in the last 4 weeks).
5. **Week outline** (soft): the CrossFit Template describes weeks of single elements, couplets and triplets, but calls itself "as much descriptive as prescriptive", and routine is the enemy, so there is no fixed sequence of day types. The outline only makes sure each week has a **heavy day** and an **interval or single monostructural day**, on open days that change week to week (never the same weekday as the week before; the choice is stable when you re-plan). The other days are free: single elements, couplets, triplets and chippers come from the targets. A workout that fits its day gets a bonus set by the "Week outline" weight in Settings (default 20; 0 turns it off). A non-heavy pick on the heavy day costs a penalty, and so does a second heavy day in a week that already has one ("this week's heavy day is …"). Weeks that already have an approved or done heavy day get no heavy slot.
5. The best scorer is proposed; the next four are its alternatives. The choice becomes part of the picture for the next day.

**Tags** are computed, never typed: modality pattern (G gymnastics, W weightlifting, M monostructural; modality follows the load, so bodyweight lunges are G), movement count, time domain (heavy days by their structure: sets of 1–5 or a max lift, with a load; sets of unweighted pull-ups or dips are not a heavy day; the rest by estimated or logged minutes), task or time priority, load, volume.

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
| 2026-11-28 | New clients: location limits (no barbell overhead, strict only, no running route), runs need a route and swims a pool, step-ups onto a bench; planner avoids unfamiliar high skills, first-time 1-rep maxes and big first-time volumes; history import from a BTWB CSV; each program's planning history is its own members' (was everyone's). |
| 2026-11-28 | Athletes and programs: each client gets their own program (coach, days, locations, settings); Athlete dropdown instead of name tabs; Program dropdown on coach pages; access by program. |
| 2026-11-28 | Phone menu folded into ☰ (top right), "Account" instead of your name, warm-up closed by default, today's workout on a grey background. |
| 2026-11-28 | Weakness work in each person's warm-up, from the coach's list and the results; the list is on Fitness. |
| 2026-11-28 | Teens' heavy days: a 1-rep max becomes heavy 3-3-2-2-2 for under-18s unless the coach allows a true 1RM that day. |
| 2026-11-28 | Individual Rx step 1: each person's version scaled to the stimulus window (own pace) and the conditioning ramp, with reasons and a coach switch. |
| 2026-11-28 | Planner v2 step 6: never reproduces a stretch of the published programming. Phase 6 complete. |
| 2026-11-28 | Planner v2 step 5: warm-up complexes (L2), 5-week skill blocks (handstand; muscle-up / pull-up strength) and a weekly light-day skill practice. |
| 2026-11-28 | Heavy days need a load (weighted pull-ups/dips count, unweighted don't); workouts over 40 minutes at most once in 90 days. |
| 2026-11-28 | Planner v2 step 4: Stimulus on Today (intent, completion window, set breaks, checkpoints). |
| 2026-11-28 | Planner v2 step 3: soft week outline: one heavy day and one interval day a week, on changing weekdays (no fixed sequence), with a new weight. |
| 2026-11-28 | Planner v2 step 2: "Why this workout" card on every planned day. |
| 2026-11-28 | Planner v2 step 1: volume-aware picks; every planned day re-checked against the rules where it sits, with a one-tap re-plan. |
| 2026-11-28 | Conditioning level and readiness on Fitness; one-tap check-in on Today. |
| 2026-11-28 | Volume-jump warnings on Program and Today, with three new settings. |
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

See "Chalkboard: the plan" in Drive (02 Plans and design). Phase 5 is in progress: Phases 5 (the athlete picture) and 6 (planner v2) are built. Next: Phase 7, Individual Rx. Later: a smoothed fitness curve with the area shaded, and a 3D health view.
