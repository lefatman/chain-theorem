/**
 * Online play (M4): battles against server-run NPCs, challenge links for a friend, and the casual
 * queue (9.3). Loadouts live on the server and are validated there against the account's level and
 * inventory (R-LOAD-004); a local loadout can be uploaded.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FORMATS } from '@chain-theorem/content';
import { ServerQueue, decode, type BattleTicket } from '@chain-theorem/protocol';
import type { FormatId } from '@chain-theorem/rules';
import { go, route } from '../app/router.ts';
import { ApiError, api, wsUrl, type ServerLoadout } from '../net/api.ts';
import { account, refreshAccount, signOut } from '../state/account.ts';
import { profile } from '../state/profile.ts';
import { startOnlineBattle } from './battleSession.ts';
import { AccessBanner, PlayLocked } from './AccountScreen.tsx';
import { RankedPanel } from './RankedPanel.tsx';

type Tier = 'wild' | 'trainer' | 'elite';

function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  const known: Record<string, string> = {
    invalid_loadout: 'That loadout is not legal for your level or collection.',
    not_found: 'Not found.',
    challenge_closed: 'That challenge is no longer open.',
    own_challenge: 'You cannot accept your own challenge.',
    too_many_loadouts: 'You can keep at most 5 loadouts (7.4).',
    offline: 'The server cannot be reached.',
    subscription_required: 'Your trial has ended. Subscribe to keep playing online.',
  };
  return known[code] ?? `Something went wrong (${code}).`;
}

export function OnlineScreen() {
  const acc = account.value;
  const code = route.value.params.get('c');
  const [loadouts, setLoadouts] = useState<ServerLoadout[]>([]);
  const [format, setFormat] = useState<FormatId>('first_blood');
  const [loadoutId, setLoadoutId] = useState('');
  const [tier, setTier] = useState<Tier>('wild');
  const [link, setLink] = useState<{ url: string; ticket: BattleTicket } | null>(null);
  const [queue, setQueue] = useState<{ waiting: number } | null>(null);
  const [challenge, setChallenge] = useState<{
    format: FormatId;
    from: { name: string; level: number };
    open: boolean;
  } | null>(null);
  const [active, setActive] = useState<{ id: string; format: FormatId; opponent: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState('');
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (acc.kind === 'unknown') void refreshAccount();
  }, [acc.kind]);

  const reload = async () => {
    const r = await api.loadouts();
    setLoadouts(r.loadouts);
    setLoadoutId((id) =>
      r.loadouts.some((l) => l.id === id) ? id : (r.loadouts.find((l) => l.valid)?.id ?? ''),
    );
    setActive((await api.activeBattles()).battles);
  };

  useEffect(() => {
    if (acc.kind !== 'signed_in') return;
    reload().catch((e: unknown) => setError(errorText(e)));
    if (code) api.challengeInfo(code).then(setChallenge, (e: unknown) => setError(errorText(e)));
  }, [acc.kind, code]);

  useEffect(() => () => socket.current?.close(), []);

  if (acc.kind === 'unknown')
    return (
      <main class="setup">
        <p>Connecting…</p>
      </main>
    );
  if (acc.kind === 'offline')
    return (
      <main class="setup">
        <h2>Online play</h2>
        <p>The server cannot be reached, so online play is unavailable. Local play still works.</p>
        <button onClick={() => go('title')}>Back</button>
      </main>
    );
  if (acc.kind === 'signed_out')
    return (
      <main class="setup">
        <h2>Online play</h2>
        <p>Sign in to play online.</p>
        <button class="primary" onClick={() => go('login', code ? { next: code } : undefined)}>
          Sign in
        </button>
        <button onClick={() => go('title')}>Back</button>
      </main>
    );

  const run = async (f: () => Promise<void>) => {
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const joinQueue = () =>
    run(async () => {
      const { url } = await api.queueTicket(format, loadoutId);
      const ws = new WebSocket(wsUrl(url));
      socket.current = ws;
      setQueue({ waiting: 0 });
      ws.onmessage = (ev) => {
        const m = decode(ServerQueue, ev.data, Number.POSITIVE_INFINITY);
        if (!m) return;
        if (m.t === 'queued') setQueue({ waiting: m.d.waiting });
        else if (m.t === 'matched') {
          ws.close(1000, 'matched');
          socket.current = null;
          startOnlineBattle(m.d.battleId);
          go('battle');
        } else if (m.t === 'err') setError(m.d.msg ?? m.d.code);
      };
      ws.onclose = () => setQueue(null);
    });

  const leaveQueue = () => {
    socket.current?.close(1000, 'left');
    socket.current = null;
    setQueue(null);
  };

  const me = acc.me;
  // M6 6.3: the trial or subscription has ended (the server answers 402 to online play).
  if (!me.access.canPlay)
    return (
      <PlayLocked
        me={me}
        active={active}
        onRejoin={(id) => {
          startOnlineBattle(id);
          go('battle');
        }}
      />
    );
  const valid = loadouts.filter((l) => l.valid);
  return (
    <main class="setup">
      <h2>Online play</h2>
      <p>
        Signed in as <strong>{me.name}</strong> · level {me.level}{' '}
        <button onClick={() => go('account')}>Account and subscription</button>{' '}
        <button onClick={() => void signOut()}>Sign out</button>
      </p>
      <AccessBanner access={me.access} />
      {error && (
        <p class="note warn" role="alert">
          {error}
        </p>
      )}
      <section aria-label="The world">
        <button class="primary" onClick={() => go('world')}>
          Enter the world
        </button>{' '}
        <span class="muted small-text">
          Explore towns and routes, meet players, learn at the Chess Academy.
        </span>
      </section>
      <section aria-label="Spectating">
        <button onClick={() => go('watch')}>Watch live battles</button>{' '}
        <span class="muted small-text">
          Ranked, tournament and challenge-zone battles, shown a few moves behind.
        </span>
      </section>
      {active.length > 0 && (
        <section aria-label="Battles in progress">
          <h3>Battles in progress</h3>
          {active.map((b) => (
            <button
              key={b.id}
              class="primary"
              onClick={() => {
                startOnlineBattle(b.id);
                go('battle');
              }}
            >
              Rejoin {FORMATS[b.format]?.name ?? b.format} vs {b.opponent}
            </button>
          ))}
        </section>
      )}
      <section aria-label="Tournaments">
        <button onClick={() => go('tournaments')}>Tournaments</button>{' '}
        <span class="muted small-text">
          Scheduled Swiss and knockout events for your slot bracket, with prizes.
        </span>
      </section>
      {challenge && code && (
        <section aria-label="Challenge">
          <h3>Challenge from {challenge.from.name}</h3>
          <p>
            {FORMATS[challenge.format]?.name} · level {challenge.from.level}
          </p>
          {challenge.open ? (
            <button
              class="primary"
              disabled={!loadoutId}
              onClick={() =>
                run(async () => {
                  const t = await api.acceptChallenge(code, loadoutId);
                  startOnlineBattle(t.battleId, t);
                  go('battle');
                })
              }
            >
              Accept with the selected loadout
            </button>
          ) : (
            <p>This challenge is no longer open.</p>
          )}
        </section>
      )}
      <label>
        Format
        <select
          value={format}
          onChange={(e) => setFormat((e.target as HTMLSelectElement).value as FormatId)}
        >
          {Object.values(FORMATS).map((f) => (
            <option value={f.id} key={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Loadout
        <select
          value={loadoutId}
          onChange={(e) => setLoadoutId((e.target as HTMLSelectElement).value)}
        >
          {loadouts.map((l) => (
            <option value={l.id} key={l.id} disabled={!l.valid}>
              {l.name}
              {l.valid ? '' : ` (not legal: rule ${l.errors[0]?.rule ?? '?'})`}
            </option>
          ))}
        </select>
      </label>
      {valid.length === 0 && (
        <p class="note">Upload a loadout that is legal at your level to play.</p>
      )}
      <div class="row">
        <select
          value={upload}
          onChange={(e) => setUpload((e.target as HTMLSelectElement).value)}
          aria-label="Local loadout to upload"
        >
          <option value="">Upload a local loadout…</option>
          {profile.value.loadouts.map((l) => (
            <option value={l.id} key={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          disabled={!upload}
          onClick={() =>
            run(async () => {
              const l = profile.value.loadouts.find((x) => x.id === upload);
              if (!l) return;
              const saved = await api.saveLoadout(l.name, l.loadout);
              await reload();
              if (saved.valid) setLoadoutId(saved.id);
              setUpload('');
            })
          }
        >
          Upload
        </button>
      </div>
      <fieldset>
        <legend>Against an NPC</legend>
        <select
          value={tier}
          onChange={(e) => setTier((e.target as HTMLSelectElement).value as Tier)}
          aria-label="NPC tier"
        >
          <option value="wild">Wild NPC</option>
          <option value="trainer">Trainer NPC</option>
          <option value="elite">Elite NPC</option>
        </select>
        <button
          class="primary"
          disabled={!loadoutId}
          onClick={() =>
            run(async () => {
              const t = await api.npcBattle(format, loadoutId, tier);
              startOnlineBattle(t.battleId, t);
              go('battle');
            })
          }
        >
          Battle
        </button>
      </fieldset>
      <fieldset>
        <legend>Against a friend</legend>
        <button
          disabled={!loadoutId}
          onClick={() =>
            run(async () => {
              const c = await api.challenge(format, loadoutId);
              setLink({ url: c.url, ticket: c.ticket });
            })
          }
        >
          Create a challenge link
        </button>
        {link && (
          <p role="status">
            Send this link:{' '}
            <input
              readOnly
              value={link.url}
              aria-label="Challenge link"
              onFocus={(e) => (e.target as HTMLInputElement).select()}
            />{' '}
            The battle opens when your friend accepts.{' '}
            <button
              class="primary"
              onClick={() => {
                startOnlineBattle(link.ticket.battleId, link.ticket);
                go('battle');
              }}
            >
              Wait in the battle
            </button>
          </p>
        )}
      </fieldset>
      <fieldset>
        <legend>Casual queue</legend>
        {queue ? (
          <p role="status">
            Looking for an opponent within ±5 levels… ({queue.waiting} waiting){' '}
            <button onClick={leaveQueue}>Leave queue</button>
          </p>
        ) : (
          <button disabled={!loadoutId} onClick={() => void joinQueue()}>
            Join the queue
          </button>
        )}
      </fieldset>
      {/* M6 6.2: ranked queues by bracket and rating; leaderboards and guilds (9.3, 10.4). */}
      <RankedPanel loadoutId={loadoutId} />
      <button onClick={() => go('title')}>Back</button>
    </main>
  );
}
