/** Drop-in army art paths and sheet sizes (R-ART-001, 4.5). */
import { describe, expect, it } from 'vitest';
import { parseDropIn, validSheetSize } from './dropin.ts';

describe('drop-in army art (R-ART-001)', () => {
  it('R-ART-001 maps assets/army/<style>/<side>[/<element>]/<type>.png to a unit sheet', () => {
    expect(parseDropIn('../../../../../assets/army/medieval/white/knight.png')).toEqual({
      style: 'medieval',
      side: 'white',
      element: '*',
      type: 'knight',
    });
    expect(parseDropIn('/assets/army/samurai/black/frost/king.png')).toEqual({
      style: 'samurai',
      side: 'black',
      element: 'frost',
      type: 'king',
    });
  });

  it('R-ART-001 R-ART-003 rejects unknown styles, sides, elements, types and other layouts', () => {
    expect(parseDropIn('/assets/army/viking/white/knight.png')).toBeNull();
    expect(parseDropIn('/assets/army/roman/red/knight.png')).toBeNull();
    expect(parseDropIn('/assets/army/roman/white/fire/knight.png')).toBeNull();
    expect(parseDropIn('/assets/army/roman/white/dragon.png')).toBeNull();
    expect(parseDropIn('/assets/army/roman-white-knight.png')).toBeNull();
    expect(parseDropIn('/assets/army/roman/white/neutral/pawn.png')).toBeNull();
  });

  it('R-ART-001 a sheet is six square frames in one row', () => {
    expect(validSheetSize(192, 32)).toBe(true);
    expect(validSheetSize(384, 64)).toBe(true);
    expect(validSheetSize(193, 32)).toBe(false);
    expect(validSheetSize(32, 32)).toBe(false);
    expect(validSheetSize(768, 128)).toBe(false);
  });
});
