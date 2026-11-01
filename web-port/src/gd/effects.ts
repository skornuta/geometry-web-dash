/**
 * Gameplay particle effects, streaks and screen shake — the GD wiring over
 * the generic `engine/ccparticles.ts` and `engine/streak.ts`.
 *
 * **Sourced from the shipped plists and the 2.2081 binary**, not tuned. The
 * original loads cocos particle plists from Resources and then overrides some
 * of their values in code; both halves are reproduced here, and every override
 * names where it was read (`docs/fidelity/FIDELITY.md` §2 has the working).
 * What could not be sourced quickly is marked APPROXIMATION and is on the
 * Phase 3 list there.
 *
 * Particles are drawn in world space; the scene owns the textures.
 */

import { parsePlist } from "../engine/plist.ts";
import {
  CCEmitter, particleConfigFromPlist, type ParticleConfig,
} from "../engine/ccparticles.ts";
import { MotionStreak } from "../engine/streak.ts";
import type { Gamemode } from "./gamemodes.ts";
import { dashWorldDirection, type DashArtPlayer } from "./dashArt.ts";
import { ASSET } from "../assetBase.ts";

export type Rgb = { r: number; g: number; b: number };

/** every plist the gameplay effects load */
export const EFFECT_PLISTS = [
  "dragEffect", "landEffect", "shipDragEffect", "explodeEffect", "burstEffect2",
  "ringEffect", "bumpEffect", "portalEffect01", "portalEffect02", "portalEffect03",
  "portalEffect04", "portalEffect08", "portalEffect09", "speedEffect_slow",
  "speedEffect_normal", "speedEffect_fast", "speedEffect_vfast", "speedEffect_vvfast",
  "coinPickupEffect", "endEffectPortal", "levelComplete01", "firework",
  "boost_01_effect", "boost_02_effect", "boost_03_effect", "boost_04_effect",
  "glitterEffect", "dashEffect", "swingBurstEffect",
] as const;
export type EffectName = typeof EFFECT_PLISTS[number];
export type EffectLibrary = ReadonlyMap<EffectName, ParticleConfig>;

/** fetch and parse every effect plist the scene needs */
export async function loadEffectLibrary(base = `${ASSET}`): Promise<EffectLibrary> {
  const out = new Map<EffectName, ParticleConfig>();
  await Promise.all(EFFECT_PLISTS.map(async (n) => {
    const xml = await fetch(`${base}${n}.plist`).then((r) => {
      if (!r.ok) throw new Error(`effect plist ${n}: HTTP ${r.status}`);
      return r.text();
    });
    out.set(n, particleConfigFromPlist(parsePlist(xml) as Record<string, unknown>));
  }));
  return out;
}

/* ---------------- colours ---------------- */

/**
 * `GameToolbox::strongColor` (m1 `0x44b154`): a colour with no channel at 255
 * is scaled up by `min(255 / max, 1.5)`, truncated; otherwise unchanged.
 */
export function strongColor(c: readonly [number, number, number]): [number, number, number] {
  const [r, g, b] = c;
  if (r === 255 || g === 255 || b === 255) return [r, g, b];
  const m = Math.max(r, g, b);
  const k = m > 0 ? Math.min(255 / m, 1.5) : 1.5;
  return [Math.trunc(r * k), Math.trunc(g * k), Math.trunc(b * k)];
}

/**
 * `PlayerObject::updateGlowColor` (`0x38edf0`) +28..360: the two particle
 * colours. `a` (drag, landing, burst) is colour 1 — colour 2 when colour 1
 * is black — and `b` (the streak) is colour 2, colour 1 when colour 2 is
 * black; both then go through `strongColor`.
 */
export function particleColors(col1: readonly [number, number, number],
  col2: readonly [number, number, number]) {
  const black = (c: readonly number[]) => c[0] === 0 && c[1] === 0 && c[2] === 0;
  let a = col1, b = col2;
  if (black(col1) && !black(col2)) { a = col2; b = col2; }
  else if (black(col2) && !black(col1)) { a = col1; b = col1; }
  return { a: strongColor(a), b: strongColor(b) };
}

const rgba = (c: readonly [number, number, number], a = 1): [number, number, number, number] =>
  [c[0] / 255, c[1] / 255, c[2] / 255, a];

/* ---------------- the player's emitters (PlayerObject::init 0x37...) ---------------- */

const GROUND_MODES: ReadonlySet<Gamemode> = new Set<Gamemode>(["cube", "ball", "robot", "spider"]);

export interface PlayerView extends DashArtPlayer {
  x: number;
  y: number;
  mode: Gamemode;
  mini: boolean;
  onGround: boolean;
  gravityFlipped: boolean;
  yVel: number;
}

