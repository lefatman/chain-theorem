/**
 * Trigger conditions in the NPC's model of a capture (5.6; 9.4 R-FMT-005). A known ability that
 * carries conditions counts only for the captures its conditions admit: Cornered bites only on a rim
 * square (DD-123), Overwhelm negates only a lower-ranked victim and spends no charge otherwise
 * (DD-125), Redo rewinds only a capture by an equal or higher rank (DD-100), Phalanx guards only
 * minor pieces and Reinforce needs a non-pawn victim. `conditionsHold` is the engine's test from
 * what the search may know (the two piece types and the capture square), on data, never on ids.
 *
 * Expected behaviour comes from spec 5.1 (rank order, DD-97), 5.4, 5.6 and each module's rules
 * text, not from the search's current output.
 */
import { describe, expect, it } from 'vitest';
import {
  type AbilityDef,
  type Condition,
  type GameState,
  type PieceType,
  parseSquare,
  uciToMove,
} from '@chain-theorem/rules';
import { abilityById, engine } from '../../content/index.ts';
import { idAt, setup } from '../../content/src/testing.ts';
import { conditionsHold, effectiveProfile, profileOf, sideKnowledge } from './knowledge.ts';
import { VALUE } from './fast.ts';
import { play, searchContext, unplay } from './index.ts';

const sq = parseSquare;
const A5 = sq('a5');
const D5 = sq('d5');

function ability(id: string): AbilityDef {
  const def = abilityById.get(id);
  if (!def) throw new Error(`unknown ability ${id}`);
  return def;
}

/** Encoded legal move `uci` for the side to move in `state`, as the fast search sees it. */
function encoded(state: GameState, uci: string): number {
  const ctx = searchContext(engine, state, state.turn);
  const mv = uciToMove(uci);
  const side = state.turn === 'white' ? 0 : 1;
  const m = ctx.pos.legal(side).find((x) => (x & 63) === mv.from && ((x >> 6) & 63) === mv.to);
  if (m === undefined) throw new Error(`illegal ${uci}`);
  return m;
}

/** Play `uci` in the fast search seen by `viewer`; undo it and check the position is restored. */
function probe(state: GameState, uci: string, viewer: 'white' | 'black') {
  const ctx = searchContext(engine, state, viewer);
  const before = { board: [...ctx.pos.board], psq: [...ctx.pos.psq] };
  const p = play(ctx, encoded(state, uci));
  const after = { board: [...ctx.pos.board], psq: [...ctx.pos.psq] };
  unplay(ctx, p);
  expect({ board: [...ctx.pos.board], psq: [...ctx.pos.psq] }).toEqual(before);
  return { played: p, after };
}

/**
 * The NPC's real input: white's belief state built from its own projection, with `revealed` as the
 * abilities black's piece types are known to carry (8.2). Black's hidden sets are not in it.
 */
function belief(s: GameState, revealed: Partial<Record<PieceType, string[]>>): GameState {
  const black = { ...s.reveals.black, abilities: revealed };
  const seen = { ...s, reveals: { ...s.reveals, black } };
  return engine.beliefState(engine.project(seen, 'white'), s.armies.white.loadout);
}

/** White rook a1 takes the black pawn a5: a capture on the a-file, a rim square. */
const RIM = '4k3/8/8/p7/8/8/8/R3K3 w - - 0 1';
/** White rook d1 takes the black pawn d5: a capture in the centre. */
const CENTRE = '4k3/8/8/3p4/8/8/8/3RK3 w - - 0 1';

