/**
 * Dash presentation decoded from GD 2.209 arm64, not certified 2.2081 parity.
 * Image-relative addresses (without 0x100000000):
 *   updateDashArt 0x378dcc: mode offsets/scales, fall_loop, ±288°/.3s icon spin.
 *   startDashing 0x3798dc..0x3799c4: scale (.3,.2) ->
 *     (baseX*1.1*.9, baseY*1.2*1.2) in .1s -> (baseX*1.1,baseY*1.2) in .1s.
 *   0x379a00..0x379d4c: detached additive boom, nine .05s frames, scale1.2,
 *     fade delay .2 + .3s; the animate/remove action ends it at .45s.
 *   0x379df8..0x379e34: white flame, delay .1, kit-color tint over .2s.
 *   updateDashAnimation 0x36bbf8: totalTime, float32 interval/quotient, 12 frames.
 *   stopDashing 0x36bf2c..0x36c188: detached frame1 + outline opacity150,
 *     scale to20%, world-x move -20, fade, all over .2s.
 * No atlas/DOM/RNG dependencies. Own one state per player, outside simulation.
 */
import type { Gamemode } from "./gamemodes.ts";
import { SPEEDS } from "./physics.ts";
import { toWorld } from "../game/frame.ts";

const DEG = Math.PI / 180;
export const DASH_ENTRY_DURATION = 9 * 0.05;
export const DASH_EXIT_DURATION = 0.2;
export const DASH_OUTLINE_ALPHA = 150 / 255;

export interface DashArtPlayer {
  /** World coordinates, not the simulation's temporary local coordinates. */
  readonly x: number;
  readonly y: number;
  readonly mode: Gamemode;
  readonly mini: boolean;
  readonly gravityFlipped: boolean;
  readonly sideways?: boolean;
  readonly reversed?: boolean;
  readonly dash?: 0 | 1 | 2;
  /** Already resolved local gravity-axis distance per forward travel unit. */
  readonly dashSlope?: number;
}

export function dashModeArt(mode: Gamemode) {
  switch (mode) {
    case "ship": return { x: 0, y: -2, scaleX: 1, scaleY: 0.85 };
    case "ufo": return { x: 0, y: 0, scaleX: 0.95, scaleY: 0.9 };
    case "robot": return { x: 1, y: 0, scaleX: 0.9, scaleY: 0.85 };
    case "spider": return { x: 1, y: 0, scaleX: 0.95, scaleY: 0.8 };
    default: return { x: 0, y: 0, scaleX: 0.9, scaleY: 0.8 };
  }
}

/** Convert the port's speed rows to native m_playerSpeed, NOT world units/sec. */
export function nativeDashSpeed(worldSpeed: number): number {
  return [0.7, 0.9, 1.1, 1.3, 1.6][(SPEEDS as readonly number[]).indexOf(worldSpeed)] ?? 0.9;
}

/** Native local flame-node rotation in clockwise degrees, normally within ±70. */
export function dashFrameInterval(nativeSpeed: number, flameRotation: number): number {
  const f = Math.fround;
  const base = f(f(0.04) / f(nativeSpeed));
  const factor = f(f(Math.abs(f(flameRotation)) / -70) * f(0.4) + 1);
  return f(base * factor);
}

export function dashFrameIndex(totalTime: number, nativeSpeed: number, flameRotation: number): number {
  return Math.floor(Math.fround(totalTime / dashFrameInterval(nativeSpeed, flameRotation))) % 12 + 1;
}

/** Unit direction in world space; gravity must not be applied to dashSlope again. */
export function dashWorldDirection(p: DashArtPlayer) {
  const angle = Math.atan(p.dashSlope ?? 0);
  return toWorld({ sideways: p.sideways ?? false, reversed: p.reversed ?? false }, Math.cos(angle), Math.sin(angle));
}

