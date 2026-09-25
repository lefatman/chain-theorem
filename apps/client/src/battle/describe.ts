/**
 * Plain-language log line for every event (11.2: "every reaction chain is replayable step by step
 * with a plain-language log line per step"). Uses only projected data; hidden names read "an
 * unknown ability".
 */
import { abilityById, itemById, traitById } from '@chain-theorem/content';
import { squareName, type PublicEvent, type PublicState, type SourceRef } from '@chain-theorem/rules';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function pieceLabel(pub: PublicState, id: number): string {
  const p = pub.pieces[id];
  if (!p) return 'a piece';
  return `${p.side === 'white' ? 'White' : 'Black'} ${p.type}`;
}

export function abilityName(id: string | null): string {
  if (id === null) return 'an unknown ability';
  return abilityById.get(id)?.name ?? id;
}

export function sourceName(src: SourceRef | undefined): string {
  if (!src) return 'an effect';
  switch (src.kind) {
    case 'ability':
      return abilityName(src.id);
    case 'item':
      return itemById.get(src.id)?.name ?? src.id;
    case 'trait':
      return traitById.get(src.id)?.name ?? src.id;
    case 'rule':
      return {
        royal_immunity: 'Royal Immunity',
        inv03: 'king safety (INV-03)',
        silence: 'elemental silence',
        depth: 'the chain depth limit',
        bonus_in_bonus: 'the one-bonus-action rule',
      }[src.id];
    case 'hidden':
      return 'something hidden';
  }
}

const FIZZLE: Record<string, string> = {
  no_body: 'its piece is gone',
  royal_immunity: 'kings are immune to effect captures',
  inv03: 'it would expose the king',
  protected: 'the target is protected',
  bulwark: 'Bulwark absorbed it',
  burning: 'the square is burning',
  occupied: 'the square is occupied',
  no_target: 'there is no valid target',
  depth_limit: 'the chain is too deep',
  bonus_in_bonus: 'bonus actions cannot grant bonus actions',
  already_on_board: 'the piece is already on the board',
  condition: 'its condition is not met',
};

export function describe(ev: PublicEvent, pub: PublicState): string {
  switch (ev.k) {
    case 'BattleStarted':
      return 'The battle begins.';
    case 'ActionStarted':
      return `${cap(ev.side)} moves ${squareName(ev.move.from)} to ${squareName(ev.move.to)}.`;
    case 'MoveMade': {
      const who = `${cap(ev.side)} ${ev.pieceType}`;
      if (ev.castle) return `${cap(ev.side)} castles ${ev.castle === 'K' ? 'king side' : 'queen side'}.`;
      const verb = ev.capture ? 'captures on' : 'moves to';
      const bonus = ev.bonus ? ' (bonus move)' : '';
      const promo = ev.promotion ? ` and promotes to a ${ev.promotion}` : '';
      return `${who} ${verb} ${squareName(ev.to)}${ev.enPassant ? ' en passant' : ''}${promo}${bonus}.`;
    }
    case 'Captured':
      return ev.by === 'move'
        ? `${cap(ev.victimSide)} ${ev.victimType} on ${squareName(ev.square)} is captured.`
        : `${sourceName(ev.source)} removes the ${ev.victimSide} ${ev.victimType} on ${squareName(ev.square)}.`;
    case 'Promoted':
      return `The pawn becomes a ${ev.to} (${ev.element}).`;
    case 'AbilityTriggered':
      return `${pieceLabel(pub, ev.piece)}: ${abilityName(ev.ability)} activates${ev.attuned ? ' (attuned)' : ''}.`;
    case 'AbilitySilenced':
      return `${pieceLabel(pub, ev.piece)}: ${abilityName(ev.ability)} is silenced by elemental advantage.`;
    case 'AbilityNegated':
      return `${pieceLabel(pub, ev.piece)}: ${abilityName(ev.ability)} is negated by ${sourceName(ev.source)}.`;
    case 'EffectFizzled':
      return `${abilityName(ev.ability)} fizzles: ${FIZZLE[ev.reason] ?? ev.reason}.`;
    case 'ChargeSpent':
      return ev.remaining >= 0
        ? `${abilityName(ev.ability)} spends a charge (${ev.remaining} left).`
        : `${abilityName(ev.ability)} spends a charge.`;
    case 'SquareIgnited':
      return `${squareName(ev.square)} bursts into flame for ${ev.turns} turns.`;
    case 'SquareExtinguished':
      return `The fire on ${squareName(ev.square)} goes out.`;
    case 'Revealed': {
      const whose = cap(ev.side);
      const i = ev.info;
      switch (i.kind) {
        case 'ability':
          return `Revealed: ${whose}'s ${i.pieceType}s carry ${abilityName(i.ability)}.`;
        case 'set':
          return `Revealed: ${whose}'s ${i.pieceType} set is ${i.abilities.map(abilityName).join(', ') || 'empty'}.`;
        case 'item':
          return `Revealed: ${whose} equips ${itemById.get(i.item)?.name ?? i.item}.`;
        case 'items':
          return `Revealed: ${whose}'s items are ${i.items.map((x) => itemById.get(x)?.name ?? x).join(', ') || 'none'}.`;
        case 'veiled':
          return `${whose}'s ${i.pieceType}s are veiled: their abilities act unnamed.`;
        case 'elements':
          return `${whose}'s true element${i.elements.length > 1 ? 's are' : ' is'} ${i.elements.join(' and ')}.`;
      }
      return 'Something was revealed.';
    }
    case 'PieceMoved':
      return `${sourceName(ev.source)} moves ${pieceLabel(pub, ev.piece)} to ${squareName(ev.to)}.`;
    case 'PieceRevived':
      return `${pieceLabel(pub, ev.piece)} returns on ${squareName(ev.square)} (${sourceName(ev.source)}).`;
    case 'ChoiceMade':
      return `${cap(ev.side)} makes a choice.`;
    case 'Check':
      return `${cap(ev.side)}'s king is in check!`;
    case 'TurnPassed':
      return `${cap(ev.side)} to move.`;
    case 'BattleEnded': {
      const r = ev.result;
      const reason = r.reason.replace(/_/g, ' ');
      return r.winner ? `${cap(r.winner)} wins (${reason}).` : `Draw (${reason}).`;
    }
  }
}
