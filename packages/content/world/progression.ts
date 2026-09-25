/**
 * Progression values (7.1, 7.5 R-LOAD-005, 10.2 R-WORLD-002, 17.2). Every number here is PLAYTEST:
 * tune it from telemetry, never in engine or server code.
 *
 * XP curve: XP to go from level L to L + 1 is round(60 * L^1.6), capped at CAPS.LEVEL_CAP (30).
 * With the Academy rewards a new player finishes the lessons at level 3, the Academy quest line at
 * about level 4-5 (the second item slot arrives at 5, 7.1), and the cap takes on the order of 100
 * hours of play at the 17.2 session pacing below (world.test.ts / progression.test.ts check this).
 *
 * Battle XP is weighted by format and result (7.5) and grows 15% per opponent level above 1, so
 * losses still pay (pillar 5) and longer formats pay more per battle but not per minute.
 *
 * Wild-encounter rewards: battle XP, a few coins, and on a win a small chance of an ability card of
 * the wild army's element that the player can equip now. Rolls come from a seed the server derives
 * from the battle id, so a reward grant is reproducible and idempotent (R-SEC-003).
 */
import type { ElementId, FormatId } from '@chain-theorem/rules';
import { CAPS } from '../config.ts';
import { abilities } from '../registry.generated.ts';
import type { Reward } from './types.ts';

export type BattleOutcome = 'win' | 'loss' | 'draw';

const clampLevel = (level: number) =>
  Math.max(1, Math.min(CAPS.LEVEL_CAP, Math.floor(Number.isFinite(level) ? level : 1)));

// ---- Levels ------------------------------------------------------------------------------------

export const XP_CURVE = { base: 60, exponent: 1.6 } as const;

/** XP needed to go from `level` to `level + 1`; 0 at the level cap. */
export function xpToNext(level: number): number {
  const l = clampLevel(level);
  return l >= CAPS.LEVEL_CAP ? 0 : Math.round(XP_CURVE.base * l ** XP_CURVE.exponent);
}

/** TOTAL[L] = total XP needed to reach level L (TOTAL[1] = 0). */
const TOTAL: readonly number[] = (() => {
  const t = [0, 0];
  for (let l = 1; l < CAPS.LEVEL_CAP; l++) t.push((t[l] ?? 0) + xpToNext(l));
  return t;
})();

/** Total XP needed to reach `level` (clamped to 1..LEVEL_CAP). */
export function xpForLevel(level: number): number {
  return TOTAL[clampLevel(level)] ?? 0;
}

/** The level a player with `xp` total XP has reached, capped at CAPS.LEVEL_CAP. */
export function levelForXp(xp: number): number {
  let level = 1;
  for (let l = 2; l <= CAPS.LEVEL_CAP; l++) {
    if (xp >= (TOTAL[l] ?? Infinity)) level = l;
    else break;
  }
  return level;
}

// ---- Battle XP ---------------------------------------------------------------------------------

/** Base XP per finished battle against a level-1 opponent (PLAYTEST). */
export const BATTLE_XP: Readonly<Record<FormatId, Readonly<Record<BattleOutcome, number>>>> = {
  first_blood: { win: 30, draw: 15, loss: 10 },
  vanguard: { win: 70, draw: 35, loss: 20 },
  full: { win: 120, draw: 60, loss: 35 },
};

/** Extra battle XP per opponent level above 1 (PLAYTEST). */
export const OPPONENT_LEVEL_BONUS = 0.15;

/**
 * XP for one finished battle (wild, trainer, PvP) by format, result and the opponent's level. A
 * trainer's `reward` and a lesson's `reward` are separate; lesson battles grant only the lesson
 * reward.
 */
export function battleXp(format: FormatId, outcome: BattleOutcome, opponentLevel: number): number {
  const factor = 1 + OPPONENT_LEVEL_BONUS * (clampLevel(opponentLevel) - 1);
  return Math.round(BATTLE_XP[format][outcome] * factor);
}

/** XP for entering a zone for the first time (7.5 "discoveries", PLAYTEST). */
export const DISCOVERY_XP = 25;

// ---- Wild-encounter rewards --------------------------------------------------------------------

