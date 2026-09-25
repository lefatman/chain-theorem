/**
 * Masquerade Mask (R-LOAD-002, D-31; PLAYTEST). The opponent sees one chosen element for all of the
 * wearer's pieces until the wearer's true element becomes observable (DD-26, extended by DD-44).
 * The mask drops, and the item is revealed, on the first of:
 * - a silence event involving one of the wearer's pieces, in either direction (DD-26);
 * - a square ignited by the wearer's piece while the shown element is not Ember (Hot Foot);
 * - an activation the opponent can name whose attuned flag differs from what the shown element
 *   predicts (attuned but off the shown element by the bearer's own element, or not attuned although
 *   the ability's affinity is the shown element); an attunement granted by an Attunement Charm is
 *   explained by the charm and keeps the mask;
 * - a charge spent, on an ability the opponent can name, by a piece that started as Grove while the
 *   shown element is not Grove (Overabundance shows in the public remaining count);
 * - a Tide piece moving through its own pieces, or giving check through them, while the shown
 *   element is not Tide (Flow).
 *
 * M7 7.3 extends the list to the Storm, Stone and Frost traits (6.1), both when the true trait shows
 * and when a shown trait visibly fails to act:
 * - Bulwark (Stone): an effect capture of the wearer's piece fizzles with `bulwark` while the shown
 *   element is not Stone; or, shown Stone, an effect capture removes a wearer's piece whose Bulwark
 *   was never spent (the spent list is public);
 * - Stillness (Frost): an opponent's After-capturing ability is negated by Stillness while the shown
 *   element is not Frost; or, shown Frost, an opponent's After-capturing ability triggers for a
 *   capture of the wearer's piece;
 * - Always First (Storm): the wearer's captor's After-capturing abilities resolve before the victim's
 *   When-captured ones while the shown element is not Storm; or, shown Storm, they resolve after
 *   those of a non-Storm victim. The order is public even for unnamed (Veiled) activations.
 */
import { defineItem } from '@chain-theorem/rules/sdk';
import type { BattleEvent, ElementId, PieceId, PieceType, Side } from '@chain-theorem/rules';
import type { MutCtx, PieceView } from '@chain-theorem/rules/sdk';

/** The move capture whose reactions are resolving: who triggered first (Always First, 6.1). */
export interface MaskCapture {
  captor: PieceId;
  victim: PieceId;
  seen: 'none' | 'captor' | 'victim';
}

export interface MaskState {
  active: Record<Side, boolean>;
  /**
   * An activation whose name is not yet known to the opponent: its attuned flag becomes observable
   * only if the activation reveal that follows it is not hidden (Veil). Cleared by the next event.
   */
  pending: { side: Side; pieceType: PieceType; ability: string; odd: boolean } | null;
  /** The current move capture (reset when the turn passes, so it never enters the repetition hash). */
  cap: MaskCapture | null;
}
const ID = 'masquerade_mask';

/** Squares strictly between a and b on a rank, file or diagonal; null when not aligned. */
function between(a: number, b: number): number[] | null {
  const df = (b & 7) - (a & 7);
  const dr = (b >> 3) - (a >> 3);
  if (!(df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr))) return null;
  const steps = Math.max(Math.abs(df), Math.abs(dr));
  const out: number[] = [];
  for (let i = 1; i < steps; i++) out.push(a + Math.sign(dr) * 8 * i + Math.sign(df) * i);
  return out;
}

/** Does `piece` (a slider or pawn double push) travel or attack along `path` through its own side? */
function throughOwn(ctx: MutCtx, piece: PieceView, path: number[]): boolean {
  let own = false;
  for (const sq of path) {
    const occ = ctx.pieceAt(sq);
    if (!occ) continue;
    if (occ.side !== piece.side) return false;
    own = true;
  }
  return own;
}

function slides(type: PieceView['type'], a: number, b: number): boolean {
  const orth = (a & 7) === (b & 7) || a >> 3 === b >> 3;
  if (type === 'queen') return true;
  if (type === 'rook') return orth;
  if (type === 'bishop') return !orth;
  return false;
}

