/**
 * NPC awareness of the C7 items (R-FMT-005; DD-126, DD-127): the search reads the viewer's own items
 * and the opponent's revealed ones, never the opponent's true loadout. Duelist's Gauntlet keeps its
 * wearer's When-capturing abilities unsilenced and its When-captured ones silenced by the foil under
 * ONCE_PER_ABILITY after the once; a known, unused Reliquary makes a side's first loss mostly
 * illusory when the piece's start square is empty.
 */
import { describe, expect, it } from 'vitest';
import {
  type ElementId,
  type GameState,
  type PieceType,
  type Side,
  uciToMove,
} from '@chain-theorem/rules';
import { engine, makeEngine } from '../../content/index.ts';
import { idAt, setup } from '../../content/src/testing.ts';
import { VALUE } from './fast.ts';
import { play, searchContext, unplay } from './index.ts';

type Eng = typeof engine;

function encoded(eng: Eng, state: GameState, uci: string): number {
  const ctx = searchContext(eng, state, state.turn);
  const mv = uciToMove(uci);
  const side = state.turn === 'white' ? 0 : 1;
  const m = ctx.pos.legal(side).find((x) => (x & 63) === mv.from && ((x >> 6) & 63) === mv.to);
  if (m === undefined) throw new Error(`illegal ${uci}`);
  return m;
}

/** Play `uci` in the fast search as `viewer` sees it, undo it, and return what the search predicted. */
function probe(eng: Eng, state: GameState, uci: string, viewer: Side) {
  const ctx = searchContext(eng, state, viewer);
  const before = [...ctx.pos.board];
  const p = play(ctx, encoded(eng, state, uci));
  unplay(ctx, p);
  expect([...ctx.pos.board]).toEqual(before);
  return p;
}

/**
 * The viewer's real input: its belief state from its own projection, with the opponent's abilities
 * and items named here added to the reveal log (8.2). Everything else of the opponent's stays hidden.
 */
function belief(
  eng: Eng,
  s: GameState,
  viewer: Side,
  known: { abilities?: Partial<Record<PieceType, string[]>>; items?: string[] } = {},
): GameState {
  const other: Side = viewer === 'white' ? 'black' : 'white';
  const log = s.reveals[other];
  const seen: GameState = {
    ...s,
    reveals: {
      ...s.reveals,
      [other]: {
        ...log,
        abilities: { ...log.abilities, ...(known.abilities ?? {}) },
        items: [...log.items, ...(known.items ?? [])],
      },
    },
  };
  return eng.beliefState(eng.project(seen, viewer), s.armies[viewer].loadout);
}

/** White Grove knight c3 takes the black Ember pawn d5 (Poisoned Meat). Ids: K=0 N=1 p=2 k=3. */
const GROVE_TAKES_EMBER = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
/** Black Grove knight d5 takes the white Ember pawn c3 (Poisoned Meat). Ids: K=0 P=1 n=2 k=3. */
const BLACK_GROVE_TAKES_EMBER = '4k3/8/8/3n4/8/2P5/8/4K3 b - - 0 1';

describe("Duelist's Gauntlet in the search (R-FMT-005, DD-126)", () => {
  it("R-FMT-005 DD-126 the viewer's own Gauntlet keeps its Pierce unsilenced: the Grove knight taking a known Poisoned Meat pawn is rated safe, and killed without the item", () => {
    const armies = {
      white: { elements: ['grove' as ElementId], abilities: ['pierce'] },
      black: { elements: ['ember' as ElementId], abilities: ['poisoned_meat'] },
    };
    const bare = setup({ fen: GROVE_TAKES_EMBER, ...armies }).state;
    const knight = idAt(bare, 'c3');
    const known = { abilities: { pawn: ['poisoned_meat'] } };
    expect(probe(engine, belief(engine, bare, 'white', known), 'c3d5', 'white').killed).toBe(
      knight,
    );
    const worn = setup({
      fen: GROVE_TAKES_EMBER,
      white: { ...armies.white, items: ['duelists_gauntlet'] },
      black: armies.black,
    }).state;
    expect(probe(engine, belief(engine, worn, 'white', known), 'c3d5', 'white').killed).toBe(-1);
  });

  it("R-FMT-005 DD-126 the opponent's Gauntlet counts only once it is revealed: Black's Pierce reads silenced until White has seen the item", () => {
    const s = setup({
      fen: BLACK_GROVE_TAKES_EMBER,
      white: { elements: ['ember'], abilities: ['poisoned_meat'] },
      black: { elements: ['grove'], items: ['duelists_gauntlet'], abilities: ['pierce'] },
    }).state;
    const knight = idAt(s, 'd5');
    const pierceKnown = { abilities: { knight: ['pierce'] } };
    // The true loadout holds the Gauntlet, but White's belief state does not: the item is hidden.
    expect(probe(engine, belief(engine, s, 'white', pierceKnown), 'd5c3', 'white').killed).toBe(
      knight,
    );
    expect(
      probe(
        engine,
        belief(engine, s, 'white', { ...pierceKnown, items: ['duelists_gauntlet'] }),
        'd5c3',
        'white',
      ).killed,
    ).toBe(-1);
  });

  it("R-FMT-005 DD-108 DD-126 under ONCE_PER_ABILITY a known Gauntlet on the victim's side keeps its Poisoned Meat silenced after the once is spent", () => {
    const once = makeEngine({ SILENCE_SCOPE: 'ONCE_PER_ABILITY' });
    const caps = { SILENCE_SCOPE: 'ONCE_PER_ABILITY' as const };
    const armies = {
      white: { elements: ['ember' as ElementId] },
      black: { elements: ['grove' as ElementId], abilities: ['poisoned_meat'] },
    };
    const spent = (s: GameState): GameState => ({
      ...s,
      silenced: { white: [], black: ['pawn:poisoned_meat'] },
    });
    const bare = spent(setup({ fen: GROVE_TAKES_EMBER, caps, ...armies }).state);
    const knight = idAt(bare, 'c3');
    const pmKnown = { abilities: { pawn: ['poisoned_meat'] } };
    // The once is spent: without a Gauntlet Poisoned Meat fires and the knight is rated as killed.
    expect(probe(once, belief(once, bare, 'white', pmKnown), 'c3d5', 'white').killed).toBe(knight);
    const worn = spent(
      setup({
        fen: GROVE_TAKES_EMBER,
        caps,
        white: armies.white,
        black: { ...armies.black, items: ['duelists_gauntlet'] },
      }).state,
    );
    expect(
      probe(
        once,
        belief(once, worn, 'white', { ...pmKnown, items: ['duelists_gauntlet'] }),
        'c3d5',
        'white',
      ).killed,
    ).toBe(-1);
    // Unrevealed, the Gauntlet is not read (R-FMT-005).
    expect(probe(once, belief(once, worn, 'white', pmKnown), 'c3d5', 'white').killed).toBe(knight);
  });
});

