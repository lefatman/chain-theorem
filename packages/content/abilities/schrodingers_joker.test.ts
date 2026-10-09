/**
 * Schrödinger's Joker (5.8): Captures, neutral, non-king, 1 charge. "After capturing a victim of
 * higher rank, from the owner's next turn the captor has a twin: a second piece of the same type,
 * element and abilities that starts on the captor's square and makes its own move each turn right
 * after the owner's normal move. Capturing or effect-capturing any member of a twin group removes
 * the whole group. A twin that captures a higher-rank piece spawns another twin into the group; a
 * group holds at most three pieces."
 *
 * Expected behaviour comes from spec 4.1 (INV-01, INV-03, INV-04), 5.1 (DD-97), 5.2 (SPAWN), 5.4,
 * 6.2, 9.1, R-RULES-005 and DD-101, not from the engine's current output.
 */
import { describe, expect, it } from 'vitest';
import { type ChoiceRequest, type GameState, parseSquare } from '@chain-theorem/rules';
import { CAPS, PLAYTEST_FLAGS, abilityById } from '../index.ts';
import { type ArmySpec, eventsOf, idAt, pieceAt, play, scenario, setup } from '../src/testing.ts';

const sq = parseSquare;
const pickMove = (uci: string) => (req: ChoiceRequest) => {
  const i = req.options.findIndex(
    (o) => o.kind === 'move' && o.from === sq(uci.slice(0, 2)) && o.to === sq(uci.slice(2, 4)),
  );
  if (i < 0) throw new Error(`move ${uci} is not offered: ${JSON.stringify(req.options)}`);
  return i;
};
const waiting = (s: GameState) =>
  s.pieces.filter((p) => p.square < 0 && p.spawnSquare !== undefined).map((p) => p.id);

// White knight c3 (Joker), king e1; black rook d5, pawn h7, king e8. c3xd5 beats a higher rank.
const FEN = '4k3/7p/8/3r4/8/2N5/8/4K3 w - - 0 1';
const JOKER: ArmySpec = { elements: ['neutral'], abilities: ['schrodingers_joker'] };

