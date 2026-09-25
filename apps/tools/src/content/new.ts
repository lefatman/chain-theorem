/**
 * `pnpm content:new ability|item|trait <id>` — scaffolds a module and its scenario test from a
 * template (13.5). Then fill in the data, write the test, run `pnpm content:index` and `pnpm check`.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const [kind, id] = process.argv.slice(2);
const DIRS: Record<string, string> = { ability: 'abilities', item: 'items', trait: 'traits' };
if (!kind || !id || !DIRS[kind] || !/^[a-z][a-z0-9_]*$/.test(id)) {
  console.error('usage: pnpm content:new ability|item|trait <snake_case_id>');
  process.exit(1);
}
const dir = join(ROOT, 'packages/content', DIRS[kind] as string);
const file = join(dir, `${id}.ts`);
const testFile = join(dir, `${id}.test.ts`);
if (existsSync(file)) {
  console.error(`${file} already exists; shipped ids are retired, never reused (13.5)`);
  process.exit(1);
}
const title = id
  .split('_')
  .map((w) => w[0]?.toUpperCase() + w.slice(1))
  .join(' ');
const templates: Record<string, string> = {
  ability: `/** ${title} (PLAYTEST): describe the rule and cite the spec section. */
import { defineAbility, fx, target } from '@chain-theorem/rules/sdk';

export default defineAbility({
  id: '${id}',
  name: '${title}',
  version: 1,
  category: 'CAPTURED', // CAPTURING | CAPTURES | CAPTURED | PASSIVE
  affinity: 'neutral', // ember | tide | grove | storm | stone | frost | neutral
  eligible: 'all',
  tags: [], // 'replay' (grants a bonus move) | 'revive' (returns a captured piece)
  minLevel: 1, // level requirement, 1..LEVEL_CAP
  slotCost: 1, // ability slots used, 1..MAX_ABILITY_CAPACITY
  limits: { perAction: 1 }, // add \`charges\` to make it consumable
  effects: [fx.effectCapture(target.captor())],
  text: { short: 'TODO one line.', rules: 'TODO full rules text.' },
  status: 'PLAYTEST',
});
`,
  item: `/** ${title} (PLAYTEST): describe the rule and cite the spec section. */
import { defineItem } from '@chain-theorem/rules/sdk';

export default defineItem({
  id: '${id}',
  name: '${title}',
  version: 1,
  slotCost: 1, // every item that is not a capacity item costs 1 slot (D-22)
  minLevel: 1,
  hooks: {},
  text: { short: 'TODO one line.', rules: 'TODO full rules text.' },
  status: 'PLAYTEST',
});
`,
  trait: `/**
 * ${title} (element trait): describe the rule and cite the spec section. Every element has exactly
 * one trait (6.1), so a new trait replaces its element's current module (delete that file).
 */
import { defineTrait } from '@chain-theorem/rules/sdk';

export default defineTrait({
  id: '${id}',
  name: '${title}',
  element: 'ember', // ember | tide | grove | storm | stone | frost
  version: 1,
  hooks: {},
  text: { short: 'TODO one line.', rules: 'TODO full rules text.' },
  status: 'PLAYTEST',
});
`,
};
const test = `import { describe, expect, it } from 'vitest';
import { scenario } from '../src/testing.ts';

describe('${id}', () => {
  it('R-ABIL-005 ${id} scenario: TODO describe', () => {
    const r = scenario({
      fen: '4k3/8/8/3p4/8/2N5/8/4K3 w - - 0 1',
      white: { abilities: [] },
      black: { abilities: [] },
      moves: ['c3d5'],
    });
    expect(r.kinds).toContain('Captured');
  });
});
`;
writeFileSync(file, templates[kind] as string);
writeFileSync(testFile, test);
console.log(
  `created ${file}\ncreated ${testFile}\nnext: fill in the data, write the test, pnpm content:index && pnpm check`,
);
