/**
 * Element tests (R-ELEM-001 identities and traits, R-ELEM-002 the silence rule and silenceScope,
 * R-ELEM-003 attuned versions, R-ELEM-004 Blended Family; DD-23, DD-28, DD-36).
 *
 * Expected behaviour comes from spec 5.4, 5.7, 6.1-6.5, 8.2 and DD-23, DD-28 and DD-36, not from the
 * engine's current output. The beats relation below is written from spec 6 directly.
 */
import { describe, expect, it } from 'vitest';
import type { BattleEvent, ElementId } from '@chain-theorem/rules';
import { registry } from '../index.ts';
import type { HotFootState } from '../traits/hot_foot.ts';
import {
  type ScenarioSpec,
  eventsOf,
  idAt,
  parseSquare,
  pieceAt,
  play,
  scenario,
  setup,
} from '../src/testing.ts';

const sq = parseSquare;
/** Ember beats Grove beats Tide beats Ember; Storm beats Frost beats Stone beats Storm (spec 6). */
const BEATS: Partial<Record<ElementId, ElementId>> = {
  ember: 'grove',
  grove: 'tide',
  tide: 'ember',
  storm: 'frost',
  frost: 'stone',
  stone: 'storm',
};
const beats = (a: ElementId, b: ElementId) => BEATS[a] === b;
const SIX: ElementId[] = ['ember', 'tide', 'grove', 'storm', 'stone', 'frost'];
const ALL: ElementId[] = [...SIX, 'neutral'];
/** Knight c3 takes the pawn d5. */
const FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';

type Outcome = 'triggered' | 'silenced' | 'negated' | 'none';
function outcome(events: readonly BattleEvent[], ability: string): Outcome {
  if (eventsOf(events, 'AbilityNegated').some((e) => e.ability === ability)) return 'negated';
  if (eventsOf(events, 'AbilitySilenced').some((e) => e.ability === ability)) return 'silenced';
  if (eventsOf(events, 'AbilityTriggered').some((e) => e.ability === ability)) return 'triggered';
  return 'none';
}
const triggered = (events: readonly BattleEvent[]) =>
  eventsOf(events, 'AbilityTriggered').map((e) => e.ability);

function capture(
  captor: ElementId,
  captorSet: string[],
  victim: ElementId,
  victimSet: string[],
  extra: Partial<ScenarioSpec> = {},
) {
  return scenario({
    fen: FEN,
    white: { elements: [captor], abilities: captorSet },
    black: { elements: [victim], abilities: victimSet },
    moves: ['c3d5'],
    ...extra,
  });
}

