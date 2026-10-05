// Cube physics constants and integration.
//
// Read out of the shipping 2.2081 arm64 slice (`PlayerObject::updateJump`,
// `m1 0x3766e8`) and cross-checked against the 21 recorded runs in
// `macros-main/`. The original works in "raw" units — one 60 Hz frame's
// displacement, already scaled by the 0.9 slowdown — and steps at 240 Hz:
//
//   dtRaw = 0.225                              // (1/240) * 60 * 0.9
//   m_gravity   = 0.958199                     // 0x3f754c88 at +0x138
//   m_yVelocity += mult * m_gravity * dtRaw    // mult is per gamemode
//   m_yVelocity  = round3(m_yVelocity)         // <- see QUANT below
//   y           += m_yVelocity * dtRaw
//
// Converting to world units per second (world unit = 1/30 block):
//   velocity W = 54 * raw        (0.9 * 60; a jump sets raw 11.18 -> 603.72)
//   accel      = 12960 * (raw per step)   (54 * 240)
//
// **`round3` is not a detail.** After every acceleration the original snaps
// `m_yVelocity` to three decimal places (`fcvtzs`/`frinta` block at +0x53c,
// ties away from zero). Because the velocity is therefore always a multiple of
// 0.001, a step of 0.2155948 lands on 0.216 *every single time* — so the cube's
// real acceleration is 0.216 * 12960 = 2799.36 u/s^2, not 0.958199 * 2916 =
// 2794.11. A long-baseline fit over 44,281 free-fall arcs in the macros gives
// -2799.360 (p25 -2799.365, p75 -2799.357), which pins it to six figures.
//
// Every gamemode's multiplier goes through the same snap, and the rounding is
// what makes each one land where it does, so `quantizeVelocity` is applied
// after each acceleration rather than the constants being pre-rounded.
//
// Cross-check: 5.770002 * 0.9 * 60 = 311.58 u/s, exactly the documented normal
// speed, which is what pins the 60 Hz interpretation of the raw unit.
//
// The resulting cube arc peaks ~2.2 blocks up and spans ~4.5 blocks at normal
// speed, matching the real game (a cube jump clears a 4-block gap).

/** world units per block */
export const BLOCK = 30;

/**
 * World units of velocity per raw unit: 0.9 * 60. Exported because the
 * original's velocity quantisation and its `2 * m_gravity` branch threshold are
 * both stated in raw units.
 */
export const RAW_VELOCITY = 54;

/** raw seconds per 240 Hz step: (1/240) * 60 * 0.9 */
export const RAW_DT = 0.225;

/**
 * **The speed setting changes the physics, not just the scroll rate.**
 *
 * `PlayerObject::updateSpeedVariables` (2.2081 arm64 `m1 0x374e30`) branches on
 * `m_playerSpeed` and writes three doubles: `m_xVelocity` (+0x780),
 * `m_gravity` (+0x790) and the jump velocity (+0x788). Every one of them
 * differs per speed, and 3x and 4x share a row (the function tests 0.7, 0.9,
 * 1.1 and then accepts 1.3 or 1.6 into the same branch).
 *
 * Treating gravity and the jump as constants is what made the robot's take-off
 * come out 6.5 u/s short at 2x — measurably, in `macros-main`: 308.342 against
 * our 301.860, over 21 recorded take-offs. It is half the cube's jump, and the
 * cube's jump at 2x is 11.42, not 11.18.
 *
 * Raw units; see the file header for the conversions. The world speeds these
 * produce (`xVel * mult * 60`) are 251.16 / 311.58 / 387.42 / 468 / 576 —
 * exactly `SPEEDS`, which is the cross-check that the row order is right.
 */
export interface SpeedPhysics {
  /** `m_playerSpeed`, the multiplier the branch tests */
  mult: number;
  /** `m_xVelocity` (+0x780), raw units per 60 Hz frame */
  xVel: number;
  /** `m_gravity` (+0x790), raw */
  gravity: number;
  /** the jump velocity (+0x788), raw */
  jump: number;
}

export const SPEED_PHYSICS: readonly SpeedPhysics[] = [
  { mult: 0.7, xVel: 5.980002, gravity: 0.940199, jump: 10.620032 },
  { mult: 0.9, xVel: 5.770002, gravity: 0.958199, jump: 11.180032 },
  { mult: 1.1, xVel: 5.870002, gravity: 0.957199, jump: 11.420032 },
  { mult: 1.3, xVel: 6.000002, gravity: 0.961199, jump: 11.230032 },
  { mult: 1.6, xVel: 6.000002, gravity: 0.961199, jump: 11.230032 },
] as const;

