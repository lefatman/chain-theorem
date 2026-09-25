/**
 * World content types (M5, spec 10): zones authored in Tiled (JSON export), NPCs, encounter tables,
 * Chess Academy lessons, quests, rewards and key items. Everything here is plain data; the server
 * decides encounters, lesson results and rewards (R-SEC-003), the client only draws.
 */
import type { ElementId, FormatId, Loadout } from '@chain-theorem/rules';

export type Dir = 'n' | 's' | 'e' | 'w';
export type NpcTier = 'wild' | 'trainer' | 'elite';

// ---- Tiled maps (orthogonal, 16x16 tiles, JSON export; 10.1) -----------------------------------

/**
 * The subset of the Tiled JSON map format the game reads. Tile meaning comes from tile properties
 * in the map's embedded tileset: `kind` (drawing), `solid` (blocks movement), `wild` (encounter grass).
 * Object layer `objects` holds spawn points, warps, NPCs, named areas and challenge zones.
 */
export interface TiledMap {
  type: 'map';
  orientation: 'orthogonal';
  width: number;
  height: number;
  tilewidth: 16;
  tileheight: 16;
  infinite: false;
  layers: TiledLayer[];
  tilesets: TiledTileset[];
  properties?: TiledProperty[];
  /** Tiled bookkeeping fields are allowed and ignored. */
  [extra: string]: unknown;
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer;

export interface TiledTileLayer {
  type: 'tilelayer';
  name: string;
  width: number;
  height: number;
  /** Global tile ids, row-major; 0 = empty. */
  data: number[];
  [extra: string]: unknown;
}

export interface TiledObjectLayer {
  type: 'objectgroup';
  name: string;
  objects: TiledObject[];
  [extra: string]: unknown;
}

export interface TiledObject {
  id: number;
  name: string;
  /** 'spawn' | 'warp' | 'npc' | 'area' | 'challenge' | 'sign' (Tiled 1.9+ calls this `type`). */
  type: string;
  /** Pixels (object top-left); rectangles have width/height, points have 0. */
  x: number;
  y: number;
  width: number;
  height: number;
  properties?: TiledProperty[];
  [extra: string]: unknown;
}

export interface TiledProperty {
  name: string;
  type: 'string' | 'int' | 'float' | 'bool';
  value: string | number | boolean;
}

export interface TiledTileset {
  firstgid: number;
  name: string;
  tilewidth: 16;
  tileheight: 16;
  tilecount: number;
  columns: number;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tiles?: { id: number; properties?: TiledProperty[] }[];
  [extra: string]: unknown;
}

/** A rectangle in tile coordinates. */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the server and client need from a map, parsed once (geometry.ts). */
export interface ZoneGeometry {
  width: number;
  height: number;
  /** Per tile (row-major): 1 when movement is blocked. */
  solid: Uint8Array;
  /** Per tile: 1 on wild grass, where encounters are rolled (10.2). */
  wild: Uint8Array;
  /** Per tile: the drawing kind of each tile layer's tile, bottom layer first ('' = empty). */
  kinds: string[][];
  spawn: { x: number; y: number; dir: Dir };
  warps: { x: number; y: number; to: string; toX: number; toY: number; dir: Dir }[];
  npcs: { id: string; x: number; y: number; dir: Dir }[];
  areas: ({ name: string } & TileRect)[];
  challenge: TileRect[];
  signs: { x: number; y: number; text: string }[];
}

// ---- Zones -----------------------------------------------------------------------------------

export interface EncounterEntry {
  weight: number;
  /** Wild NPC level range, inclusive (clamped to the player's level ± 2 by the server). */
  levels: [number, number];
  /** Element of the wild creature army; omitted = any enabled element. */
  element?: ElementId;
  /** Display name, e.g. "Wild Blazelope". */
  name: string;
}

export interface ZoneDef {
  id: string;
  name: string;
  kind: 'town' | 'route' | 'wild' | 'interior';
  map: TiledMap;
  /** Encounter chance per step on a wild tile (10.2, PLAYTEST). 0 in towns. */
  encounterRate: number;
  /** Safe steps after an encounter before the next roll can hit. */
  encounterGrace: number;
  encounters: EncounterEntry[];
  /** Format of wild encounters and challenge-zone battles (10.2: First Blood). */
  format: FormatId;
}

// ---- NPCs ------------------------------------------------------------------------------------

export interface Reward {
  xp: number;
  items?: { id: string; qty: number }[];
  cards?: { id: string; qty: number }[];
  keyItems?: string[];
  coins?: number;
}

export type NpcRole =
  | { kind: 'talk' }
  | {
      kind: 'trainer';
      tier: NpcTier;
      format: FormatId;
      level: number;
      /** A fixed legal loadout (validated at `level`), or a seeded content build. */
      loadout: Loadout | { buildSeed: number };
      reward: Reward;
      /** Battle only once (story trainers) or any number of times (practice). */
      once: boolean;
    }
  | { kind: 'teacher'; lessons: string[] }
  | { kind: 'quest'; quest: string };

export interface NpcDef {
  id: string;
  name: string;
  /** Overworld look: a procedural trainer sprite variant (0..15) and colour. */
  look: { variant: number; element: ElementId | 'neutral' };
  /** Lines shown when talked to; `{name}` is replaced by the player's name. */
  lines: string[];
  role: NpcRole;
}

// ---- Chess Academy lessons (10.3) ------------------------------------------------------------

/**
 * A puzzle is solved when the player's move is one of `accept` (UCI) in the position `fen`; the
 * server checks legality with the engine. Chess lessons (movement, check, checkmate) may be skipped
 * by veterans; ability and element lessons may not (10.3).
 */
export interface Puzzle {
  fen: string;
  prompt: string;
  accept: string[];
  /** Shown after a wrong answer. */
  hint: string;
}

export type LessonDef =
  | {
      id: string;
      title: string;
      kind: 'puzzles';
      topic: 'movement' | 'check' | 'checkmate';
      skippable: true;
      intro: string[];
      puzzles: Puzzle[];
      reward: Reward;
    }
  | {
      id: string;
      title: string;
      /** A real server battle against an Academy NPC with fixed loadouts that showcase one ability or element. */
      kind: 'battle';
      topic: 'ability' | 'element';
      skippable: false;
      intro: string[];
      format: FormatId;
      fen?: string;
      player: { level: number; loadout: Loadout };
      npc: { name: string; tier: NpcTier; level: number; loadout: Loadout };
      reward: Reward;
    };

// ---- Quests (10.5) ---------------------------------------------------------------------------

export type QuestStep =
  | { kind: 'talk'; npc: string; text: string }
  | { kind: 'reach'; zone: string; area: string; text: string }
  | { kind: 'defeat'; npc: string; text: string }
  | { kind: 'lesson'; lesson: string; text: string }
  | {
      kind: 'win';
      text: string;
      /** Constraints on the battle and the player's loadout (e.g. only Tide abilities). */
      constraint: { format?: FormatId; tier?: NpcTier; onlyAffinity?: ElementId; wild?: boolean };
    };

export interface QuestDef {
  id: string;
  name: string;
  /** Quests that must be complete first. */
  requires: string[];
  steps: QuestStep[];
  reward: Reward;
}

// ---- Key items (10.2) ------------------------------------------------------------------------

export interface KeyItemDef {
  id: string;
  name: string;
  text: string;
  /** Multiplies the encounter rate while owned (e.g. 0.5); key items never use item slots. */
  encounterRate?: number;
}

export interface WorldRegistry {
  zones: readonly ZoneDef[];
  npcs: readonly NpcDef[];
  lessons: readonly LessonDef[];
  quests: readonly QuestDef[];
  keyItems: readonly KeyItemDef[];
  /** Where a new account appears. */
  start: { zone: string };
}
