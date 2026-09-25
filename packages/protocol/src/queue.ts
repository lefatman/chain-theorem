/**
 * Matchmaker messages (M4 4.3, 9.3): a casual-queue socket to the Matchmaker Durable Object for one
 * format. The server pairs players within ±5 levels (widening over time) and answers `matched`; the
 * client then asks REST for a battle ticket. Leaving the queue is closing the socket.
 */
import { z } from 'zod';
import { Format } from './battle.ts';

/** Client → Matchmaker. */
export const ClientQueue = {
  /** Keep-alive; the loadout is chosen when the queue ticket is issued (REST). */
  ping: z.object({}),
};
export type ClientQueueMap = typeof ClientQueue;

/** Matchmaker → client. */
export const ServerQueue = {
  queued: z.object({ format: Format, since: z.number(), waiting: z.number().int().min(0) }),
  matched: z.object({ battleId: z.string().max(64) }),
  pong: z.object({}),
  err: z.object({ code: z.string().max(32), msg: z.string().max(200).optional() }),
};
export type ServerQueueMap = typeof ServerQueue;

/** Unranked queues match within ±5 levels (9.3); the window widens while a player waits. */
export const LEVEL_WINDOW = 5;
/** After this long the window widens by one level per interval (DD: keeps small populations playable). */
export const WIDEN_AFTER_MS = 30_000;
export const WIDEN_EVERY_MS = 10_000;

/** Level window for a player who has waited `waitedMs`. */
export function levelWindow(waitedMs: number): number {
  if (waitedMs < WIDEN_AFTER_MS) return LEVEL_WINDOW;
  return LEVEL_WINDOW + 1 + Math.floor((waitedMs - WIDEN_AFTER_MS) / WIDEN_EVERY_MS);
}