/** the same rows in world units, plus the ship/UFO branch threshold */
export interface SpeedConstants {
  /** world units per second squared */
  gravity: number;
  /** world units per second */
  jump: number;
  /** `2 * m_gravity` in world velocity units — see RISE_THRESHOLD */
  rise: number;
}

const SPEED_CONSTANTS: readonly SpeedConstants[] = SPEED_PHYSICS.map((r) => ({
  gravity: r.gravity * 2916,
  jump: r.jump * 54,
  rise: 2 * r.gravity * 54,
}));

/**
 * The physics row for a horizontal speed in world units. Unknown speeds — a
 * level that never crossed a speed portal cannot produce one, but a trigger
 * might — fall back to normal, which is what the original's own `else` does
 * for `m_xVelocity`.
 */
export function speedConstants(speed: number): SpeedConstants {
  const i = (SPEEDS as readonly number[]).indexOf(speed);
  return SPEED_CONSTANTS[i] ?? SPEED_CONSTANTS[1];
}

/** the original's `m_gravity` at normal speed, raw (`0x3f754c88`) */
export const RAW_GRAVITY = SPEED_PHYSICS[1].gravity;

/**
 * Cube gravity, world units per second squared.
 *
 * This is the **unrounded** constant, `RAW_GRAVITY * RAW_VELOCITY * 240 *
 * RAW_DT` = 2794.108. One step of it is 0.2155948 raw, which
 * `quantizeVelocity` then snaps to 0.216 — so the acceleration you actually
 * measure in a recording is 0.216 * 12960 = 2799.36. Feed this constant into
 * the integrator and let the snap produce that; pre-rounding it here would get
 * the cube right and every other gamemode's multiplier wrong.
 */
export const GRAVITY = RAW_GRAVITY * 2916;
/**
 * The cube's jump at **normal speed**. Every other speed has its own value —
 * see `SPEED_PHYSICS` — so this is only the right number for a gamemode step
 * when the run is at 1x; `speedConstants()` is what the step functions use.
 */
export const JUMP_VELOCITY = SPEED_PHYSICS[1].jump * RAW_VELOCITY;

/**
 * `PlayerObject` snaps `m_yVelocity` to three decimal places (raw) after every
 * acceleration: `trunc(v) + frinta(frac(v) * 1000) / 1000`, i.e. round to
 * nearest multiple of 0.001 with ties away from zero (2.2081 arm64
 * `updateJump` +0x53c, and again at +0xf6c and +0xf6e for the UFO and swing).
 *
 * This is why the effective gravity is 0.216 and not 0.2155948 — see the file
 * header. Applying it per acceleration, rather than rounding the constants
 * once, is what makes the mini and 1.2x branches come out right too.
 */
export function quantizeVelocity(v: number): number {
  const raw = v / RAW_VELOCITY;
  const whole = Math.trunc(raw);
  const frac = raw - whole;
  // frinta: round half away from zero, which Math.round is not for negatives
  const snapped = Math.sign(frac) * Math.round(Math.abs(frac) * 1000) / 1000;
  return (whole + snapped) * RAW_VELOCITY;
}

/**
 * The ship and UFO brake a *fast climb*: both read
 *
 *   slow = m_isUpsideDown ? m_yVelocity > -2 * m_gravity
 *                         : m_yVelocity <  2 * m_gravity
 *
 * (2.2081 arm64 `updateJump` +0x40c for the ship, +0xf2c for the UFO), which in
 * our sign convention is `yVel * gravitySign < RISE_THRESHOLD`. It is **not**
 * a test for falling: a ship dropping at 500 u/s and one climbing at 50 u/s
 * take the same branch, and only a climb past this speed takes the other.
 *
 * Reading it as `yVel * g <= 0` was the port's single largest physics fault —
 * it gave a rising ship 1.2x gravity from the first frame after release
 * instead of 0.8x, and cost a held ship its 0.5 thrust the moment it started
 * to climb. The macros bracket the real value to [103.4656, 103.5169), and
 * 2 * 0.958199 * 54 = 103.4855 sits inside it.
 */