export interface DashLoopPose {
  readonly x: number;
  readonly y: number;
  /** Radians CCW, renderer convention. Signed scaleY carries reflected frames. */
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly frame: number;
  /** Native entrance: white for .1s, then tint to the selected kit color over .2s. */
  readonly kitColorMix: number;
  readonly playerAnimation: "fall_loop" | null;
  /** Cube/ball icon children are scaled to .9 by updateDashArt; others unchanged. */
  readonly playerScale: number;
  /** Native icon-child rotation action, clockwise degrees; compose with root pose. */
  readonly iconSpin: number;
}

export interface DashArtOptions {
  readonly paused?: boolean;
  readonly effectsEnabled?: boolean;
  /** Native boom starts at the activating orb's resolved world centre. */
  readonly entryPosition?: { readonly x: number; readonly y: number };
  /** Supply the actual local node rotation if available; see fallback below. */
  readonly flameRotation?: number;
}

export function dashLoopPose(p: DashArtPlayer, totalTime: number, nativeSpeed: number,
  age: number, options: DashArtOptions = {}): DashLoopPose {
  const art = dashModeArt(p.mode), size = p.mini ? 0.6 : 1;
  const angle = Math.atan(p.dashSlope ?? 0), g = p.gravityFlipped ? -1 : 1;
  const frame = { sideways: p.sideways ?? false, reversed: p.reversed ?? false };
  const direction = dashWorldDirection(p);
  const normal = toWorld(frame, -Math.sin(angle) * g, Math.cos(angle) * g);
  const handedness = direction.x * normal.y - direction.y * normal.x;
  const targetX = art.scaleX * 1.1, targetY = art.scaleY * 1.2;
  let sx = targetX, sy = targetY;
  if (age < 0.1) {
    // APPROXIMATION: the first native action has a rate-2 easing wrapper;
    // its exact easing class is unresolved. Linear interpolation preserves the
    // decoded start/target/duration, without claiming a verified easing curve.
    const t = Math.max(0, age / 0.1);
    sx = 0.3 + (targetX * 0.9 - 0.3) * t;
    sy = 0.2 + (targetY * 1.2 - 0.2) * t;
  } else if (age < 0.2) {
    const t = (age - 0.1) / 0.1;
    sx = targetX * (0.9 + 0.1 * t);
    sy = targetY * (1.2 - 0.2 * t);
  }
  // APPROXIMATION: without a native node hierarchy, infer local flame rotation
  // from dashSlope. Callers can override it; world camera/reversal angles must
  // never enter the native cadence formula.
  const flameRotation = options.flameRotation ?? -angle / DEG;
  const spins = p.mode === "cube" || p.mode === "ball";
  return {
    x: p.x + (direction.x * art.x + normal.x * art.y) * size,
    y: p.y + (direction.y * art.x + normal.y * art.y) * size,
    rotation: Math.atan2(direction.y, direction.x),
    scaleX: sx * size, scaleY: sy * size * handedness,
    frame: dashFrameIndex(totalTime, nativeSpeed, flameRotation),
    kitColorMix: Math.min(1, Math.max(0, (age - 0.1) / 0.2)),
    playerAnimation: p.mode === "robot" || p.mode === "spider" ? "fall_loop" : null,
    playerScale: spins ? 0.9 : 1,
    iconSpin: spins ? (frame.sideways === p.gravityFlipped ? 288 : -288) * age / 0.3 : 0,
  };
}

export interface DashEntry {
  readonly x: number; readonly y: number; readonly rotation: number;
  readonly age: number; readonly dash: 1 | 2;
}
export interface DashRemnant { readonly age: number; readonly pose: DashLoopPose }
export interface DashArtState {
  /** Native totalTime advances even outside dashes, but never during pause. */
  readonly totalTime: number;
  readonly age: number;
  readonly loop: DashLoopPose | null;
  readonly entries: readonly DashEntry[];
  readonly remnants: readonly DashRemnant[];
}

/** Reset/rewind: replace the state; optionally seed the restored native clock. */
export function createDashArt(totalTime = 0): DashArtState {
  return { totalTime, age: 0, loop: null, entries: [], remnants: [] };
}

