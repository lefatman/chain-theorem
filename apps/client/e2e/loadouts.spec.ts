/**
 * Loadout builder (M3 3.2): saving a valid loadout, and the engine's R-LOAD-004 errors for invalid
 * ones (7.4). Every card and item is unlocked in local play; the loadout's level decides legality.
 */
import { PROFILE_KEY, expect, openTitle, seedStorage, test } from './helpers.ts';
import type { Page } from '@playwright/test';

async function openLoadouts(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Loadouts' }).click();
  await expect(page.getByRole('heading', { name: 'Loadouts', level: 2 })).toBeVisible();
}

function saveButton(page: Page) {
  return page.getByRole('button', { name: 'Save', exact: true });
}

function checkPanel(page: Page) {
  return page.getByRole('region', { name: 'Check' });
}

test.describe('loadout builder', () => {
  test('R-LOAD-004 saves a valid loadout that persists across reloads', async ({ page }) => {
    await openTitle(page);
    await openLoadouts(page);
    await page.getByRole('button', { name: 'New loadout' }).click();
    await expect(page.getByRole('heading', { name: 'New loadout' })).toBeVisible();

    await page.getByRole('textbox', { name: 'Name' }).fill('E2E Tide Build');
    await page.getByRole('radio', { name: /^Tide\b/ }).check();
    await page
      .getByRole('article', { name: "Dual Adept's Glove" })
      .getByRole('button', { name: 'Equip' })
      .click();
    for (const ability of ['Hit and Run', 'Scout']) {
      await page
        .getByRole('article', { name: ability, exact: true })
        .getByRole('button', { name: 'Add to set' })
        .click();
    }
    await expect(checkPanel(page)).toContainText('Ready for battle');
    await expect(saveButton(page)).toBeEnabled();
    await saveButton(page).click();

    // Back on the list: the new loadout is valid.
    await expect(page.getByRole('heading', { name: 'Loadouts', level: 2 })).toBeVisible();
    const row = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'E2E Tide Build' }),
    });
    await expect(row).toContainText('Valid');
    await expect(row).toContainText("Dual Adept's Glove");
    await expect(row).toContainText('Tide');
    await expect(row).toContainText('Hit and Run, Scout');

    // The route survives the reload (#/loadouts); the loadout comes back from local storage.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Loadouts', level: 2 })).toBeVisible();
    await expect(row).toContainText('Valid');
    const stored = await page.evaluate((k) => localStorage.getItem(k) ?? '', PROFILE_KEY);
    expect(stored).toContain('E2E Tide Build');
  });

  test('R-LOAD-004 two capacity items are rejected with a rule 3 error', async ({ page }) => {
    await seedStorage(page, {
      [PROFILE_KEY]: {
        level: 30,
        loadouts: [
          {
            id: 'e2e-two-gloves',
            name: 'Two Gloves',
            level: 30,
            loadout: {
              elements: ['ember'],
              items: ['dual_adepts_glove', 'triple_adepts_gloves'],
              sets: [['cleave']],
            },
          },
        ],
      },
    });
    await openLoadouts(page);
    const row = page.getByRole('listitem').filter({
      has: page.getByRole('heading', { name: 'Two Gloves' }),
    });
    await expect(row).toContainText(/problem/);
    await expect(row).toContainText(/both capacity items/);

    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByRole('heading', { name: 'Edit loadout' })).toBeVisible();
    await expect(checkPanel(page)).toContainText(/Rule 3 \(one item per group\)/);
    await expect(checkPanel(page)).toContainText(/both capacity items/);
    await expect(saveButton(page)).toBeDisabled();
  });

  test('R-LOAD-004 lowering the level below an item shows rule errors and blocks saving', async ({
    page,
  }) => {
    await openTitle(page);
    await openLoadouts(page);
    await page.getByRole('button', { name: 'New loadout' }).click();
    await page.getByRole('textbox', { name: 'Name' }).fill('E2E Too Low');
    await page.getByRole('spinbutton').fill('30');
    await page
      .getByRole('article', { name: 'Headmaster Ring' })
      .getByRole('button', { name: 'Equip' })
      .click();
    await expect(checkPanel(page)).toContainText('Ready for battle');

    await page.getByRole('spinbutton').fill('1');
    await expect(checkPanel(page)).toContainText(
      /Rule 2 \(level requirements\).*Headmaster Ring needs level 20/,
    );
    await expect(checkPanel(page)).toContainText(/Rule 1 \(item slots\).*level 1 unlocks 1/);
    await expect(saveButton(page)).toBeDisabled();

    // Nothing was saved.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'E2E Too Low' })).toHaveCount(0);
  });
});
