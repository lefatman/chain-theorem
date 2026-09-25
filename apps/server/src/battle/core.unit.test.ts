/**
 * BattleCore behaviour (M4 4.2): protocol flow, clocks, prompts, conduct, rate limits, persistence.
 * The randomized R-SEC-001 sweep lives in security.unit.test.ts; NPC seats in npc.unit.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CHOICE_PROMPT_MS, DISCONNECT_GRACE_MS, FORMATS, engine } from '@chain-theorem/content';
import { LIMITS, MAX_STRIKES } from '@chain-theorem/protocol';
import {
  type BattleEvent,
  type GameState,
  type Loadout,
  type PublicState,
  RulesError,
  type Side,
  moveToUci,
} from '@chain-theorem/rules';
import { BattleCore, type CoreOptions } from './core.ts';
import { checkMessage, frame } from './testing.ts';
import type { BattleInit, BattleSnapshot, LogRecord, Outbox, ServerMsg } from './types.ts';

const T0 = 1_750_000_000_000;
const FULL = FORMATS.full?.clock ?? { initialMs: 600_000, incrementMs: 5_000 };

const PLAIN: Loadout = { elements: ['ember'], items: [], sets: [[]] };
const RIPOSTE: Loadout = { elements: ['ember'], items: [], sets: [['riposte']] };
/** E6 (5.5): Bd3xg6 captures a knight with Riposte; Black answers the bonus-capture prompt. */
const E6_FEN = '4k1r1/5p1p/6n1/8/8/3B4/8/4K3 w - - 0 1';

function init(over: Partial<BattleInit> = {}): BattleInit {
  return {
    battleId: 'b-test-1',
    format: 'full',
    white: { playerId: 'p-white', name: 'Ada', level: 30, loadout: PLAIN },
    black: { playerId: 'p-black', name: 'Bo', level: 30, loadout: PLAIN },
    ...over,
  };
}

type MsgOf<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

function msgs<T extends ServerMsg['t']>(out: Outbox, to: Side, t: T): MsgOf<T>[] {
  return out.send.filter((o) => o.to === to && o.msg.t === t).map((o) => o.msg as MsgOf<T>);
}

const records = (out: Outbox): LogRecord[] =>
  out.effects.flatMap((e) => (e.kind === 'persist' ? [e.record] : []));

/** Create a battle whose every outgoing message is checked (schema, R-SEC-001 scan). */
function start(i: BattleInit = init(), opts: CoreOptions = {}, t0 = T0) {
  const problems: string[] = [];
  const observe: CoreOptions['observe'] = (to, msg, state) => {
    const p = checkMessage(to, msg, state);
    if (p) problems.push(p);
  };
  const { core, out } = BattleCore.create(i, t0, { ...opts, observe });
  return { core, out, problems, observe };
}

/** Connect both sides and say hello at `t`. */
function join(core: BattleCore, t: number): void {
  for (const side of ['white', 'black'] as const) {
    core.connect(side, t);
    core.message(side, frame('hello', { from: 0 }), t);
  }
}

const mv = (move: string) => frame('mv', { move });
const pubOf = (m: MsgOf<'bev'> | MsgOf<'bstart'>) => m.d.public as unknown as PublicState;

