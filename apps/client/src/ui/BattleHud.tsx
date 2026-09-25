/**
 * Battle overlay (DOM, 12.1): players and clocks, turn and check status, the result with rematch,
 * the choice prompt, the move panel with preview, the piece detail card, the Dossier and the
 * step-through log, plus resign and draw offer (9.2). On narrow screens (360x640, 12.3) the panels
 * become tabs below the board; on wide screens the log and Dossier share a tabbed area.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { DRAW_OFFER_EVERY_MOVES, FORMATS } from '@chain-theorem/content';
import { opposite, type ResultReason, type Side } from '@chain-theorem/rules';
import type { BattleController } from '../battle/controller.ts';
import { go } from '../app/router.ts';
import { rematch } from './battleSession.ts';
import { worldBattle } from '../world/session.ts';
import { tournamentBattle } from '../state/tournament.ts';
import { ElementBadge, PieceGlyph } from './bits.tsx';
import { Clocks } from './Clocks.tsx';
import { Dossier } from './Dossier.tsx';
import { EventLog, type EventLogProps } from './EventLog.tsx';
import { sideName } from './labels.ts';
import { MovePreview, type MovePanelProps } from './MovePreview.tsx';
import { PieceCard } from './PieceCard.tsx';
import { PromptDialog } from './PromptDialog.tsx';

type TabId = 'move' | 'piece' | 'log' | 'dossier';
const TAB_LABEL: Record<TabId, string> = {
  move: 'Move',
  piece: 'Piece',
  log: 'Log',
  dossier: 'Dossier',
};

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

export interface HudProps {
  controller: BattleController;
  compact: boolean;
  move: MovePanelProps;
  inspect: { square: number | null; pinned: boolean; onClose(): void };
  replay: Omit<EventLogProps, 'log'>;
  onPromptFocus(square: number | null): void;
}

export function BattleHud({ controller, compact, move, inspect, replay, onPromptFocus }: HudProps) {
  const s = controller.snapshot.value;
  const opp = opposite(s.viewer);
  const tabs: TabId[] = compact ? ['move', 'piece', 'log', 'dossier'] : ['log', 'dossier'];
  const [tab, setTab] = useState<TabId>(compact ? 'move' : 'log');
  const current = tabs.includes(tab) ? tab : (tabs[0] ?? 'log');
  const formatName = FORMATS[s.pub.format]?.name ?? s.pub.format;

  // Compact layout: follow what the player is doing.
  const inspected = inspect.square === null ? -1 : (s.pub.board[inspect.square] ?? -1);
  const inspectedSide = inspected >= 0 ? s.pub.pieces[inspected]?.side : undefined;
  useEffect(() => {
    if (!compact || !inspect.pinned || inspectedSide === undefined) return;
    setTab(inspectedSide === s.viewer ? 'move' : 'piece');
  }, [inspect.square, inspect.pinned]);
  useEffect(() => {
    if (replay.at !== null && !tabs.includes('log')) return;
    if (replay.at !== null) setTab('log');
  }, [replay.at !== null]);

  const panels: Record<TabId, () => ComponentChildren> = {
    move: () => <MovePreview {...move} />,
    piece: () => (
      <PieceCard
        pub={s.pub}
        own={s.own}
        square={inspect.square}
        pinned={inspect.pinned}
        onClose={inspect.onClose}
      />
    ),
    log: () => <EventLog log={s.log} {...replay} />,
    dossier: () => <Dossier pub={s.pub} formatName={formatName} />,
  };

  return (
    <aside class={`hud ${compact ? 'compact' : ''}`} aria-label="Battle panel">
      <Players controller={controller} />
      <TurnBanner controller={controller} />
      {s.connection !== undefined && <OnlineStatus controller={controller} />}
      {s.status === 'ended' && s.result && (
        <div class="result" role="status">
          <p>
            <strong>
              <span aria-hidden="true">{'⚑'} </span>
              {s.result.winner
                ? s.result.winner === s.viewer && s.controls.length === 1
                  ? 'You win!'
                  : `${s.names[s.result.winner]} (${sideName(s.result.winner)}) wins`
                : 'Draw'}
            </strong>{' '}
            ·{' '}
            {s.result.reason === 'objective' ? `${formatName} objective` : REASON[s.result.reason]}
          </p>
          <div class="row start">
            {worldBattle.value === controller ? (
              <button class="primary" onClick={() => go('world')}>
                Return to the world
              </button>
            ) : tournamentBattle.value?.controller === controller ? (
              <button
                class="primary"
                onClick={() =>
                  go('tournaments', { id: tournamentBattle.value?.tournamentId ?? '' })
                }
              >
                Back to the tournament
              </button>
            ) : s.connection === undefined ? (
              <>
                <button class="primary" onClick={() => rematch() || go('play')}>
                  Rematch (swap colours)
                </button>
                <button onClick={() => go('play')}>New battle</button>
              </>
            ) : (
              <button class="primary" onClick={() => go('online')}>
                New online battle
              </button>
            )}
            <button onClick={() => go('title')}>Title</button>
          </div>
          <p class="muted small-text">Every chain stays replayable in the log.</p>
        </div>
      )}
      {s.prompt && <PromptDialog controller={controller} onFocusOption={onPromptFocus} />}
      {s.handoff && <Handoff controller={controller} side={s.handoff} />}

      {!compact && (
        <>
          <MovePreview {...move} />
          {inspect.square !== null && panels.piece()}
        </>
      )}

      <div class="tabs" role="tablist" aria-label="Battle panels">
        {tabs.map((t, i) => (
          <button
            key={t}
            role="tab"
            id={`tab-${t}`}
            aria-selected={t === current}
            aria-controls={`panel-${t}`}
            tabIndex={t === current ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const next = tabs[(i + d + tabs.length) % tabs.length] ?? t;
              setTab(next);
              document.getElementById(`tab-${next}`)?.focus();
            }}
          >
            {TAB_LABEL[t]}
            {t === 'log' && replay.at !== null && <span class="tab-badge"> (replay)</span>}
          </button>
        ))}
      </div>
      <div
        class="tab-panel"
        role="tabpanel"
        id={`panel-${current}`}
        aria-labelledby={`tab-${current}`}
      >
        {panels[current]()}
      </div>

      <Actions controller={controller} />
      <p class="sr-only" aria-live="polite">
        {s.pub.inCheck === s.viewer ? 'Your king is in check.' : ''}
      </p>
      <span class="sr-only">Opponent: {s.names[opp]}</span>
    </aside>
  );
}

function Players({ controller }: { controller: BattleController }) {
  const s = controller.snapshot.value;
  const opp = opposite(s.viewer);
  const row = (side: Side, label: string) => {
    const army = s.pub.armies[side];
    return (
      <div class={`player ${side === s.pub.turn && !s.result ? 'to-move' : ''}`}>
        <span class="pname">
          <PieceGlyph type="king" side={side} /> <strong>{s.names[side]}</strong>{' '}
          <span class="muted">
            {sideName(side)} · level {army.level}
          </span>
          <span class="sr-only"> ({label})</span>
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
  };
  return (
    <header class="hud-players">
      {row(opp, 'opponent')}
      {row(s.viewer, s.controls.length > 1 ? 'on this device' : 'you')}
    </header>
  );
}

function TurnBanner({ controller }: { controller: BattleController }) {
  const s = controller.snapshot.value;
  if (s.status === 'ended') return null;
  const pend = s.pub.pending;
  const mine = s.controls.includes(s.pub.turn) && s.pub.turn === s.viewer;
  let text: string;
  if (s.prompt) text = 'Your choice: answer the prompt below.';
  else if (pend && pend.chooser !== s.viewer) text = `${s.names[pend.chooser]} is choosing...`;
  else if (mine) text = 'Your move.';
  else text = `${s.names[s.pub.turn]} (${sideName(s.pub.turn)}) is thinking...`;
  const check = s.pub.inCheck;
  return (
    <div class={`turn-banner ${mine ? 'mine' : ''}`} role="status">
      <span aria-hidden="true">{mine ? '▸ ' : '⌛︎ '}</span>
      {text}
      {check && (
        <strong class="check-alert">
          {' '}
          <span aria-hidden="true">{'⚠︎'}</span>{' '}
          {check === s.viewer ? 'Your king is in check!' : `${sideName(check)}'s king is in check.`}
        </strong>
      )}
    </div>
  );
}

function Handoff({ controller, side }: { controller: BattleController; side: Side }) {
  const s = controller.snapshot.value;
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), [side]);
  return (
    <div class="handoff-cover" role="dialog" aria-modal="true" aria-labelledby="handoff-h">
      <div class="handoff">
        <h2 id="handoff-h">Pass the device</h2>
        <p>
          {s.names[side]} ({sideName(side)}), it is your turn. The board stays hidden until you are
          ready.
        </p>
        <button ref={btn} class="primary" onClick={() => controller.acceptHandoff()}>
          I am {s.names[side]}: show the board
        </button>
      </div>
    </div>
  );
}

function Actions({ controller }: { controller: BattleController }) {
  const s = controller.snapshot.value;
  const [confirmResign, setConfirmResign] = useState(false);
  const [askDraw, setAskDraw] = useState(false);
  const [lastOffer, setLastOffer] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const playing = s.status === 'playing';
  const hotSeat = s.controls.length > 1;
  const opp = opposite(s.viewer);
  const nextOffer = lastOffer === null ? 0 : lastOffer + DRAW_OFFER_EVERY_MOVES;
  const canOffer = playing && s.pub.fullmove >= nextOffer;

  const offer = () => {
    setLastOffer(s.pub.fullmove);
    if (hotSeat) {
      setAskDraw(true);
      return;
    }
    controller.offerDraw();
    setNote('Draw offered.');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (controller.snapshot.value.status === 'playing')
        setNote(`No agreement: ${s.names[opp]} plays on.`);
    }, 1500);
  };

  return (
    <footer class="hud-actions">
      {confirmResign ? (
        <div class="confirm" role="alertdialog" aria-label="Resign?">
          <span>Resign this battle?</span>
          <button
            class="danger"
            onClick={() => {
              setConfirmResign(false);
              controller.resign();
            }}
          >
            Yes, resign
          </button>
          <button onClick={() => setConfirmResign(false)}>Keep playing</button>
        </div>
      ) : askDraw ? (
        <div class="confirm" role="alertdialog" aria-label="Draw offer">
          <span>
            {s.names[opp]} ({sideName(opp)}): {s.names[s.viewer]} offers a draw. Accept?
          </span>
          <button
            onClick={() => {
              setAskDraw(false);
              controller.offerDraw();
            }}
          >
            Accept draw
          </button>
          <button
            onClick={() => {
              setAskDraw(false);
              setNote('Draw declined.');
            }}
          >
            Decline
          </button>
        </div>
      ) : (
        <div class="row">
          <button
            disabled={!canOffer}
            title={
              canOffer || !playing
                ? undefined
                : `One draw offer per ${DRAW_OFFER_EVERY_MOVES} moves`
            }
            onClick={offer}
          >
            Offer draw
          </button>
          <button class="danger" disabled={!playing} onClick={() => setConfirmResign(true)}>
            Resign
          </button>
          <button onClick={() => go('title')}>Leave</button>
        </div>
      )}
      <p class="muted small-text" aria-live="polite">
        {note}
        {playing && !canOffer && lastOffer !== null
          ? ` Next draw offer from move ${nextOffer}.`
          : ''}
      </p>
    </footer>
  );
}

/** Online battles: socket state, the opponent's connection (9.2 grace) and incoming draw offers. */
function OnlineStatus({ controller }: { controller: BattleController }) {
  const s = controller.snapshot.value;
  const [now, setNow] = useState(Date.now());
  const away = s.opponent && !s.opponent.connected ? s.opponent.graceUntil : undefined;
  useEffect(() => {
    if (away === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [away]);
  const offer =
    s.drawOffer && s.drawOffer !== s.viewer && s.status === 'playing' ? s.drawOffer : null;
  return (
    <>
      {s.connection === 'connecting' && (
        <p class="note" role="status">
          Connecting to the battle…
        </p>
      )}
      {s.connection === 'reconnecting' && (
        <p class="note warn" role="status">
          Connection lost. Reconnecting… (your clock keeps running)
        </p>
      )}
      {away !== undefined && s.status === 'playing' && (
        <p class="note" role="status">
          {s.names[opposite(s.viewer)]} disconnected. They lose by abandonment in{' '}
          {Math.max(0, Math.ceil((away - now) / 1000))} s unless they return.
        </p>
      )}
      {s.notice && <p class="note warn">{s.notice}</p>}
      {offer && (
        <div class="confirm" role="alertdialog" aria-label="Draw offer">
          <span>{s.names[offer]} offers a draw. Accept?</span>
          <button onClick={() => controller.replyDraw?.(true)}>Accept draw</button>
          <button onClick={() => controller.replyDraw?.(false)}>Decline</button>
        </div>
      )}
    </>
  );
}
