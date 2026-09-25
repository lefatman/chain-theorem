/**
 * The zone socket on the client (M5, spec 10.1–10.5, 13.4). The ZoneRoom decides movement,
 * encounters, lesson results, quests and rewards (R-SEC-003); the client asks and draws.
 *
 * - Every (re)connect asks for a fresh world ticket (R-SEC-006), sends `hello` and waits for `zsnap`.
 * - Own steps are predicted at once (at most 8 per second, R-SEC-005; one tile per STEP_MS). A wall
 *   bump predicts a turn, which the zone answers with `zpos`; any other `zpos` is a refusal: the
 *   client snaps to it and re-syncs with `hello`, because steps still in flight moved on from there.
 * - Other players' `zstep`s are interpolated over STEP_MS from where they are drawn.
 * - `zwarp` closes the socket and reconnects with a new ticket for the new zone (warps, party travel).
 * - `enc` hands over to the battle screen; the world waits (the player stays on their tile with a
 *   battling marker, 10.1) and continues when the battle ends.
 *
 * No DOM and no router here: the host passes the ticket, the zone maps and the battle hand-off.
 */
import { signal } from '@preact/signals';
import {
  ClientZone,
  LIMITS,
  ServerZone,
  Uci,
  decode,
  encode,
  newBucket,
  take,
  type Bucket,
  type Channel,
  type Dir,
  type Format,
  type Msg,
  type ServerZoneMap,
} from '@chain-theorem/protocol';
import { stepFrom, walkable, type ZoneGeometry } from '@chain-theorem/content/world';

/** One tile of walking (ms): 6.7 steps per second, under the 8 per second limit (R-SEC-005). */
export const STEP_MS = 150;
/** Minimum gap between any two step messages, turns included: never more than 8 per second. */
export const STEP_GAP_MS = 1000 / LIMITS.step.rate;
/** Chat lines kept per channel. */
export const CHAT_KEEP = 100;
/** Toasts kept at once (older ones drop). */
export const TOAST_KEEP = 5;
/** An expected wall-bump answer older than this is forgotten. */
const TURN_EXPIRY_MS = 2000;
/** Minimum pause between two chat sends (on top of the 1/s token bucket). */
const CHAT_PAUSE_MS = 400;

export interface TilePos {
  x: number;
  y: number;
  dir: Dir;
}

/** Something that walks: its tile, where the current step started and when. */
export interface Mover extends TilePos {
  /** Drawn position (tiles, may be fractional) when the current step began. */
  fromX: number;
  fromY: number;
  /** Local time (ms) the current step began; it lasts STEP_MS. */
  at: number;
  /** Steps taken (walk-cycle parity). */
  steps: number;
}

export interface WorldPlayer extends Mover {
  p: string;
  name: string;
  level: number;
  battling: boolean;
}

export interface WorldSelf extends Mover {
  p: string;
}

export interface WorldNpc extends TilePos {
  id: string;
  name: string;
}

export interface RosterEntry {
  p: string;
  name: string;
  level: number;
  battling: boolean;
}

export interface ChatLine {
  id: number;
  ch: Channel;
  from: string;
  name: string;
  text: string;
  filtered: boolean;
  /** Sent by this player (whispers are echoed locally; the zone echoes zone and party lines). */
  own: boolean;
  /** Whisper recipient (own whispers). */
  to?: string;
  toName?: string;
}

export interface DialogOption {
  id: string;
  label: string;
}

export interface WorldDialog {
  npc: string;
  name: string;
  lines: string[];
  options: DialogOption[];
  /** Drawn by the client (a sign): closing it sends nothing. */
  local?: boolean;
}

export type PuzzleStatus = 'solving' | 'checking' | 'wrong' | 'done';

export interface PuzzleView {
  lesson: string;
  index: number;
  count: number;
  fen: string;
  prompt: string;
  status: PuzzleStatus;
  /** Shown after a wrong answer. */
  hint: string | null;
  /** The teacher who gave the lesson (a skip goes through them). */
  npc: string | null;
  skippable: boolean;
}

export interface QuestView {
  id: string;
  step: number;
  done: boolean;
  /** Current step text from the zone; null until a `quest` message names it. */
  text: string | null;
}

export interface PartyView {
  id: string;
  leader: string | null;
  members: { p: string; name: string; zone: string | null }[];
}

type ServerMsg = Msg<ServerZoneMap>;
type ClientMsg = Msg<typeof ClientZone>;
/** The data of one server message type. */
type Data<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>['d'];

