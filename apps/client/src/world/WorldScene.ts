/**
 * Phaser overworld scene (M5, spec 10.1, 11.1, 12.3). Lazy-loaded with Phaser, never in the first
 * load. Draws the zone from its Tiled geometry (`kinds` per layer, procedural 16x16 tiles painted
 * in chunks), the challenge-zone overlay (hatch plus border, R-WORLD-006), players and NPCs as
 * procedural trainers (four directions, 2-frame walk) with name tags, the battling marker (10.1)
 * and selection brackets. The camera follows the player at an integer zoom (nearest-neighbour,
 * R-ART-001). Rendering is on demand: the loop sleeps when nothing moves and any change wakes it.
 *
 * The scene only draws what the WorldController holds; input lives in the DOM (ui/world), except
 * taps on the map, which it reports as tiles.
 */
import Phaser from 'phaser';
import { effect } from '@preact/signals';
import { tileId } from '@chain-theorem/content/world';
// The content tileset (what Tiled shows); small enough that Vite inlines it into this lazy chunk.
import tilesetUrl from '../../../../assets/world/tiles.png';
import { drawnPos, STEP_MS, type Mover, type WorldController } from './controller.ts';
import type { ZoneGeometry } from '@chain-theorem/content/world';
import { atlasFromImage, paintChunk, paintTile, TILE, type TileAtlas } from './tiles.ts';
import { worldZoom } from './view.ts';
import {
  battleMark,
  hatchMark,
  lookKey,
  selectMark,
  shadowMark,
  trainerFrameIndex,
  trainerSheet,
  TRAINER_FRAMES,
  TRAINER_H,
  TRAINER_W,
  type Mark,
  type TrainerLook,
} from './trainers.ts';

export interface WorldSceneHost {
  controller: WorldController;
  playerLook(id: string): TrainerLook;
  npcLook(id: string): TrainerLook;
  ownName(): string;
  /** Text scale (11.2) for name tags. */
  textScale(): number;
  /** A tile was tapped or clicked. */
  onTile(x: number, y: number): void;
}

/** Map chunk edge in tiles (one texture each, painted when it comes into view). */
const CHUNK = 32;
const TAG_PX = 11;
const TILESET = 'ct-w-tileset';

/** The tileset cut by kind, kept across visits (null: not loaded, procedural tiles only). */
let atlas: TileAtlas | null = null;

interface Actor {
  sheet: string;
  body: Phaser.GameObjects.Image;
  shadow: Phaser.GameObjects.Image;
  tag: Phaser.GameObjects.Text;
  mark: Phaser.GameObjects.Image;
  select: Phaser.GameObjects.Image;
  seen: boolean;
}

function canvasFrom(w: number, h: number, rgba: Uint8ClampedArray<ArrayBuffer>): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  return c;
}

function markRgba(m: Mark): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(m.grid.w * m.grid.h * 4);
  for (let y = 0; y < m.grid.h; y++)
    for (let x = 0; x < m.grid.w; x++) {
      const v = m.grid.get(x, y);
      if (v === 0) continue;
      const c = m.palette[v] ?? 0;
      const i = (y * m.grid.w + x) * 4;
      out[i] = (c >> 16) & 255;
      out[i + 1] = (c >> 8) & 255;
      out[i + 2] = c & 255;
      out[i + 3] = 255;
    }
  return out;
}

export class WorldScene extends Phaser.Scene {
  private readonly host: WorldSceneHost;
  private geo: ZoneGeometry | null = null;
  private geoGen = 0;
  private chunks = new Map<string, Phaser.GameObjects.Image>();
  private overlay: Phaser.GameObjects.Container | null = null;
  private ground: Phaser.GameObjects.TileSprite | null = null;
  private actors = new Map<string, Actor>();
  private stops: (() => void)[] = [];
  private awake = 2;
  private zoom = 1;
  private ready = false;
  private readonly onResize = () => {
    this.fitZoom();
    this.invalidate();
  };

