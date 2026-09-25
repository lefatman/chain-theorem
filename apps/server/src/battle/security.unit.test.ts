/**
 * R-SEC-001 through the battle core (15, 17.1): seeded random battles with random legal loadouts,
 * two random clients that act only on what they were sent (legal moves from their projection,
 * random prompt answers), random disconnects and reconnects with `hello` at random indexes, draw
 * offers, resignations, garbage frames, floods, out-of-turn and forged input, and time jumps that
 * fire the flag, prompt and grace deadlines through the alarm.
 *
 * Every outgoing message is serialized and scanned for its recipient (`checkMessage`: scanPayload
 * on the message, its projection, events and prompt request; viewer and chooser; protocol schema).
 * A twin core fed the same inputs, and restored from a JSON snapshot at random moments, must produce
 * byte-identical output (snapshot/restore continues identically, also while a prompt is pending).
 */
import { describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import { unrevealedIds } from '@chain-theorem/content/scan';
import { MAX_STRIKES } from '@chain-theorem/protocol';
import type { FormatId, PublicState, Side } from '@chain-theorem/rules';
import { BattleCore, type CoreOptions } from './core.ts';
import { searchPolicy } from './npc.ts';
import { Rng, checkMessage, frame, randomLoadout } from './testing.ts';
import type { BattleInit, BattleSnapshot, LogRecord, Outbox, SeatInit, Tier } from './types.ts';

const T0 = 1_750_000_000_000;
const FORMATS: FormatId[] = ['first_blood', 'vanguard', 'full'];
const TIERS: Tier[] = ['wild', 'trainer', 'elite'];
/** Cheap NPC budgets: this sweep is about information flow, not play strength. */
const cheapNpc = searchPolicy(engine, { wild: 300, trainer: 300, elite: 300 });

interface Client {
  side: Side;
  connected: boolean;
  /** `hello` sent on this connection and its replay `bev` not yet seen (the `from` asked). */
  awaitingReplay: number | null;
  started: boolean;
  to: number;
  pub: PublicState | null;
  prompt: { promptId: string; options: number } | null;
  oldPrompts: string[];
  drawOfferBy: Side | null;
  /** Every projected event received, by full-log index, as JSON. */
  known: Map<number, string>;
}

interface Coverage {
  battles: number;
  results: Record<string, number>;
  moves: number;
  prompts: number;
  answered: number;
  promptTimeouts: number;
  reconnects: number;
  replayedEvents: number;
  rejected: number;
  rateLimited: number;
  invalid: number;
  closes: number;
  restores: number;
  messages: number;
  /** Messages scanned while the recipient's opponent still had unrevealed ids. */
  withSecrets: number;
}

const newClient = (side: Side): Client => ({
  side,
  connected: false,
  awaitingReplay: null,
  started: false,
  to: 0,
  pub: null,
  prompt: null,
  oldPrompts: [],
  drawOfferBy: null,
  known: new Map(),
});

function roundTrip(core: BattleCore, opts: CoreOptions): BattleCore {
  const snap = JSON.parse(JSON.stringify(core.snapshot())) as BattleSnapshot;
  const log = JSON.parse(JSON.stringify(core.log())) as LogRecord[];
  return BattleCore.restore(snap, log, opts);
}

function fuzzBattle(seed: number, cov: Coverage, npcSide: Side | null, maxSteps: number): void {
  const rng = new Rng(seed);
  const format = rng.pick(FORMATS);
  const seat = (side: Side): SeatInit => {
    const level = 1 + rng.int(engine.caps.LEVEL_CAP);
    const loadout = randomLoadout(engine, rng, level);
    return side === npcSide
      ? { tier: rng.pick(TIERS), name: 'Wild Thing', level, loadout }
      : { playerId: `p-${side}-${seed}`, name: side === 'white' ? 'Ada' : 'Bo', level, loadout };
  };
  const init: BattleInit = {
    battleId: `fuzz-${seed}`,
    format,
    white: seat('white'),
    black: seat('black'),
  };
  const problems: string[] = [];
  const opts: CoreOptions = {
    npc: cheapNpc,
    observe: (to, msg, state) => {
      cov.messages++;
      const hidden = unrevealedIds(state, to);
      if (hidden.abilities.size + hidden.items.size > 0) cov.withSecrets++;
      const p = checkMessage(to, msg, state);
      if (p) problems.push(`seed ${seed}: ${p}`);
    },
  };
  const twinOpts: CoreOptions = { npc: cheapNpc };
  let now = T0 + seed * 7919;
  const created = BattleCore.create(init, now, opts);
  const core = created.core;
  let twin = BattleCore.create(init, now, twinOpts).core;
  const humans = (['white', 'black'] as const).filter((s) => s !== npcSide);
  const clients: Record<Side, Client> = { white: newClient('white'), black: newClient('black') };
  let ended = false;

  const receive = (c: Client, out: Outbox): void => {
    for (const { to, msg } of out.send) {
      if (to !== c.side) continue;
      expect(c.connected, `seed ${seed}: message to a closed socket`).toBe(true);
      switch (msg.t) {
        case 'bstart':
          expect(c.awaitingReplay).not.toBeNull();
          c.started = true;
          c.pub = msg.d.public as unknown as PublicState;
          break;
        case 'bev': {
          expect(c.started).toBe(true);
          const events = msg.d.events as { i: number }[];
          if (c.awaitingReplay !== null) {
            // Reconnect replay: every event this side already had from `from` on comes back
            // identical (R-NET-001; the replay equals the live stream).
            expect(msg.d.from).toBe(Math.min(c.awaitingReplay, core.snapshot().events));
            const got = new Map(events.map((e) => [e.i, JSON.stringify(e)]));
            for (const [i, json] of c.known)
              if (i >= msg.d.from && i < msg.d.to)
                expect(got.get(i), `seed ${seed} event ${i}`).toBe(json);
            cov.replayedEvents += events.length;
            c.awaitingReplay = null;
          } else {
            expect(msg.d.from, `seed ${seed}: gap in the live stream`).toBe(c.to);
          }
          for (const e of events) {
            expect(e.i).toBeGreaterThanOrEqual(msg.d.from);
            expect(e.i).toBeLessThan(msg.d.to);
            const json = JSON.stringify(e);
            const had = c.known.get(e.i);
            if (had !== undefined) expect(json).toBe(had);
            c.known.set(e.i, json);
          }
          c.to = msg.d.to;
          c.pub = msg.d.public as unknown as PublicState;
          if (c.pub.pending?.chooser !== c.side) c.prompt = null;
          // Any action lapses an open draw offer (9.2).
          if (events.length > 0) c.drawOfferBy = null;
          break;
        }
        case 'prompt':
          expect(c.pub?.pending?.chooser).toBe(c.side);
          if (c.prompt && c.prompt.promptId !== msg.d.promptId)
            c.oldPrompts.push(c.prompt.promptId);
          c.prompt = {
            promptId: msg.d.promptId,
            options: (msg.d.request as { options: unknown[] }).options.length,
          };
          // The deadline lies after the core's current time (an alarm runs at its due time).
          expect(msg.d.deadline).toBeGreaterThan(core.snapshot().now);
          cov.prompts++;
          break;
        case 'drawOffer':
          c.drawOfferBy = msg.d.by;
          break;
        default:
          break;
      }
    }
  };

  /** Feed one input to the core and its twin; outputs must match byte for byte. */
  const call = (label: string, fn: (b: BattleCore) => Outbox): Outbox => {
    const out = fn(core);
    const other = fn(twin);
    expect(JSON.stringify(other), `seed ${seed}: twin differs after ${label}`).toBe(
      JSON.stringify(out),
    );
    for (const side of humans) receive(clients[side], out);
    for (const e of out.effects) {
      if (e.kind === 'error') problems.push(`seed ${seed}: core error ${e.message}`);
      if (e.kind === 'close') {
        cov.closes++;
        // The host closes the socket, then reports the disconnect.
        if (clients[e.side].connected) disconnect(e.side);
      }
      if (e.kind === 'ended') {
        expect(ended).toBe(false);
        ended = true;
        expect(e.summary.result).toEqual(core.result);
        const r = core.result;
        cov.results[r ? `${r.winner ?? 'draw'}:${r.reason}` : '?'] =
          (cov.results[r ? `${r.winner ?? 'draw'}:${r.reason}` : '?'] ?? 0) + 1;
      }
      if (e.kind === 'persist' && e.record.cause === 'prompt_timeout') cov.promptTimeouts++;
    }
    // Clocks never go negative; every deadline up to now has fired.
    const snap = core.snapshot();
    expect(snap.clocks.white).toBeGreaterThanOrEqual(0);
    expect(snap.clocks.black).toBeGreaterThanOrEqual(0);
    const next = core.nextAlarm();
    if (core.result) expect(next).toBeNull();
    else expect(next === null || next > snap.now).toBe(true);
    return out;
  };

  const send = (side: Side, raw: string, label: string) =>
    call(`${label} ${side}`, (b) => b.message(side, raw, now));

  function disconnect(side: Side): void {
    clients[side].connected = false;
    clients[side].awaitingReplay = null;
    call(`disconnect ${side}`, (b) => b.disconnect(side, now));
  }

  const reconnect = (side: Side): void => {
    const c = clients[side];
    c.connected = true;
    c.started = false;
    c.drawOfferBy = null;
    call(`connect ${side}`, (b) => b.connect(side, now));
    const from = rng.chance(0.3) ? c.to : rng.int(c.to + 1);
    c.awaitingReplay = from;
    cov.reconnects++;
    send(side, frame('hello', { from }), 'hello');
  };

  /**
   * Input that must be refused: err to the sender (or a silent rate-limit drop), no state or log
   * change (R-SEC-002).
   */
  const forged = (side: Side, raw: string): void => {
    const state = JSON.stringify(core.fullState());
    const n = core.log().length;
    const limited = core.snapshot().stats[side].rateLimited;
    const out = send(side, raw, 'forged');
    expect(out.effects.filter((e) => e.kind === 'persist')).toEqual([]);
    const errs = out.send.filter((o) => o.to === side && o.msg.t === 'err').length;
    expect(errs === 1 || core.snapshot().stats[side].rateLimited === limited + 1).toBe(true);
    expect(JSON.stringify(core.fullState())).toBe(state);
    expect(core.log()).toHaveLength(n);
    cov.rejected++;
  };

  for (const side of humans) reconnect(side);
  // Half the battles have a slow thinker, so flags fall too.
  const slow: Side | null = rng.chance(0.5) ? rng.pick(humans) : null;

  for (let step = 0; step < maxSteps && !core.result; step++) {
    now += rng.chance(0.08) ? rng.int(40_000) : rng.int(2_000);
    const st = core.fullState();
    if (slow && (st.pending ? st.pending.request.chooser : st.turn) === slow)
      now += rng.int(45_000);
    // Fire due deadlines through the alarm, exactly at their time.
    const due = core.nextAlarm();
    if (due !== null && due <= now) {
      const out = call('alarm', (b) => b.alarm(due));
      const at = out.effects.flatMap((e) => (e.kind === 'persist' ? [e.record.at] : []));
      expect(at[0], `seed ${seed}: the alarm fired at its deadline`).toBe(due);
      continue;
    }
    if (rng.chance(0.03)) {
      twin = roundTrip(twin, twinOpts);
      cov.restores++;
    }
    const live = humans.filter((s) => clients[s].connected);
    const away = humans.filter((s) => !clients[s].connected);
    const r = rng.next();
    if (away.length > 0 && rng.chance(0.15)) {
      reconnect(rng.pick(away));
    } else if (r < 0.03 && live.length > 0) {
      disconnect(rng.pick(live));
    } else if (r < 0.05 && live.length > 0) {
      const junk = [
        '',
        'x',
        '{"t":"mv"}',
        frame('ch', { promptId: 'a', option: -1 }),
        frame('zz', {}),
      ];
      send(rng.pick(live), rng.pick(junk), 'junk');
    } else if (r < 0.09 && live.length > 0) {
      const side = rng.pick(live);
      const c = clients[side];
      const st = core.fullState();
      const opp = side === 'white' ? 'black' : 'white';
      const pend = st.pending;
      if (pend && pend.request.chooser === opp && clients[opp].prompt) {
        // A foreign prompt id.
        forged(side, frame('ch', { promptId: pend.request.promptId, option: 0 }));
      } else if (c.oldPrompts.length > 0) {
        const stale = rng.pick(c.oldPrompts); // a replayed, already answered prompt
        if (pend?.request.promptId !== stale)
          forged(side, frame('ch', { promptId: stale, option: 0 }));
      } else if (!st.result && (st.turn !== side || pend)) {
        forged(side, frame('mv', { move: 'e2e4' })); // out of turn
      } else if (!st.result && !pend) {
        forged(side, frame('mv', { move: 'a1a1' })); // illegal
      }
    } else if (r < 0.1 && live.length > 0) {
      send(rng.pick(live), frame('draw', {}), 'draw');
    } else if (r < 0.102 && live.length > 0) {
      send(rng.pick(live), frame('resign', {}), 'resign');
    } else if (r < 0.12 && live.length > 0) {
      send(rng.pick(live), frame('sync', { t: now }), 'sync');
    } else if (r < 0.125 && live.length > 0) {
      const side = rng.pick(live);
      const before = core.snapshot().stats[side].rateLimited;
      for (let k = 0; k < 14; k++) send(side, frame('sync', { t: k }), 'flood');
      expect(core.snapshot().stats[side].rateLimited).toBeGreaterThan(before);
    } else {
      // The acting client plays from what it was sent.
      for (const side of live) {
        const c = clients[side];
        if (!c.started || !c.pub || c.pub.result) continue;
        const opp = side === 'white' ? 'black' : 'white';
        if (c.drawOfferBy === opp && rng.chance(0.3)) {
          send(side, frame('drawReply', { accept: rng.chance(0.15) }), 'drawReply');
          c.drawOfferBy = null;
          continue;
        }
        if (c.prompt) {
          if (rng.chance(0.9)) {
            send(
              side,
              frame('ch', { promptId: c.prompt.promptId, option: rng.int(c.prompt.options) }),
              'ch',
            );
            cov.answered++;
          }
          continue;
        }
        if (c.pub.turn === side && !c.pub.pending && c.pub.legal.length > 0) {
          const legal = c.pub.legal;
          const captures = legal.filter((u) => (c.pub?.board[squareOf(u.slice(2, 4))] ?? -1) >= 0);
          const move =
            captures.length > 0 && rng.chance(0.5) ? rng.pick(captures) : rng.pick(legal);
          // Sometimes with pre-supplied answers for own Capturing prompts (DD-39), often invalid.
          const choices = rng.chance(0.1)
            ? [
                rng.pick([
                  { kind: 'decline' },
                  { kind: 'square', square: rng.int(64) },
                  { kind: 'piece', piece: rng.int(32), square: rng.int(64) },
                ]),
              ]
            : undefined;
          send(side, frame('mv', choices ? { move, choices } : { move }), 'mv');
          cov.moves++;
        }
      }
    }
  }
  // Finish unfinished battles, then every human reconnects and replays the whole log.
  if (!core.result) {
    const side = humans[0] as Side;
    if (!clients[side].connected) reconnect(side);
    send(side, frame('resign', {}), 'final resign');
  }
  expect(core.result).not.toBeNull();
  expect(ended).toBe(true);
  for (const side of humans) {
    const c = clients[side];
    if (c.connected) disconnect(side);
    c.connected = true;
    c.started = false;
    call('final connect', (b) => b.connect(side, now));
    c.awaitingReplay = 0;
    const out = send(side, frame('hello', { from: 0 }), 'final hello');
    // Everything this side ever received is exactly the full replay (nothing extra, nothing lost).
    const replay = out.send.find((o) => o.to === side && o.msg.t === 'bev')?.msg;
    const events = replay?.t === 'bev' ? (replay.d.events as { i: number }[]) : [];
    expect(events.map((e) => e.i)).toEqual([...c.known.keys()].sort((a, b) => a - b));
    expect(out.send.at(-1)?.msg.t).toBe('bend');
  }
  // Bounded strike streaks never closed a well-behaved client.
  for (const side of humans) {
    const st = core.snapshot().stats[side];
    cov.rateLimited += st.rateLimited;
    cov.invalid += st.invalid;
    expect(core.snapshot().buckets[side].strikes).toBeLessThan(MAX_STRIKES);
  }
  expect(problems).toEqual([]);
  expect(twin.snapshot()).toEqual(core.snapshot());
  cov.battles++;
}

function squareOf(name: string): number {
  return name.charCodeAt(0) - 97 + (Number(name[1]) - 1) * 8;
}

const emptyCoverage = (): Coverage => ({
  battles: 0,
  results: {},
  moves: 0,
  prompts: 0,
  answered: 0,
  promptTimeouts: 0,
  reconnects: 0,
  replayedEvents: 0,
  rejected: 0,
  rateLimited: 0,
  invalid: 0,
  closes: 0,
  restores: 0,
  messages: 0,
  withSecrets: 0,
});

describe('BattleCore information flow under random play (R-SEC-001)', () => {
  const total = emptyCoverage();

  it('R-SEC-001 R-INFO-005 R-SEC-002 R-SEC-005 random human battles: no message leaks, replay equals live, twin restored from snapshots matches', () => {
    for (let seed = 1; seed <= 40; seed++) fuzzBattle(seed, total, null, 260);
  });

  it('R-SEC-001 R-FMT-005 random battles against NPC seats', () => {
    for (let seed = 101; seed <= 108; seed++)
      fuzzBattle(seed, total, seed % 2 ? 'black' : 'white', 160);
  });

  it('R-SEC-001 R-FMT-003 R-NET-001 the sweep covers prompts, timeouts, reconnects, conduct and limits', () => {
    const reasons = Object.keys(total.results).map((k) => k.split(':')[1]);
    console.log(`battle core sweep: ${JSON.stringify(total)}`);
    expect(total.battles).toBe(48);
    expect(total.withSecrets).toBeGreaterThan(total.messages / 2);
    expect(total.prompts).toBeGreaterThan(5);
    expect(total.answered).toBeGreaterThan(3);
    expect(total.reconnects).toBeGreaterThan(40);
    expect(total.replayedEvents).toBeGreaterThan(100);
    expect(total.rejected).toBeGreaterThan(20);
    expect(total.rateLimited).toBeGreaterThan(0);
    expect(total.invalid).toBeGreaterThan(0);
    expect(total.restores).toBeGreaterThan(10);
    for (const reason of ['timeout', 'abandon', 'resign']) expect(reasons).toContain(reason);
  });
});

describe('the R-SEC-001 message check itself', () => {
  it('R-SEC-001 flags a message built from the wrong projection or raw events', () => {
    const level = 30;
    const { state, events } = engine.newBattle({
      format: 'full',
      white: { level, loadout: { elements: ['ember'], items: [], sets: [['momentum']] } },
      black: { level, loadout: { elements: ['grove'], items: [], sets: [['poisoned_meat']] } },
      strict: true,
    });
    const clocks = { white: 1, black: 1, running: null, at: 0, inc: 0 };
    const bev = (pub: object, evs: object[]) =>
      ({
        t: 'bev',
        d: { from: 0, to: evs.length, events: evs, public: pub, clocks },
      }) as never;
    const own = engine.project(state, 'white');
    expect(
      checkMessage('white', bev(own, engine.projectEvents(state, events, 'white')), state),
    ).toBeNull();
    // Black's own projection sent to White names Poisoned Meat.
    expect(checkMessage('white', bev(engine.project(state, 'black'), []), state)).toMatch(
      /poisoned_meat/,
    );
    // Full (unprojected) state in a payload.
    expect(checkMessage('white', bev({ ...own, leak: state.armies.black }, []), state)).toMatch(
      /poisoned_meat/,
    );
  });
});
