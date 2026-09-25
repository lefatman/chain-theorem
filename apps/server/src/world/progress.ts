/**
 * Player progress in the database for the overworld host (M5): what a zone channel needs to admit a
 * player (`PlayerInit`), idempotent reward grants with level-ups (R-SEC-003, 7.5), quest and lesson
 * storage, and the party view with its youngest-participant flag (R-SEC-011).
 */
import { engine } from '@chain-theorem/content';
import {
  lessonById,
  levelForXp,
  questById,
  world,
  type Reward,
} from '@chain-theorem/content/world';
import type { Db, Party } from '@chain-theorem/db';
import { playerFacts } from '../api/collection.ts';
import {
  quests as questLogic,
  type BattleOutcome,
  type PartyView,
  type PlayerInit,
  type QuestProgress,
} from '../zone/index.ts';
import type { Fighter } from './battles.ts';
import { fightingLoadout } from './loadout.ts';
import type { GrantPlan } from './outcome.ts';

/** Progress flag names (progress_flags.flag). */
export const FLAG = {
  lesson: (id: string) => `lesson:${id}`,
  npc: (id: string) => `npc:${id}`,
  zone: (id: string) => `zone:${id}`,
} as const;

const QUEST_INDEX = questLogic.questIndex(world.quests);

export function isAdult(adultFrom: number, now: number): boolean {
  return now >= adultFrom;
}

/** The party as zone cores see it; `minor` when any member is under 18 (R-SEC-011). */
export async function partyView(
  db: Db,
  party: Party | null,
  now: number,
): Promise<PartyView | null> {
  if (!party) return null;
  let minor = false;
  for (const m of party.members) {
    const p = await db.players.getById(m.playerId);
    if (!p || !isAdult(p.adultFrom, now)) minor = true;
  }
  return {
    id: party.id,
    leader: party.leaderId,
    members: party.members.map((m) => ({ p: m.playerId, name: m.name, zone: m.zone })),
    minor,
  };
}

export async function storedQuests(db: Db, playerId: string): Promise<QuestProgress[]> {
  return (await db.world.quests(playerId)).map((q) => ({
    id: q.questId,
    step: q.step,
    done: q.data.done === true,
  }));
}

export async function saveQuest(
  db: Db,
  playerId: string,
  q: QuestProgress,
  now: number,
): Promise<void> {
  await db.world.setQuest(playerId, q.id, q.step, { done: q.done }, now);
}

/** Lessons done and once-only trainers defeated, from the progress flags. */
export function factsFromFlags(flags: readonly string[]): {
  lessonsDone: string[];
  defeatedNpcs: string[];
  zonesSeen: string[];
} {
  const pick = (prefix: string) =>
    flags.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length));
  return { lessonsDone: pick('lesson:'), defeatedNpcs: pick('npc:'), zonesSeen: pick('zone:') };
}

/**
 * Everything a zone channel needs to admit `playerId` into `zone`; null for an unknown player. The
 * saved tile is used only when it belongs to this zone. `battle` is the battle the player is still
 * in (a reload mid-battle), or null.
 */
export async function loadPlayerInit(
  db: Db,
  playerId: string,
  zone: string,
  now: number,
  battle: string | null,
): Promise<{ init: PlayerInit; firstVisit: boolean } | null> {
  const p = await db.players.getById(playerId);
  if (!p) return null;
  const flags = factsFromFlags(await db.world.flags(playerId));
  const here = p.zoneId === zone && p.tileX !== null && p.tileY !== null;
  const init: PlayerInit = {
    id: p.id,
    name: p.displayName,
    level: p.level,
    adult: isAdult(p.adultFrom, now),
    friends: await db.social.friendIds(playerId),
    ...(here ? { x: p.tileX ?? 0, y: p.tileY ?? 0 } : {}),
    quests: await storedQuests(db, playerId),
    lessonsDone: flags.lessonsDone,
    defeatedNpcs: flags.defeatedNpcs,
    keyItems: await db.world.keyItems(playerId),
    party: await partyView(db, await db.social.partyOf(playerId), now),
    filterChat: await db.world.filterChat(playerId),
    battling: battle !== null,
    battleId: battle,
    // M6 (10.4): guild chat goes to this guild's GuildRoom.
    guild: await db.guilds.guildIdOf(playerId),
    // M6 6.4 (R-SEC-011): the player's own mutes and blocks, and a moderator's chat ban.
    muted: await db.safety.mutedIds(playerId),
    blocked: await db.safety.blockedIds(playerId),
    chatBanUntil: p.chatBanUntil,
  };
  return { init, firstVisit: !flags.zonesSeen.includes(zone) };
}

