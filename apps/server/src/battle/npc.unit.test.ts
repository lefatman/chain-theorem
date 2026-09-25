/**
 * NPC seats in the battle core (9.4, R-FMT-005): immediate replies from the NPC's own projection,
 * no NPC clock, deterministic node budgets. The CPU benchmark is opt-in:
 *
 *   SERVER_NPC_BENCH=1 pnpm exec vitest run --project unit apps/server/src/battle/npc.unit.test.ts
 */
import { describe, expect, it } from 'vitest';
import { CHOICE_PROMPT_MS, FORMATS, engine } from '@chain-theorem/content';
import { scanPayload } from '@chain-theorem/content/scan';
import {
  applyWithDefaults,
  type GameState,
  type Loadout,
  type PublicState,
  type Side,
  moveToUci,
} from '@chain-theorem/rules';
import { chooseOption, search } from '@chain-theorem/ai';
import { BattleCore, type CoreOptions } from './core.ts';
import { NPC_NODES, type NpcPolicy, searchPolicy } from './npc.ts';
import { Rng, checkMessage, frame, randomLoadout } from './testing.ts';
import type { BattleInit, Outbox, Tier } from './types.ts';

const T0 = 1_750_000_000_000;
const FULL = FORMATS.full?.clock ?? { initialMs: 600_000, incrementMs: 5_000 };
const PLAIN: Loadout = { elements: ['ember'], items: [], sets: [[]] };
const RIPOSTE: Loadout = { elements: ['ember'], items: [], sets: [['riposte']] };
const E6_FEN = '4k1r1/5p1p/6n1/8/8/3B4/8/4K3 w - - 0 1';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;

function vsNpc(over: Partial<BattleInit> = {}, tier: Tier = 'trainer'): BattleInit {
  return {
    battleId: 'b-npc',
    format: 'full',
    white: { playerId: 'p1', name: 'Ada', level: 30, loadout: PLAIN },
    black: { tier, name: 'Route Trainer', level: 30, loadout: PLAIN, npcId: 'trainer_1' },
    ...over,
  };
}

/** Wrap a policy so every call is checked: own projection only, own loadout only (9.4). */
function spyPolicy(
  inner: NpcPolicy,
  side: Side,
  own: () => Loadout,
  state: () => GameState | null,
  calls: string[],
): NpcPolicy {
  const check = (pub: PublicState, loadout: Loadout, kind: string) => {
    calls.push(kind);
    expect(pub.viewer).toBe(side);
    expect(loadout).toEqual(own());
    expect(pub.armies[side === 'white' ? 'black' : 'white'].loadout).toBeUndefined();
    const s = state();
    if (s) expect(scanPayload(pub, s, side)).toBeNull();
  };
  return {
    move: (pub, loadout, tier) => {
      check(pub, loadout, 'move');
      return inner.move(pub, loadout, tier);
    },
    option: (pub, loadout, request, tier) => {
      check(pub, loadout, 'option');
      expect(request.chooser).toBe(side);
      return inner.option(pub, loadout, request, tier);
    },
    acceptDraw: (pub, loadout, tier) => {
      check(pub, loadout, 'draw');
      return inner.acceptDraw(pub, loadout, tier);
    },
  };
}

function checked(opts: CoreOptions = {}): { opts: CoreOptions; problems: string[] } {
  const problems: string[] = [];
  return {
    problems,
    opts: {
      ...opts,
      observe: (to, msg, state) => {
        const p = checkMessage(to, msg, state);
        if (p) problems.push(p);
      },
    },
  };
}

const kinds = (out: Outbox) => out.send.map((o) => `${o.to}:${o.msg.t}`);

