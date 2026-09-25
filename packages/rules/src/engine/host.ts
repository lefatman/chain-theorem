/**
 * Shared event and reveal plumbing for anything that mutates a draft state: the action pipeline and
 * battle setup. Reveals update `state.reveals` copy-on-write and emit `Revealed` events (R-INFO-002).
 */
import type { PieceView } from '../sdk/types.ts';
import {
  type BattleEvent,
  type EventInput,
  type GameState,
  type PieceId,
  type RevealCause,
  type RevealInfo,
  type RevealLog,
  type Side,
  type SourceRef,
  type Square,
  RulesError,
} from '../types.ts';
import type { Host, Runtime } from './runtime.ts';

export const emptyReveal = (): RevealLog => ({
  abilities: {},
  complete: [],
  items: [],
  allItems: false,
  veiled: [],
});

export class EventHost implements Host {
  readonly events: BattleEvent[] = [];
  depth = 0;
  protected readonly lastSq = new Map<PieceId, Square>();
  private onEventDepth = 0;

  protected readonly rt: Runtime;
  readonly s: GameState;

  constructor(rt: Runtime, s: GameState) {
    this.rt = rt;
    this.s = s;
  }

  lastSquare(id: PieceId): Square {
    const p = this.s.pieces[id];
    if (p && p.square >= 0) return p.square;
    return this.lastSq.get(id) ?? -1;
  }

  emit(ev: EventInput): void {
    const event = { ...ev, i: this.s.eventSeq++, depth: ev.depth ?? this.depth } as BattleEvent;
    this.events.push(event);
    if (this.events.length > this.rt.caps.MAX_EVENTS_PER_ACTION) {
      throw new RulesError(
        'internal',
        `action exceeded ${this.rt.caps.MAX_EVENTS_PER_ACTION} events (unbounded chain)`,
      );
    }
    if (this.onEventDepth >= 4) return;
    const hooks = this.rt.hook(this.s, 'onEvent');
    if (hooks.length === 0) return;
    this.onEventDepth++;
    try {
      for (const e of hooks) e.hooks.onEvent?.(this.rt.ctx(this, e), event);
    } finally {
      this.onEventDepth--;
    }
  }

  reveal(
    side: Side,
    info: RevealInfo,
    cause: RevealCause,
    source?: SourceRef,
    piece?: PieceView,
  ): void {
    if (piece && info.kind === 'ability' && cause !== 'effect' && cause !== 'observed') {
      for (const e of this.rt.hook(this.s, 'revealFilter')) {
        const fn = e.hooks.revealFilter?.reveal;
        if (fn && fn(this.rt.ctx(this, e), { side, info, cause, piece }) === 'hide') {
          // Veil (DD-28): the name stays hidden; the opponent learns this piece type is veiled.
          const log = this.s.reveals[side];
          if (!log.veiled.includes(piece.type)) {
            this.s.reveals = {
              ...this.s.reveals,
              [side]: { ...log, veiled: [...log.veiled, piece.type] },
            };
            this.emit({
              k: 'Revealed',
              side,
              info: { kind: 'veiled', pieceType: piece.type },
              cause: 'observed',
            });
          }
          return;
        }
      }
    }
    const log = this.s.reveals[side];
    let next: RevealLog | null = null;
    switch (info.kind) {
      case 'ability': {
        const list = log.abilities[info.pieceType] ?? [];
        if (!list.includes(info.ability)) {
          next = {
            ...log,
            abilities: { ...log.abilities, [info.pieceType]: [...list, info.ability] },
          };
        }
        break;
      }
      case 'set': {
        const list = log.abilities[info.pieceType] ?? [];
        const merged = [...list, ...info.abilities.filter((a) => !list.includes(a))];
        const complete = log.complete.includes(info.pieceType);
        if (merged.length !== list.length || !complete) {
          next = {
            ...log,
            abilities: { ...log.abilities, [info.pieceType]: merged },
            complete: complete ? log.complete : [...log.complete, info.pieceType],
          };
        }
        break;
      }
      case 'item':
        if (!log.items.includes(info.item)) next = { ...log, items: [...log.items, info.item] };
        break;
      case 'items': {
        const items = [...log.items, ...info.items.filter((i) => !log.items.includes(i))];
        if (items.length !== log.items.length || !log.allItems)
          next = { ...log, items, allItems: true };
        break;
      }
      case 'veiled':
        if (!log.veiled.includes(info.pieceType))
          next = { ...log, veiled: [...log.veiled, info.pieceType] };
        break;
      case 'elements':
        this.emit({ k: 'Revealed', side, info, cause, ...(source ? { source } : {}) });
        return;
    }
    if (!next) return;
    this.s.reveals = { ...this.s.reveals, [side]: next };
    this.emit({ k: 'Revealed', side, info, cause, ...(source ? { source } : {}) });
  }
}
