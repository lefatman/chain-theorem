/**
 * Words for the Tournaments screen (M7 7.1), pure: round names, results, places, countdowns. Results
 * are always spelled out in text (never colour alone, 11.2 spirit).
 */
import type { TournamentPairing, TournamentSystem, TournamentView } from '@chain-theorem/protocol';

export const SYSTEM_LABEL: Record<TournamentSystem, string> = {
  swiss: 'Swiss',
  se: 'Knockout',
};

/** A knockout round by how many rounds remain: Final, Semi-finals, Quarter-finals, Round of 16. */
export function roundName(system: TournamentSystem, n: number, rounds: number): string {
  if (system === 'swiss' || rounds === 0) return `Round ${n}`;
  const left = rounds - n;
  if (left === 0) return 'Final';
  if (left === 1) return 'Semi-finals';
  if (left === 2) return 'Quarter-finals';
  return `Round of ${2 ** (left + 1)}`;
}

/** A pairing's score as text: "1–0", "½–½", "0–1", with forfeits and byes spelled out. */
export function resultText(p: TournamentPairing, started: boolean): string {
  const forfeit = p.absent.length === 1 ? ' (forfeit)' : '';
  switch (p.result) {
    case 'white':
      return `1–0${forfeit}`;
    case 'black':
      return `0–1${forfeit}`;
    case 'draw':
      return '½–½';
    case 'none':
      return '0–0 (neither played)';
    case 'bye':
      return 'bye';
    default:
      return started ? 'playing' : 'not started';
  }
}

/** Who goes through in a knockout pairing (null: nobody or not decided). */
export function advancing(
  p: TournamentPairing,
  drawAdvances: 'white' | 'black' = 'black',
): string | null {
  switch (p.result) {
    case 'white':
    case 'bye':
      return p.white.id;
    case 'black':
      return p.black?.id ?? null;
    case 'draw':
      return drawAdvances === 'white' ? p.white.id : (p.black?.id ?? null);
    default:
      return null;
  }
}

export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** "in 2 min 5 s", "in 12 s", "now". */
export function countdown(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `in ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m} min${s % 60 ? ` ${s % 60} s` : ''}`;
  const h = Math.floor(m / 60);
  return `in ${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

/** Why registration is refused, in words. */
export function cannotText(code: string | null): string | null {
  const known: Record<string, string> = {
    closed: 'Registration is closed.',
    full: 'The tournament is full.',
    wrong_bracket: 'This event is for another slot bracket than your level.',
    already: 'You are registered.',
    not_registered: 'You are not registered.',
    subscription_required: 'Your trial has ended. Subscribe to play tournaments.',
    suspended: 'This account is suspended.',
  };
  return code === null ? null : (known[code] ?? `Not possible (${code}).`);
}

/** One line on where the event stands. */
export function statusLine(v: TournamentView, now: number): string {
  switch (v.status) {
    case 'open':
      return `Registration open · starts ${countdown(v.startsAt - now)}`;
    case 'running':
      return `${roundName(v.system, v.round, v.rounds)} of ${v.rounds} ${v.system === 'swiss' ? 'rounds' : '(knockout)'}`;
    case 'finished':
      return v.winner ? `Finished · won by ${v.winner.name}` : 'Finished · no winner';
    case 'cancelled':
      return 'Cancelled';
  }
}