/**
 * One player's effects: the emitters `PlayerObject::init` builds
 * (+2560..3888), the motion streak `setupStreak` builds (`0x375058`), and the
 * wave trail. Driven once per rendered frame from the player's state — this
 * is presentation and feeds nothing back.
 */
export class PlayerEffects {
  /** `[0x868]` dragEffect as shipped, relative — the ground drag */
  readonly drag: CCEmitter;
  /** `[0x870]` dragEffect, speed and speedVar ×0.2, posVar (0, 2), orange → red — the vehicle flame */
  readonly flame: CCEmitter;
  /** `[0x878]` dragEffect, speed ×2, angleVar ×2, size ×1.5, posVar (0, 2), amber → red — the ship's thrust */
  readonly thrust: CCEmitter;
  /** `[0x880]` shipDragEffect, grouped — a vehicle sliding on a surface */
  readonly shipDrag: CCEmitter;
  /** `[0x8b8]` / `[0x8c0]` landEffect, grouped, used alternately by `hitGround` */
  readonly land: [CCEmitter, CCEmitter];
  /** `[0x890]` burstEffect2, relative — the robot's boost */
  readonly robotBurst: CCEmitter;
  /** GD 2.209 `[0x8a0]`: dashEffect, relative, resumed only while dashing. */
  readonly dash: CCEmitter;
  /** GD 2.2 `[0x8a0]`/`[0x8a8]`: swingBurstEffect ×2, grouped — swing tap / direction change */
  readonly swingBurst?: [CCEmitter, CCEmitter];
  /** `setupStreak`: streak 1 = `CCMotionStreak(0.3, 5, 10, white, streak_01_001)` */
  readonly streak = new MotionStreak(0.3, 5, 10);
  readonly wave = new WaveTrail();
  /** `hitGround` alternates between its two landing emitters (`[0x8b0]`) */
  private landNext = 0;
  private swingBurstNext = 0;
  private wasSwing = false;
  private lastSwingGravity = false;
  /** the drag keeps emitting 0.06 s after leaving the ground (`update` +1968..2052) */
  private dragGrace = 0;
  private streakOn = false;
  private wasGround = true;
  private lastMode: Gamemode = "cube";
  private readonly landAngle: number;
  private readonly landGravityY: number;
  colorA: [number, number, number] = [255, 255, 255];
  colorB: [number, number, number] = [255, 255, 255];

  constructor(lib: EffectLibrary) {
    const drag = lib.get("dragEffect")!;
    this.drag = new CCEmitter(drag);
    this.drag.positionType = "relative";
    this.drag.stop();

    this.flame = new CCEmitter(drag);
    this.flame.positionType = "relative";
    this.flame.cfg.speed *= 0.2;
    this.flame.cfg.speedVar *= 0.2;
    this.flame.cfg.posVarX = 0;
    this.flame.cfg.posVarY = 2;
    // `0x1007237a0` and `0x10071d990`
    this.flame.cfg.startColor = [1, 100 / 255, 0, 1];
    this.flame.cfg.endColor = [1, 0, 0, 1];
    this.flame.stop();

    this.thrust = new CCEmitter(drag);
    this.thrust.positionType = "relative";
    this.thrust.cfg.speed *= 2;
    this.thrust.cfg.speedVar *= 2;
    this.thrust.cfg.angleVar *= 2;
    this.thrust.cfg.startSize *= 1.5;
    this.thrust.cfg.startSizeVar *= 1.5;
    this.thrust.cfg.posVarX = 0;
    this.thrust.cfg.posVarY = 2;
    // `0x1007237b0`
    this.thrust.cfg.startColor = [1, 190 / 255, 0, 1];
    this.thrust.cfg.endColor = [1, 0, 0, 1];
    this.thrust.stop();

    this.shipDrag = new CCEmitter(lib.get("shipDragEffect")!);
    this.shipDrag.positionType = "grouped";
    this.shipDrag.stop();

    const land = lib.get("landEffect")!;
    this.land = [new CCEmitter(land), new CCEmitter(land)];
    for (const l of this.land) { l.positionType = "grouped"; l.stop(); }
    // `[0x8c8]` / `[0x8cc]`: the plist's angle and gravity y, flipped per landing
    this.landAngle = land.angle;
    this.landGravityY = land.gravityY;

    this.robotBurst = new CCEmitter(lib.get("burstEffect2")!);
    this.robotBurst.positionType = "relative";
    this.robotBurst.stop();

    // GD 2.209 PlayerObject::init: dashEffect is relative and initially stopped.
    this.dash = new CCEmitter(lib.get("dashEffect")!);
    this.dash.positionType = "relative";
    this.dash.stop();
    this.setDashColor([255, 255, 255]);

    const sb = lib.get("swingBurstEffect");
    if (sb) {
      this.swingBurst = [new CCEmitter(sb), new CCEmitter(sb)];
      for (const s of this.swingBurst) {
        s.positionType = "grouped";
        s.cfg.duration = 0.05;
        // Native overrides: start (1, 0.392, 0, 1), end red (1, 0, 0, 1)
        s.cfg.startColor = [1, 100 / 255, 0, 1];
        s.cfg.endColor = [1, 0, 0, 1];
        s.stop();
      }
    }
  }

