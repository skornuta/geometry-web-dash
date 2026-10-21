// Portals, orbs, pads and coins (M4).
//
// Orb/pad forces are the original's ringJump values in raw units (kept in
// comments), converted x54 to world velocity; per-mode multipliers apply to
// the raw jump j = 11.180032 (= JUMP_VELOCITY).
import { P, propBool, propFloat, propInt } from "./props.ts";
import { SPEEDS, MINI_SCALE, gravitySign, flipGravity, speedConstants, quantizeVelocity } from "./physics.ts";
import { setGamemode, type Gamemode, type PlayerState } from "./gamemodes.ts";
import { cameraCenterForPortal } from "./camera.ts";
import type { TriggerRuntime } from "./triggers.ts";
import type { WorldView } from "../game/frame.ts";
import { PLAYER_HALF, type Box } from "../game/collision.ts";

/** per-attempt run state that interactives read and mutate */
export interface RunState {
  /** current horizontal speed (speed portals rewrite this) */
  speed: number;
  /** mirror portals reflect the world view; simulation coordinates stay y-up/rightward */
  mirrored: boolean;
  /** secret coins collected this attempt */
  coins: number;
}

// ---------------------------------------------------------------------------
// Portals
// ---------------------------------------------------------------------------

export const GAMEMODE_PORTALS: Record<number, Gamemode> = {
  12: "cube", 13: "ship", 47: "ball", 111: "ufo",
  660: "wave", 745: "robot", 1331: "spider",
  // 2.2's swing portal (GameObjectType 41 — see gen-objects.mjs)
  1933: "swing",
};

/** speed portal id -> index into SPEEDS */
const SPEED_PORTALS: Record<number, number> = {
  200: 0, 201: 1, 202: 2, 203: 3, 1334: 4,
};

/**
 * Apply a portal/speed trigger by object id. Dual portals are FLAG ONLY:
 * `onDual` is invoked (once per level, wired to a warning) and the single
 * player continues — full dual is deferred (used in levels 21/22).
 */
