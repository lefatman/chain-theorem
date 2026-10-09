import { describe, expect, it } from 'vitest';
import type { ElementId, PieceType, PublicPiece, PublicState, Side } from '@chain-theorem/rules';
import {
  BADGE_CLEAR,
  drawUnit,
  ELEMENTS,
  PIECE_TYPES,
  SPRITE,
  unitGrid,
  UNIT_FRAMES,
  type UnitFacing,
  type UnitFrame,
} from './sprites.ts';
import { ARMY_STYLES, type ArmyStyle } from './army.ts';
import { elementIconGrid, glyphBadgeGrid, pipGrid, pipKinds } from './icons.ts';
import { A, armyPalette, elementPalette } from './palette.ts';
import { gba, M, type Ctx2D, type PixelGrid } from './pixel.ts';

const ALL_ELEMENTS: ElementId[] = [...ELEMENTS, 'neutral'];
const SIDES: Side[] = ['white', 'black'];

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) union++;
  }
  return union === 0 ? 1 : inter / union;
}

function count(g: PixelGrid, m: number): number {
  let n = 0;
  for (const v of g.px) if (v === m) n++;
  return n;
}

function luminance(rgb: number): number {
  return 0.2126 * ((rgb >> 16) & 255) + 0.7152 * ((rgb >> 8) & 255) + 0.0722 * (rgb & 255);
}