/** The player's fighting loadout for a world battle (DD-78). */
export async function loadFighter(db: Db, playerId: string): Promise<Fighter | null> {
  const p = await db.players.getById(playerId);
  if (!p) return null;
  const facts = await playerFacts(db, playerId, p.level);
  const saved = await db.loadouts.list(playerId);
  const loadout = fightingLoadout(saved, facts);
  if (!engine.validateLoadout(loadout, facts).ok) return null;
  return { playerId, name: p.displayName, level: p.level, loadout };
}

/** Grant once under `plan.key`; the reward when it went through, null for a repeat. */
export async function grantOnce(
  db: Db,
  playerId: string,
  plan: GrantPlan,
  now: number,
): Promise<Reward | null> {
  const r = plan.reward;
  const res = await db.rewards.grant({
    key: plan.key,
    playerId,
    xp: Math.max(0, Math.floor(r.xp)),
    items: (r.items ?? []).map((i) => ({ itemId: i.id, qty: i.qty })),
    cards: (r.cards ?? []).map((c) => ({ abilityId: c.id, qty: c.qty })),
    coins: Math.max(0, Math.floor(r.coins ?? 0)),
    keyItems: r.keyItems ?? [],
    flags: plan.flags,
    at: now,
  });
  return res.status === 'granted' ? r : null;
}

/** Raise the stored level to what the XP has reached (never lowers it); the level after. */
export async function syncLevel(db: Db, playerId: string): Promise<number> {
  const r = await db.players.syncLevel(playerId, levelForXp);
  return r?.level ?? 1;
}

/**
 * A world battle ended after the player left its zone (the zone core never saw the result): apply
 * what the core would have done, from the stored progress. Lessons complete on a win with their
 * reward (once); quests advance on the battle and the lesson.
 */
export async function offlineBattleEnd(
  db: Db,
  playerId: string,
  outcome: BattleOutcome,
  now: number,
): Promise<Reward[]> {
  const granted: Reward[] = [];
  const flags = factsFromFlags(await db.world.flags(playerId));
  let list = await storedQuests(db, playerId);
  const facts = { lessonsDone: [...flags.lessonsDone], defeatedNpcs: [...flags.defeatedNpcs] };
  const events: questLogic.QuestEvent[] = [];
  if (outcome.result === 'win' && outcome.kind === 'lesson' && outcome.lesson) {
    const lesson = lessonById.get(outcome.lesson);
    if (lesson && !facts.lessonsDone.includes(lesson.id)) {
      const r = await grantOnce(
        db,
        playerId,
        {
          key: `lesson:${playerId}:${lesson.id}`,
          reward: lesson.reward,
          flags: [FLAG.lesson(lesson.id)],
        },
        now,
      );
      if (r) granted.push(r);
      facts.lessonsDone.push(lesson.id);
      events.push({ kind: 'lesson', lesson: lesson.id });
    }
  }
  if (outcome.result === 'win' && outcome.kind === 'trainer' && outcome.npc)
    if (!facts.defeatedNpcs.includes(outcome.npc)) facts.defeatedNpcs.push(outcome.npc);
  events.unshift({ kind: 'battle', outcome });
  for (const ev of events) {
    const r = questLogic.advance(QUEST_INDEX, list, ev, facts);
    list = r.list;
    for (const u of r.updates) {
      await saveQuest(db, playerId, u.progress, now);
      if (u.completed && u.reward) {
        const def = questById.get(u.progress.id);
        const g = await grantOnce(
          db,
          playerId,
          { key: `quest:${playerId}:${u.progress.id}`, reward: def?.reward ?? u.reward, flags: [] },
          now,
        );
        if (g) granted.push(g);
      }
    }
  }
  return granted;
}
