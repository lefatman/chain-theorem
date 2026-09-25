/**
 * Battle screen: Phaser board (lazy-loaded, 12.3) plus the Preact HUD overlay. The view only ever
 * uses projections (R-INFO-005): the live `pub`, projected log lines, and replay frames rebuilt from
 * them (ui/replay.ts). Legal moves come with the projection (DD-37); previews use only the viewer's
 * loadout and revealed information (8.4); attack hints use the same belief state (10.3).
 *
 * The board scene queues action animations itself and defers live snapshots while animating or
 * while a replay frame is pinned (showPublic). Replay steps forward animate from the pinned frame;
 * any other jump pins the target frame directly; leaving replay calls showLive.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import {
  moveToUci,
  squareName,
  uciToMove,
  type Move,
  type PublicState,
  type Side,
} from '@chain-theorem/rules';
import type { BattleController, BattleSnapshot } from './controller.ts';
import type { BoardGame } from './scene/game.ts';
import { settings } from '../state/settings.ts';
import { attackHints } from '../ui/attacks.ts';
import { BattleHud } from '../ui/BattleHud.tsx';
import { cap } from '../ui/labels.ts';
import { optionSquare } from '../ui/PromptDialog.tsx';
import { frameAt, groupActions, isStep, navigate, stepSquares } from '../ui/replay.ts';
import { COMPACT_QUERY, useMedia } from '../ui/useMedia.ts';

type Scene = BoardGame['scene'];
type SceneHighlights = Parameters<Scene['setHighlights']>[0];

/** Replay-capable scene methods, feature-detected so an older scene still works (no animation). */
interface ReplayScene {
  showPublic(pub: PublicState, viewer: Side): void;
  showLive(): void;
  skipAnimations?(): void;
  isAnimating?(): boolean;
}

function replayApi(scene: Scene): ReplayScene | null {
  const s = scene as Partial<ReplayScene>;
  return typeof s.showPublic === 'function' && typeof s.showLive === 'function'
    ? (scene as unknown as ReplayScene)
    : null;
}

const NO_HINTS = { threatened: [] as number[], unsafeTargets: [] as number[] };

