/**
 * A cocos2d-x 2.x `CCParticleSystem`, driven by the particle plists the game
 * ships (`dragEffect.plist`, `ringEffect.plist`, …). Generic: nothing here
 * knows what an effect is for — `gd/effects.ts` does the wiring.
 *
 * It reproduces the stock engine's algorithms, because the plists only mean
 * what they meant to that engine:
 *
 * - `initWithDictionary`: every plist key, `emissionRate = maxParticles /
 *   particleLifespan` (so a lifespan of 0 fires the whole budget at once — that
 *   is how `landEffect` and `explodeEffect` are bursts), `finishParticleSize
 *   -1` meaning "same as start";
 * - `initParticle`: `timeToLive = max(0, life ± lifeVar)`, position
 *   `sourcePosition ± posVar`, per-channel colour variance clamped to 0..1,
 *   start/end size and spin with variance, the direction from `angle ±
 *   angleVar`; gravity mode (speed, radial and tangential acceleration) and
 *   radius mode (a particle orbits in from `startRadius` to `endRadius` at
 *   `rotatePerSecond`);
 * - `update`: the emit counter, `duration` stopping the system, the per-mode
 *   integration, `timeToLive` expiry with swap-remove;
 * - position types: **free / relative** particles stay where they were born
 *   in the emitter's parent space (a trail), **grouped** ones ride the emitter.
 *
 * `CCRANDOM_MINUS1_1()` is `2·rand()/RAND_MAX − 1`; the random source is
 * injectable so tests are deterministic.
 *
 * Allocation-free after construction: particles are struct-of-arrays in
 * typed arrays sized to `maxParticles`.
 */

export type EmitterMode = "gravity" | "radius";
export type PositionType = "free" | "relative" | "grouped";

export interface ParticleConfig {
  texture: string;
  mode: EmitterMode;
  maxParticles: number;
  /** seconds; −1 = forever */
  duration: number;
  life: number;
  lifeVar: number;
  angle: number;
  angleVar: number;
  posVarX: number;
  posVarY: number;
  sourceX: number;
  sourceY: number;
  startSize: number;
  startSizeVar: number;
  /** −1 = same as the start size */
  endSize: number;
  endSizeVar: number;
  startColor: [number, number, number, number];
  startColorVar: [number, number, number, number];
  endColor: [number, number, number, number];
  endColorVar: [number, number, number, number];
  startSpin: number;
  startSpinVar: number;
  endSpin: number;
  endSpinVar: number;
  // gravity mode
  gravityX: number;
  gravityY: number;
  speed: number;
  speedVar: number;
  radialAccel: number;
  radialAccelVar: number;
  tangentialAccel: number;
  tangentialAccelVar: number;
  rotationIsDir: boolean;
  // radius mode
  startRadius: number;
  startRadiusVar: number;
  /** −1 = same as the start radius */
  endRadius: number;
  endRadiusVar: number;
  rotatePerSecond: number;
  rotatePerSecondVar: number;
  /** `blendFuncDestination == GL_ONE` */
  additive: boolean;
  /** GD's own particle rules (custom particle objects); absent = stock cocos */
  gd?: GDParticleExt;
}

/**
 * What GD's modified `CCParticleSystem` adds (2.2081 binary): `initParticle`
 * (m1 0x6cdaa0), `update` (m1 0x6ce94c) and `CCParticleSystemQuad::
 * updateQuadWithParticle` (m1 0x52aa70).
 *
 * - life is floored at 0.0001 (not 0);
 * - the emission angle and both spins are whole degrees (`fcvtzs`), the start
 *   spin folded into [0, 360); the spin's rate is `end / life` when "start
 *   spin = end spin" is set, else `(end − start) / life`; the spin wraps by
 *   360 every step;
 * - `rotationIsDir` adds `90 − deg(direction)` to the start spin (stock cocos
 *   replaces it with `−deg(direction)`);
 * - the end size has no "−1 = same as start" case: it is `max(0, end ± var)`,
 *   or `start ± var` when "start size = end size" is set;
 * - each particle draws a fade-in and a fade-out time (clamped into its life):
 *   while younger than the fade-in its opacity is scaled by `age / fadeIn`,
 *   while it has less than the fade-out left by `left / fadeOut`;
 * - friction multiplies the velocity (position), the size rate and the spin
 *   rate by `1 − f·dt` every step;
 * - uniform colour mode colours every particle `start → end` by its age
 *   (the object's two colours), ignoring the per-particle colours.
 */
