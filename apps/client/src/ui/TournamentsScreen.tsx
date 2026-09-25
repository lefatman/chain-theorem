/**
 * Tournaments (M7 7.1; spec 10.4 R-WORLD-004): scheduled and admin-created Swiss and knockout events
 * per format and slot bracket. The list (upcoming, live, finished) and one event's page: register or
 * withdraw, your next pairing during the break, "Play your game" when your round starts, a Swiss
 * standings table or a knockout bracket, every round's results and the prizes. The page polls the
 * server (the TournamentRoom holds no sockets); results are spelled out in text.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FORMATS } from '@chain-theorem/content';
import type {
  TournamentList,
  TournamentRound,
  TournamentSummary,
  TournamentView,
} from '@chain-theorem/protocol';
import { go, route } from '../app/router.ts';
import { ApiError, api } from '../net/api.ts';
import { account, refreshAccount } from '../state/account.ts';
import { tournamentBattle } from '../state/tournament.ts';
import { startOnlineBattle } from './battleSession.ts';
import {
  SYSTEM_LABEL,
  advancing,
  cannotText,
  countdown,
  ordinal,
  resultText,
  roundName,
  statusLine,
} from './tournamentText.ts';

type Tab = 'upcoming' | 'live' | 'finished';

const formatLabel = (f: string) =>
  (FORMATS as Record<string, { name: string } | undefined>)[f]?.name ?? f;

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  if (code === 'offline') return 'The server cannot be reached.';
  if (code === 'no_game') return 'Your game is not ready (or already over).';
  return cannotText(code) ?? `Something went wrong (${code}).`;
}

/** Server time now, from the offset measured when the view arrived. */
function useClock(offset: number): number {
  const [now, setNow] = useState(Date.now() + offset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  return now;
}

export function TournamentsScreen() {
  const acc = account.value;
  const id = route.value.params.get('id');
  useEffect(() => {
    if (acc.kind === 'unknown') void refreshAccount();
  }, [acc.kind]);
  if (acc.kind !== 'signed_in')
    return (
      <main class="setup">
        <h2>Tournaments</h2>
        <p>{acc.kind === 'unknown' ? 'Connecting…' : 'Sign in to see the tournaments.'}</p>
        <button onClick={() => go('online')}>Back</button>
      </main>
    );
  return id ? <TournamentPage id={id} me={acc.me.id} /> : <TournamentListView />;
}

function TournamentListView() {
  const [list, setList] = useState<TournamentList | null>(null);
  const [tab, setTab] = useState<Tab>('upcoming');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.tournaments().then(
      (l) => {
        setList(l);
        setError(null);
      },
      (e: unknown) => setError(errorText(e)),
    );
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, []);

  const act = async (f: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const rows = list ? list[tab] : [];
  return (
    <main class="setup wide tournaments">
      <div class="screen-head">
        <h2>Tournaments</h2>
        <p class="muted small-text">
          Swiss and knockout events per format and slot bracket, with prizes for the top three.
          {list ? ` Your bracket: ${list.bracket} item slots.` : ''}
        </p>
      </div>
      <div class="seg" role="group" aria-label="Show">
        {(['upcoming', 'live', 'finished'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'upcoming' ? 'Upcoming' : t === 'live' ? 'Live' : 'Finished'}
            {list ? ` (${list[t].length})` : ''}
          </button>
        ))}
      </div>
      {error && (
        <p class="note warn" role="alert">
          {error}
        </p>
      )}
      {!list ? (
        <p class="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p class="muted">
          {tab === 'upcoming'
            ? 'No tournament is open for registration right now.'
            : tab === 'live'
              ? 'No tournament is being played right now.'
              : 'No finished tournament yet.'}
        </p>
      ) : (
        <ul class="tournament-list">
          {rows.map((t) => (
            <TournamentRow
              key={t.id}
              t={t}
              mine={list.bracket}
              busy={busy}
              onRegister={() => act(() => api.registerTournament(t.id))}
              onLeave={() => act(() => api.leaveTournament(t.id))}
            />
          ))}
        </ul>
      )}
      <div class="row start">
        <button onClick={() => go('online')}>Back</button>
      </div>
    </main>
  );
}

