/**
 * Scenario Lab frame reducer: rebuild the board after every single event of a reaction chain by
 * replaying the events forward on a copy of the previous PublicState (11.2, "every reaction chain is
 * replayable step by step"). The engine only hands out states between actions (and at prompts), so
 * the lab derives the in-between boards here and checks itself against the engine's own projection
 * at every point the engine can be observed (see `frameDrift`).
 *
 * Covered: MoveMade (castling rook included), Captured, PieceMoved, PieceRevived, Promoted,
 * SquareIgnited / SquareExtinguished plus the Hot Foot countdown on TurnPassed and pending burns
 * after an Ember move capture (R-ELEM-005), Check, TurnPassed, BattleEnded, Revealed (reveal logs,
 * so pips appear as abilities are revealed) and ChargeSpent (usage counters).
 */
import {
  elementFor,
  opposite,
  type BattleEvent,
  type ElementId,
  type PieceType,
  type PublicPiece,
  type PublicState,
  type RevealLog,
  type Side,
} from '@chain-theorem/rules';

/** Hot Foot's public slice (packages/content/traits/hot_foot.ts). */
const HOT_FOOT = 'hot_foot';

interface Burn {
  sq: number;
  side: Side;
  turns: number;
}
interface PendingBurn {
  piece: number;
  sq: number;
}
interface HotFootView {
  burning: Burn[];
  pending: PendingBurn[];
}

export interface ReduceContext {
  /**
   * True element of a piece. The lab may read the full GameState; Hot Foot's pending burn depends on
   * the true element, which a Masquerade Mask can hide from the displayed one.
   */
  trueElement?(piece: number): ElementId | undefined;
  /** True loadout elements of a side ([A] or [A, B]), for the element a promoted piece takes. */
  trueElements?(side: Side): readonly ElementId[] | undefined;
  /**
   * The full usage counters right after the event (charges spent per `${piece}:${ability}`). With it
   * the frame shows exactly the counters the viewer may see, as project() does: own abilities and
   * revealed opponent abilities, including counters spent before the ability was revealed. Without
   * it, counters only grow from ChargeSpent events of abilities the viewer knows.
   */
  trueUsage?: Readonly<Record<string, number>>;
}

function readHotFoot(slices: Record<string, unknown>): HotFootView | null {
  const hf = slices[HOT_FOOT] as Partial<HotFootView> | undefined;
  if (!hf || !Array.isArray(hf.burning)) return null;
  return { burning: [...hf.burning], pending: Array.isArray(hf.pending) ? [...hf.pending] : [] };
}

function addUnique<T>(list: readonly T[], items: readonly T[]): T[] {
  return [...list, ...items.filter((x) => !list.includes(x))];
}

/** Mirror of the engine's reveal-log update (rules engine/host.ts `reveal`, R-INFO-002). */
function applyReveal(log: RevealLog, info: Extract<BattleEvent, { k: 'Revealed' }>['info']) {
  switch (info.kind) {
    case 'ability': {
      const list = log.abilities[info.pieceType] ?? [];
      if (list.includes(info.ability)) return log;
      return { ...log, abilities: { ...log.abilities, [info.pieceType]: [...list, info.ability] } };
    }
    case 'set': {
      const list = log.abilities[info.pieceType] ?? [];
      return {
        ...log,
        abilities: { ...log.abilities, [info.pieceType]: addUnique(list, info.abilities) },
        complete: addUnique(log.complete, [info.pieceType]),
      };
    }
    case 'item':
      return { ...log, items: addUnique(log.items, [info.item]) };
    case 'items':
      return { ...log, items: addUnique(log.items, info.items), allItems: true };
    case 'veiled':
      return { ...log, veiled: addUnique(log.veiled, [info.pieceType]) };
    case 'elements':
      return log;
  }
}

function knows(
  viewer: Side,
  armies: PublicState['armies'],
  side: Side,
  type: PieceType,
  ability: string,
): boolean {
  if (side === viewer) return true;
  return armies[side].revealed.abilities[type]?.includes(ability) ?? false;
}

/** The counters project() shows `viewer` (rules engine/project.ts, per-piece-type knowledge). */
function visibleUsage(
  trueUsage: Readonly<Record<string, number>>,
  pieces: readonly PublicPiece[],
  viewer: Side,
  armies: PublicState['armies'],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, n] of Object.entries(trueUsage)) {
    const [id, ability] = key.split(':') as [string, string];
    const p = pieces[Number(id)];
    if (p && knows(viewer, armies, p.side, p.type, ability)) out[key] = n;
  }
  return out;
}

