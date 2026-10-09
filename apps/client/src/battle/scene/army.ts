/**
 * Army manifest (R-ART-001, R-ART-003): the battle pieces are human soldiers drawn in one of four
 * cultural styles. A style is a cosmetic choice per player (never sold, 11.1): the piece types keep
 * their silhouettes across styles, the owner shows in the armour colour (white steel or black iron)
 * and the element in the accents and the emblem (sprites.ts, palette.ts).
 *
 * Unit names are plain historical terms, one per style and piece type; `look` describes each sprite
 * for the sheet exporter and for artists replacing the procedural art (assets/army/README.md).
 */
import type { PieceType, Side } from '@chain-theorem/rules';

export type ArmyStyle = 'roman' | 'medieval' | 'arab' | 'samurai';
export const ARMY_STYLES: readonly ArmyStyle[] = ['roman', 'medieval', 'arab', 'samurai'];
export const ARMY_STYLE_LABEL: Record<ArmyStyle, string> = {
  roman: 'Roman legion',
  medieval: 'Medieval court',
  arab: 'Arabian host',
  samurai: 'Samurai clan',
};

export interface UnitEntry {
  /** Stable id: `${style}-${type}`. */
  id: string;
  style: ArmyStyle;
  type: PieceType;
  name: string;
  look: string;
}

type Roster = Record<ArmyStyle, Record<PieceType, [name: string, look: string]>>;

const ROSTER: Roster = {
  roman: {
    pawn: [
      'Legionary',
      'a short soldier in a rounded helmet with cheek guards, a tall rectangular shield and a pilum',
    ],
    knight: [
      'Eques',
      'a rider on a horse, a tall crest plume across the helmet, a round shield and a spear',
    ],
    bishop: [
      'Augur',
      'a slender priest in a long robe with a front stripe, a pointed cap and a curled lituus staff',
    ],
    rook: [
      'Praetorian',
      'a broad guard behind a tower shield, a square helm with a crenellated top and a mace',
    ],
    queen: ['Augusta', 'a tall lady in a bell-shaped stola with a diadem, long hair and a sceptre'],
    king: [
      'Imperator',
      'a broad monarch in a muscled cuirass and a long cloak, a gold laurel wreath and a short sword',
    ],
  },
  medieval: {
    pawn: [
      'Footman',
      'a short soldier in a wide kettle hat over a mail coif, a pointed heater shield and a spear',
    ],
    knight: ['Knight', 'a rider in a great helm with a plume, a heater shield and a lance'],
    bishop: [
      'Bishop',
      'a slender cleric in a tall mitre and a long robe with a stole, holding a crozier',
    ],
    rook: [
      'Castellan',
      'a broad man-at-arms behind a tall pavise, a flat helm with merlons and a poleaxe',
    ],
    queen: [
      'Queen',
      'a tall lady in a bell gown with a three-point crown, long hair and a sceptre',
    ],
    king: [
      'King',
      'a broad bearded monarch in a tunic and an ermine-trimmed mantle, a tall crown and a sword',
    ],
  },
  arab: {
    pawn: [
      'Askari',
      'a short soldier in a conical helmet with a mail aventail and a turban band, a round shield and a spear',
    ],
    knight: [
      'Faris',
      'a rider in a spiked turban helmet with a plume, a round shield and a curved sword',
    ],
    bishop: [
      'Hakim',
      'a slender scholar in a tall turban and a long robe, with a long beard and a staff',
    ],
    rook: [
      'Warden',
      'a broad guard behind a tall kite shield, a domed helm with merlons and an aventail, and a mace',
    ],
    queen: [
      'Sultana',
      'a tall lady in a flowing gown with a jewelled diadem, a veil and a sceptre',
    ],
    king: [
      'Sultan',
      'a broad bearded monarch in a long caftan and a great turban with a plume, holding a curved sword',
    ],
  },
  samurai: {
    pawn: [
      'Ashigaru',
      'a short soldier in a conical jingasa hat bearing the emblem, laced armour and a yari spear',
    ],
    knight: [
      'Hatamoto',
      'a rider in a horned kabuto and a face mask, with a back banner and a yari',
    ],
    bishop: [
      'Sohei',
      'a slender warrior monk in a tall white cowl and a robe, holding a ringed staff',
    ],
    rook: [
      'Yojimbo',
      'a broad guard behind a tall standing shield, a square helm with merlons and a studded club',
    ],
    queen: [
      'Hime',
      'a tall lady with long black hair and a gold hair ornament, in a kimono with a wide sash',
    ],
    king: [
      'Shogun',
      'a broad monarch in a kabuto with a great gold crest, a sleeveless war coat over armour, and a long sword',
    ],
  },
};

const TYPE_ORDER: readonly PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/** All 24 units, style-major in ARMY_STYLES order, then pawn..king. */
export const units: readonly UnitEntry[] = ARMY_STYLES.flatMap((style) =>
  TYPE_ORDER.map((type) => {
    const [name, look] = ROSTER[style][type];
    return { id: `${style}-${type}`, style, type, name, look };
  }),
);

/** The unit name for a piece type in a style. */
export function unitName(style: ArmyStyle, type: PieceType): string {
  return ROSTER[style][type][0];
}

/** FNV-1a of a string (stable per player name). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Which style each side's army wears in a battle. The sides this client controls wear the chosen
 * style (in hot-seat play only White does); every other side gets a stable style from its name,
 * never the same as the opposite side's, so the two armies always contrast. A style is cosmetic
 * and local: the opponent's own choice is not sent over the wire.
 */
export function armyStylesFor(
  chosen: ArmyStyle,
  names: Record<Side, string>,
  controls: readonly Side[],
): Record<Side, ArmyStyle> {
  const own = (side: Side): boolean =>
    controls.includes(side) && !(controls.length === 2 && side === 'black');
  const other = (side: Side, avoid: ArmyStyle): ArmyStyle => {
    const rest = ARMY_STYLES.filter((s) => s !== avoid);
    return rest[hash(names[side]) % rest.length] ?? chosen;
  };
  if (own('white')) return { white: chosen, black: other('black', chosen) };
  if (own('black')) return { white: other('white', chosen), black: chosen };
  const white = ARMY_STYLES[hash(names.white) % ARMY_STYLES.length] ?? chosen;
  return { white, black: other('black', white) };
}