describe('army sprites (R-ART-001, R-ART-002)', () => {
  for (const facing of ['front', 'back'] as const) {
    for (const frame of ['idle0', 'idle1'] as const) {
      it(`R-ART-002 piece type is readable from the outline alone across styles (${facing} ${frame})`, () => {
        // The nearest silhouette among every other style's units always has the same type.
        for (const type of PIECE_TYPES) {
          for (const style of ARMY_STYLES) {
            const mask = unitGrid(style, type, 'neutral', facing, frame).mask();
            let best = -1;
            let bestType: PieceType | null = null;
            for (const t2 of PIECE_TYPES) {
              for (const s2 of ARMY_STYLES) {
                if (s2 === style) continue;
                const v = iou(mask, unitGrid(s2, t2, 'neutral', facing, frame).mask());
                if (v > best) {
                  best = v;
                  bestType = t2;
                }
              }
            }
            expect(bestType, `${style}/${type}`).toBe(type);
          }
        }
      });
    }
  }

  it('R-ART-002 silhouettes follow type across styles (every unit overlaps each same-type unit more than any other type)', () => {
    for (const facing of ['front', 'back'] as const) {
      for (const ref of ARMY_STYLES) {
        for (const type of PIECE_TYPES) {
          const mask = unitGrid(ref, type, 'neutral', facing, 'idle0').mask();
          let minSame = 1;
          let maxOther = 0;
          for (const style of ARMY_STYLES) {
            if (style === ref) continue;
            for (const t2 of PIECE_TYPES) {
              const v = iou(mask, unitGrid(style, t2, 'neutral', facing, 'idle0').mask());
              if (t2 === type) minSame = Math.min(minSame, v);
              else maxOther = Math.max(maxOther, v);
            }
          }
          expect(minSame, `${ref}/${type} ${facing}`).toBeGreaterThan(maxOther);
        }
      }
    }
  });

  it('R-ART-002 pawns are the shortest units and smaller than all but the slender bishop; queens and kings stand full height', () => {
    // The figure's own top (head and headgear): columns 10..21, not the weapon held at the side.
    const top = (g: PixelGrid) => {
      for (let y = 0; y < g.h; y++) for (let x = 10; x <= 21; x++) if (g.get(x, y)) return y;
      return g.h;
    };
    for (const style of ARMY_STYLES) {
      const grid = (t: PieceType) => unitGrid(style, t, 'neutral', 'front', 'idle0');
      const filled = (t: PieceType) => SPRITE * SPRITE - count(grid(t), A.EMPTY);
      for (const t of PIECE_TYPES) {
        if (t === 'pawn') continue;
        expect(top(grid('pawn')), `${style}: pawn shorter than ${t}`).toBeGreaterThan(top(grid(t)));
        if (t !== 'bishop')
          expect(filled('pawn'), `${style}: pawn smaller than ${t}`).toBeLessThan(filled(t));
      }
      for (const t of ['queen', 'king'] as const)
        expect(top(grid(t)), `${style}/${t}`).toBeLessThanOrEqual(5);
    }
  });

  it('R-ART-002 owner: front sprites show a face, back sprites never do', () => {
    for (const style of ARMY_STYLES) {
      for (const type of PIECE_TYPES) {
        for (const el of ALL_ELEMENTS) {
          expect(
            count(unitGrid(style, type, el, 'front', 'idle0'), A.EYE),
            `${style}/${type}/${el}`,
          ).toBeGreaterThan(0);
          expect(
            count(unitGrid(style, type, el, 'back', 'idle0'), A.EYE),
            `${style}/${type}/${el}`,
          ).toBe(0);
        }
      }
    }
  });

  it('R-ART-002 owner: white steel and black iron armour differ in brightness on every unit', () => {
    for (const el of ALL_ELEMENTS) {
      const w = armyPalette('white', el);
      const b = armyPalette('black', el);
      for (const m of [A.ARM_SH, A.ARM, A.ARM_LT]) {
        expect(luminance(w[m] ?? 0) - luminance(b[m] ?? 0), `${el} material ${m}`).toBeGreaterThan(
          80,
        );
      }
    }
    // Both owners share the grid: only the palette tells them apart.
    const g = unitGrid('roman', 'rook', 'ember', 'front', 'idle0');
    expect(count(g, A.ARM) + count(g, A.ARM_SH) + count(g, A.ARM_LT)).toBeGreaterThan(60);
  });

  it('R-ART-001 every unit has front and back sprites, a 2-frame idle and a faint frame', () => {
    const key = (g: PixelGrid) => g.px.join(',');
    for (const style of ARMY_STYLES) {
      for (const type of PIECE_TYPES) {
        for (const facing of ['front', 'back'] as UnitFacing[]) {
          const frames = UNIT_FRAMES.map((f: UnitFrame) =>
            key(unitGrid(style, type, 'ember', facing, f)),
          );
          expect(new Set(frames).size, `${style}/${type}/${facing}`).toBe(3);
        }
        expect(key(unitGrid(style, type, 'ember', 'front', 'idle0'))).not.toBe(
          key(unitGrid(style, type, 'ember', 'back', 'idle0')),
        );
      }
    }
  });

  it('R-ART-002 element changes the accents and the emblem, never the silhouette', () => {
    for (const style of ARMY_STYLES) {
      for (const type of PIECE_TYPES) {
        for (const facing of ['front', 'back'] as const) {
          const ref = unitGrid(style, type, 'neutral', facing, 'idle0');
          const grids = new Set<string>();
          for (const el of ALL_ELEMENTS) {
            const g = unitGrid(style, type, el, facing, 'idle0');
            expect(g.mask(), `${style}/${type}/${el}/${facing} silhouette`).toEqual(ref.mask());
            grids.add(g.px.join(','));
          }
          expect(grids.size, `${style}/${type}/${facing} emblems`).toBe(ALL_ELEMENTS.length);
        }
      }
    }
    for (const side of SIDES) {
      const accents = ALL_ELEMENTS.map((el) => armyPalette(side, el)[A.ACC]);
      expect(new Set(accents).size).toBe(ALL_ELEMENTS.length);
    }
  });

  it('R-ART-001 palettes are limited handheld-style: 16 entries snapped to 15-bit colour', () => {
    const snapped = (c: number) =>
      [16, 8, 0].every((s) => {
        const v = (c >> s) & 255;
        return v === (((v >> 3) << 3) | (v >> 5));
      });
    for (const el of ALL_ELEMENTS) {
      for (const faint of [false, true]) {
        for (const side of SIDES) {
          const p = armyPalette(side, el, faint);
          expect(p).toHaveLength(16);
          for (const c of p.slice(1))
            expect(snapped(c), `${side} ${el} ${c.toString(16)}`).toBe(true);
        }
        const p = elementPalette(el, faint);
        expect(p).toHaveLength(16);
        for (const c of p.slice(1)) expect(snapped(c), `${el} ${c.toString(16)}`).toBe(true);
      }
    }
    expect(gba(0xffffff)).toBe(0xffffff);
    expect(gba(0x000000)).toBe(0);
  });

  it('R-ART-001 drawUnit draws nearest-neighbour pixels at an integer scale', () => {
    const rects: [number, number, number, number][] = [];
    const ctx: Ctx2D = {
      fillStyle: '#000',
      fillRect: (x, y, w, h) => {
        rects.push([x, y, w, h]);
      },
    };
    drawUnit(ctx, 'arab', 'knight', 'black', 'storm', 'front', 'idle0', 3, 10, 20);
    expect(rects.length).toBeGreaterThan(20);
    for (const [x, y, w, h] of rects) {
      expect(h).toBe(3);
      expect(w % 3).toBe(0);
      expect((x - 10) % 3).toBe(0);
      expect((y - 20) % 3).toBe(0);
      expect(x + w).toBeLessThanOrEqual(10 + SPRITE * 3);
      expect(y + h).toBeLessThanOrEqual(20 + SPRITE * 3);
    }
  });

  it('R-ART-002 the glyph badge corner stays clear of every unit, and nothing rises above the square', () => {
    for (const style of ARMY_STYLES) {
      for (const type of PIECE_TYPES) {
        for (const el of ALL_ELEMENTS) {
          for (const facing of ['front', 'back'] as const) {
            for (const frame of UNIT_FRAMES) {
              const g = unitGrid(style, type, el, facing, frame);
              for (let y = BADGE_CLEAR.y0; y <= BADGE_CLEAR.y1; y++) {
                for (let x = 0; x <= BADGE_CLEAR.x; x++)
                  expect(g.get(x, y), `${style}/${type}/${el}/${facing}/${frame} ${x},${y}`).toBe(
                    A.EMPTY,
                  );
              }
              for (let y = 0; y < BADGE_CLEAR.y0; y++)
                for (let x = 0; x < SPRITE; x++)
                  expect(
                    g.get(x, y),
                    `${style}/${type}/${el}/${facing}/${frame} above the square ${x},${y}`,
                  ).toBe(A.EMPTY);
              // The bottom row holds at most the boots' outline: feet stand on the base ring.
              for (let x = 0; x < SPRITE; x++)
                expect(
                  [A.EMPTY, A.OUT],
                  `${style}/${type}/${el}/${facing}/${frame} bottom row`,
                ).toContain(g.get(x, SPRITE - 1));
            }
          }
        }
      }
    }
  });
});

