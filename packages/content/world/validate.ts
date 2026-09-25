/**
 * World content validation (10.1-10.5; run by `pnpm content:validate` and the world tests). Returns
 * one message per problem, `where: what`, empty when the world is sound:
 *
 * - R-WORLD-001 every map parses with parseZone; warps land on walkable tiles of existing zones and
 *   have a matching way back; NPC objects reference existing NPCs (each placed exactly once).
 * - R-WORLD-002 every zone is reachable from the start zone and every warp, NPC, sign, named area
 *   and challenge zone is reachable without stepping on wild grass (paths avoid wild patches); zones
 *   with grass have an encounter table and a rate, towns and interiors have neither.
 * - R-WORLD-003 lesson puzzles check out with the engine: each accepted move is legal and reaches the
 *   topic's goal (capture / check / checkmate), and every move that does is accepted; battle lessons
 *   teach exactly one ability, or pit an element against one it beats or loses to.
 * - R-WORLD-005 quests, lessons and NPC roles reference existing ids; rewards reference real items,
 *   ability cards and key items.
 * - R-LOAD-004 every fixed loadout (trainers, lessons) is legal at its level; seeded builds build.
 * - Protocol limits (packages/protocol zone.ts): names 40, lines 400, dialog lines 20, FEN 100.
 */
import { beats, moveToUci, type ElementId, type Loadout } from '@chain-theorem/rules';
import { CAPS, abilityById, engine, itemById } from '../index.ts';
import { npcBuild } from '../src/npcs.ts';
import { inRect, parseZone, stepFrom, walkable } from './geometry.ts';
import type { LessonDef, NpcTier, Puzzle, Reward, WorldRegistry, ZoneGeometry } from './types.ts';

const LIMIT = { name: 40, title: 80, line: 400, lines: 20, fen: 100, puzzles: 64, tile: 4096 };
const ID = /^[a-z][a-z0-9_]*$/;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;
const TIERS: readonly NpcTier[] = ['wild', 'trainer', 'elite'];
const DIRS4 = ['n', 's', 'e', 'w'] as const;
const SANDBOX: Loadout = { elements: ['neutral'], items: [], sets: [[]] };

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const textOk = (s: unknown, max: number) =>
  typeof s === 'string' && s.trim().length > 0 && s.length <= max;

/** Moves that reach a puzzle topic's goal, and all legal moves, in the puzzle position. */
export function puzzleMoves(
  fen: string,
  topic: 'movement' | 'check' | 'checkmate',
): { legal: Set<string>; goal: Set<string> } {
  const { state } = engine.newBattle({
    format: 'full',
    white: { level: 1, loadout: SANDBOX },
    black: { level: 1, loadout: SANDBOX },
    fen,
  });
  const side = state.turn;
  const legal = new Set<string>();
  const goal = new Set<string>();
  for (const move of engine.legalMoves(state, side)) {
    const uci = moveToUci(move);
    legal.add(uci);
    const r = engine.applyAction(state, { kind: 'move', side, move });
    const reached =
      topic === 'movement'
        ? r.events.some((e) => e.k === 'MoveMade' && e.capture)
        : topic === 'check'
          ? r.state.inCheck !== null && r.state.inCheck !== side
          : r.state.result?.reason === 'checkmate' && r.state.result.winner === side;
    if (reached) goal.add(uci);
  }
  return { legal, goal };
}

function loadoutProblems(loadout: Loadout, level: number): string[] {
  if (!isInt(level) || level < 1 || level > CAPS.LEVEL_CAP) return [`level ${level} out of range`];
  return engine
    .validateLoadout(loadout, { level })
    .errors.map((e) => `R-LOAD-004 rule ${e.rule} (${e.code}): ${e.message}`);
}

function rewardProblems(r: Reward, keyItems: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (!isInt(r.xp) || r.xp < 0) out.push('reward xp must be a whole number >= 0');
  if (r.coins !== undefined && (!isInt(r.coins) || r.coins < 0))
    out.push('reward coins must be a whole number >= 0');
  for (const it of r.items ?? []) {
    const def = itemById.get(it.id);
    if (!def) out.push(`reward item ${it.id} does not exist`);
    else if (def.retired) out.push(`reward item ${it.id} is retired`);
    if (!isInt(it.qty) || it.qty < 1) out.push(`reward item ${it.id} needs qty >= 1`);
  }
  for (const c of r.cards ?? []) {
    const def = abilityById.get(c.id);
    if (!def) out.push(`reward card ${c.id} is not an ability`);
    else if (def.retired) out.push(`reward card ${c.id} is retired`);
    if (!isInt(c.qty) || c.qty < 1) out.push(`reward card ${c.id} needs qty >= 1`);
  }
  for (const k of r.keyItems ?? [])
    if (!keyItems.has(k)) out.push(`reward key item ${k} does not exist`);
  return out;
}

