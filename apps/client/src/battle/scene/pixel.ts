/**
 * Tiny pixel-art toolkit for procedural sprites (R-ART-001). A PixelGrid holds material indices
 * (not colours); palettes map materials to GBA-style 15-bit colours at blit time, so one shape
 * serves every element and the faint frame. No Phaser and no DOM at import time: usable from
 * Phaser textures, the Scenario Lab, a sprite-sheet exporter and Node unit tests.
 */

/** Material indices. SHADE/LIGHT variants are computed by `shade()`; OUT by `outline()`. */
export const M = {
  EMPTY: 0,
  OUT: 1,
  SHADE: 2,
  BASE: 3,
  LIGHT: 4,
  ACC_SH: 5,
  ACC: 6,
  ACC_LT: 7,
  EYE: 8,
  WHITE: 9,
  BELLY: 10,
  BLUSH: 11,
  GOLD: 12,
  GOLD_SH: 13,
  MOTIF: 14,
  MOTIF2: 15,
} as const;
export type Material = (typeof M)[keyof typeof M];

/** 16 entries (index 0 = transparent), each 0xRRGGBB. One GBA-style 16-colour sprite palette. */
export type Palette = readonly number[];

/** Snap a colour to the GBA's 15-bit space (5 bits per channel), expanded back to 8 bits. */
export function gba(rgb: number): number {
  const ch = (v: number) => {
    const five = Math.min(31, Math.round(v / 8.225));
    return (five << 3) | (five >> 2);
  };
  return (ch((rgb >> 16) & 255) << 16) | (ch((rgb >> 8) & 255) << 8) | ch(rgb & 255);
}

export function mix(a: number, b: number, t: number): number {
  const c = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t) & 255;
  return (c(16) << 16) | (c(8) << 8) | c(0);
}

/** Desaturate and dim a colour (faint frames). */
export function faded(rgb: number): number {
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  const y = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  return gba(mix(rgb, (y << 16) | (y << 8) | y, 0.65) & 0xffffff);
}

export function css(rgb: number): string {
  return `#${rgb.toString(16).padStart(6, '0')}`;
}

