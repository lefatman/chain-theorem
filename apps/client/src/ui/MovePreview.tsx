/**
 * Move panel and move preview (8.4, R-INFO-004). Pieces and destinations are also buttons, so every
 * move can be made from the keyboard. Hovering or focusing a destination (on the board or here)
 * previews the move with engine.preview, which uses only the viewer's own loadout and revealed
 * opponent information; things hidden information could change are listed with a "?". After commit
 * the move is spent even if a hidden ability changes the outcome (INV-06).
 */
import { useMemo } from 'preact/hooks';
import { engine, itemById } from '@chain-theorem/content';
import {
  PIECE_TYPES,
  squareName,
  type Loadout,
  type Move,
  type PublicState,
  type Unknown,
} from '@chain-theorem/rules';
import { describe } from '../battle/describe.ts';
import { PieceGlyph } from './bits.tsx';
import { ELEMENT_NAME, PIECE_PLURAL, cap, sideName, traitOf } from './labels.ts';

const HIDDEN_IN_PREVIEW = new Set(['ActionStarted', 'TurnPassed', 'ChoiceMade']);

function unknownText(u: Unknown, pub: PublicState): string {
  const opp = pub.viewer === 'white' ? 'black' : 'white';
  switch (u.kind) {
    case 'victimAbilities':
      return `The ${u.pieceType} may carry When-captured abilities you have not seen.`;
    case 'reactionAbilities':
      return `${cap(PIECE_PLURAL[u.pieceType])} may react with abilities you have not seen.`;
    case 'opponentItems': {
      const army = pub.armies[opp];
      const known = army.revealed.items.reduce((n, id) => n + (itemById.get(id)?.slotCost ?? 0), 0);
      const left = Math.max(0, army.consumedSlots - known);
      return `${sideName(opp)} has ${left} unexplained item slot${left === 1 ? '' : 's'}; hidden items may change this.`;
    }
  }
}

export interface MovePanelProps {
  pub: PublicState;
  own: Loadout;
  myTurn: boolean;
  waitingFor: string | null;
  selected: number | null;
  targets: Move[];
  preview: Move | null;
  unsafe: number[];
  threatened: number[];
  hints: boolean;
  onSelect(square: number | null): void;
  onPreview(m: Move | null): void;
  onMove(m: Move): void;
}

/** Opponent element traits can change how they attack (for example Flow), so name them. */
function TraitNote({ pub }: { pub: PublicState }) {
  const opp = pub.viewer === 'white' ? 'black' : 'white';
  const lines = pub.armies[opp].elements.flatMap((el) => {
    const t = traitOf(el);
    return t ? [`${ELEMENT_NAME[el]} trait ${t.name}: ${t.short}`] : [];
  });
  if (lines.length === 0) return null;
  return <p class="muted small-text">{lines.join(' ')}</p>;
}

