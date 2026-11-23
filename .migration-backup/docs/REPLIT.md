# Moving Noskov Fitness to Replit

## Should it be Replit or Vercel?

**Replit is a good fit for this project.** It gives you the editor, a PostgreSQL database (Neon-backed), secrets,
publishing and an AI agent in one place, and it can build an Expo mobile app later from the same account.
Vercel is the best host specifically for Next.js, but you would add a separate database account and have no editor there.
For a family app that grows feature by feature, one place to run, edit and publish matters more.

Three things to keep in mind with Replit:

1. **GitHub stays the source of truth.** Claude Code pushes to GitHub; Replit pulls. If you change code in Replit
   (or Replit Agent does), commit and push it so the two never drift. Before accepting Agent changes to the engine,
   run `npm run check` in the Shell: the tests protect the programming rules.
2. **Costs are usage-based.** A family-size app is small, but check replit.com/pricing for the current Core plan and
   publishing/database usage before publishing.
3. **Mobile:** the web app works on phones now (add it to the home screen). A native app later is an Expo project
   that talks to the same database/API; publishing to the App Store needs an Apple Developer membership.

## What you need before starting

- The GitHub repo `vadimnoskov/noskovfitness` (done) with the Claude GitHub App installed (done).
- The database export **`noskovfitness-db.sql`** from Google Drive → NoskovFitness_app → Planning. It contains your
  family's training history, so it lives in Drive and never in GitHub.
- A family password you will share with Olga, Sasha and Anton.

## Steps

> Replit renames buttons from time to time. If a label below differs from what you see, look for the closest match
> (or the Tools / search box in the workspace) and tell me what you saw.

1. **Import the repo.** Go to <https://replit.com/import> → **GitHub**. Connect your GitHub account if asked and allow
   access to `noskovfitness`. Pick the repo and import it.
   - If Replit Agent offers to "set up" or convert the project, answer:
     *"Keep the existing project structure. It is an npm workspaces monorepo; the .replit file already defines run,
     build and deployment. Please don't restructure files."*
2. **Add the database.** Open the **Database** tool in the workspace and create a **PostgreSQL** database.
   Replit stores the connection string as the `DATABASE_URL` secret. Check in **Secrets** that `DATABASE_URL` exists.
3. **Add the password.** In **Secrets**, add `APP_PASSWORD` = your family password.
   (Without it the published app refuses to start, on purpose.)
4. **Load your data.** Drag `noskovfitness-db.sql` from your computer into the workspace file tree.
   It is ignored by git, so it will not be committed. Then open the **Shell** and run:
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f noskovfitness-db.sql
   ```
   Check it worked (expect 2930 and 151):
   ```bash
   psql "$DATABASE_URL" -c "select (select count(*) from results) results, (select count(*) from workouts where benchmark is not null) benchmarks"
   ```
   Then delete the file from the workspace:
   ```bash
   rm noskovfitness-db.sql
   ```
5. **Install and run.** In the Shell run `npm ci`, then press **Run**. The preview opens the sign-in page; use the
   family password. You should see Program, Calendar, Analysis, Benchmarks and Settings.
6. **Publish.** Open **Publish / Deployments**, choose **Autoscale**. The build and run commands come from `.replit`
   (`npm ci --include=dev && npm run db:migrate && npm run build`, then `npm run start`). Make sure `APP_PASSWORD` and
   `DATABASE_URL` are available to the published app (Secrets are usually copied automatically).
   - If Replit gives the published app its **own production database**, it starts empty: repeat step 4 against it.
     Replit shows that database's connection string in the Database tool; ask me if unsure.
7. **Share** the published address with the family. Each person adds it to their phone's home screen
   (Safari: Share → Add to Home Screen; Chrome: menu → Add to Home screen).

## Everyday workflow afterwards

- New features: I push to GitHub → in Replit open the **Git** pane → **Pull** → the app restarts → **Publish** again.
- Database changes ship as numbered files in `packages/db/migrations/`; the publish build runs `npm run db:migrate`,
  which applies only new ones and never deletes data.
- Never run `npm run db:import` against the Replit database once you have approved program days: it rebuilds the
  history from the exports and refuses to run if it would delete approved days (unless `FORCE=1`).