  /** `updateGlowColor`: tint the drag, landing and streak from the kit */
  setColors(col1: readonly [number, number, number], col2: readonly [number, number, number]) {
    const { a, b } = particleColors(col1, col2);
    this.colorA = a;
    this.colorB = b;
    for (const e of [this.drag, this.land[0], this.land[1]]) {
      e.cfg.startColor = rgba(a, e.cfg.startColor[3]);
    }
    this.wave.color = [col1[0], col1[1], col1[2]];
    // APPROXIMATION: the port has no m_switchDashFireColor setting yet. Use
    // strong particle color A until the caller supplies its selected native
    // color through setDashColor (after setColors).
    this.dash.cfg.startColor = rgba(a);
    this.dash.cfg.endColor = rgba(a, 0.5);
  }

  /**
   * Native 2.209 updateGlowColor 0x381454..0x3814a0 selects a strong kit color
   * via m_switchDashFireColor, overrides BOTH RGB endpoints, end alpha ×.5.
   * The caller owns selection policy; pass unstrengthened 0..255 RGB here.
   */
  setDashColor(color: readonly [number, number, number]) {
    const c = strongColor(color);
    this.dash.cfg.startColor = rgba(c);
    this.dash.cfg.endColor = rgba(c, 0.5);
  }

  /** `PlayerObject::stopParticles` / `playerDestroyed`: emission stops, live particles run out */
  stopAll() {
    for (const e of this.emitters()) e.stop();
    this.streakOn = false;
  }

  /** advance what is already alive without emitting anything new */
  tick(dt: number) {
    for (const e of this.emitters()) e.update(dt);
    this.streak.update(dt);
  }

  /** a respawn or checkpoint rewind: nothing carries over */
  reset() {
    for (const e of this.emitters()) e.clear();
    this.streak.reset();
    this.wave.reset();
    this.streakOn = false;
    this.dragGrace = 0;
    this.wasGround = true;
    this.wasSwing = false;
    this.lastSwingGravity = false;
  }

  emitters(): CCEmitter[] {
    const list = [this.drag, this.flame, this.thrust, this.shipDrag, this.land[0], this.land[1], this.robotBurst, this.dash];
    if (this.swingBurst) list.push(...this.swingBurst);
    return list;
  }

  /**
   * GD 2.2 swing direction-change burst (`[0x8a0]`/`[0x8a8]`):
   * Alternates between the two grouped emitters at the rear of the swing copter (-10 * size, 0).
   */
  triggerSwingBurst(px: number, py: number, mini: boolean, gravityFlipped: boolean) {
    if (!this.swingBurst) return;
    const size = mini ? 0.6 : 1;
    const g = gravityFlipped ? -1 : 1;
    const e = this.swingBurst[this.swingBurstNext];
    this.swingBurstNext ^= 1;
    e.x = px - 10 * size;
    e.y = py;
    e.cfg.gravityY = -Math.abs(e.cfg.gravityY) * g;
    e.reset();
  }

  /**
   * `activateStreak` callers: an orb (`ringJump` +2016), a pad
   * (`propellPlayer` +448), a gravity flip (`flipGravity` +492) and entering
   * a flying mode. `deactivateStreak`: landing (`hitGround` +1588).
   */
  activateStreak() {
    if (!this.streakOn) this.streak.reset();
    this.streakOn = true;
  }

