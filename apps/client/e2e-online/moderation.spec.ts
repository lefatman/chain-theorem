/**
 * M6 6.4 through the real UI and Worker (spec 15 R-SEC-011, R-SEC-006; 10.4 R-WORLD-004): a player
 * on a phone (360x640) reports a chat line and blocks its sender from the report dialog; the blocked
 * player's whisper and consent challenge are refused like an offline or busy player's and never
 * arrive; the report appears in the admin console, where a moderator reviews it, finds the player
 * and suspends them: their zone socket is closed, the world says so and signing in is refused.
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

interface Player {
  page: Page;
  name: string;
  email: string;
  frames: string[];
  errors: string[];
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.close();
});

async function requestLink(page: Page, email: string): Promise<void> {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
}

async function player(
  browser: Browser,
  name: string,
  opts: { mobile?: boolean; email?: string } = {},
): Promise<Player> {
  const ctx = await browser.newContext(
    opts.mobile
      ? { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 } },
  );
  contexts.push(ctx);
  const page = await ctx.newPage();
  const frames: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  const email = opts.email ?? `${name.toLowerCase()}-${Date.now()}@example.com`;
  await page.goto('/#/online');
  await requestLink(page, email);
  await page.goto(await magicLink(email));
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Date of birth').fill('1999-04-05');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Signed in as ${name}`)).toBeVisible();
  return { page, name, email, frames, errors };
}

async function enterWorld(p: Player): Promise<void> {
  await p.page.getByRole('button', { name: 'Enter the world' }).click();
  await p.page.waitForSelector('.world-host canvas');
  await expect(p.page.locator('.world-bar h2')).toContainText('Chess Academy');
}

/** Select `name` in the Players panel (a second click would unselect). */
async function selectPlayer(p: Player, name: string): Promise<void> {
  await p.page.getByRole('tab', { name: /Players/ }).click();
  const row = p.page.locator('.player-name', { hasText: name });
  if ((await row.getAttribute('aria-pressed')) !== 'true') await row.click();
}

