/**
 * Redo (5.8): Captured, neutral, all, replay, 1 charge. "When captured by a move of a piece of equal
 * or higher rank, the position returns to the moment before the previous action; that action and the
 * capturing reply are undone, pieces removed in them return, and play resumes there. Charges spent
 * (Redo's own included), everything revealed and the clocks are not undone; rewound positions do not
 * count toward repetition; the rewind resolves before any format objective is adjudicated."
 *
 * Expected behaviour comes from spec 4.5 (repetition), 5.1 (rank, DD-97), 5.2 (REWIND), 5.4, 6.2,
 * 7.2 (Warden's Stopwatch), 9.1 (First Blood), INV-04 and DD-100, not from the engine's output.
 */
import { describe, expect, it } from 'vitest';
import { type GameState, parseSquare, toFen } from '@chain-theorem/rules';
import { abilityById } from '../index.ts';
import type { HotFootState } from '../traits/hot_foot.ts';
import { eventsOf, idAt, pieceAt, play, scenario, setup } from '../src/testing.ts';

const sq = parseSquare;
const position = (s: GameState) => ({
  fen: toFen(s),
  turn: s.turn,
  ply: s.ply,
  board: s.board,
  squares: s.pieces.map((p) => p.square),
});

// White rook a1 and king e1; black knight d5 (Redo), pawn h7, king e8. White plays a1-d1 (ply 0),
// Black h7-h6 (ply 1), White d1xd5 (ply 2): the capture rewinds to the start of ply 1.
const FEN = '4k3/7p/8/3n4/8/8/8/R3K3 w - - 0 1';

