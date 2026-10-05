// Gamemode physics for the 8 player modes (M4).
//
// Formulas translated from the original game's PlayerObject (via OpenGD,
// GPL-3.0 — reimplemented, not copied). Raw per-60Hz-frame values are kept as
// comments; world conversion is velocity x54, acceleration x2916 (see
// physics.ts), and per-mode multipliers are applied dimensionlessly on the
// world-unit GRAVITY/JUMP_VELOCITY constants.
//
// The cube branch is numerically identical to physics.ts `integrate()` when
// the player is not mini (physics.test.ts pins that behaviour).
import {
  TERMINAL_VELOCITY, ROTATION_SPEED, RAW_VELOCITY, speedConstants, SPEEDS,
  quantizeVelocity, advanceX, advanceY, gravitySign, flipGravity, snapRotation,
  type CubeState,
} from "./physics.ts";
import { DEFAULT_CAMERA_Y_CENTER } from "./camera.ts";

export type Gamemode =
  | "cube" | "ship" | "ball" | "ufo" | "wave" | "robot" | "spider" | "swing";

export interface PlayerState extends CubeState {
  /**
   * The jump button went down on *this* step. Distinguishes `pushButton`'s
   * fresh press from a button that was already held — see `StepInput.pressed`.
   */
  freshPress: boolean;
  /**
   * `m_fCameraYCenter` — the camera anchor a gamemode portal installs, and the
   * datum the free-fly band's ceiling is measured from.
   *
   * **Per player, not per run** — each player carries its own. Inside a dual
   * the two stay equal: the dual portal installs one anchor and gamemode
   * portals crossed during the dual do not move it (see `stepOne` in sim.ts;
   * measured on level 16, where the real player 1 flies 390 ± 135 while
   * crossing a ship portal whose own centre is 450).
   */
  cameraYCenter: number;
  mode: Gamemode;
  mini: boolean;
  /**
   * The robot's charge timer (`[0x7f8]`): seconds spent coasting since
   * take-off. Zeroed by the robot's jump, advanced only while the charge is
   * actually running — it is **not** "how long the button has been down".
   */
  holdTime: number;
  /** `[0x9cc]`: this airborne arc came from the player's own jump */
  jumping: boolean;
  /** dash orb state: 0 = none, 1 = dash, 2 = dash + flip gravity on release */
  dash: 0 | 1 | 2;
  /** the dash's gravity-axis distance per unit of travel (`[0x570]`, see `dashSlope`) */
  dashSlope?: number;
  /**
   * `m_stateNoAutoJump`, raised by a J block (1813) the player touched on the
   * last collision pass: a held button no longer re-jumps off the ground, only
   * a press not yet spent (`queuedHold`) does.
   */
  noAutoJump: boolean;
  /**
   * The spider orb took this press: a held button does not re-jump the cube
   * until it is let go. Dash f10382-10414: sent onto the ceiling by the orb,
   * the native cube rests there for the rest of the 32-frame hold.
   */
  holdSpent?: boolean;
  /** last step pushed this flier along the wrong side of a ramp (tile hand-off) */
  slopeBumpRide?: boolean;
  /** the stored `slopeVelocity` came from a bump ride (see sim.ts) */
  slopeBumpLaunch?: boolean;
  /** the last bump held the player at the ramp's ledge */
  slopeBumpLedge?: boolean;
  /** the ship's eased sprite angle, radians CCW (see `easeShipRotation`) */
  shipRot?: number;
  /** `[0xa31]`: the game is in dual mode (see `dualSlow`) */
  inDual?: boolean;
  /**
   * In a dual, how far the ground and ceiling sit from the camera centre:
   * `GJBaseGameLayer::updateDualGround` (m1 0xfd20c) spaces them 300 apart when
   * either player flies (ship, UFO, wave, swing) and 270 otherwise (a ball's
   * own 240 is raised to 270). Set each step by the sim.
   */
  dualEdge?: number;
  /** 2.2 free-mode camera (portal property 111): follow in every mode, no fly band */
  freeMode?: boolean;
  /** the level sets header key kA32 (see `stepShip`) */
  kA32?: boolean;
  /** the level sets Fix Robot Jump (header kA34) — see `activatePad` */
  fixRobotJump?: boolean;
  /** the level sets Enable Player Squeeze (header kA31) — see sim.ts */
  squeeze?: boolean;
  /** a force block's push for the next step, added after the clamp */
  pendingForce?: number;
  /** `[0x902]`: a launch has lifted the ship/UFO clamp (see `settleLaunch`) */
  noClamp?: boolean;
  /** the native slope fields (`NATIVE_SLOPES`, see src/game/nativeSlope.ts) */
  /** a teleport moved the player this step (the band ceiling skips the next) */
  teleported?: boolean;
  ns?: import("../game/nativeSlope.ts").NativeSlopeState;
  /**
   * `[0x93c]`: a toggle orb (`CustomRing`) has already fired during this press.
   * `pushButton` +516 zeroes the four ring flags at `[0x93b]`, so a new press
   * arms another one.
   */
  usedCustomRing: boolean;
  /** `m_lastGroundObject` (+0x838) and `m_snapDifference` (+0x800) — see snapjump.ts */
  snapObject: number;
  snapObjectX: number;
  snapObjectY: number;
  snapOffset: number;
  /** steps left in which a player that ran off a surface may still jump */
  groundGrace: number;
  /**
   * Rotate Gameplay (2900): travel runs along world y (`m_isSideways`), and/or
   * against the axis (`m_isGoingLeft`). The step runs in the frame these
   * define — see `src/game/frame.ts`. Both false in a normal level.
   */
  sideways: boolean;
  reversed: boolean;
  /**
   * The free-fly band is off: the player left a sideways section and no
   * gamemode portal has anchored a new band since (see `rotateGameplay`).
   */
  bandless?: boolean;
  /** the dash runs one more step, then stops (a gamemode portal ended it) */
  dashEnding?: boolean;
  /** skip the terminal-velocity clamp for one step (a black orb just fired) */
  skipClamp?: boolean;
}

