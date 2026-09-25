/**
 * Scenario Lab frames (11.2 step-through, BUILD_PROMPT M3): the per-event boards the lab rebuilds
 * with applyEventToPublic must agree with the engine's own projection at every point the engine
 * exposes one (each prompt and each settled action), for both viewers, on the worked examples and on
 * seeded random battles with random abilities, items and elements.
 */
import { describe, expect, it } from 'vitest';
import { abilities, items } from '@chain-theorem/content';
import { WORKED_EXAMPLES } from '../../../../packages/content/src/examples.ts';
import type { ArmySpec, ScenarioSpec } from '@chain-theorem/content/testing';
import { ELEMENTS, type ElementId, type Side, moveToUci, parseSquare } from '@chain-theorem/rules';
import { actionFrames, sessionFrames } from './frames.ts';
import { applyEventToPublic } from './reducer.ts';
import { type LabSession, answerPrompt, openPrompt, playMove, runScenario } from './session.ts';

const VIEWERS: readonly Side[] = ['white', 'black'];

/** Every checkpoint drift in the session, as readable strings (empty = all frames verified). */
function drifts(s: LabSession): string[] {
  const out: string[] = [];
  for (const viewer of VIEWERS) {
    for (const f of sessionFrames(s, viewer)) {
      if (f.drift && f.drift.length > 0)
        out.push(
          `${viewer} action ${f.action.n} event ${f.event.i} ${f.event.k}: ${f.drift.join(', ')}`,
        );
    }
  }
  return out;
}

function checkpoints(s: LabSession): number {
  return sessionFrames(s, 'white').filter((f) => f.drift !== null).length;
}

function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0x100000000;
  };
}

function pick<T>(r: () => number, list: readonly T[]): T {
  const v = list[Math.floor(r() * list.length)];
  if (v === undefined) throw new Error('empty list');
  return v;
}

function randomArmy(r: () => number): ArmySpec {
  const elements: ElementId[] = [pick(r, [...ELEMENTS, 'neutral'] as const)];
  if (r() < 0.25)
    elements.push(
      pick(
        r,
        ELEMENTS.filter((e) => e !== elements[0]),
      ),
    );
  const set = abilities.filter(() => r() < 0.3).map((a) => a.id);
  const chosen = items.filter((i) => !i.exclusiveGroup && r() < 0.2).map((i) => i.id);
  const itemParams: NonNullable<ArmySpec['itemParams']> = {};
  for (const id of chosen) {
    if (items.find((i) => i.id === id)?.param) itemParams[id] = { element: pick(r, ELEMENTS) };
  }
  return { level: 30, elements, items: chosen, itemParams, sets: [set] };
}

describe('Scenario Lab frames (R-ART-002 step-through replay)', () => {
  for (const ex of WORKED_EXAMPLES) {
    const setups: [string, ScenarioSpec][] = [
      [ex.id, ex.setup],
      ...(ex.variants ?? []).map((v): [string, ScenarioSpec] => [`${ex.id} ${v.label}`, v.setup]),
    ];
    for (const [name, setup] of setups) {
      it(`R-ART-002 ${name}: every rebuilt frame matches the engine projection at each checkpoint`, () => {
        const s = runScenario(setup);
        expect(s.error).toBeNull();
        expect(s.actions).toHaveLength((setup.moves?.length ?? 0) + 1);
        expect(checkpoints(s)).toBeGreaterThanOrEqual(s.actions.length);
        expect(drifts(s)).toEqual([]);
      });
    }
  }

  it('R-ART-002 E6: the Riposte prompt is a checkpoint with the partial board (knight gone, bishop on g6)', () => {
    const e6 = WORKED_EXAMPLES.find((e) => e.id === 'E6');
    const s = runScenario(e6?.setup ?? {});
    const frames = actionFrames(s.engine, s.actions[1] ?? s.actions[0]!, 'black');
    const atPrompt = frames.find((f) => f.promptAfter);
    expect(atPrompt?.drift).toEqual([]);
    expect(atPrompt?.pub.board[parseSquare('g6')]).toBe(1);
    expect(atPrompt?.pub.pieces[2]?.square).toBe(-1);
    // The prompt is answered by a ChoiceMade frame that knows which option was taken.
    const made = frames.find((f) => f.event.k === 'ChoiceMade');
    expect(made?.answered?.request.options[made.answered.answer ?? -1]).toEqual({
      kind: 'move',
      from: parseSquare('h7'),
      to: parseSquare('g6'),
    });
  });

  it('R-ART-002 castling moves the rook with the king in the rebuilt frame', () => {
    const s = runScenario({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', moves: ['e1g1', 'e8c8'] });
    expect(drifts(s)).toEqual([]);
    const moved = sessionFrames(s, 'white').filter((f) => f.event.k === 'MoveMade');
    expect(moved[0]?.pub.board[parseSquare('f1')]).toBeGreaterThanOrEqual(0);
    expect(moved[1]?.pub.board[parseSquare('d8')]).toBeGreaterThanOrEqual(0);
  });

  it('R-ART-002 en passant and promotion frames match the engine', () => {
    const s = runScenario({
      fen: '4k3/1P6/8/3pP3/8/8/8/4K3 w - d6 0 1',
      white: { elements: ['ember'] },
      moves: ['e5d6', 'e8f7', 'b7b8n'],
    });
    expect(s.error).toBeNull();
    expect(drifts(s)).toEqual([]);
    const promoted = sessionFrames(s, 'black').find((f) => f.event.k === 'Promoted');
    expect(
      promoted?.pub.pieces[promoted.event.k === 'Promoted' ? promoted.event.piece : -1]?.type,
    ).toBe('knight');
  });

  it('R-ART-002 applyEventToPublic is pure and stamps eventSeq', () => {
    const s = runScenario(WORKED_EXAMPLES[0]?.setup ?? {});
    const action = s.actions[1];
    if (!action) throw new Error('no action');
    const before = s.engine.project(action.before, 'white');
    const copy = JSON.stringify(before);
    const ev = action.events.find((e) => e.k === 'Captured');
    if (!ev) throw new Error('no capture');
    const after = applyEventToPublic(before, ev);
    expect(JSON.stringify(before)).toBe(copy);
    expect(after.eventSeq).toBe(ev.i + 1);
    expect(after.legal).toEqual([]);
  });

  it('R-ART-002 seeded random battles with random loadouts: no frame drift at any checkpoint', () => {
    let actions = 0;
    let prompts = 0;
    for (let seed = 1; seed <= Number(process.env.LAB_SEEDS ?? 24); seed++) {
      const r = rng(seed * 7919);
      let s = runScenario({
        format: pick(r, ['full', 'vanguard'] as const),
        white: randomArmy(r),
        black: randomArmy(r),
      });
      for (let ply = 0; ply < Number(process.env.LAB_PLIES ?? 70) && !s.state.result; ply++) {
        const p = openPrompt(s);
        if (p) {
          s = answerPrompt(s, Math.floor(r() * p.request.options.length));
          prompts++;
          continue;
        }
        const legal = s.engine.legalMoves(s.state, s.state.turn);
        if (legal.length === 0) break;
        // Prefer captures so chains actually happen.
        const caps = legal.filter((m) => (s.state.board[m.to] ?? -1) >= 0);
        const m = pick(r, caps.length > 0 && r() < 0.7 ? caps : legal);
        s = playMove(s, moveToUci(m), 'ask');
      }
      actions += s.actions.length;
      expect(drifts(s), `seed ${seed}`).toEqual([]);
    }
    expect(actions).toBeGreaterThan(500);
    expect(prompts).toBeGreaterThan(0);
  });
});