describe('conditionsHold: trigger conditions from data (5.6, R-FMT-005)', () => {
  it('R-FMT-005 no conditions, undefined or empty, always hold', () => {
    expect(conditionsHold(undefined, 'rook', 'pawn', D5)).toBe(true);
    expect(conditionsHold([], 'rook', 'pawn', D5)).toBe(true);
  });

  it('R-FMT-005 victimTypeNot (Reinforce, Slipstream) and victimTypeIs (Rebuild)', () => {
    const notPawn: Condition[] = [{ victimTypeNot: 'pawn' }];
    expect(conditionsHold(notPawn, 'rook', 'pawn', D5)).toBe(false);
    expect(conditionsHold(notPawn, 'rook', 'knight', D5)).toBe(true);
    expect(conditionsHold(notPawn, 'pawn', 'queen', D5)).toBe(true);
    const tower: Condition[] = [{ victimTypeIs: ['rook', 'queen'] }];
    expect(conditionsHold(tower, 'pawn', 'rook', D5)).toBe(true);
    expect(conditionsHold(tower, 'pawn', 'queen', D5)).toBe(true);
    expect(conditionsHold(tower, 'pawn', 'bishop', D5)).toBe(false);
  });

  it('R-FMT-005 captorTypeIs (Phalanx) and captorTypeNot', () => {
    const minor: Condition[] = [{ captorTypeIs: ['pawn', 'knight', 'bishop'] }];
    for (const t of ['pawn', 'knight', 'bishop'] as const) {
      expect(conditionsHold(minor, t, 'queen', D5), t).toBe(true);
    }
    for (const t of ['rook', 'queen', 'king'] as const) {
      expect(conditionsHold(minor, t, 'pawn', D5), t).toBe(false);
    }
    const notKing: Condition[] = [{ captorTypeNot: 'king' }];
    expect(conditionsHold(notKing, 'king', 'pawn', D5)).toBe(false);
    expect(conditionsHold(notKing, 'queen', 'pawn', D5)).toBe(true);
  });

  it('R-FMT-005 DD-97 rank: captor > victim holds for a rook over a knight, not for a knight over a knight or a knight over a rook', () => {
    const outranks: Condition[] = [{ rank: { of: 'captor', cmp: '>', to: 'victim' } }];
    expect(conditionsHold(outranks, 'rook', 'knight', D5)).toBe(true);
    expect(conditionsHold(outranks, 'knight', 'knight', D5)).toBe(false);
    expect(conditionsHold(outranks, 'knight', 'rook', D5)).toBe(false);
    // Knight and bishop tie at rank 2 (DD-97): not higher, but equal or higher.
    expect(conditionsHold(outranks, 'bishop', 'knight', D5)).toBe(false);
    const cmp = (c: '<' | '<=' | '==' | '>=' | '>', captor: PieceType, victim: PieceType) =>
      conditionsHold([{ rank: { of: 'captor', cmp: c, to: 'victim' } }], captor, victim, D5);
    expect(cmp('>=', 'bishop', 'knight')).toBe(true);
    expect(cmp('==', 'bishop', 'knight')).toBe(true);
    expect(cmp('==', 'rook', 'knight')).toBe(false);
    expect(cmp('<', 'pawn', 'king')).toBe(true);
    expect(cmp('<', 'king', 'pawn')).toBe(false);
    expect(cmp('<=', 'queen', 'rook')).toBe(false);
    expect(cmp('<=', 'rook', 'rook')).toBe(true);
    // `of` and `to` name the pieces: Quantum Kill's victim > captor is the mirror image.
    const punchesUp: Condition[] = [{ rank: { of: 'victim', cmp: '>', to: 'captor' } }];
    expect(conditionsHold(punchesUp, 'knight', 'rook', D5)).toBe(true);
    expect(conditionsHold(punchesUp, 'rook', 'knight', D5)).toBe(false);
  });

  it('R-FMT-005 DD-123 zone rim: the a- and h-files and the first and eighth ranks, for the victim and the captor alike; the centre is not', () => {
    const victimRim: Condition[] = [{ zone: { of: 'victim', is: 'rim' } }];
    const captorRim: Condition[] = [{ zone: { of: 'captor', is: 'rim' } }];
    for (const s of ['a5', 'h4', 'd1', 'e8', 'a1', 'h8']) {
      expect(conditionsHold(victimRim, 'rook', 'pawn', sq(s)), s).toBe(true);
      expect(conditionsHold(captorRim, 'rook', 'pawn', sq(s)), s).toBe(true);
    }
    for (const s of ['d5', 'b2', 'g7', 'e4']) {
      expect(conditionsHold(victimRim, 'rook', 'pawn', sq(s)), s).toBe(false);
      expect(conditionsHold(captorRim, 'rook', 'pawn', sq(s)), s).toBe(false);
    }
    let rim = 0;
    for (let s = 0; s < 64; s++) if (conditionsHold(victimRim, 'rook', 'pawn', s)) rim++;
    expect(rim).toBe(28);
  });

  it('R-FMT-005 every condition in the list must hold', () => {
    const both: Condition[] = [{ zone: { of: 'victim', is: 'rim' } }, { captorTypeIs: ['pawn'] }];
    expect(conditionsHold(both, 'pawn', 'knight', A5)).toBe(true);
    expect(conditionsHold(both, 'pawn', 'knight', D5)).toBe(false);
    expect(conditionsHold(both, 'rook', 'knight', A5)).toBe(false);
  });

  it('R-ABIL-005 DD-123 DD-125 DD-100 the shipped modules’ conditions read as their rules text says', () => {
    const holds = (id: string, captor: PieceType, victim: PieceType, at = D5) =>
      conditionsHold(ability(id).conditions, captor, victim, at);
    expect(holds('cornered', 'rook', 'pawn', A5)).toBe(true);
    expect(holds('cornered', 'rook', 'pawn', D5)).toBe(false);
    expect(holds('overwhelm', 'rook', 'knight')).toBe(true);
    expect(holds('overwhelm', 'knight', 'knight')).toBe(false);
    expect(holds('redo', 'knight', 'knight')).toBe(true);
    expect(holds('redo', 'pawn', 'knight')).toBe(false);
    expect(holds('phalanx', 'bishop', 'queen')).toBe(true);
    expect(holds('phalanx', 'rook', 'pawn')).toBe(false);
    expect(holds('reinforce', 'knight', 'pawn')).toBe(false);
    expect(holds('reinforce', 'knight', 'bishop')).toBe(true);
    expect(holds('rebuild', 'pawn', 'queen')).toBe(true);
    expect(holds('rebuild', 'pawn', 'knight')).toBe(false);
    // Necromancer: a victim of equal or higher rank than the captor (the knight/bishop tie counts).
    expect(holds('necromancer', 'knight', 'bishop')).toBe(true);
    expect(holds('necromancer', 'queen', 'rook')).toBe(false);
    expect(holds('quantum_kill', 'pawn', 'knight')).toBe(true);
    expect(holds('quantum_kill', 'knight', 'bishop')).toBe(false);
    // An unconditional ability holds for every capture.
    expect(holds('poisoned_meat', 'rook', 'pawn')).toBe(true);
  });
});

