// The imported PostgreSQL schema, preserved for Replit's schema management.
import { sql } from 'drizzle-orm';
import { pgTable, text, char, integer, boolean, jsonb, uuid, date, timestamp, numeric, primaryKey, unique, index, check } from 'drizzle-orm/pg-core';

export const movements = pgTable('movements', {
  key: text('key').primaryKey(), family: text('family').notNull(), name: text('name').notNull(),
  modality: char('modality', { length: 1 }).notNull(), pattern: text('pattern').notNull(), ref: jsonb('ref').notNull(),
}, t => [check('movements_modality_check', sql`${t.modality} IN ('G','W','M')`)]);

export const athletes = pgTable('athletes', {
  id: text('id').primaryKey(), name: text('name').notNull(), birthYear: integer('birth_year'), sex: text('sex').notNull(),
  units: text('units').notNull().default('lb'), isCoach: boolean('is_coach').notNull().default(false),
  canLogForOthers: boolean('can_log_for_others').notNull().default(false),
  /** scrypt hash of the athlete's own password; null until the coach sets one. */
  passwordHash: text('password_hash'),
  /** Standing load setting: fraction of the standard Rx per kind of equipment, e.g. {"dumbbell":0.6}. Null = full Rx. */
  loadProfile: jsonb('load_profile'),
}, t => [check('athletes_sex_check', sql`${t.sex} IN ('male','female')`), check('athletes_units_check', sql`${t.units} IN ('lb','kg')`)]);

