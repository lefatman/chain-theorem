/**
 * NPC knowledge of the M7 content (7.3; spec 6.1, 9.4 R-FMT-005): the Storm, Stone and Frost
 * abilities are profiled from their effect primitives (never their ids), the fast search plays their
 * known reactions (a pushed or home-sent captor, a negated follow-up, a guarded neighbour, a free
 * move for the victim's side), and it knows the three new traits' public effects on a capture
 * (Always First, Bulwark, Stillness). Prompt answers score a piece sent to a fixed square by placing
 * it there.
 *
 * Expected behaviour comes from spec 5.2-5.4, 6.1-6.2 and 9.4, not from the search's current output.
 */
import { describe, expect, it } from 'vitest';
import {
  type AbilityDef,
  type ChoiceRequest,
  type GameState,
  type Loadout,
  parseSquare,
  uciToMove,
} from '@chain-theorem/rules';
import { abilityById, engine } from '../../content/index.ts';
import { scenario, setup } from '../../content/src/testing.ts';
import { type Profile, profileOf, silenced, traitEffects } from './knowledge.ts';
import { chooseOption, play, searchContext, unplay } from './index.ts';

const sq = parseSquare;

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

/** Play `uci` in the fast search seen by `viewer` (true state: full knowledge); undo it after. */
function probe(state: GameState, uci: string, viewer: 'white' | 'black') {
  const ctx = searchContext(engine, state, viewer);
  const before = { board: [...ctx.pos.board], psq: [...ctx.pos.psq] };
  const p = play(ctx, encoded(state, uci));
  const after = { board: [...ctx.pos.board], psq: [...ctx.pos.psq] };
  unplay(ctx, p);
  expect({ board: [...ctx.pos.board], psq: [...ctx.pos.psq] }).toEqual(before);
  return { played: p, after };
}

const KNIGHT = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';

describe('profiles of the Storm, Stone and Frost abilities (R-FMT-005, R-ABIL-002)', () => {
  const cases: [string, Partial<Profile>][] = [
    ['squall', { bonus: true, recaptures: false }],
    ['riposte', { bonus: true, recaptures: true }],
    ['pawn_storm', { bonus: true }],
    ['slipstream', { bonus: true }],
    ['afterimage', { protectsSelf: true, movesEnemy: false }],
    ['buttress', { protectsFriend: true, protectsSelf: true }],
    ['stonewall', { negatesCaptor: true, negatesVictim: false, reveals: true }],
    ['rebuild', { reviveFriendly: true }],
    ['frost_heave', { pushesCaptor: true, sendsCaptorHome: false }],
    ['snowdrift', { movesEnemy: true }],
    ['snowbound', { movesEnemy: true }],
    ['permafrost', { sendsCaptorHome: true, movesEnemy: true, pushesCaptor: false }],
  ];
  for (const [id, expected] of cases) {
    it(`R-FMT-005 ${id} is profiled from its effect primitives`, () => {
      expect(profileOf(ability(id))).toMatchObject(expected);
    });
  }

  it('R-FMT-005 Phalanx negates the victim’s reactions like Pierce, so a pawn capture into a known Poisoned Meat is safe', () => {
    expect(profileOf(ability('phalanx'))).toEqual({
      ...profileOf(ability('pierce')),
      reveals: false,
    });
    const { state } = setup({
      fen: '4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1',
      white: { abilities: ['phalanx'] },
      black: { abilities: ['poisoned_meat'] },
    });
    expect(probe(state, 'e4d5', 'white').played.killed).toBe(-1);
  });

  it('R-FMT-005 R-ELEM-002 silence follows the second triangle too (Storm > Frost > Stone > Storm); cross-triangle pairs are even', () => {
    expect(silenced('storm', 'frost')).toEqual({ victim: true, captor: false });
    expect(silenced('frost', 'stone')).toEqual({ victim: true, captor: false });
    expect(silenced('stone', 'storm')).toEqual({ victim: true, captor: false });
    expect(silenced('frost', 'storm')).toEqual({ victim: false, captor: true });
    expect(silenced('storm', 'ember')).toEqual({ victim: false, captor: false });
    expect(silenced('tide', 'stone')).toEqual({ victim: false, captor: false });
  });

  it('R-FMT-005 R-ELEM-001 trait effects on a capture: Always First, Stillness, Bulwark', () => {
    expect(traitEffects('storm', 'ember')).toEqual({
      stormFirst: true,
      stillness: false,
      captorBulwark: false,
    });
    expect(traitEffects('storm', 'storm').stormFirst).toBe(false);
    expect(traitEffects('ember', 'frost').stillness).toBe(true);
    expect(traitEffects('stone', 'tide').captorBulwark).toBe(true);
  });
});