describe('PieceKnowledge keeps conditional abilities apart from the merged profiles (R-FMT-005)', () => {
  it('R-FMT-005 DD-123 a known Cornered is a conditional CAPTURED entry, not a merged killsCaptor; it still counts as one known trigger', () => {
    const { state } = setup({ fen: RIM, black: { abilities: ['cornered'] } });
    const k = sideKnowledge(engine, state, 'black', 'black').pawn;
    expect(k.captured.killsCaptor).toBe(false);
    expect(k.conditional).toEqual([
      {
        category: 'CAPTURED',
        profile: profileOf(ability('cornered')),
        conditions: [{ zone: { of: 'victim', is: 'rim' } }],
      },
    ]);
    expect(k.conditional[0]?.profile.killsCaptor).toBe(true);
    expect(k.count).toBe(1);
  });

  it('R-FMT-005 unconditional abilities merge as before; a type without conditional abilities has an empty list', () => {
    const { state } = setup({
      fen: RIM,
      white: { abilities: ['pierce'] },
      black: { abilities: ['poisoned_meat', 'cornered'] },
    });
    const pawn = sideKnowledge(engine, state, 'black', 'black').pawn;
    expect(pawn.captured.killsCaptor).toBe(true);
    expect(pawn.conditional.map((c) => c.category)).toEqual(['CAPTURED']);
    expect(pawn.count).toBe(2);
    const rook = sideKnowledge(engine, state, 'white', 'white').rook;
    expect(rook.capturing.negatesVictim).toBe(true);
    expect(rook.conditional).toEqual([]);
    expect(rook.count).toBe(1);
  });

  it('R-FMT-005 effectiveProfile returns the merged profile itself when nothing conditional applies, and a copy with the applicable entries added otherwise', () => {
    const { state } = setup({
      fen: RIM,
      white: { abilities: ['pierce'] },
      black: { abilities: ['cornered'] },
    });
    const rook = sideKnowledge(engine, state, 'white', 'white').rook;
    expect(effectiveProfile(rook, 'CAPTURING', 'rook', 'pawn', A5)).toBe(rook.capturing);
    const pawn = sideKnowledge(engine, state, 'black', 'black').pawn;
    expect(effectiveProfile(pawn, 'CAPTURED', 'rook', 'pawn', A5).killsCaptor).toBe(true);
    expect(effectiveProfile(pawn, 'CAPTURED', 'rook', 'pawn', D5)).toBe(pawn.captured);
    // Only entries of the asked category apply, and the merged profile is never written to.
    expect(effectiveProfile(pawn, 'CAPTURES', 'rook', 'pawn', A5)).toBe(pawn.captures);
    expect(pawn.captured.killsCaptor).toBe(false);
  });
});

