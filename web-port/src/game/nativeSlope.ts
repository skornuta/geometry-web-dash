// Drives the transcribed `collidedWithSlopeInternal` (src/gd/slopeCollision.ts)
// from the port's step: the per-player native slope fields, a view that maps
// the port's PlayerState onto `SlopePlayer`, and the two halves of the game's
// per-step bookkeeping around the collision pass:
//
//   `PlayerObject::preCollision`  (m1 0x37c100) — ages the slope flags
//   `PlayerObject::postCollision` (m1 0x37c258) — the ride-end launch and
//                                  clearing the slope once it is left
//
// Units: the routine is in the game's raw units; the port's velocities are
// world units (raw x RAW_VELOCITY). Positions are the port's, which only differ
// from GD's by a constant in y. The step is 1/240 s = dt 0.25 (60 Hz frames).
import type { Collider } from "./collision.ts";
import type { PlayerState } from "../gd/gamemodes.ts";
import { RAW_VELOCITY, SPEED_PHYSICS, SPEEDS, RISE_THRESHOLD } from "../gd/physics.ts";
import {
  round3, type Rect, type SlopeHost, type SlopeObject, type SlopePlayer,
} from "../gd/slopeCollision.ts";

const f = Math.fround;

/**
 * On by default: native replays 29 -> 16 resync faults, sweep unchanged at
 * 21/22. `NATIVE_SLOPES=0` restores the old model (`resolveSlope`) for comparison.
 */
