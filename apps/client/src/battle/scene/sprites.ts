/**
 * Procedural army sprites (R-ART-001, R-ART-002, R-ART-003). Every unit is painted at runtime on
 * a 32x32 material grid in handheld-era proportions (a large head, big eyes with a highlight, a
 * short body, a 1 px outline and two-tone shading), then coloured with `armyPalette(side, element)`:
 *
 * - Silhouette follows piece type in every style: pawn short with a spear, knight a rider on a
 *   horse, bishop tall and slender with a staff and tall headgear, rook broad behind a tower
 *   shield under a crenellated helm, queen tall in a bell gown with a crown, king broad in a long
 *   cloak with a tall crown. Type is readable from the outline alone.
 * - Style (army.ts: Roman, medieval, Arab, samurai) changes headgear, weapons, shields and dress;
 *   the body layout underneath is shared, so a style never changes a type's silhouette.
 * - Owner is the armour colour (white steel or black iron), plus front sprites for the opponent
 *   and back sprites for the viewer's own army. Front sprites show a face; back sprites never do.
 * - Element is the accent colour (plumes, cloaks, sashes, trim) plus the element's emblem on the
 *   shield, chest or cape: a shape cue that survives colour-vision deficiencies (R-ART-002).
 * - Each unit has a front sprite, a back sprite, a 2-frame idle (a 1 px bob, plumes flutter) and
 *   a faint frame (a slump with closed eyes).
 *
 * All shapes are original (R-ART-003). The badge corner (columns 0..9 of rows 3..12, where the
 * glyph badge sits once the sprite is placed on its square) stays clear of every unit.
 */
import type { ElementId, PieceType, Side } from '@chain-theorem/rules';
import type { ArmyStyle } from './army.ts';
import { blit, PixelGrid, writeRgba, type Ctx2D } from './pixel.ts';
import { A, armyPalette } from './palette.ts';

export const SPRITE = 32;
export type UnitFacing = 'front' | 'back';
export type UnitFrame = 'idle0' | 'idle1' | 'faint';
export const UNIT_FRAMES: readonly UnitFrame[] = ['idle0', 'idle1', 'faint'];
export const PIECE_TYPES: readonly PieceType[] = [
  'pawn',
  'knight',
  'bishop',
  'rook',
  'queen',
  'king',
];
export const ELEMENTS: readonly ElementId[] = ['ember', 'tide', 'grove', 'storm', 'stone', 'frost'];
/** The glyph badge corner: columns 0..BADGE_CLEAR.x of rows BADGE_CLEAR.y0..y1 stay empty. */
export const BADGE_CLEAR = { x: 9, y0: 3, y1: 12 } as const;
/** Lowest sprite row a figure may use (the base ring and pips sit under it). */
const FLOOR = 30;

interface Pose {
  style: ArmyStyle;
  el: ElementId;
  front: boolean;
  /** Idle variant (plumes and cloaks flutter). */
  v: 0 | 1;
  faint: boolean;
}

type Stamp = readonly string[];
const KEY: Record<string, number> = {
  o: A.OUT,
  s: A.ARM_SH,
  a: A.ARM,
  l: A.ARM_LT,
  d: A.ACC_SH,
  c: A.ACC,
  b: A.ACC_LT,
  e: A.EYE,
  w: A.WHITE,
  k: A.SKIN,
  j: A.SKIN_SH,
  g: A.GOLD,
  h: A.GOLD_SH,
  t: A.CLOTH,
  r: A.HAIR,
};

/** Stamp with its top-left at (x, y). */
function put(g: PixelGrid, s: Stamp, x: number, y: number, flip = false): void {
  g.stamp(x, y, s, KEY, flip);
}

/** Stamp centred on column `cx` (16 is the figure's axis) with its top row at `y`. */
function putC(g: PixelGrid, s: Stamp, cx: number, y: number, flip = false): void {
  const w = s[0]?.length ?? 0;
  put(g, s, Math.floor(cx - w / 2 + 0.5), y, flip);
}