function puzzleProblems(topic: 'movement' | 'check' | 'checkmate', p: Puzzle): string[] {
  const out: string[] = [];
  if (!textOk(p.fen, LIMIT.fen)) out.push(`FEN must be 1..${LIMIT.fen} characters`);
  if (!textOk(p.prompt, LIMIT.line)) out.push(`prompt must be 1..${LIMIT.line} characters`);
  if (!textOk(p.hint, LIMIT.line)) out.push(`hint must be 1..${LIMIT.line} characters`);
  if (p.accept.length === 0) out.push('accepts no move');
  if (new Set(p.accept).size !== p.accept.length) out.push('duplicate accepted moves');
  for (const m of p.accept) if (!UCI.test(m)) out.push(`accepted move ${m} is not UCI`);
  let moves: { legal: Set<string>; goal: Set<string> };
  try {
    moves = puzzleMoves(p.fen, topic);
  } catch (e) {
    out.push(`bad position: ${(e as Error).message}`);
    return out;
  }
  const goalName = { movement: 'capture', check: 'give check', checkmate: 'deliver checkmate' }[
    topic
  ];
  for (const m of p.accept) {
    if (!moves.legal.has(m)) out.push(`accepted move ${m} is illegal`);
    else if (!moves.goal.has(m)) out.push(`accepted move ${m} does not ${goalName}`);
  }
  const missing = [...moves.goal].filter((m) => !p.accept.includes(m));
  if (missing.length > 0)
    out.push(`moves that also ${goalName} are not accepted: ${missing.join(' ')}`);
  if (moves.goal.size === 0) out.push(`no legal move can ${goalName}`);
  return out;
}

function lessonProblems(l: LessonDef, keyItems: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (!textOk(l.title, LIMIT.title)) out.push(`title must be 1..${LIMIT.title} characters`);
  if (l.intro.length < 1 || l.intro.length > LIMIT.lines)
    out.push(`intro needs 1..${LIMIT.lines} lines`);
  for (const line of l.intro)
    if (!textOk(line, LIMIT.line)) out.push('an intro line is empty or too long');
  out.push(...rewardProblems(l.reward, keyItems));
  if (l.kind === 'puzzles') {
    if (l.skippable !== true) out.push('chess lessons are skippable (10.3)');
    if (l.puzzles.length < 1 || l.puzzles.length > LIMIT.puzzles)
      out.push(`needs 1..${LIMIT.puzzles} puzzles`);
    l.puzzles.forEach((p, i) => {
      for (const m of puzzleProblems(l.topic, p)) out.push(`puzzle ${i}: ${m}`);
    });
    return out;
  }
  if (l.skippable !== false) out.push('ability and element lessons are never skippable (10.3)');
  if (!(l.format in CAPS.FORMATS)) out.push(`unknown format ${l.format}`);
  if (l.fen !== undefined) {
    try {
      engine.newBattle({
        format: l.format,
        white: { level: 1, loadout: SANDBOX },
        black: { level: 1, loadout: SANDBOX },
        fen: l.fen,
      });
    } catch (e) {
      out.push(`bad FEN: ${(e as Error).message}`);
    }
  }
  for (const m of loadoutProblems(l.player.loadout, l.player.level))
    out.push(`player loadout: ${m}`);
  for (const m of loadoutProblems(l.npc.loadout, l.npc.level)) out.push(`npc loadout: ${m}`);
  if (!textOk(l.npc.name, LIMIT.name)) out.push(`npc name must be 1..${LIMIT.name} characters`);
  if (!TIERS.includes(l.npc.tier)) out.push(`unknown npc tier ${l.npc.tier}`);
  const taught = new Set(l.player.loadout.sets.flat());
  if (l.topic === 'ability' && taught.size !== 1)
    out.push(`an ability lesson teaches exactly one ability (the player carries ${taught.size})`);
  if (l.topic === 'element') {
    const [p, n] = [l.player.loadout.elements, l.npc.loadout.elements];
    const a = p[0] as ElementId;
    const b = n[0] as ElementId;
    if (p.length !== 1 || n.length !== 1 || !(beats(a, b) || beats(b, a)))
      out.push('an element lesson pits one element against one it beats or loses to');
  }
  return out;
}

