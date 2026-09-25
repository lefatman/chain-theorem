/**
 * Step-through replay (11.2, R-ART-002): rebuilding each step's board from the live projection and
 * the projected log must reproduce the engine's own projection at every point it can be observed
 * (after each action and at each mid-action prompt).
 */
import { describe, expect, it } from 'vitest';
import { engine } from '@chain-theorem/content';
import {
  type ActionInput,
  type ApplyResult,
  type BattleEvent,
  type GameState,
  type Loadout,
  type PublicState,
  moveToUci,
  uciToMove,
} from '@chain-theorem/rules';
import type { LogEntry } from '../battle/controller.ts';
import { frameAt, groupActions, navigate } from './replay.ts';

interface Checkpoint {
  at: number;
  pub: PublicState;
  settled: boolean;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function toLog(state: GameState, events: BattleEvent[]): LogEntry[] {
  return engine
    .projectEvents(state, events, 'white')
    .map((event) => ({ i: event.i, ply: 0, depth: event.depth, event, text: '' }));
}

function burns(pub: PublicState): string {
  const hf = pub.slices.hot_foot as { burning?: { sq: number; turns: number }[] } | undefined;
  return JSON.stringify([...(hf?.burning ?? [])].sort((a, b) => a.sq - b.sq));
}

function expectFrame(frame: PublicState | null, cp: Checkpoint): void {
  expect(frame).not.toBeNull();
  if (!frame) return;
  expect(frame.board).toEqual(cp.pub.board);
  expect(frame.pieces.map((p) => [p.square, p.type, p.element])).toEqual(
    cp.pub.pieces.map((p) => [p.square, p.type, p.element]),
  );
  expect(burns(frame)).toEqual(burns(cp.pub));
  expect(frame.turn).toEqual(cp.pub.turn);
  expect(frame.result).toEqual(cp.pub.result);
  expect(frame.eventSeq).toEqual(cp.pub.eventSeq);
  if (cp.settled) expect(frame.inCheck).toEqual(cp.pub.inCheck);
}

class Driver {
  state: GameState;
  events: BattleEvent[];
  checkpoints: Checkpoint[] = [];

  constructor(white: Loadout, black: Loadout, fen?: string) {
    const r = engine.newBattle({
      format: 'full',
      white: { level: 30, loadout: white },
      black: { level: 30, loadout: black },
      ...(fen ? { fen } : {}),
    });
    this.state = r.state;
    this.events = [...r.events];
    this.mark(true);
  }

  private mark(settled: boolean): void {
    const last = this.events[this.events.length - 1];
    this.checkpoints.push({
      at: last ? last.i : -1,
      pub: engine.project(this.state, 'white'),
      settled,
    });
  }

  apply(input: ActionInput): ApplyResult {
    const r = engine.applyAction(this.state, input);
    this.state = r.state;
    this.events.push(...r.events);
    this.mark(r.kind === 'done');
    return r;
  }

  move(uci: string, pick: (n: number) => number = () => 0): void {
    let r = this.apply({ kind: 'move', side: this.state.turn, move: uciToMove(uci) });
    while (r.kind === 'needsChoice') {
      const req = r.request;
      r = this.apply({
        kind: 'choice',
        side: req.chooser,
        promptId: req.promptId,
        option: pick(req.options.length),
      });
    }
  }

