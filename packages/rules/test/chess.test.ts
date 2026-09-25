/**
 * M1 steps 1.2 and 1.4: the chess core through the public engine API with an empty content registry
 * (spec 4.1, 4.2, 4.5, 13.2, 16 M1; DD-10, DD-25, DD-33, DD-34). No content is imported (R-DATA-001):
 * the engine is built from an empty registry and a CAPS copy that mirrors packages/content/config.ts.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ActionInput,
  type ApplyResult,
  type BattleEvent,
  type Caps,
  type ContentRegistry,
  type Engine,
  type EventKind,
  type FormatId,
  type GameState,
  type Loadout,
  type Move,
  type PieceState,
  type Side,
  RulesError,
  START_FEN,
  createEngine,
  moveToUci,
  opposite,
  parseSquare,
  uciToMove,
} from '../src/index.ts';

// ---- engine under test ------------------------------------------------------------------------

const emptyRegistry: ContentRegistry = { abilities: [], items: [], traits: [], version: 'test' };

const FORMATS: Caps['FORMATS'] = {
  first_blood: {
    id: 'first_blood',
    name: 'First Blood',
    objective: { nonPawnCaptures: 1 },
    clock: { initialMs: 3 * 60_000, incrementMs: 2_000 },
  },
  vanguard: {
    id: 'vanguard',
    name: 'Vanguard',
    objective: { nonPawnCaptures: 3 },
    clock: { initialMs: 5 * 60_000, incrementMs: 3_000 },
  },
  full: {
    id: 'full',
    name: 'Full Battle',
    objective: null,
    clock: { initialMs: 10 * 60_000, incrementMs: 5_000 },
  },
};

const caps: Caps = {
  LEVEL_CAP: 30,
  itemSlots: (level: number) => Math.min(6, 1 + Math.floor(level / 5)),
  MAX_ITEM_SLOTS: 6,
  BASE_ABILITY_CAPACITY: 1,
  MAX_ABILITY_CAPACITY: 5,
  MAX_CHAIN_DEPTH: 3,
  SILENCE_SCOPE: 'ALL_TRIGGERS',
  ENABLED_ELEMENTS: ['ember', 'tide', 'grove'],
  FORMATS,
  MAX_EVENTS_PER_ACTION: 512,
};

const engine = createEngine(emptyRegistry, caps);

const NEUTRAL: Loadout = { elements: ['neutral'], items: [], sets: [[]] };

// ---- helpers ----------------------------------------------------------------------------------

type Done = Extract<ApplyResult, { kind: 'done' }>;
type EventOf<K extends EventKind> = Extract<BattleEvent, { k: K }>;

const sq = parseSquare;

function start(
  fen?: string,
  eng: Engine = engine,
  format: FormatId = 'full',
): { state: GameState; events: BattleEvent[] } {
  return eng.newBattle({
    format,
    white: { level: 1, loadout: NEUTRAL },
    black: { level: 1, loadout: NEUTRAL },
    ...(fen === undefined ? {} : { fen }),
  });
}

function moveInput(state: GameState, uci: string): ActionInput {
  return { kind: 'move', side: state.turn, move: uciToMove(uci) };
}

function play(state: GameState, uci: string, eng: Engine = engine): Done {
  const r = eng.applyAction(state, moveInput(state, uci));
  if (r.kind !== 'done') throw new Error(`unexpected choice prompt after ${uci}`);
  return r;
}

function playLine(
  state: GameState,
  ucis: readonly string[],
): { state: GameState; events: BattleEvent[]; steps: Done[] } {
  let s = state;
  const events: BattleEvent[] = [];
  const steps: Done[] = [];
  for (const u of ucis) {
    const r = play(s, u);
    steps.push(r);
    events.push(...r.events);
    s = r.state;
  }
  return { state: s, events, steps };
}

function legalUci(state: GameState, side: Side = state.turn): string[] {
  return engine.legalMoves(state, side).map(moveToUci).sort();
}

const kinds = (events: readonly BattleEvent[]): EventKind[] => events.map((e) => e.k);

function ofKind<K extends EventKind>(events: readonly BattleEvent[], k: K): EventOf<K>[] {
  return events.filter((e): e is EventOf<K> => e.k === k);
}

function at(state: GameState, name: string): PieceState | undefined {
  const id = state.board[sq(name)] ?? -1;
  return id >= 0 ? state.pieces[id] : undefined;
}

function idAt(state: GameState, name: string): number {
  const p = at(state, name);
  if (!p) throw new Error(`no piece on ${name}`);
  return p.id;
}

function errorCode(fn: () => unknown): string | null {
  try {
    fn();
  } catch (e) {
    if (e instanceof RulesError) return e.code;
    throw e;
  }
  return null;
}

/** Full-engine perft: every node is reached through legalMoves + applyAction. */
function enginePerft(state: GameState, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of engine.legalMoves(state, state.turn)) {
    const r = engine.applyAction(state, { kind: 'move', side: state.turn, move: m });
    if (r.kind !== 'done') throw new Error('unexpected choice prompt in perft');
    n += enginePerft(r.state, depth - 1);
  }
  return n;
}

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const CASTLE_FEN = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

// ---- R-RULES-001: standard chess -------------------------------------------------------------

describe('R-RULES-001 start position and piece identities', () => {
  it('R-RULES-001 R-DATA-002 newBattle builds the standard start with 20 legal moves for white', () => {
    const { state, events } = start();
    expect(engine.toFen(state)).toBe(START_FEN);
    expect(state.turn).toBe('white');
    expect(state.castling).toBe(15);
    expect(state.ep).toBe(-1);
    expect(state.result).toBeNull();
    expect(state.pieces).toHaveLength(32);
    // Ids in square order a1..h8 (spec 5.4): white 0..15, black 16..31.
    expect(at(state, 'a1')).toMatchObject({ id: 0, side: 'white', type: 'rook' });
    expect(at(state, 'e1')).toMatchObject({
      id: 4,
      side: 'white',
      type: 'king',
      element: 'neutral',
    });
    expect(at(state, 'a7')).toMatchObject({ id: 16, side: 'black', type: 'pawn' });
    expect(at(state, 'e8')).toMatchObject({ id: 28, side: 'black', type: 'king' });
    const expected = [
      ...'abcdefgh'.split('').flatMap((f) => [`${f}2${f}3`, `${f}2${f}4`]),
      'b1a3',
      'b1c3',
      'g1f3',
      'g1h3',
    ].sort();
    expect(legalUci(state)).toEqual(expected);
    expect(legalUci(state)).toHaveLength(20);
    expect(events).toEqual([
      { k: 'BattleStarted', i: 0, depth: 0, format: 'full', contentVersion: 'test' },
    ]);
  });

  it('R-RULES-001 black has 20 replies to 1.e4 and the side to move alternates', () => {
    const r = play(start().state, 'e2e4');
    expect(r.state.turn).toBe('black');
    expect(legalUci(r.state)).toHaveLength(20);
    expect(errorCode(() => engine.applyAction(r.state, moveInput(r.state, 'e7e5')))).toBeNull();
  });

  it('R-RULES-001 INV-03 a pinned piece cannot move and a king cannot step into attack', () => {
    const pinned = start('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1').state;
    expect(legalUci(pinned).filter((u) => u.startsWith('e2'))).toEqual([]);
    expect(errorCode(() => play(pinned, 'e2d3'))).toBe('illegal_move');
    const king = start('4k3/8/8/8/8/8/3r4/4K3 w - - 0 1').state;
    expect(legalUci(king)).toEqual(['e1d2', 'e1f1']);
    expect(errorCode(() => play(king, 'e1e2'))).toBe('illegal_move');
  });
});

