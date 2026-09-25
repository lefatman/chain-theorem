/**
 * Leaderboards (M6 6.1, spec 10.4 R-WORLD-004): per format and bracket, players and guilds. Only
 * settled players are listed (enough rated games and a low enough rating deviation); your own row is
 * highlighted and your standing is shown even when you are not listed.
 */
import { useEffect, useState } from 'preact/hooks';
import { FORMATS } from '@chain-theorem/content';
import type {
  Bracket,
  Format,
  GuildLeaderboard,
  Leaderboard,
  MyRatings,
} from '@chain-theorem/protocol';
import { go, route } from '../app/router.ts';
import { ApiError, api } from '../net/api.ts';
import { account, refreshAccount } from '../state/account.ts';
import { ratingText } from './RankedPanel.tsx';

const BRACKETS: Bracket[] = ['1-2', '3-4', '5-6'];
type Kind = 'players' | 'guilds';

function isBracket(s: string | null): s is Bracket {
  return s !== null && (BRACKETS as string[]).includes(s);
}

export function LeaderboardsScreen() {
  const acc = account.value;
  const params = route.value.params;
  const [info, setInfo] = useState<MyRatings | null>(null);
  const [format, setFormat] = useState<Format>(
    (params.get('format') as Format | null) ?? 'vanguard',
  );
  const [bracket, setBracket] = useState<Bracket | null>(
    isBracket(params.get('bracket')) ? (params.get('bracket') as Bracket) : null,
  );
  const [kind, setKind] = useState<Kind>('players');
  const [players, setPlayers] = useState<Leaderboard | null>(null);
  const [guilds, setGuilds] = useState<GuildLeaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (acc.kind === 'unknown') void refreshAccount();
  }, [acc.kind]);

  useEffect(() => {
    if (acc.kind !== 'signed_in') return;
    api.myRatings().then(
      (r) => {
        setInfo(r);
        setBracket((b) => b ?? r.bracket);
        if (!r.formats.includes(format) && r.formats[0]) setFormat(r.formats[0]);
      },
      () => setBracket((b) => b ?? '1-2'),
    );
  }, [acc.kind]);

  useEffect(() => {
    if (acc.kind !== 'signed_in' || !bracket) return;
    setError(null);
    const fail = (e: unknown) =>
      setError(
        e instanceof ApiError && e.code === 'offline'
          ? 'The server cannot be reached.'
          : 'The leaderboard could not be loaded.',
      );
    if (kind === 'players') api.leaderboard(format, bracket).then(setPlayers, fail);
    else api.guildLeaderboard(format, bracket).then(setGuilds, fail);
  }, [acc.kind, format, bracket, kind]);

  if (acc.kind !== 'signed_in')
    return (
      <main class="setup">
        <h2>Leaderboards</h2>
        <p>{acc.kind === 'unknown' ? 'Connecting…' : 'Sign in to see the leaderboards.'}</p>
        <button onClick={() => go('online')}>Back</button>
      </main>
    );

  const me = acc.me;
  const formats = info?.formats ?? (['vanguard', 'full'] as Format[]);
  const board = kind === 'players' ? players : guilds;
  const fresh = board && board.format === format && board.bracket === bracket;
  const title = `${FORMATS[format]?.name ?? format}, ${bracket ?? '…'} item slots`;

  return (
    <main class="setup wide leaderboards">
      <div class="screen-head">
        <h2>Leaderboards</h2>
        <p class="muted small-text">
          Glicko-2 ratings per format and bracket. Players appear after{' '}
          {players?.rules.minGames ?? 5} rated games with a rating deviation of at most{' '}
          {players?.rules.maxRd ?? 200}.
        </p>
      </div>
      <div class="row start">
        <label class="inline">
          Format
          <select
            value={format}
            onChange={(e) => setFormat((e.target as HTMLSelectElement).value as Format)}
          >
            {formats.map((f) => (
              <option key={f} value={f}>
                {FORMATS[f]?.name ?? f}
              </option>
            ))}
          </select>
        </label>
        <label class="inline">
          Bracket
          <select
            value={bracket ?? ''}
            onChange={(e) => setBracket((e.target as HTMLSelectElement).value as Bracket)}
          >
            {BRACKETS.map((b) => (
              <option key={b} value={b}>
                {b} item slots{info?.bracket === b ? ' (yours)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div class="seg" role="group" aria-label="Show">
          <button
            type="button"
            aria-pressed={kind === 'players'}
            onClick={() => setKind('players')}
          >
            Players
          </button>
          <button type="button" aria-pressed={kind === 'guilds'} onClick={() => setKind('guilds')}>
            Guilds
          </button>
        </div>
      </div>
      {error && (
        <p class="note warn" role="alert">
          {error}
        </p>
      )}
      {kind === 'players' && players && fresh && (
        <p class="note" role="status">
          {players.me
            ? `You: ${ratingText(players.me)}${players.me.rank === null ? ' · not listed yet' : ''}`
            : 'You have no rated games in this format and bracket yet.'}
        </p>
      )}
      {kind === 'guilds' && guilds && fresh && (
        <p class="note" role="status">
          {guilds.mine
            ? `Your guild [${guilds.mine.tag}] is #${guilds.mine.rank} with ${guilds.mine.score}.`
            : `Guilds are listed with at least ${guilds.rules.minRated} listed members; the score is the mean of their best ${guilds.rules.top}.`}
        </p>
      )}
      {!fresh ? (
        <p class="muted">Loading…</p>
      ) : kind === 'players' && players ? (
        players.entries.length === 0 ? (
          <p class="muted">Nobody is listed here yet.</p>
        ) : (
          <div class="table-wrap">
            <table class="board">
              <caption class="sr-only">Players, {title}</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col">Rating</th>
                  <th scope="col">Games</th>
                </tr>
              </thead>
              <tbody>
                {players.entries.map((e) => {
                  const own = e.id === me.id;
                  return (
                    <tr key={e.id} class={own ? 'own' : ''} aria-current={own ? 'true' : undefined}>
                      <td>{e.rank}</td>
                      <th scope="row">
                        {e.name}
                        {e.tag && <span class="tag"> [{e.tag}]</span>}
                        {own && <span class="you"> (you)</span>}
                      </th>
                      <td>
                        {e.rating} <span class="muted small-text">± {e.rd}</span>
                      </td>
                      <td>{e.games}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : guilds && guilds.entries.length === 0 ? (
        <p class="muted">No guild is listed here yet.</p>
      ) : (
        guilds && (
          <div class="table-wrap">
            <table class="board">
              <caption class="sr-only">Guilds, {title}</caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Guild</th>
                  <th scope="col">Score</th>
                  <th scope="col">Rated</th>
                </tr>
              </thead>
              <tbody>
                {guilds.entries.map((e) => {
                  const own = e.id === guilds.mine?.id;
                  return (
                    <tr key={e.id} class={own ? 'own' : ''} aria-current={own ? 'true' : undefined}>
                      <td>{e.rank}</td>
                      <th scope="row">
                        {e.name} <span class="tag">[{e.tag}]</span>
                        {own && <span class="you"> (yours)</span>}
                      </th>
                      <td>{e.score}</td>
                      <td>{e.rated}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}
      <div class="row start">
        <button onClick={() => go('online')}>Back</button>
      </div>
    </main>
  );
}
