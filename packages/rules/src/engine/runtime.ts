/**
 * Runtime: the registry indexed for fast lookup, per-battle hook entries in the fixed order
 * (13.5: engine invariants first, then traits, items and abilities, each by priority then id),
 * hook contexts, and the movement rules (`MoveRules`) that hooks produce for move generation.
 */
import { opposite } from '../board.ts';
import { stateHashOf } from '../hash.ts';
import { F_EP, type MoveRules, Pos, defaultRules, dirBit } from '../movegen.ts';
import { kingSafeAfter, rulesAfterTurnEnd } from './simulate.ts';
import type {
  AbilityDef,
  Caps,
  CaptureRestriction,
  ChoiceCtx,
  ContentRegistry,
  EffectSpec,
  HookChoice,
  HookName,
  ItemDef,
  MutCtx,
  PieceView,
  RuleHooks,
  TraitDef,
} from '../sdk/types.ts';
import {
  type ChoiceOption,
  type ElementId,
  type EventInput,
  type GameState,
  type PieceId,
  type PieceType,
  type RevealCause,
  type RevealInfo,
  type Side,
  type SourceRef,
  type Square,
  PIECE_TYPES,
  RulesError,
} from '../types.ts';

export interface HookEntry {
  kind: 'trait' | 'item' | 'ability';
  id: string;
  owner: Side | null;
  priority: number;
  hooks: Partial<RuleHooks>;
  element?: ElementId;
}

export interface Entries {
  all: HookEntry[];
  by: Map<HookName, HookEntry[]>;
  /** Some ability in play has a REWIND effect, so pre-action snapshots are kept (DD-100). */
  rewind: boolean;
}

function hasRewind(effects: readonly EffectSpec[]): boolean {
  return effects.some(
    (e) =>
      e.op === 'rewind' ||
      (e.op === 'when' && hasRewind(e.then)) ||
      (e.op === 'atChainEnd' && hasRewind(e.effects)),
  );
}

/** What a hook context reads and writes through. */
export interface Host {
  s: GameState;
  lastSquare(id: PieceId): Square;
  emit?(ev: EventInput): void;
  reveal?(
    side: Side,
    info: RevealInfo,
    cause: RevealCause,
    source?: SourceRef,
    piece?: PieceView,
  ): void;
  /** Mid-action questions (onActionEnd only). */
  choose?(entry: HookEntry, req: HookChoice): ChoiceOption | null;
}

/**
 * One hidden-able movement rule in force: which ability module changed the rules for which piece
 * (a capture restriction, DD-99, or a movement grant such as Electric Slide, DD-104), for the
 * reveal-on-observation checks. Traits are public and never listed.
 */
export interface CapSource {
  entry: HookEntry;
  /** The restricted victim, or the piece granted the movement. */
  victim: PieceId;
  kind: 'capture' | 'movement';
  restriction?: CaptureRestriction;
}

/** Leave out some sources when building rules (strict comparisons for reveals, DD-32). */
export type SkipRestriction = (entry: HookEntry, victim: PieceId) => boolean;

const MODULE_ORDER: Record<HookEntry['kind'], number> = { trait: 0, item: 1, ability: 2 };

export function sourceOf(entry: HookEntry): SourceRef {
  if (entry.kind === 'item') return { kind: 'item', id: entry.id, side: entry.owner as Side };
  if (entry.kind === 'trait')
    return { kind: 'trait', id: entry.id, element: entry.element ?? 'neutral' };
  // Passive abilities act for the whole side; piece -1 marks "no single bearer".
  return { kind: 'ability', id: entry.id, piece: -1, side: entry.owner as Side };
}

export class Runtime {
  readonly abilities = new Map<string, AbilityDef>();
  readonly items = new Map<string, ItemDef>();
  readonly traits: readonly TraitDef[];
  /** Slice id -> declaring module hooks. */
  readonly slices = new Map<string, Partial<RuleHooks>>();
  readonly hashedSlices: string[] = [];
  private readonly cache = new WeakMap<object, Entries>();

  readonly registry: ContentRegistry;
  readonly caps: Caps;

  constructor(registry: ContentRegistry, caps: Caps) {
    this.registry = registry;
    this.caps = caps;
    for (const a of registry.abilities) {
      if (this.abilities.has(a.id))
        throw new RulesError('bad_setup', `duplicate ability id ${a.id}`);
      this.abilities.set(a.id, a);
    }
    for (const i of registry.items) {
      if (this.items.has(i.id)) throw new RulesError('bad_setup', `duplicate item id ${i.id}`);
      this.items.set(i.id, i);
    }
    this.traits = [...registry.traits].sort(
      (a, b) => (a.hooks.priority ?? 0) - (b.hooks.priority ?? 0) || cmp(a.id, b.id),
    );
    const modules: Partial<RuleHooks>[] = [
      ...registry.traits.map((t) => t.hooks),
      ...registry.items.map((i) => i.hooks),
      ...registry.abilities.map((a) => a.hooks ?? {}),
    ];
    for (const hooks of modules) {
      const decl = hooks.stateSlice;
      if (!decl) continue;
      if (this.slices.has(decl.id))
        throw new RulesError('bad_setup', `duplicate state slice ${decl.id}`);
      this.slices.set(decl.id, hooks);
      if (decl.hash !== false) this.hashedSlices.push(decl.id);
    }
    this.hashedSlices.sort();
  }

