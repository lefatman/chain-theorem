/**
 * `pnpm deploy:check`: reports which production prerequisites (DEPLOY.md) are in place.
 * Human-only items (step 0.4, BUILD_PROMPT section 11) are reported, never faked.
 * Exits 0 always: it is an informational checklist, not a gate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

type Row = { item: string; ok: boolean; hint: string };
const rows: Row[] = [];
const root = new URL('..', import.meta.url).pathname;
const wranglerPath = `${root}apps/server/wrangler.jsonc`;
const wrangler = existsSync(wranglerPath) ? readFileSync(wranglerPath, 'utf8') : '';

function tryRun(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

rows.push({
  item: 'wrangler.jsonc present',
  ok: wrangler.length > 0,
  hint: 'apps/server/wrangler.jsonc (M4)',
});
rows.push({
  item: 'Hyperdrive id configured',
  ok: wrangler.length > 0 && !wrangler.includes('REPLACE_WITH_HYPERDRIVE_ID'),
  hint: 'DEPLOY.md section 2 (human-only, step 0.4)',
});
const whoami = tryRun('pnpm', ['--filter', '@chain-theorem/server', 'exec', 'wrangler', 'whoami']);
rows.push({
  item: 'wrangler logged in',
  ok: whoami !== null && !/not authenticated/i.test(whoami),
  hint: 'wrangler login (human-only)',
});
for (const env of ['CLOUDFLARE_API_TOKEN', 'DATABASE_URL']) {
  rows.push({
    item: `${env} in environment`,
    ok: Boolean(process.env[env]),
    hint: 'optional for CI deploys / migrations',
  });
}
rows.push({
  item: '.dev.vars.example documents secrets',
  ok: existsSync(`${root}apps/server/.dev.vars.example`),
  hint: 'apps/server/.dev.vars.example',
});

const width = Math.max(...rows.map((r) => r.item.length));
console.log('Chain Theorem deploy readiness (see DEPLOY.md)\n');
for (const r of rows)
  console.log(`${r.ok ? '[x]' : '[ ]'} ${r.item.padEnd(width)}  ${r.ok ? '' : r.hint}`);
const missing = rows.filter((r) => !r.ok).length;
console.log(
  `\n${rows.length - missing}/${rows.length} ready. Missing items are human-only or later milestones.`,
);
