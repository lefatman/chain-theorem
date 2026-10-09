/**
 * Alpha guest play (spec 9.6, R-FMT-007; DD-107): the pure parts of the alpha screen. What the alpha
 * routes' error codes mean to the person reading them, the "format · level" line of an invite, and
 * the loadout the editor starts from (legal at level 1, so legal at every level the creator may pick).
 */
import { CAPS, FORMATS } from '@chain-theorem/content';
import type { FormatId } from '@chain-theorem/rules';
import { ApiError } from '../net/api.ts';
import type { SavedLoadout } from '../state/profile.ts';

export function alphaErrorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  const known: Record<string, string> = {
    challenge_closed: 'That code is no longer open.',
    own_challenge: 'You cannot accept your own code.',
    invalid_loadout: 'That loadout is not legal at this level.',
    rate_limited: 'Too many guests from this address; try again later.',
    signed_out: 'Play as a guest first.',
    not_found: 'That code was not found.',
    bad_level: `The level must be from 1 to ${CAPS.LEVEL_CAP}.`,
    try_again: 'Something went wrong; try again.',
    offline: 'The server cannot be reached.',
    no_server: 'The server cannot be reached.',
  };
  return known[code] ?? `Something went wrong (${code}).`;
}

/** "First Blood · level 12": what an invite says about the battle (9.6). */
export function formatLine(format: FormatId, level: number): string {
  return `${FORMATS[format]?.name ?? format} · level ${level}`;
}

/**
 * The editor's starting point for an alpha loadout: every card and item in it is level 1, so it is
 * legal at any level from 1 to LEVEL_CAP (R-LOAD-004) and the person only has to change what they want.
 */
export function alphaLoadout(level: number): SavedLoadout {
  return {
    id: 'alpha',
    name: 'Alpha loadout',
    level,
    loadout: { elements: ['tide'], items: ['dual_adepts_glove'], sets: [['hit_and_run', 'scout']] },
  };
}
