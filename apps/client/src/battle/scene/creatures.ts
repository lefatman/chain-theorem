/**
 * Creature manifest (R-ART-001 roster of 36; R-ART-003 original names). One creature per element
 * and piece type. Names are original coinages; a suffix per type keeps the role learnable
 * (-let pawns, -lope knights, -seer bishops, -keep rooks, crowned kings), while queens get a regal
 * name of their own. At authoring time every name was checked against the full list of 1,025
 * Pokémon species: no match, no species name inside a name, and an edit distance of at least 3
 * from every species (see creatures.test.ts for the kept guard).
 *
 * `look` describes each sprite for the sprite-sheet exporter and for human artists replacing the
 * procedural art in M4 step 4.5 (keep the silhouette; see sprites.ts).
 */
import type { ElementId, PieceType } from '@chain-theorem/rules';

export interface CreatureEntry {
  /** Stable id: `${element}-${type}`. */
  id: string;
  name: string;
  element: Exclude<ElementId, 'neutral'>;
  type: PieceType;
  look: string;
}

type Roster = Record<
  Exclude<ElementId, 'neutral'>,
  Record<PieceType, [name: string, look: string]>
>;

const ROSTER: Roster = {
  ember: {
    pawn: ['Flickerlet', 'a round ember chick with a flame tuft and a flame-tipped tail'],
    knight: ['Blazelope', 'a leaping fox-antelope with a flame tail and a red mane'],
    bishop: ['Wickseer', 'a slender candle-mage in a red mitre, holding a staff with a flame orb'],
    rook: ['Hearthkeep', 'a blocky hearth-golem whose three battlements burn like candles'],
    queen: ['Pyrelle', 'a tall fire empress with flowing red hair and flames along her hem'],
    king: ['Coalcrown', 'a round coal-bellied monarch in a crimson cape and a gold crown'],
  },
  tide: {
    pawn: ['Bubblet', 'a round water sprite with a curling wave crest and a fin tail'],
    knight: ['Surflope', 'a leaping sea-deer with a finned tail and a teal mane'],
    bishop: ['Brineseer', 'a slender tide-mage in a teal mitre with a foaming orb staff'],
    rook: ['Tidekeep', 'a blocky reef-golem crowned by three breaking waves'],
    queen: ['Coralessa', 'a tall ocean queen with teal hair and foam at her hem'],
    king: ['Reefcrown', 'a round blue monarch in a teal cape with a pearl in his crown'],
  },
  grove: {
    pawn: ['Sproutlet', 'a round seedling with two leaves on top and a leafy tail'],
    knight: ['Mosslope', 'a leaping moss-stag with a leaf tail and a green mane'],
    bishop: ['Thornseer', 'a slender druid in a green mitre with a sprouting staff'],
    rook: ['Barkkeep', 'a blocky bark-golem whose battlements sprout leaves'],
    queen: ['Verdelle', 'a tall forest queen with vine hair and leaves at her hem'],
    king: ['Oakcrown', 'a round leafy monarch in a green cape and a gold crown'],
  },
  storm: {
    pawn: ['Sparklet', 'a round spark imp with a lightning antenna'],
    knight: ['Boltlope', 'a leaping thunder-hare with a bolt-tipped tail'],
    bishop: ['Staticseer', 'a slender storm-caster in an indigo mitre with a crackling staff'],
    rook: ['Cloudkeep', 'a blocky cloud-golem whose battlements spark'],
    queen: ['Nimbelle', 'a tall storm empress with sparks along her hem'],
    king: ['Stormcrown', 'a round violet monarch in an indigo cape and a gold crown'],
  },
  stone: {
    pawn: ['Pebblet', 'a round pebble critter with a rock chip on its head'],
    knight: ['Craglope', 'a leaping crag-goat with a rocky club tail'],
    bishop: ['Runeseer', 'a slender rune-carver in a slate mitre with a mossy stone staff'],
    rook: ['Cairnkeep', 'a blocky cairn-golem with stacked stones on its battlements'],
    queen: ['Marbelle', 'a tall marble queen with a veined gown'],
    king: ['Slatecrown', 'a round slate monarch in a stone-grey cape and a gold crown'],
  },
  frost: {
    pawn: ['Frostlet', 'a round snow sprite with an ice-crystal crest'],
    knight: ['Rimelope', 'a leaping rime-fox with an icicle tail'],
    bishop: ['Glintseer', 'a slender ice-mage in a blue mitre with a crystal staff'],
    rook: ['Floekeep', 'a blocky glacier-golem with icicles on its battlements'],
    queen: ['Aurelle', 'a tall aurora queen with snowflakes at her hem'],
    king: ['Hailcrown', 'a round ice-blue monarch in a blue cape and a gold crown'],
  },
};

const TYPE_ORDER: readonly PieceType[] = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

/** All 36 creatures, element-major in ELEMENTS order, then pawn..king. */
export const creatures: readonly CreatureEntry[] = (
  Object.keys(ROSTER) as (keyof Roster)[]
).flatMap((element) =>
  TYPE_ORDER.map((type) => {
    const [name, look] = ROSTER[element][type];
    return { id: `${element}-${type}`, name, element, type, look };
  }),
);

const TYPE_LABEL: Record<PieceType, string> = {
  pawn: 'Pawn',
  knight: 'Knight',
  bishop: 'Bishop',
  rook: 'Rook',
  queen: 'Queen',
  king: 'King',
};

/** Display name for a piece's creature; neutral (sandbox) pieces are plain training dummies. */
export function creatureName(type: PieceType, element: ElementId): string {
  if (element === 'neutral') return `Training ${TYPE_LABEL[type]}`;
  return ROSTER[element][type][0];
}
