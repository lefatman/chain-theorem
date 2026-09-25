/**
 * Overworld NPCs (10.3, 10.5, 9.4): Academy tutors (lessons), quest givers, route trainers with
 * legal loadouts at their level (R-LOAD-004: fixed, or `{ buildSeed }` through `npcBuild`), and
 * townsfolk. Names are original (R-ART-003; `world.test.ts` keeps a deny-list guard).
 *
 * Trainer rewards are bonuses on a win: story trainers (`once`) pay out on the first win only;
 * practice trainers on every win. Battle XP by format and result (`battleXp`) comes on top.
 */
import type { NpcDef } from './types.ts';

export const NPCS: readonly NpcDef[] = [
  // ---- Chess Academy --------------------------------------------------------------------------
  {
    id: 'headmaster_orla',
    name: 'Headmaster Orla',
    look: { variant: 0, element: 'neutral' },
    lines: [
      'Welcome to the Chess Academy, {name}! I am Headmaster Orla.',
      'Here every battle is a game of chess, bent by the abilities your creatures carry. Never played chess? No matter: my tutors will teach you, one step at a time.',
      'Start with Tutor Nell, just to my left, for how the pieces move. When you have finished every lesson, come back and see me.',
    ],
    role: { kind: 'quest', quest: 'academy_enrolment' },
  },
  {
    id: 'tutor_nell',
    name: 'Tutor Nell',
    look: { variant: 1, element: 'neutral' },
    lines: [
      'Every piece moves in its own way. Shall we practise?',
      'If you already know chess, you may skip my lesson.',
    ],
    role: { kind: 'teacher', lessons: ['moves_basics'] },
  },
  {
    id: 'tutor_rafe',
    name: 'Tutor Rafe',
    look: { variant: 2, element: 'neutral' },
    lines: [
      'Attack the king and you give check. Trap the king and you win!',
      'Chess veterans may skip my lessons.',
    ],
    role: { kind: 'teacher', lessons: ['check_basics', 'checkmate_basics'] },
  },
  {
    id: 'tutor_juno',
    name: 'Tutor Juno',
    look: { variant: 3, element: 'tide' },
    lines: [
      'Abilities are what make our battles special. We learn them one at a time, with a real battle for each.',
      'Everyone takes these lessons, even chess masters!',
    ],
    role: {
      kind: 'teacher',
      lessons: ['ability_hit_and_run', 'ability_scout', 'ability_poisoned_meat'],
    },
  },
  {
    id: 'tutor_idris',
    name: 'Tutor Idris',
    look: { variant: 4, element: 'ember' },
    lines: [
      'Ember, Tide and Grove: each one beats another and loses to the third. Let me show you why that matters.',
    ],
    role: { kind: 'teacher', lessons: ['elements_triangle'] },
  },
  {
    id: 'coach_brann',
    name: 'Coach Brann',
    look: { variant: 5, element: 'tide' },
    lines: ['Fancy a practice battle? First Blood, as often as you like. I will go easy on you.'],
    role: {
      kind: 'trainer',
      tier: 'wild',
      format: 'first_blood',
      level: 2,
      loadout: { buildSeed: 1 },
      reward: { xp: 10 },
      once: false,
    },
  },
  {
    id: 'pim',
    name: 'Pim',
    look: { variant: 6, element: 'grove' },
    lines: [
      'I skipped the chess lessons, but nobody skips the ability lessons. Tutor Juno says even grandmasters get caught by Poisoned Meat!',
      'Tip: your opponent sees your element before a battle, but never your abilities until they fire.',
    ],
    role: { kind: 'talk' },
  },

  // ---- Rookhaven ------------------------------------------------------------------------------
  {
    id: 'gatekeeper_tomas',
    name: 'Gatekeeper Tomas',
    look: { variant: 7, element: 'neutral' },
    lines: [
      'Knight’s Way starts right through this gate, {name}.',
      'The road itself is safe. Wild creatures only jump out of the tall grass, so you decide when to battle.',
    ],
    role: { kind: 'quest', quest: 'academy_first_road' },
  },
  {
    id: 'captain_wren',
    name: 'Captain Wren',
    look: { variant: 8, element: 'tide' },
    lines: [
      'Tide is the finest element there is, {name}! Slippery, clever, always one step ahead.',
      'Think so too? Then prove it: win a battle using only Tide abilities.',
    ],
    role: { kind: 'quest', quest: 'academy_tide_trial' },
  },
  {
    id: 'old_hollis',
    name: 'Old Hollis',
    look: { variant: 9, element: 'neutral' },
    lines: [
      'Been fishing this pond for forty years. Never caught a thing.',
      'In my day we played Full Battles that lasted all afternoon. Now it is First Blood: first to capture a piece that is not a pawn wins. Quick, but I like it.',
    ],
    role: { kind: 'talk' },
  },
  {
    id: 'tam',
    name: 'Tam',
    look: { variant: 10, element: 'ember' },
    lines: [
      'When I grow up I am going to lead an Ember army! Hot Foot is the best trait.',
      'Did you know? When an Ember piece captures and then moves on, the square it left burns for three turns, and only Ember pieces may step there.',
    ],
    role: { kind: 'talk' },
  },
  {
    id: 'hettie',
    name: 'Hettie',
    look: { variant: 11, element: 'grove' },
    lines: [
      'Fresh bread! Well, soon. The shop opens when the traders arrive.',
      'Grove armies are like good bread: they keep going. Abilities with charges get twice as many on a Grove piece.',
    ],
    role: { kind: 'talk' },
  },
  {
    id: 'dorran',
    name: 'Dorran',
    look: { variant: 12, element: 'neutral' },
    lines: [
      'See those signs? Read them! Most of what I know about this town I learned from signs.',
      'There is a Challenge Zone on Knight’s Way. Step onto the sand and other players can challenge you to First Blood without asking first.',
    ],
    role: { kind: 'talk' },
  },

  // ---- Knight’s Way ----------------------------------------------------------------------------
  {
    id: 'trainer_pell',
    name: 'Trainer Pell',
    look: { variant: 13, element: 'ember' },
    lines: ['Hey! You are from the Academy, right? Let us see what they taught you. First Blood!'],
    role: {
      kind: 'trainer',
      tier: 'trainer',
      format: 'first_blood',
      level: 2,
      loadout: {
        elements: ['ember'],
        items: ['dual_adepts_glove'],
        sets: [['hit_and_run', 'last_word']],
      },
      reward: { xp: 60, coins: 30, items: [{ id: 'scouts_lens', qty: 1 }] },
      once: true,
    },
  },
  {
    id: 'trainer_linnea',
    name: 'Trainer Linnea',
    look: { variant: 14, element: 'grove' },
    lines: [
      'I train by the tall grass every day. Up for a longer battle? Vanguard rules: three captures of pieces that are not pawns to win.',
    ],
    role: {
      kind: 'trainer',
      tier: 'trainer',
      format: 'vanguard',
      level: 4,
      loadout: { buildSeed: 2 },
      reward: { xp: 90, coins: 40, cards: [{ id: 'hit_and_run', qty: 1 }] },
      once: true,
    },
  },
  {
    id: 'dunmore',
    name: 'Dunmore',
    look: { variant: 15, element: 'neutral' },
    lines: [
      'That sandy clearing is a Challenge Zone. Step in and any player of your bracket can challenge you to First Blood, no questions asked.',
      'Step out whenever you like. Nobody can challenge you while you are battling, or for a minute after.',
    ],
    role: { kind: 'talk' },
  },

  // ---- Thistle Meadow -------------------------------------------------------------------------
  {
    id: 'meadowkeeper_sef',
    name: 'Meadowkeeper Sef',
    look: { variant: 9, element: 'ember' },
    lines: [
      'I keep watch over the meadow. Beat me in a Vanguard battle and I will share one of my favourite cards.',
    ],
    role: {
      kind: 'trainer',
      tier: 'trainer',
      format: 'vanguard',
      level: 5,
      loadout: { buildSeed: 0 },
      reward: { xp: 110, coins: 50, cards: [{ id: 'cleave', qty: 1 }] },
      once: true,
    },
  },
  {
    id: 'botanist_ilse',
    name: 'Botanist Ilse',
    look: { variant: 5, element: 'grove' },
    lines: [
      'The meadow grass is thick with wild creatures. Walk the paths if you want peace and quiet.',
      'Every Academy graduate receives a Hush Candle. Wild creatures keep their distance from its soft light.',
    ],
    role: { kind: 'talk' },
  },
];
