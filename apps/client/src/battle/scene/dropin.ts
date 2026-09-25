/**
 * Drop-in creature art (4.5, 11.1). A PNG at `assets/creatures/<element>/<type>.png` replaces the
 * procedural sheet for that element and piece type. The sheet holds six square frames in one row in
 * `SHEET_FRAMES` order (front idle0, idle1, faint, then back idle0, idle1, faint), 24 or 48 px per
 * frame. Every file needs a source and licence row in assets/LICENSES.md (R-ART-003). Files are
 * fetched only when a battle opens, so they never count toward the first load (12.3).
 */
import { ELEMENTS, PIECE_TYPES, type ElementId, type PieceType } from '@chain-theorem/rules';
import { registerCreatureSheet } from './art.ts';
import { SHEET_FRAMES } from './sprites.ts';

const files = import.meta.glob('../../../../../assets/creatures/*/*.png', {
  query: '?url',
  import: 'default',
}) as Record<string, () => Promise<string>>;

/** Element and piece type named by a drop-in path, or null when the path is not a creature sheet. */
export function parseDropIn(path: string): { element: ElementId; type: PieceType } | null {
  const m = /creatures\/([a-z]+)\/([a-z]+)\.png$/.exec(path);
  if (!m) return null;
  const element = m[1] as ElementId;
  const type = m[2] as PieceType;
  if (!(ELEMENTS as readonly string[]).includes(element)) return null;
  if (!(PIECE_TYPES as readonly string[]).includes(type)) return null;
  return { element, type };
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
    for (const [path, url] of Object.entries(files)) {
      const id = parseDropIn(path);
      if (!id) {
        console.warn(
          `drop-in art ignored (expected assets/creatures/<element>/<type>.png): ${path}`,
        );
        continue;
      }
      try {
        const img = await loadImage(await url());
        if (!validSheetSize(img.naturalWidth, img.naturalHeight)) {
          console.warn(`drop-in art ignored (six square frames in one row): ${path}`);
          continue;
        }
        registerCreatureSheet(id.type, id.element, img);
        n++;
      } catch (e) {
        console.warn(String(e));
      }
    }
    return n;
  })();
  return loaded;
}
