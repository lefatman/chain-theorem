/**
 * Alpha guest play (spec 9.6, R-FMT-007; DD-107): play a friend by one-time code without an account,
 * at a level the code's creator picks (1–LEVEL_CAP) with every card and item at or below it allowed to
 * both sides. The server decides everything that matters: the guest identity (an HttpOnly cookie),
 * the code, legality at the level (R-LOAD-004) and the socket ticket (R-SEC-006). This screen builds
 * the loadout with the loadout editor and hands the ticket to the battle screen; the socket flow is
 * the challenge-link one. The Worker's ALPHA_GUEST_PLAY flag enables it; the screen says when it is off.
 */
import { useEffect, useState } from 'preact/hooks';
import { CAPS, FORMATS } from '@chain-theorem/content';
import type { AlphaCreated, AlphaInfo, AlphaMe } from '@chain-theorem/protocol';
import type { FormatId } from '@chain-theorem/rules';
import { go, route } from '../app/router.ts';
import { ApiError, api } from '../net/api.ts';
import { alphaErrorText, alphaLoadout, formatLine } from './alpha.ts';
import { startOnlineBattle } from './battleSession.ts';
import { LoadoutEditor } from './LoadoutEditor.tsx';

/** The level the create flow starts at; the person moves it where they like (1–LEVEL_CAP). */
const DEFAULT_LEVEL = 10;

type Who = 'loading' | 'offline' | AlphaMe;

export function AlphaScreen() {
  const code = route.value.params.get('c');
  const [who, setWho] = useState<Who>('loading');
  const [info, setInfo] = useState<AlphaInfo | null>(null);
  const [format, setFormat] = useState<FormatId>('first_blood');
  const [created, setCreated] = useState<AlphaCreated | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Who the alpha routes see: a guest, a signed-in player or nobody; or that they are not there. */
  const load = async () => {
    try {
      setWho(await api.alphaMe());
    } catch (e) {
      const c = e instanceof ApiError ? e.code : 'offline';
      // No server at all, or a server without the alpha routes (404): either way, no alpha play.
      setWho(c === 'offline' || c === 'no_server' ? 'offline' : { enabled: false, me: null });
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const enabled = typeof who === 'object' && who.enabled;
  useEffect(() => {
    if (!enabled || !code) return;
    setInfo(null);
    api.alphaInfo(code).then(setInfo, (e: unknown) => setError(alphaErrorText(e)));
  }, [enabled, code]);

  if (who === 'loading')
    return (
      <main class="setup">
        <p>Connecting…</p>
      </main>
    );
  if (who === 'offline')
    return (
      <main class="setup">
        <h2>Alpha play</h2>
        <p>The server cannot be reached, so alpha play is unavailable. Local play still works.</p>
        <button onClick={() => go('title')}>Back</button>
      </main>
    );
  if (!who.enabled)
    return (
      <main class="setup">
        <h2>Alpha play</h2>
        <p>Alpha guest play is not enabled on this server.</p>
        <button onClick={() => go('title')}>Back</button>
      </main>
    );

  const me = who.me;
  const becomeGuest = async () => {
    setError(null);
    try {
      await api.alphaGuest();
      await load();
    } catch (e) {
      setError(alphaErrorText(e));
    }
  };
  const selectAll = (e: Event) => (e.target as HTMLInputElement).select();

  // The editor's Save is the one network action of each flow; its answer shows in the save bar.
  const editor = code ? (
    info?.open ? (
      <LoadoutEditor
        key={`join-${code}`}
        initial={alphaLoadout(info.level)}
        isNew
        fixedLevel={info.level}
        saveLabel="Accept and play"
        intro={`The code's creator chose level ${info.level}: every card and item at or below it is allowed, and this loadout must be legal there.`}
        onCancel={() => go('title')}
        onSave={async (l) => {
          try {
            const t = await api.alphaAccept(code, l.loadout);
            startOnlineBattle(t.battleId, t);
            go('battle');
            return null;
          } catch (e) {
            return alphaErrorText(e);
          }
        }}
      />
    ) : null
  ) : created ? null : (
    <LoadoutEditor
      key="create"
      initial={alphaLoadout(DEFAULT_LEVEL)}
      isNew
      saveLabel="Create a code"
      intro="The level you set here is the battle's level for both players: every card and item at or below it is allowed."
      onCancel={() => go('title')}
      onSave={async (l) => {
        try {
          setCreated(await api.alphaCreate(format, l.level, l.loadout));
          return null;
        } catch (e) {
          return alphaErrorText(e);
        }
      }}
    />
  );

  const head = (
    <>
      <header class="screen-head">
        <h2>Alpha play</h2>
        <p class="muted">
          Play a friend by one-time code, no account needed. Whoever creates the code picks the
          battle's level (1–{CAPS.LEVEL_CAP}); every card and item at or below it is allowed to both
          sides. Nothing is recorded.
        </p>
      </header>
      {me ? (
        <p>
          {me.guest ? 'You are' : 'Signed in as'} <strong>{me.name}</strong>
          {me.guest && <span class="muted small-text"> (a guest for 24 hours)</span>}
        </p>
      ) : (
        <p>
          <button class="primary" onClick={() => void becomeGuest()}>
            Play as a guest
          </button>{' '}
          <span class="muted small-text">You get a guest name for 24 hours; that is all.</span>
        </p>
      )}
      {error && (
        <p class="note warn" role="alert">
          {error}
        </p>
      )}
      {code ? (
        <section aria-label="Join by code">
          {info ? (
            <>
              <h3>Alpha battle from {info.from.name}</h3>
              <p>{formatLine(info.format, info.level)}</p>
              {!info.open && <p>This code is no longer open.</p>}
            </>
          ) : (
            !error && <p>Looking up the code…</p>
          )}
        </section>
      ) : created ? (
        <div class="panel" role="status">
          <h3>Your code</h3>
          <label>
            Alpha code
            <input readOnly value={created.code} onFocus={selectAll} />
          </label>
          <label>
            Alpha link
            <input readOnly value={created.url} onFocus={selectAll} />
          </label>
          <p>
            Send the code or the link; the battle starts when your friend accepts. The code works
            once and expires after 30 minutes.
          </p>
          <button
            class="primary"
            onClick={() => {
              startOnlineBattle(created.ticket.battleId, created.ticket);
              go('battle');
            }}
          >
            Wait in the battle
          </button>
        </div>
      ) : (
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
      )}
      {!editor && <button onClick={() => go('title')}>Back</button>}
    </>
  );

  // The editor is a page of its own (<main>), so while it shows, the alpha part sits above it.
  return editor ? (
    <>
      <section class="setup wide" aria-label="Alpha play">
        {head}
      </section>
      {editor}
    </>
  ) : (
    <main class="setup">{head}</main>
  );
}
