/**
 * Server information contract (R-INFO-005, INVARIANT; R-SEC-001). A projection contains the whole
 * board, the viewer's own army, and only what has been revealed about the opponent. Events are
 * whitelisted field by field; any opponent ability or item id the viewer has not seen is replaced by
 * null, which is also how Veil keeps names hidden (DD-28).
 *
 * Spectators (M7 7.2, spec 10.4) get a public-only projection: about each army exactly what that
 * army's opponent knows. The owner of an army knows all of it and every `Revealed` event goes to both
 * players, so this is the intersection of the two players' knowledge: the reveal logs, the displayed
 * elements (Masquerade Mask as the opponent sees it), the board and public slices. Nothing only one
 * player saw reaches a spectator: no loadouts or sets, no legal moves, no prompt contents, no
 * choices, no pending burns, and no fizzle, charge or usage counter of an ability the owner's
 * opponent cannot name.
 */
import { opposite } from '../board.ts';
import type { PieceView } from '../sdk/types.ts';
import type {
  BattleEvent,
  BattleResult,
  ChoiceRequest,
  ElementId,
  FormatId,
  GameState,
  Loadout,
  PieceId,
  PieceType,
  RevealLog,
  Side,
  SourceRef,
  Square,
} from '../types.ts';
import type { Host, Runtime } from './runtime.ts';

export interface PublicPiece {
  id: PieceId;
  side: Side;
  type: PieceType;
  /** Displayed element (Masquerade Mask may show a chosen element to the opponent). */
  element: ElementId;
  square: Square;
  start: Square;
  capturedSeq: number;
}

export interface PublicArmy {
  level: number;
  /** Displayed element(s): [A] or [A, B] (group A = pawns/knights/bishops, group B = rooks/queen/king). */
  elements: ElementId[];
  consumedSlots: number;
  /** What the opponent has learned about this army. */
  revealed: RevealLog;
  /** Present only for the viewer's own army. */
  loadout?: Loadout;
  sets?: Record<PieceType, string[]>;
}

export interface PublicState {
  viewer: Side;
  format: FormatId;
  contentVersion: string;
  turn: Side;
  ply: number;
  fullmove: number;
  halfmove: number;
  castling: number;
  ep: Square;
  board: number[];
  pieces: PublicPiece[];
  armies: Record<Side, PublicArmy>;
  usage: Record<string, number>;
  slices: Record<string, unknown>;
  objective: Record<Side, number>;
  inCheck: Side | null;
  result: BattleResult | null;
  eventSeq: number;
  pending: { chooser: Side; request: ChoiceRequest | null } | null;
  /** The viewer's legal moves (UCI) when it is their turn and nothing is pending. */
  legal: string[];
}

export type PublicEvent = BattleEvent;

/** Who a projection is for: one of the players, or a spectator (M7 7.2). */
export type Viewer = Side | 'spectator';

/**
 * A spectator's projection (M7 7.2, R-INFO-005): the same shape as a player's, with both armies as
 * their opponents see them, no loadout or sets on either army, no legal moves, a pending choice
 * without its request, and only the slices whose module declares `spectate`.
 */
export interface SpectatorState extends Omit<PublicState, 'viewer' | 'pending' | 'legal'> {
  viewer: 'spectator';
  pending: { chooser: Side; request: null } | null;
  legal: [];
}

/**
 * The player whose knowledge decides what `viewer` may learn about `owner`'s hidden information: a
 * player knows their own army; a spectator learns about each army only what its opponent knows.
 */
export function knowerOf(owner: Side, viewer: Viewer): Side {
  return viewer === 'spectator' ? opposite(owner) : viewer;
}

class ReadHost implements Host {
  readonly s: GameState;
  constructor(s: GameState) {
    this.s = s;
  }
  lastSquare(id: PieceId): Square {
    return this.s.pieces[id]?.square ?? -1;
  }
}

/**
 * Is `ability` known to `viewer` on `side`'s pieces of `pieceType`? Knowledge is per piece type
 * (8.2: an ability is revealed together with the piece type it was seen on), so a veiled type keeps
 * its names hidden even when the same ability was revealed on another type (DD-28). Without a piece
 * type (a side-wide source such as a passive) any type counts.
 */
