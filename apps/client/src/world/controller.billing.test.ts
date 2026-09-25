/** The world stops, rather than retrying, when the trial or subscription has ended (M6 6.3). */
import { describe, expect, it } from 'vitest';
import { WorldController } from './controller.ts';

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('world entry without a subscription (R-COST-005)', () => {
  it('R-COST-005 a 402 from the world ticket closes the world with the trial-ended notice', async () => {
    const timers: unknown[] = [];
    let sockets = 0;
    const c = new WorldController({
      ticket: () =>
        Promise.reject(
          Object.assign(new Error('subscription_required'), {
            status: 402,
            code: 'subscription_required',
          }),
        ),
      socketFactory: () => {
        sockets++;
        throw new Error('no socket expected');
      },
      now: () => 0,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => undefined,
    });
    await flush();
    expect(c.connection.value).toBe('closed');
    expect(c.notice.value).toMatch(/trial has ended/i);
    expect(timers).toEqual([]);
    expect(sockets).toBe(0);
    c.dispose();
  });
});