export interface StepInput {
  holding: boolean;
  /**
   * Was the player overlapping an orb last step? A cube jump consumes the
   * buffered press only when it is *not* touching a ring
   * (`if (!_touchedRingObject) _queuedHold = false;`), so an orb sitting at
   * ground level still gets the press. One step of lag at 240 Hz is ~4 ms.
   */
  onOrb: boolean;
  /**
   * A **fresh** press this step, as opposed to a button that was already down.
   *
   * The two reach the jump at different points in the original's frame, and the
   * macros show it plainly. `PlayerObject::pushButton` runs on the press event,
   * before the frame's gravity, so a fresh press's first position step is
   * already one gravity step down: **2.4669 u** at 240 Hz (`(603.72 - 2799.36 /
   * 240) / 240`). A button that was already down instead jumps from *inside the
   * landing*, after that frame's gravity has been applied and spent, so its
   * first step uses the full jump velocity: **2.5155 u** (`603.72 / 240`).
   *
   * Measured over the 21 real runs in `macros-main/`: every one of the 429
   * jumps from a standing rest rises 2.4669, and 375 of the jumps taken on the
   * landing frame rise 2.5155 (the remaining 148 are fresh presses that landed
   * on the same frame, and rise 2.4669). See `scripts/macro-compare.mjs`.
   */
  pressed: boolean;
  /**
   * Written by the step, read by the caller: this step made a ground jump
   * (cube, robot or ball) — the `updateJump` +5724 site that calls
   * `PlayerObject::incrementJumps`.
   */
  jumped?: boolean;
}

/**
 * **Ship, UFO, ball and swing fall under the base gravity at every speed**
 * (`0.958199`, the 1x row); only the cube, robot and spider take the speed
 * portal's row. The binary's swing branch multiplies the literal 0.958199
 * (PHYSICS-FROM-BINARY.md), and the native runs say the same of the others:
 * Electrodynamix f12738, a mini ship at 3x steps 0.127 raw held-slow and
 * 0.101 held-fast — both fit only the base constant, where the 3x row
 * (0.961199) gives 0.102. Moving the ship, UFO and ball took resync faults
 * 83 -> 78 -> 75 -> 67; the cube on the base constant is far worse (118).
 */
const BASE_PHYSICS = speedConstants(SPEEDS[1]);

/** mini shrinks jump/impulse velocities (original: x0.8) */
const MINI_VEL = 0.8;

export function freshPlayer(x: number, y: number): PlayerState {
  return {
    x, y, yVel: 0, onGround: true, rotation: 0, gravityFlipped: false,
    queuedHold: false, justHeld: false, freshPress: false,
    slopeTime: 0, slopeVelocity: 0,
    cameraYCenter: DEFAULT_CAMERA_Y_CENTER,
    mode: "cube", mini: false, holdTime: 0, jumping: false, dash: 0,
    noAutoJump: false, usedCustomRing: false,
    snapObject: -1, snapObjectX: 0, snapObjectY: 0, snapOffset: 0,
    groundGrace: 0, sideways: false, reversed: false,
  };
}

/**
 * Enter a gamemode. Most portals just carry the velocity over, but the **ship
 * and UFO halve it**, and the ship zeroes the rotation (`setRotation(0);
 * m_dYVel /= 2;` in `toggleGameMode`) — without that you enter carrying the
 * full speed of whatever drop preceded it.
 *
 * **The robot enters with its float already spent** (GD 2.2081 arm64). The
 * dispatcher `PlayerObject::switchedToMode` (`m1 0x388338`) stores nothing
 * itself; it calls one helper per mode, and the robot's (`m1 0x38d95c`, the one
 * that writes `m_isRobot` at `0x96d`) ends with:
 *
 * ```
 * +384  mov  x8, #0x3ff8000000000000   ; the double 1.5
 * +388  str  x8, [x19, #0x7f8]         ; the charge timer
 * ```
 *
 * `0x7f8` is the charge timer and `1.5` is exactly the cap it is tested
 * against, so a fresh robot fails `[0x7f8] < 1.5` on its first frame: crossing
 * a robot portal in mid-air gives you **no** float. Only the robot's own ground
 * jump re-arms it, by zeroing the same field at `updateJump+2668`
 * (`str xzr, [x19, #0x7f8]`), two instructions after the `0x936` clear that
 * already backs the fresh-press rule.
 *
 * This matters because `jumping` survives a portal: without the reset, a cube
 * that jumped and *then* crossed a robot portal arrived with `jumping` true and
 * a full charge, and floated on an arc the robot never launched. Checked the
 * other way too — **nothing in any of the mode helpers writes `0x9cc`**, so
 * `jumping` itself is deliberately *not* cleared here.
 */
