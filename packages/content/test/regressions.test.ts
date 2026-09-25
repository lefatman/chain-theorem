/**
 * Regression tests for the spec-conformance review of M2 (23 findings). Each test replays the
 * reviewer's scenario and asserts the spec behaviour; the finding number is in the test name. The
 * decisions they rely on are DD-41 (Cleave anchor), DD-42 (fresh burns), DD-43 (Overabundance at
 * battle start), DD-44 (Mask drop), DD-45 (Veil projection), DD-46 (public-knowledge option lists)
 * and DD-47 (king safety after the turn ends).
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceOption, ChoiceRequest, GameState, Move } from '@chain-theorem/rules';
import { parseSquare as sq, uciToMove } from '@chain-theorem/rules';
import { createEngine } from '@chain-theorem/rules';
import { defineAbility, fx, square, target } from '@chain-theorem/rules/sdk';
import { CAPS, engine, registry } from '../index.ts';
import { eventsOf, idAt, pieceAt, play, scenario, setup } from '../src/testing.ts';

const uci = (m: Move) =>
  `${'abcdefgh'[m.from & 7]}${(m.from >> 3) + 1}${'abcdefgh'[m.to & 7]}${(m.to >> 3) + 1}`;

const optionKey = (o: ChoiceOption) => JSON.stringify(o);

/** The first prompt raised by `move`, without answering it. */
function firstPrompt(state: GameState, move: string): ChoiceRequest | null {
  const r = engine.applyAction(state, { kind: 'move', side: state.turn, move: uciToMove(move) });
  return r.kind === 'needsChoice' ? r.request : null;
}

