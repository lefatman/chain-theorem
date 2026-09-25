/**
 * NPCs never read hidden data (spec 9.4 R-FMT-005, 8.5 R-INFO-005, R-SEC-001). Two battles that
 * differ only in the opponent's unrevealed abilities and items (same level, displayed elements and
 * consumed slots) give the NPC byte-identical projections, and therefore identical searches and
 * identical prompt answers. A control shows the same position does change the move once the
 * ability is revealed, so the equality below is not vacuous.
 */
import { describe, expect, it } from 'vitest';
import {
  type ApplyResult,
  type FormatId,
  type GameState,
  type Loadout,
  type Side,
  moveToUci,
  uciToMove,
} from '@chain-theorem/rules';
import { engine } from '../../content/index.ts';
import { play } from '../../content/src/testing.ts';
import { type Tier, chooseOption, search } from './index.ts';

const TIER_NAMES: readonly Tier[] = ['wild', 'trainer', 'elite'];

/**
 * Opponent loadouts that look the same from outside: Grove, level 20, 1 consumed slot. None of
 * their abilities or items can fire or become observable in the positions under test (no rook
 * carries a Capturing ability, and the king's Stalwart only shows when it moves into check), so
 * nothing is revealed and the differences stay hidden.
 */
const HIDDEN: readonly Loadout[] = [
  { elements: ['grove'], items: ['dual_adepts_glove'], sets: [['poisoned_meat', 'rebirth']] },
  { elements: ['grove'], items: ['wardens_stopwatch'], sets: [['riposte']] },
  { elements: ['grove'], items: ['resonance_crystal'], sets: [[]] },
  {
    elements: ['grove'],
    items: ['multitaskers_schedule'],
    sets: [['backdraft'], ['last_word'], ['veil'], [], ['antidote'], ['stalwart']],
  },
];

const NPC_LOADOUT: Loadout = {
  elements: ['ember'],
  items: ['dual_adepts_glove'],
  sets: [['momentum', 'backdraft']],
};

interface Case {
  name: string;
  format: FormatId;
  fen?: string;
  npc: Side;
  moves: string[];
}

const CASES: readonly Case[] = [
  { name: 'start position, NPC white', format: 'full', npc: 'white', moves: [] },
  {
    name: 'open game, NPC black',
    format: 'vanguard',
    npc: 'black',
    moves: ['e2e4', 'e7e5', 'g1f3'],
  },
  {
    // The trap position of E4: a knight can take a pawn that may secretly carry Poisoned Meat.
    name: 'First Blood bait pawn, NPC white',
    format: 'first_blood',
    fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
    npc: 'white',
    moves: [],
  },
  {
    name: 'Kiwipete middlegame, NPC white',
    format: 'full',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    npc: 'white',
    moves: [],
  },
];

function battle(c: Case, hidden: Loadout): GameState {
  const npcSide = { level: 20, loadout: NPC_LOADOUT };
  const oppSide = { level: 20, loadout: hidden };
  let { state } = engine.newBattle({
    format: c.format,
    white: c.npc === 'white' ? npcSide : oppSide,
    black: c.npc === 'black' ? npcSide : oppSide,
    ...(c.fen ? { fen: c.fen } : {}),
  });
  for (const uci of c.moves) state = play(engine, state, uci).state;
  return state;
}

