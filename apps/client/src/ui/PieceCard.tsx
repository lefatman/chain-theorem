/**
 * Piece detail card (11.2: "Revealed abilities: small pips under the piece; tap or hover for
 * details" and "Charges: remaining uses shown as pips on the ability's detail card"). Own pieces
 * show their type's full set in resolution order with exact remaining charges; opponent pieces show
 * only what has been revealed for their type, with charges counted from the projected usage
 * (R-INFO-005). Attuned markers follow 6.3.
 */
import { useMemo } from 'preact/hooks';
import { abilityById, engine, itemById } from '@chain-theorem/content';
import {
  eligibleFor,
  opposite,
  squareName,
  type AbilityDef,
  type GameState,
  type Loadout,
  type PublicPiece,
  type PublicState,
} from '@chain-theorem/rules';
import { CategoryTag, ElementBadge, Pips, PieceGlyph } from './bits.tsx';
import { PIECE_PLURAL, cap, sideName, traitOf } from './labels.ts';

interface Row {
  def: AbilityDef;
  attuned: boolean;
  eligible: boolean;
  charges: { left: number; total: number } | null;
}

/** Attuned if its affinity matches the piece's element, or an equipped item attunes it (6.3). */
function isAttuned(def: AbilityDef, piece: PublicPiece, own: Loadout | null): boolean {
  if (!def.attuned || def.affinity === 'neutral') return false;
  if (def.affinity === piece.element) return true;
  if (!own) return false;
  return own.items.some(
    (id) =>
      itemById.get(id)?.hooks.attunement !== undefined &&
      own.itemParams?.[id]?.element === def.affinity,
  );
}

function chargesOf(
  belief: GameState | null,
  pub: PublicState,
  piece: PublicPiece,
  def: AbilityDef,
): Row['charges'] {
  if (def.limits.charges === undefined || !belief) return null;
  const used = pub.usage[`${piece.id}:${def.id}`] ?? 0;
  const left = engine.remainingCharges(belief, piece.id, def.id);
  if (!Number.isFinite(left)) return null;
  return { left: Math.max(0, left), total: Math.max(0, left) + used };
}

export function PieceCard({
  pub,
  own,
  square,
  pinned,
  onClose,
}: {
  pub: PublicState;
  own: Loadout;
  square: number | null;
  /** True when the card was opened by a click (shows a close button). */
  pinned: boolean;
  onClose(): void;
}) {
  const belief = useMemo(() => {
    try {
      return engine.beliefState(pub, own);
    } catch {
      return null;
    }
  }, [pub, own]);
  const id = square === null ? -1 : (pub.board[square] ?? -1);
  const piece = id >= 0 ? pub.pieces[id] : undefined;
  if (!piece || square === null) {
    return (
      <section class="piece-card empty" aria-label="Piece details">
        <p class="muted">Tap or hover a piece to see its abilities and charges.</p>
      </section>
    );
  }
  const mine = piece.side === pub.viewer;
  const army = pub.armies[piece.side];
  const ids = mine
    ? (army.sets?.[piece.type] ?? [])
    : (pub.armies[piece.side].revealed.abilities[piece.type] ?? []);
  const rows: Row[] = ids.flatMap((a) => {
    const def = abilityById.get(a);
    if (!def) return [];
    return [
      {
        def,
        attuned: isAttuned(def, piece, mine ? own : null),
        eligible: eligibleFor(def, piece.type),
        charges: chargesOf(belief, pub, piece, def),
      },
    ];
  });
  const known = army.revealed;
  const complete = known.complete.includes(piece.type);
  const veiled = known.veiled.includes(piece.type);
  const trait = traitOf(piece.element);
  return (
    <section class="piece-card" aria-label="Piece details" aria-live="polite">
      <header>
        <h3>
          <PieceGlyph type={piece.type} side={piece.side} /> {sideName(piece.side)} {piece.type} on{' '}
          {squareName(square)}
        </h3>
        {pinned && (
          <button class="small" aria-label="Close piece details" onClick={onClose}>
            {'✕'}
          </button>
        )}
      </header>
      <p class="piece-meta">
        <span class="owner">{mine ? 'Yours' : 'Opponent'}</span> ·{' '}
        <ElementBadge el={piece.element} />
        {trait && (
          <span class="muted">
            {' '}
            · {trait.name}: {trait.short}
          </span>
        )}
      </p>
      <h4>
        {mine
          ? `${cap(piece.type)} abilities (resolution order)`
          : `Seen on ${sideName(piece.side)}'s ${PIECE_PLURAL[piece.type]}`}
      </h4>
      {rows.length === 0 ? (
        <p class="muted">{mine ? 'No abilities on this piece type.' : 'None seen yet.'}</p>
      ) : (
        <ol class="ability-rows">
          {rows.map((r) => (
            <li key={r.def.id}>
              <div class="ability-row-head">
                <strong>{r.def.name}</strong> <CategoryTag cat={r.def.category} />
                {r.attuned && (
                  <span class="tag attuned">
                    <span aria-hidden="true">{'★'}</span> Attuned
                  </span>
                )}
                {r.charges && (
                  <Pips
                    left={r.charges.left}
                    total={r.charges.total}
                    label={`${r.def.name} charges`}
                  />
                )}
              </div>
              {!r.eligible && (
                <p class="note warn">
                  <span aria-hidden="true">{'⚠︎'}</span> Does nothing on a {piece.type}.
                </p>
              )}
              <p class="rules">{r.def.text.rules}</p>
            </li>
          ))}
        </ol>
      )}
      {!mine && (
        <p class="note">
          {complete ? (
            <>
              <span aria-hidden="true">{'✓'}</span> Complete: this is the whole {piece.type} set.
            </>
          ) : (
            <>
              <span aria-hidden="true">?</span> More abilities may be hidden.
            </>
          )}
          {veiled && (
            <>
              {' '}
              <span aria-hidden="true">{'◐'}</span> Veiled: its abilities act unnamed.
            </>
          )}
        </p>
      )}
      {mine && known.abilities[piece.type]?.length ? (
        <p class="muted">
          {sideName(opposite(piece.side))} has seen:{' '}
          {(known.abilities[piece.type] ?? []).map((a) => abilityById.get(a)?.name ?? a).join(', ')}
        </p>
      ) : null}
    </section>
  );
}