export interface GDParticleExt {
  /** `setEmissionRate`: explicit, not `total / life` */
  emissionRate: number;
  fadeIn: number; fadeInVar: number; fadeOut: number; fadeOutVar: number;
  frictionPos: number; frictionPosVar: number;
  frictionSize: number; frictionSizeVar: number;
  frictionRot: number; frictionRotVar: number;
  startSpinEqualToEndSpin: boolean;
  startSizeEqualToEndSize: boolean;
  /** `[0x2e4]`: start and end colour (0..1 rgb) every particle takes by age */
  uniformColor: { start: [number, number, number]; end: [number, number, number] } | null;
}

const num = (d: Record<string, unknown>, k: string, dflt = 0): number => {
  const v = d[k];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return parseFloat(v);
  return dflt;
};

/** a plist dictionary (as `engine/plist.ts` parses it) → a config */
export function particleConfigFromPlist(d: Record<string, unknown>): ParticleConfig {
  const c4 = (p: string): [number, number, number, number] => [
    num(d, `${p}Red`), num(d, `${p}Green`), num(d, `${p}Blue`), num(d, `${p}Alpha`),
  ];
  return {
    texture: String(d.textureFileName ?? ""),
    mode: num(d, "emitterType") === 1 ? "radius" : "gravity",
    maxParticles: Math.max(0, Math.floor(num(d, "maxParticles"))),
    duration: num(d, "duration", -1),
    life: num(d, "particleLifespan"),
    lifeVar: num(d, "particleLifespanVariance"),
    angle: num(d, "angle"),
    angleVar: num(d, "angleVariance"),
    posVarX: num(d, "sourcePositionVariancex"),
    posVarY: num(d, "sourcePositionVariancey"),
    // `initWithDictionary` puts sourcePosition on the *node* and leaves
    // `m_tSourcePosition` at zero; the game positions every emitter itself
    sourceX: 0,
    sourceY: 0,
    startSize: num(d, "startParticleSize"),
    startSizeVar: num(d, "startParticleSizeVariance"),
    endSize: num(d, "finishParticleSize"),
    endSizeVar: num(d, "finishParticleSizeVariance"),
    startColor: c4("startColor"),
    startColorVar: c4("startColorVariance"),
    endColor: c4("finishColor"),
    endColorVar: c4("finishColorVariance"),
    startSpin: num(d, "rotationStart"),
    startSpinVar: num(d, "rotationStartVariance"),
    endSpin: num(d, "rotationEnd"),
    endSpinVar: num(d, "rotationEndVariance"),
    gravityX: num(d, "gravityx"),
    gravityY: num(d, "gravityy"),
    speed: num(d, "speed"),
    speedVar: num(d, "speedVariance"),
    radialAccel: num(d, "radialAcceleration"),
    radialAccelVar: num(d, "radialAccelVariance"),
    tangentialAccel: num(d, "tangentialAcceleration"),
    tangentialAccelVar: num(d, "tangentialAccelVariance"),
    rotationIsDir: num(d, "rotationIsDir") !== 0,
    startRadius: num(d, "maxRadius"),
    startRadiusVar: num(d, "maxRadiusVariance"),
    endRadius: num(d, "minRadius"),
    endRadiusVar: num(d, "minRadiusVariance"),
    rotatePerSecond: num(d, "rotatePerSecond"),
    rotatePerSecondVar: num(d, "rotatePerSecondVariance"),
    additive: num(d, "blendFuncDestination") === 1,
  };
}