/**
 * Observe transitions at the END of dt, so newly created actions start at age0.
 * For exact event timing, observe with dt0 at the activation/release boundary,
 * then advance subsequent intervals. Process each player's physics-step states
 * to avoid losing a start+stop that occurs within one rendered frame.
 */
export function stepDashArt(state: DashArtState, dt: number, p: DashArtPlayer,
  nativeSpeed: number, options: DashArtOptions = {}): DashArtState {
  if (options.paused) return state;
  dt = Math.max(0, dt);
  const totalTime = state.totalTime + dt;
  const entries = state.entries.map((e) => ({ ...e, age: e.age + dt })).filter((e) => e.age < DASH_ENTRY_DURATION);
  const remnants = state.remnants.map((e) => ({ ...e, age: e.age + dt })).filter((e) => e.age < DASH_EXIT_DURATION);
  const active = !!p.dash;
  const age = active && state.loop ? state.age + dt : 0;
  const loop = active ? dashLoopPose(p, totalTime, nativeSpeed, age, options) : null;
  if (options.effectsEnabled !== false) {
    if (loop && !state.loop) {
      // APPROXIMATION when omitted: the player's centre stands in for the orb.
      const pos = options.entryPosition ?? p;
      entries.push({ x: pos.x, y: pos.y, rotation: loop.rotation, age: 0, dash: p.dash === 2 ? 2 : 1 });
    } else if (!loop && state.loop) {
      // Snapshot the last supplied active pose; sample at the stop boundary to
      // obtain native placement, rather than using a later render-frame pose.
      remnants.push({ age: 0, pose: state.loop });
    }
  }
  return { totalTime, age, loop, entries, remnants };
}

export interface DashSpritePose {
  readonly kind: "flame" | "outline" | "entry";
  readonly sheet: "glow" | "game04";
  readonly frame: string;
  readonly x: number; readonly y: number;
  readonly rotation: number;
  readonly scaleX: number; readonly scaleY: number;
  readonly alpha: number;
  readonly blend: "additive";
  /** For flame/remnant: lerp white -> selected kit RGB by this amount. */
  readonly kitColorMix?: number;
  /** Entry tint is native; loop/remnant tint is selected by the caller. */
  readonly color?: readonly [number, number, number];
}

/** Sprite transforms are world/node units. Multiply atlas px by HD once only. */
export function dashArtSprites(state: DashArtState): DashSpritePose[] {
  const out: DashSpritePose[] = [];
  const pair = (pose: DashLoopPose, alpha: number, outlineAlpha: number) => {
    const n = String(pose.frame).padStart(3, "0");
    out.push({ ...pose, kind: "flame", sheet: "glow", frame: `playerDash2_${n}.png`, alpha, blend: "additive" });
    out.push({ ...pose, kind: "outline", sheet: "glow", frame: `playerDash2_outline_${n}.png`, alpha: outlineAlpha, kitColorMix: 0, blend: "additive" });
  };
  // APPROXIMATION: attached outline opacity uses the decoded detached opacity;
  // white outline tint and attached opacity/blend need a native capture audit.
  if (state.loop) pair(state.loop, 1, DASH_OUTLINE_ALPHA);
  for (const e of state.remnants) {
    const t = e.age / DASH_EXIT_DURATION, k = 1 - 0.8 * t;
    pair({ ...e.pose, frame: 1, x: e.pose.x - 20 * t,
      scaleX: e.pose.scaleX * k, scaleY: e.pose.scaleY * k }, 1 - t, DASH_OUTLINE_ALPHA * (1 - t));
  }
  for (const e of state.entries) {
    const tint = Math.min(1, e.age / 0.3);
    out.push({ kind: "entry", sheet: "game04", frame: `playerDash2_boom2_${String(Math.floor(e.age * 20) + 1).padStart(3, "0")}.png`,
      x: e.x, y: e.y, rotation: e.rotation, scaleX: 1.2, scaleY: 1.2,
      alpha: 1 - Math.max(0, (e.age - 0.2) / 0.3), blend: "additive",
      color: e.dash === 1 ? [1 - tint, 1, 1 - tint] : [1, 1 - tint, 1] });
  }
  return out;
}
