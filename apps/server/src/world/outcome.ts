/**
 * What a finished battle means for each human player (M5 5.2, 7.5, 10.5): the result from their side,
 * the element affinities of the abilities they used (quest win constraints), and the reward to grant.
 * Pure and deterministic: wild drops are seeded from the battle id, so the same battle always yields
 * the same reward and a repeated grant is a no-op (R-SEC-003).
 */
import { abilities } from '@chain-theorem/content';
import { battleXp, npcById, wildReward, type Reward } from '@chain-theorem/content/world';
import type { ElementId, Side } from '@chain-theorem/rules';
import type { BattleArchive, BattleSummary, SeatInit } from '../battle/index.ts';
import type { BattleOutcome } from '../zone/index.ts';
import { battleSeed, type BattleOrigin } from './battles.ts';

/** DD-76: a battle shorter than this many plies (an instant resign or abandon) pays no reward. */
export const MIN_REWARD_PLIES = 2;

const AFFINITY: ReadonlyMap<string, string> = new Map(abilities.map((a) => [a.id, a.affinity]));

export interface SeatResult {
  playerId: string;
  side: Side;
  result: 'win' | 'loss' | 'draw';
  level: number;
  opponentLevel: number;
  /** Element affinities of the abilities this side triggered (neutral excluded), sorted. */
  affinities: ElementId[];
}

/** One idempotent grant: `key` makes a repeat a no-op (reward_grants UNIQUE, R-SEC-003). */
export interface GrantPlan {
  key: string;
  reward: Reward;
  /** Progress flags set in the same atomic list (a story trainer defeated). */
  flags: string[];
}

const playerOf = (seat: SeatInit): string | null => ('playerId' in seat ? seat.playerId : null);

/** Affinities of the abilities `side` triggered during the battle (from the full server log). */
export function affinitiesUsed(archive: Pick<BattleArchive, 'records'>, side: Side): ElementId[] {
  const out = new Set<ElementId>();
  for (const r of archive.records)
    for (const e of r.events) {
      if (e.k !== 'AbilityTriggered' || e.side !== side || !e.ability) continue;
      const aff = AFFINITY.get(e.ability);
      if (aff && aff !== 'neutral') out.add(aff as ElementId);
    }
  return [...out].sort();
}

/** Every human seat's result. */
export function seatResults(summary: BattleSummary, archive: BattleArchive): SeatResult[] {
  const out: SeatResult[] = [];
  for (const side of ['white', 'black'] as const) {
    const seat = archive.seats[side];
    const id = playerOf(seat);
    if (!id) continue;
    const other = archive.seats[side === 'white' ? 'black' : 'white'];
    const w = summary.result.winner;
    out.push({
      playerId: id,
      side,
      result: w === null ? 'draw' : w === side ? 'win' : 'loss',
      level: seat.level,
      opponentLevel: other.level,
      affinities: affinitiesUsed(archive, side),
    });
  }
  return out;
}

/** The zone core's view of the outcome (quests, lessons, once-only trainers, cooldown). */
export function zoneOutcome(
  origin: BattleOrigin,
  seat: SeatResult,
  summary: BattleSummary,
): BattleOutcome | null {
  const base = { result: seat.result, format: summary.format, affinities: seat.affinities };
  switch (origin.kind) {
    case 'wild':
      return { ...base, kind: 'wild', tier: 'wild' };
    case 'trainer':
      return { ...base, kind: 'trainer', npc: origin.npc, tier: origin.tier };
    case 'lesson':
      return { ...base, kind: 'lesson', lesson: origin.lesson };
    case 'challenge':
      return { ...base, kind: 'challenge' };
    case 'npc':
    case 'pvp':
    case 'ranked':
    case 'wager':
      return null;
  }
}

const merge = (a: Reward, b: Reward): Reward => {
  const sum = (x: { id: string; qty: number }[] = [], y: { id: string; qty: number }[] = []) => {
    const m = new Map<string, number>();
    for (const i of [...x, ...y]) m.set(i.id, (m.get(i.id) ?? 0) + i.qty);
    return [...m].map(([id, qty]) => ({ id, qty }));
  };
  const out: Reward = { xp: a.xp + b.xp };
  const items = sum(a.items, b.items);
  const cards = sum(a.cards, b.cards);
  const keyItems = [...new Set([...(a.keyItems ?? []), ...(b.keyItems ?? [])])];
  const coins = (a.coins ?? 0) + (b.coins ?? 0);
  if (items.length) out.items = items;
  if (cards.length) out.cards = cards;
  if (keyItems.length) out.keyItems = keyItems;
  if (coins) out.coins = coins;
  return out;
};

/** Sum of several rewards (what the player is shown after the grants that went through). */
export function totalReward(list: readonly Reward[]): Reward {
  return list.reduce(merge, { xp: 0 });
}

/**
 * The grants a finished battle owes one player (7.5, DD-74, DD-76):
 * - wild: battle XP, coins and a seeded chance of a card (`wildReward`);
 * - trainer: battle XP, plus the trainer's reward on a win (a story trainer's once per player, under
 *   its own key, with the defeated flag);
 * - lesson: nothing here: the lesson's reward is granted when the lesson completes (DD-73);
 * - PvP (ranked and wager battles too) and online-screen NPC battles: battle XP by format, result
 *   and the opponent's level; a ranked battle's rating update is separate (`rating/settle.ts`), a
 *   wager's stakes are settled by `world/wager.ts`.
 */
export function battleGrants(
  origin: BattleOrigin,
  seat: SeatResult,
  summary: BattleSummary,
): GrantPlan[] {
  if (summary.plies < MIN_REWARD_PLIES || origin.kind === 'lesson') return [];
  const key = `battle:${summary.battleId}`;
  switch (origin.kind) {
    case 'wild':
      return [
        {
          key,
          reward: wildReward({
            seed: battleSeed(summary.battleId),
            outcome: seat.result,
            playerLevel: seat.level,
            npcLevel: origin.level,
            ...(origin.element ? { element: origin.element } : {}),
          }),
          flags: [],
        },
      ];
    case 'trainer': {
      const plans: GrantPlan[] = [
        { key, reward: { xp: battleXp(summary.format, seat.result, origin.level) }, flags: [] },
      ];
      const role = npcById.get(origin.npc)?.role;
      if (seat.result === 'win' && role?.kind === 'trainer') {
        if (role.once)
          plans.push({
            key: `trainer:${seat.playerId}:${origin.npc}`,
            reward: role.reward,
            flags: [`npc:${origin.npc}`],
          });
        else plans.push({ key: `${key}:bonus`, reward: role.reward, flags: [] });
      }
      return plans;
    }
    case 'challenge':
    case 'npc':
    case 'pvp':
    case 'ranked':
    case 'wager':
      return [
        {
          key,
          reward: { xp: battleXp(summary.format, seat.result, seat.opponentLevel) },
          flags: [],
        },
      ];
  }
}
