/**
 * Client budget measurement (BUILD_PROMPT 7: "From M3 on, bundle size, memory and frame-rate budgets
 * are measured and recorded"; spec 12.3 R-TECH-003 and 11.4 R-ART-004).
 *
 *   pnpm measure:client [--skip-build] [--strict] [--seconds 5]
 *
 * 1. Bundle: builds the production client into its own directory (so a concurrent `vite build`
 *    cannot swap chunks mid-run) and sizes every file raw, gzip (level 9) and brotli. The initial
 *    chunks are the entry script, stylesheets and modulepreloads named in index.html plus everything
 *    they import statically, followed recursively; dynamic imports (the Phaser board) and workers
 *    (NPC search) are lazy.
 * 2. Runtime: serves the build with `vite preview` and drives headless Chromium through a local Full
 *    Battle against the Elite NPC in two profiles: the 12.3 minimum device (360x640, touch, 4x CPU
 *    throttling via CDP Emulation.setCPUThrottlingRate) and a 1280x800 desktop. It records the files
 *    and network bytes loaded up to the title screen and up to a playable battle, frames per second
 *    (a requestAnimationFrame counter) over N seconds of an idle battle and N seconds of an NPC game
 *    (the script plays random legal moves through the Move panel while the NPC answers), and memory
 *    (JS heap from CDP Performance.getMetrics and performance.memory; renderer process PSS on Linux).
 * 3. Writes reports/budgets.json and reports/budgets.md with a pass/fail per budget.
 *
 * Size budgets are deterministic and fail the command (exit 1). Runtime budgets depend on the
 * machine (headless Chromium renders WebGL in software), so they are recorded with pass/fail and fail
 * the command only with --strict. Sizes use decimal units (1 kB = 1000 B), the stricter reading.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { cpus, loadavg } from 'node:os';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import type { Browser, BrowserType, CDPSession, Locator, Page } from '@playwright/test';

// ---- configuration ---------------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'apps/client');
const OUT_REL = 'node_modules/.cache/measure-dist';
const OUT = join(CLIENT, OUT_REL);
const REPORTS = join(ROOT, 'reports');
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const argv = process.argv.slice(2);
const SKIP_BUILD = argv.includes('--skip-build');
const STRICT = argv.includes('--strict');
const secondsArg = argv.indexOf('--seconds');
const SECONDS = secondsArg >= 0 ? Number(argv[secondsArg + 1]) || 5 : 5;

const KB = 1000;
const MB = 1000 * 1000;
const BUDGET = {
  initialJs: 600 * KB, // 12.3 R-TECH-003: initial JavaScript <= 600 KB gzipped
  firstLoad: 2 * MB, // 11.4 R-ART-004: first load, to the title screen
  firstPlayable: 5 * MB, // 11.4 R-ART-004: first playable (tutorial town from M5; a battle today)
  memory: 150 * MB, // 12.3 R-TECH-003: memory <= 150 MB in tab
  fpsFloor: 30, // 12.3: 30 fps floor on the minimum device
  fpsTarget: 60, // 12.3: 60 fps (overworld); the battle board is held to the same target
};
/** rAF counts over a few seconds jitter by a frame or two at 60 Hz; 57 fps is "60 fps" here. */
const FPS_TARGET_TOLERANCE = 0.95;
/** Phaser's LOG_VERSION constant appears only in the Phaser bundle. */
const PHASER_MARKER = /LOG_VERSION:\s*["'`]v4\d/;

interface Profile {
  id: string;
  label: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  cpuThrottle: number;
  fps: { budget: number; kind: 'floor' | 'target' };
}

const PROFILES: Profile[] = [
  {
    id: 'min-device',
    label: 'Minimum device: 360x640, DPR 2, touch, 4x CPU throttling',
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    cpuThrottle: 4,
    fps: { budget: BUDGET.fpsFloor, kind: 'floor' },
  },
  {
    id: 'desktop',
    label: 'Desktop: 1280x800, DPR 1, no throttling',
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    cpuThrottle: 1,
    fps: { budget: BUDGET.fpsTarget, kind: 'target' },
  },
];

// ---- small helpers ---------------------------------------------------------------------------------

function log(msg: string): void {
  console.log(`[measure] ${msg}`);
}

function fmtBytes(n: number): string {
  if (n >= MB) return `${(n / MB).toFixed(2)} MB`;
  return `${(n / KB).toFixed(1)} kB`;
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${r.status}`);
}

function git(args: string[]): string {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

// ---- 1. bundle -------------------------------------------------------------------------------------

type Load = 'initial' | 'first-load asset' | 'lazy (Phaser board)' | 'lazy (worker)' | 'lazy';

interface FileEntry {
  /** Path as served, e.g. "/assets/index-abc.js". */
  path: string;
  raw: number;
  gzip: number;
  brotli: number;
  load: Load;
}

interface Bundle {
  files: FileEntry[];
  initialJs: string[];
  initialCss: string[];
  firstLoadAssets: string[];
  totals: {
    initialJsGzip: number;
    initialCssGzip: number;
    initialJsCssGzip: number;
    firstLoadGzip: number;
    phaserGzip: number;
    allGzip: number;
    allRaw: number;
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return m ? (m[1] ?? null) : null;
}

/** Static `import ... from "x"`, `import "x"` and `export ... from "x"`; never `import("x")`. */
const STATIC_IMPORT =
  /(?:^|[;\s})])(?:import|export)\s*(?:[\w$\s{},*]+?\s*from\s*)?(["'])([^"']+)\1/g;

function resolveServed(from: string, spec: string): string | null {
  if (spec.startsWith('/')) return spec;
  if (spec.startsWith('./') || spec.startsWith('../')) return posix.join(posix.dirname(from), spec);
  return null;
}

function measureBundle(): Bundle {
  const html = readFileSync(join(OUT, 'index.html'), 'utf8');
  const served = (p: string) => (p.startsWith('/') ? p : `/${p}`);
  const entryJs = [...html.matchAll(/<script\b[^>]*>/gi)].flatMap((m) => {
    const src = attr(m[0], 'src');
    return src ? [served(src)] : [];
  });
  const initialCss: string[] = [];
  const firstLoadAssets: string[] = ['/index.html'];
  const preloads: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (attr(m[0], 'rel') ?? '').toLowerCase();
    const href = attr(m[0], 'href');
    if (!href || /^https?:/.test(href)) continue;
    if (rel === 'stylesheet') initialCss.push(served(href));
    else if (rel === 'modulepreload') preloads.push(served(href));
    else if (rel === 'manifest' || rel.includes('icon')) firstLoadAssets.push(served(href));
  }
  // Icons named by the web manifest are fetched for install prompts: count them in the first load.
  for (const m of [...firstLoadAssets]) {
    if (!m.endsWith('.webmanifest') && !m.endsWith('manifest.json')) continue;
    const file = join(OUT, m);
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, 'utf8')) as { icons?: { src?: string }[] };
    for (const icon of manifest.icons ?? []) {
      if (icon.src && !/^https?:/.test(icon.src)) firstLoadAssets.push(served(icon.src));
    }
  }

  // Follow static imports from the entry scripts and preloads.
  const initialJs: string[] = [];
  const queue = [...entryJs, ...preloads];
  while (queue.length > 0) {
    const p = queue.shift() as string;
    if (initialJs.includes(p)) continue;
    const file = join(OUT, p);
    if (!existsSync(file)) continue;
    initialJs.push(p);
    const code = readFileSync(file, 'utf8');
    for (const m of code.matchAll(STATIC_IMPORT)) {
      const target = resolveServed(p, m[2] ?? '');
      if (target && target.endsWith('.js') && !initialJs.includes(target)) queue.push(target);
    }
  }

  const files: FileEntry[] = walk(OUT)
    .map((abs) => {
      const path = `/${relative(OUT, abs).split('\\').join('/')}`;
      const buf = readFileSync(abs);
      let load: Load = 'lazy';
      if (initialJs.includes(path) || initialCss.includes(path)) load = 'initial';
      else if (firstLoadAssets.includes(path)) load = 'first-load asset';
      else if (path.endsWith('.js') && PHASER_MARKER.test(buf.toString('utf8')))
        load = 'lazy (Phaser board)';
      else if (/worker/i.test(path)) load = 'lazy (worker)';
      return {
        path,
        raw: buf.length,
        gzip: gzipSync(buf, { level: 9 }).length,
        brotli: brotliCompressSync(buf, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
        }).length,
        load,
      };
    })
    .sort((a, b) => b.gzip - a.gzip);

  const sum = (pred: (f: FileEntry) => boolean, key: 'gzip' | 'raw' = 'gzip') =>
    files.filter(pred).reduce((n, f) => n + f[key], 0);
  const initialJsGzip = sum((f) => initialJs.includes(f.path));
  const initialCssGzip = sum((f) => initialCss.includes(f.path));
  return {
    files,
    initialJs,
    initialCss,
    firstLoadAssets: firstLoadAssets.filter((p) => files.some((f) => f.path === p)),
    totals: {
      initialJsGzip,
      initialCssGzip,
      initialJsCssGzip: initialJsGzip + initialCssGzip,
      firstLoadGzip: sum((f) => f.load === 'initial' || f.load === 'first-load asset'),
      phaserGzip: sum((f) => f.load === 'lazy (Phaser board)'),
      allGzip: sum(() => true),
      allRaw: sum(() => true, 'raw'),
    },
  };
}

// ---- 2. runtime ------------------------------------------------------------------------------------

interface FrameStats {
  seconds: number;
  frames: number;
  fps: number;
  p95FrameMs: number;
  worstFrameMs: number;
  /** Frames longer than 1/30 s. */
  slowFrames: number;
  /**
   * Share of wall time the renderer main thread spent in tasks (CDP TaskDuration, which includes
   * waiting on the GPU process), on its CPU (ThreadTime), and in script (ScriptDuration).
   */
  mainThreadBusyPct: number;
  mainThreadCpuPct: number;
  scriptPct: number;
}

interface HeapSample {
  usedMB: number;
  totalMB: number;
}

interface RuntimeResult {
  profile: Profile;
  renderer: string;
  titleReadyMs: number;
  boardReadyMs: number;
  network: {
    titleFiles: string[];
    titleTransferred: number;
    titleStaticGzip: number;
    playableFiles: string[];
    playableTransferred: number;
    playableStaticGzip: number;
  };
  fps: {
    /** Title screen (DOM only, no Phaser): what this browser manages without the board. */
    title: FrameStats;
    idle: FrameStats;
    npcGame: FrameStats & { plies: number; moves: number };
  };
  memory: {
    title: HeapSample;
    idleBattle: HeapSample;
    npcGamePeakUsedMB: number;
    afterGameBeforeGc: HeapSample;
    afterGameAfterGc: HeapSample;
    rendererPssMB: number | null;
    gpuPssMB: number | null;
  };
}

interface RafCounter {
  deltas: number[];
  peakHeap: number;
  stop: boolean;
  elapsed: number;
}

type CounterWindow = Window & { __ctRaf?: RafCounter };

interface CpuTotals {
  task: number;
  thread: number;
  script: number;
}

function frameStats(c: RafCounter, busy: CpuTotals): FrameStats {
  const sorted = [...c.deltas].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  const seconds = Math.max(0.001, c.elapsed / 1000);
  return {
    seconds: round(seconds, 2),
    frames: c.deltas.length,
    fps: round(c.deltas.length / seconds),
    p95FrameMs: round(p95),
    worstFrameMs: round(sorted[sorted.length - 1] ?? 0),
    slowFrames: c.deltas.filter((d) => d > 1000 / 30 + 0.5).length,
    mainThreadBusyPct: round((100 * busy.task) / seconds),
    mainThreadCpuPct: round((100 * busy.thread) / seconds),
    scriptPct: round((100 * busy.script) / seconds),
  };
}

async function cpuTotals(cdp: CDPSession): Promise<CpuTotals> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  return { task: get('TaskDuration'), thread: get('ThreadTime'), script: get('ScriptDuration') };
}

/** Count frames (and main-thread time) while `during` runs. */
async function measureFrames<T>(
  page: Page,
  cdp: CDPSession,
  during: () => Promise<T>,
): Promise<{ stats: FrameStats; peakHeap: number; result: T }> {
  const a = await cpuTotals(cdp);
  await startCounter(page);
  const result = await during();
  const c = await stopCounter(page);
  const b = await cpuTotals(cdp);
  return {
    stats: frameStats(c, {
      task: b.task - a.task,
      thread: b.thread - a.thread,
      script: b.script - a.script,
    }),
    peakHeap: c.peakHeap,
    result,
  };
}

/**
 * requestAnimationFrame counter run in the page; it also samples the JS heap. Kept as plain source
 * text because tsx (esbuild keepNames) would wrap a local function in a `__name` helper that does
 * not exist in the page.
 */
const COUNTER_SOURCE = `(() => {
  const c = { deltas: [], peakHeap: 0, stop: false, elapsed: 0 };
  window.__ctRaf = c;
  let first = 0;
  let last = 0;
  const sample = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
  const tick = (t) => {
    if (c.stop) return;
    if (first === 0) first = t;
    else c.deltas.push(t - last);
    last = t;
    c.elapsed = t - first;
    if (c.deltas.length % 15 === 0) c.peakHeap = Math.max(c.peakHeap, sample());
    requestAnimationFrame(tick);
  };
  c.peakHeap = sample();
  requestAnimationFrame(tick);
})()`;

async function startCounter(page: Page): Promise<void> {
  await page.evaluate(COUNTER_SOURCE);
}

async function stopCounter(page: Page): Promise<RafCounter> {
  return page.evaluate(() => {
    const c = (window as CounterWindow).__ctRaf;
    if (!c) throw new Error('no frame counter running');
    c.stop = true;
    return { deltas: c.deltas, peakHeap: c.peakHeap, stop: true, elapsed: c.elapsed };
  });
}

async function heap(cdp: CDPSession): Promise<HeapSample> {
  const { metrics } = await cdp.send('Performance.getMetrics');
  const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  return {
    usedMB: round(get('JSHeapUsedSize') / MB),
    totalMB: round(get('JSHeapTotalSize') / MB),
  };
}

/** Proportional set size of a process in MB (Linux), or null. */
function pssMB(pid: number): number | null {
  try {
    const text = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const m = /^Pss:\s+(\d+)\s+kB/m.exec(text);
    return m ? round((Number(m[1]) * 1024) / MB) : null;
  } catch {
    return null;
  }
}

/** Largest renderer (the battle tab; a spare renderer is tiny) and the GPU process PSS. */
async function processMemory(
  browser: Browser,
): Promise<{ renderer: number | null; gpu: number | null }> {
  try {
    const s = await browser.newBrowserCDPSession();
    const info = (await s.send('SystemInfo.getProcessInfo')) as {
      processInfo: { type: string; id: number }[];
    };
    await s.detach();
    const of = (type: string) =>
      info.processInfo
        .filter((p) => p.type === type)
        .map((p) => pssMB(p.id))
        .filter((v): v is number => v !== null);
    const renderers = of('renderer');
    const gpu = of('GPU');
    return {
      renderer: renderers.length ? Math.max(...renderers) : null,
      gpu: gpu.length ? Math.max(...gpu) : null,
    };
  } catch {
    return { renderer: null, gpu: null };
  }
}

/** Deterministic pseudo-random choices for the NPC game (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function clickIfVisible(target: Locator): Promise<boolean> {
  if (!(await target.isVisible().catch(() => false))) return false;
  await target.click({ timeout: 2_000 }).catch(() => undefined);
  return true;
}

/** Play random legal moves through the Move panel whenever it is our turn, for `ms`. */
async function playNpcGame(page: Page, ms: number): Promise<number> {
  const random = rng(20260925);
  const pick = (n: number) => Math.min(n - 1, Math.floor(random() * n));
  const until = Date.now() + ms;
  let moves = 0;
  const banner = page.locator('.turn-banner');
  const pieces = page.getByRole('group', { name: 'Pieces that can move' }).getByRole('button');
  const dests = page
    .getByRole('group', { name: 'Destinations' })
    .getByRole('button', { name: /^(Move to|Capture on)/ });
  while (Date.now() < until) {
    // Answer mid-action prompts and promotions with their first option.
    if (await clickIfVisible(page.getByRole('dialog').first().getByRole('button').first()))
      continue;
    // A finished battle: rematch (colours swap) and keep playing.
    if (await clickIfVisible(page.getByRole('button', { name: /Rematch/ }))) continue;
    const mine = await banner
      .textContent({ timeout: 500 })
      .then((t) => (t ?? '').includes('Your move.'))
      .catch(() => false);
    if (!mine) {
      await page.waitForTimeout(40);
      continue;
    }
    let d = await dests.count();
    if (d === 0) {
      const n = await pieces.count();
      if (n === 0) {
        await page.waitForTimeout(40);
        continue;
      }
      await pieces
        .nth(pick(n))
        .click({ timeout: 2_000 })
        .catch(() => undefined);
      await dests
        .first()
        .waitFor({ timeout: 2_000 })
        .catch(() => undefined);
      d = await dests.count();
      if (d === 0) continue;
    }
    await dests
      .nth(pick(d))
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    moves++;
  }
  return moves;
}

/** Actions in the battle log; on narrow screens the log is a tab, opened briefly to count. */
async function logActions(page: Page): Promise<number> {
  const items = page.getByRole('log').locator(':scope > li');
  if (
    await page
      .getByRole('log')
      .isVisible()
      .catch(() => false)
  )
    return items.count();
  const logTab = page.getByRole('tab', { name: /^Log/ });
  if (!(await logTab.isVisible().catch(() => false))) return 0;
  await logTab.click();
  await page
    .getByRole('log')
    .waitFor({ timeout: 5_000 })
    .catch(() => undefined);
  const n = await items.count();
  await page
    .getByRole('tab', { name: 'Move' })
    .click()
    .catch(() => undefined);
  return n;
}

async function measureProfile(
  browser: Browser,
  baseURL: string,
  profile: Profile,
  bundle: Bundle,
): Promise<RuntimeResult> {
  log(`profile ${profile.id}: ${profile.label}`);
  const context = await browser.newContext({
    baseURL,
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    reducedMotion: 'no-preference',
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    if (profile.cpuThrottle > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuThrottle });
    }
    const requested = new Map<string, number>();
    context.on('requestfinished', (req) => {
      void req
        .sizes()
        .then((s) => {
          const path = new URL(req.url()).pathname;
          requested.set(
            path,
            (requested.get(path) ?? 0) + s.responseBodySize + s.responseHeadersSize,
          );
        })
        .catch(() => undefined);
    });
    const staticGzip = (paths: string[]) =>
      paths.reduce((n, p) => {
        const f = bundle.files.find((x) => x.path === (p === '/' ? '/index.html' : p));
        return n + (f?.gzip ?? 0);
      }, 0);
    const snapshotNetwork = () => {
      const files = [...requested.keys()].sort();
      const transferred = [...requested.values()].reduce((a, b) => a + b, 0);
      return { files, transferred, gzip: staticGzip(files) };
    };

    // Title screen.
    const t0 = Date.now();
    await page.goto('/');
    await page.getByRole('heading', { name: 'Chain Theorem', level: 1 }).waitFor();
    const titleReadyMs = Date.now() - t0;
    await page.waitForLoadState('networkidle');
    const titleNet = snapshotNetwork();
    await cdp.send('HeapProfiler.collectGarbage');
    const titleHeap = await heap(cdp);
    log(`  title screen ${SECONDS}s`);
    const titleFrames = await measureFrames(page, cdp, () => page.waitForTimeout(SECONDS * 1000));

    // A local Full Battle vs the Elite NPC.
    await page.getByRole('button', { name: 'Play a local battle' }).click();
    await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('full');
    await page.getByRole('combobox', { name: 'Opponent', exact: true }).selectOption('elite');
    const t1 = Date.now();
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.locator('.board-host canvas').waitFor({ state: 'visible', timeout: 60_000 });
    await page.getByText('Loading board...').waitFor({ state: 'detached', timeout: 60_000 });
    const boardReadyMs = Date.now() - t1;
    const renderer = await page.evaluate(() => {
      const c = document.querySelector('.board-host canvas') as HTMLCanvasElement | null;
      if (!c) return 'none';
      if (c.getContext('webgl2')) return 'WebGL 2';
      if (c.getContext('webgl')) return 'WebGL';
      return c.getContext('2d') ? 'Canvas 2D' : 'unknown';
    });
    await page.waitForTimeout(1_000);

    // Idle battle.
    log(`  idle battle ${SECONDS}s`);
    const idle = await measureFrames(page, cdp, () => page.waitForTimeout(SECONDS * 1000));
    await cdp.send('HeapProfiler.collectGarbage');
    const idleHeap = await heap(cdp);

    // NPC game: random legal moves for us, the Elite NPC answers from its Web Worker.
    log(`  NPC game ${SECONDS}s`);
    const actionsBefore = await logActions(page);
    const game = await measureFrames(page, cdp, () => playNpcGame(page, SECONDS * 1000));
    const actionsAfter = await logActions(page);
    const npcGame = {
      ...game.stats,
      moves: game.result,
      plies: Math.max(0, actionsAfter - actionsBefore),
    };
    // Let the last NPC reply (and the worker script) arrive before the network snapshot.
    await page.waitForLoadState('networkidle');
    const playableNet = snapshotNetwork();
    const beforeGc = await heap(cdp);
    const proc = await processMemory(browser);
    await cdp.send('HeapProfiler.collectGarbage');
    const afterGc = await heap(cdp);

    return {
      profile,
      renderer,
      titleReadyMs,
      boardReadyMs,
      network: {
        titleFiles: titleNet.files,
        titleTransferred: titleNet.transferred,
        titleStaticGzip: titleNet.gzip,
        playableFiles: playableNet.files,
        playableTransferred: playableNet.transferred,
        playableStaticGzip: playableNet.gzip,
      },
      fps: { title: titleFrames.stats, idle: idle.stats, npcGame },
      memory: {
        title: titleHeap,
        idleBattle: idleHeap,
        npcGamePeakUsedMB: round(Math.max(idle.peakHeap, game.peakHeap) / MB),
        afterGameBeforeGc: beforeGc,
        afterGameAfterGc: afterGc,
        rendererPssMB: proc.renderer,
        gpuPssMB: proc.gpu,
      },
    };
  } finally {
    await context.close();
  }
}

async function loadChromium(): Promise<BrowserType> {
  // Playwright is a dev dependency of the client, not of the repository root.
  const req = createRequire(join(CLIENT, 'package.json'));
  const mod = (await import(pathToFileURL(req.resolve('@playwright/test')).href)) as {
    chromium?: BrowserType;
    default?: { chromium?: BrowserType };
  };
  const chromium = mod.chromium ?? mod.default?.chromium;
  if (!chromium) throw new Error('could not load chromium from @playwright/test');
  return chromium;
}

function startPreview(port: number): ChildProcess {
  return spawn(
    'pnpm',
    [
      '--filter',
      '@chain-theorem/client',
      'preview',
      '--outDir',
      OUT_REL,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: ROOT, stdio: 'ignore', detached: true },
  );
}

function stopPreview(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function waitForServer(url: string, ms: number): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`preview server did not start at ${url}`);
}

// ---- 3. budgets and reports ------------------------------------------------------------------------

interface BudgetRow {
  id: string;
  spec: string;
  name: string;
  limit: string;
  measured: string;
  value: number;
  pass: boolean;
  kind: 'size' | 'runtime';
  note?: string;
}

function budgets(bundle: Bundle, runtime: RuntimeResult[]): BudgetRow[] {
  const t = bundle.totals;
  const rows: BudgetRow[] = [
    {
      id: 'initial-js',
      spec: '12.3 R-TECH-003',
      name: 'Initial JavaScript (entry JS + CSS, gzip)',
      limit: '≤ 600 kB',
      measured: `${fmtBytes(t.initialJsCssGzip)} (JS ${fmtBytes(t.initialJsGzip)} + CSS ${fmtBytes(t.initialCssGzip)})`,
      value: t.initialJsCssGzip,
      pass: t.initialJsCssGzip <= BUDGET.initialJs,
      kind: 'size',
      note: 'CSS is counted too, which is stricter than the JavaScript-only budget.',
    },
    {
      id: 'first-load',
      spec: '11.4 R-ART-004',
      name: 'First load, to the title screen (gzip)',
      limit: '≤ 2 MB',
      measured: fmtBytes(t.firstLoadGzip),
      value: t.firstLoadGzip,
      pass: t.firstLoadGzip <= BUDGET.firstLoad,
      kind: 'size',
      note: 'index.html, initial JS and CSS, manifest and icons.',
    },
    {
      id: 'first-playable',
      spec: '11.4 R-ART-004',
      name: 'First playable, whole build incl. Phaser and NPC worker (gzip)',
      limit: '≤ 5 MB',
      measured: `${fmtBytes(t.allGzip)} (Phaser chunk ${fmtBytes(t.phaserGzip)})`,
      value: t.allGzip,
      pass: t.allGzip <= BUDGET.firstPlayable,
      kind: 'size',
      note: 'The tutorial town arrives in M5; until then a local battle is the first playable.',
    },
  ];
  for (const r of runtime) {
    const p = r.profile;
    const worst = Math.min(r.fps.idle.fps, r.fps.npcGame.fps);
    const threshold = p.fps.kind === 'floor' ? p.fps.budget : p.fps.budget * FPS_TARGET_TOLERANCE;
    rows.push({
      id: `fps-${p.id}`,
      spec: '12.3 R-TECH-003',
      name: `Frame rate, ${p.label} (lower of idle battle and NPC game)`,
      limit:
        p.fps.kind === 'floor'
          ? `≥ ${p.fps.budget} fps floor`
          : `${p.fps.budget} fps (≥ ${threshold} measured)`,
      measured: `${worst} fps (idle ${r.fps.idle.fps}, NPC game ${r.fps.npcGame.fps})`,
      value: worst,
      pass: worst >= threshold,
      kind: 'runtime',
    });
    const peakHeap = Math.max(
      r.memory.npcGamePeakUsedMB,
      r.memory.afterGameBeforeGc.usedMB,
      r.memory.idleBattle.usedMB,
      r.memory.title.usedMB,
    );
    rows.push({
      id: `heap-${p.id}`,
      spec: '12.3 R-TECH-003',
      name: `Memory: peak JS heap, ${p.label}`,
      limit: '≤ 150 MB',
      measured: `${peakHeap} MB (after GC ${r.memory.afterGameAfterGc.usedMB} MB)`,
      value: peakHeap,
      pass: peakHeap * MB <= BUDGET.memory,
      kind: 'runtime',
    });
    if (r.memory.rendererPssMB !== null) {
      rows.push({
        id: `tab-${p.id}`,
        spec: '12.3 R-TECH-003',
        name: `Memory: tab renderer process (PSS), ${p.label}`,
        limit: '≤ 150 MB',
        measured: `${r.memory.rendererPssMB} MB`,
        value: r.memory.rendererPssMB,
        pass: r.memory.rendererPssMB * MB <= BUDGET.memory,
        kind: 'runtime',
        note: 'Whole renderer: JS heap, DOM, decoded images and Chromium itself; GPU process excluded.',
      });
    }
  }
  return rows;
}

function markdown(report: Report): string {
  const lines: string[] = [];
  const passed = report.budgets.filter((b) => b.pass).length;
  lines.push('# Client budgets');
  lines.push('');
  lines.push(
    `Generated ${report.generatedAt} by \`pnpm measure:client\` · commit ${report.commit} · ${report.browser} · Node ${report.node}`,
  );
  lines.push('');
  const m = report.machine;
  lines.push(
    `Machine: ${m.cpus} × ${m.model}; 1-minute load average ${m.loadAvgStart} at start, ${m.loadAvgEnd} at end.`,
  );
  lines.push('');
  lines.push(
    `**${passed} of ${report.budgets.length} budgets pass.** Spec 12.3 (R-TECH-003) and 11.4 (R-ART-004); sizes in decimal units (1 kB = 1000 B).`,
  );
  lines.push('');
  lines.push('## Budgets');
  lines.push('');
  lines.push('| Budget | Spec | Limit | Measured | Result |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const b of report.budgets) {
    lines.push(
      `| ${b.name}${b.note ? `<br><small>${b.note}</small>` : ''} | ${b.spec} | ${b.limit} | ${b.measured} | ${b.pass ? '✓ pass' : '✗ FAIL'} |`,
    );
  }
  lines.push('');
  lines.push('## Bundle');
  lines.push('');
  lines.push(
    `Initial chunks: the entry script, stylesheets and modulepreloads of \`index.html\` plus their static imports (${report.bundle.initialJs.join(', ')}; CSS ${report.bundle.initialCss.join(', ')}). Everything else loads on demand.`,
  );
  lines.push('');
  lines.push('| File | Loads | Raw | gzip -9 | brotli -11 |');
  lines.push('| --- | --- | ---: | ---: | ---: |');
  for (const f of report.bundle.files) {
    lines.push(
      `| \`${f.path}\` | ${f.load} | ${fmtBytes(f.raw)} | ${fmtBytes(f.gzip)} | ${fmtBytes(f.brotli)} |`,
    );
  }
  const t = report.bundle.totals;
  lines.push(`| **Total** | | ${fmtBytes(t.allRaw)} | ${fmtBytes(t.allGzip)} | |`);
  lines.push('');
  lines.push('## Runtime');
  lines.push('');
  lines.push(
    `Headless Chromium, production build served by \`vite preview\` (gzip). A local Full Battle against the Elite NPC: ${report.seconds} s of idle battle, then ${report.seconds} s of an NPC game in which the script plays random legal moves through the Move panel. Frame rates come from a requestAnimationFrame counter; JS heap from CDP Performance.getMetrics (after a forced GC where noted) and performance.memory; tab memory is the renderer process PSS from /proc.`,
  );
  lines.push('');
  const head = report.runtime.map((r) => r.profile.id);
  lines.push(`| Metric | ${head.join(' | ')} |`);
  lines.push(`| --- | ${head.map(() => '---:').join(' | ')} |`);
  const row = (name: string, f: (r: RuntimeResult) => string) =>
    lines.push(`| ${name} | ${report.runtime.map(f).join(' | ')} |`);
  row('Profile', (r) => r.profile.label);
  row('Board renderer', (r) => r.renderer);
  row('Title visible after', (r) => `${r.titleReadyMs} ms`);
  row('Board ready after Start', (r) => `${r.boardReadyMs} ms`);
  row(
    'Title: files / transferred / gzip -9',
    (r) =>
      `${r.network.titleFiles.length} / ${fmtBytes(r.network.titleTransferred)} / ${fmtBytes(r.network.titleStaticGzip)}`,
  );
  row(
    'Playable battle: files / transferred / gzip -9',
    (r) =>
      `${r.network.playableFiles.length} / ${fmtBytes(r.network.playableTransferred)} / ${fmtBytes(r.network.playableStaticGzip)}`,
  );
  row('Title screen fps, no board (p95 / worst frame)', (r) => {
    const s = r.fps.title;
    return `${s.fps} (${s.p95FrameMs} / ${s.worstFrameMs} ms)`;
  });
  row('Idle battle fps (p95 / worst frame)', (r) => {
    const s = r.fps.idle;
    return `${s.fps} (${s.p95FrameMs} / ${s.worstFrameMs} ms)`;
  });
  row('NPC game fps (p95 / worst frame)', (r) => {
    const s = r.fps.npcGame;
    return `${s.fps} (${s.p95FrameMs} / ${s.worstFrameMs} ms)`;
  });
  row(
    'NPC game: frames over 33 ms',
    (r) => `${r.fps.npcGame.slowFrames} of ${r.fps.npcGame.frames}`,
  );
  // CDP CPU throttling pauses the thread, so its CPU time is not meaningful when throttled.
  const busy = (r: RuntimeResult, f: FrameStats) =>
    `${f.mainThreadBusyPct}% / ${r.profile.cpuThrottle > 1 ? 'n/a' : `${f.mainThreadCpuPct}%`} / ${f.scriptPct}%`;
  row('Main thread in tasks / on CPU / in script: title', (r) => busy(r, r.fps.title));
  row('Main thread in tasks / on CPU / in script: idle battle', (r) => busy(r, r.fps.idle));
  row('Main thread in tasks / on CPU / in script: NPC game', (r) => busy(r, r.fps.npcGame));
  row(
    'NPC game: our moves / log actions',
    (r) => `${r.fps.npcGame.moves} / ${r.fps.npcGame.plies}`,
  );
  row('JS heap used, title (after GC)', (r) => `${r.memory.title.usedMB} MB`);
  row('JS heap used, idle battle (after GC)', (r) => `${r.memory.idleBattle.usedMB} MB`);
  row('JS heap used, NPC game peak', (r) => `${r.memory.npcGamePeakUsedMB} MB`);
  row(
    'JS heap used / total after the game',
    (r) =>
      `${r.memory.afterGameBeforeGc.usedMB} / ${r.memory.afterGameBeforeGc.totalMB} MB (after GC ${r.memory.afterGameAfterGc.usedMB} MB)`,
  );
  row('Tab renderer process PSS', (r) =>
    r.memory.rendererPssMB === null ? 'n/a' : `${r.memory.rendererPssMB} MB`,
  );
  row('GPU process PSS (not counted)', (r) =>
    r.memory.gpuPssMB === null ? 'n/a' : `${r.memory.gpuPssMB} MB`,
  );
  lines.push('');
  lines.push('## Caveats');
  lines.push('');
  lines.push(
    '- Headless Chromium renders WebGL in software (SwiftShader) in the GPU process, which CPU throttling does not slow; a real 2019 mid-range phone has a GPU but a slower CPU. Treat the frame rates as indicative and re-measure on a device before release.',
  );
  lines.push(
    '- Read the frame rates with the title-screen row (same browser, no WebGL board) and the main-thread rows: "in tasks" includes time blocked on the GPU process, "on CPU" is the thread\'s own CPU time. A low frame rate with the main thread in tasks near 100% but little CPU or script time means frames wait on the software WebGL rasteriser, not on client code.',
  );
  lines.push(
    '- "Transferred" counts response bodies and headers as Chromium reports them; the NPC worker script is not always reported, so the gzip -9 column (static sizes of the files that were requested) is the reliable one.',
  );
  lines.push(
    '- The 60 fps target is checked with a 5% tolerance for requestAnimationFrame jitter; the 30 fps floor has none.',
  );
  if (Math.max(m.loadAvgStart, m.loadAvgEnd) > m.cpus / 2) {
    lines.push(
      `- Other processes were busy during this run (load average above ${m.cpus / 2} on ${m.cpus} CPUs). Software WebGL competes with them for the CPU, so frame rates and tab memory vary between runs; re-run on an idle machine for comparable numbers.`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

interface Report {
  generatedAt: string;
  commit: string;
  node: string;
  browser: string;
  /** Runtime numbers depend on the machine and on whatever else was running (load average). */
  machine: { cpus: number; model: string; loadAvgStart: number; loadAvgEnd: number };
  seconds: number;
  bundle: Bundle;
  runtime: RuntimeResult[];
  budgets: BudgetRow[];
  pass: { size: boolean; runtime: boolean };
}

// ---- main ------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const loadAvgStart = round(loadavg()[0] ?? 0, 2);
  if (!SKIP_BUILD) {
    log(`building the client into apps/client/${OUT_REL}`);
    run('pnpm', ['--filter', '@chain-theorem/client', 'build', '--outDir', OUT_REL]);
  } else if (!existsSync(join(OUT, 'index.html'))) {
    throw new Error(`--skip-build: no build at ${OUT}; run without --skip-build first`);
  }
  const bundle = measureBundle();
  log(
    `initial JS+CSS ${fmtBytes(bundle.totals.initialJsCssGzip)} gzip; whole build ${fmtBytes(bundle.totals.allGzip)} gzip`,
  );

  const port = await freePort();
  const baseURL = `http://127.0.0.1:${port}`;
  const server = startPreview(port);
  let browser: Browser | null = null;
  const meta = { browser: 'unknown' };
  const runtime: RuntimeResult[] = [];
  try {
    await waitForServer(`${baseURL}/`, 30_000);
    const chromium = await loadChromium();
    const executablePath =
      process.env.PW_CHROMIUM_PATH ??
      (existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined);
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--enable-precise-memory-info'],
    });
    meta.browser = browser.version();
    for (const p of PROFILES) runtime.push(await measureProfile(browser, baseURL, p, bundle));
  } finally {
    await browser?.close();
    stopPreview(server);
  }

  const rows = budgets(bundle, runtime);
  const dirty = git(['status', '--porcelain']) ? '+dirty' : '';
  const report: Report = {
    generatedAt: new Date().toISOString(),
    commit: `${git(['rev-parse', '--short', 'HEAD']) || 'unknown'}${dirty}`,
    node: process.version,
    browser: `Chromium ${meta.browser}`,
    machine: {
      cpus: cpus().length,
      model: cpus()[0]?.model.trim() ?? 'unknown',
      loadAvgStart,
      loadAvgEnd: round(loadavg()[0] ?? 0, 2),
    },
    seconds: SECONDS,
    bundle,
    runtime,
    budgets: rows,
    pass: {
      size: rows.filter((r) => r.kind === 'size').every((r) => r.pass),
      runtime: rows.filter((r) => r.kind === 'runtime').every((r) => r.pass),
    },
  };
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(join(REPORTS, 'budgets.json'), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(REPORTS, 'budgets.md'), markdown(report));

  for (const r of rows) log(`${r.pass ? 'pass' : 'FAIL'}  ${r.name}: ${r.measured} (${r.limit})`);
  log('wrote reports/budgets.md and reports/budgets.json');
  const failed = !report.pass.size || (STRICT && !report.pass.runtime);
  if (failed) {
    console.error('[measure] budget check failed');
    process.exitCode = 1;
  } else if (!report.pass.runtime) {
    log('runtime budgets missed on this machine (recorded; use --strict to fail on them)');
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
