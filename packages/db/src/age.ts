/**
 * Age data (R-SEC-011, COMMITTED): the date of birth is collected at sign-up but only the instant
 * the account turns 18 (`adult_from`, epoch ms) is stored. The birth date never reaches the database.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Epoch ms of 00:00 UTC on the 18th birthday for an ISO `YYYY-MM-DD` birth date. A 29 February
 * birthday becomes 1 March in a non-leap year (the later of the two candidate dates). Throws on a
 * malformed or impossible date.
 */
export function adultFromBirthDate(isoDate: string): number {
  const m = ISO_DATE.exec(isoDate);
  if (!m) throw new RangeError(`not a YYYY-MM-DD date: ${isoDate}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) {
    throw new RangeError(`not a calendar date: ${isoDate}`);
  }
  // Date.UTC rolls 29 Feb over to 1 Mar when year + 18 is not a leap year.
  return Date.UTC(year + 18, month - 1, day);
}

/** Whether an account with this `adult_from` is 18 or over at `now` (epoch ms). */
export function isAdultAt(adultFrom: number, now: number): boolean {
  return now >= adultFrom;
}