export class PixelGrid {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h);
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return M.EMPTY;
    return this.px[y * this.w + x] ?? M.EMPTY;
  }

  set(x: number, y: number, m: number): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    this.px[yi * this.w + xi] = m;
  }

  rect(x: number, y: number, w: number, h: number, m: number): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, m);
    return this;
  }

  /** Filled ellipse; a pixel is inside when its centre is. Optional rotation in radians. */
  ellipse(cx: number, cy: number, rx: number, ry: number, m: number, angle = 0): this {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const r = Math.ceil(Math.max(rx, ry)) + 1;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const u = (dx * cos + dy * sin) / rx;
        const v = (-dx * sin + dy * cos) / ry;
        if (u * u + v * v <= 1) this.set(x, y, m);
      }
    }
    return this;
  }

  /** Filled polygon (pixel centres, even-odd rule). */
  poly(points: readonly (readonly [number, number])[], m: number): this {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (!a || !b) continue;
        const [x0, y0] = a;
        const [x1, y1] = b;
        if (y0 <= sy !== y1 <= sy) xs.push(x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = xs[k] ?? 0;
        const to = xs[k + 1] ?? 0;
        for (let x = Math.ceil(from - 0.5); x + 0.5 <= to; x++) this.set(x, y, m);
      }
    }
    return this;
  }

  /** Bresenham line, optionally `width` pixels thick (square brush). */
  line(x0: number, y0: number, x1: number, y1: number, m: number, width = 1): this {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const xe = Math.round(x1);
    const ye = Math.round(y1);
    const dx = Math.abs(xe - x);
    const dy = -Math.abs(ye - y);
    const sx = x < xe ? 1 : -1;
    const sy = y < ye ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.rect(x, y, width, width, m);
      if (x === xe && y === ye) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
    return this;
  }

  /**
   * Stamp a character map with its top-left at (x, y). '.' and ' ' are skipped; other characters
   * map through `key`. `flip` mirrors the stamp horizontally.
   */
  stamp(
    x: number,
    y: number,
    rows: readonly string[],
    key: Record<string, number>,
    flip = false,
  ): this {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const ch = row[flip ? row.length - 1 - i : i] ?? '.';
        const m = key[ch];
        if (m !== undefined) this.set(x + i, y + j, m);
      }
    });
    return this;
  }

  /** Replace material `from` with `to` inside a rectangle (or everywhere). */
  recolor(from: number, to: number): this {
    for (let i = 0; i < this.px.length; i++) if (this.px[i] === from) this.px[i] = to;
    return this;
  }

  /** Paint `m` only onto pixels that already hold one of `onto` (body patterns). */
  paintOnto(x: number, y: number, m: number, onto: readonly number[]): this {
    if (onto.includes(this.get(x, y))) this.set(x, y, m);
    return this;
  }

  mirrorX(): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w >> 1; x++) {
        const a = y * this.w + x;
        const b = y * this.w + (this.w - 1 - x);
        const t = this.px[a] ?? 0;
        this.px[a] = this.px[b] ?? 0;
        this.px[b] = t;
      }
    }
    return this;
  }

  /**
   * Move rows y0..y1 down by dy (idle bob, faint slump). The band is cleared first; moved pixels
   * that land below y1 only cover what is there where they are filled, so feet stay visible.
   */
  shiftRows(y0: number, y1: number, dy: number): this {
    const src = this.px.slice();
    for (let y = y0; y <= y1; y++) for (let x = 0; x < this.w; x++) this.set(x, y, M.EMPTY);
    for (let y = y0; y <= y1; y++) {
      const to = y + dy;
      if (to < 0 || to >= this.h) continue;
      for (let x = 0; x < this.w; x++) {
        const v = src[y * this.w + x] ?? M.EMPTY;
        if (v !== M.EMPTY) this.set(x, to, v);
      }
    }
    return this;
  }

  /** Copy of the grid. */
  clone(): PixelGrid {
    const g = new PixelGrid(this.w, this.h);
    g.px.set(this.px);
    return g;
  }

  /**
   * Rim lighting from the top-left: body, accent and gold pixels on the silhouette's upper edge
   * get the light variant, those near the lower-right edge the shade variant (2 px at the bottom).
   */
  shade(): this {
    const src = this.px.slice();
    const at = (x: number, y: number) =>
      x < 0 || y < 0 || x >= this.w || y >= this.h ? M.EMPTY : (src[y * this.w + x] ?? M.EMPTY);
    const pairs: [number, number, number][] = [
      [M.BASE, M.LIGHT, M.SHADE],
      [M.ACC, M.ACC_LT, M.ACC_SH],
      [M.GOLD, M.GOLD, M.GOLD_SH],
    ];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const v = at(x, y);
        const pair = pairs.find((p) => p[0] === v);
        if (!pair) continue;
        const [, lt, sh] = pair;
        if (at(x, y - 1) === M.EMPTY || (at(x - 1, y) === M.EMPTY && at(x, y - 2) === M.EMPTY)) {
          this.set(x, y, lt);
        } else if (
          at(x, y + 1) === M.EMPTY ||
          at(x + 1, y) === M.EMPTY ||
          (at(x, y + 2) === M.EMPTY && v !== M.GOLD)
        ) {
          this.set(x, y, sh);
        }
      }
    }
    return this;
  }

  /** 1-px outline on empty pixels 4-adjacent to any filled pixel. */
  outline(m: number = M.OUT): this {
    const src = this.px.slice();
    const filled = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < this.w && y < this.h && (src[y * this.w + x] ?? 0) !== M.EMPTY;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (src[y * this.w + x] !== M.EMPTY) continue;
        if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
          this.set(x, y, m);
        }
      }
    }
    return this;
  }

  /** Silhouette mask (1 = any filled pixel). Used by readability tests (R-ART-002). */
  mask(): Uint8Array {
    return this.px.map((v) => (v === M.EMPTY ? 0 : 1));
  }
}

/** Minimal structural type for a 2D context so Node tests can pass a recorder. */
export interface Ctx2D {
  fillStyle: string | CanvasGradient | CanvasPattern;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/**
 * Draw a grid onto a 2D context at an integer scale, merging horizontal runs of one colour into
 * a single fillRect (nearest-neighbour by construction, R-ART-001).
 */
export function blit(
  ctx: Ctx2D,
  grid: PixelGrid,
  palette: Palette,
  scale = 1,
  ox = 0,
  oy = 0,
): void {
  const s = Math.max(1, Math.round(scale));
  for (let y = 0; y < grid.h; y++) {
    let x = 0;
    while (x < grid.w) {
      const m = grid.get(x, y);
      let run = 1;
      while (x + run < grid.w && grid.get(x + run, y) === m) run++;
      if (m !== M.EMPTY) {
        const color = palette[m];
        if (color !== undefined) {
          ctx.fillStyle = css(color);
          ctx.fillRect(ox + x * s, oy + y * s, run * s, s);
        }
      }
      x += run;
    }
  }
}

/** Write a grid into an RGBA buffer at (ox, oy) (fast path for texture sheets; no blending). */
export function writeRgba(
  data: Uint8ClampedArray,
  stride: number,
  grid: PixelGrid,
  palette: Palette,
  ox = 0,
  oy = 0,
): void {
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      const m = grid.get(x, y);
      if (m === M.EMPTY) continue;
      const c = palette[m];
      if (c === undefined) continue;
      const i = ((oy + y) * stride + ox + x) * 4;
      data[i] = (c >> 16) & 255;
      data[i + 1] = (c >> 8) & 255;
      data[i + 2] = c & 255;
      data[i + 3] = 255;
    }
  }
}
