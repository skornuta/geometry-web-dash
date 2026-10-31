// Camera model and the free-fly band, both taken from PlayLayer.
//
// The single most important fact: **in the flying gamemodes (ship, UFO, ball,
// wave, swing) the camera does not follow the player at all** — only the
// ground modes (cube, robot, spider) do. It is locked to `m_fCameraYCenter`,
// which `changeGameMode` sets when a portal is entered. That is what stops a
// ship climbing forever — not the hard kill height, which sits far above
// everything (see KILL_HEIGHT in physics.ts).
//
// Derivation of the band, for anyone who wants to check it:
//   updateCamera (non-cube):  camBottom = cameraYCenter - VIEW_H/2, floored at 0
//   changeGameMode ship/ufo/wave:  ground -> -68, ceiling -> 388
//   changeGameMode ball:           ground -> -38, ceiling -> 358
//   checkCollisions floor:    y < groundLocal + camBottom + 93
//   checkCollisions ceiling:  y > ceilingLocal - 240 + cameraYCenter - 12
// Substituting camBottom gives, for ship/ufo/wave:
//   floor   = -68 + (centre - 160) + 93 = centre - 135
//   ceiling = 388 - 240 + centre - 12   = centre + 136
// and for ball, -38 / 358 give centre - 105 and centre + 106. Both land on a
// symmetric band around the camera centre, which is the useful way to hold it.
import type { Gamemode } from "./gamemodes.ts";
import { easedValue } from "./easing.ts";

/**
 * **Coordinate offset — read this before touching any constant below.**
 * The original's world puts the ground *surface* at y = 105: a standing player
 * sits there (`lastGroundPos.y == 105`), the floor clamp is `+93` above a
 * ground sprite at 12, and the default camera centre is 240. Our world puts the
 * ground surface at y = 0 with a standing player at y = 15.
 *
 *     gd_y = our_y + 90
 *
 * Every absolute height taken from PlayLayer (240, 210, 270, 1140, the portal
 * thresholds) is in GD space and must be shifted by this. Offsets *within* the
 * view — the 120/90 deadzone margins and the band half-heights — are relative
 * and carry over unchanged.
 *
 * Applying GD's absolutes directly is what put the view bottom at exactly y = 0
 * and hid the ground entirely.
 */
export const GD_Y_OFFSET = 90;

/**
 * Design resolution, and the rule for mapping it onto a real viewport.
 * `AppDelegate::setupDesignResolution` picks the policy from the aspect ratio:
 *
 *     if (screenH / 320 <= screenW / 480)  FIXED_HEIGHT   // 3:2 or wider
 *     else                                 FIXED_WIDTH    // narrower than 3:2
 *
 * So a wide window keeps 320 units of height and reveals more width, while a
 * narrow one keeps 480 units of width and reveals more *height*. Always using
 * fixed-height (what we did before) crops a narrow viewport horizontally
 * instead, which is why the game looked wrong in a small embedded browser.
 */
export const DESIGN_W = 480;
export const DESIGN_H = 320;

/** kept for callers that just want the design height */
export const VIEW_H = DESIGN_H;

/** world units visible in a canvas of the given pixel size, and the px/unit scale */
export function resolveView(canvasW: number, canvasH: number): {
  scale: number; viewW: number; viewH: number;
} {
  const fixedHeight = canvasH / DESIGN_H <= canvasW / DESIGN_W;
  const scale = fixedHeight ? canvasH / DESIGN_H : canvasW / DESIGN_W;
  return { scale, viewW: canvasW / scale, viewH: canvasH / scale };
}

/** `cam.y = clampf(cam.y, 0.0f, 1140.f - winSize.height)` */
export const CAM_MIN_Y = 0 - GD_Y_OFFSET;
export const CAM_MAX_Y = 1140 - VIEW_H - GD_Y_OFFSET;

/** cube deadzone: the player may sit this far from the view's bottom / top */
const DEAD_BOTTOM = 120;
const DEAD_TOP = 90;

/** default `m_fCameraYCenter` before any portal sets it */
export const DEFAULT_CAMERA_Y_CENTER = 240 - GD_Y_OFFSET;

