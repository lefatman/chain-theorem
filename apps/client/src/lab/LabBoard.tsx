/**
 * The Scenario Lab's board: the same Phaser BoardScene the battle uses (lazy-loaded, 12.3), driven
 * only through `showPublic` with one frame per event. Stepping forward by exactly one event animates
 * that event from the pinned previous frame (skippable; none under reduced motion, 11.2); any other
 * jump pins the target frame directly.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import type { BattleEvent, PublicState } from '@chain-theorem/rules';
import type { Highlights } from '../battle/scene/BoardScene.ts';
import type { BoardGame } from '../battle/scene/game.ts';
import { settings } from '../state/settings.ts';

export interface BoardFrame {
  pub: PublicState;
  /** The frame one event earlier and that event, when stepping forward by one (animated). */
  from?: { pub: PublicState; events: BattleEvent[] } | null;
}

function animationMs(): number {
  const s = settings.value;
  return s.reducedMotion ? 0 : s.fastMode ? 60 : 200;
}

/** The board the scene shows is the one this step starts from (so it can animate the step). */
function samePosition(a: PublicState, b: PublicState): boolean {
  if (a === b) return true;
  return (
    a.eventSeq === b.eventSeq &&
    a.viewer === b.viewer &&
    a.board.every((id, sq) => b.board[sq] === id) &&
    a.pieces.every((p, i) => b.pieces[i]?.type === p.type && b.pieces[i]?.square === p.square)
  );
}

export function LabBoard({
  frame,
  highlights,
  onSquare,
  label,
}: {
  frame: BoardFrame;
  highlights: Highlights;
  onSquare(square: number): void;
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const board = useRef<BoardGame | null>(null);
  const shown = useRef<PublicState | null>(null);
  const onSquareRef = useRef(onSquare);
  onSquareRef.current = onSquare;
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void import('../battle/scene/game.ts')
      .then(async ({ createBoardGame }) => {
        if (!host.current || disposed) return;
        const g = await createBoardGame(host.current);
        if (disposed) {
          g.game.destroy(true);
          return;
        }
        g.scene.bind({
          onSquare: (sq: number) => onSquareRef.current(sq),
          classicView: () => settings.value.classicView,
          animationMs,
          fastMode: () => settings.value.fastMode,
          textScale: () => settings.value.textScale,
        });
        board.current = g;
        setReady(true);
      })
      .catch((e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      board.current?.game.destroy(true);
      board.current = null;
    };
  }, []);

  useEffect(() => {
    const g = board.current;
    if (!g || !ready) return;
    const { pub, from } = frame;
    const prev = shown.current;
    shown.current = pub;
    if (from && prev && samePosition(prev, from.pub) && animationMs() > 0) {
      // One event forward: the scene animates from the pinned frame and pins this one.
      void g.scene
        .animate({ before: from.pub, after: pub, events: from.events })
        .catch(() => g.scene.showPublic(pub, pub.viewer));
      return;
    }
    g.scene.showPublic(pub, pub.viewer);
  }, [frame, ready]);

  useEffect(() => {
    if (ready) board.current?.scene.setHighlights(highlights);
  }, [highlights, ready]);

  // Classic View and text size are read when the scene draws: redraw the pinned frame on change.
  useSignalEffect(() => {
    void settings.value.classicView;
    void settings.value.textScale;
    const g = board.current;
    const pub = shown.current;
    // A copy forces a full redraw (the scene skips redrawing an identical frame).
    if (g && pub) g.scene.showPublic({ ...pub }, pub.viewer);
  });

  return (
    <div class="lab-board">
      <div class="lab-board-host" ref={host} role="region" aria-label={label} />
      {!ready && (
        <p class="lab-board-loading" role="status">
          {failed ? `The board could not load: ${failed}` : 'Loading board...'}
        </p>
      )}
    </div>
  );
}
