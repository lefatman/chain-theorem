/**
 * M6 6.1 through the real UI and the real Worker (spec 10.4, 9.5, 14.4): a trial account sees Trade
 * and Wager battle disabled with the reason; both players subscribe through the local billing
 * provider; they trade an item for cards from the world's Players panel (an invitation prompt, a
 * change that visibly resets both confirmations, ready, confirm, one atomic transfer); then they
 * negotiate an item wager, both land in the battle, one resigns, and the winner is paid both stakes.
 * The second browser is a 360x640 phone. Every trade frame is checked for leaks (R-SEC-001).
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
  frames: string[];
  errors: string[];
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.close();
});

async function player(browser: Browser, name: string, mobile = false): Promise<Player> {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 } },
  );
  contexts.push(ctx);
  const page = await ctx.newPage();
  const frames: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
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
  return { page, name, frames, errors };
}

/** Subscribe through the local (fake) billing provider: checkout, pay, webhook (M6 6.3). */
async function subscribe(p: Player): Promise<void> {
  const url = await p.page.evaluate(async () => {
    const r = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: 'monthly' }),
    });
    return ((await r.json()) as { url: string }).url;
  });
  await p.page.goto(url);
  await p.page.getByRole('button', { name: /^Pay/ }).click();
  await p.page.waitForURL(/#\/account/);
  await expect
    .poll(() => p.page.evaluate(async () => (await fetch('/api/trades/access')).json()))
    .toEqual({ allowed: true, reason: null });
}

async function enterWorld(p: Player): Promise<void> {
  await p.page.goto('/#/world');
  await p.page.waitForSelector('.world-host canvas');
  await expect(p.page.locator('.world-bar h2')).toContainText('Chess Academy');
}

async function selectPlayer(p: Player, name: string): Promise<void> {
  await p.page.getByRole('tab', { name: /Players/ }).click();
  const row = p.page.locator('.player-name', { hasText: name });
  await expect(row).toBeVisible();
  if ((await row.getAttribute('aria-pressed')) !== 'true') await row.click();
  await expect(p.page.locator('.player-actions')).toBeVisible();
}

async function inventory(p: Player): Promise<Record<string, number>> {
  const inv = await p.page.evaluate(
    async () =>
      (await (await fetch('/api/inventory')).json()) as {
        items: { id: string; qty: number }[];
        cards: { id: string; qty: number }[];
      },
  );
  return Object.fromEntries([...inv.items, ...inv.cards].map((x) => [x.id, x.qty]));
}