/**
 * Half-height of the band the player's **edge** is confined to: 150 for the
 * flying modes, 120 for the ball. The player's centre stops that edge minus its
 * own half-size short of it.
 */
const BAND_EDGE: Partial<Record<Gamemode, number>> = { ship: 150, ufo: 150, wave: 150, ball: 120, spider: 120 };

/**
 * Half-size the band measures the player by. 15 for the 30-unit player and 9
 * for a mini (x0.6), except the wave, which stops 10 (mini 6) short of the
 * edge — its solid box is a third of the icon.
 */
function bandHalf(mode: Gamemode, mini: boolean): number {
  const half = mode === "wave" ? 10 : mode === "spider" ? 13.5 : 15;
  return mini ? half * 0.6 : half;
}

/**
 * How far the player's centre may go below and above the camera centre.
 * `null` means unconfined.
 *
 * **Measured from the 21 native macros** (`macros-main/`), not derived: every
 * frame of every real run was compared against the port's `cameraYCenter`, and
 * every place a run lies flat against the band gives the same answer —
 *
 *     ship -135 (flipped and dual: ±135)   ship mini -141
 *     ball -105 (flipped: ±105)            ball mini -111
 *     wave ±140 (dual, both edges)         wave mini -144
 *
 * so the band is **symmetric** and it is the *edge* that is fixed, the centre
 * stopping one half-size short of it. The older table (`+136`/`+106` above,
 * `135` below whatever the size) came from substituting PlayLayer constants and
 * disagrees with the game twice: a mini's floor sat 6 units high, and a flipped
 * player — whose gravity side is the *top* — rested one unit into the ceiling
 * (L9 x=9297, the flipped ball rolls at exactly +105, not +106).
 *
 * **The spider has the ball's kind of band** (edge 120, half-size 13.5, so ±106.5): Fingerdash's real run rests on exactly that, every macro still replays
 * frame-exact with it, and without it a press with no block above sent the spider
 * to y 1500, out through the top of the level (`spiderTeleport`'s fallback).
 * A free-mode spider (portal key 111) is unconfined, as before.
 *
 * Cube, robot and swing are unconfined. For the robot this is checked,
 * not assumed: real runs go from 225 below to 364 above the centre (L19/L20),
 * and giving it the ship's band ends L19's replay 1950 units early.
 */
/**
 * The ground height a camera zoom other than 1 gives (`getScaledGroundHeight`,
 * m1 0x102afc): the full height h becomes floor(h / zoom / 30) · 30, so a
 * zoomed-out view pushes the floor and ceiling out toward its edges — Dash's
 * ship at zoom 0.6 (69–75 %) flies a 480-unit band, the floor a thin strip at
 * the screen's bottom and the ceiling off the top, as the 2.2 playthrough shows.
 */
export function scaledBandEdge(edge: number, zoom: number): number {
  if (zoom === 1 || !(zoom > 0)) return edge;
  return (Math.floor((2 * edge) / zoom / 30) * 30) / 2;
}

export function bandFor(mode: Gamemode, mini: boolean, zoom = 1): { below: number; above: number } | null {
  const base = BAND_EDGE[mode];
  if (base === undefined) return null;
  const edge = scaledBandEdge(base, zoom);
  const reach = edge - bandHalf(mode, mini);
  return { below: reach, above: reach };
}

/**
 * The camera centre a gamemode portal installs. Below a mode-specific height
 * the game snaps to a fixed value, otherwise it quantises the portal's y to the
 * 30-unit grid.
 *
 * The spider takes the flying snap. The binary's camera-target function (the
 * unnamed code at m1 0xfd210, called from `switchToSpiderMode` m1 0xfd160 with
 * mode code 0x21) picks its threshold from the mode code (300, 240 or 270)
 * and takes the larger of two thresholds; the spider's only special step is a
 * gate that skips the 270 check (`cmp w21, #0x21` at 0xfd364). The spider's
 * floor (240 here, as for the ship) is not decoded: 270 is what the threshold
 * gives for mode 0x21. It does not change the portals in Fingerdash (y 225) or
 * level 3001 (y 285), whose heights are above 270. Cube, robot and swing inherit.
 */
