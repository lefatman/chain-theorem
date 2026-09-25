/**
 * ZoneCore (M5, spec 10): the whole ZoneRoom logic for one zone channel as a pure state machine. It
 * has no Cloudflare API, no clock and no I/O: the Durable Object passes the time in (`now`, epoch
 * ms), sends the returned messages, performs the returned effects and stores `snapshot()` when an
 * outbox says `save`.
 *
 * - R-WORLD-001 (10.1): tile steps only, collision on the server, at most 60 players per channel,
 *   a battling marker while a player is in a battle.
 * - R-WORLD-002 / R-SEC-003 (10.2): encounters are rolled here, never on the client, with the
 *   zone rate, key-item multipliers and a grace after each encounter; paths never roll.
 * - R-WORLD-003 / R-WORLD-005 (10.3, 10.5): NPC dialogs, Chess Academy lessons checked with the
 *   rules engine, and data-driven quests (`quests.ts`).
 * - R-WORLD-004 / R-WORLD-006 (10.4): consent challenges anywhere; inside a challenge zone a
 *   challenge to someone in the same slot bracket starts at once (DD-04), never against a player in
 *   a battle or within 60 s after one.
 * - R-SEC-005: per-player token buckets (steps 8/s, chat 1/s burst 5, other messages 5/s); excess
 *   and invalid frames are dropped and counted; repeat offenders get a `close` effect.
 * - R-SEC-011: chat filtered by the youngest participant, recomputed from the current membership
 *   for every message; whispers to or from minors only between friends; adults may opt in.
 * - R-COST-002: positions are persisted only on leave (logout) and warp (zone change).
 */
import { engine as defaultEngine } from '@chain-theorem/content';
import {
  ClientZone,
  type ClientZoneMap,
  LIMITS,
  type Limit,
  type Msg,
  decode,
  newBucket,
  strike,
  take,
  tooManyStrikes,
} from '@chain-theorem/protocol';
import { type Engine, type FormatId, type Loadout, moveToUci } from '@chain-theorem/rules';
import { CLOSE_POLICY } from '../battle/index.ts';
import {
  type ChatFilter,
  basicChatFilter,
  conversationFiltered,
  sanitizeText,
  viewFiltered,
  whisperAllowed,
} from './chat.ts';
import { encounterRate, pickEntry, wildLevel } from './encounters.ts';
import {
  type QuestEvent,
  type QuestIndex,
  type QuestUpdate,
  accept as acceptQuest,
  advance,
  canAccept,
  questIndex,
  wantsReach,
} from './quests.ts';
import type {
  BattleOutcome,
  BattleRequest,
  JoinOutbox,
  Outbox,
  PartyView,
  PlayerInit,
  PlayerState,
  QuestProgress,
  RoutedChat,
  ServerMsg,
  TelemetryState,
  ZoneSnapshot,
  ZoneTelemetry,
} from './types.ts';
import {
  type Dir,
  type KeyItemDef,
  type LessonDef,
  type NpcDef,
  type Reward,
  type WorldRegistry,
  type ZoneDef,
  type ZoneGeometry,
  inRect,
  parseZone,
  stepFrom,
  tileIndex,
  walkable,
} from './world.ts';

/** Players per zone channel; overflow opens a parallel channel (10.1, PROVISIONAL). */
export const ZONE_CAPACITY = 60;
/** No challenge-zone battle within this long after a battle (R-WORLD-006, COMMITTED). */
export const CHALLENGE_COOLDOWN_MS = 60_000;
/** A consent challenge nobody answered lapses after this long. */
export const CHALLENGE_TTL_MS = 60_000;
/** Open consent challenges one player can receive at once (spam guard). */
export const MAX_PENDING_CHALLENGES = 5;
/** Telemetry counters are reported at most this often (on the next input after the window). */
export const TELEMETRY_WINDOW_MS = 60_000;
/** Zone messages other than steps and chat share the battle message budget (5/s, burst 10). */
export const OTHER_LIMIT: Limit = LIMITS.battle;

/** `err.code` values the zone sends. */
export const ZoneErr = {
  bad_message: 'bad_message',
  rate_limited: 'rate_limited',
  battling: 'battling',
  busy: 'busy',
  cooldown: 'cooldown',
  not_here: 'not_here',
  bad_target: 'bad_target',
  no_npc: 'no_npc',
  too_far: 'too_far',
  no_option: 'no_option',
  no_puzzle: 'no_puzzle',
  no_challenge: 'no_challenge',
  chal_declined: 'chal_declined',
  no_party: 'no_party',
  no_guild: 'no_guild',
  friends_only: 'friends_only',
  whisper_refused: 'whisper_refused',
  /** Host notices (parties span zones, so the host decides these; see `notice`). */
  party_full: 'party_full',
  in_party: 'in_party',
  not_online: 'not_online',
  invite_expired: 'invite_expired',
  battle_failed: 'battle_failed',
} as const;
export type ZoneErrCode = (typeof ZoneErr)[keyof typeof ZoneErr];

export interface ZoneOptions {
  /** Rules engine for puzzle legality and slot brackets (default: the content engine). */
  engine?: Engine;
  /** Encounter rolls in [0, 1) (default: `crypto.getRandomValues`). */
  rng?: () => number;
  chatFilter?: ChatFilter;
  /** Players per channel: 1..60, default 60 (the zsnap cap). */
  capacity?: number;
  /** Observer of every queued message (tests: schema checks). Never used to send anything. */
  observe?: (to: string, msg: ServerMsg) => void;
}

export interface ZoneKey {
  zone: string;
  channel: number;
}

type ClientMsg = Msg<ClientZoneMap>;
type ChatChannel = Extract<ClientMsg, { t: 'chat' }>['d']['ch'];
type Option = { id: string; label: string };

/** A position check with pure-chess rules: no abilities, sandbox element (DD-23). */
const SANDBOX: Loadout = { elements: ['neutral'], items: [], sets: [[]] };

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const emptyOutbox = (): Outbox => ({ send: [], effects: [], save: false });
const freshTele = (t: number): TelemetryState => ({
  from: t,
  playerMs: 0,
  in: {},
  out: {},
  dropped: { rate: 0, invalid: 0, refused: 0 },
  encounters: 0,
  battles: 0,
});
const cut = (s: string, n: number): string => (s.length > n ? s.slice(0, n) : s);
const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])];