describe('R-RULES-001 castling', () => {
  const cases = [
    {
      name: 'white king side',
      fen: CASTLE_FEN,
      uci: 'e1g1',
      rookFrom: 'h1',
      rookTo: 'f1',
      flag: 'K' as const,
      after: 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1',
    },
    {
      name: 'white queen side',
      fen: CASTLE_FEN,
      uci: 'e1c1',
      rookFrom: 'a1',
      rookTo: 'd1',
      flag: 'Q' as const,
      after: 'r3k2r/8/8/8/8/8/8/2KR3R b kq - 1 1',
    },
    {
      name: 'black king side',
      fen: 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1',
      uci: 'e8g8',
      rookFrom: 'h8',
      rookTo: 'f8',
      flag: 'K' as const,
      after: 'r4rk1/8/8/8/8/8/8/R3K2R w KQ - 1 2',
    },
    {
      name: 'black queen side',
      fen: 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1',
      uci: 'e8c8',
      rookFrom: 'a8',
      rookTo: 'd8',
      flag: 'Q' as const,
      after: '2kr3r/8/8/8/8/8/8/R3K2R w KQ - 1 2',
    },
  ];

  for (const c of cases) {
    it(`R-RULES-001 castling ${c.name} moves king and rook and emits MoveMade with castle ${c.flag}`, () => {
      const s0 = start(c.fen).state;
      const side = s0.turn;
      const kingFrom = c.uci.slice(0, 2);
      const kingTo = c.uci.slice(2, 4);
      const kingId = idAt(s0, kingFrom);
      const rookId = idAt(s0, c.rookFrom);
      expect(legalUci(s0)).toContain(c.uci);
      const r = play(s0, c.uci);
      expect(at(r.state, kingTo)).toMatchObject({ id: kingId, type: 'king', side });
      expect(at(r.state, c.rookTo)).toMatchObject({ id: rookId, type: 'rook', side });
      expect(at(r.state, kingFrom)).toBeUndefined();
      expect(at(r.state, c.rookFrom)).toBeUndefined();
      // Castling is not a capture and triggers nothing (4.2).
      expect(kinds(r.events)).toEqual(['ActionStarted', 'MoveMade', 'TurnPassed']);
      expect(ofKind(r.events, 'MoveMade')[0]).toMatchObject({
        side,
        piece: kingId,
        pieceType: 'king',
        from: sq(kingFrom),
        to: sq(kingTo),
        capture: false,
        castle: c.flag,
        bonus: false,
      });
      expect(engine.toFen(r.state)).toBe(c.after);
    });
  }

  const legality: { fen: string; allowed: string[]; forbidden: string[]; why: string }[] = [
    {
      fen: '4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1',
      allowed: ['e1c1'],
      forbidden: ['e1g1'],
      why: 'through an attacked f1',
    },
    {
      fen: '4k1r1/8/8/8/8/8/8/R3K2R w KQ - 0 1',
      allowed: ['e1c1'],
      forbidden: ['e1g1'],
      why: 'into an attacked g1',
    },
    {
      fen: '3rk3/8/8/8/8/8/8/R3K2R w KQ - 0 1',
      allowed: ['e1g1'],
      forbidden: ['e1c1'],
      why: 'through an attacked d1',
    },
    {
      fen: '2r1k3/8/8/8/8/8/8/R3K2R w KQ - 0 1',
      allowed: ['e1g1'],
      forbidden: ['e1c1'],
      why: 'into an attacked c1',
    },
    {
      fen: '4r1k1/8/8/8/8/8/8/R3K2R w KQ - 0 1',
      allowed: [],
      forbidden: ['e1g1', 'e1c1'],
      why: 'out of check',
    },
    {
      fen: 'r3k2r/8/8/8/8/8/8/4KR2 b kq - 0 1',
      allowed: ['e8c8'],
      forbidden: ['e8g8'],
      why: 'black through an attacked f8',
    },
    {
      fen: 'r3k2r/8/8/8/8/8/8/4R1K1 b kq - 0 1',
      allowed: [],
      forbidden: ['e8g8', 'e8c8'],
      why: 'black out of check',
    },
    {
      fen: 'r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1',
      allowed: ['e1g1'],
      forbidden: ['e1c1'],
      why: 'with a piece between king and rook',
    },
    {
      fen: '1r2k3/8/8/8/8/8/8/R3K2R w KQ - 0 1',
      allowed: ['e1g1', 'e1c1'],
      forbidden: [],
      why: 'is legal when only b1 (rook path) is attacked',
    },
    {
      fen: '4k2r/8/8/8/8/8/8/R3K2R w KQ - 0 1',
      allowed: ['e1g1', 'e1c1'],
      forbidden: [],
      why: 'is legal when only the rook is attacked',
    },
  ];

  for (const c of legality) {
    it(`R-RULES-001 castling ${c.why} (${c.fen})`, () => {
      const s = start(c.fen).state;
      const legal = legalUci(s);
      for (const u of c.allowed) expect(legal).toContain(u);
      for (const u of c.forbidden) {
        expect(legal).not.toContain(u);
        expect(errorCode(() => play(s, u))).toBe('illegal_move');
      }
    });
  }

  it('R-RULES-001 castling rights are lost after the king moves, even if it returns', () => {
    const s0 = start(CASTLE_FEN).state;
    const one = play(s0, 'e1f1').state;
    expect(one.castling).toBe(4 | 8);
    const { state } = playLine(one, ['e8f8', 'f1e1', 'f8e8']);
    expect(state.castling).toBe(0);
    expect(engine.toFen(state)).toBe('r3k2r/8/8/8/8/8/8/R3K2R w - - 4 3');
    expect(legalUci(state)).not.toContain('e1g1');
    expect(legalUci(state)).not.toContain('e1c1');
    const black = play(state, 'a1b1').state;
    expect(legalUci(black)).not.toContain('e8g8');
    expect(legalUci(black)).not.toContain('e8c8');
  });

  it('R-RULES-001 castling rights are lost on one side only after that rook moves', () => {
    const { state } = playLine(start(CASTLE_FEN).state, ['h1h2', 'a8a7', 'h2h1', 'a7a8']);
    expect(state.castling).toBe(2 | 4);
    expect(engine.toFen(state)).toBe('r3k2r/8/8/8/8/8/8/R3K2R w Qk - 4 3');
    expect(legalUci(state)).toContain('e1c1');
    expect(legalUci(state)).not.toContain('e1g1');
    const black = play(state, 'h1h2').state;
    expect(legalUci(black)).toContain('e8g8');
    expect(legalUci(black)).not.toContain('e8c8');
  });

  it('R-RULES-001 castling right is lost when a rook is captured on its home square', () => {
    const s0 = start('r3k2r/8/6N1/8/8/8/8/R3K2R w KQkq - 0 1').state;
    const rookId = idAt(s0, 'h8');
    const r = play(s0, 'g6h8');
    expect(ofKind(r.events, 'Captured')[0]).toMatchObject({ victim: rookId, square: sq('h8') });
    expect(r.state.castling).toBe(1 | 2 | 8);
    expect(engine.toFen(r.state).split(' ')[2]).toBe('KQq');
    expect(legalUci(r.state)).toContain('e8c8');
    expect(legalUci(r.state)).not.toContain('e8g8');
  });

  it('R-RULES-001 a replacement rook on the home square does not restore a lost castling right', () => {
    // Bxa1 removes the a1 rook; the a3 rook recaptures on a1, but queen-side rights stay lost.
    const s0 = start('r3k2r/7p/8/8/8/R7/1b6/R3K2R b KQkq - 0 1').state;
    const { state } = playLine(s0, ['b2a1', 'a3a1', 'h7h6']);
    expect(at(state, 'a1')).toMatchObject({ type: 'rook', side: 'white' });
    expect(engine.toFen(state).split(' ')[2]).toBe('Kkq');
    expect(legalUci(state)).toContain('e1g1');
    expect(legalUci(state)).not.toContain('e1c1');
  });

  it('R-RULES-001 a rook capturing a rook on its home square clears both sides rights', () => {
    const r = play(start(CASTLE_FEN).state, 'a1a8');
    expect(r.state.castling).toBe(1 | 4);
    expect(engine.toFen(r.state).split(' ')[2]).toBe('Kk');
    expect(ofKind(r.events, 'Check')).toEqual([
      expect.objectContaining({ side: 'black', square: sq('e8') }),
    ]);
    expect(legalUci(r.state)).not.toContain('e8g8');
  });
});