export const RISE_THRESHOLD = 2 * RAW_GRAVITY * RAW_VELOCITY;
/** the game clamps raw yVel to -15, i.e. 54 * 15 */
export const TERMINAL_VELOCITY = 810;

/**
 * Horizontal speeds in world units per second, indexed by the game's speed
 * setting (0 = slow/0.5x through 4 = fastest/4x). These are the documented
 * absolute values; the original's rounded multipliers (0.7/0.9/1.1/1.3/1.6)
 * only reproduce the normal speed exactly, so prefer these.
 */
export const SPEEDS = [251.16, 311.58, 387.42, 468.0, 576.0] as const;

/**
 * Hard kill height. `PlayLayer::checkCollisions` destroys the player above
 * y = 1290 regardless of gamemode. The tallest thing in levels 1-21 sits at
 * y=1185 (level 12), so this is above every legitimate route; level 22 is 2.2
 * content that goes higher and is not covered by the reference.
 *
 * There is a *second*, separate limit in the original: for every gamemode
 * except cube it also clamps the player between the ground and a ceiling that
 * track the camera. That one needs the camera model we do not have yet — see
 * "camera" in PORT-PROGRESS.
 */
export const KILL_HEIGHT = 1290;

/** the cube is a 30x30 box */
export const PLAYER_SIZE = 30;
/** mini mode shrinks the player */
export const MINI_SCALE = 0.6;

/**
 * Per-gamemode hitbox scale, on top of mini.
 *
 * **There is no such thing in the real game for seven of the eight modes, and
 * the wave's is the last hand-set gameplay number left in the collision code.**
 * `m_vehicleSize` — the only thing that scales the player's rect — takes exactly
 * two values in the shipping binary: it is set to 1.0 in `PlayerObject::init`
 * and toggled between 1.0 and 0.6 in `togglePlayerScale`, which is called from
 * precisely two places, the two size portals. No gamemode portal touches it,
 * and every other one of its ~677 uses is a `== 1.f` mini test.
 *
 * So the ship/UFO/swing factors (0.7) are **gone** — measured over the full
 * sweep, giving them their real 30x30 costs nothing at all.
 *
 * **The wave is different, and the recordings say so.** `scripts/macro-hitbox.mjs`
 * asks, for every frame of all 21 real runs, how large the player's hazard box
 * could be and still clear every hazard that run cleared. Seven modes come back
 * at or above 1.0 — cube 1.004, ball 1.100, spider 1.748 — which is the
 * cross-check that a full-size box is right for them. The wave comes back at
 * **0.340**, from `id 61` in level 18 at frame 11847: a full-size wave is deep
 * inside a hazard the real run flew straight past. Whatever the reason (the
 * `m_isDart` reading above says it cannot be `m_vehicleSize`), a 30x30 wave is
 * ruled out by measurement, not by taste.
 *
 * The value shipped is **0.25**, and the gap between it and the 0.340 bound is
 * the part that is still a workaround: level 17's dual wave corridor, built out
 * of `id 366` slope tiles, is impassable at 0.34 (50.3 %), gets a little
 * further at 0.30 (51.0 %) and goes through at 0.25. Our slope handling makes
 * that corridor narrower than it really is — see "Known slope defect" — so the
 * wave is carrying the difference. The target is still 1.0 here too, once the
 * slope model is right; the 0.340 bound is the number to justify against until
 * then.
 */
export function hitboxScale(mode: string): number {
  switch (mode) {
    case "wave": return 0.25;
    default: return 1; // cube, ball, robot, spider, ship, UFO, swing
  }
}

/** degrees per second while airborne — a normal jump turns very nearly 180° */
export const ROTATION_SPEED = 418;

export interface CubeState {
  /** seconds since the last gravity flip (undefined: never flipped) */
  flipAge?: number;
  x: number;
  y: number;
  /** vertical velocity, world units per second */
  yVel: number;
  onGround: boolean;
  /** visual rotation in degrees, CW positive */
  rotation: number;
  gravityFlipped: boolean;
  /**
   * GD `_queuedHold`: the buffered press. Set when the button goes down,
   * cleared when it comes up, and *consumed* by whatever uses it (an orb, or an
   * ordinary jump when no orb is being touched). **It has no time limit** —
   * that is what makes buffering work: hold the button early and the orb or
   * jump fires the instant it becomes possible.
   */
  queuedHold: boolean;
  /** GD `_hasJustHeld`: one UFO flap per press, independent of queuedHold */
  justHeld: boolean;
  /** seconds spent on the current slope (`m_totalTime - m_slopeStartTime`) */
  slopeTime: number;
  /** climb rate of the slope being ridden (`m_slopeVelocity`), world units/s */
  slopeVelocity: number;
}

