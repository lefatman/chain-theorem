/**
 * Overworld framing (M5, spec 11.1, 12.3): the camera zoom is the largest integer scale that still
 * shows a handheld-like view of at least MIN_TILES_X x MIN_TILES_Y tiles, so pixels stay square and
 * crisp (nearest-neighbour, R-ART-001) from a 360x640 phone to a desktop.
 */
import { TILE } from './tiles.ts';

export const MIN_TILES_X = 11;
export const MIN_TILES_Y = 9;
export const MAX_ZOOM = 6;

export function worldZoom(width: number, height: number): number {
  const z = Math.min(
    Math.floor(width / (TILE * MIN_TILES_X)),
    Math.floor(height / (TILE * MIN_TILES_Y)),
  );
  return Math.max(1, Math.min(MAX_ZOOM, z));
}