export function cameraCenterForPortal(mode: Gamemode, portalY: number): number | null {
  const gdY = portalY + GD_Y_OFFSET;
  switch (mode) {
    case "ship": case "ufo": case "wave": case "spider":
      return (gdY < 270 ? 240 : Math.floor(gdY / 30) * 30) - GD_Y_OFFSET;
    case "ball":
      return (gdY < 240 ? 210 : Math.floor(gdY / 30) * 30) - GD_Y_OFFSET;
    default:
      return null; // cube/robot/swing inherit the current centre
  }
}

/**
 * The camera centre the game computes for a mode change (`setupCameraMode`,
 * installed build 0x1000e0fa0-0x1000e104c): `H / 2 + max(floor((y - H / 2) / 30) * 30, 90)`
 * for the mode's height H. H is 300 flying, 240 for a ball and 270 otherwise
 * (the threshold function at 0x1000dea80); **with two players active the
 * ball's 240 becomes 270**, so a ball portal at GD y 554 centres the view at
 * 135 + floor(419 / 30) * 30 = 525 instead of the single player's 540 - the
 * real level-16 camera at x 19894 (grace-16.txt: bottom 365 = centre 525).
 */
export function cameraCenterForDualBall(portalY: number): number {
  const half = 270 / 2;
  const gdY = portalY + GD_Y_OFFSET;
  return half + Math.max(Math.floor((gdY - half) / 30) * 30, 90) - GD_Y_OFFSET;
}

/**
 * Target position of the **bottom edge** of the view.
 *
 * Cube uses a deadzone: while the player stays between `DEAD_BOTTOM` above the
 * view's bottom and `DEAD_TOP` below its top, the camera does not move at all;
 * outside it the camera moves just enough to put the player back on that edge.
 *
 * The robot and the spider do the same; everything else ignores the player
 * entirely and locks to the centre.
 */
export function cameraBottomTarget(
  mode: Gamemode, playerY: number, gravityFlipped: boolean,
  cameraYCenter: number, current: number, viewH: number = DESIGN_H,
  freeMode = false, free: FreeCamera | null = null,
): number {
  let camY: number;
  if (freeMode) mode = "cube";
  // The cube and the robot follow the player through the deadzone; the flying
  // modes and the spider (without free mode, which made `mode` cube above) lock
  // to the centre. Native Dash spider x 975–1544 (dash-full.txt, Oct 3): the
  // view holds at 79.0 while the player moves 163–292. The port's deadzone
  // moved it 20–30 units there. Deadlocked 50% (robot, y 177): the native frame
  // puts the view's bottom near 17 — inside the cube deadzone's reach (-53..57)
  // — where the locked centre had it at 146, showing the ceiling instead of
  // the acid floor.
  if (mode !== "cube" && mode !== "robot") {
    // `cam.y = winSize.height * -0.5 + cameraYCenter`, floored at 0 in GD space
    camY = Math.max(0 - GD_Y_OFFSET, cameraYCenter - viewH / 2);
  } else {
    // **The margins swap with gravity**: 70 above / 40 below the view centre
    // upright, 40 above / 70 below while the player is upside down
    // (`updateCamera` exchanges its pair by `m_isUpsideDown`, m1 0x124d58).
    // Fitted from the real Dash run (`captures-2026-10-03/dash-full.txt`, per
    // frame, centre = camY + 160/zoom, static-free cube stretches): upright, the
    // centre chases the player at ~1/39 a frame once it is more than 70 above or
    // 40 below it, at zoom 1.0 and 0.91 alike; upside down the up margin reads
    // 39.3. Electroman Adventures x 20183 (`grace-13.txt`, an upside-down cube)
    // draws 99.6 without the swap and the game's 117.3 with it. An earlier
    // version kept the upright margins on a flip because the `seek`-made native
    // log showed the camera 45-60 above centre after the blue orb at Dash x 855
    // — seek captures do not run the camera as the game does, and the real
    // run's camera is moving by then (gap 55 at x 841, 43.1 -> 50.5 by x 853).
    const edgeTop = DEAD_TOP, edgeBottom = DEAD_BOTTOM;
    let top = gravityFlipped ? edgeBottom : edgeTop;
    let bottom = gravityFlipped ? edgeTop : edgeBottom;
    if (freeMode && free) {
      // symmetric about the centre, from the portal's padding and the zoom
      top = bottom = viewH / 2 - freeMargin(free.padding, free.zoom, viewH);
    }
    camY = current;
    if (playerY <= viewH + camY - top) {
      if (playerY < bottom + camY) camY = playerY - bottom;
    } else {
      camY = playerY - viewH + top;
    }
  }
  // `clampf(cam.y, 0, 1140 - winSize.height)`, shifted into our space
  return clampCamY(camY, viewH);
}

