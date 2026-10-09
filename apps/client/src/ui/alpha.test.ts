/** Alpha guest play wording and defaults (spec 9.6, R-FMT-007; DD-107). */
import { CAPS, engine } from '@chain-theorem/content';
import { describe, expect, it } from 'vitest';
import { ApiError, ticketPath } from '../net/api.ts';
import { alphaErrorText, alphaLoadout, formatLine } from './alpha.ts';

describe('alpha guest play (9.6)', () => {
  it('R-FMT-007 every alpha route error reads as a sentence about codes, guests and levels', () => {
    const text = (status: number, code: string) => alphaErrorText(new ApiError(status, code));
    expect(text(409, 'challenge_closed')).toBe('That code is no longer open.');
    expect(text(409, 'own_challenge')).toBe('You cannot accept your own code.');
    expect(text(400, 'invalid_loadout')).toBe('That loadout is not legal at this level.');
    expect(text(429, 'rate_limited')).toBe('Too many guests from this address; try again later.');
    expect(text(401, 'signed_out')).toBe('Play as a guest first.');
    expect(text(404, 'not_found')).toBe('That code was not found.');
    expect(text(400, 'bad_level')).toBe(`The level must be from 1 to ${CAPS.LEVEL_CAP}.`);
    expect(text(0, 'offline')).toBe('The server cannot be reached.');
    expect(text(500, 'no_server')).toBe('The server cannot be reached.');
    // Unknown codes and non-API failures still name what happened.
    expect(text(500, 'teapot')).toBe('Something went wrong (teapot).');
    expect(alphaErrorText(new TypeError('boom'))).toBe('Something went wrong (error).');
  });

  it('R-FMT-007 an invite line names the format and the level the creator picked', () => {
    expect(formatLine('first_blood', 12)).toBe('First Blood · level 12');
    expect(formatLine('full', 30)).toBe('Full Battle · level 30');
    expect(formatLine('vanguard', 1)).toBe('Vanguard · level 1');
  });

  it('R-FMT-007 R-LOAD-004 the default alpha loadout is legal at every level a creator may pick', () => {
    for (const level of [1, 10, 12, CAPS.LEVEL_CAP]) {
      const l = alphaLoadout(level);
      expect(l.level).toBe(level);
      expect(l.name).toBe('Alpha loadout');
      expect(engine.validateLoadout(l.loadout, { level })).toMatchObject({ ok: true });
    }
  });

  it('R-FMT-007 R-SEC-006 alpha battle tickets come from the alpha routes, every other ticket from /api/battles', () => {
    expect(ticketPath('a-Ab3dEf7hij')).toBe('/api/alpha/battles/a-Ab3dEf7hij/ticket');
    expect(ticketPath('a-abc123')).toBe('/api/alpha/battles/a-abc123/ticket');
    expect(ticketPath('c-Ab3dEf7hij')).toBe('/api/battles/c-Ab3dEf7hij/ticket');
    expect(ticketPath('0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).toBe(
      '/api/battles/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/ticket',
    );
    // Not an alpha id (bad shape): the account route, and the id is escaped either way.
    expect(ticketPath('a-')).toBe('/api/battles/a-/ticket');
    expect(ticketPath('a-has space')).toBe('/api/battles/a-has%20space/ticket');
  });
});
