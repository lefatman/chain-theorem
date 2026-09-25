/**
 * M5 done-when through the real UI (spec 16): a new player signs up, enters the Chess Academy and wins
 * a first battle; two players meet in the world (quest, lesson puzzle, chat, party, friends, a consent
 * challenge, a warp). Everything runs against the real Worker, ZoneRoom and BattleRoom Durable Objects.
 * The battle moves are picked with the NPC search on the public state the page itself received, then
 * played by clicking the board.
 */
import { readFileSync } from 'node:fs';
import { search } from '@chain-theorem/ai';
import { engine } from '@chain-theorem/content';
import {
  lessonById,
  npcLocation,
  stepFrom,
  walkable,
  world,
  zoneGeometry,
  type Dir,
} from '@chain-theorem/content/world';
import { moveToUci, type PublicState } from '@chain-theorem/rules';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { playMove, resultPanel, turnBanner } from '../e2e/helpers.ts';

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

interface Player {
  page: Page;
  name: string;
  frames: string[];
  errors: string[];
  /** Where the player stands: the last zone snapshot or correction, plus the steps pressed since. */
  at: { zone: string; x: number; y: number };
  seen: number;
}

const contexts: BrowserContext[] = [];
test.afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.close();
});

async function player(browser: Browser, name: string, mobile = false): Promise<Player> {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 800 } },
  );
  contexts.push(ctx);
  const page = await ctx.newPage();
  const frames: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('websocket', (ws) => ws.on('framereceived', (f) => frames.push(String(f.payload))));
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
  return { page, name, frames, errors, at: { zone: world.start.zone, x: 0, y: 0 }, seen: 0 };
}

async function enterWorld(p: Player): Promise<void> {
  await p.page.getByRole('button', { name: 'Enter the world' }).click();
  await p.page.waitForSelector('.world-host canvas');
  await expect(p.page.locator('.world-bar h2')).toContainText('Chess Academy');
}

const KEY: Record<Dir, string> = { n: 'ArrowUp', s: 'ArrowDown', e: 'ArrowRight', w: 'ArrowLeft' };
const OPPOSITE: Record<Dir, Dir> = { n: 's', s: 'n', e: 'w', w: 'e' };

/** Apply zone snapshots (entering, warps, resyncs) and corrections received since the last look. */
function sync(p: Player): void {
  for (; p.seen < p.frames.length; p.seen++) {
    const m = JSON.parse(p.frames[p.seen] ?? '{}') as { t?: string; d?: Record<string, unknown> };
    if (m.t === 'zsnap' && m.d) {
      const you = m.d.you as { x: number; y: number };
      p.at = { zone: String(m.d.zone), x: you.x, y: you.y };
    } else if (m.t === 'zpos' && m.d) p.at = { ...p.at, x: Number(m.d.x), y: Number(m.d.y) };
  }
}

/** One tile (or a turn into a blocked tile): a key tap, then a pause past the step pacing. */
async function press(p: Player, dir: Dir): Promise<void> {
  // Arrow keys belong to a focused tab list or field; walking needs the page itself focused.
  await p.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  sync(p);
  const n = stepFrom(p.at.x, p.at.y, dir);
  // A tap walks one tile; a hold repeats every 150 ms, too close to the latency of a slow machine.
  await p.page.keyboard.press(KEY[dir]);
  await p.page.waitForTimeout(250);
  if (walkable(zoneGeometry(p.at.zone), n.x, n.y)) p.at = { ...p.at, x: n.x, y: n.y };
  sync(p);
}

/** Walk (shortest path on paths, no grass, no warps) next to an NPC and face it. */
async function walkTo(p: Player, npc: string): Promise<void> {
  const at = npcLocation(npc);
  if (!at) throw new Error(`no NPC ${npc}`);
  const g = zoneGeometry(at.zone);
  const k = (x: number, y: number) => y * g.width + x;
  const warps = new Set(g.warps.map((w) => k(w.x, w.y)));
  const goals = new Map<number, Dir>();
  for (const d of ['s', 'n', 'e', 'w'] as const) {
    const t = stepFrom(at.x, at.y, d);
    if (walkable(g, t.x, t.y)) goals.set(k(t.x, t.y), OPPOSITE[d]);
  }
  sync(p);
  const from = p.at;
  const prev = new Map<number, { k: number; d: Dir }>();
  const queue = [k(from.x, from.y)];
  const seen = new Set(queue);
  let goal = -1;
  while (queue.length > 0 && goal < 0) {
    const c = queue.shift() as number;
    if (goals.has(c)) goal = c;
    for (const d of ['n', 's', 'e', 'w'] as const) {
      const n = stepFrom(c % g.width, Math.floor(c / g.width), d);
      const nk = k(n.x, n.y);
      if (seen.has(nk) || !walkable(g, n.x, n.y) || g.wild[nk] || warps.has(nk)) continue;
      seen.add(nk);
      prev.set(nk, { k: c, d });
      queue.push(nk);
    }
  }
  if (goal < 0) throw new Error(`cannot reach ${npc}`);
  const dirs: Dir[] = [];
  for (let c = goal; prev.has(c); c = prev.get(c)?.k ?? -1) dirs.unshift(prev.get(c)?.d ?? 'n');
  for (const d of dirs) await press(p, d);
  await press(p, goals.get(goal) ?? 'n');
}

