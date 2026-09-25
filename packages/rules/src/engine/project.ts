/**
 * Server information contract (R-INFO-005, INVARIANT; R-SEC-001). A projection contains the whole
 * board, the viewer's own army, and only what has been revealed about the opponent. Events are
 * whitelisted field by field; any opponent ability or item id the viewer has not seen is replaced by
 * null, which is also how Veil keeps names hidden (DD-28).
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

class ReadHost implements Host {
  readonly s: GameState;
  constructor(s: GameState) {
    this.s = s;
  }
  lastSquare(id: PieceId): Square {
    return this.s.pieces[id]?.square ?? -1;
  }
}

export function knownAbility(
  state: GameState,
  side: Side,
  viewer: Side,
  ability: string | null,
): boolean {
  if (ability === null) return true;
  if (side === viewer) return true;
  const log = state.reveals[side];
  for (const list of Object.values(log.abilities)) if (list?.includes(ability)) return true;
  return false;
}

export function knownItem(state: GameState, side: Side, viewer: Side, item: string): boolean {
  if (side === viewer) return true;
  const log = state.reveals[side];
  return log.items.includes(item);
}

function displayElement(rt: Runtime, host: Host, viewer: Side, piece: PieceView): ElementId {
  if (piece.side === viewer) return piece.element;
  for (const e of rt.hook(host.s, 'revealFilter')) {
    const fn = e.hooks.revealFilter?.element;
    if (!fn) continue;
    const shown = fn(rt.ctx(host, e), viewer, piece);
    if (shown !== undefined) return shown;
  }
  return piece.element;
}

export function project(rt: Runtime, state: GameState, viewer: Side, legal: string[]): PublicState {
  const host = new ReadHost(state);
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
    const pub: PublicArmy = {
      level: army.level,
      elements: a === b ? [a] : [a, b],
      consumedSlots: army.consumedSlots,
      revealed: state.reveals[side],
    };
    if (side === viewer) {
      pub.loadout = army.loadout;
      pub.sets = army.sets;
    }
    armies[side] = pub;
  }
  const usage: Record<string, number> = {};
  for (const [key, n] of Object.entries(state.usage)) {
    const [pidStr, ability] = key.split(':') as [string, string];
    const p = state.pieces[Number(pidStr)];
    if (!p) continue;
    if (knownAbility(state, p.side, viewer, ability)) usage[key] = n;
  }
  const slices: Record<string, unknown> = {};
  for (const [id, hooks] of rt.slices) {
    const decl = hooks.stateSlice;
    if (decl?.project) slices[id] = decl.project(state.slices[id], viewer, rt.ctx(host, null));
  }
  return {
    viewer,
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
    slices,
    objective: { ...state.objective },
    inCheck: state.inCheck,
    result: state.result,
    eventSeq: state.eventSeq,
    pending: state.pending
      ? {
          chooser: state.pending.request.chooser,
          request: state.pending.request.chooser === viewer ? state.pending.request : null,
        }
      : null,
    legal,
  };
}

function maskSource(
  state: GameState,
  viewer: Side,
  src: SourceRef | undefined,
): SourceRef | undefined {
  if (!src) return undefined;
  if (src.kind === 'ability') {
    return knownAbility(state, src.side, viewer, src.id) ? src : { kind: 'hidden' };
  }
  if (src.kind === 'item') {
    return knownItem(state, src.side, viewer, src.id) ? src : { kind: 'hidden' };
  }
  return src;
}

/** Project one event for `viewer` (whitelist; unknown opponent ids become null or 'hidden'). */
export function projectEvent(state: GameState, ev: BattleEvent, viewer: Side): PublicEvent {
  switch (ev.k) {
    case 'AbilityTriggered':
    case 'AbilitySilenced':
      return knownAbility(state, ev.side, viewer, ev.ability) ? ev : { ...ev, ability: null };
    case 'AbilityNegated': {
      const ability = knownAbility(state, ev.side, viewer, ev.ability) ? ev.ability : null;
      return { ...ev, ability, source: maskSource(state, viewer, ev.source) ?? { kind: 'hidden' } };
    }
    case 'EffectFizzled': {
      const known = knownAbility(state, ev.side, viewer, ev.ability);
      const out = { ...ev, ability: known ? ev.ability : null };
      const src = maskSource(state, viewer, ev.source);
      if (src) out.source = src;
      else delete out.source;
      return out;
    }
    case 'ChargeSpent':
      return knownAbility(state, ev.side, viewer, ev.ability)
        ? ev
        : { ...ev, ability: null, remaining: -1 };
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
  state: GameState,
  events: readonly BattleEvent[],
  viewer: Side,
): PublicEvent[] {
  return events.map((e) => projectEvent(state, e, viewer));
}

export { opposite };
