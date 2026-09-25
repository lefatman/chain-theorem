/**
 * Sign-up age (DD-06, R-SEC-011): at least 13, or the local age of digital consent where higher.
 * Only the date the account turns 18 (`adult_from`) is stored, never the birth date.
 *
 * Ages of digital consent follow the national implementations of GDPR Article 8 for the EU/EEA and
 * the UK; everywhere else the minimum is 13. Legal review before launch is a human-only item.
 */
export const MIN_AGE = 13;

const CONSENT_AGE: Readonly<Record<string, number>> = {
  AT: 14,
  BE: 13,
  BG: 14,
  CY: 14,
  CZ: 15,
  DE: 16,
  DK: 13,
  EE: 13,
  ES: 14,
  FI: 13,
  FR: 15,
  GB: 13,
  GR: 15,
  HR: 16,
  HU: 16,
  IE: 16,
  IS: 13,
  IT: 14,
  LI: 16,
  LT: 14,
  LU: 16,
  LV: 13,
  MT: 13,
  NL: 16,
  NO: 13,
  PL: 16,
  PT: 13,
  RO: 16,
  SE: 13,
  SI: 15,
  SK: 16,
};

/** Minimum sign-up age for an ISO 3166-1 alpha-2 country code (from the request, `cf.country`). */
export function minimumAge(country: string | null | undefined): number {
  const local = country ? CONSENT_AGE[country.toUpperCase()] : undefined;
  return Math.max(MIN_AGE, local ?? MIN_AGE);
}

/** Parse YYYY-MM-DD as a UTC calendar date; null if it is not a real date. */
function parseDate(dob: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** Epoch ms at which someone born on `dob` reaches `years` (29 Feb birthdays count from 1 Mar). */
export function birthdayAt(dob: string, years: number): number | null {
  const p = parseDate(dob);
  if (!p) return null;
  return Date.UTC(p.y + years, p.m - 1, p.d);
}

export type AgeCheck =
  { ok: true; adultFrom: number } | { ok: false; reason: 'bad_date' | 'too_young' | 'future' };

/** Check a date of birth at sign-up and derive `adult_from` (the only age data stored). */
export function checkAge(dob: string, now: number, country: string | null | undefined): AgeCheck {
  const adultFrom = birthdayAt(dob, 18);
  const minAt = birthdayAt(dob, minimumAge(country));
  const born = birthdayAt(dob, 0);
  if (adultFrom === null || minAt === null || born === null || born < Date.UTC(1900, 0, 1))
    return { ok: false, reason: 'bad_date' };
  if (born > now) return { ok: false, reason: 'future' };
  if (minAt > now) return { ok: false, reason: 'too_young' };
  return { ok: true, adultFrom };
}