interface Point {
  zone: string;
  x: number;
  y: number;
}

/** Tiles next to (x, y) a player could stand on to talk to an NPC or read a sign there. */
function around(x: number, y: number): { x: number; y: number }[] {
  return DIRS4.map((d) => stepFrom(x, y, d));
}

export function validateWorld(w: WorldRegistry): string[] {
  const errors: string[] = [];
  const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`);

  const unique = (kind: string, list: readonly { id: string }[]) => {
    const seen = new Set<string>();
    for (const { id } of list) {
      if (!ID.test(id)) err(`${kind} ${id}`, 'id must be snake_case');
      if (seen.has(id)) err(`${kind} ${id}`, 'duplicate id');
      seen.add(id);
    }
    return seen;
  };
  const zoneIds = unique('zone', w.zones);
  const npcIds = unique('npc', w.npcs);
  const lessonIds = unique('lesson', w.lessons);
  const questIds = unique('quest', w.quests);
  const keyItemIds = unique('key item', w.keyItems);
  const npcById = new Map(w.npcs.map((n) => [n.id, n]));
  if (!zoneIds.has(w.start.zone)) err('start', `zone ${w.start.zone} does not exist`);

  // ---- Zones and maps (R-WORLD-001, R-WORLD-002) ----------------------------------------------
  const geo = new Map<string, ZoneGeometry>();
  for (const z of w.zones) {
    const where = `zone ${z.id}`;
    if (!textOk(z.name, LIMIT.name)) err(where, `name must be 1..${LIMIT.name} characters`);
    if (!['town', 'route', 'wild', 'interior'].includes(z.kind))
      err(where, `unknown kind ${z.kind}`);
    if (!(z.format in CAPS.FORMATS)) err(where, `unknown format ${z.format}`);
    if (!(z.encounterRate >= 0 && z.encounterRate <= 1)) err(where, 'encounterRate must be 0..1');
    if (!isInt(z.encounterGrace) || z.encounterGrace < 0) err(where, 'encounterGrace must be >= 0');
    const zoneProp = z.map.properties?.find((p) => p.name === 'zone')?.value;
    if (zoneProp !== z.id) err(where, `map property "zone" is ${String(zoneProp)}, not ${z.id}`);
    let g: ZoneGeometry;
    try {
      g = parseZone(z.map);
    } catch (e) {
      err(where, `map does not parse: ${(e as Error).message}`);
      continue;
    }
    if (g.width > LIMIT.tile || g.height > LIMIT.tile)
      err(where, 'map wider than the protocol allows');
    geo.set(z.id, g);
    const wildTiles = g.wild.reduce((n, v) => n + v, 0);
    if (wildTiles > 0 && (z.encounterRate <= 0 || z.encounters.length === 0))
      err(where, 'has wild grass but no encounter rate or table (10.2)');
    if (wildTiles === 0 && (z.encounterRate > 0 || z.encounters.length > 0))
      err(where, 'has an encounter table but no wild grass');
    if ((z.kind === 'town' || z.kind === 'interior') && wildTiles > 0)
      err(where, 'towns and interiors have no wild grass');
    for (const [i, e] of z.encounters.entries()) {
      const at = `${where} encounter ${i}`;
      if (!isInt(e.weight) || e.weight < 1) err(at, 'weight must be a whole number >= 1');
      const [lo, hi] = e.levels;
      if (!isInt(lo) || !isInt(hi) || lo < 1 || hi > CAPS.LEVEL_CAP || lo > hi)
        err(at, `levels must be 1..${CAPS.LEVEL_CAP}, low to high`);
      if (
        e.element !== undefined &&
        !(CAPS.ENABLED_ELEMENTS as readonly string[]).includes(e.element)
      )
        err(at, `element ${e.element} is not enabled`);
      if (!textOk(e.name, LIMIT.name)) err(at, `name must be 1..${LIMIT.name} characters`);
    }
    const names = new Set<string>();
    for (const a of g.areas) {
      if (names.has(a.name)) err(where, `duplicate area name ${a.name}`);
      names.add(a.name);
      if (a.x + a.w > g.width || a.y + a.h > g.height) err(where, `area ${a.name} leaves the map`);
    }
    for (const c of g.challenge) {
      if (c.x + c.w > g.width || c.y + c.h > g.height) err(where, 'challenge zone leaves the map');
      for (let y = c.y; y < c.y + c.h; y++)
        for (let x = c.x; x < c.x + c.w; x++) {
          if (g.wild[y * g.width + x]) err(where, `challenge zone has wild grass at ${x},${y}`);
          if (g.warps.some((wp) => wp.x === x && wp.y === y))
            err(where, `challenge zone covers a warp at ${x},${y}`);
        }
    }
    for (const s of g.signs)
      if (s.text.length > LIMIT.line) err(where, `sign at ${s.x},${s.y} is too long`);
    for (const n of g.npcs)
      if (!npcIds.has(n.id)) err(where, `NPC object ${n.id} is not a known NPC`);
  }

  // Each NPC stands in exactly one place.
  const placements = new Map<string, number>();
  for (const g of geo.values())
    for (const n of g.npcs) placements.set(n.id, (placements.get(n.id) ?? 0) + 1);
  for (const n of w.npcs) {
    const count = placements.get(n.id) ?? 0;
    if (count !== 1) err(`npc ${n.id}`, `placed ${count} times on the maps (needs exactly 1)`);
  }

  // Warps: land on a walkable, non-warp, non-grass tile of an existing zone, with a way back.
  for (const [zone, g] of geo) {
    for (const wp of g.warps) {
      const where = `zone ${zone} warp at ${wp.x},${wp.y}`;
      if (!walkable(g, wp.x, wp.y)) err(where, 'the warp tile itself is blocked');
      const tg = geo.get(wp.to);
      if (!tg) {
        err(where, `leads to unknown zone ${wp.to}`);
        continue;
      }
      if (!walkable(tg, wp.toX, wp.toY)) {
        err(where, `lands on a blocked tile ${wp.to} ${wp.toX},${wp.toY}`);
        continue;
      }
      if (tg.warps.some((b) => b.x === wp.toX && b.y === wp.toY))
        err(where, 'lands on another warp');
      if (tg.wild[wp.toY * tg.width + wp.toX]) err(where, 'lands in wild grass');
      const back = tg.warps.some(
        (b) =>
          b.to === zone &&
          Math.abs(b.x - wp.toX) + Math.abs(b.y - wp.toY) <= 1 &&
          Math.abs(b.toX - wp.x) + Math.abs(b.toY - wp.y) <= 1,
      );
      if (!back) err(where, `has no way back from ${wp.to} ${wp.toX},${wp.toY}`);
    }
  }

  // Reachability from the start zone's spawn without stepping on wild grass (10.2: paths avoid
  // wild patches). Stepping onto a warp tile moves the player to its landing tile.
  const seen = new Map<string, Uint8Array>();
  for (const [zone, g] of geo) seen.set(zone, new Uint8Array(g.width * g.height));
  const queue: Point[] = [];
  const visit = (p: Point) => {
    const g = geo.get(p.zone);
    const s = seen.get(p.zone);
    if (!g || !s || !walkable(g, p.x, p.y) || g.wild[p.y * g.width + p.x]) return;
    const i = p.y * g.width + p.x;
    if (s[i]) return;
    s[i] = 1;
    queue.push(p);
  };
  const startGeo = geo.get(w.start.zone);
  if (startGeo) visit({ zone: w.start.zone, x: startGeo.spawn.x, y: startGeo.spawn.y });
  while (queue.length > 0) {
    const p = queue.shift() as Point;
    const g = geo.get(p.zone) as ZoneGeometry;
    const warp = g.warps.find((wp) => wp.x === p.x && wp.y === p.y);
    if (warp) {
      visit({ zone: warp.to, x: warp.toX, y: warp.toY });
      continue;
    }
    for (const d of DIRS4) visit({ zone: p.zone, ...stepFrom(p.x, p.y, d) });
  }
  const reached = (zone: string, x: number, y: number) => {
    const g = geo.get(zone);
    return (
      !!g &&
      x >= 0 &&
      y >= 0 &&
      x < g.width &&
      y < g.height &&
      seen.get(zone)?.[y * g.width + x] === 1
    );
  };
  for (const [zone, g] of geo) {
    const where = `zone ${zone}`;
    if (!(seen.get(zone) ?? []).some((v) => v === 1)) {
      err(where, `is not reachable from ${w.start.zone} without crossing wild grass`);
      continue;
    }
    if (!reached(zone, g.spawn.x, g.spawn.y)) err(where, 'spawn is cut off from the paths');
    for (const wp of g.warps)
      if (!reached(zone, wp.x, wp.y))
        err(where, `warp at ${wp.x},${wp.y} needs a path that avoids wild grass`);
    for (const n of g.npcs)
      if (!around(n.x, n.y).some((t) => reached(zone, t.x, t.y)))
        err(where, `NPC ${n.id} cannot be reached without crossing wild grass`);
    for (const s of g.signs)
      if (!around(s.x, s.y).some((t) => reached(zone, t.x, t.y)))
        err(where, `sign at ${s.x},${s.y} cannot be read from a path`);
    for (const a of g.areas) {
      let ok = false;
      for (let y = a.y; y < a.y + a.h && !ok; y++)
        for (let x = a.x; x < a.x + a.w && !ok; x++) ok = inRect(a, x, y) && reached(zone, x, y);
      if (!ok) err(where, `area ${a.name} cannot be reached without crossing wild grass`);
    }
    for (const c of g.challenge) {
      let ok = false;
      for (let y = c.y; y < c.y + c.h && !ok; y++)
        for (let x = c.x; x < c.x + c.w && !ok; x++) ok = reached(zone, x, y);
      if (!ok) err(where, 'challenge zone cannot be reached');
    }
    const wildTiles = g.wild.reduce((n, v) => n + v, 0);
    if (wildTiles > 0) {
      let entrance = false;
      for (let i = 0; i < g.wild.length && !entrance; i++) {
        if (!g.wild[i] || g.solid[i]) continue;
        const x = i % g.width;
        const y = Math.floor(i / g.width);
        entrance = around(x, y).some((t) => reached(zone, t.x, t.y));
      }
      if (!entrance) err(where, 'players can never step into its wild grass');
    }
  }

  // ---- NPCs (9.4, R-LOAD-004) -----------------------------------------------------------------
  for (const n of w.npcs) {
    const where = `npc ${n.id}`;
    if (!textOk(n.name, LIMIT.name)) err(where, `name must be 1..${LIMIT.name} characters`);
    if (n.lines.length < 1 || n.lines.length > LIMIT.lines)
      err(where, `needs 1..${LIMIT.lines} lines`);
    for (const line of n.lines)
      if (!textOk(line, LIMIT.line)) err(where, 'a line is empty or too long');
    if (!isInt(n.look.variant) || n.look.variant < 0 || n.look.variant > 15)
      err(where, 'look.variant must be 0..15');
    if (
      n.look.element !== 'neutral' &&
      !(CAPS.ENABLED_ELEMENTS as readonly string[]).includes(n.look.element)
    )
      err(where, `look.element ${n.look.element} is not enabled`);
    const role = n.role;
    if (role.kind === 'teacher') {
      if (role.lessons.length === 0) err(where, 'a teacher needs lessons');
      for (const l of role.lessons)
        if (!lessonIds.has(l)) err(where, `teaches unknown lesson ${l}`);
    } else if (role.kind === 'quest') {
      if (!questIds.has(role.quest)) err(where, `gives unknown quest ${role.quest}`);
    } else if (role.kind === 'trainer') {
      if (!TIERS.includes(role.tier)) err(where, `unknown tier ${role.tier}`);
      if (!(role.format in CAPS.FORMATS)) err(where, `unknown format ${role.format}`);
      for (const m of rewardProblems(role.reward, keyItemIds)) err(where, m);
      if ('buildSeed' in role.loadout) {
        if (!isInt(role.loadout.buildSeed)) err(where, 'buildSeed must be a whole number');
        else if (!isInt(role.level) || role.level < 1 || role.level > CAPS.LEVEL_CAP)
          err(where, `level ${role.level} out of range`);
        else {
          try {
            npcBuild(role.tier, role.level, role.loadout.buildSeed);
          } catch (e) {
            err(where, `seeded build fails: ${(e as Error).message}`);
          }
        }
      } else {
        for (const m of loadoutProblems(role.loadout, role.level)) err(where, m);
      }
    }
  }

  // ---- Lessons (10.3, R-WORLD-003) ------------------------------------------------------------
  const taughtBy = new Map<string, number>();
  for (const n of w.npcs)
    if (n.role.kind === 'teacher')
      for (const l of n.role.lessons) taughtBy.set(l, (taughtBy.get(l) ?? 0) + 1);
  for (const l of w.lessons) {
    for (const m of lessonProblems(l, keyItemIds)) err(`lesson ${l.id}`, m);
    if (!taughtBy.has(l.id)) err(`lesson ${l.id}`, 'no teacher offers it');
  }

  // ---- Quests (10.5, R-WORLD-005) -------------------------------------------------------------
  const givers = new Set(w.npcs.flatMap((n) => (n.role.kind === 'quest' ? [n.role.quest] : [])));
  for (const q of w.quests) {
    const where = `quest ${q.id}`;
    if (!textOk(q.name, LIMIT.title)) err(where, `name must be 1..${LIMIT.title} characters`);
    if (!givers.has(q.id)) err(where, 'no NPC gives it');
    for (const r of q.requires)
      if (!questIds.has(r) || r === q.id) err(where, `requires unknown quest ${r}`);
    if (q.steps.length === 0) err(where, 'has no steps');
    for (const m of rewardProblems(q.reward, keyItemIds)) err(where, m);
    q.steps.forEach((s, i) => {
      const at = `${where} step ${i}`;
      if (!textOk(s.text, LIMIT.line)) err(at, 'text is empty or too long');
      switch (s.kind) {
        case 'talk':
          if (!npcIds.has(s.npc)) err(at, `talks to unknown NPC ${s.npc}`);
          break;
        case 'defeat': {
          const n = npcById.get(s.npc);
          if (!n) err(at, `defeats unknown NPC ${s.npc}`);
          else if (n.role.kind !== 'trainer') err(at, `${s.npc} is not a trainer`);
          else if (!n.role.once)
            err(at, `${s.npc} is a practice trainer; story steps need a once trainer`);
          break;
        }
        case 'lesson':
          if (!lessonIds.has(s.lesson)) err(at, `unknown lesson ${s.lesson}`);
          break;
        case 'reach': {
          const g = geo.get(s.zone);
          if (!zoneIds.has(s.zone)) err(at, `unknown zone ${s.zone}`);
          else if (g && !g.areas.some((a) => a.name === s.area))
            err(at, `zone ${s.zone} has no area ${s.area}`);
          break;
        }
        case 'win': {
          const c = s.constraint;
          if (c.format !== undefined && !(c.format in CAPS.FORMATS))
            err(at, `unknown format ${c.format}`);
          if (c.tier !== undefined && !TIERS.includes(c.tier)) err(at, `unknown tier ${c.tier}`);
          const aff = c.onlyAffinity;
          if (aff !== undefined && !(CAPS.ENABLED_ELEMENTS as readonly string[]).includes(aff))
            err(at, `onlyAffinity ${aff} is not an enabled element`);
          break;
        }
      }
    });
  }
  // Quest prerequisites form no cycle.
  const questById = new Map(w.quests.map((q) => [q.id, q]));
  const state = new Map<string, 1 | 2>();
  const cyclic = (id: string): boolean => {
    if (state.get(id) === 2) return false;
    if (state.get(id) === 1) return true;
    state.set(id, 1);
    const hit = (questById.get(id)?.requires ?? []).some(cyclic);
    state.set(id, 2);
    return hit;
  };
  for (const q of w.quests) if (cyclic(q.id)) err(`quest ${q.id}`, 'prerequisites form a cycle');

  // ---- Key items (10.2) -----------------------------------------------------------------------
  const granted = new Set<string>();
  const grant = (r: Reward) => (r.keyItems ?? []).forEach((k) => granted.add(k));
  w.quests.forEach((q) => grant(q.reward));
  w.lessons.forEach((l) => grant(l.reward));
  w.npcs.forEach((n) => n.role.kind === 'trainer' && grant(n.role.reward));
  for (const k of w.keyItems) {
    const where = `key item ${k.id}`;
    if (!textOk(k.name, LIMIT.name)) err(where, `name must be 1..${LIMIT.name} characters`);
    if (!textOk(k.text, LIMIT.line)) err(where, `text must be 1..${LIMIT.line} characters`);
    if (k.encounterRate !== undefined && !(k.encounterRate > 0 && k.encounterRate <= 1))
      err(where, 'encounterRate multiplier must be in (0, 1]');
    if (!granted.has(k.id)) err(where, 'no quest, lesson or trainer grants it');
  }
  return errors;
}