describe('BattleCore setup', () => {
  it('R-LOAD-004 a battle starts only with legal loadouts (strict newBattle)', () => {
    const illegal: Loadout = { elements: ['ember'], items: [], sets: [['riposte']] };
    // Riposte needs level 12: a level 5 seat cannot carry it.
    const bad = init({ black: { playerId: 'p2', name: 'Bo', level: 5, loadout: illegal } });
    expect(() => BattleCore.create(bad, T0)).toThrow(RulesError);
    expect(() => BattleCore.create(init({ battleId: '' }), T0)).toThrow(/battleId/);
    const npcs = init({
      white: { tier: 'wild', name: 'W', level: 5, loadout: PLAIN },
      black: { tier: 'wild', name: 'B', level: 5, loadout: PLAIN },
    });
    expect(() => BattleCore.create(npcs, T0)).toThrow(/at least one player/);
    const { core, out } = start();
    expect(core.result).toBeNull();
    expect(records(out)).toHaveLength(1);
    expect(records(out)[0]?.cause).toBe('start');
    expect(out.save).toBe(true);
    expect(out.send).toHaveLength(0);
  });

  it('R-NET-001 hello answers bstart, the events since `from`, the opponent status', () => {
    const { core, problems } = start();
    core.connect('white', T0 + 10);
    const out = core.message('white', frame('hello', { from: 0 }), T0 + 10);
    expect(out.send.map((o) => o.msg.t)).toEqual(['bstart', 'bev', 'opp']);
    const [bstart] = msgs(out, 'white', 'bstart');
    expect(bstart?.d.you).toBe('white');
    expect(bstart?.d.players).toEqual({
      white: { name: 'Ada', level: 30 },
      black: { name: 'Bo', level: 30 },
    });
    expect(bstart?.d.eventCount).toBe(core.log()[0]?.events.length);
    expect(bstart?.d.clocks.white).toBe(FULL.initialMs - 10);
    const [bev] = msgs(out, 'white', 'bev');
    expect(bev?.d.from).toBe(0);
    expect(bev?.d.to).toBe(bstart?.d.eventCount);
    expect(bev?.d.events.map((e) => e.k)).toContain('BattleStarted');
    expect(msgs(out, 'white', 'opp')[0]?.d).toEqual({
      connected: false,
      graceUntil: T0 + DISCONNECT_GRACE_MS,
    });
    expect(problems).toEqual([]);
  });

  it('R-NET-001 every move streams bev to both sides with the same log range', () => {
    const { core, problems } = start();
    join(core, T0);
    const out = core.message('white', mv('e2e4'), T0 + 1500);
    const w = msgs(out, 'white', 'bev');
    const b = msgs(out, 'black', 'bev');
    expect(w).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(w[0]?.d.from).toBe(b[0]?.d.from);
    expect(w[0]?.d.to).toBe(b[0]?.d.to);
    expect(w[0]?.d.events.map((e) => e.k)).toContain('MoveMade');
    // The side to move gets its legal moves; the other side none.
    expect(pubOf(w[0] as MsgOf<'bev'>).legal).toEqual([]);
    expect(pubOf(b[0] as MsgOf<'bev'>).legal.length).toBeGreaterThan(0);
    expect(w[0]?.d.clocks).toMatchObject({
      white: FULL.initialMs - 1500 + FULL.incrementMs,
      black: FULL.initialMs,
      running: 'black',
      at: T0 + 1500,
    });
    expect(records(out)).toHaveLength(1);
    expect(out.save).toBe(true);
    expect(problems).toEqual([]);
  });
});

describe('BattleCore refuses bad input (R-SEC-002)', () => {
  it('R-SEC-002 out-of-turn, illegal and pre-hello moves answer err and change nothing', () => {
    const { core } = start();
    core.connect('white', T0);
    const before = JSON.stringify(core.fullState());
    const logLen = core.log().length;
    const check = (side: Side, raw: string, code: string) => {
      const out = core.message(side, raw, T0 + 5);
      expect(out.send).toEqual([
        { to: side, msg: { t: 'err', d: expect.objectContaining({ code }) } },
      ]);
      expect(records(out)).toEqual([]);
      expect(JSON.stringify(core.fullState())).toBe(before);
      expect(core.log()).toHaveLength(logLen);
    };
    check('white', mv('e2e4'), 'bad_message'); // no hello yet
    core.message('white', frame('hello', { from: 0 }), T0);
    core.connect('black', T0);
    core.message('black', frame('hello', { from: 0 }), T0);
    check('black', mv('e7e5'), 'not_your_turn');
    check('white', mv('e2e5'), 'illegal');
    check('white', mv('e1e1'), 'illegal');
    check('white', frame('ch', { promptId: '0.0', option: 0 }), 'no_prompt');
    check('black', frame('drawReply', { accept: true }), 'illegal');
    expect(core.snapshot().stats.white.rejected).toBe(4);
    expect(core.snapshot().clocks).toMatchObject({ at: T0, white: FULL.initialMs });
  });

  it('R-SEC-002 a foreign, stale or replayed ch is refused; the chooser answers once', () => {
    const { core, problems } = start(
      init({ fen: E6_FEN, black: { playerId: 'p2', name: 'Bo', level: 30, loadout: RIPOSTE } }),
    );
    join(core, T0);
    const out = core.message('white', mv('d3g6'), T0 + 1000);
    const [prompt] = msgs(out, 'black', 'prompt');
    expect(prompt).toBeDefined();
    expect(msgs(out, 'white', 'prompt')).toEqual([]);
    const promptId = prompt?.d.promptId ?? '';
    const refused = (side: Side, d: unknown, code: string) => {
      const state = JSON.stringify(core.fullState());
      const o = core.message(side, frame('ch', d), T0 + 2000);
      expect(msgs(o, side, 'err')[0]?.d.code).toBe(code);
      expect(JSON.stringify(core.fullState())).toBe(state);
    };
    refused('white', { promptId, option: 0 }, 'not_your_turn');
    refused('black', { promptId: '99.0', option: 0 }, 'no_prompt');
    refused('black', { promptId, option: 200 }, 'illegal');
    refused('white', { promptId, option: 1 }, 'not_your_turn');
    // A move while the prompt waits is out of turn for both sides.
    const state = JSON.stringify(core.fullState());
    expect(msgs(core.message('black', mv('h7g6'), T0 + 2000), 'black', 'err')[0]?.d.code).toBe(
      'not_your_turn',
    );
    expect(JSON.stringify(core.fullState())).toBe(state);
    const ok = core.message('black', frame('ch', { promptId, option: 0 }), T0 + 3000);
    expect(records(ok)).toHaveLength(1);
    refused('black', { promptId, option: 0 }, 'no_prompt'); // replayed
    expect(problems).toEqual([]);
  });
});

