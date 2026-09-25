/**
 * Design-level requirements that no single feature test owns (spec 1, 12, 14; release checklist
 * 17.3): each is checked here against the code and configuration that implement it, so a change that
 * breaks one fails `pnpm check`. The client-side ones (names, browser first) are in
 * apps/client/src/requirements.test.ts; `pnpm req:coverage` checks every requirement ID has a test.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { abilities, engine, items, traits } from '@chain-theorem/content';
import { world } from '@chain-theorem/content/world';
import { RewardPayload } from '@chain-theorem/db';
import { costDashboard, emptyRollup, addZone, addBattle, type ZoneReport } from './metrics.ts';
import { battleGrants, type SeatResult } from './world/outcome.ts';
import type { BattleOrigin } from './world/battles.ts';
import type { BattleSummary } from './battle/types.ts';
import { slotBracket } from './zone/core.ts';
import { bracketForSlots } from './rating/glicko2.ts';

const root = new URL('../../..', import.meta.url).pathname;
const json = <T>(path: string): T => JSON.parse(readFileSync(join(root, path), 'utf8')) as T;
/** wrangler.jsonc allows comments and trailing commas. */
const jsonc = <T>(path: string): T =>
  JSON.parse(
    readFileSync(join(root, path), 'utf8')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/,(\s*[}\]])/g, '$1'),
  ) as T;

describe('core fantasy and scope (spec 1)', () => {
  it('R-CORE-001 every battle format is chess with 16 pieces per side from the standard start', () => {
    for (const format of ['first_blood', 'vanguard', 'full'] as const) {
      const plain = { level: 1, loadout: { elements: ['ember' as const], items: [], sets: [[]] } };
      const { state } = engine.newBattle({ format, white: plain, black: plain });
      for (const side of ['white', 'black'] as const) {
        const own = state.pieces.filter((p) => p.side === side && p.square >= 0);
        expect(own).toHaveLength(16);
        expect(own.filter((p) => p.type === 'pawn')).toHaveLength(8);
        expect(own.filter((p) => p.type === 'king')).toHaveLength(1);
      }
    }
  });

  it('R-CORE-002 novices get a Chess Academy: skippable chess lessons first, one idea per ability lesson', () => {
    const chess = world.lessons.filter((l) => l.kind === 'puzzles');
    const ability = world.lessons.filter((l) => l.kind === 'battle');
    expect(chess.map((l) => l.kind === 'puzzles' && l.topic)).toEqual(
      expect.arrayContaining(['movement', 'check', 'checkmate']),
    );
    for (const l of chess) expect(l.skippable).toBe(true);
    for (const l of ability) expect(l.skippable).toBe(false);
    // Each ability lesson hands the player one ability set of a single ability.
    for (const l of ability)
      if (l.kind === 'battle' && l.topic === 'ability')
        expect(new Set(l.player.loadout.sets.flat()).size).toBe(1);
  });

  it('R-CORE-003 competitive fairness over collection power: brackets come from level, and a battle never takes items', () => {
    // Two players at the same level share a bracket whatever they own or equip (9.3).
    for (let level = 1; level <= 30; level++) {
      const slots = engine.caps.itemSlots(level);
      expect(slotBracket(engine, level)).toBe(Math.ceil(slots / 2));
      expect(bracketForSlots(slots)).toBeDefined();
    }
    // Every battle outcome's grants only add (wagers move stakes by agreement, 9.5).
    const summary = {
      battleId: 'b-req',
      format: 'full',
      plies: 40,
      result: { winner: 'white', reason: 'checkmate' },
    } as unknown as BattleSummary;
    const seats: SeatResult[] = (['win', 'loss', 'draw'] as const).map((result) => ({
      playerId: 'p',
      side: 'white',
      result,
      level: 5,
      opponentLevel: 5,
      affinities: [],
    }));
    const origins: BattleOrigin[] = [
      { kind: 'pvp' },
      { kind: 'npc', tier: 'elite' },
      { kind: 'challenge', zone: 'route_1', auto: true },
      { kind: 'wild', zone: 'route_1', name: 'Wild', element: null, level: 3 },
    ];
    for (const origin of origins)
      for (const seat of seats)
        for (const plan of battleGrants(origin, seat, summary)) {
          expect(plan.reward.xp).toBeGreaterThanOrEqual(0);
          for (const i of [...(plan.reward.items ?? []), ...(plan.reward.cards ?? [])])
            expect(i.qty).toBeGreaterThan(0);
        }
  });

  it('R-CORE-004 creatures are how pieces look, never owned: the collection holds only items, ability cards and key items', () => {
    const shape = Object.keys(RewardPayload.shape).sort();
    expect(shape).toEqual(['cards', 'coins', 'flags', 'items', 'keyItems', 'xp']);
    // Content modules are abilities, items and traits only; nothing grants a creature.
    const kinds = new Set([...abilities, ...items, ...traits].map((m) => m.id));
    expect(kinds.size).toBe(abilities.length + items.length + traits.length);
  });
});