describe("Schrödinger's Joker (5.8, DD-97, DD-101)", () => {
  it('R-ABIL-005 module data: Captures, neutral, non-king, 1 charge, level 20, a rank condition and a spawn effect; shipped behind the PLAYTEST flag', () => {
    const def = abilityById.get('schrodingers_joker');
    expect(def).toMatchObject({
      category: 'CAPTURES',
      affinity: 'neutral',
      eligible: ['pawn', 'knight', 'bishop', 'rook', 'queen'],
      minLevel: 20,
      slotCost: 1,
      limits: { perAction: 1, charges: 1 },
      conditions: [{ rank: { of: 'victim', cmp: '>', to: 'captor' } }],
      effects: [{ op: 'spawn' }],
    });
    expect(def?.retired ?? false).toBe(!PLAYTEST_FLAGS.schrodingers_joker);
    expect(CAPS.TWIN_GROUP_MAX).toBe(3);
  });

  it('R-ABIL-002 DD-97 taking a higher-rank piece spawns a waiting twin: a new piece id, same type and element, a linked group, the charge spent', () => {
    const r = scenario({ fen: FEN, white: JOKER, moves: ['c3d5'] });
    const knight = idAt(r.initial, 'c3');
    const twin = r.initial.pieces.length;
    expect(r.state.pieces).toHaveLength(twin + 1);
    expect(r.state.pieces[twin]).toMatchObject({
      id: twin,
      side: 'white',
      type: 'knight',
      element: 'neutral',
      square: -1,
      start: sq('d5'),
      capturedSeq: -1,
      spawnSquare: sq('d5'),
    });
    expect(r.state.links).toEqual([{ ability: 'schrodingers_joker', members: [knight, twin] }]);
    expect(eventsOf(r.events, 'Spawned')).toEqual([
      expect.objectContaining({ piece: twin, twinOf: knight, side: 'white', square: sq('d5') }),
    ]);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ ability: 'schrodingers_joker', remaining: 0 }),
    ]);
    // Nothing moves until White's next turn: no prompt in this action.
    expect(r.prompts).toEqual([]);
    // Equal rank does not qualify: a knight taking a knight spawns nothing.
    const equal = scenario({
      fen: '4k3/7p/8/3n4/8/2N5/8/4K3 w - - 0 1',
      white: JOKER,
      moves: ['c3d5'],
    });
    expect(eventsOf(equal.events, 'AbilityTriggered')).toEqual([]);
    expect(equal.state.links).toBeUndefined();
  });

  it("R-ABIL-004 5.4 DD-101 on the owner's next turn the twin moves out from under its original: a declinable bonus-move prompt, the original moves and the twin takes the square", () => {
    const { engine, state } = setup({ fen: FEN, white: JOKER });
    const knight = idAt(state, 'c3');
    const twin = state.pieces.length;
    let s = play(engine, state, 'c3d5').state;
    s = play(engine, s, 'h7h6').state;
    // White's normal move (the king), then the twin's move: the knight on d5 moves out for it.
    const { state: after, step } = play(engine, s, 'e1f1', [pickMove('d5f6')]);
    expect(step.prompts).toHaveLength(1);
    const req = step.prompts[0] as ChoiceRequest;
    expect(req).toMatchObject({
      chooser: 'white',
      kind: 'bonusMove',
      source: { ability: 'schrodingers_joker', piece: twin, side: 'white' },
      defaultOption: 0,
    });
    expect(req.options[0]).toEqual({ kind: 'decline' });
    expect(req.options.slice(1).every((o) => o.kind === 'move' && o.from === sq('d5'))).toBe(true);
    expect(
      eventsOf(step.events, 'MoveMade').map((e) => [e.piece, e.from, e.to, e.twin ?? false]),
    ).toEqual([
      [idAt(s, 'e1'), sq('e1'), sq('f1'), false],
      [knight, sq('d5'), sq('f6'), true],
    ]);
    expect(eventsOf(step.events, 'Emerged')).toEqual([
      expect.objectContaining({ piece: twin, side: 'white', square: sq('d5') }),
    ]);
    expect(pieceAt(after, 'f6')?.id).toBe(knight);
    expect(pieceAt(after, 'd5')?.id).toBe(twin);
    expect(after.pieces[twin]?.spawnSquare).toBeUndefined();
    expect(after.turn).toBe('black');
    expect(after.ply).toBe(3);
  });

  it('DD-18 DD-101 declining keeps the twin waiting; an empty spawn square lets it step out first and then move', () => {
    const { engine, state } = setup({ fen: FEN, white: JOKER });
    const twin = state.pieces.length;
    let s = play(engine, state, 'c3d5').state;
    s = play(engine, s, 'h7h6').state;
    const declined = play(engine, s, 'e1f1', [0]);
    expect(eventsOf(declined.step.events, 'Emerged')).toEqual([]);
    expect(waiting(declined.state)).toEqual([twin]);
    // The original leaves d5 as the normal move: the twin steps onto d5 and may move from there.
    const stepped = play(engine, s, 'd5b6', [pickMove('d5e7')]);
    expect(eventsOf(stepped.step.events, 'Emerged')).toEqual([
      expect.objectContaining({ piece: twin, square: sq('d5') }),
    ]);
    expect(
      eventsOf(stepped.step.events, 'MoveMade').map((e) => [e.piece, e.to, e.twin ?? false]),
    ).toEqual([
      [idAt(s, 'd5'), sq('b6'), false],
      [twin, sq('e7'), true],
    ]);
    expect(pieceAt(stepped.state, 'e7')?.id).toBe(twin);
  });

  it('DD-101 a twin on the board gets one extra move after every normal move of its owner, and may decline', () => {
    const { engine, state } = setup({ fen: FEN, white: JOKER });
    const twin = state.pieces.length;
    let s = play(engine, state, 'c3d5').state;
    for (const m of ['h7h6', 'd5b6']) s = play(engine, s, m, [pickMove('d5e7')]).state;
    // Twin on e7, original on b6. Black moves; White moves the king; the twin is asked again.
    s = play(engine, s, 'h6h5').state;
    const { state: after, step } = play(engine, s, 'e1f1', [pickMove('e7g6')]);
    const req = step.prompts[0] as ChoiceRequest;
    expect(req.source.piece).toBe(twin);
    expect(req.options.slice(1).every((o) => o.kind === 'move' && o.from === sq('e7'))).toBe(true);
    expect(pieceAt(after, 'g6')?.id).toBe(twin);
    expect(pieceAt(after, 'b6')?.type).toBe('knight');
  });

  it('R-RULES-005 9.1 DD-101 linked fate: capturing any member removes the whole group, waiting twins included', () => {
    const { engine, state } = setup({ fen: FEN, white: JOKER, black: { elements: ['neutral'] } });
    const knight = idAt(state, 'c3');
    const twin = state.pieces.length;
    let s = play(engine, state, 'c3d5').state;
    // The black king walks e8-d7-d6 and takes the knight on d5 (nothing defends it).
    s = play(engine, s, 'e8d7').state;
    s = play(engine, s, 'e1f1', [0]).state; // the twin stays waiting
    s = play(engine, s, 'd7d6').state;
    s = play(engine, s, 'f1g1', [0]).state;
    const { state: after, step } = play(engine, s, 'd6d5');
    // The king took the knight on d5 (rank 5 > 2: no retaliation); the waiting twin goes with it.
    expect(
      eventsOf(step.events, 'Captured').map((e) => [e.victim, e.by, e.waiting ?? false]),
    ).toEqual([
      [knight, 'move', false],
      [twin, 'effect', true],
    ]);
    expect(eventsOf(step.events, 'Captured')[1]?.source).toEqual({
      kind: 'rule',
      id: 'linked_fate',
    });
    expect(after.links).toBeUndefined();
    expect(after.pieces[twin]).toMatchObject({ square: -1 });
    expect(after.pieces[twin]?.spawnSquare).toBeUndefined();
    expect(after.pieces[twin]?.capturedSeq).toBeGreaterThan(0);
  });

  it('DD-101 linked fate on the board: an effect capture of a twin removes the original too, credited to the capturing side', () => {
    // Only the black pawn carries Poisoned Meat (per-type sets), so the rook's capture spawns.
    const { engine, state } = setup({
      fen: FEN,
      white: JOKER,
      black: {
        elements: ['neutral'],
        items: ['multitaskers_schedule'],
        sets: [['poisoned_meat'], [], [], [], [], []],
      },
    });
    const knight = idAt(state, 'c3');
    const twin = state.pieces.length;
    let s = play(engine, state, 'c3d5').state;
    s = play(engine, s, 'h7h6').state;
    s = play(engine, s, 'd5b6', [pickMove('d5f4')]).state; // original b6, twin f4
    s = play(engine, s, 'h6h5').state;
    // The twin takes the Poisoned Meat pawn: the retaliation removes the twin, and the original
    // falls with it.
    const { state: after, step } = play(engine, s, 'e1f1', [pickMove('f4h5')]);
    expect(eventsOf(step.events, 'Captured').map((e) => [e.victim, e.by])).toEqual([
      [idAt(s, 'h5'), 'move'],
      [twin, 'effect'],
      [knight, 'effect'],
    ]);
    expect(after.pieces[knight]?.square).toBe(-1);
    expect(after.links).toBeUndefined();
    // Both knights count for Black's objective (DD-38: effect captures credit the causing side).
    expect(after.objective.black).toBe(2);
  });

  it('DD-101 a twin that takes a higher-rank piece spawns a third member with its own charge; a full group fizzles group_full', () => {
    // White Nc3 (Joker), Kb1; Black Kh8, rooks c8, e7, g6, d5, pawn a7. Black only pushes the pawn.
    const { engine, state } = setup({
      fen: '2r4k/p3r3/6r1/3r4/8/2N5/8/1K6 w - - 0 1',
      white: JOKER,
      black: { elements: ['neutral'] },
    });
    const knight = idAt(state, 'c3');
    const t1 = state.pieces.length;
    const t2 = t1 + 1;
    let s = play(engine, state, 'c3d5').state; // the knight takes the rook: T1 waits on d5
    s = play(engine, s, 'a7a6').state;
    s = play(engine, s, 'b1a1', [pickMove('d5f4')]).state; // the knight steps out, T1 emerges on d5
    s = play(engine, s, 'a6a5').state;
    const spawn2 = play(engine, s, 'a1b1', [pickMove('d5e7')]); // T1 takes the rook e7: its own charge
    s = spawn2.state;
    expect(eventsOf(spawn2.step.events, 'Spawned')).toEqual([
      expect.objectContaining({ piece: t2, twinOf: t1, square: sq('e7') }),
    ]);
    expect(s.links?.[0]?.members).toEqual([knight, t1, t2]);
    expect(waiting(s)).toEqual([t2]);
    expect(engine.remainingCharges(s, knight, 'schrodingers_joker')).toBe(0);
    expect(engine.remainingCharges(s, t1, 'schrodingers_joker')).toBe(0);
    expect(engine.remainingCharges(s, t2, 'schrodingers_joker')).toBe(1);
    s = play(engine, s, 'a5a4').state;
    // T1 (on e7) moves out quietly, T2 emerges on e7 and is asked for its own move (declined).
    const out = play(engine, s, 'b1a1', [pickMove('e7f5'), 0]);
    s = out.state;
    expect(out.step.prompts.map((p) => p.source.piece)).toEqual([t1, t2]);
    expect(eventsOf(out.step.events, 'Emerged')).toEqual([
      expect.objectContaining({ piece: t2, square: sq('e7') }),
    ]);
    expect(pieceAt(s, 'e7')?.id).toBe(t2);
    s = play(engine, s, 'a4a3').state;
    // T1 declines; T2 takes the rook c8 with a fresh charge, but the group is full.
    const full = play(engine, s, 'a1b1', [0, pickMove('e7c8')]);
    expect(full.step.prompts.map((p) => p.source.piece)).toEqual([t1, t2]);
    expect(eventsOf(full.step.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'schrodingers_joker', reason: 'group_full' }),
    ]);
    expect(full.state.pieces).toHaveLength(state.pieces.length + 2);
    expect(full.state.links?.[0]?.members).toEqual([knight, t1, t2]);
    expect(pieceAt(full.state, 'c8')?.id).toBe(t2);
  });

  it('R-ELEM-002 the foil silences the spawn; a Capturing negation (Stonewall) stops it too', () => {
    const silenced = scenario({
      fen: FEN,
      white: { elements: ['ember'], abilities: ['schrodingers_joker'] },
      black: { elements: ['tide'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(silenced.events, 'AbilitySilenced').map((e) => e.ability)).toEqual([
      'schrodingers_joker',
    ]);
    expect(silenced.state.links).toBeUndefined();
    const negated = scenario({
      fen: FEN,
      white: JOKER,
      black: { elements: ['neutral'], abilities: ['stonewall'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(negated.events, 'AbilityNegated').map((e) => e.ability)).toEqual([
      'schrodingers_joker',
    ]);
    expect(negated.state.pieces).toHaveLength(negated.initial.pieces.length);
  });

  it('R-RULES-005 INV-04 a waiting twin is position: the repetition hash tells it apart, and a JSON round trip replays identically', () => {
    const { engine, state } = setup({ fen: FEN, white: JOKER });
    const s1 = play(engine, state, 'c3d5').state;
    const stripped: GameState = { ...s1, pieces: s1.pieces.slice(0, -1) };
    delete stripped.links;
    expect(engine.stateHash(s1)).not.toBe(engine.stateHash(stripped));
    const fromJson = JSON.parse(JSON.stringify(s1)) as GameState;
    expect(engine.stateHash(fromJson)).toBe(engine.stateHash(s1));
    const a = play(engine, play(engine, s1, 'h7h6').state, 'e1f1', [1]).state;
    const b = play(engine, play(engine, fromJson, 'h7h6').state, 'e1f1', [1]).state;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('R-SEC-001 the twin shows in both projections with its spawn square; the Spawned event names the displayed element', () => {
    const r = scenario({ fen: FEN, white: JOKER, moves: ['c3d5'] });
    const twin = r.initial.pieces.length;
    for (const viewer of ['white', 'black'] as const) {
      const pub = r.engine.project(r.state, viewer);
      expect(pub.pieces[twin]).toMatchObject({ id: twin, square: -1, spawnSquare: sq('d5') });
      expect(r.engine.projectEvents(r.state, r.events, viewer).some((e) => e.k === 'Spawned')).toBe(
        true,
      );
    }
  });
});
