/**
 * M7 7.2 spectating end to end (spec 10.4 "delayed, public-projection-only view of live battles"):
 * two players meet in the ranked queue (a public battle) and a third browser at 360x640 watches it
 * from the Watch screen. Every WebSocket frame the spectator receives is scanned with the spectator
 * scanner (R-SEC-001, R-INFO-005) against the two loadouts and the reveal logs the players
 * themselves ended with; the spectator stays SPECTATE.delayPlies behind the live position, never
 * gets a player's message, and sees every move and the result once the battle ends.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { SPECTATE } from '@chain-theorem/content';
import { scanSpectatorPayload, spectatorHiddenIds } from '@chain-theorem/content/scan';
import {
  PIECE_TYPES,
  type GameState,
  type Loadout,
  type PieceType,
  type RevealLog,
  type Side,
} from '@chain-theorem/rules';
import { playMove, turnBanner } from '../e2e/helpers.ts';

const LOG = () => process.env.CT_WORKER_LOG ?? '';
const DELAY = SPECTATE.delayPlies;

interface Wire {
  t: string;
  d: Record<string, unknown>;
}

interface Person {
  ctx: BrowserContext;
  page: Page;
  frames: string[];
  name: string;
  errors: string[];
}

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

async function person(browser: Browser, name: string, mobile = false): Promise<Person> {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 } },
  );
  const page = await ctx.newPage();
  const frames: string[] = [];
  const errors: string[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
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
  return { ctx, page, frames, name, errors };
}

async function saveLoadout(p: Person, name: string, loadout: Loadout): Promise<void> {
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

async function joinRanked(p: Person): Promise<void> {
  const ranked = p.page.getByRole('group', { name: 'Ranked queue' });
  await expect(ranked).toContainText('item slots');
  await ranked.getByRole('combobox', { name: 'Ranked format' }).selectOption('full');
  await ranked.getByRole('button', { name: 'Join the ranked queue' }).click();
}

async function whiteOf(a: Person, b: Person): Promise<Person> {
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

const parsed = (frames: string[]): Wire[] => frames.map((f) => JSON.parse(f) as Wire);

/** The ply of the newest position a spectator has been shown. */
function spectatorPly(p: Person): number {
  const shown = parsed(p.frames)
    .filter((m) => m.t === 'sstart' || m.t === 'sev')
    .at(-1);
  return (shown?.d.public as { ply?: number } | undefined)?.ply ?? -1;
}

/** The newest projection a player received (`bstart` or `bev`). */
function lastPublic(p: Person): {
  ply: number;
  pieces: GameState['pieces'];
  armies: Record<Side, { revealed: RevealLog; level: number; consumedSlots: number }>;
} {
  const m = parsed(p.frames)
    .filter((x) => x.t === 'bstart' || x.t === 'bev')
    .at(-1);
  if (!m) throw new Error(`${p.name} received no projection`);
  return m.d.public as ReturnType<typeof lastPublic>;
}

const ADA: Loadout = {
  elements: ['tide'],
  items: ['dual_adepts_glove'],
  sets: [['hit_and_run', 'scout']],
};
const BO: Loadout = {
  elements: ['grove'],
  items: ['dual_adepts_glove'],
  sets: [['last_word', 'scout']],
};

