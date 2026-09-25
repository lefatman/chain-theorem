/**
 * Ranked records on every engine (M6 6.2): a battle is rated once, both ratings change in one atomic
 * list per (player, format, bracket) (R-FMT-004), stale reads conflict instead of losing an update
 * (DD-15), the same-opponent counter and flag (R-SEC-008), leaderboards (R-WORLD-004), and export
 * and deletion of rated games (R-SEC-010).
 */
import { describe, expect, it } from 'vitest';
import type { Db, Player, RatedSide } from '../src/index.ts';
import { ENGINES, makePlayer, useDb } from './engines.ts';

const T0 = Date.UTC(2026, 8, 25);

async function battle(db: Db, white: string, black: string, format = 'full') {
  return db.battles.create({ format, whiteId: white, blackId: black, startedAt: T0 });
}

function side(
  playerId: string,
  games: number | null,
  rating: number,
  delta: number,
  rd = 300,
): RatedSide {
  return {
    playerId,
    before: games === null ? null : { games },
    after: { rating, rd, volatility: 0.06 },
    delta,
  };
}

describe.each(ENGINES)('ranked on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-FMT-004 a battle is rated once; both ratings change per player, format and bracket', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        const bt = await battle(db(), a.id, b.id);
        const input = {
          battleId: bt.id,
          format: 'full',
          bracket: '1-2',
          white: side(a.id, null, 1662, 162),
          black: side(b.id, null, 1338, -162),
          scoreWhite: 1 as const,
          rated: true,
          at: T0 + 10,
        };
        expect(await db().ranked.record(input)).toBe('recorded');
        expect(await db().ranked.record(input)).toBe('duplicate');
        expect(await db().ratings.get(a.id, 'full', '1-2')).toMatchObject({
          rating: 1662,
          games: 1,
          updatedAt: T0 + 10,
        });
        expect((await db().ratings.get(b.id, 'full', '1-2'))?.games).toBe(1);
        expect(await db().ratings.get(a.id, 'full', '3-4')).toBeNull();
        expect(await db().ratings.get(a.id, 'vanguard', '1-2')).toBeNull();
        const game = await db().ranked.getGame(bt.id);
        const aFirst = a.id < b.id;
        expect(game).toMatchObject({
          format: 'full',
          bracket: '1-2',
          rated: true,
          scoreA: aFirst ? 1 : 0,
          aDelta: aFirst ? 162 : -162,
        });
        // A second game updates the existing rows.
        const bt2 = await battle(db(), b.id, a.id);
        expect(
          await db().ranked.record({
            ...input,
            battleId: bt2.id,
            white: side(b.id, 1, 1400, 62),
            black: side(a.id, 1, 1600, -62),
            scoreWhite: 1,
            at: T0 + 20,
          }),
        ).toBe('recorded');
        expect(await db().ratings.get(a.id, 'full', '1-2')).toMatchObject({
          rating: 1600,
          games: 2,
        });
      });

      it('R-FMT-004 DD-15 an update computed from a stale read conflicts and changes nothing', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        const c = await makePlayer(db());
        const first = await battle(db(), a.id, b.id);
        await db().ranked.record({
          battleId: first.id,
          format: 'full',
          bracket: '1-2',
          white: side(a.id, null, 1600, 100),
          black: side(b.id, null, 1400, -100),
          scoreWhite: 1,
          rated: true,
          at: T0,
        });
        // Computed from a's first rating (games 1), but another game landed meanwhile.
        const other = await battle(db(), a.id, c.id);
        await db().ranked.record({
          battleId: other.id,
          format: 'full',
          bracket: '1-2',
          white: side(a.id, 1, 1650, 50),
          black: side(c.id, null, 1450, -50),
          scoreWhite: 1,
          rated: true,
          at: T0 + 1,
        });
        const stale = await battle(db(), b.id, a.id);
        const r = await db().ranked.record({
          battleId: stale.id,
          format: 'full',
          bracket: '1-2',
          white: side(b.id, 1, 1500, 100),
          black: side(a.id, 1, 1550, -100),
          scoreWhite: 1,
          rated: true,
          at: T0 + 2,
        });
        expect(r).toBe('conflict');
        expect(await db().ranked.getGame(stale.id)).toBeNull();
        expect(await db().ratings.get(a.id, 'full', '1-2')).toMatchObject({
          rating: 1650,
          games: 2,
        });
        expect((await db().ratings.get(b.id, 'full', '1-2'))?.games).toBe(1);
        // Two first ratings racing: one wins, the other conflicts.
        const d = await makePlayer(db());
        const e = await makePlayer(db());
        const f = await makePlayer(db());
        const [x, y] = await Promise.all([battle(db(), d.id, e.id), battle(db(), d.id, f.id)]);
        const results = await Promise.all(
          [
            [x, e],
            [y, f],
          ].map(([bt, opp]) =>
            db().ranked.record({
              battleId: bt!.id,
              format: 'vanguard',
              bracket: '3-4',
              white: side(d.id, null, 1600, 100),
              black: side(opp!.id, null, 1400, -100),
              scoreWhite: 1,
              rated: true,
              at: T0 + 3,
            }),
          ),
        );
        expect(results.sort()).toEqual(['conflict', 'recorded']);
        expect((await db().ratings.get(d.id, 'vanguard', '3-4'))?.games).toBe(1);
      });

      it('R-SEC-008 unrated games keep ratings, count for the pair, and carry the flag entries', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        const bt = await battle(db(), a.id, b.id);
        await db().ranked.record({
          battleId: bt.id,
          format: 'full',
          bracket: '1-2',
          white: side(a.id, null, 1600, 100),
          black: side(b.id, null, 1400, -100),
          scoreWhite: 1,
          rated: true,
          at: T0,
        });
        const capped = await battle(db(), b.id, a.id, 'vanguard');
        expect(
          await db().ranked.record({
            battleId: capped.id,
            format: 'vanguard',
            bracket: '1-2',
            white: side(b.id, null, 1700, 200),
            black: side(a.id, null, 1300, -200),
            scoreWhite: 1,
            rated: false,
            audit: [
              { playerId: a.id, kind: 'ranked.repeat_pairing', payload: { opponent: b.id } },
              { playerId: b.id, kind: 'ranked.repeat_pairing', payload: { opponent: a.id } },
            ],
            at: T0 + 5,
          }),
        ).toBe('recorded');
        expect(await db().ratings.get(a.id, 'vanguard', '1-2')).toBeNull();
        expect((await db().ranked.getGame(capped.id))?.rated).toBe(false);
        expect((await db().ranked.getGame(capped.id))?.aDelta).toBe(0);
        expect(await db().ranked.pairGamesSince(b.id, a.id, T0 - 1)).toEqual({
          total: 2,
          rated: 1,
        });
        expect(await db().ranked.pairGamesSince(a.id, b.id, T0)).toEqual({ total: 1, rated: 0 });
        const flags = await db().audit.listForPlayer(a.id);
        expect(flags.map((f) => [f.kind, f.payload.opponent])).toEqual([
          ['ranked.repeat_pairing', b.id],
        ]);
      });

      it('R-WORLD-004 the leaderboard lists settled players best first with guild tags and own rank', async () => {
        const ps: Player[] = [];
        for (let i = 0; i < 5; i++) ps.push(await makePlayer(db(), undefined, `R${i}`));
        const put = (i: number, rating: number, rd: number, games: number, bracket = '1-2') =>
          db().ratings.upsert({
            playerId: ps[i]!.id,
            format: 'full',
            bracket,
            rating,
            rd,
            volatility: 0.06,
            games,
          });
        await put(0, 1800, 90, 20);
        await put(1, 1900, 250, 20); // deviation too high
        await put(2, 1700, 60, 3); // too few games
        await put(3, 1750, 100, 8);
        await put(4, 2000, 50, 30, '3-4'); // another bracket
        const g = await db().guilds.create({
          name: 'Towers',
          tag: 'TW',
          leaderId: ps[3]!.id,
          maxSize: 10,
        });
        expect(g.status).toBe('created');
        const rules = { maxRd: 200, minGames: 5 };
        const board = await db().ranked.board('full', '1-2', rules, 10);
        expect(board.map((r) => [r.name, r.rating, r.tag])).toEqual([
          ['R0', 1800, null],
          ['R3', 1750, 'TW'],
        ]);
        expect(await db().ranked.board('full', '1-2', rules, 1)).toHaveLength(1);
        expect(await db().ranked.rankOf(ps[3]!.id, 'full', '1-2', rules)).toBe(2);
        expect(await db().ranked.rankOf(ps[1]!.id, 'full', '1-2', rules)).toBeNull();
        expect(await db().ranked.rankOf(ps[2]!.id, 'full', '1-2', rules)).toBeNull();
        expect(await db().ranked.rankOf(ps[4]!.id, 'full', '3-4', rules)).toBe(1);
        expect(await db().ranked.rankOf(ps[4]!.id, 'vanguard', '3-4', rules)).toBeNull();
      });

      it('R-SEC-010 rated games are exported and anonymized on deletion', async () => {
        const a = await makePlayer(db());
        const b = await makePlayer(db());
        const bt = await battle(db(), a.id, b.id);
        await db().ranked.record({
          battleId: bt.id,
          format: 'full',
          bracket: '1-2',
          white: side(a.id, null, 1600, 100),
          black: side(b.id, null, 1400, -100),
          scoreWhite: 1,
          rated: true,
          at: T0,
        });
        const exported = await db().players.exportData(a.id);
        expect(exported?.ratedGames.map((g) => g.battleId)).toEqual([bt.id]);
        expect(await db().players.delete(a.id)).toBe(true);
        const game = await db().ranked.getGame(bt.id);
        expect([game?.aId, game?.bId].filter((x) => x !== null)).toEqual([b.id]);
        expect((await db().ranked.gamesOf(b.id)).map((g) => g.battleId)).toEqual([bt.id]);
      });
    },
  );
});
