/**
 * Format objectives in NPC search (spec 9.1 R-FMT-001/002, 9.4 R-FMT-005, worked example E4). In
 * First Blood a non-pawn piece that takes a Poisoned Meat pawn is effect-captured, and that capture
 * wins the battle for the pawn's owner. Once Poisoned Meat is revealed on pawns, Trainer and Elite
 * NPCs must not make that capture with a non-pawn piece; while it is unknown they may (the NPC
 * cannot know, 9.4).
 */
import { describe, expect, it } from 'vitest';
import {
  type FormatId,
  type GameState,
  type Loadout,
  applyWithDefaults,
  moveToUci,
  uciToMove,
} from '@chain-theorem/rules';
import { engine } from '../../content/index.ts';
import { play } from '../../content/src/testing.ts';
import { type Tier, search } from './index.ts';

const AWARE: readonly Tier[] = ['trainer', 'elite'];
const ALL: readonly Tier[] = ['wild', 'trainer', 'elite'];

const NPC: Loadout = { elements: ['grove'], items: [], sets: [[]] };
const MEAT: Loadout = { elements: ['grove'], items: [], sets: [['poisoned_meat']] };

function start(format: FormatId, fen: string, black: Loadout = MEAT): GameState {
  return engine.newBattle({
    format,
    white: { level: 20, loadout: NPC },
    black: { level: 20, loadout: black },
    fen,
  }).state;
}

/**
 * White pawn d4 takes e5: Poisoned Meat removes the pawn and is revealed on black pawns (a pawn
 * for a pawn, so the First Blood objective is untouched). Black then plays e8d8. Now the white
 * knight on d3 can take the Poisoned Meat pawn on c5.
 */
function revealedPosition(format: FormatId): GameState {
  let state = start(format, '4k3/8/8/2p1p3/3P4/3N4/8/4K3 w - - 0 1');
  state = play(engine, state, 'd4e5').state;
  state = play(engine, state, 'e8d8').state;
  return state;
}

function npcMove(state: GameState, tier: Tier): string {
  const pub = engine.project(state, state.turn);
  return moveToUci(search(engine, pub, NPC, tier).move);
}

describe('First Blood objective and Poisoned Meat (R-FMT-005, R-FMT-002, E4)', () => {
  it('R-FMT-005 E4 precondition: Poisoned Meat is revealed on pawns and taking c5 with the knight loses First Blood', () => {
    const state = revealedPosition('first_blood');
    expect(state.reveals.black.abilities.pawn).toEqual(['poisoned_meat']);
    expect(state.objective).toEqual({ white: 0, black: 0 });
    expect(state.result).toBeNull();
    const after = play(engine, state, 'd3c5').state;
    expect(after.result).toEqual({ winner: 'black', reason: 'objective' });
  });

  for (const t of AWARE) {
    it(`R-FMT-005 E4 ${t} does not take a revealed Poisoned Meat pawn with a knight in First Blood`, () => {
      const state = revealedPosition('first_blood');
      const uci = npcMove(state, t);
      expect(uci).not.toBe('d3c5');
      const after = applyWithDefaults(engine, state, {
        kind: 'move',
        side: 'white',
        move: uciToMove(uci),
      }).state;
      expect(after.result).toBeNull();
    });

    it(`R-FMT-005 E4 ${t} may take the same pawn while its ability is unknown (hidden data is never read)`, () => {
      const revealed = revealedPosition('first_blood');
      // The same board as a fresh battle: nothing revealed, Poisoned Meat still hidden on pawns.
      const unknown = start('first_blood', engine.toFen(revealed));
      expect(unknown.reveals.black.abilities.pawn).toBeUndefined();
      expect(npcMove(unknown, t)).toBe('d3c5');
    });

    it(`R-FMT-005 E1 ${t} does not trade a knight for a revealed Poisoned Meat pawn in a Full Battle either`, () => {
      const state = revealedPosition('full');
      expect(npcMove(state, t)).not.toBe('d3c5');
    });
  }

  for (const t of ALL) {
    it(`R-FMT-005 R-FMT-002 ${t} rescues a knight attacked by a pawn in First Blood (losing it loses the battle)`, () => {
      // Black pawn c5 attacks the knight on b4; if the knight stays, cxb4 wins First Blood for black.
      const state = start('first_blood', '4k3/8/8/2p5/1N6/8/8/4K3 w - - 0 1', {
        elements: ['grove'],
        items: [],
        sets: [[]],
      });
      const uci = npcMove(state, t);
      const after = applyWithDefaults(engine, state, {
        kind: 'move',
        side: 'white',
        move: uciToMove(uci),
      }).state;
      const threats = engine
        .legalMoves(after, 'black')
        .filter((m) => {
          const victim = after.pieces[after.board[m.to] ?? -1];
          return victim !== undefined && victim.side === 'white' && victim.type !== 'pawn';
        })
        .map((m) => moveToUci(m));
      expect(threats, `after ${uci}`).toEqual([]);
    });
  }
});
