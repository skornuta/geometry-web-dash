// The in-level ghost trail: triggers 32 (on) and 33 (off).
//
// Evidence (arm64 slice, geode m1 addresses):
//   EffectGameObject::triggerObject 0x172da4 — id 0x20 -> `PlayLayer::
//       toggleGhostEffect(1)`, id 0x21 -> `(0)` (0xabc14), both skipped when the
//       object's `[0x289]` (= `GameManager[0x29a]`, the same switch that
//       turns object glow off; clear in a default install) is set
//   PlayLayer::toggleGhostEffect 0xabc14 — player 1, and player 2 when the
//       layer's dual flag `[0x3f2]` is set
//   PlayerObject::toggleGhostEffect 0x388894 — type 1 builds the effect:
//       `GhostTrailEffect::runWithTarget(m_iconSprite [0x700], snapshot 0.05,
//       fade 0.4, duration 0, ghostScale 0.6, scaleTwice false)` (+208..260),
//       opacity 200 (`[0x170] = 200.0`), size factor = the player's size
//       `[0x9a0]` (1 / mini), colour `[0xa22..0xa24]` = `updateGlowColor`'s
//       first colour (colour 1, or colour 2 if colour 1 is black, through
//       `strongColor`), blended additively (`0x522bf8`: SRC_ALPHA, ONE) —
//       unless the icon sprite's own colour is black, when it is a black copy
//       with the default blend
//   GhostTrailEffect::trailSnapshot 0x5227b0 — every 0.05 s a new CCSprite takes
//       the target's displayed frame, position, rotation and flip, is added
//       just under the player's z in the object layer, then fades 200 -> 0 and
//       scales to 0.6 over 0.4 s (+584..980) and removes itself
//   off again at `resetObject` 0x387858 (+996), `playerDestroyed` 0x38907c
//       (+292) and `playCompleteEffect` 0x1bf7f0 (+156); restored from the
//       checkpoint at `loadFromCheckpoint` 0x39107c (+1160)
//
// What the copy is: `m_iconSprite` (0x700) — the cube/ball/dart/swing frame in
// those modes and the little 0.55 cube at +5 inside the ship and UFO (the
// vehicle is `m_vehicleSprite`, 0x720, which the effect never touches).
//
// APPROXIMATIONS, all in the same place as the end sequence's ghosts (FIDELITY
// A6): only the icon sprite's main layer is copied; the robot's and spider's
// hidden icon sprite has an unknown frame, so they draw no copies; the timer
// is the cocos2d-x 2.x `CCTimer` (a fired interval resets the accumulator, the
// first frame after scheduling adds nothing); and a trigger passed during a solo
// section also switches player 2 on (the game does that only if it was in a dual
// at that moment).

import type { Gamemode } from "./gamemodes.ts";
import { GHOST_FADE, GHOST_INTERVAL, GHOST_OPACITY, GHOST_SCALE } from "./levelEnd.ts";

/** how long a copy lives: the 0.4 s fade-and-shrink action, then `removeFromParent` */
export const GHOST_LIFE = GHOST_FADE;

/** where a player's icon sprite is at one moment */
export interface GhostPose {
  x: number;
  y: number;
  /** radians, as the renderer takes them (CCW) */
  rot: number;
  flipY: boolean;
  mode: Gamemode;
  mini: boolean;
}

export interface GhostSnap extends GhostPose {
  /** 0 player 1, 1 player 2 */
  slot: 0 | 1;
  /** `GhostTrail.now` at the snapshot */
  born: number;
}

/**
 * Which frame the copy shows, its offset up the player's own axis and its scale
 * relative to the player's size. `null` for modes whose icon sprite is hidden.
 */
export function ghostIcon(mode: Gamemode): { mode: Gamemode; dy: number; s: number } | null {
  switch (mode) {
    case "cube": case "ball": case "wave": case "swing":
      return { mode, dy: 0, s: 1 };
    case "ship": case "ufo":
      // `toggleFlyMode` / `toggleBirdMode`: the icon sprite stays, as a 0.55 cube at +5
      return { mode: "cube", dy: 5, s: 0.55 };
    default:
      return null;
  }
}

export class GhostTrail {
  snaps: GhostSnap[] = [];
  /** seconds of play the trail has seen */
  now = 0;
  private armed = false;
  private acc = 0;

  /**
   * Advance by `dt` seconds. `on` is the trigger state (`TriggerRuntime.ghost`);
   * `poses` is each player's icon pose now, `null` for an absent or dead one.
   */
  update(dt: number, on: boolean, poses: readonly (GhostPose | null)[]) {
    this.now += dt;
    if (!on) {
      // `stopTrail` unschedules the snapshot timer; a new effect starts afresh
      this.armed = false;
      this.acc = 0;
    } else if (!this.armed) {
      this.armed = true;
      this.acc = 0;
    } else {
      this.acc += dt;
      if (this.acc >= GHOST_INTERVAL) {
        this.acc = 0;
        poses.forEach((p, i) => {
          if (p) this.snaps.push({ ...p, slot: i as 0 | 1, born: this.now });
        });
      }
    }
    while (this.snaps.length && this.now - this.snaps[0].born >= GHOST_LIFE) this.snaps.shift();
  }

  /** the copies to draw: opacity (0..1) and size factor on top of the player's */
  live(): { snap: GhostSnap; alpha: number; scale: number }[] {
    return this.snaps.map((snap) => {
      const k = Math.min(1, (this.now - snap.born) / GHOST_FADE);
      return { snap, alpha: GHOST_OPACITY * (1 - k), scale: 1 + (GHOST_SCALE - 1) * k };
    });
  }

  clear() {
    this.snaps.length = 0;
    this.armed = false;
    this.acc = 0;
  }
}
