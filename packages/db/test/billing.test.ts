/**
 * Subscription billing on every engine (M6 6.3; R-SEC-007, R-COST-005, R-SEC-010): idempotent and
 * out-of-order-safe webhook events, provider accounts, the trial date, export and deletion, and the
 * 0004 trial backfill.
 */
import { describe, expect, it } from 'vitest';
import { MIGRATIONS, migrate, type BillingEventInput, type Db } from '../src/index.ts';
import { columnTypes } from '../src/migrations/types.ts';
import { ENGINES, makePlayer, useDb } from './engines.ts';

const T0 = Date.UTC(2026, 8, 25);
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

function ev(
  playerId: string | null,
  eventId: string,
  occurredAt: number,
  state?: BillingEventInput['state'],
): BillingEventInput {
  return {
    provider: 'fake',
    eventId,
    eventType: 'subscription.updated',
    occurredAt,
    playerId,
    ...(state ? { state } : {}),
    receivedAt: occurredAt + 5,
  };
}

async function sub(db: Db, id: string) {
  const p = await db.players.getById(id);
  return { status: p?.subStatus, expires: p?.subExpiresAt };
}

describe.each(ENGINES)('billing on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine);

      it('R-SEC-007 a verified event sets the entitlement once; a replay changes nothing', async () => {
        const p = await makePlayer(db());
        const created = ev(p.id, 'evt_1', T0, {
          subStatus: 'active',
          subExpiresAt: T0 + 30 * DAY,
          customerId: 'ctm_1',
          subscriptionId: 'sub_1',
          plan: 'monthly',
          cancelAt: null,
        });
        expect(await db().billing.record(created)).toBe('applied');
        expect(await sub(db(), p.id)).toEqual({ status: 'active', expires: T0 + 30 * DAY });
        expect(await db().billing.record(created)).toBe('duplicate');
        expect(
          await db().billing.record({
            ...created,
            state: { subStatus: 'canceled', subExpiresAt: 1 },
          }),
        ).toBe('duplicate');
        expect(await sub(db(), p.id)).toEqual({ status: 'active', expires: T0 + 30 * DAY });
        expect(await db().billing.account(p.id)).toMatchObject({
          provider: 'fake',
          customerId: 'ctm_1',
          subscriptionId: 'sub_1',
          plan: 'monthly',
          cancelAt: null,
          stateAt: T0,
        });
        expect(await db().billing.events(p.id)).toHaveLength(1);
        const audit = await db().audit.listForPlayer(p.id);
        expect(audit.map((a) => a.kind)).toEqual(['billing_event']);
        expect(audit[0]?.payload).toMatchObject({ eventId: 'evt_1', subStatus: 'active' });
      });

      it('R-SEC-007 an older event never overwrites newer state (out of order)', async () => {
        const p = await makePlayer(db());
        const newer = ev(p.id, 'evt_new', T0 + DAY, {
          subStatus: 'canceled',
          subExpiresAt: T0 + DAY,
          subscriptionId: 'sub_1',
          cancelAt: null,
        });
        const older = ev(p.id, 'evt_old', T0, {
          subStatus: 'active',
          subExpiresAt: T0 + 30 * DAY,
          customerId: 'ctm_1',
          subscriptionId: 'sub_1',
          plan: 'monthly',
          cancelAt: T0 + 30 * DAY,
        });
        expect(await db().billing.record(newer)).toBe('applied');
        expect(await db().billing.record(older)).toBe('stale');
        expect(await sub(db(), p.id)).toEqual({ status: 'canceled', expires: T0 + DAY });
        const acct = await db().billing.account(p.id);
        expect(acct).toMatchObject({ stateAt: T0 + DAY, cancelAt: null, customerId: null });
        // Both are recorded (so a retry of the stale one is a duplicate, not a second try).
        expect((await db().billing.events(p.id)).map((e) => e.eventId)).toEqual([
          'evt_old',
          'evt_new',
        ]);
        expect(await db().billing.record(older)).toBe('duplicate');
      });

      it('R-SEC-007 concurrent deliveries in any order end at the newest event', async () => {
        const p = await makePlayer(db());
        const events = Array.from({ length: 8 }, (_, i) =>
          ev(p.id, `evt_${i}`, T0 + i * 1000, {
            subStatus: i % 2 === 0 ? 'active' : 'past_due',
            subExpiresAt: T0 + (i + 1) * DAY,
            subscriptionId: 'sub_1',
          }),
        );
        const shuffled = [events[5], events[1], events[7], events[0], events[3], events[6]];
        shuffled.push(events[2], events[4]);
        const outcomes = await Promise.all(shuffled.map((e) => db().billing.record(e!)));
        expect(outcomes.every((o) => o === 'applied' || o === 'stale')).toBe(true);
        expect(await sub(db(), p.id)).toEqual({ status: 'past_due', expires: T0 + 8 * DAY });
        expect((await db().billing.account(p.id))?.stateAt).toBe(T0 + 7000);
        expect(await db().billing.events(p.id)).toHaveLength(8);
      });

      it('R-SEC-007 missing ids keep the stored ones; a renewal keeps a scheduled cancel', async () => {
        const p = await makePlayer(db());
        await db().billing.record(
          ev(p.id, 'e1', T0, {
            subStatus: 'active',
            subExpiresAt: T0 + 30 * DAY,
            customerId: 'ctm_1',
            subscriptionId: 'sub_1',
            plan: 'yearly',
            cancelAt: T0 + 30 * DAY,
          }),
        );
        // A transaction event names neither the plan nor the cancel: both stay.
        await db().billing.record(
          ev(p.id, 'e2', T0 + 1, { subStatus: 'active', subExpiresAt: T0 + 30 * DAY }),
        );
        expect(await db().billing.account(p.id)).toMatchObject({
          customerId: 'ctm_1',
          subscriptionId: 'sub_1',
          plan: 'yearly',
          cancelAt: T0 + 30 * DAY,
          stateAt: T0 + 1,
        });
        // Undoing the cancel clears it.
        await db().billing.record(
          ev(p.id, 'e3', T0 + 2, {
            subStatus: 'active',
            subExpiresAt: T0 + 30 * DAY,
            cancelAt: null,
          }),
        );
        expect((await db().billing.account(p.id))?.cancelAt).toBeNull();
        expect(await db().billing.findPlayer('fake', { subscriptionId: 'sub_1' })).toBe(p.id);
        expect(await db().billing.findPlayer('fake', { customerId: 'ctm_1' })).toBe(p.id);
        expect(await db().billing.findPlayer('paddle', { subscriptionId: 'sub_1' })).toBeNull();
        expect(await db().billing.findPlayer('fake', { subscriptionId: 'nope' })).toBeNull();
      });

      it('R-SEC-007 an event for no known player is recorded once and changes no one', async () => {
        const p = await makePlayer(db());
        expect(await db().billing.record(ev(null, 'evt_orphan', T0))).toBe('recorded');
        expect(await db().billing.record(ev(null, 'evt_orphan', T0))).toBe('duplicate');
        expect(await sub(db(), p.id)).toEqual({ status: 'none', expires: null });
        const rows = await db().kysely.selectFrom('billing_events').selectAll().execute();
        expect(rows.map((r) => [r.event_id, r.player_id])).toEqual([['evt_orphan', null]]);
      });

      it('R-COST-005 sign-up stores the trial end; it can be moved (tests, local tools)', async () => {
        const p = await db().players.create({
          email: 'trial@example.com',
          displayName: 'Trial',
          adultFrom: Date.UTC(2000, 0, 1),
          trialEndsAt: T0 + WEEK,
          now: T0,
        });
        expect(p.trialEndsAt).toBe(T0 + WEEK);
        expect(await db().billing.setTrialEndsAt(p.id, T0 - 1)).toBe(true);
        expect((await db().players.getById(p.id))?.trialEndsAt).toBe(T0 - 1);
        expect(await db().billing.setTrialEndsAt('missing', T0)).toBe(false);
      });

      it('R-SEC-010 export includes the billing account and events; delete removes them', async () => {
        const p = await makePlayer(db(), 'payer@example.com', 'Payer');
        const other = await makePlayer(db(), 'other@example.com', 'Other');
        const state = {
          subStatus: 'active',
          subExpiresAt: T0 + 30 * DAY,
          customerId: 'ctm_9',
          subscriptionId: 'sub_9',
          plan: 'quarterly',
        };
        await db().billing.record(ev(p.id, 'evt_a', T0, state));
        await db().billing.record(ev(other.id, 'evt_b', T0, { ...state, subscriptionId: 'sub_8' }));
        const out = await db().players.exportData(p.id, T0 + 10);
        expect(out?.player.subStatus).toBe('active');
        expect(out?.billing.account).toMatchObject({ subscriptionId: 'sub_9', plan: 'quarterly' });
        expect(out?.billing.events.map((e) => [e.eventId, e.payload.subStatus])).toEqual([
          ['evt_a', 'active'],
        ]);
        expect(JSON.parse(JSON.stringify(out))).toEqual(out);

        expect(await db().players.delete(p.id)).toBe(true);
        const k = db().kysely;
        expect(
          await k
            .selectFrom('billing_accounts')
            .selectAll()
            .where('player_id', '=', p.id)
            .execute(),
        ).toEqual([]);
        expect(
          await k.selectFrom('billing_events').selectAll().where('player_id', '=', p.id).execute(),
        ).toEqual([]);
        // The other player's billing is untouched.
        expect(await db().billing.account(other.id)).not.toBeNull();
        expect(await db().billing.events(other.id)).toHaveLength(1);
      });
    },
  );
});

