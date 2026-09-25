/**
 * Ranked queue (M6 6.2, spec 9.3 R-FMT-004) on the online screen: pick a ranked format, see your
 * bracket (from the item slots your level unlocks, never from the loadout) and your Glicko-2 rating,
 * and queue with the selected loadout. Ranked battles are rated per format and bracket, never carry
 * a wager and never face an NPC. Links to the leaderboards and the guild screen.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FORMATS } from '@chain-theorem/content';
import {
  ServerQueue,
  decode,
  type Format,
  type MyRatings,
  type RatingView,
} from '@chain-theorem/protocol';
import { go } from '../app/router.ts';
import { ApiError, api, wsUrl } from '../net/api.ts';
import { startOnlineBattle } from './battleSession.ts';

function rankedError(e: unknown): string {
  const code = e instanceof ApiError ? e.code : 'error';
  const known: Record<string, string> = {
    in_battle: 'Finish your battle in progress first.',
    not_ranked: 'That format has no ranked queue.',
    invalid_loadout: 'That loadout is not legal for your level or collection.',
    subscription_required: 'Your trial has ended. Subscribe to keep playing online.',
    offline: 'The server cannot be reached.',
  };
  return known[code] ?? `Something went wrong (${code}).`;
}

export function ratingText(r: RatingView): string {
  const place = r.rank !== null ? ` · #${r.rank}` : '';
  const settled = r.provisional ? ' (provisional)' : '';
  return `${r.rating} ± ${r.rd}${settled} · ${r.games} rated ${r.games === 1 ? 'game' : 'games'}${place}`;
}

export function RankedPanel({ loadoutId }: { loadoutId: string }) {
  const [info, setInfo] = useState<MyRatings | null>(null);
  const [format, setFormat] = useState<Format>('vanguard');
  const [queue, setQueue] = useState<{ waiting: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    api.myRatings().then(
      (r) => {
        setInfo(r);
        if (r.formats[0] && !r.formats.includes(format)) setFormat(r.formats[0]);
      },
      (e: unknown) => setError(rankedError(e)),
    );
    return () => socket.current?.close(1000, 'left');
  }, []);

  const formats = info?.formats ?? (['vanguard', 'full'] as Format[]);
  const mine = info?.ratings.find((r) => r.format === format && r.bracket === info.bracket);

  const join = async () => {
    setError(null);
    try {
      const t = await api.rankedTicket(format, loadoutId);
      const ws = new WebSocket(wsUrl(t.url));
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
    } catch (e) {
      setError(rankedError(e));
    }
  };

  const leave = () => {
    socket.current?.close(1000, 'left');
    socket.current = null;
    setQueue(null);
  };

  return (
    <fieldset class="ranked">
      <legend>Ranked queue</legend>
      {error && (
        <p class="note warn" role="alert">
          {error}
        </p>
      )}
      <p class="small-text">
        {info ? (
          <>
            Your bracket: <strong>{info.bracket} item slots</strong>{' '}
            <span class="muted">(from your level, not your loadout)</span>
          </>
        ) : (
          <span class="muted">Loading your ratings…</span>
        )}
      </p>
      <div class="row start">
        <label class="inline">
          Ranked format
          <select
            value={format}
            disabled={queue !== null}
            onChange={(e) => setFormat((e.target as HTMLSelectElement).value as Format)}
          >
            {formats.map((f) => (
              <option key={f} value={f}>
                {FORMATS[f]?.name ?? f}
              </option>
            ))}
          </select>
        </label>
        {mine && (
          <span class="ranked-rating" aria-label={`Your ${FORMATS[format]?.name ?? format} rating`}>
            <strong>{mine.rating}</strong>{' '}
            <span class="muted small-text">{ratingText(mine).replace(/^\d+ /, '')}</span>
          </span>
        )}
      </div>
      {queue ? (
        <p role="status">
          Looking for a ranked opponent near your rating… ({queue.waiting} waiting){' '}
          <button onClick={leave}>Leave ranked queue</button>
        </p>
      ) : (
        <button class="primary" disabled={!loadoutId || !info} onClick={() => void join()}>
          Join the ranked queue
        </button>
      )}
      <div class="row start">
        <button
          onClick={() => go('leaderboards', { format, ...(info ? { bracket: info.bracket } : {}) })}
        >
          Leaderboards
        </button>
        <button onClick={() => go('guild')}>Guild</button>
      </div>
    </fieldset>
  );
}
