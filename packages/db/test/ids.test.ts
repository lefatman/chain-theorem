/** Ids, token hashing and age data: pure helpers used by every repository. */
import { describe, expect, it } from 'vitest';
import {
  adultFromBirthDate,
  isAdultAt,
  randomToken,
  sha256Hex,
  uuidv7,
  uuidv7Time,
} from '../src/index.ts';

const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('UUIDv7 ids (R-DATA-004)', () => {
  it('R-DATA-004 ids are RFC 9562 version 7 with the variant bits set', () => {
    for (let i = 0; i < 100; i++) expect(uuidv7()).toMatch(UUIDV7);
  });

  it('R-DATA-004 ids encode their creation time in epoch milliseconds', () => {
    const now = Date.UTC(2026, 8, 25, 12, 0, 0);
    expect(uuidv7Time(uuidv7(now + 1000))).toBe(now + 1000);
  });

  it('R-DATA-004 ids made in the same millisecond still sort in creation order', () => {
    const now = Date.UTC(2030, 0, 1);
    const ids = Array.from({ length: 10_000 }, () => uuidv7(now));
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('R-DATA-004 a clock that goes backwards never produces a smaller id', () => {
    const a = uuidv7(Date.UTC(2031, 0, 1));
    const b = uuidv7(Date.UTC(2020, 0, 1));
    expect(b > a).toBe(true);
  });
});

describe('tokens (R-SEC-006)', () => {
  it('R-SEC-006 tokens are 32 random bytes in base64url', () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(t);
  });

  it('R-SEC-006 sha256Hex matches the published test vector', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('age data (R-SEC-011)', () => {
  it('R-SEC-011 adult_from is 00:00 UTC on the 18th birthday', () => {
    expect(adultFromBirthDate('2010-06-15')).toBe(Date.UTC(2028, 5, 15));
  });

  it('R-SEC-011 a 29 February birthday turns 18 on 1 March in a non-leap year', () => {
    expect(adultFromBirthDate('2008-02-29')).toBe(Date.UTC(2026, 2, 1));
  });

  it('R-SEC-011 malformed and impossible dates are rejected', () => {
    expect(() => adultFromBirthDate('2010-13-01')).toThrow(RangeError);
    expect(() => adultFromBirthDate('2010-02-30')).toThrow(RangeError);
    expect(() => adultFromBirthDate('15/06/2010')).toThrow(RangeError);
  });

  it('R-SEC-011 isAdultAt switches exactly at adult_from', () => {
    const adultFrom = adultFromBirthDate('2008-09-25');
    expect(isAdultAt(adultFrom, adultFrom - 1)).toBe(false);
    expect(isAdultAt(adultFrom, adultFrom)).toBe(true);
  });
});