/** Uniform in [0, 1) from the platform CSPRNG (Workers and Node both provide `crypto`). */
export function cryptoRandom(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] ?? 0) / 4294967296;
}

/** Ranked and challenge-zone brackets by unlocked item slots: 1-2, 3-4, 5-6 (9.3, DD-04). */
export function slotBracket(engine: Engine, level: number): number {
  return Math.ceil(engine.caps.itemSlots(level) / 2);
}

// ---- World index (built once per registry) -----------------------------------------------------

interface WorldIndex {
  zones: Map<string, ZoneDef>;
  npcs: Map<string, NpcDef>;
  lessons: Map<string, LessonDef>;
  quests: QuestIndex;
  keyItems: Map<string, KeyItemDef>;
  geometry: Map<string, ZoneGeometry>;
}

const INDEX = new WeakMap<WorldRegistry, WorldIndex>();

function indexOf(world: WorldRegistry): WorldIndex {
  let ix = INDEX.get(world);
  if (!ix) {
    ix = {
      zones: new Map(world.zones.map((z) => [z.id, z])),
      npcs: new Map(world.npcs.map((n) => [n.id, n])),
      lessons: new Map(world.lessons.map((l) => [l.id, l])),
      quests: questIndex(world.quests),
      keyItems: new Map(world.keyItems.map((k) => [k.id, k])),
      geometry: new Map(),
    };
    INDEX.set(world, ix);
  }
  return ix;
}

function geometryOf(ix: WorldIndex, zone: ZoneDef): ZoneGeometry {
  let g = ix.geometry.get(zone.id);
  if (!g) {
    g = parseZone(zone.map);
    ix.geometry.set(zone.id, g);
  }
  return g;
}

function checkTime(now: number): number {
  if (!Number.isFinite(now)) throw new Error(`ZoneCore: bad time ${String(now)}`);
  return now;
}

function checkPlayer(p: PlayerInit): void {
  const bad = (why: string): never => {
    throw new Error(`ZoneCore: bad player: ${why}`);
  };
  if (typeof p.id !== 'string' || p.id.length < 1 || p.id.length > 64) bad('id must be 1..64');
  if (typeof p.name !== 'string' || p.name.length < 1 || p.name.length > 40)
    bad('name must be 1..40 characters');
  if (!Number.isInteger(p.level) || p.level < 1 || p.level > 100) bad('level must be 1..100');
  for (const k of ['friends', 'quests', 'lessonsDone', 'defeatedNpcs', 'keyItems'] as const)
    if (!Array.isArray(p[k])) bad(`${k} must be an array`);
}

// ---- The core ----------------------------------------------------------------------------------

export class ZoneCore {
  private s: ZoneSnapshot;
  private readonly byId = new Map<string, PlayerState>();
  private readonly ix: WorldIndex;
  private readonly def: ZoneDef;
  private readonly geo: ZoneGeometry;
  private readonly engine: Engine;
  private readonly rng: () => number;
  private readonly filter: ChatFilter;
  private readonly capacity: number;
  private readonly observe: ZoneOptions['observe'];
  /** Legal UCI moves per puzzle FEN (derived data, rebuilt after a restore). */
  private readonly legal = new Map<string, ReadonlySet<string>>();
  private out: Outbox = emptyOutbox();

  /** An empty channel of `key.zone`. Throws when the zone is unknown or its map is malformed. */
  constructor(world: WorldRegistry, key: ZoneKey, opts: ZoneOptions = {}) {
    this.ix = indexOf(world);
    const def = this.ix.zones.get(key.zone);
    if (!def) throw new Error(`ZoneCore: unknown zone ${key.zone}`);
    if (!Number.isInteger(key.channel) || key.channel < 0)
      throw new Error(`ZoneCore: bad channel ${key.channel}`);
    this.def = def;
    this.geo = geometryOf(this.ix, def);
    this.engine = opts.engine ?? defaultEngine;
    this.rng = opts.rng ?? cryptoRandom;
    this.filter = opts.chatFilter ?? basicChatFilter;
    // zsnap lists at most 60 players (the protocol cap), so a channel never holds more.
    this.capacity = Math.min(
      ZONE_CAPACITY,
      Math.max(1, Math.floor(opts.capacity ?? ZONE_CAPACITY)),
    );
    this.observe = opts.observe;
    this.s = {
      v: 1,
      zone: def.id,
      channel: key.channel,
      now: 0,
      seq: 0,
      players: [],
      challenges: [],
      tele: freshTele(0),
    };
  }

  /** Resume from a stored snapshot (after eviction). */
  static restore(world: WorldRegistry, snap: ZoneSnapshot, opts: ZoneOptions = {}): ZoneCore {
    if (snap.v !== 1) throw new Error(`ZoneCore: unknown snapshot version ${String(snap.v)}`);
    const core = new ZoneCore(world, { zone: snap.zone, channel: snap.channel }, opts);
    core.s = clone(snap);
    for (const p of core.s.players) core.byId.set(p.id, p);
    return core;
  }

  /** A JSON-serializable copy of the whole state (store it after each `save` outbox). */
  snapshot(): ZoneSnapshot {
    return clone(this.s);
  }

  get zone(): string {
    return this.s.zone;
  }

  get channel(): number {
    return this.s.channel;
  }

  /** Players in the channel. */
  get size(): number {
    return this.s.players.length;
  }