describe('R-RULES-001 en passant', () => {
  const WHITE_EP = '4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1';

  it('R-RULES-001 en passant immediately after the double push captures the passed pawn', () => {
    const s0 = start(WHITE_EP).state;
    const blackPawn = idAt(s0, 'd7');
    const whitePawn = idAt(s0, 'e5');
    const pushed = play(s0, 'd7d5').state;
    expect(engine.toFen(pushed)).toBe('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2');
    expect(legalUci(pushed)).toContain('e5d6');
    const r = play(pushed, 'e5d6');
    expect(kinds(r.events)).toEqual(['ActionStarted', 'Captured', 'MoveMade', 'TurnPassed']);
    expect(ofKind(r.events, 'Captured')[0]).toMatchObject({
      victim: blackPawn,
      victimSide: 'black',
      victimType: 'pawn',
      square: sq('d5'),
      by: 'move',
      captor: whitePawn,
    });
    expect(ofKind(r.events, 'MoveMade')[0]).toMatchObject({
      side: 'white',
      piece: whitePawn,
      pieceType: 'pawn',
      from: sq('e5'),
      to: sq('d6'),
      capture: true,
      enPassant: true,
      bonus: false,
    });
    expect(at(r.state, 'd5')).toBeUndefined();
    expect(at(r.state, 'e5')).toBeUndefined();
    expect(at(r.state, 'd6')?.id).toBe(whitePawn);
    expect(r.state.pieces[blackPawn]?.square).toBe(-1);
    expect(r.state.halfmove).toBe(0);
    expect(engine.toFen(r.state)).toBe('4k3/8/3P4/8/8/8/8/4K3 b - - 0 2');
  });

  it('R-RULES-001 black captures en passant on the third rank', () => {
    const s0 = start('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1').state;
    const whitePawn = idAt(s0, 'e2');
    const r = play(play(s0, 'e2e4').state, 'd4e3');
    expect(ofKind(r.events, 'Captured')[0]).toMatchObject({
      victim: whitePawn,
      square: sq('e4'),
      by: 'move',
    });
    expect(ofKind(r.events, 'MoveMade')[0]).toMatchObject({ enPassant: true, capture: true });
    expect(at(r.state, 'e3')).toMatchObject({ side: 'black', type: 'pawn' });
    expect(at(r.state, 'e4')).toBeUndefined();
  });

  it('R-RULES-001 en passant is no longer legal one move pair after the double push', () => {
    const { state } = playLine(start(WHITE_EP).state, ['d7d5', 'e1e2', 'e8e7']);
    expect(state.ep).toBe(-1);
    expect(legalUci(state)).not.toContain('e5d6');
    expect(errorCode(() => play(state, 'e5d6'))).toBe('illegal_move');
  });

  it('R-RULES-001 two single pushes never allow en passant', () => {
    const { state } = playLine(start(WHITE_EP).state, ['d7d6', 'e1e2', 'd6d5']);
    expect(engine.toFen(state).split(' ')[3]).toBe('-');
    expect(legalUci(state)).not.toContain('e5d6');
  });

  it('R-RULES-001 INV-03 en passant that exposes the own king along the rank is illegal', () => {
    const pushed = play(start('8/3p4/8/K3P2r/8/8/8/4k3 b - - 0 1').state, 'd7d5').state;
    expect(legalUci(pushed)).not.toContain('e5d6');
    expect(legalUci(pushed)).toContain('e5e6');
  });
});

