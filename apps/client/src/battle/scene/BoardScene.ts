/**
 * Phaser board scene (M3 step 3.1). Renders only projected state (R-INFO-005): a BattleSnapshot's
 * `pub`, or any PublicState passed to `showPublic` (step-through replay, Scenario Lab). The host
 * (BattleView) owns interaction logic and calls the public methods below; the scene reports square
 * clicks and hovers.
 *
 * Readability (R-ART-002, INVARIANT) — every cue has a shape partner, never colour alone:
 * - Role: creature silhouette per piece type plus a pixel chess glyph badge in the square corner.
 * - Owner: your pieces show back sprites, the opponent's front sprites, on a base ring in the
 *   owner's colour (the glyph badge is drawn in the owner's colour too).
 * - Element: element icon (distinct shape per element) on the ring, plus the palette tint.
 * - Revealed abilities: pips on the ring (filled = known to the opponent, dotted = still hidden,
 *   square = veiled).
 * - Burning square: flame overlay with a flame + number counter of opponent turns left; a hollow
 *   flame marks a pending burn (Hot Foot, R-ELEM-005).
 * - Check: the king's square pulses with a thick border and a "!" badge, for both king kinds.
 * - Classic View swaps creatures for standard chess glyphs and keeps the element icon and pips.
 *
 * Animations (11.2): `animate(update)` queues one committed action and plays its events in order
 * (moves, effect moves, captures with a faint frame then fade, revivals, promotions, ignite and
 * extinguish, a shared burst per triggered ability). Durations come from host.animationMs(); fast
 * mode resolves any chain in under 1 s and 0 ms (reduced motion) skips animation entirely.
 */
import Phaser from 'phaser';
import type { PublicPiece, PublicState, Side } from '@chain-theorem/rules';
import type { BattleSnapshot, BattleUpdate } from '../controller.ts';
import {
  ART_SCALE,
  artStats,
  badgeFrame,
  BOARD_KEY,
  creatureFrameName,
  creatureScale,
  ELEMENT_COLORS,
  ensureClassicTexture,
  ensureCreatureTexture,
  ensureUiTextures,
  fontFrame,
  iconFrame,
  pipFrame,
  ringFrame,
  TILE,
  UI,
  type ArtStats,
  type FontInk,
} from './art.ts';
import { BOARD } from './palette.ts';
import { pipKinds } from './icons.ts';
import { planAnimation, type AnimStep } from './timeline.ts';

export interface Highlights {
  selected: number | null;
  targets: number[];
  captures: number[];
  lastMove: [number, number] | null;
  attacked: number[];
}

export interface BoardSceneHost {
  onSquare(square: number): void;
  classicView(): boolean;
  /** Base animation duration in ms; 0 = reduced motion (no animation, no idle motion). */
  animationMs(): number;
  /** Pointer moved onto a square (or off the board: null), for hover previews. */
  onHover?(square: number | null): void;
  /** Fast mode: caps any reaction chain at FAST_CHAIN_MS. Default: animationMs() <= 100. */
  fastMode?(): boolean;
  /** Text scale (11.2) for canvas labels such as coordinates and burn counters. Default 1. */
  textScale?(): number;
}

interface PieceView {
  id: number;
  side: Side;
  root: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Image;
  /** Creature facing, or null in Classic View. */
  facing: 'front' | 'back' | null;
  fainted: boolean;
}

interface BurnView {
  root: Phaser.GameObjects.Container;
  flame: Phaser.GameObjects.Image;
}

interface Track {
  start: number;
  dur: number;
  begin?: () => void;
  apply?: (t: number) => void;
  end?: () => void;
  begun?: boolean;
  done?: boolean;
}

interface Run {
  tracks: Track[];
  total: number;
  elapsed: number;
  resolve: () => void;
}

interface HotFootView {
  burning?: { sq: number; turns: number }[];
  pending?: { piece: number; sq: number }[];
}