/** one live particle, ready to draw in world space */
export interface DrawnCCParticle {
  x: number;
  y: number;
  size: number;
  /** radians, counter-clockwise (the renderer's convention) */
  rot: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

const DEG = Math.PI / 180;

export class CCEmitter {
  /** the live, overridable configuration (the game's `set*` calls write here) */
  readonly cfg: ParticleConfig;
  /** the emitter node's position in its parent (world) space */
  x = 0;
  y = 0;
  /** node rotation, degrees clockwise, as `setRotation` */
  rotation = 0;
  /** node scale */
  scale = 1;
  positionType: PositionType = "free";
  active = true;
  elapsed = 0;
  emitCounter = 0;
  /** `totalParticles / life`, recomputed by `updateEmissionRate` */
  emissionRate: number;
  count = 0;
  private readonly rand: () => number;
  // struct-of-arrays particle store
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly sx: Float32Array;
  private readonly sy: Float32Array;
  private readonly ttl: Float32Array;
  private readonly col: Float32Array;
  private readonly dcol: Float32Array;
  private readonly size: Float32Array;
  private readonly dsize: Float32Array;
  private readonly rot: Float32Array;
  private readonly drot: Float32Array;
  private readonly dirx: Float32Array;
  private readonly diry: Float32Array;
  private readonly racc: Float32Array;
  private readonly tacc: Float32Array;
  private readonly ang: Float32Array;
  private readonly dps: Float32Array;
  private readonly rad: Float32Array;
  private readonly drad: Float32Array;
  // GD's additions (allocated only for a `gd` config)
  private readonly age?: Float32Array;
  private readonly life0?: Float32Array;
  private readonly fin?: Float32Array;
  private readonly fout?: Float32Array;
  private readonly fpos?: Float32Array;
  private readonly fsize?: Float32Array;
  private readonly frot?: Float32Array;
  private readonly out: DrawnCCParticle = { x: 0, y: 0, size: 0, rot: 0, r: 1, g: 1, b: 1, a: 1 };

  constructor(cfg: ParticleConfig, rand: () => number = Math.random) {
    this.cfg = {
      ...cfg,
      startColor: [...cfg.startColor], startColorVar: [...cfg.startColorVar],
      endColor: [...cfg.endColor], endColorVar: [...cfg.endColorVar],
    };
    this.rand = rand;
    const n = Math.max(1, cfg.maxParticles);
    const f = () => new Float32Array(n);
    this.px = f(); this.py = f(); this.sx = f(); this.sy = f(); this.ttl = f();
    this.col = new Float32Array(n * 4); this.dcol = new Float32Array(n * 4);
    this.size = f(); this.dsize = f(); this.rot = f(); this.drot = f();
    this.dirx = f(); this.diry = f(); this.racc = f(); this.tacc = f();
    this.ang = f(); this.dps = f(); this.rad = f(); this.drad = f();
    if (cfg.gd) {
      this.age = f(); this.life0 = f(); this.fin = f(); this.fout = f();
      this.fpos = f(); this.fsize = f(); this.frot = f();
    }
    this.emissionRate = this.rateFor(cfg);
  }

  private rateFor(cfg: ParticleConfig): number {
    if (cfg.gd) return cfg.gd.emissionRate;
    return cfg.life > 0 ? cfg.maxParticles / cfg.life : Infinity;
  }

  /** `CCParticleSystem::updateEmissionRate` */
  updateEmissionRate() {
    this.emissionRate = this.rateFor(this.cfg);
  }

  /** `stopSystem`: no more emission; live particles run out */
  stop() {
    this.active = false;
    this.elapsed = this.cfg.duration;
    this.emitCounter = 0;
  }

  /** GD's `resumeSystem`: emission restarts, live particles untouched */
  resume() {
    this.active = true;
  }

  /** `resetSystem`: restart emission and kill every live particle */
  reset() {
    this.active = true;
    this.elapsed = 0;
    for (let i = 0; i < this.count; i++) this.ttl[i] = 0;
  }

  /** drop everything at once, emission stopped (a respawn) */
  clear() {
    this.count = 0;
    this.stop();
  }

