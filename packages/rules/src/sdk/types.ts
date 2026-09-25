/**
 * Module SDK types (R-DATA-005, spec 5.6 and 13.5). Abilities, items and traits are plain data plus
 * pure hook functions; the engine interprets them. Nothing here imports content.
 */
import type {
  BattleEvent,
  Category,
  ElementId,
  EventInput,
  FizzleReason,
  FormatId,
  GameState,
  PieceId,
  PieceType,
  RevealCause,
  RevealInfo,
  Side,
  SourceRef,
  Square,
} from '../types.ts';

export type AbilityTag = 'replay' | 'revive';
export type Status = 'COMMITTED' | 'PROVISIONAL' | 'PLAYTEST';
export type SilenceScope = 'ALL_TRIGGERS' | 'REACTIONS_ONLY' | 'OFF';

// ---- caps (values live in packages/content/config.ts) --------------------------------------------

export interface FormatDef {
  id: FormatId;
  name: string;
  /** First side to make this many qualifying (non-pawn) captures wins; null = standard win only. */
  objective: { nonPawnCaptures: number } | null;
  clock: { initialMs: number; incrementMs: number };
}

export interface Caps {
  LEVEL_CAP: number;
  itemSlots: (level: number) => number;
  MAX_ITEM_SLOTS: number;
  BASE_ABILITY_CAPACITY: number;
  MAX_ABILITY_CAPACITY: number;
  MAX_CHAIN_DEPTH: number;
  SILENCE_SCOPE: SilenceScope;
  /** Elements a real loadout may use (MVP: Ember, Tide, Grove; M7 adds Storm, Stone, Frost). */
  ENABLED_ELEMENTS: readonly ElementId[];
  FORMATS: Readonly<Record<FormatId, FormatDef>>;
  /** Termination guard: an action emitting more events than this is an engine bug. */
  MAX_EVENTS_PER_ACTION: number;
}

// ---- effect data (5.2) ----------------------------------------------------------------------------

/**
 * Where a distance is measured from; captured pieces use their last known square (5.4). 'origin' is
 * the square the captor moved from in this capture and 'landing' the square it captured on.
 */
export type Anchor = 'self' | 'captor' | 'victim' | 'origin' | 'landing';
export type Pattern = 'adjacent' | 'diagonal' | 'orthogonal';

export interface PieceFilter {
  /** Relative to the ability owner. */
  side: 'enemy' | 'friendly' | 'any';
  types?: PieceType[];
  near?: { of: Anchor; pattern: Pattern };
  exclude?: ('captor' | 'victim' | 'self')[];
}

export interface SquareFilter {
  empty: true;
  near?: { of: Anchor; pattern: Pattern };
  /** The owner's back rank. */
  backRank?: true;
  /** Always offer these squares too (if empty). */
  include?: ('origin' | 'start')[];
}

export type TargetSpec =
  | { t: 'self' }
  | { t: 'captor' }
  | { t: 'victim' }
  | { t: 'chosen'; filter: PieceFilter }
  | { t: 'mostRecentCaptured'; side: 'friendly' | 'enemy'; type: PieceType };

export type SquareSpec = { s: 'origin' } | { s: 'start' } | { s: 'chosen'; filter: SquareFilter };

export interface BonusSpec {
  /** Who may make the bonus move. */
  movers: 'self' | 'selfOrFriendlyPawn' | 'anyFriendly';
  /** 'none' = one non-capturing move; 'captor' = a move that captures the captor. */
  capture: 'none' | 'captor';
  /** Bonus actions may be declined (DD-18). */
  optional: boolean;
}

export type RevealSpec =
  | { what: 'typeSet'; of: 'victim' | 'captor' | 'self' }
  | { what: 'highestCostItem' }
  | { what: 'items' };