export function knownAbility(
  state: GameState,
  side: Side,
  viewer: Viewer,
  ability: string | null,
  pieceType?: PieceType,
): boolean {
  if (ability === null) return true;
  if (side === knowerOf(side, viewer)) return true;
  const log = state.reveals[side];
  if (pieceType !== undefined) return log.abilities[pieceType]?.includes(ability) ?? false;
  for (const list of Object.values(log.abilities)) if (list?.includes(ability)) return true;
  return false;
}

const typeOfPiece = (state: GameState, id: PieceId): PieceType | undefined =>
  state.pieces[id]?.type;

export function knownItem(state: GameState, side: Side, viewer: Viewer, item: string): boolean {
  if (side === knowerOf(side, viewer)) return true;
  const log = state.reveals[side];
  return log.items.includes(item);
}

function displayElement(rt: Runtime, host: Host, viewer: Viewer, piece: PieceView): ElementId {
  const knower = knowerOf(piece.side, viewer);
  if (piece.side === knower) return piece.element;
  for (const e of rt.hook(host.s, 'revealFilter')) {
    const fn = e.hooks.revealFilter?.element;
    if (!fn) continue;
    const shown = fn(rt.ctx(host, e), knower, piece);
    if (shown !== undefined) return shown;
  }
  return piece.element;
}

/** Everything but the viewer-specific parts (own loadout, slices, pending, legal moves). */
function projectBase(
  rt: Runtime,
  host: ReadHost,
  viewer: Viewer,
): Omit<PublicState, 'viewer' | 'slices' | 'pending' | 'legal'> {
  const state = host.s;
  const pieces: PublicPiece[] = state.pieces.map((p) => ({
    id: p.id,
    side: p.side,
    type: p.type,
    element: displayElement(rt, host, viewer, rt.view(host, p.id)),
    square: p.square,
    start: p.start,
    capturedSeq: p.capturedSeq,
  }));
  const armies = {} as Record<Side, PublicArmy>;
  for (const side of ['white', 'black'] as const) {
    const army = state.armies[side];
    const synth = (type: PieceType): PieceView => {
      const el = army.loadout.elements;
      const element =
        (type === 'rook' || type === 'queen' || type === 'king' ? (el[1] ?? el[0]) : el[0]) ??
        'neutral';
      return { id: -1, side, type, element, square: -1, lastSquare: -1, start: -1 };
    };
    const a = displayElement(rt, host, viewer, synth('pawn'));
    const b = displayElement(rt, host, viewer, synth('king'));
    armies[side] = {
      level: army.level,
      elements: a === b ? [a] : [a, b],
      consumedSlots: army.consumedSlots,
      revealed: state.reveals[side],
    };
  }
  const usage: Record<string, number> = {};
  for (const [key, n] of Object.entries(state.usage)) {
    const [pidStr, ability] = key.split(':') as [string, string];
    const p = state.pieces[Number(pidStr)];
    if (!p) continue;
    if (knownAbility(state, p.side, viewer, ability, p.type)) usage[key] = n;
  }
  return {
    format: state.format,
    contentVersion: state.contentVersion,
    turn: state.turn,
    ply: state.ply,
    fullmove: state.fullmove,
    halfmove: state.halfmove,
    castling: state.castling,
    ep: state.ep,
    board: [...state.board],
    pieces,
    armies,
    usage,
    objective: { ...state.objective },
    inCheck: state.inCheck,
    result: state.result,
    eventSeq: state.eventSeq,
  };
}

export function project(rt: Runtime, state: GameState, viewer: Side, legal: string[]): PublicState {
  const host = new ReadHost(state);
  const base = projectBase(rt, host, viewer);
  const own = base.armies[viewer];
  own.loadout = state.armies[viewer].loadout;
  own.sets = state.armies[viewer].sets;
  const slices: Record<string, unknown> = {};
  for (const [id, hooks] of rt.slices) {
    const decl = hooks.stateSlice;
    if (decl?.project) slices[id] = decl.project(state.slices[id], viewer, rt.ctx(host, null));
  }
  return {
    viewer,
    ...base,
    slices,
    pending: state.pending
      ? {
          chooser: state.pending.request.chooser,
          request: state.pending.request.chooser === viewer ? state.pending.request : null,
        }
      : null,
    legal,
  };
}

/**
 * The spectator projection (M7 7.2, R-INFO-005, R-SEC-001): public information only (see the file
 * comment). Deterministic and pure like `project`.
 */
