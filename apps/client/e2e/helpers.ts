/**
 * Shared end-to-end helpers: a `test` that fails on any console error or uncaught exception, local
 * battle setup through the real UI, and canvas clicks by square name. The board canvas is exactly
 * the 8x8 grid (BoardScene, Scale.FIT), so a square's centre follows from the canvas bounding box:
 * White sits at the bottom when the viewer plays White, Black when the viewer plays Black.
 */
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import type { FormatId, Side } from '@chain-theorem/rules';

export { expect };
export type { FormatId, Side };

export type Opponent = 'wild' | 'trainer' | 'elite' | 'human';

/** Format names as the client shows them (packages/content config FORMATS). */
export const FORMAT_NAME: Record<FormatId, string> = {
  first_blood: 'First Blood',
  vanguard: 'Vanguard',
  full: 'Full Battle',
};

export const OPPONENT_NAME: Record<Opponent, string> = {
  wild: 'Wild NPC',
  trainer: 'Trainer NPC',
  elite: 'Elite NPC',
  human: 'Player 2',
};

/** Local storage keys of the client (state/settings.ts, state/profile.ts). */
export const SETTINGS_KEY = 'ct.settings.v1';
export const PROFILE_KEY = 'ct.profile.v1';

/** Marker present only in the Phaser bundle (Phaser's LOG_VERSION constant, e.g. "v4021"). */
export const PHASER_MARKER = /LOG_VERSION:\s*["'`]v4\d/;

/** Every test fails if the page logs a console error or throws an uncaught exception. */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`uncaught: ${e.message}`));
      await use(errors);
      expect(errors, 'console errors or uncaught exceptions').toEqual([]);
    },
    { auto: true },
  ],
});

export async function openTitle(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Chain Theorem', level: 1 })).toBeVisible();
}

export interface BattleSetup {
  format: FormatId;
  opponent: Opponent;
  side?: Side;
}

/** Title -> Play a local battle -> choose format, opponent and side -> Start -> board ready. */
export async function startBattle(page: Page, setup: BattleSetup): Promise<void> {
  await openTitle(page);
  await page.getByRole('button', { name: 'Play a local battle' }).click();
  await expect(page.getByRole('heading', { name: 'Local battle' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption(setup.format);
  await page.getByRole('combobox', { name: 'Opponent', exact: true }).selectOption(setup.opponent);
  await page
    .getByRole('combobox', { name: 'Play as', exact: true })
    .selectOption(setup.side ?? 'white');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await waitForBoard(page);
}

export function boardCanvas(page: Page): Locator {
  return page.locator('.board-host canvas');
}

/** Wait until the lazily loaded Phaser board is on screen and its size has settled. */
export async function waitForBoard(page: Page): Promise<void> {
  await expect(boardCanvas(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Loading board...')).toHaveCount(0);
  await boardBox(page);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The canvas bounding box once two reads 100 ms apart agree (Scale.FIT resizes after boot). */
export async function boardBox(page: Page): Promise<Box> {
  let settled: Box | null = null;
  await expect
    .poll(
      async () => {
        const a = await boardCanvas(page).boundingBox();
        await page.waitForTimeout(100);
        const b = await boardCanvas(page).boundingBox();
        const same =
          a !== null &&
          b !== null &&
          a.width > 100 &&
          Math.abs(a.x - b.x) < 0.5 &&
          Math.abs(a.y - b.y) < 0.5 &&
          Math.abs(a.width - b.width) < 0.5 &&
          Math.abs(a.width - a.height) < 2;
        settled = same ? b : null;
        return same;
      },
      { message: 'board canvas settles to a square box', timeout: 10_000 },
    )
    .toBe(true);
  if (!settled) throw new Error('board canvas has no bounding box');
  return settled;
}

/** Page coordinates of a square's centre, e.g. squarePoint(box, 'e2', 'white'). */
export function squarePoint(box: Box, square: string, viewer: Side): { x: number; y: number } {
  const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
  const rank = Number(square.slice(1)) - 1;
  if (file < 0 || file > 7 || rank < 0 || rank > 7 || square.length !== 2) {
    throw new Error(`bad square ${square}`);
  }
  const col = viewer === 'white' ? file : 7 - file;
  const row = viewer === 'white' ? 7 - rank : rank;
  const cell = box.width / 8;
  return { x: box.x + (col + 0.5) * cell, y: box.y + (row + 0.5) * cell };
}

export async function clickSquare(page: Page, square: string, viewer: Side): Promise<void> {
  const p = squarePoint(await boardBox(page), square, viewer);
  await page.mouse.click(p.x, p.y);
}

/** The destination buttons the Move panel lists once a piece is selected. */
export function destinations(page: Page): Locator {
  return page.getByRole('group', { name: 'Destinations' });
}

/**
 * Play a move by clicking two squares on the canvas. After the first click the Move panel must
 * list the destination (proves the canvas click selected the right piece); the second click on the
 * canvas commits the move.
 */
export async function playMove(page: Page, from: string, to: string, viewer: Side): Promise<void> {
  await expect(turnBanner(page)).toContainText('Your move.');
  const target = destinations(page).getByRole('button', {
    name: new RegExp(`^(Move to|Capture on) ${to}\\b`),
  });
  // Click only while nothing is selected: a second click on a selected piece would deselect it.
  await expect(async () => {
    if (!(await target.isVisible())) await clickSquare(page, from, viewer);
    await expect(target).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 10_000 });
  await clickSquare(page, to, viewer);
  await expect(destinations(page)).toHaveCount(0);
}

/** One list item per action (plus the battle start) in the step-through log. */
export function logGroups(page: Page): Locator {
  return page.getByRole('log').locator(':scope > li');
}

export function turnBanner(page: Page): Locator {
  return page.locator('.turn-banner');
}

/** The result panel shown once the battle is over. */
export function resultPanel(page: Page): Locator {
  return page.locator('.result[role="status"]');
}

/** Replace local storage (profile, settings) and reload so the app starts from it. */
export async function seedStorage(page: Page, entries: Record<string, unknown>): Promise<void> {
  await page.goto('/');
  await page.evaluate((e) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, JSON.stringify(v));
  }, entries);
  await page.reload();
}