export const groups = pgTable('groups', {
  id: text('id').primaryKey(), name: text('name').notNull(),
  trainingDays: integer('training_days').array().notNull().default(sql`'{1,2,4,5,6}'::integer[]`),
  defaultEquipmentId: text('default_equipment_id'),
});
export const groupMembers = pgTable('group_members', {
  groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  athleteId: text('athlete_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
}, t => [primaryKey({ columns: [t.groupId, t.athleteId] })]);
export const equipmentProfiles = pgTable('equipment_profiles', {
  id: text('id').primaryKey(), groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(), items: jsonb('items').notNull(),
});
export const workouts = pgTable('workouts', {
  id: uuid('id').primaryKey().defaultRandom(), signature: text('signature').unique().notNull(), name: text('name'),
  structure: jsonb('structure').notNull(), movements: jsonb('movements').notNull(), scoreType: text('score_type').notNull(),
  stimulus: text('stimulus'), targetMinutes: numeric('target_minutes').array(), benchmark: jsonb('benchmark'),
  tagsOverride: jsonb('tags_override'), tags: jsonb('tags').notNull(), source: text('source'), originalText: text('original_text'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  programmable: boolean('programmable').notNull().default(true), programmableReason: text('programmable_reason'),
  /** Coach exception to the no-repeat rule: propose again every N days, until repeat_until (null = no end). */
  repeatEveryDays: integer('repeat_every_days'), repeatUntil: date('repeat_until', { mode: 'string' }),
  /** Coach's saved warm-up for this workout (used whenever it is programmed, unless the day has its own). */
  warmUp: text('warm_up'),
});
export const workoutMovements = pgTable('workout_movements', {
  workoutId: uuid('workout_id').notNull().references(() => workouts.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(), movementKey: text('movement_key').notNull().references(() => movements.key),
}, t => [primaryKey({ columns: [t.workoutId, t.position] }), index('workout_movements_movement_key_idx').on(t.movementKey)]);
export const programDays = pgTable('program_days', {
  id: uuid('id').primaryKey().defaultRandom(), groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(), seq: integer('seq').notNull().default(1), status: text('status').notNull(),
  equipmentProfileId: text('equipment_profile_id').references(() => equipmentProfiles.id),
  practiceWorkoutId: uuid('practice_workout_id').references(() => workouts.id),
  mainWorkoutId: uuid('main_workout_id').notNull().references(() => workouts.id),
  origin: jsonb('origin').notNull().default({ by: 'coach' }), coachNote: text('coach_note'),
  /** Coach's warm-up for this day only; null = the workout's saved warm-up or the suggested one. */
  warmUp: text('warm_up'),
  alternatives: jsonb('alternatives').notNull().default([]), warnings: jsonb('warnings').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [unique('program_days_group_id_date_seq_key').on(t.groupId, t.date, t.seq),
  check('program_days_status_check', sql`${t.status} IN ('proposed','approved','done','skipped')`)]);
export const athleteVersions = pgTable('athlete_versions', {
  dayId: uuid('day_id').notNull().references(() => programDays.id, { onDelete: 'cascade' }),
  athleteId: text('athlete_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
  workout: jsonb('workout').notNull(), changes: jsonb('changes').notNull().default([]), coachingNote: jsonb('coaching_note'),
}, t => [primaryKey({ columns: [t.dayId, t.athleteId] })]);
export const results = pgTable('results', {
  id: uuid('id').primaryKey().defaultRandom(), athleteId: text('athlete_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(), dayId: uuid('day_id').references(() => programDays.id, { onDelete: 'set null' }),
  workoutId: uuid('workout_id').references(() => workouts.id), performed: jsonb('performed').notNull(),
  asPrescribed: boolean('as_prescribed').notNull(), completed: boolean('completed').notNull().default(true), score: jsonb('score').notNull(),
  tags: jsonb('tags'), notes: text('notes'), source: text('source').notNull(), enteredBy: text('entered_by').references(() => athletes.id),
  uncertain: boolean('uncertain').notNull().default(false), createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('results_athlete_id_date_idx').on(t.athleteId, t.date), index('results_workout_id_idx').on(t.workoutId)]);
export const measurements = pgTable('measurements', {
  athleteId: text('athlete_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }), date: date('date', { mode: 'string' }).notNull(),
  kind: text('kind').notNull(), value: numeric('value').notNull(), unit: text('unit').notNull(),
}, t => [primaryKey({ columns: [t.athleteId, t.date, t.kind] })]);
export const programmingPolicy = pgTable('programming_policy', {
  groupId: text('group_id').primaryKey().references(() => groups.id, { onDelete: 'cascade' }), policy: jsonb('policy').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export const schemaMigrations = pgTable('schema_migrations', {
  name: text('name').primaryKey(), appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Signed-in devices. The cookie holds a random token; only its SHA-256 hash is stored. */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  athleteId: text('athlete_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [index('sessions_athlete_id_idx').on(t.athleteId)]);

/** AI-written coaching note per person per program day; rewritten when anything it is based on changes (input_hash). */
export const coachingNotes = pgTable('coaching_notes', {
  dayId: uuid('day_id').notNull().references(() => programDays.id, { onDelete: 'cascade' }),
  athleteId: text('athlete_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
  inputHash: text('input_hash').notNull(), note: jsonb('note').notNull(), model: text('model').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.dayId, t.athleteId] })]);

/** Coach's own warm-ups, to pick for any day (e.g. "Burgener + bar complex"). */
export const warmUpTemplates = pgTable('warm_up_templates', {
  id: uuid('id').primaryKey().defaultRandom(), name: text('name').notNull().unique(), body: text('body').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Coach's edit of one person's "Plan for today" on a program day; replaces the AI or built-in plan for that day. */
export const planEdits = pgTable('plan_edits', {
  dayId: uuid('day_id').notNull().references(() => programDays.id, { onDelete: 'cascade' }),
  athleteId: text('athlete_id').notNull().references(() => athletes.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  editedAt: timestamp('edited_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.dayId, t.athleteId] })]);

/** Where and when a workout was published (e.g. the daily archive), one row per appearance. Feeds era weighting and anti-copy. */
export const workoutSources = pgTable('workout_sources', {
  workoutId: uuid('workout_id').notNull().references(() => workouts.id, { onDelete: 'cascade' }),
  source: text('source').notNull(), sourceDate: date('source_date', { mode: 'string' }).notNull(),
}, t => [primaryKey({ columns: [t.workoutId, t.source, t.sourceDate] }), index('workout_sources_date_idx').on(t.sourceDate)]);

/** The coach's layer on Chalkboard's knowledge cards (the cards themselves live in code): status changes and notes. */
export const knowledgeState = pgTable('knowledge_state', {
  cardId: text('card_id').primaryKey(),
  status: text('status'), coachNote: text('coach_note'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [check('knowledge_state_status_check', sql`${t.status} IS NULL OR ${t.status} IN ('confirmed','proposed','disputed','gap')`)]);

/** History of every change to the knowledge (who, what, when), for the change log and undo. */
export const knowledgeEvents = pgTable('knowledge_events', {
  id: uuid('id').primaryKey().defaultRandom(), cardId: text('card_id').notNull(),
  action: text('action').notNull(), detail: jsonb('detail').notNull().default({}),
  byAthlete: text('by_athlete').references(() => athletes.id, { onDelete: 'set null' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('knowledge_events_card_idx').on(t.cardId)]);

/** Questions the coach asked Chalkboard, with its answer and the cards it used; unanswered ones become gaps. */
export const knowledgeQuestions = pgTable('knowledge_questions', {
  id: uuid('id').primaryKey().defaultRandom(), question: text('question').notNull(), answer: text('answer').notNull(),
  cardIds: text('card_ids').array().notNull().default(sql`'{}'::text[]`), covered: boolean('covered').notNull(), gap: text('gap'),
  model: text('model').notNull(), byAthlete: text('by_athlete').references(() => athletes.id, { onDelete: 'set null' }),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
});

/** What the coach taught Chalkboard: the explanation, Chalkboard's draft (cards, setting changes, conflicts), the preview and the decision. */
export const knowledgeTeachings = pgTable('knowledge_teachings', {
  id: uuid('id').primaryKey().defaultRandom(), text: text('text').notNull(),
  draft: jsonb('draft').notNull(), preview: jsonb('preview'), status: text('status').notNull().default('draft'),
  decision: text('decision'), policyBefore: jsonb('policy_before'), policyAfter: jsonb('policy_after'),
  byAthlete: text('by_athlete').references(() => athletes.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, t => [check('knowledge_teachings_status_check', sql`${t.status} IN ('draft','confirmed','discarded','undone')`)]);

/** Cards the coach taught (same shape as methodology cards), merged into the knowledge when active. */
export const coachCards = pgTable('coach_cards', {
  id: text('id').primaryKey(), body: jsonb('body').notNull(),
  teachingId: uuid('teaching_id').references(() => knowledgeTeachings.id, { onDelete: 'set null' }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
