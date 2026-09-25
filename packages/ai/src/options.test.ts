/**
 * NPC answers to mid-action prompts (spec 5.4, DD-18, 9.4 R-FMT-005). chooseOption sees only the
 * chooser's projection plus its own loadout. Bonus moves (Riposte, Momentum) are optional: the NPC
 * takes one when it wins material and declines when it would lose (a revealed Poisoned Meat captor
 * in First Blood, E4). Target and square choices pick the most valuable target and a safe square.
 */
import { describe, expect, it } from 'vitest';
import {
  type ChoiceOption,
  type ChoiceRequest,
  type FormatId,
  type GameState,
  type Loadout,
  moveToUci,
  parseSquare,
  squareName,
  uciToMove,
} from '@chain-theorem/rules';
import { engine } from '../../content/index.ts';
import { play } from '../../content/src/testing.ts';
import { type Tier, chooseOption, search } from './index.ts';

const ALL: readonly Tier[] = ['wild', 'trainer', 'elite'];
const AWARE: readonly Tier[] = ['trainer', 'elite'];

function battle(format: FormatId, fen: string, white: Loadout, black: Loadout): GameState {
  return engine.newBattle({
    format,
    white: { level: 20, loadout: white },
    black: { level: 20, loadout: black },
    fen,
  }).state;
}

const army = (abilities: string[], element: Loadout['elements'][number] = 'neutral'): Loadout => ({
  elements: [element],
  items: [],
  sets: [abilities],
});

/** Play `uci` and stop at the first prompt. */
function prompt(state: GameState, uci: string): { state: GameState; request: ChoiceRequest } {
  const r = engine.applyAction(state, { kind: 'move', side: state.turn, move: uciToMove(uci) });
  if (r.kind !== 'needsChoice') throw new Error(`no prompt after ${uci}`);
  return { state: r.state, request: r.request };
}

/** The NPC's answer, from the chooser's projection and own loadout only. */
function answer(state: GameState, request: ChoiceRequest, tier: Tier): number {
  const pub = engine.project(state, request.chooser);
  return chooseOption(engine, pub, state.armies[request.chooser].loadout, request, tier);
}

/** Answer the prompt with `option`, then let every later prompt take its default. */
function resolve(state: GameState, request: ChoiceRequest, option: number): GameState {
  let r = engine.applyAction(state, {
    kind: 'choice',
    side: request.chooser,
    promptId: request.promptId,
    option,
  });
  while (r.kind === 'needsChoice') {
    r = engine.applyAction(r.state, {
      kind: 'choice',
      side: r.request.chooser,
      promptId: r.request.promptId,
      option: r.request.defaultOption,
    });
  }
  return r.state;
}

function describeOption(o: ChoiceOption | undefined): string {
  if (!o) return 'none';
  switch (o.kind) {
    case 'decline':
      return 'decline';
    case 'move':
      return moveToUci(o);
    case 'square':
      return squareName(o.square);
    case 'piece':
      return `piece ${o.piece} on ${squareName(o.square)}`;
  }
}

/** Squares of `side`'s non-pawn pieces that an enemy pawn can take next move. */
function enPriseToPawns(state: GameState, side: 'white' | 'black'): string[] {
  const enemy = side === 'white' ? 'black' : 'white';
  return engine
    .legalMoves(state, enemy)
    .filter((m) => state.pieces[state.board[m.from] ?? -1]?.type === 'pawn')
    .filter((m) => {
      const v = state.pieces[state.board[m.to] ?? -1];
      return v !== undefined && v.side === side && v.type !== 'pawn';
    })
    .map((m) => moveToUci(m));
}