  private r11(): number {
    return 2 * this.rand() - 1;
  }

  private add() {
    if (this.cfg.gd) { this.addGD(this.cfg.gd); return; }
    const c = this.cfg;
    const i = this.count++;
    const ttl = Math.max(0, c.life + c.lifeVar * this.r11());
    this.ttl[i] = ttl;
    this.px[i] = c.sourceX + c.posVarX * this.r11();
    this.py[i] = c.sourceY + c.posVarY * this.r11();
    const k = i * 4;
    for (let ch = 0; ch < 4; ch++) {
      const s = Math.min(1, Math.max(0, c.startColor[ch] + c.startColorVar[ch] * this.r11()));
      const e = Math.min(1, Math.max(0, c.endColor[ch] + c.endColorVar[ch] * this.r11()));
      this.col[k + ch] = s;
      this.dcol[k + ch] = ttl > 0 ? (e - s) / ttl : 0;
    }
    const s0 = Math.max(0, c.startSize + c.startSizeVar * this.r11());
    this.size[i] = s0;
    if (c.endSize === -1) this.dsize[i] = 0;
    else {
      const s1 = Math.max(0, c.endSize + c.endSizeVar * this.r11());
      this.dsize[i] = ttl > 0 ? (s1 - s0) / ttl : 0;
    }
    const a0 = c.startSpin + c.startSpinVar * this.r11();
    const a1 = c.endSpin + c.endSpinVar * this.r11();
    this.rot[i] = a0;
    this.drot[i] = ttl > 0 ? (a1 - a0) / ttl : 0;
    // `startPos` is the emitter's position at birth, for free/relative types
    this.sx[i] = this.x;
    this.sy[i] = this.y;
    const a = (c.angle + c.angleVar * this.r11()) * DEG;
    if (c.mode === "gravity") {
      const sp = c.speed + c.speedVar * this.r11();
      this.dirx[i] = Math.cos(a) * sp;
      this.diry[i] = Math.sin(a) * sp;
      this.racc[i] = c.radialAccel + c.radialAccelVar * this.r11();
      this.tacc[i] = c.tangentialAccel + c.tangentialAccelVar * this.r11();
      if (c.rotationIsDir) this.rot[i] = -Math.atan2(this.diry[i], this.dirx[i]) / DEG;
    } else {
      const r0 = c.startRadius + c.startRadiusVar * this.r11();
      const r1 = c.endRadius + c.endRadiusVar * this.r11();
      this.rad[i] = r0;
      this.drad[i] = c.endRadius === -1 || ttl <= 0 ? 0 : (r1 - r0) / ttl;
      this.ang[i] = a;
      this.dps[i] = (c.rotatePerSecond + c.rotatePerSecondVar * this.r11()) * DEG;
    }
  }