describe('BattleCore NPC seats (R-FMT-005)', () => {
  it('R-FMT-005 an NPC replies inside the same call and its clock never runs', () => {
    const { opts, problems } = checked();
    const { core } = BattleCore.create(vsNpc(), T0, opts);
    core.connect('white', T0);
    core.message('white', frame('hello', { from: 0 }), T0);
    const out = core.message('white', frame('mv', { move: 'e2e4' }), T0 + 3000);
    expect(kinds(out)).toEqual(['white:bev', 'white:bev']);
    expect(core.log().map((r) => r.cause)).toEqual(['start', 'player', 'npc']);
    expect(core.fullState().turn).toBe('white');
    expect(core.snapshot().clocks).toMatchObject({
      white: FULL.initialMs - 3000 + FULL.incrementMs,
      black: FULL.initialMs,
      running: 'white',
      at: T0 + 3000,
    });
    // The NPC seat never connects, so it has no grace timer: only White's flag is pending.
    expect(core.nextAlarm()).toBe(T0 + 3000 + FULL.initialMs - 3000 + FULL.incrementMs);
    expect(problems).toEqual([]);
  });

  it('R-FMT-005 an NPC white moves at creation; an NPC side ignores connects and messages', () => {
    const i = vsNpc();
    const { core, out } = BattleCore.create(
      { ...i, white: { ...i.black }, black: { ...i.white } },
      T0,
    );
    expect(out.effects.filter((e) => e.kind === 'persist')).toHaveLength(2);
    expect(core.fullState().turn).toBe('black');
    expect(core.connect('white', T0 + 1)).toEqual({ send: [], effects: [], save: false });
    expect(core.message('white', frame('resign', {}), T0 + 1).send).toEqual([]);
    expect(core.result).toBeNull();
  });

  it('R-FMT-005 R-SEC-001 NPCs see only their own projection and loadout (9.4)', () => {
    for (const seed of [11, 12, 13]) {
      const rng = new Rng(seed);
      const human = randomLoadout(engine, rng, 30);
      const npcLoadout = randomLoadout(engine, rng, 30);
      const calls: string[] = [];
      let state: (() => GameState) | null = null;
      const policy = spyPolicy(
        searchPolicy(engine, { trainer: 500 }),
        'black',
        () => npcLoadout,
        () => (state ? state() : null),
        calls,
      );
      const { opts, problems } = checked({ npc: policy });
      const init = vsNpc({
        white: { playerId: 'p1', name: 'Ada', level: 30, loadout: human },
        black: { tier: 'trainer', name: 'T', level: 30, loadout: npcLoadout },
      });
      const { core } = BattleCore.create(init, T0, opts);
      state = () => core.fullState();
      core.connect('white', T0);
      core.message('white', frame('hello', { from: 0 }), T0);
      let t = T0;
      for (let ply = 0; ply < 24 && !core.result; ply++) {
        const st = core.fullState();
        t += 500;
        if (st.pending) {
          core.message(
            'white',
            frame('ch', { promptId: st.pending.request.promptId, option: 0 }),
            t,
          );
          continue;
        }
        // The random human never leaves its own king in check: a random loadout may give it a
        // Stalwart king (R-RULES-003), which may legally stand in check, and a random mover would
        // walk it into capture within a few moves, ending the sweep before the NPC has moved much.
        const moves = engine.legalMoves(st, 'white');
        const safe = moves.filter(
          (mv) =>
            applyWithDefaults(engine, st, { kind: 'move', side: 'white', move: mv }).state
              .inCheck !== 'white',
        );
        const m = rng.pick(safe.length > 0 ? safe : moves);
        core.message('white', frame('mv', { move: moveToUci(m) }), t);
      }
      expect(calls.filter((c) => c === 'move').length).toBeGreaterThan(5);
      expect(problems).toEqual([]);
    }
  });

  it('R-FMT-005 an NPC answers its own prompts at once (Riposte, E6)', () => {
    const calls: string[] = [];
    const npcLoadout = RIPOSTE;
    let core: BattleCore | null = null;
    const policy = spyPolicy(
      searchPolicy(engine),
      'black',
      () => npcLoadout,
      () => core?.fullState() ?? null,
      calls,
    );
    const { opts, problems } = checked({ npc: policy });
    const i = vsNpc({ fen: E6_FEN });
    core = BattleCore.create({ ...i, black: { ...i.black, loadout: npcLoadout } }, T0, opts).core;
    core.connect('white', T0);
    core.message('white', frame('hello', { from: 0 }), T0);
    const out = core.message('white', frame('mv', { move: 'd3g6' }), T0 + 1000);
    expect(calls).toContain('option');
    expect(out.send.some((o) => o.msg.t === 'prompt')).toBe(false);
    const causes = core.log().map((r) => `${r.cause}:${r.input?.kind ?? '-'}`);
    expect(causes.slice(1, 3)).toEqual(['player:move', 'npc:choice']);
    expect(core.snapshot().prompt).toBeNull();
    expect(problems).toEqual([]);
  });

  it('R-FMT-005 R-FMT-003 after a late alarm the NPC replies at the deadline, not at the alarm time', () => {
    const momentum: Loadout = { elements: ['ember'], items: [], sets: [['momentum']] };
    const { core } = BattleCore.create(
      vsNpc({
        fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
        white: { playerId: 'p1', name: 'Ada', level: 30, loadout: momentum },
      }),
      T0,
    );
    core.connect('white', T0);
    core.message('white', frame('hello', { from: 0 }), T0);
    const out = core.message('white', frame('mv', { move: 'c3d5' }), T0 + 1000);
    // Momentum: the mover's own bonus-move prompt; the mover's clock keeps running.
    expect(out.send.filter((o) => o.msg.t === 'prompt')).toHaveLength(1);
    const due = T0 + 1000 + CHOICE_PROMPT_MS;
    expect(core.nextAlarm()).toBe(due);
    core.alarm(due + 5000);
    expect(
      core
        .log()
        .slice(-2)
        .map((r) => [r.cause, r.at]),
    ).toEqual([
      ['prompt_timeout', due],
      ['npc', due],
    ]);
    expect(core.clocksAt(due + 5000)).toMatchObject({
      white: FULL.initialMs - 1000 - CHOICE_PROMPT_MS + FULL.incrementMs - 5000,
      black: FULL.initialMs,
      running: 'white',
    });
  });

  it('R-FMT-005 NPC draw replies: decline when level, accept when clearly worse', () => {
    const level = BattleCore.create(vsNpc(), T0).core;
    level.connect('white', T0);
    level.message('white', frame('hello', { from: 0 }), T0);
    const o = level.message('white', frame('draw', {}), T0 + 10);
    expect(kinds(o)).toEqual(['white:drawDeclined']);
    expect(level.result).toBeNull();
    expect(level.snapshot().draw).toEqual({ offer: null, lastPly: { white: 0, black: null } });
    const lost = BattleCore.create(vsNpc({ fen: '4k3/8/8/8/8/8/8/3QK3 w - - 0 1' }), T0).core;
    lost.connect('white', T0);
    lost.message('white', frame('hello', { from: 0 }), T0);
    const a = lost.message('white', frame('draw', {}), T0 + 10);
    expect(lost.result).toEqual({ winner: null, reason: 'agreement' });
    expect(kinds(a)).toEqual(['white:bev', 'white:bend']);
  });

  it('R-FMT-005 NPC replies are deterministic: same inputs, same battle', () => {
    const run = () => {
      const rng = new Rng(7);
      const init = vsNpc({
        white: { playerId: 'p1', name: 'Ada', level: 30, loadout: randomLoadout(engine, rng, 30) },
        black: { tier: 'elite', name: 'E', level: 30, loadout: randomLoadout(engine, rng, 30) },
      });
      const { core } = BattleCore.create(init, T0, { npc: searchPolicy(engine, { elite: 2000 }) });
      const outs: string[] = [];
      core.connect('white', T0);
      outs.push(JSON.stringify(core.message('white', frame('hello', { from: 0 }), T0)));
      let t = T0;
      for (let k = 0; k < 12 && !core.result; k++) {
        const st = core.fullState();
        t += 1000;
        const raw = st.pending
          ? frame('ch', { promptId: st.pending.request.promptId, option: 0 })
          : frame('mv', { move: moveToUci(rng.pick(engine.legalMoves(st, 'white'))) });
        outs.push(JSON.stringify(core.message('white', raw, t)));
      }
      return { outs, hash: engine.stateHash(core.fullState()) };
    };
    const a = run();
    const b = run();
    expect(b.outs).toEqual(a.outs);
    expect(b.hash).toBe(a.hash);
  });
});

