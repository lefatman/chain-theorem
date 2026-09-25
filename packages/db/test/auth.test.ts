/** Players, sessions, magic-link tokens and OAuth identities on every engine (R-SEC-006, R-DATA-003). */
import { describe, expect, it } from 'vitest';
import { DbConstraintError, DbDataError, sha256Hex } from '../src/index.ts';
import { ENGINES, makePlayer, useDb } from './engines.ts';

const T0 = Date.UTC(2026, 8, 25, 12, 0, 0);
const HOUR = 3_600_000;

describe.each(ENGINES)('auth repositories on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      describe('players', () => {
        it('R-DATA-003 creates a player from email, display name and adult_from with defaults', async () => {
          const p = await db().players.create({
            email: '  Ada@Example.COM ',
            displayName: ' Ada ',
            adultFrom: Date.UTC(2020, 0, 1),
            now: T0,
          });
          expect(p).toMatchObject({
            email: 'ada@example.com',
            displayName: 'Ada',
            level: 1,
            xp: 0,
            zoneId: null,
            tileX: null,
            tileY: null,
            subStatus: 'none',
            subExpiresAt: null,
            trialEndsAt: null,
            adultFrom: Date.UTC(2020, 0, 1),
            createdAt: T0,
          });
          expect(typeof p.createdAt).toBe('number');
          expect(await db().players.getById(p.id)).toEqual(p);
          expect(await db().players.getByEmail('ADA@example.com')).toEqual(p);
          expect(await db().players.getByEmail('nobody@example.com')).toBeNull();
        });

        it('R-DATA-003 a taken email rejects with a typed unique violation', async () => {
          await makePlayer(db(), 'dup@example.com');
          const err = await db()
            .players.create({ email: 'DUP@example.com', displayName: 'B', adultFrom: 0 })
            .catch((e: unknown) => e);
          expect(err).toBeInstanceOf(DbConstraintError);
          expect((err as DbConstraintError).kind).toBe('unique');
          expect((err as DbConstraintError).table).toBe('players');
        });

        it('R-DATA-003 rename and addXp; level only ever rises', async () => {
          const p = await makePlayer(db());
          expect(await db().players.rename(p.id, 'Renamed')).toBe(true);
          expect(await db().players.rename('missing', 'X')).toBe(false);
          expect((await db().players.getById(p.id))?.displayName).toBe('Renamed');
          const curve = (xp: number) => 1 + Math.floor(xp / 100);
          expect(await db().players.addXp(p.id, 250, curve)).toEqual({ xp: 250, level: 3 });
          await Promise.all([db().players.addXp(p.id, 50), db().players.addXp(p.id, 50)]);
          expect(await db().players.syncLevel(p.id, curve)).toEqual({ xp: 350, level: 4 });
          // A curve that would lower the level never does.
          expect(await db().players.syncLevel(p.id, () => 1)).toEqual({ xp: 350, level: 4 });
          expect(await db().players.addXp('missing', 10)).toBeNull();
        });
      });

      describe('sessions', () => {
        it('R-SEC-006 sessions store only the SHA-256 hash of a 32-byte token', async () => {
          const p = await makePlayer(db());
          const { token, session } = await db().sessions.create(p.id, { ttlMs: HOUR, now: T0 });
          expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
          expect(session).toMatchObject({ playerId: p.id, createdAt: T0, expiresAt: T0 + HOUR });
          const stored = await db().kysely.selectFrom('sessions').selectAll().execute();
          expect(stored).toHaveLength(1);
          expect(stored[0]?.token_hash).toBe(await sha256Hex(token));
          expect(JSON.stringify(stored)).not.toContain(token);
        });

        it('R-SEC-006 a session is valid until it expires and gone after sign-out', async () => {
          const p = await makePlayer(db());
          const { token, session } = await db().sessions.create(p.id, { ttlMs: HOUR, now: T0 });
          expect(await db().sessions.getValid(token, T0 + 1)).toEqual(session);
          expect(await db().sessions.getValid(token, T0 + HOUR)).toBeNull();
          expect(await db().sessions.getValid('not-a-token', T0)).toBeNull();
          expect(await db().sessions.delete(token)).toBe(true);
          expect(await db().sessions.delete(token)).toBe(false);
          expect(await db().sessions.getValid(token, T0 + 1)).toBeNull();
        });

        it('R-SEC-006 expired sessions are purged and sign-out everywhere removes all', async () => {
          const p = await makePlayer(db());
          await db().sessions.create(p.id, { ttlMs: HOUR, now: T0 });
          const live = await db().sessions.create(p.id, { ttlMs: 10 * HOUR, now: T0 });
          expect(await db().sessions.deleteExpired(T0 + 2 * HOUR)).toBe(1);
          expect(await db().sessions.getValid(live.token, T0 + 2 * HOUR)).not.toBeNull();
          await db().sessions.create(p.id, { ttlMs: HOUR, now: T0 });
          expect(await db().sessions.deleteForPlayer(p.id)).toBe(2);
        });
      });

      describe('login tokens', () => {
        it('R-SEC-006 magic-link tokens are stored hashed and consumed exactly once', async () => {
          const { token, expiresAt } = await db().loginTokens.issue({
            email: 'New@Example.com',
            purpose: 'signin',
            ttlMs: 15 * 60_000,
            data: { displayName: 'Newcomer', adultFrom: Date.UTC(2031, 4, 2) },
            now: T0,
          });
          expect(expiresAt).toBe(T0 + 15 * 60_000);
          const stored = await db().kysely.selectFrom('login_tokens').selectAll().execute();
          expect(stored[0]?.token_hash).toBe(await sha256Hex(token));
          expect(JSON.stringify(stored)).not.toContain(token);

          const first = await db().loginTokens.consume(token, T0 + 1000);
          expect(first).toEqual({
            email: 'new@example.com',
            purpose: 'signin',
            data: { displayName: 'Newcomer', adultFrom: Date.UTC(2031, 4, 2) },
          });
          expect(await db().loginTokens.consume(token, T0 + 2000)).toBeNull();
        });

        it('R-SEC-006 login token consumed exactly once under concurrent attempts', async () => {
          const { token } = await db().loginTokens.issue({
            email: 'race@example.com',
            purpose: 'signin',
            ttlMs: HOUR,
            now: T0,
          });
          const results = await Promise.all(
            Array.from({ length: 12 }, () => db().loginTokens.consume(token, T0 + 1)),
          );
          expect(results.filter((r) => r !== null)).toHaveLength(1);
          const row = await db()
            .kysely.selectFrom('login_tokens')
            .select('used_at')
            .executeTakeFirstOrThrow();
          expect(row.used_at).toBe(T0 + 1);
        });

        it('R-SEC-006 a signup token carries a pending OAuth identity and validates it', async () => {
          const data = {
            displayName: 'Octo',
            adultFrom: Date.UTC(2020, 0, 1),
            oauth: { provider: 'github', providerUserId: '583231' },
          };
          const { token } = await db().loginTokens.issue({
            email: 'octo@example.com',
            purpose: 'signup',
            ttlMs: HOUR,
            data,
            now: T0,
          });
          expect(await db().loginTokens.consume(token, T0 + 1, 'signup')).toEqual({
            email: 'octo@example.com',
            purpose: 'signup',
            data,
          });
          await expect(
            db().loginTokens.issue({
              email: 'octo@example.com',
              purpose: 'signup',
              ttlMs: HOUR,
              data: { oauth: { provider: 'a-provider-name-too-long', providerUserId: '1' } },
            }),
          ).rejects.toBeInstanceOf(DbDataError);
        });

        it('R-SEC-006 expired or wrong-purpose tokens are refused', async () => {
          const a = await db().loginTokens.issue({
            email: 'a@example.com',
            purpose: 'signin',
            ttlMs: 1000,
            now: T0,
          });
          expect(await db().loginTokens.consume(a.token, T0 + 1000)).toBeNull();
          const b = await db().loginTokens.issue({
            email: 'b@example.com',
            purpose: 'signin',
            ttlMs: HOUR,
            now: T0,
          });
          expect(await db().loginTokens.consume(b.token, T0 + 1, 'link-oauth')).toBeNull();
          expect(await db().loginTokens.consume(b.token, T0 + 1, 'signin')).not.toBeNull();
          expect(await db().loginTokens.countIssuedSince('A@example.com', T0)).toBe(1);
          expect(await db().loginTokens.countIssuedSince('a@example.com', T0 + 1)).toBe(0);
          expect(await db().loginTokens.deleteExpired(T0 + HOUR)).toBe(2);
        });
      });

      describe('oauth accounts', () => {
        it('R-SEC-006 an OAuth identity links to one player only', async () => {
          const p = await makePlayer(db());
          const q = await makePlayer(db());
          expect(await db().oauthAccounts.link(p.id, 'github', '42', T0)).toBe(true);
          expect(await db().oauthAccounts.link(q.id, 'github', '42', T0)).toBe(false);
          expect(await db().oauthAccounts.findPlayerId('github', '42')).toBe(p.id);
          expect(await db().oauthAccounts.findPlayerId('google', '42')).toBeNull();
          expect(await db().oauthAccounts.listForPlayer(p.id)).toEqual([
            { provider: 'github', providerUserId: '42', playerId: p.id, createdAt: T0 },
          ]);
        });
      });
    },
  );
});
