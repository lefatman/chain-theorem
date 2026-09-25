/**
 * Hidden information and reveals (M2 step 2.6): R-INFO-001 what is visible before battle, R-INFO-002
 * reveal rules, R-INFO-003 Dossier deductions, R-INFO-004 move previews, R-INFO-005 and R-SEC-001 the
 * server information contract, plus DD-19, DD-27, DD-28, DD-32, DD-37 and DD-40.
 *
 * Expected behaviour comes from spec 8.1-8.5, 13.2, 15 and the DD rows, not from engine output.
 */
import { describe, expect, it } from 'vitest';
import {
  type BattleEvent,
  type Engine,
  type GameState,
  type RevealLog,
  type Side,
  PIECE_TYPES,
  SIDES,
  moveToUci,
  opposite,
  parseSquare,
  uciToMove,
} from '@chain-theorem/rules';
import {
  type ArmySpec,
  type ScenarioSpec,
  eventsOf,
  idAt,
  loadoutOf,
  pieceAt,
  scenario,
  setup,
} from '../src/testing.ts';

const sq = parseSquare;
const EMPTY_LOG: RevealLog = {
  abilities: {},
  complete: [],
  items: [],
  allItems: false,
  veiled: [],
};
/** Spec 8.1: the only public facts about an opponent army (plus what has been revealed). */
const PUBLIC_ARMY_KEYS = ['consumedSlots', 'elements', 'level', 'revealed'];

/** E1 board: white knight c3, black pawn d5. */
const E1_FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
/** As E1 plus a black pawn on h7 and a white rook on h1 for a second capture. */
const TWO_PAWNS_FEN = '4k3/7p/8/3p4/8/2N5/8/4K2R w - - 0 1';

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

/**
 * Every string value in the JSON wire form of `value`, plus every ':'-separated segment of every
 * object key (usage counters are keyed `${piece}:${ability}`).
 */
function wireStrings(value: unknown): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        for (const part of k.split(':')) out.add(part);
        walk(x);
      }
    }
  };
  walk(JSON.parse(JSON.stringify(value ?? null)) as unknown);
  return out;
}

/** Ability and item ids of `owner` that the opponent has not seen revealed (on any piece type). */
function unrevealedIds(state: GameState, owner: Side): string[] {
  const log = state.reveals[owner];
  const seen = new Set(Object.values(log.abilities).flatMap((l) => l ?? []));
  const army = state.armies[owner];
  const out = new Set<string>();
  for (const t of PIECE_TYPES) for (const a of army.sets[t]) if (!seen.has(a)) out.add(a);
  for (const i of army.loadout.items) if (!log.items.includes(i)) out.add(i);
  return [...out];
}

function idsOf(spec: ArmySpec | undefined): string[] {
  const l = loadoutOf(spec);
  return [...new Set([...l.sets.flat(), ...l.items])];
}

const revealedOf = (events: readonly BattleEvent[], side: Side) =>
  eventsOf(events, 'Revealed').filter((e) => e.side === side);

// ---- R-INFO-001 -----------------------------------------------------------------------------------

const WHITE_PLAIN: ArmySpec = {
  level: 12,
  elements: ['grove'],
  items: ['triple_adepts_gloves'],
  abilities: ['scout', 'pierce'],
};
/** Maximum-style build: 6 slots, Schedule, Blended Family (tide = group A, ember = group B). */
const BLACK_A: ArmySpec = {
  level: 25,
  elements: ['tide', 'ember'],
  items: ['headmaster_ring', 'multitaskers_schedule', 'blended_family'],
  sets: [
    ['poisoned_meat', 'last_word', 'backdraft', 'rebirth', 'antidote'],
    ['hit_and_run', 'cleave', 'momentum', 'riposte', 'reinforce'],
    ['veil', 'poisoned_meat'],
    ['cleave'],
    ['riposte', 'momentum'],
    ['stalwart'],
  ],
};
/** Same public facts as BLACK_A (level 25, tide/ember, 6 slots) with 4 other items and no Schedule. */
const BLACK_B: ArmySpec = {
  level: 25,
  elements: ['tide', 'ember'],
  items: ['journeymans_medallion', 'blended_family', 'resonance_crystal', 'wardens_stopwatch'],
  abilities: ['antidote', 'backdraft', 'last_word'],
};

describe('R-INFO-001 visible before battle', () => {
  it('R-INFO-001 before any reveal the opponent army exposes only level, elements with group mapping and consumed slots', () => {
    const s = setup({ white: WHITE_PLAIN, black: BLACK_A });
    const pub = s.engine.project(s.state, 'white');
    const opp = pub.armies.black;
    expect(Object.keys(opp).sort()).toEqual(PUBLIC_ARMY_KEYS);
    expect(opp.level).toBe(25);
    expect(opp.elements).toEqual(['tide', 'ember']);
    expect(opp.consumedSlots).toBe(6);
    expect(opp.revealed).toEqual(EMPTY_LOG);
    // Group mapping (6.4): pawns, knights, bishops show element A; rooks, queen, king element B.
    const black = pub.pieces.filter((p) => p.side === 'black');
    expect(black).toHaveLength(16);
    for (const p of black)
      expect(p.element, p.type).toBe(
        p.type === 'pawn' || p.type === 'knight' || p.type === 'bishop' ? 'tide' : 'ember',
      );
    expect(pub.usage).toEqual({});
    const strings = wireStrings(pub);
    expect(idsOf(BLACK_A).filter((id) => strings.has(id))).toEqual([]);
  });

  it('R-INFO-001 item names, item count, abilities and the Schedule stay hidden: loadouts with equal public facts project identically', () => {
    const a = setup({ white: WHITE_PLAIN, black: BLACK_A });
    const b = setup({ white: WHITE_PLAIN, black: BLACK_B });
    expect(b.engine.project(b.state, 'white')).toEqual(a.engine.project(a.state, 'white'));
    expect(b.engine.projectEvents(b.state, b.events, 'white')).toEqual(
      a.engine.projectEvents(a.state, a.events, 'white'),
    );
    // Control: the two armies really differ, and their owners see the difference.
    expect(b.engine.project(b.state, 'black')).not.toEqual(a.engine.project(a.state, 'black'));
  });

  it("R-INFO-001 the viewer's own army is complete in its projection", () => {
    const s = setup({ white: WHITE_PLAIN, black: BLACK_A });
    const own = s.engine.project(s.state, 'black').armies.black;
    expect(own.loadout).toEqual(loadoutOf(BLACK_A));
    expect(own.sets).toEqual({
      pawn: ['poisoned_meat', 'last_word', 'backdraft', 'rebirth', 'antidote'],
      knight: ['hit_and_run', 'cleave', 'momentum', 'riposte', 'reinforce'],
      bishop: ['veil', 'poisoned_meat'],
      rook: ['cleave'],
      queen: ['riposte', 'momentum'],
      king: ['stalwart'],
    });
    expect(own.level).toBe(25);
    expect(own.consumedSlots).toBe(6);
    const white = s.engine.project(s.state, 'white').armies.white;
    expect(white.loadout).toEqual(loadoutOf(WHITE_PLAIN));
    for (const t of PIECE_TYPES) expect(white.sets?.[t], t).toEqual(['scout', 'pierce']);
    expect(white.consumedSlots).toBe(2);
    // ... and never the opponent's.
    expect(s.engine.project(s.state, 'black').armies.white.loadout).toBeUndefined();
    expect(s.engine.project(s.state, 'black').armies.white.sets).toBeUndefined();
  });
});