export const NATIVE_SLOPES: boolean =
  (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.NATIVE_SLOPES !== "0";

/** the game's step, in 60 Hz frames */
export const NATIVE_DT = 0.25;

/** the `PlayerObject` slope fields that persist between steps */
export interface NativeSlopeState {
  time: number;
  isOnSlope: boolean; wasOnSlope: boolean;
  slopeVelocity: number; slopeRotation: number; currentSlopeYVelocity: number;
  slopeStoredY: number; slopeStoredY2: number;
  slopeDifferent: boolean; slopeLedge: boolean; isCurrentSlopeTop: boolean;
  collidedTopMinY: number; collidedBottomMaxY: number;
  isColliding: boolean;
  upsideDownSlope: boolean;
  isOnGround2: boolean;
  slidingTime: number;
  currentSlope: SlopeObject | null; currentPotentialSlope: SlopeObject | null;
  collidingWithSlopeId: number; slopeFlipGravityRelated: boolean;
  slopeAngleRadians: number; slopeYOffset: number;
  potentialSlopes: Map<number, SlopeObject>;
  slopeCollidedWith: boolean;
  isBallRotating: boolean; rotationSpeed: number; rotateSpeed: number; isRotating: boolean;
  lastCollisionBottom: number; lastCollisionTop: number;
  lastGroundObject: SlopeObject | null; lastGroundSlopeAngle: number; lastGroundSlopeTop: boolean;
  groundYVelocity: number; yVelocityBeforeSlope: number; slopeStartTime: number;
  gameModeChangedTime: number; lastFlipTime: number;
  /** the mode last step, to date a change */
  lastMode?: string;
}

export function newNativeSlopeState(): NativeSlopeState {
  return {
    time: 0, isOnSlope: false, wasOnSlope: false,
    slopeVelocity: 0, slopeRotation: 0, currentSlopeYVelocity: 0,
    slopeStoredY: 0, slopeStoredY2: 0, slopeDifferent: false, slopeLedge: false, isCurrentSlopeTop: false,
    collidedTopMinY: 0, collidedBottomMaxY: 0, isColliding: false, upsideDownSlope: false,
    isOnGround2: false, slidingTime: 0,
    currentSlope: null, currentPotentialSlope: null, collidingWithSlopeId: 0, slopeFlipGravityRelated: false,
    slopeAngleRadians: 0, slopeYOffset: 0, potentialSlopes: new Map(), slopeCollidedWith: false,
    isBallRotating: false, rotationSpeed: 0, rotateSpeed: 0, isRotating: false,
    lastCollisionBottom: 0, lastCollisionTop: 0, lastGroundObject: null, lastGroundSlopeAngle: 0,
    lastGroundSlopeTop: false, groundYVelocity: 0, yVelocityBeforeSlope: 0, slopeStartTime: 0,
    gameModeChangedTime: 0, lastFlipTime: 0,
  };
}

export function cloneNativeSlope(ns: NativeSlopeState): NativeSlopeState {
  return { ...ns, potentialSlopes: new Map(ns.potentialSlopes) };
}

/** `preCollision` (m1 0x37c100), the slope part */
export function nativePreCollision(ns: NativeSlopeState): void {
  ns.collidedTopMinY = 0;
  ns.collidedBottomMaxY = 0;
  ns.wasOnSlope = ns.isOnSlope;
  ns.isOnSlope = false;
  if (ns.slopeCollidedWith) ns.currentPotentialSlope = null;
  else ns.slopeCollidedWith = true;
  ns.potentialSlopes.clear();
  if (ns.currentPotentialSlope) ns.potentialSlopes.set(ns.currentPotentialSlope.id, ns.currentPotentialSlope);
  if (ns.currentSlope) ns.potentialSlopes.set(ns.currentSlope.id, ns.currentSlope);
}

/**
 * A slope collider as the routine sees it. The type comes from the collider's
 * right-angle corner (after flips, rotation and — in a reversed run — the
 * local frame's mirror): types 4..7, which rotated slopes get, behave exactly
 * as the 0..3 of the same shape (same ceiling/tall-end bits and `top`).
 */
export function slopeObjectFor(c: Collider, cache: Map<number, SlopeObject>, prev?: { x: number; y: number }): SlopeObject {
  const s = c.slope!;
  // (cx, cy) is the right-angle corner: (1,-1) rises to the right = type 0
  const fx = s.cx < 0, fy = s.cy > 0;
  const type = fy ? (fx ? 3 : 1) : (fx ? 2 : 0);
  const top = type === 0 || type === 3;
  let o = cache.get(c.index);
  const rect: Rect = { x: f(c.x - c.hw), y: f(c.y - c.hh), w: f(2 * c.hw), h: f(2 * c.hh) };
  if (!o) {
    o = {
      id: c.index + 1, x: c.x, y: c.y, lastX: c.x, lastY: c.y, rect,
      slopeType: type, slopeTop: top, slopeOffset4: OFFSET4_IDS.has(c.id),
    };
    cache.set(c.index, o);
  }
  o.lastX = prev ? prev.x : c.x; o.lastY = prev ? prev.y : c.y;
  o.x = c.x; o.y = c.y; o.rect = rect; o.slopeType = type; o.slopeTop = top;
  return o;
}

/** slopes whose surface `slopeYPos` shifts by 4 (`[0x440]`, set in `customSetup`) */
const OFFSET4_IDS: ReadonlySet<number> = new Set([363, 364, 366, 367, 1717, 1718, 1723, 1724]);

export interface SlopeStepContext {
  /** the D / H blocks touched this step */
  dartSlide: boolean; hitHead: boolean;
  /** the player's box size for the routine (`getObjectRect`) */
  size: number;
  speed: number;
}

/** `PlayerObject` as the routine sees it, backed by the port's state */
export function slopePlayerView(p: PlayerState, ns: NativeSlopeState, ctx: SlopeStepContext): SlopePlayer {
  const row = SPEED_PHYSICS[Math.max(0, (SPEEDS as readonly number[]).indexOf(ctx.speed))] ?? SPEED_PHYSICS[1];
  const g = p.gravityFlipped ? -1 : 1;
  const view = {
    get x() { return p.x; }, set x(v: number) { p.x = v; },
    get y() { return p.y; }, set y(v: number) { p.y = v; },
    w: ctx.size, h: ctx.size,
    speedMultiplier: row.xVel, playerSpeed: f(row.mult),
    get gameModeChangedTime() { return ns.gameModeChangedTime; },
    canRunIntoBlocks: false,
    get lastFlipTime() { return ns.lastFlipTime; },
    get yVelocity() { return p.yVel / RAW_VELOCITY; },
    set yVelocity(v: number) { p.yVel = v * RAW_VELOCITY; },
    get isOnGround() { return p.onGround; }, set isOnGround(v: boolean) { p.onGround = v; },
    get jumpBuffered() { return p.queuedHold; }, set jumpBuffered(v: boolean) { p.queuedHold = v; },
    isShip: p.mode === "ship", isBird: p.mode === "ufo", isBall: p.mode === "ball", isDart: p.mode === "wave",
    isSwing: p.mode === "swing",
    isUpsideDown: p.gravityFlipped,
    isGoingLeft: false, isSideways: false,
    isDashing: p.dash !== 0,
    vehicleSize: p.mini ? f(0.6) : 1,
    // APPROXIMATION A42: `m_isBoosted` (+0x9cc) is set by a jump, pad, ring or
    // boost and cleared by `updateJump` once the rise drops under 2 x gravity
    // (m1 0x3777cc); taken here as "airborne and still rising that fast"
    isBoosted: !p.onGround && p.yVel * g >= RISE_THRESHOLD,
    get totalTime() { return ns.time; },
    platformerXVelocity: 0, isPlatformer: false,
    stateDartSlide: ctx.dartSlide ? 1 : 0, stateHitHead: ctx.hitHead ? 1 : 0,
    ignoreDamage: false,
  };
  // every other field lives on the native state itself
  return new Proxy(view as unknown as SlopePlayer, {
    get(t, k) { return k in t ? (t as never)[k] : (ns as never)[k]; },
    set(t, k, v) {
      if (k in t) (t as unknown as Record<string | symbol, unknown>)[k] = v;
      else (ns as unknown as Record<string | symbol, unknown>)[k] = v;
      return true;
    },
  });
}

/** outcomes the routine's callbacks produce, for the step to act on */
export interface SlopeOutcome {
  died: boolean;
  grounded: boolean;
  /** the 1-unit side / base strips `preSlopeCollision` resolves as solids */
  strips: Rect[];
}

export function slopeHost(out: SlopeOutcome): SlopeHost {
  return {
    collideSolid(_p, _o, r) { out.strips.push(r); },
    destroyPlayer() { out.died = true; throw DIED; },
    // `hitGround` lands the player: velocity zeroed (the routine restores a
    // real rise afterwards), on the ground
    hitGround(p) { p.yVelocity = 0; p.isOnGround = true; out.grounded = true; },
    updateSlopeRotation() { /* visual */ },
  };
}
export const DIED = Symbol("died");

/**
 * `postCollision` (m1 0x37c258): the slope part. Leaving a ramp launches the
 * player with the stored `m_slopeVelocity`, ramped up over the first 0.1 s on
 * it (`boostPlayer`); leaving a *descending* ramp keeps its descent speed.
 * Returns true when a launch set the velocity (the port's `noClamp`).
 */
export function nativePostCollision(p: PlayerState, ns: NativeSlopeState, view: SlopePlayer): boolean {
  let launched = false;
  if (ns.isOnSlope !== ns.wasOnSlope && !ns.isOnSlope) {
    const flip = p.gravityFlipped;
    const s0 = f(ns.slopeVelocity);
    const yv = view.yVelocity;
    const top = ns.isCurrentSlopeTop;
    // (the same test either way up, m1 0x37c3c0..0x37c464)
    let w8 = (s0 < 0 && yv > s0 && top) || (s0 > 0 && yv < s0 && !top);
    const boosted = view.isBoosted;
    if (boosted && !(view.isShip || view.isBird || view.isDart || view.isSwing)) w8 = view.isBall && w8;
    if (w8) {
      const d1 = ns.time - ns.slopeStartTime;
      const ramp = d1 < 0.1 ? Math.max(d1 * 10, 0.4) : 1;
      const v = f(ramp * s0);
      let go: boolean;
      // 0x37c544: which side of `v` the current velocity must be on
      const above = !flip ? top && ns.slopeFlipGravityRelated : top || !ns.slopeFlipGravityRelated;
      if (above) go = yv > v;
      else go = !(yv >= v);
      if (go) {
        // `boostPlayer(v)`
        view.yVelocity = round3(v);
        p.onGround = false;
        ns.isOnGround2 = false;
        launched = true;
      }
    } else {
      const fallAway = flip ? s0 > 0 : s0 < 0;
      if (fallAway && !boosted && !p.queuedHold && top === flip) {
        ns.isOnGround2 = false;
        const d0 = flip ? ns.currentSlopeYVelocity : -ns.currentSlopeYVelocity;
        view.yVelocity = round3(d0);
        p.onGround = false;
      }
    }
    ns.slopeVelocity = 0;
    ns.currentSlope = null;
    ns.slopeRotation = 0;
    ns.currentSlopeYVelocity = 0;
  }
  if (!ns.isOnSlope && !ns.wasOnSlope) ns.collidingWithSlopeId = 0;
  return launched;
}
