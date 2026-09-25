/**
 * Test helpers for the battle core: a seeded RNG, random legal loadouts, client frames and the
 * R-SEC-001 message scanner. Test-only (imported by *.unit.test.ts files).
 */
import { scanPayload } from '@chain-theorem/content/scan';
import { ServerBattle } from '@chain-theorem/protocol';
import {
  type Engine,
  type GameState,
  type Loadout,
  PIECE_TYPES,
  type Side,
} from '@chain-theorem/rules';
import type { ServerMsg } from './types.ts';

/** mulberry32, as in apps/tools (apps are not importable from each other). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)] as T;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [xs[i], xs[j]] = [xs[j] as T, xs[i] as T];
    }
    return xs;
  }
}

/** A random loadout that passes R-LOAD-004 at `level` (same recipe as the fuzzer). */
export function randomLoadout(engine: Engine, rng: Rng, level: number): Loadout {
  const caps = engine.caps;
  const items = engine.registry.items.filter((i) => !i.retired && i.minLevel <= level);
  const abilities = engine.registry.abilities.filter((a) => !a.retired && a.minLevel <= level);
  for (let attempt = 0; attempt < 50; attempt++) {
    const budget = caps.itemSlots(level);
    const chosen: (typeof items)[number][] = [];
    let used = 0;
    const groups = new Set<string>();
    for (const item of rng.shuffle([...items])) {
      if (!rng.chance(0.45)) continue;
      if (used + item.slotCost > budget) continue;
      if (item.exclusiveGroup && groups.has(item.exclusiveGroup)) continue;
      chosen.push(item);
      used += item.slotCost;
      if (item.exclusiveGroup) groups.add(item.exclusiveGroup);
    }
    const capacity = Math.max(caps.BASE_ABILITY_CAPACITY, ...chosen.map((i) => i.capacity ?? 0));
    const perType = chosen.some((i) => i.grants?.perTypeSets) && rng.chance(0.7);
    const blended = chosen.some((i) => i.grants?.secondElement);
    const els = rng.shuffle([...caps.ENABLED_ELEMENTS]);
    const elements = (blended ? [els[0], els[1]] : [els[0]]).filter(
      (e): e is NonNullable<typeof e> => e !== undefined,
    );
    const itemParams: NonNullable<Loadout['itemParams']> = {};
    for (const i of chosen)
      if (i.param?.element === 'required')
        itemParams[i.id] = { element: rng.pick(caps.ENABLED_ELEMENTS) };
    const makeSet = (): string[] => {
      const set: string[] = [];
      let cost = 0;
      for (const a of rng.shuffle([...abilities])) {
        if (cost + a.slotCost > capacity) continue;
        if (!rng.chance(0.6)) continue;
        set.push(a.id);
        cost += a.slotCost;
      }
      return set;
    };
    const loadout: Loadout = {
      elements,
      items: chosen.map((i) => i.id),
      sets: perType ? PIECE_TYPES.map(() => makeSet()) : [makeSet()],
    };
    if (Object.keys(itemParams).length > 0) loadout.itemParams = itemParams;
    if (engine.validateLoadout(loadout, { level }).ok) return loadout;
  }
  return { elements: [caps.ENABLED_ELEMENTS[0] ?? 'ember'], items: [], sets: [[]] };
}

/** A client frame as the browser sends it. */
export const frame = (t: string, d?: unknown, s?: number): string =>
  JSON.stringify(d === undefined ? { t } : s === undefined ? { t, d } : { t, s, d });

/**
 * R-SEC-001 / R-INFO-005 check of one outgoing message for its recipient, after JSON serialization:
 * the whole message is scanned for unrevealed opponent ids, and the embedded projection, events
 * and prompt request are scanned with the structural checks too. Also checks the message is built
 * for its recipient (projection viewer, prompt chooser) and matches its protocol schema (R-NET-001).
 */
export function checkMessage(to: Side, msg: ServerMsg, state: GameState): string | null {
  const wire = JSON.parse(JSON.stringify(msg)) as { t: string; d: Record<string, unknown> };
  const schema = ServerBattle[wire.t as keyof typeof ServerBattle];
  if (!schema) return `unknown server message ${wire.t}`;
  const parsed = schema.safeParse(wire.d);
  if (!parsed.success) return `${wire.t} fails its schema: ${parsed.error.message}`;
  const leak =
    scanPayload(wire, state, to) ??
    (wire.d.public ? scanPayload(wire.d.public, state, to) : null) ??
    (wire.d.events ? scanPayload(wire.d.events, state, to) : null) ??
    (wire.d.request ? scanPayload(wire.d.request, state, to) : null);
  if (leak) return `${wire.t} to ${to}: ${leak}`;
  const pub = wire.d.public as { viewer?: string; armies?: Record<string, { loadout?: unknown }> };
  if (pub && pub.viewer !== to) return `${wire.t} to ${to} carries the ${pub.viewer} projection`;
  const request = wire.d.request as { chooser?: string } | undefined;
  if (request && request.chooser !== to) return `prompt to ${to} for chooser ${request.chooser}`;
  for (const c of [wire.d.clocks] as { white?: number; black?: number }[]) {
    if (c && ((c.white ?? 0) < 0 || (c.black ?? 0) < 0)) return `${wire.t}: negative clock`;
  }
  return null;
}