/**
 * The level's height cap in GD units: 1140, unless the level sets **Dynamic
 * Level Height** (kA37, `LevelSettingsObject` +0x1c5 — the editor text: "Increases
 * max level height dynamically (the same way as max length)"). Dash sets it
 * and climbs to y≈2700, where the fixed cap froze the camera. APPROXIMATION
 * A41: the dynamic cap is taken as the highest object + one view, its exact
 * rule is not decoded.
 */
let levelHeightCap = 1140;
export function setLevelHeightCap(gdHeight: number) { levelHeightCap = Math.max(1140, gdHeight); }

/** `clampf(cam.y, 0, maxHeight - winSize.height)`, shifted into our space */
export function clampCamY(camY: number, viewH: number = DESIGN_H): number {
  return Math.min(levelHeightCap - viewH - GD_Y_OFFSET, Math.max(CAM_MIN_Y, camY));
}

/**
 * Camera bottom edge for a **dual**: put the two players' midpoint dead centre.
 *
 * Neither single-player rule is right here. The cube deadzone only moves the
 * camera once the tracked point leaves a ~110-unit band, so feeding it the
 * midpoint lets the pair drift off centre — measured on level 16 at x=11005,
 * the two cubes sat at screen y 400 and 105, a midpoint of 252 against a screen
 * centre of 360, and the level's ground was visible below a section that lives
 * at y~360-460. The non-cube rule is worse: it ignores the players entirely and
 * locks to `cameraYCenter`.
 *
 * **It takes the two players' static `cameraYCenter` anchors, not their live
 * positions.** Outside cube the original's camera never follows the player at
 * all — it locks to `cameraYCenter` — and a dual is no exception. Centring on
 * the live midpoint instead makes the view chase whichever player is moving,
 * which reads as the camera being stuck to one icon and is worse than the
 * off-centre framing it replaced. The anchors are installed by the dual portal
 * (which sits at the corridor's centre) and then by each player's own gamemode
 * portal, so their midpoint is a fixed, correct centre for the section.
 *
 * The usual level-bounds clamp still applies.
 */
export function dualCameraBottom(anchorY: number, viewH: number = DESIGN_H): number {
  return clampCamY(anchorY - viewH / 2, viewH);
}

/**
 * How far behind the view's centre player 1 rides: the view's left edge is
 * `player.x - (winW / 2 - 75)`. `PlayLayer::updateVisibility` (m1 0xa4b78)
 * builds its section window from exactly `winW * 0.5 + -75` around the camera,
 * and the game's camera measured at Theory of Everything x=2326 (571-unit view)
 * put its left edge 210.5 behind the player — `571 / 2 - 75`. The port used
 * 2.1's `winW / 2.5` (228.4 there), which shifted every level ~18 units and
 * put the edge fade in the wrong place.
 */
export const CAMERA_LEAD = 75;

/** the view's left edge for a player at `x` */
export function cameraLeftFor(x: number, viewW: number): number {
  return x - (viewW / 2 - CAMERA_LEAD);
}

/**
 * A Camera Static (1914) view: `TriggerRuntime.viewStatic`. `axis` is key 101
 * (0 both, 1 x, 2 y). `exitAxis` is the mask of axes an exit has released
 * (bit 1 x, bit 2 y), which the view eases back to the player.
 */
export interface ViewStatic {
  group: number; axis: number; dur: number; type: number; rate: number; t: number;
  exit: boolean; exitAxis: number; fromX: number | null; fromY: number | null;
  /** key 212 (follow) with key 213 easing: the view chases the target, 1/easing a frame */
  follow: number;
  /**
   * key 453 (smooth velocity): the view travels a cubic Bezier that leaves its
   * start with the speed the view already had (`smoothBezier`)
   */
  smooth?: boolean;
  /** key 454, the velocity modifier (`updateStaticCameraPosToGroup` arg 2, stored at +0x268) */
  velMod?: number;
  /** the view's velocity (units/s) when the static began; set on the first frame */
  vx?: number; vy?: number;
  /** the plain ease's start offset from its target (`easeOffset`), set on the first frame */
  gx?: number; gy?: number;
}