function TournamentRow(props: {
  t: TournamentSummary;
  mine: string;
  busy: boolean;
  onRegister: () => void;
  onLeave: () => void;
}) {
  const { t } = props;
  const other = t.bracket !== props.mine;
  return (
    <li class="tournament-card">
      <h3>
        <a href={`#/tournaments?id=${encodeURIComponent(t.id)}`}>{t.name}</a>
      </h3>
      <p class="small-text">
        {formatLabel(t.format)} · {SYSTEM_LABEL[t.system]} · {t.bracket} slots · {t.players}/
        {t.maxPlayers} players
      </p>
      <p class="small-text muted">
        {t.status === 'open'
          ? `Starts ${when(t.startsAt)}`
          : t.status === 'running'
            ? `${roundName(t.system, t.round, t.rounds)} of ${t.rounds}`
            : t.status === 'cancelled'
              ? 'Cancelled'
              : t.winner
                ? `Won by ${t.winner.name}`
                : 'Finished'}
        {t.registered && <span class="you"> · you are in</span>}
      </p>
      <div class="row start">
        {t.status === 'open' &&
          (t.registered ? (
            <button disabled={props.busy} onClick={props.onLeave}>
              Unregister
            </button>
          ) : (
            <button
              class="primary"
              disabled={props.busy || other || t.players >= t.maxPlayers}
              onClick={props.onRegister}
              aria-describedby={other ? `why-${t.id}` : undefined}
            >
              Register
            </button>
          ))}
        <button onClick={() => go('tournaments', { id: t.id })}>
          {t.status === 'open' ? 'Details' : t.system === 'swiss' ? 'Standings' : 'Bracket'}
        </button>
        {t.status === 'open' && !t.registered && other && (
          <span id={`why-${t.id}`} class="small-text muted">
            For {t.bracket} slots (you: {props.mine})
          </span>
        )}
      </div>
    </li>
  );
}

