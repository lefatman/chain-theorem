/**
 * Property tests (M2 step 2.9; R-TEST-001 "Property and fuzz" layer, spec 17.1): determinism
 * (INV-04), chain termination (R-ABIL-003, DD-12), projection safety (R-SEC-001, R-INFO-005),
 * loadout validity (R-LOAD-004) and suspended actions (DD-11) over random battles with random valid
 * loadouts, the fast-check counterpart of the M2 "done when" fuzz (spec 16).
 *
 * Expected behaviour is derived from spec 4.1, 5.3, 5.4, 7.1-7.4, 8.2, 8.5, 15 and the delegated
 * decisions (section 18), not from the engine's current output. The loadout rules 1-7 are re-checked
 * here by an independent checker written from spec 7.1-7.4 (item costs and capacities from the 7.2
 * table, COMMITTED); only the PLAYTEST level requirements come from module data (DD-05).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ActionInput,
  type ApplyResult,
  type BattleEvent,
  type BattleSetup,
  type ElementId,
  type Engine,
  type FormatId,
  type GameState,
  type Loadout,
  type LoadoutValidation,
  type Move,
  type PlayerFacts,
  type PublicEvent,
  type PublicState,
  type Side,
  ELEMENTS,
  RulesError,
  createEngine,
  relOrder,
  uciToMove,
} from '@chain-theorem/rules';
import type { AbilityDef, ItemDef } from '@chain-theorem/rules/sdk';
import { CAPS, abilities, engine, items, makeEngine, registry } from '../index.ts';

// ---- helpers --------------------------------------------------------------------------------------

const json = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const other = (s: Side): Side => (s === 'white' ? 'black' : 'white');
const SIDES: readonly Side[] = ['white', 'black'];

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
/** Both sides can promote (or capture while promoting) at once; queens face off on the d-file. */
const PROMOTE = 'rn1qk1nr/1P4pp/8/8/8/8/1p4PP/RN1QK1NR w KQkq - 0 1';

const MAX_PLIES = 120;
/** Deeper local runs: `PROPERTY_RUNS_SCALE=10 pnpm vitest run packages/content/test/property.test.ts`. */
const SCALE = Math.max(1, Math.floor(Number(process.env.PROPERTY_RUNS_SCALE ?? '1')) || 1);
/** Per-test timeout of the battle properties (each takes a few seconds at SCALE 1). */
const GAME_TIMEOUT = 60_000 * SCALE;
/** A single action that keeps prompting past this many answers is treated as non-terminating. */
const MAX_PROMPTS_PER_ACTION = 64;

const ENABLED: readonly ElementId[] = CAPS.ENABLED_ELEMENTS;
/** 'neutral' and every element not yet enabled (6.5, DD-23). */
const DISABLED: readonly ElementId[] = [...ELEMENTS, 'neutral' as const].filter(
  (e) => !ENABLED.includes(e),
);
const ITEM_IDS: readonly string[] = items.map((i) => i.id);
const ABILITY_IDS: readonly string[] = abilities.map((a) => a.id);
const ITEM = new Map<string, ItemDef>(items.map((i) => [i.id, i]));
const ABILITY = new Map<string, AbilityDef>(abilities.map((a) => [a.id, a]));
const itemOf = (id: string): ItemDef => {
  const def = ITEM.get(id);
  if (!def) throw new Error(`unknown item ${id}`);
  return def;
};
const abilityOf = (id: string): AbilityDef => {
  const def = ABILITY.get(id);
  if (!def) throw new Error(`unknown ability ${id}`);
  return def;
};

/** Small deterministic PRNG (mulberry32) seeded by fast-check. */
class Prng {
  private a: number;
  constructor(seed: number) {
    this.a = seed >>> 0;
  }
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(xs: readonly T[]): T {
    const x = xs[this.int(xs.length)];
    if (x === undefined) throw new Error('pick from an empty list');
    return x;
  }
}

// ---- independent loadout checker (spec 7.1-7.4) ---------------------------------------------------

/** R-LOAD-001 (COMMITTED): slots = min(6, 1 + floor(level / 5)). */
const specSlots = (level: number): number => Math.min(6, 1 + Math.floor(level / 5));

/**
 * Spec 7.2 item table: capacity N costs N - 1 slots (Dual Adept's Glove 1 slot, DD-01), every other
 * item costs 1 slot; Schedule gives six sets, Blended Family two elements; Attunement Charm and
 * Masquerade Mask take an element parameter (DD-29). The M7 7.3 items (Mooring Chain, Mainspring)
 * follow the same catalogue rule: utility items cost 1 slot.
 */
const SPEC_ITEMS: Record<
  string,
  { cost: number; capacity?: number; schedule?: true; blended?: true; param?: true }
> = {
  dual_adepts_glove: { cost: 1, capacity: 2 },
  triple_adepts_gloves: { cost: 2, capacity: 3 },
  journeymans_medallion: { cost: 3, capacity: 4 },
  headmaster_ring: { cost: 4, capacity: 5 },
  multitaskers_schedule: { cost: 1, schedule: true },
  blended_family: { cost: 1, blended: true },
  wardens_stopwatch: { cost: 1 },
  masquerade_mask: { cost: 1, param: true },
  resonance_crystal: { cost: 1 },
  attunement_charm: { cost: 1, param: true },
  scouts_lens: { cost: 1 },
  mooring_chain: { cost: 1 },
  mainspring: { cost: 1 },
};
const specItem = (id: string) => {
  const s = SPEC_ITEMS[id];
  if (!s) throw new Error(`item ${id} is not in the spec 7.2 table`);
  return s;
};