  update(dt: number, p: PlayerView, holding: boolean, robotCharging: boolean, speed: number) {
    const size = p.mini ? 0.6 : 1;
    const g = p.gravityFlipped ? -1 : 1;
    const ground = GROUND_MODES.has(p.mode);
    const flying = p.mode === "ship" || p.mode === "ufo" || p.mode === "swing" || p.mode === "wave";
    if (p.mode !== this.lastMode) {
      if (flying) this.activateStreak();
      if (p.mode === "wave") this.wave.reset();
      this.lastMode = p.mode;
    }

    // --- emitter placement (`PlayerObject::setPosition` 0x38e200 +88..252) ---
    // the flame and its companions sit behind and below the icon: ship
    // (−10·size, −18)… APPROXIMATION: the `[0x550]` node's transform is not
    // decoded, so the offsets are applied in world space, mirrored with gravity
    let ox = -12 * size, oy = -4;
    if (p.mode === "ship") { ox = -10 * size; oy = -18 * size; }
    else if (p.mode === "ufo") { ox = 0; oy = -3; }
    else if (p.mode === "swing") { ox = -10 * size; oy = 0; }
    const ex = p.x + ox, ey = p.y + oy * g;
    for (const e of [this.drag, this.flame, this.thrust, this.robotBurst]) {
      e.x = ex; e.y = ey;
    }
    // the drag throws upward off the surface: flip it with gravity
    this.drag.cfg.gravityY = -Math.abs(this.drag.cfg.gravityY) * g;
    this.drag.cfg.angle = g > 0 ? 90 : 270;
    this.shipDrag.x = p.x;
    this.shipDrag.y = p.y - 15 * size * g;

    // --- ground drag (`update` +3784..3852, stop after 0.06 s at +1940..2052) ---
    if (ground && p.onGround) {
      this.dragGrace = 0.06;
      if (!this.drag.active) this.drag.resume();
    } else if (this.drag.active) {
      this.dragGrace -= dt;
      if (this.dragGrace <= 0) this.drag.stop();
    }

    // --- vehicle flame, ship thrust, ship drag (`update` +1776..2160) ---
    const vehicle = p.mode === "ship" || p.mode === "ufo";
    if (vehicle && !this.flame.active) this.flame.resume();
    if (!vehicle && this.flame.active) this.flame.stop();
    const thrusting = p.mode === "ship" && holding;
    if (thrusting && !this.thrust.active) this.thrust.resume();
    if (!thrusting && this.thrust.active) this.thrust.stop();
    const sliding = vehicle && p.onGround;
    if (sliding && !this.shipDrag.active) this.shipDrag.resume();
    if (!sliding && this.shipDrag.active) this.shipDrag.stop();

    // --- robot boost (`update` +2308..2664) ---
    if (robotCharging && !this.robotBurst.active) this.robotBurst.resume();
    if (!robotCharging && this.robotBurst.active) this.robotBurst.stop();

    // --- landing (`hitGround` +484..940) ---
    if (p.onGround && !this.wasGround && ground) {
      const e = this.land[this.landNext];
      this.landNext ^= 1;
      if (e.count <= 2) {
        e.cfg.angle = g > 0 ? this.landAngle : -this.landAngle;
        e.cfg.gravityY = g > 0 ? this.landGravityY : -this.landGravityY;
        e.x = p.x;
        e.y = p.y - 15 * size * g;
        e.reset();
      }
      // `hitGround` +1588: landing ends the streak
      if (!flying) this.streakOn = false;
    }
    this.wasGround = p.onGround;

    // --- dash: native startDashing/resumeSystem, stopDashing/stopSystem ---
    // p.x/y are already world coordinates. Transform only the local dash
    // direction: dashSlope already encodes gravity, and must not be flipped
    // a second time. The plist's 180° spray is relative to this node rotation.
    if (p.dash) {
      const d = dashWorldDirection(p);
      this.dash.x = p.x;
      this.dash.y = p.y;
      this.dash.rotation = -Math.atan2(d.y, d.x) * 180 / Math.PI;
      this.dash.scale = size;
      if (!this.dash.active) this.dash.resume();
      // startDashing deactivates the normal streak, even for flying modes.
      this.streakOn = false;
    } else if (this.dash.active) this.dash.stop();

    // --- swing direction-change burst (`[0x8a0]`/`[0x8a8]`) ---
    if (p.mode === "swing") {
      if (this.wasSwing && p.gravityFlipped !== this.lastSwingGravity) {
        this.triggerSwingBurst(p.x, p.y, p.mini, p.gravityFlipped);
      }
      this.lastSwingGravity = p.gravityFlipped;
      this.wasSwing = true;
    } else {
      this.wasSwing = false;
    }

    for (const e of this.emitters()) e.update(dt);

    // --- the streak ---
    if (!p.dash && (this.streakOn || flying)) this.streak.setPosition(p.x, p.y);
    this.streak.update(dt);

    // --- the wave trail ---
    this.wave.update(p, speed, dt);
  }
}

/* ---------------- the wave trail (HardStreak) ---------------- */