export type Reward = Data<'reward'>;
export type Encounter = Data<'enc'>;
export type ChallengeIn = Data<'chalIn'>;
export type PartyInvite = Data<'partyInvite'>;

export type ToastInput =
  { kind: 'reward'; reward: Reward } | { kind: 'info' | 'error'; text: string };
export type Toast = ToastInput & { id: number };

export type Connection = 'connecting' | 'open' | 'reconnecting' | 'warping' | 'closed';

/** The subset of WebSocket this controller uses (tests pass a fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code?: number } | unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface WorldOptions {
  /** `POST /api/world/ticket`, called for every connect (R-SEC-006). */
  ticket(): Promise<{ zone: string; url: string }>;
  /** Turn a ticket's socket path into a WebSocket URL (default: as is). */
  socketUrl?(path: string): string;
  /** Geometry of a zone's map, for prediction and drawing; null when the client has none. */
  geometry?(zone: string): Promise<ZoneGeometry | null>;
  /** Open the battle screen for an encounter; resolve when that battle has ended. */
  onEncounter?(enc: Encounter): Promise<void> | void;
  /** A reward arrived (account level and progress refresh). */
  onReward?(reward: Reward): void;
  /** Lessons the content marks skippable (chess lessons, 10.3). */
  skippable?(lesson: string): boolean;
  /** The player's own chat filter choice, sent after every hello (R-SEC-011); unset = default. */
  filterChat?: boolean;
  socketFactory?: (url: string) => SocketLike;
  now?: () => number;
  /** Reconnect delays in ms; the last one repeats. */
  backoff?: readonly number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const OPEN = 1;
/** Zone close codes that must not trigger an automatic reconnect (ZoneRoom). */
export const CLOSE_REPLACED = 4000;
export const CLOSE_POLICY = 1008;
/** Every chat channel, in tab order. */
export const CHANNELS: readonly Channel[] = ['zone', 'party', 'guild', 'whisper'];

const emptyChat = (): Record<Channel, ChatLine[]> => ({
  zone: [],
  party: [],
  guild: [],
  whisper: [],
});

/** Drawn position of a mover at time `now` (tiles): linear over STEP_MS from the step start. */
export function drawnPos(m: Mover, now: number): { x: number; y: number; moving: boolean } {
  const t = (now - m.at) / STEP_MS;
  if (!(t < 1) || t < 0) return { x: m.x, y: m.y, moving: false };
  return { x: m.fromX + (m.x - m.fromX) * t, y: m.fromY + (m.y - m.fromY) * t, moving: true };
}

/** The four neighbours of a tile, as the direction to face them. */
const DIRS: readonly Dir[] = ['n', 's', 'e', 'w'];

/** Friendly text for zone error codes. */
const ERRORS: Record<string, string> = {
  rate_limited: 'Slow down a little.',
  battling: 'Not while you are in a battle.',
  busy: 'That player is busy.',
  cooldown: 'Challenges wait 60 seconds after a battle.',
  not_here: 'That player is not here any more.',
  bad_target: 'You cannot do that to yourself.',
  no_npc: 'There is nobody there to talk to.',
  too_far: 'Stand in front of them to talk.',
  no_option: 'That option is not available now.',
  no_puzzle: 'That puzzle is no longer open.',
  no_challenge: 'That challenge is no longer open.',
  chal_declined: 'Your challenge was declined.',
  no_party: 'You are not in a party.',
  no_guild: 'Guild chat arrives with guilds.',
  friends_only: 'Players under 18 can whisper friends only.',
  whisper_refused: 'That player cannot receive your whispers.',
  party_full: 'That party is full.',
  in_party: 'That player is already in a party.',
  not_online: 'That player is not online.',
  invite_expired: 'That party invitation has expired.',
  battle_failed: 'The battle could not start. Try again.',
};

export function errorText(code: string, msg?: string): string {
  return ERRORS[code] ?? msg ?? `Something went wrong (${code}).`;
}

