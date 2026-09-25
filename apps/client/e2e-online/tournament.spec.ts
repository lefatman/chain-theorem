/**
 * M7 7.1 tournaments through the real UI, the real Worker and its Durable Objects (spec 10.4
 * R-WORLD-004): an admin (ADMIN_EMAILS) creates a tiny knockout event that starts in a few seconds;
 * two browsers, one a 360x640 phone, find it on the Tournaments screen and register; when the event
 * starts, both open "Play your game", both play moves on the board, one resigns, and both go back to
 * the tournament page to see the result, the bracket and their place.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { playMove, turnBanner } from '../e2e/helpers.ts';

const LOG = () => process.env.CT_WORKER_LOG ?? '';

function mails(email: string): string[] {
  const text = readFileSync(LOG(), 'utf8');
  const out: string[] = [];
  let at = text.indexOf(`[mail] to ${email}`);
  while (at >= 0) {
    const m = /http:\/\/\S+#\/login\?token=[\w%-]+/.exec(text.slice(at));
    if (m) out.push(m[0]);
    at = text.indexOf(`[mail] to ${email}`, at + 1);
  }
  return out;
}

/** The first magic link printed for `email` after `before` earlier ones. */
async function magicLink(email: string, before = 0): Promise<string> {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    const list = mails(email);
    if (list.length > before) return list[list.length - 1] as string;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no magic link for ${email}`);
}

interface Player {
  ctx: BrowserContext;
  page: Page;
  name: string;
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
  return { ctx, page, name, errors };
}

/**
 * The admin's session cookie (moderator@example.com is in ADMIN_EMAILS, e2e-online/setup.ts), through
 * the REST sign-in: a new account completes its profile, an existing one is signed in.
 */
async function adminCookie(base: string): Promise<string> {
  const email = 'moderator@example.com';
  const before = mails(email).length;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  expect((await post('/api/auth/start', { email })).ok).toBe(true);
  const link = await magicLink(email, before);
  const token = decodeURIComponent(/token=([\w%-]+)/.exec(link)?.[1] ?? '');
  const verify = await post('/api/auth/verify', { token });
  const v = (await verify.json()) as { status: string; signup?: string };
  const res =
    v.status === 'signed_in'
      ? verify
      : await post('/api/auth/complete', {
          signup: v.signup,
          name: 'Moderator',
          dob: '1990-01-01',
        });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  expect(cookie).toContain('=');
  return cookie;
}

async function noSideScroll(page: Page): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
}

/** White moves first: whichever page offers "Your move." once both boards are up is White. */
async function whiteOf(a: Player, b: Player): Promise<Player> {
  const until = Date.now() + 20_000;
  while (Date.now() < until) {
    for (const p of [a, b]) {
      const text = await turnBanner(p.page)
        .innerText()
        .catch(() => '');
      if (text.includes('Your move.')) return p;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('neither page got the first move');
}

test('M7 R-WORLD-004 R-FMT-004 two browsers register for a tournament and play their game through the UI', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const stamp = Date.now() % 100000;
  const tia = await player(browser, `Tia${stamp}`);
  const tom = await player(browser, `Tom${stamp}`, true);

  // An admin creates a two-player knockout (Full Battle) that starts in 25 seconds.
  const base = baseURL ?? '';
  const cookie = await adminCookie(base);
  const name = `E2E Cup ${stamp}`;
  const created = await fetch(`${base}/api/admin/tournaments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      name,
      format: 'full',
      bracket: '1-2',
      system: 'se',
      startInMs: 25_000,
      breakMs: 0,
      maxPlayers: 2,
    }),
  });
  expect(created.status).toBe(200);

  // Tia registers from the list; Tom (on a phone) from the event's page.
  await tia.page.goto('/#/online');
  await tia.page.getByRole('button', { name: 'Tournaments' }).click();
  await expect(tia.page.getByRole('heading', { name: 'Tournaments', level: 2 })).toBeVisible();
  const card = tia.page.getByRole('listitem').filter({ hasText: name });
  await expect(card).toContainText('Knockout · 1-2 slots');
  await card.getByRole('button', { name: 'Register' }).click();
  await expect(card).toContainText('you are in');
  await card.getByRole('link', { name }).click();
  await expect(tia.page.getByRole('heading', { name, level: 2 })).toBeVisible();
  await expect(tia.page.getByRole('status').first()).toContainText('You are registered');

  await tom.page.goto('/#/online');
  await tom.page.getByRole('button', { name: 'Tournaments' }).click();
  await tom.page.getByRole('link', { name }).click();
  await expect(tom.page.getByRole('heading', { name, level: 2 })).toBeVisible();
  await noSideScroll(tom.page);
  await tom.page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(tom.page.getByRole('status').first()).toContainText('You are registered');
  await expect(tom.page.getByRole('region', { name: 'Registered players' })).toContainText(
    tia.name,
  );

  // The event starts by itself; both get "Play your game" and join the battle.
  for (const p of [tia, tom]) {
    const play = p.page.getByRole('button', { name: 'Play your game' });
    await expect(play).toBeVisible({ timeout: 60_000 });
    await expect(p.page.getByRole('status').first()).toContainText('Final: your game against');
    await play.click();
  }
  for (const p of [tia, tom])
    await expect(p.page.getByRole('complementary', { name: 'Battle panel' })).toContainText(
      '10:00',
      { timeout: 20_000 },
    );
  const white = await whiteOf(tia, tom);
  const black = white === tia ? tom : tia;
  await playMove(white.page, 'e2', 'e4', 'white');
  await playMove(black.page, 'e7', 'e5', 'black');
  await playMove(white.page, 'g1', 'f3', 'white');
  await playMove(black.page, 'b8', 'c6', 'black');

  // White resigns: Black wins the final and the tournament.
  await white.page.getByRole('button', { name: 'Resign' }).click();
  await white.page
    .getByRole('button', { name: /Resign|Yes/ })
    .last()
    .click();
  for (const p of [white, black]) {
    const back = p.page.getByRole('button', { name: 'Back to the tournament' });
    await expect(back).toBeVisible({ timeout: 20_000 });
    await back.click();
    await expect(p.page.getByRole('heading', { name, level: 2 })).toBeVisible();
    await expect(p.page.getByText(`Finished · won by ${black.name}`)).toBeVisible({
      timeout: 20_000,
    });
  }
  await expect(black.page.getByRole('status').first()).toContainText('You finished 1st.');
  await expect(white.page.getByRole('status').first()).toContainText('You finished 2nd.');
  const bracket = black.page.getByRole('region', { name: 'Bracket' });
  await expect(bracket).toContainText('0–1');
  await expect(bracket.getByText('✓ advances')).toHaveCount(1);
  await expect(bracket).toContainText(`Winner: ${black.name}`);
  await noSideScroll(tom.page);
  expect(tia.errors).toEqual([]);
  expect(tom.errors).toEqual([]);
});
