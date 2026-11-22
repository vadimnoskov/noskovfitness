/**
 * Domain model for Noskov Fitness (phase 1–3).
 * Principle: prescription (what was planned) and performance (what happened) are separate records;
 * history is never rewritten when the plan changes.
 */
import type { MovementRef, PrescriptionParams } from '../movements/resolver';
import type { Implement, Modality } from '../movements/catalog';

export type ID = string;
export type ISODate = string; // yyyy-mm-dd, the athlete's local training date
export type Units = 'lb' | 'kg';

// ---------- People ----------
export interface Athlete {
  id: ID;
  name: string;
  birthYear: number;
  /** Used only for reference standards and default Rx loads. */
  sex: 'male' | 'female';
  units: Units;
  /** Coach can program; athletes record results. */
  role: 'coach' | 'athlete';
}

export interface Group {
  id: ID;
  name: string; // "Noskov family"
  athleteIds: ID[];
  coachIds: ID[];
  /** Default weekly rhythm: ISO weekday numbers 1=Mon..7=Sun that are normally training days. */
  trainingDays: number[];
}

export interface BodyMeasurement { athleteId: ID; date: ISODate; kind: 'weight' | 'height' | 'chest' | 'waist' | 'hips' | 'torso' | 'shoulder-height'; value: number; unit: 'lb' | 'kg' | 'in' | 'cm' }

// ---------- Equipment ----------
/** What a location actually has, with quantities, so a workout can be checked and adjusted for 4 people. */
export interface EquipmentProfile {
  id: ID;
  name: string; // "CrossFit gym", "Home garage"
  items: EquipmentItem[];
}
export interface EquipmentItem {
  implement: Implement;
  quantity: number; // e.g. rower: 1, barbell: 2, rings: 1 set
  /** Available loads for fixed-weight implements, e.g. dumbbells [15,20,25,35,50] (per hand). */
  loads?: number[];
  note?: string;
}

// ---------- Workouts ----------
export type Structure =
  | { kind: 'for-time'; rounds?: number; scheme?: number[]; capMin?: number } // 21-15-9 => scheme
  | { kind: 'amrap'; minutes: number }
  | { kind: 'emom'; minutes: number; everySec?: number }
  | { kind: 'intervals'; rounds: number; workSec?: number; restSec: number; scored: 'time' | 'reps' | 'load' }
  | { kind: 'tabata'; rounds?: number }
  | { kind: 'sets'; scheme: number[]; restSec?: number } // 5-5-5-5-5 strength
  | { kind: 'max'; what: 'load' | 'reps' | 'distance'; minutes?: number }
  | { kind: 'skill-practice'; minutes: number };

export interface Load { male?: number; female?: number; unit: Units; perImplement?: boolean; percentOf?: { movementKey: string; pct: number } }

export interface MovementPrescription {
  movement: MovementRef;
  reps?: number; // per round, or omit when structure.scheme drives reps
  distanceM?: number;
  calories?: number;
  seconds?: number;
  load?: Load;
  heightIn?: { male?: number; female?: number }; // box, wall-ball target
  params?: PrescriptionParams;
  note?: string;
}

export type ScoreType = 'time' | 'rounds-reps' | 'reps' | 'load' | 'distance' | 'calories' | 'none';

export interface Workout {
  id: ID;
  name?: string; // "Fran"; optional for unnamed workouts
  structure: Structure;
  movements: MovementPrescription[];
  scoreType: ScoreType;
  /** Coach's intent in plain words; feeds scaling and AI coaching notes. */
  stimulus?: string;
  targetMinutes?: [number, number];
  benchmark?: { category: 'girl' | 'hero' | 'open' | 'test' | 'own'; retestEveryDays?: number };
  source?: string; // "CrossFit.com", "BTWB import", "NF-WODs 2017"
  /** Imported text is kept verbatim so nothing is lost while parsing improves. */
  originalText?: string;
  /** Tags derived from structure + movements; a coach override wins. */
  tags?: Partial<WorkoutTags>;
}

export type TimeDomain = 'short' | 'medium' | 'long' | 'endurance';
export interface WorkoutTags {
  modalityPattern: Modality[]; // per movement in order, e.g. ['W','G'] for Fran
  movementCount: number;
  load: 'bodyweight' | 'light' | 'medium' | 'heavy';
  volume: 'low' | 'medium' | 'high';
  timeDomain: TimeDomain;
  priority: 'task' | 'time';
  pathway: 'phosphagen' | 'glycolytic' | 'oxidative';
}

// ---------- Program calendar ----------
export type DayStatus = 'proposed' | 'approved' | 'done' | 'skipped';

export interface ProgramDay {
  id: ID;
  groupId: ID;
  date: ISODate;
  status: DayStatus;
  equipmentProfileId: ID;
  /** Optional short technique/skill part before the main workout (never heavy). */
  practice?: Workout;
  main: Workout;
  /** Who/what produced it: the engine (with its score breakdown) or the coach. */
  origin: { by: 'engine' | 'coach'; score?: Record<string, number>; policyVersion?: string };
  coachNote?: string;
}

/** Calendar operations the coach can apply; each may trigger a re-plan of later unapproved days. */
export type ScheduleOp =
  | { op: 'skip'; dayId: ID; shift: 'drop' | 'push-forward' }
  | { op: 'push-forward'; fromDate: ISODate; trainingDays: number } // move this and all later days
  | { op: 'insert'; date: ISODate; workout?: Workout } // extra day; engine fills if no workout
  | { op: 'move'; dayId: ID; toDate: ISODate }
  | { op: 'replan'; fromDate: ISODate; toDate: ISODate }; // regenerate proposed days only

// ---------- Athlete versions and results ----------
export interface AthleteVersion {
  dayId: ID;
  athleteId: ID;
  /** Same structure as the group workout; movements/reps/loads may differ. */
  workout: Workout;
  changes: { index: number; from: MovementPrescription; to: MovementPrescription; reason: 'time-match' | 'scaling-ladder' | 'load' | 'equipment' | 'coach' }[];
  coachingNote?: CoachingNote;
}

export interface CoachingNote {
  text: string;
  generatedAt: string;
  model: string;
  /** Hash of the history + workout used, so the note regenerates only when inputs change. */
  inputsHash: string;
  approved?: boolean;
}

export interface Result {
  id: ID;
  athleteId: ID;
  date: ISODate;
  dayId?: ID; // absent for imported history
  workoutId?: ID;
  /** Exactly what was done, which may differ from the plan. */
  performed: Workout;
  asPrescribed: boolean; // Rx vs scaled
  completed: boolean; // false = capped / partial
  score: {
    timeSec?: number;
    rounds?: number; // stored separately from reps: 5 rounds + 12 reps
    reps?: number;
    loads?: number[]; // per set, in athlete units
    distanceM?: number;
    calories?: number;
  };
  notes?: string;
  source: 'app' | 'btwb-import' | 'manual-notes';
}