/**
 * The plain (not smooth) ease toward a target that may move: the view's offset
 * from the target eases to zero, `view = target(t) + (from - target(0)) * (1 - p)`.
 * For a fixed target this is the from-to lerp; for a moving one that does not
 * depend on the view (turned play's lead on the player) the view is dragged along at the target's own speed from the first frame (a lerp between
 * the two end points would only follow it in proportion to p). Dash x 20775
 * (rows 17094-17330, a robot rising 2 a row, the exit's 1 s in-out ease to the
 * follow camera, which leads the player by 75 / zoom): the real view is
 * reproduced to rmse 0.26 over 340 rows. (`updateCamera` 0x1092c0 writes the
 * same thing as an increment, `pos += (T - pos)(p - p_prev)/(1 - p_prev)`; the
 * increment reading did *not* match the rows against a moving target.)
 */
export function easeOffset(offset0: number, target: number, p: number): number {
  return p >= 1 ? target : target + offset0 * (1 - p);
}


/**
 * One axis of a smooth-velocity static (`updateCamera` m1 0x124838, the branch
 * taken while the ease progress is below 1 and +0x260 is set — the installed
 * build's copy is at 0x100108ef0): a cubic Bezier with control points
 * P0 (the view at the static's start), P1 = P0 + v * dur / 3 (v the view's
 * velocity then; the game reads it from +0x200 / +0x204 scaled by +0x208 /
 * +0x20c), P2 = T + (P1 - T) * modifier and P3 = T (the guide), evaluated at
 * the ease progress `p`. A zero modifier ends the curve at rest on T.
 *
 * Checked on the real Dash run (dash-full.txt, x 11385, spider): with P1 from
 * the view's own speed at the trigger (0.725 a step), solving the curve at
 * p = 0.21 / 0.5 / 0.63 / 0.71 for P2 gives 827 / 837 / 815 / 806 against the
 * guide's 825. The modifier's default when key 454 is absent is therefore 0
 * (APPROXIMATION: the value the game passes is not read from the binary).
 */
export function smoothBezier(p0: number, v: number, dur: number, t: number, p: number, mod: number): number {
  const p1 = p0 + (v * dur) / 3;
  const p2 = t + (p1 - t) * mod;
  const u = 1 - p;
  return u * u * u * p0 + 3 * p * u * u * p1 + 3 * p * p * u * p2 + p * p * p * t;
}

/**
 * One frame of a Camera Static's view, written to `out`. Returns false once
 * every axis is released and eased home, so the caller can drop the static.
 *
 * `exitStaticCamera` (m1 0x12b6b0) releases an axis only when the exit's
 * flag is set for it (exitX = axis != 2, exitY = axis != 1) and the axis has
 * a static active; the other axis keeps its static. So an x-only exit leaves
 * the y target in place (Dash x 15767: key 101 = 1, the view's bottom stays
 * on group 304's guide while x follows the player, native f11616–15472).
 *
 * `frame` is the 60 Hz frame count since the static began (for follow).
 */
