/**
 * Classic View (11.2, R-ART-002): the toggle persists across reloads and swaps the creatures on the
 * board for standard chess glyphs. Reduced motion freezes the idle animation so board screenshots
 * are stable enough to compare.
 */
import { SETTINGS_KEY, expect, openTitle, startBattle, test, waitForBoard } from './helpers.ts';
import type { Page } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

const CLASSIC = 'Classic View (chess glyphs instead of creatures)';

async function setClassicView(page: Page, on: boolean): Promise<void> {
  await openTitle(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const box = page.getByRole('checkbox', { name: CLASSIC });
  await box.setChecked(on);
  await expect(box).toBeChecked({ checked: on });
}

/** Screenshot of the board with the pointer parked outside it (no hover outline). */
async function boardShot(page: Page): Promise<Buffer> {
  await page.mouse.move(1, 1);
  await waitForBoard(page);
  // Let the first frames render before capturing.
  await page.waitForTimeout(500);
  return page.locator('.board-host canvas').screenshot();
}

test.describe('settings', () => {
  test('R-ART-002 Classic View toggle persists across reloads', async ({ page }) => {
    await setClassicView(page, true);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: CLASSIC })).toBeChecked();
    const stored = await page.evaluate(
      (k) => JSON.parse(localStorage.getItem(k) ?? '{}') as { classicView?: boolean },
      SETTINGS_KEY,
    );
    expect(stored.classicView).toBe(true);

    await setClassicView(page, false);
    await page.reload();
    await expect(page.getByRole('checkbox', { name: CLASSIC })).not.toBeChecked();
  });

  test('R-ART-002 Classic View changes how the board is drawn', async ({ page }) => {
    await setClassicView(page, false);
    await startBattle(page, { format: 'full', opponent: 'wild' });
    const creaturesA = await boardShot(page);
    await startBattle(page, { format: 'full', opponent: 'wild' });
    const creaturesB = await boardShot(page);
    // Same position, same settings: the board draws identically (so a difference below is real).
    expect(creaturesB.equals(creaturesA)).toBe(true);

    await setClassicView(page, true);
    await startBattle(page, { format: 'full', opponent: 'wild' });
    const classic = await boardShot(page);
    expect(classic.equals(creaturesA)).toBe(false);
  });
});