  get full(): boolean {
    return this.s.players.length >= this.capacity;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * A player's tile. Steps do not ask for a snapshot save (R-COST-002), so the host mirrors this
   * into the player's socket attachment, which survives hibernation at no storage cost.
   */
  position(id: string): { x: number; y: number; dir: Dir } | null {
    const p = this.byId.get(id);
    return p ? { x: p.x, y: p.y, dir: p.dir } : null;
  }

  /**
   * After a restore: put a player back on the tile its socket attachment recorded (newer than the
   * stored snapshot). Ignored for unknown players and unwalkable tiles. Sends nothing.
   */
  place(id: string, pos: { x: number; y: number; dir: Dir }): void {
    const p = this.byId.get(id);
    if (!p || !Number.isInteger(pos.x) || !Number.isInteger(pos.y)) return;
    if (!walkable(this.geo, pos.x, pos.y)) return;
    p.x = pos.x;
    p.y = pos.y;
    p.dir = pos.dir;
    p.inChallenge = this.inChallenge(pos.x, pos.y);
  }

  // ---------------------------------------------------------------------------------------------
  // Presence

  /**
   * A player's socket for this channel opened. Refused with 'full' at capacity (10.1). A player
   * already here (a reconnect) keeps the channel's position, battle and lesson state; identity,
   * friends, party and preferences are refreshed from `init`. Nothing is broadcast to the player
   * until it sends `hello`.
   */
  join(init: PlayerInit, now: number): JoinOutbox {
    const t = this.begin(now);
    checkPlayer(init);
    const old = this.byId.get(init.id);
    if (old) {
      this.refresh(old, init);
      this.out.save = true;
      return { ...this.flush(), refused: null };
    }
    if (this.s.players.length >= this.capacity) return { ...this.flush(), refused: 'full' };
    const pos = this.startPosition(init);
    const p: PlayerState = {
      id: init.id,
      name: init.name,
      level: init.level,
      adult: init.adult,
      friends: [...init.friends],
      filterChat: init.filterChat,
      x: pos.x,
      y: pos.y,
      dir: pos.dir,
      live: false,
      quests: clone(init.quests),
      lessonsDone: [...init.lessonsDone],
      defeatedNpcs: [...init.defeatedNpcs],
      keyItems: [...init.keyItems],
      party: init.party ? clone(init.party) : null,
      battling: init.battling ?? false,
      battleId: null,
      battleEndedAt: init.battleEndedAt ?? null,
      grace: 0,
      inChallenge: this.inChallenge(pos.x, pos.y),
      dialog: null,
      lesson: null,
      warping: null,
      buckets: {
        step: newBucket(LIMITS.step, t),
        chat: newBucket(LIMITS.chat, t),
        other: newBucket(OTHER_LIMIT, t),
      },
    };
    this.s.players.push(p);
    this.byId.set(p.id, p);
    this.broadcast({ t: 'zjoin', d: this.view(p) }, p.id);
    // Quests may have moved elsewhere (a lesson finished) or arrive here (a `reach` step).
    this.questEvent(p, null, t);
    this.out.save = true;
    return { ...this.flush(), refused: null };
  }

  /** The player's last socket for this channel closed (logout, warp, disconnect). */
  leave(id: string, now: number): Outbox {
    this.begin(now);
    const p = this.byId.get(id);
    if (!p) return this.flush();
    this.s.players = this.s.players.filter((q) => q.id !== id);
    this.byId.delete(id);
    this.s.challenges = this.s.challenges.filter((c) => c.from !== id && c.to !== id);
    this.broadcast({ t: 'zleave', d: { p: id } });
    // R-COST-002: the position is saved on logout; after a warp the destination was already saved.
    if (!p.warping)
      this.out.effects.push({ kind: 'persist', id, zone: this.s.zone, x: p.x, y: p.y, dir: p.dir });
    this.out.save = true;
    return this.flush();
  }

  // ---------------------------------------------------------------------------------------------
  // Client messages

  /** One raw WebSocket frame from player `id`. */
  message(id: string, raw: unknown, now: number): Outbox {
    const t = this.begin(now);
    const p = this.byId.get(id);
    if (!p) {
      this.error(`message from ${id}, who is not in the channel`);
      return this.flush();
    }
    const msg = decode(ClientZone, raw);
    if (!msg) {
      // An invalid frame still costs a token (so valid messages in between cannot keep a flood
      // of invalid ones alive) and is always a strike (R-SEC-005).
      const other = p.buckets.other;
      const before = other.strikes;
      if (take(other, OTHER_LIMIT, t)) {
        other.strikes = before;
        strike(other);
      }
      this.s.tele.dropped.invalid++;
      if (other.strikes === 1) this.err(p, ZoneErr.bad_message);
      this.checkStrikes(p);
      return this.flush();
    }
    const kind = msg.t === 'step' ? 'step' : msg.t === 'chat' ? 'chat' : 'other';
    const bucket = p.buckets[kind];
    const limit = kind === 'other' ? OTHER_LIMIT : LIMITS[kind];
    if (!take(bucket, limit, t)) {
      this.s.tele.dropped.rate++;
      // A dropped step snaps the client back; other drops answer once per run of drops.
      if (kind === 'step') this.zpos(p);
      else if (bucket.strikes === 1) this.err(p, ZoneErr.rate_limited);
      this.checkStrikes(p);
      return this.flush();
    }
    const tin = this.s.tele.in;
    tin[msg.t] = (tin[msg.t] ?? 0) + 1;
    if (!this.handle(p, msg, t)) this.s.tele.dropped.refused++;
    return this.flush();
  }

  /** Handle one valid message; false when it was refused. */
  private handle(p: PlayerState, msg: ClientMsg, t: number): boolean {
    if (msg.t === 'hello') {
      this.hello(p);
      return true;
    }
    // After a warp the client reconnects elsewhere; anything else on this socket is stale.
    if (p.warping) return false;
    switch (msg.t) {
      case 'step':
        return this.step(p, msg.d.dir, t);
      case 'chat':
        return this.chat(p, msg.d.ch, msg.d.text, msg.d.to);
      case 'chal':
        return this.challenge(p, msg.d.to, msg.d.format, t);
      case 'chalReply':
        return this.challengeReply(p, msg.d.id, msg.d.accept);
      case 'interact':
        return this.interact(p, msg.d.npc, t);
      case 'choose':
        return this.choose(p, msg.d.npc, msg.d.option, t);
      case 'answer':
        return this.answer(p, msg.d.lesson, msg.d.puzzle, msg.d.move, t);
      case 'party':
        return this.partyOp(p, msg.d);
      case 'prefs':
        p.filterChat = msg.d.filterChat;
        this.out.effects.push({ kind: 'prefs', id: p.id, filterChat: p.filterChat });
        this.out.save = true;
        return true;
    }
  }

  /** `hello` (every (re)connect): the snapshot, then the party and any open puzzle. */
  private hello(p: PlayerState): void {
    p.live = true;
    this.send(p.id, {
      t: 'zsnap',
      d: {
        zone: this.s.zone,
        channel: this.s.channel,
        you: { p: p.id, x: p.x, y: p.y, dir: p.dir },
        players: this.s.players.filter((q) => q.id !== p.id).map((q) => this.view(q)),
        npcs: this.geo.npcs.flatMap((n) => {
          const def = this.ix.npcs.get(n.id);
          return def ? [{ id: n.id, name: cut(def.name, 40), x: n.x, y: n.y, dir: n.dir }] : [];
        }),
        challengeZone: p.inChallenge,
        quests: p.quests.map((q) => ({ id: q.id, step: q.step, done: q.done })),
      },
    });
    if (p.party) this.sendParty(p);
    const lesson = p.lesson ? this.ix.lessons.get(p.lesson.id) : undefined;
    if (p.lesson && lesson?.kind === 'puzzles') this.sendPuzzle(p, lesson, p.lesson.index);
  }

  // ---------------------------------------------------------------------------------------------
  // Movement, warps, challenge-zone banners, areas and encounters

  private step(p: PlayerState, dir: Dir, t: number): boolean {
    if (p.battling) {
      // 10.1: a player in battle stays on their tile.
      this.zpos(p);
      return false;
    }
    p.dialog = null;
    const to = stepFrom(p.x, p.y, dir);
    if (!walkable(this.geo, to.x, to.y)) {
      // A step into a wall only turns (R-SEC-002: the client's position is never trusted).
      const turned = p.dir !== dir;
      p.dir = dir;
      this.zpos(p);
      if (turned) this.broadcast({ t: 'zstep', d: this.stepView(p) }, p.id);
      return turned;
    }
    p.x = to.x;
    p.y = to.y;
    p.dir = dir;
    this.broadcast({ t: 'zstep', d: this.stepView(p) }, p.id);
    const warp = this.geo.warps.find((w) => w.x === p.x && w.y === p.y);
    if (warp) {
      this.warpTo(p, { zone: warp.to, x: warp.toX, y: warp.toY, dir: warp.dir });
      return true;
    }
    const inside = this.inChallenge(p.x, p.y);
    if (inside !== p.inChallenge) {
      p.inChallenge = inside;
      this.send(p.id, { t: 'banner', d: { kind: 'challengeZone', inside } });
      this.out.save = true;
    }
    this.checkReach(p, t);
    if (this.geo.wild[tileIndex(this.geo, p.x, p.y)]) this.wildStep(p);
    return true;
  }

  private warpTo(p: PlayerState, dest: { zone: string; x: number; y: number; dir: Dir }): void {
    p.warping = { ...dest };
    p.dialog = null;
    this.s.challenges = this.s.challenges.filter((c) => c.from !== p.id && c.to !== p.id);
    this.out.effects.push({ kind: 'warp', id: p.id, ...dest });
    this.send(p.id, { t: 'zwarp', d: { zone: dest.zone } });
    this.out.save = true;
  }

  /** R-WORLD-002: one roll per wild step, after the grace, never while battling. */
  private wildStep(p: PlayerState): void {
    if (p.battling) return;
    if (p.grace > 0) {
      p.grace--;
      return;
    }
    const rate = encounterRate(this.def, p.keyItems, this.ix.keyItems);
    if (rate <= 0 || !(this.rng() < rate)) return;
    const entry = pickEntry(this.def.encounters, this.rng());
    if (!entry) {
      this.error(`zone ${this.def.id} has wild tiles but no encounter entries`);
      return;
    }
    const level = wildLevel(entry, p.level, this.rng());
    p.grace = Math.max(0, Math.floor(this.def.encounterGrace));
    this.s.tele.encounters++;
    this.startBattle([p], {
      kind: 'wild',
      players: [p.id],
      format: this.def.format,
      zone: this.def.id,
      entry: clone(entry),
      level,
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Chat (R-SEC-011)

  private chat(p: PlayerState, ch: ChatChannel, raw: string, to: string | undefined): boolean {
    const text = cut(sanitizeText(raw), 200);
    if (!text) return this.refuse(p, ZoneErr.bad_message);
    switch (ch) {
      case 'zone': {
        // The channel's filter level is recomputed from its current members for every message.
        const conversation = conversationFiltered(this.s.players);
        let clean: string | null = null;
        for (const r of this.s.players) {
          if (!r.live) continue;
          const filtered = viewFiltered(conversation, r);
          if (filtered) clean ??= cut(this.filter.clean(text), 200);
          this.send(r.id, {
            t: 'chatmsg',
            d: {
              ch: 'zone',
              from: p.id,
              name: p.name,
              text: filtered ? (clean ?? '') : text,
              filtered,
            },
          });
        }
        return true;
      }
      case 'party': {
        const party = p.party;
        if (!party) return this.refuse(p, ZoneErr.no_party);
        const filtered = party.minor || !p.adult;
        const msg: RoutedChat = {
          ch: 'party',
          from: p.id,
          name: p.name,
          text: filtered ? cut(this.filter.clean(text), 200) : text,
          filtered,
          fromAdult: p.adult,
          friend: true,
        };
        const members = party.members.map((m) => m.p);
        if (!members.includes(p.id)) members.push(p.id);
        this.out.effects.push({ kind: 'chat', from: p.id, to: members, msg });
        return true;
      }
      case 'whisper': {
        if (to === undefined || to === p.id) return this.refuse(p, ZoneErr.bad_target);
        const friend = p.friends.includes(to);
        if (!p.adult && !friend) return this.refuse(p, ZoneErr.friends_only);
        const q = this.byId.get(to);
        if (q && !whisperAllowed(p, q)) return this.refuse(p, ZoneErr.whisper_refused);
        const filtered = !p.adult || (q !== undefined && !q.adult);
        const msg: RoutedChat = {
          ch: 'whisper',
          from: p.id,
          name: p.name,
          text: filtered ? cut(this.filter.clean(text), 200) : text,
          filtered,
          fromAdult: p.adult,
          friend,
        };
        if (q) this.deliver(q, msg);
        else this.out.effects.push({ kind: 'chat', from: p.id, to: [to], msg });
        return true;
      }
      case 'guild':
        // Guilds arrive in M6 (10.4).
        return this.refuse(p, ZoneErr.no_guild);
    }
  }

  /** Show a routed line to `r`; false when a whisper is not allowed for this recipient. */
  private deliver(r: PlayerState, m: RoutedChat): boolean {
    if (m.ch === 'whisper' && (!m.fromAdult || !r.adult)) {
      if (!(m.friend && r.friends.includes(m.from))) return false;
    }
    const filtered = viewFiltered(m.filtered || !m.fromAdult, r);
    const text = filtered ? cut(this.filter.clean(m.text), 200) : m.text;
    this.send(r.id, {
      t: 'chatmsg',
      d: { ch: m.ch, from: m.from, name: cut(m.name, 40), text: cut(text, 200), filtered },
    });
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Challenges (10.4, R-WORLD-006)

  private challenge(p: PlayerState, to: string, format: FormatId, t: number): boolean {
    if (to === p.id) return this.refuse(p, ZoneErr.bad_target);
    const q = this.byId.get(to);
    if (!q || q.warping) return this.refuse(p, ZoneErr.not_here);
    if (p.battling) return this.refuse(p, ZoneErr.battling);
    if (q.battling) return this.refuse(p, ZoneErr.busy);
    const bracket = slotBracket(this.engine, p.level);
    if (p.inChallenge && q.inChallenge && bracket === slotBracket(this.engine, q.level)) {
      // Entering a challenge zone is consent (9.3): the battle starts at once in the zone's format.
      if (this.cooling(p, t) || this.cooling(q, t)) return this.refuse(p, ZoneErr.cooldown);
      this.startBattle([p, q], {
        kind: 'challenge',
        players: [p.id, q.id],
        format: this.def.format,
        auto: true,
      });
      return true;
    }
    // Anywhere else (or across brackets), a challenge needs the other player's consent.
    const open = this.s.challenges.filter((c) => c.from !== p.id);
    if (open.filter((c) => c.to === q.id).length >= MAX_PENDING_CHALLENGES)
      return this.refuse(p, ZoneErr.busy);
    const c = { id: `c${++this.s.seq}`, from: p.id, to: q.id, format, at: t };
    this.s.challenges = [...open, c];
    this.send(q.id, { t: 'chalIn', d: { id: c.id, from: p.id, name: p.name, format } });
    this.out.save = true;
    return true;
  }

  private challengeReply(p: PlayerState, id: string, accept: boolean): boolean {
    const c = this.s.challenges.find((x) => x.id === id && x.to === p.id);
    if (!c) return this.refuse(p, ZoneErr.no_challenge);
    this.s.challenges = this.s.challenges.filter((x) => x !== c);
    this.out.save = true;
    const from = this.byId.get(c.from);
    if (!accept) {
      if (from) this.err(from, ZoneErr.chal_declined);
      return true;
    }
    if (!from || from.warping) return this.refuse(p, ZoneErr.not_here);
    if (p.battling) return this.refuse(p, ZoneErr.battling);
    if (from.battling) return this.refuse(p, ZoneErr.busy);
    this.startBattle([from, p], {
      kind: 'challenge',
      players: [from.id, p.id],
      format: c.format,
      auto: false,
    });
    return true;
  }

  private cooling(p: PlayerState, t: number): boolean {
    return p.battleEndedAt !== null && t < p.battleEndedAt + CHALLENGE_COOLDOWN_MS;
  }

  // ---------------------------------------------------------------------------------------------
  // NPCs, lessons and quests (10.3, 10.5)

  private interact(p: PlayerState, npcId: string, t: number): boolean {
    if (p.battling) return this.refuse(p, ZoneErr.battling);
    const front = stepFrom(p.x, p.y, p.dir);
    const spots = this.geo.npcs.filter((n) => n.id === npcId);
    const spot = spots.find(
      (n) => n.x === front.x && n.y === front.y && Math.abs(n.x - p.x) + Math.abs(n.y - p.y) === 1,
    );
    if (!spot) return this.refuse(p, spots.length > 0 ? ZoneErr.too_far : ZoneErr.no_npc);
    const def = this.ix.npcs.get(npcId);
    if (!def) {
      this.error(`zone ${this.def.id} places unknown NPC ${npcId}`);
      return this.refuse(p, ZoneErr.no_npc);
    }
    this.questEvent(p, { kind: 'talk', npc: npcId }, t);
    const options = this.optionsFor(p, def);
    p.dialog = { npc: npcId, options: options.map((o) => o.id) };
    this.send(p.id, {
      t: 'dialog',
      d: {
        npc: npcId,
        name: cut(def.name, 40),
        lines: def.lines.slice(0, 20).map((l) => cut(l.replaceAll('{name}', p.name), 400)),
        options,
      },
    });
    return true;
  }

  private optionsFor(p: PlayerState, def: NpcDef): Option[] {
    const role = def.role;
    const out: Option[] = [];
    switch (role.kind) {
      case 'trainer':
        if (!(role.once && p.defeatedNpcs.includes(def.id)))
          out.push({ id: 'battle', label: 'Battle' });
        break;
      case 'teacher':
        for (const id of role.lessons) {
          const l = this.ix.lessons.get(id);
          if (!l || p.lessonsDone.includes(id)) continue;
          out.push({ id: `lesson:${id}`, label: cut(l.title, 80) });
          if (l.skippable) out.push({ id: `skip:${id}`, label: cut(`Skip: ${l.title}`, 80) });
        }
        break;
      case 'quest': {
        const q = this.ix.quests.get(role.quest);
        if (q && canAccept(q, p.quests))
          out.push({ id: `quest:${q.id}`, label: cut(`Accept: ${q.name}`, 80) });
        break;
      }
      case 'talk':
        break;
    }
    return out.filter((o) => o.id.length <= 80).slice(0, 8);
  }

  private choose(p: PlayerState, npcId: string, option: string, t: number): boolean {
    const dialog = p.dialog;
    if (!dialog || dialog.npc !== npcId || !dialog.options.includes(option))
      return this.refuse(p, ZoneErr.no_option);
    if (p.battling) return this.refuse(p, ZoneErr.battling);
    const def = this.ix.npcs.get(npcId);
    if (!def) return this.refuse(p, ZoneErr.no_npc);
    const role = def.role;
    const colon = option.indexOf(':');
    const verb = colon < 0 ? option : option.slice(0, colon);
    const arg = colon < 0 ? '' : option.slice(colon + 1);
    p.dialog = null;
    switch (verb) {
      case 'battle': {
        if (role.kind !== 'trainer') break;
        if (role.once && p.defeatedNpcs.includes(def.id)) break;
        this.startBattle([p], {
          kind: 'trainer',
          players: [p.id],
          format: role.format,
          npc: def.id,
          tier: role.tier,
          level: role.level,
        });
        return true;
      }
      case 'lesson':
      case 'skip': {
        const lesson = this.ix.lessons.get(arg);
        if (role.kind !== 'teacher' || !lesson || !role.lessons.includes(arg)) break;
        if (p.lessonsDone.includes(arg)) break;
        if (verb === 'skip') {
          // 10.3: veterans may skip the chess lessons, never the ability or element lessons.
          if (!lesson.skippable) break;
          if (p.lesson?.id === arg) p.lesson = null;
          this.completeLesson(p, lesson, true, t);
          return true;
        }
        this.startLesson(p, lesson, t);
        return true;
      }
      case 'quest': {
        const q = this.ix.quests.get(arg);
        if (role.kind !== 'quest' || role.quest !== arg || !q) break;
        const r = acceptQuest(q, p.quests, p);
        if (!r) break;
        p.quests = r.list;
        this.questUpdate(p, r.update);
        this.out.save = true;
        // Accepting from the giver is also talking to them: a leading `talk` step to this NPC
        // completes at once (DD-72), so the player is not sent back to the NPC they just spoke to.
        this.questEvent(p, { kind: 'talk', npc: npcId }, t);
        return true;
      }
    }
    return this.refuse(p, ZoneErr.no_option);
  }

  private startLesson(p: PlayerState, lesson: LessonDef, t: number): void {
    if (lesson.kind === 'battle') {
      this.startBattle([p], {
        kind: 'lesson',
        players: [p.id],
        format: lesson.format,
        lesson: lesson.id,
      });
      return;
    }
    this.out.save = true;
    if (lesson.puzzles.length === 0) {
      this.completeLesson(p, lesson, false, t);
      return;
    }
    p.lesson = { id: lesson.id, index: 0 };
    this.sendPuzzle(p, lesson, 0);
  }

  private answer(
    p: PlayerState,
    lessonId: string,
    index: number,
    move: string,
    t: number,
  ): boolean {
    const cur = p.lesson;
    if (!cur || cur.id !== lessonId || cur.index !== index)
      return this.refuse(p, ZoneErr.no_puzzle);
    const lesson = this.ix.lessons.get(cur.id);
    const puzzle = lesson?.kind === 'puzzles' ? lesson.puzzles[cur.index] : undefined;
    if (!lesson || lesson.kind !== 'puzzles' || !puzzle) {
      p.lesson = null;
      return this.refuse(p, ZoneErr.no_puzzle);
    }
    // R-WORLD-003 / R-SEC-003: the move must be listed AND legal in the position.
    const ok = puzzle.accept.includes(move) && this.legalIn(puzzle.fen).has(move);
    const last = cur.index >= lesson.puzzles.length - 1;
    if (!ok) {
      this.send(p.id, {
        t: 'lessonResult',
        d: {
          lesson: lesson.id,
          puzzle: index,
          ok: false,
          hint: cut(puzzle.hint, 400),
          done: false,
        },
      });
      return true;
    }
    this.send(p.id, {
      t: 'lessonResult',
      d: { lesson: lesson.id, puzzle: index, ok: true, done: last },
    });
    this.out.save = true;
    if (last) {
      p.lesson = null;
      this.completeLesson(p, lesson, false, t);
    } else {
      cur.index++;
      this.sendPuzzle(p, lesson, cur.index);
    }
    return true;
  }

  private legalIn(fen: string): ReadonlySet<string> {
    let set = this.legal.get(fen);
    if (set) return set;
    try {
      const { state } = this.engine.newBattle({
        format: 'full',
        white: { level: 1, loadout: SANDBOX },
        black: { level: 1, loadout: SANDBOX },
        fen,
      });
      set = new Set(this.engine.legalMoves(state, state.turn).map((m) => moveToUci(m)));
    } catch (e) {
      this.error(`puzzle position ${fen} is not playable: ${String(e)}`);
      set = new Set();
    }
    this.legal.set(fen, set);
    return set;
  }

  private sendPuzzle(p: PlayerState, lesson: Extract<LessonDef, { kind: 'puzzles' }>, i: number) {
    const puzzle = lesson.puzzles[i];
    if (!puzzle) return;
    this.send(p.id, {
      t: 'puzzle',
      d: {
        lesson: lesson.id,
        index: i,
        count: lesson.puzzles.length,
        fen: cut(puzzle.fen, 100),
        prompt: cut(puzzle.prompt, 400),
      },
    });
  }

  private completeLesson(p: PlayerState, lesson: LessonDef, skipped: boolean, t: number): void {
    if (p.lessonsDone.includes(lesson.id)) return;
    p.lessonsDone.push(lesson.id);
    this.out.effects.push({
      kind: 'lessonDone',
      id: p.id,
      lesson: lesson.id,
      reward: clone(lesson.reward),
      skipped,
    });
    this.out.save = true;
    this.questEvent(p, { kind: 'lesson', lesson: lesson.id }, t);
  }

  /** Apply one quest event (null: only settle steps met by lasting facts) and report changes. */
  private questEvent(p: PlayerState, ev: QuestEvent | null, t: number): void {
    const r = advance(this.ix.quests, p.quests, ev, p);
    if (r.updates.length > 0) {
      p.quests = r.list;
      for (const u of r.updates) this.questUpdate(p, u);
      this.out.save = true;
    }
    // A step that became current may already be met where the player stands.
    if (ev?.kind !== 'reach') this.checkReach(p, t);
  }

  private checkReach(p: PlayerState, t: number): void {
    if (!wantsReach(this.ix.quests, p.quests, this.s.zone)) return;
    const areas = this.geo.areas.filter((a) => inRect(a, p.x, p.y)).map((a) => a.name);
    if (areas.length > 0) this.questEvent(p, { kind: 'reach', zone: this.s.zone, areas }, t);
  }

  private questUpdate(p: PlayerState, u: QuestUpdate): void {
    const q: QuestProgress = { ...u.progress };
    this.send(p.id, { t: 'quest', d: { ...q, text: cut(u.text, 200) } });
    this.out.effects.push({ kind: 'quest', id: p.id, quest: q });
    if (u.completed && u.reward)
      this.out.effects.push({ kind: 'questDone', id: p.id, quest: q.id, reward: clone(u.reward) });
  }

  // ---------------------------------------------------------------------------------------------
  // Parties (routed by the host: parties span zones)

  private partyOp(p: PlayerState, d: Extract<ClientMsg, { t: 'party' }>['d']): boolean {
    switch (d.op) {
      case 'invite':
        if (d.to === p.id) return this.refuse(p, ZoneErr.bad_target);
        this.out.effects.push({
          kind: 'party',
          party: { op: 'invite', from: p.id, name: p.name, to: d.to },
        });
        return true;
      case 'reply':
        this.out.effects.push({
          kind: 'party',
          party: { op: 'reply', from: p.id, invite: d.id, accept: d.accept },
        });
        return true;
      case 'leave':
        if (!p.party) return this.refuse(p, ZoneErr.no_party);
        this.out.effects.push({ kind: 'party', party: { op: 'leave', from: p.id } });
        return true;
    }
  }

  private sendParty(p: PlayerState): void {
    const party = p.party;
    this.send(p.id, {
      t: 'party',
      d: party
        ? {
            id: party.id,
            leader: party.leader,
            members: party.members
              .slice(0, 4)
              .map((m) => ({ p: m.p, name: cut(m.name, 40), zone: m.zone })),
          }
        : { id: null, leader: null, members: [] },
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Host-driven inputs

  /** The host created the battle a `battle` effect asked for: tell the player where to connect. */
  battleStarted(
    id: string,
    info: { battleId: string; url: string; kind: BattleRequest['kind'] },
    now: number,
  ): Outbox {
    this.begin(now);
    const p = this.byId.get(id);
    if (!p) return this.flush();
    if (!p.battling) this.error(`battleStarted for ${id}, who is not battling`);
    p.battleId = info.battleId;
    this.send(p.id, { t: 'enc', d: { battleId: info.battleId, url: info.url, kind: info.kind } });
    this.out.save = true;
    return this.flush();
  }

  /**
   * The player's battle ended (`outcome`), or could not start (`null`: no cooldown, no progress).
   * Clears the battling marker, starts the 60 s challenge cooldown (R-WORLD-006), records a
   * once-only trainer as defeated, completes a battle lesson and advances quests. Ignored when the
   * player is not battling, so a repeated call changes nothing.
   */
  battleEnded(id: string, outcome: BattleOutcome | null, now: number): Outbox {
    const t = this.begin(now);
    const p = this.byId.get(id);
    if (!p || !p.battling) return this.flush();
    p.battling = false;
    p.battleId = null;
    this.out.save = true;
    this.broadcast({ t: 'zbattle', d: { p: p.id, battling: false } });
    if (!outcome) return this.flush();
    p.battleEndedAt = t;
    if (outcome.result === 'win' && outcome.kind === 'trainer' && outcome.npc) {
      const role = this.ix.npcs.get(outcome.npc)?.role;
      if (role?.kind === 'trainer' && role.once && !p.defeatedNpcs.includes(outcome.npc)) {
        p.defeatedNpcs.push(outcome.npc);
        this.out.effects.push({ kind: 'defeated', id: p.id, npc: outcome.npc });
      }
    }
    if (outcome.result === 'win' && outcome.kind === 'lesson' && outcome.lesson) {
      const lesson = this.ix.lessons.get(outcome.lesson);
      if (lesson) this.completeLesson(p, lesson, false, t);
    }
    this.questEvent(p, { kind: 'battle', outcome }, t);
    return this.flush();
  }

  /** A party or whisper line routed from another zone core (a `chat` effect). */
  deliverChat(toId: string, msg: RoutedChat, now: number): Outbox {
    this.begin(now);
    const r = this.byId.get(toId);
    if (!r ? msg.ch === 'whisper' : !this.deliver(r, msg))
      this.out.effects.push({ kind: 'bounce', to: msg.from, code: ZoneErr.whisper_refused });
    return this.flush();
  }

  /** A whisper from this player could not be delivered (a `bounce` effect, or the target is offline). */
  chatRefused(id: string, now: number): Outbox {
    this.begin(now);
    const p = this.byId.get(id);
    if (p) this.err(p, ZoneErr.whisper_refused);
    return this.flush();
  }

  /** Tell the player why a host-side request failed (a party invite or reply, a battle start). */
  notice(id: string, code: ZoneErrCode, now: number): Outbox {
    this.begin(now);
    const p = this.byId.get(id);
    if (p) this.err(p, code);
    return this.flush();
  }

  /** The player's party changed (or `null`: no party). Call it for every member on any change. */
  setParty(id: string, party: PartyView | null, now: number): Outbox {
    this.begin(now);
    const p = this.byId.get(id);
    if (!p) return this.flush();
    p.party = party ? clone(party) : null;
    this.sendParty(p);
    this.out.save = true;
    return this.flush();
  }

  /** Show a party invitation (`id` is the host's invite id, answered with `party {op:'reply'}`). */
  partyInvite(
    toId: string,
    invite: { id: string; from: string; name: string },
    now: number,
  ): Outbox {
    this.begin(now);
    if (this.byId.has(toId))
      this.send(toId, {
        t: 'partyInvite',
        d: { id: invite.id, from: invite.from, name: cut(invite.name, 40) },
      });
    return this.flush();
  }

  /** Move the player to another zone (party travel): like a warp tile. */
  travel(id: string, dest: { zone: string; x: number; y: number; dir: Dir }, now: number): Outbox {
    this.begin(now);
    const p = this.byId.get(id);
    if (p && !p.warping && !p.battling) this.warpTo(p, dest);
    return this.flush();
  }

  /**
   * The host granted a reward (quest, lesson, trainer); `level` is the player's level after it.
   * Key items apply at once (encounter multipliers).
   */
  grant(id: string, reward: Reward, level: number, now: number): Outbox {
    this.begin(now);
    const p = this.byId.get(id);
    if (!p) return this.flush();
    const newLevel = Number.isInteger(level) ? Math.min(100, Math.max(1, level)) : p.level;
    const levelUp = newLevel > p.level;
    p.level = newLevel;
    p.keyItems = union(p.keyItems, reward.keyItems ?? []);
    this.send(p.id, {
      t: 'reward',
      d: {
        xp: Math.max(0, Math.floor(reward.xp)),
        level: p.level,
        levelUp,
        items: (reward.items ?? []).map((i) => ({ id: i.id, qty: i.qty })),
        cards: (reward.cards ?? []).map((c) => ({ id: c.id, qty: c.qty })),
        keyItems: [...(reward.keyItems ?? [])],
        coins: Math.max(0, Math.floor(reward.coins ?? 0)),
      },
    });
    this.out.save = true;
    return this.flush();
  }

  /** Report the telemetry counters now (e.g. when the last player leaves). */
  flushTelemetry(now: number): Outbox {
    this.begin(now);
    this.emitTelemetry();
    return this.flush();
  }

  // ---------------------------------------------------------------------------------------------
  // Internals

  private startBattle(players: PlayerState[], battle: BattleRequest): void {
    const ref = `${this.s.zone}#${this.s.channel}:${++this.s.seq}`;
    for (const p of players) {
      p.battling = true;
      p.battleId = null;
      p.dialog = null;
    }
    for (const p of players) this.broadcast({ t: 'zbattle', d: { p: p.id, battling: true } });
    this.out.effects.push({ kind: 'battle', ref, battle });
    this.s.tele.battles++;
    this.out.save = true;
  }

  private refresh(p: PlayerState, init: PlayerInit): void {
    p.name = init.name;
    p.level = init.level;
    p.adult = init.adult;
    p.friends = [...init.friends];
    p.filterChat = init.filterChat;
    p.party = init.party ? clone(init.party) : null;
    p.keyItems = union(p.keyItems, init.keyItems);
    p.lessonsDone = union(p.lessonsDone, init.lessonsDone);
    p.defeatedNpcs = union(p.defeatedNpcs, init.defeatedNpcs);
    for (const q of init.quests) {
      const mine = p.quests.find((x) => x.id === q.id);
      if (!mine) p.quests.push({ ...q });
      else if (q.done || q.step > mine.step) Object.assign(mine, q);
    }
    p.live = false;
    for (const b of Object.values(p.buckets)) b.strikes = 0;
  }

  private startPosition(init: PlayerInit): { x: number; y: number; dir: Dir } {
    const { x, y } = init;
    if (
      x !== undefined &&
      y !== undefined &&
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      walkable(this.geo, x, y)
    )
      return { x, y, dir: init.dir ?? this.geo.spawn.dir };
    return { ...this.geo.spawn };
  }

  private inChallenge(x: number, y: number): boolean {
    return this.geo.challenge.some((r) => inRect(r, x, y));
  }

  private view(p: PlayerState) {
    return {
      p: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      dir: p.dir,
      battling: p.battling,
      level: p.level,
    };
  }

  private stepView(p: PlayerState) {
    return { p: p.id, x: p.x, y: p.y, dir: p.dir };
  }

  private begin(now: number): number {
    const t = Math.max(checkTime(now), this.s.now);
    if (this.s.now === 0) this.s.tele.from = t;
    this.s.tele.playerMs += this.s.players.length * (t - this.s.now);
    this.s.now = t;
    this.out = emptyOutbox();
    const before = this.s.challenges.length;
    this.s.challenges = this.s.challenges.filter((c) => t < c.at + CHALLENGE_TTL_MS);
    if (this.s.challenges.length !== before) this.out.save = true;
    return t;
  }

  private flush(): Outbox {
    if (this.s.now - this.s.tele.from >= TELEMETRY_WINDOW_MS) this.emitTelemetry();
    const out = this.out;
    this.out = emptyOutbox();
    return out;
  }

  private emitTelemetry(): void {
    const s = this.s;
    const tele = s.tele;
    const report: ZoneTelemetry = {
      zone: s.zone,
      channel: s.channel,
      from: tele.from,
      to: s.now,
      players: s.players.length,
      playerMs: tele.playerMs,
      in: { ...tele.in },
      out: { ...tele.out },
      dropped: { ...tele.dropped },
      encounters: tele.encounters,
      battles: tele.battles,
    };
    this.out.effects.push({ kind: 'telemetry', report });
    s.tele = freshTele(s.now);
  }

  private send(to: string, msg: ServerMsg): void {
    this.out.send.push({ to, msg });
    const tout = this.s.tele.out;
    tout[msg.t] = (tout[msg.t] ?? 0) + 1;
    this.observe?.(to, msg);
  }

  /** To every player who said hello on their current socket, except `except`. */
  private broadcast(msg: ServerMsg, except?: string): void {
    for (const p of this.s.players) if (p.live && p.id !== except) this.send(p.id, msg);
  }

  private zpos(p: PlayerState): void {
    this.send(p.id, { t: 'zpos', d: { x: p.x, y: p.y, dir: p.dir } });
  }

  private err(p: PlayerState, code: ZoneErrCode): void {
    this.send(p.id, { t: 'err', d: { code } });
  }

  private refuse(p: PlayerState, code: ZoneErrCode): false {
    this.err(p, code);
    return false;
  }

  private checkStrikes(p: PlayerState): void {
    const b = p.buckets;
    if (tooManyStrikes(b.step) || tooManyStrikes(b.chat) || tooManyStrikes(b.other))
      this.out.effects.push({
        kind: 'close',
        id: p.id,
        code: CLOSE_POLICY,
        reason: 'too many invalid or excess messages',
      });
  }

  private error(message: string): void {
    this.out.effects.push({ kind: 'error', message });
  }
}
