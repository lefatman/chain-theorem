import { describe, expect, it } from 'vitest';
import type { ElementId, PieceType, PublicPiece, PublicState } from '@chain-theorem/rules';
import {
  creatureGrid,
  CREATURE_FRAMES,
  drawCreature,
  ELEMENTS,
  PIECE_TYPES,
  SPRITE,
  type CreatureFacing,
  type CreatureFrame,
} from './sprites.ts';
import { elementIconGrid, glyphBadgeGrid, pipGrid, pipKinds } from './icons.ts';
import { creaturePalette } from './palette.ts';
import { gba, M, type Ctx2D, type PixelGrid } from './pixel.ts';

const ALL_ELEMENTS: ElementId[] = [...ELEMENTS, 'neutral'];

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

describe('creature sprites (R-ART-001, R-ART-002)', () => {
  for (const facing of ['front', 'back'] as const) {
    for (const frame of ['idle0', 'idle1'] as const) {
      it(`R-ART-002 piece type is readable from the outline alone (${facing} ${frame})`, () => {
        // Nearest silhouette among every other element's creatures always has the same type.
        for (const type of PIECE_TYPES) {
          for (const el of ELEMENTS) {
            const mask = creatureGrid(type, el, facing, frame).mask();
            let best = -1;
            let bestType: PieceType | null = null;
            for (const t2 of PIECE_TYPES) {
              for (const e2 of ELEMENTS) {
                if (e2 === el) continue;
                const v = iou(mask, creatureGrid(t2, e2, facing, frame).mask());
                if (v > best) {
                  best = v;
                  bestType = t2;
                }
              }
            }
            expect(bestType, `${type}/${el}`).toBe(type);
          }
        }
      });
    }
  }

  it('R-ART-002 silhouettes follow type across elements (same type overlaps more than any other type)', () => {
    let minSame = 1;
    let maxOther = 0;
    for (const type of PIECE_TYPES) {
      const ref = creatureGrid(type, 'neutral', 'front', 'idle0').mask();
      for (const el of ELEMENTS) {
        for (const t2 of PIECE_TYPES) {
          const v = iou(ref, creatureGrid(t2, el, 'front', 'idle0').mask());
          if (t2 === type) minSame = Math.min(minSame, v);
          else maxOther = Math.max(maxOther, v);
        }
      }
    }
    expect(minSame).toBeGreaterThan(maxOther);
  });

  it('R-ART-002 pawns are the smallest creatures and queens and kings the largest', () => {
    const area = (t: PieceType) => count(creatureGrid(t, 'neutral', 'front', 'idle0'), M.EMPTY);
    const filled = (t: PieceType) => SPRITE * SPRITE - area(t);
    for (const t of PIECE_TYPES) if (t !== 'pawn') expect(filled('pawn')).toBeLessThan(filled(t));
    for (const t of ['pawn', 'knight', 'bishop'] as const) {
      expect(filled(t)).toBeLessThan(filled('queen'));
      expect(filled(t)).toBeLessThan(filled('king'));
    }
  });

  it('R-ART-002 owner: front sprites show a face, back sprites never do', () => {
    for (const type of PIECE_TYPES) {
      for (const el of ALL_ELEMENTS) {
        expect(
          count(creatureGrid(type, el, 'front', 'idle0'), M.EYE),
          `${type}/${el}`,
        ).toBeGreaterThan(0);
        expect(count(creatureGrid(type, el, 'back', 'idle0'), M.EYE), `${type}/${el}`).toBe(0);
      }
    }
  });

  it('R-ART-001 every creature has front and back sprites, a 2-frame idle and a faint frame', () => {
    const key = (g: PixelGrid) => g.px.join(',');
    for (const type of PIECE_TYPES) {
      for (const el of ALL_ELEMENTS) {
        for (const facing of ['front', 'back'] as CreatureFacing[]) {
          const frames = CREATURE_FRAMES.map((f: CreatureFrame) =>
            key(creatureGrid(type, el, facing, f)),
          );
          expect(new Set(frames).size, `${type}/${el}/${facing}`).toBe(3);
        }
        expect(key(creatureGrid(type, el, 'front', 'idle0'))).not.toBe(
          key(creatureGrid(type, el, 'back', 'idle0')),
        );
      }
    }
  });

  it('R-ART-002 element changes the palette and motif, never the piece type', () => {
    for (const type of PIECE_TYPES) {
      const grids = ELEMENTS.map((el) => creatureGrid(type, el, 'front', 'idle0').px.join(','));
      expect(new Set(grids).size).toBe(ELEMENTS.length);
    }
    const bases = ALL_ELEMENTS.map((el) => creaturePalette(el)[M.BASE]);
    expect(new Set(bases).size).toBe(ALL_ELEMENTS.length);
  });

  it('R-ART-001 palettes are limited GBA-style: 16 entries snapped to 15-bit colour', () => {
    const snapped = (c: number) =>
      [16, 8, 0].every((s) => {
        const v = (c >> s) & 255;
        return v === (((v >> 3) << 3) | (v >> 5));
      });
    for (const el of ALL_ELEMENTS) {
      for (const faint of [false, true]) {
        const p = creaturePalette(el, faint);
        expect(p).toHaveLength(16);
        for (const c of p.slice(1)) expect(snapped(c), `${el} ${c.toString(16)}`).toBe(true);
      }
    }
    expect(gba(0xffffff)).toBe(0xffffff);
    expect(gba(0x000000)).toBe(0);
  });

  it('R-ART-001 drawCreature draws nearest-neighbour pixels at an integer scale', () => {
    const rects: [number, number, number, number][] = [];
    const ctx: Ctx2D = {
      fillStyle: '#000',
      fillRect: (x, y, w, h) => {
        rects.push([x, y, w, h]);
      },
    };
    drawCreature(ctx, 'knight', 'storm', 'front', 'idle0', 3, 10, 20);
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

  it('R-ART-002 the glyph badge corner (x <= 4, y <= 4) stays clear of every creature', () => {
    for (const type of PIECE_TYPES) {
      for (const el of ALL_ELEMENTS) {
        for (const facing of ['front', 'back'] as const) {
          for (const frame of CREATURE_FRAMES) {
            const g = creatureGrid(type, el, facing, frame);
            for (let y = 0; y <= 4; y++) {
              for (let x = 0; x <= 4; x++)
                expect(g.get(x, y), `${type}/${el}/${facing}/${frame} ${x},${y}`).toBe(M.EMPTY);
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