interface CheckOptions {
  /** Content data with retired flags (rule 7); defaults to the shipped registry. */
  abilityData?: ReadonlyMap<string, AbilityDef>;
  itemData?: ReadonlyMap<string, ItemDef>;
}

/** Rules of 7.4 that `loadout` breaks for `player`, checked from the spec text alone. */
function specViolations(loadout: Loadout, player: PlayerFacts, opts: CheckOptions = {}): number[] {
  const abilityData = opts.abilityData ?? ABILITY;
  const itemData = opts.itemData ?? ITEM;
  const broken = new Set<number>();
  const level = player.level;
  // Rule 1: total item slot cost <= unlocked item slots.
  const cost = loadout.items.reduce((n, id) => n + specItem(id).cost, 0);
  if (cost > specSlots(level)) broken.add(1);
  // Rule 2: every equipped item's and ability's level requirement <= the player's level.
  for (const id of loadout.items) if ((itemData.get(id)?.minLevel ?? 0) > level) broken.add(2);
  for (const set of loadout.sets)
    for (const id of set) if ((abilityData.get(id)?.minLevel ?? 0) > level) broken.add(2);
  // Rule 3: at most one capacity item, no item twice.
  if (new Set(loadout.items).size !== loadout.items.length) broken.add(3);
  if (loadout.items.filter((id) => specItem(id).capacity !== undefined).length > 1) broken.add(3);
  // Rule 4: every set within capacity, no duplicates. Capacity is 1 without a capacity item and
  // capacity items never stack (the best one applies).
  const capacity = Math.max(1, ...loadout.items.map((id) => specItem(id).capacity ?? 1));
  for (const set of loadout.sets) {
    if (new Set(set).size !== set.length) broken.add(4);
    const setCost = set.reduce((n, id) => n + (abilityData.get(id)?.slotCost ?? 1), 0);
    if (setCost > capacity) broken.add(4);
  }
  // Rule 5: 1 set, or 6 with Multitasker's Schedule.
  const schedule = loadout.items.some((id) => specItem(id).schedule);
  if (!(loadout.sets.length === 1 || (loadout.sets.length === 6 && schedule))) broken.add(5);
  // Rule 6: Blended Family requires two different elements; otherwise exactly one (6.4).
  const blended = loadout.items.some((id) => specItem(id).blended);
  const els = loadout.elements;
  if (blended ? !(els.length === 2 && els[0] !== els[1]) : els.length !== 1) broken.add(6);
  // Rule 7: every equipped item and ability is owned and not retired.
  for (const id of loadout.items) {
    if (itemData.get(id)?.retired) broken.add(7);
    if (player.ownedItems && !player.ownedItems.includes(id)) broken.add(7);
  }
  for (const set of loadout.sets)
    for (const id of set) {
      if (abilityData.get(id)?.retired) broken.add(7);
      if (player.ownedAbilities && !player.ownedAbilities.includes(id)) broken.add(7);
    }
  return [...broken].sort((a, b) => a - b);
}

const rulesOf = (v: LoadoutValidation): number[] =>
  [...new Set(v.errors.map((e) => e.rule))].sort((a, b) => a - b);

// ---- arbitraries ----------------------------------------------------------------------------------

interface Army {
  level: number;
  loadout: Loadout;
}

const levelArb = fc.integer({ min: 1, max: CAPS.LEVEL_CAP });
/** Battles lean toward high levels half of the time so large loadouts (Veil, Mask, 5-5 sets) play. */
const battleLevelArb = fc.oneof(levelArb, fc.integer({ min: 18, max: CAPS.LEVEL_CAP }));
/** Abilities that can prompt their owner (DD-18): bonus moves and target or square selections. */
const PROMPTING = new Set(['riposte', 'momentum', 'backdraft', 'cleave', 'hit_and_run', 'rebirth']);

/** Raw random material for one army; `buildArmy` turns it into a loadout that respects the rules. */
const armyDrawArb = (level: fc.Arbitrary<number>) =>
  fc.record({
    level,
    itemOrder: fc.shuffledSubarray([...ITEM_IDS]),
    e1: fc.nat({ max: ENABLED.length - 1 }),
    e2: fc.integer({ min: 1, max: Math.max(1, ENABLED.length - 1) }),
    params: fc.array(fc.constantFrom(...ENABLED), {
      minLength: ITEM_IDS.length,
      maxLength: ITEM_IDS.length,
    }),
    perType: fc.boolean(),
    pools: fc.array(fc.shuffledSubarray([...ABILITY_IDS]), { minLength: 6, maxLength: 6 }),
  });
type ArmyDraw = ReturnType<typeof armyDrawArb> extends fc.Arbitrary<infer T> ? T : never;

