/**
 * Requirement coverage (spec section 0, release checklist 17.3): every requirement ID in
 * docs/DESIGN.md (`R-<AREA>-<NNN>` and `INV-xx`) must appear in the title of at least one test
 * (`it`, `test` or `describe`) somewhere in the repository. Prints the IDs without a test and exits 1
 * when any is missing; `--table` prints the count of tests per ID.
 *
 *   pnpm req:coverage [--table]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const ID = /\b(?:R-[A-Z]{2,6}-\d{3}|INV-\d{2})\b/g;
const SKIP = new Set(['node_modules', 'dist', '.git', '.wrangler', 'coverage', 'test-results']);
const TEST_FILE = /\.(test|spec|perft\.test)\.tsx?$/;
/** A test or suite title: the first string argument of it/test/describe (and their modifiers). */
const TITLE =
  /\b(?:it|test|describe)(?:\.(?:each\([^)]*\)|skipIf\([^)]*\)|only|concurrent|sequential))*\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) files(p, out);
    else if (TEST_FILE.test(name)) out.push(p);
  }
  return out;
}

/** Requirement IDs in the spec, with whether each is marked INVARIANT where it is defined. */
function specIds(): Map<string, boolean> {
  const spec = readFileSync(join(root, 'docs/DESIGN.md'), 'utf8');
  const ids = new Map<string, boolean>();
  for (const line of spec.split('\n'))
    for (const m of line.matchAll(ID)) {
      const id = m[0];
      const invariant = id.startsWith('INV-') || /INVARIANT/.test(line);
      ids.set(id, (ids.get(id) ?? false) || invariant);
    }
  return ids;
}

const ids = specIds();
const counts = new Map<string, number>([...ids.keys()].map((id) => [id, 0]));
const where = new Map<string, string>();
for (const f of files(root)) {
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(TITLE)) {
    for (const id of (m[2] ?? '').match(ID) ?? []) {
      if (!counts.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!where.has(id)) where.set(id, relative(root, f));
    }
  }
}

const missing = [...counts].filter(([, n]) => n === 0).map(([id]) => id);
if (process.argv.includes('--table')) {
  for (const [id, n] of [...counts].sort(([a], [b]) => (a < b ? -1 : 1)))
    console.log(
      `${id.padEnd(12)} ${String(n).padStart(4)}  ${ids.get(id) ? 'INVARIANT ' : ''}${where.get(id) ?? '-'}`,
    );
}
const invariants = [...ids].filter(([, inv]) => inv).map(([id]) => id);
if (missing.length > 0) {
  console.error(
    `req:coverage: ${missing.length} requirement IDs have no test: ${missing.join(', ')}`,
  );
  process.exit(1);
}
console.log(
  `req:coverage ok: all ${ids.size} requirement IDs have tests (${invariants.length} marked INVARIANT)`,
);