/** Piece layout inside a square (game pixels relative to the square centre). */
const RING_Y = 20;
const BODY_BOTTOM = 24;
const ICON_X = 19;
const ICON_Y = 20;
const PIP_X0 = -16;
const PIP_DX = 9;
const PIP_Y = 27;
const MAX_PIPS = 4;
const IDLE_MS = 520;

const EMPTY_HIGHLIGHTS: Highlights = {
  selected: null,
  targets: [],
  captures: [],
  lastMove: null,
  attacked: [],
};

export class BoardScene extends Phaser.Scene {
  private host: BoardSceneHost | null = null;
  private snapshot: BattleSnapshot | null = null;
  /** State pinned by showPublic (replay / lab); live snapshots wait until showLive(). */
  private pinned: { pub: PublicState; viewer: Side } | null = null;
  private shown: { pub: PublicState; viewer: Side; classic: boolean } | null = null;
  private highlights: Highlights = EMPTY_HIGHLIGHTS;
  private flip = false;
  private coordScale = 0;
  private ready = false;
  private hoverSq: number | null = null;

  private coords: Phaser.GameObjects.Container | null = null;
  private under: Phaser.GameObjects.Graphics | null = null;
  private burnLayer: Phaser.GameObjects.Container | null = null;
  private checkLayer: Phaser.GameObjects.Container | null = null;
  private pieceLayer: Phaser.GameObjects.Container | null = null;
  private over: Phaser.GameObjects.Graphics | null = null;
  private fxLayer: Phaser.GameObjects.Container | null = null;
  private hoverG: Phaser.GameObjects.Graphics | null = null;
  private pieces = new Map<number, PieceView>();
  private burns = new Map<number, BurnView>();
  private checkPulse: Phaser.GameObjects.Graphics | null = null;

  private queue: Promise<void> = Promise.resolve();
  /** Updates queued or playing; live snapshots are drawn once this drops to 0. */
  private pending = 0;
  private run: Run | null = null;
  private skipGen = 0;
  private idlePhase: 0 | 1 = 0;
  private clock = 0;

  constructor() {
    super({ key: 'board' });
  }

  bind(host: BoardSceneHost): void {
    this.host = host;
  }

