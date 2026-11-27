/**
 * Chalkboard's knowledge: every principle, rule, number and definition the engine works from is a card with a
 * plain-language statement, its sources, how strongly it applies, and what the engine does with it.
 *
 * Methodology cards live in code (they are quotes and summaries of the manuals, not personal data). The coach's
 * status changes, notes and own cards live in the database and are merged on top (see mergeCards).
 */

export type AreaId =
  | 'definitions' | 'charter' | 'week' | 'variance' | 'heavy' | 'conditioning' | 'skills' | 'weaknesses'
  | 'scaling' | 'populations' | 'recovery' | 'session' | 'equipment' | 'coaching' | 'assessment' | 'movements' | 'lifestyle' | 'people';

export interface Area { id: AreaId; name: string; blurb: string }

export type CardKind = 'definition' | 'principle' | 'rule' | 'number' | 'method' | 'caution';
/** hard: never broken · strong: avoided unless nothing else fits · guidance: shapes choices · info: background. */
export type Strength = 'hard' | 'strong' | 'guidance' | 'info';
/** confirmed: in use · proposed: waiting for the coach · disputed: sources or coach disagree · gap: known unknown. */
export type CardStatus = 'confirmed' | 'proposed' | 'disputed' | 'gap';
export type LinkRel = 'refines' | 'supports' | 'limits' | 'conflicts' | 'uses' | 'related';

export interface SourceRef {
  /** Key into SOURCES, or 'coach' for the coach's own decision. */
  doc: string;
  /** Section, page or date, e.g. "Heavy days", "p. 94", "2026-11-26". */
  where?: string;
  /** A short verbatim quote, when the wording matters. */
  quote?: string;
}

export interface EngineUse {
  /** Plain description of what the engine does with this card. */
  does: string;
  /** built: the engine does it today · planned: in a later phase. */
  state: 'built' | 'planned';
  phase?: number;
  /** Settings paths whose current values belong next to the card (e.g. "rules.heavyExceptionDays"). */
  settings?: string[];
  /** Regular expression (source) matching the planner's notes when this card changed a pick; used to count it. */
  notePattern?: string;
}

export interface KnowledgeCard {
  id: string;
  area: AreaId;
  title: string;
  statement: string;
  kind: CardKind;
  strength: Strength;
  status: CardStatus;
  sources: SourceRef[];
  links?: { rel: LinkRel; to: string }[];
  engine?: EngineUse;
  /** Who the card is about when it is not everyone (e.g. "teens", "late masters"). */
  scope?: string;
  /** For disputed cards and gaps: what is open, in one or two sentences. */
  open?: string;
  /** 'coach' for cards the coach taught (stored in the database); methodology cards have no origin. */
  origin?: 'coach';
  /** The teaching that created a coach card. */
  teachingId?: string;
}

export interface Source {
  title: string;
  author?: string;
  year?: number;
  kind: 'certification' | 'guide' | 'journal' | 'coach';
  /** Set when parts of the source lean on outside bodies the coach excluded (e.g. NSCA, ACSM): only CF-voiced points are used. */
  caution?: string;
}