test('M6 R-SEC-011 R-WORLD-004 R-SEC-006 block stops a whisper and a challenge; a report reaches the admin console; a suspended player is disconnected', async ({
  browser,
}) => {
  const tag = String(Date.now()).slice(-4);
  const a = await player(browser, `Ines${tag}`, { mobile: true });
  const b = await player(browser, `Otto${tag}`);
  await enterWorld(a);
  await enterWorld(b);

  // B says something in zone chat; A reports that line from the chat (360x640).
  await b.page.getByLabel('Chat message to zone').fill('you are terrible at this');
  await b.page.getByRole('button', { name: 'Send' }).click();
  await expect(a.page.locator('.chat-log')).toContainText('you are terrible at this');
  await a.page.getByRole('button', { name: `Actions for ${b.name}'s message` }).click();
  await a.page
    .locator('.line-actions')
    .getByRole('button', { name: /Report/ })
    .click();
  const dialog = a.page.getByRole('dialog', { name: `Report ${b.name}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Send report' })).toBeDisabled();
  await dialog.getByLabel('Harassment or bullying').check();
  await expect(dialog.getByLabel(/Include the message/)).toBeChecked();
  await dialog.getByLabel(/Anything else/).fill('e2e: rude in zone chat');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(dialog.getByRole('status').first()).toContainText('The moderators will look at it');
  // Block is one tap away; the line A already saw is hidden at once.
  await dialog.getByRole('button', { name: `Block ${b.name}` }).click();
  await expect(dialog).toContainText(`You blocked ${b.name}`);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(a.page.locator('.chat-log')).not.toContainText('you are terrible at this');
  // The Safety list offers Unblock.
  await a.page.getByRole('tab', { name: /Settings/ }).click();
  await expect(a.page.getByRole('list', { name: 'Blocked players' })).toContainText(b.name);

  // B's whisper is refused exactly like one to an offline player, and never reaches A.
  await selectPlayer(b, a.name);
  await b.page.locator('.player-actions').getByRole('button', { name: 'Whisper' }).click();
  await b.page.getByLabel('Chat message to whisper').fill('let me explain myself');
  await b.page.getByRole('button', { name: 'Send' }).click();
  await expect(b.page.locator('.toasts')).toContainText('cannot receive your whispers');
  // B's consent challenge is refused like one to a busy player; A gets no prompt.
  await selectPlayer(b, a.name);
  await b.page.locator('.player-actions').getByRole('button', { name: 'Challenge' }).click();
  await expect(b.page.locator('.toasts')).toContainText('That player is busy.');
  await a.page.waitForTimeout(500);
  await expect(a.page.getByText(/challenges you/)).toHaveCount(0);
  expect(a.frames.some((f) => f.includes('let me explain myself'))).toBe(false);
  expect(a.frames.some((f) => f.includes('"t":"chalIn"'))).toBe(false);

  // The moderator (ADMIN_EMAILS) sees the report in the console and reviews it.
  const mod = await player(browser, `Mod${tag}`, { email: 'moderator@example.com' });
  await mod.page.goto('/admin');
  await expect(mod.page.getByRole('heading', { name: 'Moderation console' })).toBeVisible();
  const card = mod.page.getByRole('article').filter({ hasText: 'e2e: rude in zone chat' });
  await expect(card).toContainText(b.name);
  await expect(card).toContainText(a.name);
  await expect(card).toContainText('you are terrible at this');
  await card.getByLabel('Moderator note (optional)').fill('confirmed in chat');
  await card.getByRole('button', { name: 'Mark reviewed' }).click();
  await expect(mod.page.getByRole('status')).toContainText('Report marked reviewed.');
  await expect(
    mod.page.getByRole('article').filter({ hasText: 'e2e: rude in zone chat' }),
  ).toHaveCount(0);

  // Lookup, then an indefinite suspension.
  await mod.page.getByLabel(/Find a player/).fill(b.name);
  await mod.page.getByRole('button', { name: 'Search' }).click();
  await mod.page.getByRole('link', { name: b.name }).click();
  await expect(mod.page.getByRole('heading', { level: 1 })).toHaveText(b.name);
  await expect(mod.page.locator('body')).not.toContainText(b.email);
  await mod.page.getByLabel('Indefinitely (ignores hours)').check();
  await mod.page.locator('#s-reason').fill('harassment (e2e)');
  await mod.page.getByRole('button', { name: 'Suspend', exact: true }).click();
  await expect(mod.page.getByRole('status')).toContainText('Player suspended');
  await expect(mod.page.locator('section[aria-label="Account facts"]')).toContainText(
    'Suspended indefinitely',
  );

  // B's zone socket is closed: the world says why and does not reconnect.
  await expect(b.page.locator('.world-conn')).toContainText('This account is suspended.');
  // Signing in again is refused.
  await b.page.goto('/#/online');
  await b.page.reload();
  await requestLink(b.page, b.email);
  await b.page.goto(await magicLink(b.email));
  await expect(b.page.getByRole('alert')).toContainText('This account is suspended');
  // R-SEC-010: the suspended player can still download their data (and delete the account).
  const exportLink = b.page.getByRole('link', { name: 'Download my data' });
  await expect(exportLink).toBeVisible();
  const exported = await b.page.evaluate(
    async (href) => {
      const r = await fetch(href);
      return { status: r.status, body: (await r.json()) as { player?: { id?: string } } };
    },
    (await exportLink.getAttribute('href')) ?? '',
  );
  expect(exported.status).toBe(200);
  expect(exported.body.player?.id).toBeTruthy();
  await expect(b.page.getByRole('button', { name: 'Delete my account' })).toBeVisible();

  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  expect(mod.errors).toEqual([]);
});
