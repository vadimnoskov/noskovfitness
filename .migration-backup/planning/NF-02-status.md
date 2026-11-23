# NF-02 — Decisions and build status

November 22, 2026

## Your answers, now requirements

| Topic | Decision | How the app handles it |
|---|---|---|
| Rhythm | All four train together, usually 5 days a week | Group calendar with default training days. Coach can **skip**, **push forward** (shift later days), **insert** an extra day or **move** a day. Later unapproved days are then re-planned to keep variety balanced. |
| Locations | CrossFit gym (everything) or home garage (almost everything, limited quantity) | Each location is an **equipment profile** with quantities and available loads. Every day is checked against its location; with 1 rower for 4 people the engine staggers or substitutes. |
| Sasha (15), Anton (13) | Do nearly all lifts and movements, including handstand walks, bar muscle-ups (learning) and double-unders | Versions scaled by load and time-matched reps rather than easier movements. Bar muscle-up gets a progression step until it is solid. |
| Engine depth | Fill the next week or several, coach approves or edits | Engine fills a planning window (1–6 weeks) with **proposed** days; coach approves day by day or the whole week. Options stay available per day. |
| Coaching notes | Written by AI from each person's history and the workout | Generated per athlete version and saved with a fingerprint of the inputs, so a note is regenerated only when history or the workout changes. Notes need an Anthropic API key at build time. |
| Olga's data | Coming in a few days; meanwhile assume Vadim's results scaled for women's loads | Placeholder profile from Vadim's numbers × the CrossFit women's/men's Rx load ratio, clearly marked as estimated until her export arrives. |

## Built so far (code repository "noskov-fitness")

- **Movement catalog**: 71 movement families with controlled attributes (implement, single/double/alternating, start position, receiving position, style, carry position, named variant).
- **Resolver**: turns any typed or imported phrase into exactly one catalog movement. Prescription details (unbroken, weighted, tempo, pause, calories vs meters) are kept separate from identity. It resolves **99.7%** of the 11,952 movement mentions in the three BTWB exports: 704 spellings become 355 movements. Complexes and unknown phrases are flagged for review, never guessed.
- **Domain model**: athletes, group, equipment profiles, workouts (structures: for time, AMRAP, EMOM, intervals, Tabata, sets, max, skill practice), derived tags, program days, schedule operations, athlete versions, AI coaching notes, results (rounds and extra reps stored separately; capped results kept apart from completed times).
- **Kids' records**: 125 results and 33 measurements from Olga's notes structured and linked to the catalog; 7 are marked uncertain where the notes had a "?".
- Automated tests for the resolver. Code backup: `noskov-fitness-code.bundle` in this folder.

## Review now

Movement Library Review page: six decisions plus the full library, searchable, with every old spelling filed under its movement.

## Still open

1. Sasha's sex, for default Rx loads and reference standards (the app needs it for women's/men's Rx).
2. Which weekdays are the default 5 training days?
3. Home garage equipment list with quantities (rower/bike count, barbells, dumbbell and kettlebell weights, rings, rope, GHD…).
4. Units: lb for everyone?
5. Logging: each person on their own phone, or one person logs for the group?
6. A GitHub account or repository to hold the code, so it isn't only in this temporary workspace.

## Next build steps

1. Lock the movement library after your review.
2. Import all three BTWB histories into the database as structured workouts and results.
3. Benchmark library (Girls, Heroes, Open, your Misc WODs) with retest intervals.
4. The program calendar web app: week / 8-week / year zoom with your color coding, workout builder, live analysis map.