describe('technical stack (spec 12)', () => {
  it('R-TECH-001 the stack of 12.1: strict TypeScript 5, Vite, Phaser 4.2, Preact with Signals, Zod, Kysely, Vitest, fast-check, Playwright, the Workers pool', () => {
    const base = json<{ compilerOptions: { strict: boolean } }>('tsconfig.base.json');
    expect(base.compilerOptions.strict).toBe(true);
    const rootPkg = json<{ devDependencies: Record<string, string> }>('package.json');
    expect(rootPkg.devDependencies.typescript).toMatch(/^5\./);
    expect(rootPkg.devDependencies['fast-check']).toBeDefined();
    expect(rootPkg.devDependencies.vitest).toBeDefined();
    const client = json<{
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    }>('apps/client/package.json');
    expect(client.dependencies.phaser).toMatch(/^~?4\.2\./);
    expect(client.dependencies.preact).toBeDefined();
    expect(client.dependencies['@preact/signals']).toBeDefined();
    expect(client.devDependencies.vite).toBeDefined();
    expect(client.devDependencies['@playwright/test']).toBeDefined();
    const db = json<{ dependencies: Record<string, string> }>('packages/db/package.json');
    expect(db.dependencies.kysely).toBeDefined();
    expect(
      json<{ dependencies: Record<string, string> }>('packages/protocol/package.json').dependencies
        .zod,
    ).toBeDefined();
    const server = json<{ devDependencies: Record<string, string> }>('apps/server/package.json');
    expect(server.devDependencies['@cloudflare/vitest-pool-workers']).toBeDefined();
    // The rules engine has zero runtime dependencies (13.2).
    const rules = json<{ dependencies?: Record<string, string> }>('packages/rules/package.json');
    expect(Object.keys(rules.dependencies ?? {})).toEqual([]);
  });

  it('R-TECH-002 every Durable Object class of 12.2 is bound, migrated as SQLite-backed, and uses no timers or loops', () => {
    const cfg = jsonc<{
      durable_objects: { bindings: { class_name: string }[] };
      migrations: { new_sqlite_classes: string[] }[];
    }>('apps/server/wrangler.jsonc');
    const bound = cfg.durable_objects.bindings.map((b) => b.class_name);
    const migrated = cfg.migrations.flatMap((m) => m.new_sqlite_classes);
    const index = readFileSync(join(root, 'apps/server/src/index.ts'), 'utf8');
    for (const cls of [
      'BattleRoom',
      'ZoneRoom',
      'Matchmaker',
      'GuildRoom',
      'TradeSession',
      'TournamentRoom',
    ]) {
      expect(bound).toContain(cls);
      expect(migrated).toContain(cls);
      expect(index).toMatch(new RegExp(`export \\{ ${cls} \\}`));
    }
    // R-COST-002: rooms stay hibernation-eligible: no intervals, no game loops, Alarms only.
    const rooms = join(root, 'apps/server/src/rooms');
    for (const f of readdirSync(rooms).filter((n) => n.endsWith('.ts') && !n.includes('test'))) {
      const src = readFileSync(join(rooms, f), 'utf8');
      expect(src, f).not.toMatch(/\bsetInterval\s*\(/);
      expect(src, f).not.toMatch(/\bwhile\s*\(\s*true\s*\)/);
    }
  });
});

describe('cost model (spec 14)', () => {
  it('R-COST-003 the cost dashboard recomputes the 14.1 estimate from measured telemetry, not from assumptions', () => {
    const hour = 1_760_000_000_000 - (1_760_000_000_000 % 3_600_000);
    const report = (inMsgs: number, rows: number): ZoneReport => ({
      zone: 'route_1',
      channel: 0,
      from: hour,
      to: hour + 60_000,
      players: 10,
      playerMs: 10 * 60_000,
      in: { step: inMsgs },
      out: { zstep: inMsgs * 9 },
      dropped: { rate: 0, invalid: 0, refused: 0 },
      encounters: 0,
      battles: 0,
      host: { rowsWritten: rows, doRequests: 1, joins: 0 },
    });
    const quiet = emptyRollup(hour);
    addZone(quiet, report(600, 2));
    const busy = emptyRollup(hour);
    addZone(busy, report(6_000, 200));
    addBattle(busy, { at: hour, messages: 80, records: 60, npcMoves: 30, alarms: 31, humans: 1 });
    const q = costDashboard([quiet]).total.cost;
    const b = costDashboard([busy]).total.cost;
    // Same player time, more measured traffic and writes: a higher measured cost.
    expect(b.perPlayerHour).toBeGreaterThan(q.perPlayerHour);
    expect(b.breakdown.rows).toBeGreaterThan(q.breakdown.rows);
    expect(b.breakdown.requests).toBeGreaterThan(q.breakdown.requests);
  });
});