describe('BattleCore prompts and clocks (R-FMT-003)', () => {
  const e6 = () =>
    start(
      init({ fen: E6_FEN, black: { playerId: 'p2', name: 'Bo', level: 30, loadout: RIPOSTE } }),
    );

  it('R-FMT-003 a mid-action prompt is charged to the chooser; the mover gets the increment when the action completes', () => {
    const { core, problems } = e6();
    join(core, T0);
    const out = core.message('white', mv('d3g6'), T0 + 2000);
    const [prompt] = msgs(out, 'black', 'prompt');
    expect(prompt?.d.deadline).toBe(T0 + 2000 + CHOICE_PROMPT_MS);
    const [wbev] = msgs(out, 'white', 'bev');
    // The mover's projection shows a pending choice without the request (R-INFO-005).
    expect(pubOf(wbev as MsgOf<'bev'>).pending).toEqual({ chooser: 'black', request: null });
    expect(wbev?.d.clocks).toMatchObject({
      white: FULL.initialMs - 2000,
      black: FULL.initialMs,
      running: 'black',
    });
    expect(core.nextAlarm()).toBe(T0 + 2000 + CHOICE_PROMPT_MS);
    // Mid-prompt: the chooser's clock runs, the mover's is paused.
    expect(core.clocksAt(T0 + 5000)).toMatchObject({
      white: FULL.initialMs - 2000,
      black: FULL.initialMs - 3000,
    });
    const request = pubOf(msgs(out, 'black', 'bev')[0] as MsgOf<'bev'>).pending?.request;
    const capture = request?.options.findIndex((o) => o.kind === 'move') ?? -1;
    expect(capture).toBeGreaterThan(0);
    const done = core.message(
      'black',
      frame('ch', { promptId: prompt?.d.promptId, option: capture }),
      T0 + 9000,
    );
    const clocks = msgs(done, 'black', 'bev')[0]?.d.clocks;
    expect(clocks).toMatchObject({
      white: FULL.initialMs - 2000 + FULL.incrementMs,
      black: FULL.initialMs - 7000,
      running: 'black',
      at: T0 + 9000,
    });
    expect(done.send.some((o) => o.msg.t === 'prompt')).toBe(false);
    expect(problems).toEqual([]);
  });

  it('R-FMT-003 an unanswered prompt takes its default option after 15 s (5.4, DD-18)', () => {
    const { core, problems } = e6();
    join(core, T0);
    const out = core.message('white', mv('d3g6'), T0 + 2000);
    const request = pubOf(msgs(out, 'black', 'bev')[0] as MsgOf<'bev'>).pending?.request;
    const due = T0 + 2000 + CHOICE_PROMPT_MS;
    expect(records(core.alarm(due - 1))).toEqual([]);
    const fired = core.alarm(due + 250); // a late alarm still fires at the deadline
    const [rec] = records(fired);
    expect(rec?.cause).toBe('prompt_timeout');
    expect(rec?.at).toBe(due);
    expect(rec?.input).toMatchObject({ kind: 'choice', option: request?.defaultOption });
    expect(request?.options[request.defaultOption]).toEqual({ kind: 'decline' });
    expect(core.snapshot().clocks).toMatchObject({
      white: FULL.initialMs - 2000 + FULL.incrementMs,
      black: FULL.initialMs - CHOICE_PROMPT_MS,
      running: 'black',
      at: due,
    });
    expect(problems).toEqual([]);
  });

  it('R-FMT-003 the prompt deadline is the flag when the chooser has less than 15 s', () => {
    const fen = '4k1r1/5p1p/6n1/8/8/3B4/8/4K3 b - - 0 1';
    const { core, problems } = start(
      init({ fen, black: { playerId: 'p2', name: 'Bo', level: 30, loadout: RIPOSTE } }),
    );
    join(core, T0);
    const think = FULL.initialMs - 5000;
    core.message('black', mv('g8h8'), T0 + think);
    const left = 5000 + FULL.incrementMs;
    const out = core.message('white', mv('d3g6'), T0 + think + 1000);
    const flag = T0 + think + 1000 + left;
    expect(msgs(out, 'black', 'prompt')[0]?.d.deadline).toBe(flag);
    expect(core.nextAlarm()).toBe(flag);
    const end = core.alarm(flag);
    expect(core.result).toEqual({ winner: 'white', reason: 'timeout' });
    expect(core.snapshot().clocks.black).toBe(0);
    expect(msgs(end, 'white', 'bend')[0]?.d.result).toEqual({ winner: 'white', reason: 'timeout' });
    expect(problems).toEqual([]);
  });

  it('R-FMT-003 flag fall is exact at the alarm time and clocks never go negative', () => {
    const { core, problems } = start();
    join(core, T0);
    core.message('white', mv('e2e4'), T0 + 1000);
    const flag = T0 + 1000 + FULL.initialMs; // Black's full clock from the moment its turn began
    expect(core.nextAlarm()).toBe(flag);
    expect(records(core.alarm(flag - 1))).toEqual([]);
    expect(core.clocksAt(flag - 1).black).toBe(1);
    expect(core.clocksAt(flag + 5000).black).toBe(0);
    const out = core.alarm(flag);
    expect(records(out)[0]).toMatchObject({ cause: 'flag', at: flag, input: { kind: 'timeout' } });
    expect(core.result).toEqual({ winner: 'white', reason: 'timeout' });
    expect(core.snapshot().clocks).toMatchObject({ black: 0, running: null });
    expect(core.nextAlarm()).toBeNull();
    const ended = out.effects.find((e) => e.kind === 'ended');
    expect(ended?.kind === 'ended' && ended.summary).toMatchObject({
      battleId: 'b-test-1',
      result: { winner: 'white', reason: 'timeout' },
      startedAt: T0,
      endedAt: flag,
      plies: 1,
    });
    // A move that arrives after the flag loses on time instead (checked on every input).
    const late = start();
    join(late.core, T0);
    const o = late.core.message('white', mv('e2e4'), T0 + FULL.initialMs);
    expect(late.core.result).toEqual({ winner: 'black', reason: 'timeout' });
    expect(msgs(o, 'white', 'err')[0]?.d.code).toBe('over');
    expect(problems).toEqual([]);
  });

  it('R-FMT-003 disconnect grace: the clock keeps running, reconnecting clears it, past grace the battle is lost', () => {
    const { core, problems } = start();
    join(core, T0);
    const d1 = core.disconnect('white', T0 + 1000);
    expect(msgs(d1, 'black', 'opp')[0]?.d).toEqual({
      connected: false,
      graceUntil: T0 + 1000 + DISCONNECT_GRACE_MS,
    });
    expect(core.nextAlarm()).toBe(T0 + 1000 + DISCONNECT_GRACE_MS);
    const back = core.connect('white', T0 + 30_000);
    expect(msgs(back, 'black', 'opp')[0]?.d).toEqual({ connected: true });
    const hello = core.message('white', frame('hello', { from: 0 }), T0 + 30_000);
    expect(msgs(hello, 'white', 'bstart')[0]?.d.clocks.white).toBe(FULL.initialMs - 30_000);
    expect(core.nextAlarm()).toBe(T0 + FULL.initialMs);
    core.disconnect('white', T0 + 40_000);
    const out = core.alarm(T0 + 40_000 + DISCONNECT_GRACE_MS);
    expect(core.result).toEqual({ winner: 'black', reason: 'abandon' });
    expect(records(out)[0]?.cause).toBe('grace');
    expect(msgs(out, 'black', 'bend')).toHaveLength(1);
    expect(msgs(out, 'white', 'bend')).toHaveLength(0); // white is away
    expect(problems).toEqual([]);
  });

  it('R-FMT-003 a seat that never connects abandons when the grace ends', () => {
    const { core } = start();
    core.connect('white', T0 + 100);
    core.message('white', frame('hello', { from: 0 }), T0 + 100);
    core.message('white', mv('d2d4'), T0 + 200);
    expect(core.nextAlarm()).toBe(T0 + DISCONNECT_GRACE_MS);
    core.alarm(T0 + DISCONNECT_GRACE_MS);
    expect(core.result).toEqual({ winner: 'white', reason: 'abandon' });
  });
});

