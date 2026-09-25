/**
 * M6 6.3 done-when for the fake provider (spec 16: "billing works end to end in the provider's test
 * mode"): a new player on a phone-sized screen sees the 7-day trial, the trial ends, the world and
 * the online screen refuse play with a clear "Your trial has ended" and a way to subscribe, the
 * player cancels one checkout, then pays on the fake checkout page the Worker serves, whose signed
 * webhook goes through the production verification path, and plays again. Paddle's sandbox needs a
 * human's keys (DEPLOY.md 5).
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

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

async function signUp(page: Page, name: string, email: string): Promise<void> {
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
}

async function noSideScroll(page: Page): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(360);
}

test('R-COST-005 R-SEC-007 trial, trial ended, fake checkout (cancel, then pay), play again at 360x640', async ({
  browser,
}) => {
  const ctx = await browser.newContext({
    viewport: { width: 360, height: 640 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await signUp(page, 'Payer', `payer-${Date.now()}@example.com`);

  // The trial: the online screen says how long it lasts; play is open.
  await expect(page.getByText(/Free trial: 7 days left/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter the world' })).toBeVisible();
  await noSideScroll(page);

  // The account page is one tap away and lists the three plans (14.3).
  await page.getByRole('button', { name: 'Account and subscription' }).click();
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await expect(
    page.getByText(/Free trial: 7 days left .*trading and wagers need a subscription/),
  ).toBeVisible();
  for (const name of [
    /monthly plan, \$4\.00 a month/,
    /quarterly plan, \$11\.00 every 3 months/,
    /yearly plan, \$40\.00 a year/,
  ])
    await expect(page.getByRole('button', { name })).toBeVisible();
  await expect(page.getByText('Test mode: checkout is a local fake page')).toBeVisible();
  await noSideScroll(page);

  // The trial ends (the fake provider's local test hook moves trial_ends_at into the past).
  const ended = await page.evaluate(async () => {
    const r = await fetch('/api/billing/fake/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'expire_trial' }),
    });
    return r.status;
  });
  expect(ended).toBe(200);

  // Entering the world now gets a 402: the app switches to the trial-ended view.
  await page.goto('/#/world');
  await expect(page.getByRole('heading', { name: 'Your trial has ended' })).toBeVisible();
  await expect(page.getByRole('alert').first()).toContainText('needs a subscription');
  await noSideScroll(page);
  await page.getByRole('button', { name: 'Online play' }).click();
  await expect(page.getByRole('heading', { name: 'Your trial has ended' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter the world' })).toHaveCount(0);

  // Checkout, then Cancel on the fake page: back in the app, nothing charged.
  await page.getByRole('button', { name: 'See plans and subscribe' }).click();
  await expect(
    page.getByText('Your trial has ended. Subscribe to keep playing online.'),
  ).toBeVisible();
  await page.getByRole('button', { name: /yearly plan/ }).click();
  await expect(page).toHaveURL(/\/api\/billing\/fake\/checkout\?session=/);
  await expect(page.getByText('Test mode: no real payment')).toBeVisible();
  await expect(page.getByText(/Yearly plan: \$40\.00 every 12 months/)).toBeVisible();
  await noSideScroll(page);
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/#\/account\?checkout=canceled/);
  await expect(page.getByText('Checkout canceled. Nothing was charged.')).toBeVisible();
  await expect(
    page.getByText('Your trial has ended. Subscribe to keep playing online.'),
  ).toBeVisible();

  // Subscribe monthly and pay: the signed webhook subscribes the account.
  await page.getByRole('button', { name: /monthly plan/ }).click();
  await expect(page).toHaveURL(/\/api\/billing\/fake\/checkout\?session=/);
  await page.getByRole('button', { name: 'Pay $4.00' }).click();
  await expect(page).toHaveURL(/#\/account\?checkout=success/);
  await expect(page.getByText('Thank you! Your subscription is active.')).toBeVisible();
  await expect(page.getByText(/Subscribed \(monthly plan\)\. Renews on/)).toBeVisible();
  await expect(page.getByRole('button', { name: /monthly plan/ })).toHaveCount(0);
  await noSideScroll(page);

  // Cancel at period end, then keep it after all.
  await page.getByRole('button', { name: 'Cancel subscription…' }).click();
  await page.getByRole('button', { name: 'Cancel at period end' }).click();
  await expect(page.getByText(/It ends on .*you keep full access until then/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep my subscription' }).click();
  await expect(page.getByText(/Renews on/)).toBeVisible();

  // Online play is open again, and the world lets the player in.
  await page.getByRole('button', { name: 'Online play' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enter the world' }).click();
  await expect(page.locator('.world-conn.open')).toBeAttached({ timeout: 30_000 });

  expect(errors).toEqual([]);
  await ctx.close();
});
