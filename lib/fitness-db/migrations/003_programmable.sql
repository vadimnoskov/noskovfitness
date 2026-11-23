-- Coach control over which library workouts the engine may propose.
ALTER TABLE workouts ADD COLUMN programmable boolean NOT NULL DEFAULT true;
ALTER TABLE workouts ADD COLUMN programmable_reason text;