describe('chooseOption: optional bonus moves (R-FMT-005, DD-18)', () => {
  // E6: bishop b3 takes a Riposte knight on d5; the rook d8 and the pawn e6 can take the bishop.
  const E6 = '3rk3/8/4p3/3n4/8/1B6/8/4K3 w - - 0 1';

  for (const t of ALL) {
    it(`R-FMT-005 E6 ${t} accepts a Riposte capture that wins back the bishop`, () => {
      const { state, request } = prompt(battle('full', E6, army([]), army(['riposte'])), 'b3d5');
      expect(request.options[0]).toEqual({ kind: 'decline' });
      const i = answer(state, request, t);
      const o = request.options[i];
      expect(o?.kind, describeOption(o)).toBe('move');
      expect(o?.kind === 'move' && o.to).toBe(parseSquare('d5'));
    });

    it(`R-FMT-005 ${t} accepts a winning Riposte capture even when already far ahead`, () => {
      // Black is a queen up; the recapture still wins the bishop and must not look like a loss.
      const fen = '3rk3/q7/4p3/3n4/8/1B6/8/4K3 w - - 0 1';
      const { state, request } = prompt(battle('full', fen, army([]), army(['riposte'])), 'b3d5');
      const o = request.options[answer(state, request, t)];
      expect(o?.kind, describeOption(o)).toBe('move');
    });

    it(`R-FMT-005 ${t} uses a Momentum bonus move to rescue a capturing knight left en prise`, () => {
      // Nc3xd5: the pawn e6 guards d5. Declining leaves the knight to exd5.
      const fen = '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1';
      const { state, request } = prompt(battle('full', fen, army(['momentum']), army([])), 'c3d5');
      const i = answer(state, request, t);
      expect(request.options[i]?.kind, describeOption(request.options[i])).toBe('move');
      const after = resolve(state, request, i);
      expect(enPriseToPawns(after, 'white')).toEqual([]);
    });
  }

  // Black to move: c5xb4 reveals white's Poisoned Meat (pawn for pawn); then e4xd5 takes a Riposte
  // pawn and black may answer Nf6xd5, which Poisoned Meat would punish.
  const MEAT_FEN = '6k1/8/5n2/2pp4/1P2P3/8/8/6K1 b - - 0 1';
  function meatPrompt(format: FormatId): { state: GameState; request: ChoiceRequest } {
    let state = battle(format, MEAT_FEN, army(['poisoned_meat']), army(['riposte']));
    state = play(engine, state, 'c5b4').state;
    expect(state.reveals.white.abilities.pawn).toEqual(['poisoned_meat']);
    return prompt(state, 'e4d5');
  }

  for (const t of AWARE) {
    it(`R-FMT-005 E4 ${t} declines a Riposte capture of a revealed Poisoned Meat captor in First Blood`, () => {
      const { state, request } = meatPrompt('first_blood');
      expect(request.options.map(describeOption)).toEqual(['decline', 'f6d5']);
      expect(answer(state, request, t)).toBe(0);
      // Control: accepting really loses the battle.
      expect(resolve(state, request, 1).result).toEqual({ winner: 'white', reason: 'objective' });
      expect(resolve(state, request, 0).result).toBeNull();
    });

    it(`R-FMT-005 E1 ${t} declines the same Riposte in a Full Battle (a knight for a pawn)`, () => {
      const { state, request } = meatPrompt('full');
      expect(answer(state, request, t)).toBe(0);
    });

    it(`R-FMT-005 ${t} may accept that Riposte while the captor's Poisoned Meat is still unknown`, () => {
      const fen = '6k1/8/5n2/3p4/4P3/8/8/6K1 w - - 0 1';
      const base = battle('first_blood', fen, army(['poisoned_meat']), army(['riposte']));
      const { state, request } = prompt(base, 'e4d5');
      expect(state.reveals.white.abilities.pawn).toBeUndefined();
      expect(answer(state, request, t)).toBe(1);
    });
  }
});

