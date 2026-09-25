/**
 * Trade and wager messages (M6 6.1; R-NET-001, R-SEC-002): offers are strictly shaped (known id
 * syntax, positive bounded quantities, bounded line counts), anything else is dropped; REST bodies
 * validate the same way. Server messages round-trip.
 */
import { describe, expect, it } from 'vitest';
import {
  ClientTrade,
  OFFER_MAX_LINES,
  OFFER_MAX_QTY,
  ServerTrade,
  StartTrade,
  decode,
  encode,
} from './index.ts';

describe('trade messages (M6)', () => {
  it('R-NET-001 R-SEC-002 offers decode with defaults; malformed offers are dropped', () => {
    expect(decode(ClientTrade, '{"t":"offer","d":{"cards":[{"id":"scout","qty":2}]}}')).toEqual({
      t: 'offer',
      d: { items: [], cards: [{ id: 'scout', qty: 2 }] },
    });
    const line = (id: string, qty: number) => ({ id, qty });
    const bad = [
      { items: [line('Scout', 1)] },
      { items: [line('scout', 0)] },
      { items: [line('scout', OFFER_MAX_QTY + 1)] },
      { items: [line('scout', 1.5)] },
      { cards: Array.from({ length: OFFER_MAX_LINES + 1 }, (_, i) => line(`c${i}`, 1)) },
      { items: [{ id: 'scout' }] },
    ];
    for (const d of bad) expect(decode(ClientTrade, JSON.stringify({ t: 'offer', d }))).toBeNull();
    expect(decode(ClientTrade, '{"t":"ready","d":{"rev":-1,"on":true}}')).toBeNull();
    expect(decode(ClientTrade, '{"t":"format","d":{"format":"blitz"}}')).toBeNull();
    expect(decode(ClientTrade, '{"t":"confirm","d":{"rev":3,"extra":1}}')).toEqual({
      t: 'confirm',
      d: { rev: 3 },
    });
  });

  it('R-NET-001 the start body names a player and a mode; server messages round-trip', () => {
    expect(StartTrade.safeParse({ with: 'p1', mode: 'wager', format: 'full' }).success).toBe(true);
    expect(StartTrade.safeParse({ with: 'p1', mode: 'sell' }).success).toBe(false);
    expect(StartTrade.safeParse({ with: '', mode: 'trade' }).success).toBe(false);
    const raw = encode(ServerTrade, {
      t: 'tdone',
      d: { mode: 'wager', battleId: 'b1', url: '/ws/battle/b1?t=x' },
    });
    expect(decode(ServerTrade, raw)).toEqual({
      t: 'tdone',
      d: { mode: 'wager', battleId: 'b1', url: '/ws/battle/b1?t=x' },
    });
    expect(decode(ServerTrade, '{"t":"tend","d":{"reason":"sold","by":null}}')).toBeNull();
  });
});