/** gravity sign: +1 normal (pulls -y), -1 flipped */
export function gravitySign(s: CubeState): number {
  return s.gravityFlipped ? -1 : 1;
}

/**
 * Flip gravity the way the original does (`PlayerObject::flipGravity`):
 * **a flip always halves the vertical velocity**, and only when the state
 * actually changes — so re-entering the same gravity portal does nothing.
 *
 * Every gravity change goes through here: portals, the blue and green orbs, the
 * gravity pad and the ball's own flip. Flipping used to just set the flag,
 * which let the player carry its full speed through and threw it about twice as
 * far as it should go.
 */
export function flipGravity(s: CubeState, flipped: boolean) {
  if (s.gravityFlipped === flipped) return;
  s.gravityFlipped = flipped;
  s.yVel /= 2;
  // `m_lastFlipTime` (+0x7c8), read by `isSafeFlip` — see sim.ts's floor rule
  s.flipAge = 0;
  // `flipGravity` (m1 0x37b4e8): on (or just off) a slope, the stored slope's
  // `m_slopeFlipGravityRelated` (+0x684) toggles — it decides which way the
  // ride-end launch is tested (Hexagon Force f4700: a ball flipping as it
  // leaves a ramp keeps its flip velocity, no launch). Native slopes only.
  const ns = (s as { ns?: { isOnSlope: boolean; wasOnSlope: boolean; slopeFlipGravityRelated: boolean; lastFlipTime: number; time: number } }).ns;
  if (ns) {
    ns.lastFlipTime = ns.time;
    if (ns.wasOnSlope || ns.isOnSlope) ns.slopeFlipGravityRelated = !ns.slopeFlipGravityRelated;
  }
}

/** Apply one physics step of `dt` seconds. Collision is resolved by the caller. */
export function integrate(s: CubeState, dt: number, speed: number, holding: boolean) {
  const g = gravitySign(s);
  if (holding && s.onGround) {
    s.yVel = JUMP_VELOCITY * g;
    s.onGround = false;
  }
  s.x = advanceX(s.x, speed * dt);
  s.yVel = quantizeVelocity(s.yVel - GRAVITY * dt * g);
  // clamp fall speed (in the direction gravity pulls)
  if (g > 0) s.yVel = Math.max(s.yVel, -TERMINAL_VELOCITY);
  else s.yVel = Math.min(s.yVel, TERMINAL_VELOCITY);
  s.y = advanceY(s.y, s.yVel * dt);
  if (!s.onGround) s.rotation += ROTATION_SPEED * dt * g;
}

/**
 * The original's world y for our y. `PlayerObject` is a cocos2d node, so its
 * position is a **float**, and the level's floor sits at game y = 90 while ours
 * sits at 0.
 */
export const GD_Y_OFFSET = 90;

/**
 * Advance a position the way cocos2d does: in float32.
 *
 * `CCNode::setPosition` stores floats, so the game's x and y are rounded to
 * float32 **every step**, and the error does not average out — at x ~ 28000 one
 * ulp is 0.00195 and a step of 1.29825 lands on 1.298828 over and over, so the
 * real run runs measurably *ahead* of exact arithmetic (311.5975 u/s measured
 * against the true 311.58). Accumulating in double left us ~12 units behind by
 * the end of a long level, which is what moved every trigger and portal.
 *
 * The y form adds the offset back before rounding so the rounding happens on
 * the same magnitude the game rounds; both are exact round trips because 90 is
 * exactly representable.
 */
export function advanceX(x: number, dx: number): number {
  return Math.fround(x + dx);
}
export function advanceY(y: number, dy: number): number {
  return Math.fround(y + GD_Y_OFFSET + dy) - GD_Y_OFFSET;
}

/** Snap to the nearest quarter turn, which the game does on landing. */
export function snapRotation(deg: number): number {
  return Math.round(deg / 90) * 90;
}

/** Peak height of a jump, used by tests to sanity-check the constants. */
export function jumpApex(): number {
  return (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);
}

/** Airborne time of a full jump from and back to the same height. */
export function jumpAirtime(): number {
  return (2 * JUMP_VELOCITY) / GRAVITY;
}
