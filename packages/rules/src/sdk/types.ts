/**
 * Module SDK types (R-DATA-005, spec 5.6 and 13.5). Abilities, items and traits are plain data plus
 * pure hook functions; the engine interprets them. Nothing here imports content.
 */
import type {
  BattleEvent,
  Category,
  ChoiceOption,
  ChoiceRequest,
  Compass,
  ElementId,
  EventInput,
  FizzleReason,
  FormatId,
  GameState,
  PieceId,
  PieceType,
  RankCmp,
  RevealCause,
  RevealInfo,
  Side,
  SourceRef,
  Square,
} from '../types.ts';

/** `venom`: an effect capture that even Stalwart's protection does not stop (DD-102). */
export type AbilityTag = 'replay' | 'revive' | 'venom';
export type Status = 'COMMITTED' | 'PROVISIONAL' | 'PLAYTEST';
/**
 * The silence rule's scope (6.2, PLAYTEST): ALL_TRIGGERS silences every trigger of the weaker piece,
 * REACTIONS_ONLY spares Capturing abilities, ONCE_PER_ABILITY silences each ability on each piece
 * type once per battle (DD-108), OFF disables the advantage for testing.
 */
export type SilenceScope = 'ALL_TRIGGERS' | 'REACTIONS_ONLY' | 'ONCE_PER_ABILITY' | 'OFF';

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
  /** Most pieces in one twin group, the original included (Schrödinger's Joker, DD-101). */
  TWIN_GROUP_MAX: number;
  /**
   * Trait numbers (6.1; the identities are COMMITTED, these values PLAYTEST: designer brief, plan
   * item B4). The trait modules read them; the simulator and fuzzer override them with `--caps`.
   */
  TRAITS: {
    /** Flow: allied pieces a Tide slider or double push may pass in one move; 0 means no limit. */
    FLOW_PASS_LIMIT: number;
    /** Bulwark: whether Stone pawns get the first-effect-capture fizzle too. */
    BULWARK_PAWNS: boolean;
    /** Overabundance: extra charges per consumable ability on a Grove piece. */
    OVERABUNDANCE: { mode: 'add' | 'multiply'; amount: number };
    /** Hot Foot: opponent turns a square burns after it ignites. */
    HOT_FOOT_TURNS: number;
  };
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
  /** Piece rank (5.1, DD-97) compared with a reference piece's rank. */
  rank?: { cmp: RankCmp; to: 'captor' | 'victim' | 'self' };
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
  | { t: 'mostRecentCaptured'; side: 'friendly' | 'enemy'; type: PieceType }
  /**
   * The owner chooses among captured pieces matching the filter (never a king), in the square
   * order of their starting squares; each option names that square (Necromancer, DD-103).
   */
  | { t: 'chosenCaptured'; filter: PieceFilter };

export type SquareSpec =
  | { s: 'origin' }
  | { s: 'start' }
  | { s: 'chosen'; filter: SquareFilter }
  /** The piece's starting square when empty, otherwise the owner chooses from the filter. */
  | { s: 'startElse'; filter: SquareFilter };

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
  /** No piece on the board matches the filter as an effect-capture target (Quantum Kill). */
  | { noneMatch: PieceFilter }
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
  /**
   * REWIND (5.2, DD-100): the position returns to the start of the previous action (two plies back,
   * or one when this is the battle's first action); charges, reveals and clocks survive. Ends the
   * action: nothing queued after it resolves.
   */
  | { op: 'rewind' }
  /**
   * SPAWN (5.2, DD-101): the bearer gets a twin of its type, element and abilities that waits on the
   * bearer's square until its owner's next turn, then makes its own move after the owner's normal
   * move each turn. Capturing any member of the group removes them all. Fizzles `group_full`.
   */
  | { op: 'spawn' }
  | { op: 'when'; cond: EffectCondition; then: EffectSpec[] }
  | { op: 'atChainEnd'; effects: EffectSpec[] };

/** Trigger conditions (5.6 `conditions`). All must hold for the ability to trigger. */
export type Condition =
  | { victimTypeNot: PieceType }
  | { victimTypeIs: PieceType[] }
  | { captorTypeIs: PieceType[] }
  | { captorTypeNot: PieceType }
  /** Compare the victim's and the captor's ranks (5.1, DD-97): `of cmp to`. */
  | { rank: { of: 'victim' | 'captor'; cmp: RankCmp; to: 'victim' | 'captor' } };

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
  /** Loadout rule 8 (7.4): no set may hold this ability with one of these categories (DD-102). */
  excludes?: { categories: Category[] };
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
  /**
   * Is the ability attuned on this piece (6.3): the piece's element matches the ability's affinity,
   * or an `attunement` hook (Attunement Charm) says so? For passives whose hooks differ when attuned.
   */
  attuned(piece: PieceView, abilityId: string): boolean;
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

