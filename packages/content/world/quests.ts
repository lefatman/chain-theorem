/**
 * Quests (10.5, R-WORLD-005) and key items (10.2). The Chess Academy line runs in order:
 * talk to the Headmaster and take the lessons (10.3), walk out onto Knight’s Way, defeat a route
 * trainer, win a wild encounter, then win one battle using only Tide abilities. Rewards suit early
 * levels (7.5): XP, soft currency, ability cards and items from the first level bands (7.2, 5.7) and
 * the Hush Candle, a key item that halves the encounter rate (10.2; key items use no item slots).
 */
import type { KeyItemDef, QuestDef } from './types.ts';

export const QUESTS: readonly QuestDef[] = [
  {
    id: 'academy_enrolment',
    name: 'Welcome to the Academy',
    requires: [],
    steps: [
      { kind: 'talk', npc: 'headmaster_orla', text: 'Talk to Headmaster Orla.' },
      {
        kind: 'lesson',
        lesson: 'moves_basics',
        text: 'Learn how the pieces move with Tutor Nell (chess veterans may skip it).',
      },
      {
        kind: 'lesson',
        lesson: 'check_basics',
        text: 'Learn about check with Tutor Rafe (skippable).',
      },
      {
        kind: 'lesson',
        lesson: 'checkmate_basics',
        text: 'Learn checkmate with Tutor Rafe (skippable).',
      },
      {
        kind: 'lesson',
        lesson: 'ability_hit_and_run',
        text: 'Win Tutor Juno’s Hit and Run lesson battle.',
      },
      { kind: 'lesson', lesson: 'ability_scout', text: 'Win Tutor Juno’s Scout lesson battle.' },
      {
        kind: 'lesson',
        lesson: 'ability_poisoned_meat',
        text: 'Win Tutor Juno’s Poisoned Meat lesson battle.',
      },
      {
        kind: 'lesson',
        lesson: 'elements_triangle',
        text: 'Learn the elements in Tutor Idris’s lesson battle.',
      },
      { kind: 'talk', npc: 'headmaster_orla', text: 'Report back to Headmaster Orla.' },
    ],
    reward: { xp: 120, coins: 50, cards: [{ id: 'pierce', qty: 1 }] },
  },
  {
    id: 'academy_first_road',
    name: 'Out the Gate',
    requires: ['academy_enrolment'],
    steps: [
      {
        kind: 'talk',
        npc: 'gatekeeper_tomas',
        text: 'Talk to Gatekeeper Tomas at Rookhaven’s north gate.',
      },
      {
        kind: 'reach',
        zone: 'route_1',
        area: 'south_gate',
        text: 'Walk out onto Knight’s Way.',
      },
      { kind: 'defeat', npc: 'trainer_pell', text: 'Defeat Trainer Pell on Knight’s Way.' },
      {
        kind: 'win',
        text: 'Step into the tall grass and win a battle against a wild creature.',
        constraint: { wild: true, tier: 'wild', format: 'first_blood' },
      },
      { kind: 'talk', npc: 'gatekeeper_tomas', text: 'Tell Gatekeeper Tomas how it went.' },
    ],
    reward: {
      xp: 150,
      coins: 60,
      cards: [{ id: 'backdraft', qty: 1 }],
      items: [{ id: 'attunement_charm', qty: 1 }],
    },
  },
  {
    id: 'academy_tide_trial',
    name: 'The Tide Trial',
    requires: ['academy_first_road'],
    steps: [
      { kind: 'talk', npc: 'captain_wren', text: 'Talk to Captain Wren by Rookhaven Pond.' },
      {
        kind: 'win',
        text: 'Win a battle with a loadout of Tide abilities only.',
        constraint: { onlyAffinity: 'tide' },
      },
      {
        kind: 'talk',
        npc: 'headmaster_orla',
        text: 'Return to Headmaster Orla at the Chess Academy to graduate.',
      },
    ],
    reward: {
      xp: 250,
      coins: 100,
      keyItems: ['hush_candle'],
      items: [{ id: 'triple_adepts_gloves', qty: 1 }],
      cards: [{ id: 'antidote', qty: 1 }],
    },
  },
];

export const KEY_ITEMS: readonly KeyItemDef[] = [
  {
    id: 'hush_candle',
    name: 'Hush Candle',
    text: 'A candle with a soft blue flame, given to every Chess Academy graduate. Wild creatures keep their distance from its light: wild encounters happen half as often while you carry it. It never uses an item slot.',
    // PLAYTEST (10.2): multiplies every zone's encounter rate.
    encounterRate: 0.5,
  },
];