export function applyPortal(
  id: number, props: Map<number, string>,
  p: PlayerState, run: RunState, onDual?: () => void,
  /** a linked portal's (2902) exit, from `groupAnchor` */
  exit?: { x: number; y: number } | null,
  /** grow a grounded player on this frame (false: the block does it next step) */
  groundLift = true,
) {
  const mode = GAMEMODE_PORTALS[id];
  if (mode) {
    // A grounded player keeps its underside on the ground through the change
    // of size, on the portal's own frame — as a size portal does (case 99):
    // Dash f1167, a spider (27 box) resting at 13.5 becomes a cube at 15.
    if (groundLift && p.onGround && p.mode !== mode) {
      // (the wave rests on its 10 x 10 rect, 5 off a block — Dash f20734:
      // a grounded wave turning cube rises 10)
      const half = (m: string) => (m === "spider" ? SPIDER_SIZE : m === "wave" ? 1 / 3 : 1);
      p.y += 15 * (p.mini ? MINI_SCALE : 1) * (half(mode) - half(p.mode)) * gravitySign(p);
    }
    setGamemode(p, mode, run.speed);
    // the portal's own y decides where the camera anchors from here on
    const centre = cameraCenterForPortal(mode, propFloat(props, P.Y, p.y));
    if (centre !== null) p.cameraYCenter = centre;
    p.bandless = false;
    // Property 111 on a gamemode portal is 2.2's **free mode** camera:
    // `updateCameraMode` copies it onto the layer for every portal (m1
    // 0xfd518), and free mode drops the flying grounds (`updateDualGround`).
    // Dash's ball (7635) and swing (9315) portals set it: natively the camera
    // then follows the player like a cube's instead of locking to the centre.
    p.freeMode = propBool(props, 111);
    return;
  }
  const speedIdx = SPEED_PORTALS[id];
  if (speedIdx !== undefined) { run.speed = SPEEDS[speedIdx]; return; }
  switch (id) {
    // Gravity portals go through the same flip as everything else, so they also
    // halve the vertical velocity (PlayLayer::changeGravity -> flipGravity).
    // Setting the flag directly let the player keep all of its speed through the
    // portal, which is why they threw you far too far.
    case 10: flipGravity(p, false); break;
    case 11: flipGravity(p, true); break;
    case 45: run.mirrored = true; break;
    case 46: run.mirrored = false; break;
    // Resizing on the ground keeps the player's underside on it, that same
    // frame: Theory of Everything f3285, a mini ship resting at 99 (90 + 9)
    // is at 105 (90 + 15) on the very frame it crosses the normal portal.
    case 99:
      // APPROXIMATION (A49): a grounded mini UFO or robot on a block the game
      // reaches before the portal rises on the next pass instead (`groundLift`;
      // Theory of Everything f16051, Geometrical Dominator f21705 — BUGS
      // PHY-94); the cube and ship cases rise at once whatever the order
      // (ToE f3285, f11491; Electrodynamix f7032). The mode split is fitted.
      if ((groundLift || (p.mode !== "ufo" && p.mode !== "robot")) && p.mini && p.onGround) p.y += (15 - 15 * MINI_SCALE) * gravitySign(p);
      p.mini = false;
      break;
    case 101: p.mini = true; break;
    case 286: case 287: onDual?.(); break;
    // Teleport: the destination is **absolute**, measured from the *portal*, not
    // from the player — `getPortalTargetPos` returns
    // `{ player.x, object.y + m_teleportYOffset }` for id 747. Adding the offset
    // to the player's own y instead made the landing depend on where in the
    // portal you entered, so you could drop out below the pads you are meant to
    // land on (level 20, x=3327: portal y=197, offset -151 -> land at y=46,
    // right on the pads at y=34).
    case 747:
      p.y = propFloat(props, P.Y, p.y) + propFloat(props, P.TELEPORT_Y_OFFSET, 0);
      p.onGround = false;
      teleportExit(p, props);
      break;
    // The linked portal goes to its target group's object instead
    // (`getPortalTargetPos`), each axis unless key 352/353 keeps the player's
    // own. Dash f13836: through (15555, 615), key 352 set, the native player
    // is at exactly the exit object's y, 1815, on the portal's frame.
    case 2902:
      if (!exit) break;
      if (!propBool(props, P.TELEPORT_IGNORE_X)) p.x = exit.x;
      if (!propBool(props, P.TELEPORT_IGNORE_Y)) p.y = exit.y;
      p.onGround = false;
      teleportExit(p, props);
      break;
  }
}

/**
 * What `GJBaseGameLayer::teleportPlayer` (m1 0xf99d8) does to the player after
 * moving it:
 *
 * * key 354 `m_gravityMode` (+0x75c): 1 normal, 2 flipped, 3 toggle, through
 *   `flipGravity(…, noEffects = true)` — which still halves the velocity.
 * * key 345 `m_staticForceEnabled` (+0x741): `updateStaticForce(angle,
 *   key 346, key 443 additive)` (m1 0x38ff20) sets `m_yVelocity` to
 *   `force * sin(angle)` raw — the unit vector's x instead while sideways —
 *   or adds it when additive; a zero force that is not additive stops it.
 *
 * The angle is `180 - rotation` for a blue portal's exit (`0xf9c7c`: 180 for
 * ids 38/747/749/2064/2902). The same code adds 180 when a virtual on the exit
 * returns true; Dash's only static-force portal, (13035, 825), rotation 90
 * with key 4 set, leaves the native run at exactly +18 raw (f9799: 4.0017 up,
 * i.e. 972 less one step of gravity), so that virtual is not the X flip.
 */
function teleportExit(p: PlayerState, props: Map<number, string>) {
  // `flipGravity` halves the velocity even with noEffects (only `[0x7a9]`
  // skips it): Dash f13836, out of a linked teleport onto normal gravity the
  // real cube leaves at -19.8, half the port's old -39.7
  switch (propInt(props, P.TELEPORT_GRAVITY, 0)) {
    case 1: flipGravity(p, false); break;
    case 2: flipGravity(p, true); break;
    case 3: flipGravity(p, !p.gravityFlipped); break;
  }
  if (!propBool(props, P.TELEPORT_STATIC_FORCE)) return;
  const force = propFloat(props, P.TELEPORT_FORCE, 0);
  const additive = propBool(props, P.TELEPORT_FORCE_ADDITIVE);
  if (force === 0 && !additive) { p.yVel = 0; return; }
  const a = (180 - propFloat(props, P.ROTATION, 0)) * Math.PI / 180;
  const v = force * 54 * (p.sideways ? Math.cos(a) : Math.sin(a));
  p.yVel = additive ? p.yVel + v : v;
}