function buildArmy(d: ArmyDraw): Army {
  const level = d.level;
  const slots = CAPS.itemSlots(level);
  const chosen: string[] = [];
  const groups = new Set<string>();
  let used = 0;
  for (const id of d.itemOrder) {
    const def = itemOf(id);
    if (def.minLevel > level || used + def.slotCost > slots) continue;
    if (def.exclusiveGroup && groups.has(def.exclusiveGroup)) continue;
    chosen.push(id);
    used += def.slotCost;
    if (def.exclusiveGroup) groups.add(def.exclusiveGroup);
  }
  const defs = chosen.map(itemOf);
  const e1 = ENABLED[d.e1] ?? 'ember';
  const e2 = ENABLED[(d.e1 + d.e2) % ENABLED.length] ?? 'tide';
  const elements: ElementId[] = defs.some((i) => i.grants?.secondElement) ? [e1, e2] : [e1];
  const itemParams: NonNullable<Loadout['itemParams']> = {};
  for (const def of defs)
    if (def.param?.element === 'required')
      itemParams[def.id] = { element: d.params[ITEM_IDS.indexOf(def.id)] ?? e1 };
  const capacity = Math.max(CAPS.BASE_ABILITY_CAPACITY, ...defs.map((i) => i.capacity ?? 0));
  const setCount = d.perType && defs.some((i) => i.grants?.perTypeSets) ? 6 : 1;
  const sets: string[][] = [];
  for (let k = 0; k < setCount; k++) {
    const set: string[] = [];
    let cost = 0;
    for (const id of d.pools[k] ?? []) {
      const a = abilityOf(id);
      if (a.minLevel > level || cost + a.slotCost > capacity) continue;
      set.push(id);
      cost += a.slotCost;
    }
    sets.push(set);
  }
  const loadout: Loadout = { elements, items: chosen, sets };
  if (Object.keys(itemParams).length > 0) loadout.itemParams = itemParams;
  return { level, loadout };
}

/**
 * Random valid loadouts: built to respect the rules, then kept only if validateLoadout accepts.
 * `prompting` moves the abilities that can prompt to the front of every set, so suspended actions
 * (DD-11) happen often.
 */
const validArmy = (level: fc.Arbitrary<number>, prompting = false): fc.Arbitrary<Army> =>
  armyDrawArb(level)
    .map((d) =>
      prompting
        ? {
            ...d,
            pools: d.pools.map((p) => [
              ...p.filter((id) => PROMPTING.has(id)),
              ...p.filter((id) => !PROMPTING.has(id)),
            ]),
          }
        : d,
    )
    .map(buildArmy)
    .filter((a) => engine.validateLoadout(a.loadout, { level: a.level }).ok);
const validArmyArb = validArmy(levelArb);
const battleArmyArb = validArmy(battleLevelArb);
const promptingArmyArb = validArmy(fc.integer({ min: 12, max: CAPS.LEVEL_CAP }), true);

/** Loosely built loadouts, mostly invalid, with optional ownership lists. */
const looseArb: fc.Arbitrary<{ loadout: Loadout; facts: PlayerFacts }> = fc
  .record({
    level: fc.integer({ min: 1, max: CAPS.LEVEL_CAP }),
    items: fc.array(fc.constantFrom(...ITEM_IDS), { maxLength: 5 }),
    elements: fc.array(fc.constantFrom(...ENABLED), { maxLength: 3 }),
    sets: fc.oneof(
      fc.array(fc.array(fc.constantFrom(...ABILITY_IDS), { maxLength: 6 }), {
        minLength: 1,
        maxLength: 1,
      }),
      fc.array(fc.array(fc.constantFrom(...ABILITY_IDS), { maxLength: 6 }), {
        minLength: 6,
        maxLength: 6,
      }),
      fc.array(fc.array(fc.constantFrom(...ABILITY_IDS), { maxLength: 6 }), { maxLength: 7 }),
    ),
    param: fc.constantFrom(...ENABLED),
    ownedItems: fc.option(fc.subarray([...ITEM_IDS]), { nil: undefined }),
    ownedAbilities: fc.option(fc.subarray([...ABILITY_IDS]), { nil: undefined }),
  })
  .map((r) => {
    const itemParams: NonNullable<Loadout['itemParams']> = {};
    for (const id of r.items)
      if (itemOf(id).param?.element === 'required') itemParams[id] = { element: r.param };
    const loadout: Loadout = { elements: r.elements, items: r.items, sets: r.sets, itemParams };
    const facts: PlayerFacts = { level: r.level };
    if (r.ownedItems) facts.ownedItems = r.ownedItems;
    if (r.ownedAbilities) facts.ownedAbilities = r.ownedAbilities;
    return { loadout, facts };
  });

const FORMATS: readonly FormatId[] = ['full', 'full', 'vanguard', 'first_blood'];

interface GameSpec {
  setup: BattleSetup;
  seed: number;
  /** Probability of playing a capture when one is available. */
  captureBias: number;
}

const gameOf = (army: fc.Arbitrary<Army>): fc.Arbitrary<GameSpec> =>
  fc
    .record({
      white: army,
      black: army,
      format: fc.constantFrom(...FORMATS),
      fen: fc.constantFrom(START, START, KIWIPETE, PROMOTE),
      seed: fc.integer({ min: 0, max: 0x7fffffff }),
      captureBias: fc.constantFrom(0.5, 0.85),
    })
    .map((r) => ({
      setup: { format: r.format, white: r.white, black: r.black, fen: r.fen },
      seed: r.seed,
      captureBias: r.captureBias,
    }));
/** Half of the battles use loadouts whose sets lead with prompting abilities on both sides. */
const gameArb = fc.oneof(gameOf(battleArmyArb), gameOf(promptingArmyArb));

// ---- random game driver ---------------------------------------------------------------------------

interface Step {
  /** The state passed to applyAction (never mutated by it). */
  pre: GameState;
  input: ActionInput;
  result: ApplyResult;
}

/** One committed action: the move and every choice answered while it was suspended. */
interface Action {
  ply: number;
  steps: Step[];
}

interface Game {
  setup: BattleSetup;
  start: { state: GameState; events: BattleEvent[] };
  actions: Action[];
  final: GameState;
}

/**
 * Plays random legal moves (a capture with probability `captureBias` when one exists, so reaction
 * chains run) and answers every prompt with a random option, until a result or MAX_PLIES.
 */
