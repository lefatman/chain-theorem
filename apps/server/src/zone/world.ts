/**
 * The world content contracts the zone core reads (M5, spec 10): `packages/content/world`. The
 * content package does not export its `world/` folder yet, so this file is the one place that
 * reaches into it; switch both lines to the package export (`@chain-theorem/content/world`) once
 * it exists and nothing else changes.
 */
export type * from '../../../../packages/content/world/types.ts';
export {
  inRect,
  parseZone,
  stepFrom,
  tileIndex,
  walkable,
} from '../../../../packages/content/world/geometry.ts';
