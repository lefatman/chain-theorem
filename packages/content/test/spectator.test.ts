/**
 * Spectator projection (M7 7.2, spec 10.4 "delayed, public-projection-only view of live battles";
 * R-INFO-005 INVARIANT, R-SEC-001). A spectator learns about each army only what that army's
 * opponent knows. The owner knows its whole army and every `Revealed` event goes to both players, so
 * this is exactly the intersection of the two players' knowledge (8.2 reveals are public once both
 * have seen them); anything only one player saw (the owner's loadout and choices, a prompt's options,
 * pending burns, fizzles and charges of abilities the opponent cannot name) stays hidden.
 *
 * Expected behaviour comes from spec 6.1 (Hot Foot: burning squares are public), 8.1, 8.2, 8.5, 10.4
 * and 15, and DD-26, DD-28, DD-45; not from engine output.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type BattleEvent,
  type Engine,
  type GameState,
  type Loadout,
  type PublicEvent,
  type Side,
  PIECE_TYPES,
  SIDES,
  opposite,
  uciToMove,
} from '@chain-theorem/rules';
import { engine, makeEngine } from '../index.ts';
import { scanSpectatorPayload, spectatorHiddenIds } from '../src/scan.ts';
import { type ArmySpec, eventsOf, idAt, scenario, setup } from '../src/testing.ts';
import type { HotFootState } from '../traits/hot_foot.ts';

/** E1 board: white knight c3, black pawn d5. */
const E1_FEN = '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1';
/** Spec 8.1: the only public facts about an army (plus what has been revealed). */
const PUBLIC_ARMY_KEYS = ['consumedSlots', 'elements', 'level', 'revealed'];

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`missing ${what}`);
  return value;
}

/** Every string value in the wire form of `value`, plus every ':'-separated segment of every key. */
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

/** Ids of `owner` its opponent has not seen revealed on any piece type. */
function unrevealed(state: GameState, owner: Side): string[] {
  const log = state.reveals[owner];
  const seen = new Set(Object.values(log.abilities).flatMap((l) => l ?? []));
  const army = state.armies[owner];
  const out = new Set<string>();
  for (const t of PIECE_TYPES) for (const a of army.sets[t]) if (!seen.has(a)) out.add(a);
  for (const i of army.loadout.items) if (!log.items.includes(i)) out.add(i);
  return [...out];
}

const isHidden = (v: unknown): boolean =>
  v === null ||
  (typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'hidden');

/**
 * Is `a` no more informative than `b`? Equal, or hidden (null or a hidden source) where `b` has a
 * value, recursively; every element of an array must be matched by some element of `b`.
 */
