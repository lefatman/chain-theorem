/**
 * Screenshots of the title page and the alpha screens for docs/screenshots (on demand, not part of
 * the suite): `CT_SCREENSHOTS=1 pnpm exec playwright test --config playwright.online.config.ts
 * screenshots.spec.ts` from apps/client, against the real Worker with alpha guest play on.
 */
import { mkdirSync } from 'node:fs';
import { expect, test, type Browser } from '@playwright/test';

const OUT = new URL('../../../docs/screenshots/', import.meta.url).pathname;

test.skip(!process.env.CT_SCREENSHOTS, 'screenshots are taken on demand (CT_SCREENSHOTS=1)');
// Two hand-made contexts and tracing on failure do not mix (artifact races at teardown).
test.use({ trace: 'off' });

async function page(browser: Browser, width: number, height: number) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  return { ctx, page: await ctx.newPage() };
}

test('screenshots: title and alpha screens, desktop and phone', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const desk = await page(browser, 1280, 800);
  await desk.page.goto('/');
  await expect(desk.page.getByRole('button', { name: 'Play a friend by code' })).toBeVisible();
  await desk.page.screenshot({ path: `${OUT}01-title.png` });

  await desk.page.goto('/#/alpha');
  await desk.page.getByRole('button', { name: 'Play as a guest' }).click();
  await expect(desk.page.getByText(/You are Guest \d{4}/)).toBeVisible();
  await desk.page.screenshot({ path: `${OUT}20-alpha-create.png` });
  await desk.page.getByRole('spinbutton', { name: 'Level' }).fill('12');
  await desk.page.getByRole('button', { name: 'Create a code' }).click();
  const link = await desk.page.getByLabel('Alpha link').inputValue();
  await desk.page.screenshot({ path: `${OUT}21-alpha-code.png` });

  const phone = await page(browser, 390, 844);
  await phone.page.goto('/');
  await expect(phone.page.getByRole('button', { name: 'Play a friend by code' })).toBeVisible();
  await phone.page.screenshot({ path: `${OUT}08-mobile-title.png`, fullPage: true });
  await phone.page.goto(link);
  await phone.page.getByRole('button', { name: 'Play as a guest' }).click();
  await expect(phone.page.getByRole('heading', { name: /Alpha battle from Guest/ })).toBeVisible();
  await phone.page.screenshot({ path: `${OUT}22-alpha-join-mobile.png` });
});
