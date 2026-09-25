/**
 * The admin console's tournaments page (M7 7.1; ADMIN_EMAILS only, like the rest of `/admin`):
 * server-rendered with the strict CSP and no script. Lists the events (running, open, recent ones)
 * with a cancel button, and a form that creates one; both post back and redirect (303).
 */
import { TOURNAMENTS } from '@chain-theorem/content';
import type { Tournament } from '@chain-theorem/db';
import { CreateTournament } from '@chain-theorem/protocol';
import { HttpError } from '../http.ts';
import { SYSTEM_NAME, formatName } from '../tournament/schedule.ts';
import { esc, page } from './pages.ts';

const when = (ms: number | null): string =>
  ms === null ? '—' : `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function row(t: Tournament): string {
  const live = t.status === 'open' || t.status === 'running';
  const cancel = live
    ? `<form method="post" action="/admin/tournaments/${encodeURIComponent(t.id)}/cancel"><button type="submit" class="danger">Cancel</button></form>`
    : '';
  const progress =
    t.status === 'running'
      ? `round ${t.round} of ${t.rounds}`
      : t.status === 'finished' && t.winnerName
        ? `won by ${esc(t.winnerName)}`
        : '';
  return `<tr><td>${esc(t.name)}${t.scheduleKey ? ' <span class="muted">(daily)</span>' : ''}</td><td>${esc(formatName(t.format))}</td><td>${esc(t.bracket)}</td><td>${esc(SYSTEM_NAME[t.system])}</td><td>${esc(t.status)} ${progress}</td><td>${esc(when(t.startsAt))}</td><td>${t.players}/${t.maxPlayers}</td><td>${cancel}</td></tr>`;
}

export function tournamentsPage(list: readonly Tournament[], notice?: string): string {
  const table =
    list.length === 0
      ? '<p class="muted">No tournaments yet.</p>'
      : `<table><thead><tr><th scope="col">Name</th><th scope="col">Format</th><th scope="col">Slots</th><th scope="col">System</th><th scope="col">Status</th><th scope="col">Start</th><th scope="col">Players</th><th scope="col"></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table>`;
  const formats = TOURNAMENTS.formats
    .map((f) => `<option value="${esc(f)}">${esc(formatName(f))}</option>`)
    .join('');
  const form = `<form method="post" action="/admin/tournaments" class="card"><h2>New tournament</h2>
<label for="t-name">Name (optional)</label><input id="t-name" type="text" name="name" maxlength="40">
<label for="t-format">Format</label><select id="t-format" name="format">${formats}</select>
<label for="t-bracket">Slot bracket</label><select id="t-bracket" name="bracket"><option>1-2</option><option>3-4</option><option>5-6</option></select>
<label for="t-system">System</label><select id="t-system" name="system"><option value="swiss">Swiss</option><option value="se">Single elimination</option></select>
<label for="t-start">Starts in (minutes)</label><input id="t-start" type="number" name="startInMinutes" min="0" step="1" value="15" required>
<label for="t-max">Players at most</label><input id="t-max" type="number" name="maxPlayers" min="2" max="${TOURNAMENTS.maxPlayersLimit}" value="${TOURNAMENTS.maxPlayers}" required>
<label for="t-rounds">Swiss rounds (empty: ceil(log2 players) + ${TOURNAMENTS.extraSwissRounds})</label><input id="t-rounds" type="number" name="rounds" min="1" max="12">
<label for="t-break">Break before each round (seconds)</label><input id="t-break" type="number" name="breakSeconds" min="0" max="600" value="${TOURNAMENTS.breakMs / 1000}" required>
<div class="row"><button type="submit">Create</button></div></form>`;
  return page('Tournaments', `<h1>Tournaments</h1>${form}<h2>Events</h2>${table}`, notice);
}

/** The create form as a `CreateTournament` body; 400 when anything is off. */
export function createFromForm(f: URLSearchParams): CreateTournament {
  const num = (k: string) => {
    const v = (f.get(k) ?? '').trim();
    return v === '' ? undefined : Number(v);
  };
  const minutes = num('startInMinutes');
  const seconds = num('breakSeconds');
  const rounds = num('rounds');
  const name = (f.get('name') ?? '').trim();
  const r = CreateTournament.safeParse({
    ...(name ? { name } : {}),
    format: f.get('format'),
    bracket: f.get('bracket'),
    system: f.get('system'),
    ...(minutes !== undefined ? { startInMs: Math.round(minutes * 60_000) } : {}),
    ...(num('maxPlayers') !== undefined ? { maxPlayers: num('maxPlayers') } : {}),
    ...(rounds !== undefined ? { rounds } : {}),
    ...(seconds !== undefined ? { breakMs: Math.round(seconds * 1000) } : {}),
  });
  if (!r.success) throw new HttpError(400, 'bad_request');
  return r.data;
}