/**
 * Rough colour-vision-deficiency simulations (Machado, Oliveira and Fernandes 2009, severity 1,
 * applied to sRGB values) plus plain luminance: enough to check that an element cue does not rest
 * on hue alone.
 */
const VISION: Record<string, readonly number[]> = {
  protanopia: [0.152, 1.053, -0.205, 0.115, 0.786, 0.099, -0.004, -0.048, 1.052],
  deuteranopia: [0.367, 0.861, -0.228, 0.28, 0.673, 0.047, -0.012, 0.043, 0.969],
  tritanopia: [1.256, -0.077, -0.179, -0.078, 0.931, 0.148, 0.005, 0.691, 0.304],
  grayscale: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
};

function seen(rgb: number, m: readonly number[]): [number, number, number] {
  const c = [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255];
  const at = (i: number) =>
    Math.max(
      0,
      Math.min(
        255,
        (m[i] ?? 0) * (c[0] ?? 0) + (m[i + 1] ?? 0) * (c[1] ?? 0) + (m[i + 2] ?? 0) * (c[2] ?? 0),
      ),
    );
  return [at(0), at(3), at(6)];
}

/** Pixels that differ (shape, or a clearly different seen colour) between two sprites of a unit. */
function seenDifference(
  style: ArmyStyle,
  type: PieceType,
  side: Side,
  a: ElementId,
  b: ElementId,
  facing: UnitFacing,
  m: readonly number[],
): number {
  const ga = unitGrid(style, type, a, facing, 'idle0');
  const gb = unitGrid(style, type, b, facing, 'idle0');
  const pa = armyPalette(side, a);
  const pb = armyPalette(side, b);
  let n = 0;
  for (let i = 0; i < ga.px.length; i++) {
    const ma = ga.px[i] ?? 0;
    const mb = gb.px[i] ?? 0;
    if (ma === A.EMPTY && mb === A.EMPTY) continue;
    if (ma === A.EMPTY || mb === A.EMPTY) {
      n++;
      continue;
    }
    const ca = seen(pa[ma] ?? 0, m);
    const cb = seen(pb[mb] ?? 0, m);
    if (Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]) > 40) n++;
  }
  return n;
}