describe('R-RULES-001 promotion', () => {
  const PROMO = '4k3/P7/8/8/8/8/8/4K3 w - - 0 1';

  it('R-RULES-001 promotion offers exactly four pieces and every promotion move names one', () => {
    const s = start(PROMO).state;
    const fromA7 = engine.legalMoves(s, 'white').filter((m) => m.from === sq('a7'));
    expect(fromA7.map(moveToUci).sort()).toEqual(['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r']);
    expect(fromA7.every((m) => m.promotion !== undefined)).toBe(true);
    const black = start('4k3/8/8/8/8/8/p7/4K3 b - - 0 1').state;
    const fromA2 = engine.legalMoves(black, 'black').filter((m) => m.from === sq('a2'));
    expect(fromA2.map(moveToUci).sort()).toEqual(['a2a1b', 'a2a1n', 'a2a1q', 'a2a1r']);
  });

  it('R-RULES-001 a promotion move without an explicit promotion field is illegal', () => {
    const s = start(PROMO).state;
    const noPromo: ActionInput = {
      kind: 'move',
      side: 'white',
      move: { from: sq('a7'), to: sq('a8') },
    };
    expect(errorCode(() => engine.applyAction(s, noPromo))).toBe('illegal_move');
    // A promotion field on a move that does not promote is illegal too.
    const e4q: ActionInput = {
      kind: 'move',
      side: 'white',
      move: { from: sq('e2'), to: sq('e4'), promotion: 'queen' },
    };
    expect(errorCode(() => engine.applyAction(start().state, e4q))).toBe('illegal_move');
  });

  it('R-RULES-001 under-promotion keeps the piece id and emits MoveMade then Promoted', () => {
    const s0 = start(PROMO).state;
    const pawn = idAt(s0, 'a7');
    const r = play(s0, 'a7a8n');
    expect(kinds(r.events)).toEqual(['ActionStarted', 'MoveMade', 'Promoted', 'TurnPassed']);
    expect(ofKind(r.events, 'MoveMade')[0]).toMatchObject({
      piece: pawn,
      pieceType: 'pawn',
      from: sq('a7'),
      to: sq('a8'),
      capture: false,
      promotion: 'knight',
    });
    expect(ofKind(r.events, 'Promoted')[0]).toMatchObject({
      piece: pawn,
      side: 'white',
      to: 'knight',
      element: 'neutral',
    });
    expect(at(r.state, 'a8')).toMatchObject({ id: pawn, type: 'knight', side: 'white' });
    expect(engine.toFen(r.state)).toBe('N3k3/8/8/8/8/8/8/4K3 b - - 0 1');
  });

  it('R-RULES-001 capture-promotion to a rook that gives check emits Captured, MoveMade, Promoted, Check', () => {
    const s0 = start('1r2k3/P7/8/8/8/8/8/4K3 w - - 0 1').state;
    const victim = idAt(s0, 'b8');
    const r = play(s0, 'a7b8r');
    expect(kinds(r.events)).toEqual([
      'ActionStarted',
      'Captured',
      'MoveMade',
      'Promoted',
      'TurnPassed',
      'Check',
    ]);
    expect(ofKind(r.events, 'Captured')[0]).toMatchObject({ victim, victimType: 'rook' });
    expect(ofKind(r.events, 'MoveMade')[0]).toMatchObject({ capture: true, promotion: 'rook' });
    expect(ofKind(r.events, 'Check')[0]).toMatchObject({ side: 'black', square: sq('e8') });
    expect(r.state.inCheck).toBe('black');
  });

  it('R-RULES-001 black promotes to a queen with check', () => {
    const r = play(start('4k3/8/8/8/8/8/p7/4K3 b - - 0 1').state, 'a2a1q');
    expect(ofKind(r.events, 'Promoted')[0]).toMatchObject({ side: 'black', to: 'queen' });
    expect(ofKind(r.events, 'Check')[0]).toMatchObject({ side: 'white', square: sq('e1') });
    expect(engine.toFen(r.state)).toBe('4k3/8/8/8/8/8/8/q3K3 w - - 0 2');
  });
});

describe('R-RULES-001 check', () => {
  it('R-RULES-001 a checking move emits one Check event and only evasions stay legal', () => {
    const r = play(start('4k3/8/8/8/8/8/8/R3K3 w - - 0 1').state, 'a1a8');
    expect(kinds(r.events)).toEqual(['ActionStarted', 'MoveMade', 'TurnPassed', 'Check']);
    expect(ofKind(r.events, 'Check')).toEqual([
      expect.objectContaining({ k: 'Check', side: 'black', square: sq('e8') }),
    ]);
    expect(r.state.inCheck).toBe('black');
    expect(r.state.result).toBeNull();
    expect(legalUci(r.state)).toEqual(['e8d7', 'e8e7', 'e8f7']);
  });

  it('R-RULES-001 a quiet move emits no Check and clears inCheck', () => {
    const checked = play(start('4k3/8/8/8/8/8/8/R3K3 w - - 0 1').state, 'a1a8').state;
    const r = play(checked, 'e8e7');
    expect(ofKind(r.events, 'Check')).toEqual([]);
    expect(r.state.inCheck).toBeNull();
  });
});

// ---- R-RULES-005: win, loss and draw -----------------------------------------------------------