/**
 * `HardStreak` (`updateStroke` m1 `0x8da3c`): the wave's solid trail, a
 * `CCDrawNode` redrawn every frame as quads between the points where the wave
 * changed direction (`addPoint` from `PlayerObject`) and the player's current
 * position, in two passes — the first wider and opaque, the second narrower
 * at 0.65 opacity — and cleared behind the camera.
 * APPROXIMATION: the pass widths (6 then 2, times the wave size) are read
 * as half-widths, the colour is colour 1, and the music pulse
 * (`m_pulseSize`) is not modelled.
 */
export class WaveTrail {
  private readonly xs = new Float32Array(512);
  private readonly ys = new Float32Array(512);
  count = 0;
  color: [number, number, number] = [255, 255, 255];
  private lastDir = 0;
  active = false;
  headX = 0;
  headY = 0;
  size = 1;

  reset() {
    this.count = 0;
    this.lastDir = 0;
    this.active = false;
  }

  private push(x: number, y: number) {
    if (this.count === this.xs.length) {
      this.xs.copyWithin(0, 1);
      this.ys.copyWithin(0, 1);
      this.count--;
    }
    this.xs[this.count] = x;
    this.ys[this.count] = y;
    this.count++;
  }

  update(p: PlayerView, _speed: number, _dt: number) {
    if (p.mode !== "wave") { this.active = false; return; }
    this.size = p.mini ? 0.6 : 1;
    const dir = Math.sign(p.yVel);
    if (!this.active) {
      this.active = true;
      this.count = 0;
      this.push(p.x, p.y);
      this.lastDir = dir;
    } else if (dir !== this.lastDir) {
      this.push(p.x, p.y);
      this.lastDir = dir;
    }
    this.headX = p.x;
    this.headY = p.y;
  }

  /** `clearBehindXPos`: drop points that have scrolled off the left edge */
  clearBehind(x: number) {
    let drop = 0;
    while (drop < this.count - 1 && this.xs[drop + 1] < x) drop++;
    if (drop > 0) {
      this.xs.copyWithin(0, drop, this.count);
      this.ys.copyWithin(0, drop, this.count);
      this.count -= drop;
    }
  }

  /** each segment, oldest first, ending at the live head */
  forEachSegment(fn: (x0: number, y0: number, x1: number, y1: number) => void) {
    if (!this.active || this.count === 0) return;
    for (let i = 0; i < this.count; i++) {
      const x1 = i + 1 < this.count ? this.xs[i + 1] : this.headX;
      const y1 = i + 1 < this.count ? this.ys[i + 1] : this.headY;
      fn(this.xs[i], this.ys[i], x1, y1);
    }
  }
}

/* ---------------- death (PlayerObject::playDeathEffect 0x1b7e94) ---------------- */

/**
 * Death effect 1, the default (`playDeathEffect` +244..1216):
 *
 * - the icon fades out over 0.05 s;
 * - `playerExplosion_01_001` at the player, z 10000, scale
 *   `s · (1.5 ± 0.2)` and rotation `±45°`, where `s` is the vehicle size
 *   (`size < 1 ? size : 0.9·size`), animated through frames 1 (or 2, a coin
 *   flip) to 11 at `0.05 + 0.01·rand` s each, fading out over the last half;
 *   the sprite is **not tinted and not additive**;
 * - `explodeEffect.plist`, grouped, yellow → red, speed ×0.8, scaled `s`;
 * - two circle waves: yellow `10·s → 110·s` over 0.6 s at opacity 0.6, and
 *   orange `10·s → 115·s` over 0.4 s.
 */
export const DEATH_FRAME_DELAY = 0.05;
export const DEATH_FRAME_DELAY_VAR = 0.01;
export const DEATH_SCALE = 1.5;
export const DEATH_SCALE_VAR = 0.2;
export const DEATH_ROTATION_VAR = 45;
export const DEATH_LAST_FRAME = 11;

export function deathVehicleScale(size: number): number {
  return size < 1 ? size : size * 0.9;
}

export function deathExplosion(lib: EffectLibrary, x: number, y: number, size: number): CCEmitter {
  const e = new CCEmitter(lib.get("explodeEffect")!);
  e.positionType = "grouped";
  e.cfg.startColor = [1, 1, 0, 1];
  e.cfg.endColor = [1, 0, 0, 1];
  e.cfg.startColorVar = [0, 0, 0, 0];
  e.cfg.endColorVar = [0, 0, 0, 0];
  e.cfg.speed *= 0.8;
  e.scale = deathVehicleScale(size);
  e.x = x;
  e.y = y;
  e.reset();
  return e;
}

export const DEATH_WAVES = [
  { from: 10, to: 110, duration: 0.6, color: [255, 255, 0] as const, opacity: 0.6 },
  { from: 10, to: 115, duration: 0.4, color: [255, 150, 0] as const, opacity: 1 },
] as const;