// ---- R-INFO-002 -----------------------------------------------------------------------------------

describe('R-INFO-002 reveal rules', () => {
  it('R-INFO-002 an activated ability is revealed together with the piece type it was seen on', () => {
    const r = scenario({
      fen: E1_FEN,
      white: { abilities: ['hit_and_run'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(r.state.reveals.black.abilities).toEqual({ pawn: ['poisoned_meat'] });
    expect(r.state.reveals.black.complete).toEqual([]);
    expect(revealedOf(r.events, 'black')).toContainEqual(
      expect.objectContaining({
        info: { kind: 'ability', pieceType: 'pawn', ability: 'poisoned_meat' },
        cause: 'activated',
      }),
    );
    // E1: Hit and Run activates and fizzles without a body; either way it is revealed on knights.
    const hr = revealedOf(r.events, 'white').find(
      (e) => e.info.kind === 'ability' && e.info.ability === 'hit_and_run',
    );
    expect(hr?.info).toEqual({ kind: 'ability', pieceType: 'knight', ability: 'hit_and_run' });
    expect(['activated', 'fizzled']).toContain(hr?.cause);
    expect(r.state.reveals.white.abilities).toEqual({ knight: ['hit_and_run'] });
    // Only the type it was seen on: nothing is known about black knights, bishops and so on.
    const pub = r.engine.project(r.state, 'white');
    expect(pub.armies.black.revealed.abilities).toEqual({ pawn: ['poisoned_meat'] });
    expect(r.engine.project(r.state, 'black').armies.white.revealed.abilities).toEqual({
      knight: ['hit_and_run'],
    });
  });

  it('R-INFO-002 R-ELEM-002 a silenced ability is revealed by name with its piece type', () => {
    const r = scenario({
      fen: E1_FEN,
      white: { elements: ['tide'], abilities: ['hit_and_run'] },
      black: { elements: ['grove'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({
        side: 'white',
        pieceType: 'knight',
        ability: 'hit_and_run',
        category: 'CAPTURES',
      }),
    ]);
    expect(revealedOf(r.events, 'white')).toContainEqual(
      expect.objectContaining({
        info: { kind: 'ability', pieceType: 'knight', ability: 'hit_and_run' },
        cause: 'silenced',
      }),
    );
    expect(pieceAt(r.state, 'd5')).toMatchObject({ side: 'white', type: 'knight' });
    const black = r.engine.project(r.state, 'black');
    expect(black.armies.white.revealed.abilities).toEqual({ knight: ['hit_and_run'] });
    const projected = r.engine.projectEvents(r.state, r.events, 'black');
    expect(eventsOf(projected, 'AbilitySilenced')[0]?.ability).toBe('hit_and_run');
  });

  it('R-INFO-002 E2 a negated ability is revealed as negated', () => {
    const r = scenario({
      fen: E1_FEN,
      white: { items: ['dual_adepts_glove'], abilities: ['hit_and_run', 'pierce'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilityNegated')).toEqual([
      expect.objectContaining({ side: 'black', pieceType: 'pawn', ability: 'poisoned_meat' }),
    ]);
    expect(revealedOf(r.events, 'black')).toContainEqual(
      expect.objectContaining({
        info: { kind: 'ability', pieceType: 'pawn', ability: 'poisoned_meat' },
        cause: 'negated',
      }),
    );
    expect(r.state.reveals.black.abilities).toEqual({ pawn: ['poisoned_meat'] });
    expect(pieceAt(r.state, 'c3')).toMatchObject({ side: 'white', type: 'knight' });
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
  });

  it('R-INFO-002 E3 an ability whose effect fizzles (Royal Immunity) is revealed', () => {
    const r = scenario({
      fen: '4k3/8/8/8/8/3pK3/8/8 w - - 0 1',
      black: { abilities: ['poisoned_meat'] },
      moves: ['e3d3'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toContainEqual(
      expect.objectContaining({
        side: 'black',
        ability: 'poisoned_meat',
        reason: 'royal_immunity',
      }),
    );
    const rv = revealedOf(r.events, 'black').find(
      (e) => e.info.kind === 'ability' && e.info.ability === 'poisoned_meat',
    );
    expect(rv?.info).toEqual({ kind: 'ability', pieceType: 'pawn', ability: 'poisoned_meat' });
    expect(['activated', 'fizzled']).toContain(rv?.cause);
    expect(r.state.reveals.black.abilities).toEqual({ pawn: ['poisoned_meat'] });
    expect(pieceAt(r.state, 'd3')).toMatchObject({ side: 'white', type: 'king' });
  });

  it("R-INFO-002 an item is revealed when its effect is observable: Warden's Stopwatch negating Riposte", () => {
    const spec: ScenarioSpec = {
      fen: '4k3/8/8/3n4/8/2N5/8/4K3 w - - 0 1',
      white: { items: ['wardens_stopwatch'] },
      black: { abilities: ['riposte'] },
    };
    const before = setup(spec);
    expect(before.state.reveals.white.items).toEqual([]);
    const r = scenario({ ...spec, moves: ['c3d5'] });
    expect(eventsOf(r.events, 'AbilityNegated')).toContainEqual(
      expect.objectContaining({ side: 'black', pieceType: 'knight', ability: 'riposte' }),
    );
    expect(r.state.reveals.white.items).toEqual(['wardens_stopwatch']);
    expect(revealedOf(r.events, 'white')).toContainEqual(
      expect.objectContaining({ info: { kind: 'item', item: 'wardens_stopwatch' } }),
    );
    expect(r.state.reveals.black.abilities).toEqual({ knight: ['riposte'] });
    expect(r.engine.project(r.state, 'black').armies.white.revealed.items).toEqual([
      'wardens_stopwatch',
    ]);
    expect(pieceAt(r.state, 'd5')).toMatchObject({ side: 'white', type: 'knight' });
  });

  it('R-INFO-002 DD-40 a REVEAL effect names items: attuned Last Word discloses the complete item list, even when empty', () => {
    const r = scenario({
      fen: E1_FEN,
      white: { items: ['resonance_crystal', 'wardens_stopwatch'] },
      black: { elements: ['tide'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect([...r.state.reveals.white.items].sort()).toEqual([
      'resonance_crystal',
      'wardens_stopwatch',
    ]);
    expect(r.state.reveals.white.allItems).toBe(true);
    // Base effect: the captor's whole type set (empty here) is known and complete.
    expect(r.state.reveals.white.complete).toContain('knight');
    expect(r.state.reveals.white.abilities.knight).toEqual([]);
    const black = r.engine.project(r.state, 'black').armies.white.revealed;
    expect(black.allItems).toBe(true);
    expect([...black.items].sort()).toEqual(['resonance_crystal', 'wardens_stopwatch']);

    const empty = scenario({
      fen: E1_FEN,
      black: { elements: ['tide'], abilities: ['last_word'] },
      moves: ['c3d5'],
    });
    expect(empty.state.reveals.white.items).toEqual([]);
    expect(empty.state.reveals.white.allItems).toBe(true);
  });

  it("R-INFO-002 DD-27 Scout's Lens is revealed when it fires at battle start, with the pawn ability it exposed", () => {
    const s = setup({
      white: { items: ['scouts_lens'] },
      black: { items: ['dual_adepts_glove'], abilities: ['poisoned_meat', 'last_word'] },
    });
    expect(s.state.reveals.white.items).toEqual(['scouts_lens']);
    expect(s.state.reveals.black.abilities).toEqual({ pawn: ['poisoned_meat'] });
    expect(s.engine.project(s.state, 'black').armies.white.revealed.items).toEqual(['scouts_lens']);
    expect(s.engine.project(s.state, 'white').armies.black.revealed.abilities).toEqual({
      pawn: ['poisoned_meat'],
    });
    expect(revealedOf(s.events, 'black')).toContainEqual(
      expect.objectContaining({
        info: { kind: 'ability', pieceType: 'pawn', ability: 'poisoned_meat' },
      }),
    );
  });

  it('R-INFO-002 reveals last for the rest of the battle', () => {
    const r = scenario({
      fen: TWO_PAWNS_FEN,
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8e7', 'e1e2', 'e7e6', 'h1h7'],
    });
    // Replay step by step and check the log after every move.
    const { engine, state: start } = setup({
      fen: TWO_PAWNS_FEN,
      black: { abilities: ['poisoned_meat'] },
    });
    let s = start;
    for (const uci of ['c3d5', 'e8e7', 'e1e2', 'e7e6']) {
      s = engine.applyAction(s, { kind: 'move', side: s.turn, move: uciToMove(uci) }).state;
      expect(s.reveals.black.abilities, uci).toEqual({ pawn: ['poisoned_meat'] });
      expect(engine.project(s, 'white').armies.black.revealed.abilities, uci).toEqual({
        pawn: ['poisoned_meat'],
      });
    }
    // The revealing pawn is long gone; a later activation is still shown by name.
    const last = must(r.steps[4], 'h1h7');
    const projected = r.engine.projectEvents(r.state, last.events, 'white');
    expect(eventsOf(projected, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ side: 'black', pieceType: 'pawn', ability: 'poisoned_meat' }),
    ]);
    expect(r.state.reveals.black.abilities).toEqual({ pawn: ['poisoned_meat'] });
    expect(pieceAt(r.state, 'h7')).toBeUndefined();
  });

  it('R-INFO-002 DD-28 Veil hides the name on activation: the opponent sees the effect and learns the piece type is veiled', () => {
    const r = scenario({
      fen: E1_FEN,
      black: { items: ['dual_adepts_glove'], abilities: ['veil', 'poisoned_meat'] },
      moves: ['c3d5'],
    });
    const knight = idAt(r.initial, 'c3');
    // The board effect happens and is shown.
    expect(eventsOf(r.events, 'Captured')).toContainEqual(
      expect.objectContaining({ victim: knight, by: 'effect' }),
    );
    expect(pieceAt(r.state, 'd5')).toBeUndefined();
    // The name is not revealed; the veiled piece type is.
    const log = r.state.reveals.black;
    expect(Object.values(log.abilities).flatMap((l) => l ?? [])).toEqual([]);
    expect(log.veiled).toEqual(['pawn']);
    expect(revealedOf(r.events, 'black')).toContainEqual(
      expect.objectContaining({ info: { kind: 'veiled', pieceType: 'pawn' } }),
    );
    expect(revealedOf(r.events, 'black').filter((e) => e.info.kind === 'ability')).toEqual([]);
    const pub = r.engine.project(r.state, 'white');
    expect(pub.armies.black.revealed.veiled).toEqual(['pawn']);
  });

  it('R-INFO-002 DD-28 explicit REVEAL effects (Scout) still name veiled abilities', () => {
    const r = scenario({
      fen: E1_FEN,
      white: { abilities: ['scout'] },
      black: { items: ['dual_adepts_glove'], abilities: ['veil', 'poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(r.state.reveals.black.abilities.pawn).toEqual(
      expect.arrayContaining(['veil', 'poisoned_meat']),
    );
    expect(r.state.reveals.black.complete).toContain('pawn');
    const projected = r.engine.projectEvents(r.state, r.events, 'white');
    expect(eventsOf(projected, 'AbilityTriggered').filter((e) => e.side === 'black')).toEqual([
      expect.objectContaining({ pieceType: 'pawn', ability: 'poisoned_meat' }),
    ]);
  });
});

// ---- R-INFO-003 -----------------------------------------------------------------------------------

describe('R-INFO-003 Dossier deductions', () => {
  const glove8_3: ScenarioSpec = {
    fen: E1_FEN,
    white: { level: 10 },
    black: {
      level: 10,
      items: ['dual_adepts_glove'],
      abilities: ['last_word', 'poisoned_meat'],
    },
  };

  it("R-INFO-003 spec 8.3: 1 slot consumed and two abilities seen on pawns means Dual Adept's Glove and no Schedule", () => {
    const r = scenario({ ...glove8_3, moves: ['c3d5'] });
    const pub = r.engine.project(r.state, 'white');
    expect(pub.armies.black.consumedSlots).toBe(1);
    expect(pub.armies.black.revealed.abilities).toEqual({ pawn: ['last_word', 'poisoned_meat'] });
    expect(pub.armies.black.revealed.items).toEqual([]);
    const d = r.engine.deduce(pub);
    expect(d.side).toBe('black');
    expect(d.observedCapacity).toBe(2);
    expect(d.certainItems).toEqual(['dual_adepts_glove']);
    expect(d.combinations).toBe(1);
    expect(d.schedule).toBe('no');
    expect(d.capacity).toEqual({ min: 2, max: 2 });
    expect(d.impossibleItems).toContain('multitaskers_schedule');
    expect(d.truncated).toBe(false);
    const hints = d.hints.join(' ');
    expect(hints).toContain("Dual Adept's Glove");
    expect(hints).toContain('Schedule');
  });

  it('R-INFO-003 control: before those reveals the same public facts prove neither', () => {
    const s = setup(glove8_3);
    const d = s.engine.deduce(s.engine.project(s.state, 'white'));
    expect(d.certainItems).toEqual([]);
    expect(d.combinations).toBeGreaterThan(1);
    expect(d.schedule).toBe('unknown');
  });

  it('R-INFO-003 R-INFO-001 two displayed elements prove Blended Family', () => {
    const one = setup({
      black: { level: 15, elements: ['tide', 'ember'], items: ['blended_family'] },
    });
    const d1 = one.engine.deduce(one.engine.project(one.state, 'white'));
    expect(d1.blended).toBe('yes');
    expect(d1.certainItems).toEqual(['blended_family']);
    expect(d1.combinations).toBe(1);

    const five = setup({
      black: {
        level: 30,
        elements: ['grove', 'tide'],
        items: ['blended_family', 'headmaster_ring'],
      },
    });
    const d5 = five.engine.deduce(five.engine.project(five.state, 'white'));
    expect(d5.blended).toBe('yes');
    expect(d5.certainItems).toContain('blended_family');
  });

  it('R-INFO-003 one displayed element with a 1-slot budget rules Blended Family out', () => {
    const s = setup({ black: { level: 30, elements: ['tide'], items: ['resonance_crystal'] } });
    const d = s.engine.deduce(s.engine.project(s.state, 'white'));
    expect(d.blended).toBe('no');
    expect(d.impossibleItems).toContain('blended_family');
  });

  const scheduleSpec = (knightSet: string[]): ScenarioSpec => ({
    fen: '4k3/8/8/1n2p3/3P4/2N5/8/4K3 w - - 0 1',
    white: { level: 10, abilities: ['scout'] },
    black: {
      level: 10,
      items: ['multitaskers_schedule'],
      sets: [['hit_and_run'], knightSet, [], [], [], []],
    },
    moves: ['d4e5', 'e8d8', 'c3b5'],
  });

  it('R-INFO-003 the Schedule is proven when two completely revealed type sets differ', () => {
    const r = scenario(scheduleSpec(['cleave']));
    const pub = r.engine.project(r.state, 'white');
    expect([...pub.armies.black.revealed.complete].sort()).toEqual(['knight', 'pawn']);
    expect(pub.armies.black.revealed.abilities).toEqual({
      pawn: ['hit_and_run'],
      knight: ['cleave'],
    });
    const d = r.engine.deduce(pub);
    expect(d.schedule).toBe('yes');
    expect(d.certainItems).toEqual(['multitaskers_schedule']);
    expect(d.combinations).toBe(1);
  });

  it('R-INFO-003 control: equal complete type sets do not prove the Schedule', () => {
    const r = scenario(scheduleSpec(['hit_and_run']));
    const pub = r.engine.project(r.state, 'white');
    expect([...pub.armies.black.revealed.complete].sort()).toEqual(['knight', 'pawn']);
    const d = r.engine.deduce(pub);
    expect(d.schedule).toBe('unknown');
    expect(d.certainItems).toEqual([]);
  });
});

// ---- R-INFO-004 -----------------------------------------------------------------------------------

describe('R-INFO-004 move previews', () => {
  const plainWhite: ArmySpec = {};

  it("R-INFO-004 a capture of a piece type whose set is not fully known is flagged '?'", () => {
    const s = setup({ fen: E1_FEN, white: plainWhite, black: { abilities: ['poisoned_meat'] } });
    const pub = s.engine.project(s.state, 'white');
    const p = s.engine.preview(pub, loadoutOf(plainWhite), uciToMove('c3d5'));
    expect(p.legal).toBe(true);
    expect(p.unknowns).toContainEqual({ kind: 'victimAbilities', pieceType: 'pawn' });
    const quiet = s.engine.preview(pub, loadoutOf(plainWhite), uciToMove('e1e2'));
    expect(quiet.legal).toBe(true);
    expect(quiet.unknowns.filter((u) => u.kind === 'victimAbilities')).toEqual([]);
  });

  it('R-INFO-004 INV-06 the preview does not leak a hidden Poisoned Meat: the captor survives in the preview but not in the real move', () => {
    const s = setup({ fen: E1_FEN, white: plainWhite, black: { abilities: ['poisoned_meat'] } });
    const knight = idAt(s.state, 'c3');
    const pub = s.engine.project(s.state, 'white');
    const p = s.engine.preview(pub, loadoutOf(plainWhite), uciToMove('c3d5'));
    expect(p.board[sq('d5')]).toBe(knight);
    expect(p.board[sq('c3')]).toBe(-1);
    expect(eventsOf(p.events, 'Captured').map((e) => e.victim)).toEqual([idAt(s.state, 'd5')]);
    expect(wireStrings(p).has('poisoned_meat')).toBe(false);
    // The committed move is spent; the hidden ability changes the outcome (INV-06).
    const real = s.engine.applyAction(s.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('c3d5'),
    });
    expect(real.state.board[sq('d5')]).toBe(-1);
    expect(eventsOf(real.events, 'Captured')).toContainEqual(
      expect.objectContaining({ victim: knight, by: 'effect' }),
    );
  });

  it('R-INFO-004 previews use only public information: different hidden victim abilities give identical previews', () => {
    const previews = [['poisoned_meat'], ['last_word'], ['backdraft'], []].map((abilities) => {
      const s = setup({ fen: E1_FEN, white: plainWhite, black: { abilities } });
      const pub = s.engine.project(s.state, 'white');
      return { pub, preview: s.engine.preview(pub, loadoutOf(plainWhite), uciToMove('c3d5')) };
    });
    const first = must(previews[0], 'first preview');
    for (const other of previews.slice(1)) {
      expect(other.pub).toEqual(first.pub);
      expect(other.preview).toEqual(first.preview);
    }
  });

  it('R-INFO-004 revealed opponent abilities are used: after Poisoned Meat is seen on pawns the preview shows the retaliation', () => {
    const r = scenario({
      fen: TWO_PAWNS_FEN,
      white: plainWhite,
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8e7'],
    });
    const rook = idAt(r.state, 'h1');
    const pub = r.engine.project(r.state, 'white');
    const p = r.engine.preview(pub, loadoutOf(plainWhite), uciToMove('h1h7'));
    expect(p.legal).toBe(true);
    expect(eventsOf(p.events, 'Captured')).toContainEqual(
      expect.objectContaining({ victim: rook, by: 'effect' }),
    );
    expect(p.board.includes(rook)).toBe(false);
    expect(p.board[sq('h7')]).toBe(-1);
    // Only one ability of the pawn set has been seen, so the set is still flagged.
    expect(p.unknowns).toContainEqual({ kind: 'victimAbilities', pieceType: 'pawn' });
  });

  it('R-INFO-004 a fully revealed victim type carries no ? marker', () => {
    const white: ArmySpec = { abilities: ['scout'] };
    const r = scenario({
      fen: TWO_PAWNS_FEN,
      white,
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8e7'],
    });
    expect(r.state.reveals.black.complete).toContain('pawn');
    const rook = idAt(r.state, 'h1');
    const p = r.engine.preview(
      r.engine.project(r.state, 'white'),
      loadoutOf(white),
      uciToMove('h1h7'),
    );
    expect(p.unknowns.filter((u) => u.kind === 'victimAbilities')).toEqual([]);
    expect(p.board.includes(rook)).toBe(false);
  });

  it("R-INFO-004 the preview applies the viewer's own loadout (Hit and Run returns the knight)", () => {
    const white: ArmySpec = { abilities: ['hit_and_run'] };
    const s = setup({ fen: E1_FEN, white, black: {} });
    const knight = idAt(s.state, 'c3');
    const pub = s.engine.project(s.state, 'white');
    const withIt = s.engine.preview(pub, loadoutOf(white), uciToMove('c3d5'));
    expect(withIt.board[sq('c3')]).toBe(knight);
    expect(withIt.board[sq('d5')]).toBe(-1);
    const without = s.engine.preview(pub, loadoutOf({}), uciToMove('c3d5'));
    expect(without.board[sq('d5')]).toBe(knight);
    expect(without.board[sq('c3')]).toBe(-1);
  });
});

// ---- R-INFO-005 / R-SEC-001 -----------------------------------------------------------------------

describe('R-INFO-005 R-SEC-001 server information contract', () => {
  it('R-INFO-005 projectEvents replaces an unrevealed (veiled) opponent ability id with null and its source with hidden; the owner sees names', () => {
    const black: ArmySpec = { items: ['dual_adepts_glove'], abilities: ['veil', 'poisoned_meat'] };
    const r = scenario({ fen: E1_FEN, black, moves: ['c3d5'] });
    const knight = idAt(r.initial, 'c3');
    const forWhite = r.engine.projectEvents(r.state, r.events, 'white');
    const trig = eventsOf(forWhite, 'AbilityTriggered').filter((e) => e.side === 'black');
    expect(trig).toEqual([expect.objectContaining({ pieceType: 'pawn', ability: null })]);
    const cap = eventsOf(forWhite, 'Captured').find((e) => e.victim === knight);
    expect(cap).toMatchObject({ by: 'effect', source: { kind: 'hidden' } });
    const strings = new Set([
      ...wireStrings(forWhite),
      ...wireStrings(r.engine.project(r.state, 'white')),
    ]);
    expect(idsOf(black).filter((id) => strings.has(id))).toEqual([]);
    // The owner's own view keeps every name.
    const forBlack = r.engine.projectEvents(r.state, r.events, 'black');
    expect(eventsOf(forBlack, 'AbilityTriggered').filter((e) => e.side === 'black')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat' }),
    ]);
    expect(eventsOf(forBlack, 'Captured').find((e) => e.victim === knight)?.source).toMatchObject({
      kind: 'ability',
      id: 'poisoned_meat',
    });
  });

  it('R-INFO-005 R-INFO-002 DD-28 knowledge is per piece type: a name revealed on pawns stays hidden on a veiled knight', () => {
    const r = scenario({
      fen: '4k3/8/5n2/3p4/8/2N5/8/4KR2 w - - 0 1',
      black: {
        items: ['multitaskers_schedule', 'dual_adepts_glove'],
        sets: [['poisoned_meat'], ['veil', 'poisoned_meat'], [], [], [], []],
      },
      moves: ['c3d5', 'e8e7', 'f1f6'],
    });
    const rook = idAt(r.initial, 'f1');
    expect(r.state.reveals.black.abilities).toEqual({ pawn: ['poisoned_meat'] });
    expect(r.state.reveals.black.veiled).toEqual(['knight']);
    const last = must(r.steps[2], 'f1f6');
    expect(eventsOf(last.events, 'Captured')).toContainEqual(
      expect.objectContaining({ victim: rook, by: 'effect' }),
    );
    const forWhite = r.engine.projectEvents(r.state, last.events, 'white');
    expect(eventsOf(forWhite, 'AbilityTriggered').filter((e) => e.side === 'black')).toEqual([
      expect.objectContaining({ pieceType: 'knight', ability: null }),
    ]);
    expect(eventsOf(forWhite, 'Captured').find((e) => e.victim === rook)?.source).toEqual({
      kind: 'hidden',
    });
  });

  it('R-INFO-005 opponent usage counters appear only for revealed abilities', () => {
    const run = (abilities: string[]) =>
      scenario({
        fen: '1n2k3/8/8/8/B7/8/8/4K3 b - - 0 1',
        black: { items: ['dual_adepts_glove'], abilities },
        moves: ['b8c6', 'a4c6'],
      });
    const veiled = run(['veil', 'rebirth']);
    const knight = idAt(veiled.initial, 'b8');
    const key = `${knight}:rebirth`;
    // Rebirth brought the knight back and spent its charge (DD-17), hidden by Veil.
    expect(pieceAt(veiled.state, 'b8')).toMatchObject({ side: 'black', type: 'knight' });
    expect(veiled.state.usage).toEqual({ [key]: 1 });
    expect(veiled.engine.project(veiled.state, 'white').usage).toEqual({});
    expect(veiled.engine.project(veiled.state, 'black').usage).toEqual({ [key]: 1 });
    const forWhite = veiled.engine.projectEvents(veiled.state, veiled.events, 'white');
    expect(eventsOf(forWhite, 'ChargeSpent')).toEqual([
      expect.objectContaining({ side: 'black', ability: null }),
    ]);
    expect(eventsOf(forWhite, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: knight, source: { kind: 'hidden' } }),
    ]);
    expect(wireStrings(forWhite).has('rebirth')).toBe(false);

    const open = run(['rebirth']);
    expect(open.state.reveals.black.abilities.knight).toContain('rebirth');
    expect(open.engine.project(open.state, 'white').usage).toEqual({ [key]: 1 });
  });

  it('R-INFO-005 R-SEC-001 a pending ChoiceRequest is visible only to the chooser', () => {
    const s = setup({
      fen: '4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1',
      black: { abilities: ['backdraft'] },
    });
    const r = s.engine.applyAction(s.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('e4d5'),
    });
    expect(r.kind).toBe('needsChoice');
    if (r.kind !== 'needsChoice') return;
    expect(r.request.chooser).toBe('black');
    expect(r.request.options).toHaveLength(2);
    const forBlack = s.engine.project(r.state, 'black');
    expect(forBlack.pending).toEqual({ chooser: 'black', request: r.request });
    const forWhite = s.engine.project(r.state, 'white');
    expect(forWhite.pending).toEqual({ chooser: 'black', request: null });
    expect(wireStrings(forWhite).has(r.request.promptId)).toBe(false);
    // Answering clears it for both.
    const done = s.engine.applyAction(r.state, {
      kind: 'choice',
      side: 'black',
      promptId: r.request.promptId,
      option: 0,
    });
    expect(done.kind).toBe('done');
    for (const side of SIDES) expect(s.engine.project(done.state, side).pending).toBeNull();
  });

  it('R-INFO-005 DD-37 the projection carries legal moves only for the side to move', () => {
    const s = setup({ white: WHITE_PLAIN, black: BLACK_A });
    const white = s.engine.project(s.state, 'white');
    const expected = s.engine.legalMoves(s.state, 'white').map(moveToUci).sort();
    expect([...white.legal].sort()).toEqual(expected);
    expect(white.legal).toHaveLength(20);
    expect(s.engine.project(s.state, 'black').legal).toEqual([]);
    const after = s.engine.applyAction(s.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('e2e4'),
    }).state;
    expect(s.engine.project(after, 'white').legal).toEqual([]);
    expect([...s.engine.project(after, 'black').legal].sort()).toEqual(
      s.engine.legalMoves(after, 'black').map(moveToUci).sort(),
    );
    expect(s.engine.project(after, 'black').legal.length).toBeGreaterThan(0);
  });

  it("R-INFO-005 DD-37 DD-32 a revealed Stalwart king that may be captured appears in the attacker's legal moves", () => {
    const r = scenario({
      fen: '4k3/8/8/8/8/8/8/3RK3 b - - 0 1',
      black: { abilities: ['stalwart'] },
      moves: ['e8d8'],
    });
    expect(r.state.reveals.black.abilities.king).toContain('stalwart');
    const white = r.engine.project(r.state, 'white');
    expect(white.legal).toContain('d1d8');
    expect([...white.legal].sort()).toEqual(
      r.engine.legalMoves(r.state, 'white').map(moveToUci).sort(),
    );
    expect(r.engine.project(r.state, 'black').legal).toEqual([]);
  });

  it('R-INFO-005 DD-19 choice options are filtered by public rules only: Bulwark-protected pawns are offered and the chosen effect fizzles', () => {
    const s = setup({
      fen: '4k3/8/2p1p3/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['cleave'] },
      black: { elements: ['stone'] },
    });
    const c6 = idAt(s.state, 'c6');
    const e6 = idAt(s.state, 'e6');
    const r = s.engine.applyAction(s.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('c3d5'),
    });
    expect(r.kind).toBe('needsChoice');
    if (r.kind !== 'needsChoice') return;
    expect(r.request.chooser).toBe('white');
    expect(r.request.options).toHaveLength(2);
    expect(r.request.options).toEqual(
      expect.arrayContaining([
        { kind: 'piece', piece: c6, square: sq('c6') },
        { kind: 'piece', piece: e6, square: sq('e6') },
      ]),
    );
    const pick = r.request.options.findIndex((o) => o.kind === 'piece' && o.piece === c6);
    const done = s.engine.applyAction(r.state, {
      kind: 'choice',
      side: 'white',
      promptId: r.request.promptId,
      option: pick,
    });
    expect(eventsOf(done.events, 'EffectFizzled')).toContainEqual(
      expect.objectContaining({ ability: 'cleave', reason: 'bulwark', target: c6 }),
    );
    expect(pieceAt(done.state, 'c6')).toMatchObject({ side: 'black', type: 'pawn' });
  });
});

// ---- R-SEC-001 scan ---------------------------------------------------------------------------------

interface Snap {
  state: GameState;
  events: BattleEvent[];
}

interface ScanStats {
  snapshots: number;
  hiddenChecks: number;
  /** Hidden ids present in raw events that the projection had to strip. */
  stripped: number;
}

/** Checks the information contract for both viewers of one server-side snapshot. */
function checkContract(eng: Engine, snap: Snap, label: string, stats: ScanStats): void {
  stats.snapshots++;
  for (const viewer of SIDES) {
    const opp = opposite(viewer);
    const pub = eng.project(snap.state, viewer);
    const evs = eng.projectEvents(snap.state, snap.events, viewer);
    const hidden = unrevealedIds(snap.state, opp);
    const seen = new Set([...wireStrings(pub), ...wireStrings(evs)]);
    const where = `${label}, viewer ${viewer}`;
    expect(
      hidden.filter((id) => seen.has(id)),
      `${where}: unrevealed ids in the payload`,
    ).toEqual([]);
    const raw = wireStrings(snap.events);
    stats.stripped += hidden.filter((id) => raw.has(id)).length;
    stats.hiddenChecks += hidden.length;
    // Only public facts about the opponent army (8.1).
    expect(Object.keys(pub.armies[opp]).sort(), where).toEqual(PUBLIC_ARMY_KEYS);
    // Opponent usage counters only for abilities revealed on that piece type.
    for (const key of Object.keys(pub.usage)) {
      const [pid, ability] = key.split(':');
      const piece = snap.state.pieces[Number(pid)];
      if (piece && piece.side === opp)
        expect(
          snap.state.reveals[opp].abilities[piece.type] ?? [],
          `${where}: usage ${key}`,
        ).toContain(ability);
    }
    // A pending ChoiceRequest only for its chooser.
    if (pub.pending && pub.pending.chooser !== viewer)
      expect(pub.pending.request, `${where}: pending`).toBeNull();
    // DD-37: legal moves only for the side to move.
    if (snap.state.turn !== viewer) expect(pub.legal, `${where}: legal`).toEqual([]);
  }
}

/** Plays a scripted battle and returns every server-side snapshot, including suspended actions. */
function record(spec: ScenarioSpec): { engine: Engine; snaps: Snap[] } {
  const { engine, state, events } = setup(spec);
  const snaps: Snap[] = [{ state, events }];
  let s = state;
  for (const uci of spec.moves ?? []) {
    let r = engine.applyAction(s, { kind: 'move', side: s.turn, move: uciToMove(uci) });
    snaps.push({ state: r.state, events: r.events });
    while (r.kind === 'needsChoice') {
      r = engine.applyAction(r.state, {
        kind: 'choice',
        side: r.request.chooser,
        promptId: r.request.promptId,
        option: r.request.defaultOption,
      });
      snaps.push({ state: r.state, events: r.events });
    }
    s = r.state;
  }
  return { engine, snaps };
}

/** Deterministic LCG (tests only; the engine itself never uses randomness). */
function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

/** A seeded playout from the standard start that prefers captures, answering prompts at random. */
function playout(
  pair: { white: ArmySpec; black: ArmySpec },
  seed: number,
  plies: number,
): { engine: Engine; snaps: Snap[] } {
  const { engine, state, events } = setup({ white: pair.white, black: pair.black });
  const rnd = lcg(seed);
  const snaps: Snap[] = [{ state, events }];
  let s = state;
  for (let ply = 0; ply < plies && !s.result; ply++) {
    const moves = engine.legalMoves(s, s.turn);
    if (moves.length === 0) break;
    const captures = moves.filter((m) => (s.board[m.to] ?? -1) >= 0);
    const pool = captures.length > 0 && rnd() < 0.75 ? captures : moves;
    const move = must(pool[Math.floor(rnd() * pool.length)], 'move');
    let r = engine.applyAction(s, { kind: 'move', side: s.turn, move });
    snaps.push({ state: r.state, events: r.events });
    while (r.kind === 'needsChoice') {
      r = engine.applyAction(r.state, {
        kind: 'choice',
        side: r.request.chooser,
        promptId: r.request.promptId,
        option: Math.floor(rnd() * r.request.options.length),
      });
      snaps.push({ state: r.state, events: r.events });
    }
    s = r.state;
  }
  return { engine, snaps };
}

function expectDisjoint(white: ArmySpec | undefined, black: ArmySpec | undefined, label: string) {
  const b = new Set(idsOf(black));
  expect(
    idsOf(white).filter((id) => b.has(id)),
    `${label}: loadouts must be disjoint`,
  ).toEqual([]);
}

/** Hand-written battles covering Veil, pending choices, silence, negation, revival and Stalwart. */
const SCRIPTED: { name: string; spec: ScenarioSpec }[] = [
  {
    name: 'veiled Poisoned Meat (E1)',
    spec: {
      fen: E1_FEN,
      white: { elements: ['tide'], items: ['resonance_crystal'], abilities: ['hit_and_run'] },
      black: {
        elements: ['neutral'],
        items: ['dual_adepts_glove'],
        abilities: ['veil', 'poisoned_meat'],
      },
      moves: ['c3d5', 'e8e7', 'e1e2'],
    },
  },
  {
    name: 'veiled Backdraft prompt, attuned Hit and Run prompt, Rebirth, Masquerade Mask',
    spec: {
      fen: '4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1',
      white: {
        elements: ['tide'],
        items: ['masquerade_mask'],
        itemParams: { masquerade_mask: { element: 'grove' } },
        abilities: ['hit_and_run'],
      },
      black: {
        elements: ['neutral'],
        items: ['triple_adepts_gloves'],
        abilities: ['veil', 'backdraft', 'rebirth'],
      },
      moves: ['e4d5', 'e8e7', 'e1e2'],
    },
  },
  {
    name: 'veiled Rebirth with charges',
    spec: {
      fen: '1n2k3/8/8/8/B7/8/8/4K3 b - - 0 1',
      white: { elements: ['ember'], items: ['resonance_crystal'], abilities: ['cleave'] },
      black: {
        elements: ['neutral'],
        items: ['dual_adepts_glove'],
        abilities: ['veil', 'rebirth'],
      },
      moves: ['b8c6', 'a4c6', 'e8d8'],
    },
  },
  {
    name: "Scout's Lens, silenced Scout and Pierce, Schedule",
    spec: {
      fen: '4k3/8/8/1n2p3/3P4/2N5/8/4K3 w - - 0 1',
      white: {
        elements: ['tide'],
        items: ['scouts_lens', 'dual_adepts_glove'],
        abilities: ['scout', 'pierce'],
      },
      black: {
        elements: ['grove'],
        items: ['multitaskers_schedule', 'triple_adepts_gloves'],
        sets: [
          ['hit_and_run', 'antidote'],
          ['cleave'],
          ['backdraft'],
          [],
          ['riposte'],
          ['last_word'],
        ],
      },
      moves: ['d4e5', 'e8d8', 'c3b5', 'd8e7'],
    },
  },
  {
    name: 'Stalwart king under Veil is captured',
    spec: {
      fen: '4k3/8/8/8/8/8/8/3RK3 b - - 0 1',
      white: { abilities: ['last_word'], items: ['wardens_stopwatch'] },
      black: {
        items: ['resonance_crystal', 'dual_adepts_glove'],
        abilities: ['stalwart', 'veil'],
      },
      moves: ['e8d8', 'd1d8'],
    },
  },
];

const PAIRS: { name: string; white: ArmySpec; black: ArmySpec }[] = [
  {
    name: 'Blended Schedule vs veiled Grove with Masquerade Mask',
    white: {
      level: 30,
      elements: ['tide', 'ember'],
      items: [
        'blended_family',
        'journeymans_medallion',
        'multitaskers_schedule',
        'wardens_stopwatch',
      ],
      sets: [
        ['hit_and_run', 'scout', 'pierce', 'momentum'],
        ['momentum', 'hit_and_run', 'cleave', 'scout'],
        ['pierce', 'cleave', 'scout', 'momentum'],
        ['cleave', 'pierce', 'hit_and_run', 'scout'],
        ['scout', 'momentum', 'pierce', 'cleave'],
        ['stalwart', 'scout', 'pierce', 'cleave'],
      ],
    },
    black: {
      level: 30,
      elements: ['grove'],
      items: ['headmaster_ring', 'resonance_crystal', 'masquerade_mask'],
      itemParams: { masquerade_mask: { element: 'ember' } },
      abilities: ['veil', 'poisoned_meat', 'rebirth', 'backdraft', 'riposte'],
    },
  },
  {
    name: "Grove with Scout's Lens and a Tide Charm vs a veiled Blended Schedule",
    white: {
      level: 30,
      elements: ['grove'],
      items: ['triple_adepts_gloves', 'scouts_lens', 'attunement_charm'],
      itemParams: { attunement_charm: { element: 'tide' } },
      abilities: ['last_word', 'antidote', 'reinforce'],
    },
    black: {
      level: 30,
      elements: ['ember', 'tide'],
      items: ['blended_family', 'multitaskers_schedule', 'dual_adepts_glove', 'wardens_stopwatch'],
      sets: [
        ['backdraft', 'momentum'],
        ['riposte', 'cleave'],
        ['veil', 'poisoned_meat'],
        ['hit_and_run', 'scout'],
        ['pierce', 'rebirth'],
        ['stalwart', 'veil'],
      ],
    },
  },
];

describe('R-SEC-001 projection safety scan', () => {
  it('R-SEC-001 R-INFO-005 DD-37 no unrevealed opponent ability or item id appears in any projection or projected event of scripted battles', () => {
    const stats: ScanStats = { snapshots: 0, hiddenChecks: 0, stripped: 0 };
    for (const { name, spec } of SCRIPTED) {
      expectDisjoint(spec.white, spec.black, name);
      const { engine, snaps } = record(spec);
      snaps.forEach((snap, i) => checkContract(engine, snap, `${name} #${i}`, stats));
    }
    expect(stats.snapshots).toBeGreaterThan(SCRIPTED.length * 2);
    expect(stats.hiddenChecks).toBeGreaterThan(0);
    // The scan is not vacuous: raw events carried hidden ids that the projection stripped.
    expect(stats.stripped).toBeGreaterThan(0);
  });

  it('R-SEC-001 R-INFO-005 seeded playouts with rich hidden loadouts never leak an unrevealed id to either player', () => {
    const stats: ScanStats = { snapshots: 0, hiddenChecks: 0, stripped: 0 };
    for (const pair of PAIRS) {
      expectDisjoint(pair.white, pair.black, pair.name);
      for (const seed of [1, 2, 3]) {
        const { engine, snaps } = playout(pair, seed, 90);
        snaps.forEach((snap, i) =>
          checkContract(engine, snap, `${pair.name} seed ${seed} #${i}`, stats),
        );
      }
    }
    expect(stats.snapshots).toBeGreaterThan(100);
    expect(stats.hiddenChecks).toBeGreaterThan(0);
    expect(stats.stripped).toBeGreaterThan(0);
  });
});