export class WorldController {
  readonly connection = signal<Connection>('connecting');
  /** Current zone and channel (null before the first snapshot). */
  readonly zone = signal<{ id: string; channel: number } | null>(null);
  /** Map geometry of the current zone (null while loading or when the client has no map). */
  readonly geometry = signal<ZoneGeometry | null>(null);
  /** Own position, predicted. */
  readonly me = signal<WorldSelf | null>(null);
  /** Other players with positions (changes on every step: the scene reads it). */
  readonly players = signal<ReadonlyMap<string, WorldPlayer>>(new Map());
  /** Other players without positions (changes on join, leave and battling only: panels read it). */
  readonly roster = signal<readonly RosterEntry[]>([]);
  readonly npcs = signal<readonly WorldNpc[]>([]);
  /** True while standing in a challenge zone (10.4, R-WORLD-006). */
  readonly challengeZone = signal(false);
  /** The last challenge-zone banner (entering or leaving). */
  readonly banner = signal<{ inside: boolean; at: number } | null>(null);
  readonly chat = signal<Record<Channel, ChatLine[]>>(emptyChat());
  readonly unread = signal<Record<Channel, number>>({ zone: 0, party: 0, guild: 0, whisper: 0 });
  /** Local time from which chat may be sent again (rate-limit friendly UI). */
  readonly chatReadyAt = signal(0);
  readonly dialog = signal<WorldDialog | null>(null);
  readonly puzzle = signal<PuzzleView | null>(null);
  readonly quests = signal<readonly QuestView[]>([]);
  readonly party = signal<PartyView | null>(null);
  readonly challenges = signal<readonly ChallengeIn[]>([]);
  readonly invites = signal<readonly PartyInvite[]>([]);
  readonly toasts = signal<readonly Toast[]>([]);
  /** The battle this player is in, started from the world (null in the world). */
  readonly battle = signal<Encounter | null>(null);
  /** True while the zone shows this player as battling. */
  readonly battling = signal(false);
  /** Selected player (scene tap or list), for the player actions panel. */
  readonly selected = signal<string | null>(null);
  readonly filterChat = signal<boolean | undefined>(undefined);
  /** A message for the status line (connection problems). */
  readonly notice = signal<string | null>(null);

  private readonly opts: WorldOptions;
  private socket: SocketLike | null = null;
  private attempts = 0;
  private timer: unknown = null;
  private disposed = false;
  private seq = 0;
  private chatSeq = 0;
  private toastSeq = 0;
  /** Hello sent, snapshot not yet received: steps wait (they would be predicted from a stale tile). */
  private awaitingSnap = true;
  /** Stepped onto a warp tile: the zone is about to move us. */
  private warpPending = false;
  /** Wall bumps sent, each answered by a `zpos` equal to the prediction. */
  private expectTurns: (TilePos & { at: number })[] = [];
  private readonly stepBucket: Bucket;
  private readonly chatBucket: Bucket;
  /** Local time the last step message went out. */
  private lastStepAt = -Infinity;
  /** The teacher of each lesson, remembered from the dialog that started it. */
  private readonly lessonNpc = new Map<string, string>();
  private readonly skipOffered = new Set<string>();
  /** A dialog to swallow (the automatic re-interact of a lesson skip). */
  private swallowDialog: string | null = null;
  private geoZone: string | null = null;

  constructor(opts: WorldOptions) {
    this.opts = opts;
    const now = this.now();
    this.stepBucket = newBucket(LIMITS.step, now);
    this.chatBucket = newBucket(LIMITS.chat, now);
    this.filterChat.value = opts.filterChat;
    void this.connect();
  }