// ---------------------------------------------------------------------------
// Orbs (tap while overlapping; the caller handles buffering and touch state)
// ---------------------------------------------------------------------------

// Orb ids follow OpenGD's `GameObject.cpp` switch, which names each one:
//   36 yellow, 84 blue/gravity, 141 pink, 1022 green, 1330 black/drop,
//   1333 red, 1704 dash, 1751 gravity-dash, 3006 teleport.
// 84 and 141 were previously swapped with the pink/red forces, so the blue orb
// gave a pink hop and the pink orb flipped gravity. Cross-checked against the
// colour painted into the atlas art — see the EXTRA table in gen-objects.mjs.

/**
 * red orb (1333) per-mode multipliers of j.
 * A normal-size ship gets NO multiplier — only the mini ship gets 1.4.
 */
function redOrbMult(p: PlayerState): number {
  switch (p.mode) {
    case "ship": return p.mini ? 1.4 : 1.0;
    case "ufo": return p.mini ? 1.36 : 1.02;
    case "spider": case "ball": return 1.34;
    case "robot": return 1.28;
    default: return 1.38;
  }
}

/** pink orb (141) per-mode multipliers of j */
function pinkOrbMult(p: PlayerState): number {
  switch (p.mode) {
    case "ship": return 0.37;
    case "ufo": return 0.42;
    case "ball": return 0.77;
    default: return 0.72;
  }
}

/** black/drop orb (1330) absolute raw downward speed per mode */
function dropOrbSpeed(p: PlayerState): number {
  switch (p.mode) {
    case "ufo": return 11.2;
    case "ship": case "wave": return 14;
    case "spider": return 16.5;
    default: return 15;
  }
}

/**
 * Activate an orb by object id. Returns true when the press was consumed
 * (3006 teleport orb is render-only and consumes nothing — M4 note).
 */
/**
 * `PlayerObject::startDashing` (m1 0x386de8), classic (non-platformer) branch:
 * the orb's rotation becomes a direction, folded into the forward half and
 * clamped to ±70 degrees, and the dash moves `sin/|cos|` gravity-axis units per
 * unit of travel (`[0x570]`; the vector's axes swap while sideways).
 *
 *   a = -rotation (normalised to ±180)
 *   off = (sideways ? -90 : 0) + (reversed ? 180 : 0); a += off
 *   |a| > 90  ->  a = ±180 - a;  clamp a to [-70, 70];  a -= off
 *
 * Dash (13333, 675), rotation -45: the native cube climbs 1.614 per 1.614
 * travelled (f10099 on). The +180 the original adds when a virtual on the orb
 * (vtable 0x580) returns true is not modelled — see `teleportExit`.
 */
export function dashSlope(rotation: number, sideways: boolean, reversed: boolean): number {
  const norm = (a: number) => (a > 180 ? a - 360 : a < -180 ? a + 360 : a);
  let a = norm(-rotation % 360);
  const off = (sideways ? -90 : 0) + (reversed ? 180 : 0);
  if (off !== 0) a = norm(a + off);
  if (Math.abs(a) > 90) a = norm((a > 0 ? 180 : -180) - a);
  a = Math.min(70, Math.max(-70, a));
  if (off !== 0) a = norm(a - off);
  const r = a * Math.PI / 180;
  let [vx, vy] = [Math.cos(r), Math.sin(r)];
  if (sideways) [vx, vy] = [vy, vx];
  return vy / Math.abs(vx) + 0; // no -0 for a flat dash
}