function atMost(a: unknown, b: unknown): boolean {
  if (isHidden(a)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return a === b;
  if (Array.isArray(a)) return Array.isArray(b) && a.every((x) => b.some((y) => atMost(x, y)));
  if (Array.isArray(b)) return false;
  const bo = b as Record<string, unknown>;
  return Object.entries(a).every(([k, v]) => k in bo && atMost(v, bo[k]));
}

/**
 * "A spectator never learns more than either player", checked on one server-side snapshot: each
 * army as its opponent sees it, pieces as their owner's opponent sees them, everything else no more
 * informative than both players' projections, and every event no more informative than what each
 * player received for it.
 */
function checkNoMoreThanPlayers(
  eng: Engine,
  state: GameState,
  events: readonly BattleEvent[],
  where: string,
): void {
  const spec = eng.projectSpectator(state);
  const pubs = { white: eng.project(state, 'white'), black: eng.project(state, 'black') };
  expect(spec.viewer, where).toBe('spectator');
  expect(spec.legal, `${where}: legal`).toEqual([]);
  for (const side of SIDES) {
    const opp = opposite(side);
    expect(Object.keys(spec.armies[side]).sort(), `${where}: ${side} army keys`).toEqual(
      PUBLIC_ARMY_KEYS,
    );
    expect(spec.armies[side], `${where}: ${side} army`).toEqual(pubs[opp].armies[side]);
  }
  for (const p of spec.pieces)
    expect(p, `${where}: piece ${p.id}`).toEqual(pubs[opposite(p.side)].pieces[p.id]);
  expect(spec.board, `${where}: board`).toEqual(state.board);
  for (const viewer of SIDES) {
    const pub = pubs[viewer];
    for (const [key, n] of Object.entries(spec.usage))
      expect(pub.usage[key], `${where}: usage ${key} for ${viewer}`).toBe(n);
    for (const [id, value] of Object.entries(spec.slices))
      expect(atMost(value, pub.slices[id]), `${where}: slice ${id} vs ${viewer}`).toBe(true);
    if (spec.pending) expect(pub.pending?.chooser, `${where}: chooser`).toBe(spec.pending.chooser);
  }
  if (spec.pending) expect(spec.pending.request, `${where}: request`).toBeNull();
  expect(scanSpectatorPayload(spec, state), `${where}: projection scan`).toBeNull();

  const specEvents = eng.projectSpectatorEvents(state, events);
  const seen = {
    white: new Map(eng.projectEvents(state, events, 'white').map((e) => [e.i, e])),
    black: new Map(eng.projectEvents(state, events, 'black').map((e) => [e.i, e])),
  };
  for (const e of specEvents) {
    expect(e.k, `${where}: event ${e.i}`).not.toBe('ChoiceMade');
    for (const viewer of SIDES) {
      const theirs = seen[viewer].get(e.i);
      expect(theirs, `${where}: event ${e.i} ${e.k} not sent to ${viewer}`).toBeDefined();
      if (e.k === 'Promoted' && viewer === e.side) {
        // The owner sees its true element; the spectator sees the displayed one (Masquerade).
        const { element: _e, ...rest } = e;
        expect(atMost(rest, theirs), `${where}: event ${e.i} Promoted vs owner`).toBe(true);
        expect(e, `${where}: Promoted as the opponent sees it`).toEqual(
          seen[opposite(e.side)].get(e.i),
        );
      } else {
        expect(atMost(e, theirs), `${where}: event ${e.i} ${e.k} vs ${viewer}`).toBe(true);
      }
    }
  }
  expect(scanSpectatorPayload(specEvents, state), `${where}: events scan`).toBeNull();
}

interface Snap {
  state: GameState;
  events: BattleEvent[];
}

/** Plays UCI moves (prompts answered with their default) and returns every server-side snapshot. */
function record(spec: Parameters<typeof setup>[0]): { engine: Engine; snaps: Snap[] } {
  const { engine: eng, state, events } = setup(spec);
  const snaps: Snap[] = [{ state, events }];
  let s = state;
  for (const uci of spec.moves ?? []) {
    let r = eng.applyAction(s, { kind: 'move', side: s.turn, move: uciToMove(uci) });
    snaps.push({ state: r.state, events: r.events });
    while (r.kind === 'needsChoice') {
      r = eng.applyAction(r.state, {
        kind: 'choice',
        side: r.request.chooser,
        promptId: r.request.promptId,
        option: r.request.defaultOption,
      });
      snaps.push({ state: r.state, events: r.events });
    }
    s = r.state;
  }
  return { engine: eng, snaps };
}

// ---- crafted positions ------------------------------------------------------------------------------

describe('M7 7.2 spectator projection: public information only (R-INFO-005, R-SEC-001)', () => {
  const MASKED_BLENDED: ArmySpec = {
    level: 30,
    elements: ['tide', 'ember'],
    items: ['blended_family', 'masquerade_mask', 'multitaskers_schedule'],
    itemParams: { masquerade_mask: { element: 'grove' } },
    sets: [['scout'], ['hit_and_run'], ['veil', 'cleave'], [], ['riposte'], ['stalwart']],
  };

  it('R-INFO-005 R-SEC-001 a spectator gets the whole board and no loadout, sets, legal moves or private slice of either army', () => {
    const { state } = setup({
      white: MASKED_BLENDED,
      black: { elements: ['grove'], items: ['scouts_lens'], abilities: ['rebirth', 'veil'] },
    });
    const spec = engine.projectSpectator(state);
    expect(spec.viewer).toBe('spectator');
    expect(spec.board).toEqual(state.board);
    expect(spec.pieces.map((p) => [p.id, p.side, p.type, p.square])).toEqual(
      state.pieces.map((p) => [p.id, p.side, p.type, p.square]),
    );
    expect(spec.legal).toEqual([]);
    for (const side of SIDES) {
      expect(Object.keys(spec.armies[side]).sort()).toEqual(PUBLIC_ARMY_KEYS);
      expect(spec.armies[side].level).toBe(state.armies[side].level);
      expect(spec.armies[side].consumedSlots).toBe(state.armies[side].consumedSlots);
    }
    // Only slices whose module declares `spectate` reach a spectator (safe default).
    const modules = [
      ...engine.registry.traits.map((m) => m.hooks),
      ...engine.registry.items.map((m) => m.hooks),
      ...engine.registry.abilities.map((m) => m.hooks ?? {}),
    ];
    for (const hooks of modules) {
      const decl = hooks.stateSlice;
      if (decl && !decl.spectate) expect(spec.slices).not.toHaveProperty(decl.id);
    }
    expect(spec.slices).not.toHaveProperty('masquerade_mask');
    const strings = wireStrings(spec);
    for (const side of SIDES)
      expect(unrevealed(state, side).filter((id) => strings.has(id))).toEqual([]);
    expect(scanSpectatorPayload(spec, state)).toBeNull();
  });

  it("R-INFO-005 R-INFO-001 each army is shown to a spectator exactly as its opponent sees it (level, displayed elements, slots, reveals); Scout's Lens reveals are public", () => {
    const { state } = setup({
      white: MASKED_BLENDED,
      black: { elements: ['grove'], items: ['scouts_lens'], abilities: ['rebirth', 'veil'] },
    });
    const spec = engine.projectSpectator(state);
    // The Lens revealed White's first pawn ability to Black: both players know it now.
    expect(state.reveals.white.abilities.pawn).toEqual(['scout']);
    expect(spec.armies.white.revealed.abilities.pawn).toEqual(['scout']);
    expect(spec.armies.black.revealed.items).toEqual(['scouts_lens']);
    for (const side of SIDES)
      expect(spec.armies[side]).toEqual(engine.project(state, opposite(side)).armies[side]);
    // The mask shows grove to Black, so to spectators too; White itself sees tide and ember.
    expect(spec.armies.white.elements).toEqual(['grove']);
    expect(engine.project(state, 'white').armies.white.elements).toEqual(['tide', 'ember']);
    expect(new Set(spec.pieces.filter((p) => p.side === 'white').map((p) => p.element))).toEqual(
      new Set(['grove']),
    );
    expect(wireStrings(spec).has('masquerade_mask')).toBe(false);
  });

  it('R-INFO-005 R-SEC-001 DD-28 a veiled activation reaches a spectator unnamed, as the opponent sees it, although its owner sees the name', () => {
    const black: ArmySpec = { items: ['dual_adepts_glove'], abilities: ['veil', 'poisoned_meat'] };
    const r = scenario({ fen: E1_FEN, black, moves: ['c3d5'] });
    const knight = idAt(r.initial, 'c3');
    const forSpec = r.engine.projectSpectatorEvents(r.state, r.events);
    expect(eventsOf(forSpec, 'AbilityTriggered').filter((e) => e.side === 'black')).toEqual([
      expect.objectContaining({ pieceType: 'pawn', ability: null, category: null, attuned: null }),
    ]);
    expect(eventsOf(forSpec, 'Captured').find((e) => e.victim === knight)).toMatchObject({
      by: 'effect',
      source: { kind: 'hidden' },
    });
    const spec = r.engine.projectSpectator(r.state);
    expect(spec.armies.black.revealed.veiled).toEqual(['pawn']);
    const strings = new Set([...wireStrings(forSpec), ...wireStrings(spec)]);
    expect(['veil', 'poisoned_meat', 'dual_adepts_glove'].filter((id) => strings.has(id))).toEqual(
      [],
    );
    // The owner's view keeps the name: a spectator knows less than the owner, as much as White.
    expect(
      eventsOf(r.engine.projectEvents(r.state, r.events, 'black'), 'AbilityTriggered')[0],
    ).toMatchObject({ ability: 'poisoned_meat' });
    expect(forSpec).toEqual(r.engine.projectEvents(r.state, r.events, 'white'));
    checkNoMoreThanPlayers(r.engine, r.state, r.events, 'veil');
  });

  it('R-INFO-002 R-INFO-005 a Scout reveal is known to both players (the victim owns the set and sees the Revealed event), so a spectator sees it', () => {
    const r = scenario({
      fen: E1_FEN,
      white: { abilities: ['scout'] },
      black: { items: ['dual_adepts_glove'], abilities: ['veil', 'poisoned_meat'] },
      moves: ['c3d5'],
    });
    const reveal = eventsOf(r.events, 'Revealed').find(
      (e) => e.side === 'black' && e.info.kind === 'set',
    );
    expect(reveal).toBeDefined();
    // Both players received the reveal, so it is public.
    for (const viewer of SIDES)
      expect(
        eventsOf(r.engine.projectEvents(r.state, r.events, viewer), 'Revealed').find(
          (e) => e.i === reveal?.i,
        ),
      ).toMatchObject({ info: reveal?.info });
    const forSpec = r.engine.projectSpectatorEvents(r.state, r.events);
    expect(eventsOf(forSpec, 'Revealed').find((e) => e.i === reveal?.i)).toMatchObject({
      info: reveal?.info,
      source: { kind: 'ability', id: 'scout', side: 'white' },
    });
    const spec = r.engine.projectSpectator(r.state);
    expect(spec.armies.black.revealed.abilities.pawn).toEqual(
      expect.arrayContaining(['veil', 'poisoned_meat']),
    );
    expect(spec.armies.black.revealed.complete).toContain('pawn');
    checkNoMoreThanPlayers(r.engine, r.state, r.events, 'scout');
  });

  it("R-INFO-005 R-SEC-001 a veiled Scout's reveal names the victim's set for a spectator but never the Scout: its source stays hidden, as for the victim's owner", () => {
    const r = scenario({
      fen: E1_FEN,
      white: { items: ['dual_adepts_glove'], abilities: ['veil', 'scout'] },
      black: { abilities: ['poisoned_meat'] },
      moves: ['c3d5'],
    });
    expect(r.state.reveals.white.veiled).toEqual(['knight']);
    expect(r.state.reveals.black.abilities.pawn).toEqual(['poisoned_meat']);
    const forSpec = r.engine.projectSpectatorEvents(r.state, r.events);
    const setReveal = eventsOf(forSpec, 'Revealed').find(
      (e) => e.side === 'black' && e.info.kind === 'set',
    );
    expect(setReveal).toMatchObject({ source: { kind: 'hidden' } });
    const ownerView = eventsOf(r.engine.projectEvents(r.state, r.events, 'white'), 'Revealed').find(
      (e) => e.i === setReveal?.i,
    );
    expect(ownerView?.source).toMatchObject({ kind: 'ability', id: 'scout' });
    const strings = new Set([
      ...wireStrings(forSpec),
      ...wireStrings(r.engine.projectSpectator(r.state)),
    ]);
    expect(['veil', 'scout', 'dual_adepts_glove'].filter((id) => strings.has(id))).toEqual([]);
    expect(spectatorHiddenIds(r.state)).toEqual(new Set(['veil', 'scout', 'dual_adepts_glove']));
    checkNoMoreThanPlayers(r.engine, r.state, r.events, 'veiled scout');
  });

  it('R-INFO-005 DD-26 a spectator sees a Masquerade Mask as the opponent does (pieces, army, promotion) until the true element shows', () => {
    const { engine: eng, snaps } = record({
      fen: '4k3/P7/8/8/8/8/P7/R3K3 w - - 0 1',
      white: {
        elements: ['tide'],
        items: ['masquerade_mask'],
        itemParams: { masquerade_mask: { element: 'grove' } },
      },
      moves: ['a7a8q', 'e8e7', 'a1a3'],
    });
    const promo = must(snaps[1], 'a7a8q');
    const promoted = must(
      eventsOf(eng.projectSpectatorEvents(promo.state, promo.events), 'Promoted')[0],
      'Promoted',
    );
    expect(promoted.element).toBe('grove');
    expect(eventsOf(eng.projectEvents(promo.state, promo.events, 'white'), 'Promoted')[0]).toEqual(
      expect.objectContaining({ element: 'tide' }),
    );
    const masked = eng.projectSpectator(promo.state);
    expect(masked.armies.white.elements).toEqual(['grove']);
    expect(
      masked.pieces.filter((p) => p.side === 'white').every((p) => p.element === 'grove'),
    ).toBe(true);
    // The rook moves through its own pawn (Flow): the true element is observable, the mask drops.
    const flow = must(snaps[3], 'a1a3');
    expect(eventsOf(flow.events, 'Revealed')).toContainEqual(
      expect.objectContaining({ side: 'white', info: { kind: 'elements', elements: ['tide'] } }),
    );
    const open = eng.projectSpectator(flow.state);
    expect(open.armies.white.elements).toEqual(['tide']);
    expect(open.armies.white.revealed.items).toContain('masquerade_mask');
    expect(open.pieces.filter((p) => p.side === 'white').every((p) => p.element === 'tide')).toBe(
      true,
    );
    snaps.forEach((s, i) => checkNoMoreThanPlayers(eng, s.state, s.events, `mask #${i}`));
  });

  it('R-ELEM-005 R-INFO-005 a spectator never sees a pending burn but sees burning squares, which are public (6.1)', () => {
    const { engine: eng, snaps } = record({
      fen: E1_FEN,
      white: { elements: ['ember'] },
      moves: ['c3d5', 'e8f8', 'd5b4'],
    });
    const knight = idAt(must(snaps[0], 'start').state, 'c3');
    const captured = must(snaps[1], 'c3d5');
    const hf = (v: unknown) => v as HotFootState;
    expect(hf(eng.project(captured.state, 'white').slices.hot_foot).pending).toEqual([
      { piece: knight, sq: 35 },
    ]);
    expect(hf(eng.project(captured.state, 'black').slices.hot_foot).pending).toEqual([]);
    expect(hf(eng.projectSpectator(captured.state).slices.hot_foot)).toEqual({
      burning: [],
      pending: [],
    });
    const ignited = must(snaps[3], 'd5b4');
    expect(
      eventsOf(eng.projectSpectatorEvents(ignited.state, ignited.events), 'SquareIgnited'),
    ).toEqual([expect.objectContaining({ square: 35, side: 'white', turns: 3 })]);
    const burning = hf(eng.projectSpectator(ignited.state).slices.hot_foot).burning;
    expect(burning).toEqual([expect.objectContaining({ sq: 35, side: 'white', turns: 3 })]);
    for (const viewer of SIDES)
      expect(hf(eng.project(ignited.state, viewer).slices.hot_foot).burning).toEqual(burning);
    snaps.forEach((s, i) => checkNoMoreThanPlayers(eng, s.state, s.events, `hot foot #${i}`));
    // The scanner catches a pending burn in a spectator payload.
    const leaky = {
      ...eng.projectSpectator(captured.state),
      slices: { hot_foot: { burning: [], pending: [{ piece: knight, sq: 35 }] } },
    };
    expect(scanSpectatorPayload(leaky, captured.state)).toMatch(/pending burn/);
  });

  it('R-INFO-005 R-SEC-001 a spectator sees who is choosing but never the request, and never a ChoiceMade', () => {
    const s = setup({
      fen: '4k3/8/8/3p4/2PPP3/8/8/4K3 w - - 0 1',
      black: { abilities: ['backdraft'] },
    });
    const r = s.engine.applyAction(s.state, {
      kind: 'move',
      side: 'white',
      move: uciToMove('e4d5'),
    });
    if (r.kind !== 'needsChoice') throw new Error('expected a prompt');
    const spec = s.engine.projectSpectator(r.state);
    expect(spec.pending).toEqual({ chooser: 'black', request: null });
    expect(wireStrings(spec).has(r.request.promptId)).toBe(false);
    checkNoMoreThanPlayers(s.engine, r.state, r.events, 'prompt');
    const done = s.engine.applyAction(r.state, {
      kind: 'choice',
      side: 'black',
      promptId: r.request.promptId,
      option: 0,
    });
    expect(eventsOf(done.events, 'ChoiceMade')).toHaveLength(1);
    expect(
      eventsOf(s.engine.projectSpectatorEvents(done.state, done.events), 'ChoiceMade'),
    ).toEqual([]);
    expect(s.engine.projectSpectator(done.state).pending).toBeNull();
    checkNoMoreThanPlayers(s.engine, done.state, done.events, 'answered');
  });

  it('R-INFO-005 DD-45 fizzles, spent charges and usage of an ability its owner’s opponent cannot name never reach a spectator', () => {
    const run = (abilities: string[]) =>
      scenario({
        fen: '1n2k3/8/8/8/B7/8/8/4K3 b - - 0 1',
        black: { items: ['dual_adepts_glove'], abilities },
        moves: ['b8c6', 'a4c6'],
      });
    const veiled = run(['veil', 'rebirth']);
    const knight = idAt(veiled.initial, 'b8');
    const key = `${knight}:rebirth`;
    expect(veiled.state.usage).toEqual({ [key]: 1 });
    expect(veiled.engine.projectSpectator(veiled.state).usage).toEqual({});
    const forSpec = veiled.engine.projectSpectatorEvents(veiled.state, veiled.events);
    expect(eventsOf(forSpec, 'ChargeSpent')).toEqual([]);
    expect(eventsOf(forSpec, 'PieceRevived')).toEqual([
      expect.objectContaining({ piece: knight, source: { kind: 'hidden' } }),
    ]);
    expect(wireStrings(forSpec).has('rebirth')).toBe(false);
    checkNoMoreThanPlayers(veiled.engine, veiled.state, veiled.events, 'veiled rebirth');

    const open = run(['rebirth']);
    expect(open.engine.projectSpectator(open.state).usage).toEqual({ [key]: 1 });
    expect(
      eventsOf(open.engine.projectSpectatorEvents(open.state, open.events), 'ChargeSpent'),
    ).toEqual([expect.objectContaining({ side: 'black', ability: 'rebirth', remaining: 0 })]);
  });
});

// ---- the scanner itself -------------------------------------------------------------------------

describe('M7 7.2 spectator payload scanner (R-SEC-001)', () => {
  const battle = () =>
    setup({
      fen: E1_FEN,
      white: {
        elements: ['ember'],
        abilities: ['momentum', 'veil'],
        items: ['masquerade_mask'],
        itemParams: { masquerade_mask: { element: 'tide' } },
      },
      black: { elements: ['grove'], abilities: ['rebirth'], items: ['resonance_crystal'] },
    }).state;

  it('R-SEC-001 R-INFO-005 the real spectator projection passes and each hand-made leak is caught', () => {
    const state = battle();
    const spec = engine.projectSpectator(state);
    expect(scanSpectatorPayload(spec, state)).toBeNull();
    expect(scanSpectatorPayload({ t: 'sstart', d: { public: spec } }, state)).toBeNull();
    // Hidden ids of either side, anywhere (values or keys).
    expect(scanSpectatorPayload({ ...spec, note: 'momentum' }, state)).toMatch(/momentum/);
    expect(scanSpectatorPayload({ ...spec, note: 'rebirth' }, state)).toMatch(/rebirth/);
    expect(scanSpectatorPayload({ d: { x: { resonance_crystal: 1 } } }, state)).toMatch(
      /resonance_crystal/,
    );
    expect(scanSpectatorPayload({ ...spec, usage: { '9:rebirth': 1 } }, state)).toMatch(/rebirth/);
    // A loadout, legal moves, a prompt's request, a private slice, a masked element shown.
    const loadout: Loadout = { elements: ['grove'], items: [], sets: [[]] };
    const armies = { ...spec.armies, black: { ...spec.armies.black, loadout } };
    expect(scanSpectatorPayload({ ...spec, armies }, state)).toMatch(/loadout/);
    expect(scanSpectatorPayload({ ...spec, legal: ['e1e2'] }, state)).toMatch(/legal/);
    const pending = { chooser: 'black', request: { promptId: '1.1' } };
    expect(scanSpectatorPayload({ ...spec, pending }, state)).toMatch(/request/);
    expect(
      scanSpectatorPayload({ ...spec, slices: { ...spec.slices, overabundance: {} } }, state),
    ).toMatch(/private/);
    const pieces = spec.pieces.map((p) => (p.side === 'white' ? { ...p, element: 'ember' } : p));
    expect(scanSpectatorPayload({ ...spec, pieces }, state)).toMatch(/Mask/);
    const whiteArmy = { ...spec.armies.white, elements: ['ember'] };
    expect(
      scanSpectatorPayload({ ...spec, armies: { ...spec.armies, white: whiteArmy } }, state),
    ).toMatch(/Mask/);
  });

  it('R-SEC-001 R-INFO-005 events that name, count or source an ability only its owner knows are leaks for a spectator', () => {
    const state = battle();
    const known: GameState = {
      ...state,
      reveals: {
        ...state.reveals,
        black: { ...state.reveals.black, abilities: { pawn: ['rebirth'] } },
      },
    };
    const base = { i: 3, depth: 0, side: 'black', piece: 9, pieceType: 'knight' };
    const trig = { ...base, k: 'AbilityTriggered', ability: 'rebirth', category: 'CAPTURED' };
    // Revealed on pawns only: a name on a knight is a leak, on a pawn it is public.
    expect(scanSpectatorPayload([{ ...trig, attuned: false }], known)).toMatch(/knight/);
    expect(
      scanSpectatorPayload([{ ...trig, pieceType: 'pawn', attuned: false }], known),
    ).toBeNull();
    const hidden = { ...base, k: 'AbilityTriggered', ability: null, category: null, attuned: true };
    expect(scanSpectatorPayload([hidden], known)).toMatch(/category or attuned/);
    const fizzle = { ...base, k: 'EffectFizzled', ability: null, effect: 'x', reason: 'inv03' };
    expect(scanSpectatorPayload([fizzle], known)).toMatch(/unnamed/);
    const choice = { i: 4, depth: 0, k: 'ChoiceMade', side: 'white', promptId: '1', option: {} };
    expect(scanSpectatorPayload([choice], known)).toMatch(/ChoiceMade/);
    const bySource = (source: object) => ({
      i: 5,
      depth: 0,
      k: 'Captured',
      victim: 1,
      victimSide: 'white',
      victimType: 'knight',
      square: 10,
      by: 'effect',
      captor: null,
      source,
    });
    expect(
      scanSpectatorPayload(
        [bySource({ kind: 'item', id: 'resonance_crystal', side: 'black' })],
        known,
      ),
    ).toMatch(/resonance_crystal/);
    expect(
      scanSpectatorPayload(
        [bySource({ kind: 'ability', id: 'rebirth', side: 'black', piece: idAt(state, 'd5') })],
        {
          ...known,
          reveals: {
            ...known.reveals,
            black: { ...known.reveals.black, abilities: { knight: ['rebirth'] } },
          },
        },
      ),
    ).toMatch(/not known to both/);
    expect(scanSpectatorPayload([bySource({ kind: 'hidden' })], known)).toBeNull();
    const promoted = { i: 6, depth: 0, k: 'Promoted', piece: 3, side: 'white', to: 'queen' };
    expect(scanSpectatorPayload([{ ...promoted, element: 'ember' }], known)).toMatch(/Mask/);
    expect(scanSpectatorPayload([{ ...promoted, element: 'tide' }], known)).toBeNull();
  });
});

// ---- properties -----------------------------------------------------------------------------------

/** mulberry32: a deterministic PRNG for building test loadouts (the engine never uses randomness). */
class Prng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(xs: readonly T[]): T {
    return must(xs[this.int(xs.length)], 'pick');
  }
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
    }
    return xs;
  }
}