/** A mid-action question a hook asks its owner (5.4; Block Path's facing, DD-99). */
export interface HookChoice {
  /** The piece the question is about; the prompt names it as its source and subject. */
  piece: PieceId;
  kind: ChoiceRequest['kind'];
  purpose?: ChoiceRequest['purpose'];
  options: ChoiceOption[];
  /** A declinable prompt gets a leading `decline` option, which is also its default (DD-18). */
  optional: boolean;
}

export interface ChoiceCtx extends MutCtx {
  /**
   * Ask the module's owner. Returns the chosen option, or null when declined or when there is
   * nothing to choose. Suspends the action until the answer arrives (replayed deterministically).
   */
  choose(req: HookChoice): ChoiceOption | null;
  /**
   * Would `side`'s king be safe once `change` (slice writes on a draft) has been applied? Options
   * that would leave a king in check are never offered (INV-03): a Block Path king may not turn
   * its guard away from an attacker.
   */
  kingSafeAfter(side: Side, change: (draft: MutCtx) => void): boolean;
}

/** Restrictions on move captures of one piece (captureFilter, 5.6 and 13.5). */
export interface CaptureRestriction {
  /** Enemy pieces that may not move-capture this piece (Obstinate). */
  attackers?: readonly PieceId[];
  /**
   * Compass directions, as seen from this piece, it cannot be move-captured from: sliders, kings
   * and pawns along the shared line, knights along their long leg (Block Path, DD-99).
   */
  from?: readonly Compass[];
  /** A hard restriction also binds attackers that bypass passive restrictions (DD-102). */
  hard?: true;
}

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

export interface ActionEndInfo {
  /** The acting player. */
  actor: Side;
  /** Every piece movement of the action, in order (including bonus and effect moves). */
  moved: readonly PieceMovedInfo[];
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
    /**
     * What a spectator may see (M7 7.2, R-INFO-005): only facts both players know, such as Hot
     * Foot's burning squares. Omit to keep the slice from spectators (the safe default); it is
     * never derived from `project`.
     */
    spectate?(value: unknown, ctx: ReadCtx): unknown;
    /** Include in the repetition hash (default true). */
    hash?: boolean;
  };
  onBattleStart(ctx: SetupCtx): void;
  moveFilter: {
    passThrough?(ctx: ReadCtx, piece: PieceView): boolean;
    blockedSquares?(ctx: ReadCtx, piece: PieceView): readonly Square[] | null;
    kingMode?(ctx: ReadCtx, king: PieceView): 'stalwart' | undefined;
    /**
     * Restrictions on move captures of `victim` (Obstinate, Block Path); effect captures never
     * consult them. The engine reveals the ability the first time a restriction changes which
     * moves are legal or whether a king is in check (DD-32, DD-99).
     */
    captureFilter?(ctx: ReadCtx, victim: PieceView): CaptureRestriction | null;
    /** `true`: the piece ignores blocked squares and soft capture restrictions (Stalwart, DD-102). */
    bypass?(ctx: ReadCtx, piece: PieceView): boolean;
    /** `true`: this pawn may leap straight over one adjacent ally to the empty square beyond. */
    pawnLeap?(ctx: ReadCtx, pawn: PieceView): boolean;
    /** Redirects per move this slider may make at allied squares (0, 1 or 2; Electric Slide). */
    redirects?(ctx: ReadCtx, slider: PieceView): number;
    /**
     * May this allied piece serve as a corner for a turning `slider` (bishop, rook or queen) of its
     * side? Every ally does unless a hook of its own side answers `false`; a non-corner blocks that
     * slider like any ally. Asked once per ally and slider type when the rules are assembled
     * (Electric Slide: an ally of equal or higher rank than the slider, never the king; the queen
     * turns at rooks and bishops; DD-106, DD-111).
     */
    redirectCorner?(ctx: ReadCtx, ally: PieceView, slider: PieceType): boolean;
  };
  queueOrder(ctx: ReadCtx, queue: QueuedTrigger[]): QueuedTrigger[];
  triggerFilter(ctx: MutCtx, trigger: TriggerInfo): 'allow' | 'silence' | 'negate';
  silenceOverride(ctx: MutCtx, trigger: TriggerInfo): boolean;
  effectIntercept(ctx: MutCtx, effect: EffectInfo): InterceptVerdict;
  onPieceMoved(ctx: MutCtx, info: PieceMovedInfo): void;
  /** After the chain has resolved and before Settle; the only hook that may ask a question. */
  onActionEnd(ctx: ChoiceCtx, info: ActionEndInfo): void;
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