describe('chooseOption: targets and squares (R-FMT-005, DD-18, DD-19)', () => {
  for (const t of ALL) {
    it(`R-FMT-005 ${t} picks the most valuable Backdraft target (bishop over knight over pawn)`, () => {
      // Attuned Backdraft (Ember bearer) may take an adjacent pawn, knight or bishop.
      const fen = '4k3/8/2N1B3/3p4/2P1Q3/8/8/3RK3 w - - 0 1';
      const { state, request } = prompt(
        battle('full', fen, army([]), army(['backdraft'], 'ember')),
        'd1d5',
      );
      expect(request.options.map(describeOption).sort()).toEqual([
        'piece 2 on c4',
        'piece 5 on c6',
        'piece 6 on e6',
      ]);
      expect(describeOption(request.options[answer(state, request, t)])).toBe('piece 6 on e6');
    });

    it(`R-FMT-005 ${t} prefers a knight to a pawn as the Backdraft target`, () => {
      const fen = '4k3/8/2N5/3p4/2P5/8/8/3RK3 w - - 0 1';
      const { state, request } = prompt(
        battle('full', fen, army([]), army(['backdraft'], 'ember')),
        'd1d5',
      );
      expect(describeOption(request.options[answer(state, request, t)])).toBe('piece 4 on c6');
    });

    it(`R-FMT-005 ${t} breaks a tie between equal Cleave targets with the lowest option index`, () => {
      const fen = '4k3/8/2p1p3/3p4/8/8/8/3RK3 w - - 0 1';
      const { state, request } = prompt(battle('full', fen, army(['cleave']), army([])), 'd1d5');
      expect(request.options).toHaveLength(2);
      expect(answer(state, request, t)).toBe(0);
    });

    it(`R-FMT-005 DD-20 ${t} lands an attuned Hit and Run knight on a square no pawn attacks`, () => {
      // Tide knight e4 takes g5. Of the offered squares, e4, d4, e5 and f5 are attacked by black
      // pawns (d5, c5, f6, e6); d3, e3, f3 and f4 are safe.
      const fen = '4k3/8/4pp2/2pp2p1/4N3/8/8/4K3 w - - 0 1';
      const { state, request } = prompt(
        battle('full', fen, army(['hit_and_run'], 'tide'), army([])),
        'e4g5',
      );
      expect(request.kind).toBe('square');
      const i = answer(state, request, t);
      const after = resolve(state, request, i);
      expect(enPriseToPawns(after, 'white'), describeOption(request.options[i])).toEqual([]);
    });
  }

  it('R-FMT-005 in an NPC-vs-NPC battle full of prompts every answer is a valid option', () => {
    const white: Loadout = {
      elements: ['ember'],
      items: ['triple_adepts_gloves'],
      sets: [['riposte', 'momentum', 'cleave']],
    };
    const black: Loadout = {
      elements: ['tide'],
      items: ['triple_adepts_gloves'],
      sets: [['hit_and_run', 'backdraft', 'riposte']],
    };
    let { state } = engine.newBattle({
      format: 'full',
      white: { level: 30, loadout: white },
      black: { level: 30, loadout: black },
    });
    const kinds = new Set<string>();
    for (let ply = 0; ply < 60 && !state.result; ply++) {
      const side = state.turn;
      const pub = engine.project(state, side);
      const own = state.armies[side].loadout;
      const move = search(engine, pub, own, 'trainer', { nodes: 1_500, seed: ply }).move;
      let r = engine.applyAction(state, { kind: 'move', side, move });
      while (r.kind === 'needsChoice') {
        const req = r.request;
        kinds.add(req.kind);
        const i = answer(r.state, req, ply % 2 === 0 ? 'elite' : 'wild');
        expect(Number.isInteger(i) && i >= 0 && i < req.options.length).toBe(true);
        r = engine.applyAction(r.state, {
          kind: 'choice',
          side: req.chooser,
          promptId: req.promptId,
          option: i,
        });
      }
      state = r.state;
    }
    expect(kinds.size).toBeGreaterThan(0);
  });

  it('R-FMT-005 a protect prompt shields the most valuable own piece; a capture prompt spares it', () => {
    const state = battle('full', '4k3/8/8/8/8/8/3PQ3/4K3 w - - 0 1', army([]), army([]));
    const queen = state.board[parseSquare('e2')] as number;
    const pawn = state.board[parseSquare('d2')] as number;
    const options: ChoiceOption[] = [
      { kind: 'piece', piece: pawn, square: parseSquare('d2') },
      { kind: 'piece', piece: queen, square: parseSquare('e2') },
    ];
    const request = (purpose: ChoiceRequest['purpose']): ChoiceRequest => ({
      promptId: '0.0',
      chooser: 'white',
      source: { ability: 'test', piece: queen, side: 'white' },
      kind: 'target',
      purpose,
      options,
      defaultOption: 0,
    });
    const pub = engine.project(state, 'white');
    const own = state.armies.white.loadout;
    expect(chooseOption(engine, pub, own, request('protect'), 'trainer')).toBe(1);
    expect(chooseOption(engine, pub, own, request('capture'), 'trainer')).toBe(0);
  });

  it('R-FMT-005 a square prompt names the piece it places (attuned Hit and Run)', () => {
    const state = battle(
      'full',
      '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      army(['hit_and_run'], 'tide'),
      army([]),
    );
    const knight = state.board[parseSquare('c3')] as number;
    const { request } = prompt(state, 'c3d5');
    expect(request.kind).toBe('square');
    expect(request.subject).toBe(knight);
  });
});
