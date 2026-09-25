/**
 * Quest progression (R-WORLD-005, 10.5) as pure functions over per-quest step state. Quests are data
 * (`QuestDef`); this module advances them on world events: talking to an NPC, reaching a named area,
 * finishing a lesson, and battle outcomes (defeat a named NPC, win under a constraint). The zone core
 * calls it; a host can call it directly for a battle that ends after the player left the zone.
 *
 * - One event completes at most one step of each quest.
 * - Steps already satisfied by lasting facts (a lesson done, a once-only trainer defeated) complete
 *   as soon as they become current, so a quest never waits on something the player cannot repeat.
 */
import type { BattleOutcome, QuestProgress } from './types.ts';
import type { QuestDef, QuestStep, Reward } from './world.ts';

/** Lasting player facts that can satisfy a step without a new event. */
export interface QuestFacts {
  lessonsDone: readonly string[];
  defeatedNpcs: readonly string[];
}

export type QuestEvent =
  | { kind: 'talk'; npc: string }
  | { kind: 'reach'; zone: string; areas: readonly string[] }
  | { kind: 'lesson'; lesson: string }
  | { kind: 'battle'; outcome: BattleOutcome };

/** One quest that moved: its new state, the text to show, and the reward when it completed. */
export interface QuestUpdate {
  progress: QuestProgress;
  text: string;
  completed: boolean;
  reward: Reward | null;
}

export type QuestIndex = ReadonlyMap<string, QuestDef>;

export function questIndex(quests: readonly QuestDef[]): QuestIndex {
  return new Map(quests.map((q) => [q.id, q]));
}

export function currentStep(def: QuestDef, p: QuestProgress): QuestStep | null {
  return p.done ? null : (def.steps[p.step] ?? null);
}

/** The line shown for a quest: its current step, or that it is complete. */
export function questText(def: QuestDef, p: QuestProgress): string {
  const step = currentStep(def, p);
  return (step ? step.text : `${def.name}: complete`).slice(0, 200);
}

/** A quest can be accepted when it was never started and every required quest is done. */
export function canAccept(def: QuestDef, list: readonly QuestProgress[]): boolean {
  if (list.some((q) => q.id === def.id)) return false;
  return def.requires.every((r) => list.some((q) => q.id === r && q.done));
}

/** Complete every current step already satisfied by lasting facts. */
export function settle(def: QuestDef, p: QuestProgress, facts: QuestFacts): QuestProgress {
  let step = p.step;
  for (;;) {
    const s = def.steps[step];
    if (!s) break;
    const met =
      (s.kind === 'lesson' && facts.lessonsDone.includes(s.lesson)) ||
      (s.kind === 'defeat' && facts.defeatedNpcs.includes(s.npc));
    if (!met) break;
    step++;
  }
  return { id: p.id, step, done: step >= def.steps.length };
}

/** Does a battle outcome meet a `win` step's constraint (10.5)? */
export function winMatches(
  c: Extract<QuestStep, { kind: 'win' }>['constraint'],
  o: BattleOutcome,
): boolean {
  if (o.result !== 'win') return false;
  // A lesson battle uses the lesson's fixed loadout, not the player's own build.
  if (o.kind === 'lesson') return false;
  if (c.format !== undefined && o.format !== c.format) return false;
  if (c.tier !== undefined && o.tier !== c.tier) return false;
  if (c.wild !== undefined && (o.kind === 'wild') !== c.wild) return false;
  if (c.onlyAffinity !== undefined) {
    // "Win using only Tide abilities": at least one ability used, and all of that element.
    if (o.affinities.length === 0) return false;
    if (o.affinities.some((a) => a !== c.onlyAffinity)) return false;
  }
  return true;
}

export function stepMatches(step: QuestStep, ev: QuestEvent): boolean {
  switch (step.kind) {
    case 'talk':
      return ev.kind === 'talk' && ev.npc === step.npc;
    case 'reach':
      return ev.kind === 'reach' && ev.zone === step.zone && ev.areas.includes(step.area);
    case 'lesson':
      return ev.kind === 'lesson' && ev.lesson === step.lesson;
    case 'defeat':
      return (
        ev.kind === 'battle' &&
        ev.outcome.result === 'win' &&
        ev.outcome.kind === 'trainer' &&
        ev.outcome.npc === step.npc
      );
    case 'win':
      return ev.kind === 'battle' && winMatches(step.constraint, ev.outcome);
  }
}

function update(def: QuestDef, before: QuestProgress, after: QuestProgress): QuestUpdate | null {
  if (after.step === before.step && after.done === before.done) return null;
  return {
    progress: after,
    text: questText(def, after),
    completed: after.done && !before.done,
    reward: after.done && !before.done ? def.reward : null,
  };
}

/** Start a quest (from a quest giver's dialog). Null when it cannot be accepted. */
export function accept(
  def: QuestDef,
  list: readonly QuestProgress[],
  facts: QuestFacts,
): { list: QuestProgress[]; update: QuestUpdate } | null {
  if (!canAccept(def, list)) return null;
  const started: QuestProgress = { id: def.id, step: 0, done: def.steps.length === 0 };
  const progress = settle(def, started, facts);
  const completed = progress.done;
  return {
    list: [...list, progress],
    update: {
      progress,
      text: questText(def, progress),
      completed,
      reward: completed ? def.reward : null,
    },
  };
}

/**
 * Apply one event to every active quest (null: only settle steps met by lasting facts). Unknown
 * quest ids are left alone.
 */
export function advance(
  defs: QuestIndex,
  list: readonly QuestProgress[],
  ev: QuestEvent | null,
  facts: QuestFacts,
): { list: QuestProgress[]; updates: QuestUpdate[] } {
  const updates: QuestUpdate[] = [];
  const out = list.map((p) => {
    const def = defs.get(p.id);
    if (!def || p.done) return p;
    const step = currentStep(def, p);
    let next = p;
    if (step && ev && stepMatches(step, ev)) next = { id: p.id, step: p.step + 1, done: false };
    next = settle(def, next, facts);
    const u = update(def, p, next);
    if (u) updates.push(u);
    return next;
  });
  return { list: out, updates };
}

/** Active quests whose current step is `reach` in `zone` (the core checks the area on arrival). */
export function wantsReach(
  defs: QuestIndex,
  list: readonly QuestProgress[],
  zone: string,
): boolean {
  return list.some((p) => {
    const def = defs.get(p.id);
    const step = def ? currentStep(def, p) : null;
    return step?.kind === 'reach' && step.zone === zone;
  });
}