export const WILD_DROPS = {
  /** Chance of an ability card on a win. */
  cardChance: 0.1,
  /** Coins by result, inclusive range. */
  coins: { win: [4, 10], draw: [2, 4], loss: [1, 2] },
} as const satisfies {
  cardChance: number;
  coins: Record<BattleOutcome, readonly [number, number]>;
};

/** mulberry32: a small seeded PRNG in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cards a wild army can drop: not retired, equippable at the player's level, of an enabled element;
 * the wild army's own element when it has any such card.
 */
export function wildCardPool(playerLevel: number, element?: ElementId): string[] {
  const enabled = CAPS.ENABLED_ELEMENTS as readonly string[];
  const usable = abilities
    .filter(
      (a) => !a.retired && a.minLevel <= clampLevel(playerLevel) && enabled.includes(a.affinity),
    )
    .map((a) => ({ id: a.id, affinity: a.affinity }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const own = usable.filter((a) => a.affinity === element);
  return (own.length > 0 ? own : usable).map((a) => a.id);
}

export interface WildRewardInput {
  /** From the battle id (server), so the same battle always yields the same reward. */
  seed: number;
  outcome: BattleOutcome;
  playerLevel: number;
  npcLevel: number;
  element?: ElementId;
}

export function wildReward(input: WildRewardInput): Reward {
  const next = rng(input.seed);
  const [lo, hi] = WILD_DROPS.coins[input.outcome];
  const reward: Reward = {
    xp: battleXp('first_blood', input.outcome, input.npcLevel),
    coins: lo + Math.floor(next() * (hi - lo + 1)),
  };
  if (input.outcome === 'win' && next() < WILD_DROPS.cardChance) {
    const pool = wildCardPool(input.playerLevel, input.element);
    const card = pool[Math.floor(next() * pool.length)];
    if (card) reward.cards = [{ id: card, qty: 1 }];
  }
  return reward;
}

// ---- Encounter pacing (10.2, 17.2) -------------------------------------------------------------

/**
 * The session model the per-zone encounter rates are tuned against (10.2: a 30-minute session holds
 * about 4-6 First Blood encounters and 1 longer battle). A player who wants battles walks a share
 * of their steps in tall grass; each wild battle costs its median length plus transitions.
 */
export const PACING = {
  sessionSeconds: 30 * 60,
  /** 17.2: First Blood median 2-5 minutes; the midpoint. */
  firstBloodSeconds: 210,
  /** The one longer battle per session: a Vanguard trainer (9.1: 5-10 minutes). */
  longBattleSeconds: 450,
  /** Dialogs, lessons menus, loadout edits and reward screens per session. */
  otherSeconds: 240,
  /** Transition into and out of each wild battle. */
  encounterOverheadSeconds: 15,
  /** Walking pace including pauses (the client may send up to 8 steps a second, 10.1). */
  stepsPerSecond: 3,
  /** Share of walking steps spent in tall grass by a player looking for battles. */
  grassShare: 0.4,
  /** 10.2 target: First Blood encounters per 30-minute session. */
  target: [4, 6],
} as const;

/** Expected steps on wild tiles from one encounter to the next: the grace steps, then 1 / rate. */
export function wildStepsPerEncounter(rate: number, grace: number): number {
  return rate > 0 ? grace + 1 / rate : Infinity;
}

/**
 * Expected First Blood encounters in one PACING session for a zone's rate and grace (and a key-item
 * multiplier). Walking time W and encounters E satisfy W = free - E * perBattle (the time left after
 * the longer battle and menus) and E = W * grassStepsPerSecond / stepsPerEncounter, so
 * E = free * g / (k + g * perBattle).
 */
export function sessionEncounters(rate: number, grace: number, rateMultiplier = 1): number {
  const p = PACING;
  const k = wildStepsPerEncounter(rate * rateMultiplier, grace);
  if (!Number.isFinite(k)) return 0;
  const free = p.sessionSeconds - p.longBattleSeconds - p.otherSeconds;
  const perBattle = p.firstBloodSeconds + p.encounterOverheadSeconds;
  const g = p.stepsPerSecond * p.grassShare;
  return (free * g) / (k + g * perBattle);
}