test('M7 7.2 R-SEC-001 R-INFO-005 a third browser watches a public battle SPECTATE.delayPlies behind; every spectator frame is scanned', async ({
  browser,
}) => {
  const ada = await person(browser, 'Ada');
  const bo = await person(browser, 'Bo');
  const cy = await person(browser, 'Cy', true);
  await saveLoadout(ada, 'Ada Tide', ADA);
  await saveLoadout(bo, 'Bo Grove', BO);

  // A ranked pairing is a public battle (10.4).
  await joinRanked(ada);
  await joinRanked(bo);
  for (const p of [ada, bo])
    await expect(p.page.getByRole('complementary', { name: 'Battle panel' })).toContainText(
      '10:00',
      { timeout: 20_000 },
    );
  const white = await whiteOf(ada, bo);
  const black = white === ada ? bo : ada;

  // The spectator finds it on the Watch screen, reached from the online screen.
  await cy.page.getByRole('button', { name: 'Watch live battles' }).click();
  await expect(cy.page.getByRole('heading', { name: 'Watch live battles' })).toBeVisible();
  const entry = cy.page.getByRole('button', {
    name: `Watch ${white.name} versus ${black.name}`,
  });
  await expect(async () => {
    if (!(await entry.isVisible())) await cy.page.getByRole('button', { name: 'Refresh' }).click();
    await expect(entry).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(cy.page.locator('.live-list')).toContainText('Ranked');
  await entry.click();
  const panel = cy.page.getByRole('complementary', { name: 'Spectator panel' });
  await expect(panel).toContainText(`Delayed by ${DELAY} plies`);
  await expect(panel).toContainText(white.name);
  await expect(cy.page.locator('.board-host canvas')).toBeVisible({ timeout: 20_000 });
  expect(spectatorPly(cy)).toBe(0);

  // The players are told someone is watching.
  await expect
    .poll(() => parsed(white.frames).some((m) => m.t === 'watchers' && (m.d.count as number) >= 1))
    .toBe(true);

  const moves: [Person, string, string, Side][] = [
    [white, 'e2', 'e4', 'white'],
    [black, 'e7', 'e5', 'black'],
    [white, 'g1', 'f3', 'white'],
    [black, 'b8', 'c6', 'black'],
    [white, 'f1', 'c4', 'white'],
  ];
  for (const [k, [p, from, to, side]] of moves.entries()) {
    await playMove(p.page, from, to, side);
    const live = k + 1;
    await expect.poll(() => lastPublic(white).ply).toBe(live);
    // The spectator is exactly the delay behind (the start position until then) and never closer.
    await expect.poll(() => spectatorPly(cy)).toBe(Math.max(0, live - DELAY));
    expect(live - spectatorPly(cy)).toBeGreaterThanOrEqual(Math.min(DELAY, live));
  }
  // The delayed log shows the released moves only.
  await cy.page.getByRole('tab', { name: 'Log' }).click();
  await expect(cy.page.getByRole('log')).toContainText(/g1\W.*f3/);
  await expect(cy.page.getByRole('log')).not.toContainText(/f1\W.*c4/);
  // 360x640: no sideways scrolling (12.3).
  const overflow = await cy.page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // The battle ends: the spectator gets the rest and the result.
  await white.page.getByRole('button', { name: 'Resign' }).click();
  await white.page.getByRole('button', { name: 'Yes, resign' }).click();
  await expect(cy.page.locator('.result[role="status"]')).toContainText(
    `${black.name} (Black) wins`,
  );
  expect(spectatorPly(cy)).toBe(moves.length);
  await expect(cy.page.getByRole('log')).toContainText(/f1\W.*c4/);

  // R-SEC-001 / R-INFO-005: every frame the spectator received, scanned against the loadouts and
  // what each player's opponent had learned by the end (knowledge only grows).
  const pubW = lastPublic(white);
  const pubB = lastPublic(black);
  const loadoutOf = (p: Person) => (p === ada ? ADA : BO);
  const army = (p: Person, pub: ReturnType<typeof lastPublic>, side: Side) => ({
    level: pub.armies[side].level,
    loadout: loadoutOf(p),
    sets: Object.fromEntries(PIECE_TYPES.map((t) => [t, loadoutOf(p).sets[0] ?? []])) as Record<
      PieceType,
      string[]
    >,
    consumedSlots: pub.armies[side].consumedSlots,
  });
  const state = {
    armies: { white: army(white, pubB, 'white'), black: army(black, pubW, 'black') },
    // What each side's opponent knows about it, from the opponent's own last projection.
    reveals: { white: pubB.armies.white.revealed, black: pubW.armies.black.revealed },
    pieces: pubW.pieces,
    slices: {},
  } as unknown as GameState;
  const hidden = spectatorHiddenIds(state);
  expect(hidden.size).toBeGreaterThan(0);
  const frames = parsed(cy.frames);
  expect(frames.length).toBeGreaterThan(moves.length);
  for (const m of frames) {
    expect(['sstart', 'sev', 'send', 'watchers', 'err'], `frame type ${m.t}`).toContain(m.t);
    if (m.d.public) expect((m.d.public as { viewer?: string }).viewer).toBe('spectator');
    expect(scanSpectatorPayload(m, state), `${m.t} frame`).toBeNull();
  }
  for (const id of hidden)
    expect(
      cy.frames.filter((f) => f.includes(`"${id}"`)),
      `spectator received ${id}`,
    ).toEqual([]);
  expect(frames.some((m) => m.t === 'send')).toBe(true);
  for (const p of [ada, bo, cy]) expect(p.errors, `${p.name} page errors`).toEqual([]);
  for (const p of [ada, bo, cy]) await p.ctx.close();
});