describe('Cornered in the fast search (DD-123, R-FMT-005)', () => {
  it('R-FMT-005 DD-123 a rook taking a known Cornered pawn on a5 (the rim) is rated as killing the captor; the same capture on d5 is not', () => {
    const rim = setup({ fen: RIM, black: { abilities: ['cornered'] } }).state;
    const onRim = probe(rim, 'a1a5', 'white');
    expect(onRim.played.killed).toBe(idAt(rim, 'a1'));
    expect(onRim.after.board[A5]).toBe(-1);
    const centre = setup({ fen: CENTRE, black: { abilities: ['cornered'] } }).state;
    const inCentre = probe(centre, 'd1d5', 'white');
    expect(inCentre.played.killed).toBe(-1);
    expect(inCentre.after.board[D5]).toBe(idAt(centre, 'd1'));
  });

  it.each([
    ['the h-file', '4k3/8/8/7p/8/8/8/4K2R w - - 0 1', 'h1h5', 'white'],
    ['the eighth rank', '3nk3/8/8/8/8/8/8/3RK3 w - - 0 1', 'd1d8', 'white'],
    ['the first rank', '1r2k3/8/8/8/8/8/8/1N2K3 b - - 0 1', 'b8b1', 'black'],
  ] as const)(
    'DD-123 every edge is the rim: the search removes a captor on %s',
    (_edge, fen, uci, captorSide) => {
      const cornered = { abilities: ['cornered'] };
      const armies = captorSide === 'white' ? { black: cornered } : { white: cornered };
      const state = setup({ fen, ...armies }).state;
      expect(probe(state, uci, captorSide).played.killed).toBe(idAt(state, uci.slice(0, 2)));
    },
  );

  it('R-RULES-004 DD-123 a king captor on the rim is not removed (royal immunity)', () => {
    const state = setup({
      fen: '4k3/8/8/8/8/8/7n/7K w - - 0 1',
      black: { abilities: ['cornered'] },
    }).state;
    expect(probe(state, 'h1h2', 'white').played.killed).toBe(-1);
  });

  it('R-FMT-005 R-INFO-005 from the belief state: a Cornered revealed on black’s pawns bites on the rim only; an unrevealed one is never read', () => {
    const rim = setup({ fen: RIM, black: { abilities: ['cornered'] } }).state;
    const rook = idAt(rim, 'a1');
    expect(probe(belief(rim, { pawn: ['cornered'] }), 'a1a5', 'white').played.killed).toBe(rook);
    expect(probe(belief(rim, {}), 'a1a5', 'white').played.killed).toBe(-1);
    const centre = setup({ fen: CENTRE, black: { abilities: ['cornered'] } }).state;
    expect(probe(belief(centre, { pawn: ['cornered'] }), 'd1d5', 'white').played.killed).toBe(-1);
  });
});

/** White rook d1 (rank 3) takes the black knight d5 (rank 2). */
const ROOK_V_KNIGHT = '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1';
/** White knight c3 takes the black knight d5: equal rank. */
const KNIGHT_V_KNIGHT = '4k3/8/8/3n4/8/2N5/8/4K3 w - - 0 1';
/** White knight c3 takes the black rook d5: the captor is outranked. */
const KNIGHT_V_ROOK = '4k3/8/8/3r4/8/2N5/8/4K3 w - - 0 1';