export function setGamemode(p: PlayerState, mode: Gamemode, speed = 311.58) {
  const entering = p.mode !== mode;
  // **Leaving the wave halves its raw velocity.** The wave's raw speed is
  // `xVel * mult` per 60 Hz frame (5.193 at 1x, i.e. 311.58 world), and every
  // other mode reads raw velocity at x54 — so what comes out is
  // `0.5 * speed / 60 * 54 = 0.45 * speed`, whatever the wave was doing.
  // Measured on the real runs: Blast Processing f14076, Geometrical Dominator
  // f7551 and Deadlocked f867 (a *mini* wave at 623 u/s) all leave at 140.21;
  // into a ship it is halved again (Blast Processing f6810: 70.10).
  if (entering && p.mode === "wave") p.yVel = Math.sign(p.yVel) * 0.45 * speed;
  // Leaving a ship or UFO halves the velocity, as entering a ship does:
  // Clubstep frame 7010, the real ship at 272.27 u/s becomes a cube at 136.13
  // (+ gravity). Across the native runs this took resync faults 206 -> 173 and
  // let Blast Processing finish; doing the same for the ball made it worse.
  // The swing too: `toggleSwingMode` (m1 0x38c5b4) reaches its
  // `m_yVelocity *= 0.5` (+0x110) whether it is switching on or off (Dash
  // f5191, a swing pushed down a ceiling ramp becomes a cube at half speed).
  else if (entering && (p.mode === "ship" || p.mode === "ufo" || p.mode === "swing")) p.yVel /= 2;
  p.mode = mode;
  // A gamemode portal ends a dash one step later: Dash f2196, a dashing ball
  // crosses a cube portal and the real player still holds its height through
  // f2197, falling only from f2198.
  if (p.dash !== 0) p.dashEnding = true;
  // `[0x7f8] = 1.5` — spent, not zero. See the note above.
  if (entering && mode === "robot") p.holdTime = ROBOT_HOLD_MAX;
  // Entering a UFO halves it too, not only a ship (Theory of Everything f5325:
  // a cube falling at 528.61 leaves the portal at 264.30 + gravity).
  // ...and so does entering a swing (Dash f3879: -42.4 -> -21.4 in the
  // time-warped native run)
  if (entering && (mode === "ship" || mode === "ufo" || mode === "swing")) p.yVel /= 2;
  if (entering && mode === "ship") {
    p.rotation = 0;
  } else {
    p.rotation = snapRotation(p.rotation);
  }
}

/** terminal fall clamp (raw +/-15, i.e. 810 world) */
function clampTerminal(p: PlayerState, g: number) {
  // a black orb's drop skips the clamp for the step it fires — see `activateOrb`
  if (p.skipClamp) { p.skipClamp = false; addForce(p); return; }
  if (g > 0) p.yVel = Math.max(p.yVel, -TERMINAL_VELOCITY);
  else p.yVel = Math.min(p.yVel, TERMINAL_VELOCITY);
  addForce(p);
}

/**
 * A force block's push lands after the clamp and before the move: Dash
 * f21517-21521, the real cube moves at 707.1, 769.8, 832.5, then 861.03 =
 * 810 (clamp) + 51.03 (force) every step.
 */
function addForce(p: PlayerState) {
  if (!p.pendingForce) return;
  // scaled like the mode's gravity: Dash f17008, a robot over a 1.63 block
  // gains 17.82 a step = 0.9 x the cube's 19.80 (the robot falls at 0.9 g)
  const mult = p.mode === "robot" ? 0.9 : p.mode === "ball" || p.mode === "spider" ? 0.6 : 1;
  // in float32, and rounded to the velocity grid with it: Dash f17617, a
  // robot under gravity (0.195 raw a step) in a 1.4 block (0.2835) gains
  // 0.088 raw a step natively — 0.2835f is just under the tie — not 0.089
  const raw = Math.fround(Math.fround(p.pendingForce / RAW_VELOCITY) * Math.fround(mult));
  p.yVel = quantizeVelocity(p.yVel + raw * RAW_VELOCITY);
  p.pendingForce = 0;
}