  /** GD's `initParticle` (m1 0x6cdaa0) — see `GDParticleExt` */
  private addGD(g: GDParticleExt) {
    const c = this.cfg;
    const i = this.count++;
    let ttl = c.life + c.lifeVar * this.r11();
    if (!(ttl > 0.0001)) ttl = 0.0001;
    this.ttl[i] = ttl;
    this.life0![i] = ttl;
    this.age![i] = 0;
    this.px[i] = c.sourceX + c.posVarX * this.r11();
    this.py[i] = c.sourceY + c.posVarY * this.r11();
    const k = i * 4;
    for (let ch = 0; ch < 4; ch++) {
      const s = Math.min(1, Math.max(0, c.startColor[ch] + c.startColorVar[ch] * this.r11()));
      const e = Math.min(1, Math.max(0, c.endColor[ch] + c.endColorVar[ch] * this.r11()));
      this.col[k + ch] = s;
      this.dcol[k + ch] = (e - s) / ttl;
    }
    const fin = Math.max(0, Math.min(ttl, g.fadeIn + g.fadeInVar * this.r11()));
    this.fin![i] = fin;
    this.fout![i] = Math.max(0, Math.min(ttl - fin, g.fadeOut + g.fadeOutVar * this.r11()));
    const s0 = Math.max(0, c.startSize + c.startSizeVar * this.r11());
    this.size[i] = s0;
    const endVar = c.endSize + c.endSizeVar * this.r11();
    let ds: number;
    if (g.startSizeEqualToEndSize) {
      const v = c.endSizeVar * this.r11();
      ds = s0 + v < 0 ? -s0 : v;
    } else ds = Math.max(0, endVar) - s0;
    this.dsize[i] = ds / ttl;
    this.fpos![i] = g.frictionPos + g.frictionPosVar * this.r11();
    this.fsize![i] = g.frictionSize + g.frictionSizeVar * this.r11();
    this.frot![i] = g.frictionRot + g.frictionRotVar * this.r11();
    // whole-degree spins, the start folded into [0, 360)
    const a0i = Math.trunc(c.startSpin + c.startSpinVar * this.r11());
    let a0 = a0i < -360 || a0i > 360 ? a0i % 360 : a0i;
    if (a0 < 0) a0 += 360;
    this.rot[i] = a0;
    const a1i = Math.trunc(c.endSpin + c.endSpinVar * this.r11());
    this.drot[i] = (g.startSpinEqualToEndSpin ? a1i : a1i - a0i) / ttl;
    this.sx[i] = this.x;
    this.sy[i] = this.y;
    const a = Math.trunc(c.angle + c.angleVar * this.r11()) * DEG;
    if (c.mode === "gravity") {
      const sp = c.speed + c.speedVar * this.r11();
      this.dirx[i] = Math.cos(a) * sp;
      this.diry[i] = Math.sin(a) * sp;
      this.racc[i] = c.radialAccel + c.radialAccelVar * this.r11();
      this.tacc[i] = c.tangentialAccel + c.tangentialAccelVar * this.r11();
      if (c.rotationIsDir) this.rot[i] += 90 - Math.atan2(this.diry[i], this.dirx[i]) / DEG;
    } else {
      const r0 = c.startRadius + c.startRadiusVar * this.r11();
      const r1 = c.endRadius + c.endRadiusVar * this.r11();
      this.rad[i] = r0;
      this.drad[i] = (r1 - r0) / ttl;
      this.ang[i] = a;
      this.dps[i] = (c.rotatePerSecond + c.rotatePerSecondVar * this.r11()) * DEG;
    }
  }

  /** `CCParticleSystem::update` */
  update(dt: number) {
    const c = this.cfg;
    if (this.active && this.emissionRate) {
      const rate = 1 / this.emissionRate;
      if (this.count < c.maxParticles) this.emitCounter += dt;
      while (this.count < c.maxParticles && this.emitCounter > rate) {
        this.add();
        this.emitCounter -= rate;
      }
      this.elapsed += dt;
      if (c.duration !== -1 && c.duration < this.elapsed) this.stop();
    }
    let i = 0;
    while (i < this.count) {
      this.ttl[i] -= dt;
      if (this.ttl[i] > 0) {
        if (c.mode === "gravity") {
          let rx = 0, ry = 0;
          const x = this.px[i], y = this.py[i];
          if (x || y) {
            const l = Math.hypot(x, y);
            rx = x / l; ry = y / l;
          }
          const tx = -ry * this.tacc[i], ty = rx * this.tacc[i];
          const ax = rx * this.racc[i] + tx + c.gravityX;
          const ay = ry * this.racc[i] + ty + c.gravityY;
          this.dirx[i] += ax * dt;
          this.diry[i] += ay * dt;
          this.px[i] += this.dirx[i] * dt;
          this.py[i] += this.diry[i] * dt;
        } else {
          this.ang[i] += this.dps[i] * dt;
          this.rad[i] += this.drad[i] * dt;
          this.px[i] = -Math.cos(this.ang[i]) * this.rad[i];
          this.py[i] = -Math.sin(this.ang[i]) * this.rad[i];
        }
        const k = i * 4;
        for (let ch = 0; ch < 4; ch++) this.col[k + ch] += this.dcol[k + ch] * dt;
        this.size[i] = Math.max(0, this.size[i] + this.dsize[i] * dt);
        this.rot[i] += this.drot[i] * dt;
        if (c.gd) {
          this.age![i] += dt;
          const r = this.rot[i];
          if (r > 360) this.rot[i] = r - 360;
          else if (r < 0) this.rot[i] = r + 360;
          // friction, after the step (m1 0x6cf334)
          if (this.fpos![i]) { const m = 1 - dt * this.fpos![i]; this.dirx[i] *= m; this.diry[i] *= m; }
          if (this.fsize![i]) this.dsize[i] *= 1 - dt * this.fsize![i];
          if (this.frot![i]) this.drot[i] *= 1 - dt * this.frot![i];
        }
        i++;
      } else {
        // swap-remove, as the engine does
        const last = --this.count;
        if (i !== last) this.move(last, i);
      }
    }
  }