function playGame(eng: Engine, spec: GameSpec): Game {
  const rng = new Prng(spec.seed);
  const start = eng.newBattle(spec.setup);
  let state = start.state;
  const actions: Action[] = [];
  for (let ply = 0; ply < MAX_PLIES && !state.result; ply++) {
    const side = state.turn;
    const moves = eng.legalMoves(state, side);
    if (moves.length === 0)
      throw new Error(`${side} has no legal move at ply ${ply} but the battle has no result`);
    const captures = moves.filter((m: Move) => (state.board[m.to] ?? -1) >= 0);
    const move =
      captures.length > 0 && rng.next() < spec.captureBias ? rng.pick(captures) : rng.pick(moves);
    let input: ActionInput = { kind: 'move', side, move };
    let result = eng.applyAction(state, input);
    const steps: Step[] = [{ pre: state, input, result }];
    while (result.kind === 'needsChoice') {
      if (steps.length > MAX_PROMPTS_PER_ACTION)
        throw new Error(`action at ply ${ply} is still prompting after ${steps.length} answers`);
      const pre = result.state;
      input = {
        kind: 'choice',
        side: result.request.chooser,
        promptId: result.request.promptId,
        option: rng.int(result.request.options.length),
      };
      result = eng.applyAction(pre, input);
      steps.push({ pre, input, result });
    }
    actions.push({ ply, steps });
    state = result.state;
  }
  return { setup: spec.setup, start, actions, final: state };
}

// ---- projection scanning (R-SEC-001) --------------------------------------------------------------

/** Opponent ability and item ids the viewer has not been shown (from reveals[opp] and armies[opp]). */
function unrevealedIds(state: GameState, viewer: Side): Set<string> {
  const opp = other(viewer);
  const log = state.reveals[opp];
  const known = new Set(Object.values(log.abilities).flatMap((l) => l ?? []));
  const out = new Set<string>();
  for (const set of state.armies[opp].loadout.sets)
    for (const id of set) if (!known.has(id)) out.add(id);
  for (const id of state.armies[opp].loadout.items) if (!log.items.includes(id)) out.add(id);
  return out;
}

/** Ids (as whole JSON string values) of `ids` that occur in `payload`'s JSON text. */
function quotedIn(payload: unknown, ids: ReadonlySet<string>): string[] {
  const text = JSON.stringify(payload);
  return [...ids].filter((id) => text.includes(JSON.stringify(id)));
}

/**
 * Removes the parts of a projection that describe the viewer's own army (its loadout, sets, what the
 * opponent knows about it, and a prompt sourced from the viewer's own ability), so that an id both
 * players carry is still caught when it leaks through an opponent-owned field.
 */
function withoutOwnData(pub: PublicState, viewer: Side): unknown {
  const c = json(pub);
  const { loadout: _l, sets: _s, revealed: _r, ...ownRest } = c.armies[viewer];
  let pending: unknown = c.pending;
  const req = c.pending?.request;
  if (req && req.source.side === viewer)
    pending = { ...c.pending, request: { ...req, source: { ...req.source, ability: '' } } };
  return { ...c, armies: { ...c.armies, [viewer]: ownRest }, pending };
}

/** As above for projected events: drop ids attributed to the viewer's own side. */
function eventsWithoutOwnData(events: readonly PublicEvent[], viewer: Side): unknown[] {
  return events.map((e) => {
    const c = json(e) as unknown as Record<string, unknown>;
    if (c.side === viewer && 'ability' in c) c.ability = null;
    if (c.k === 'Revealed' && c.side === viewer) c.info = null;
    const src = c.source as { side?: Side } | undefined;
    if (src && src.side === viewer) c.source = { ...src, id: '' };
    return c;
  });
}

/** Every R-SEC-001 / R-INFO-005 violation visible to `viewer` at this step. */
function leaks(
  eng: Engine,
  state: GameState,
  events: readonly BattleEvent[],
  viewer: Side,
): string[] {
  const opp = other(viewer);
  const hidden = unrevealedIds(state, viewer);
  const found: string[] = [];
  const pub = eng.project(state, viewer);
  const pubEvents = eng.projectEvents(state, events, viewer);
  // Whole-string scan of both payloads (15, R-SEC-001).
  for (const id of quotedIn(withoutOwnData(pub, viewer), hidden))
    found.push(`project() to ${viewer} contains unrevealed "${id}"`);
  for (const id of quotedIn(eventsWithoutOwnData(pubEvents, viewer), hidden))
    found.push(`projectEvents() to ${viewer} contains unrevealed "${id}"`);
  // Structure (8.5, R-INFO-005): only revealed opponent loadout data, opponent usage counters only
  // for revealed abilities, a pending choice only to its chooser.
  const oppArmy = pub.armies[opp] as unknown as Record<string, unknown>;
  if ('loadout' in oppArmy || 'sets' in oppArmy)
    found.push(`project() to ${viewer} carries the opponent's loadout`);
  for (const key of Object.keys(pub.usage)) {
    const [pid, ability] = key.split(':');
    if (state.pieces[Number(pid)]?.side === opp && ability !== undefined && hidden.has(ability))
      found.push(`project() to ${viewer} has a usage counter for unrevealed ${ability}`);
  }
  if (pub.pending?.request && pub.pending.request.chooser !== viewer)
    found.push(`project() to ${viewer} carries the opponent's prompt`);
  // DD-37 with DD-32: the viewer's legal moves may include taking the opponent's king only once
  // Stalwart is public (it was observable, so it was revealed); otherwise the list leaks it.
  const oppKing = state.pieces.find((p) => p.side === opp && p.type === 'king' && p.square >= 0);
  if (oppKing && !(state.reveals[opp].abilities.king ?? []).includes('stalwart'))
    for (const uci of pub.legal)
      if (uciToMove(uci).to === oppKing.square)
        found.push(`project() to ${viewer} offers ${uci} onto an unrevealed Stalwart king`);
  // 8.2 and DD-28: an activation, silence or negation names an opponent ability only when that
  // ability has been revealed on that piece type (Veil keeps names hidden per piece type).
  for (const e of pubEvents) {
    if (e.k !== 'AbilityTriggered' && e.k !== 'AbilitySilenced' && e.k !== 'AbilityNegated')
      continue;
    if (e.side !== opp || e.ability === null) continue;
    if (!(state.reveals[opp].abilities[e.pieceType] ?? []).includes(e.ability))
      found.push(`${e.k} to ${viewer} names ${e.ability} on ${e.pieceType} before it is revealed`);
  }
  return found;
}

