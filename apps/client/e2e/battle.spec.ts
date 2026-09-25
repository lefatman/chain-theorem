/**
 * M3 done-when: First Blood, Vanguard and Full Battle are playable against every NPC tier
 * (R-FMT-001 formats, R-FMT-005 NPC tiers). Moves are made by clicking squares on the canvas.
 */
import {
  FORMAT_NAME,
  OPPONENT_NAME,
  expect,
  logGroups,
  playMove,
  startBattle,
  test,
  turnBanner,
  type FormatId,
  type Opponent,
} from './helpers.ts';
import type { Page } from '@playwright/test';

const FORMATS: FormatId[] = ['first_blood', 'vanguard', 'full'];
const TIERS: Exclude<Opponent, 'human'>[] = ['wild', 'trainer', 'elite'];

/** The Dossier tab names the format and its objective count. */
async function expectFormat(page: Page, format: FormatId): Promise<void> {
  await page.getByRole('tab', { name: 'Dossier' }).click();
  await expect(page.getByRole('tabpanel')).toContainText(`${FORMAT_NAME[format]}: you 0`);
  await page.getByRole('tab', { name: 'Log' }).click();
}

test.describe('local battle vs NPC', () => {
  for (const format of FORMATS) {
    for (const tier of TIERS) {
      test(`R-FMT-001 R-FMT-005 ${FORMAT_NAME[format]} vs ${OPPONENT_NAME[tier]}: canvas move and NPC reply`, async ({
        page,
      }) => {
        await startBattle(page, { format, opponent: tier });
        await expect(page.getByRole('complementary', { name: 'Battle panel' })).toContainText(
          OPPONENT_NAME[tier],
        );
        await expectFormat(page, format);

        const before = await logGroups(page).count();
        await playMove(page, 'e2', 'e4', 'white');
        await expect(page.getByRole('log')).toContainText(/e2\W.*e4/);
        // The NPC replies: one more action in the log and the turn comes back.
        await expect(logGroups(page).nth(before + 1)).toBeAttached();
        await expect(turnBanner(page)).toContainText('Your move.');
        await expect(page.getByRole('log')).toContainText('Black');
      });
    }
  }

  test('R-FMT-005 playing Black: the NPC opens and the board is flipped', async ({ page }) => {
    await startBattle(page, { format: 'full', opponent: 'trainer', side: 'black' });
    // White (the NPC) moves first.
    await expect(logGroups(page).nth(1)).toBeAttached();
    await expect(turnBanner(page)).toContainText('Your move.');
    const before = await logGroups(page).count();
    // Black at the bottom: e7 is in the second row from the bottom, column d from the left.
    await playMove(page, 'e7', 'e5', 'black');
    await expect(page.getByRole('log')).toContainText(/e7\W.*e5/);
    await expect(logGroups(page).nth(before + 1)).toBeAttached();
    await expect(turnBanner(page)).toContainText('Your move.');
  });

  test('R-FMT-003 resign ends the battle with a result banner', async ({ page }) => {
    await startBattle(page, { format: 'first_blood', opponent: 'wild' });
    await expect(turnBanner(page)).toContainText('Your move.');
    await page.getByRole('button', { name: 'Resign', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Resign?' });
    await confirm.getByRole('button', { name: 'Yes, resign' }).click();

    const result = page.getByRole('status').filter({ hasText: /resignation/ });
    await expect(result).toBeVisible();
    await expect(result).toContainText(`${OPPONENT_NAME.wild} (Black) wins`);
    await expect(result.getByRole('button', { name: /Rematch/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Resign', exact: true })).toBeDisabled();
    await expect(page.getByRole('log')).toContainText(/resign/i);
  });
});