describe('the fast search plays the new reactions (R-FMT-005)', () => {
  it('R-FMT-005 a known Frost Heave pushes the captor back to its origin, and undo restores the position', () => {
    const { state } = setup({ fen: KNIGHT, black: { abilities: ['frost_heave'] } });
    const { played, after } = probe(state, 'c3d5', 'black');
    const knight = state.board[sq('c3')] as number;
    expect(played.pushed).toBe(knight);
    expect(after.psq[knight]).toBe(sq('c3'));
    expect(after.board[sq('d5')]).toBe(-1);
  });

  it('R-FMT-005 a known Permafrost sends the captor to its starting square', () => {
    const r = scenario({
      fen: 'k7/5p2/8/8/8/8/8/4K1N1 w - - 0 1',
      black: { abilities: ['permafrost'] },
      moves: ['g1f3', 'a8b8', 'f3e5', 'b8a8'],
    });
    const { after } = probe(r.state, 'e5f7', 'black');
    const knight = r.state.board[sq('e5')] as number;
    expect(after.psq[knight]).toBe(sq('g1'));
  });

  it('R-FMT-005 R-ELEM-001 Bulwark: a Stone captor survives a known Poisoned Meat until its Bulwark is spent', () => {
    const { state } = setup({
      fen: KNIGHT,
      white: { elements: ['stone'] },
      black: { elements: ['tide'], abilities: ['poisoned_meat'] },
    });
    expect(probe(state, 'c3d5', 'black').played.killed).toBe(-1);
    const knight = state.board[sq('c3')] as number;
    const spent: GameState = {
      ...state,
      slices: { ...state.slices, bulwark: { spent: [knight] } },
    };
    expect(probe(spent, 'c3d5', 'black').played.killed).toBe(knight);
  });

  it('R-FMT-005 R-ELEM-001 Stillness and a known Stonewall cancel the captor’s follow-up bonus; Always First keeps it', () => {
    const bias = (
      white: Loadout['elements'][number],
      black: Loadout['elements'][number],
      set: string[],
    ) =>
      probe(
        setup({
          fen: '4k3/8/4p3/3p4/8/2N5/8/4K3 w - - 0 1',
          white: { elements: [white], abilities: ['cleave'] },
          black: { elements: [black], abilities: set },
        }).state,
        'c3d5',
        'white',
      ).played.bias;
    // Every case also pays the same risk for capturing a type whose set is not fully known.
    const plain = bias('tide', 'tide', []);
    expect(bias('tide', 'frost', [])).toBe(plain - 70); // Stillness
    expect(bias('tide', 'tide', ['stonewall'])).toBe(plain - 70);
    expect(bias('storm', 'tide', ['stonewall'])).toBe(plain); // Always First resolves Cleave first
  });

  it('R-FMT-005 Buttress cancels the penalty for capturing into a known Backdraft; Squall costs the captor a little tempo', () => {
    const run = (white: string[], black: string[]) =>
      probe(
        setup({
          fen: '4k3/8/8/3p4/4P3/2N5/8/4K3 w - - 0 1',
          white: { abilities: white },
          black: { abilities: black },
        }).state,
        'c3d5',
        'white',
      ).played.bias;
    // Every case also pays the same risk for capturing a type whose set is not fully known.
    const base = run([], []);
    expect(run([], ['backdraft'])).toBe(base - 70);
    expect(run(['buttress'], ['backdraft'])).toBe(base);
    expect(run([], ['squall'])).toBe(base - 15);
    expect(run([], ['riposte'])).toBe(base);
  });
});

describe('prompt answers for the new abilities (R-FMT-005, DD-18)', () => {
  it('R-FMT-005 attuned Snowbound: the NPC sends the queen that could recapture home, not the pawn (default option)', () => {
    const OPENING = ['e2e4', 'e7e5', 'g1f3', 'd7d6', 'd2d4', 'd8f6'];
    const r = scenario({
      white: { elements: ['frost'], abilities: ['snowbound'] },
      moves: OPENING,
    });
    const res = engine.applyAction(r.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('d4e5'),
    });
    if (res.kind !== 'needsChoice') throw new Error('expected the Snowbound prompt');
    const req: ChoiceRequest = res.request;
    expect(req.options.map((o) => (o.kind === 'piece' ? o.square : -1))).toEqual([
      sq('d6'),
      sq('f6'),
    ]);
    for (const tier of ['trainer', 'elite'] as const) {
      const pick = chooseOption(
        engine,
        engine.project(res.state, 'white'),
        r.state.armies.white.loadout,
        req,
        tier,
      );
      expect(pick, tier).toBe(1);
    }
  });
});