/** Frames of the trade socket only (not the zone or the battle). */
function tradeFrames(p: Player): string[] {
  return p.frames.filter((f) => /^\{"t":"(tstate|tdone|tend)"/.test(f));
}

test('M6 R-COST-005 R-WORLD-004 R-SEC-004 R-FMT-006 R-SEC-001 a trade and a wager battle between two browsers', async ({
  browser,
}) => {
  const tag = String(Date.now()).slice(-4);
  const a = await player(browser, `Arlo${tag}`);
  const b = await player(browser, `Bea${tag}`, true);

  // 14.4: a trial account sees Trade and Wager battle disabled, with the reason.
  await subscribe(a);
  await enterWorld(a);
  await enterWorld(b);
  await selectPlayer(b, a.name);
  const bActions = b.page.locator('.player-actions');
  await expect(bActions.getByRole('button', { name: /Trade/ })).toBeDisabled();
  await expect(bActions.getByRole('button', { name: /Wager battle/ })).toBeDisabled();
  await expect(b.page.locator('#trade-locked')).toContainText('free-trial accounts cannot trade');
  await subscribe(b);
  await enterWorld(b);

  // A invites B to trade; B opens it from the prompt.
  await selectPlayer(a, b.name);
  await a.page.locator('.player-actions').getByRole('button', { name: /Trade/ }).click();
  const aw = a.page.getByRole('dialog', { name: new RegExp(`Trade with ${b.name}`) });
  await expect(aw).toBeVisible();
  await expect(b.page.locator('.world-prompts')).toContainText('wants to trade with you');
  await b.page.getByRole('button', { name: 'Open trade' }).click();
  const bw = b.page.getByRole('dialog', { name: new RegExp(`Trade with ${a.name}`) });
  await expect(bw).toBeVisible();

  // Offers: A's Dual Adept's Glove for B's Scout.
  await aw.getByLabel('Add from your collection').selectOption('items:dual_adepts_glove');
  await aw.getByRole('button', { name: 'Add', exact: true }).click();
  await bw.getByLabel('Add from your collection').selectOption('cards:scout');
  await bw.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(aw.locator('.trade-side.theirs')).toContainText('Scout');
  await expect(bw.locator('.trade-side.theirs')).toContainText("Dual Adept's Glove");

  // Both ready ... then B adds a card: both marks reset, and A is told plainly.
  await aw.getByRole('button', { name: 'Ready', exact: true }).click();
  await bw.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(aw.getByRole('button', { name: 'Confirm trade' })).toBeEnabled();
  await bw.getByLabel('Add from your collection').selectOption('cards:last_word');
  await bw.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(aw.locator('.trade-reset')).toContainText(
    `${b.name} changed the trade, so both players' ready marks and confirmations were reset`,
  );
  await expect(aw.getByRole('button', { name: 'Confirm trade' })).toBeDisabled();

  // Step 1: both ready. Step 2: both confirm.
  await aw.getByRole('button', { name: 'Ready', exact: true }).click();
  await bw.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(aw.getByRole('button', { name: 'Confirm trade' })).toBeEnabled();
  await aw.getByRole('button', { name: 'Confirm trade' }).click();
  await expect(bw.getByRole('button', { name: 'Confirm trade' })).toBeEnabled();
  await bw.getByRole('button', { name: 'Confirm trade' }).click();
  await expect(aw).toContainText('Trade complete.');
  await expect(bw).toContainText('Trade complete.');
  await expect(aw.locator('.trade-result')).toContainText('Last Word');
  await aw.getByRole('button', { name: 'Close' }).click();
  await bw.getByRole('button', { name: 'Close' }).click();
  expect(await inventory(a)).toMatchObject({ scout: 2, last_word: 2, hit_and_run: 1 });
  expect((await inventory(a)).dual_adepts_glove ?? 0).toBe(0);
  expect(await inventory(b)).toMatchObject({ dual_adepts_glove: 2, hit_and_run: 1 });
  expect((await inventory(b)).scout ?? 0).toBe(0);

  // An item wager: A stakes a Scout, B a Glove; explicit consent from both (9.5).
  await selectPlayer(a, b.name);
  await a.page
    .locator('.player-actions')
    .getByRole('button', { name: /Wager battle/ })
    .click();
  const aw2 = a.page.getByRole('dialog', { name: new RegExp(`Wager battle with ${b.name}`) });
  await expect(b.page.locator('.world-prompts')).toContainText('invites you to an item wager');
  await b.page.getByRole('button', { name: 'See the wager' }).click();
  const bw2 = b.page.getByRole('dialog', { name: new RegExp(`Wager battle with ${a.name}`) });
  await expect(bw2).toBeVisible();
  await expect(aw2.getByLabel('Format')).toHaveValue('first_blood');
  await aw2.getByLabel('Add from your collection').selectOption('cards:scout');
  await aw2.getByRole('button', { name: 'Add', exact: true }).click();
  await bw2.getByLabel('Add from your collection').selectOption('items:dual_adepts_glove');
  await bw2.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(aw2.locator('.trade-side.theirs')).toContainText("Dual Adept's Glove");
  await expect(bw2.locator('.trade-side.theirs')).toContainText('Scout');
  await aw2.getByRole('button', { name: 'Ready', exact: true }).click();
  await bw2.getByRole('button', { name: 'Ready', exact: true }).click();
  await expect(aw2.getByRole('button', { name: 'Confirm wager' })).toBeEnabled();
  await aw2.getByRole('button', { name: 'Confirm wager' }).click();
  await expect(bw2.getByRole('button', { name: 'Confirm wager' })).toBeEnabled();
  await bw2.getByRole('button', { name: 'Confirm wager' }).click();

  // Both land in the battle; the stakes are in escrow.
  await a.page.waitForURL(/#\/battle/);
  await b.page.waitForURL(/#\/battle/);
  await a.page.waitForSelector('.board-host canvas');
  expect((await inventory(a)).scout).toBe(1);
  expect((await inventory(b)).dual_adepts_glove).toBe(1);

  // A resigns: B takes both stakes.
  await a.page.getByRole('button', { name: 'Resign' }).click();
  await a.page
    .getByRole('button', { name: /Resign|Yes/ })
    .last()
    .click();
  await expect(a.page.getByRole('button', { name: 'Return to the world' })).toBeVisible();
  await expect(b.page.getByRole('button', { name: 'Return to the world' })).toBeVisible();
  await b.page.getByRole('button', { name: 'Return to the world' }).click();
  await b.page.waitForSelector('.world-host canvas');
  await expect(b.page.locator('.world-prompts')).toContainText('You won the wager.');
  await expect(b.page.locator('.world-prompts')).toContainText('Scout');
  await expect.poll(async () => (await inventory(b)).dual_adepts_glove).toBe(2);
  expect((await inventory(b)).scout).toBe(1);
  expect((await inventory(a)).scout).toBe(1);
  expect((await inventory(a)).dual_adepts_glove ?? 0).toBe(0);

  // R-SEC-001: trade frames carry offers only, never a loadout or whether anything is equipped.
  for (const p of [a, b]) {
    const seen = tradeFrames(p).join('\n');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain('hit_and_run');
    expect(seen).not.toMatch(/equip|loadout|"sets"|"elements"|owned|inventory/i);
  }
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  expect([...a.frames, ...b.frames].filter((f) => f.includes('"t":"err"'))).toEqual([]);
});