  ability(id: string): AbilityDef | undefined {
    return this.abilities.get(id);
  }

  /**
   * Full-state hash for repetition (4.5, DD-33). The en passant file counts only when an en passant
   * capture is actually legal for the side to move (pins, Hot Foot and Stalwart included).
   */
  stateHash(state: GameState): string {
    let epUsable = false;
    if (state.ep >= 0) {
      const host: Host = { s: state, lastSquare: (id) => state.pieces[id]?.square ?? -1 };
      const pos = Pos.fromState(state, this.moveRules(host));
      pos.safety = rulesAfterTurnEnd(this, state, state.turn);
      epUsable = pos.legal(state.turn === 'white' ? 0 : 1).some((m) => (m & F_EP) !== 0);
    }
    return stateHashOf(state, this.hashedSlices, epUsable);
  }

  /** Hook entries active in this battle, in the fixed order. Cached per `armies` object. */
  entries(state: GameState): Entries {
    const cached = this.cache.get(state.armies);
    if (cached) return cached;
    const all: HookEntry[] = [];
    for (const t of this.traits) {
      all.push({
        kind: 'trait',
        id: t.id,
        owner: null,
        priority: t.hooks.priority ?? 0,
        hooks: t.hooks,
        element: t.element,
      });
    }
    const items: HookEntry[] = [];
    const abilities: HookEntry[] = [];
    let rewind = false;
    for (const side of ['white', 'black'] as const) {
      const army = state.armies[side];
      for (const id of army.loadout.items) {
        const def = this.items.get(id);
        if (def)
          items.push({
            kind: 'item',
            id,
            owner: side,
            priority: def.hooks.priority ?? 0,
            hooks: def.hooks,
          });
      }
      const seen = new Set<string>();
      for (const t of PIECE_TYPES) {
        for (const id of army.sets[t]) {
          if (seen.has(id)) continue;
          seen.add(id);
          const def = this.abilities.get(id);
          if (def && (hasRewind(def.effects) || (def.attuned && hasRewind(def.attuned.effects))))
            rewind = true;
          if (def?.hooks)
            abilities.push({
              kind: 'ability',
              id,
              owner: side,
              priority: def.hooks.priority ?? 0,
              hooks: def.hooks,
            });
        }
      }
    }
    const order = (a: HookEntry, b: HookEntry) =>
      MODULE_ORDER[a.kind] - MODULE_ORDER[b.kind] ||
      a.priority - b.priority ||
      cmp(a.id, b.id) ||
      cmp(a.owner ?? '', b.owner ?? '');
    items.sort(order);
    abilities.sort(order);
    all.push(...items, ...abilities);
    const by = new Map<HookName, HookEntry[]>();
    for (const e of all) {
      for (const name of Object.keys(e.hooks) as (keyof RuleHooks)[]) {
        if (name === 'priority') continue;
        const list = by.get(name) ?? [];
        list.push(e);
        by.set(name, list);
      }
    }
    const result = { all, by, rewind };
    this.cache.set(state.armies, result);
    return result;
  }

  hook(state: GameState, name: HookName): HookEntry[] {
    return this.entries(state).by.get(name) ?? EMPTY;
  }

  view(host: Host, id: PieceId): PieceView {
    const p = host.s.pieces[id];
    if (!p) throw new RulesError('internal', `no piece ${id}`);
    return {
      id: p.id,
      side: p.side,
      type: p.type,
      element: p.element,
      square: p.square,
      lastSquare: p.square >= 0 ? p.square : host.lastSquare(id),
      start: p.start,
    };
  }

  ctx(host: Host, entry: HookEntry | null): ChoiceCtx {
    return new Ctx(this, host, entry);
  }

  /** Ability ids of the piece's current type, in set order. */
  setOf(state: GameState, side: Side, type: PieceType): readonly string[] {
    return state.armies[side].sets[type];
  }

