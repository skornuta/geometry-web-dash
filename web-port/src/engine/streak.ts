/**
 * A cocos2d-x 2.x `CCMotionStreak` — the textured ribbon a moving node leaves
 * behind. Generic; `gd/effects.ts` decides which streak a player gets.
 *
 * The algorithms are the stock engine's (`CCMotionStreak::update`,
 * `ccVertexLineToPolygon`), because the game hands it its constants and those
 * only mean what they meant there:
 *
 * - `fade` seconds for a point to disappear; each point's state runs 1 → 0,
 *   and its two vertices take `state · 255` as their opacity;
 * - a point is appended only when the node has moved more than `minSeg` from
 *   the last point (and `2·minSeg` from the one before), at most
 *   `fade · 60 + 2` points;
 * - "fast mode": a new point's two vertices are fixed when it is appended,
 *   offset by `stroke / 2` along the perpendicular of the segment arriving at
 *   it, and never recomputed;
 * - texture coordinates run `(0, i/n)`–`(1, i/n)` along the ribbon.
 *
 * Allocation-free after construction.
 */

export interface StreakVertexPair {
  x0: number; y0: number; x1: number; y1: number; alpha: number; v: number;
}

export class MotionStreak {
  readonly fade: number;
  readonly stroke: number;
  private readonly minSeg2: number;
  readonly maxPoints: number;
  /** points in use */
  count = 0;
  private started = false;
  private px = 0;
  private py = 0;
  private readonly ptx: Float32Array;
  private readonly pty: Float32Array;
  private readonly state: Float32Array;
  /** two vertices per point: [x+, y+, x−, y−] */
  private readonly vert: Float32Array;
  private readonly pair: StreakVertexPair = { x0: 0, y0: 0, x1: 0, y1: 0, alpha: 0, v: 0 };

  constructor(fade: number, minSeg: number, stroke: number) {
    this.fade = fade;
    this.stroke = stroke;
    const seg = minSeg === -1 ? stroke / 5 : minSeg;
    this.minSeg2 = seg * seg;
    this.maxPoints = Math.floor(fade * 60) + 2;
    this.ptx = new Float32Array(this.maxPoints);
    this.pty = new Float32Array(this.maxPoints);
    this.state = new Float32Array(this.maxPoints);
    this.vert = new Float32Array(this.maxPoints * 4);
  }

  /** `setPosition`: the node moved; the first call starts the streak */
  setPosition(x: number, y: number) {
    this.started = true;
    this.px = x;
    this.py = y;
  }

  /** `reset`: forget every point */
  reset() {
    this.count = 0;
  }

  update(dt: number) {
    if (!this.started) return;
    const delta = dt / this.fade;
    let mov = 0;
    for (let i = 0; i < this.count; i++) {
      this.state[i] -= delta;
      if (this.state[i] <= 0) { mov++; continue; }
      if (mov > 0) {
        const n = i - mov;
        this.state[n] = this.state[i];
        this.ptx[n] = this.ptx[i];
        this.pty[n] = this.pty[i];
        for (let k = 0; k < 4; k++) this.vert[n * 4 + k] = this.vert[i * 4 + k];
      }
    }
    this.count -= mov;

    let append = this.count < this.maxPoints;
    if (append && this.count > 0) {
      const d1 = (this.ptx[this.count - 1] - this.px) ** 2 + (this.pty[this.count - 1] - this.py) ** 2;
      const d2 = this.count === 1 ? Infinity
        : (this.ptx[this.count - 2] - this.px) ** 2 + (this.pty[this.count - 2] - this.py) ** 2;
      if (d1 < this.minSeg2 || d2 < this.minSeg2 * 2) append = false;
    }
    if (append) {
      const i = this.count;
      this.ptx[i] = this.px;
      this.pty[i] = this.py;
      this.state[i] = 1;
      this.count++;
      if (i === 1) {
        this.perp(0);
        this.perp(1);
      } else if (i > 1) {
        this.perp(i);
      }
    }
  }

  /** `ccVertexLineToPolygon` for one point, using its neighbours as they are now */
  private perp(i: number) {
    const n = this.count;
    let dx: number, dy: number;
    if (i === 0) {
      dx = this.ptx[0] - this.ptx[1]; dy = this.pty[0] - this.pty[1];
    } else if (i === n - 1) {
      dx = this.ptx[i - 1] - this.ptx[i]; dy = this.pty[i - 1] - this.pty[i];
    } else {
      dx = this.ptx[i - 1] - this.ptx[i + 1]; dy = this.pty[i - 1] - this.pty[i + 1];
    }
    const l = Math.hypot(dx, dy) || 1;
    // ccpPerp(normalize(v)) = (−v.y, v.x)
    const s = this.stroke / 2;
    const ox = (-dy / l) * s, oy = (dx / l) * s;
    const k = i * 4;
    this.vert[k] = this.ptx[i] + ox;
    this.vert[k + 1] = this.pty[i] + oy;
    this.vert[k + 2] = this.ptx[i] - ox;
    this.vert[k + 3] = this.pty[i] - oy;
  }

  /** each point's vertex pair, oldest first, with its opacity and texture v */
  forEachPair(fn: (p: StreakVertexPair, i: number) => void) {
    const p = this.pair;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const k = i * 4;
      p.x0 = this.vert[k]; p.y0 = this.vert[k + 1];
      p.x1 = this.vert[k + 2]; p.y1 = this.vert[k + 3];
      p.alpha = this.state[i];
      p.v = i / n;
      fn(p, i);
    }
  }
}