export function MovePreview(p: MovePanelProps) {
  const { pub } = p;
  const movable = useMemo(() => {
    // UCI moves start with the origin square (DD-37: legal moves come with the projection).
    const froms = new Set(pub.legal.map((u) => u.slice(0, 2)));
    return pub.pieces
      .filter((x) => x.side === pub.viewer && x.square >= 0 && froms.has(squareName(x.square)))
      .sort(
        (a, b) => PIECE_TYPES.indexOf(a.type) - PIECE_TYPES.indexOf(b.type) || a.square - b.square,
      );
  }, [pub]);
  const result = useMemo(() => {
    if (!p.preview) return null;
    try {
      return engine.preview(pub, p.own, p.preview);
    } catch {
      return null;
    }
  }, [pub, p.own, p.preview?.from, p.preview?.to, p.preview?.promotion]);

  const selPiece = p.selected === null ? undefined : pub.pieces[pub.board[p.selected] ?? -1];
  return (
    <section class="move-panel" aria-labelledby="move-h">
      <h3 id="move-h">Move</h3>
      {!p.myTurn ? (
        <p class="muted">{p.waitingFor ?? 'Waiting.'}</p>
      ) : p.selected === null || !selPiece ? (
        <>
          <p class="muted">Choose a piece on the board, or here:</p>
          <div class="chips" role="group" aria-label="Pieces that can move">
            {movable.map((x) => (
              <button
                key={x.id}
                class={`chip-btn ${p.threatened.includes(x.square) && p.hints ? 'threat' : ''}`}
                aria-label={`${x.type} on ${squareName(x.square)}${p.threatened.includes(x.square) && p.hints ? ', attacked' : ''}`}
                onClick={() => p.onSelect(x.square)}
              >
                <PieceGlyph type={x.type} side={x.side} /> {squareName(x.square)}
                {p.hints && p.threatened.includes(x.square) && (
                  <span class="warn-mark" aria-hidden="true">
                    {'⚠︎'}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p>
            <PieceGlyph type={selPiece.type} side={selPiece.side} /> {cap(selPiece.type)} on{' '}
            {squareName(p.selected)}: choose a destination.
          </p>
          <div class="chips" role="group" aria-label="Destinations">
            {p.targets.map((m) => {
              const unsafe = p.hints && p.unsafe.includes(m.to);
              const capture = (pub.board[m.to] ?? -1) >= 0;
              return (
                <button
                  key={`${m.to}${m.promotion ?? ''}`}
                  class={`chip-btn ${unsafe ? 'threat' : ''} ${capture ? 'capture' : ''}`}
                  aria-label={`${capture ? 'Capture on' : 'Move to'} ${squareName(m.to)}${m.promotion ? `, promote to ${m.promotion}` : ''}${unsafe ? ', attacked there' : ''}`}
                  onMouseEnter={() => p.onPreview(m)}
                  onFocus={() => p.onPreview(m)}
                  onClick={() => p.onMove(m)}
                >
                  {capture && (
                    <span aria-hidden="true" class="cap-mark">
                      {'✕'}
                    </span>
                  )}
                  {squareName(m.to)}
                  {m.promotion ? ` = ${cap(m.promotion)}` : ''}
                  {unsafe && (
                    <span class="warn-mark" aria-hidden="true">
                      {'⚠︎'}
                    </span>
                  )}
                </button>
              );
            })}
            <button class="chip-btn ghost" onClick={() => p.onSelect(null)}>
              Cancel
            </button>
          </div>
          {p.hints && (
            <p class="muted small-text">
              <span aria-hidden="true">{'⚠︎'}</span> = the opponent attacks that square after your
              move. <span aria-hidden="true">{'✕'}</span> = capture.
            </p>
          )}
        </>
      )}
      {p.hints && p.threatened.length > 0 && p.selected === null && (
        <>
          <p class="note warn">
            <span aria-hidden="true">{'⚠︎'}</span> Under attack now:{' '}
            {p.threatened
              .map((sq) => {
                const x = pub.pieces[pub.board[sq] ?? -1];
                return x ? `${x.type} on ${squareName(sq)}` : squareName(sq);
              })
              .join(', ')}
          </p>
          <TraitNote pub={pub} />
        </>
      )}
      {p.preview && (
        <div class="preview" aria-live="polite">
          <h4>
            Preview: {squareName(p.preview.from)} {'→'} {squareName(p.preview.to)}
            {p.preview.promotion ? ` = ${cap(p.preview.promotion)}` : ''}
          </h4>
          {!result || !result.legal ? (
            <p class="muted">No preview for this move.</p>
          ) : (
            <>
              <ol class="preview-lines">
                {result.events
                  .filter((e) => !HIDDEN_IN_PREVIEW.has(e.k))
                  .map((e) => (
                    <li key={e.i} class={`depth-${e.depth}`}>
                      {describe(e, pub)}
                    </li>
                  ))}
              </ol>
              {result.result && (
                <p class="note ok">
                  <span aria-hidden="true">{'⚑'}</span>{' '}
                  {result.result.winner === pub.viewer
                    ? `This wins the battle (${result.result.reason.replace(/_/g, ' ')}).`
                    : result.result.winner === null
                      ? `This ends in a draw (${result.result.reason.replace(/_/g, ' ')}).`
                      : `This loses the battle (${result.result.reason.replace(/_/g, ' ')}).`}
                </p>
              )}
              {result.unknowns.length > 0 && (
                <ul class="unknowns">
                  {result.unknowns.map((u, i) => (
                    <li key={i}>
                      <span class="q" aria-hidden="true">
                        ?
                      </span>{' '}
                      {unknownText(u, pub)}
                    </li>
                  ))}
                </ul>
              )}
              <p class="muted small-text">
                Uses only your loadout and what you have seen. Once made, the move is spent even if
                a hidden ability changes the outcome.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
