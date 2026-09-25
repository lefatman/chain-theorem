/**
 * ZoneRoom messages (10.1, 10.4, 13.4). The overworld sends tile steps only, never positions per
 * frame (R-COST-002); the zone answers with compact step events.
 */
import { z } from 'zod';
import { Format } from './battle.ts';

export const Dir = z.enum(['n', 's', 'e', 'w']);
export type Dir = z.infer<typeof Dir>;
export const Channel = z.enum(['zone', 'party', 'guild', 'whisper']);
export type Channel = z.infer<typeof Channel>;

const Id = z.string().min(1).max(64);
const Tile = z.number().int().min(0).max(4095);

/** Client → ZoneRoom. */
export const ClientZone = {
  hello: z.object({}),
  step: z.object({ dir: Dir }),
  chat: z.object({ ch: Channel, text: z.string().min(1).max(200), to: Id.optional() }),
  /** Challenge another player (consent-based PvP outside challenge zones, 9.3). */
  chal: z.object({ to: Id, format: Format }),
  chalReply: z.object({ id: Id, accept: z.boolean() }),
  interact: z.object({ npc: Id }),
};
export type ClientZoneMap = typeof ClientZone;

export const ZonePlayer = z.object({
  p: Id,
  name: z.string().max(40),
  x: Tile,
  y: Tile,
  dir: Dir,
  battling: z.boolean(),
});

/** ZoneRoom → client. */
export const ServerZone = {
  zsnap: z.object({
    zone: Id,
    channel: z.number().int().min(0),
    you: z.object({ p: Id, x: Tile, y: Tile, dir: Dir }),
    players: z.array(ZonePlayer).max(60),
    npcs: z.array(z.object({ id: Id, name: z.string().max(40), x: Tile, y: Tile, dir: Dir })),
    challengeZone: z.boolean(),
  }),
  zstep: z.object({ p: Id, x: Tile, y: Tile, dir: Dir }),
  zjoin: ZonePlayer,
  zleave: z.object({ p: Id }),
  zbattle: z.object({ p: Id, battling: z.boolean() }),
  chatmsg: z.object({
    ch: Channel,
    from: Id,
    name: z.string().max(40),
    text: z.string().max(200),
    filtered: z.boolean(),
  }),
  /** An encounter or accepted challenge started: open a BattleRoom socket with this token. */
  enc: z.object({ battleId: Id, token: z.string().max(512) }),
  chalIn: z.object({ id: Id, from: Id, name: z.string().max(40), format: Format }),
  err: z.object({ code: z.string().max(32), msg: z.string().max(200).optional() }),
};
export type ServerZoneMap = typeof ServerZone;
