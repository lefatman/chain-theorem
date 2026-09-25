/**
 * Addressing zone channels (M5, 10.1, 10.4): each channel is one ZoneRoom named `zone:<zone>:<channel>`.
 * Parties, whispers and battle results reach a player through their presence (zone and channel, set
 * when a channel admits them and cleared when they leave it).
 */
import type { Db } from '@chain-theorem/db';
import type { Env } from '../env.ts';

/** Channels per zone (each holds 60 players, 10.1). */
export const MAX_CHANNELS = 32;

export function zoneRoomName(zone: string, channel: number): string {
  return `zone:${zone}:${channel}`;
}

export function zoneStub(env: Env, zone: string, channel: number): DurableObjectStub {
  return env.ZONE_ROOM.get(env.ZONE_ROOM.idFromName(zoneRoomName(zone, channel)));
}

/** Host calls a ZoneRoom accepts from other rooms (POST, JSON body). */
export type ZoneCall =
  | 'deliver'
  | 'refused'
  | 'party'
  | 'invite'
  | 'ended'
  | 'grant'
  | 'notify'
  /** M6: the player's guild changed (joined, left, kicked, disbanded). */
  | 'guild';

/**
 * Send a host call to the channel the player is in. Resolves false when the player is offline or
 * no longer in that channel (the room answers 404).
 */
export async function callPlayer(
  env: Env,
  db: Db,
  playerId: string,
  call: ZoneCall,
  body: unknown,
): Promise<boolean> {
  const at = await db.world.presence(playerId);
  if (!at) return false;
  const res = await zoneStub(env, at.zone, at.channel).fetch(`https://zone/${call}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.ok;
}
