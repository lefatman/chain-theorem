/**
 * Drop-in army art (4.5, 11.1). A PNG at `assets/army/<style>/<side>/<type>.png` replaces the
 * procedural sheet for that army style, owner and piece type in every element; a PNG at
 * `assets/army/<style>/<side>/<element>/<type>.png` replaces it for one element. The sheet holds six
 * square frames in one row in `SHEET_FRAMES` order (front idle0, idle1, faint, then back idle0,
 * idle1, faint), 32 or 64 px per frame. Every file needs a source and licence row in
 * assets/LICENSES.md (R-ART-003). Files are fetched only when a battle opens, so they never count
 * toward the first load (12.3).
 */
import {
  ELEMENTS,
  PIECE_TYPES,
  type ElementId,
  type PieceType,
  type Side,
} from '@chain-theorem/rules';
import { ARMY_STYLES, type ArmyStyle } from './army.ts';
import { registerUnitSheet } from './art.ts';
import { SHEET_FRAMES } from './sprites.ts';

const files = import.meta.glob('../../../../../assets/army/*/*/*.png', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;
const perElement = import.meta.glob('../../../../../assets/army/*/*/*/*.png', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

export interface DropInId {
  style: ArmyStyle;
  side: Side;
  /** One element, or every element. */
  element: ElementId | '*';
  type: PieceType;
}

/** The unit named by a drop-in path, or null when the path is not an army sheet. */
export function parseDropIn(path: string): DropInId | null {
  const m = /army\/([a-z]+)\/(white|black)(?:\/([a-z]+))?\/([a-z]+)\.png$/.exec(path);
  if (!m) return null;
  const style = m[1] as ArmyStyle;
  const side = m[2] as Side;
  const element = (m[3] ?? '*') as ElementId | '*';
  const type = m[4] as PieceType;
  if (!(ARMY_STYLES as readonly string[]).includes(style)) return null;
  if (element !== '*' && !(ELEMENTS as readonly string[]).includes(element)) return null;
  if (!(PIECE_TYPES as readonly string[]).includes(type)) return null;
  return { style, side, element, type };
}

/** A sheet is six square frames of 16 to 64 px in one row. */
export function validSheetSize(width: number, height: number): boolean {
  return (
    Number.isInteger(height) &&
    height >= 16 &&
    height <= 64 &&
    width === height * SHEET_FRAMES.length
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`cannot load ${url}`));
    img.src = url;
  });
}

let loaded: Promise<number> | null = null;

/** Register every valid drop-in sheet once; resolves to how many were registered. */
export function loadDropInArt(): Promise<number> {
  loaded ??= (async () => {
    let n = 0;
    for (const [path, url] of [...Object.entries(files), ...Object.entries(perElement)]) {
      const id = parseDropIn(path);
      if (!id) {
        console.warn(
          `drop-in art ignored (expected assets/army/<style>/<side>[/<element>]/<type>.png): ${path}`,
        );
        continue;
      }
      try {
        const img = await loadImage(await url());
        if (!validSheetSize(img.naturalWidth, img.naturalHeight)) {
          console.warn(`drop-in art ignored (six square frames in one row): ${path}`);
          continue;
        }
        registerUnitSheet(id.style, id.type, id.side, id.element, img);
        n++;
      } catch (e) {
        console.warn(String(e));
      }
    }
    return n;
  })();
  return loaded;
}
