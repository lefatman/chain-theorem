/**
 * Client-side design requirements (spec 1, R-ART-003): original names everywhere a player reads them,
 * and a browser-first client. The server-side ones are in apps/server/src/requirements.unit.test.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abilities, items, traits } from '@chain-theorem/content';
import { world } from '@chain-theorem/content/world';
import { creatures } from './battle/scene/creatures.ts';

const root = new URL('../../..', import.meta.url).pathname;
const json = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8')) as T;

describe('core scope (spec 1)', () => {
  it('R-CORE-005 no Pokémon names anywhere in the content, the world or the creature roster', () => {
    const deny = [
      'pokemon',
      'pokémon',
      'pikachu',
      'charmander',
      'squirtle',
      'bulbasaur',
      'eevee',
      'snorlax',
      'mewtwo',
      'jigglypuff',
      'gengar',
      'lucario',
      'pokeball',
      'pokedex',
      'pallet',
      'kanto',
      'johto',
      'hoenn',
      'sinnoh',
      'unova',
      'kalos',
      'alola',
      'galar',
      'paldea',
    ];
    const names = [
      ...[...abilities, ...items, ...traits].map((m) => m.name),
      ...world.zones.map((z) => z.name),
      ...world.npcs.map((n) => n.name),
      ...world.zones.flatMap((z) => z.encounters.map((e) => e.name)),
      ...world.quests.map((q) => q.name),
      ...world.keyItems.map((k) => k.name),
      ...creatures.map((c) => c.name),
    ];
    expect(names.length).toBeGreaterThan(50);
    for (const name of names) {
      const n = name.toLowerCase();
      for (const d of deny) expect(n.includes(d), `${name} contains "${d}"`).toBe(false);
    }
  });

  it('R-CORE-006 browser first: a responsive web client and no native or desktop wrapper', () => {
    const html = readFileSync(join(root, 'apps/client/index.html'), 'utf8');
    expect(html).toMatch(/<meta name="viewport" content="width=device-width/);
    const pkgs = [
      'package.json',
      ...readdirSync(join(root, 'apps')).map((a) => `apps/${a}/package.json`),
    ];
    for (const p of pkgs) {
      const pkg = json<{
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }>(p);
      const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      for (const native of [
        'electron',
        'react-native',
        '@capacitor/core',
        'cordova',
        '@tauri-apps/api',
      ])
        expect(deps, `${p} depends on ${native}`).not.toContain(native);
    }
  });
});