export function activateOrb(
  id: number, p: PlayerState, speed: number = SPEEDS[1], props?: Map<number, string>,
): boolean {
  // The drop orb returns early in the original, *before* the mini and
  // ball/spider scaling, so it alone is an absolute speed.
  // `ringJump` also does `setIsOnGround(false)` for every ring
  if (id === 1330) {
    p.yVel = -dropOrbSpeed(p) * 54 * gravitySign(p);
    p.onGround = false;
    // Its first step escapes the terminal clamp: Fingerdash f7190, the real
    // cube drops 821.66 (-810 plus one gravity step) and only then settles at
    // the clamp's 810. Not the spider's: f9450, its 891 drop is clamped to
    // 810 on the first step (the spider has its own update branch).
    p.skipClamp = p.mode !== "spider";
    return true;
  }
  if (id === 1704 || id === 1751) {
    p.dash = id === 1704 ? 1 : 2;
    p.dashSlope = dashSlope(props ? propFloat(props, P.ROTATION, 0) : 0, p.sideways, p.reversed);
    return true;
  }
  if (id === 3006) return false;                 // teleport orb: render only

  // `newYVel` starts at the raw jump height and is scaled per orb, then by the
  // gravity sign, then by mini, then by ball/spider — in that order.
  let mult: number;
  switch (id) {
    case 36: // yellow — robot is the only mode that changes it
      mult = p.mode === "robot" ? 0.9 : 1;
      break;
    case 1333: mult = redOrbMult(p); break;
    case 141: mult = pinkOrbMult(p); break;
    case 84: mult = 0.8; break;                             // blue / gravity
    case 1022: mult = p.mode === "ship" ? 0.7 : 1; break;    // green
    default: return false;
  }

  // The two gravity orbs differ in a way that is easy to get backwards, and
  // both readings are visible in the original's ordering:
  //   green (1022) flips FIRST, so its velocity takes the *post*-flip sign and
  //     the halving is overwritten by the assignment that follows;
  //   blue (84) flips LAST, so it takes the *pre*-flip sign and then really is
  //     halved.
  if (id === 1022) flipGravity(p, !p.gravityFlipped);

  // The jump is the **current speed's** (`speedConstants(speed).jump`), not
  // normal speed's: Electrodynamix frame 2253 at 2x, the real yellow ring
  // gives 616.68 u/s (11.420032 * 54) where the 1x constant gave 603.72.
  p.yVel = speedConstants(speed).jump * mult * gravitySign(p) * (p.mini ? 0.8 : 1);
  p.onGround = false;
  // The launch lands on the 0.001-raw grid like every velocity (Geometrical
  // Dominator f10805: a robot on a pink orb leaves at 8.222 raw, not 8.22242)
  // — *before* the ball/spider 0.7, which is applied to the rounded value:
  // Clubstep f9164, a mini ball on a yellow orb moves at 6.131 raw after its
  // first gravity step (8.944 x 0.7), where rounding last gives 6.132.
  p.yVel = quantizeVelocity(p.yVel);
  // `ringJump` +2644..2700: ball and spider x 0.7, swing x the double 0.6
  // (0x3fe3333340000000); no other mode is scaled
  if (p.mode === "ball" || p.mode === "spider") p.yVel *= 0.7;
  else if (p.mode === "swing") p.yVel *= 0.6;

  if (id === 84) flipGravity(p, !p.gravityFlipped);
  return true;
}

// ---------------------------------------------------------------------------
// Pads (auto-activate on touch, no press; the caller re-arms on leaving)
// ---------------------------------------------------------------------------

/**
 * `PlayerObject::propellPlayer(force)`:
 *   yVel = flipMod * 16 * force * (mini ? 0.8 : 1),  then ball/spider *= 0.6
 * The per-pad `force` values are the call sites in PlayLayer — these are the
 * real numbers, not the guesses they replaced (pink was 0.6, red 1.5).
 */
const PAD_BASE = 16 * 54;
/**
 * Pad forces, read from the dispatch at m1 `0x100100540`. It switches on
 * `GameObjectType` and defaults to 1.0, which is why the **yellow** pad (type 8)
 * never appears in it. The gravity pad (type 10) is not in that switch either —
 * it reaches `propellPlayer(0.8, …)` from a separate call site (`0x1001007f8`)
 * and flips *afterwards*, so its flip halves what the propel just wrote.
 */