/**
 * The public state right after `ev`. Pure: `pub` is not mutated. Legal moves and the pending prompt
 * are cleared (an in-between frame is never playable) and `eventSeq` becomes `ev.i + 1`, so the
 * board scene can tell frames apart and animate one step from the previous frame.
 */
export function applyEventToPublic(
  pub: PublicState,
  ev: BattleEvent,
  ctx: ReduceContext = {},
): PublicState {
  const board = pub.board.slice();
  const pieces: PublicPiece[] = pub.pieces.map((p) => ({ ...p }));
  let hf = readHotFoot(pub.slices);
  let hfChanged = false;
  let { turn, ply, inCheck, result, usage, armies } = pub;

  const lift = (id: number) => {
    const p = pieces[id];
    if (!p) return null;
    if (p.square >= 0 && board[p.square] === id) board[p.square] = -1;
    return p;
  };
  const put = (id: number, to: number) => {
    const p = lift(id);
    if (!p) return;
    const other = board[to] ?? -1;
    // A square holds one piece: anything still there was removed by an unlogged side effect.
    if (other >= 0 && other !== id) {
      const o = pieces[other];
      if (o) o.square = -1;
    }
    board[to] = id;
    p.square = to;
  };
  const clearPending = (keep: (b: PendingBurn) => boolean) => {
    if (!hf) return;
    const next = hf.pending.filter(keep);
    if (next.length !== hf.pending.length) {
      hf = { ...hf, pending: next };
      hfChanged = true;
    }
  };

  switch (ev.k) {
    case 'ActionStarted':
      turn = ev.side;
      break;
    case 'MoveMade': {
      put(ev.piece, ev.to);
      if (ev.castle) {
        // Castling is the king's two-square move; the rook has no event of its own.
        const rookFrom = ev.castle === 'K' ? ev.from + 3 : ev.from - 4;
        const rookTo = ev.castle === 'K' ? ev.from + 1 : ev.from - 1;
        const rook = board[rookFrom] ?? -1;
        if (rook >= 0) put(rook, rookTo);
      }
      // Hot Foot: the element after promotion decides whether a capture leaves a pending burn
      // (DD-24); a promoted piece takes its type's group element (R-RULES-002).
      const loadoutElements = ctx.trueElements?.(ev.side) ?? armies[ev.side].elements;
      const element = ev.promotion
        ? elementFor(loadoutElements, ev.promotion)
        : (ctx.trueElement?.(ev.piece) ?? pieces[ev.piece]?.element);
      if (hf && ev.capture && element === 'ember') {
        hf = {
          ...hf,
          pending: [
            ...hf.pending.filter((b) => b.piece !== ev.piece),
            { piece: ev.piece, sq: ev.to },
          ],
        };
        hfChanged = true;
      }
      break;
    }
    case 'Captured': {
      const p = pieces[ev.victim];
      if (p) {
        if (board[ev.square] === ev.victim) board[ev.square] = -1;
        lift(ev.victim);
        p.square = -1;
        p.type = ev.victimType;
      }
      clearPending((b) => b.piece !== ev.victim);
      break;
    }
    case 'PieceMoved':
      put(ev.piece, ev.to);
      break;
    case 'PieceRevived':
      put(ev.piece, ev.square);
      break;
    case 'Promoted': {
      const p = pieces[ev.piece];
      if (p) {
        p.type = ev.to;
        // The viewer's own pieces show their true element; the opponent's show the displayed group
        // element (Masquerade Mask shows one element for every piece, DD-26; R-RULES-002).
        p.element = p.side === pub.viewer ? ev.element : elementFor(armies[p.side].elements, ev.to);
      }
      break;
    }
    case 'SquareIgnited':
      if (hf) {
        hf = {
          burning: [
            ...hf.burning.filter((b) => b.sq !== ev.square),
            { sq: ev.square, side: ev.side, turns: ev.turns },
          ],
          pending: hf.pending.filter((b) => b.sq !== ev.square),
        };
        hfChanged = true;
      }
      break;
    case 'SquareExtinguished':
      if (hf) {
        hf = { ...hf, burning: hf.burning.filter((b) => b.sq !== ev.square) };
        hfChanged = true;
      }
      break;
    case 'TurnPassed': {
      turn = ev.side;
      ply = ev.ply;
      inCheck = null;
      // Hot Foot countdown (onTurnEnd runs right after the turn passes, DD-25): burns lit by the
      // side now to move lose one turn, because their opponent has just taken one.
      if (hf && hf.burning.length > 0) {
        const mover = opposite(ev.side);
        hf = {
          ...hf,
          burning: hf.burning
            .map((b) => (b.side === mover ? b : { ...b, turns: b.turns - 1 }))
            .filter((b) => b.turns > 0),
        };
        hfChanged = true;
      }
      break;
    }
    case 'Check':
      // Settle can report both kings (a Stalwart king may stand in check); the first one is the
      // state's alert, as in the engine.
      inCheck = inCheck ?? ev.side;
      break;
    case 'BattleEnded':
      result = ev.result;
      break;
    case 'Revealed': {
      const army = armies[ev.side];
      const info = ev.info;
      if (info.kind === 'elements') {
        // Masquerade Mask exposed (DD-26): the true elements show from now on.
        armies = { ...armies, [ev.side]: { ...army, elements: [...info.elements] } };
        for (const p of pieces) {
          if (p.side !== ev.side) continue;
          p.element = ctx.trueElement?.(p.id) ?? elementFor(info.elements, p.type);
        }
      } else {
        const revealed = applyReveal(army.revealed, info);
        if (revealed !== army.revealed) armies = { ...armies, [ev.side]: { ...army, revealed } };
      }
      break;
    }
    case 'ChargeSpent': {
      const p = pieces[ev.piece];
      if (
        !ctx.trueUsage &&
        ev.ability !== null &&
        p &&
        knows(pub.viewer, armies, ev.side, p.type, ev.ability)
      ) {
        const key = `${ev.piece}:${ev.ability}`;
        usage = { ...usage, [key]: (usage[key] ?? 0) + 1 };
      }
      break;
    }
    default:
      break;
  }
  if (ctx.trueUsage) usage = visibleUsage(ctx.trueUsage, pieces, pub.viewer, armies);

  return {
    ...pub,
    board,
    pieces,
    slices: hfChanged && hf ? { ...pub.slices, [HOT_FOOT]: hf } : pub.slices,
    turn,
    ply,
    inCheck,
    result,
    usage,
    armies,
    eventSeq: ev.i + 1,
    legal: [],
    pending: null,
  };
}