/**
 * Ship/UFO velocity clamps (raw, x54 for world): 8.0/size against gravity,
 * 6.4/size toward it. `size` is the original's playerSize: 1.0, mini 0.85.
 */
/**
 * `updateJump`'s slow test (branch without kA32): upside down `v > 2g`; the
 * right way up `v < 2g` — or `v < -2g` in a dual (`[0xa31]`, set for both
 * players by `GJBaseGameLayer::toggleDualMode`). Hexagon Force f18575: in a
 * dual, player 1 held from rest takes the 0.4 boost (5.45 a step), not 0.5.
 */
function dualSlow(p: PlayerState, g: number, rise: number): boolean {
  if (g < 0) return p.yVel > rise;
  return p.yVel < (p.inDual ? -rise : rise);
}

function shipLimits(size: number) {
  return { against: quantizeVelocity((8.0 * 54) / size), toward: quantizeVelocity((6.4 * 54) / size) };
}

/**
 * `PlayerObject::updateJump` (m1 0x3766e8) +0x218: the launch flag `[0x902]`
 * is cleared once the velocity is inside the clamp's range again.
 */
export function settleLaunch(p: PlayerState, g: number, size: number) {
  if (!p.noClamp) return;
  const { against, toward } = shipLimits(size);
  const v = p.yVel * g;
  if (v < against && v > -toward) p.noClamp = false;
}

function clampShip(p: PlayerState, g: number, size: number) {
  // A launch (ramp, pad, orb, force — `[0x902]`) lifts the clamp until the
  // velocity is back inside it; `updateJump` +0x218 clears the flag then.
  if (p.noClamp) return;
  // The limits land on the same 0.001-raw grid as every velocity: a falling
  // mini ship tops out at 7.529 raw, not 6.4 / 0.85 = 7.529412 (Electrodynamix
  // f6188, 406.567 u/s; the port's 406.588 drifted 0.0001 u per frame).
  const { against, toward } = shipLimits(size);
  if (g > 0) p.yVel = Math.min(Math.max(p.yVel, -toward), against);
  else p.yVel = Math.min(Math.max(p.yVel, -against), toward);
}

/**
 * End a dash-orb dash: releasing the button does this, and so does touching an
 * S block (1829). The gravity dash flips gravity as it ends.
 */
export function stopDash(p: PlayerState) {
  // the dash's own climb does not carry on: Dash f10103, the native cube
  // released off a 45-degree dash starts its fall from rest (-0.048, one
  // step of gravity)
  p.yVel = 0;
  if (p.dash === 2) flipGravity(p, !p.gravityFlipped);
  p.dash = 0;
  p.dashEnding = false;
}

/**
 * One fixed physics step for the current gamemode. Collision is resolved by
 * the caller (except the spider's teleport, which needs the collision world
 * and is handled there). Returns true when the buffered press was consumed.
 */
export function stepPlayer(p: PlayerState, dt: number, speed: number, input: StepInput): boolean {
  // dash orb: while held the player runs along the orb's angle — `dashSlope`
  // gravity-axis units per unit of travel, no gravity — and the gravity
  // variant flips gravity on release. APPROXIMATION: the eased stop is not
  // modelled.
  // Letting go ends the dash on that same step, which then moves as the mode
  // does — gravity included (Fingerdash f4582: the real cube starts falling on
  // the release frame; stopping and returning left it hanging one step).
  if (!input.holding) p.holdSpent = false;
  if (p.dash !== 0 && !input.holding) stopDash(p);
  if (p.dash !== 0) {
    p.x = advanceX(p.x, speed * dt);
    p.yVel = speed * (p.dashSlope ?? 0);
    p.y += p.yVel * dt;
    if (p.dashEnding) stopDash(p);
    return false;
  }

  const consumed = stepMode(p, dt, speed, input);
  // a force the mode did not take (no terminal clamp) does not carry over —
  // APPROXIMATION: ship/UFO/wave/swing ignore force blocks (none in the runs)
  p.pendingForce = 0;
  return consumed;
}

function stepMode(p: PlayerState, dt: number, speed: number, input: StepInput): boolean {
  switch (p.mode) {
    case "cube": return stepCube(p, dt, speed, input);
    case "robot": return stepRobot(p, dt, speed, input);
    case "ship": return stepShip(p, dt, speed, input);
    case "swing": return stepSwing(p, dt, speed, input);
    case "ufo": return stepUfo(p, dt, speed, input);
    case "ball": return stepBall(p, dt, speed, input);
    case "wave": stepWave(p, dt, speed, input); return false;
    case "spider": stepSpiderFall(p, dt, speed); return false;
  }
}

