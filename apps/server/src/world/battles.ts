/**
 * Battles started from the overworld (M5 5.2, 5.3, 10.2–10.4): turns a zone core `battle` effect into
 * a BattleRoom init plus the battle's origin, which the BattleRoom keeps server-side for rewards and
 * quest progress when the battle ends (R-SEC-003). Pure: the caller supplies loadouts and the seed.
 */
import { npcBuild } from '@chain-theorem/content/npcs';
import { lessonById, npcById } from '@chain-theorem/content/world';
import type { ElementId, FormatId, Loadout } from '@chain-theorem/rules';
import type { BattleInit, SeatInit } from '../battle/index.ts';
import type { NpcTier } from '@chain-theorem/content/world';
import type { BattleRequest } from '../zone/index.ts';
import type { Bracket } from '../rating/ranked.ts';

/** Where a battle came from; stored next to the battle, never sent to a client. */
export type BattleOrigin =
  | {
      kind: 'wild';
      zone: string;
      /** The encounter entry's display name. */
      name: string;
      element: ElementId | null;
      level: number;
    }
  | { kind: 'trainer'; zone: string; npc: string; tier: NpcTier; level: number }
  | { kind: 'lesson'; zone: string; lesson: string }
  | { kind: 'challenge'; zone: string; auto: boolean }
  /** An NPC battle from the online screen (M4 `POST /api/battles`). */
  | { kind: 'npc'; tier: NpcTier }
  /** A challenge link or a queue pairing (M4). */
  | { kind: 'pvp' }
  /**
   * A ranked-queue pairing (M6 6.2, R-FMT-004): rated per format and bracket when it ends. Never
   * carries a wager (9.5) and never seats an NPC.
   */
  | { kind: 'ranked'; bracket: Bracket }
  /**
   * An item wager battle negotiated in a TradeSession (M6 6.1, 9.5 R-FMT-006): both stakes are in
   * escrow under `wagerId`; the end settles them once (`world/wager.ts`). PvP only, never ranked.
   */
  | { kind: 'wager'; wagerId: string };

/** A human seat's fighting loadout, already checked legal (R-LOAD-004). */
export interface Fighter {
  playerId: string;
  name: string;
  level: number;
  loadout: Loadout;
}

export interface ZoneBattle {
  init: BattleInit;
  origin: BattleOrigin;
}

/** Deterministic 32-bit seed of a battle id (FNV-1a): NPC builds and wild drops per battle. */
export function battleSeed(battleId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < battleId.length; i++) {
    h ^= battleId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The BattleRoom init for a zone battle. `fighters` holds every human player of the request;
 * `white` picks the colour of the first seat (true: first player plays White). Lesson battles always
 * seat the player as White so the lesson's start position reads as written.
 */
export function zoneBattle(
  battleId: string,
  zone: string,
  req: BattleRequest,
  fighters: ReadonlyMap<string, Fighter>,
  firstIsWhite: boolean,
): ZoneBattle {
  const fighter = (id: string): SeatInit => {
    const f = fighters.get(id);
    if (!f) throw new Error(`no loadout for ${id}`);
    return { playerId: f.playerId, name: f.name, level: f.level, loadout: f.loadout };
  };
  const seat = (
    a: SeatInit,
    b: SeatInit,
    fen?: string,
  ): Omit<BattleInit, 'battleId'> & {
    format: FormatId;
  } => ({
    format: req.format,
    white: firstIsWhite ? a : b,
    black: firstIsWhite ? b : a,
    ...(fen ? { fen } : {}),
  });
  switch (req.kind) {
    case 'wild': {
      const element = req.entry.element ?? null;
      const npc = npcBuild('wild', req.level, battleSeed(battleId), element ?? undefined);
      const them: SeatInit = {
        tier: 'wild',
        name: req.entry.name,
        level: npc.level,
        loadout: npc.loadout,
      };
      return {
        init: { battleId, ...seat(fighter(req.players[0]), them) },
        origin: { kind: 'wild', zone, name: req.entry.name, element, level: npc.level },
      };
    }
    case 'trainer': {
      const def = npcById.get(req.npc);
      if (def?.role.kind !== 'trainer') throw new Error(`${req.npc} is not a trainer`);
      const role = def.role;
      const loadout =
        'buildSeed' in role.loadout
          ? npcBuild(role.tier, role.level, role.loadout.buildSeed).loadout
          : role.loadout;
      const them: SeatInit = {
        tier: role.tier,
        name: def.name,
        npcId: def.id,
        level: role.level,
        loadout,
      };
      return {
        init: { battleId, ...seat(fighter(req.players[0]), them) },
        origin: { kind: 'trainer', zone, npc: def.id, tier: role.tier, level: role.level },
      };
    }
    case 'lesson': {
      const lesson = lessonById.get(req.lesson);
      if (lesson?.kind !== 'battle') throw new Error(`${req.lesson} is not a battle lesson`);
      const f = fighters.get(req.players[0]);
      if (!f) throw new Error(`no player for ${req.lesson}`);
      // The lesson's fixed loadouts at the lesson's level (10.3), not the player's own.
      const me: SeatInit = {
        playerId: f.playerId,
        name: f.name,
        level: lesson.player.level,
        loadout: lesson.player.loadout,
      };
      const them: SeatInit = {
        tier: lesson.npc.tier,
        name: lesson.npc.name,
        level: lesson.npc.level,
        loadout: lesson.npc.loadout,
      };
      return {
        init: {
          battleId,
          format: lesson.format,
          white: me,
          black: them,
          ...(lesson.fen ? { fen: lesson.fen } : {}),
        },
        origin: { kind: 'lesson', zone, lesson: lesson.id },
      };
    }
    case 'challenge':
      return {
        init: { battleId, ...seat(fighter(req.players[0]), fighter(req.players[1])) },
        origin: { kind: 'challenge', zone, auto: req.auto },
      };
  }
}