const PAD_FORCE: Record<number, number> = {
  35: 1,      // yellow
  140: 0.65,  // pink — cube/robot; per-mode variants below
  1332: 1.25, // red   — ditto
  67: 0.8,    // blue / gravity (then halved by its own flip)
};

/** the pink and red pads read the player's mode and size before deciding */
function padForce(id: number, p: PlayerState): number | undefined {
  const base = PAD_FORCE[id];
  if (base === undefined) return undefined;
  if (id === 140) {
    if (p.mode === "ship") return 0.35;
    if (p.mode === "ufo") return 0.4;
    if (p.mode === "ball" || p.mode === "spider") return 0.7;
    return base;
  }
  if (id === 1332) {
    if (p.mode === "ship") return p.mini ? 0.95 : 0.63;
    if (p.mode === "ufo") return p.mini ? 0.98 : 0.6;
    return base;
  }
  return base;
}

/**
 * Activate a pad by object id — 35 yellow, 140 pink, 67 blue/gravity, 1332 red,
 * per OpenGD's `GameObject.cpp` switch and the atlas art (bump_01 yellow,
 * bump_03 magenta, gravbump_01 cyan, bump_02 orange/red).
 *
 * 1332 was previously treated as a spider pad and teleported the player. The
 * spider pad is a different object (1594), which is not in the object table —
 * see gen-objects.mjs.
 */
export function activatePad(id: number, p: PlayerState) {
  // **Fix Robot Jump** (level header kA34 → `LevelSettingsObject` +0x1c4; the
  // player keeps its negation at [0xb50]): `bumpPlayer` (m1 0x38f9d0) then
  // raises [0x94c], which stops a robot's jump charge (`updateJump` +0xb14)
  // until its next own jump. Without it — every classic level — a robot that
  // hits a pad mid-jump keeps floating on its old charge: the editor text calls
  // it "robot jumps being bugged on slopes and/or pads". (Dash sets it.)
  if (p.fixRobotJump) p.jumping = false;
  const force = padForce(id, p);
  if (force === undefined) return;
  // `propellPlayer` +136..+208 sends ball, spider AND swing to +304, which
  // multiplies the launch by the double 0x3fe3333340000000 = 0.6 before the
  // animation hook. Removing this costs the sweep 8 levels — measured.
  const heavy = p.mode === "ball" || p.mode === "spider" || p.mode === "swing";
  const mult = (p.mini ? 0.8 : 1) * (heavy ? 0.6 : 1);
  // the propel uses the pre-flip sign; the gravity pad flips afterwards, which
  // halves what it just applied (so it lands at an effective force of 0.4)
  p.yVel = PAD_BASE * force * mult * gravitySign(p);
  // `propellPlayer` does `setIsOnGround(false)`. Without it the player is still
  // considered grounded, so the very next step's ordinary jump overwrites the
  // pad's launch with the (weaker) jump velocity — the pad looks like it barely
  // did anything when you hold the button over it.
  p.onGround = false;
  if (id === 67) flipGravity(p, !p.gravityFlipped);
}

// ---------------------------------------------------------------------------
// Spider teleport (also used by the spider pad, 1332)
// ---------------------------------------------------------------------------

/** how far the spider scans for a surface before clamping */
export const SPIDER_SCAN = 1800;
/**
 * APPROXIMATION (tunable): fallback ceiling when the spider finds nothing
 * above it. The ground plane (y = 0) is the downward fallback.
 */
export const LEVEL_CEILING = 1500;

/**
 * Teleport to the nearest solid surface in the direction opposite to gravity,
 * flip gravity and zero yVel. Works mid-air. Falls back to the ground plane
 * or LEVEL_CEILING when nothing is found within SPIDER_SCAN.
 */
/**
 * **The spider's box is 27 units, not 30** (0.9 of the player's): every rest
 * in the native runs sits 13.5 from the surface — Fingerdash's floors at
 * 223.5 and ceilings at 376, Dash's walls once gameplay turns — where 15 left
 * the port 1.5 off on every spider frame. With the flip on the press (see
 * `simPress`) this took resync faults 62 -> 59.
 */
