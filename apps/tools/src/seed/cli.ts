/**
 * `pnpm seed` (TESTING.md 4): resets the local data used by `pnpm dev` (D1, R2 and Durable Object
 * storage under .wrangler/state) and creates test accounts: levels 1, 10 and 25 plus one under-18
 * account (R-SEC-011). Each has a legal saved loadout; the level 10 and 25 accounts own the whole
 * catalogue. Sign in with the printed email; the magic link appears in the `pnpm dev` console.
 */
import { rmSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import { abilities, engine, items } from '@chain-theorem/content';
import { npcBuild } from '@chain-theorem/content/npcs';
import { migrate, type Db } from '@chain-theorem/db';
import { d1Db } from '@chain-theorem/db/d1';
import type { D1Database } from '@cloudflare/workers-types';
import type { Loadout } from '@chain-theorem/rules';

const root = new URL('../../../../', import.meta.url).pathname;
const state = `${root}.wrangler/state`;

interface Account {
  email: string;
  name: string;
  level: number;
  /** Birth date used only to derive adult_from here; it is never stored. */
  born: [number, number, number];
  full: boolean;
}

const now = new Date();
const y = now.getUTCFullYear();
const ACCOUNTS: Account[] = [
  { email: 'level1@local.test', name: 'Rookie', level: 1, born: [y - 25, 0, 15], full: false },
  { email: 'level10@local.test', name: 'Adept', level: 10, born: [y - 30, 5, 1], full: true },
  { email: 'level25@local.test', name: 'Master', level: 25, born: [y - 35, 8, 9], full: true },
  { email: 'minor@local.test', name: 'Junior', level: 5, born: [y - 15, 2, 3], full: false },
];

async function create(db: Db, a: Account): Promise<void> {
  const adultFrom = Date.UTC(a.born[0] + 18, a.born[1], a.born[2]);
  const p = await db.players.create({ email: a.email, displayName: a.name, adultFrom });
  await db.kysely.updateTable('players').set({ level: a.level }).where('id', '=', p.id).execute();
  const own = a.full
    ? {
        items: items.filter((i) => !i.retired).map((i) => i.id),
        cards: abilities.filter((x) => !x.retired).map((x) => x.id),
      }
    : {
        items: items.filter((i) => i.minLevel <= Math.min(a.level, 1)).map((i) => i.id),
        cards: abilities.filter((x) => x.minLevel <= Math.min(a.level, 1)).map((x) => x.id),
      };
  for (const id of own.items) await db.inventory.grant(p.id, 'item', id, 1);
  for (const id of own.cards) await db.inventory.grant(p.id, 'card', id, 1);
  // A legal loadout at the account's level from what it owns (the Trainer NPC build when owned).
  const build = npcBuild('trainer', a.full ? a.level : 1, a.level);
  const loadout: Loadout = build.loadout;
  const v = engine.validateLoadout(loadout, {
    level: a.level,
    ownedItems: own.items,
    ownedAbilities: own.cards,
  });
  await db.loadouts.save(p.id, { name: `${a.name}'s build`, loadout, isValid: v.ok });
}

rmSync(state, { recursive: true, force: true });
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  configPath: `${root}apps/server/wrangler.jsonc`,
  persist: { path: `${state}/v3` },
});
try {
  const db = d1Db(proxy.env.DB);
  await migrate(db);
  for (const a of ACCOUNTS) await create(db, a);
  console.log(
    'seed: local data reset; accounts (sign in by email, the link is printed by `pnpm dev`):',
  );
  for (const a of ACCOUNTS)
    console.log(
      `  ${a.email.padEnd(20)} level ${String(a.level).padEnd(2)} ${a.email.startsWith('minor') ? '(under 18)' : ''}`,
    );
} finally {
  await proxy.dispose();
}
