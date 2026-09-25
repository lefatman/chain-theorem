/**
 * Shared presentation vocabulary for the DOM overlay: category labels (5.1), element names and
 * icons, piece glyphs and small text helpers. Every colour cue in the UI has one of these icons or a
 * text label as its partner (R-ART-002: colour is never the only signal).
 */
import { traits } from '@chain-theorem/content';
import {
  beats,
  foilOf,
  type AbilityDef,
  type Category,
  type ElementId,
  type PieceType,
  type Side,
} from '@chain-theorem/rules';

/** UI labels for the four categories (5.1, R-ABIL-001). */
export const CATEGORY_LABEL: Record<Category, string> = {
  CAPTURING: 'When capturing',
  CAPTURES: 'After capturing',
  CAPTURED: 'When captured',
  PASSIVE: 'Always',
};

/** Icon partner for each category (text presentation, never emoji). */
export const CATEGORY_ICON: Record<Category, string> = {
  CAPTURING: '⚔︎',
  CAPTURES: '↻',
  CAPTURED: '✖︎',
  PASSIVE: '∞',
};

export const ELEMENT_NAME: Record<ElementId, string> = {
  ember: 'Ember',
  tide: 'Tide',
  grove: 'Grove',
  storm: 'Storm',
  stone: 'Stone',
  frost: 'Frost',
  neutral: 'Neutral',
};

/** Filled chess glyphs with a text-presentation selector so no platform draws them as emoji. */
export const PIECE_GLYPH: Record<PieceType, string> = {
  pawn: '♟︎',
  knight: '♞︎',
  bishop: '♝︎',
  rook: '♜︎',
  queen: '♛︎',
  king: '♚︎',
};

export const PIECE_PLURAL: Record<PieceType, string> = {
  pawn: 'pawns',
  knight: 'knights',
  bishop: 'bishops',
  rook: 'rooks',
  queen: 'queen',
  king: 'king',
};

export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const sideName = (s: Side): string => (s === 'white' ? 'White' : 'Black');

/** Blended Family groups (6.4, R-ELEM-004). */
export const GROUP_A: readonly PieceType[] = ['pawn', 'knight', 'bishop'];
export const GROUP_B: readonly PieceType[] = ['rook', 'queen', 'king'];
export const GROUP_A_TEXT = 'pawns, knights and bishops (12 pieces)';
export const GROUP_B_TEXT = 'rooks, queen and king (4 pieces)';

export function traitOf(el: ElementId): { name: string; short: string; rules: string } | null {
  const t = traits.find((x) => x.element === el);
  return t ? { name: t.name, short: t.text.short, rules: t.text.rules } : null;
}

/** "Ember beats Grove; Tide beats Ember" (6.2 silence rule). */
export function matchupText(el: ElementId): string {
  if (el === 'neutral') return 'Neutral: no advantage and no foil.';
  const beaten = (Object.keys(ELEMENT_NAME) as ElementId[]).find(
    (x) => x !== 'neutral' && beats(el, x),
  );
  const foil = foilOf(el);
  const parts: string[] = [];
  if (beaten) parts.push(`silences ${ELEMENT_NAME[beaten]}`);
  if (foil) parts.push(`silenced by ${ELEMENT_NAME[foil]}`);
  return `${ELEMENT_NAME[el]} ${parts.join('; ')}.`;
}

export function eligibleText(def: AbilityDef): string {
  if (def.eligible === 'all') return 'All pieces';
  const list = def.eligible;
  if (list.length === 5 && !list.includes('king')) return 'All but the king';
  if (list.length === 1 && list[0]) return `${cap(list[0])} only`;
  return list.map(cap).join(', ');
}

export function chargesText(charges: number | undefined): string {
  if (charges === undefined) return 'No charge limit';
  return `${charges} charge${charges === 1 ? '' : 's'} per piece`;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
