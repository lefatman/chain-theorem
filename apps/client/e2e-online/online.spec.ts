/**
 * M4 done-when (spec 16): two browsers complete a timed battle with a mid-battle disconnect and
 * reconnect, and the R-SEC-001 payload scan passes on every WebSocket frame each browser received.
 * Everything runs through the real UI, the real Worker and its Durable Objects.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { playMove, turnBanner } from '../e2e/helpers.ts';

const LOG = () => process.env.CT_WORKER_LOG ?? '';

/** The latest magic link printed for `email` by the Worker's console mail sender. */
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
  ctx: BrowserContext;
  page: Page;
  frames: string[];
  name: string;
}

async function player(browser: Browser, name: string): Promise<Player> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const frames: string[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, frames, name };
}

async function signUp(p: Player, email: string): Promise<void> {
  const { page } = p;
  await page.goto('/#/online');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('status')).toContainText('Check your email');
  await page.goto(await magicLink(email));
  await page.getByLabel('Display name').fill(p.name);
  await page.getByLabel('Date of birth').fill('2000-02-03');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText(`Signed in as ${p.name}`)).toBeVisible();
}

/** Save a loadout through the account API from the signed-in page (the same call the UI makes). */
async function saveLoadout(p: Player, name: string, loadout: unknown): Promise<void> {
  const status = await p.page.evaluate(
    async ([n, l]) => {
      const r = await fetch('/api/loadouts', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: n, loadout: l }),
      });
      return r.status;
    },
    [name, loadout] as const,
  );
  expect(status).toBe(200);
  await p.page.reload();
  await expect(p.page.getByRole('combobox', { name: 'Loadout', exact: true })).toContainText(name);
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

test('M4 R-FMT-003 R-NET-001 R-SEC-001 two browsers: a timed battle with a disconnect and a reconnect', async ({
  browser,
}) => {
  const stamp = Date.now();
  const ada = await player(browser, 'Ada');
  const bo = await player(browser, 'Bo');
  await signUp(ada, `ada-${stamp}@example.com`);
  await signUp(bo, `bo-${stamp}@example.com`);
  // Different loadouts, so each side has ids the other must never see (R-SEC-001).
  await saveLoadout(ada, 'Ada Tide', {
    elements: ['tide'],
    items: ['dual_adepts_glove'],
    sets: [['hit_and_run', 'scout']],
  });
  await saveLoadout(bo, 'Bo Grove', {
    elements: ['grove'],
    items: ['dual_adepts_glove'],
    sets: [['last_word', 'scout']],
  });

  // Ada creates a challenge link for a Full Battle and waits inside it.
  await ada.page.getByLabel('Format').selectOption('full');
  await ada.page.getByRole('button', { name: 'Create a challenge link' }).click();
  const link = await ada.page.getByLabel('Challenge link').inputValue();
  expect(link).toMatch(/#\/online\?c=\w+/);
  await ada.page.getByRole('button', { name: 'Wait in the battle' }).click();

  // Bo opens the link and accepts.
  await bo.page.goto(link);
  await expect(bo.page.getByRole('heading', { name: 'Challenge from Ada' })).toBeVisible();
  await bo.page.getByRole('button', { name: 'Accept with the selected loadout' }).click();

  // Both boards come up with running clocks (timed battle, 9.2).
  for (const p of [ada, bo]) {
    await expect(p.page.getByRole('complementary', { name: 'Battle panel' })).toContainText(
      '10:00',
      { timeout: 20_000 },
    );
  }
  const white = await whiteOf(ada, bo);
  const black = white === ada ? bo : ada;

  await playMove(white.page, 'e2', 'e4', 'white');
  await playMove(black.page, 'e7', 'e5', 'black');
  await playMove(white.page, 'g1', 'f3', 'white');

  // Black disconnects mid-battle (the tab reloads and loses its socket).
  await black.page.reload();
  await expect(
    white.page.getByText(/disconnected\. They lose by abandonment in \d+ s/),
  ).toBeVisible();

  // Black rejoins from the online screen; the reconnect replays the battle so far.
  await black.page.goto('/#/online');
  await black.page.getByRole('button', { name: /^Rejoin Full Battle vs / }).click();
  await expect(turnBanner(black.page)).toContainText('Your move.');
  await expect(black.page.getByRole('log')).toContainText(/g1\W.*f3/);
  await expect(white.page.getByText(/disconnected\./)).toHaveCount(0);

  await playMove(black.page, 'b8', 'c6', 'black');
  await expect(turnBanner(white.page)).toContainText('Your move.');
  await expect(white.page.getByRole('log')).toContainText(/b8\W.*c6/);

  // The battle completes: White resigns.
  await white.page.getByRole('button', { name: 'Resign' }).click();
  await white.page.getByRole('button', { name: 'Yes, resign' }).click();
  for (const p of [white, black])
    await expect(p.page.locator('.result[role="status"]')).toBeVisible();

  // R-SEC-001: nothing the opponent never revealed appears in any frame a browser received.
  const hidden: Record<string, string[]> = { Ada: ['last_word'], Bo: ['hit_and_run'] };
  for (const p of [ada, bo]) {
    expect(p.frames.length).toBeGreaterThan(5);
    for (const id of hidden[p.name] ?? []) {
      const leaks = p.frames.filter((f) => f.includes(`"${id}"`));
      expect(leaks, `${p.name} received ${id}`).toEqual([]);
    }
  }
  await ada.ctx.close();
  await bo.ctx.close();
});