  /**
   * Movement modifiers for move generation, computed from moveFilter hooks (DD-14). `kingSources`
   * and `capSources` report which module made a king Stalwart or restricted captures of a piece;
   * `skip` leaves chosen capture restrictions out (strict comparisons for reveals, DD-32, DD-99).
   */
  moveRules(
    host: Host,
    kingSources?: Map<Side, HookEntry>,
    capSources?: CapSource[],
    skip?: SkipRestriction,
  ): MoveRules {
    const s = host.s;
    const rules = defaultRules(s.pieces.length);
    const entries = this.hook(s, 'moveFilter');
    if (entries.length === 0) return rules;
    const pass: HookEntry[] = [];
    const blocked: HookEntry[] = [];
    const kings: HookEntry[] = [];
    const caps: HookEntry[] = [];
    const bypass: HookEntry[] = [];
    const leaps: HookEntry[] = [];
    const redirects: HookEntry[] = [];
    const corners: HookEntry[] = [];
    for (const e of entries) {
      const mf = e.hooks.moveFilter;
      if (!mf) continue;
      if (mf.passThrough) pass.push(e);
      if (mf.blockedSquares) blocked.push(e);
      if (mf.kingMode) kings.push(e);
      if (mf.captureFilter) caps.push(e);
      if (mf.bypass) bypass.push(e);
      if (mf.pawnLeap) leaps.push(e);
      if (mf.redirects) redirects.push(e);
      if (mf.redirectCorner) corners.push(e);
    }
    const source = (e: HookEntry, v: PieceView, kind: CapSource['kind']) => {
      if (e.owner !== null) capSources?.push({ entry: e, victim: v.id, kind });
    };
    const ctxs = new Map<HookEntry, ChoiceCtx>();
    const ctxOf = (e: HookEntry) => {
      let c = ctxs.get(e);
      if (!c) {
        c = this.ctx(host, e);
        ctxs.set(e, c);
      }
      return c;
    };
    const views: PieceView[] = [];
    for (const p of s.pieces) {
      if (p.square < 0) continue;
      const v = this.view(host, p.id);
      views.push(v);
      for (const e of pass) {
        if (e.hooks.moveFilter?.passThrough?.(ctxOf(e), v)) {
          rules.passThrough[p.id] = 1;
          rules.anyPass[p.side === 'white' ? 0 : 1] = true;
          break;
        }
      }
      for (const e of bypass) {
        if (e.hooks.moveFilter?.bypass?.(ctxOf(e), v)) {
          rules.bypass[p.id] = 1;
          break;
        }
      }
      // A bypassing piece ignores blocked squares (Stalwart over burning squares, DD-102).
      if (rules.bypass[p.id] !== 1) {
        for (const e of blocked) {
          const squares = e.hooks.moveFilter?.blockedSquares?.(ctxOf(e), v);
          if (squares && squares.length > 0) {
            const arr = rules.blocked[p.id] ?? new Uint8Array(64);
            for (const sq of squares) arr[sq] = 1;
            rules.blocked[p.id] = arr;
          }
        }
      }
      if (p.type === 'king') {
        for (const e of kings) {
          if (e.hooks.moveFilter?.kingMode?.(ctxOf(e), v) === 'stalwart') {
            rules.stalwart[p.side === 'white' ? 0 : 1] = true;
            kingSources?.set(p.side, e);
            break;
          }
        }
      }
      // A corner for its own side's turning sliders unless one of that side's hooks says no
      // (DD-106). Other sides' hooks never speak for this piece.
      for (const e of corners) {
        if (e.owner !== null && e.owner !== p.side) continue;
        if (e.hooks.moveFilter?.redirectCorner?.(ctxOf(e), v) === false) {
          rules.conducts[p.id] = 0;
          break;
        }
      }
      if (p.type === 'pawn') {
        for (const e of leaps) {
          if (skip?.(e, p.id)) continue;
          if (e.hooks.moveFilter?.pawnLeap?.(ctxOf(e), v)) {
            rules.leap[p.id] = 1;
            source(e, v, 'movement');
            break;
          }
        }
      } else if (p.type === 'rook' || p.type === 'bishop' || p.type === 'queen') {
        for (const e of redirects) {
          if (skip?.(e, p.id)) continue;
          const n = e.hooks.moveFilter?.redirects?.(ctxOf(e), v) ?? 0;
          if (n > 0) {
            rules.redirect[p.id] = Math.max(rules.redirect[p.id] as number, Math.min(2, n));
            rules.anyRedirect[p.side === 'white' ? 0 : 1] = true;
            source(e, v, 'movement');
          }
        }
      }
    }
    // Capture restrictions need every attacker's bypass flag, so they come in a second pass.
    if (caps.length > 0) {
      for (const v of views) {
        for (const e of caps) {
          if (skip?.(e, v.id)) continue;
          const r = e.hooks.moveFilter?.captureFilter?.(ctxOf(e), v);
          if (!r) continue;
          let any = false;
          if (r.attackers && r.attackers.length > 0) {
            for (const a of r.attackers) {
              if (!r.hard && rules.bypass[a] === 1) continue;
              const arr = rules.noCapBy[v.id] ?? new Uint8Array(s.pieces.length);
              arr[a] = 1;
              rules.noCapBy[v.id] = arr;
              any = true;
            }
          }
          if (r.from && r.from.length > 0) {
            let mask = 0;
            for (const c of r.from) mask |= dirBit(c);
            if (r.hard) rules.noCapDirs[v.id] = (rules.noCapDirs[v.id] as number) | mask;
            else rules.noCapDirsSoft[v.id] = (rules.noCapDirsSoft[v.id] as number) | mask;
            any = true;
          }
          if (any) {
            rules.anyCap = true;
            if (e.owner !== null)
              capSources?.push({ entry: e, victim: v.id, kind: 'capture', restriction: r });
          }
        }
      }
    }
    return rules;
  }
}

