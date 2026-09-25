/**
 * Watch live battles (M7 7.2, spec 10.4 "delayed, public-projection-only view of live battles"):
 * the list of public live battles (ranked, tournament games, challenge-zone battles whose players
 * allow spectators), a spectator view of one of them, and the player's own setting: whether others
 * may watch their public battles (on by default for adults, off for accounts under 18). Reachable
 * from the online screen (`#/watch`, one battle at `#/watch?b=<id>`).
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { FORMATS } from '@chain-theorem/content';
import type { LiveBattle, LiveBattles, SpectateSetting } from '@chain-theorem/protocol';
import { go, route } from '../app/router.ts';
import { SpectatorController } from '../battle/spectate.ts';
import { SpectatorView } from '../battle/SpectatorView.tsx';
import { ApiError, api, wsUrl } from '../net/api.ts';
import { account, refreshAccount } from '../state/account.ts';

const REFRESH_MS = 15_000;

function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  const known: Record<string, string> = {
    not_found: 'That battle is not live any more, or it cannot be watched.',
    full: 'That battle has as many spectators as it can take. Try another one.',
    offline: 'The server cannot be reached.',
  };
  return known[code] ?? `Something went wrong (${code}).`;
}

function kindText(b: LiveBattle): string {
  if (b.kind === 'ranked') return `Ranked${b.bracket ? `, slots ${b.bracket}` : ''}`;
  if (b.kind === 'tournament') return `Tournament${b.tournament ? `: ${b.tournament}` : ''}`;
  return 'Challenge zone';
}

export function WatchScreen() {
  const acc = account.value;
  const battleId = route.value.params.get('b');
  useEffect(() => {
    if (acc.kind === 'unknown') void refreshAccount();
  }, [acc.kind]);

  if (acc.kind === 'unknown')
    return (
      <main class="setup">
        <p>Connecting…</p>
      </main>
    );
  if (acc.kind !== 'signed_in')
    return (
      <main class="setup">
        <h2>Watch live battles</h2>
        <p>
          {acc.kind === 'offline'
            ? 'The server cannot be reached, so live battles cannot be watched.'
            : 'Sign in to watch live battles.'}
        </p>
        {acc.kind === 'signed_out' && (
          <button class="primary" onClick={() => go('login')}>
            Sign in
          </button>
        )}
        <button onClick={() => go('online')}>Back</button>
      </main>
    );
  return battleId ? <Watching battleId={battleId} /> : <LiveList />;
}

function Watching({ battleId }: { battleId: string }) {
  const controller = useMemo(
    () =>
      new SpectatorController({
        battleId,
        // A fresh 60-second spectator ticket for every (re)connect (R-SEC-006).
        connectUrl: async () => wsUrl((await api.spectateTicket(battleId)).url),
      }),
    [battleId],
  );
  useEffect(() => () => controller.dispose(), [controller]);
  return <SpectatorView controller={controller} onLeave={() => go('watch')} />;
}

function LiveList() {
  const [live, setLive] = useState<LiveBattles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setting, setSetting] = useState<SpectateSetting | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setLive(await api.liveBattles());
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => {
    void load();
    api.spectateSetting().then(setSetting, () => undefined);
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const watch = async (id: string) => {
    setError(null);
    try {
      // Checked here so a full or finished battle says why; the view asks for its own tickets.
      await api.spectateTicket(id);
      go('watch', { b: id });
    } catch (e) {
      setError(errorText(e));
      void load();
    }
  };

  const choose = async (allow: boolean | null) => {
    setBusy(true);
    try {
      setSetting(await api.setSpectateSetting(allow));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const delay = live?.delay ?? 0;
  return (
    <main class="setup watch">
      <h2>Watch live battles</h2>
      <p class="muted">
        Ranked battles, tournament games and challenge-zone battles are public when both players
        allow it. You see each battle {delay} {delay === 1 ? 'ply' : 'plies'} behind the players,
        and only what both players know: never a hidden ability or item.
      </p>
      {error && (
        <p class="note warn" role="alert">
          {error}
        </p>
      )}
      <section aria-labelledby="live-h">
        <div class="row">
          <h3 id="live-h">Live now</h3>
          <button class="small" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {!live ? (
          <p role="status">Loading…</p>
        ) : live.battles.length === 0 ? (
          <p role="status">No public battles right now. Check back soon.</p>
        ) : (
          <ul class="live-list">
            {live.battles.map((b) => (
              <li key={b.id}>
                <span class="live-players">
                  <strong>{b.white.name}</strong> <span class="muted">(level {b.white.level})</span>{' '}
                  vs <strong>{b.black.name}</strong>{' '}
                  <span class="muted">(level {b.black.level})</span>
                </span>
                <span class="live-meta muted">
                  {FORMATS[b.format]?.name ?? b.format} · {kindText(b)} · {b.spectators} watching
                </span>
                <button
                  class="primary"
                  aria-label={`Watch ${b.white.name} versus ${b.black.name}`}
                  onClick={() => void watch(b.id)}
                >
                  Watch
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="spectate-setting-h">
        <h3 id="spectate-setting-h">Your battles</h3>
        {!setting && <p role="status">Loading your spectating setting…</p>}
        {setting && (
          <>
            <label class="check">
              <input
                type="checkbox"
                checked={setting.allow}
                disabled={busy}
                onChange={(e) => void choose((e.target as HTMLInputElement).checked)}
              />{' '}
              Let others watch my public battles (with a {delay}-ply delay)
            </label>
            <p class="muted small-text">
              {setting.custom
                ? 'Your own choice. '
                : `The default (${setting.byDefault ? 'on' : 'off: accounts under 18 are not watched unless they choose to be'}). `}
              It applies to battles that start from now on.
            </p>
            {setting.custom && (
              <button class="small" disabled={busy} onClick={() => void choose(null)}>
                Use the default
              </button>
            )}
          </>
        )}
      </section>
      <button onClick={() => go('online')}>Back</button>
    </main>
  );
}
