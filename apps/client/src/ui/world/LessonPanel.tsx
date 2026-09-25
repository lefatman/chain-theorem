/**
 * Chess Academy puzzles (M5, spec 10.3, R-WORLD-003): the lesson's position on a DOM mini board.
 * Click a piece, then its target square; the zone checks the answer. A wrong answer shows the
 * lesson's hint; chess lessons can be skipped by veterans (never ability or element lessons).
 * Move highlighting and "this square is attacked" hints follow the battle settings (on by default).
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { squareName, type PieceType } from '@chain-theorem/rules';
import { settings } from '../../state/settings.ts';
import { worldIndex } from '../../world/content.ts';
import type { WorldController } from '../../world/controller.ts';
import {
  displayOrder,
  hintsFor,
  pick,
  promotionUci,
  PROMOTIONS,
  readFen,
} from '../../world/miniboard.ts';

const GLYPH: Record<PieceType, string> = {
  king: '♚',
  queen: '♛',
  rook: '♜',
  bishop: '♝',
  knight: '♞',
  pawn: '♟',
};

export interface MiniBoardProps {
  fen: string;
  disabled: boolean;
  onMove(uci: string): void;
  /** Changing it clears the selection (a new try). */
  resetKey?: unknown;
}

export function MiniBoard({ fen, disabled, onMove, resetKey }: MiniBoardProps) {
  const pos = useMemo(() => readFen(fen), [fen]);
  const hints = useMemo(() => hintsFor(fen), [fen]);
  const [sel, setSel] = useState<number | null>(null);
  const [promo, setPromo] = useState<{ from: number; to: number } | null>(null);
  useEffect(() => {
    setSel(null);
    setPromo(null);
  }, [fen, resetKey]);
  if (!pos) return <p class="note warn">This puzzle's position cannot be shown.</p>;
  const s = settings.value;
  const targets = s.moveHighlights && sel !== null ? (hints?.targets.get(sel) ?? []) : [];
  const attacked = s.attackHints ? (hints?.attacked ?? []) : [];
  const order = displayOrder(pos.turn);

  const click = (sq: number) => {
    if (disabled) return;
    const r = pick(pos, { selected: sel }, sq);
    if (r.kind === 'select') setSel(r.selected);
    else if (r.kind === 'promote') setPromo(r);
    else {
      setSel(null);
      onMove(r.uci);
    }
  };

  return (
    <div class="mini-wrap">
      <div
        class="mini-board"
        role="group"
        aria-label={`Puzzle board, ${pos.turn} to move. Choose a piece, then its square.`}
      >
        {order.map((sq, i) => {
          const p = pos.board[sq] ?? null;
          const dark = ((sq >> 3) + (sq & 7)) % 2 === 0;
          const isTarget = targets.includes(sq);
          const isAttacked = attacked.includes(sq);
          const label = [
            squareName(sq),
            p ? `${p.side} ${p.type}` : 'empty',
            isAttacked ? 'attacked' : '',
            isTarget ? 'can move here' : '',
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <button
              key={sq}
              type="button"
              class={`mini-sq ${dark ? 'dark' : 'light'} ${sel === sq ? 'sel' : ''} ${
                isTarget ? 'target' : ''
              } ${isAttacked ? 'attacked' : ''}`}
              aria-label={label}
              aria-pressed={sel === sq}
              disabled={disabled}
              onClick={() => click(sq)}
            >
              {p && <span class={`mini-piece ${p.side}`}>{`${GLYPH[p.type]}︎`}</span>}
              {isTarget && <span class="mini-dot" aria-hidden="true" />}
              {isAttacked && (
                <span class="mini-warn" aria-hidden="true">
                  !
                </span>
              )}
              {i % 8 === 0 && (
                <span class="mini-rank" aria-hidden="true">
                  {(sq >> 3) + 1}
                </span>
              )}
              {i >= 56 && (
                <span class="mini-file" aria-hidden="true">
                  {'abcdefgh'[sq & 7]}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {promo && (
        <div class="mini-promo" role="group" aria-label="Promote the pawn to">
          {PROMOTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setPromo(null);
                setSel(null);
                onMove(promotionUci(promo.from, promo.to, t));
              }}
            >
              {`${GLYPH[t]}︎`} {t}
            </button>
          ))}
          <button type="button" onClick={() => setPromo(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function LessonPanel({ c }: { c: WorldController }) {
  const p = c.puzzle.value;
  const box = useRef<HTMLDivElement>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('.mini-sq:not(:disabled), button')?.focus();
  }, [p?.lesson, p?.index]);
  useEffect(() => {
    if (p?.status === 'wrong') setTries((t) => t + 1);
  }, [p?.status]);
  if (!p) return null;
  const lesson = worldIndex.value?.lessons.get(p.lesson);
  const title = lesson?.title ?? 'Chess Academy lesson';
  return (
    <div class="lesson-back">
      <div
        class="lesson panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-title"
        ref={box}
        onKeyDown={(e) => {
          if (e.key === 'Escape') c.closePuzzle();
        }}
      >
        <h3 id="lesson-title">{title}</h3>
        <p class="muted small-text">
          Puzzle {p.index + 1} of {p.count}
        </p>
        <p>{p.prompt}</p>
        <MiniBoard
          fen={p.fen}
          disabled={p.status === 'checking' || p.status === 'done'}
          onMove={(uci) => c.answer(uci)}
          resetKey={tries}
        />
        <p role="status" aria-live="polite" class={p.status === 'wrong' ? 'note warn' : 'note'}>
          {p.status === 'checking' && 'Checking…'}
          {p.status === 'wrong' && (
            <>
              <strong>Not quite.</strong> {p.hint ?? 'Try another move.'}
            </>
          )}
          {p.status === 'done' && (
            <>
              <strong>Lesson complete!</strong> Well played.
            </>
          )}
          {p.status === 'solving' && ' '}
        </p>
        <div class="row">
          {p.skippable && p.npc && p.status !== 'done' && (
            <button type="button" onClick={() => c.skipLesson()}>
              Skip this lesson
            </button>
          )}
          <button
            type="button"
            class={p.status === 'done' ? 'primary' : ''}
            onClick={() => c.closePuzzle()}
          >
            {p.status === 'done' ? 'Continue' : 'Put it away'}
          </button>
        </div>
      </div>
    </div>
  );
}