export function stepViewStatic(
  vs: ViewStatic, tgX: number, tgY: number, camX: number, camY: number,
  lastX: number, lastY: number, frame: number, paused: boolean,
  out: { x: number; y: number }, offX = 0, offY = 0, lastOffX = offX, lastOffY = offY,
  velX = 0, velY = 0, trackTarget = false,
): boolean {
  const hold = vs.axis === 0 ? 3 : vs.axis;
  const rel = vs.exitAxis & hold;
  const relX = (rel & 1) !== 0, relY = (rel & 2) !== 0;
  const holdX = (hold & 1) !== 0 && !relX, holdY = (hold & 2) !== 0 && !relY;
  // A follow chases the group's own point; the zoom's offset (`zoomedTarget`)
  // is added to what it reaches, not chased with it. Native Dash 13200–14800
  // (dash-full.txt): the zoom swings 0.6 -> 0.96 -> 0.6 while the view's centre
  // stays 1 % a frame behind the guide, and the bottom is that centre less
  // 160 / zoom at every sample. A static without follow keeps its from-to ease
  // in the zoomed space (offsets are 0 there).
  const chase = vs.follow > 0;
  if (vs.fromX === null || vs.fromY === null) {
    // `lastOff*`: the offset already inside `last*` (the view a previous
    // static drew at its zoom; none if the plain follow drew it)
    vs.fromX = chase ? lastX - lastOffX : lastX;
    vs.fromY = chase ? lastY - lastOffY : lastY;
  }
  const k = vs.dur > 0 ? easedValue(Math.min(1, vs.t / vs.dur), vs.type, vs.rate) : 1;
  if (vs.smooth && vs.vx === undefined) { vs.vx = velX; vs.vy = velY; }
  const smooth = !!vs.smooth && !chase && vs.dur > 0 && k < 1;
  out.x = camX; out.y = camY;
  if (holdX && chase) {
    // follow: chase the (moving) target by 1/easing of the gap a 60 Hz frame
    const f = paused ? 0 : Math.min(1, (frame * 60) / vs.follow);
    vs.fromX += (tgX - vs.fromX) * f;
    out.x = vs.fromX + offX;
  } else if (smooth && holdX && !relX) {
    out.x = smoothBezier(vs.fromX, vs.vx ?? 0, vs.dur, tgX + offX, k, vs.velMod ?? 0);
  } else if (smooth && relX) {
    // the exit's release (`updateCamera` 0x109a54): the same Bezier, to the follow camera
    out.x = smoothBezier(vs.fromX, vs.vx ?? 0, vs.dur, camX, k, vs.velMod ?? 0);
  } else if (holdX || relX) {
    const from = chase ? vs.fromX + offX : vs.fromX;
    const target = relX ? camX : tgX + (chase ? 0 : offX);
    if (trackTarget) { vs.gx ??= from - target; out.x = easeOffset(vs.gx, target, k); }
    else out.x = from + (target - from) * k;
  }
  if (holdY && chase) {
    const f = paused ? 0 : Math.min(1, (frame * 60) / vs.follow);
    vs.fromY += (tgY - vs.fromY) * f;
    out.y = vs.fromY + offY;
  } else if (smooth && holdY && !relY) {
    out.y = smoothBezier(vs.fromY, vs.vy ?? 0, vs.dur, tgY + offY, k, vs.velMod ?? 0);
  } else if (smooth && relY) {
    out.y = smoothBezier(vs.fromY, vs.vy ?? 0, vs.dur, camY, k, vs.velMod ?? 0);
  } else if (holdY || relY) {
    const from = chase ? vs.fromY + offY : vs.fromY;
    const target = relY ? camY : tgY + (chase ? 0 : offY);
    if (trackTarget) { vs.gy ??= from - target; out.y = easeOffset(vs.gy, target, k); }
    else out.y = from + (target - from) * k;
  }
  return holdX || holdY || k < 1;
}

/** scratch outputs for `stepViewStaticPair`, so a frame allocates nothing */
const PAIR_FIRST = { x: 0, y: 0 }, PAIR_SECOND = { x: 0, y: 0 };
const PAIR_OFF = { x: 0, y: 0 };
/** the last view this module drew and the zoom offset inside it (see `stepViewStaticPair`) */
const pairLast = { x: NaN, y: NaN, offX: 0, offY: 0 };

/** which axes a static owns (bit 1 x, bit 2 y): a both-axis static owns both */
function ownedAxes(vs: ViewStatic | null): number {
  return vs ? (vs.axis === 0 ? 3 : vs.axis) : 0;
}

/**
 * The offset a zoomed view puts on a static's centre: **none.** The game's view
 * is centred exactly on the guide object and drawn at scale x zoom about that
 * centre, so its visible bottom is the guide's y less (320/2)/zoom — the
 * native `cam.y` of the real Dash run is that visible edge (x 2200: guide at GD
 * 225, zoom 0.8333, 225 - 192 = 33.0; x 3300: 255 - 160 = 95.0; x 15200: 645 -
 * 266.7 = 378.3, all to the digit). This function used to move the centre by
 * half·(1 − 1/zoom) to make the *un-zoomed* bottom (centre - 160) equal that
 * number; the renderer then zoomed about the displaced centre as well, so the
 * drawn view sat 160·(1/zoom − 1) low (32 at zoom 0.8333, 107 at 0.6) —
 * compared against the game's own screenshot at Dash x 2300 the floor sat at
 * 0.77 of the frame height against the game's 0.84, and 0.85 once this was
 * removed. Kept as the single place the offset would go.
 */