describe('R-RULES-005 checkmate and stalemate', () => {
  it("R-RULES-005 fool's mate ends with BattleEnded checkmate for black", () => {
    const { state, steps } = playLine(start().state, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    const last = steps[steps.length - 1] as Done;
    expect(kinds(last.events)).toEqual([
      'ActionStarted',
      'MoveMade',
      'TurnPassed',
      'Check',
      'BattleEnded',
    ]);
    expect(ofKind(last.events, 'Check')[0]).toMatchObject({ side: 'white', square: sq('e1') });
    expect(last.events[last.events.length - 1]).toMatchObject({
      k: 'BattleEnded',
      result: { winner: 'black', reason: 'checkmate' },
    });
    expect(state.result).toEqual({ winner: 'black', reason: 'checkmate' });
    for (const s of steps.slice(0, -1)) expect(ofKind(s.events, 'BattleEnded')).toEqual([]);
    expect(engine.legalMoves(state, 'white')).toEqual([]);
    expect(engine.legalMoves(state, 'black')).toEqual([]);
  });

  it('R-RULES-005 a back-rank mate wins for white', () => {
    const r = play(start('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1').state, 'a1a8');
    expect(r.state.result).toEqual({ winner: 'white', reason: 'checkmate' });
  });

  it('R-RULES-005 a stalemate is a draw and emits no Check', () => {
    const r = play(start('7k/4Q3/6K1/8/8/8/8/8 w - - 0 1').state, 'e7f7');
    expect(kinds(r.events)).toEqual(['ActionStarted', 'MoveMade', 'TurnPassed', 'BattleEnded']);
    expect(r.state.result).toEqual({ winner: null, reason: 'stalemate' });
    expect(ofKind(r.events, 'BattleEnded')[0]?.result).toEqual({
      winner: null,
      reason: 'stalemate',
    });
    expect(r.state.inCheck).toBeNull();
    expect(engine.legalMoves(r.state, 'black')).toEqual([]);
  });
});

describe('R-RULES-005 fifty-move rule', () => {
  it('R-RULES-005 halfmove 99 plus one quiet move draws with reason fifty_move', () => {
    const r = play(start('4k3/8/8/8/8/8/8/R3K3 w - - 99 60').state, 'a1a2');
    expect(r.state.halfmove).toBe(100);
    expect(r.state.result).toEqual({ winner: null, reason: 'fifty_move' });
    expect(r.events[r.events.length - 1]).toMatchObject({
      k: 'BattleEnded',
      result: { winner: null, reason: 'fifty_move' },
    });
  });

  it('R-RULES-005 the 99th quiet ply does not draw; the 100th does, for either side', () => {
    const r = play(start('4k3/8/8/8/8/8/8/R3K3 w - - 98 60').state, 'a1a2');
    expect(r.state.halfmove).toBe(99);
    expect(r.state.result).toBeNull();
    const r2 = play(r.state, 'e8e7');
    expect(r2.state.result).toEqual({ winner: null, reason: 'fifty_move' });
  });

  it('R-RULES-005 a capture resets the counter', () => {
    const r = play(start('4k3/8/8/8/8/8/p7/R3K3 w - - 99 60').state, 'a1a2');
    expect(ofKind(r.events, 'Captured')).toHaveLength(1);
    expect(r.state.halfmove).toBe(0);
    expect(r.state.result).toBeNull();
  });

  it('R-RULES-005 a pawn move resets the counter', () => {
    const r = play(start('4k3/8/8/8/8/8/P7/R3K3 w - - 99 60').state, 'a2a3');
    expect(r.state.halfmove).toBe(0);
    expect(r.state.result).toBeNull();
    const d = play(start('4k3/8/8/8/8/8/P7/4K3 w - - 99 60').state, 'a2a4');
    expect(d.state.halfmove).toBe(0);
    expect(d.state.result).toBeNull();
  });

  it('R-RULES-005 castling does not reset the counter', () => {
    const r = play(start('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 99 60').state, 'e1g1');
    expect(r.state.result).toEqual({ winner: null, reason: 'fifty_move' });
  });

  it('R-RULES-005 DD-25 checkmate on the 100th ply outranks the fifty-move rule', () => {
    const r = play(start('6k1/5ppp/8/8/8/8/8/R5K1 w - - 99 60').state, 'a1a8');
    expect(r.state.halfmove).toBe(100);
    expect(r.state.result).toEqual({ winner: 'white', reason: 'checkmate' });
    expect(ofKind(r.events, 'BattleEnded')).toHaveLength(1);
  });

  it('R-RULES-005 DD-25 stalemate on the 100th ply is reported as stalemate', () => {
    const r = play(start('7k/4Q3/6K1/8/8/8/8/8 w - - 99 60').state, 'e7f7');
    expect(r.state.result).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('R-RULES-005 DD-25 the fifty-move rule outranks a simultaneous threefold repetition', () => {
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const s0 = start('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 92 1').state;
    const seven = playLine(s0, [...shuffle, ...shuffle.slice(0, 3)]).state;
    expect(seven.result).toBeNull();
    const r = play(seven, 'f6g8');
    expect(r.state.halfmove).toBe(100);
    expect(r.state.result).toEqual({ winner: null, reason: 'fifty_move' });
  });
});

describe('R-RULES-005 threefold repetition', () => {
  const SHUFFLE = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];

  it('R-RULES-005 knight shuffles draw by repetition on the third occurrence', () => {
    const s0 = start().state;
    const { state: twice, steps } = playLine(s0, SHUFFLE);
    expect(steps.every((s) => s.state.result === null)).toBe(true);
    // The start position has now occurred twice.
    expect(engine.stateHash(twice)).toBe(engine.stateHash(s0));
    const seven = playLine(twice, SHUFFLE.slice(0, 3)).state;
    expect(seven.result).toBeNull();
    const r = play(seven, 'f6g8');
    expect(r.state.result).toEqual({ winner: null, reason: 'repetition' });
    expect(r.events[r.events.length - 1]).toMatchObject({
      k: 'BattleEnded',
      result: { winner: null, reason: 'repetition' },
    });
    expect(engine.legalMoves(r.state, 'white')).toEqual([]);
  });

  it('R-RULES-005 DD-33 positions with different castling rights are not repetitions', () => {
    // Rook shuffles return the board to the start after 4 and 8 plies, but without king-side
    // rights, so the start position must not count: if it did, ply 8 would be its third
    // occurrence. The first position that occurs three times with equal rights is the one after
    // plies 2, 6 and 10.
    const cycle = ['h1g1', 'h8g8', 'g1h1', 'g8h8'];
    const s0 = start(CASTLE_FEN).state;
    const four = playLine(s0, cycle).state;
    expect(engine.toFen(four)).toBe('r3k2r/8/8/8/8/8/8/R3K2R w Qq - 4 3');
    expect(engine.stateHash(four)).not.toBe(engine.stateHash(s0));
    const eight = playLine(four, cycle).state;
    expect(eight.result).toBeNull();
    const nine = play(eight, 'h1g1').state;
    expect(nine.result).toBeNull();
    const ten = play(nine, 'h8g8');
    expect(ten.state.result).toEqual({ winner: null, reason: 'repetition' });
  });

  it('R-RULES-005 DD-33 the state hash depends on side to move and castling rights', () => {
    const h = (fen: string) => engine.stateHash(start(fen).state);
    expect(h('4k3/8/8/8/8/8/8/R3K3 w - - 0 1')).not.toBe(h('4k3/8/8/8/8/8/8/R3K3 b - - 0 1'));
    expect(h(CASTLE_FEN)).not.toBe(h('r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1'));
    expect(h(CASTLE_FEN)).not.toBe(h('r3k2r/8/8/8/8/8/8/R3K2R w KQk - 0 1'));
    expect(h(CASTLE_FEN)).not.toBe(h('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1'));
    // Move counters are not part of the position.
    expect(h('4k3/8/8/8/8/8/8/R3K3 w - - 0 1')).toBe(h('4k3/8/8/8/8/8/8/R3K3 w - - 37 80'));
    expect(h(CASTLE_FEN)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('R-RULES-005 DD-33 the en passant file counts only when a pawn could capture en passant', () => {
    const h = (fen: string) => engine.stateHash(start(fen).state);
    expect(h('4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1')).toBe(h('4k3/8/8/8/4P3/8/8/4K3 b - - 0 1'));
    expect(h('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1')).not.toBe(h('4k3/8/8/8/3pP3/8/8/4K3 b - - 0 1'));
  });

  it('R-RULES-005 DD-33 piece identity is part of the hashed state', () => {
    const s = start('4k3/8/8/8/8/8/8/R3K2R w - - 0 1').state;
    const swapped: GameState = JSON.parse(JSON.stringify(s)) as GameState;
    const a = idAt(s, 'a1');
    const b = idAt(s, 'h1');
    swapped.board[sq('a1')] = b;
    swapped.board[sq('h1')] = a;
    (swapped.pieces[a] as PieceState).square = sq('h1');
    (swapped.pieces[b] as PieceState).square = sq('a1');
    expect(engine.toFen(swapped)).toBe(engine.toFen(s));
    expect(engine.stateHash(swapped)).not.toBe(engine.stateHash(s));
  });
});

describe('R-RULES-005 insufficient material is not a draw', () => {
  it('R-RULES-005 king against king keeps playing', () => {
    const s0 = start('4k3/8/8/8/8/8/8/4K3 w - - 0 1').state;
    const { state, events } = playLine(s0, ['e1e2', 'e8e7', 'e2e1', 'e7e8', 'e1d1']);
    expect(ofKind(events, 'BattleEnded')).toEqual([]);
    expect(state.result).toBeNull();
    expect(legalUci(state).length).toBeGreaterThan(0);
  });

  it('R-RULES-005 a capture that leaves bare kings does not end the battle', () => {
    const r = play(start('4k3/8/8/8/8/8/3p4/4K3 w - - 0 1').state, 'e1d2');
    expect(ofKind(r.events, 'Captured')).toHaveLength(1);
    expect(r.state.result).toBeNull();
    expect(legalUci(r.state)).toEqual(['e8d7', 'e8d8', 'e8e7', 'e8f7', 'e8f8']);
  });

  it('R-RULES-005 king and minor piece against king keeps playing', () => {
    for (const fen of [
      '4k3/8/8/8/8/8/8/4KN2 w - - 0 1',
      '4k3/8/8/8/8/8/8/4KB2 w - - 0 1',
      '4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1',
    ]) {
      let s = start(fen).state;
      for (let ply = 0; ply < 4; ply++) {
        const r = play(s, legalUci(s)[0] as string);
        expect(r.state.result).toBeNull();
        expect(ofKind(r.events, 'BattleEnded')).toEqual([]);
        s = r.state;
      }
    }
  });

  it('R-RULES-005 bare kings still draw by the fifty-move rule', () => {
    const r = play(start('4k3/8/8/8/8/8/8/4K3 w - - 99 80').state, 'e1e2');
    expect(r.state.result).toEqual({ winner: null, reason: 'fifty_move' });
  });

  it('R-RULES-005 timeout is a loss even when the opponent has a bare king', () => {
    const s = start('4k3/8/8/8/8/8/8/4K3 w - - 0 1').state;
    const r = engine.applyAction(s, { kind: 'timeout', side: 'white' });
    expect(r.state.result).toEqual({ winner: 'black', reason: 'timeout' });
  });
});

describe('R-RULES-005 resign, timeout, abandon and agreed draws', () => {
  const cases: { input: ActionInput; winner: Side | null; reason: string }[] = [
    { input: { kind: 'resign', side: 'white' }, winner: 'black', reason: 'resign' },
    { input: { kind: 'resign', side: 'black' }, winner: 'white', reason: 'resign' },
    { input: { kind: 'timeout', side: 'white' }, winner: 'black', reason: 'timeout' },
    { input: { kind: 'timeout', side: 'black' }, winner: 'white', reason: 'timeout' },
    { input: { kind: 'abandon', side: 'white' }, winner: 'black', reason: 'abandon' },
    { input: { kind: 'abandon', side: 'black' }, winner: 'white', reason: 'abandon' },
    { input: { kind: 'agreeDraw' }, winner: null, reason: 'agreement' },
  ];

  for (const c of cases) {
    const who = 'side' in c.input ? ` by ${c.input.side}` : '';
    it(`R-RULES-005 ${c.input.kind}${who} ends the battle (${c.reason}, winner ${String(c.winner)})`, () => {
      const pre = play(start().state, 'e2e4').state; // black to move
      const r = engine.applyAction(pre, c.input);
      expect(r.kind).toBe('done');
      expect(r.state.result).toEqual({ winner: c.winner, reason: c.reason });
      expect(r.events).toEqual([
        {
          k: 'BattleEnded',
          i: pre.eventSeq,
          depth: 0,
          result: { winner: c.winner, reason: c.reason },
        },
      ]);
      expect(engine.legalMoves(r.state, 'white')).toEqual([]);
      expect(engine.legalMoves(r.state, 'black')).toEqual([]);
      expect(errorCode(() => engine.applyAction(r.state, moveInput(r.state, 'e7e5')))).toBe(
        'battle_over',
      );
      expect(errorCode(() => engine.applyAction(r.state, { kind: 'resign', side: 'white' }))).toBe(
        'battle_over',
      );
      expect(errorCode(() => engine.applyAction(r.state, { kind: 'agreeDraw' }))).toBe(
        'battle_over',
      );
    });
  }
});

// ---- R-DATA-002: API contract, typed events, errors, purity -------------------------------------

describe('R-DATA-002 RulesError codes', () => {
  it('R-DATA-002 illegal moves throw RulesError illegal_move', () => {
    const s = start().state;
    const before = JSON.stringify(s);
    for (const uci of ['e2e5', 'e4e5', 'g1g3', 'e1e2', 'a1a3']) {
      expect(errorCode(() => play(s, uci))).toBe('illegal_move');
    }
    // Moving an opponent piece on your own turn is an illegal move.
    expect(
      errorCode(() =>
        engine.applyAction(s, { kind: 'move', side: 'white', move: uciToMove('e7e5') }),
      ),
    ).toBe('illegal_move');
    expect(() => play(s, 'e2e5')).toThrow(RulesError);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('R-DATA-002 moving out of turn throws RulesError not_your_turn', () => {
    const s = start().state;
    expect(
      errorCode(() =>
        engine.applyAction(s, { kind: 'move', side: 'black', move: uciToMove('e7e5') }),
      ),
    ).toBe('not_your_turn');
    const b = play(s, 'e2e4').state;
    expect(
      errorCode(() =>
        engine.applyAction(b, { kind: 'move', side: 'white', move: uciToMove('d2d4') }),
      ),
    ).toBe('not_your_turn');
  });

  it('R-DATA-002 any action after checkmate throws RulesError battle_over', () => {
    const { state } = playLine(start().state, ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    expect(errorCode(() => engine.applyAction(state, moveInput(state, 'e1f2')))).toBe(
      'battle_over',
    );
    expect(errorCode(() => engine.applyAction(state, { kind: 'resign', side: 'white' }))).toBe(
      'battle_over',
    );
    expect(errorCode(() => engine.applyAction(state, { kind: 'timeout', side: 'white' }))).toBe(
      'battle_over',
    );
  });
});

describe('R-DATA-002 typed events for every move kind', () => {
  // Covers en passant, castling on both wings for both colours, captures, capture-promotion and checks.
  const FEN = 'r3k2r/pPp5/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1';
  const LINE: { uci: string; kinds: EventKind[]; made: Record<string, unknown> }[] = [
    {
      uci: 'e5d6',
      kinds: ['ActionStarted', 'Captured', 'MoveMade', 'TurnPassed'],
      made: { capture: true, enPassant: true, pieceType: 'pawn' },
    },
    {
      uci: 'e8g8',
      kinds: ['ActionStarted', 'MoveMade', 'TurnPassed'],
      made: { capture: false, castle: 'K', pieceType: 'king' },
    },
    {
      uci: 'e1c1',
      kinds: ['ActionStarted', 'MoveMade', 'TurnPassed'],
      made: { capture: false, castle: 'Q', pieceType: 'king' },
    },
    {
      uci: 'c7d6',
      kinds: ['ActionStarted', 'Captured', 'MoveMade', 'TurnPassed'],
      made: { capture: true, pieceType: 'pawn' },
    },
    {
      uci: 'b7a8q',
      kinds: ['ActionStarted', 'Captured', 'MoveMade', 'Promoted', 'TurnPassed'],
      made: { capture: true, promotion: 'queen', pieceType: 'pawn' },
    },
    {
      uci: 'f8a8',
      kinds: ['ActionStarted', 'Captured', 'MoveMade', 'TurnPassed'],
      made: { capture: true, pieceType: 'rook' },
    },
    {
      uci: 'd1d6',
      kinds: ['ActionStarted', 'Captured', 'MoveMade', 'TurnPassed'],
      made: { capture: true, pieceType: 'rook' },
    },
    {
      uci: 'a7a5',
      kinds: ['ActionStarted', 'MoveMade', 'TurnPassed'],
      made: { capture: false, pieceType: 'pawn' },
    },
    {
      uci: 'd6d8',
      kinds: ['ActionStarted', 'MoveMade', 'TurnPassed', 'Check'],
      made: { capture: false, pieceType: 'rook' },
    },
    {
      uci: 'a8d8',
      kinds: ['ActionStarted', 'Captured', 'MoveMade', 'TurnPassed'],
      made: { capture: true, pieceType: 'rook' },
    },
    {
      uci: 'h1h8',
      kinds: ['ActionStarted', 'MoveMade', 'TurnPassed', 'Check'],
      made: { capture: false, pieceType: 'rook' },
    },
    {
      uci: 'g8h8',
      kinds: ['ActionStarted', 'Captured', 'MoveMade', 'TurnPassed'],
      made: { capture: true, pieceType: 'king' },
    },
  ];

  it('R-DATA-002 DD-10 each move emits ActionStarted, Captured, MoveMade, Promoted, TurnPassed and Check records', () => {
    const { state: s0, events: setup } = start(FEN);
    const all: BattleEvent[] = [...setup];
    let s = s0;
    for (const step of LINE) {
      const mv: Move = uciToMove(step.uci);
      const side = s.turn;
      const pieceId = idAt(s, step.uci.slice(0, 2));
      const victimSq = step.made.enPassant === true ? mv.to + (side === 'white' ? -8 : 8) : mv.to;
      const victimId = s.board[victimSq] ?? -1;
      const r = play(s, step.uci);
      expect(kinds(r.events), step.uci).toEqual(step.kinds);
      expect(r.events[0]).toEqual({
        k: 'ActionStarted',
        i: s.eventSeq,
        depth: 0,
        side,
        ply: s.ply,
        move: mv,
      });
      const made = ofKind(r.events, 'MoveMade');
      expect(made).toHaveLength(1);
      expect(made[0]).toMatchObject({
        side,
        piece: pieceId,
        from: mv.from,
        to: mv.to,
        bonus: false,
        ...step.made,
      });
      if (step.made.castle === undefined) expect(made[0]?.castle).toBeUndefined();
      if (step.made.enPassant === undefined) expect(made[0]?.enPassant).toBeUndefined();
      if (step.made.promotion === undefined) expect(made[0]?.promotion).toBeUndefined();
      const captured = ofKind(r.events, 'Captured');
      if (step.made.capture === true) {
        expect(captured).toEqual([
          expect.objectContaining({
            victim: victimId,
            victimSide: opposite(side),
            square: victimSq,
            by: 'move',
            captor: pieceId,
          }),
        ]);
        expect(r.events.indexOf(captured[0] as BattleEvent)).toBeLessThan(
          r.events.indexOf(made[0] as BattleEvent),
        );
      }
      for (const promo of ofKind(r.events, 'Promoted')) {
        expect(promo).toMatchObject({ piece: pieceId, side, to: step.made.promotion });
      }
      expect(ofKind(r.events, 'TurnPassed')).toEqual([
        expect.objectContaining({ side: opposite(side), ply: s.ply + 1 }),
      ]);
      for (const c of ofKind(r.events, 'Check')) {
        expect(c).toMatchObject({ side: opposite(side) });
        expect(r.state.pieces[r.state.board[c.square] ?? -1]?.type).toBe('king');
      }
      // Battle-wide indices continue across actions; every record here is depth 0.
      r.events.forEach((e, j) => {
        expect(e.i).toBe(s.eventSeq + j);
        expect(e.depth).toBe(0);
      });
      expect(r.state.eventSeq).toBe(s.eventSeq + r.events.length);
      expect(r.state.ply).toBe(s.ply + 1);
      expect(r.state.turn).toBe(opposite(side));
      all.push(...r.events);
      s = r.state;
    }
    expect(all.map((e) => e.i)).toEqual(all.map((_, j) => j));
    expect(engine.toFen(s)).toBe('3r3k/8/8/p7/8/8/8/2K5 w - - 0 7');
    expect(s.result).toBeNull();
  });
});

describe('R-DATA-002 toFen', () => {
  const FENS = [
    START_FEN,
    KIWIPETE,
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    'r2q1rk1/pP1p2pp/Q4n2/bbp1p3/Np6/1B3NBn/pPPP1PPP/R3K2R b KQ - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2',
    '4k3/8/8/8/8/8/8/R3K3 b - - 42 77',
  ];

  for (const fen of FENS) {
    it(`R-DATA-002 toFen round-trips ${fen}`, () => {
      expect(engine.toFen(start(fen).state)).toBe(fen);
    });
  }

  it('R-DATA-002 toFen tracks moves, counters, castling and the en passant square', () => {
    const s0 = start().state;
    const e4 = play(s0, 'e2e4').state;
    expect(engine.toFen(e4)).toBe('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    const { state } = playLine(e4, ['e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1']);
    expect(engine.toFen(state)).toBe(
      'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4',
    );
  });

  it('R-DATA-002 a battle rebuilt from toFen has the same FEN and legal moves', () => {
    const line = ['e5d6', 'e8g8', 'e1c1', 'c7d6', 'b7a8q', 'f8a8', 'd1d6', 'a7a5'];
    let s = start('r3k2r/pPp5/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1').state;
    for (const u of line) {
      const rebuilt = start(engine.toFen(s)).state;
      expect(engine.toFen(rebuilt)).toBe(engine.toFen(s));
      expect(legalUci(rebuilt)).toEqual(legalUci(s));
      s = play(s, u).state;
    }
  });
});

describe('R-DATA-002 purity: inputs are never mutated', () => {
  it('R-DATA-002 applyAction never mutates its input state (JSON before and after)', () => {
    const line = ['e5d6', 'e8g8', 'e1c1', 'c7d6', 'b7a8q', 'f8a8', 'd1d6', 'a7a5', 'd6d8', 'a8d8'];
    let s = start('r3k2r/pPp5/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1').state;
    for (const u of line) {
      const before = JSON.stringify(s);
      const r = play(s, u);
      expect(JSON.stringify(s), u).toBe(before);
      expect(r.state).not.toBe(s);
      s = r.state;
    }
    for (const input of [
      { kind: 'resign', side: 'white' },
      { kind: 'timeout', side: 'black' },
      { kind: 'abandon', side: 'white' },
      { kind: 'agreeDraw' },
    ] as ActionInput[]) {
      const before = JSON.stringify(s);
      engine.applyAction(s, input);
      expect(JSON.stringify(s)).toBe(before);
    }
    const mated = playLine(start().state, ['f2f3', 'e7e5', 'g2g4']).state;
    const beforeMate = JSON.stringify(mated);
    play(mated, 'd8h4');
    expect(JSON.stringify(mated)).toBe(beforeMate);
    const beforeIllegal = JSON.stringify(s);
    expect(errorCode(() => play(s, 'a1a2'))).toBe('illegal_move');
    expect(JSON.stringify(s)).toBe(beforeIllegal);
  });

  it('R-DATA-002 legalMoves, stateHash, toFen and project do not mutate the state', () => {
    const s = play(start(KIWIPETE).state, 'e1g1').state;
    const before = JSON.stringify(s);
    engine.legalMoves(s, 'white');
    engine.legalMoves(s, 'black');
    engine.stateHash(s);
    engine.toFen(s);
    engine.project(s, 'white');
    engine.project(s, 'black');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('R-DATA-002 newBattle does not mutate its setup', () => {
    const setup = {
      format: 'full' as const,
      white: { level: 1, loadout: NEUTRAL },
      black: { level: 1, loadout: NEUTRAL },
      fen: KIWIPETE,
    };
    const before = JSON.stringify(setup);
    engine.newBattle(setup);
    expect(JSON.stringify(setup)).toBe(before);
  });

  it('R-DATA-002 INV-04 random games never mutate earlier states', () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 60 }), (picks) => {
        let s = start().state;
        for (const pick of picks) {
          const moves = engine.legalMoves(s, s.turn);
          if (moves.length === 0) break;
          const mv = moves[pick % moves.length] as Move;
          const before = JSON.stringify(s);
          const r = engine.applyAction(s, { kind: 'move', side: s.turn, move: mv });
          expect(JSON.stringify(s)).toBe(before);
          s = r.state;
        }
      }),
      { numRuns: 40, seed: 0x5eed },
    );
  });
});

describe('INV-04 determinism', () => {
  it('INV-04 R-DATA-002 the same inputs give identical states, events and stateHash', () => {
    const e1 = createEngine(emptyRegistry, caps);
    const e2 = createEngine(emptyRegistry, caps);
    fc.assert(
      fc.property(fc.array(fc.nat(), { minLength: 1, maxLength: 80 }), (picks) => {
        const a0 = start(undefined, e1);
        const b0 = start(undefined, e2);
        expect(b0).toEqual(a0);
        let a = a0.state;
        let b = b0.state;
        for (const pick of picks) {
          const ma = e1.legalMoves(a, a.turn);
          const mb = e2.legalMoves(b, b.turn);
          expect(mb).toEqual(ma);
          if (ma.length === 0) break;
          const mv = ma[pick % ma.length] as Move;
          const input: ActionInput = { kind: 'move', side: a.turn, move: mv };
          const ra = e1.applyAction(a, input);
          const rb = e2.applyAction(b, input);
          const again = e1.applyAction(a, input);
          expect(rb.events).toEqual(ra.events);
          expect(rb.state).toEqual(ra.state);
          expect(again).toEqual(ra);
          expect(e2.stateHash(rb.state)).toBe(e1.stateHash(ra.state));
          expect(JSON.stringify(rb.state)).toBe(JSON.stringify(ra.state));
          a = ra.state;
          b = rb.state;
        }
      }),
      { numRuns: 40, seed: 0xc4a1 },
    );
  });

  it('INV-04 replaying a recorded game from its inputs reproduces the final state hash', () => {
    const line = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6', 'e1g1', 'f6e4', 'd2d4', 'e5d4'];
    const first = playLine(start().state, line);
    const second = playLine(start().state, line);
    expect(second.events).toEqual(first.events);
    expect(engine.stateHash(second.state)).toBe(engine.stateHash(first.state));
    expect(second.state).toEqual(first.state);
  });
});

describe('R-RULES-001 full-engine perft (legalMoves + applyAction)', () => {
  const suites: { name: string; fen: string; counts: number[] }[] = [
    { name: 'start position', fen: START_FEN, counts: [20, 400, 8_902] },
    { name: 'Kiwipete', fen: KIWIPETE, counts: [48, 2_039] },
    {
      name: 'position 3',
      fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
      counts: [14, 191, 2_812],
    },
    {
      name: 'position 4',
      fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
      counts: [6, 264, 9_467],
    },
    {
      name: 'position 5',
      fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
      counts: [44, 1_486],
    },
  ];
  for (const suite of suites) {
    suite.counts.forEach((expected, i) => {
      const depth = i + 1;
      it(`R-RULES-001 engine perft ${suite.name} depth ${depth} = ${expected}`, () => {
        expect(enginePerft(start(suite.fen).state, depth)).toBe(expected);
      });
    });
  }
});
