/**
 * Per-socket rate limits (R-SEC-005): steps 8/s, chat 1/s with a burst of 5, battle 5 msgs/s.
 * Excess is dropped and counted; a socket that keeps exceeding them is disconnected. Buckets are
 * plain data so a hibernating Durable Object can keep them in the socket attachment.
 */
export interface Limit {
  /** Tokens added per second. */
  rate: number;
  /** Bucket size. */
  burst: number;
}

export const LIMITS = {
  step: { rate: 8, burst: 8 },
  chat: { rate: 1, burst: 5 },
  battle: { rate: 5, burst: 10 },
} as const satisfies Record<string, Limit>;

/** Drops in a row (without an accepted message in between) before the socket is closed. */
export const MAX_STRIKES = 50;

export interface Bucket {
  tokens: number;
  /** Epoch ms of the last refill. */
  at: number;
  /** Dropped messages since the last accepted one. */
  strikes: number;
  /** Total dropped (telemetry). */
  dropped: number;
}

export function newBucket(limit: Limit, now: number): Bucket {
  return { tokens: limit.burst, at: now, strikes: 0, dropped: 0 };
}

/** Take one token; false means drop the message. Mutates `b`. */
export function take(b: Bucket, limit: Limit, now: number): boolean {
  const dt = Math.max(0, now - b.at) / 1000;
  b.tokens = Math.min(limit.burst, b.tokens + dt * limit.rate);
  b.at = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    b.strikes = 0;
    return true;
  }
  b.strikes++;
  b.dropped++;
  return false;
}

/** Record a message dropped for another reason (invalid schema). */
export function strike(b: Bucket): void {
  b.strikes++;
  b.dropped++;
}

export function tooManyStrikes(b: Bucket): boolean {
  return b.strikes >= MAX_STRIKES;
}