  now(): number {
    return this.opts.now ? this.opts.now() : performance.now();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  // ---- connection -------------------------------------------------------------------------------

  private async connect(): Promise<void> {
    if (this.disposed) return;
    if (this.connection.value !== 'warping')
      this.connection.value = this.attempts === 0 ? 'connecting' : 'reconnecting';
    let ticket: { zone: string; url: string };
    try {
      ticket = await this.opts.ticket();
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 401 || status === 403) {
        this.stop('Sign in to enter the world.');
        return;
      }
      this.retry();
      return;
    }
    if (this.disposed) return;
    const url = this.opts.socketUrl ? this.opts.socketUrl(ticket.url) : ticket.url;
    const ws = this.opts.socketFactory
      ? this.opts.socketFactory(url)
      : (new WebSocket(url) as unknown as SocketLike);
    this.socket = ws;
    this.awaitingSnap = true;
    ws.onopen = () => {
      if (this.socket !== ws) return;
      this.attempts = 0;
      this.notice.value = null;
      this.send({ t: 'hello', d: {} });
      const f = this.filterChat.value;
      if (f !== undefined) this.send({ t: 'prefs', d: { filterChat: f } });
    };
    ws.onmessage = (ev) => {
      if (this.socket === ws) this.receive(ev.data);
    };
    ws.onclose = (ev) => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (this.disposed) return;
      const code = (ev as { code?: number } | null)?.code;
      // 4000: this player opened the world elsewhere (another tab or device); reconnecting would
      // take the zone back from it, and the two would take turns forever.
      if (code === CLOSE_REPLACED) {
        this.stop('The world is open in another tab or window.');
        return;
      }
      // 1008: the zone closed us for a policy reason (too many refused messages); don't hammer it.
      if (code === CLOSE_POLICY) {
        this.stop('The zone closed the connection.');
        return;
      }
      this.retry();
    };
    ws.onerror = () => undefined;
  }

  private retry(): void {
    if (this.disposed) return;
    const delays = this.opts.backoff ?? [500, 1000, 2000, 4000, 8000];
    const ms = delays[Math.min(this.attempts, delays.length - 1)] ?? 8000;
    this.attempts++;
    this.connection.value = 'reconnecting';
    const set = this.opts.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t));
    this.timer = set(() => {
      this.timer = null;
      void this.connect();
    }, ms);
  }

  private stop(notice: string): void {
    this.connection.value = 'closed';
    this.notice.value = notice;
  }

  /** Try again now (after a `closed` connection). */
  reconnect(): void {
    if (this.disposed || this.socket) return;
    this.clearRetry();
    this.attempts = 0;
    void this.connect();
  }

  private clearRetry(): void {
    if (this.timer === null) return;
    const clear =
      this.opts.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
    clear(this.timer);
    this.timer = null;
  }

  private send(msg: ClientMsg): boolean {
    const ws = this.socket;
    if (!ws || ws.readyState !== OPEN) return false;
    ws.send(encode(ClientZone, { ...msg, s: this.seq++ } as ClientMsg));
    return true;
  }

  private receive(raw: unknown): void {
    const msg = decode(ServerZone, raw, Number.POSITIVE_INFINITY);
    if (msg) this.handle(msg);
  }

  // ---- server messages --------------------------------------------------------------------------

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case 'zsnap':
        this.snapshot(msg.d);
        break;
      case 'zstep': {
        const d = msg.d;
        const me = this.me.value;
        if (me && d.p === me.p) break; // the zone never echoes own steps; ignore if it does
        const cur = this.players.value.get(d.p);
        if (!cur) break;
        const next = new Map(this.players.value);
        next.set(d.p, this.moved(cur, d));
        this.players.value = next;
        break;
      }
      case 'zpos':
        this.correct(msg.d);
        break;
      case 'zjoin': {
        const d = msg.d;
        const me = this.me.value;
        if (me && d.p === me.p) break;
        const next = new Map(this.players.value);
        next.set(d.p, { ...d, fromX: d.x, fromY: d.y, at: -Infinity, steps: 0 });
        this.players.value = next;
        this.updateRoster();
        break;
      }
      case 'zleave': {
        if (!this.players.value.has(msg.d.p)) break;
        const next = new Map(this.players.value);
        next.delete(msg.d.p);
        this.players.value = next;
        if (this.selected.value === msg.d.p) this.selected.value = null;
        this.updateRoster();
        break;
      }
      case 'zbattle': {
        const d = msg.d;
        const me = this.me.value;
        if (me && d.p === me.p) {
          this.battling.value = d.battling;
          if (!d.battling) this.battle.value = null;
          break;
        }
        const cur = this.players.value.get(d.p);
        if (!cur) break;
        const next = new Map(this.players.value);
        next.set(d.p, { ...cur, battling: d.battling });
        this.players.value = next;
        this.updateRoster();
        break;
      }
      case 'zwarp':
        this.warp();
        break;
      case 'chatmsg': {
        const d = msg.d;
        const own = d.from === this.me.value?.p;
        this.addChat({ ...d, own });
        break;
      }
      case 'enc':
        this.encounter(msg.d);
        break;
      case 'chalIn':
        this.challenges.value = [...this.challenges.value.filter((c) => c.id !== msg.d.id), msg.d];
        break;
      case 'banner':
        this.challengeZone.value = msg.d.inside;
        this.banner.value = { inside: msg.d.inside, at: this.now() };
        break;
      case 'dialog': {
        const d = msg.d;
        if (this.swallowDialog === d.npc) {
          this.swallowDialog = null;
          break;
        }
        for (const o of d.options)
          if (o.id.startsWith('skip:')) this.skipOffered.add(o.id.slice('skip:'.length));
        this.faceNpc(d.npc);
        this.dialog.value = { npc: d.npc, name: d.name, lines: d.lines, options: d.options };
        break;
      }
      case 'puzzle': {
        const d = msg.d;
        const cur = this.puzzle.value;
        // A re-sent puzzle (reconnect) keeps its hint and status.
        if (cur && cur.lesson === d.lesson && cur.index === d.index && cur.status !== 'checking')
          break;
        this.dialog.value = null;
        this.puzzle.value = {
          ...d,
          status: 'solving',
          hint: null,
          npc: this.lessonNpc.get(d.lesson) ?? null,
          skippable: this.canSkip(d.lesson),
        };
        break;
      }
      case 'lessonResult': {
        const d = msg.d;
        const cur = this.puzzle.value;
        if (!cur || cur.lesson !== d.lesson || cur.index !== d.puzzle) break;
        if (!d.ok) this.puzzle.value = { ...cur, status: 'wrong', hint: d.hint ?? null };
        else if (d.done) this.puzzle.value = { ...cur, status: 'done', hint: null };
        // A right answer that is not the last: the next `puzzle` follows.
        break;
      }
      case 'quest': {
        const d = msg.d;
        const rest = this.quests.value.filter((q) => q.id !== d.id);
        this.quests.value = [
          ...rest,
          { id: d.id, step: d.step, done: d.done, text: d.text || null },
        ];
        break;
      }
      case 'reward':
        this.toast({ kind: 'reward', reward: msg.d });
        this.opts.onReward?.(msg.d);
        break;
      case 'party': {
        const d = msg.d;
        this.party.value =
          d.id === null ? null : { id: d.id, leader: d.leader, members: d.members };
        if (d.id !== null) this.invites.value = [];
        break;
      }
      case 'partyInvite':
        this.invites.value = [...this.invites.value.filter((i) => i.id !== msg.d.id), msg.d];
        break;
      case 'err': {
        const d = msg.d;
        this.swallowDialog = null;
        if (d.code === 'no_puzzle') this.puzzle.value = null;
        if (d.code !== 'bad_message') this.toast({ kind: 'error', text: errorText(d.code, d.msg) });
        break;
      }
    }
  }

  private snapshot(d: Data<'zsnap'>): void {
    const prevZone = this.zone.value?.id;
    this.zone.value = { id: d.zone, channel: d.channel };
    this.me.value = {
      p: d.you.p,
      x: d.you.x,
      y: d.you.y,
      dir: d.you.dir,
      fromX: d.you.x,
      fromY: d.you.y,
      at: -Infinity,
      steps: this.me.value?.steps ?? 0,
    };
    const players = new Map<string, WorldPlayer>();
    for (const p of d.players) {
      if (p.p === d.you.p) continue;
      players.set(p.p, { ...p, fromX: p.x, fromY: p.y, at: -Infinity, steps: 0 });
    }
    this.players.value = players;
    this.updateRoster();
    this.npcs.value = d.npcs;
    this.challengeZone.value = d.challengeZone;
    const known = new Map(this.quests.value.map((q) => [q.id, q]));
    this.quests.value = d.quests.map((q) => {
      const k = known.get(q.id);
      return { ...q, text: k && k.step === q.step ? k.text : null };
    });
    if (this.selected.value && !players.has(this.selected.value)) this.selected.value = null;
    if (prevZone !== d.zone) {
      this.dialog.value = null;
      this.challenges.value = [];
    }
    this.expectTurns = [];
    this.awaitingSnap = false;
    this.warpPending = false;
    this.connection.value = 'open';
    this.loadGeometry(d.zone);
  }

  private loadGeometry(zone: string): void {
    if (this.geoZone === zone) return;
    this.geoZone = zone;
    this.geometry.value = null;
    const load = this.opts.geometry;
    if (!load) return;
    void load(zone).then(
      (g) => {
        if (this.geoZone === zone && !this.disposed) this.geometry.value = g;
      },
      () => undefined,
    );
  }

  private moved<M extends Mover>(cur: M, to: TilePos): M {
    const now = this.now();
    const from = drawnPos(cur, now);
    const dist = Math.abs(to.x - cur.x) + Math.abs(to.y - cur.y);
    if (dist === 0) return { ...cur, dir: to.dir };
    // A jump (a warp inside the zone, a missed step) is drawn at once, not slid.
    if (dist > 1) return { ...cur, ...to, fromX: to.x, fromY: to.y, at: -Infinity };
    return { ...cur, ...to, fromX: from.x, fromY: from.y, at: now, steps: cur.steps + 1 };
  }

  private correct(d: TilePos): void {
    if (this.awaitingSnap) return; // the snapshot on its way is authoritative
    const now = this.now();
    this.expectTurns = this.expectTurns.filter((e) => now - e.at < TURN_EXPIRY_MS);
    const first = this.expectTurns[0];
    if (first && first.x === d.x && first.y === d.y && first.dir === d.dir) {
      this.expectTurns.shift();
      return;
    }
    // A refused step: snap back, then re-sync, since steps sent after it moved on from here.
    const me = this.me.value;
    if (me) this.me.value = { ...me, ...d, fromX: d.x, fromY: d.y, at: -Infinity };
    this.expectTurns = [];
    if (this.send({ t: 'hello', d: {} })) this.awaitingSnap = true;
  }

  private warp(): void {
    this.connection.value = 'warping';
    this.dialog.value = null;
    this.puzzle.value = null;
    this.warpPending = true;
    const ws = this.socket;
    this.socket = null;
    ws?.close(1000, 'warp');
    this.clearRetry();
    this.attempts = 0;
    void this.connect();
  }

  private encounter(enc: Encounter): void {
    this.battle.value = enc;
    this.battling.value = true;
    this.dialog.value = null;
    this.challenges.value = [];
    const cur = this.puzzle.value;
    if (cur && cur.status === 'done') this.puzzle.value = null;
    const done = this.opts.onEncounter?.(enc);
    if (done)
      void done.then(
        () => this.battleOver(enc.battleId),
        () => this.battleOver(enc.battleId),
      );
  }

  /** The battle screen reports that the battle started from the world has ended. */
  battleOver(battleId: string): void {
    if (this.battle.value?.battleId !== battleId) return;
    this.battle.value = null;
    this.battling.value = false;
  }

  private updateRoster(): void {
    this.roster.value = [...this.players.value.values()]
      .map((p) => ({ p: p.p, name: p.name, level: p.level, battling: p.battling }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private addChat(line: Omit<ChatLine, 'id'>): void {
    const all = this.chat.value;
    const list = [...all[line.ch], { ...line, id: ++this.chatSeq }].slice(-CHAT_KEEP);
    this.chat.value = { ...all, [line.ch]: list };
    if (!line.own)
      this.unread.value = { ...this.unread.value, [line.ch]: this.unread.value[line.ch] + 1 };
  }

  private toast(t: ToastInput): void {
    this.toasts.value = [...this.toasts.value, { ...t, id: ++this.toastSeq }].slice(-TOAST_KEEP);
  }

  private canSkip(lesson: string): boolean {
    return this.skipOffered.has(lesson) || this.opts.skippable?.(lesson) === true;
  }

  /** Face an NPC that just started talking (cosmetic: they turn to the player). */
  private faceNpc(npc: string): void {
    const me = this.me.value;
    if (!me) return;
    const n = this.npcs.value.find((x) => x.id === npc);
    if (!n) return;
    const dx = me.x - n.x;
    const dy = me.y - n.y;
    const dir: Dir =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'e' : 'w') : dy > 0 ? 's' : dy < 0 ? 'n' : n.dir;
    if (dir !== n.dir) this.npcs.value = this.npcs.value.map((x) => (x === n ? { ...x, dir } : x));
  }

  // ---- movement ---------------------------------------------------------------------------------

  /** Why the player cannot walk now (null = free). */
  blocked(): string | null {
    if (this.connection.value !== 'open' || this.awaitingSnap || !this.me.value) return 'offline';
    if (this.warpPending) return 'warping';
    if (this.battle.value || this.battling.value) return 'battling';
    if (this.dialog.value) return 'dialog';
    const pz = this.puzzle.value;
    if (pz && pz.status !== 'done') return 'puzzle';
    return null;
  }

  /** Milliseconds until the next step may start (0 = now). */
  stepReadyIn(): number {
    const me = this.me.value;
    if (!me) return STEP_MS;
    const now = this.now();
    return Math.max(0, me.at + STEP_MS - now, this.lastStepAt + STEP_GAP_MS - now);
  }

  /** Send one step message if the 8/s limit allows it (R-SEC-005). */
  private sendStep(dir: Dir, now: number): boolean {
    if (now - this.lastStepAt < STEP_GAP_MS) return false;
    if (!take(this.stepBucket, LIMITS.step, now)) return false;
    this.lastStepAt = now;
    return this.send({ t: 'step', d: { dir } });
  }

  /**
   * One step intent (R-SEC-005: at most one per STEP_MS and 8 per second). Walls turn the player
   * without moving (the zone answers that with `zpos`). Returns true when a step was sent.
   */
  step(dir: Dir): boolean {
    if (this.blocked() !== null) return false;
    const me = this.me.value;
    if (!me || this.stepReadyIn() > 0) return false;
    const now = this.now();
    const geo = this.geometry.value;
    const to = stepFrom(me.x, me.y, dir);
    const open = geo ? walkable(geo, to.x, to.y) : to.x >= 0 && to.y >= 0;
    if (!open) {
      if (me.dir === dir || !this.sendStep(dir, now)) return false;
      this.me.value = { ...me, dir };
      this.expectTurns.push({ x: me.x, y: me.y, dir, at: now });
      return true;
    }
    if (!this.sendStep(dir, now)) return false;
    this.me.value = {
      ...me,
      x: to.x,
      y: to.y,
      dir,
      fromX: me.x,
      fromY: me.y,
      at: now,
      steps: me.steps + 1,
    };
    if (geo?.warps.some((w) => w.x === to.x && w.y === to.y)) this.warpPending = true;
    return true;
  }

  /** The tile the player faces. */
  facing(): { x: number; y: number } | null {
    const me = this.me.value;
    return me ? stepFrom(me.x, me.y, me.dir) : null;
  }

  /**
   * Interact with what the player faces (E / space / the action button): an NPC (the zone answers
   * with `dialog`), a sign (read locally) or a player (select them). An NPC next to the player
   * but not in front is turned to first.
   */
  interact(): boolean {
    if (this.blocked() !== null) return false;
    const me = this.me.value;
    const front = this.facing();
    if (!me || !front) return false;
    const npc = this.npcs.value.find((n) => n.x === front.x && n.y === front.y);
    if (npc) return this.send({ t: 'interact', d: { npc: npc.id } });
    const sign = this.geometry.value?.signs.find((s) => s.x === front.x && s.y === front.y);
    if (sign) {
      this.dialog.value = {
        npc: `sign:${sign.x},${sign.y}`,
        name: 'Sign',
        lines: [sign.text],
        options: [],
        local: true,
      };
      return true;
    }
    const player = [...this.players.value.values()].find((p) => p.x === front.x && p.y === front.y);
    if (player) {
      this.selected.value = player.p;
      return true;
    }
    for (const d of DIRS) {
      const t = stepFrom(me.x, me.y, d);
      const n = this.npcs.value.find((x) => x.x === t.x && x.y === t.y);
      if (n) return this.talkTo(n.id);
    }
    return false;
  }

  /** Talk to an NPC standing next to the player (turning to face them first). */
  talkTo(npcId: string): boolean {
    if (this.blocked() !== null) return false;
    const me = this.me.value;
    const n = this.npcs.value.find((x) => x.id === npcId);
    if (!me || !n) return false;
    const dir = DIRS.find((d) => {
      const t = stepFrom(me.x, me.y, d);
      return t.x === n.x && t.y === n.y;
    });
    if (!dir) {
      this.toast({ kind: 'info', text: `Walk up to ${n.name} to talk.` });
      return false;
    }
    if (me.dir !== dir) {
      const now = this.now();
      if (!this.sendStep(dir, now)) return false;
      this.me.value = { ...me, dir };
      this.expectTurns.push({ x: me.x, y: me.y, dir, at: now });
    }
    return this.send({ t: 'interact', d: { npc: n.id } });
  }

  // ---- dialog and lessons -----------------------------------------------------------------------

  /** Pick a dialog option (`battle`, `lesson:<id>`, `quest:<id>`, `skip:<id>`). */
  choose(option: string): boolean {
    const d = this.dialog.value;
    if (!d) return false;
    this.dialog.value = null;
    if (d.local) return true;
    if (option.startsWith('lesson:')) this.lessonNpc.set(option.slice('lesson:'.length), d.npc);
    return this.send({ t: 'choose', d: { npc: d.npc, option } });
  }

  closeDialog(): void {
    this.dialog.value = null;
  }

  /** Answer the open puzzle with a UCI move; the zone checks it (R-WORLD-003, R-SEC-003). */
  answer(move: string): boolean {
    const p = this.puzzle.value;
    if (!p || (p.status !== 'solving' && p.status !== 'wrong')) return false;
    if (!Uci.safeParse(move).success) return false;
    if (!this.send({ t: 'answer', d: { lesson: p.lesson, puzzle: p.index, move } })) return false;
    this.puzzle.value = { ...p, status: 'checking' };
    return true;
  }

  /**
   * Skip a chess lesson (10.3): the zone accepts `skip:<lesson>` only as an option of the teacher's
   * current dialog, so the client talks to the teacher again and picks it without showing the dialog.
   */
  skipLesson(): boolean {
    const p = this.puzzle.value;
    if (!p || !p.skippable || !p.npc) return false;
    const npc = p.npc;
    if (!this.send({ t: 'interact', d: { npc } })) return false;
    this.swallowDialog = npc;
    this.send({ t: 'choose', d: { npc, option: `skip:${p.lesson}` } });
    this.puzzle.value = null;
    return true;
  }

  /** Put the puzzle away (the teacher offers it again). */
  closePuzzle(): void {
    this.puzzle.value = null;
  }

  // ---- chat -------------------------------------------------------------------------------------

  /** Send a chat line; false when rate-limited (1/s, burst 5, R-SEC-005) or not connected. */
  sendChat(ch: Channel, text: string, to?: { p: string; name: string }): boolean {
    const clean = text.trim().slice(0, 200);
    if (!clean) return false;
    if (ch === 'whisper' && !to) return false;
    const now = this.now();
    if (now < this.chatReadyAt.value) return false;
    if (!take(this.chatBucket, LIMITS.chat, now)) {
      this.chatReadyAt.value = now + 1000 / LIMITS.chat.rate;
      return false;
    }
    const sent = this.send(
      ch === 'whisper' && to
        ? { t: 'chat', d: { ch, text: clean, to: to.p } }
        : { t: 'chat', d: { ch, text: clean } },
    );
    if (!sent) return false;
    // Rate-limit friendly: pause briefly, and until the next token when the burst is spent.
    const wait =
      this.chatBucket.tokens >= 1
        ? CHAT_PAUSE_MS
        : Math.max(CHAT_PAUSE_MS, ((1 - this.chatBucket.tokens) / LIMITS.chat.rate) * 1000);
    this.chatReadyAt.value = now + wait;
    // The zone does not echo whispers to their sender.
    if (ch === 'whisper' && to) {
      const me = this.me.value;
      this.addChat({
        ch,
        from: me?.p ?? '',
        name: 'You',
        text: clean,
        filtered: false,
        own: true,
        to: to.p,
        toName: to.name,
      });
    }
    return true;
  }

  markRead(ch: Channel): void {
    if (this.unread.value[ch] === 0) return;
    this.unread.value = { ...this.unread.value, [ch]: 0 };
  }

  /** Adults may filter their own chat; minors are always filtered by the zone (R-SEC-011). */
  setFilterChat(on: boolean): void {
    this.filterChat.value = on;
    this.send({ t: 'prefs', d: { filterChat: on } });
  }

  // ---- players, challenges and parties ----------------------------------------------------------

  select(p: string | null): void {
    this.selected.value = p;
  }

  /** Challenge a player in this zone (10.4): consent outside challenge zones, at once inside. */
  challenge(to: string, format: Format): boolean {
    return this.send({ t: 'chal', d: { to, format } });
  }

  replyChallenge(id: string, accept: boolean): boolean {
    this.challenges.value = this.challenges.value.filter((c) => c.id !== id);
    return this.send({ t: 'chalReply', d: { id, accept } });
  }

  invite(to: string): boolean {
    return this.send({ t: 'party', d: { op: 'invite', to } });
  }

  replyInvite(id: string, accept: boolean): boolean {
    this.invites.value = this.invites.value.filter((i) => i.id !== id);
    return this.send({ t: 'party', d: { op: 'reply', id, accept } });
  }

  leaveParty(): boolean {
    return this.send({ t: 'party', d: { op: 'leave' } });
  }

  dismissToast(id: number): void {
    this.toasts.value = this.toasts.value.filter((t) => t.id !== id);
  }

  /** Players within `range` tiles (Chebyshev) of this player, nearest first. */
  nearby(range: number): WorldPlayer[] {
    const me = this.me.value;
    if (!me) return [];
    const d = (p: WorldPlayer) => Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y));
    return [...this.players.value.values()]
      .filter((p) => d(p) <= range)
      .sort((a, b) => d(a) - d(b) || a.name.localeCompare(b.name));
  }

  dispose(): void {
    this.disposed = true;
    this.clearRetry();
    const ws = this.socket;
    this.socket = null;
    ws?.close(1000, 'left');
    this.connection.value = 'closed';
  }
}