export const SPIDER_SIZE = 0.9;

/**
 * `GameObject::isFacingDown` (m1 0x4f9198) and its sideways twin (0x4f9228):
 * the rotation, truncated to whole degrees, and the Y flip. Multiples of 90
 * take their own branch (down only at +-180); anything else is down inside
 * 91..269 (or the mirrored -269..-91), and the flip inverts it. The sideways
 * form is "facing left": multiples of 90 give 270 unflipped or 90 flipped.
 */
export function objectFacing(rotation: number, flipY: boolean, sideways = false): boolean {
  const r = Math.trunc(rotation);
  const inRange = (r >= 91 && r <= 269) || (r >= -269 && r <= -91);
  const multiple = r % 90 === 0;
  if (!sideways) return flipY !== (multiple ? Math.abs(r) === 180 : inRange);
  if (multiple) {
    const n = r < 0 ? r + 360 : r;
    return (n === 270 && !flipY) || (n === 90 && flipY);
  }
  return flipY !== inRange;
}

/**
 * The spider orb (3004, `GameObjectType` 43), `ringJump` +792..888: the
 * player's gravity is first set to the direction the orb faces (through
 * `flipGravity`, only when it differs), then `spiderTestJump` teleports it to
 * the surface along that gravity and flips. So the exit is fixed by the orb's
 * orientation, not by the gravity the player arrived with. Dash's two orbs
 * (13965 upright, 14325 flipped) are entered at the aligned gravity and match
 * a plain toggle; entered the other way round the plain toggle goes the wrong
 * way.
 */
export function spiderOrbJump(
  p: PlayerState, world: WorldView, rt: TriggerRuntime | undefined, props: Map<number, string>,
) {
  const facing = objectFacing(propFloat(props, P.ROTATION, 0), propBool(props, P.FLIP_Y), p.sideways);
  if (p.gravityFlipped !== facing) flipGravity(p, facing);
  spiderTeleport(p, world, rt);
}

export function spiderTeleport(p: PlayerState, world: WorldView, rt?: TriggerRuntime) {
  const g = gravitySign(p);
  // the player's own size: Dash f10382, a cube sent up by the spider orb rests
  // 15 under the ceiling, not the spider's 13.5
  const half = PLAYER_HALF * (p.mini ? MINI_SCALE : 1) * (p.mode === "spider" ? SPIDER_SIZE : 1);
  const probe: Box = { x: p.x, y: p.y + (g * SPIDER_SCAN) / 2, hw: half, hh: SPIDER_SCAN / 2 };

  let best = Infinity;
  let landY = 0;
  // trigger-moved blocks count at their current place (Dash f776: the ceiling
  // the real spider flips onto is a moved group; without `rt` it was missed
  // and the spider flew off the top of the level)
  for (const c of world.near(probe, rt)) {
    if (c.kind !== "solid") continue;
    // the player teleports straight up/down inside its own column
    // **The column runs from the spider's centre to its front edge.** Dash
    // f776: the real spider flips onto a block just ahead, 0.95 inside its
    // front edge; Fingerdash f9961: it ignores a column behind it that
    // overlaps its box by 7.7 and flies on to the platform above. (This made
    // Fingerdash complete its real run.)
    if (c.x + c.hw <= p.x || c.x - c.hw >= p.x + half) continue;
    // the face the player ends up resting against (block bottom when rising)
    const surface = g > 0 ? c.y - c.hh : c.y + c.hh;
    const land = surface - g * half;
    const dist = (land - p.y) * g;
    if (dist > 0.001 && dist < best) {
      best = dist;
      landY = land;
    }
  }
  if (best === Infinity) landY = g > 0 ? LEVEL_CEILING - half : half;

  p.y = landY;
  flipGravity(p, !p.gravityFlipped);
  // The flip leaves the spider moving 1.0 raw toward its new ground. Invisible
  // when it lands on the next step (the usual case), but Dash f2008-2009 goes
  // straight on into a ball portal and a pad, and the real player drops 0.254
  // first: -54 plus one ball gravity step.
  p.yVel = -54 * gravitySign(p);
  p.onGround = false;
}