describe('BattleCore conduct (R-FMT-003 9.2)', () => {
  it('R-FMT-003 resign, sync and draw offers: one per 10 moves, lapsing at the next action', () => {
    const { core, problems } = start();
    join(core, T0);
    const sync = core.message('white', frame('sync', { t: 42.5 }), T0 + 700);
    expect(msgs(sync, 'white', 'clock')[0]?.d).toEqual({
      clocks: {
        white: FULL.initialMs - 700,
        black: FULL.initialMs,
        running: 'white',
        at: T0 + 700,
        inc: FULL.incrementMs,
      },
      echo: 42.5,
      now: T0 + 700,
    });
    const offer = core.message('white', frame('draw', {}), T0 + 1000);
    expect(msgs(offer, 'black', 'drawOffer')[0]?.d).toEqual({ by: 'white' });
    expect(msgs(offer, 'white', 'drawOffer')[0]?.d).toEqual({ by: 'white' });
    expect(
      msgs(core.message('white', frame('draw', {}), T0 + 1100), 'white', 'err')[0]?.d.code,
    ).toBe('draw_limit');
    core.message('black', frame('drawReply', { accept: false }), T0 + 1200);
    expect(core.snapshot().draw.offer).toBeNull();
    expect(
      msgs(core.message('white', frame('draw', {}), T0 + 1300), 'white', 'err')[0]?.d.code,
    ).toBe('draw_limit');
    // Black offers; the offer lapses when White moves.
    core.message('black', frame('draw', {}), T0 + 1400);
    core.message('white', mv('e2e4'), T0 + 1500);
    expect(core.snapshot().draw.offer).toBeNull();
    expect(
      msgs(
        core.message('white', frame('drawReply', { accept: true }), T0 + 1600),
        'white',
        'err',
      )[0]?.d.code,
    ).toBe('illegal');
    // Knight dance to ply 20 without a threefold repetition; then White may offer again.
    const dance =
      'g8f6 b1c3 b8c6 f3g5 f6g4 c3b5 c6b4 g5f3 g4f6 b5c3 b4c6 f3g1 f6g8 c3b1 c6b8 g1f3 g8f6'.split(
        ' ',
      );
    core.message('black', mv('e7e5'), T0 + 1700);
    core.message('white', mv('g1f3'), T0 + 1800);
    let t = T0 + 2000;
    for (const m of dance) core.message(core.fullState().turn, mv(m), (t += 100));
    expect(core.fullState().ply).toBe(20);
    expect(core.fullState().turn).toBe('white');
    const again = core.message('white', frame('draw', {}), (t += 100));
    expect(msgs(again, 'black', 'drawOffer')).toHaveLength(1);
    const agreed = core.message('black', frame('drawReply', { accept: true }), (t += 100));
    expect(core.result).toEqual({ winner: null, reason: 'agreement' });
    expect(msgs(agreed, 'white', 'bend')[0]?.d.result).toEqual({
      winner: null,
      reason: 'agreement',
    });
    expect(
      msgs(core.message('white', frame('resign', {}), t + 100), 'white', 'err')[0]?.d.code,
    ).toBe('over');
    expect(problems).toEqual([]);
  });

  it('R-FMT-003 crossing draw offers agree; resign ends the battle for either side at any time', () => {
    const a = start();
    join(a.core, T0);
    a.core.message('white', frame('draw', {}), T0 + 10);
    a.core.message('black', frame('draw', {}), T0 + 20);
    expect(a.core.result).toEqual({ winner: null, reason: 'agreement' });
    const b = start();
    join(b.core, T0);
    const out = b.core.message('black', frame('resign', {}), T0 + 10);
    expect(b.core.result).toEqual({ winner: 'white', reason: 'resign' });
    expect(out.effects.map((e) => e.kind)).toEqual(['persist', 'ended']);
    expect(b.core.nextAlarm()).toBeNull();
  });
});

