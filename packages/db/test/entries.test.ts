/**
 * Package entries (ARCHITECTURE 7): the Worker bundle imports `@chain-theorem/db`, `/d1` or `/pg`,
 * so none of those may reach better-sqlite3 (native code); only `/node` may. The dialect-agnostic
 * entry imports no driver at all.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Bare package specifiers reachable from `entry` through relative imports. */
function externalImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const external = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(
      /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/g,
    )) {
      const spec = m[1]!;
      if (spec.startsWith('.')) visit(resolve(dirname(file), spec));
      else external.add(spec);
    }
  };
  visit(resolve(PKG, entry));
  return external;
}

describe('package entries (R-DATA-004)', () => {
  it('R-DATA-004 the dialect-agnostic entry imports no database driver', () => {
    const deps = externalImports('src/index.ts');
    expect([...deps].sort()).toEqual(['kysely', 'zod']);
  });

  it('R-DATA-004 the d1 and pg entries never reach better-sqlite3', () => {
    expect(externalImports('src/d1.ts').has('better-sqlite3')).toBe(false);
    expect(externalImports('src/d1.ts').has('pg')).toBe(false);
    expect(externalImports('src/pg.ts').has('better-sqlite3')).toBe(false);
    expect(externalImports('src/node.ts').has('better-sqlite3')).toBe(true);
  });

  it('R-DATA-004 package.json exposes the four entries', () => {
    const pkg = JSON.parse(readFileSync(resolve(PKG, 'package.json'), 'utf8')) as {
      exports: Record<string, string>;
    };
    expect(pkg.exports).toEqual({
      '.': './src/index.ts',
      './node': './src/node.ts',
      './pg': './src/pg.ts',
      './d1': './src/d1.ts',
    });
  });
});
