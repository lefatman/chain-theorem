/** Drop-in creature art paths and sheet sizes (R-ART-001, 4.5). */
import { describe, expect, it } from 'vitest';
import { parseDropIn, validSheetSize } from './dropin.ts';

describe('drop-in creature art (R-ART-001)', () => {
  it('R-ART-001 maps assets/creatures/<element>/<type>.png to a sheet', () => {
    expect(parseDropIn('../../../../../assets/creatures/ember/knight.png')).toEqual({
      element: 'ember',
      type: 'knight',
    });
    expect(parseDropIn('/assets/creatures/frost/king.png')).toEqual({
      element: 'frost',
      type: 'king',
    });
  });

  it('R-ART-001 R-ART-003 rejects unknown elements, types and other layouts', () => {
    expect(parseDropIn('/assets/creatures/fire/knight.png')).toBeNull();
    expect(parseDropIn('/assets/creatures/ember/dragon.png')).toBeNull();
    expect(parseDropIn('/assets/creatures/ember-knight.png')).toBeNull();
    expect(parseDropIn('/assets/creatures/neutral/pawn.png')).toBeNull();
  });

  it('R-ART-001 a sheet is six square frames in one row', () => {
    expect(validSheetSize(144, 24)).toBe(true);
    expect(validSheetSize(288, 48)).toBe(true);
    expect(validSheetSize(145, 24)).toBe(false);
    expect(validSheetSize(24, 24)).toBe(false);
    expect(validSheetSize(768, 128)).toBe(false);
  });
});
