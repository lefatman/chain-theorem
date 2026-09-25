/**
 * Overworld input (M5, spec 10.1): arrows/WASD and the on-screen d-pad hold a direction, E/space
 * and the action button interact. A held direction walks one tile at a time as soon as the previous
 * step has finished (the controller enforces STEP_MS and the 8/s limit, R-SEC-005); the last
 * direction pressed wins, like a handheld d-pad. Page timers, not the Phaser loop, drive it, so
 * input works while the scene sleeps.
 */
import type { Dir } from '@chain-theorem/protocol';

export type WorldAction = Dir | 'interact';

const KEYS: Record<string, WorldAction> = {
  ArrowUp: 'n',
  ArrowDown: 's',
  ArrowLeft: 'w',
  ArrowRight: 'e',
  w: 'n',
  W: 'n',
  s: 's',
  S: 's',
  a: 'w',
  A: 'w',
  d: 'e',
  D: 'e',
  e: 'interact',
  E: 'interact',
  ' ': 'interact',
  Enter: 'interact',
};

/** The world action of a keyboard key, or null. */
export function keyAction(key: string): WorldAction | null {
  return KEYS[key] ?? null;
}

export interface Walker {
  /** Try one step; true when it was sent. */
  step(dir: Dir): boolean;
  /** Milliseconds until the next step may start. */
  stepReadyIn(): number;
}

export interface InputTimers {
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** Retry cadence while a held step is refused for another reason (a dialog, a warp). */
const RETRY_MS = 60;

export class InputDriver {
  private held: Dir[] = [];
  /** A press not yet turned into a step (a quick tap during a step still walks once). */
  private tap: Dir | null = null;
  private timer: unknown = null;
  private readonly walker: Walker;
  private readonly timers: InputTimers;

  constructor(walker: Walker, timers: InputTimers = {}) {
    this.walker = walker;
    this.timers = timers;
  }

  press(dir: Dir): void {
    this.held = [...this.held.filter((d) => d !== dir), dir];
    this.tap = dir;
    this.cancel();
    this.pump();
  }

  release(dir: Dir): void {
    this.held = this.held.filter((d) => d !== dir);
    if (this.held.length === 0 && this.tap === null) this.cancel();
  }

  releaseAll(): void {
    this.held = [];
    this.tap = null;
    this.cancel();
  }

  /** The direction being walked (last pressed of those held). */
  current(): Dir | null {
    return this.held.at(-1) ?? null;
  }

  private pump(): void {
    this.timer = null;
    const dir = this.current() ?? this.tap;
    if (!dir) return;
    const wait = this.walker.stepReadyIn();
    if (wait <= 0) {
      this.walker.step(dir);
      this.tap = null;
      if (!this.current()) return;
    }
    const next = Math.max(wait > 0 ? wait : this.walker.stepReadyIn(), 0) || RETRY_MS;
    const set = this.timers.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.timer = set(() => this.pump(), next);
  }

  private cancel(): void {
    if (this.timer === null) return;
    const clear =
      this.timers.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
    clear(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.releaseAll();
  }
}