/* ---------------- objects' own particles (GameObject::customSetup 0x4e866c) ---------------- */

export interface ObjectParticleSpec {
  plist: EffectName;
  start?: [number, number, number, number];
  end?: [number, number, number, number];
}

/**
 * Which plist `customSetup` gives each `GameObjectType` through
 * `createAndAddParticle(type, plist, tag, grouped)`, and the colours it then
 * sets. Partly sourced: the plist per type and the start colours are read at
 * each call site; where a site shares its tail with other cases the colour
 * could not be attributed and the plist's own is used (APPROXIMATION), and
 * end colours are the ones read immediately after where one exists.
 */
const c = (r: number, g: number, b: number, a = 1): [number, number, number, number] => [r, g, b, a];
/**
 * A9, resolved. Task 2 could not attribute a colour to the sites that "share
 * their tail with other cases". Interpreting `GameObject::customSetup`'s switch
 * for every object id 1..4699 attributes all **31** of its
 * `createAndAddParticle` (m1 `0x4eb5ec`) call sites to exact ids, and the
 * `ccColor4F` vectors loaded right after each call give the colours:
 *
 * | site | plist | ids | start -> end |
 * |---|---|---|---|
 * | `0x4ea070` | portalEffect02 | 747, 2902 | (0,255,255) -> (0,100,150) |
 * | `0x4ea374` | portalEffect02 | 45 | (255,150,0) |
 * | `0x4ea454` | portalEffect02 | 745 | (150,150,150) -> (50,50,75) |
 * | `0x4ea54c` | ringEffect | 36 | (255,200,50) -> (255,100,25) |
 * | `0x4ea5e8` | portalEffect02 | 47 | (255,100,0) |
 * | `0x4ea6cc` | ringEffect | 84 | (0,255,255) -> (0,125,255) |
 * | `0x4ea7f4` | portalEffect02 | 1933 | (255,255,0) -> (255,200,0) |
 * | `0x4ea97c` | bumpEffect | 140 | (255,0,255) |
 * | `0x4eaad4` | bumpEffect | 67 | (0,255,255) |
 * | `0x4eade4` | portalEffect02 | 1331 | (200,0,255) |
 * | `0x4eae84` | bumpEffect | 1332 | (255,50,50) |
 * | `0x4eb0d0` | ringEffect | 1594 | (255,200,50) -> (255,100,25) |
 * | `0x4eb198` | ringEffect | 141 | (255,100,255) -> (255,0,175) |
 * | `0x4eb224` | portalEffect02 | 660 | (0,200,255) -> (0,100,255) |
 * | `0x4eb328` | ringEffect | 1333 | (255,100,25) -> (255,0,0) |
 * | `0x4eb440` | portalEffect09 | 286 | (255,200,0) -> (255,100,0) |
 *
 * and the sites that set **no** colour — 10-13/46 (portalEffect03), 35
 * (bumpEffect), 99/101 (portalEffect08), 111/749/2064 (portalEffect02), 287
 * (portalEffect09), 200-203/1334 (boost_01..04 — see `SPEED_PORTAL_PARTICLES`), 1586 (fireballEffect), 1700
 * (bubbleEffect), 4401+ (keyEffect) — are **correct as they are**: the plist's
 * own colours are what the original draws. Every entry below that Task 2
 * already had matches; the two that were missing (the mirror and ball portals)
 * are added.
 */
export const OBJECT_PARTICLES: ReadonlyMap<number, ObjectParticleSpec> = new Map<number, ObjectParticleSpec>([
  [3, { plist: "portalEffect02" }],                       // inverse gravity portal
  [4, { plist: "portalEffect01" }],                       // normal gravity portal
  [5, { plist: "portalEffect04" }],                       // ship portal
  [6, { plist: "portalEffect03" }],                       // cube portal
  [8, { plist: "bumpEffect" }],                           // yellow pad
  [9, { plist: "bumpEffect", start: c(1, 0, 1) }],        // pink pad
  [10, { plist: "bumpEffect", start: c(0, 1, 1) }],       // gravity pad
  [11, { plist: "ringEffect", start: c(1, 0.784, 0.196), end: c(1, 0.392, 0.098) }], // yellow ring
  [12, { plist: "ringEffect", start: c(1, 0.392, 1), end: c(1, 0, 0.686) }],          // pink ring
  [13, { plist: "ringEffect", start: c(0, 1, 1), end: c(0, 0.49, 1) }],               // gravity ring
  [14, { plist: "portalEffect02", start: c(1, 0.588, 0) }],                          // inverse mirror
  [15, { plist: "portalEffect01" }],                      // normal mirror
  [16, { plist: "portalEffect02", start: c(1, 0.392, 0) }],                          // ball portal
  [17, { plist: "portalEffect08" }],                      // regular size
  [18, { plist: "portalEffect09" }],                      // mini size
  [19, { plist: "portalEffect02" }],                      // UFO portal
  [23, { plist: "portalEffect09", start: c(1, 0.784, 0), end: c(1, 0.392, 0) }],     // dual
  [24, { plist: "portalEffect09" }],                      // solo
  [26, { plist: "portalEffect02", start: c(0, 0.784, 1), end: c(0, 0.392, 1) }],     // wave
  [27, { plist: "portalEffect02", start: c(0.588, 0.588, 0.588), end: c(0.196, 0.196, 0.294) }], // robot
  [33, { plist: "portalEffect02", start: c(0.784, 0, 1) }],                          // spider
  [34, { plist: "bumpEffect", start: c(1, 0.196, 0.196) }],                           // red pad
  [35, { plist: "ringEffect", start: c(1, 0.392, 0.098), end: c(1, 0, 0) }],          // red ring
  [41, { plist: "portalEffect02", start: c(1, 1, 0), end: c(1, 0.784, 0) }],          // swing
]);