/**
 * Differences between a rebuilt frame and the engine's projection at the same point, limited to what
 * the reducer is responsible for. Empty when they agree. `settled` = after the action finished (check
 * and turn are only final then).
 */
export function frameDrift(rebuilt: PublicState, exact: PublicState, settled: boolean): string[] {
  const out: string[] = [];
  for (let sq = 0; sq < 64; sq++) {
    if ((rebuilt.board[sq] ?? -1) !== (exact.board[sq] ?? -1)) out.push(`board[${sq}]`);
  }
  exact.pieces.forEach((p, id) => {
    const r = rebuilt.pieces[id];
    if (!r || r.square !== p.square || r.type !== p.type || r.element !== p.element)
      out.push(`piece #${id}`);
  });
  const burns = (pub: PublicState) => {
    const hf = readHotFoot(pub.slices);
    if (!hf) return '';
    const b = [...hf.burning].sort((x, y) => x.sq - y.sq);
    const p = [...hf.pending].sort((x, y) => x.sq - y.sq);
    return JSON.stringify([b, p]);
  };
  if (burns(rebuilt) !== burns(exact)) out.push('hot_foot');
  if (JSON.stringify(rebuilt.armies.white.revealed) !== JSON.stringify(exact.armies.white.revealed))
    out.push('reveals.white');
  if (JSON.stringify(rebuilt.armies.black.revealed) !== JSON.stringify(exact.armies.black.revealed))
    out.push('reveals.black');
  const usage = (u: Record<string, number>) =>
    JSON.stringify(Object.entries(u).sort(([a], [b]) => a.localeCompare(b)));
  if (usage(rebuilt.usage) !== usage(exact.usage)) out.push('usage');
  if (JSON.stringify(rebuilt.result) !== JSON.stringify(exact.result)) out.push('result');
  if (settled) {
    if (rebuilt.turn !== exact.turn) out.push('turn');
    if (rebuilt.inCheck !== exact.inCheck) out.push('inCheck');
  }
  return out;
}
