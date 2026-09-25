/**
 * Tournament rows on every engine (M7 7.1; spec 10.4 R-WORLD-004, R-SEC-010): events and their
 * listing order, a scheduled event created once however many requests race (UNIQUE key), entries with
 * the field size enforced by CHECK inside the atomic list, the end with places, and the player's data
 * export and deletion.
 */
import { describe, expect, it } from 'vitest';
import { DbConstraintError, type Db, type Player } from '../src/index.ts';
import { ENGINES, makePlayer, useDb } from './engines.ts';

const T0 = Date.UTC(2026, 8, 25, 12);

async function players(db: Db, n: number, prefix = 'T'): Promise<Player[]> {
  const out: Player[] = [];
  for (let i = 0; i < n; i++) out.push(await makePlayer(db, undefined, `${prefix}${i}`));
  return out;
}

const event = (over: Record<string, unknown> = {}) => ({
  name: 'Daily Full Battle Swiss',
  format: 'full',
  bracket: '1-2',
  system: 'swiss' as const,
  startsAt: T0 + 60_000,
  maxPlayers: 3,
  now: T0,
  ...over,
});

describe.each(ENGINES)('tournaments on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-WORLD-004 an event is created open and listed by start time', async () => {
        const [admin] = await players(db(), 1, 'A');
        const later = await db().tournaments.create(
          event({ name: 'Later', startsAt: T0 + 120_000, createdBy: admin!.id }),
        );
        const sooner = await db().tournaments.create(event({ name: 'Sooner' }));
        expect(later).toMatchObject({
          name: 'Later',
          status: 'open',
          players: 0,
          rounds: 0,
          round: 0,
          createdBy: admin!.id,
          scheduleKey: null,
          winnerId: null,
          winnerName: null,
        });
        const open = await db().tournaments.list(['open']);
        expect(open.map((t) => t.name)).toEqual(['Sooner', 'Later']);
        expect((await db().tournaments.list(['open'], { order: 'desc' }))[0]?.id).toBe(later.id);
        expect(await db().tournaments.list(['running'])).toEqual([]);
        expect(await db().tournaments.get(sooner.id)).toEqual(sooner);
        // The CHECK constraints refuse a bad system or field size.
        await expect(
          db().tournaments.create(event({ system: 'league' as 'swiss' })),
        ).rejects.toBeInstanceOf(DbConstraintError);
      });

      it('R-WORLD-004 a scheduled event is created once, whoever asks first', async () => {
        const key = 'daily:swiss:full:1-2:2026-09-25';
        const results = await Promise.all(
          [0, 1, 2].map(() => db().tournaments.createScheduled({ ...event(), scheduleKey: key })),
        );
        expect(results.filter((r) => r.created)).toHaveLength(1);
        expect(new Set(results.map((r) => r.tournament.id)).size).toBe(1);
        expect(await db().tournaments.byScheduleKeys([key, 'other'])).toHaveLength(1);
        const again = await db().tournaments.createScheduled({ ...event(), scheduleKey: key });
        expect(again.created).toBe(false);
      });

      it('R-WORLD-004 entries: once per player, never past the field size (CHECK), counted atomically', async () => {
        const t = await db().tournaments.create(event({ maxPlayers: 2 }));
        const [a, b, c] = await players(db(), 3);
        expect(await db().tournaments.addEntry(t.id, a!.id, T0)).toBe('added');
        expect(await db().tournaments.addEntry(t.id, a!.id, T0)).toBe('exists');
        expect(await db().tournaments.addEntry(t.id, b!.id, T0 + 1)).toBe('added');
        expect(await db().tournaments.addEntry(t.id, c!.id, T0 + 2)).toBe('full');
        expect(await db().tournaments.addEntry('nope', c!.id, T0 + 2)).toBe('no_tournament');
        expect(await db().tournaments.addEntry(t.id, 'ghost', T0 + 2)).toBe('no_player');
        expect((await db().tournaments.get(t.id))?.players).toBe(2);
        expect((await db().tournaments.entries(t.id)).map((e) => e.playerId)).toEqual([
          a!.id,
          b!.id,
        ]);
        expect(await db().tournaments.registeredIn(a!.id, [t.id, 'x'])).toEqual(new Set([t.id]));
        expect(await db().tournaments.removeEntry(t.id, a!.id)).toBe(true);
        expect(await db().tournaments.removeEntry(t.id, a!.id)).toBe(false);
        expect((await db().tournaments.get(t.id))?.players).toBe(1);
        expect(await db().tournaments.addEntry(t.id, c!.id, T0 + 3)).toBe('added');
        expect(await db().tournaments.removeEmpty(t.id)).toBe(false);
        const empty = await db().tournaments.create(event());
        expect(await db().tournaments.removeEmpty(empty.id)).toBe(true);
        expect(await db().tournaments.get(empty.id)).toBeNull();
      });

      it('R-WORLD-004 the room mirrors its summary and writes the end once', async () => {
        const t = await db().tournaments.create(event());
        const [a, b] = await players(db(), 2);
        await db().tournaments.addEntry(t.id, a!.id, T0);
        await db().tournaments.addEntry(t.id, b!.id, T0);
        expect(
          await db().tournaments.update(t.id, {
            status: 'running',
            rounds: 1,
            round: 1,
            startedAt: T0 + 60_000,
          }),
        ).toBe(true);
        expect((await db().tournaments.list(['running']))[0]).toMatchObject({
          id: t.id,
          rounds: 1,
          round: 1,
          startedAt: T0 + 60_000,
        });
        const end = {
          status: 'finished' as const,
          finishedAt: T0 + 90_000,
          winnerId: a!.id,
          places: [
            { playerId: a!.id, place: 1, points: 1 },
            { playerId: b!.id, place: 2, points: 0.5 },
          ],
        };
        await db().tournaments.finish(t.id, end);
        await db().tournaments.finish(t.id, end);
        const done = await db().tournaments.get(t.id);
        expect(done).toMatchObject({ status: 'finished', winnerId: a!.id, winnerName: 'T0' });
        expect(
          (await db().tournaments.entries(t.id)).map((e) => [e.playerId, e.place, e.points]),
        ).toEqual([
          [a!.id, 1, 1],
          [b!.id, 2, 0.5],
        ]);
      });

      it('R-SEC-010 export lists the tournaments; deletion removes the entries and clears the winner', async () => {
        const [p, other] = await players(db(), 2, 'Priv');
        const open = await db().tournaments.create(event({ name: 'Open one', createdBy: p!.id }));
        const done = await db().tournaments.create(event({ name: 'Done one' }));
        await db().tournaments.addEntry(open.id, p!.id, T0);
        await db().tournaments.addEntry(open.id, other!.id, T0);
        await db().tournaments.addEntry(done.id, p!.id, T0);
        await db().tournaments.finish(done.id, {
          status: 'finished',
          finishedAt: T0 + 1,
          winnerId: p!.id,
          places: [{ playerId: p!.id, place: 1, points: 3 }],
        });
        const exported = await db().players.exportData(p!.id, T0 + 5);
        expect(exported?.tournaments).toEqual([
          {
            tournamentId: open.id,
            name: 'Open one',
            format: 'full',
            system: 'swiss',
            status: 'open',
            startsAt: open.startsAt,
            registeredAt: T0,
            place: null,
            points: null,
          },
          {
            tournamentId: done.id,
            name: 'Done one',
            format: 'full',
            system: 'swiss',
            status: 'finished',
            startsAt: done.startsAt,
            registeredAt: T0,
            place: 1,
            points: 3,
          },
        ]);
        expect(await db().tournaments.idsForPlayer(p!.id)).toEqual([open.id, done.id].sort());
        expect(await db().players.delete(p!.id)).toBe(true);
        expect(await db().tournaments.idsForPlayer(p!.id)).toEqual([]);
        // The open event's count drops; the finished one keeps its field size; references clear.
        expect(await db().tournaments.get(open.id)).toMatchObject({ players: 1, createdBy: null });
        expect(await db().tournaments.get(done.id)).toMatchObject({ players: 1, winnerId: null });
        expect((await db().tournaments.entries(open.id)).map((e) => e.playerId)).toEqual([
          other!.id,
        ]);
      });
    },
  );
});
