/**
 * Log a delegated decision (D-37): appends a DD row to spec section 18 (docs/DESIGN.md) and writes
 * docs/decisions/DD-XX-<slug>.md.
 *
 *   pnpm tsx scripts/add-decision.ts "<decision>" "<why it is the best case>" [--slug short-name] [--refs "5.4, R-ABIL-004"]
 *
 * The next free DD number is chosen automatically.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const slugArg = flag('--slug');
const refs = flag('--refs') ?? '';
const [decision, why] = args;
if (!decision || !why) {
  console.error('usage: add-decision "<decision>" "<why>" [--slug s] [--refs r]');
  process.exit(1);
}
const root = new URL('..', import.meta.url).pathname;
const designPath = `${root}docs/DESIGN.md`;
const design = readFileSync(designPath, 'utf8');
const nums = [...design.matchAll(/^\| DD-(\d+) \|/gm)].map((m) => Number(m[1]));
const next = Math.max(0, ...nums) + 1;
const id = `DD-${String(next).padStart(2, '0')}`;
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const row = `| ${id} | ${cell(decision)} | ${cell(why)} |`;
const lines = design.split('\n');
let lastRow = -1;
lines.forEach((l, i) => {
  if (/^\| DD-\d+ \|/.test(l)) lastRow = i;
});
if (lastRow < 0) throw new Error('section 18 table not found');
lines.splice(lastRow + 1, 0, row);
writeFileSync(designPath, lines.join('\n'));
const slug = (slugArg ?? decision)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 48);
const existing = readdirSync(`${root}docs/decisions`);
if (existing.some((f) => f.startsWith(`${id}-`))) throw new Error(`${id} record exists`);
writeFileSync(
  `${root}docs/decisions/${id}-${slug}.md`,
  `# ${id}: ${decision.split('.')[0]}\n\nStatus: binding under D-37 (designer may overrule).${refs ? `\nSpec: ${refs}` : ''}\n\n## Decision\n\n${decision}\n\n## Why it is the best case\n\n${why}\n`,
);
console.log(`${id} logged`);
