/**
 * Scheduled tournaments (M7 7.1; spec 10.4 R-WORLD-004: "scheduled Swiss and single-elimination
 * events per bracket"), pure: the next daily occurrence of each schedule entry for every slot bracket,
 * when it falls within `aheadMs`. The key names the event uniquely, so creating it is idempotent (a
 * UNIQUE column): whoever lists the events first creates them, however many requests race.
 */
import { FORMATS } from '@chain-theorem/content';
import type { Bracket, TournamentSystem } from '@chain-theorem/protocol';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export interface ScheduleEntry {
  system: TournamentSystem;
  format: string;
  hourUtc: number;
  maxPlayers: number;
}

export interface ScheduledEvent {
  key: string;
  name: string;
  system: TournamentSystem;
  format: string;
  bracket: Bracket;
  startsAt: number;
  maxPlayers: number;
}

const FORMAT_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.values(FORMATS).map((f) => [f.id, f.name]),
);

/** A format's display name (the id when unknown). */
export function formatName(format: string): string {
  return FORMAT_NAMES[format] ?? format;
}

export const SYSTEM_NAME: Record<TournamentSystem, string> = {
  swiss: 'Swiss',
  se: 'Knockout',
};

/** A tournament's default name: `Full Battle Swiss · 1-2 slots` (daily events say so). */
export function tournamentName(
  formatName: string,
  system: TournamentSystem,
  bracket: Bracket,
  daily = false,
): string {
  return `${daily ? 'Daily ' : ''}${formatName} ${SYSTEM_NAME[system]} · ${bracket} slots`;
}

export function scheduledEvents(
  now: number,
  schedule: readonly ScheduleEntry[],
  brackets: readonly Bracket[],
  aheadMs: number,
  formatName: (format: string) => string,
): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  const midnight = Math.floor(now / DAY_MS) * DAY_MS;
  for (const entry of schedule) {
    let at = midnight + entry.hourUtc * HOUR_MS;
    if (at <= now) at += DAY_MS;
    if (at - now > aheadMs) continue;
    const day = new Date(at).toISOString().slice(0, 10);
    for (const bracket of brackets)
      out.push({
        key: `daily:${entry.system}:${entry.format}:${bracket}:${day}`,
        name: tournamentName(formatName(entry.format), entry.system, bracket, true),
        system: entry.system,
        format: entry.format,
        bracket,
        startsAt: at,
        maxPlayers: entry.maxPlayers,
      });
  }
  return out;
}