// ---- properties -----------------------------------------------------------------------------------

describe('property: random battles with random valid loadouts (M2 step 2.9)', () => {
  it(
    'INV-04 determinism: replaying the same actions from the same setup on a fresh engine yields identical events, states and stateHash at every step',
    () => {
      const outcomes: Record<string, number> = {};
      let plies = 0;
      fc.assert(
        fc.property(gameArb, (spec) => {
          const game = playGame(engine, spec);
          const res = game.final.result;
          const key = res ? `${res.winner ?? 'draw'}:${res.reason}` : 'capped';
          outcomes[key] = (outcomes[key] ?? 0) + 1;
          plies += game.actions.length;
          const fresh = makeEngine();
          const again = fresh.newBattle(json(spec.setup));
          expect(again.events).toEqual(game.start.events);
          expect(fresh.stateHash(again.state)).toBe(engine.stateHash(game.start.state));
          expect(fresh.stateHash(again.state)).toMatch(/^[0-9a-f]{16}$/);
          let s = again.state;
          for (const action of game.actions) {
            for (const step of action.steps) {
              const before = JSON.stringify(s);
              const r = fresh.applyAction(s, step.input);
              // Pure: the input state is never mutated (ARCHITECTURE 2.3).
              expect(JSON.stringify(s)).toBe(before);
              expect(r.kind).toBe(step.result.kind);
              expect(r.events).toEqual(step.result.events);
              expect(fresh.stateHash(r.state)).toBe(engine.stateHash(step.result.state));
              expect(json(r.state)).toEqual(json(step.result.state));
              s = r.state;
            }
          }
          expect(fresh.stateHash(s)).toBe(engine.stateHash(game.final));
          expect(s.result).toEqual(game.final.result);
        }),
        { numRuns: 60 * SCALE },
      );
      console.log(`INV-04: ${plies} plies replayed; outcomes ${JSON.stringify(outcomes)}`);
    },
    GAME_TIMEOUT,
  );

  it(
    'R-ABIL-003 DD-12 INV-01 INV-06 chain termination: every committed action ends and is spent, emits at most CAPS.MAX_EVENTS_PER_ACTION events at depth 0 or 1, and bonus moves come only from depth-0 replay abilities',
    () => {
      const replay = new Set(abilities.filter((a) => a.tags.includes('replay')).map((a) => a.id));
      let longest = 0;
      let nested = 0;
      fc.assert(
        fc.property(gameArb, (spec) => {
          const game = playGame(engine, spec);
          for (const action of game.actions) {
            const events = action.steps.flatMap((st) => st.result.events);
            longest = Math.max(longest, events.length);
            expect(events.length).toBeLessThanOrEqual(CAPS.MAX_EVENTS_PER_ACTION);
            expect(action.steps.at(-1)?.result.kind).toBe('done');
            for (const e of events) expect([0, 1]).toContain(e.depth);
            if (events.some((e) => e.depth === 1)) nested++;
            // Event indices are contiguous over the whole action (no event lost or repeated).
            const first = action.steps[0]?.pre.eventSeq ?? 0;
            expect(events.map((e) => e.i)).toEqual(events.map((_, k) => first + k));
            // INV-01: each bonus move is granted by a replay ability activated in the committed
            // action (depth 0); a bonus action never grants another (DD-12).
            const bonusMoves = events.filter((e) => e.k === 'MoveMade' && e.bonus).length;
            const grants = events.filter(
              (e) =>
                e.k === 'AbilityTriggered' &&
                e.depth === 0 &&
                e.ability !== null &&
                replay.has(e.ability),
            ).length;
            expect(bonusMoves).toBeLessThanOrEqual(grants);
            // INV-06: the committed move is spent; hidden abilities never retract it. It opens the
            // action (ActionStarted), is the first non-bonus MoveMade, and the turn passes.
            const move = action.steps[0];
            const post = action.steps.at(-1)?.result.state;
            if (!move || move.input.kind !== 'move' || !post) throw new Error('malformed action');
            const { side, move: committed } = move.input;
            expect(events[0]).toMatchObject({ k: 'ActionStarted', side, move: committed });
            expect(events.find((e) => e.k === 'MoveMade' && !e.bonus)).toMatchObject({
              side,
              from: committed.from,
              to: committed.to,
              depth: 0,
            });
            if (!post.result) {
              expect(post.turn).toBe(other(side));
              expect(post.ply).toBe(move.pre.ply + 1);
            }
          }
        }),
        { numRuns: 60 * SCALE },
      );
      // Keep the property meaningful: nested pipelines must actually be exercised.
      expect(nested).toBeGreaterThan(0);
      console.log(`R-ABIL-003: longest action ${longest} events; ${nested} actions with depth 1`);
    },
    GAME_TIMEOUT,
  );

  it(
    'R-SEC-001 R-INFO-005 projection safety: no project() or projectEvents() payload to either viewer contains an unrevealed opponent ability or item id',
    () => {
      let scanned = 0;
      fc.assert(
        fc.property(gameArb, (spec) => {
          const game = playGame(engine, spec);
          const found: string[] = [];
          const scan = (state: GameState, events: readonly BattleEvent[], label: string) => {
            scanned++;
            for (const viewer of SIDES)
              for (const leak of leaks(engine, state, events, viewer))
                found.push(`${label}: ${leak}`);
          };
          scan(game.start.state, game.start.events, 'setup');
          for (const action of game.actions)
            action.steps.forEach((st, k) =>
              scan(st.result.state, st.result.events, `ply ${action.ply} step ${k}`),
            );
          expect(found).toEqual([]);
        }),
        { numRuns: 60 * SCALE },
      );
      expect(scanned).toBeGreaterThan(40);
    },
    GAME_TIMEOUT,
  );

  it(
    'DD-11 DD-18 R-ABIL-004 R-SEC-002 suspension: at every needsChoice the state is plain JSON, answering on its JSON round trip gives identical results, bad answers are rejected, and prompts have the DD-18 shape',
    () => {
      let prompts = 0;
      fc.assert(
        fc.property(gameArb, (spec) => {
          const game = playGame(engine, spec);
          for (const action of game.actions) {
            const move = action.steps[0];
            if (!move) throw new Error('empty action');
            let emitted = 0;
            action.steps.forEach((st, k) => {
              const r = st.result;
              emitted += r.events.length;
              if (r.kind === 'done') {
                expect(r.state.pending).toBeNull();
                return;
              }
              prompts++;
              const req = r.request;
              // The pending record (DD-11): pre-action snapshot, the action input, the open request
              // and the number of events already emitted; all of it plain JSON.
              const pend = r.state.pending;
              expect(pend).not.toBeNull();
              expect(pend?.request).toEqual(req);
              expect(json(pend?.pre)).toEqual(json(move.pre));
              expect(pend?.input).toEqual(move.input);
              expect(pend?.emitted).toBe(emitted);
              expect(json(r.state)).toEqual(r.state);
              expect(engine.stateHash(json(r.state))).toBe(engine.stateHash(r.state));
              // Only the chooser receives the open prompt (8.5, R-INFO-005).
              const mine = engine.project(r.state, req.chooser).pending;
              const theirs = engine.project(r.state, other(req.chooser)).pending;
              expect(mine?.chooser).toBe(req.chooser);
              expect(mine?.request).toEqual(req);
              expect(theirs?.chooser).toBe(req.chooser);
              expect(theirs?.request ?? null).toBeNull();
              // The owner of the ability chooses (5.2); prompt shape per DD-18.
              expect(req.chooser).toBe(req.source.side);
              expect(req.options.length).toBeGreaterThanOrEqual(2);
              expect(req.defaultOption).toBeGreaterThanOrEqual(0);
              expect(req.defaultOption).toBeLessThan(req.options.length);
              if (req.kind === 'bonusMove') {
                expect(req.options[0]).toEqual({ kind: 'decline' });
                expect(req.defaultOption).toBe(0);
              } else {
                expect(req.options.some((o) => o.kind === 'decline')).toBe(false);
                // 5.4: no answer means the first valid option in square order, a1 to h8 from the
                // owner's side.
                const keys = req.options.map((o) =>
                  'square' in o ? relOrder(req.chooser, o.square) : -1,
                );
                expect(keys).not.toContain(-1);
                expect(keys[req.defaultOption]).toBe(Math.min(...keys));
              }
              // R-SEC-002: bad answers are rejected with a RulesError and change nothing.
              const snapshot = JSON.stringify(r.state);
              const good = { kind: 'choice', side: req.chooser, promptId: req.promptId, option: 0 };
              const bad: ActionInput[] = [
                { ...good, kind: 'choice', option: req.options.length },
                { ...good, kind: 'choice', option: -1 },
                { ...good, kind: 'choice', promptId: `${req.promptId}-stale` },
                { ...good, kind: 'choice', side: other(req.chooser) },
                { kind: 'move', side: r.state.turn, move: (move.input as { move: Move }).move },
              ];
              for (const input of bad)
                expect(() => engine.applyAction(r.state, input)).toThrow(RulesError);
              expect(JSON.stringify(r.state)).toBe(snapshot);
              // Answer on a JSON round trip (a Durable Object restart) and compare.
              const next = action.steps[k + 1];
              if (!next) throw new Error('a suspended action has no answer step');
              const stored = json(r.state);
              const resumed = engine.applyAction(stored, next.input);
              expect(json(resumed)).toEqual(json(next.result));
              expect(engine.stateHash(resumed.state)).toBe(engine.stateHash(next.result.state));
              // The resume returns only the new events, starting with the recorded answer.
              const made = resumed.events.filter((e) => e.k === 'ChoiceMade');
              const input = next.input;
              if (input.kind !== 'choice') throw new Error('expected a choice input');
              expect(made[0]).toMatchObject({
                side: req.chooser,
                promptId: req.promptId,
                option: req.options[input.option],
              });
              expect(resumed.events[0]?.i).toBe(r.state.eventSeq);
            });
          }
        }),
        { numRuns: 60 * SCALE },
      );
      console.log(`DD-11: ${prompts} prompts checked`);
      expect(prompts).toBeGreaterThan(0);
    },
    GAME_TIMEOUT,
  );

  it(
    'DD-11 INV-04 a battle whose state is JSON round-tripped before every action and answer replays to the same events and hashes',
    () => {
      fc.assert(
        fc.property(gameArb, (spec) => {
          const game = playGame(engine, spec);
          let s = json(engine.newBattle(json(spec.setup)).state);
          for (const action of game.actions)
            for (const step of action.steps) {
              const r = engine.applyAction(json(s), step.input);
              expect(r.events).toEqual(step.result.events);
              expect(engine.stateHash(r.state)).toBe(engine.stateHash(step.result.state));
              s = r.state;
            }
          expect(json(s)).toEqual(json(game.final));
        }),
        { numRuns: 40 * SCALE },
      );
    },
    GAME_TIMEOUT,
  );
});