/**
 * **The slope boost** — jumping off an uphill ramp launches you higher than a
 * flat jump does. This is the well-known tech, and it is what makes a
 * ramp-to-ledge gap comfortable in the real game; without it those jumps are
 * noticeably harder than they should be (reported on level 16 at x~9800, where
 * you ride a 45-degree ramp to y=270 and must clear a saw onto a ledge at 300).
 *
 * `updateJump`, right after the jump velocity is assigned:
 * ```cpp
 * if (m_wasOnSlope || m_isOnSlope) {
 *   if (m_slopeVelocity * flipMod() > 0.0f) {            // uphill only
 *     double threshold = m_yVelocity * 1.4f;             // of the BASE jump
 *     float v = getModifiedSlopeYVel();
 *     if (m_isBall) v = m_slopeVelocity;                 // ball skips the ramp-up
 *     addToYVelocity(v * 0.25f, 60);
 *     if (!m_isUpsideDown) setYVelocity(min(m_yVelocity, threshold), 3);
 *     else                 setYVelocity(max(m_yVelocity, threshold), 4);
 *   }
 * }
 * ```
 * `getModifiedSlopeYVel()` is `slopeVelocity * clamp(timeOnSlope * 10, 0.4, 1)`,
 * so a longer ride boosts harder, up to the full value after 0.1s. The whole
 * thing is capped at **1.4x** the base jump.
 *
 * Note the gate is on `slopeVelocity`, which we set to 0 on a descending ramp —
 * so a downhill ramp gives no boost, and takes nothing away either. `slopeTime`
 * and `slopeVelocity` still hold last step's values here because the jump is
 * applied before the collision pass, which is exactly `m_wasOnSlope`.
 */
function applySlopeBoost(p: PlayerState, g: number) {
  if (p.slopeVelocity * g <= 0) return;
  const threshold = p.yVel * 1.4;
  const ramped = p.mode === "ball"
    ? p.slopeVelocity
    : p.slopeVelocity * Math.min(1, Math.max(0.4, p.slopeTime * 10));
  p.yVel += ramped * 0.25;
  p.yVel = g > 0 ? Math.min(p.yVel, threshold) : Math.max(p.yVel, threshold);
  // The jump has spent the ramp's stored velocity: no launch follows when the
  // ride ends. Hexagon Force f4326, a ball tapped on a 2:1 ramp at 2x leaves
  // at ~200 u/s (this boost, halved by the flip, x0.6); the port then fired
  // the ride-end launch as well and overwrote it with 0.4 x m_slopeVelocity.
  p.slopeTime = 0;
  p.slopeVelocity = 0;
}

/**
 * The cube. Numerically identical to physics.ts `integrate()` for a non-mini
 * cube. (The robot used to share this function with a `robot` flag; it has its
 * own step now — see `stepRobot`.)
 */
function stepCube(
  p: PlayerState, dt: number, speed: number, input: StepInput,
): boolean {
  const g = gravitySign(p);
  // An ordinary jump consumes the queued hold (the original clears
  // `_queuedHold` here when no ring is being touched), so a press spent on a
  // jump cannot then also fire an orb.
  let consumed = false;
  /** a held button jumps after the frame's gravity — see `StepInput.pressed` */
  let afterGravity = false;
  if (input.holding && !p.holdSpent && (p.onGround || p.groundGrace > 0) && (!p.noAutoJump || p.queuedHold)) {
    p.groundGrace = 0;
    p.yVel = speedConstants(speed).jump * (p.mini ? MINI_VEL : 1) * g;
    applySlopeBoost(p, g);
    p.onGround = false;
    input.jumped = true;
    afterGravity = !input.pressed;
    if (!input.onOrb) { p.queuedHold = false; consumed = true; }
  }
  p.x = advanceX(p.x, speed * dt);
  if (!afterGravity) p.yVel = quantizeVelocity(p.yVel - speedConstants(speed).gravity * dt * g);
  clampTerminal(p, g);
  p.y = advanceY(p.y, p.yVel * dt);
  if (!p.onGround) p.rotation += ROTATION_SPEED * dt * g;
  return consumed;
}

/**
 * The robot — **read out of the shipping binary, not tuned** (GD 2.2081 arm64,
 * `PlayerObject::updateJump`; pipeline in PHYSICS-FROM-BINARY.md). Four facts,
 * all from the same function, and they only make sense together:
 *
 * 1. `+2724  fmov s2,#0.5; fmul s2,s1,s2; cmp w10,#0; fcsel s1,s2,s1,ne`
 *    — with `w10 = m_isRobot` loaded at `+236` and never reassigned on this
 *    path. **The robot's jump is half the cube's.**
 * 2. `+2236  s9 = m_isSpider ? 0.6 : (m_isRobot ? 0.9 : 1.0)`, and `s9`
 *    multiplies the gravity step at `+3016`. **Robot gravity is 0.9x.**
 * 3. `+236   w11 = m_isRobot ? ([0x936] & [0x935]) : [0x935]`, and `w11` gates
 *    the ground jump at `+2320`. Everyone else jumps on a *held* button; the
 *    robot needs the **buffered press** as well, so holding through a landing
 *    does not re-jump.
 * 4. `+2860..+2940` — the charge, which is what nothing here modelled:
 *    ```
 *    if (jumping && held && !cancelled && [0x7f8] < 1.5) {
 *        [0x7f8] += dt * 0.1;
 *        m_yVelocity += s9 * gravity * dt * (upsideDown ? -1 : +1);   // +2904
 *    }
 *    m_yVelocity -= s9 * gravity * dt * (upsideDown ? -1 : +1);       // +2992
 *    ```
 *    The two steps are the same magnitude with opposite signs, so holding does
 *    not *reduce* gravity — it **cancels it exactly**. The robot coasts at its
 *    take-off speed until the timer runs out, then falls normally.
 *
 * The timer is in the binary's dt units, where one 60 Hz frame is `0.9`
 * (`dtSlow`), i.e. `dt_binary = 54 * dt_seconds` — the same 54 that converts
 * raw velocity to world units in physics.ts. So the window is
 * `1.5 / 0.1 = 15` binary units = **15/54 s**.
 *
 * Together these give an apex of ~102 world units (3.4 blocks) for a full hold
 * and ~18 (0.6 blocks) for a tap, against the cube's flat 65. That spread is
 * the robot's whole character, and a half jump *without* the float — which is
 * what the two proved constants look like on their own — is strictly worse
 * than the old approximation. Do not ship one without the other.
 */