describe.each(ENGINES)('0004 trial backfill on $name', (engine) => {
  describe.skipIf(!engine.available)(
    engine.available ? 'available' : 'skipped: TEST_PG_URL is not set',
    () => {
      const db = useDb(engine, { migrate: false });

      it('R-COST-005 accounts from before billing get created_at + 7 days as their trial end', async () => {
        const d = db();
        const t = columnTypes(d.dialect);
        const schema = d.kysely.schema;
        // The database as it was before 0004: the ledger and every earlier migration.
        await d.atomic([
          schema
            .createTable('schema_migrations')
            .ifNotExists()
            .addColumn('id', 'text', (c) => c.primaryKey())
            .addColumn('applied_at', t.ts, (c) => c.notNull())
            .compile(),
        ]);
        for (const m of MIGRATIONS.filter((x) => x.id < '0004')) {
          await d.atomic([
            ...m.up({ dialect: d.dialect, schema, t }),
            d.kysely.insertInto('schema_migrations').values({ id: m.id, applied_at: T0 }).compile(),
          ]);
        }
        const base = { adult_from: 0, created_at: T0 - 30 * DAY };
        await d.kysely
          .insertInto('players')
          .values([
            { ...base, id: 'old', email: 'old@example.com', display_name: 'Old' },
            {
              ...base,
              id: 'set',
              email: 'set@example.com',
              display_name: 'Set',
              trial_ends_at: T0 + DAY,
            },
          ])
          .execute();
        const applied = await migrate(d);
        expect(applied).toContain('0004_billing');
        expect((await d.players.getById('old'))?.trialEndsAt).toBe(T0 - 30 * DAY + WEEK);
        expect((await d.players.getById('set'))?.trialEndsAt).toBe(T0 + DAY);
        expect(await migrate(d)).toEqual([]);
      });
    },
  );
});