function zoomOffset(_zoom: number, _viewW: number, out: { x: number; y: number }) {
  out.x = 0;
  out.y = 0;
}

/**
 * The view while up to two Camera Statics are live, one per axis. Each axis
 * takes the value of the static that owns it, and the follow where neither
 * does. `first` is the older static (`viewStaticOther`), `second` the newer
 * (`viewStatic`), so the newer one wins an axis that both could claim.
 * Returns whether each static is still live (false once it has eased home).
 */
export function stepViewStaticPair(
  first: ViewStatic | null, firstTg: { x: number; y: number } | null,
  second: ViewStatic | null, secondTg: { x: number; y: number } | null,
  camX: number, camY: number, lastX: number, lastY: number, frame: number, paused: boolean,
  zoom: number, viewW: number,
  out: { x: number; y: number },
  velX = 0, velY = 0, trackTarget = false,
): { first: boolean; second: boolean } {
  let aliveFirst = true, aliveSecond = true;
  zoomOffset(zoom, viewW, PAIR_OFF);
  // the offset the previous frame's view carries, when it was this function's
  const fromPairX = lastX === pairLast.x, fromPairY = lastY === pairLast.y;
  const lox = fromPairX ? pairLast.offX : 0, loy = fromPairY ? pairLast.offY : 0;
  if (first && firstTg) {
    aliveFirst = stepViewStatic(first, firstTg.x, firstTg.y, camX, camY, lastX, lastY, frame, paused, PAIR_FIRST, PAIR_OFF.x, PAIR_OFF.y, lox, loy, velX, velY, trackTarget);
  }
  if (second && secondTg) {
    aliveSecond = stepViewStatic(second, secondTg.x, secondTg.y, camX, camY, lastX, lastY, frame, paused, PAIR_SECOND, PAIR_OFF.x, PAIR_OFF.y, lox, loy, velX, velY, trackTarget);
  }
  const ownFirst = first && firstTg ? ownedAxes(first) : 0;
  const ownSecond = second && secondTg ? ownedAxes(second) : 0;
  out.x = (ownSecond & 1) ? PAIR_SECOND.x : (ownFirst & 1) ? PAIR_FIRST.x : camX;
  out.y = (ownSecond & 2) ? PAIR_SECOND.y : (ownFirst & 2) ? PAIR_FIRST.y : camY;
  pairLast.x = out.x; pairLast.y = out.y; pairLast.offX = PAIR_OFF.x; pairLast.offY = PAIR_OFF.y;
  return { first: aliveFirst, second: aliveSecond };
}


/** a free camera's settings: the portal's padding (key 114) and the current zoom */
export interface FreeCamera { padding: number; zoom: number }

/**
 * How far above and below the view's centre the free camera lets the player go
 * (`updateCamera` m1 0x124838, installed build 0x1001089a0): each side is
 * `half - (30 + padding * (half - 2 - 30))`, scaled by 1 / zoom, with `half`
 * the view's half height. Padding 0.8044 at zoom 0.6 on Dash gives 45, which is
 * what the real swing rows fit (x 7560-8100: margins 45 / 45, D 30).
 */
export function freeMargin(padding: number, zoom: number, viewH: number = DESIGN_H): number {
  const half = viewH / 2;
  return (half - (30 + padding * (half - 2 - 30))) / zoom;
}

/**
 * The follow's pull a second: the game divides the gap by D each 60 Hz frame,
 * D = 10 for the cube's fixed margins and the portal's easing (key 113) in free
 * mode (`updateCamera` 0x1091dc: `[+0x2d0]`). The old fixed 6 is 60 / 10.
 */
export function followRate(freeMode: boolean, easing: number | undefined): number {
  return freeMode && easing !== undefined ? 60 / easing : 6;
}