function animationMs(): number {
  const s = settings.value;
  return s.reducedMotion ? 0 : s.fastMode ? 60 : 220;
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function BattleView({ controller }: { controller: BattleController }) {
  const host = useRef<HTMLDivElement>(null);
  const board = useRef<BoardGame | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [inspect, setInspect] = useState<number | null>(null);
  const [hoverSq, setHoverSq] = useState<number | null>(null);
  const [previewMove, setPreviewMove] = useState<Move | null>(null);
  const [promo, setPromo] = useState<Move[] | null>(null);
  const [promptFocus, setPromptFocus] = useState<number | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const compact = useMedia(COMPACT_QUERY);
  const snap = controller.snapshot.value;
  const hintsOn = settings.value.attackHints;

  const atRef = useRef(at);
  atRef.current = at;
  /** Event index of the replay frame pinned on the board (null = live). */
  const shownAt = useRef<number | null>(null);
  const replayToken = useRef(0);

  // ---- board lifecycle and live animations --------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    const unsub = controller.onUpdate((u) => {
      // While a replay frame is pinned the live board waits; showLive() catches up later.
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
          onSquare: (sq: number) => onSquareRef.current(sq),
          onHover: (sq: number | null) => setHoverSq(sq),
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
      // Phaser destroys on the next loop step; wake a sleeping loop (on-demand rendering) so the
      // game, its WebGL context and the scene's idle timer go now, not never.
      board.current?.game.destroy(true);
      board.current?.game.loop.wake();
      board.current = null;
    };
  }, [controller]);

  useSignalEffect(() => {
    const s = controller.snapshot.value;
    void settings.value.classicView;
    const g = board.current;
    if (!g) return;
    // The scene stores this and draws it once no animation is queued and no replay frame is pinned.
    if (replayApi(g.scene) || atRef.current === null) g.scene.setSnapshot(s);
  });

  // ---- replay frames (11.2) -----------------------------------------------------------------------
  useEffect(() => {
    const g = board.current;
    if (!g || !ready) return;
    const token = ++replayToken.current;
    const api = replayApi(g.scene);
    const s: BattleSnapshot = controller.snapshot.value;
    const prev = shownAt.current;
    shownAt.current = at;
    if (!api) {
      // Older scene: draw frames without animation.
      g.scene.setSnapshot(at === null ? s : { ...s, pub: frameAt(s.pub, s.log, at) ?? s.pub });
      return;
    }
    const frame = at === null ? null : frameAt(s.pub, s.log, at);
    const steps = s.log.filter((e) => isStep(e.event));
    const pi = prev === null ? -1 : steps.findIndex((e) => e.i === prev);
    const ti = at === null ? -1 : steps.findIndex((e) => e.i === at);
    const before =
      frame && prev !== null && pi >= 0 && ti === pi + 1 ? frameAt(s.pub, s.log, prev) : null;
    if (frame && before && prev !== null && at !== null) {
      // One step forward: the scene animates from the pinned frame and pins the result.
      const events = s.log.filter((e) => e.i > prev && e.i <= at).map((e) => e.event);
      void g.scene.animate({ before, after: frame, events }).catch(() => undefined);
      return;
    }
    const lastI = steps[steps.length - 1]?.i;
    if (at === null && prev !== null && pi >= 0 && pi === steps.length - 2 && lastI !== undefined) {
      // Stepping onto the final step returns to live: animate that step, then unpin.
      const from = frameAt(s.pub, s.log, prev);
      const to = frameAt(s.pub, s.log, lastI);
      if (from && to) {
        const events = s.log.filter((e) => e.i > prev).map((e) => e.event);
        void g.scene
          .animate({ before: from, after: to, events })
          .catch(() => undefined)
          .then(() => {
            if (token === replayToken.current) api.showLive();
          });
        return;
      }
    }
    const apply = () => {
      if (token !== replayToken.current) return;
      if (at === null || !frame) {
        shownAt.current = null;
        api.showLive();
      } else api.showPublic(frame, s.viewer);
    };
    if (api.isAnimating?.()) {
      // Let a skipped step finish settling before pinning, so it cannot re-pin its own result.
      api.skipAnimations?.();
      void nextTask().then(apply);
    } else apply();
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

  // ---- interaction ------------------------------------------------------------------------------------
  const legal = useMemo(() => snap.pub.legal.map(uciToMove), [snap.pub]);
  const myTurn =
    snap.status === 'playing' &&
    !snap.handoff &&
    !snap.prompt &&
    !snap.pub.pending &&
    snap.pub.turn === snap.viewer &&
    snap.controls.includes(snap.viewer);
  const sel = myTurn ? selected : null;
  const targets = sel === null ? [] : legal.filter((m) => m.from === sel);
  const hints = useMemo(
    () => (hintsOn && snap.status === 'playing' ? attackHints(snap.pub, snap.own, sel) : NO_HINTS),
    [snap.pub, snap.own, sel, hintsOn, snap.status],
  );
  const hoverMove =
    hoverSq === null
      ? null
      : (targets.find((m) => m.to === hoverSq && (!m.promotion || m.promotion === 'queen')) ??
        null);
  // Board hover wins; otherwise the last focused destination stays previewed (no layout jumps).
  const preview = hoverMove ?? previewMove;
  const hoverPiece = hoverSq !== null && (snap.pub.board[hoverSq] ?? -1) >= 0 ? hoverSq : null;
  const cardSquare = hoverPiece ?? inspect ?? sel;

  const makeMove = (m: Move) => {
    controller.move(moveToUci(m));
    setSelected(null);
    setInspect(null);
    setPreviewMove(null);
    setPromo(null);
  };

  const onSquare = (sq: number) => {
    const s = controller.snapshot.value;
    if (atRef.current !== null) {
      setPlaying(false);
      setAt(null);
    }
    if (s.prompt) {
      const matches = s.prompt.options.flatMap((o, i) => (optionSquare(o) === sq ? [i] : []));
      if (matches.length === 1 && matches[0] !== undefined) controller.answer(matches[0]);
      return;
    }
    const id = s.pub.board[sq] ?? -1;
    const piece = id >= 0 ? s.pub.pieces[id] : undefined;
    if (myTurn && sel !== null && sel !== sq) {
      const choices = legal.filter((m) => m.from === sel && m.to === sq);
      if (choices.length > 1) {
        setPromo(choices);
        return;
      }
      if (choices[0]) {
        makeMove(choices[0]);
        return;
      }
    }
    if (!piece || sq === sel) {
      setSelected(null);
      setInspect(piece ? sq : null);
      return;
    }
    setInspect(sq);
    setPreviewMove(null);
    setSelected(myTurn && piece.side === s.viewer && legal.some((m) => m.from === sq) ? sq : null);
  };
  const onSquareRef = useRef(onSquare);
  onSquareRef.current = onSquare;

  // ---- highlights -----------------------------------------------------------------------------------
  useEffect(() => {
    const g = board.current;
    if (!g || !ready) return;
    const s = controller.snapshot.value;
    let h: SceneHighlights;
    if (at !== null) {
      const ev = s.log.find((e) => e.i === at)?.event;
      const sq = ev ? stepSquares(ev) : { move: null, focus: [] };
      h = {
        selected: sq.focus[0] ?? null,
        targets: [],
        captures: [],
        lastMove: sq.move,
        attacked: [],
      };
    } else {
      const lastMove = [...s.log]
        .reverse()
        .find((e) => e.event.k === 'MoveMade' && e.depth === 0)?.event;
      const lm =
        lastMove?.k === 'MoveMade' ? ([lastMove.from, lastMove.to] as [number, number]) : null;
      if (s.prompt) {
        const squares = s.prompt.options.flatMap((o) => {
          const x = optionSquare(o);
          return x === null ? [] : [x];
        });
        h = { selected: promptFocus, targets: squares, captures: [], lastMove: lm, attacked: [] };
      } else {
        const attacked = [...new Set([...hints.threatened, ...hints.unsafeTargets])];
        h = {
          selected: sel,
          targets: settings.value.moveHighlights ? targets.map((m) => m.to) : [],
          captures: targets.filter((m) => (s.pub.board[m.to] ?? -1) >= 0).map((m) => m.to),
          lastMove: lm,
          attacked,
        };
      }
    }
    g.scene.setHighlights(h);
  });

  // ---- render ---------------------------------------------------------------------------------------
  const replayEntry = at === null ? null : snap.log.find((e) => e.i === at);
  const waitingFor =
    snap.status === 'ended'
      ? 'The battle is over.'
      : snap.pub.pending && snap.pub.pending.chooser !== snap.viewer
        ? `${snap.names[snap.pub.pending.chooser]} is choosing...`
        : snap.handoff
          ? 'Waiting for the next player.'
          : snap.prompt
            ? 'Answer the prompt first.'
            : `${snap.names[snap.pub.turn]} is thinking...`;
  return (
    <div class={`battle ${compact ? 'compact' : ''}`}>
      <div class="board-wrap">
        {replayEntry && (
          <div class="replay-banner" role="status">
            <span aria-hidden="true">{'↺'} </span>
            <span class="replay-text">Replay: {replayEntry.text}</span>
            <button
              class="small"
              onClick={() => {
                setPlaying(false);
                setAt(null);
              }}
            >
              Back to live
            </button>
          </div>
        )}
        <div
          class="board-host"
          ref={host}
          role="region"
          aria-label="Battle board. To move with the keyboard, use the Move panel."
        />
        {!ready && (
          <p class="board-loading" role="status">
            {failed
              ? 'The board could not load. Reload the page to try again.'
              : 'Loading board...'}
          </p>
        )}
        {promo && (
          <div class="promo" role="dialog" aria-label="Choose a promotion">
            <p>Promote to:</p>
            {promo.map((m) => (
              <button key={m.promotion} onClick={() => makeMove(m)}>
                {cap(m.promotion ?? 'queen')}
              </button>
            ))}
            <button class="ghost" onClick={() => setPromo(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
      <BattleHud
        controller={controller}
        compact={compact}
        onPromptFocus={setPromptFocus}
        move={{
          pub: snap.pub,
          own: snap.own,
          myTurn,
          waitingFor,
          selected: sel,
          targets,
          preview,
          unsafe: hints.unsafeTargets,
          threatened: hints.threatened,
          hints: hintsOn,
          onSelect: (sq) => {
            setSelected(sq);
            setInspect(sq);
            setPreviewMove(null);
          },
          onPreview: setPreviewMove,
          onMove: (m) => {
            const variants = targets.filter((t) => t.to === m.to && t.from === m.from);
            if (variants.length > 1 && !m.promotion) setPromo(variants);
            else makeMove(m);
          },
        }}
        inspect={{
          square: cardSquare,
          pinned: hoverPiece === null && inspect !== null,
          onClose: () => setInspect(null),
        }}
        replay={{
          at,
          playing,
          onSeek: setAt,
          onPlay: setPlaying,
        }}
      />
      <p class="sr-only" aria-live="polite">
        {sel !== null ? `Selected ${squareName(sel)}. ${targets.length} moves.` : ''}
      </p>
    </div>
  );
}
