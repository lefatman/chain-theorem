/**
 * Spectating on every engine (M7 7.2; spec 10.4 "delayed, public-projection-only view of live
 * battles"): the per-account opt-out with its age-dependent default (R-SEC-011 spirit) and the live
 * list of listed battles.
 */
import { describe, expect, it } from 'vitest';
import { spectatingAllowed } from '../src/index.ts';
import { ENGINES, columnNames, makePlayer, useDb } from './engines.ts';

const T0 = Date.UTC(2026, 8, 25);
const HOUR = 60 * 60 * 1000;

describe('spectating defaults (pure)', () => {
  it('R-SEC-011 others may watch an adult by default and an account under 18 only if it opts in; the default flips on the 18th birthday', () => {
    const adultFrom = T0 + HOUR;
    expect(spectatingAllowed({ spectate: null, adultFrom }, T0)).toBe(false);
    expect(spectatingAllowed({ spectate: null, adultFrom }, T0 + HOUR)).toBe(true);
    expect(spectatingAllowed({ spectate: true, adultFrom }, T0)).toBe(true);
    expect(spectatingAllowed({ spectate: false, adultFrom: 0 }, T0)).toBe(false);
  });
});

describe.each(ENGINES)('spectating on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-DATA-003 migration 0008 adds players.spectate and battles.listed', async () => {
        expect(await columnNames(db(), 'players')).toContain('spectate');
        expect(await columnNames(db(), 'battles')).toContain('listed');
      });

      it('R-SEC-011 the spectating setting starts at the default (null), stores a choice and can go back to the default', async () => {
        const p = await makePlayer(db());
        expect(p.spectate).toBeNull();
        expect(await db().players.setSpectate(p.id, false)).toBe(true);
        expect((await db().players.getById(p.id))?.spectate).toBe(false);
        expect(await db().players.setSpectate(p.id, true)).toBe(true);
        expect((await db().players.getById(p.id))?.spectate).toBe(true);
        expect(await db().players.setSpectate(p.id, null)).toBe(true);
        expect((await db().players.getById(p.id))?.spectate).toBeNull();
        expect(await db().players.setSpectate('missing', true)).toBe(false);
        // Data export includes the setting (R-SEC-010).
        await db().players.setSpectate(p.id, false);
        expect((await db().players.exportData(p.id))?.player.spectate).toBe(false);
      });

      it('R-DATA-003 only listed battles without a result that started recently are live, newest first', async () => {
        const w = await makePlayer(db());
        const b = await makePlayer(db());
        const mk = (listed: boolean, startedAt: number) =>
          db().battles.create({ format: 'full', whiteId: w.id, blackId: b.id, startedAt, listed });
        const old = await mk(true, T0 - 10 * HOUR);
        const a = await mk(true, T0 - 2 * HOUR);
        const c = await mk(true, T0 - HOUR);
        const hidden = await mk(false, T0);
        const done = await mk(true, T0);
        expect(a.listed).toBe(true);
        expect(hidden.listed).toBe(false);
        await db().battles.finish(done.id, { result: 'white', reason: 'resign', endedAt: T0 + 1 });
        const live = await db().battles.listLive(T0 - 6 * HOUR, 10);
        const ids = live.map((x) => x.id);
        expect(ids).toEqual([c.id, a.id]);
        expect(ids).not.toContain(old.id);
        expect(await db().battles.listLive(T0 - 6 * HOUR, 1)).toHaveLength(1);
      });
    },
  );
});