export type EffectCondition =
  | { survives: 'captor' | 'victim' | 'self' }
  | { noLegalCapturerOf: 'captor' }
  | { typeIs: { of: 'captor' | 'victim' | 'self'; types: PieceType[] } }
  | { not: EffectCondition }
  | { all: EffectCondition[] };

export type EffectSpec =
  | { op: 'effectCapture'; target: TargetSpec }
  | { op: 'negate'; of: 'victim' | 'captor'; categories: Category[] }
  | { op: 'protect'; target: TargetSpec; against: 'effectCapture'; count: number | 'all' }
  | { op: 'move'; piece: TargetSpec; to: SquareSpec }
  | { op: 'revive'; piece: TargetSpec; to: SquareSpec }
  | { op: 'bonusAction'; bonus: BonusSpec }
  | { op: 'reveal'; reveal: RevealSpec }
  | { op: 'modifyRule'; rule: string; params?: Record<string, string | number | boolean> }
  | { op: 'when'; cond: EffectCondition; then: EffectSpec[] }
  | { op: 'atChainEnd'; effects: EffectSpec[] };

/** Trigger conditions (5.6 `conditions`). All must hold for the ability to trigger. */
export type Condition =
  | { victimTypeNot: PieceType }
  | { victimTypeIs: PieceType[] }
  | { captorTypeIs: PieceType[] }
  | { captorTypeNot: PieceType };

// ---- module definitions ---------------------------------------------------------------------------

export interface ModuleText {
  short: string;
  rules: string;
}

export interface AbilityDef {
  id: string;
  name: string;
  version: number;
  category: Category;
  affinity: ElementId;
  eligible: PieceType[] | 'all';
  tags: AbilityTag[];
  minLevel: number;
  slotCost: number;
  limits: { perAction: 1; charges?: number };
  conditions?: Condition[];
  effects: EffectSpec[];
  attuned?: { effects: EffectSpec[]; mode: 'replace' | 'append'; conditions?: Condition[] };
  /** PASSIVE abilities change rules through hooks (MODIFY_RULE, DD-14). */
  hooks?: Partial<RuleHooks>;
  text: ModuleText;
  status: Status;
  retired?: boolean;
}

export interface ItemDef {
  id: string;
  name: string;
  version: number;
  slotCost: 1 | 2 | 3 | 4;
  minLevel: number;
  capacity?: 2 | 3 | 4 | 5;
  exclusiveGroup?: string;
  grants?: { perTypeSets?: true; secondElement?: true };
  param?: { element: 'required' };
  hooks: Partial<RuleHooks>;
  text: ModuleText;
  status: Status;
  retired?: boolean;
}

export interface TraitDef {
  id: string;
  name: string;
  element: ElementId;
  version: number;
  hooks: Partial<RuleHooks>;
  text: ModuleText;
  status: Status;
}

export interface ContentRegistry {
  abilities: readonly AbilityDef[];
  items: readonly ItemDef[];
  traits: readonly TraitDef[];
  version: string;
}

// ---- hook contexts --------------------------------------------------------------------------------

export interface PieceView {
  id: PieceId;
  side: Side;
  type: PieceType;
  element: ElementId;
  /** -1 when captured. */
  square: Square;
  /** Last known square (== square while on the board). */
  lastSquare: Square;
  start: Square;
}

export interface ReadCtx {
  readonly state: Readonly<GameState>;
  readonly caps: Caps;
  readonly registry: ContentRegistry;
  /** The side that equips this item or ability; null for traits and engine rules. */
  readonly owner: Side | null;
  piece(id: PieceId): PieceView;
  pieceAt(square: Square): PieceView | null;
  /** Pieces on the board, optionally filtered by side. */
  pieces(side?: Side): PieceView[];
  /** Read a state slice (default: this module's own slice). */
  slice<T>(id?: string): T;
  /** Ability ids in the piece's current set, in order (ineligible ones included). */
  abilitiesOf(piece: PieceView): readonly string[];
  hasAbility(piece: PieceView, abilityId: string): boolean;
  hasItem(side: Side, itemId: string): boolean;
  itemParam(side: Side, itemId: string): { element?: ElementId } | undefined;
}