  create(): void {
    ensureUiTextures(this);
    this.add.image(0, 0, BOARD_KEY).setOrigin(0).setScale(ART_SCALE).setDepth(0);
    this.coords = this.add.container(0, 0).setDepth(1);
    this.under = this.add.graphics().setDepth(2);
    this.burnLayer = this.add.container(0, 0).setDepth(3);
    this.checkLayer = this.add.container(0, 0).setDepth(4);
    this.pieceLayer = this.add.container(0, 0).setDepth(5);
    this.over = this.add.graphics().setDepth(6);
    this.fxLayer = this.add.container(0, 0).setDepth(7);
    this.hoverG = this.add.graphics().setDepth(8);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const sq = this.pointerSquare(p);
      if (sq !== null) this.host?.onSquare(sq);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.setHover(this.pointerSquare(p)));
    this.input.on('gameout', () => this.setHover(null));
    this.time.addEvent({ delay: IDLE_MS, loop: true, callback: () => this.idleTick() });
    const stop = () => {
      this.ready = false;
      const r = this.run;
      this.run = null;
      r?.resolve();
    };
    this.events.once('shutdown', stop);
    this.events.once('destroy', stop);
    this.ready = true;
    this.drawCoords();
    this.refresh();
  }

  override update(_time: number, delta: number): void {
    this.clock += delta;
    if (this.run) this.step(delta);
    if (this.checkPulse) {
      this.checkPulse.setAlpha(this.motion() ? 0.6 + 0.4 * Math.sin(this.clock / 170) : 1);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Public API.
  // -------------------------------------------------------------------------------------------

  squareXY(sq: number): { x: number; y: number } {
    const f = sq & 7;
    const r = sq >> 3;
    const col = this.flip ? 7 - f : f;
    const row = this.flip ? r : 7 - r;
    return { x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 };
  }

  /** Live battle state. Drawn now unless an animation is queued or a pinned view is showing. */
  setSnapshot(s: BattleSnapshot): void {
    this.snapshot = s;
    if (this.pending === 0 && !this.pinned) this.refresh();
  }

  setHighlights(h: Highlights): void {
    this.highlights = h;
    if (this.ready) this.drawOverlay();
  }

  /**
   * Render an arbitrary projected state (step-through replay, Scenario Lab) and pin it: live
   * snapshots are stored but not drawn until showLive(). A queued animation is skipped first.
   * animate() continues a pinned view when its update starts from the pinned state.
   */
  showPublic(pub: PublicState, viewer: Side): void {
    this.skipAnimations();
    this.pinned = { pub, viewer };
    this.refresh();
  }

  /** Leave a pinned view and show the latest live snapshot again. */
  showLive(): void {
    this.pinned = null;
    this.refresh();
  }

  /** Finish every running and queued animation immediately (animations are skippable, 11.2). */
  skipAnimations(): void {
    this.skipGen++;
    if (this.run) this.step(Number.POSITIVE_INFINITY);
  }

  isAnimating(): boolean {
    return this.pending > 0;
  }

  /** Texture generation timings (12.3 budgets). */
  artStats(): ArtStats {
    return { ...artStats };
  }

  /**
   * Queue one committed action's animation; resolves when it has played (or was skipped). Events
   * play in order; fast mode keeps a whole chain under 1 s; animationMs() 0 skips it.
   */
  animate(u: BattleUpdate): Promise<void> {
    this.pending++;
    const gen = this.skipGen;
    const job = this.queue.then(() => this.play(u, gen));
    this.queue = job.catch(() => undefined);
    return job;
  }

  // -------------------------------------------------------------------------------------------
  // Drawing.
  // -------------------------------------------------------------------------------------------

  private classic(): boolean {
    return this.host?.classicView() ?? false;
  }

  private motion(): boolean {
    return (this.host?.animationMs() ?? 0) > 0;
  }

  private fontScale(): number {
    return (this.host?.textScale?.() ?? 1) >= 1.25 ? 3 : 2;
  }

  /** Draw what should be visible now: the pinned view, else the latest live snapshot. */
  private refresh(): void {
    if (!this.ready) return;
    const target =
      this.pinned ??
      (this.snapshot ? { pub: this.snapshot.pub, viewer: this.snapshot.viewer } : null);
    if (!target) return;
    const classic = this.classic();
    const s = this.shown;
    if (s && s.pub === target.pub && s.viewer === target.viewer && s.classic === classic) {
      this.drawOverlay();
      return;
    }
    this.draw(target.pub, target.viewer);
  }

  private draw(pub: PublicState, viewer: Side): void {
    if (!this.ready || !this.pieceLayer || !this.burnLayer) return;
    const classic = this.classic();
    this.shown = { pub, viewer, classic };
    const flip = viewer === 'black';
    if (flip !== this.flip || this.coordScale !== this.fontScale()) {
      this.flip = flip;
      this.drawCoords();
    }
    this.pieceLayer.removeAll(true);
    this.pieces.clear();
    this.burnLayer.removeAll(true);
    this.burns.clear();
    this.fxLayer?.removeAll(true);
    const hf = pub.slices.hot_foot as HotFootView | undefined;
    for (const b of hf?.burning ?? []) this.addBurn(b.sq, b.turns);
    for (const p of hf?.pending ?? []) {
      if (hf?.burning?.some((b) => b.sq === p.sq)) continue;
      const { x, y } = this.squareXY(p.sq);
      this.burnLayer.add(
        this.add.image(x + TILE / 2 - 10, y - TILE / 2 + 11, UI, 'smoulder').setScale(ART_SCALE),
      );
    }
    const onBoard = pub.pieces.filter((p) => p.square >= 0);
    onBoard.sort((a, b) => this.squareXY(a.square).y - this.squareXY(b.square).y);
    for (const p of onBoard) this.addPiece(p, pub, viewer, classic);
    this.drawCheck(pub);
    this.drawOverlay();
    this.idleTick(true);
    // Texture timings for budget checks (12.3); read by e2e measurement scripts.
    this.game.canvas.dataset.artStats = JSON.stringify(artStats);
  }

  private addPiece(p: PublicPiece, pub: PublicState, viewer: Side, classic: boolean): PieceView {
    const layer = this.pieceLayer;
    const { x, y } = this.squareXY(Math.max(0, p.square));
    const root = this.add.container(x, y);
    let body: Phaser.GameObjects.Image;
    let facing: PieceView['facing'] = null;
    if (classic) {
      body = this.add.image(0, 0, ensureClassicTexture(this, p.type, p.side));
      root.add(body);
      root.add(
        this.add.image(ICON_X + 2, ICON_Y + 1, UI, iconFrame(p.element)).setScale(ART_SCALE),
      );
    } else {
      facing = p.side === viewer ? 'back' : 'front';
      root.add(this.add.image(0, RING_Y, UI, ringFrame(p.side, p.element)).setScale(ART_SCALE));
      const key = ensureCreatureTexture(this, p.type, p.element);
      body = this.add
        .image(0, BODY_BOTTOM, key, creatureFrameName(facing, 'idle0'))
        .setOrigin(0.5, 1)
        .setScale(creatureScale(p.type, p.element));
      root.add(body);
      root.add(this.add.image(ICON_X, ICON_Y, UI, iconFrame(p.element)).setScale(ART_SCALE));
      root.add(
        this.add
          .image(-TILE / 2 + 1, -TILE / 2 + 1, UI, badgeFrame(p.type, p.side))
          .setOrigin(0)
          .setScale(ART_SCALE),
      );
    }
    const pips = pipKinds(pub, p, viewer);
    pips.slice(0, MAX_PIPS).forEach((kind, i) => {
      root.add(this.add.image(PIP_X0 + i * PIP_DX, PIP_Y, UI, pipFrame(kind)).setScale(ART_SCALE));
    });
    layer?.add(root);
    const view: PieceView = { id: p.id, side: p.side, root, body, facing, fainted: false };
    this.pieces.set(p.id, view);
    return view;
  }

  private addBurn(sq: number, turns: number): BurnView | null {
    const layer = this.burnLayer;
    if (!layer) return null;
    const { x, y } = this.squareXY(sq);
    const root = this.add.container(x, y);
    const glow = this.add.graphics();
    glow.fillStyle(0xf05020, 0.22);
    glow.fillRect(-TILE / 2, -TILE / 2, TILE, TILE);
    const flame = this.add
      .image(0, TILE / 2, UI, 'flame-0')
      .setOrigin(0.5, 1)
      .setScale(ART_SCALE)
      .setAlpha(0.92);
    root.add([glow, flame, this.counter(turns)]);
    layer.add(root);
    const view = { root, flame };
    this.burns.set(sq, view);
    return view;
  }

  /** Flame + number badge in the square's top-right corner: opponent turns left. */
  private counter(turns: number): Phaser.GameObjects.Container {
    const fs = this.fontScale();
    const digits = String(Math.max(0, turns));
    const w = 7 * ART_SCALE + digits.length * 4 * fs + 4;
    const h = Math.max(9 * ART_SCALE, 5 * fs + 4);
    const c = this.add.container(TILE / 2 - 2 - w, -TILE / 2 + 2);
    const box = this.add.graphics();
    box.fillStyle(0x181420, 0.92);
    box.fillRoundedRect(0, 0, w, h, 3);
    box.lineStyle(1, 0xf8c830, 1);
    box.strokeRoundedRect(0.5, 0.5, w - 1, h - 1, 3);
    c.add(box);
    c.add(
      this.add
        .image(1, (h - 9 * ART_SCALE) / 2, UI, 'flame-small')
        .setOrigin(0)
        .setScale(ART_SCALE),
    );
    this.pixelText(c, digits, 'white', 7 * ART_SCALE + 2, (h - 5 * fs) / 2, fs);
    return c;
  }

  private pixelText(
    into: Phaser.GameObjects.Container,
    text: string,
    ink: FontInk,
    x: number,
    y: number,
    scale: number,
  ): void {
    [...text].forEach((ch, i) => {
      into.add(
        this.add
          .image(x + i * 4 * scale, y, UI, fontFrame(ink, ch))
          .setOrigin(0)
          .setScale(scale),
      );
    });
  }

  /** Rank digits on the left edge, file letters in the bottom-left corner of the bottom row. */
  private drawCoords(): void {
    const layer = this.coords;
    if (!layer) return;
    layer.removeAll(true);
    const fs = this.fontScale();
    this.coordScale = fs;
    for (let i = 0; i < 8; i++) {
      const rankSq = this.flip ? i * 8 + 7 : i * 8;
      const rs = this.squareXY(rankSq);
      const rankInk: FontInk = ((rankSq & 7) + (rankSq >> 3)) % 2 === 1 ? 'dark' : 'light';
      this.pixelText(layer, String(i + 1), rankInk, rs.x - TILE / 2 + 2, rs.y - (5 * fs) / 2, fs);
      const fileSq = this.flip ? 56 + i : i;
      const fsq = this.squareXY(fileSq);
      const fileInk: FontInk = ((fileSq & 7) + (fileSq >> 3)) % 2 === 1 ? 'dark' : 'light';
      this.pixelText(
        layer,
        'abcdefgh'[i] ?? 'a',
        fileInk,
        fsq.x - TILE / 2 + 2,
        fsq.y + TILE / 2 - 5 * fs - 2,
        fs,
      );
    }
  }

  private drawCheck(pub: PublicState): void {
    const layer = this.checkLayer;
    if (!layer) return;
    layer.removeAll(true);
    this.checkPulse = null;
    if (!pub.inCheck) return;
    // Both king kinds (ordinary and Stalwart) are type 'king' in the projection.
    const king = pub.pieces.find(
      (p) => p.side === pub.inCheck && p.type === 'king' && p.square >= 0,
    );
    if (!king) return;
    const { x, y } = this.squareXY(king.square);
    const g = this.add.graphics();
    g.fillStyle(BOARD.check, 0.32);
    g.fillRect(x - TILE / 2, y - TILE / 2, TILE, TILE);
    g.lineStyle(4, BOARD.check, 1);
    g.strokeRect(x - TILE / 2 + 2, y - TILE / 2 + 2, TILE - 4, TILE - 4);
    const burning = this.burns.has(king.square);
    const badge = this.add
      .image(x + TILE / 2 - 11, burning ? y + 4 : y - TILE / 2 + 11, UI, 'check')
      .setScale(ART_SCALE);
    layer.add([g, badge]);
    this.checkPulse = g;
  }

  private drawOverlay(): void {
    const under = this.under;
    const over = this.over;
    if (!under || !over) return;
    under.clear();
    over.clear();
    const h = this.highlights;
    const corner = (sq: number) => {
      const { x, y } = this.squareXY(sq);
      return { x: x - TILE / 2, y: y - TILE / 2 };
    };
    if (h.lastMove) {
      for (const sq of h.lastMove) {
        const c = corner(sq);
        under.fillStyle(BOARD.lastMove, 0.38);
        under.fillRect(c.x, c.y, TILE, TILE);
        under.lineStyle(2, 0xb08818, 0.8);
        under.strokeRect(c.x + 3, c.y + 3, TILE - 6, TILE - 6);
      }
    }
    for (const sq of h.attacked) {
      const c = corner(sq);
      under.fillStyle(BOARD.attacked, 0.16);
      under.fillRect(c.x, c.y, TILE, TILE);
      // Hatching: the shape partner of the red tint.
      under.lineStyle(2, BOARD.attacked, 0.45);
      for (let k = 16; k < TILE * 2; k += 16) {
        under.lineBetween(
          c.x + Math.max(0, k - TILE),
          c.y + Math.min(TILE, k),
          c.x + Math.min(TILE, k),
          c.y + Math.max(0, k - TILE),
        );
      }
    }
    if (h.selected !== null) {
      const c = corner(h.selected);
      under.fillStyle(BOARD.selected, 0.42);
      under.fillRect(c.x, c.y, TILE, TILE);
      // Corner brackets.
      over.lineStyle(4, 0x1878a0, 1);
      const L = 14;
      for (const [sx, sy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const) {
        const px = c.x + 2 + sx * (TILE - 4);
        const py = c.y + 2 + sy * (TILE - 4);
        const dx = sx ? -L : L;
        const dy = sy ? -L : L;
        over.lineBetween(px, py, px + dx, py);
        over.lineBetween(px, py, px, py + dy);
      }
    }
    for (const sq of h.targets) {
      if (h.captures.includes(sq)) continue;
      const { x, y } = this.squareXY(sq);
      over.fillStyle(BOARD.target, 0.5);
      over.fillCircle(x, y, TILE / 8);
      over.lineStyle(2, 0xf8f0d8, 0.7);
      over.strokeCircle(x, y, TILE / 8);
    }
    for (const sq of h.captures) {
      // Capture targets: four corner triangles (a different shape from move dots).
      const c = corner(sq);
      over.fillStyle(BOARD.target, 0.6);
      const T = 16;
      over.fillTriangle(c.x, c.y, c.x + T, c.y, c.x, c.y + T);
      over.fillTriangle(c.x + TILE, c.y, c.x + TILE - T, c.y, c.x + TILE, c.y + T);
      over.fillTriangle(c.x, c.y + TILE, c.x + T, c.y + TILE, c.x, c.y + TILE - T);
      over.fillTriangle(
        c.x + TILE,
        c.y + TILE,
        c.x + TILE - T,
        c.y + TILE,
        c.x + TILE,
        c.y + TILE - T,
      );
    }
    this.drawHover();
  }

  private drawHover(): void {
    const g = this.hoverG;
    if (!g) return;
    g.clear();
    if (this.hoverSq === null) return;
    const { x, y } = this.squareXY(this.hoverSq);
    g.lineStyle(2, BOARD.hover, 0.85);
    g.strokeRect(x - TILE / 2 + 1, y - TILE / 2 + 1, TILE - 2, TILE - 2);
  }

  private pointerSquare(p: Phaser.Input.Pointer): number | null {
    const file = Math.floor(p.x / TILE);
    const rankFromTop = Math.floor(p.y / TILE);
    if (file < 0 || file > 7 || rankFromTop < 0 || rankFromTop > 7) return null;
    const f = this.flip ? 7 - file : file;
    const r = this.flip ? rankFromTop : 7 - rankFromTop;
    return r * 8 + f;
  }

  private setHover(sq: number | null): void {
    if (sq === this.hoverSq) return;
    this.hoverSq = sq;
    this.drawHover();
    this.host?.onHover?.(sq);
  }

  /** 2-frame idle for creatures and flame flicker; frozen when motion is reduced. */
  private idleTick(redrawOnly = false): void {
    const moving = this.motion();
    if (!redrawOnly) this.idlePhase = moving ? (this.idlePhase === 0 ? 1 : 0) : 0;
    for (const v of this.pieces.values()) {
      if (!v.facing || v.fainted) continue;
      const phase = moving ? (v.id % 2) ^ this.idlePhase : 0;
      v.body.setFrame(creatureFrameName(v.facing, phase ? 'idle1' : 'idle0'), false, false);
    }
    for (const b of this.burns.values())
      b.flame.setFrame(moving && this.idlePhase ? 'flame-1' : 'flame-0', false, false);
  }

  // -------------------------------------------------------------------------------------------
  // Animation.
  // -------------------------------------------------------------------------------------------

  private async play(u: BattleUpdate, gen: number): Promise<void> {
    try {
      const ms = this.host?.animationMs() ?? 0;
      // A live update while a replay view is pinned does not disturb it; a replay step (starting
      // from the pinned state) animates and then pins its result.
      const pin = this.pinned;
      const continuesPin = pin !== null && pin.pub.eventSeq === u.before.eventSeq;
      if (pin && !continuesPin) return;
      const hidden = typeof document !== 'undefined' && document.hidden;
      if (this.ready && ms > 0 && !hidden && gen === this.skipGen) {
        const plan = planAnimation(u.before, u.events, ms, this.host?.fastMode?.());
        if (plan.steps.length > 0) {
          const s = this.shown;
          if (
            !s ||
            s.pub.eventSeq !== u.before.eventSeq ||
            s.viewer !== u.before.viewer ||
            s.classic !== this.classic()
          ) {
            this.draw(u.before, u.before.viewer);
          }
          await this.runTracks(
            plan.steps.map((st) => this.track(st)),
            plan.total,
          );
        }
      }
      if (continuesPin) this.pinned = { pub: u.after, viewer: u.after.viewer };
    } finally {
      this.pending--;
      if (this.pending === 0 || this.pinned) this.refresh();
    }
  }

  private runTracks(tracks: Track[], total: number): Promise<void> {
    return new Promise((resolve) => {
      this.run = { tracks, total, elapsed: 0, resolve };
      this.step(0);
    });
  }

  private step(dt: number): void {
    const r = this.run;
    if (!r) return;
    r.elapsed += dt;
    for (const tr of r.tracks) {
      if (tr.done || r.elapsed < tr.start) continue;
      if (!tr.begun) {
        tr.begun = true;
        tr.begin?.();
      }
      const t = tr.dur <= 0 ? 1 : Math.min(1, (r.elapsed - tr.start) / tr.dur);
      tr.apply?.(t);
      if (t >= 1) {
        tr.done = true;
        tr.end?.();
      }
    }
    if (r.elapsed >= r.total && r.tracks.every((t) => t.done)) {
      this.run = null;
      this.fxLayer?.removeAll(true);
      r.resolve();
    }
  }

  private track(st: AnimStep): Track {
    const base = { start: st.start, dur: st.dur };
    switch (st.k) {
      case 'move': {
        const a = this.squareXY(st.from);
        const b = this.squareXY(st.to);
        return {
          ...base,
          begin: () => {
            const v = this.pieces.get(st.piece);
            if (v) this.pieceLayer?.bringToTop(v.root);
          },
          apply: (t) => {
            const v = this.pieces.get(st.piece);
            if (!v) return;
            const e = easeInOut(t);
            v.root.setPosition(
              a.x + (b.x - a.x) * e,
              a.y + (b.y - a.y) * e - Math.sin(Math.PI * t) * st.hop,
            );
          },
        };
      }
      case 'faint':
        return {
          ...base,
          begin: () => {
            const v = this.pieces.get(st.piece);
            if (!v) return;
            v.fainted = true;
            if (v.facing) v.body.setFrame(creatureFrameName(v.facing, 'faint'), false, false);
            this.pieceLayer?.bringToTop(v.root);
          },
          apply: (t) => {
            const v = this.pieces.get(st.piece);
            if (!v) return;
            // Hold the faint frame, then fade and sink (Classic View: fade and shrink).
            const f = t < 0.45 ? 0 : (t - 0.45) / 0.55;
            v.root.setAlpha(1 - f);
            if (v.facing) v.body.y = BODY_BOTTOM + f * 6;
            else v.body.setScale(1 - 0.4 * f);
          },
          end: () => {
            const v = this.pieces.get(st.piece);
            if (!v) return;
            v.root.destroy();
            this.pieces.delete(st.piece);
          },
        };
      case 'revive': {
        const fx = this.burstFx(st.square, 0xf8c830);
        return {
          ...base,
          begin: () => {
            fx.begin();
            this.pieces.get(st.piece)?.root.destroy();
            const pub = this.shown?.pub;
            const viewer = this.shown?.viewer ?? 'white';
            const p: PublicPiece = {
              id: st.piece,
              side: st.side,
              type: st.type,
              element: st.element,
              square: st.square,
              start: st.square,
              capturedSeq: -1,
            };
            const v = pub ? this.addPiece(p, pub, viewer, this.classic()) : null;
            v?.root.setAlpha(0).setScale(0.4);
          },
          apply: (t) => {
            fx.apply(t);
            this.pieces
              .get(st.piece)
              ?.root.setAlpha(t)
              .setScale(0.4 + 0.6 * easeOut(t));
          },
          end: fx.end,
        };
      }
      case 'promote': {
        let fx: ReturnType<BoardScene['burstFx']> | null = null;
        return {
          ...base,
          begin: () => {
            const v = this.pieces.get(st.piece);
            if (!v) return;
            if (v.facing) {
              const key = ensureCreatureTexture(this, st.type, st.element);
              v.body.setTexture(key, creatureFrameName(v.facing, 'idle0'));
              v.body.setScale(creatureScale(st.type, st.element));
            } else {
              v.body.setTexture(ensureClassicTexture(this, st.type, v.side));
            }
            fx = this.burstFx(this.squareOf(v), ELEMENT_COLORS[st.element]);
            fx.begin();
          },
          apply: (t) => {
            fx?.apply(t);
            this.pieces.get(st.piece)?.root.setScale(1 + 0.25 * Math.sin(Math.PI * t));
          },
          end: () => fx?.end(),
        };
      }
      case 'ignite': {
        let view: BurnView | null = null;
        return {
          ...base,
          begin: () => {
            this.burns.get(st.square)?.root.destroy();
            view = this.addBurn(st.square, st.turns);
            view?.root.setAlpha(0);
          },
          apply: (t) => {
            view?.root.setAlpha(t);
            view?.flame.setScale(ART_SCALE, ART_SCALE * (0.3 + 0.7 * easeOut(t)));
          },
        };
      }
      case 'extinguish':
        return {
          ...base,
          apply: (t) => this.burns.get(st.square)?.root.setAlpha(1 - t),
          end: () => {
            this.burns.get(st.square)?.root.destroy();
            this.burns.delete(st.square);
          },
        };
      case 'burst': {
        const fx = this.burstFx(st.square, ELEMENT_COLORS[st.element]);
        return { ...base, ...fx };
      }
      case 'fizzle': {
        let img: Phaser.GameObjects.Image | null = null;
        return {
          ...base,
          begin: () => {
            const { x, y } = this.squareXY(st.square);
            img = this.add.image(x + 12, y - 14, UI, 'fizzle').setScale(ART_SCALE);
            this.fxLayer?.add(img);
          },
          apply: (t) => img?.setAlpha(1 - t * t).setY(this.squareXY(st.square).y - 14 - t * 8),
          end: () => img?.destroy(),
        };
      }
      case 'check': {
        let g: Phaser.GameObjects.Graphics | null = null;
        return {
          ...base,
          begin: () => {
            const { x, y } = this.squareXY(st.square);
            g = this.add.graphics();
            g.lineStyle(6, BOARD.check, 1);
            g.strokeRect(x - TILE / 2 + 3, y - TILE / 2 + 3, TILE - 6, TILE - 6);
            this.fxLayer?.add(g);
          },
          apply: (t) => g?.setAlpha(Math.sin(Math.PI * t)),
          end: () => g?.destroy(),
        };
      }
    }
  }

  private squareOf(v: PieceView): number {
    const file = Math.floor(v.root.x / TILE);
    const rankFromTop = Math.floor(v.root.y / TILE);
    const f = this.flip ? 7 - file : file;
    const r = this.flip ? rankFromTop : 7 - rankFromTop;
    return r * 8 + f;
  }

  /** The shared ability VFX: an eight-point burst tinted by element, expanding and fading. */
  private burstFx(
    sq: number,
    color: number,
  ): { begin: () => void; apply: (t: number) => void; end: () => void } {
    let img: Phaser.GameObjects.Image | null = null;
    return {
      begin: () => {
        const { x, y } = this.squareXY(sq);
        img = this.add
          .image(x, y - 6, UI, 'burst')
          .setScale(ART_SCALE * 0.6)
          .setTint(color);
        this.fxLayer?.add(img);
      },
      apply: (t) => img?.setScale(ART_SCALE * (0.6 + 1.2 * easeOut(t))).setAlpha(1 - t),
      end: () => {
        img?.destroy();
        img = null;
      },
    };
  }
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