describe('M2 review regressions', () => {
  it('#1 INV-03 R-ELEM-005 DD-47 a burn that goes out at the end of the turn cannot leave the mover’s own king in check', () => {
    const r = scenario({
      fen: '8/p7/6k1/4p2R/3P4/8/8/K7 w - - 0 1',
      white: { elements: ['ember', 'tide'], items: ['blended_family'] },
      black: { elements: ['ember'] },
      moves: ['d4e5', 'a7a6', 'e5e6', 'g6f6', 'a1b1', 'f6e5', 'b1a1'],
    });
    const burn = (r.state.slices.hot_foot as { burning: { sq: number; turns: number }[] }).burning;
    expect(burn).toEqual([expect.objectContaining({ sq: sq('e5'), turns: 1 })]);
    // Black's turn ends the burn; Rh5 then attacks e5, so only king moves off e5 stay legal.
    const legal = engine.legalMoves(r.state, 'black').map(uci);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((m) => m.startsWith('e5'))).toBe(true);
    expect(legal).not.toContain('a6a5');
    expect(() =>
      engine.applyAction(r.state, { kind: 'move', side: 'black', move: uciToMove('a6a5') }),
    ).toThrow();
  });

  it('#2 INV-03 DD-17 a revived Tide rook that would check the actor’s king through its own pawn fizzles', () => {
    const r = scenario({
      fen: 'r6k/p7/8/8/8/8/6B1/1K6 b - - 0 1',
      black: { elements: ['tide'], abilities: ['rebirth'] },
      moves: ['a8e8', 'b1a1', 'e8e4', 'g2e4'],
    });
    expect(eventsOf(r.events, 'PieceRevived')).toEqual([]);
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'rebirth', reason: 'inv03' }),
    ]);
    expect(eventsOf(r.events, 'ChargeSpent')).toEqual([]);
    expect(r.state.inCheck).toBeNull();
  });

  it('#3 INV-03 R-RULES-002 a Riposte promotion that gains Flow and checks the actor’s king is not offered', () => {
    const s = setup({
      fen: '7k/8/8/8/8/3N4/1p6/2r1n1K1 w - - 0 1',
      black: { elements: ['ember', 'tide'], items: ['blended_family'], abilities: ['riposte'] },
    });
    const req = firstPrompt(s.state, 'd3c1');
    expect(req?.source.ability).toBe('riposte');
    const promos = (req?.options ?? [])
      .map((o) => (o.kind === 'move' ? (o.promotion ?? 'none') : o.kind))
      .sort();
    expect(promos).toEqual(['bishop', 'decline', 'knight']);
  });

  it('#4 DD-41 Cleave measures from the landing square even after Hit and Run moved the captor away', () => {
    const r = scenario({
      fen: '7k/8/5p2/4p3/2p5/3N4/8/K7 w - - 0 1',
      white: { abilities: ['hit_and_run', 'cleave'] },
      moves: ['d3e5'],
      answers: [0],
    });
    const effect = eventsOf(r.events, 'Captured').filter((e) => e.by === 'effect');
    expect(effect.map((e) => e.square)).toEqual([sq('f6')]);
    expect(pieceAt(r.state, 'c4')?.type).toBe('pawn');
    expect(pieceAt(r.state, 'd3')?.type).toBe('knight');
  });

  it('#5 R-INFO-002 Stalwart is not revealed when another interceptor fizzles the effect first', () => {
    const r = scenario({
      fen: '4q2k/8/8/4p3/8/8/4R3/4K3 w - - 0 1',
      white: { abilities: ['antidote', 'stalwart'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['e2e5'],
    });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ reason: 'protected' }),
    ]);
    expect(r.state.reveals.white.abilities.king ?? []).not.toContain('stalwart');
  });

  it('#6 #16 R-SEC-001 DD-46 an opponent’s Riposte may not expose the actor’s hidden Stalwart king; once public it may', () => {
    // Ne3xd5 leaves the e-file open: Re8 would check the white king. While Stalwart is hidden the
    // chooser judges the king as ordinary, so the capture is not offered and Stalwart stays hidden.
    const fen = '4r2k/8/8/3p4/8/1B2n3/8/4K3 w - - 0 1';
    const armies = {
      white: { abilities: ['stalwart'] },
      black: { elements: ['ember' as const], abilities: ['riposte'] },
    };
    const riposte = { kind: 'move', from: sq('e3'), to: sq('d5') } as const;
    const hidden = setup({ fen, ...armies });
    const req = firstPrompt(hidden.state, 'b3d5');
    expect(req?.options.map(optionKey) ?? []).not.toContain(optionKey(riposte));
    const r = scenario({ fen, ...armies, moves: ['b3d5'], answers: [{ kind: 'decline' }] });
    expect(r.state.inCheck).toBeNull();
    expect(r.state.reveals.white.abilities.king ?? []).not.toContain('stalwart');
    // With Stalwart public the capture is offered and the Stalwart king may stand in check.
    const known: GameState = {
      ...hidden.state,
      reveals: {
        ...hidden.state.reveals,
        white: { ...hidden.state.reveals.white, abilities: { king: ['stalwart'] } },
      },
    };
    const after = play(engine, known, 'b3d5', [riposte]).state;
    expect(pieceAt(after, 'd5')).toMatchObject({ side: 'black', type: 'knight' });
    expect(after.inCheck).toBe('white');
  });

  it('#7 R-INFO-002 capturing a Stalwart king with an ordinary-legal move does not reveal the captor’s own Stalwart', () => {
    const r = scenario({
      fen: 'k7/8/8/8/8/8/8/R6K w - - 0 1',
      white: { abilities: ['stalwart'] },
      black: { abilities: ['stalwart'] },
      moves: ['a1a8'],
    });
    expect(r.state.reveals.white.abilities.king ?? []).not.toContain('stalwart');
  });

  it('#8 a successful Riposte does not also run the attuned fallback (no spurious fizzle)', () => {
    const r = scenario({
      fen: '4r2k/8/8/4n3/3P4/8/8/K7 w - - 0 1',
      black: { elements: ['ember'], abilities: ['riposte'] },
      moves: ['d4e5'],
      answers: [{ kind: 'move', from: sq('e8'), to: sq('e5') }],
    });
    expect(pieceAt(r.state, 'e5')).toMatchObject({ side: 'black', type: 'rook' });
    expect(eventsOf(r.events, 'EffectFizzled')).toEqual([]);
  });

  it('#9 DD-42 a square ignited during the opponent’s turn keeps all 3 of that opponent’s turns', () => {
    const s = setup({
      fen: 'b6k/8/2P5/4p3/8/3N4/8/K7 w - - 0 1',
      white: { elements: ['ember'], abilities: ['riposte'] },
    });
    let state = play(engine, s.state, 'd3e5').state;
    state = play(engine, state, 'a8c6', [{ kind: 'move', from: sq('e5'), to: sq('c6') }]).state;
    const burns = (st: GameState) =>
      (st.slices.hot_foot as { burning: { sq: number; turns: number }[] }).burning.map(
        (b) => b.turns,
      );
    // Lit during Black's turn: that partial turn does not count.
    expect(burns(state)).toEqual([3]);
    state = play(engine, state, 'a1b1').state;
    expect(burns(state)).toEqual([3]);
    state = play(engine, state, 'h8g8').state;
    expect(burns(state)).toEqual([2]);
  });

  it('#10 #21 R-RULES-003 the repetition hash ignores an en passant square no legal move can use', () => {
    const pinned = setup({ fen: '4k3/8/8/K2pP2r/8/8/8/8 w - d6 0 2' });
    expect(engine.legalMoves(pinned.state, 'white').some((m) => m.to === sq('d6'))).toBe(false);
    const plain = setup({ fen: '4k3/8/8/K2pP2r/8/8/8/8 w - - 0 2' });
    expect(engine.stateHash(pinned.state)).toBe(engine.stateHash(plain.state));
    // A usable en passant square still counts.
    const open = setup({ fen: '4k3/8/8/3pP3/8/8/8/K7 w - d6 0 2' });
    const openPlain = setup({ fen: '4k3/8/8/3pP3/8/8/8/K7 w - - 0 2' });
    expect(engine.stateHash(open.state)).not.toBe(engine.stateHash(openPlain.state));
  });

  it('#11 R-ELEM-007 DD-43 a Grove pawn that spent 3 of 4 charges keeps 1 left after promoting to a Tide queen', () => {
    const s = setup({
      fen: '7k/4P3/8/8/8/8/8/K7 w - - 0 1',
      white: { elements: ['grove', 'tide'], items: ['blended_family'], abilities: ['momentum'] },
    });
    const pawn = idAt(s.state, 'e7');
    const state: GameState = { ...s.state, usage: { [`${pawn}:momentum`]: 3 } };
    const after = play(engine, state, 'e7e8q').state;
    expect(after.pieces[pawn]).toMatchObject({ type: 'queen', element: 'tide' });
    expect(engine.remainingCharges(after, pawn, 'momentum')).toBe(1);
  });

  it('#12 R-SEC-001 DD-46 option lists for the opponent do not depend on the actor’s hidden Stalwart', () => {
    // Nf5xd4: Backdraft may take c3 or e3; e3 shields the white king from Re8.
    const fen = '4r2k/8/8/5N2/3n4/2P1P3/8/4K3 w - - 0 1';
    const options = (white: string[]) => {
      const s = setup({ fen, white: { abilities: white }, black: { abilities: ['backdraft'] } });
      return firstPrompt(s.state, 'f5d4')?.options.map(optionKey) ?? [];
    };
    const ordinary = options([]);
    expect(options(['stalwart'])).toEqual(ordinary);
    expect(ordinary).not.toContain(
      optionKey({ kind: 'piece', piece: idAt(setup({ fen }).state, 'e3'), square: sq('e3') }),
    );
  });

  it('#12 R-SEC-001 DD-46 once Stalwart is public, the opponent may choose the shielding pawn', () => {
    const fen = '4r2k/8/8/5N2/3n4/2P1P3/8/4K3 w - - 0 1';
    const s = setup({
      fen,
      white: { abilities: ['stalwart'] },
      black: { abilities: ['backdraft'] },
    });
    const known: GameState = {
      ...s.state,
      reveals: {
        ...s.state.reveals,
        white: { ...s.state.reveals.white, abilities: { king: ['stalwart'] } },
      },
    };
    const keys = firstPrompt(known, 'f5d4')?.options.map(optionKey) ?? [];
    expect(keys).toContain(
      optionKey({ kind: 'piece', piece: idAt(s.state, 'e3'), square: sq('e3') }),
    );
  });

  it('#13 R-INFO-002 DD-28 triggers resolving after a mid-chain promotion stay on the pawn set and under its Veil', () => {
    const sets = [['momentum', 'hit_and_run', 'veil'], [], [], [], [], []];
    const r = scenario({
      fen: '7k/4p3/3P4/8/8/8/8/K7 w - - 0 1',
      white: { sets, items: ['multitaskers_schedule'] },
      moves: ['d6e7'],
      answers: [{ kind: 'move', from: sq('e7'), to: sq('e8'), promotion: 'queen' }],
    });
    const trig = eventsOf(r.events, 'AbilityTriggered');
    expect(trig.map((e) => [e.ability, e.pieceType])).toEqual([
      ['momentum', 'pawn'],
      ['hit_and_run', 'pawn'],
    ]);
    expect(r.state.reveals.white.abilities.queen).toBeUndefined();
    expect(r.state.reveals.white.abilities.pawn).toBeUndefined();
    const black = JSON.stringify(r.engine.projectEvents(r.state, r.events, 'black'));
    expect(black).not.toContain('"momentum"');
    expect(black).not.toContain('"hit_and_run"');
  });

  it('#14 R-ABIL-005 DD-45 a veiled activation shows no category, attunement, fizzle, charge or choice', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { elements: ['ember'], abilities: ['momentum', 'veil'] },
      moves: ['c3d5'],
      answers: [{ kind: 'decline' }],
    });
    expect(eventsOf(r.events, 'ChoiceMade')).toHaveLength(1);
    const black = r.engine.projectEvents(r.state, r.events, 'black');
    expect(eventsOf(black, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: null, category: null, attuned: null }),
    ]);
    expect(eventsOf(black, 'ChoiceMade')).toEqual([]);
    expect(eventsOf(black, 'EffectFizzled')).toEqual([]);
    expect(eventsOf(black, 'ChargeSpent')).toEqual([]);
    // The chooser keeps its own record.
    expect(eventsOf(r.engine.projectEvents(r.state, r.events, 'white'), 'ChoiceMade')).toHaveLength(
      1,
    );
  });

  it('#15 DD-26 DD-44 an Ember capture under a Mask shows no pending burn; the ignition drops the Mask', () => {
    const masked = {
      elements: ['ember' as const],
      items: ['masquerade_mask'],
      itemParams: { masquerade_mask: { element: 'tide' as const } },
    };
    const s = setup({ fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1', white: masked });
    let state = play(engine, s.state, 'c3d5').state;
    const pending = (st: GameState, viewer: 'white' | 'black') =>
      (engine.project(st, viewer).slices.hot_foot as { pending: unknown[] }).pending;
    expect(pending(state, 'white')).toHaveLength(1);
    expect(pending(state, 'black')).toEqual([]);
    expect(engine.project(state, 'black').armies.white.elements).toEqual(['tide']);
    state = play(engine, state, 'e8f8').state;
    const r = play(engine, state, 'd5b4');
    expect(eventsOf(r.step.events, 'SquareIgnited')).toHaveLength(1);
    expect(engine.project(r.state, 'black').armies.white.elements).toEqual(['ember']);
    expect(r.state.reveals.white.items).toContain('masquerade_mask');
  });

  it('#17 R-LOAD-002 an Attunement Charm that alone admits a trigger is revealed even when the trigger is then silenced', () => {
    // Reinforce needs a non-pawn victim unless attuned; the Grove charm attunes it on a Tide knight.
    // The Tide captor is silenced by the Grove victim (R-ELEM-002), so the trigger never resolves.
    const def = engine.registry.abilities.find((a) => a.id === 'reinforce');
    expect(def?.affinity).toBe('grove');
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: {
        elements: ['tide'],
        items: ['attunement_charm'],
        itemParams: { attunement_charm: { element: 'grove' } },
        abilities: ['reinforce'],
      },
      black: { elements: ['grove'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'reinforce' }),
    ]);
    expect(r.state.reveals.white.items).toContain('attunement_charm');
  });

  it('#18 R-LOAD-004 a missing or fractional level is rejected (bad_level)', () => {
    const loadout = { elements: ['ember' as const], items: [], sets: [['hit_and_run']] };
    for (const level of [Number.NaN, 0, 2.5, 99, undefined as unknown as number]) {
      const v = engine.validateLoadout(loadout, { level });
      expect(v.ok).toBe(false);
      expect(v.errors).toContainEqual(expect.objectContaining({ rule: 2, code: 'bad_level' }));
    }
    expect(engine.validateLoadout(loadout, { level: 1 }).ok).toBe(true);
  });

  it('#19 R-LOAD-004 a strict newBattle refuses an illegal loadout', () => {
    const bad = { elements: ['ember' as const], items: [], sets: [['riposte']] };
    const ok = { elements: ['ember' as const], items: [], sets: [['hit_and_run']] };
    const setupFor = (loadout: typeof bad, strict: boolean) => ({
      format: 'full' as const,
      strict,
      white: { loadout, level: 1 },
      black: { loadout: ok, level: 1 },
    });
    expect(() => engine.newBattle(setupFor(bad, true))).toThrow();
    expect(() => engine.newBattle(setupFor(bad, false))).not.toThrow();
    expect(() => engine.newBattle(setupFor(ok, true))).not.toThrow();
  });

  it('#20 R-INFO-003 an inconsistent public record gives no certain or impossible items', () => {
    const s = setup({ white: { level: 1 } });
    const pub = engine.project(s.state, 'black');
    // Three revealed items at level 1 (one slot): no combination fits.
    const broken = {
      ...pub,
      armies: {
        ...pub.armies,
        white: {
          ...pub.armies.white,
          revealed: {
            ...pub.armies.white.revealed,
            items: ['scouts_lens', 'headmaster_ring', 'resonance_crystal'],
          },
        },
      },
    };
    const d = engine.deduce(broken);
    expect(d.certainItems).toEqual([]);
    expect(d.impossibleItems).toEqual([]);
  });

  it('#22 R-INFO-004 an en passant preview flags the victim’s unknown abilities', () => {
    const s = setup({
      fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2',
      black: { abilities: ['poisoned_meat'] },
    });
    const pub = engine.project(s.state, 'white');
    const own = s.state.armies.white.loadout;
    const p = engine.preview(pub, own, uciToMove('e5d6'));
    expect(p.legal).toBe(true);
    expect(p.unknowns).toContainEqual({ kind: 'victimAbilities', pieceType: 'pawn' });
  });

  it('DD-17 DD-48 an activation with an immediate and a chain-end effect spends one charge', () => {
    const twice = defineAbility({
      id: 'test_twice',
      name: 'Test Twice',
      version: 1,
      category: 'CAPTURES',
      affinity: 'neutral',
      eligible: 'all',
      tags: [],
      minLevel: 1,
      slotCost: 1,
      limits: { perAction: 1, charges: 2 },
      effects: [
        fx.move(target.self(), square.origin()),
        fx.atChainEnd([fx.reveal({ what: 'typeSet', of: 'victim' })]),
      ],
      text: { short: 'test', rules: 'test' },
      status: 'PLAYTEST',
    });
    const e = createEngine({ ...registry, abilities: [...registry.abilities, twice] }, CAPS);
    const s = setup({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: ['test_twice'] },
    });
    const r = play(e, s.state, 'c3d5');
    const knight = idAt(s.state, 'c3');
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    expect(eventsOf(r.step.events, 'ChargeSpent')).toEqual([
      expect.objectContaining({ ability: 'test_twice', remaining: 1 }),
    ]);
    expect(r.state.usage[`${knight}:test_twice`]).toBe(1);
  });
});
