/**
 * `pnpm content:validate` (13.5): checks every module — unique id matching its file name, minLevel
 * within 1..LEVEL_CAP, slotCost within the caps, known tags, affinities and piece types, rules text
 * present, effects that match their tags with at most one bonus action (INV-01), and at least one
 * scenario test next to the module. Also checks the registry is current and the world content
 * (maps, warps, NPCs, lessons, quests, rewards, loadouts; 10.1-10.5) with `validateWorld`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ELEMENTS, PIECE_TYPES } from '@chain-theorem/rules';
import type { AbilityDef, EffectSpec } from '@chain-theorem/rules/sdk';
import { CAPS, abilities, items, traits } from '@chain-theorem/content';
import { validateWorld, world } from '@chain-theorem/content/world';
import { generate, moduleIds } from './index-gen.ts';

const ROOT = new URL('../../../../', import.meta.url).pathname;
const CONTENT = join(ROOT, 'packages/content');
const STATUSES = ['COMMITTED', 'PROVISIONAL', 'PLAYTEST'];
const TAGS = ['replay', 'revive'];
const CATEGORIES = ['CAPTURING', 'CAPTURES', 'CAPTURED', 'PASSIVE'];
const AFFINITIES = [...ELEMENTS, 'neutral'];

/** Every effect op in a list, including those nested in fx.when and fx.atChainEnd. */
function ops(list: readonly EffectSpec[]): EffectSpec['op'][] {
  return list.flatMap((e) =>
    e.op === 'when'
      ? [e.op, ...ops(e.then)]
      : e.op === 'atChainEnd'
        ? [e.op, ...ops(e.effects)]
        : [e.op],
  );
}

/**
 * Effect rules the type system cannot express: at most one bonus action per activation (INV-01) and
 * tags that match the effects, since Warden's Stopwatch and the revive rules read the tags (5.6).
 */
export function effectProblems(a: AbilityDef): string[] {
  const out: string[] = [];
  const base = ops(a.effects);
  const attuned = a.attuned
    ? ops(a.attuned.mode === 'append' ? [...a.effects, ...a.attuned.effects] : a.attuned.effects)
    : [];
  const count = (list: string[], op: string) => list.filter((o) => o === op).length;
  if (count(base, 'bonusAction') > 1 || count(attuned, 'bonusAction') > 1)
    out.push('at most one bonusAction per activation (INV-01)');
  const all = [...base, ...attuned];
  const bonus = all.includes('bonusAction');
  const revive = all.includes('revive');
  if (bonus !== a.tags.includes('replay'))
    out.push(bonus ? "a bonusAction needs the 'replay' tag" : "'replay' tag without a bonusAction");
  if (revive !== a.tags.includes('revive'))
    out.push(
      revive ? "a revive effect needs the 'revive' tag" : "'revive' tag without a revive effect",
    );
  return out;
}