/** A random valid loadout from whatever the registry holds (the catalogue is not assumed). */
function randomLoadout(rng: Prng, level: number): Loadout {
  const caps = engine.caps;
  const items = engine.registry.items.filter((i) => !i.retired && i.minLevel <= level);
  const abilities = engine.registry.abilities.filter((a) => !a.retired && a.minLevel <= level);
  for (let attempt = 0; attempt < 50; attempt++) {
    const chosen: typeof items = [];
    let used = 0;
    const groups = new Set<string>();
    for (const item of rng.shuffle([...items])) {
      if (rng.next() > 0.5 || used + item.slotCost > caps.itemSlots(level)) continue;
      if (item.exclusiveGroup && groups.has(item.exclusiveGroup)) continue;
      chosen.push(item);
      used += item.slotCost;
      if (item.exclusiveGroup) groups.add(item.exclusiveGroup);
    }
    const capacity = Math.max(caps.BASE_ABILITY_CAPACITY, ...chosen.map((i) => i.capacity ?? 0));
    const els = rng.shuffle([...caps.ENABLED_ELEMENTS]);
    const elements = chosen.some((i) => i.grants?.secondElement)
      ? [must(els[0], 'el'), must(els[1], 'el')]
      : [must(els[0], 'el')];
    const makeSet = (): string[] => {
      const set: string[] = [];
      let cost = 0;
      for (const a of rng.shuffle([...abilities])) {
        if (cost + a.slotCost > capacity || rng.next() > 0.7) continue;
        set.push(a.id);
        cost += a.slotCost;
      }
      return set;
    };
    const perType = chosen.some((i) => i.grants?.perTypeSets) && rng.next() < 0.7;
    const loadout: Loadout = {
      elements,
      items: chosen.map((i) => i.id),
      sets: perType ? PIECE_TYPES.map(makeSet) : [makeSet()],
    };
    const params: NonNullable<Loadout['itemParams']> = {};
    for (const i of chosen)
      if (i.param?.element === 'required')
        params[i.id] = { element: rng.pick(caps.ENABLED_ELEMENTS) };
    if (Object.keys(params).length > 0) loadout.itemParams = params;
    if (engine.validateLoadout(loadout, { level }).ok) return loadout;
  }
  return { elements: [engine.caps.ENABLED_ELEMENTS[0] ?? 'ember'], items: [], sets: [[]] };
}

