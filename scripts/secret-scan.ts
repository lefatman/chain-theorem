/**
 * R-SEC-009: secrets only in Worker secrets, never in the repository or client bundle.
 * Scans tracked files, and the built client bundle (apps/client/dist) when it exists, for high-risk
 * secret patterns. Run in CI.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERNS: [string, RegExp][] = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Paddle live API key', /\bpdl_live_apikey_[A-Za-z0-9_]{20,}\b/],
  ['Paddle sandbox API key', /\bpdl_sdbx_apikey_[A-Za-z0-9_]{20,}\b/],
  ['Paddle webhook secret', /\bpdl_ntfset_[A-Za-z0-9_]{20,}\b/],
  ['Stripe live key', /\bsk_live_[A-Za-z0-9]{20,}\b/],
  [
    'Postgres URL with password',
    /postgres(?:ql)?:\/\/[^:\s'"]+:(?!chain@|postgres@|password@|PASSWORD@|\$\{)[^@\s'"]{6,}@(?!localhost|127\.0\.0\.1)/,
  ],
];
const ALLOW_FILES = [/^scripts\/secret-scan\.ts$/, /^pnpm-lock\.yaml$/, /^docs\//];

/** The built client (served to every browser): scanned too when it exists. */
function bundleFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...bundleFiles(p));
    else if (/\.(js|mjs|html|css|json|webmanifest|map)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [
  ...execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean),
  ...bundleFiles('apps/client/dist'),
];
let hits = 0;
for (const file of files) {
  if (ALLOW_FILES.some((re) => re.test(file))) continue;
  let text: string;
  try {
    if (statSync(file).size > 2_000_000) continue;
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const [name, re] of PATTERNS) {
    if (re.test(text)) {
      console.error(`${file}: possible ${name}`);
      hits++;
    }
  }
  if (/(^|\/)\.dev\.vars$/.test(file) || /(^|\/)\.env(\.|$)/.test(file)) {
    console.error(`${file}: local secrets file is tracked`);
    hits++;
  }
}
if (hits > 0) {
  console.error(`secret scan failed: ${hits} finding(s)`);
  process.exit(1);
}
console.log(`secret scan ok: ${files.length} tracked files clean (R-SEC-009)`);
