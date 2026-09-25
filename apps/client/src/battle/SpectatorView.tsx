/**
 * Spectator view (M7 7.2, spec 10.4): the existing board scene with no input, both armies' public
 * information, the delayed event log with step-through replay, a "delayed by N plies" note, the
 * spectator count and the final result. Everything shown comes from the spectator projection and
 * spectator-projected events (R-INFO-005); a spectator has no loadout, so there are no move
 * previews, attack hints or prompts. Works at 360x640 (12.3): the panels become tabs under the board.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { FORMATS, abilityById, engine, itemById } from '@chain-theorem/content';
import {
  PIECE_TYPES,
  opposite,
  squareName,
  type PublicState,
  type ResultReason,
  type Side,
} from '@chain-theorem/rules';
import { settings } from '../state/settings.ts';
import { Clocks } from '../ui/Clocks.tsx';
import { EventLog } from '../ui/EventLog.tsx';
import { CategoryTag, ElementBadge, PieceGlyph } from '../ui/bits.tsx';
import { GROUP_A_TEXT, GROUP_B_TEXT, cap, sideName } from '../ui/labels.ts';
import { frameAt, groupActions, navigate } from '../ui/replay.ts';
import { COMPACT_QUERY, useMedia } from '../ui/useMedia.ts';
import type { BoardGame } from './scene/game.ts';
import type { SpectatorController } from './spectate.ts';

type TabId = 'log' | 'white' | 'black';

const REASON: Record<ResultReason, string> = {
  checkmate: 'checkmate',
  stalwart_captured: 'the Stalwart king was captured',
  objective: 'format objective reached',
  resign: 'resignation',
  timeout: 'out of time',
  abandon: 'abandoned',
  stalemate: 'stalemate',
  repetition: 'threefold repetition',
  fifty_move: '50-move rule',
  agreement: 'draw agreed',
  double_royal_defeat: 'both royals fell',
};

function animationMs(): number {
  const s = settings.value;
  return s.reducedMotion ? 0 : s.fastMode ? 60 : 220;
}

export function SpectatorView({
  controller,
  onLeave,
}: {
  controller: SpectatorController;
  onLeave(): void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const board = useRef<BoardGame | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [inspect, setInspect] = useState<number | null>(null);
  const [tab, setTab] = useState<TabId>('log');
  const compact = useMedia(COMPACT_QUERY);
  const snap = controller.snapshot.value;
  const atRef = useRef(at);
  atRef.current = at;

  // ---- board lifecycle: the same scene as a battle, bound with no moves -------------------------
  useEffect(() => {
    let disposed = false;
    const unsub = controller.onUpdate((u) => {
      if (atRef.current !== null) return;
      void board.current?.scene.animate(u).catch((e: unknown) => console.warn('animation', e));
    });
    void import('./scene/game.ts')
      .then(async ({ createBoardGame }) => {
        if (!host.current || disposed) return;
        const g = await createBoardGame(host.current);
        if (disposed) {
          g.game.destroy(true);
          return;
        }
        board.current = g;
        g.scene.bind({
          // Read-only: a square only selects a piece to describe.
          onSquare: (sq: number) => {
            const id = controller.snapshot.value.pub.board[sq] ?? -1;
            setInspect(id >= 0 ? sq : null);
          },
          classicView: () => settings.value.classicView,
          animationMs,
          fastMode: () => settings.value.fastMode,
          textScale: () => settings.value.textScale,
        });
        g.scene.setSnapshot(controller.snapshot.value);
        setReady(true);
      })
      .catch((e: unknown) => {
        console.error('board failed to load', e);
        setFailed(true);
      });
    return () => {
      disposed = true;
      unsub();
      board.current?.game.destroy(true);
      board.current?.game.loop.wake();
      board.current = null;
    };
  }, [controller]);

  useSignalEffect(() => {
    const s = controller.snapshot.value;
    void settings.value.classicView;
    board.current?.scene.setSnapshot(s);
  });

  // ---- replay frames rebuilt from the delayed log (11.2) ------------------------------------------
  useEffect(() => {
    const g = board.current;
    if (!g || !ready) return;
    const s = controller.snapshot.value;
    if (at === null) {
      g.scene.showLive();
      return;
    }
    const frame = frameAt(s.pub, s.log, at);
    if (frame) g.scene.showPublic(frame, s.viewer);
  }, [at, ready]);

  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(
      () => {
        const next = navigate(
          groupActions(controller.snapshot.value.log),
          atRef.current,
          'forward',
        );
        setAt(next);
        if (next === null) setPlaying(false);
      },
      Math.max(animationMs() * 2, 200) + 650,
    );
    return () => clearTimeout(id);
  }, [playing, at]);

  useEffect(() => {
    const g = board.current;
    if (!g || !ready) return;
    const last = [...snap.log].reverse().find((e) => e.event.k === 'MoveMade' && e.depth === 0);
    const lastMove =
      last?.event.k === 'MoveMade' ? ([last.event.from, last.event.to] as [number, number]) : null;
    g.scene.setHighlights({ selected: inspect, targets: [], captures: [], lastMove, attacked: [] });
  });

  const formatName = FORMATS[snap.pub.format]?.name ?? snap.pub.format;
  const delay = snap.spectate?.delay ?? 0;
  const pend = snap.pub.pending;
  const status =
    snap.status === 'waiting'
      ? 'Connecting to the battle…'
      : snap.status === 'ended'
        ? 'The battle is over.'
        : pend
          ? `${snap.names[pend.chooser]} (${sideName(pend.chooser)}) is choosing…`
          : `${snap.names[snap.pub.turn]} (${sideName(snap.pub.turn)}) to move.`;
  const inspected = inspect === null ? -1 : (snap.pub.board[inspect] ?? -1);
  const piece = inspected >= 0 ? snap.pub.pieces[inspected] : undefined;
  const tabs: TabId[] = ['log', 'white', 'black'];
  const label: Record<TabId, string> = {
    log: 'Log',
    white: `${sideName('white')}: ${snap.names.white}`,
    black: `${sideName('black')}: ${snap.names.black}`,
  };

  return (
    <div class={`battle spectating ${compact ? 'compact' : ''}`}>
      <div class="board-wrap">
        {at !== null && (
          <div class="replay-banner" role="status">
            <span aria-hidden="true">{'↺'} </span>
            <span class="replay-text">Replay: {snap.log.find((e) => e.i === at)?.text ?? ''}</span>
            <button
              class="small"
              onClick={() => {
                setPlaying(false);
                setAt(null);
              }}
            >
              Back to the delayed view
            </button>
          </div>
        )}
        <div
          class="board-host"
          ref={host}
          role="region"
          aria-label="Board of the battle you are watching (read-only)."
        />
        {!ready && (
          <p class="board-loading" role="status">
            {failed ? 'The board could not load. Reload the page to try again.' : 'Loading board…'}
          </p>
        )}
      </div>
      <aside class={`hud ${compact ? 'compact' : ''}`} aria-label="Spectator panel">
        <header class="hud-players">
          <h2 class="spectate-title">Watching · {formatName}</h2>
          {(['black', 'white'] as const).map((side) => {
            const army = snap.pub.armies[side];
            return (
              <div
                key={side}
                class={`player ${side === snap.pub.turn && !snap.result ? 'to-move' : ''}`}
              >
                <span class="pname">
                  <PieceGlyph type="king" side={side} /> <strong>{snap.names[side]}</strong>{' '}
                  <span class="muted">
                    {sideName(side)} · level {army.level}
                  </span>
                </span>
                <span class="pels">
                  {army.elements.map((el, i) => (
                    <ElementBadge
                      key={i}
                      el={el}
                      {...(army.elements.length > 1 ? { suffix: i === 0 ? '(A)' : '(B)' } : {})}
                    />
                  ))}
                </span>
                <Clocks controller={controller} side={side} />
              </div>
            );
          })}
        </header>
        <p class="note spectate-delay" role="note">
          <span aria-hidden="true">{'⏱︎'} </span>
          Delayed by {delay} {delay === 1 ? 'ply' : 'plies'}: you see the battle {delay}{' '}
          {delay === 1 ? 'move' : 'half-moves'} behind the players, and only what both players know.{' '}
          <span class="muted">{snap.spectate?.watchers ?? 0} watching.</span>
        </p>
        <div class="turn-banner" role="status">
          {status}
          {snap.pub.inCheck && (
            <strong class="check-alert">
              {' '}
              <span aria-hidden="true">{'⚠︎'}</span> {sideName(snap.pub.inCheck)}&apos;s king is in
              check.
            </strong>
          )}
        </div>
        {snap.connection === 'reconnecting' && (
          <p class="note warn" role="status">
            Connection lost. Reconnecting…
          </p>
        )}
        {snap.notice && (
          <p class="note warn" role="alert">
            {snap.notice}
          </p>
        )}
        {snap.status === 'ended' && snap.result && (
          <div class="result" role="status">
            <p>
              <strong>
                <span aria-hidden="true">{'⚑'} </span>
                {snap.result.winner
                  ? `${snap.names[snap.result.winner]} (${sideName(snap.result.winner)}) wins`
                  : 'Draw'}
              </strong>{' '}
              ·{' '}
              {snap.result.reason === 'objective'
                ? `${formatName} objective`
                : REASON[snap.result.reason]}
            </p>
          </div>
        )}
        {piece && inspect !== null && (
          <section aria-label="Selected piece">
            <p>
              <PieceGlyph type={piece.type} side={piece.side} /> {sideName(piece.side)} {piece.type}{' '}
              on {squareName(inspect)} · <ElementBadge el={piece.element} />
            </p>
            <KnownAbilities pub={snap.pub} side={piece.side} only={piece.type} />
            <button class="small" onClick={() => setInspect(null)}>
              Close
            </button>
          </section>
        )}
        <div class="tabs" role="tablist" aria-label="Spectator panels">
          {tabs.map((t, i) => (
            <button
              key={t}
              role="tab"
              id={`stab-${t}`}
              aria-selected={t === tab}
              aria-controls={`spanel-${t}`}
              tabIndex={t === tab ? 0 : -1}
              onClick={() => setTab(t)}
              onKeyDown={(e) => {
                const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!d) return;
                e.preventDefault();
                const next = tabs[(i + d + tabs.length) % tabs.length] ?? t;
                setTab(next);
                document.getElementById(`stab-${next}`)?.focus();
              }}
            >
              {label[t]}
            </button>
          ))}
        </div>
        <div class="tab-panel" role="tabpanel" id={`spanel-${tab}`} aria-labelledby={`stab-${tab}`}>
          {tab === 'log' ? (
            <EventLog log={snap.log} at={at} playing={playing} onSeek={setAt} onPlay={setPlaying} />
          ) : (
            <ArmyPanel pub={snap.pub} side={tab} name={snap.names[tab]} formatName={formatName} />
          )}
        </div>
        <footer class="hud-actions">
          <div class="row">
            <button onClick={() => controller.flip()}>Flip board</button>
            <button onClick={onLeave}>Back to live battles</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

/** Known abilities of `side` by piece type (what its opponent has seen), optionally one type. */
function KnownAbilities({
  pub,
  side,
  only,
}: {
  pub: PublicState;
  side: Side;
  only?: (typeof PIECE_TYPES)[number];
}) {
  const known = pub.armies[side].revealed;
  const types = only ? [only] : PIECE_TYPES;
  return (
    <ul class="dossier-types">
      {types.map((t) => {
        const list = known.abilities[t] ?? [];
        const complete = known.complete.includes(t);
        const veiled = known.veiled.includes(t);
        return (
          <li key={t}>
            <span class="dt-type">
              <PieceGlyph type={t} side={side} /> {cap(t)}
            </span>
            <span class="dt-abilities">
              {list.length === 0 && !complete && <span class="muted">nothing seen</span>}
              {list.length === 0 && complete && <span class="muted">no abilities</span>}
              {list.map((a) => {
                const def = abilityById.get(a);
                return (
                  <span key={a} class="chip" title={def?.text.rules}>
                    {def?.name ?? a} {def && <CategoryTag cat={def.category} />}
                  </span>
                );
              })}
              {veiled && (
                <span class="chip veiled" title="Its abilities act unnamed (Veil).">
                  <span aria-hidden="true">{'▣'} </span>veiled
                </span>
              )}
            </span>
            <span class={`dt-mark ${complete ? 'complete' : 'partial'}`}>
              {complete ? 'complete' : 'partial'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** One army's public information (8.1 plus reveals) and the Dossier deductions about it (8.3). */
function ArmyPanel({
  pub,
  side,
  name,
  formatName,
}: {
  pub: PublicState;
  side: Side;
  name: string;
  formatName: string;
}) {
  const army = pub.armies[side];
  const known = army.revealed;
  const hints = settings.value.deductionHints;
  const key = JSON.stringify([known, army.level, army.consumedSlots, army.elements]);
  // Deductions use only this army's public facts: seen from its opponent's seat (8.3).
  const d = useMemo(
    () => (hints ? engine.deduce({ ...pub, viewer: opposite(side) }) : null),
    [hints, key],
  );
  return (
    <section class="dossier" aria-label={`${sideName(side)}: what is known`}>
      <h3>
        {sideName(side)}: {name}
      </h3>
      <dl class="facts-list">
        <dt>Level</dt>
        <dd>{army.level}</dd>
        <dt>Element{army.elements.length > 1 ? 's' : ''}</dt>
        <dd>
          {army.elements.length > 1 ? (
            <>
              <ElementBadge el={army.elements[0] ?? 'neutral'} />{' '}
              <span class="muted">A: {GROUP_A_TEXT}</span>
              <br />
              <ElementBadge el={army.elements[1] ?? 'neutral'} />{' '}
              <span class="muted">B: {GROUP_B_TEXT}</span>
            </>
          ) : (
            <ElementBadge el={army.elements[0] ?? 'neutral'} />
          )}
        </dd>
        <dt>Item slots used</dt>
        <dd>{army.consumedSlots}</dd>
        <dt>Known items</dt>
        <dd>
          {known.items.length === 0 ? (
            <span class="muted">none seen</span>
          ) : (
            known.items.map((id) => (
              <span key={id} class="chip" title={itemById.get(id)?.text.rules}>
                {itemById.get(id)?.name ?? id}
              </span>
            ))
          )}
          {known.allItems && <span class="muted"> (all)</span>}
        </dd>
        <dt>Objective</dt>
        <dd>
          {formatName}: {pub.objective[side]}
        </dd>
      </dl>
      <h4>Abilities seen, by piece type</h4>
      <KnownAbilities pub={pub} side={side} />
      {d && d.hints.length > 0 && (
        <>
          <h4>Deductions</h4>
          <ul class="deductions">
            {d.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
