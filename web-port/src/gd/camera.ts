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
const BAND_EDGE: Partial<Record<Gamemode, number>> = { ship: 150, ufo: 150, wave: 150, ball: 120 };

/**
 * Half-size the band measures the player by. 15 for the 30-unit player and 9
 * for a mini (x0.6), except the wave, which stops 10 (mini 6) short of the
 * edge — its solid box is a third of the icon.
 */
function bandHalf(mode: Gamemode, mini: boolean): number {
  const half = mode === "wave" ? 10 : 15;
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
 * Cube, robot, spider and swing are unconfined. For the robot this is checked,
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
  freeMode = false,
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
    // The margins do **not** swap with gravity. Native Dash (traces/
    // native-camera-l22.txt, 425 samples) is matched to within a unit by
    // this deadzone — 70 above / 40 below the view centre, eased 1/40 a step,
    // floored at 0 — in every mode, at every zoom, and through both flips the
    // run makes: the blue orb at x 855 turns the cube over (f634) and the
    // camera stays put with it 45–60 above the centre; the spider rests 70
    // above it on the ceiling at x 1007–1250. A swapped deadzone (what the
    // port did) lifts the view 10–30 there. `updateCamera` does exchange
    // its 70/40 pair by `m_isUpsideDown` (m1 0x124d58), so some other state
    // must undo it; until that is decoded the captures win (FIDELITY A54).
    void gravityFlipped;
    const top = DEAD_TOP;
    const bottom = DEAD_BOTTOM;
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
  out: { x: number; y: number },
): boolean {
  const hold = vs.axis === 0 ? 3 : vs.axis;
  const rel = vs.exitAxis & hold;
  const relX = (rel & 1) !== 0, relY = (rel & 2) !== 0;
  const holdX = (hold & 1) !== 0 && !relX, holdY = (hold & 2) !== 0 && !relY;
  if (vs.fromX === null || vs.fromY === null) { vs.fromX = lastX; vs.fromY = lastY; }
  const k = vs.dur > 0 ? easedValue(Math.min(1, vs.t / vs.dur), vs.type, vs.rate) : 1;
  out.x = camX; out.y = camY;
  if (holdX && vs.follow > 0) {
    // follow: chase the (moving) target by 1/easing of the gap a 60 Hz frame
    const f = paused ? 0 : Math.min(1, (frame * 60) / vs.follow);
    vs.fromX += (tgX - vs.fromX) * f;
    out.x = vs.fromX;
  } else if (holdX || relX) {
    out.x = vs.fromX + ((relX ? camX : tgX) - vs.fromX) * k;
  }
  if (holdY && vs.follow > 0) {
    const f = paused ? 0 : Math.min(1, (frame * 60) / vs.follow);
    vs.fromY += (tgY - vs.fromY) * f;
    out.y = vs.fromY;
  } else if (holdY || relY) {
    out.y = vs.fromY + ((relY ? camY : tgY) - vs.fromY) * k;
  }
  return holdX || holdY || k < 1;
}

/** scratch outputs for `stepViewStaticPair`, so a frame allocates nothing */
const PAIR_FIRST = { x: 0, y: 0 }, PAIR_SECOND = { x: 0, y: 0 };
const PAIR_TG_FIRST = { x: 0, y: 0 }, PAIR_TG_SECOND = { x: 0, y: 0 };

/** which axes a static owns (bit 1 x, bit 2 y): a both-axis static owns both */
function ownedAxes(vs: ViewStatic | null): number {
  return vs ? (vs.axis === 0 ? 3 : vs.axis) : 0;
}

/**
 * A static's view centre for a zoomed view: the group's point is where the view's
 * edge sits at zoom 1, and the zoom scales the half-window about it (native Dash
 * 2185–2412, zoom 0.8333: the bottom is 135 − (320/2)/0.8333 + 90 = 33.0 and the
 * left edge is 2311 − (571/2)/0.8333 = 1968.4). So the centre moves by
 * half·(1 − 1/zoom), zero at zoom 1.
 */
function zoomedTarget(tg: { x: number; y: number }, zoom: number, viewW: number, out: { x: number; y: number }) {
  const zc = 1 - 1 / (zoom > 0 ? zoom : 1);
  out.x = tg.x + (viewW / 2) * zc;
  out.y = tg.y + (DESIGN_H / 2) * zc;
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
): { first: boolean; second: boolean } {
  let aliveFirst = true, aliveSecond = true;
  if (first && firstTg) {
    zoomedTarget(firstTg, zoom, viewW, PAIR_TG_FIRST);
    aliveFirst = stepViewStatic(first, PAIR_TG_FIRST.x, PAIR_TG_FIRST.y, camX, camY, lastX, lastY, frame, paused, PAIR_FIRST);
  }
  if (second && secondTg) {
    zoomedTarget(secondTg, zoom, viewW, PAIR_TG_SECOND);
    aliveSecond = stepViewStatic(second, PAIR_TG_SECOND.x, PAIR_TG_SECOND.y, camX, camY, lastX, lastY, frame, paused, PAIR_SECOND);
  }
  const ownFirst = first && firstTg ? ownedAxes(first) : 0;
  const ownSecond = second && secondTg ? ownedAxes(second) : 0;
  out.x = (ownSecond & 1) ? PAIR_SECOND.x : (ownFirst & 1) ? PAIR_FIRST.x : camX;
  out.y = (ownSecond & 2) ? PAIR_SECOND.y : (ownFirst & 2) ? PAIR_FIRST.y : camY;
  return { first: aliveFirst, second: aliveSecond };
}