function TournamentPage(props: { id: string; me: string }) {
  const [v, setV] = useState<TournamentView | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const now = useClock(offset);

  const load = () =>
    api.tournament(props.id).then(
      (x) => {
        if (!alive.current) return;
        setV(x);
        setOffset(x.now - Date.now());
      },
      (e: unknown) => alive.current && setError(errorText(e)),
    );
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [props.id]);
  // Poll while the event is open or running (quicker around a round's start).
  const live = v ? v.status === 'open' || v.status === 'running' : true;
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void load(), v?.status === 'running' ? 2000 : 4000);
    return () => clearInterval(t);
  }, [props.id, live, v?.status]);

  const act = async (f: () => Promise<TournamentView>) => {
    setBusy(true);
    setError(null);
    try {
      const x = await f();
      setV(x);
      setOffset(x.now - Date.now());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const play = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await api.tournamentTicket(props.id);
      const c = startOnlineBattle(t.battleId, t);
      tournamentBattle.value = { controller: c, tournamentId: props.id };
      go('battle');
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (!v)
    return (
      <main class="setup">
        <h2>Tournament</h2>
        {error ? (
          <p class="note warn" role="alert">
            {error}
          </p>
        ) : (
          <p class="muted">Loading…</p>
        )}
        <button onClick={() => go('tournaments')}>All tournaments</button>
      </main>
    );

  return (
    <main class="setup wide tournaments">
      <div class="screen-head">
        <h2>{v.name}</h2>
        <p class="small-text">
          {formatLabel(v.format)} · {SYSTEM_LABEL[v.system]} · {v.bracket} item slots · {v.players}/
          {v.maxPlayers} players
        </p>
        <p class="muted small-text">{statusLine(v, now)}</p>
      </div>
      {error && (
        <p class="note warn" role="alert">
          {error}
        </p>
      )}
      <section class="panel tournament-you" aria-label="Your tournament">
        <YouPanel
          v={v}
          now={now}
          busy={busy}
          onPlay={() => void play()}
          onRegister={() => void act(() => api.registerTournament(v.id))}
          onLeave={() => void act(() => api.leaveTournament(v.id))}
        />
      </section>
      {v.status === 'open' ? (
        <section aria-label="Registered players">
          <h3>Registered ({v.entrants.length})</h3>
          {v.entrants.length === 0 ? (
            <p class="muted">Nobody yet.</p>
          ) : (
            <ul class="entrant-list">
              {v.entrants.map((e) => (
                <li key={e.id} class={e.id === props.me ? 'own' : ''}>
                  {e.name} <span class="muted small-text">level {e.level}</span>
                  {e.id === props.me && <span class="you"> (you)</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : v.system === 'swiss' ? (
        <Standings v={v} me={props.me} />
      ) : (
        <Bracket v={v} me={props.me} />
      )}
      {v.system === 'swiss' && v.roundList.length > 0 && (
        <section aria-label="Rounds">
          <h3>Rounds</h3>
          {[...v.roundList].reverse().map((r) => (
            <RoundResults key={r.n} v={v} r={r} me={props.me} />
          ))}
        </section>
      )}
      {v.prizes.length > 0 && v.status !== 'cancelled' && (
        <section aria-label="Prizes">
          <h3>Prizes</h3>
          <ul class="prize-list">
            {v.prizes.map((p) => (
              <li key={p.place}>
                {ordinal(p.place)} place: {p.xp} XP and {p.coins} coins
              </li>
            ))}
          </ul>
          <p class="muted small-text">
            {v.system === 'swiss'
              ? 'Ties are broken by Buchholz (the sum of your opponents’ points), then Sonneborn-Berger, then seed.'
              : 'Seeds follow the rating; byes go to the top seeds; a drawn game sends Black through.'}
          </p>
        </section>
      )}
      <div class="row start">
        <button onClick={() => go('tournaments')}>All tournaments</button>
        <button onClick={() => go('online')}>Online play</button>
      </div>
    </main>
  );
}

function YouPanel(props: {
  v: TournamentView;
  now: number;
  busy: boolean;
  onPlay: () => void;
  onRegister: () => void;
  onLeave: () => void;
}) {
  const { v, now, busy } = props;
  const you = v.you;
  if (v.status === 'open') {
    if (you.registered)
      return (
        <div role="status">
          <p>You are registered. Round 1 is paired at the start ({countdown(v.startsAt - now)}).</p>
          <button disabled={busy} onClick={props.onLeave}>
            Unregister
          </button>
        </div>
      );
    const why = cannotText(you.cannot);
    return (
      <div role="status">
        <p>{why ?? 'Registration is open. Your newest legal loadout is used in every game.'}</p>
        <button class="primary" disabled={busy || why !== null} onClick={props.onRegister}>
          Register
        </button>
      </div>
    );
  }
  if (v.status === 'running') {
    if (you.game)
      return (
        <div role="status">
          <p>
            <strong>
              {roundName(v.system, you.game.round, v.rounds)}: your game against {you.game.opponent}{' '}
              is ready.
            </strong>{' '}
            You play {you.game.colour === 'white' ? 'White' : 'Black'}. Join within a minute or the
            game is lost.
          </p>
          <button class="primary" disabled={busy} onClick={props.onPlay}>
            Play your game
          </button>
        </div>
      );
    if (you.next)
      return (
        <p role="status">
          {roundName(v.system, you.next.round, v.rounds)} starts{' '}
          {countdown(you.next.startsAt - now)}:{' '}
          {you.next.opponent === null
            ? 'you have a bye.'
            : `you play ${you.next.colour === 'white' ? 'White' : 'Black'} against ${you.next.opponent}.`}
        </p>
      );
    if (!you.registered) return <p role="status">You are not playing in this tournament.</p>;
    if (you.withdrawn) return <p role="status">You have withdrawn from this tournament.</p>;
    return (
      <div role="status">
        <p>Waiting for the other games of the round to finish.</p>
        <button disabled={busy} onClick={props.onLeave}>
          Withdraw
        </button>
      </div>
    );
  }
  if (v.status === 'finished')
    return (
      <p role="status">
        {v.winner
          ? `${v.winner.name} won the tournament.`
          : 'The tournament ended without a winner.'}
        {you.place !== null ? ` You finished ${ordinal(you.place)}.` : ''}
      </p>
    );
  return <p role="status">This tournament was cancelled.</p>;
}

function Standings(props: { v: TournamentView; me: string }) {
  const { v } = props;
  return (
    <section aria-label="Standings">
      <h3>Standings</h3>
      <div class="table-wrap">
        <table class="board">
          <caption class="sr-only">Standings of {v.name}</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Player</th>
              <th scope="col">Points</th>
              <th scope="col">
                <abbr title="Buchholz: the sum of the opponents' points">Buch.</abbr>
              </th>
              <th scope="col">
                <abbr title="Sonneborn-Berger">SB</abbr>
              </th>
              <th scope="col">Won</th>
            </tr>
          </thead>
          <tbody>
            {v.standings.map((s) => {
              const own = s.id === props.me;
              return (
                <tr key={s.id} class={own ? 'own' : ''} aria-current={own ? 'true' : undefined}>
                  <td>{s.rank}</td>
                  <th scope="row">
                    {s.name}
                    {own && <span class="you"> (you)</span>}
                    {s.withdrawn && <span class="muted small-text"> withdrawn</span>}
                  </th>
                  <td>{s.points}</td>
                  <td>{s.buchholz}</td>
                  <td>{s.sb}</td>
                  <td>
                    {s.wins}/{s.games}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RoundResults(props: { v: TournamentView; r: TournamentRound; me: string }) {
  const { v, r } = props;
  const label = roundName(v.system, r.n, v.rounds);
  return (
    <details class="round" open={r.n === v.round}>
      <summary>
        {label}
        {r.finished ? ' · finished' : r.started ? ' · playing' : ` · starts ${when(r.startsAt)}`}
      </summary>
      <ol class="pairings">
        {r.pairings.map((p) => {
          const own = p.white.id === props.me || p.black?.id === props.me;
          return (
            <li key={p.board} class={own ? 'own' : ''}>
              <span class="board-no">Board {p.board}:</span>{' '}
              {p.black === null ? (
                <>
                  {p.white.name} <span class="muted">has a bye</span>
                </>
              ) : (
                <>
                  {p.white.name} <span class="muted small-text">(White)</span> – {p.black.name}{' '}
                  <span class="muted small-text">(Black)</span>{' '}
                  <strong>{resultText(p, r.started)}</strong>
                </>
              )}
              {own && <span class="you"> (you)</span>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

/** A knockout bracket: one column per round (stacked on narrow screens), winners marked in text. */
function Bracket(props: { v: TournamentView; me: string }) {
  const { v } = props;
  const rounds: (TournamentRound | null)[] = [];
  for (let n = 1; n <= v.rounds; n++) rounds.push(v.roundList.find((r) => r.n === n) ?? null);
  return (
    <section aria-label="Bracket">
      <h3>Bracket</h3>
      <div class="bracket">
        {rounds.map((r, i) => {
          const n = i + 1;
          const slots = 2 ** (v.rounds - n);
          return (
            <section key={n} class="bracket-round" aria-label={roundName('se', n, v.rounds)}>
              <h4>{roundName('se', n, v.rounds)}</h4>
              <ol>
                {Array.from({ length: slots }, (_, k) => {
                  const p = r?.pairings.find((x) => x.slot === k) ?? null;
                  if (!p)
                    return (
                      <li key={k} class="match tbd">
                        {r ? 'No players' : 'To be decided'}
                      </li>
                    );
                  const through = advancing(p);
                  const line = (id: string, name: string, colour: string) => (
                    <div
                      class={`seat${through === id ? ' through' : ''}${id === props.me ? ' own' : ''}`}
                    >
                      {name} <span class="muted small-text">({colour})</span>
                      {id === props.me && <span class="you"> (you)</span>}
                      {through === id && <span class="small-text"> ✓ advances</span>}
                    </div>
                  );
                  return (
                    <li key={k} class="match">
                      {line(p.white.id, p.white.name, p.black ? 'White' : 'bye')}
                      {p.black ? line(p.black.id, p.black.name, 'Black') : null}
                      <div class="small-text muted">{resultText(p, r?.started ?? false)}</div>
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
      {v.status === 'finished' && v.winner && (
        <p class="note ok" role="status">
          Winner: {v.winner.name}
        </p>
      )}
    </section>
  );
}
