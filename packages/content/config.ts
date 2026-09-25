/**
 * Global caps (spec 13.5, R-LOAD-001). Modules and the loadout validator read these; nothing else
 * hard-codes a limit. PLAYTEST and PROVISIONAL values live here, never in engine code.
 */
import type { Caps, FormatDef } from '@chain-theorem/rules/sdk';

export const FORMATS: Caps['FORMATS'] = {
  // R-FMT-001: objective COMMITTED, clock PROVISIONAL.
  first_blood: {
    id: 'first_blood',
    name: 'First Blood',
    objective: { nonPawnCaptures: 1 },
    clock: { initialMs: 3 * 60_000, incrementMs: 2_000 },
  },
  vanguard: {
    id: 'vanguard',
    name: 'Vanguard',
    objective: { nonPawnCaptures: 3 },
    clock: { initialMs: 5 * 60_000, incrementMs: 3_000 },
  },
  full: {
    id: 'full',
    name: 'Full Battle',
    objective: null,
    clock: { initialMs: 10 * 60_000, incrementMs: 5_000 },
  },
} satisfies Record<string, FormatDef>;

export const CAPS = {
  LEVEL_CAP: 30,
  // R-LOAD-001 (COMMITTED): slots = min(6, 1 + floor(level / 5)).
  itemSlots: (level: number) => Math.min(6, 1 + Math.floor(level / 5)),
  MAX_ITEM_SLOTS: 6,
  BASE_ABILITY_CAPACITY: 1,
  MAX_ABILITY_CAPACITY: 5,
  MAX_CHAIN_DEPTH: 3,
  // R-ELEM-002 tuning knob: 'ALL_TRIGGERS' (default) | 'REACTIONS_ONLY' | 'OFF'.
  SILENCE_SCOPE: 'ALL_TRIGGERS',
  // 6.5: MVP ships Ember, Tide and Grove; Storm, Stone and Frost follow in M7.
  ENABLED_ELEMENTS: ['ember', 'tide', 'grove'],
  FORMATS,
  MAX_EVENTS_PER_ACTION: 512,
} as const satisfies Caps;

/** Hot Foot burns for this many turns of the igniting player's opponent (D-40, COMMITTED). */
export const HOT_FOOT_TURNS = 3;
/** Saved loadouts per player (7.4, PROVISIONAL). */
export const MAX_SAVED_LOADOUTS = 5;
/** Mid-action choice prompt, charged to the chooser's clock (5.4). */
export const CHOICE_PROMPT_MS = 15_000;
/** Disconnect grace while the clock keeps running (9.2, PROVISIONAL). */
export const DISCONNECT_GRACE_MS = 60_000;
/** Draw offers: at most one per this many moves (9.2). */
export const DRAW_OFFER_EVERY_MOVES = 10;
