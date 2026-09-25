/**
 * ZoneRoom messages (10.1–10.5, 13.4). The overworld sends tile steps only, never positions per frame
 * (R-COST-002); the zone answers with compact step events. The server decides movement, encounters,
 * lesson results, quest progress and rewards (R-SEC-003); the client only asks and draws.
 */
import { z } from 'zod';
import { Format, Uci } from './battle.ts';

export const Dir = z.enum(['n', 's', 'e', 'w']);
export type Dir = z.infer<typeof Dir>;
export const Channel = z.enum(['zone', 'party', 'guild', 'whisper']);
export type Channel = z.infer<typeof Channel>;

const Id = z.string().min(1).max(64);
const Tile = z.number().int().min(0).max(4095);
const Name = z.string().max(40);

/** Client → ZoneRoom. */
export const ClientZone = {
  /** Sent on every (re)connect; answered with `zsnap`. */
  hello: z.object({}),
  /** One tile step intent (at most 8 per second, R-SEC-005). A step into a wall only turns. */
  step: z.object({ dir: Dir }),
  chat: z.object({ ch: Channel, text: z.string().trim().min(1).max(200), to: Id.optional() }),
  /** Consent-based challenge to a player in the same zone (10.4); `format` outside challenge zones. */
  chal: z.object({ to: Id, format: Format }),
  chalReply: z.object({ id: Id, accept: z.boolean() }),
  /** Talk to the NPC in front of the player; answered with `dialog`. */
  interact: z.object({ npc: Id }),
  /** Choose a dialog option (`battle`, `lesson:<id>`, `quest:<id>`, `skip:<lesson>`). */
  choose: z.object({ npc: Id, option: z.string().min(1).max(80) }),
  /** Answer the current puzzle of a lesson with a move (10.3); the server checks it. */
  answer: z.object({ lesson: Id, puzzle: z.number().int().min(0).max(63), move: Uci }),
  party: z.discriminatedUnion('op', [
    z.object({ op: z.literal('invite'), to: Id }),
    z.object({ op: z.literal('reply'), id: Id, accept: z.boolean() }),
    z.object({ op: z.literal('leave') }),
  ]),
  /** Adults may filter their own chat (R-SEC-011); minors are always filtered. */
  prefs: z.object({ filterChat: z.boolean() }),
};
export type ClientZoneMap = typeof ClientZone;

export const ZonePlayer = z.object({
  p: Id,
  name: Name,
  x: Tile,
  y: Tile,
  dir: Dir,
  battling: z.boolean(),
  level: z.number().int().min(1).max(100),
});

export const RewardMsg = z.object({
  xp: z.number().int().min(0),
  level: z.number().int().min(1),
  levelUp: z.boolean(),
  items: z.array(z.object({ id: Id, qty: z.number().int() })).default([]),
  cards: z.array(z.object({ id: Id, qty: z.number().int() })).default([]),
  keyItems: z.array(Id).default([]),
  coins: z.number().int().min(0).default(0),
});

export const QuestState = z.object({
  id: Id,
  step: z.number().int().min(0),
  done: z.boolean(),
});

/** ZoneRoom → client. */
export const ServerZone = {
  zsnap: z.object({
    zone: Id,
    channel: z.number().int().min(0),
    you: z.object({ p: Id, x: Tile, y: Tile, dir: Dir }),
    players: z.array(ZonePlayer).max(60),
    npcs: z.array(z.object({ id: Id, name: Name, x: Tile, y: Tile, dir: Dir })),
    /** True while the player stands in a challenge zone (10.4). */
    challengeZone: z.boolean(),
    quests: z.array(QuestState),
  }),
  zstep: z.object({ p: Id, x: Tile, y: Tile, dir: Dir }),
  /** Your own step was refused (a wall, too fast): snap back to this tile. */
  zpos: z.object({ x: Tile, y: Tile, dir: Dir }),
  zjoin: ZonePlayer,
  zleave: z.object({ p: Id }),
  zbattle: z.object({ p: Id, battling: z.boolean() }),
  /** Move to another zone: fetch a zone ticket for `zone` and reconnect (a warp or party travel). */
  zwarp: z.object({ zone: Id }),
  chatmsg: z.object({
    ch: Channel,
    from: Id,
    name: Name,
    text: z.string().max(200),
    filtered: z.boolean(),
  }),
  /** A battle started for you (encounter, trainer, lesson, challenge): open its socket with `url`. */
  enc: z.object({
    battleId: Id,
    url: z.string().max(1024),
    kind: z.enum(['wild', 'trainer', 'lesson', 'challenge']),
  }),
  chalIn: z.object({ id: Id, from: Id, name: Name, format: Format }),
  /** Entering or leaving a challenge zone (10.4 banner). */
  banner: z.object({ kind: z.literal('challengeZone'), inside: z.boolean() }),
  dialog: z.object({
    npc: Id,
    name: Name,
    lines: z.array(z.string().max(400)).max(20),
    options: z.array(z.object({ id: z.string().max(80), label: z.string().max(80) })).max(8),
  }),
  /** A lesson's puzzle to solve (10.3). */
  puzzle: z.object({
    lesson: Id,
    index: z.number().int().min(0),
    count: z.number().int().min(1),
    fen: z.string().max(100),
    prompt: z.string().max(400),
  }),
  /** The verdict on an answer: wrong answers get the hint; the last right one completes the lesson. */
  lessonResult: z.object({
    lesson: Id,
    puzzle: z.number().int().min(0),
    ok: z.boolean(),
    hint: z.string().max(400).optional(),
    done: z.boolean(),
  }),
  quest: QuestState.extend({ text: z.string().max(200) }),
  reward: RewardMsg,
  party: z.object({
    id: Id.nullable(),
    leader: Id.nullable(),
    members: z.array(z.object({ p: Id, name: Name, zone: Id.nullable() })).max(4),
  }),
  partyInvite: z.object({ id: Id, from: Id, name: Name }),
  err: z.object({ code: z.string().max(32), msg: z.string().max(200).optional() }),
};
export type ServerZoneMap = typeof ServerZone;
