/**
 * Block Path (5.8, PLAYTEST; designer brief 2026-10-06, DD-99; B5 brief 2026-10-11): Passive,
 * neutral, all. The piece faces one of eight compass directions and cannot be move-captured by an
 * attacker standing in that direction: sliders, kings and pawns along the shared line, knights along
 * their long leg. A diagonal is blocked only when that diagonal is chosen. Kings included: a king is
 * not in check from its facing. Effect captures ignore it, and so does nothing else: even Stalwart
 * attackers respect it (a hard restriction, DD-102). The default facing is the owner's forward
 * direction (N for White, S for Black) until the piece moves; after any move of the piece its owner
 * may face it anew through a declinable prompt (declining keeps the old facing). The king is the
 * exception (B5): it always faces forward after it moves and is never asked, so a king is guarded
 * from the front only. A revived piece faces forward again. Costs two ability slots (B5: 73% on its
 * own in Full Battle and part of the Stalwart king set, docs/BALANCE_BASELINE.md sections 5 and 6).
 *
 * Facings are owner-private state until the ability is revealed on that piece type; the engine
 * reveals it the first time a facing changes which moves are legal or whether a king is in check.
 */
import {
  COMPASS,
  compassFrom,
  defineAbility,
  fx,
  stepTowards,
  type ReadCtx,
} from '@chain-theorem/rules/sdk';
import type { Compass, PieceView, Side } from '@chain-theorem/rules';
import { relOrder } from '@chain-theorem/rules';

export interface BlockPathState {
  /** Piece id -> facing; absent means the default (forward). */
  facing: Record<string, Compass>;
}

const ID = 'block_path';
/** Slice id (not the ability id: projections never carry an unrevealed ability's name, R-SEC-001). */
export const FACINGS = 'facings';

export const defaultFacing = (side: Side): Compass => (side === 'white' ? 'N' : 'S');

export function facingOf(state: BlockPathState | undefined, piece: PieceView): Compass {
  return state?.facing[String(piece.id)] ?? defaultFacing(piece.side);
}

const revealed = (ctx: ReadCtx, p: PieceView): boolean =>
  (ctx.state.reveals[p.side].abilities[p.type] ?? []).includes(ID);

function visibleFacings(
  state: BlockPathState,
  ctx: ReadCtx,
  show: (p: PieceView) => boolean,
): BlockPathState {
  const facing: Record<string, Compass> = {};
  for (const p of ctx.pieces()) {
    if (ctx.hasAbility(p, ID) && show(p)) facing[String(p.id)] = facingOf(state, p);
  }
  return { facing };
}

export default defineAbility({
  id: ID,
  name: 'Block Path',
  version: 2,
  category: 'PASSIVE',
  affinity: 'neutral',
  eligible: 'all',
  tags: [],
  minLevel: 12,
  slotCost: 2,
  limits: { perAction: 1 },
  effects: [fx.modifyRule(ID)],
  hooks: {
    stateSlice: {
      id: FACINGS,
      init: (): BlockPathState => ({ facing: {} }),
      // A facing is the owner's secret until Block Path is revealed on that piece type (8.2). The
      // projection lists every visible Block Path piece with its facing, defaults included, so a
      // client draws the arrows without knowing the rule.
      project: (value, viewer, ctx) =>
        visibleFacings(value as BlockPathState, ctx, (p) => p.side === viewer || revealed(ctx, p)),
      spectate: (value, ctx) =>
        visibleFacings(value as BlockPathState, ctx, (p) => revealed(ctx, p)),
    },
    moveFilter: {
      captureFilter: (ctx, victim) => {
        if (victim.side !== ctx.owner || !ctx.hasAbility(victim, ID)) return null;
        return { from: [facingOf(ctx.slice<BlockPathState>(FACINGS), victim)], hard: true };
      },
    },
    onActionEnd: (ctx, info) => {
      const owner = ctx.owner;
      if (owner === null) return;
      const asked = new Set<number>();
      for (const m of info.moved) {
        if (m.cause === 'revive' || m.piece.side !== owner || asked.has(m.piece.id)) continue;
        asked.add(m.piece.id);
        const piece = ctx.piece(m.piece.id);
        if (piece.square < 0 || !ctx.hasAbility(piece, ID)) continue;
        const state = ctx.slice<BlockPathState>(FACINGS);
        const key = String(piece.id);
        if (piece.type === 'king') {
          // A king always faces forward after it moves (B5): no prompt. A facing the king still
          // carries (a battle saved before this version) is cleared, and the reset is reported
          // only when the facing actually changes.
          if (!(key in state.facing)) continue;
          const { [key]: before, ...facing } = state.facing;
          ctx.setSlice<BlockPathState>({ facing });
          const forward = defaultFacing(owner);
          if (before === forward) continue;
          ctx.emit({
            k: 'FacingSet',
            piece: piece.id,
            side: owner,
            square: piece.square,
            facing: forward,
            source: { kind: 'ability', id: ID, piece: piece.id, side: owner },
          });
          continue;
        }
        const current = facingOf(state, piece);
        // Each option is the adjacent square in a direction (5.4 square order from the owner's side).
        const options = COMPASS.filter((c) => c !== current)
          .map((c) => stepTowards(piece.square, c))
          .filter((sq) => sq >= 0)
          .sort((a, b) => relOrder(owner, a) - relOrder(owner, b))
          .map((sq) => ({ kind: 'square' as const, square: sq }));
        const answer = ctx.choose({
          piece: piece.id,
          kind: 'square',
          purpose: 'facing',
          options,
          optional: true,
        });
        if (!answer || answer.kind !== 'square') continue;
        const facing = compassFrom(piece.square, answer.square);
        if (!facing) continue;
        const s = ctx.slice<BlockPathState>(FACINGS);
        ctx.setSlice<BlockPathState>({ facing: { ...s.facing, [key]: facing } });
        ctx.emit({
          k: 'FacingSet',
          piece: piece.id,
          side: owner,
          square: piece.square,
          facing,
          source: { kind: 'ability', id: ID, piece: piece.id, side: owner },
        });
      }
    },
    onEvent: (ctx, ev) => {
      // A captured piece loses its facing; a revived one starts forward again.
      const id = ev.k === 'Captured' ? ev.victim : ev.k === 'PieceRevived' ? ev.piece : -1;
      if (id < 0) return;
      const s = ctx.slice<BlockPathState>(FACINGS);
      if (!(String(id) in s.facing)) return;
      const { [String(id)]: _gone, ...facing } = s.facing;
      ctx.setSlice<BlockPathState>({ facing });
    },
  },
  text: {
    short: 'Faces one way; nothing takes it from there.',
    rules:
      'This piece faces one of eight directions (forward by default). It cannot be captured by a move from a piece standing in that direction: along the line for sliders, kings and pawns, along the long leg for knights. A king is not in check from its facing. After this piece moves you may turn it to face a new direction; the king always faces forward after it moves. Effect captures ignore the facing.',
  },
  status: 'PLAYTEST',
});
