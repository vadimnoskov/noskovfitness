# Noskov Fitness — Planning Brief v1

November 22, 2026 · Companion to the visual plan (noskov-fitness-plan.html)

## 1. Decision in one paragraph

Build Noskov Fitness as a **CrossFit-only programming app** for our family first. It starts as the 2017 (2013) programming spreadsheet turned into a live, zoomable calendar, plus a basic result log for Vadim, Olga, Sasha and Anton. Two clean libraries sit underneath it: **movements** (one canonical entry each) and **workouts** (structured, repeatable, with benchmarks). A rules-based **programming engine** suggests workouts and Vadim approves them. The engine is built as a separate, tested module so features can be added one at a time. The dumbbell-only "Strength After 40" track, buddy groups and a public track come later, built on the same engine as additional equipment profiles and groups.

## 2. Ground rules

- CrossFit methodology is the baseline for everything: constantly varied, functional movements, executed at relatively high intensity. No other strength and conditioning methodology unless the programmer explicitly asks for it.
- Varied is not random. Variance is tracked across: modality (G/W/M) and their combinations, number of movements, volume, time domain, energy pathway, structure (AMRAP, for time, intervals, EMOM, Tabata, sets), task vs time priority, load, and specific movements.
- One workout of the day. An optional short practice part (lift technique or gymnastics skill) may come before a metcon. A heavy lifting day stands alone, never followed by an intense metcon. A gymnastics practice can be the entire day.
- The ultimate goal is balance across all ten general physical skills. Weakness focus only nudges a varied program and never dominates it.

## 3. Core concepts (glossary)

| Concept | Meaning |
|---|---|
| Movement | One canonical movement (e.g. Pull-up), with modality, pattern, implement and unit. |
| Variation | A named child of a movement with fixed attributes (strict, kipping, chest-to-bar, jumping, banded…). |
| Alias | Any spelling that resolves to one movement/variation. Typed text never creates a new movement silently. |
| Scaling ladder | An ordered list of variations from easiest to hardest, with rough rep conversions. |
| Workout | A reusable structure + movements + Rx loads/standards + score type. Can be marked **benchmark** with a retest interval. |
| Day | One main workout, optionally preceded by a practice part. Placed on the program calendar. |
| Derived tags | Modality pattern, # movements, load, volume, time domain, priority, energy pathway — computed from the workout, overridable. |
| Program / track | A calendar of days for a group (family now; buddy groups, public track later). |
| Athlete version | The automatic scaled copy of the group Rx workout for one person, with their coaching notes. |
| Result | What actually happened: version done, time / rounds+reps / loads per set, capped or completed, notes. |
| Policy | Editable targets, weights and rules the engine uses. |

## 4. The screens (phase 1–3)

1. **Program calendar**: week rows, color-coded day headers (W/G/M, load, time, volume, priority, ★ benchmark). Zoom from week, to 8 weeks, to a year.
2. **Workout builder**: pick a structure, add movements from the library, set reps/loads. Tags are derived automatically.
3. **Movement library**: families, variations, aliases, scaling ladders. Adding a movement starts with a duplicate check.
4. **Benchmarks**: Girls, Heroes, Open workouts, our own, each with a retest interval and history.
5. **Analysis**: the live map-2017 view (movement × week, total, last used) plus the mix against targets on every dimension. Windows: 4 weeks, 12 weeks, year.
6. **Athlete view** (phone first): today's workout in their version, coaching notes, result entry, history.
7. **Engine panel**: proposals for open days with a score breakdown; editable rules and weights.

## 5. Programming engine (how it decides)

1. **Filter** candidates with hard rules (one main workout; no heavy lift + intense metcon on the same day; no same movement on consecutive days; equipment available; every athlete has a valid version).
2. **Score** the survivors: variety gap (how much a candidate moves the recent mix toward target) + movement freshness + weakness focus (capped, default about 15%) + benchmark due.
3. **Propose** the top few for each open day. Vadim picks, edits or writes his own. Nothing is published automatically.
4. All targets and weights live in an editable policy, so the "core algorithm" can be adjusted without code changes. The engine is a separate TypeScript package with automated tests for every rule.