const EMPTY: HookEntry[] = [];

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

class Ctx implements ChoiceCtx {
  private readonly rt: Runtime;
  private readonly host: Host;
  private readonly entry: HookEntry | null;

  constructor(rt: Runtime, host: Host, entry: HookEntry | null) {
    this.rt = rt;
    this.host = host;
    this.entry = entry;
  }

  get state(): GameState {
    return this.host.s;
  }
  get caps() {
    return this.rt.caps;
  }
  get registry() {
    return this.rt.registry;
  }
  get owner(): Side | null {
    return this.entry?.owner ?? null;
  }
  piece(id: PieceId): PieceView {
    return this.rt.view(this.host, id);
  }
  pieceAt(square: Square): PieceView | null {
    const id = this.host.s.board[square] ?? -1;
    return id >= 0 ? this.rt.view(this.host, id) : null;
  }
  pieces(side?: Side): PieceView[] {
    const out: PieceView[] = [];
    for (const p of this.host.s.pieces) {
      if (p.square >= 0 && (side === undefined || p.side === side))
        out.push(this.rt.view(this.host, p.id));
    }
    return out;
  }
  slice<T>(id?: string): T {
    const key = id ?? this.entry?.hooks.stateSlice?.id;
    if (!key) throw new RulesError('internal', 'slice(): module declares no stateSlice');
    return this.host.s.slices[key] as T;
  }
  setSlice<T>(value: T, id?: string): void {
    const key = id ?? this.entry?.hooks.stateSlice?.id;
    if (!key) throw new RulesError('internal', 'setSlice(): module declares no stateSlice');
    if (!this.host.emit)
      throw new RulesError('internal', 'setSlice() is not allowed in read-only hooks');
    this.host.s.slices = { ...this.host.s.slices, [key]: value };
  }
  abilitiesOf(piece: PieceView): readonly string[] {
    return this.host.s.armies[piece.side].sets[piece.type];
  }
  hasAbility(piece: PieceView, abilityId: string): boolean {
    return this.abilitiesOf(piece).includes(abilityId);
  }
  attuned(piece: PieceView, abilityId: string): boolean {
    const def = this.rt.ability(abilityId);
    if (!def) return false;
    if (def.affinity !== 'neutral' && piece.element === def.affinity) return true;
    for (const e of this.rt.hook(this.host.s, 'attunement')) {
      if (e.hooks.attunement?.(this.rt.ctx(this.host, e), piece, def)) return true;
    }
    return false;
  }
  hasItem(side: Side, itemId: string): boolean {
    return this.host.s.armies[side].loadout.items.includes(itemId);
  }
  itemParam(side: Side, itemId: string): { element?: ElementId } | undefined {
    return this.host.s.armies[side].loadout.itemParams?.[itemId];
  }
  emit(event: EventInput): void {
    if (!this.host.emit)
      throw new RulesError('internal', 'emit() is not allowed in read-only hooks');
    this.host.emit(event);
  }
  reveal(side: Side, info: RevealInfo, cause: RevealCause, source?: SourceRef): void {
    if (!this.host.reveal)
      throw new RulesError('internal', 'reveal() is not allowed in read-only hooks');
    this.host.reveal(side, info, cause, source);
  }
  revealSelf(cause: RevealCause = 'observed'): void {
    const e = this.entry;
    if (!e || e.owner === null) return;
    if (e.kind === 'item') this.reveal(e.owner, { kind: 'item', item: e.id }, cause, sourceOf(e));
  }
  choose(req: HookChoice): ChoiceOption | null {
    if (!this.host.choose || !this.entry)
      throw new RulesError('internal', 'choose() is only allowed in onActionEnd');
    return this.host.choose(this.entry, req);
  }
  kingSafeAfter(side: Side, change: (draft: MutCtx) => void): boolean {
    return kingSafeAfter(this.rt, this.host.s, this.entry, side, change);
  }
}

export { opposite };
