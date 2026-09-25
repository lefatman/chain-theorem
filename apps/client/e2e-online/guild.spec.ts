/**
 * M6 guilds, ranked and leaderboards through the real UI (spec 10.4, 9.3): two browsers (one at
 * 360x640) against the real Worker, GuildRoom and ZoneRoom Durable Objects. One player founds a
 * guild and invites the other by name; the other accepts; both enter the world and talk in guild
 * chat; the roster shows ranks and who is online. The ranked panel shows the bracket and rating, and
 * the leaderboards screen opens on the player's bracket.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const LOG = () => process.env.CT_WORKER_LOG ?? '';

async function magicLink(email: string): Promise<string> {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const text = readFileSync(LOG(), 'utf8');
    const i = text.lastIndexOf(`[mail] to ${email}`);
    if (i >= 0) {
      const m = /http:\/\/\S+#\/login\?token=[\w%-]+/.exec(text.slice(i));
      if (m) return m[0];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no magic link for ${email}`);
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.close();
});

interface Player {
  page: Page;
  name: string;
  errors: string[];
}

async function player(browser: Browser, name: string, mobile = false): Promise<Player> {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 } },
  );
  contexts.push(ctx);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const email = `${name.toLowerCase()}-${Date.now()}@example.com`;
  await page.goto('/#/online');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  await page.goto(await magicLink(email));
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Date of birth').fill('2000-02-03');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();
  return { page, name, errors };
}

/** No sideways scrolling at the page level (360x640, 12.3). */
async function fitsWidth(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function enterWorld(p: Player): Promise<void> {
  await p.page.getByRole('button', { name: 'Enter the world' }).click();
  await p.page.waitForSelector('.world-host canvas');
  await expect(p.page.locator('.world-bar h2')).toContainText('Chess Academy');
}

const worldTab = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'World panels' }).getByRole('tab', { name });
const chatTab = (page: Page, name: RegExp) =>
  page.getByRole('tablist', { name: 'Chat channels' }).getByRole('tab', { name });

test('M6 R-WORLD-004 R-SEC-011 R-FMT-004 two players found and join a guild and talk in guild chat; ranked panel and leaderboards', async ({
  browser,
}) => {
  const stamp = String(Date.now()).slice(-4);
  const a = await player(browser, `Gwen${stamp}`);
  const b = await player(browser, `Hugo${stamp}`, true);
  const guildName = `Rook Hall ${stamp}`;
  const tag = `R${stamp.slice(-3)}`;

  // The ranked queue panel: bracket from the level (level 1: 1-2 slots) and the starting rating.
  const ranked = a.page.getByRole('group', { name: 'Ranked queue' });
  await expect(ranked).toContainText('1-2 item slots');
  await expect(ranked.getByLabel(/rating$/)).toContainText('1500');
  await expect(ranked.getByRole('button', { name: 'Join the ranked queue' })).toBeVisible();
  // Leaderboards open on the player's bracket; nobody is listed yet in a fresh database.
  await ranked.getByRole('button', { name: 'Leaderboards' }).click();
  await expect(a.page.getByRole('heading', { name: 'Leaderboards' })).toBeVisible();
  await expect(a.page.getByLabel('Bracket')).toHaveValue('1-2');
  await expect(a.page.getByRole('status')).toContainText('no rated games');
  await a.page.getByRole('button', { name: 'Guilds' }).click();
  await expect(a.page.locator('main')).toContainText('No guild is listed here yet.');
  await a.page.getByRole('button', { name: 'Back' }).click();

  // A founds a guild from the online screen.
  await a.page
    .getByRole('group', { name: 'Ranked queue' })
    .getByRole('button', { name: 'Guild' })
    .click();
  await expect(a.page.getByRole('heading', { name: 'Guild', exact: true })).toBeVisible();
  await a.page.getByLabel('Guild name').fill(guildName);
  await a.page.getByLabel(/^Tag/).fill(tag.toLowerCase());
  await a.page.getByRole('button', { name: 'Create guild' }).click();
  await expect(a.page.getByRole('heading', { name: new RegExp(guildName) })).toBeVisible();
  await expect(a.page.locator('.guild-panel')).toContainText(`[${tag}]`);
  await expect(a.page.locator('.guild-roster')).toContainText('Leader');

  // A invites B by display name.
  await a.page.getByLabel('Invite a player by name').fill(b.name);
  await a.page.getByRole('button', { name: 'Invite', exact: true }).click();
  await expect(a.page.getByRole('status')).toContainText(`Invitation sent to ${b.name}`);
  await expect(a.page.locator('.guild-panel')).toContainText(b.name);

  // B (on a phone) sees the invitation on the guild screen and accepts.
  await b.page.getByRole('button', { name: 'Guild', exact: true }).click();
  await expect(b.page.getByRole('heading', { name: 'Guild', exact: true })).toBeVisible();
  await expect(b.page.locator('.guild-invites')).toContainText(guildName);
  await b.page.getByRole('button', { name: `Accept the invitation to ${guildName}` }).click();
  await expect(b.page.getByRole('status')).toContainText(`You joined ${guildName}`);
  await expect(b.page.locator('.guild-roster')).toContainText(a.name);
  await expect(b.page.locator('.guild-roster li.own')).toContainText('Member');
  // A member cannot invite or change ranks.
  await expect(b.page.getByLabel('Invite a player by name')).toHaveCount(0);
  await expect(b.page.getByRole('button', { name: /Promote/ })).toHaveCount(0);
  await fitsWidth(b.page);

  // Both enter the world: the roster shows the other online; guild chat reaches both.
  await enterWorld(a);
  await enterWorld(b);
  await worldTab(a.page, /Guild/).click();
  await expect(a.page.locator('.guild-roster li', { hasText: b.name })).toContainText('online');
  // The leader promotes B from the world's guild panel.
  await a.page.getByRole('button', { name: `Promote ${b.name} to officer` }).click();
  await expect(a.page.locator('.guild-roster li', { hasText: b.name })).toContainText('Officer');

  await worldTab(a.page, /Chat/).click();
  await chatTab(a.page, /Guild/).click();
  await a.page.getByLabel('Chat message to guild').fill(`Welcome, ${b.name}!`);
  await a.page.getByRole('button', { name: 'Send' }).click();
  await expect(a.page.locator('.chat-log')).toContainText(`Welcome, ${b.name}!`);

  await worldTab(b.page, /Chat/).click();
  await chatTab(b.page, /Guild/).click();
  await expect(b.page.locator('.chat-log')).toContainText(`Welcome, ${b.name}!`);
  await b.page.getByLabel('Chat message to guild').fill('Glad to be here');
  await b.page.getByRole('button', { name: 'Send' }).click();
  await expect(a.page.locator('.chat-log')).toContainText('Glad to be here');
  // Guild lines stay out of zone chat.
  await chatTab(b.page, /Zone/).click();
  await expect(b.page.locator('.chat-log')).not.toContainText('Glad to be here');

  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});