/** Talk to the NPC in front, page through its lines, and pick the option labelled `label`. */
async function talk(page: Page, label: RegExp): Promise<void> {
  await page.keyboard.press('e');
  await expect(page.locator('.world-dialog')).toBeVisible();
  while (await page.getByRole('button', { name: /^Next/ }).count())
    await page.getByRole('button', { name: /^Next/ }).click();
  await page.locator('.world-dialog').getByRole('button', { name: label }).click();
}

/** A regular expression matching exactly `text` (a dialog option label). */
const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

function latestPublic(p: Player): PublicState | null {
  for (let i = p.frames.length - 1; i >= 0; i--) {
    const m = JSON.parse(p.frames[i] ?? '{}') as { t?: string; d?: { public?: unknown } };
    if ((m.t === 'bev' || m.t === 'bstart') && m.d?.public) return m.d.public as PublicState;
  }
  return null;
}

test('M5 R-WORLD-003 R-SEC-003 a new player signs up and wins a first battle in the Chess Academy', async ({
  browser,
}) => {
  const started = Date.now();
  const p = await player(browser, `Nova${String(Date.now()).slice(-4)}`);
  await enterWorld(p);
  // The Headmaster stands in front of the spawn (10.3).
  await talk(p.page, /Accept/);
  await expect(p.page.locator('.quest-tracker')).toBeVisible();

  // Tutor Juno's first ability lesson: a real First Blood battle with fixed loadouts.
  const lesson = lessonById.get('ability_hit_and_run');
  if (lesson?.kind !== 'battle') throw new Error('ability_hit_and_run is a battle lesson');
  await walkTo(p, 'tutor_juno');
  await talk(p.page, exact(lesson.title));
  await p.page.waitForURL(/#\/battle/);
  await p.page.waitForSelector('.board-host canvas');
  const until = Date.now() + 90_000;
  while (!(await resultPanel(p.page).isVisible())) {
    if (Date.now() > until) throw new Error('the lesson battle did not end');
    if (await p.page.locator('.prompt').isVisible()) {
      await p.page.locator('.prompt-options button').first().click();
      continue;
    }
    const pub = latestPublic(p);
    const mine = (
      await turnBanner(p.page)
        .innerText()
        .catch(() => '')
    ).includes('Your move.');
    if (!pub || !mine || pub.turn !== pub.viewer || pub.legal.length === 0) {
      await p.page.waitForTimeout(100);
      continue;
    }
    const uci = moveToUci(
      search(engine, pub, lesson.player.loadout, 'elite', { nodes: 60_000 }).move,
    );
    await playMove(p.page, uci.slice(0, 2), uci.slice(2, 4), pub.viewer);
  }
  await expect(resultPanel(p.page)).toContainText('You win!');
  await p.page.getByRole('button', { name: 'Return to the world' }).click();
  await p.page.waitForSelector('.world-host canvas');
  // The lesson counts (R-SEC-003: granted once, server-side) and the reward shows.
  await expect
    .poll(async () =>
      p.page.evaluate(async () => (await (await fetch('/api/progress')).json()) as unknown),
    )
    .toMatchObject({ lessonsDone: expect.arrayContaining(['ability_hit_and_run']) });
  expect(p.errors).toEqual([]);
  expect(p.frames.filter((f) => f.includes('"t":"err"'))).toEqual([]);
  // Wall time of the automated run (the human estimate is `pnpm test:firstwin`).
  expect(Date.now() - started).toBeLessThan(30 * 60_000);
});

test('M5 R-WORLD-001 R-WORLD-004 R-SEC-011 two players meet: puzzle, chat, party, friends, a consent challenge and a warp', async ({
  browser,
}) => {
  const tag = String(Date.now()).slice(-4);
  const a = await player(browser, `Alma${tag}`);
  const b = await player(browser, `Bram${tag}`, true);
  await enterWorld(a);
  await enterWorld(b);

  // A takes Tutor Nell's movement lesson: one puzzle solved on the mini board, a wrong answer's hint.
  await walkTo(a, 'tutor_nell');
  const lesson = lessonById.get('moves_basics');
  if (lesson?.kind !== 'puzzles') throw new Error('moves_basics is a puzzle lesson');
  await talk(a.page, exact(lesson.title));
  await expect(a.page.locator('.lesson')).toBeVisible();
  const answer = lesson.puzzles[0]?.accept[0] ?? '';
  await a.page.getByRole('button', { name: new RegExp(`^${answer.slice(0, 2)}\\b`) }).click();
  await a.page.getByRole('button', { name: new RegExp(`^${answer.slice(2, 4)}\\b`) }).click();
  await expect(a.page.locator('.lesson')).toContainText('Puzzle 2 of');
  await a.page.getByRole('button', { name: 'Skip this lesson' }).click();

  // Zone chat.
  await a.page.getByRole('tab', { name: /Chat/ }).click();
  await a.page.getByLabel('Chat message to zone').fill(`Hi ${b.name}!`);
  await a.page.getByRole('button', { name: 'Send' }).click();
  await expect(b.page.locator('.chat-log')).toContainText(`Hi ${b.name}!`);

  // Party.
  await a.page.getByRole('tab', { name: /Players/ }).click();
  await a.page.locator('.player-name', { hasText: b.name }).click();
  await a.page.getByRole('button', { name: 'Invite to party' }).click();
  await expect(b.page.locator('.world-prompts')).toContainText('invites you');
  await b.page.getByRole('button', { name: 'Join' }).click();
  await a.page.getByRole('tab', { name: /Party/ }).click();
  await expect(a.page.locator('.world-party')).toContainText(b.name);

  // Friends.
  await a.page.getByRole('tab', { name: /Friends/ }).click();
  await a.page.getByLabel('Add a friend by name').fill(b.name);
  await a.page.getByRole('button', { name: 'Add friend' }).click();
  await b.page.getByRole('tab', { name: /Friends/ }).click();
  await expect(b.page.locator('.world-friends')).toContainText(a.name);
  await b.page.getByRole('button', { name: 'Accept' }).first().click();

  // A consent challenge: both go to the battle, A resigns, both return to the world.
  await a.page.getByRole('tab', { name: /Players/ }).click();
  const row = a.page.locator('.player-name', { hasText: b.name });
  if ((await row.getAttribute('aria-pressed')) !== 'true') await row.click();
  await a.page.locator('.player-actions').getByRole('button', { name: 'Challenge' }).click();
  await expect(b.page.locator('.world-prompts')).toContainText('challenges you');
  await b.page.locator('.world-prompts').getByRole('button', { name: 'Accept' }).click();
  await a.page.waitForURL(/#\/battle/);
  await b.page.waitForURL(/#\/battle/);
  await a.page.waitForSelector('.board-host canvas');
  await a.page.getByRole('button', { name: 'Resign' }).click();
  await a.page
    .getByRole('button', { name: /Resign|Yes/ })
    .last()
    .click();
  await expect(a.page.getByRole('button', { name: 'Return to the world' })).toBeVisible();
  await expect(b.page.getByRole('button', { name: 'Return to the world' })).toBeVisible();
  await a.page.getByRole('button', { name: 'Return to the world' }).click();
  await b.page.getByRole('button', { name: 'Return to the world' }).click();
  await a.page.waitForSelector('.world-host canvas');

  // A walks out through the Academy door to Rookhaven (a warp; the party follows its leader).
  const hall = zoneGeometry(world.start.zone);
  const door = hall.warps[0];
  if (!door) throw new Error('the Academy has a door');
  const k = (x: number, y: number) => y * hall.width + x;
  sync(a);
  const from = a.at;
  const prev = new Map<number, { k: number; d: Dir }>();
  const queue = [k(from.x, from.y)];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const c = queue.shift() as number;
    if (c === k(door.x, door.y)) break;
    for (const d of ['n', 's', 'e', 'w'] as const) {
      const n = stepFrom(c % hall.width, Math.floor(c / hall.width), d);
      const nk = k(n.x, n.y);
      if (seen.has(nk) || !walkable(hall, n.x, n.y)) continue;
      seen.add(nk);
      prev.set(nk, { k: c, d });
      queue.push(nk);
    }
  }
  const dirs: Dir[] = [];
  for (let c = k(door.x, door.y); prev.has(c); c = prev.get(c)?.k ?? -1)
    dirs.unshift(prev.get(c)?.d ?? 'n');
  for (const d of dirs) await press(a, d);
  await expect(a.page.locator('.world-bar h2')).toContainText(
    world.zones.find((z) => z.id === door.to)?.name ?? door.to,
  );
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
  expect([...a.frames, ...b.frames].filter((f) => f.includes('"t":"err"'))).toEqual([]);
});