describe.runIf(env?.SERVER_NPC_BENCH === '1')('NPC CPU benchmark (SERVER_NPC_BENCH=1)', () => {
  const now = (): number => performance.now();

  /** Positions from seeded random battles with random legal loadouts, 8..40 plies in. */
  function positions(count: number): GameState[] {
    const out: GameState[] = [];
    const rng = new Rng(2024);
    while (out.length < count) {
      const level = 10 + rng.int(21);
      let { state } = engine.newBattle({
        format: 'full',
        white: { level, loadout: randomLoadout(engine, rng, level) },
        black: { level, loadout: randomLoadout(engine, rng, level) },
        strict: true,
      });
      const stop = 8 + rng.int(33);
      for (let ply = 0; ply < stop && !state.result; ply++) {
        const moves = engine.legalMoves(state, state.turn);
        let r = engine.applyAction(state, {
          kind: 'move',
          side: state.turn,
          move: rng.pick(moves),
        });
        while (r.kind === 'needsChoice')
          r = engine.applyAction(r.state, {
            kind: 'choice',
            side: r.request.chooser,
            promptId: r.request.promptId,
            option: rng.int(r.request.options.length),
          });
        state = r.state;
      }
      if (!state.result) out.push(state);
    }
    return out;
  }

  it('R-FMT-005 NPC node budgets stay near 50 ms CPU per reply', () => {
    // SERVER_NPC_NODES=trainer=20000,elite=10000 tries other budgets.
    const budgets: Record<Tier, number> = { ...NPC_NODES };
    for (const kv of (env?.SERVER_NPC_NODES ?? '').split(',').filter(Boolean)) {
      const [k, v] = kv.split('=');
      if (k === 'wild' || k === 'trainer' || k === 'elite') budgets[k] = Number(v);
    }
    const states = positions(40);
    const rows: string[] = [];
    for (const tier of ['wild', 'trainer', 'elite'] as const) {
      // Warm up the JIT.
      for (const s of states.slice(0, 5))
        search(engine, engine.project(s, s.turn), s.armies[s.turn].loadout, tier, {
          nodes: budgets[tier],
        });
      const ms: number[] = [];
      const depths: number[] = [];
      for (const s of states) {
        const pub = engine.project(s, s.turn);
        const t0 = now();
        const r = search(engine, pub, s.armies[s.turn].loadout, tier, { nodes: budgets[tier] });
        ms.push(now() - t0);
        depths.push(r.depth);
      }
      ms.sort((a, b) => a - b);
      const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
      const p90 = ms[Math.floor(ms.length * 0.9)] ?? 0;
      const max = ms[ms.length - 1] ?? 0;
      const depth = depths.reduce((a, b) => a + b, 0) / depths.length;
      rows.push(
        `${tier.padEnd(8)} ${String(budgets[tier]).padStart(6)} nodes: mean ${mean.toFixed(1)} ms, p90 ${p90.toFixed(1)} ms, max ${max.toFixed(1)} ms, mean depth ${depth.toFixed(2)}`,
      );
      expect(mean).toBeLessThan(80);
    }
    // Prompt answers (chooseOption) on real prompts from the same kind of battles.
    const rng = new Rng(99);
    const optMs: number[] = [];
    for (let k = 0; optMs.length < 30 && k < 400; k++) {
      const level = 30;
      let { state } = engine.newBattle({
        format: 'full',
        white: { level, loadout: randomLoadout(engine, rng, level) },
        black: { level, loadout: randomLoadout(engine, rng, level) },
        strict: true,
      });
      for (let ply = 0; ply < 60 && !state.result && optMs.length < 30; ply++) {
        const moves = engine.legalMoves(state, state.turn);
        const caps = moves.filter((m) => (state.board[m.to] ?? -1) >= 0);
        const move = caps.length > 0 ? rng.pick(caps) : rng.pick(moves);
        let r = engine.applyAction(state, { kind: 'move', side: state.turn, move });
        while (r.kind === 'needsChoice') {
          const c = r.request.chooser;
          const pub = engine.project(r.state, c);
          const t0 = now();
          chooseOption(engine, pub, r.state.armies[c].loadout, r.request, 'elite');
          optMs.push(now() - t0);
          r = engine.applyAction(r.state, {
            kind: 'choice',
            side: c,
            promptId: r.request.promptId,
            option: r.request.defaultOption,
          });
        }
        state = r.state;
      }
    }
    optMs.sort((a, b) => a - b);
    const optMean = optMs.reduce((a, b) => a + b, 0) / Math.max(1, optMs.length);
    rows.push(
      `prompt answers (${optMs.length}): mean ${optMean.toFixed(1)} ms, max ${(optMs[optMs.length - 1] ?? 0).toFixed(1)} ms`,
    );
    console.log(`\nServer NPC budgets over ${states.length} positions\n${rows.join('\n')}\n`);
  });
});