describe('NPCs never read hidden data (R-FMT-005, R-INFO-005, R-SEC-001)', () => {
  it('R-FMT-005 R-INFO-001 the hidden variants really differ in the full state but share every public fact', () => {
    const states = HIDDEN.map((h) => battle(CASES[0] as Case, h));
    const sets = new Set(states.map((s) => JSON.stringify(s.armies.black.sets)));
    expect(sets.size).toBe(HIDDEN.length);
    const consumed = new Set(states.map((s) => s.armies.black.consumedSlots));
    expect([...consumed]).toEqual([1]);
  });

  for (const c of CASES) {
    it(`R-FMT-005 R-INFO-005 ${c.name}: the NPC's projection is identical whatever the opponent hides`, () => {
      const pubs = HIDDEN.map((h) => JSON.stringify(engine.project(battle(c, h), c.npc)));
      for (const p of pubs) expect(p).toBe(pubs[0]);
      // No opponent-only item or ability id appears anywhere (the NPC's own ids may).
      const mine = new Set([...NPC_LOADOUT.items, ...NPC_LOADOUT.sets.flat()]);
      const ids = HIDDEN.flatMap((h) => [...h.items, ...h.sets.flat()]).filter(
        (id) => !mine.has(id),
      );
      expect(ids.length).toBeGreaterThan(5);
      for (const id of ids) expect(pubs[0]).not.toContain(`"${id}"`);
    });

    for (const t of TIER_NAMES) {
      it(`R-FMT-005 R-SEC-001 ${t}, ${c.name}: the chosen move is identical whatever the opponent hides`, () => {
        const results = HIDDEN.map((h) => {
          const state = battle(c, h);
          const pub = engine.project(state, c.npc);
          return search(engine, pub, NPC_LOADOUT, t, { nodes: 3_000, seed: 11 });
        });
        for (const r of results) {
          expect(moveToUci(r.move)).toBe(moveToUci((results[0] as (typeof results)[0]).move));
          expect(r).toEqual(results[0]);
        }
      });
    }
  }

  it('R-FMT-005 control: the same bait position changes the trainer move once Poisoned Meat is revealed', () => {
    // First Blood, knight c3 vs pawn d5; a white pawn capture on e5 first reveals Poisoned Meat.
    const fen = '4k3/8/8/3pp3/3P4/2N5/8/4K3 w - - 0 1';
    const pm: Loadout = { elements: ['grove'], items: [], sets: [['poisoned_meat']] };
    const plain: Loadout = { elements: ['grove'], items: [], sets: [[]] };
    const npcLo: Loadout = { elements: ['grove'], items: [], sets: [[]] };
    const start = (black: Loadout) =>
      engine.newBattle({
        format: 'first_blood',
        white: { level: 20, loadout: npcLo },
        black: { level: 20, loadout: black },
        fen,
      }).state;
    // d4xe5 then e8f8: with Poisoned Meat the white pawn dies on e5 and the ability is revealed.
    const revealed = play(engine, play(engine, start(pm), 'd4e5').state, 'e8f8').state;
    expect(revealed.reveals.black.abilities.pawn).toEqual(['poisoned_meat']);
    const pubRevealed = engine.project(revealed, 'white');
    // Same board, nothing revealed (the hidden-ability twin of the revealed position).
    const hiddenTwin = engine.newBattle({
      format: 'first_blood',
      white: { level: 20, loadout: npcLo },
      black: { level: 20, loadout: pm },
      fen: engine.toFen(revealed),
    }).state;
    const plainTwin = engine.newBattle({
      format: 'first_blood',
      white: { level: 20, loadout: npcLo },
      black: { level: 20, loadout: plain },
      fen: engine.toFen(revealed),
    }).state;
    const mv = (s: GameState) =>
      moveToUci(
        search(engine, engine.project(s, 'white'), npcLo, 'trainer', { nodes: 5_000 }).move,
      );
    expect(mv(hiddenTwin)).toBe(mv(plainTwin));
    expect(mv(hiddenTwin)).toBe('c3d5');
    expect(
      moveToUci(search(engine, pubRevealed, npcLo, 'trainer', { nodes: 5_000 }).move),
    ).not.toBe('c3d5');
  });

  it('R-FMT-005 R-SEC-001 chooseOption answers a prompt identically whatever the captor hides', () => {
    // The NPC (black, Ember) owns Backdraft; a white rook takes d5 and black picks a target.
    // White's hidden abilities are all CAPTURED-category, so none fires on this capture.
    const fen = '4k3/8/2N1B3/3p4/2P1Q3/8/8/3RK3 w - - 0 1';
    const npcLo: Loadout = { elements: ['ember'], items: [], sets: [['backdraft']] };
    const answers = HIDDEN.map((h) => {
      const { state } = engine.newBattle({
        format: 'full',
        white: { level: 20, loadout: h },
        black: { level: 20, loadout: npcLo },
        fen,
      });
      const r: ApplyResult = engine.applyAction(state, {
        kind: 'move',
        side: 'white',
        move: uciToMove('d1d5'),
      });
      if (r.kind !== 'needsChoice') throw new Error('expected a Backdraft prompt');
      const pub = engine.project(r.state, 'black');
      return {
        pub: JSON.stringify(pub),
        options: TIER_NAMES.map((t) => chooseOption(engine, pub, npcLo, r.request, t)),
      };
    });
    for (const a of answers) {
      expect(a.pub).toBe(answers[0]?.pub);
      expect(a.options).toEqual(answers[0]?.options);
    }
  });
});
