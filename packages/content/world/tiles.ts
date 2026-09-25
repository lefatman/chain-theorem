/**
 * The overworld tileset (10.1, R-WORLD-001): one 16x16 tile catalogue shared by every zone map. Each
 * map embeds it as a Tiled tileset whose tile properties carry `kind` (drawing key), `solid` (blocks
 * movement) and `wild` (encounter grass, 10.2). The pixel art is painted in code
 * (`tools/art.ts` → `assets/world/tiles.png`, R-ART-003); the order here is the tile id order in that
 * image (8 columns). Adding a tile appends to the end so existing maps keep their gids.
 */

export interface TileDef {
  kind: string;
  solid: boolean;
  wild: boolean;
  /**
   * 'ground' tiles are opaque and fill the bottom layer; 'deco' tiles have a transparent background
   * and sit on the second layer over a ground tile.
   */
  layer: 'ground' | 'deco';
}

const g = (kind: string, solid = false, wild = false): TileDef => ({
  kind,
  solid,
  wild,
  layer: 'ground',
});
const d = (kind: string, solid = true): TileDef => ({ kind, solid, wild: false, layer: 'deco' });

export const TILESET_NAME = 'overworld';
export const TILESET_COLUMNS = 8;

export const TILES: readonly TileDef[] = [
  // Row 0: outdoor ground.
  g('grass'),
  g('grass_tuft'),
  g('flowers'),
  g('path'),
  g('plaza'),
  g('tall_grass', false, true),
  g('sand'),
  g('bridge'),
  // Row 1: nature.
  d('tree'),
  d('bush'),
  d('rock'),
  g('water', true),
  g('lily', true),
  d('fence'),
  d('signpost'),
  d('stump'),
  // Row 2: buildings and town furniture.
  d('roof'),
  d('eave'),
  d('wall'),
  d('window'),
  d('door', false),
  d('emblem'),
  d('lamp'),
  d('fountain'),
  // Row 3: interiors.
  g('floor'),
  g('checker_light'),
  g('checker_dark'),
  g('inner_wall', true),
  d('bookshelf'),
  d('desk'),
  g('rug'),
  g('doormat'),
  // Row 4: interior furniture and extras.
  d('statue'),
  d('blackboard'),
  d('plant'),
  d('crate'),
  d('mailbox'),
  g('meadow_grass'),
  g('mushrooms'),
  g('reeds', true),
];

/** Tile id (0-based, as in the tileset) by kind. */
export const tileId: ReadonlyMap<string, number> = new Map(TILES.map((t, i) => [t.kind, i]));