describe('Reliquary in the search (R-FMT-005, DD-127)', () => {
  /** Black knight b6 steps to d5; White's knight c3 can take it there. Ids: K=0 N=1 n=2 k=3. */
  const FEN = '4k3/8/1n6/8/8/2N5/8/4K3 b - - 0 1';
  function afterKnightMove(items: string[]): GameState {
    const s = setup({ fen: FEN, black: { items } }).state;
    const r = engine.applyAction(s, { kind: 'move', side: 'black', move: uciToMove('b6d5') });
    if (r.kind !== 'done') throw new Error('unexpected prompt');
    return r.state;
  }
  const discount = Math.round((VALUE[1] as number) * 0.6);

  it("R-FMT-005 DD-127 capturing the first piece of a side with a known, unused Reliquary carries the self-revive discount when the piece's start square is empty", () => {
    const plain = afterKnightMove([]);
    const withItem = afterKnightMove(['reliquary']);
    const base = probe(engine, belief(engine, plain, 'white'), 'c3d5', 'white').bias;
    // Hidden: the true loadout has the Reliquary, the belief state does not.
    expect(probe(engine, belief(engine, withItem, 'white'), 'c3d5', 'white').bias).toBe(base);
    // Revealed and unused: the knight is worth less, since it returns to b6 at the end of the turn.
    expect(
      probe(engine, belief(engine, withItem, 'white', { items: ['reliquary'] }), 'c3d5', 'white')
        .bias,
    ).toBe(base - discount);
  });

  it('R-FMT-005 DD-127 a side that has lost a piece already gets no discount: its payout has come and gone', () => {
    // White's rook takes the pawn a5 first (Black's first loss; the payout fizzles, the rook stands on
    // its start), then the knight b6 steps to d5 and White's knight can take it.
    const s = setup({
      fen: '4k3/8/1n6/p7/8/2N5/8/R3K3 w - - 0 1',
      black: { items: ['reliquary'] },
    }).state;
    let r = engine.applyAction(s, { kind: 'move', side: 'white', move: uciToMove('a1a5') });
    if (r.kind !== 'done') throw new Error('unexpected prompt');
    r = engine.applyAction(r.state, { kind: 'move', side: 'black', move: uciToMove('b6d5') });
    if (r.kind !== 'done') throw new Error('unexpected prompt');
    const plain = setup({ fen: '4k3/8/8/R7/8/2N5/8/4K3 b - - 0 1' });
    void plain;
    const known = belief(engine, r.state, 'white', { items: ['reliquary'] });
    const unknown = belief(engine, r.state, 'white');
    expect(probe(engine, known, 'c3d5', 'white').bias).toBe(
      probe(engine, unknown, 'c3d5', 'white').bias,
    );
  });

  it('DD-127 no discount when the start square is not empty: a piece taken where it started stays taken', () => {
    // The black knight is taken on b6, its own start square, which the captor then occupies.
    const s = setup({
      fen: '4k3/8/1n6/8/2N5/8/8/4K3 w - - 0 1',
      black: { items: ['reliquary'] },
    }).state;
    const plain = setup({ fen: '4k3/8/1n6/8/2N5/8/8/4K3 w - - 0 1' }).state;
    const base = probe(engine, belief(engine, plain, 'white'), 'c4b6', 'white').bias;
    expect(
      probe(engine, belief(engine, s, 'white', { items: ['reliquary'] }), 'c4b6', 'white').bias,
    ).toBe(base);
  });
});
