/**
 * M8 — a small pooled particle system.
 *
 * **Sourcing note.** The original's gameplay emitters are cocos2d
 * `CCParticleSystemQuad`s built from **plists shipped in Resources**
 * (`dragEffect`, `landEffect`, `shipDragEffect`, `explodeEffect`, …). An
 * earlier version of this comment said they were not shipped as data; that was
 * wrong. Game code can still override a plist's values after loading it. This
 * file is just the machinery and has no opinion about how any particular
 * effect should look.
 *
 * Deliberately allocation-free after construction: particles live in a fixed
 * pool and dead ones are recycled, because these run every frame during
 * gameplay and a per-particle object churn would show up as GC stutter.
 */

export interface ParticleSpec {
  /** seconds the particle lives */
  life: number;
  /** initial velocity, world units per second */
  vx: number;
  vy: number;
  /** acceleration, world units per second squared (gravity, drag-in) */
  ax: number;
  ay: number;
  /** size in world units at birth and at death */
  size0: number;
  size1: number;
  /** colour, 0..1 */
  r: number;
  g: number;
  b: number;
  /** alpha at birth and at death */
  a0: number;
  a1: number;
  /** rotation (radians) and spin (radians per second) */
  rot: number;
  spin: number;
  /** additive reads as "glow"; normal reads as "dust" */
  additive: boolean;
}

interface Particle extends ParticleSpec {
  x: number;
  y: number;
  age: number;
  alive: boolean;
}

/** what the caller needs in order to draw one particle */
export interface DrawnParticle {
  x: number;
  y: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  rot: number;
  additive: boolean;
}

function blank(): Particle {
  return {
    x: 0, y: 0, age: 0, alive: false,
    life: 1, vx: 0, vy: 0, ax: 0, ay: 0,
    size0: 1, size1: 1, r: 1, g: 1, b: 1, a0: 1, a1: 0,
    rot: 0, spin: 0, additive: false,
  };
}

export class ParticleSystem {
  private pool: Particle[];
  /** round-robin cursor, so a full pool overwrites the oldest rather than dropping new ones */
  private next = 0;

  constructor(capacity = 900) {
    this.pool = Array.from({ length: capacity }, blank);
  }

  get capacity(): number {
    return this.pool.length;
  }

  /** how many particles are currently alive (tests and the debug readout use this) */
  get liveCount(): number {
    let n = 0;
    for (const p of this.pool) if (p.alive) n++;
    return n;
  }

  clear() {
    for (const p of this.pool) p.alive = false;
  }

  /**
   * Spawn one particle. When the pool is full this recycles the slot the cursor
   * lands on — dropping the *oldest* rather than refusing the newest, so a burst
   * always looks like a burst even under pressure.
   */
  spawn(x: number, y: number, spec: ParticleSpec) {
    // prefer a genuinely free slot, but never scan the whole pool for one
    let p: Particle | null = null;
    for (let i = 0; i < 16; i++) {
      const c = this.pool[(this.next + i) % this.pool.length];
      if (!c.alive) { p = c; this.next = (this.next + i + 1) % this.pool.length; break; }
    }
    if (!p) {
      p = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
    }
    Object.assign(p, spec);
    p.x = x;
    p.y = y;
    p.age = 0;
    p.alive = true;
  }

  update(dt: number) {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      p.vx += p.ax * dt;
      p.vy += p.ay * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
  }

  /** walk the live particles, already interpolated, ready to draw */
  forEach(fn: (d: DrawnParticle) => void) {
    const out: DrawnParticle = {
      x: 0, y: 0, size: 0, r: 1, g: 1, b: 1, a: 1, rot: 0, additive: false,
    };
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.age / p.life;
      out.x = p.x;
      out.y = p.y;
      out.size = p.size0 + (p.size1 - p.size0) * t;
      out.r = p.r;
      out.g = p.g;
      out.b = p.b;
      out.a = p.a0 + (p.a1 - p.a0) * t;
      out.rot = p.rot;
      out.additive = p.additive;
      fn(out);
    }
  }
}

/** uniform random in [a, b) — every emitter wants this */
export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