describe('Redo (5.8, DD-97, DD-100)', () => {
  it('R-ABIL-005 module data: Captured, neutral, all, replay, 1 charge, level 15, a rank condition and a rewind effect', () => {
    const def = abilityById.get('redo');
    expect(def).toMatchObject({
      category: 'CAPTURED',
      affinity: 'neutral',
      eligible: 'all',
      tags: ['replay'],
      minLevel: 15,
      slotCost: 1,
      limits: { perAction: 1, charges: 1 },
      conditions: [{ rank: { of: 'captor', cmp: '>=', to: 'victim' } }],
      effects: [{ op: 'rewind' }],
    });
    expect(def?.attuned).toBeUndefined();
  });

  it('R-ABIL-002 R-ABIL-004 a rook (rank 3) taking the Redo knight rewinds two plies: the knight is back, Black is to move as before its last move', () => {
    const { engine, state: start } = setup({
      fen: FEN,
      black: { abilities: ['redo'] },
    });
    const knight = idAt(start, 'd5');
    const s1 = play(engine, start, 'a1d1').state;
    const beforeBlack = position(s1);
    const s2 = play(engine, s1, 'h7h6').state;
    const { state: s3, step } = play(engine, s2, 'd1d5');
    // The position is the one Black faced before h7-h6: the pawn is back on h7, the knight on d5.
    expect(position(s3)).toEqual(beforeBlack);
    expect(s3.turn).toBe('black');
    expect(s3.ply).toBe(1);
    expect(pieceAt(s3, 'h7')?.type).toBe('pawn');
    expect(s3.pieces[knight]?.square).toBe(sq('d5'));
    expect(pieceAt(s3, 'd1')?.type).toBe('rook');
    expect(s3.result).toBeNull();
    expect(s3.pending).toBeNull();
    // The events tell the story: capture, trigger, rewind, charge, turn.
    expect(eventsOf(step.events, 'Captured')).toHaveLength(1);
    expect(eventsOf(step.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ side: 'black', ability: 'redo', piece: knight }),
    ]);
    expect(eventsOf(step.events, 'Rewound')).toEqual([
      expect.objectContaining({ side: 'black', toPly: 1, toTurn: 'black', plies: 2 }),
    ]);
    expect(eventsOf(step.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ ability: 'redo', remaining: 0 }),
    ]);
    // The turn did not pass: no TurnPassed, the Rewound event names the side to move.
    expect(eventsOf(step.events, 'TurnPassed')).toEqual([]);
    expect(step.events.at(-1)?.k).toBe('Rewound');
    // Spent charges and reveals survive the rewind (DD-100).
    expect(s3.usage[`${knight}:redo`]).toBe(1);
    expect(s3.reveals.black.abilities.knight).toEqual(['redo']);
    expect(engine.remainingCharges(s3, knight, 'redo')).toBe(0);
  });

  it('DD-97 only a captor of equal or higher rank triggers it: a pawn capture stands, a bishop (equal) capture rewinds', () => {
    // Pawn e4 takes the knight d5: rank 1 < 2, no trigger.
    const pawn = scenario({
      fen: '4k3/7p/8/3n4/4P3/8/8/4K3 w - - 0 1',
      black: { abilities: ['redo'] },
      moves: ['e1f1', 'h7h6', 'e4d5'],
    });
    expect(eventsOf(pawn.events, 'AbilityTriggered')).toEqual([]);
    expect(eventsOf(pawn.events, 'Rewound')).toEqual([]);
    expect(pieceAt(pawn.state, 'd5')).toMatchObject({ type: 'pawn', side: 'white' });
    // Bishop b3 takes the knight d5: rank 2 = 2, it rewinds.
    const bishop = scenario({
      fen: '4k3/7p/8/3n4/8/1B6/8/4K3 w - - 0 1',
      black: { abilities: ['redo'] },
      moves: ['e1f1', 'h7h6', 'b3d5'],
    });
    expect(eventsOf(bishop.events, 'Rewound')).toHaveLength(1);
    expect(pieceAt(bishop.state, 'd5')).toMatchObject({ type: 'knight', side: 'black' });
    expect(pieceAt(bishop.state, 'h7')?.type).toBe('pawn');
  });

  it('DD-100 captured in the first action of the battle: only that action is undone and White moves again', () => {
    const r = scenario({ fen: FEN, black: { abilities: ['redo'] }, moves: ['a1d1'] });
    // No capture yet: nothing happened. Now a position where the first move captures.
    expect(eventsOf(r.events, 'Rewound')).toEqual([]);
    const first = scenario({
      fen: '4k3/7p/8/3n4/8/8/8/3RK3 w - - 0 1',
      black: { abilities: ['redo'] },
      moves: ['d1d5'],
    });
    expect(eventsOf(first.events, 'Rewound')).toEqual([
      expect.objectContaining({ side: 'black', toPly: 0, toTurn: 'white', plies: 1 }),
    ]);
    expect(first.state.turn).toBe('white');
    expect(first.state.ply).toBe(0);
    expect(toFen(first.state)).toBe(toFen(first.initial));
    expect(first.state.usage[`${idAt(first.initial, 'd5')}:redo`]).toBe(1);
  });

  it('DD-17 one charge: the second qualifying capture of the same piece is not undone', () => {
    const { engine, state } = setup({ fen: FEN, black: { abilities: ['redo'] } });
    let s = state;
    for (const m of ['a1d1', 'h7h6', 'd1d5']) s = play(engine, s, m).state;
    expect(pieceAt(s, 'd5')?.type).toBe('knight');
    // Black moves again, White captures again: the charge is gone, the knight falls.
    s = play(engine, s, 'h7h5').state;
    const { state: after, step } = play(engine, s, 'd1d5');
    expect(eventsOf(step.events, 'AbilityTriggered')).toEqual([]);
    expect(eventsOf(step.events, 'Rewound')).toEqual([]);
    expect(pieceAt(after, 'd5')).toMatchObject({ type: 'rook', side: 'white' });
    expect(after.turn).toBe('black');
  });

  it('R-RULES-005 DD-100 rewound positions leave the repetition history, and nothing queued after the rewind resolves', () => {
    const { engine, state } = setup({
      fen: FEN,
      white: { abilities: ['cleave'] },
      black: { abilities: ['redo'] },
    });
    const s1 = play(engine, state, 'a1d1').state;
    const s2 = play(engine, s1, 'h7h6').state;
    const { state: s3, step } = play(engine, s2, 'd1d5');
    expect(s3.repetition).toEqual(s1.repetition);
    expect(s3.repetition).toHaveLength(s1.repetition.length);
    // The captor's Cleave (Captures) was queued after the victim's Redo and never ran.
    expect(eventsOf(step.events, 'AbilityTriggered').map((e) => e.ability)).toEqual(['redo']);
    expect(step.prompts).toEqual([]);
  });

  it('R-FMT-002 9.1 First Blood: a capture that would win is undone before the objective is adjudicated', () => {
    const r = scenario({
      fen: FEN,
      format: 'first_blood',
      black: { abilities: ['redo'] },
      moves: ['a1d1', 'h7h6', 'd1d5'],
    });
    expect(r.state.result).toBeNull();
    expect(r.state.objective).toEqual({ white: 0, black: 0 });
    expect(eventsOf(r.events, 'BattleEnded')).toEqual([]);
    // Control: without Redo the capture ends the battle.
    const plain = scenario({ fen: FEN, format: 'first_blood', moves: ['a1d1', 'h7h6', 'd1d5'] });
    expect(plain.state.result).toEqual({ winner: 'white', reason: 'objective' });
  });

  it('R-ELEM-005 DD-100 public state of the undone plies is undone too: a burn lit in them is gone', () => {
    // The White Ember knight takes the pawn d5 (pending burn, ply 0). Two quiet plies later it
    // leaves d5 to take the Redo bishop f4 (ply 4): d5 ignites, Redo (2 >= 2) rewinds to the start
    // of ply 3, and the fire lit in ply 4 is gone with the ply.
    // Only the bishop carries Redo (per-type sets), so the pawn's capture does not rewind.
    const r = scenario({
      fen: '4k3/8/8/3p4/5b2/2N5/8/4K3 w - - 0 1',
      white: { elements: ['ember'] },
      black: {
        elements: ['tide'],
        items: ['multitaskers_schedule'],
        sets: [[], [], ['redo'], [], [], []],
      },
      moves: ['c3d5', 'e8d8', 'e1f1', 'd8e8', 'd5f4'],
    });
    expect(eventsOf(r.events, 'SquareIgnited').map((e) => e.square)).toEqual([sq('d5')]);
    expect(eventsOf(r.events, 'Rewound')).toEqual([
      expect.objectContaining({ side: 'black', toPly: 3, plies: 2 }),
    ]);
    const hot = r.state.slices.hot_foot as HotFootState;
    expect(hot.burning).toEqual([]);
    expect(hot.pending).toEqual([{ piece: idAt(r.initial, 'c3'), sq: sq('d5') }]);
    expect(pieceAt(r.state, 'd5')?.type).toBe('knight');
    expect(pieceAt(r.state, 'f4')?.type).toBe('bishop');
    expect(pieceAt(r.state, 'd8')?.type).toBe('king');
    expect(pieceAt(r.state, 'f1')?.type).toBe('king');
    expect(r.state.turn).toBe('black');
    expect(r.state.ply).toBe(3);
  });

  it('R-LOAD-002 D-39 Warden’s Stopwatch negates Redo (replay); the foil’s silence stops it too', () => {
    const stop = scenario({
      fen: FEN,
      white: { items: ['wardens_stopwatch'] },
      black: { abilities: ['redo'] },
      moves: ['a1d1', 'h7h6', 'd1d5'],
    });
    expect(eventsOf(stop.events, 'AbilityNegated').map((e) => e.ability)).toEqual(['redo']);
    expect(eventsOf(stop.events, 'Rewound')).toEqual([]);
    expect(pieceAt(stop.state, 'd5')?.type).toBe('rook');
    const silenced = scenario({
      fen: FEN,
      white: { elements: ['ember'] },
      black: { elements: ['grove'], abilities: ['redo'] },
      moves: ['a1d1', 'h7h6', 'd1d5'],
    });
    expect(eventsOf(silenced.events, 'AbilitySilenced').map((e) => e.ability)).toEqual(['redo']);
    expect(eventsOf(silenced.events, 'Rewound')).toEqual([]);
  });

  it('INV-04 R-SEC-001 the snapshots are engine-private: neither projection carries the history, and a JSON round trip replays identically', () => {
    const { engine, state } = setup({ fen: FEN, black: { abilities: ['redo'] } });
    const s1 = play(engine, state, 'a1d1').state;
    expect(s1.history).toHaveLength(1);
    const s2 = play(engine, s1, 'h7h6').state;
    expect(s2.history?.map((h) => h.ply)).toEqual([0, 1]);
    for (const viewer of ['white', 'black'] as const) {
      expect(JSON.stringify(engine.project(s2, viewer))).not.toContain('"history"');
    }
    expect(JSON.stringify(engine.projectSpectator(s2))).not.toContain('"history"');
    const fromJson = JSON.parse(JSON.stringify(s2)) as GameState;
    const a = play(engine, s2, 'd1d5').state;
    const b = play(engine, fromJson, 'd1d5').state;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    // Only the last two snapshots are ever kept, so nothing older than the restored position
    // remains; the next action starts the history afresh.
    expect(a.history).toEqual([]);
    const next = play(engine, a, 'h7h5').state;
    expect(next.history?.map((h) => h.ply)).toEqual([1]);
  });

  it('DD-100 no snapshots are kept when nobody carries a rewind ability', () => {
    const { engine, state } = setup({ fen: FEN });
    const s1 = play(engine, state, 'a1d1').state;
    expect(s1.history).toBeUndefined();
  });
});