/** A seeded battle: random valid loadouts, captures preferred, prompts answered at random. */
function randomBattle(seed: number, plies: number): { snaps: Snap[] } {
  const rng = new Prng(seed);
  const level = 12 + rng.int(engine.caps.LEVEL_CAP - 11);
  const { state, events } = engine.newBattle({
    format: rng.pick(['full', 'full', 'vanguard', 'first_blood'] as const),
    white: { level, loadout: randomLoadout(rng, level) },
    black: { level, loadout: randomLoadout(rng, level) },
    strict: true,
  });
  const snaps: Snap[] = [{ state, events }];
  let s = state;
  for (let ply = 0; ply < plies && !s.result; ply++) {
    const moves = engine.legalMoves(s, s.turn);
    const captures = moves.filter((m) => (s.board[m.to] ?? -1) >= 0);
    const move = captures.length > 0 && rng.next() < 0.7 ? rng.pick(captures) : rng.pick(moves);
    let r = engine.applyAction(s, { kind: 'move', side: s.turn, move });
    snaps.push({ state: r.state, events: r.events });
    while (r.kind === 'needsChoice') {
      r = engine.applyAction(r.state, {
        kind: 'choice',
        side: r.request.chooser,
        promptId: r.request.promptId,
        option: rng.int(r.request.options.length),
      });
      snaps.push({ state: r.state, events: r.events });
    }
    s = r.state;
  }
  return { snaps };
}