  private move(from: number, to: number) {
    this.px[to] = this.px[from]; this.py[to] = this.py[from];
    this.sx[to] = this.sx[from]; this.sy[to] = this.sy[from];
    this.ttl[to] = this.ttl[from];
    for (let ch = 0; ch < 4; ch++) {
      this.col[to * 4 + ch] = this.col[from * 4 + ch];
      this.dcol[to * 4 + ch] = this.dcol[from * 4 + ch];
    }
    this.size[to] = this.size[from]; this.dsize[to] = this.dsize[from];
    this.rot[to] = this.rot[from]; this.drot[to] = this.drot[from];
    this.dirx[to] = this.dirx[from]; this.diry[to] = this.diry[from];
    this.racc[to] = this.racc[from]; this.tacc[to] = this.tacc[from];
    this.ang[to] = this.ang[from]; this.dps[to] = this.dps[from];
    this.rad[to] = this.rad[from]; this.drad[to] = this.drad[from];
    if (this.age) {
      this.age[to] = this.age[from]; this.life0![to] = this.life0![from];
      this.fin![to] = this.fin![from]; this.fout![to] = this.fout![from];
      this.fpos![to] = this.fpos![from]; this.fsize![to] = this.fsize![from]; this.frot![to] = this.frot![from];
    }
  }

  /**
   * Walk the live particles in world space. `updateQuadWithParticle` draws a
   * `size`-square quad rotated by `−rotation` degrees; the node's own rotation
   * and scale apply on top. A free or relative particle is drawn where it was
   * born plus its travel; a grouped one rides the emitter.
   */
  forEach(fn: (p: DrawnCCParticle) => void) {
    const o = this.out;
    const nr = -this.rotation * DEG;
    const cs = Math.cos(nr) * this.scale, sn = Math.sin(nr) * this.scale;
    const grouped = this.positionType === "grouped";
    for (let i = 0; i < this.count; i++) {
      const lx = this.px[i], ly = this.py[i];
      const ox = grouped ? this.x : this.sx[i];
      const oy = grouped ? this.y : this.sy[i];
      o.x = ox + lx * cs - ly * sn;
      o.y = oy + lx * sn + ly * cs;
      o.size = this.size[i] * this.scale;
      o.rot = nr - this.rot[i] * DEG;
      const k = i * 4;
      o.r = this.col[k]; o.g = this.col[k + 1]; o.b = this.col[k + 2];
      o.a = Math.min(1, Math.max(0, this.col[k + 3]));
      const g = this.cfg.gd;
      if (g) {
        const age = this.age![i], left = this.ttl[i];
        if (g.uniformColor) {
          const t = Math.min(1, age / this.life0![i]);
          const u = g.uniformColor;
          o.r = u.start[0] + (u.end[0] - u.start[0]) * t;
          o.g = u.start[1] + (u.end[1] - u.start[1]) * t;
          o.b = u.start[2] + (u.end[2] - u.start[2]) * t;
        }
        // `updateQuadWithParticle`: fading in, else fading out
        if (age < this.fin![i]) o.a *= age / this.fin![i];
        else if (left < this.fout![i]) o.a *= left / this.fout![i];
      }
      fn(o);
    }
  }
}