const ROBOT_JUMP_MULT = 0.5;
const ROBOT_GRAVITY_MULT = 0.9;
/**
 * `[0x7f8] < 1.5` accumulating `dt * 0.1`, converted out of binary dt units.
 *
 * Exported because the robot's remaining float budget is **search state**: two
 * robots at the same height and velocity with different budgets left are not
 * interchangeable, and `scripts/autoplay.mjs` has to say so in its beam key.
 */
export const ROBOT_HOLD_MAX = (1.5 / 0.1) / 54;

function stepRobot(
  p: PlayerState, dt: number, speed: number, input: StepInput,
): boolean {
  const g = gravitySign(p);
  let consumed = false;
  const tookOff = input.holding && p.queuedHold && p.onGround;
  if (tookOff) {
    p.yVel = speedConstants(speed).jump * ROBOT_JUMP_MULT * (p.mini ? MINI_VEL : 1) * g;
    applySlopeBoost(p, g);
    p.onGround = false;
    p.jumping = true;
    // A jump from a **fresh press** spends one step of charge on its take-off
    // frame; one held through a landing does not. Geometrical Dominator's
    // real run: all six floats started by a press last 67 frames, both started
    // by a held landing last 68 — the same pressed/held split as the cube's
    // jump timing (`StepInput.pressed`).
    p.holdTime = input.pressed ? dt : 0;
    input.jumped = true;
    if (!input.onOrb) { p.queuedHold = false; consumed = true; }
  }
  p.x = advanceX(p.x, speed * dt);
  // `[0x9cc]` is set only by the jump above, so an orb, a pad or walking off a
  // ledge does not start a charge — only the robot's own jump does.
  //
  // **The take-off frame spends no charge.** The charge block (2.2081 arm64
  // `updateJump` +0xb14) is skipped when `[0x94c]` is set, which is the flag the
  // jump raises, so the budget only starts running on the frame *after* the
  // jump — and the jump frame needs no cancellation anyway, since the jump
  // overwrites the velocity. That makes the float 68 frames long, not 67.
  //
  // It is one frame, and it is the difference between the 2x robot run in
  // level 19 being flyable and not: one step short leaves the arc 10.5 u/s slow
  // by the time the float gives out, and the section stops going through.
  // **Letting go ends the float for good.** A second press in the same arc does
  // not re-float, even with charge left (Geometrical Dominator f4317-4342: the
  // real robot releases 44 steps in, then fires a pink orb and falls under
  // gravity from 434.70; the port used to hold that velocity as a new float).
  // Across the native runs this took resync faults 135 -> 122.
  if (!input.holding && !p.onGround) p.holdTime = ROBOT_HOLD_MAX;
  const charging = !tookOff && p.jumping && !p.onGround && input.holding &&
    p.holdTime < ROBOT_HOLD_MAX;
  if (charging) p.holdTime += dt;
  const rg = speedConstants(speed).gravity * ROBOT_GRAVITY_MULT;
  p.yVel = quantizeVelocity(p.yVel - (charging || tookOff ? 0 : rg) * dt * g);
  clampTerminal(p, g);
  p.y = advanceY(p.y, p.yVel * dt);
  // no spin: the robot stays upright in the air
  if (p.onGround) p.jumping = false;
  return consumed;
}

