-- Noskov Fitness schema v1. Prescription and performance are separate; history is never rewritten.

CREATE TABLE movements (
  key       text PRIMARY KEY,               -- canonical key, e.g. 'snatch|start=hang|receive=power'
  family    text NOT NULL,
  name      text NOT NULL,
  modality  char(1) NOT NULL CHECK (modality IN ('G','W','M')),
  pattern   text NOT NULL,
  ref       jsonb NOT NULL                  -- MovementRef
);

CREATE TABLE athletes (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  birth_year int,
  sex        text NOT NULL CHECK (sex IN ('male','female')),
  units      text NOT NULL DEFAULT 'lb' CHECK (units IN ('lb','kg')),
  is_coach   boolean NOT NULL DEFAULT false,
  can_log_for_others boolean NOT NULL DEFAULT false
);

CREATE TABLE groups (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  training_days int[] NOT NULL DEFAULT '{1,2,4,5,6}'   -- ISO weekdays
);
CREATE TABLE group_members (
  group_id   text REFERENCES groups(id) ON DELETE CASCADE,
  athlete_id text REFERENCES athletes(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, athlete_id)
);

CREATE TABLE equipment_profiles (
  id       text PRIMARY KEY,
  group_id text REFERENCES groups(id) ON DELETE CASCADE,
  name     text NOT NULL,
  items    jsonb NOT NULL                 -- EquipmentItem[]
);

CREATE TABLE workouts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature      text UNIQUE NOT NULL,    -- dedupe key: same workout repeated = same row
  name           text,
  structure      jsonb NOT NULL,
  movements      jsonb NOT NULL,          -- MovementPrescription[]
  score_type     text NOT NULL,
  stimulus       text,
  target_minutes numeric[],
  benchmark      jsonb,                   -- {category, retestEveryDays}
  tags_override  jsonb,
  tags           jsonb NOT NULL,          -- derived (Rx, male) for programming analysis
  source         text,
  original_text  text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workout_movements (
  workout_id   uuid REFERENCES workouts(id) ON DELETE CASCADE,
  position     int NOT NULL,
  movement_key text NOT NULL REFERENCES movements(key),
  PRIMARY KEY (workout_id, position)
);
CREATE INDEX ON workout_movements (movement_key);

CREATE TABLE program_days (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  date                 date NOT NULL,
  seq                  int NOT NULL DEFAULT 1,     -- an inserted extra workout on the same date gets 2
  status               text NOT NULL CHECK (status IN ('proposed','approved','done','skipped')),
  equipment_profile_id text REFERENCES equipment_profiles(id),
  practice_workout_id  uuid REFERENCES workouts(id),
  main_workout_id      uuid NOT NULL REFERENCES workouts(id),
  origin               jsonb NOT NULL DEFAULT '{"by":"coach"}',
  coach_note           text,
  UNIQUE (group_id, date, seq)
);

CREATE TABLE athlete_versions (
  day_id        uuid REFERENCES program_days(id) ON DELETE CASCADE,
  athlete_id    text REFERENCES athletes(id) ON DELETE CASCADE,
  workout       jsonb NOT NULL,
  changes       jsonb NOT NULL DEFAULT '[]',
  coaching_note jsonb,
  PRIMARY KEY (day_id, athlete_id)
);

CREATE TABLE results (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id    text NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date          date NOT NULL,
  day_id        uuid REFERENCES program_days(id) ON DELETE SET NULL,
  workout_id    uuid REFERENCES workouts(id),
  performed     jsonb NOT NULL,           -- exactly what was done
  as_prescribed boolean NOT NULL,
  completed     boolean NOT NULL DEFAULT true,
  score         jsonb NOT NULL,           -- {timeSec, rounds, reps, loads[], distanceM, calories}
  tags          jsonb,                    -- derived for this athlete's performance
  notes         text,
  source        text NOT NULL,            -- app | btwb-import | manual-notes
  entered_by    text REFERENCES athletes(id),
  uncertain     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON results (athlete_id, date);
CREATE INDEX ON results (workout_id);

CREATE TABLE measurements (
  athlete_id text REFERENCES athletes(id) ON DELETE CASCADE,
  date       date NOT NULL,
  kind       text NOT NULL,
  value      numeric NOT NULL,
  unit       text NOT NULL,
  PRIMARY KEY (athlete_id, date, kind)
);

CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
