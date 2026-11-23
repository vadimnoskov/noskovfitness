-- Programming engine: editable policy per group, default location, and engine output on program days.
CREATE TABLE programming_policy (
  group_id   text PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  policy     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE groups ADD COLUMN default_equipment_id text;
ALTER TABLE program_days ADD COLUMN alternatives jsonb NOT NULL DEFAULT '[]';
ALTER TABLE program_days ADD COLUMN warnings jsonb NOT NULL DEFAULT '[]';
ALTER TABLE program_days ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