export interface MutCtx extends ReadCtx {
  setSlice<T>(value: T, id?: string): void;
  emit(event: EventInput): void;
  reveal(side: Side, info: RevealInfo, cause: RevealCause, source?: SourceRef): void;
  /** Reveal the module this hook belongs to (item or ability) to the opponent of its owner. */
  revealSelf(cause?: RevealCause): void;
}

export type SetupCtx = MutCtx;

export interface CaptureInfo {
  /** Capture id (captureSeq value of the victim's capture). */
  id: number;
  captor: PieceView;
  victim: PieceView;
  from: Square;
  to: Square;
  depth: number;
}

export interface TriggerInfo {
  piece: PieceView;
  side: Side;
  ability: AbilityDef;
  category: Category;
  capture: CaptureInfo;
  /** Element of the bearer and of the other piece at the moment the trigger is evaluated. */
  element: ElementId;
  otherElement: ElementId;
}

export interface QueuedTrigger {
  piece: PieceId;
  side: Side;
  ability: string;
  category: Category;
  element: ElementId;
  seq: number;
}

export interface EffectInfo {
  kind: 'effectCapture' | 'move' | 'revive';
  target: PieceView;
  to?: Square;
  source: SourceRef;
  /** Side owning the effect's source. */
  sourceSide: Side;
  /** The acting player (whose action this is). */
  actor: Side;
}

export interface PieceMovedInfo {
  piece: PieceView;
  from: Square;
  to: Square;
  cause: 'move' | 'castle' | 'bonus' | 'effect' | 'revive';
  /** True when the piece landed by making a move capture. */
  capture: boolean;
  depth: number;
}

export interface RevealRequest {
  side: Side;
  info: RevealInfo;
  cause: RevealCause;
  piece?: PieceView;
}

export type InterceptVerdict = 'allow' | { fizzle: FizzleReason };

export interface RuleHooks {
  /** Lower runs first within a module class; ties by id. */
  priority: number;
  stateSlice: {
    id: string;
    init(ctx: ReadCtx): unknown;
    /** What a viewer may see; omit to keep the slice private (never projected). */
    project?(value: unknown, viewer: Side, ctx: ReadCtx): unknown;
    /** Include in the repetition hash (default true). */
    hash?: boolean;
  };
  onBattleStart(ctx: SetupCtx): void;
  moveFilter: {
    passThrough?(ctx: ReadCtx, piece: PieceView): boolean;
    blockedSquares?(ctx: ReadCtx, piece: PieceView): readonly Square[] | null;
    kingMode?(ctx: ReadCtx, king: PieceView): 'stalwart' | undefined;
  };
  queueOrder(ctx: ReadCtx, queue: QueuedTrigger[]): QueuedTrigger[];
  triggerFilter(ctx: MutCtx, trigger: TriggerInfo): 'allow' | 'silence' | 'negate';
  silenceOverride(ctx: MutCtx, trigger: TriggerInfo): boolean;
  effectIntercept(ctx: MutCtx, effect: EffectInfo): InterceptVerdict;
  onPieceMoved(ctx: MutCtx, info: PieceMovedInfo): void;
  onTurnEnd(ctx: MutCtx, info: { side: Side }): void;
  revealFilter: {
    reveal?(ctx: ReadCtx, request: RevealRequest): 'allow' | 'hide';
    element?(ctx: ReadCtx, viewer: Side, piece: PieceView): ElementId | undefined;
  };
  modifyCharges(ctx: ReadCtx, piece: PieceView, ability: AbilityDef, charges: number): number;
  attunement(ctx: ReadCtx, piece: PieceView, ability: AbilityDef): boolean;
  onEvent(ctx: MutCtx, event: BattleEvent): void;
}

export type HookName = Exclude<keyof RuleHooks, 'priority'>;