/** Paint a stamp only onto pixels already holding one of `onto` (emblems on shields and cloth). */
function putOnto(g: PixelGrid, s: Stamp, x0: number, y0: number, onto: readonly number[]): void {
  s.forEach((row, j) => {
    [...row].forEach((ch, i) => {
      const m = KEY[ch];
      if (m !== undefined) g.paintOnto(x0 + i, y0 + j, m, onto);
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Element emblems: the same shapes as the element icons (flame, wave, leaf, bolt, rock, snow
// star, hollow circle), in the accent colour, painted onto armour and cloth surfaces.
// ---------------------------------------------------------------------------------------------

const EMBLEM: Record<ElementId, Stamp> = {
  ember: ['...c...', '..cc...', '..ccc..', '.cbcc..', '.cbbcc.', 'ccbbbc.', '.ccccc.'],
  tide: ['.......', '.cc....', 'c.cc..c', '...cccc', '.......', 'ccccccc', '.......'],
  grove: ['....cc.', '..cccc.', '.ccbcc.', 'cccbc..', '.cbc...', 'cc.....', '.......'],
  storm: ['...cc..', '..cc...', '.ccccc.', '...cc..', '..cc...', '.c.....', '.......'],
  stone: ['.......', '..ccc..', '.cbbcc.', 'ccbccc.', 'cccccc.', '.ccccc.', '.......'],
  frost: ['c..c..c', '.c.c.c.', '..ccc..', 'ccccccc', '..ccc..', '.c.c.c.', 'c..c..c'],
  neutral: ['.......', '.ccccc.', 'c.....c', 'c.....c', 'c.....c', '.ccccc.', '.......'],
};

const EMBLEM_SMALL: Record<ElementId, Stamp> = {
  ember: ['..c..', '.cc..', '.cbc.', 'cbbc.', '.ccc.'],
  tide: ['.c...', 'c.c.c', '...c.', '.....', 'ccccc'],
  grove: ['...cc', '.cbc.', 'cbc..', 'cc...', '.....'],
  storm: ['..cc.', '.cc..', 'cccc.', '..c..', '.c...'],
  stone: ['.ccc.', 'cbbcc', 'ccccc', '.ccc.', '.....'],
  frost: ['c.c.c', '.ccc.', 'ccccc', '.ccc.', 'c.c.c'],
  neutral: ['.ccc.', 'c...c', 'c...c', 'c...c', '.ccc.'],
};

const SURFACE = [A.ARM, A.ARM_SH, A.ARM_LT, A.WHITE, A.CLOTH];

/** The element's emblem centred on (cx, cy), painted only onto armour or cloth. */
function emblem(g: PixelGrid, el: ElementId, cx: number, cy: number, small = false): void {
  const s = small ? EMBLEM_SMALL[el] : EMBLEM[el];
  const w = s[0]?.length ?? 0;
  putOnto(g, s, Math.floor(cx - w / 2 + 0.5), Math.floor(cy - s.length / 2 + 0.5), SURFACE);
}

// ---------------------------------------------------------------------------------------------
// Faces.
// ---------------------------------------------------------------------------------------------

/** One 2x3 eye with its top-left at (x, y): open with a highlight, or closed when fainted. */
function eye(g: PixelGrid, x: number, y: number, faint: boolean): void {
  if (faint) {
    g.set(x, y + 1, A.EYE);
    g.set(x + 1, y + 1, A.EYE);
    return;
  }
  g.rect(x, y, 2, 3, A.EYE);
  g.set(x, y, A.WHITE);
}

/** Eyes at (lx, y) and (rx, y) and a small mouth two rows under them. */
function face(g: PixelGrid, p: Pose, lx: number, rx: number, y: number): void {
  eye(g, lx, y, p.faint);
  eye(g, rx, y, p.faint);
  const mid = Math.floor((lx + rx + 2) / 2);
  if (p.faint) g.rect(mid - 1, y + 4, 2, 1, A.SKIN_SH);
  else g.set(mid - 1, y + 4, A.SKIN_SH);
}

/** A round head (skin) with hair on top; `top` is the head's top row. */
function head(g: PixelGrid, cx: number, top: number, r: number, hairRows: number): void {
  g.ellipse(cx, top + r, r + 0.3, r, A.SKIN);
  if (hairRows > 0) {
    const src = g.px.slice();
    for (let y = top; y < top + hairRows; y++)
      for (let x = 0; x < g.w; x++) if (src[y * g.w + x] === A.SKIN) g.set(x, y, A.HAIR);
  }
}

// ---------------------------------------------------------------------------------------------
// Headgear per style and role. Stamps are centred on the figure's axis with their top at the
// given row; front-only details (visors, cheek guards, masks) are added separately.
// ---------------------------------------------------------------------------------------------

type Role = 'soldier' | 'knight' | 'cleric' | 'heavy' | 'queen' | 'king';

/** A crenellated square helm: the rook's silhouette cue in every style. */
const MERLON_HELM: Stamp = [
  'aaa.aaa.aaa',
  'aaa.aaa.aaa',
  'aaaaaaaaaaa',
  'aaaaaaaaaaa',
  'lllllllllll',
];

const CROWN_QUEEN: Stamp = ['g...g...g', 'g...g...g', 'gg.ggg.gg', 'ggcgggcgg', 'ggggggggg'];
const CROWN_KING: Stamp = [
  '.....g.....',
  'g...ggg...g',
  'g.g.ggg.g.g',
  'ggggggggggg',
  'ggcgggggcgg',
  'ggggggggggg',
];

interface Gear {
  /** Rows above the head's top row that the stamp starts at. */
  up: number;
  stamp: Stamp;
  /** Front-only pixels (visor slits, cheek guards, masks), same anchor. */
  front?: Stamp;
  /** Idle variant of `stamp` (plume flutter). */
  alt?: Stamp;
}

const NONE = '';
/** `n` empty rows, so a front-only detail lines up with its helmet. */
const skip = (n: number, ...rows: string[]): Stamp => [...Array<string>(n).fill(NONE), ...rows];

/** Stamps are 11 columns wide (sprite columns 11..21, centred on the figure's axis). */
const GEAR: Record<ArmyStyle, Record<Role, Gear>> = {
  roman: {
    // Galea: a rounded dome with a brow ridge and hanging cheek guards.
    soldier: {
      up: 1,
      stamp: ['....aaa....', '..aaaaaaa..', '.aaaaaaaaa.', 'aaaaaaaaaaa', 'lllllllllll'],
      front: skip(5, 'a.........a', 'a.........a', 's.........s'),
    },
    // The eques wears a crest plume over the galea.
    knight: {
      up: 3,
      stamp: [
        '.....c.....',
        '....ccc....',
        '....ccc....',
        '..aaaaaaa..',
        '.aaaaaaaaa.',
        'aaaaaaaaaaa',
        'lllllllllll',
      ],
      alt: [
        '......c....',
        '.....ccc...',
        '....cccc...',
        '..aaaaaaa..',
        '.aaaaaaaaa.',
        'aaaaaaaaaaa',
        'lllllllllll',
      ],
      front: skip(7, 'a.........a', 'a.........a', 's.........s'),
    },
    // The augur's pointed leather cap (an apex).
    cleric: {
      up: 2,
      stamp: [
        '.....t.....',
        '....ttt....',
        '...ttttt...',
        '..ttttttt..',
        '.ttttttttt.',
        'ttttttttttt',
      ],
    },
    heavy: {
      up: 2,
      stamp: MERLON_HELM,
      front: skip(5, 'a.........a', 'a.........a', 's.........s'),
    },
    // A diadem over long hair.
    queen: { up: 0, stamp: ['....ggg....', '..gggcggg..', '.gg.....gg.'] },
    // The imperator's gold laurel wreath.
    king: {
      up: 0,
      stamp: ['...........', '.g.......g.', 'gg.......gg', 'ggg.....ggg', '.ggg...ggg.'],
    },
  },
  medieval: {
    // A kettle hat with a wide brim over a mail coif.
    soldier: {
      up: 1,
      stamp: ['...aaaaa...', '..aaaaaaa..', '.aaaaaaaaa.', 'aaaaaaaaaaa', 'lllllllllll'],
      front: skip(5, 's.........s', 's.........s', 'ss.......ss'),
    },
    // A great helm with a plume; the eye slit and the nasal bar show on the front only.
    knight: {
      up: 3,
      stamp: [
        '.....c.....',
        '....ccc....',
        '....ccc....',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
      ],
      alt: [
        '......c....',
        '.....ccc...',
        '....cccc...',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
        '.aaaaaaaaa.',
      ],
      front: skip(6, '.aeeeeeeea.', '.aaaaeaaaa.', '.aaaaeaaaa.', '.aaaaeaaaa.'),
    },
    // A tall mitre with a gold band.
    cleric: {
      up: 2,
      stamp: [
        '.....a.....',
        '....aca....',
        '...aacaa...',
        '..aaacaaa..',
        '.aaaacaaaa.',
        'ggggggggggg',
      ],
    },
    heavy: {
      up: 2,
      stamp: MERLON_HELM,
      front: skip(5, 'a.........a', 'a.........a', 'a.........a'),
    },
    queen: { up: 1, stamp: CROWN_QUEEN },
    king: { up: 2, stamp: CROWN_KING },
  },
  arab: {
    // A conical helmet with a spike, a turban band and a mail aventail.
    soldier: {
      up: 2,
      stamp: [
        '.....a.....',
        '....aaa....',
        '...aaaaa...',
        '..aaaaaaa..',
        '.aaaaaaaaa.',
        'ccccccccccc',
      ],
      front: skip(6, 's.........s', 's.........s', 'ss.......ss'),
    },
    // The faris adds a plume to the spike and a thicker wrap.
    knight: {
      up: 3,
      stamp: [
        '.....aw....',
        '.....aww...',
        '....aaa....',
        '...aaaaa...',
        '..aaaaaaa..',
        '.aaaaaaaaa.',
        'ccccccccccc',
        'ccccccccccc',
      ],
      alt: [
        '....wa.....',
        '...wwa.....',
        '....aaa....',
        '...aaaaa...',
        '..aaaaaaa..',
        '.aaaaaaaaa.',
        'ccccccccccc',
        'ccccccccccc',
      ],
      front: skip(8, 's.........s', 's.........s', 'ss.......ss'),
    },
    // The hakim's tall turban with a gold band.
    cleric: {
      up: 2,
      stamp: [
        '....ccc....',
        '..ccccccc..',
        '.cccccdccc.',
        'cccccdccccc',
        'ccccgggcccc',
        '.ccccccccc.',
      ],
    },
    heavy: {
      up: 2,
      stamp: ['aaa.aaa.aaa', 'aaa.aaa.aaa', '.aaaaaaaaa.', 'aaaaaaaaaaa', 'lllllllllll'],
      front: skip(5, 's.........s', 's.........s', 'ss.......ss'),
    },
    // A jewelled diadem with a veil falling at the sides.
    queen: { up: 1, stamp: ['...ggggg...', '.gggcgcggg.', 'cg.......gc', 'c.........c'] },
    // A great turban with a brooch and a plume.
    king: {
      up: 2,
      stamp: [
        '......w....',
        '...ccccw...',
        '.ccccccccc.',
        'cccccdccccc',
        'ccccgggcccc',
        '.ccccccccc.',
      ],
      alt: [
        '.......w...',
        '...cccccw..',
        '.ccccccccc.',
        'cccccdccccc',
        'ccccgggcccc',
        '.ccccccccc.',
      ],
    },
  },
  samurai: {
    // A conical jingasa hat.
    soldier: {
      up: 2,
      stamp: [
        '....aaa....',
        '...aaaaa...',
        '..aaaaaaa..',
        '.aaaaaaaaa.',
        'aaaaaaaaaaa',
        'aaaaaaaaaaa',
      ],
    },
    // A kabuto with gold horns and a flaring neck guard; a face mask on the front.
    knight: {
      up: 3,
      stamp: [
        'g.........g',
        '.g.......g.',
        '..g.aaa.g..',
        '...aaaaa...',
        '..aaaaaaa..',
        '.aaaaaaaaa.',
        'sssssssssss',
      ],
      front: skip(9, '.sssssssss.', '..sssssss..'),
    },
    // The warrior monk's tall white cowl.
    cleric: {
      up: 2,
      stamp: [
        '.....w.....',
        '....www....',
        '...wwwww...',
        '..wwwwwww..',
        '.ww.....ww.',
        '.ww.....ww.',
        '.ww.....ww.',
        '.ww.....ww.',
        '.www...www.',
      ],
    },
    heavy: {
      up: 2,
      stamp: ['aaa.aaa.aaa', 'aaa.aaa.aaa', 'aaaaaaaaaaa', 'aaaaaaaaaaa', 'sssssssssss'],
      front: skip(8, '.sssssssss.'),
    },
    // Long black hair with a gold hairpin and a flower.
    queen: {
      up: 0,
      stamp: ['.......gc..', '.rrrrrrrgc.', 'rrrrrrrrrg.', 'rrrrrrrrrr.'],
    },
    // A kabuto with a great gold crescent crest.
    king: {
      up: 2,
      stamp: [
        '..g.....g..',
        '..gg.g.gg..',
        '...ggggg...',
        '..aaaaaaa..',
        '.aaaaaaaaa.',
        'sssssssssss',
      ],
    },
  },
};

function headgear(g: PixelGrid, p: Pose, role: Role, cx: number, headTop: number): void {
  const gear = GEAR[p.style][role];
  const stamp = p.v === 1 && gear.alt ? gear.alt : gear.stamp;
  const top = headTop - gear.up;
  putC(g, stamp, cx, top);
  if (p.front && gear.front) putC(g, gear.front, cx, top);
}

// ---------------------------------------------------------------------------------------------
// Weapons (held on the figure's right, the viewer's right) and shields (the viewer's left on
// front sprites, slung on the back on back sprites).
// ---------------------------------------------------------------------------------------------

type Weapon = 'spear' | 'lance' | 'staff' | 'mace' | 'sceptre' | 'sword';

const SPEAR_HEAD: Record<ArmyStyle, Stamp> = {
  roman: ['.l.', '.a.', '.a.', '.a.', 'aaa'],
  medieval: ['.l.', 'lal', 'aaa', 'aaa', '.a.'],
  arab: ['.l.', '.a.', 'aaa', '.a.', 'ccc'],
  samurai: ['.l.', '.l.', '.a.', '.a.', 'c.c'],
};
const STAFF_TOP: Record<ArmyStyle, Stamp> = {
  roman: ['.ggg.', 'g...g', 'g..g.', '..gg.', '..t..'],
  medieval: ['.ggg.', 'g...g', 'g...g', '.g...', '..t..'],
  arab: ['..g..', '.ggg.', '.ggg.', '..g..', '..t..'],
  samurai: ['.ggg.', 'g.g.g', 'gg.gg', '.ggg.', '..t..'],
};
const MACE_HEAD: Record<ArmyStyle, Stamp> = {
  roman: ['.aaa.', 'aaaaa', 'aaaaa', '.aaa.'],
  medieval: ['aaa..', 'aaaa.', 'aaaa.', 'aaa..'],
  arab: ['a.a.a', 'aaaaa', '.aaa.', '.aaa.'],
  samurai: ['.rrr.', 'rsrsr', 'rrrrr', 'rsrsr', 'rrrrr'],
};
const SWORD: Record<ArmyStyle, Stamp> = {
  roman: ['.l.', 'la.', 'la.', 'la.', 'la.', 'la.', 'la.', 'ggg', '.t.', '.t.', '.g.'],
  medieval: [
    '.l.',
    'la.',
    'la.',
    'la.',
    'la.',
    'la.',
    'la.',
    'la.',
    'la.',
    'ggg',
    '.t.',
    '.t.',
    '.g.',
  ],
  arab: ['l..', 'la.', 'la.', '.la', '.la', '.la', '.la', '.la', '.ag', '.gg', '..t', '..t'],
  samurai: [
    '.l.',
    '.la',
    '.la',
    '.la',
    '.la',
    '.la',
    '.la',
    '.la',
    '.la',
    '.gg',
    '..t',
    '..t',
    '..t',
  ],
};
const SHIELD: Record<ArmyStyle, Stamp> = {
  // A tall curved scutum with a boss.
  roman: [
    'ccccccccc',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'ccccccccc',
  ],
  // A heater shield.
  medieval: [
    'ccccccccc',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    '.caaaaac.',
    '.caaaaac.',
    '..caaac..',
    '..caaac..',
    '...ccc...',
  ],
  // A round shield.
  arab: [
    '...ccc...',
    '.ccaaacc.',
    '.caaaaac.',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    '.caaaaac.',
    '.ccaaacc.',
    '...ccc...',
  ],
  // A tall standing shield (tate) with lacquered bands.
  samurai: [
    'ccccccccc',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'caaaaaaac',
    'ccccccccc',
    'ccccccccc',
  ],
};
/** The rook's tower shield: the style's shield widened by two columns on each side. */
function widen(rows: Stamp): Stamp {
  return rows.map((row) => `${row[0]}${row[0]}${row.slice(1, -1)}${row.slice(-1)}${row.slice(-1)}`);
}
const TOWER: Record<ArmyStyle, Stamp> = {
  roman: widen(SHIELD.roman),
  medieval: widen(SHIELD.medieval),
  arab: widen(SHIELD.arab),
  samurai: widen(SHIELD.samurai),
};

/** A weapon rising from the hand at (hx, hy) to the top row `top` (the shaft is cloth). */
function weapon(g: PixelGrid, p: Pose, kind: Weapon, hx: number, hy: number, top: number): void {
  const st = p.style;
  switch (kind) {
    case 'spear':
    case 'lance': {
      g.rect(hx, top + 5, kind === 'lance' ? 2 : 1, FLOOR - top - 5, A.CLOTH);
      putC(g, SPEAR_HEAD[st], hx + 0.5, top);
      if (kind === 'lance') g.rect(hx - 1, hy - 1, 4, 1, A.ARM);
      break;
    }
    case 'staff':
      g.rect(hx, top + 4, 1, FLOOR - top - 4, A.CLOTH);
      putC(g, STAFF_TOP[st], hx + 0.5, top);
      break;
    case 'mace': {
      const headH = MACE_HEAD[st].length;
      g.rect(hx, top + headH, 1, hy + 4 - top - headH, A.CLOTH);
      putC(g, MACE_HEAD[st], hx + 0.5, top);
      break;
    }
    case 'sceptre':
      g.rect(hx, top + 3, 1, hy + 2 - top - 3, A.GOLD);
      put(g, ['.c.', 'ccc', '.c.'], hx - 1, top);
      break;
    case 'sword':
      putC(g, SWORD[st], hx + 0.5, hy - SWORD[st].length + 3);
      break;
  }
  g.rect(hx - 1, hy, 2, 2, A.SKIN);
}

/** A shield with the emblem, its top-left at (x, y): the style's shield, a shorter one or a tower. */
function shield(
  g: PixelGrid,
  p: Pose,
  x: number,
  y: number,
  size: 'normal' | 'short' | 'tower' = 'normal',
): void {
  let s = size === 'tower' ? TOWER[p.style] : SHIELD[p.style];
  // The short shield keeps the top four and bottom five rows of the style's shield.
  if (size === 'short') s = [...s.slice(0, 4), ...s.slice(s.length - 5)];
  put(g, s, x, y);
  const w = s[0]?.length ?? 0;
  emblem(g, p.el, x + w / 2, y + Math.floor(s.length / 2) - (p.style === 'medieval' ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// Bodies. Each paints one piece type at the shared 32x32 layout; `p.front` chooses the face
// side. Figures stand on row FLOOR; heads and headgear never rise above row 3.
// ---------------------------------------------------------------------------------------------

/** Two legs and boots between rows `y` and FLOOR, `gap` columns apart around the axis. */
function legs(g: PixelGrid, y: number, legM: number, w = 3, gap = 2): void {
  const lx = 16 - gap / 2 - w;
  const rx = 16 + gap / 2;
  g.rect(lx, y, w, FLOOR - 2 - y, legM);
  g.rect(rx, y, w, FLOOR - 2 - y, legM);
  g.rect(lx - 1, FLOOR - 2, w + 1, 3, A.HAIR);
  g.rect(rx, FLOOR - 2, w + 1, 3, A.HAIR);
}

function pawn(g: PixelGrid, p: Pose): void {
  const top = 10;
  // A short figure: a slim torso with element sleeves, a belt, trousers and boots.
  g.rect(11, 19, 10, 2, A.ARM);
  g.rect(12, 19, 8, 6, A.ARM);
  g.rect(10, 20, 2, 5, A.ACC);
  g.rect(20, 20, 2, 5, A.ACC);
  g.rect(10, 25, 2, 1, A.SKIN);
  g.rect(12, 24, 8, 1, A.HAIR);
  legs(g, 25, A.CLOTH, 3, 2);
  if (p.style === 'roman') {
    // Lorica bands and a pteruges skirt over bare legs.
    for (const y of [20, 22]) g.rect(12, y, 8, 1, A.ARM_SH);
    g.rect(12, 25, 8, 2, A.CLOTH);
    for (const x of [13, 15, 17]) g.set(x, 26, A.HAIR);
    g.rect(12, 27, 3, 1, A.SKIN);
    g.rect(17, 27, 3, 1, A.SKIN);
  } else if (p.style === 'samurai') {
    // Laced lamellar plates.
    for (const y of [21, 23]) g.rect(12, y, 8, 1, A.ACC_SH);
  } else if (p.style === 'arab') {
    // A long tunic with a sash.
    g.rect(12, 25, 8, 2, A.ARM);
    g.rect(12, 23, 8, 1, A.ACC);
  } else {
    // A surcoat in the element colour over mail.
    g.rect(14, 19, 4, 6, A.ACC);
  }
  head(g, 16, top, 4.2, 0);
  if (p.front) {
    face(g, p, 12, 18, 13);
    weapon(g, p, 'spear', 24, 23, 5);
    headgear(g, p, 'soldier', 16, top);
    shield(g, p, 4, 17, 'short');
  } else {
    weapon(g, p, 'spear', 24, 23, 5);
    headgear(g, p, 'soldier', 16, top);
    shield(g, p, 9, 18, 'short');
  }
}

function knight(g: PixelGrid, p: Pose): void {
  // The horse: a chest seen from the front, four legs, a neck and head on the viewer's left.
  g.ellipse(16.5, 24, 9, 4.3, A.ARM);
  for (const x of [10, 14, 18, 22]) {
    g.rect(x, 27, 2, 3, A.ARM);
    g.rect(x, FLOOR, 2, 1, A.HAIR);
  }
  g.poly(
    [
      [10, 22],
      [15, 22],
      [16, 14],
      [12, 12],
    ],
    A.ARM,
  );
  g.ellipse(13.5, 16, 3.2, 3.5, A.ARM);
  g.rect(11, 11, 1, 2, A.ARM);
  g.rect(14, 11, 1, 2, A.ARM);
  // Mane and tail in the element colour.
  g.rect(15, 12, 2, 9, A.ACC);
  g.set(14, 12, A.ACC);
  g.rect(24, 20, 2, 7, A.ACC);
  g.set(26, 22 + p.v, A.ACC);
  if (p.front) {
    g.rect(11, 18, 3, 2, A.ARM_SH);
    g.set(11, 15, A.EYE);
    g.set(14, 15, A.EYE);
  }
  // Harness and the rider's stirrup boot.
  g.rect(9, 21, 14, 1, A.CLOTH);
  g.rect(23, 24, 2, 4, A.HAIR);
  // The rider: torso, arms, head and headgear.
  const top = 7;
  g.rect(16, 15, 8, 8, A.ARM);
  g.rect(15, 15, 10, 2, A.ARM);
  g.rect(15, 17, 1, 5, A.ACC);
  g.rect(24, 17, 1, 5, A.ACC);
  if (p.style === 'medieval' || p.style === 'arab') g.rect(18, 17, 4, 6, A.ACC);
  if (p.style === 'samurai') for (const y of [18, 20]) g.rect(16, y, 8, 1, A.ACC_SH);
  head(g, 20, top, 4.2, 1);
  if (p.front) face(g, p, 17, 22, 10);
  headgear(g, p, 'knight', 20, top);
  if (p.style === 'samurai') {
    // A sashimono back banner in the owner's colour, carrying the emblem.
    g.rect(28, 4, 1, 17, A.CLOTH);
    g.rect(23, 4, 5, 12, A.ARM);
    g.rect(23, 4, 5, 1, A.ACC);
    g.rect(23, 15, 5, 1, A.ACC);
    g.set(22 + p.v, 5, A.ACC);
    emblem(g, p.el, 25, 10, true);
    weapon(g, p, 'spear', 29, 21, 5);
  } else {
    weapon(
      g,
      p,
      p.style === 'medieval' ? 'lance' : p.style === 'arab' ? 'sword' : 'spear',
      27,
      21,
      4,
    );
    if (p.front) shield(g, p, 21, 15);
    else shield(g, p, 16, 15);
  }
}

function bishop(g: PixelGrid, p: Pose): void {
  const top = 6;
  // A long robe, narrow at the shoulders and flaring to the hem, with a stole down the middle.
  g.poly(
    [
      [13, 16],
      [19, 16],
      [21, FLOOR + 1],
      [11, FLOOR + 1],
    ],
    A.ARM,
  );
  g.rect(11, 17, 2, 7, A.ARM);
  g.rect(19, 17, 2, 7, A.ARM);
  g.rect(11, 24, 2, 1, A.SKIN);
  g.rect(15, 16, 2, 2, A.ACC);
  g.rect(15, 25, 2, 4, A.ACC);
  if (p.style === 'samurai') {
    g.rect(13, 16, 6, 2, A.WHITE);
    g.rect(12, 24, 8, 1, A.ACC);
  }
  if (p.style === 'arab') g.rect(12, 24, 8, 1, A.ACC);
  head(g, 16, top, 4.8, p.style === 'arab' ? 0 : 1);
  if (p.style === 'arab' || p.style === 'medieval') {
    // A beard.
    g.rect(13, 14, 6, 2, A.HAIR);
    g.rect(14, 16, 4, 2, A.HAIR);
  }
  if (p.front) face(g, p, 12, 18, 10);
  headgear(g, p, 'cleric', 16, top);
  weapon(g, p, 'staff', 24, 22, 4);
  emblem(g, p.el, 16, 21);
}

function rook(g: PixelGrid, p: Pose): void {
  const top = 9;
  // A squat, broad body with pauldrons, greaves and wide boots.
  g.rect(8, 17, 16, 9, A.ARM);
  g.rect(6, 17, 3, 4, A.ARM);
  g.rect(23, 17, 3, 4, A.ARM);
  g.rect(6, 21, 2, 4, A.ACC);
  g.rect(24, 21, 2, 4, A.ACC);
  g.rect(6, 25, 2, 1, A.SKIN);
  g.rect(8, 25, 16, 1, A.HAIR);
  legs(g, 26, A.ARM, 5, 3);
  head(g, 16, top, 4.8, 0);
  if (p.front) face(g, p, 12, 18, 13);
  headgear(g, p, 'heavy', 16, top);
  weapon(g, p, 'mace', 27, 23, 11);
  if (p.front) shield(g, p, 4, 15, 'tower');
  else shield(g, p, 9, 16, 'tower');
}

function queen(g: PixelGrid, p: Pose): void {
  const top = 5;
  // Long, full hair falling past the shoulders at both sides.
  g.rect(9, 14, 3, 9, A.HAIR);
  g.rect(20, 14, 3, 9, A.HAIR);
  // A slim bodice with puffed sleeves, a sash, and a wide bell gown from the waist down.
  g.rect(13, 15, 6, 6, A.ARM);
  g.rect(11, 15, 3, 3, A.ARM);
  g.rect(18, 15, 3, 3, A.ARM);
  g.rect(11, 18, 2, 4, A.ARM);
  g.rect(19, 18, 2, 4, A.ARM);
  g.rect(11, 22, 2, 1, A.SKIN);
  g.poly(
    [
      [13, 19],
      [19, 19],
      [27, FLOOR + 1],
      [5, FLOOR + 1],
    ],
    A.ARM,
  );
  g.rect(13, 18, 6, 2, A.ACC);
  g.rect(6, FLOOR - 1, 20, 2, A.ACC);
  if (p.style === 'samurai') {
    // A kimono with wide hanging sleeves and a big obi bow at the back.
    g.rect(10, 16, 3, 7, A.ARM);
    g.rect(19, 16, 3, 7, A.ARM);
    g.rect(13, 19, 6, 4, A.ACC);
    if (!p.front) g.rect(11, 18, 10, 2, A.ACC_SH);
  }
  if (p.style === 'arab') {
    // The veil falls over the hair.
    g.rect(9, 14, 3, 6, A.ACC);
    g.rect(20, 14, 3, 6, A.ACC);
  }
  head(g, 16, top, 4.8, 3);
  if (p.front) face(g, p, 12, 18, 9);
  headgear(g, p, 'queen', 16, top);
  weapon(g, p, 'sceptre', 24, 20, 8);
  emblem(g, p.el, 16, 26);
}

function king(g: PixelGrid, p: Pose): void {
  const top = 6;
  // A tall figure: broad pauldrons over a cloak of middling width that carries the emblem on
  // the back, a tunic with a gold belt, and a tall crown.
  g.poly(
    [
      [8, 18],
      [24, 18],
      [24 + p.v, FLOOR + 1],
      [8 - p.v, FLOOR + 1],
    ],
    A.ACC,
  );
  if (p.style === 'medieval') {
    // Ermine trim along the cloak's edges.
    for (let y = 19; y <= 29; y++) {
      g.set(8, y, y % 4 === 0 ? A.HAIR : A.WHITE);
      g.set(23, y, y % 4 === 2 ? A.HAIR : A.WHITE);
    }
  }
  g.rect(10, 16, 12, 10, A.ARM);
  g.rect(8, 16, 16, 3, A.ARM);
  g.rect(10, 25, 12, 1, A.GOLD);
  g.rect(9, 19, 2, 6, A.ARM);
  g.rect(21, 19, 2, 6, A.ARM);
  g.rect(9, 25, 2, 1, A.SKIN);
  legs(g, 26, A.ARM, 3, 2);
  if (p.style === 'samurai') {
    // A sleeveless war coat over the armour, open at the chest.
    g.rect(10, 16, 2, 9, A.ACC);
    g.rect(20, 16, 2, 9, A.ACC);
    g.rect(10, 16, 12, 1, A.ACC);
  } else if (p.style === 'roman') {
    // A muscled cuirass.
    g.rect(10, 17, 12, 1, A.ARM_SH);
  } else if (p.style === 'arab') {
    // A caftan with gold trim.
    g.rect(11, 16, 1, 9, A.GOLD);
    g.rect(20, 16, 1, 9, A.GOLD);
  }
  head(g, 16, top, 5, 1);
  if (p.style !== 'roman') {
    // A beard.
    g.rect(13, 14, 6, 2, A.HAIR);
    g.rect(14, 16, 4, 1, A.HAIR);
  }
  if (p.front) face(g, p, 12, 18, 10);
  headgear(g, p, 'king', 16, top);
  weapon(g, p, 'sword', 25, 23, 6);
  emblem(g, p.el, 16, p.front ? 21 : 22);
}

const BODIES: Record<PieceType, (g: PixelGrid, p: Pose) => void> = {
  pawn,
  knight,
  bishop,
  rook,
  queen,
  king,
};

/** Lowest row that bobs in the idle; rows below it (feet, the horse) stay planted. */
const BOB_BOTTOM: Record<PieceType, number> = {
  pawn: 27,
  knight: 22,
  bishop: 27,
  rook: 27,
  queen: 27,
  king: 27,
};

function dizzy(g: PixelGrid, top: number): void {
  // Two small twinkles above the slumped head.
  const y = Math.max(5, top - 2);
  for (const x of [12, 20]) {
    g.set(x, y, A.GOLD);
    g.set(x - 1, y, A.WHITE);
    g.set(x + 1, y, A.WHITE);
    g.set(x, y - 1, A.WHITE);
    g.set(x, y + 1, A.WHITE);
  }
}

function topRow(g: PixelGrid): number {
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.get(x, y) !== A.EMPTY) return y;
  return 0;
}

/** Shading pairs for unit materials: armour, accents and gold get rim light; skin a jaw shade. */
const SHADE_PAIRS: [number, number, number][] = [
  [A.ARM, A.ARM_LT, A.ARM_SH],
  [A.ACC, A.ACC_LT, A.ACC_SH],
  [A.GOLD, A.GOLD, A.GOLD_SH],
  [A.SKIN, A.SKIN, A.SKIN_SH],
];

const grids = new Map<string, PixelGrid>();

/**
 * The unit's material grid (32x32, outline and shading applied). Pure and cached: usable in Node
 * (tests, exporters) as well as in the browser. The owner only changes the palette, so the grid
 * is shared by both sides.
 */
export function unitGrid(
  style: ArmyStyle,
  type: PieceType,
  element: ElementId,
  facing: UnitFacing,
  frame: UnitFrame,
): PixelGrid {
  const key = `${style}:${type}:${element}:${facing}:${frame}`;
  const hit = grids.get(key);
  if (hit) return hit;
  const g = new PixelGrid(SPRITE, SPRITE);
  const pose: Pose = {
    style,
    el: element,
    front: facing === 'front',
    v: frame === 'idle1' ? 1 : 0,
    faint: frame === 'faint',
  };
  BODIES[type](g, pose);
  if (frame === 'idle1') g.shiftRows(0, BOB_BOTTOM[type], 1);
  if (frame === 'faint') {
    g.shiftRows(0, BOB_BOTTOM[type], 2);
    dizzy(g, topRow(g));
  }
  g.shade(SHADE_PAIRS);
  g.outline(A.OUT);
  grids.set(key, g);
  return g;
}

/**
 * Draw one unit frame onto any 2D context (Phaser canvas textures, the Scenario Lab, a sprite
 * sheet exporter). `scale` is an integer nearest-neighbour factor; (x, y) is the top-left corner.
 */
export function drawUnit(
  ctx: Ctx2D,
  style: ArmyStyle,
  type: PieceType,
  side: Side,
  element: ElementId,
  facing: UnitFacing,
  frame: UnitFrame,
  scale = 1,
  x = 0,
  y = 0,
): void {
  blit(
    ctx,
    unitGrid(style, type, element, facing, frame),
    armyPalette(side, element, frame === 'faint'),
    scale,
    x,
    y,
  );
}

/** Frame order inside a unit sheet: front idle0, idle1, faint, then back idle0, idle1, faint. */
export const SHEET_FRAMES: readonly { facing: UnitFacing; frame: UnitFrame }[] = (
  ['front', 'back'] as const
).flatMap((facing) => UNIT_FRAMES.map((frame) => ({ facing, frame })));

/** Draw a whole 6-frame sheet (192x32 at scale 1) for one style, type, owner and element. */
export function drawUnitSheet(
  ctx: Ctx2D,
  style: ArmyStyle,
  type: PieceType,
  side: Side,
  element: ElementId,
  scale = 1,
): void {
  SHEET_FRAMES.forEach((f, i) =>
    drawUnit(ctx, style, type, side, element, f.facing, f.frame, scale, i * SPRITE * scale, 0),
  );
}

/** RGBA pixels of a whole sheet (192x32): the fast path used for board textures. */
export function unitSheetPixels(
  style: ArmyStyle,
  type: PieceType,
  side: Side,
  element: ElementId,
): Uint8ClampedArray<ArrayBuffer> {
  const w = SPRITE * SHEET_FRAMES.length;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * SPRITE * 4));
  SHEET_FRAMES.forEach((f, i) => {
    const grid = unitGrid(style, type, element, f.facing, f.frame);
    writeRgba(data, w, grid, armyPalette(side, element, f.frame === 'faint'), i * SPRITE, 0);
  });
  return data;
}