// ---- loadouts (R-LOAD-004) ------------------------------------------------------------------------

describe('property: loadout validation (R-LOAD-004)', () => {
  it('R-LOAD-004 R-LOAD-002 the spec 7.2 item table matches the shipped catalogue (costs, capacities, grants, parameters)', () => {
    expect([...ITEM_IDS].sort()).toEqual(Object.keys(SPEC_ITEMS).sort());
    for (const def of items) {
      const s = specItem(def.id);
      expect(def.slotCost).toBe(s.cost);
      expect(def.capacity).toBe(s.capacity);
      expect(def.exclusiveGroup !== undefined).toBe(s.capacity !== undefined);
      expect(Boolean(def.grants?.perTypeSets)).toBe(Boolean(s.schedule));
      expect(Boolean(def.grants?.secondElement)).toBe(Boolean(s.blended));
      expect(def.param?.element === 'required').toBe(Boolean(s.param));
    }
  });

  it('R-LOAD-004 R-LOAD-001 random loadouts that pass validateLoadout satisfy rules 1-7 when checked independently', () => {
    fc.assert(
      fc.property(validArmyArb, ({ level, loadout }) => {
        const v = engine.validateLoadout(loadout, { level });
        expect(v.ok).toBe(true);
        expect(v.errors).toEqual([]);
        expect(specViolations(loadout, { level })).toEqual([]);
        // Every element comes from the enabled list (DD-23, 6.5).
        for (const el of loadout.elements) expect(ENABLED).toContain(el);
        // The reported numbers follow R-LOAD-001 and the 7.2 table.
        expect(v.unlockedSlots).toBe(specSlots(level));
        expect(v.consumedSlots).toBe(loadout.items.reduce((n, id) => n + specItem(id).cost, 0));
        expect(v.capacity).toBe(
          Math.max(1, ...loadout.items.map((id) => specItem(id).capacity ?? 1)),
        );
      }),
      { numRuns: 300 * SCALE },
    );
  });

  it('R-LOAD-004 validateLoadout agrees with an independent rules 1-7 checker on arbitrary loadouts (same verdict, same rule numbers)', () => {
    let invalid = 0;
    let valid = 0;
    const candidateArb = fc.oneof(
      looseArb,
      validArmyArb.map((a) => ({ loadout: a.loadout, facts: { level: a.level } as PlayerFacts })),
    );
    fc.assert(
      fc.property(candidateArb, ({ loadout, facts }) => {
        const v = engine.validateLoadout(loadout, facts);
        const expected = specViolations(loadout, facts);
        if (expected.length === 0) valid++;
        else invalid++;
        expect(rulesOf(v)).toEqual(expected);
        expect(v.ok).toBe(expected.length === 0);
      }),
      { numRuns: 500 * SCALE },
    );
    expect(valid).toBeGreaterThan(20);
    expect(invalid).toBeGreaterThan(20);
  });

  it('R-LOAD-004 DD-23 mutating a valid loadout to break exactly one rule makes validation fail with that rule number', () => {
    const applied: Record<string, number> = {};
    const kinds = ['1', '2', '3', '4', '5', '6', '7', '7r', 'dd23'] as const;
    fc.assert(
      fc.property(
        validArmyArb,
        fc.constantFrom(...kinds),
        fc.array(fc.nat(), { minLength: 8, maxLength: 8 }),
        ({ level, loadout: base }, kind, picks) => {
          const r = new Prng(picks.reduce((h, x) => (h * 31 + x) >>> 0, 17));
          const loadout = json(base);
          let facts: PlayerFacts = { level };
          let eng: Engine = engine;
          let data: CheckOptions = {};
          const slots = specSlots(level);
          const used = loadout.items.reduce((n, id) => n + specItem(id).cost, 0);
          const capacity = Math.max(1, ...loadout.items.map((id) => specItem(id).capacity ?? 1));
          const hasCapacityItem = loadout.items.some((id) => specItem(id).capacity !== undefined);
          const setParam = (id: string) => {
            if (specItem(id).param)
              loadout.itemParams = { ...loadout.itemParams, [id]: { element: r.pick(ENABLED) } };
          };
          const allAbilities = [...new Set(loadout.sets.flat())];
          let expectedRule: number | null = null;
          switch (kind) {
            case '1': {
              // Add affordable-by-level items (no Blended Family, no second capacity item) until
              // the slot budget is exceeded.
              const extra = ITEM_IDS.filter(
                (id) =>
                  !loadout.items.includes(id) &&
                  itemOf(id).minLevel <= level &&
                  !specItem(id).blended &&
                  !(hasCapacityItem && specItem(id).capacity !== undefined),
              );
              let total = used;
              const add: string[] = [];
              let capAdded = false;
              for (const id of extra) {
                if (total > slots) break;
                if (specItem(id).capacity !== undefined) {
                  if (capAdded) continue;
                  capAdded = true;
                }
                add.push(id);
                total += specItem(id).cost;
              }
              if (total <= slots) return;
              for (const id of add) {
                loadout.items.push(id);
                setParam(id);
              }
              expectedRule = 1;
              break;
            }
            case '2': {
              // Put an ability the player's level has not unlocked into one set.
              const k = r.int(loadout.sets.length);
              const set = loadout.sets[k] ?? [];
              const locked = ABILITY_IDS.filter(
                (id) => abilityOf(id).minLevel > level && !set.includes(id),
              );
              if (locked.length === 0) return;
              const id = r.pick(locked);
              const cost = set.reduce((n, a) => n + abilityOf(a).slotCost, 0);
              if (cost + abilityOf(id).slotCost <= capacity) set.push(id);
              else {
                const out = set.findIndex((a) => abilityOf(a).slotCost >= abilityOf(id).slotCost);
                if (out < 0) return;
                set[out] = id;
              }
              expectedRule = 2;
              break;
            }
            case '3': {
              // Equip an item twice, or a second capacity item, within the slot budget.
              const dup = loadout.items.filter((id) => used + specItem(id).cost <= slots);
              const second = hasCapacityItem
                ? ITEM_IDS.filter(
                    (id) =>
                      specItem(id).capacity !== undefined &&
                      !loadout.items.includes(id) &&
                      itemOf(id).minLevel <= level &&
                      used + specItem(id).cost <= slots,
                  )
                : [];
              const pool = [...dup, ...second];
              if (pool.length === 0) return;
              const id = r.pick(pool);
              loadout.items.push(id);
              setParam(id);
              expectedRule = 3;
              break;
            }
            case '4': {
              // A duplicate inside a set, or more abilities than the capacity allows.
              const k = r.int(loadout.sets.length);
              const set = loadout.sets[k] ?? [];
              if (set.length > 0) set.push(r.pick(set));
              else {
                const open = ABILITY_IDS.filter((id) => abilityOf(id).minLevel <= level);
                let cost = 0;
                for (const id of open) {
                  if (cost > capacity) break;
                  set.push(id);
                  cost += abilityOf(id).slotCost;
                }
                if (cost <= capacity) return;
              }
              expectedRule = 4;
              break;
            }
            case '5': {
              // A set count other than 1, or 6 with Multitasker's Schedule.
              const schedule = loadout.items.some((id) => specItem(id).schedule);
              const counts = schedule ? [0, 2, 3, 4, 5, 7] : [0, 2, 3, 4, 5, 6, 7];
              const n = r.pick(counts);
              const src = loadout.sets;
              loadout.sets = Array.from({ length: n }, (_, i) => [...(src[i % src.length] ?? [])]);
              expectedRule = 5;
              break;
            }
            case '6': {
              // Blended Family with equal elements or one element; two elements without it.
              const blended = loadout.items.some((id) => specItem(id).blended);
              const e = r.pick(ENABLED);
              if (blended) loadout.elements = r.int(2) === 0 ? [e, e] : [e];
              else loadout.elements = [e, r.pick(ENABLED.filter((x) => x !== e))];
              expectedRule = 6;
              break;
            }
            case '7': {
              // Something equipped that the player does not own.
              if (loadout.items.length > 0 && (allAbilities.length === 0 || r.int(2) === 0)) {
                const missing = r.pick(loadout.items);
                facts = { level, ownedItems: ITEM_IDS.filter((id) => id !== missing) };
              } else if (allAbilities.length > 0) {
                const missing = r.pick(allAbilities);
                facts = { level, ownedAbilities: ABILITY_IDS.filter((id) => id !== missing) };
              } else return;
              expectedRule = 7;
              break;
            }
            case '7r': {
              // Something equipped that is retired (content data, 13.5).
              const pool = [...loadout.items, ...allAbilities];
              if (pool.length === 0) return;
              const id = r.pick(pool);
              const reg = {
                ...registry,
                items: registry.items.map((i) => (i.id === id ? { ...i, retired: true } : i)),
                abilities: registry.abilities.map((a) =>
                  a.id === id ? { ...a, retired: true } : a,
                ),
              };
              eng = createEngine(reg, CAPS);
              data = {
                itemData: new Map(reg.items.map((i) => [i.id, i])),
                abilityData: new Map(reg.abilities.map((a) => [a.id, a])),
              };
              expectedRule = 7;
              break;
            }
            case 'dd23': {
              // DD-23: 'neutral' (and any element not yet enabled) is for sandbox battles only.
              const bad = r.pick(DISABLED);
              loadout.elements = loadout.elements.map((e, i) =>
                i === loadout.elements.length - 1 ? bad : e,
              );
              const v = engine.validateLoadout(loadout, facts);
              expect(v.ok).toBe(false);
              applied[kind] = (applied[kind] ?? 0) + 1;
              return;
            }
          }
          if (expectedRule === null) return;
          // The mutation breaks exactly the intended rule when checked from the spec...
          expect(specViolations(loadout, facts, data)).toEqual([expectedRule]);
          // ...and the validator rejects it for that rule and no other.
          const v = eng.validateLoadout(loadout, facts);
          expect(v.ok).toBe(false);
          expect(rulesOf(v)).toEqual([expectedRule]);
          applied[kind] = (applied[kind] ?? 0) + 1;
        },
      ),
      { numRuns: 400 * SCALE },
    );
    for (const kind of kinds) expect(applied[kind] ?? 0, `mutation ${kind}`).toBeGreaterThan(3);
  });
});