  verify(): number {
    const live = engine.project(this.state, 'white');
    const log = toLog(this.state, this.events);
    for (const cp of this.checkpoints) expectFrame(frameAt(live, log, cp.at), cp);
    return this.checkpoints.length;
  }
}

const EMBER_GROVE: Loadout = {
  elements: ['ember', 'grove'],
  items: ['headmaster_ring'],
  sets: [['hit_and_run', 'rebirth', 'cleave', 'momentum', 'poisoned_meat']],
};
const TIDE_EMBER: Loadout = {
  elements: ['tide', 'ember'],
  items: ['headmaster_ring'],
  sets: [['backdraft', 'reinforce', 'riposte', 'hit_and_run', 'scout']],
};

describe('step-through replay frames (R-ART-002)', () => {
  it('R-ART-002 castling, en passant and promotion rewind to the exact boards', () => {
    const plain: Loadout = { elements: ['ember', 'grove'], items: [], sets: [[]] };
    const d = new Driver(plain, plain, 'r3k2r/1P6/8/3pP3/8/8/8/R3K2R w KQkq d6 0 1');
    for (const uci of ['e5d6', 'e8g8', 'b7a8q', 'f8a8', 'e1c1', 'a8a2', 'd6d7', 'a2a3', 'd7d8n'])
      d.move(uci);
    expect(d.verify()).toBeGreaterThan(9);
  });

  it('R-ART-002 random ability battles rewind to every observed position', () => {
    let checked = 0;
    const kinds = new Set<string>();
    for (const seed of [1, 7, 42, 99, 2024, 31337]) {
      const rand = rng(seed);
      const d = new Driver(
        seed % 2 ? EMBER_GROVE : TIDE_EMBER,
        seed % 2 ? TIDE_EMBER : EMBER_GROVE,
      );
      for (let ply = 0; ply < 140 && !d.state.result; ply++) {
        const legal = engine.legalMoves(d.state, d.state.turn);
        const m = legal[Math.floor(rand() * legal.length)];
        if (!m) break;
        d.move(moveToUci(m), (n) => Math.floor(rand() * n));
      }
      checked += d.verify();
      for (const e of d.events) kinds.add(e.k === 'Captured' ? `Captured:${e.by}` : e.k);
    }
    expect(checked).toBeGreaterThan(200);
    // The games must exercise every board-changing event the rewind handles.
    for (const k of [
      'Captured:effect',
      'PieceMoved',
      'PieceRevived',
      'SquareIgnited',
      'SquareExtinguished',
      'Promoted',
    ])
      expect(kinds, k).toContain(k);
  });

  it('R-ART-002 a log that does not match the board yields null instead of a wrong frame', () => {
    const d = new Driver(EMBER_GROVE, TIDE_EMBER);
    d.move('e2e4');
    const live = engine.project(d.state, 'white');
    const log = toLog(d.state, d.events);
    const broken = log.map((e) =>
      e.event.k === 'MoveMade' ? { ...e, event: { ...e.event, to: 36 + 8 } } : e,
    );
    expect(frameAt(live, broken, -1)).toBeNull();
  });

  it('R-ART-002 groups the log into battle start, one group per action, and the result', () => {
    const d = new Driver(EMBER_GROVE, TIDE_EMBER);
    d.move('e2e4');
    d.move('e7e5');
    d.apply({ kind: 'resign', side: 'white' });
    const groups = groupActions(toLog(d.state, d.events).map((e) => ({ ...e, text: e.event.k })));
    expect(groups.map((g) => g.title)).toEqual([
      'Battle start',
      'ActionStarted',
      'ActionStarted',
      'Result',
    ]);
    expect(groups.every((g) => g.steps.every((s) => s.event.k !== 'TurnPassed'))).toBe(true);
  });
});

describe('replay navigation (R-ART-002)', () => {
  const entry = (i: number, k: 'ActionStarted' | 'MoveMade' | 'Check'): LogEntry =>
    ({ i, ply: 0, depth: 0, text: k, event: { k } as BattleEvent }) as LogEntry;
  // Two actions: [0 start, 1 move, 2 check] and [3 start, 4 move].
  const groups = groupActions([
    entry(0, 'ActionStarted'),
    entry(1, 'MoveMade'),
    entry(2, 'Check'),
    entry(3, 'ActionStarted'),
    entry(4, 'MoveMade'),
  ]);

  it('R-ART-002 steps back from live, forward into live, and jumps by action', () => {
    expect(navigate(groups, null, 'back')).toBe(3);
    expect(navigate(groups, 3, 'forward')).toBeNull();
    expect(navigate(groups, 1, 'forward')).toBe(2);
    expect(navigate(groups, null, 'prevAction')).toBe(3);
    expect(navigate(groups, 3, 'prevAction')).toBe(0);
    expect(navigate(groups, 2, 'prevAction')).toBe(0);
    expect(navigate(groups, 1, 'nextAction')).toBe(3);
    expect(navigate(groups, 3, 'nextAction')).toBeNull();
    expect(navigate(groups, 0, 'back')).toBe(0);
  });
});