describe('M7 7.2 spectator properties (R-INFO-005, R-SEC-001, INV-04)', () => {
  it('R-INFO-005 R-SEC-001 property: in random battles a spectator never learns more than either player, and every spectator payload passes the scan', () => {
    let checked = 0;
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        const { snaps } = randomBattle(seed, 60);
        snaps.forEach((snap, i) => {
          checkNoMoreThanPlayers(engine, snap.state, snap.events, `seed ${seed} #${i}`);
          checked++;
        });
      }),
      { numRuns: 25, seed: 7702 },
    );
    expect(checked).toBeGreaterThan(500);
  });

  it('R-INFO-005 R-SEC-001 rich hidden loadouts (Veil, Masquerade Mask, Scout, Schedule, Blended Family) played out: a spectator never learns more than either player', () => {
    const pair: { white: ArmySpec; black: ArmySpec } = {
      white: {
        level: 30,
        elements: ['tide', 'ember'],
        items: ['blended_family', 'masquerade_mask', 'multitaskers_schedule', 'scouts_lens'],
        itemParams: { masquerade_mask: { element: 'grove' } },
        sets: [
          ['scout', 'hit_and_run', 'veil'],
          ['momentum', 'cleave'],
          ['veil', 'pierce', 'scout'],
          ['cleave', 'hit_and_run'],
          ['riposte', 'scout'],
          ['stalwart', 'veil'],
        ],
      },
      black: {
        level: 30,
        elements: ['grove'],
        items: ['headmaster_ring', 'resonance_crystal', 'attunement_charm'],
        itemParams: { attunement_charm: { element: 'tide' } },
        abilities: ['veil', 'poisoned_meat', 'rebirth', 'backdraft', 'riposte'],
      },
    };
    let stripped = 0;
    for (const seed of [1, 2, 3, 4]) {
      const { engine: eng, state, events } = setup({ white: pair.white, black: pair.black });
      const rng = new Prng(seed);
      let s = state;
      const snaps: Snap[] = [{ state, events }];
      for (let ply = 0; ply < 80 && !s.result; ply++) {
        const moves = eng.legalMoves(s, s.turn);
        if (moves.length === 0) break;
        const captures = moves.filter((m) => (s.board[m.to] ?? -1) >= 0);
        const move =
          captures.length > 0 && rng.next() < 0.75 ? rng.pick(captures) : rng.pick(moves);
        let r = eng.applyAction(s, { kind: 'move', side: s.turn, move });
        snaps.push({ state: r.state, events: r.events });
        while (r.kind === 'needsChoice') {
          r = eng.applyAction(r.state, {
            kind: 'choice',
            side: r.request.chooser,
            promptId: r.request.promptId,
            option: rng.int(r.request.options.length),
          });
          snaps.push({ state: r.state, events: r.events });
        }
        s = r.state;
      }
      for (const [i, snap] of snaps.entries()) {
        checkNoMoreThanPlayers(eng, snap.state, snap.events, `rich seed ${seed} #${i}`);
        const raw = wireStrings(snap.events);
        const hidden = [...spectatorHiddenIds(snap.state)];
        stripped += hidden.filter((id) => raw.has(id)).length;
      }
    }
    // Not vacuous: raw events carried ids that the spectator projection had to strip.
    expect(stripped).toBeGreaterThan(0);
  });

  it('INV-04 R-INFO-005 property: spectator projections are deterministic (repeatable, stable across a JSON round trip and a fresh engine)', () => {
    const fresh = makeEngine();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        const { snaps } = randomBattle(seed, 30);
        for (const snap of snaps) {
          const a = JSON.stringify(engine.projectSpectator(snap.state));
          const stored = JSON.parse(JSON.stringify(snap.state)) as GameState;
          expect(JSON.stringify(engine.projectSpectator(snap.state))).toBe(a);
          expect(JSON.stringify(engine.projectSpectator(stored))).toBe(a);
          expect(JSON.stringify(fresh.projectSpectator(stored))).toBe(a);
          const ev: PublicEvent[] = engine.projectSpectatorEvents(snap.state, snap.events);
          expect(JSON.stringify(fresh.projectSpectatorEvents(stored, snap.events))).toBe(
            JSON.stringify(ev),
          );
        }
      }),
      { numRuns: 15, seed: 7703 },
    );
  });
});