describe('BattleCore rate limits (R-SEC-005)', () => {
  it('R-SEC-005 excess and invalid messages are dropped and counted; err is sent once; repeat offenders are closed', () => {
    const { core } = start();
    join(core, T0);
    const t = T0 + 5000; // the bucket is full again
    let clocks = 0;
    let errs = 0;
    for (let k = 0; k < 30; k++) {
      const out = core.message('white', frame('sync', { t: k }), t);
      clocks += msgs(out, 'white', 'clock').length;
      errs += msgs(out, 'white', 'err').length;
    }
    expect(clocks).toBe(LIMITS.battle.burst);
    expect(errs).toBe(1);
    expect(core.snapshot().stats.white.rateLimited).toBe(30 - LIMITS.battle.burst);
    // One second refills five tokens; an accepted message clears the strikes.
    core.message('white', frame('sync', { t: 0 }), t + 1000);
    expect(core.snapshot().buckets.white.strikes).toBe(0);
    // Invalid frames: not JSON, unknown type, bad data, oversized. Each is a strike.
    const junk = [
      'nope',
      '{"t":"zz"}',
      frame('mv', { move: 'e2e9' }),
      frame('sync', { t: 'x'.repeat(5000) }),
    ];
    let closed = 0;
    let badErrs = 0;
    for (let k = 0; k < MAX_STRIKES; k++) {
      const out = core.message('white', junk[k % junk.length] as string, t + 60_000 + k * 1000);
      closed += out.effects.filter((e) => e.kind === 'close').length;
      badErrs += msgs(out, 'white', 'err').length;
    }
    expect(core.snapshot().stats.white.invalid).toBe(MAX_STRIKES);
    expect(badErrs).toBe(1);
    expect(closed).toBe(1);
    const last = core.message('white', 'nope', t + 200_000);
    expect(last.effects).toContainEqual(
      expect.objectContaining({ kind: 'close', side: 'white', code: 1008 }),
    );
    // Nothing reached the game.
    expect(core.fullState().ply).toBe(0);
  });
});