function stepShip(p: PlayerState, dt: number, speed: number, input: StepInput): boolean {
  const g = gravitySign(p);
  const size = p.mini ? 0.85 : 1.0;
  // NOT "is it falling": the original tests `m_yVelocity < 2 * m_gravity`, so
  // a slow climb counts as slow too and only a fast one brakes. See
  // RISE_THRESHOLD.
  const sc = BASE_PHYSICS;
  // The slow/fast test reads `m_gravity`, the speed portal's row, while the
  // acceleration uses the base constant (see `BASE_PHYSICS`): Geometrical
  // Dominator f13696, a held ship at 2x and 103.46 u/s takes the fast branch —
  // over 2 x 0.957199 raw, under the base 2 x 0.958199. This made
  // Electrodynamix frame-exact; resync faults 54 -> 51.
  const riseRow = speedConstants(speed);
  // **The threshold is on the world velocity and is not mirrored by gravity**:
  // `slow` is `yVel < rise` the right way up and `yVel > rise` upside down.
  // Measured over every clean unheld ship frame of the 20 native runs: flipped,
  // world v below +103 takes the 1.2 branch (1409 frames, no exceptions) and
  // above it the 0.8 branch (733 frames) — the mirrored test (`yVel * g <
  // rise`) picked the wrong one for every flipped ship between -103 and +103,
  // Jumper frame 5797 onward.
  // A level with header key kA32 (`LevelSettingsObject` +0x1c2, copied to
  // the player's `[0x559]` in `resetLevelVariables`) takes `updateJump`'s other
  // branch, where the test is gravity-relative (`v > -2g` upside down). Only
  // Dash sets it.
  const slow = p.kA32 ? p.yVel * g < riseRow.rise : dualSlow(p, g, riseRow.rise);
  // original per-frame accel: gravity * shipAccel * extraBoost / playerSize
  const shipAccel = input.holding ? 1.0 : slow ? 0.8 : 1.2;
  const extraBoost = input.holding && slow ? 0.5 : 0.4;
  const accel = (sc.gravity * shipAccel * extraBoost) / size;
  // holding thrusts against gravity, releasing falls toward it
  const dir = input.holding ? g : -g;
  settleLaunch(p, g, size);
  p.x = advanceX(p.x, speed * dt);
  if (p.noClamp) {
    // **Past the cap after a launch the ship eases back to it** instead of
    // being clamped: Hexagon Force f8912-8917, a flipped ship launched off a
    // ramp at 368.3 loses exactly 4.64 a step (gravity x 1.0 x 0.4 / size,
    // the `-1.0` multiplier in `updateJump` turning it round) until it is
    // under 345.6, then clamps there as usual.
    const back = (sc.gravity * 1.0 * 0.4) / size;
    p.yVel = quantizeVelocity(p.yVel - Math.sign(p.yVel) * back * dt);
  } else {
    p.yVel = quantizeVelocity(p.yVel + dir * accel * dt);
  }
  clampShip(p, g, size);
  p.y = advanceY(p.y, p.yVel * dt);
  return false;
}

/** swing gravity multiplier: `m_vehicleSize != 1.0 ? 0.6 : 0.4` */
const SWING_GRAVITY_MULT = 0.4;
const SWING_GRAVITY_MULT_MINI = 0.6;
/** the entering speed a swing tap keeps across its flip */
const SWING_FLIP_KEEP = 0.8;

/**
 * The swing copter (2.2; only level 22 uses it).
 *
 * **It is not a ship, and it used to be flown as one.** Read straight out of
 * the shipping binary's `PlayerObject::updateJump` (`m_isSwing` branch, GD
 * 2.2081 arm64 `+716`; see PHYSICS-FROM-BINARY.md for the pipeline):
 *
 * ```
 * if (m_isSwing) {
 *   if (<queued press> && <held>) {
 *     float pre = (float) m_yVelocity;             // captured BEFORE the flip
 *     flipGravity(this, !m_isUpsideDown, true);    // call to PlayerObject::flipGravity
 *     m_yVelocity = pre * 0.8;                     // overwrites flipGravity's /2
 *   }
 *   float mult = (m_vehicleSize != 1.0) ? 0.6 : 0.4;
 *   m_yVelocity += mult * gravity * dt * (m_isUpsideDown ? +1 : -1);
 * }
 * ```
 *
 * So there is **no thrust and no hold** — between taps it is plain freefall at
 * 0.4x gravity (0.6x mini), and a tap flips gravity while keeping 0.8 of the
 * speed you arrived with. Flying it as a ship gave it thrust it does not have
 * and an accel curve (0.8 rising / 1.2 falling) that does not exist here.
 *
 * The `* 0.8` lands *after* `flipGravity`, so it overwrites the halving every
 * flip normally applies — the same ordering trap already documented for the
 * green orb. `flipGravity()` is still called (never set `gravityFlipped`
 * directly) and its halving is then deliberately discarded.
 */
function stepSwing(p: PlayerState, dt: number, speed: number, input: StepInput): boolean {
  let consumed = false;
  if (input.holding && p.queuedHold) {
    const pre = p.yVel;
    flipGravity(p, !p.gravityFlipped);
    p.yVel = pre * SWING_FLIP_KEEP;
    p.queuedHold = false;
    consumed = true;
  }
  const g = gravitySign(p);
  const mult = p.mini ? SWING_GRAVITY_MULT_MINI : SWING_GRAVITY_MULT;
  p.x = advanceX(p.x, speed * dt);
  p.yVel = quantizeVelocity(p.yVel - BASE_PHYSICS.gravity * mult * dt * g);
  // **The swing is clamped at 8.0 raw both ways** (size-scaled like the ship,
  // on the velocity grid): Dash f4375, the real swing rises at exactly 432
  // and holds it. The ship's asymmetric 8.0/6.4 breaks the run at f3995; the
  // symmetric clamp keeps it frame-exact to f5190.
  const lim = quantizeVelocity(8 * 54 / (p.mini ? 0.85 : 1));
  p.yVel = Math.max(-lim, Math.min(lim, p.yVel));
  p.y = advanceY(p.y, p.yVel * dt);
  return consumed;
}