export function validateContent(): string[] {
  const errors: string[] = [];
  const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`);
  const seen = new Set<string>();
  const unique = (kind: string, id: string) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) err(key, 'duplicate id');
    seen.add(key);
  };
  const text = (where: string, t: { short?: string; rules?: string } | undefined) => {
    if (!t?.short?.trim()) err(where, 'text.short is missing');
    if (!t?.rules?.trim()) err(where, 'text.rules is missing');
  };
  const hasTest = (dir: string, id: string) => {
    const f = join(CONTENT, dir, `${id}.test.ts`);
    if (!existsSync(f)) return false;
    return /\b(it|test)\(/.test(readFileSync(f, 'utf8'));
  };

  const files = {
    abilities: moduleIds('abilities'),
    items: moduleIds('items'),
    traits: moduleIds('traits'),
  };
  for (const a of abilities) {
    const w = `ability ${a.id}`;
    unique('ability', a.id);
    if (!files.abilities.includes(a.id)) err(w, 'id does not match a file name in abilities/');
    if (!/^[a-z][a-z0-9_]*$/.test(a.id)) err(w, 'id must be snake_case');
    if (!Number.isInteger(a.version) || a.version < 1) err(w, 'version must be a positive integer');
    if (!CATEGORIES.includes(a.category)) err(w, `unknown category ${a.category}`);
    if (!AFFINITIES.includes(a.affinity)) err(w, `unknown affinity ${a.affinity}`);
    if (
      a.eligible !== 'all' &&
      (a.eligible.length === 0 || a.eligible.some((t) => !PIECE_TYPES.includes(t)))
    ) {
      err(w, 'eligible must be "all" or a non-empty list of piece types');
    }
    for (const t of a.tags) if (!TAGS.includes(t)) err(w, `unknown tag ${t}`);
    if (!Number.isInteger(a.minLevel) || a.minLevel < 1 || a.minLevel > CAPS.LEVEL_CAP)
      err(w, `minLevel must be 1..${CAPS.LEVEL_CAP}`);
    if (!Number.isInteger(a.slotCost) || a.slotCost < 1 || a.slotCost > CAPS.MAX_ABILITY_CAPACITY) {
      err(w, `slotCost must be 1..${CAPS.MAX_ABILITY_CAPACITY}`);
    }
    if (a.limits.perAction !== 1) err(w, 'limits.perAction must be 1 (5.4)');
    if (
      a.limits.charges !== undefined &&
      (!Number.isInteger(a.limits.charges) || a.limits.charges < 1)
    ) {
      err(w, 'charges must be a positive integer');
    }
    if (a.category === 'PASSIVE' && !a.hooks) err(w, 'PASSIVE abilities act through hooks');
    if (a.category !== 'PASSIVE' && a.effects.length === 0)
      err(w, 'triggered abilities need at least one effect');
    if (a.affinity === 'neutral' && a.attuned)
      err(w, 'neutral abilities have no attuned version (6.3)');
    if (!STATUSES.includes(a.status)) err(w, `unknown status ${a.status}`);
    for (const problem of effectProblems(a)) err(w, problem);
    text(w, a.text);
    if (!hasTest('abilities', a.id)) err(w, 'needs a scenario test abilities/<id>.test.ts');
  }
  for (const i of items) {
    const w = `item ${i.id}`;
    unique('item', i.id);
    if (!files.items.includes(i.id)) err(w, 'id does not match a file name in items/');
    if (!/^[a-z][a-z0-9_]*$/.test(i.id)) err(w, 'id must be snake_case');
    if (![1, 2, 3, 4].includes(i.slotCost) || i.slotCost > CAPS.MAX_ITEM_SLOTS)
      err(w, 'slotCost must be 1..4');
    if (!Number.isInteger(i.minLevel) || i.minLevel < 1 || i.minLevel > CAPS.LEVEL_CAP)
      err(w, `minLevel must be 1..${CAPS.LEVEL_CAP}`);
    if (i.capacity !== undefined) {
      if (i.capacity > CAPS.MAX_ABILITY_CAPACITY) err(w, 'capacity above MAX_ABILITY_CAPACITY');
      if (i.slotCost !== i.capacity - 1) err(w, 'capacity N costs N - 1 slots (7.2)');
      if (i.exclusiveGroup !== 'capacity')
        err(w, "capacity items belong to exclusiveGroup 'capacity' (D-22)");
    } else if (i.slotCost !== 1) {
      err(w, 'every item that is not a capacity item costs 1 slot (D-22)');
    }
    if (!STATUSES.includes(i.status)) err(w, `unknown status ${i.status}`);
    text(w, i.text);
    if (!hasTest('items', i.id)) err(w, 'needs a scenario test items/<id>.test.ts');
  }
  for (const t of traits) {
    const w = `trait ${t.id}`;
    unique('trait', t.id);
    if (!files.traits.includes(t.id)) err(w, 'id does not match a file name in traits/');
    if (!ELEMENTS.includes(t.element as (typeof ELEMENTS)[number]))
      err(w, `unknown element ${t.element}`);
    if (!STATUSES.includes(t.status)) err(w, `unknown status ${t.status}`);
    text(w, t.text);
    if (!hasTest('traits', t.id)) err(w, 'needs a scenario test traits/<id>.test.ts');
  }
  for (const el of ELEMENTS) {
    if (traits.filter((t) => t.element === el).length !== 1)
      err(`element ${el}`, 'needs exactly one trait module (6.1)');
  }
  const registryFile = join(CONTENT, 'registry.generated.ts');
  if (!existsSync(registryFile) || readFileSync(registryFile, 'utf8') !== generate()) {
    err('registry.generated.ts', 'stale: run pnpm content:index');
  }
  for (const problem of validateWorld(world)) errors.push(`world ${problem}`);
  return errors;
}

if (process.argv[1]?.endsWith('validate.ts')) {
  const errors = validateContent();
  if (errors.length > 0) {
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error(`content:validate failed: ${errors.length} problem(s)`);
    process.exit(1);
  }
  console.log(
    `content:validate ok: ${abilities.length} abilities, ${items.length} items, ${traits.length} traits; ` +
      `world: ${world.zones.length} zones, ${world.npcs.length} NPCs, ${world.lessons.length} lessons, ` +
      `${world.quests.length} quests, ${world.keyItems.length} key items`,
  );
}