describe('element emblems (R-ART-002: colour is never the only signal)', () => {
  it('R-ART-002 every unit wears its element emblem on both facings, painted inside the armour or cloth', () => {
    for (const style of ARMY_STYLES) {
      for (const type of PIECE_TYPES) {
        for (const facing of ['front', 'back'] as const) {
          const emblems = ELEMENTS.map((el) =>
            unitGrid(style, type, el, facing, 'idle0')
              .px.map((v) => (v === A.ACC || v === A.ACC_LT ? 1 : 0))
              .join(''),
          );
          expect(new Set(emblems).size, `${style}/${type}/${facing}`).toBe(ELEMENTS.length);
        }
      }
    }
  });

  it('R-ART-002 under protanopia, deuteranopia and tritanopia simulations and in grayscale, each element’s unit differs from every other element’s unit of the same style, type and owner', () => {
    for (const [vision, m] of Object.entries(VISION)) {
      for (const style of ARMY_STYLES) {
        for (const type of PIECE_TYPES) {
          for (const side of SIDES) {
            for (const facing of ['front', 'back'] as const) {
              for (const a of ELEMENTS) {
                for (const b of ELEMENTS) {
                  if (a === b) continue;
                  expect(
                    seenDifference(style, type, side, a, b, facing, m),
                    `${vision} ${side} ${style} ${type} ${facing} ${a}/${b}`,
                  ).toBeGreaterThanOrEqual(8);
                }
              }
            }
          }
        }
      }
    }
  });
});

describe('board icons (R-ART-002: colour is never the only signal)', () => {
  it('R-ART-002 every element icon has its own shape', () => {
    const masks = ALL_ELEMENTS.map((el) => elementIconGrid(el).mask());
    for (let i = 0; i < masks.length; i++) {
      for (let j = i + 1; j < masks.length; j++) {
        const a = masks[i];
        const b = masks[j];
        if (!a || !b) continue;
        expect(iou(a, b), `${ALL_ELEMENTS[i]} vs ${ALL_ELEMENTS[j]}`).toBeLessThan(0.8);
      }
    }
  });

  it('R-ART-002 every piece type has a distinct glyph badge', () => {
    const glyphs = PIECE_TYPES.map((t) => glyphBadgeGrid(t).px.join(','));
    expect(new Set(glyphs).size).toBe(PIECE_TYPES.length);
  });

  it('R-ART-002 pip kinds differ in shape, not just colour', () => {
    const masks = (['known', 'hidden', 'veiled'] as const).map((k) =>
      pipGrid(k)
        .px.map((v) => (v === M.EMPTY ? 0 : v === M.OUT ? 1 : 2))
        .join(','),
    );
    expect(new Set(masks).size).toBe(3);
  });
});

describe('ability pips (R-ART-002, R-INFO-005)', () => {
  const piece = (side: 'white' | 'black', type: PieceType): PublicPiece => ({
    id: 0,
    side,
    type,
    element: 'ember',
    square: 0,
    start: 0,
    capturedSeq: -1,
  });
  const reveal = (abilities: Partial<Record<PieceType, string[]>>, veiled: PieceType[] = []) => ({
    abilities,
    complete: [],
    items: [],
    allItems: false,
    veiled,
  });
  const pub = {
    viewer: 'white',
    armies: {
      white: {
        level: 10,
        elements: ['ember'],
        consumedSlots: 0,
        revealed: reveal({ pawn: ['momentum'] }),
        sets: {
          pawn: ['momentum', 'hit_and_run'],
          knight: [],
          bishop: [],
          rook: [],
          queen: [],
          king: [],
        },
      },
      black: {
        level: 10,
        elements: ['tide'],
        consumedSlots: 0,
        revealed: reveal({ knight: ['backdraft'] }, ['knight']),
      },
    },
  } as unknown as PublicState;

  it('R-ART-002 own pieces show every ability: filled when the opponent knows it, hollow while hidden', () => {
    expect(pipKinds(pub, piece('white', 'pawn'), 'white')).toEqual(['known', 'hidden']);
    expect(pipKinds(pub, piece('white', 'rook'), 'white')).toEqual([]);
  });

  it('R-ART-002 opponent pieces show only revealed abilities, plus a veiled marker', () => {
    expect(pipKinds(pub, piece('black', 'knight'), 'white')).toEqual(['known', 'veiled']);
    expect(pipKinds(pub, piece('black', 'pawn'), 'white')).toEqual([]);
  });
});