/** Does this activation's attuned flag contradict the shown element (DD-44)? */
function oddAttunement(
  ctx: MutCtx,
  shown: ElementId,
  ev: Extract<BattleEvent, { k: 'AbilityTriggered' }>,
): boolean {
  const def = ctx.registry.abilities.find((a) => a.id === ev.ability);
  if (!def || !def.attuned || def.affinity === 'neutral') return false;
  const predicted = def.affinity === shown;
  if (ev.attuned === predicted) return false;
  // Attuned off the shown element: odd only when the bearer's own element did it, not a charm.
  return !ev.attuned || ctx.piece(ev.piece).element === def.affinity;
}

/** Is `ability` on `side`'s `pieceType` already known to the opponent? */
function named(ctx: MutCtx, side: Side, pieceType: PieceType, ability: string): boolean {
  return ctx.state.reveals[side].abilities[pieceType]?.includes(ability) ?? false;
}

function exposes(ctx: MutCtx, owner: Side, shown: ElementId, ev: BattleEvent): boolean {
  switch (ev.k) {
    case 'AbilitySilenced':
      return ev.side === owner || ctx.piece(ev.by).side === owner;
    case 'SquareIgnited':
      return ev.side === owner && shown !== 'ember';
    case 'AbilityTriggered':
      return ev.side === owner && oddAttunement(ctx, shown, ev);
    case 'ChargeSpent': {
      // The remaining count is public only for an ability the opponent can name.
      if (ev.side !== owner || shown === 'grove') return false;
      if (ev.ability === null || !named(ctx, owner, ev.pieceType, ev.ability)) return false;
      const over = ctx.state.slices.overabundance as { grove?: number[] } | undefined;
      return over?.grove?.includes(ev.piece) ?? false;
    }
    case 'MoveMade': {
      if (ev.side !== owner || shown === 'tide' || ev.castle) return false;
      const piece = ctx.piece(ev.piece);
      if (piece.element !== 'tide') return false;
      const path = between(ev.from, ev.to);
      return path !== null && path.length > 0 && throughOwn(ctx, piece, path);
    }
    case 'EffectFizzled':
      // Bulwark (Stone) answered an effect capture of the wearer's piece.
      return (
        ev.reason === 'bulwark' &&
        ev.target !== undefined &&
        ctx.piece(ev.target).side === owner &&
        shown !== 'stone'
      );
    case 'Captured':
      // Shown Stone, but an effect capture removed a piece whose Bulwark was never spent.
      return (
        ev.by === 'effect' &&
        ev.victimSide === owner &&
        shown === 'stone' &&
        ctx.piece(ev.victim).element !== 'stone'
      );
    case 'AbilityNegated':
      // Stillness (Frost) negated the opponent's After-capturing ability on a wearer's victim.
      return (
        ev.side !== owner &&
        ev.source.kind === 'trait' &&
        ev.source.id === 'stillness' &&
        shown !== 'frost'
      );
    case 'Check': {
      if (ev.side === owner || shown === 'tide') return false;
      for (const p of ctx.pieces(owner)) {
        if (p.element !== 'tide' || !slides(p.type, p.square, ev.square)) continue;
        const path = between(p.square, ev.square);
        if (path && throughOwn(ctx, p, path)) return true;
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * Track the move capture whose reactions are resolving and report an Always First (Storm) or
 * Stillness (Frost) observation the shown element cannot explain (M7 7.3).
 */
function captureOrder(
  ctx: MutCtx,
  owner: Side,
  shown: ElementId,
  cap: MaskCapture | null,
  ev: BattleEvent,
): { cap: MaskCapture | null; observed: boolean } {
  if (ev.k === 'TurnPassed') return { cap: null, observed: false };
  if (ev.k === 'Captured' && ev.by === 'move' && ev.captor !== null)
    return { cap: { captor: ev.captor, victim: ev.victim, seen: 'none' }, observed: false };
  if (ev.k !== 'AbilityTriggered' || !cap) return { cap, observed: false };
  const captor = ctx.piece(cap.captor);
  const victim = ctx.piece(cap.victim);
  let observed = false;
  let seen = cap.seen;
  if (ev.piece === cap.victim && ev.category === 'CAPTURED') {
    // The wearer's captor resolved first: only Always First does that.
    if (seen === 'captor' && captor.side === owner && shown !== 'storm') observed = true;
    if (seen === 'none') seen = 'victim';
  } else if (ev.piece === cap.captor && ev.category === 'CAPTURES') {
    // Shown Storm, yet a non-Storm victim's When-captured abilities resolved first.
    if (seen === 'victim' && captor.side === owner && shown === 'storm')
      observed ||= victim.element !== 'storm';
    // Shown Frost, yet the opponent's After-capturing ability was not negated by Stillness.
    if (captor.side !== owner && victim.side === owner && shown === 'frost')
      observed ||= victim.element !== 'frost';
    if (seen === 'none') seen = 'captor';
  }
  return { cap: seen === cap.seen ? cap : { ...cap, seen }, observed };
}

export default defineItem({
  id: ID,
  name: 'Masquerade Mask',
  version: 4,
  slotCost: 1,
  minLevel: 14,
  param: { element: 'required' },
  hooks: {
    // Private slice (never projected): whether each side's mask is still up.
    stateSlice: {
      id: ID,
      init: (ctx): MaskState => ({
        active: {
          white: ctx.hasItem('white', ID) && ctx.itemParam('white', ID)?.element !== undefined,
          black: ctx.hasItem('black', ID) && ctx.itemParam('black', ID)?.element !== undefined,
        },
        pending: null,
        cap: null,
      }),
    },
    revealFilter: {
      element: (ctx, viewer, piece) => {
        const owner = ctx.owner;
        if (!owner || piece.side !== owner || viewer === owner) return undefined;
        if (!ctx.slice<MaskState>(ID).active[owner]) return undefined;
        return ctx.itemParam(owner, ID)?.element;
      },
    },
    onEvent: (ctx, ev) => {
      const owner = ctx.owner;
      if (!owner) return;
      const s = ctx.slice<MaskState>(ID);
      if (!s.active[owner]) return;
      const shown = ctx.itemParam(owner, ID)?.element;
      if (!shown) return;
      // The order of activations is public even when they are unnamed (Always First, Stillness).
      const order = captureOrder(ctx, owner, shown, s.cap, ev);
      let drop = order.observed;
      let pending: MaskState['pending'] = null;
      const p = s.pending;
      if (
        p &&
        ev.k === 'Revealed' &&
        ev.side === p.side &&
        ev.info.kind === 'ability' &&
        ev.info.pieceType === p.pieceType &&
        ev.info.ability === p.ability
      ) {
        drop ||= p.odd;
      } else if (ev.k === 'AbilityTriggered' && ev.side === owner && ev.ability !== null) {
        // The flag is public only once the opponent can name the ability (8.2, DD-28).
        const odd = exposes(ctx, owner, shown, ev);
        if (named(ctx, owner, ev.pieceType, ev.ability)) drop ||= odd;
        else if (odd) pending = { side: owner, pieceType: ev.pieceType, ability: ev.ability, odd };
      } else {
        drop ||= exposes(ctx, owner, shown, ev);
      }
      if (!drop) {
        if (pending !== p || order.cap !== s.cap)
          ctx.setSlice<MaskState>({ ...s, pending, cap: order.cap });
        return;
      }
      ctx.setSlice<MaskState>({
        active: { ...s.active, [owner]: false },
        pending: null,
        cap: null,
      });
      ctx.revealSelf('observed');
      const els = ctx.state.armies[owner].loadout.elements;
      ctx.reveal(owner, { kind: 'elements', elements: [...els] }, 'observed');
    },
  },
  text: {
    short: 'Show a false element until your true one shows.',
    rules:
      'Your opponent sees an element you choose for your army until your true element becomes observable: the first silence involving one of your pieces, or one of your traits or attuned abilities showing.',
  },
  status: 'PLAYTEST',
});
