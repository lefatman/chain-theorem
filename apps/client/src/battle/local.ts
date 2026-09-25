/**
 * Local battles in the browser (M3): hot-seat, vs NPC of any tier, and Scenario Lab runs. The full
 * GameState stays inside this controller; the UI receives only projections for the current viewer.
 * Clocks use Fischer increments from the format (9.2); the NPC runs in a Web Worker.
 */
import { signal } from '@preact/signals';
import { engine as defaultEngine } from '@chain-theorem/content';
import type { Tier } from '@chain-theorem/ai';
import {
  type ApplyResult,
  type BattleEvent,
  type Engine,
  type FormatId,
  type GameState,
  type Loadout,
  type Side,
  opposite,
  uciToMove,
} from '@chain-theorem/rules';
import type {
  BattleController,
  BattleSnapshot,
  BattleUpdate,
  Clocks,
  LogEntry,
} from './controller.ts';
import { describe } from './describe.ts';
import { npcMove, npcOption } from './npc.ts';

export interface LocalPlayer {
  name: string;
  level: number;
  loadout: Loadout;
  /** 'human' or an NPC tier. */
  control: 'human' | Tier;
}

export interface LocalBattleOptions {
  format: FormatId;
  white: LocalPlayer;
  black: LocalPlayer;
  fen?: string;
  timed?: boolean;
  engine?: Engine;
  /** NPC thinking time in ms (9.4: about 50 ms). */
  npcMs?: number;
}

export class LocalController implements BattleController {
  readonly snapshot;
  private state: GameState;
  private readonly engine: Engine;
  private readonly listeners = new Set<(u: BattleUpdate) => void>();
  private readonly allEvents: BattleEvent[] = [];
  private viewer: Side;
  private clocks: Clocks | null;
  private flagTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private busy = false;
  private readonly opts: LocalBattleOptions;

  constructor(opts: LocalBattleOptions) {
    this.opts = opts;
    this.engine = opts.engine ?? defaultEngine;
    const { state, events } = this.engine.newBattle({
      format: opts.format,
      white: { level: opts.white.level, loadout: opts.white.loadout },
      black: { level: opts.black.level, loadout: opts.black.loadout },
      ...(opts.fen ? { fen: opts.fen } : {}),
    });
    this.state = state;
    this.allEvents.push(...events);
    const humans = (['white', 'black'] as const).filter((s) => opts[s].control === 'human');
    this.viewer = humans.includes(state.turn) ? state.turn : (humans[0] ?? 'white');
    const f = this.engine.caps.FORMATS[opts.format];
    this.clocks =
      opts.timed && f
        ? {
            white: f.clock.initialMs,
            black: f.clock.initialMs,
            running: state.turn,
            at: performance.now(),
          }
        : null;
    this.snapshot = signal<BattleSnapshot>(this.build(null));
    this.armFlag();
    queueMicrotask(() => this.maybeNpc());
  }

  private get controls(): Side[] {
    return (['white', 'black'] as const).filter((s) => this.opts[s].control === 'human');
  }

  private log(): LogEntry[] {
    const pub = this.engine.project(this.state, this.viewer);
    const projected = this.engine.projectEvents(this.state, this.allEvents, this.viewer);
    let ply = 0;
    return projected.map((event) => {
      if (event.k === 'ActionStarted') ply = event.ply;
      return { i: event.i, ply, depth: event.depth, event, text: describe(event, pub) };
    });
  }

  private build(handoff: Side | null): BattleSnapshot {
    const pub = this.engine.project(this.state, this.viewer);
    const pending = this.state.pending;
    const prompt =
      pending &&
      pending.request.chooser === this.viewer &&
      this.opts[this.viewer].control === 'human'
        ? pending.request
        : null;
    return {
      pub,
      viewer: this.viewer,
      own: this.opts[this.viewer].loadout,
      log: this.log(),
      prompt,
      clocks: this.clocks ? { ...this.clocks } : null,
      status: this.state.result ? 'ended' : 'playing',
      result: this.state.result,
      names: { white: this.opts.white.name, black: this.opts.black.name },
      controls: this.controls,
      handoff,
    };
  }

