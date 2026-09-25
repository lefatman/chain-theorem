/**
 * R-DATA-001 dependency rule check (spec 13.1).
 * rules -> nothing; content, ai -> rules; db, protocol -> nothing in repo;
 * client -> rules, content, protocol; server -> anything; nothing depends on apps/*.
 * Also enforces that packages/rules has zero runtime dependencies.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const ALLOWED: Record<string, string[] | '*'> = {
  '@chain-theorem/rules': [],
  '@chain-theorem/content': ['@chain-theorem/rules'],
  '@chain-theorem/ai': ['@chain-theorem/rules'],
  '@chain-theorem/db': [],
  '@chain-theorem/protocol': [],
  '@chain-theorem/client': [
    '@chain-theorem/rules',
    '@chain-theorem/content',
    '@chain-theorem/protocol',
    '@chain-theorem/ai',
  ],
  '@chain-theorem/server': '*',
  '@chain-theorem/tools': '*',
};
const APPS = ['@chain-theorem/client', '@chain-theorem/server', '@chain-theorem/tools'];

let failures = 0;
for (const group of ['packages', 'apps']) {
  for (const dir of readdirSync(join(ROOT, group))) {
    const file = join(ROOT, group, dir, 'package.json');
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as {
      name: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allowed = ALLOWED[pkg.name];
    if (allowed === undefined) {
      console.error(`unknown workspace package ${pkg.name}: add it to scripts/check-deps.ts`);
      failures++;
      continue;
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const dep of Object.keys(deps)) {
      if (!dep.startsWith('@chain-theorem/')) continue;
      if (APPS.includes(dep)) {
        console.error(`${pkg.name} depends on app ${dep}; nothing may depend on apps/* (13.1)`);
        failures++;
      } else if (allowed !== '*' && !allowed.includes(dep)) {
        console.error(`${pkg.name} may not depend on ${dep} (13.1)`);
        failures++;
      }
    }
    if (pkg.name === '@chain-theorem/rules' && Object.keys(pkg.dependencies ?? {}).length > 0) {
      console.error('@chain-theorem/rules must have zero runtime dependencies (R-DATA-001)');
      failures++;
    }
  }
}
if (failures > 0) {
  console.error(`deps:check failed with ${failures} violation(s)`);
  process.exit(1);
}
console.log('deps:check ok: workspace dependency rules hold (R-DATA-001)');
