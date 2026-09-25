/**
 * Enforcing a suspension on live connections (M6 6.4, R-SEC-006). The sessions are already revoked
 * and sign-in, tickets and socket upgrades refuse the player; this closes what is open right now:
 * - the zone socket (the ZoneRoom host call `/kick`: the player leaves the channel);
 * - trade and wager sessions (found through the `trade.invite` / `trade.invited` audit entries of
 *   the last day; each is cancelled on the player's behalf, which closes both sockets);
 * - queue sockets (every casual queue and the player's ranked bracket: `Matchmaker /kick`);
 * - battle sockets (each active battle: `BattleRoom /kick`). The battle itself is not ended here:
 *   the player cannot reconnect, so the normal disconnect grace abandons it (9.2).
 */
import { engine, RANKED } from '@chain-theorem/content';
import type { Db } from '@chain-theorem/db';
import type { Env } from '../env.ts';
import { rankedQueueName } from '../api/ranked.ts';
import { TRADE_INVITE, TRADE_INVITED } from '../api/trades.ts';
import { bracketForLevel } from '../rating/ranked.ts';
import { callPlayer } from '../world/routing.ts';
import { CLOSE_SUSPENDED, SUSPENDED } from './sanctions.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Closed {
  zone: boolean;
  trades: number;
  queues: number;
  battles: number;
}

async function post(stub: DurableObjectStub, url: string, body: unknown): Promise<boolean> {
  try {
    const res = await stub.fetch(url, { method: 'POST', body: JSON.stringify(body) });
    return res.ok;
  } catch (err) {
    console.error(`moderation: ${url} failed: ${String(err)}`);
    return false;
  }
}

/** Close every live connection of a suspended player; what was closed. */
export async function closeLive(env: Env, db: Db, playerId: string, now: number): Promise<Closed> {
  const closed: Closed = { zone: false, trades: 0, queues: 0, battles: 0 };
  closed.zone = await callPlayer(env, db, playerId, 'kick', {
    id: playerId,
    code: CLOSE_SUSPENDED,
    reason: SUSPENDED,
  });

  const entries = await db.audit.listKinds(
    playerId,
    [TRADE_INVITE, TRADE_INVITED],
    now - DAY_MS,
    100,
  );
  const trades = new Set<string>();
  for (const e of entries) if (typeof e.payload.trade === 'string') trades.add(e.payload.trade);
  for (const id of trades) {
    const stub = env.TRADE_SESSION.get(env.TRADE_SESSION.idFromName(id));
    if (await post(stub, 'https://trade/cancel', { playerId })) closed.trades++;
  }

  const player = await db.players.getById(playerId);
  const queues = Object.keys(engine.caps.FORMATS);
  if (player)
    for (const format of RANKED.formats)
      queues.push(rankedQueueName(format, bracketForLevel(player.level)));
  for (const name of queues) {
    const stub = env.MATCHMAKER.get(env.MATCHMAKER.idFromName(name));
    if (await post(stub, 'https://queue/kick', { playerId, code: CLOSE_SUSPENDED }))
      closed.queues++;
  }

  for (const b of await db.battles.listActiveForPlayer(playerId, 5)) {
    const stub = env.BATTLE_ROOM.get(env.BATTLE_ROOM.idFromName(b.id));
    if (await post(stub, 'https://room/kick', { playerId, code: CLOSE_SUSPENDED }))
      closed.battles++;
  }
  return closed;
}