/**
 * Speed portals get their emitter by **id**, one boost plist each, with no
 * colour of their own: `customSetup`'s `createAndAddParticle` calls read
 * under the emulator (2026-09-29) — 200 → boost_01, 201 → boost_02,
 * 202 → boost_03, 203 and 1334 → boost_04 (the table above had lumped them
 * all under boost_04 and never drew them).
 */
export const SPEED_PORTAL_PARTICLES: ReadonlyMap<number, EffectName> = new Map<number, EffectName>([
  [200, "boost_01_effect"], [201, "boost_02_effect"], [202, "boost_03_effect"],
  [203, "boost_04_effect"], [1334, "boost_04_effect"],
]);

/** an object's ambient emitter, grouped at the object and turned with it */
export function objectEmitter(lib: EffectLibrary, type: number, id?: number): CCEmitter | null {
  const speed = id !== undefined ? SPEED_PORTAL_PARTICLES.get(id) : undefined;
  if (speed) {
    const cfg = lib.get(speed);
    if (!cfg) return null;
    const e = new CCEmitter(cfg);
    e.positionType = "grouped";
    return e;
  }
  const spec = OBJECT_PARTICLES.get(type);
  if (!spec) return null;
  const e = new CCEmitter(lib.get(spec.plist)!);
  e.positionType = "grouped";
  if (spec.start) e.cfg.startColor = [...spec.start];
  if (spec.end) e.cfg.endColor = [...spec.end];
  return e;
}

/* ---------------- orb activation (PlayerObject::ringJump +2160..2360) ---------------- */

/**
 * `ringJump` drops a filled, fading-in `CCCircleWave(35 → 5, 0.35 s)` on the
 * orb it fired (42 → 5 for the red ring), following the orb, in a colour per
 * type: yellow `(255, 200, 0)`, pink `(255, 0, 255)`, gravity `(0, 255, 255)`,
 * green `(0, 255, 0)`, red `(255, 100, 0)`, dash `(0, 255, 0)`, gravity dash
 * `(255, 0, 255)`, spider `(255, 50, 255)`. The drop ring takes colour channel
 * 1007 (`activeColorForIndex(1007)`); a custom ring its own colour.
 */
export function orbWaveColor(type: number): [number, number, number] | null {
  switch (type) {
    case 12: return [255, 0, 255];
    case 13: return [0, 255, 255];
    case 29: return [0, 255, 0];
    case 35: return [255, 100, 0];
    case 37: return [0, 255, 0];
    case 38: return [255, 0, 255];
    case 43: return [255, 50, 255];
    case 32: return null; // channel 1007, resolved by the scene
    default: return [255, 200, 0];
  }
}
export function orbWaveFrom(type: number): number {
  return type === 35 ? 42 : 35;
}
export const ORB_WAVE_TO = 5;
export const ORB_WAVE_DURATION = 0.35;

/* ---------------- speed portals (GJBaseGameLayer::playSpeedParticle 0x12bb74) ---------------- */

/**
 * The speed-change streaks: `speedEffect_{slow,normal,fast,vfast,vvfast}`
 * for speed mods 0.7 / 0.9 / 1.1 / 1.3 / 1.6, grouped, auto-removing, on the
 * game layer in screen space at `(screenRight + 10, winH / 2)` (+52..312).
 */
export function speedEffectFor(index: number): EffectName {
  return (["speedEffect_slow", "speedEffect_normal", "speedEffect_fast",
    "speedEffect_vfast", "speedEffect_vvfast"] as const)[Math.max(0, Math.min(4, index))];
}