describe('elements (R-ELEM-001 to R-ELEM-004)', () => {
  it('R-ELEM-001 each of the six elements has exactly one always-on trait module', () => {
    const byElement = Object.fromEntries(registry.traits.map((t) => [t.element, t.id]));
    expect(byElement).toEqual({
      ember: 'hot_foot',
      tide: 'flow',
      grove: 'overabundance',
      storm: 'always_first',
      stone: 'bulwark',
      frost: 'stillness',
    });
    expect(registry.traits).toHaveLength(6);
    // Traits are not abilities: they are never loadout cards.
    const abilityIds = registry.abilities.map((a) => a.id);
    for (const t of registry.traits) expect(abilityIds).not.toContain(t.id);
  });

  it('R-ELEM-001 DD-23 the engine runs battles with all six elements (and neutral); real loadouts are limited to the enabled MVP elements', () => {
    for (const element of ALL) {
      const s = setup({ white: { elements: [element] }, black: { elements: [element] } });
      expect(
        s.state.pieces.every((p) => p.element === element),
        element,
      ).toBe(true);
    }
    const codes = (elements: ElementId[]) =>
      setup({})
        .engine.validateLoadout({ elements, items: [], sets: [[]] }, { level: 30 })
        .errors.map((e) => e.code);
    for (const element of ['ember', 'tide', 'grove'] as const)
      expect(codes([element]), element).toEqual([]);
    for (const element of ['storm', 'stone', 'frost', 'neutral'] as const)
      expect(codes([element]), element).toContain('element_disabled');
  });

  it('R-ELEM-002 R-ELEM-001 the silence table over every captor and victim element (neutral has no relationships)', () => {
    // Captor: Scout (Capturing), Hit and Run (Captures). Victim: Last Word (Captured).
    // Stillness (Frost victim) negates the captor's Captures abilities, and negation takes
    // precedence over silence (DD-36).
    const actual: string[] = [];
    const expected: string[] = [];
    for (const c of ALL) {
      for (const v of ALL) {
        const r = capture(c, ['scout', 'hit_and_run'], v, ['last_word']);
        actual.push(
          `${c}x${v}: scout=${outcome(r.events, 'scout')} hit_and_run=${outcome(r.events, 'hit_and_run')} last_word=${outcome(r.events, 'last_word')}`,
        );
        const scout = beats(v, c) ? 'silenced' : 'triggered';
        const hnr = v === 'frost' ? 'negated' : beats(v, c) ? 'silenced' : 'triggered';
        const lw = beats(c, v) ? 'silenced' : 'triggered';
        expected.push(`${c}x${v}: scout=${scout} hit_and_run=${hnr} last_word=${lw}`);
        // AbilitySilenced names the other piece of the capture.
        const knight = idAt(r.initial, 'c3');
        const pawn = idAt(r.initial, 'd5');
        for (const e of eventsOf(r.events, 'AbilitySilenced'))
          expect(e.by, `${c}x${v} ${e.ability}`).toBe(e.side === 'white' ? pawn : knight);
      }
    }
    expect(actual).toEqual(expected);
  });

  it("R-ELEM-002 captor beats victim: the victim's Captured abilities are silenced and revealed by name", () => {
    // Ember knight takes a Grove Poisoned Meat pawn: Poisoned Meat is silenced, the knight lives.
    const r = capture('ember', ['hit_and_run'], 'grove', ['poisoned_meat']);
    const knight = idAt(r.initial, 'c3');
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({
        side: 'black',
        ability: 'poisoned_meat',
        category: 'CAPTURED',
        pieceType: 'pawn',
        by: knight,
      }),
    ]);
    expect(eventsOf(r.events, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'black',
        info: { kind: 'ability', pieceType: 'pawn', ability: 'poisoned_meat' },
        cause: 'silenced',
      }),
    );
    expect(r.state.reveals.black.abilities.pawn).toEqual(['poisoned_meat']);
    expect(triggered(r.events)).toEqual(['hit_and_run']);
    expect(eventsOf(r.events, 'Captured')).toHaveLength(1);
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
  });

  it("R-ELEM-002 victim beats captor: the captor's Capturing and Captures abilities are silenced and revealed by name", () => {
    const r = capture('ember', ['scout', 'hit_and_run'], 'tide', []);
    const pawn = idAt(r.initial, 'd5');
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'white', ability: 'scout', category: 'CAPTURING', by: pawn }),
      expect.objectContaining({
        side: 'white',
        ability: 'hit_and_run',
        category: 'CAPTURES',
        by: pawn,
      }),
    ]);
    expect(triggered(r.events)).toEqual([]);
    expect(r.state.reveals.white.abilities.knight?.slice().sort()).toEqual([
      'hit_and_run',
      'scout',
    ]);
    // Scout did not reveal the victim's set.
    expect(r.state.reveals.black.complete).toEqual([]);
    expect(pieceAt(r.state, 'd5')?.type).toBe('knight');

    // The advantaged victim's own Captured abilities still fire: Poisoned Meat removes the knight.
    const pm = capture('ember', ['hit_and_run'], 'tide', ['poisoned_meat']);
    expect(outcome(pm.events, 'hit_and_run')).toBe('silenced');
    expect(triggered(pm.events)).toEqual(['poisoned_meat']);
    expect(pieceAt(pm.state, 'd5')).toBeUndefined();
  });

  it('R-ELEM-002 E1 same element, or elements from different triangles: nothing is silenced', () => {
    for (const [c, v] of [
      ['tide', 'tide'],
      ['neutral', 'neutral'],
      ['frost', 'tide'],
      ['grove', 'stone'],
      ['ember', 'neutral'],
    ] as [ElementId, ElementId][]) {
      const r = capture(c, ['hit_and_run'], v, ['poisoned_meat']);
      expect(eventsOf(r.events, 'AbilitySilenced'), `${c}x${v}`).toEqual([]);
      expect(triggered(r.events), `${c}x${v}`).toEqual(['poisoned_meat', 'hit_and_run']);
      expect(eventsOf(r.events, 'EffectFizzled'), `${c}x${v}`).toEqual([
        expect.objectContaining({ ability: 'hit_and_run', reason: 'no_body' }),
      ]);
      expect(pieceAt(r.state, 'c3'), `${c}x${v}`).toBeUndefined();
      expect(pieceAt(r.state, 'd5'), `${c}x${v}`).toBeUndefined();
    }
  });

  it('R-ELEM-002 silenceScope REACTIONS_ONLY spares a disadvantaged captor’s Capturing abilities only', () => {
    const caps = { caps: { SILENCE_SCOPE: 'REACTIONS_ONLY' as const } };
    const r = capture('ember', ['scout', 'hit_and_run'], 'tide', [], caps);
    expect(outcome(r.events, 'scout')).toBe('triggered');
    expect(outcome(r.events, 'hit_and_run')).toBe('silenced');
    const v = capture('ember', ['hit_and_run'], 'grove', ['poisoned_meat'], caps);
    expect(outcome(v.events, 'poisoned_meat')).toBe('silenced');
    expect(pieceAt(v.state, 'c3')?.type).toBe('knight');

    const all = capture('ember', ['scout', 'hit_and_run'], 'tide', [], {
      caps: { SILENCE_SCOPE: 'ALL_TRIGGERS' },
    });
    expect(outcome(all.events, 'scout')).toBe('silenced');
  });

  it('R-ELEM-002 silenceScope OFF disables the advantage in both directions', () => {
    const caps = { caps: { SILENCE_SCOPE: 'OFF' as const } };
    const r = capture('ember', ['scout', 'hit_and_run'], 'tide', [], caps);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([]);
    expect(triggered(r.events)).toEqual(['scout', 'hit_and_run']);
    const v = capture('ember', ['hit_and_run'], 'grove', ['poisoned_meat'], caps);
    expect(eventsOf(v.events, 'AbilitySilenced')).toEqual([]);
    expect(triggered(v.events)).toEqual(['poisoned_meat', 'hit_and_run']);
    expect(pieceAt(v.state, 'd5')).toBeUndefined();
    expect(pieceAt(v.state, 'c3')).toBeUndefined();
  });

  it('R-ELEM-002 DD-28 silence never affects Passive abilities: Veil still hides the name of a silenced ability', () => {
    // Tide beats Ember: the Ember knight's Hit and Run is silenced, but Veil keeps it unnamed.
    const r = capture('ember', ['veil', 'hit_and_run'], 'tide', []);
    expect(outcome(r.events, 'hit_and_run')).toBe('silenced');
    expect(r.state.reveals.white.abilities.knight ?? []).not.toContain('hit_and_run');
    expect(r.state.reveals.white.veiled).toEqual(['knight']);
    const seen = r.engine.projectEvents(r.state, r.events, 'black');
    expect(eventsOf(seen, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'white', ability: null }),
    ]);
  });

  it('R-ELEM-002 R-ELEM-001 silence never switches traits off', () => {
    // Bulwark: Frost beats Stone, yet the Stone knight's Bulwark stops the (unsilenced) Poisoned Meat.
    const stone = capture('stone', ['hit_and_run'], 'frost', ['poisoned_meat']);
    expect(triggered(stone.events)).toEqual(['poisoned_meat']);
    expect(eventsOf(stone.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', reason: 'bulwark' }),
    ]);
    expect(pieceAt(stone.state, 'd5')?.type).toBe('knight');

    // Stillness: Storm beats Frost, yet the Frost victim still negates the captor's Captures.
    const frost = capture('storm', ['hit_and_run'], 'frost', ['last_word']);
    expect(outcome(frost.events, 'last_word')).toBe('silenced');
    expect(outcome(frost.events, 'hit_and_run')).toBe('negated');

    // Hot Foot: Tide beats Ember, yet the Ember captor still leaves a pending burn.
    const ember = scenario({
      fen: FEN,
      white: { elements: ['ember'], abilities: ['hit_and_run'] },
      black: { elements: ['tide'] },
      moves: ['c3d5', 'e8d8', 'd5c3'],
    });
    expect(outcome(ember.steps[0]?.events ?? [], 'hit_and_run')).toBe('silenced');
    expect(eventsOf(ember.steps[2]?.events ?? [], 'SquareIgnited')).toEqual([
      expect.objectContaining({ square: sq('d5'), side: 'white' }),
    ]);
    expect((ember.state.slices.hot_foot as HotFootState).burning).toEqual([
      { sq: sq('d5'), side: 'white', turns: 3 },
    ]);
  });

  it('R-ELEM-002 DD-36 R-RULES-002 silence uses the pre-promotion element; attunement uses the promoted piece’s element', () => {
    // Blended Family: pawns Ember, queen Tide. g7xh8=Q takes a Grove rook with Poisoned Meat.
    // Ember (the pawn at commit) beats Grove, so Poisoned Meat is silenced; the new Tide queen's
    // Hit and Run (its queen set) resolves attuned.
    const r = scenario({
      fen: '4k2r/6P1/8/8/8/8/8/4K3 w - - 0 1',
      white: {
        elements: ['ember', 'tide'],
        items: ['blended_family'],
        sets: [[], [], [], [], ['hit_and_run'], []],
      },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['g7h8q'],
    });
    const pawn = idAt(r.initial, 'g7');
    expect(eventsOf(r.events, 'Promoted')).toEqual([
      expect.objectContaining({ piece: pawn, to: 'queen', element: 'tide' }),
    ]);
    expect(eventsOf(r.events, 'AbilitySilenced')).toEqual([
      expect.objectContaining({ side: 'black', ability: 'poisoned_meat', by: pawn }),
    ]);
    expect(eventsOf(r.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({
        piece: pawn,
        pieceType: 'queen',
        ability: 'hit_and_run',
        attuned: true,
      }),
    ]);
    expect(r.prompts[0]?.kind).toBe('square');
    expect(r.state.pieces[pawn]?.square).toBeGreaterThanOrEqual(0);
    expect(r.state.pieces[pawn]?.type).toBe('queen');
  });

  it('R-ELEM-003 Hit and Run is attuned on a Tide bearer (choose the origin or an adjacent square) and plain otherwise', () => {
    const tide = capture('tide', ['hit_and_run'], 'neutral', [], {
      answers: [{ kind: 'square', square: sq('d4') }],
    });
    expect(eventsOf(tide.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'hit_and_run', attuned: true }),
    ]);
    expect(tide.prompts).toHaveLength(1);
    expect(tide.prompts[0]?.options).toEqual(
      ['b2', 'c2', 'd2', 'b3', 'c3', 'd3', 'b4', 'c4', 'd4'].map((s) => ({
        kind: 'square',
        square: sq(s),
      })),
    );
    expect(pieceAt(tide.state, 'd4')?.type).toBe('knight');

    const grove = capture('grove', ['hit_and_run'], 'neutral', []);
    expect(eventsOf(grove.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'hit_and_run', attuned: false }),
    ]);
    expect(grove.prompts).toEqual([]);
    expect(pieceAt(grove.state, 'c3')?.type).toBe('knight');
  });

  it('R-ELEM-003 Cleave is attuned on an Ember bearer (an orthogonally adjacent pawn may be taken)', () => {
    const fen = '4k3/8/3p4/3p4/8/2N5/8/4K3 w - - 0 1';
    const ember = scenario({
      fen,
      white: { elements: ['ember'], abilities: ['cleave'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
    });
    const d6 = idAt(ember.initial, 'd6');
    expect(eventsOf(ember.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'cleave', attuned: true }),
    ]);
    expect(eventsOf(ember.events, 'Captured')).toEqual([
      expect.objectContaining({ square: sq('d5'), by: 'move' }),
      expect.objectContaining({ victim: d6, by: 'effect' }),
    ]);

    const plain = scenario({
      fen,
      white: { elements: ['neutral'], abilities: ['cleave'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5'],
    });
    expect(eventsOf(plain.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'cleave', attuned: false }),
    ]);
    expect(eventsOf(plain.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ ability: 'cleave', reason: 'no_target' }),
    ]);
    expect(pieceAt(plain.state, 'd6')?.id).toBe(d6);
  });

  it('R-ELEM-003 E3 Poisoned Meat is attuned on a Grove bearer: a surviving captor has all its abilities revealed', () => {
    const fen = '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1';
    const run = (element: ElementId) =>
      scenario({
        fen,
        white: { elements: ['neutral'], abilities: ['last_word'] },
        black: { elements: [element], abilities: ['poisoned_meat'] },
        moves: ['e1e2'],
      });
    const grove = run('grove');
    expect(eventsOf(grove.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', attuned: true }),
    ]);
    expect(eventsOf(grove.events, 'EffectFizzled')).toEqual([
      expect.objectContaining({ reason: 'royal_immunity' }),
    ]);
    expect(eventsOf(grove.events, 'Revealed')).toContainEqual(
      expect.objectContaining({
        side: 'white',
        info: { kind: 'set', pieceType: 'king', abilities: ['last_word'] },
      }),
    );
    expect(grove.state.reveals.white.complete).toEqual(['king']);

    const plain = run('neutral');
    expect(eventsOf(plain.events, 'AbilityTriggered')).toEqual([
      expect.objectContaining({ ability: 'poisoned_meat', attuned: false }),
    ]);
    expect(plain.state.reveals.white.complete).toEqual([]);
    expect(plain.state.reveals.white.abilities.king).toBeUndefined();
  });

  it('R-ELEM-004 Blended Family computes silence per piece', () => {
    // White: Ember knight (group A), Tide rook (group B); black Grove pawns with Poisoned Meat.
    const r = scenario({
      fen: '4k3/8/8/p2p4/8/2N5/8/R3K3 w - - 0 1',
      white: { elements: ['ember', 'tide'], items: ['blended_family'], abilities: ['hit_and_run'] },
      black: { elements: ['grove'], abilities: ['poisoned_meat'] },
      moves: ['c3d5', 'e8e7', 'a1a5'],
    });
    const knight = idAt(r.initial, 'c3');
    const rook = idAt(r.initial, 'a1');
    const first = r.steps[0]?.events ?? [];
    // Ember beats Grove: Poisoned Meat is silenced and the knight steps back.
    expect(outcome(first, 'poisoned_meat')).toBe('silenced');
    expect(outcome(first, 'hit_and_run')).toBe('triggered');
    expect(pieceAt(r.state, 'c3')?.id).toBe(knight);
    // Grove beats Tide: the rook's Hit and Run is silenced and Poisoned Meat removes it.
    const third = r.steps[2]?.events ?? [];
    expect(outcome(third, 'hit_and_run')).toBe('silenced');
    expect(outcome(third, 'poisoned_meat')).toBe('triggered');
    expect(eventsOf(third, 'Captured')).toEqual([
      expect.objectContaining({ square: sq('a5'), by: 'move' }),
      expect.objectContaining({ victim: rook, by: 'effect' }),
    ]);
    expect(r.state.pieces[rook]?.square).toBe(-1);
  });

  it('R-ELEM-004 R-ELEM-003 Blended Family computes attunement per piece', () => {
    // White: Tide knight (group A, attuned Hit and Run), Ember rook (group B, plain Hit and Run).
    const r = scenario({
      fen: '4k3/8/8/p2p4/8/2N5/8/R3K3 w - - 0 1',
      white: { elements: ['tide', 'ember'], items: ['blended_family'], abilities: ['hit_and_run'] },
      black: { elements: ['neutral'] },
      moves: ['c3d5', 'e8e7', 'a1a5'],
      answers: [{ kind: 'square', square: sq('c3') }],
    });
    expect(eventsOf(r.events, 'AbilityTriggered').map((e) => [e.pieceType, e.attuned])).toEqual([
      ['knight', true],
      ['rook', false],
    ]);
    expect(r.steps[0]?.prompts).toHaveLength(1);
    expect(r.steps[2]?.prompts).toEqual([]);
    expect(pieceAt(r.state, 'c3')?.type).toBe('knight');
    expect(pieceAt(r.state, 'a1')?.type).toBe('rook');
  });

  it('R-ELEM-004 R-INFO-001 the opponent sees both elements and which group holds each', () => {
    const s = setup({
      white: { elements: ['ember', 'tide'], items: ['blended_family'] },
      black: { elements: ['grove'] },
    });
    const pub = s.engine.project(s.state, 'black');
    expect(pub.armies.white.elements).toEqual(['ember', 'tide']);
    const shown = (square: string) => pub.pieces.find((p) => p.square === sq(square))?.element;
    for (const square of ['a2', 'h2', 'b1', 'g1', 'c1', 'f1'])
      expect(shown(square), square).toBe('ember');
    for (const square of ['a1', 'h1', 'd1', 'e1']) expect(shown(square), square).toBe('tide');
    for (const p of s.state.pieces.filter((x) => x.side === 'white'))
      expect(p.element, p.type).toBe(
        p.type === 'rook' || p.type === 'queen' || p.type === 'king' ? 'tide' : 'ember',
      );
  });

  it('R-ELEM-004 R-LOAD-004 Blended Family needs two different elements, and two elements need Blended Family', () => {
    const { engine } = setup({});
    const codes = (elements: ElementId[], items: string[]) =>
      engine
        .validateLoadout({ elements, items, sets: [[]] }, { level: 30 })
        .errors.map((e) => e.code);
    expect(codes(['ember', 'tide'], ['blended_family'])).toEqual([]);
    expect(codes(['ember', 'ember'], ['blended_family'])).toContain('elements_same');
    expect(codes(['ember'], ['blended_family'])).toContain('elements_count');
    expect(codes(['ember', 'tide'], [])).toContain('elements_count');
  });

  it('R-ELEM-004 R-RULES-002 a promoted pawn joins its new type’s group and element', () => {
    const s = setup({
      fen: '4k3/6P1/8/8/8/8/8/4K3 w - - 0 1',
      white: { elements: ['grove', 'ember'], items: ['blended_family'] },
      black: { elements: ['neutral'] },
    });
    const pawn = idAt(s.state, 'g7');
    expect(s.state.pieces[pawn]?.element).toBe('grove');
    const q = play(s.engine, s.state, 'g7g8q');
    expect(q.state.pieces[pawn]).toMatchObject({ type: 'queen', element: 'ember' });
    const n = play(s.engine, s.state, 'g7g8n');
    expect(n.state.pieces[pawn]).toMatchObject({ type: 'knight', element: 'grove' });
  });
});
