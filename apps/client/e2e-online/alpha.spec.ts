/**
 * Alpha guest play end to end (spec 9.6, R-FMT-007; DD-107): two browsers with no account at all.
 * Ada becomes a guest, picks a format and level 12, creates a one-time code and waits in the battle;
 * Bo opens the link, becomes a guest, builds a loadout at the code's level in the editor and accepts.
 * Both boards come up with First Blood clocks, a move each is played, and every WebSocket frame each
 * browser received is scanned for the other's unrevealed ability id (R-SEC-001). Everything goes
 * through the real UI, the real Worker (ALPHA_GUEST_PLAY on, setup.ts) and its Durable Objects.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { playMove, turnBanner } from '../e2e/helpers.ts';

interface Guest {
  ctx: BrowserContext;
  page: Page;
  frames: string[];
  errors: string[];
  name: string;
}

async function guest(browser: Browser, name: string): Promise<Guest> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const frames: string[] = [];
  const errors: string[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, frames, errors, name };
}

/** The "Play as a guest" button, then the guest name the server handed out ("Guest NNNN"). */
async function playAsGuest(p: Guest): Promise<string> {
  await p.page.getByRole('button', { name: 'Play as a guest' }).click();
  const who = p.page.getByText(/You are Guest \d{4}/);
  await expect(who).toBeVisible({ timeout: 15_000 });
  const m = /Guest \d{4}/.exec(await who.innerText());
  if (!m) throw new Error('no guest name');
  return m[0];
}

/** White moves first: whichever page offers "Your move." once both boards are up is White. */
async function whiteOf(a: Guest, b: Guest): Promise<Guest> {
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

test('R-FMT-007 R-SEC-001 two guests without accounts play by one-time code at the creator level', async ({
  browser,
}) => {
  const ada = await guest(browser, 'Ada');
  const bo = await guest(browser, 'Bo');

  // Ada: a guest, First Blood at level 12 with the default Tide loadout (Hit and Run, Scout).
  await ada.page.goto('/#/alpha');
  await expect(ada.page.getByRole('heading', { name: 'Alpha play' })).toBeVisible({
    timeout: 15_000,
  });
  const adaName = await playAsGuest(ada);
  await ada.page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('first_blood');
  await ada.page.getByRole('spinbutton', { name: 'Level' }).fill('12');
  await expect(ada.page.getByRole('region', { name: 'Check' })).toContainText('Ready for battle');
  await ada.page.getByRole('button', { name: 'Create a code' }).click();
  const status = ada.page.getByRole('status');
  await expect(status).toContainText('The code works once', { timeout: 15_000 });
  const code = await ada.page.getByLabel('Alpha code').inputValue();
  expect(code).toMatch(/^[A-Za-z0-9]{6,16}$/);
  const link = await ada.page.getByLabel('Alpha link').inputValue();
  expect(link).toMatch(/#\/alpha\?c=/);
  expect(link).toContain(code);
  await ada.page.getByRole('button', { name: 'Wait in the battle' }).click();

  // Bo: opens the link, becomes a guest, builds Grove with Last Word and Scout at the code's level.
  await bo.page.goto(link);
  await expect(
    bo.page.getByRole('heading', { name: /^Alpha battle from Guest \d{4}$/ }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    bo.page.getByRole('heading', { name: `Alpha battle from ${adaName}` }),
  ).toBeVisible();
  await expect(bo.page.getByText('First Blood · level 12')).toBeVisible();
  const boName = await playAsGuest(bo);
  expect(boName).not.toBe(adaName);
  // The joiner builds at the lobby's level: no level input, a statement of level 12 instead.
  await expect(bo.page.getByRole('spinbutton')).toHaveCount(0);
  await expect(bo.page.getByText(/must be legal at level 12/)).toBeVisible();
  await bo.page.getByRole('radio', { name: /^Grove\b/ }).check();
  await bo.page.getByRole('button', { name: 'Remove Hit and Run' }).click();
  await bo.page
    .getByRole('article', { name: 'Last Word', exact: true })
    .getByRole('button', { name: 'Add to set' })
    .click();
  await expect(bo.page.getByRole('region', { name: 'Check' })).toContainText('Ready for battle');
  await bo.page.getByRole('button', { name: 'Accept and play' }).click();

  // Both boards come up with First Blood clocks (3:00, config FORMATS); both names are shown.
  for (const p of [ada, bo]) {
    await expect(p.page.getByRole('complementary', { name: 'Battle panel' })).toContainText(
      '3:00',
      { timeout: 20_000 },
    );
    await expect(p.page.getByRole('complementary', { name: 'Battle panel' })).toContainText(
      p === ada ? boName : adaName,
    );
  }
  const white = await whiteOf(ada, bo);
  const black = white === ada ? bo : ada;
  await playMove(white.page, 'e2', 'e4', 'white');
  await playMove(black.page, 'e7', 'e5', 'black');
  await expect(turnBanner(white.page)).toContainText('Your move.');
  await expect(white.page.getByRole('log')).toContainText(/e7\W.*e5/);

  // R-SEC-001: nothing the opponent never revealed appears in any frame a browser received.
  const hidden: Record<string, string[]> = { Ada: ['last_word'], Bo: ['hit_and_run'] };
  for (const p of [ada, bo]) {
    expect(p.frames.length, `${p.name} received frames`).toBeGreaterThan(2);
    for (const id of hidden[p.name] ?? []) {
      const leaks = p.frames.filter((f) => f.includes(`"${id}"`));
      expect(leaks, `${p.name} received ${id}`).toEqual([]);
    }
    expect(p.errors, `${p.name} page errors`).toEqual([]);
  }
  await ada.ctx.close();
  await bo.ctx.close();
});