  constructor(host: WorldSceneHost) {
    super({ key: 'world' });
    this.host = host;
  }

  preload(): void {
    if (!atlas) this.load.image(TILESET, tilesetUrl);
  }

  /** Cut the loaded tileset image into tiles by kind (a failed load leaves procedural tiles). */
  private readAtlas(): void {
    if (atlas || !this.textures.exists(TILESET)) return;
    const img = this.textures.get(TILESET).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx || c.width === 0) return;
    ctx.drawImage(img, 0, 0);
    atlas = atlasFromImage(ctx.getImageData(0, 0, c.width, c.height).data, c.width, tileId);
  }

  create(): void {
    this.readAtlas();
    this.upload('ct-w-battle', battleMark());
    this.upload('ct-w-select', selectMark());
    this.upload('ct-w-shadow', shadowMark());
    this.upload('ct-w-hatch', hatchMark());
    const grass = paintTile('grass');
    const rgba = new Uint8ClampedArray(TILE * TILE * 4);
    grass.px.forEach((v, i) => {
      rgba[i * 4] = (v >> 16) & 255;
      rgba[i * 4 + 1] = (v >> 8) & 255;
      rgba[i * 4 + 2] = v & 255;
      rgba[i * 4 + 3] = 255;
    });
    this.addCanvas('ct-w-grass', canvasFrom(TILE, TILE, rgba));

    this.cameras.main.setRoundPixels(true);
    this.fitZoom();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize);
    this.game.events.on(Phaser.Core.Events.VISIBLE, this.onResize);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.host.onTile(Math.floor(p.worldX / TILE), Math.floor(p.worldY / TILE));
    });

    const c = this.host.controller;
    this.stops.push(
      effect(() => {
        const g = c.geometry.value;
        void c.zone.value;
        this.setGeometry(g);
      }),
      effect(() => {
        void c.me.value;
        void c.players.value;
        void c.npcs.value;
        void c.selected.value;
        this.invalidate();
      }),
    );
    const stop = () => {
      for (const s of this.stops) s();
      this.stops = [];
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize);
      this.game.events.off(Phaser.Core.Events.VISIBLE, this.onResize);
      this.ready = false;
    };
    this.events.once('shutdown', stop);
    this.events.once('destroy', stop);
    this.ready = true;
  }

  private addCanvas(key: string, canvas: HTMLCanvasElement): Phaser.Textures.Texture | null {
    if (this.textures.exists(key)) this.textures.remove(key);
    const tex = this.textures.create(key, canvas, canvas.width, canvas.height);
    tex?.add('__BASE', 0, 0, 0, canvas.width, canvas.height);
    return tex;
  }

  private upload(key: string, m: Mark): void {
    this.addCanvas(key, canvasFrom(m.grid.w, m.grid.h, markRgba(m)));
  }

  private sheet(look: TrainerLook): string {
    const key = `ct-w-tr-${lookKey(look)}`;
    if (this.textures.exists(key)) return key;
    const w = TRAINER_W * TRAINER_FRAMES.length;
    const tex = this.addCanvas(key, canvasFrom(w, TRAINER_H, trainerSheet(look)));
    TRAINER_FRAMES.forEach((_f, i) => tex?.add(i, 0, i * TRAINER_W, 0, TRAINER_W, TRAINER_H));
    return key;
  }

  /** Something visible changed: render at least `frames` more frames. */
  invalidate(frames = 2): void {
    this.awake = Math.max(this.awake, frames);
    const loop = this.game?.loop;
    if (loop && !loop.running) {
      loop.resetDelta();
      loop.wake();
    }
  }

  private fitZoom(): void {
    const cam = this.cameras.main;
    const z = worldZoom(this.scale.width, this.scale.height);
    cam.setSize(this.scale.width, this.scale.height);
    if (z === this.zoom && cam.zoom === z) return;
    this.zoom = z;
    cam.setZoom(z);
  }

  // ---- map -------------------------------------------------------------------------------------

  private setGeometry(g: ZoneGeometry | null): void {
    if (g === this.geo) return;
    this.geo = g;
    this.geoGen++;
    for (const [key, img] of this.chunks) {
      img.destroy();
      this.textures.remove(key);
    }
    this.chunks.clear();
    this.overlay?.destroy(true);
    this.overlay = null;
    if (g) {
      this.ground?.setVisible(false);
      const o = this.add.container(0, 0).setDepth(1);
      for (const r of g.challenge) {
        const hatch = this.add
          .tileSprite(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE, 'ct-w-hatch')
          .setOrigin(0)
          .setAlpha(0.35);
        const border = this.add.graphics();
        border.lineStyle(1, 0xd84848, 0.9);
        border.strokeRect(r.x * TILE + 0.5, r.y * TILE + 0.5, r.w * TILE - 1, r.h * TILE - 1);
        o.add([hatch, border]);
      }
      this.overlay = o;
    }
    this.invalidate();
  }

  /** Paint the chunks that the camera can see (plus one ring), drop far ones. */
  private ensureChunks(): void {
    const g = this.geo;
    if (!g) return;
    const view = this.cameras.main.worldView;
    const span = CHUNK * TILE;
    const cx0 = Math.max(0, Math.floor(view.x / span) - 1);
    const cy0 = Math.max(0, Math.floor(view.y / span) - 1);
    const cx1 = Math.min(Math.ceil(g.width / CHUNK) - 1, Math.floor((view.right - 1) / span) + 1);
    const cy1 = Math.min(Math.ceil(g.height / CHUNK) - 1, Math.floor((view.bottom - 1) / span) + 1);
    const want = new Set<string>();
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `ct-w-map-${this.geoGen}-${cx}-${cy}`;
        want.add(key);
        if (this.chunks.has(key)) continue;
        const w = Math.min(CHUNK, g.width - cx * CHUNK);
        const h = Math.min(CHUNK, g.height - cy * CHUNK);
        const rgba = paintChunk(g, cx * CHUNK, cy * CHUNK, w, h, atlas);
        this.addCanvas(key, canvasFrom(w * TILE, h * TILE, rgba));
        const img = this.add
          .image(cx * span, cy * span, key)
          .setOrigin(0)
          .setDepth(0);
        this.chunks.set(key, img);
      }
    for (const [key, img] of this.chunks) {
      if (want.has(key)) continue;
      img.destroy();
      this.textures.remove(key);
      this.chunks.delete(key);
    }
  }

  // ---- actors ----------------------------------------------------------------------------------

  private actor(
    id: string,
    look: TrainerLook,
    name: string,
    colour: string,
    italic: boolean,
  ): Actor {
    const sheet = this.sheet(look);
    let a = this.actors.get(id);
    if (a && a.sheet !== sheet) {
      a.body.setTexture(sheet, 0);
      a.sheet = sheet;
    }
    if (!a) {
      const tag = this.add
        .text(0, 0, name, {
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          fontSize: `${Math.round(TAG_PX * this.host.textScale())}px`,
          fontStyle: italic ? 'italic bold' : 'bold',
          color: colour,
          stroke: '#101018',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(100_000);
      a = {
        sheet,
        body: this.add.image(0, 0, sheet, 0).setOrigin(0.5, 1),
        shadow: this.add.image(0, 0, 'ct-w-shadow').setAlpha(0.3).setDepth(2),
        tag,
        mark: this.add.image(0, 0, 'ct-w-battle').setOrigin(0.5, 1).setDepth(100_001),
        select: this.add.image(0, 0, 'ct-w-select').setOrigin(0.5, 1).setDepth(3),
        seen: true,
      };
      this.actors.set(id, a);
    }
    if (a.tag.text !== name) a.tag.setText(name);
    a.seen = true;
    return a;
  }

  private place(
    a: Actor,
    m: { x: number; y: number; dir: Mover['dir'] },
    frame: 0 | 1,
    battling: boolean,
    selected: boolean,
  ): void {
    const x = Math.round(m.x * TILE + TILE / 2);
    const y = Math.round(m.y * TILE + TILE);
    a.body
      .setPosition(x, y)
      .setFrame(trainerFrameIndex(m.dir, frame))
      .setDepth(10 + m.y);
    a.shadow.setPosition(x, y - 1);
    a.select.setPosition(x, y + 1).setVisible(selected);
    a.mark.setPosition(x, y - TRAINER_H - 1).setVisible(battling);
    const tagY = y - TRAINER_H - (battling ? 12 : 1);
    a.tag.setPosition(x, tagY).setScale(1 / this.zoom);
  }

  private drawActors(now: number): boolean {
    const c = this.host.controller;
    let moving = false;
    for (const a of this.actors.values()) a.seen = false;
    const sel = c.selected.value;
    const frameOf = (m: Mover) => {
      const d = drawnPos(m, now);
      if (d.moving) moving = true;
      const t = (now - m.at) / STEP_MS;
      return { d, frame: (d.moving && t < 0.5 ? 1 : 0) as 0 | 1 };
    };
    for (const n of c.npcs.value) {
      const a = this.actor(`n:${n.id}`, this.host.npcLook(n.id), n.name, '#b8f0ff', true);
      this.place(a, n, 0, false, false);
    }
    for (const p of c.players.value.values()) {
      const a = this.actor(`p:${p.p}`, this.host.playerLook(p.p), p.name, '#ffffff', false);
      const { d, frame } = frameOf(p);
      this.place(a, { x: d.x, y: d.y, dir: p.dir }, frame, p.battling, sel === p.p);
    }
    const me = c.me.value;
    if (me) {
      const a = this.actor('me', this.host.playerLook(me.p), this.host.ownName(), '#ffe7a3', false);
      const { d, frame } = frameOf(me);
      this.place(a, { x: d.x, y: d.y, dir: me.dir }, frame, c.battling.value, false);
      this.follow(d.x, d.y);
    }
    for (const [id, a] of this.actors) {
      if (a.seen) continue;
      a.body.destroy();
      a.shadow.destroy();
      a.tag.destroy();
      a.mark.destroy();
      a.select.destroy();
      this.actors.delete(id);
    }
    return moving;
  }

  /** Centre the camera on the player, clamped to the map (a small map sits in the middle). */
  private follow(tx: number, ty: number): void {
    const cam = this.cameras.main;
    const viewW = cam.width / cam.zoom;
    const viewH = cam.height / cam.zoom;
    const g = this.geo;
    let cx = tx * TILE + TILE / 2;
    let cy = ty * TILE + TILE / 2;
    if (g) {
      const mw = g.width * TILE;
      const mh = g.height * TILE;
      cx = mw <= viewW ? mw / 2 : Math.min(Math.max(cx, viewW / 2), mw - viewW / 2);
      cy = mh <= viewH ? mh / 2 : Math.min(Math.max(cy, viewH / 2), mh - viewH / 2);
    }
    cam.centerOn(Math.round(cx), Math.round(cy));
  }

  /** Plain grass under everything when the client has no map for the zone. */
  private drawGround(): void {
    if (this.geo) return;
    const view = this.cameras.main.worldView;
    if (!this.ground)
      this.ground = this.add.tileSprite(0, 0, 16, 16, 'ct-w-grass').setOrigin(0).setDepth(-1);
    const x = Math.floor(view.x / TILE) * TILE - TILE;
    const y = Math.floor(view.y / TILE) * TILE - TILE;
    this.ground
      .setVisible(true)
      .setPosition(x, y)
      .setSize(view.width + 3 * TILE, view.height + 3 * TILE);
  }

  override update(): void {
    if (!this.ready) return;
    const moving = this.drawActors(performance.now());
    this.drawGround();
    this.ensureChunks();
    // This frame still renders; the loop then sleeps until the next visible change.
    if (moving) this.awake = 2;
    else if (--this.awake <= 0) this.game.loop.sleep();
  }
}