/**
 * Screen shake.
 *
 * Decays exponentially and is sampled per frame, so the offset is not tied to
 * the physics step. `add` takes the *strength* in world units; repeated calls
 * take the strongest rather than summing, so two shakes at once cannot stack
 * into something unreadable.
 */
export class Shake {
  strength = 0;
  private t = 0;
  x = 0;
  y = 0;

  add(strength: number) {
    this.strength = Math.max(this.strength, strength);
  }

  reset() {
    this.strength = 0;
    this.x = this.y = 0;
  }

  /** TUNED: how fast a shake dies away (fraction remaining after one second) */
  static readonly DECAY = 0.0009;

  update(dt: number) {
    if (this.strength <= 0.01) {
      this.strength = 0;
      this.x = this.y = 0;
      return;
    }
    this.t += dt;
    this.strength *= Math.pow(Shake.DECAY, dt);
    // two different frequencies so it does not read as a clean oscillation
    this.x = Math.sin(this.t * 61) * this.strength;
    this.y = Math.cos(this.t * 47) * this.strength;
  }
}

/**
 * TUNED: how hard dying shakes the screen, in world units. `playDeathEffect`'s
 * classic branch calls no `shakeCamera`; where the original's death shake
 * comes from (`PlayLayer::destroyPlayer`?) was not traced — on the Phase 3 list.
 */
export const DEATH_SHAKE = 9;

/* ---------------- one-shot emitters ---------------- */

/**
 * Emitters that outlive their trigger — a death burst, a coin pickup, the
 * speed-portal streaks, the ending's fireworks: the original creates them with
 * `setAutoRemoveOnFinish(true)`, and they remove themselves once stopped and
 * empty. `screen` ones are drawn with the HUD's camera.
 */
export class EffectPool {
  readonly live: { e: CCEmitter; screen: boolean; anchorRight: boolean }[] = [];

  /** `anchorRight`: a screen emitter pinned just off the right edge, whatever the width */
  add(e: CCEmitter, screen = false, anchorRight = false): CCEmitter {
    this.live.push({ e, screen, anchorRight });
    return e;
  }

  update(dt: number) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const { e } = this.live[i];
      e.update(dt);
      if (!e.active && e.count === 0) this.live.splice(i, 1);
    }
  }

  clear() {
    this.live.length = 0;
  }
}

/** a configured emitter, tinted (start and end, alpha kept) when a colour is given */
export function oneShot(lib: EffectLibrary, name: EffectName, x: number, y: number,
  tint?: readonly [number, number, number]): CCEmitter {
  const e = new CCEmitter(lib.get(name)!);
  e.positionType = "grouped";
  if (tint) {
    e.cfg.startColor = [tint[0] / 255, tint[1] / 255, tint[2] / 255, 1];
    e.cfg.endColor = [tint[0] / 255, tint[1] / 255, tint[2] / 255, 1];
  }
  e.x = x;
  e.y = y;
  e.reset();
  return e;
}

/* ---------------- glitter (PlayLayer::m_glitterParticles) ---------------- */

/**
 * The flying modes' **glitter**: small additive squares drifting across the
 * whole screen. From the 2.2081 binary and a native scene dump (Theory of
 * Everything 9%, 2026-10-03: a `CCParticleSystemQuad` centred on the screen):
 *
 * - `PlayLayer` setup (m1 0x9b33c) creates it from `glitterEffect.plist`,
 *   position type relative, in the object layer at z 0, stopped; its
 *   position variance is (winW / 1.8, winH / 2), divided by the camera zoom
 *   when that changes (m1 0x1225d0);
 * - its start colour is player 1's colour at full alpha and its end colour
 *   black (m1 0x9ca14–0x9ca5c);
 * - every frame it sits at the camera's centre (m1 0xa810c);
 * - `toggleGlitter` (m1 0xa7504) runs it: the level start turns it on in the
 *   ship, wave, swing and UFO (`setupLevelStart` m1 0xfc7e8…), and
 *   `playerWillSwitchMode` (m1 0xfd58c) turns it off at any portal whose type
 *   is not one of those four's — so it shows exactly while flying.
 */
export const GLITTER_MODES: ReadonlySet<string> = new Set(["ship", "ufo", "wave", "swing"]);

export function glitterEmitter(lib: EffectLibrary): CCEmitter | null {
  const cfg = lib.get("glitterEffect");
  if (!cfg) return null;
  const e = new CCEmitter(cfg);
  e.positionType = "relative";
  e.cfg.endColor = [0, 0, 0, 1];
  e.stop();
  return e;
}