  onUpdate(listener: (u: BattleUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private chargeClock(): void {
    const c = this.clocks;
    if (!c || !c.running) return;
    const now = performance.now();
    c[c.running] -= now - c.at;
    c.at = now;
  }

  private armFlag(): void {
    if (this.flagTimer) clearTimeout(this.flagTimer);
    const c = this.clocks;
    if (!c || !c.running || this.state.result) return;
    const side = c.running;
    this.flagTimer = setTimeout(
      () => {
        this.chargeClock();
        if (c[side] <= 0 && !this.state.result) this.commit({ kind: 'timeout', side });
      },
      Math.max(0, c[side]) + 5,
    );
  }

  /** Apply one action and publish projected updates. */
  private commit(input: Parameters<Engine['applyAction']>[1]): ApplyResult | null {
    if (this.disposed) return null;
    const before = this.engine.project(this.state, this.viewer);
    let r: ApplyResult;
    try {
      r = this.engine.applyAction(this.state, input);
    } catch (e) {
      console.warn('rejected action', input, e);
      return null;
    }
    const prevTurn = this.state.turn;
    this.state = r.state;
    this.allEvents.push(...r.events);
    // Clocks: charge the mover; Fischer increment when the turn passes (9.2).
    if (this.clocks) {
      this.chargeClock();
      const f = this.engine.caps.FORMATS[this.opts.format];
      if (r.kind === 'done' && this.state.turn !== prevTurn && f)
        this.clocks[prevTurn] += f.clock.incrementMs;
      this.clocks.running = this.state.result
        ? null
        : r.kind === 'needsChoice'
          ? r.request.chooser
          : this.state.turn;
      this.clocks.at = performance.now();
      this.armFlag();
    }
    // Hot-seat: follow the side that must act next.
    const next = r.kind === 'needsChoice' ? r.request.chooser : this.state.turn;
    let handoff: Side | null = null;
    if (this.controls.includes(next) && next !== this.viewer && !this.state.result) {
      this.viewer = next;
      handoff =
        this.controls.length > 1 &&
        (globalThis as { ctPassDevice?: boolean }).ctPassDevice !== false
          ? next
          : null;
    }
    const after = this.engine.project(this.state, this.viewer);
    const events = this.engine.projectEvents(this.state, r.events, this.viewer);
    for (const l of this.listeners) l({ before, after, events });
    this.snapshot.value = this.build(handoff);
    queueMicrotask(() => this.maybeNpc());
    return r;
  }

  private async maybeNpc(): Promise<void> {
    if (this.disposed || this.busy || this.state.result) return;
    const pending = this.state.pending;
    const actor = pending ? pending.request.chooser : this.state.turn;
    const control = this.opts[actor].control;
    if (control === 'human') return;
    this.busy = true;
    try {
      const pub = this.engine.project(this.state, actor);
      if (pending) {
        const option = await npcOption(pub, this.opts[actor].loadout, control, pending.request);
        this.busy = false;
        this.commit({ kind: 'choice', side: actor, promptId: pending.request.promptId, option });
      } else {
        const move = await npcMove(pub, this.opts[actor].loadout, control, this.opts.npcMs ?? 50);
        this.busy = false;
        this.commit({ kind: 'move', side: actor, move });
      }
    } catch (e) {
      this.busy = false;
      console.error('NPC failed', e);
    }
  }

  move(uci: string): void {
    const side = this.state.turn;
    if (!this.controls.includes(side) || this.state.pending) return;
    this.commit({ kind: 'move', side, move: uciToMove(uci) });
  }

  answer(option: number): void {
    const p = this.state.pending;
    if (!p || !this.controls.includes(p.request.chooser)) return;
    this.commit({ kind: 'choice', side: p.request.chooser, promptId: p.request.promptId, option });
  }

  resign(): void {
    this.commit({ kind: 'resign', side: this.viewer });
  }

  offerDraw(): void {
    // Local play: an NPC accepts a draw only when it is clearly not winning; hot-seat agrees directly.
    const other = opposite(this.viewer);
    if (this.opts[other].control === 'human') this.commit({ kind: 'agreeDraw' });
  }

  acceptHandoff(): void {
    this.snapshot.value = { ...this.snapshot.value, handoff: null };
  }

  /** Full state (Scenario Lab only; never used by battle UI). */
  debugState(): GameState {
    return this.state;
  }

  dispose(): void {
    this.disposed = true;
    if (this.flagTimer) clearTimeout(this.flagTimer);
    this.listeners.clear();
  }
}