describe('BattleCore persistence (R-NET-001 reconnect)', () => {
  function roundTrip(core: BattleCore, opts: CoreOptions = {}): BattleCore {
    const snap = JSON.parse(JSON.stringify(core.snapshot())) as BattleSnapshot;
    const log = JSON.parse(JSON.stringify(core.log())) as LogRecord[];
    return BattleCore.restore(snap, log, opts);
  }

  it('R-NET-001 snapshot and restore while a prompt is pending continue identically', () => {
    const i = init({
      fen: E6_FEN,
      black: { playerId: 'p2', name: 'Bo', level: 30, loadout: RIPOSTE },
    });
    const a = start(i).core;
    join(a, T0);
    const out = a.message('white', mv('d3g6'), T0 + 1000);
    const promptId = msgs(out, 'black', 'prompt')[0]?.d.promptId;
    expect(a.fullState().pending).not.toBeNull();
    const b = roundTrip(a);
    expect(b.nextAlarm()).toBe(a.nextAlarm());
    const inputs: [Side, string, number][] = [
      ['black', frame('hello', { from: 3 }), T0 + 2000],
      ['white', frame('sync', { t: 1 }), T0 + 2500],
      ['black', frame('ch', { promptId, option: 1 }), T0 + 4000],
      ['white', frame('hello', { from: 0 }), T0 + 4100],
    ];
    for (const [side, raw, t] of inputs) {
      expect(JSON.stringify(b.message(side, raw, t))).toBe(JSON.stringify(a.message(side, raw, t)));
    }
    const legal = a.fullState().turn;
    const next = engine.legalMoves(a.fullState(), legal)[0];
    expect(next).toBeDefined();
    const uci = moveToUci(next ?? { from: 0, to: 0 });
    expect(JSON.stringify(b.message(legal, mv(uci), T0 + 5000))).toBe(
      JSON.stringify(a.message(legal, mv(uci), T0 + 5000)),
    );
    expect(JSON.stringify(b.alarm(T0 + 900_000))).toBe(JSON.stringify(a.alarm(T0 + 900_000)));
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.log()).toEqual(a.log());
  });

  it('R-NET-001 restore refuses a log that does not match the snapshot', () => {
    const { core } = start();
    join(core, T0);
    core.message('white', mv('e2e4'), T0 + 10);
    const snap = core.snapshot();
    expect(() => BattleCore.restore(snap, core.log().slice(0, 1))).toThrow(/records/);
    const bad = core.log().map((r) => ({ ...r, from: r.from + 1 }));
    expect(() => BattleCore.restore(snap, bad)).toThrow(/order/);
  });

  it('R-NET-001 the reconnect replay equals the live stream for that side (R-INFO-005)', () => {
    const i = init({
      fen: E6_FEN,
      black: { playerId: 'p2', name: 'Bo', level: 30, loadout: RIPOSTE },
    });
    const { core, problems } = start(i);
    join(core, T0);
    const live: Record<Side, BattleEvent[]> = { white: [], black: [] };
    const collect = (out: Outbox) => {
      for (const o of out.send)
        if (o.msg.t === 'bev') live[o.to].push(...(o.msg.d.events as unknown as BattleEvent[]));
    };
    const first = core.message('white', mv('d3g6'), T0 + 1000);
    collect(first);
    const promptId = msgs(first, 'black', 'prompt')[0]?.d.promptId;
    collect(core.message('black', frame('ch', { promptId, option: 1 }), T0 + 2000));
    collect(core.message('white', mv('e1d2'), T0 + 3000));
    for (const side of ['white', 'black'] as const) {
      for (const from of [0, 1, 3, core.snapshot().events]) {
        const out = core.message(side, frame('hello', { from }), T0 + 4000 + from);
        const replay = msgs(out, side, 'bev')[0];
        expect(replay?.d.from).toBe(from);
        expect(replay?.d.to).toBe(core.snapshot().events);
        const expected = (from === 0 ? core.log().flatMap((r) => r.seen[side]) : live[side]).filter(
          (e) => e.i >= from,
        );
        expect(replay?.d.events).toEqual(expected);
      }
    }
    // Hidden information stays hidden in the replay: White never learns Black's ChoiceMade.
    const whiteKinds = core
      .log()
      .flatMap((r) => r.seen.white)
      .map((e) => e.k);
    expect(whiteKinds).not.toContain('ChoiceMade');
    expect(
      core
        .log()
        .flatMap((r) => r.seen.black)
        .map((e) => e.k),
    ).toContain('ChoiceMade');
    expect(problems).toEqual([]);
  });

  it('R-NET-001 a hello past the end is clamped; a finished battle answers bend after the replay', () => {
    const { core } = start();
    join(core, T0);
    core.message('white', frame('resign', {}), T0 + 10);
    const out = core.message('black', frame('hello', { from: 999_999 }), T0 + 20);
    expect(out.send.map((o) => o.msg.t)).toEqual(['bstart', 'bev', 'opp', 'bend']);
    const bev = msgs(out, 'black', 'bev')[0];
    expect(bev?.d.from).toBe(core.snapshot().events);
    expect(bev?.d.events).toEqual([]);
  });

  it('R-NET-001 the event log is contiguous: record events carry i = from + k', () => {
    const { core } = start(
      init({ fen: E6_FEN, black: { playerId: 'p2', name: 'Bo', level: 30, loadout: RIPOSTE } }),
    );
    join(core, T0);
    core.message('white', mv('d3g6'), T0 + 1000);
    core.alarm(T0 + 1000 + CHOICE_PROMPT_MS);
    for (const r of core.log()) r.events.forEach((e, k) => expect(e.i).toBe(r.from + k));
    const state: GameState = core.fullState();
    expect(core.snapshot().events).toBe(state.eventSeq);
  });
});