function stepUfo(p: PlayerState, dt: number, speed: number, input: StepInput): boolean {
  const g = gravitySign(p);
  const size = p.mini ? 0.85 : 1.0;
  let consumed = false;
  // tap-only mid-air jump: raw 7 * playerSize (mini uses raw 8 * 0.85)
  if (input.holding && p.justHeld) {
    const newVel = (p.mini ? 8 : 7) * size * 54 * g;
    // original only applies the impulse if it increases upward velocity
    if ((newVel - p.yVel) * g > 0) {
      p.justHeld = false;
      p.yVel = newVel;
      consumed = true;
    }
  }
  // same `m_yVelocity < 2 * m_gravity` branch as the ship — and, like the
  // ship's, on the world velocity, not mirrored upside down (the mirrored
  // test cost 7 resync faults across the native runs)
  const sc = BASE_PHYSICS;
  const riseRowU = speedConstants(speed); // the speed row, as for the ship
  const gravMult = dualSlow(p, g, riseRowU.rise) ? 0.8 : 1.2;
  settleLaunch(p, g, size);
  p.x = advanceX(p.x, speed * dt);
  p.yVel = quantizeVelocity(p.yVel - ((sc.gravity * gravMult * 0.5) / size) * dt * g);
  clampShip(p, g, size);
  p.y = advanceY(p.y, p.yVel * dt);
  return consumed;
}

function stepBall(p: PlayerState, dt: number, speed: number, input: StepInput): boolean {
  let consumed = false;
  // Tap while touching a surface: take a full jump along the *pre*-flip up,
  // then flip (which halves it), then scale by 0.6 — the original's order in
  // `updateJump`. Doing the flip first inverted the sign, so the ball dived
  // into the surface it was sitting on instead of crossing to the other one.
  // the original sets `m_bIsHolding = false` here, so the ball cannot re-jump
  // until the button is released and pressed again
  /** a buffered press jumps after the frame's gravity — as the cube's does */
  let afterGravity = false;
  if (input.holding && p.queuedHold && (p.onGround || p.groundGrace > 0)) {
    p.groundGrace = 0;
    p.yVel = speedConstants(speed).jump * (p.mini ? MINI_VEL : 1) * gravitySign(p);
    applySlopeBoost(p, gravitySign(p));
    flipGravity(p, !p.gravityFlipped);
    p.yVel *= 0.6;
    p.onGround = false;
    p.queuedHold = false;
    input.jumped = true;
    consumed = true;
    // Hexagon Force: a press buffered in the air (f4689) jumps on landing at
    // 200.10 (f4700), a fresh press at 207.09 (f4326) — one gravity step apart
    afterGravity = !input.pressed;
  }
  const g = gravitySign(p);
  p.x = advanceX(p.x, speed * dt);
  // ball gravity multiplier 0.6
  if (!afterGravity) p.yVel = quantizeVelocity(p.yVel - BASE_PHYSICS.gravity * 0.6 * dt * g);
  clampTerminal(p, g);
  p.y = advanceY(p.y, p.yVel * dt);
  return consumed;
}

function stepWave(p: PlayerState, dt: number, speed: number, input: StepInput) {
  const g = gravitySign(p);
  // 45° diagonals: |yVel| equals the horizontal speed; mini is twice as steep
  // (the real mini wave: 623.16 = 2 x 311.58, Deadlocked frame 654 on)
  const w = speed * (p.mini ? 2 : 1);
  p.x = advanceX(p.x, speed * dt);
  p.yVel = (input.holding ? w : -w) * g;
  p.y = advanceY(p.y, p.yVel * dt);
}

/** spider falling is ordinary gravity; the teleport needs the world (caller) */
/** spider gravity multiplier, from the same switch that gives the robot 0.9 */
const SPIDER_GRAVITY_MULT = 0.6;

function stepSpiderFall(p: PlayerState, dt: number, speed: number) {
  const g = gravitySign(p);
  p.x = advanceX(p.x, speed * dt);
  // `updateJump` +2236: `s9 = m_isSpider ? 0.6 : (m_isRobot ? 0.9 : 1.0)`, and
  // s9 multiplies the gravity step at +3016 — the same 0.6 the ball gets.
  p.yVel = quantizeVelocity(p.yVel - speedConstants(speed).gravity * SPIDER_GRAVITY_MULT * dt * g);
  clampTerminal(p, g);
  p.y = advanceY(p.y, p.yVel * dt);
}