describe('Overwhelm in the fast search (DD-125, R-FMT-005)', () => {
  it('R-FMT-005 DD-125 a rook with Overwhelm taking a known Poisoned Meat knight is safe: the negation fires and spends one of its two charges, restored on undo', () => {
    const { state } = setup({
      fen: ROOK_V_KNIGHT,
      white: { abilities: ['overwhelm'] },
      black: { abilities: ['poisoned_meat'] },
    });
    const rook = idAt(state, 'd1');
    const ctx = searchContext(engine, state, 'white');
    expect(ctx.negateCharges[rook]).toBe(2);
    const p = play(ctx, encoded(state, 'd1d5'));
    expect(p.killed).toBe(-1);
    expect(p.charged).toBe(rook);
    expect(ctx.negateCharges[rook]).toBe(1);
    unplay(ctx, p);
    expect(ctx.negateCharges[rook]).toBe(2);
  });

  it('R-FMT-005 DD-125 DD-97 a knight with Overwhelm taking a Poisoned Meat knight (equal rank) or rook (higher rank) is killed and spends no negation charge', () => {
    for (const fen of [KNIGHT_V_KNIGHT, KNIGHT_V_ROOK]) {
      const { state } = setup({
        fen,
        white: { abilities: ['overwhelm'] },
        black: { abilities: ['poisoned_meat'] },
      });
      const knight = idAt(state, 'c3');
      const ctx = searchContext(engine, state, 'white');
      const p = play(ctx, encoded(state, 'c3d5'));
      expect(p.killed, fen).toBe(knight);
      expect(p.charged, fen).toBe(-1);
      expect(ctx.negateCharges[knight], fen).toBe(2);
      unplay(ctx, p);
      expect(ctx.negateCharges[knight], fen).toBe(2);
    }
  });

  it('R-FMT-005 DD-125 DD-120 with both charges spent the rook dies to the knight’s Poisoned Meat; the belief state built from the projection answers the same', () => {
    const { state } = setup({
      fen: ROOK_V_KNIGHT,
      white: { abilities: ['overwhelm'] },
      black: { abilities: ['poisoned_meat'] },
    });
    const rook = idAt(state, 'd1');
    const used = (n: number): GameState => ({
      ...state,
      usage: { ...state.usage, [`${rook}:overwhelm`]: n },
    });
    expect(probe(used(1), 'd1d5', 'white').played.killed).toBe(-1);
    expect(probe(used(2), 'd1d5', 'white').played.killed).toBe(rook);
    const seen = (n: number) => belief(used(n), { knight: ['poisoned_meat'] });
    expect(probe(seen(1), 'd1d5', 'white').played.killed).toBe(-1);
    expect(probe(seen(2), 'd1d5', 'white').played.killed).toBe(rook);
  });
});

describe('conditions of existing abilities the search now honours (R-FMT-005)', () => {
  it('R-FMT-005 Phalanx guards only pawns, knights and bishops: a rook capture into a known Poisoned Meat is rated as killing the rook, a bishop’s as safe', () => {
    const rook = setup({
      fen: CENTRE,
      white: { abilities: ['phalanx'] },
      black: { abilities: ['poisoned_meat'] },
    }).state;
    expect(probe(rook, 'd1d5', 'white').played.killed).toBe(idAt(rook, 'd1'));
    const bishop = setup({
      fen: '4k3/8/8/3p4/8/1B6/8/4K3 w - - 0 1',
      white: { abilities: ['phalanx'] },
      black: { abilities: ['poisoned_meat'] },
    }).state;
    expect(probe(bishop, 'b3d5', 'white').played.killed).toBe(-1);
  });

  it('R-FMT-005 DD-100 DD-97 Redo rewinds only a capture by an equal or higher rank: a pawn taking a known Redo knight carries no undo penalty; a knight or a rook taking it does', () => {
    // White: K e1, R d1, N c3, P e4; Black: N d5 (Redo), K e8. Every capture of a type whose set is
    // not fully known pays the same risk, so the differences isolate the Redo term.
    const KNIGHT = '4k3/8/8/3n4/4P3/2N5/8/3RK3 w - - 0 1';
    const bias = (fen: string, uci: string, set: string[]) =>
      probe(setup({ fen, black: { abilities: set } }).state, uci, 'white').played.bias;
    const penalty = (victim: number) => (VALUE[victim] as number) + 15;
    expect(bias(KNIGHT, 'e4d5', ['redo'])).toBe(bias(KNIGHT, 'e4d5', [])); // pawn 1 < knight 2
    expect(bias(KNIGHT, 'c3d5', ['redo'])).toBe(bias(KNIGHT, 'c3d5', []) - penalty(1)); // 2 >= 2
    expect(bias(KNIGHT, 'd1d5', ['redo'])).toBe(bias(KNIGHT, 'd1d5', []) - penalty(1)); // 3 >= 2
    // A Redo rook: the knight is outranked (no rewind), the rook is its equal (rewind).
    const ROOK = '4k3/8/8/3r4/4P3/2N5/8/3RK3 w - - 0 1';
    expect(bias(ROOK, 'c3d5', ['redo'])).toBe(bias(ROOK, 'c3d5', []));
    expect(bias(ROOK, 'd1d5', ['redo'])).toBe(bias(ROOK, 'd1d5', []) - penalty(3));
  });

  it('R-FMT-005 Reinforce revives only after a non-pawn victim: no revive bonus for taking a known pawn, the bonus for taking a knight', () => {
    const run = (fen: string, set: string[]) =>
      probe(setup({ fen, white: { abilities: set } }).state, 'c3d5', 'white').played.bias;
    const PAWN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
    expect(run(PAWN, ['reinforce'])).toBe(run(PAWN, []));
    expect(run(KNIGHT_V_KNIGHT, ['reinforce'])).toBe(run(KNIGHT_V_KNIGHT, []) + 60);
  });
});