export function projectSpectator(rt: Runtime, state: GameState): SpectatorState {
  const host = new ReadHost(state);
  const base = projectBase(rt, host, 'spectator');
  const slices: Record<string, unknown> = {};
  for (const [id, hooks] of rt.slices) {
    const decl = hooks.stateSlice;
    if (decl?.spectate) slices[id] = decl.spectate(state.slices[id], rt.ctx(host, null));
  }
  return {
    viewer: 'spectator',
    ...base,
    slices,
    pending: state.pending ? { chooser: state.pending.request.chooser, request: null } : null,
    legal: [],
  };
}

function maskSource(
  state: GameState,
  viewer: Viewer,
  src: SourceRef | undefined,
): SourceRef | undefined {
  if (!src) return undefined;
  if (src.kind === 'ability') {
    const type = src.piece >= 0 ? typeOfPiece(state, src.piece) : undefined;
    return knownAbility(state, src.side, viewer, src.id, type) ? src : { kind: 'hidden' };
  }
  if (src.kind === 'item') {
    return knownItem(state, src.side, viewer, src.id) ? src : { kind: 'hidden' };
  }
  return src;
}

/**
 * Project one event for `viewer`, or null when the viewer must not receive it at all. A hidden
 * ability (not revealed for the piece type that carries it, e.g. under Veil) is reduced to an
 * opaque activation marker: no name, category or attuned flag, and its fizzles, charge spending and
 * the owner's choices are not sent, so only board effects remain visible (8.2, DD-28, R-SEC-001).
 * A spectator sees each side's events as that side's opponent does and never sees a choice (M7 7.2).
 */
export function projectEvent(
  rt: Runtime,
  state: GameState,
  ev: BattleEvent,
  viewer: Viewer,
): PublicEvent | null {
  switch (ev.k) {
    case 'AbilityTriggered':
      return knownAbility(state, ev.side, viewer, ev.ability, ev.pieceType)
        ? ev
        : { ...ev, ability: null, category: null, attuned: null };
    case 'AbilitySilenced':
      return knownAbility(state, ev.side, viewer, ev.ability, ev.pieceType)
        ? ev
        : { ...ev, ability: null, category: null };
    case 'AbilityNegated': {
      const known = knownAbility(state, ev.side, viewer, ev.ability, ev.pieceType);
      return {
        ...ev,
        ability: known ? ev.ability : null,
        category: known ? ev.category : null,
        source: maskSource(state, viewer, ev.source) ?? { kind: 'hidden' },
      };
    }
    case 'EffectFizzled': {
      if (!knownAbility(state, ev.side, viewer, ev.ability, ev.pieceType)) return null;
      const out = { ...ev };
      const src = maskSource(state, viewer, ev.source);
      if (src) out.source = src;
      else delete out.source;
      return out;
    }
    case 'ChargeSpent':
      return knownAbility(state, ev.side, viewer, ev.ability, ev.pieceType) ? ev : null;
    case 'ChoiceMade':
      // A choice is the chooser's own business; its board effect follows as its own events.
      return ev.side === viewer ? ev : null;
    case 'Promoted': {
      // Masquerade Mask: the new piece shows its displayed element, not the true one (DD-26).
      if (ev.side === knowerOf(ev.side, viewer)) return ev;
      const view: PieceView = {
        id: ev.piece,
        side: ev.side,
        type: ev.to,
        element: ev.element,
        square: -1,
        lastSquare: -1,
        start: -1,
      };
      return { ...ev, element: displayElement(rt, new ReadHost(state), viewer, view) };
    }
    case 'Captured':
    case 'PieceMoved':
    case 'PieceRevived': {
      if (!ev.source) return ev;
      const src = maskSource(state, viewer, ev.source) ?? { kind: 'hidden' as const };
      return { ...ev, source: src } as PublicEvent;
    }
    case 'Revealed': {
      if (!ev.source) return ev;
      return { ...ev, source: maskSource(state, viewer, ev.source) ?? { kind: 'hidden' } };
    }
    default:
      return ev;
  }
}

export function projectEvents(
  rt: Runtime,
  state: GameState,
  events: readonly BattleEvent[],
  viewer: Viewer,
): PublicEvent[] {
  const out: PublicEvent[] = [];
  for (const e of events) {
    const p = projectEvent(rt, state, e, viewer);
    if (p) out.push(p);
  }
  return out;
}

export { opposite };