## 6. Group programming and scaling

- One Rx workout for the group, so everyone trains together.
- **Time-matched scaling:** reps for each person = intended seconds on that movement × that person's pace. Pace comes from their history and updates after each result. If the pace is too low, step down the scaling ladder. Example: Vadim does 30 double-unders in about 30 s; Anton's version gets the number he can do in about 30 s.
- **Group aggregate:** the engine ranks gaps on the group's average profile, so the shared workout targets shared weaknesses. Individual weaknesses get an optional 5–10 minute **personal practice** before the group workout.
- **Coaching notes** appear only in each person's own view: last result, best result, pacing plan; for lifts, warm-up sets and working weights from previous results.

## 7. Fitness profile

Our own transparent method, not a copy of BTWB's population ranking. Categories similar to BTWB's (power lifts, Olympic lifts, speed, endurance, bodyweight, light, heavy and long metcons), each scored 0–100 against published reference standards adjusted for age and sex. A category with no data is "not measured", never "weak". Imbalances are shown as in BTWB (e.g. front squat vs back squat, snatch vs clean). The group line is the average of the people measured in each category.

## 8. Data we already have

- **BTWB export** (2,673 sessions, Aug 2008 – Nov 2026; 2,443 Rx, 230 scaled). It contains 1,876 distinct workout names and about 1,480 raw movement spellings (about 580 after basic cleanup). It is the seed for Vadim's history, the benchmark list and the movement-library dedupe review.
- **NF-WODs spreadsheet**: 2011–2026 programming sheets, the map sheets (movement list grouped by modality + benchmark list), and the Girls, Hero, Misc WODs and ALL OPEN tabs.
- **CrossFit Journal library** (what-is-fitness, foundations and others) as the methodology reference.
- Earlier "Strength After 40" planning package: useful later for the dumbbell track and the commercial phase. Its data-model cautions are adopted: rounds and extra reps stored separately; a capped finish is not a completed time; a scaled version never creates a false PR.

## 9. Roadmap

| Phase | Deliverable | Done when |
|---|---|---|
| 0 Foundation | Repo, data model, movement library seeded + dedupe review, import of Vadim's history | The library has no duplicates and all of Vadim's history is linked to it |
| 1 Program | Workout builder, benchmarks, zoomable calendar, live analysis map | Vadim programs a month in the app instead of the sheet |
| 2 Record | Four family logins, result entry, history, PRs | All four log a week of workouts |
| 3 Scale + notes | Athlete versions, time-matched reps, ladders, coaching notes | Each person sees their own version and notes |
| 4 Suggest | Engine proposals, editable policy | Vadim accepts most proposals with light edits |
| 5 Profile | Fitness profile, weakness focus, group aggregate | The profile matches Vadim's judgment of each person |
| Later | Mobile app, dumbbell track (Strength After 40), buddy groups, public track, subscriptions | Each added as its own step |

## 10. Platform recommendation

Build with **Claude Code in a GitHub repository**: TypeScript, Next.js, PostgreSQL, with the engine as a separate tested package. Phase 1 is a responsive web app the family adds to their phone home screens; a native app later uses the same API. The repo can be opened or hosted on Replit at any time, so nothing locks us in.

## 11. Open questions

1. Weekly rhythm: fixed days (e.g. Sunday rest), 3-on/1-off, or 5-on/2-off? Same days for all four?
2. Training location(s) and real equipment list for each.
3. Sasha and Anton: ages and current abilities (barbell, pull-ups, double-unders…).
4. Units: lb for everyone, or kg for some?
5. Logging: each person on their own phone, or one person logs for the group?
6. Target mix: use proposed defaults, or derive them from Vadim's 2016–2025 history?
7. Time domains: keep the sheet's (short < 4, medium 4–12, long 12–20, endurance 20–60 min)?
8. Benchmarks: start from the Girls / Hero / Open / Misc WODs tabs? Any on a fixed retest rhythm?
9. Engine depth: propose-and-pick, or fill a week to edit?
10. Coaching notes: rule-based first, or written by an AI model from history?
11. OK with Claude Code + GitHub as the build home, hosting decided later?
12. Do Olga or the kids have BTWB data to import?
