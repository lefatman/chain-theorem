import { PHASER_MARKER, expect, openTitle, startBattle, test } from './helpers.ts';

test.describe('title screen', () => {
  test('R-TECH-003 title screen loads without console errors and without Phaser', async ({
    page,
  }) => {
    const scripts: string[] = [];
    page.on('response', (r) => {
      if (r.request().resourceType() === 'script') scripts.push(r.url());
    });
    await openTitle(page);
    await expect(page).toHaveTitle('Chain Theorem');
    const menu = page.getByRole('navigation', { name: 'Main menu' });
    for (const name of ['Play a local battle', 'Loadouts', 'Settings']) {
      await expect(menu.getByRole('button', { name })).toBeVisible();
    }
    // The dev-only Scenario Lab is removed from production builds (BUILD_PROMPT M3).
    await expect(page.getByRole('button', { name: /Scenario Lab/ })).toHaveCount(0);
    // PWA manifest is linked (12.3 install target).
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest.webmanifest',
    );

    // 12.3: Phaser is lazy-loaded, so none of the title screen's scripts contain it.
    expect(scripts.length).toBeGreaterThan(0);
    for (const url of scripts) {
      const body = await (await page.request.get(url)).text();
      expect(PHASER_MARKER.test(body), `${url} must not contain Phaser`).toBe(false);
    }
  });

  test('R-TECH-003 Phaser loads lazily when a battle opens', async ({ page }) => {
    const phaser: string[] = [];
    page.on('response', (r) => {
      if (r.request().resourceType() !== 'script') return;
      void r
        .text()
        .then((body) => {
          if (PHASER_MARKER.test(body)) phaser.push(r.url());
        })
        .catch(() => undefined);
    });
    await openTitle(page);
    await page.waitForLoadState('networkidle');
    expect(phaser).toEqual([]);
    await startBattle(page, { format: 'first_blood', opponent: 'wild' });
    await expect.poll(() => phaser.length).toBeGreaterThan(0);
  });
});
