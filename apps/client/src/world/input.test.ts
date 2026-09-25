/**
 * Overworld input (M5, spec 10.1, R-SEC-005): keys map to directions and interact; a held
 * direction keeps walking as each step finishes, the last pressed direction wins, and a quick tap
 * during a step still walks once.
 */
import { describe, expect, it } from 'vitest';
import type { Dir } from '@chain-theorem/protocol';
import { InputDriver, keyAction } from './input.ts';

function harness(stepMs = 150) {
  const clock = { t: 0 };
  let last = -Infinity;
  const steps: { dir: Dir; t: number }[] = [];
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let ids = 0;
  const walker = {
    stepReadyIn: () => Math.max(0, last + stepMs - clock.t),
    step: (dir: Dir) => {
      if (clock.t < last + stepMs) return false;
      last = clock.t;
      steps.push({ dir, t: clock.t });
      return true;
    },
  };
  const d = new InputDriver(walker, {
    setTimer: (fn, ms) => {
      const id = ++ids;
      timers.push({ fn, at: clock.t + ms, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  /** Advance the clock, firing due timers in order. */
  const run = (ms: number) => {
    const end = clock.t + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      clock.t = next.at;
      next.fn();
    }
    clock.t = end;
  };
  return { d, steps, run, clock, timers };
}

describe('overworld input (R-WORLD-001, R-SEC-005)', () => {
  it('R-WORLD-001 maps arrows, WASD, E and space', () => {
    expect(keyAction('ArrowUp')).toBe('n');
    expect(keyAction('d')).toBe('e');
    expect(keyAction('S')).toBe('s');
    expect(keyAction('a')).toBe('w');
    expect(keyAction('e')).toBe('interact');
    expect(keyAction(' ')).toBe('interact');
    expect(keyAction('x')).toBeNull();
  });

  it('R-SEC-005 a held direction walks one tile per step, never faster', () => {
    const h = harness();
    h.d.press('e');
    h.run(1000);
    h.d.release('e');
    h.run(1000);
    expect(h.steps.map((s) => s.t)).toEqual([0, 150, 300, 450, 600, 750, 900]);
    expect(h.timers).toEqual([]);
  });

  it('R-WORLD-001 the last direction pressed wins; releasing it resumes the other', () => {
    const h = harness();
    h.d.press('e');
    h.run(200);
    h.d.press('s');
    h.run(300);
    h.d.release('s');
    h.run(200);
    h.d.releaseAll();
    expect(h.steps.map((s) => s.dir)).toEqual(['e', 'e', 's', 's', 'e']);
  });

  it('R-WORLD-001 a quick tap during a step still walks once when the step ends', () => {
    const h = harness();
    h.d.press('e');
    h.d.release('e');
    h.run(50);
    h.d.press('n');
    h.d.release('n');
    h.run(500);
    expect(h.steps).toEqual([
      { dir: 'e', t: 0 },
      { dir: 'n', t: 150 },
    ]);
  });
});
