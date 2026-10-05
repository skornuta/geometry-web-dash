/**
 * The end of a classic level — where it is, when it triggers, and the
 * sequence the original plays once it has. Everything here is read out of the
 * shipping 2.2081 arm64 binary (pipeline: PHYSICS-FROM-BINARY.md), and the
 * addresses are recorded in `docs/fidelity/FIDELITY.md` §1.
 *
 * **Where the level ends.** `PlayLayer::createObjectsFromSetupFinished`
 * (m1 `0xa4550`, +196..276) sets the level length — the denominator of every
 * percentage (`getCurrentPercent` `0xa6e80`) — to
 *
 * ```
 * m_levelLength = max(lastObjectX + 340, screenRight + 300)
 * ```
 *
 * where `lastObjectX` (`PlayLayer + 0x36a0`) is the largest `getStartPos().x`
 * of **every** object `PlayLayer::addObject` (`0xa02e0`, +104..164) is handed —
 * triggers included — and then creates the `EndPortalObject` at
 * `(m_levelLength, 225)`. The port used to complete the level at the last
 * object's x, 340 units early.
 *
 * **When it triggers.** `PlayLayer::checkForEnd` (`0xa84a0`) fires
 * `EndPortalObject::triggerObject` once the player reaches the portal's
 * `getSpawnPos()` (`0x321d80`): `portal.x - 300 / zoom`. Classic levels never
 * zoom, so the player is locked at `levelLength - 300` and *animated* the rest
 * of the way — the physics stops there.
 */

import type { Level } from "./level.ts";
import { DESIGN_H, GD_Y_OFFSET } from "./camera.ts";
import { easedValue } from "./easing.ts";

/** `lastObjectX + 340` — createObjectsFromSetupFinished +228..240 */
export const LEVEL_END_PAD = 340;
/** `screenRight + 300` — the floor for a level shorter than the screen (+208..224) */
export const LEVEL_END_SCREEN_PAD = 300;
/** `getSpawnPos`: the trigger sits `300 / zoom` before the portal (+60..72) */
export const END_TRIGGER_LEAD = 300;
/**
 * The screen width `m_levelLength` is computed against. The `screenRight + 300`
 * term only binds for a level shorter than about half a screen; the shortest
 * of the 22 levels ends at x = 23 745, so this never decides anything here —
 * it is fixed at the 16:9 width so the headless search and the browser agree.
 */
export const CLASSIC_SCREEN_RIGHT = (DESIGN_H * 16) / 9;

/** the largest object x in the level — `PlayLayer + 0x36a0` */
export function lastObjectX(level: Level): number {
  let m = 0;
  for (const o of level.objects) if (o.x > m) m = o.x;
  return m;
}

/** `m_levelLength` (`PlayLayer + 0x3088`) */
export function levelLength(lastX: number, screenRight = CLASSIC_SCREEN_RIGHT): number {
  return Math.max(lastX + LEVEL_END_PAD, screenRight + LEVEL_END_SCREEN_PAD);
}

/** the player x at which `checkForEnd` locks the player and starts the ending */
export function endTriggerX(length: number): number {
  return length - END_TRIGGER_LEAD;
}

/**
 * The portal's height, re-read by `EndPortalObject::updateEndPos`
 * (`0x321f40`) when it comes into view and again at the trigger:
 * the camera's centre, but never below GD y 225 — unless the player is a ship,
 * which takes the camera centre as it is. Returned in port coordinates.
 */
export function endPortalY(cameraCentreY: number, isShip: boolean): number {
  const floor = 225 - GD_Y_OFFSET;
  return isShip ? cameraCentreY : Math.max(floor, cameraCentreY);
}

/* ---------------- the camera (GJBaseGameLayer::updateCamera 0x124838) ---------------- */

/**
 * `updateCamera` +276..336: while an end portal exists, the camera's left edge
 * may not pass `m_levelLength - winW / zoom` (minus the camera's x offset,
 * zero here), so the portal comes to rest exactly on the right-hand edge of the
 * screen and the camera stops while the player runs on into it.
 */
export function clampCameraLeft(left: number, length: number, viewW: number): number {
  return Math.min(left, length - viewW);
}

/* ---------------- the pull into the portal (playEndAnimationToPos 0xa3bf4) ---------------- */

/** `CCBezierTo::create(1.0, …)` wrapped in `CCEaseIn(1.2)` (+588..616) */
export const PULL_DURATION = 1.0;
export const PULL_EASE_RATE = 1.2;
/** `CCRotateBy::create(1.0, 360)` wrapped in `CCEaseIn(1.5)` (+668..700) */
export const SPIN_DEGREES = 360;
export const SPIN_EASE_RATE = 1.5;
/**
 * `updateStaticCameraPos(pos, staticX false, staticY true, …, 1.2, easing 1, 1.8)`
 * (+256..320): the camera settles vertically on the portal over 1.2 s,
 * `CCEaseInOut` rate 1.8. Easing type 1 is EaseInOut in `getEasedValue`.
 */
export const CAMERA_SETTLE_DURATION = 1.2;
export const CAMERA_SETTLE_EASING = 1;
export const CAMERA_SETTLE_RATE = 1.8;

export interface Point { x: number; y: number }

/**
 * `ccBezierConfig` as `playEndAnimationToPos` fills it (+440..584), with
 * `dir` the level's facing (`-1` when the portal is flipped):
 *
 * - control 1 = the player's position when the ending starts;
 * - control 2 = `(start.x + 40·dir, portal.y + 150)`;
 * - end       = `(portal.x + 50·dir, portal.y - 20)`.
 */
export function pullCurve(start: Point, portal: Point, dir = 1) {
  return {
    p0: start,
    p1: start,
    p2: { x: start.x + 40 * dir, y: portal.y + 150 },
    p3: { x: portal.x + 50 * dir, y: portal.y - 20 },
  };
}

/** cocos2d `bezierat`, the cubic `CCBezierTo` samples */
function bezierAt(a: number, b: number, c: number, d: number, t: number): number {
  const u = 1 - t;
  return u * u * u * a + 3 * t * u * u * b + 3 * t * t * u * c + t * t * t * d;
}

/**
 * Where the player is drawn `t` seconds into the ending, and how far the spin
 * has turned (degrees, clockwise like every GD rotation).
 */
export function pullPose(start: Point, portal: Point, t: number, dir = 1) {
  const k = Math.min(1, Math.max(0, t / PULL_DURATION));
  const e = easedValue(k, 2, PULL_EASE_RATE);
  const c = pullCurve(start, portal, dir);
  return {
    x: bezierAt(c.p0.x, c.p1.x, c.p2.x, c.p3.x, e),
    y: bezierAt(c.p0.y, c.p1.y, c.p2.y, c.p3.y, e),
    spin: SPIN_DEGREES * easedValue(k, 2, SPIN_EASE_RATE) * dir,
  };
}

/* ---------------- the timeline after the pull ---------------- */

/**
 * `showCompleteEffect` (`0xa211c`) schedules `showCompleteText` after
 * `0.5 * (16 + 2) * 0.195` s — its strip count and interval, reused as a
 * delay (+664..692). In practice `levelComplete` skips the effect and calls
 * `showCompleteText` after a flat 0.1 s instead (+2672..2740).
 */
export const COMPLETE_TEXT_DELAY = 0.5 * (16 + 2) * 0.195;
export const PRACTICE_TEXT_DELAY = 0.1;
/** `showCompleteText` +2188..2240: `EndLevelLayer` drops 1.5 s after the text */
export const END_LAYER_DELAY = 1.5;

/** seconds after the trigger at which each step of the ending runs */
export function endTimeline(practice: boolean) {
  const complete = PULL_DURATION;
  const text = complete + (practice ? PRACTICE_TEXT_DELAY : COMPLETE_TEXT_DELAY);
  return { complete, text, endLayer: text + END_LAYER_DELAY };
}

/**
 * `showCompleteEffect` +596..624: `shakeCamera(0.5 * (16 + 2) * 0.195, 3, 0)`
 * — the flash's own duration, strength 3.
 */
export const COMPLETE_SHAKE_DURATION = COMPLETE_TEXT_DELAY;
export const COMPLETE_SHAKE_STRENGTH = 3;

/**
 * `CCLightFlash::playEffect` as `showCompleteEffect` calls it (+392..584), in
 * the binding's parameter order. Positioned on the portal, tinted the player's
 * colour 1. `endHeight` is the screen diagonal `sqrt(w² + (h/2)²)` plus 10.
 */
export const COMPLETE_FLASH = {
  startWidth: 1, startWidthVariation: 0,
  endWidth: 30, endWidthVariation: 20,
  endHeightPad: 10,
  stripDuration: 0.5 * 0.18, stripDurationVariance: 0.5 * 0.04,
  stripInterval: 0.5 * 0.195,
  stripStartDelay: 0.5 * 0.04, stripStartDelayVariation: 0.5 * 0.04,
  stripRotation: 0, stripRotationVariation: 180,
  stripOpacity: 155, stripOpacityVariation: 100,
  stripCount: 16, circleRotation: true, fadeIn: false, delay: 0.4,
} as const;

/**
 * A `CCCircleWave` — an additive circle (`glBlendFunc(SRC_ALPHA, ONE)`) whose
 * radius tweens from `from` to `to` over `duration` while its opacity fades.
 * `CCCircleWave::init` (`0x13e714`) and `draw` (`0x13ec74`):
 *
 * - `fadeIn`: opacity 0→255 over the first half, 255→0 over the second, and
 *   the radius grows linearly;
 * - otherwise opacity 255→0 over the whole duration, both tweens wrapped in
 *   `CCEaseOut(2)` (the 4-argument `create` passes `easeOut = true`);
 * - `outline` (`m_circleMode != 0`) draws a `lineWidth`-wide ring, else a
 *   filled disc.
 */
export interface CircleWaveSpec {
  from: number;
  to: number;
  duration: number;
  fadeIn: boolean;
  outline: boolean;
  lineWidth: number;
}

/** radius and opacity (0..1) of a circle wave `t` seconds in, or null once it is gone */
export function circleWaveAt(w: CircleWaveSpec, t: number): { radius: number; opacity: number } | null {
  if (t < 0 || t > w.duration) return null;
  const k = t / w.duration;
  if (w.fadeIn) {
    const opacity = k < 0.5 ? k * 2 : 2 - k * 2;
    return { radius: w.from + (w.to - w.from) * k, opacity };
  }
  // CCEaseOut(2) is `t ^ (1 / 2)`
  const e = easedValue(k, 3, 2);
  return { radius: w.from + (w.to - w.from) * e, opacity: 1 - e };
}

/**
 * `levelComplete` +2532..2668: one filled wave 10→250 over 0.5 s on the
 * portal (`lineWidth` 4 is set but a filled disc ignores it).
 */
export const COMPLETE_WAVE: CircleWaveSpec = {
  from: 10, to: 250, duration: 0.5, fadeIn: false, outline: false, lineWidth: 4,
};
/**
 * `PlayLayer::spawnCircle` (`0xa2048`): an outline wave, width 4, from 10 to
 * the screen's right edge over 0.5 s, fading in and out. `levelComplete`
 * fires five, 0.05 s apart (+2232..2528); `showCompleteText` five more.
 */
export function spawnCircleWave(screenRight: number): CircleWaveSpec {
  return { from: 10, to: screenRight, duration: 0.5, fadeIn: true, outline: true, lineWidth: 4 };
}
export const SPAWN_CIRCLE_DELAYS = [0, 0.05, 0.1, 0.15, 0.2] as const;

/**
 * `showCompleteText` +808..1080 (normal mode only): a filled wave from 10 to
 * the screen's right edge over 0.8 s on the portal, and one 10→250 over 0.8 s
 * on the banner.
 */
export function textWaves(screenRight: number): { portal: CircleWaveSpec; banner: CircleWaveSpec } {
  return {
    portal: { from: 10, to: screenRight, duration: 0.8, fadeIn: false, outline: false, lineWidth: 4 },
    banner: { from: 10, to: 250, duration: 0.8, fadeIn: false, outline: false, lineWidth: 4 },
  };
}

/**
 * `showCompleteText`'s ten fireworks (`0xa2dcc`), each at
 * `base + (2·rand − 1)·0.08` s (+1392..2184). Each is a filled circle wave
 * 10→`35 + 15·rand` over 0.5 s at a random point at least 50 from the screen
 * edge, tinted the player's colour 2, plus a `firework.plist` burst.
 */
export const FIREWORK_BASES = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.35] as const;
export const FIREWORK_JITTER = 0.08;
export const FIREWORK_MARGIN = 50;
export function fireworkWave(rand: number): CircleWaveSpec {
  return { from: 10, to: 35 + 15 * rand, duration: 0.5, fadeIn: true, outline: false, lineWidth: 4 };
}

/**
 * The "Level Complete!" banner `showCompleteText` pops over the level
 * (+72..400) — a different sprite from the one on the results panel:
 * `(winW/2, winH/2 + 35)`, z 15, from scale 0.01 up to 1.1 (1.0 in practice)
 * over 0.66 s with `CCEaseElasticOut(0.6)`, held 0.88 s, then down to 0.01
 * over 0.22 s with `CCEaseIn(2)` and hidden.
 */
export const BANNER_DY = 35;
export const BANNER_POP = 0.66;
export const BANNER_POP_PERIOD = 0.6;
export const BANNER_HOLD = 0.88;
export const BANNER_SHRINK = 0.22;
export const BANNER_SHRINK_RATE = 2;
export const BANNER_START = 0.01;

/** the banner's scale `t` seconds after `showCompleteText`, or 0 once hidden */
export function bannerScale(t: number, practice: boolean): number {
  const full = practice ? 1.0 : 1.1;
  if (t < 0) return 0;
  if (t < BANNER_POP) {
    return BANNER_START + (full - BANNER_START) * easedValue(t / BANNER_POP, 6, BANNER_POP_PERIOD);
  }
  const t2 = t - BANNER_POP - BANNER_HOLD;
  if (t2 < 0) return full;
  if (t2 < BANNER_SHRINK) {
    return full + (BANNER_START - full) * easedValue(t2 / BANNER_SHRINK, 2, BANNER_SHRINK_RATE);
  }
  return 0;
}

/* ---------------- the ghost trail (PlayerObject::toggleGhostEffect 0x388894) ---------------- */

/**
 * `playEndAnimationToPos` turns the player's ghost trail on
 * (`toggleGhostEffect(1)`), which runs `GhostTrailEffect::runWithTarget(icon,
 * snapshotInterval 0.05, fadeInterval 0.4, duration 0, ghostScale 0.6, false)`
 * (+208..260) additively in colour 1 from opacity 200 (`[0x170] = 200.0`):
 * every 0.05 s a copy of the icon fades to nothing and shrinks toward 0.6 of
 * its size over 0.4 s.
 */
export const GHOST_INTERVAL = 0.05;
export const GHOST_FADE = 0.4;
export const GHOST_SCALE = 0.6;
export const GHOST_OPACITY = 200 / 255;

/* ---------------- the portal itself (EndPortalObject::init 0x321974) ---------------- */

/**
 * The end wall: a column of `square_02_001` sprites, each rotated −90, one per
 * 30 units of `1.5 × winH`, children of the portal at `(0, (n/2)·30 − i·30)`
 * in its 30×30 content box (+508..672) — so centred on `portal.x − 15`; plus
 * an additive `gradientBar` scaled to `1.5 × winH` tall, at
 * `portal.x − 15/zoom − 14` (`setPosition` `0x321de4`).
 */
export const END_WALL_FRAME = "square_02_001.png";
export const END_GRADIENT_FRAME = "gradientBar.png";
export const END_WALL_ROTATION = -90;
export const END_WALL_STEP = 30;
export const END_WALL_HEIGHT_MULT = 1.5;
export const END_GRADIENT_DX = -15 - 14;

export function endWallSquares(viewH: number): number[] {
  const n = Math.round((viewH * END_WALL_HEIGHT_MULT) / END_WALL_STEP);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.floor(n / 2) * END_WALL_STEP - i * END_WALL_STEP - 15);
  return out;
}

/**
 * A level's **timestamp** (`GJGameLevel::m_timestamp`, +0x460): when it is set,
 * `PlayLayer::getCurrentPercent` (m1 0xa6e80) measures progress by time, not
 * by x — `m_currentProgress / (2 · timestamp) · 100`, i.e. 240 Hz steps over
 * the timestamp. `LevelTools::getLevel` (m1 0x4556e0) sets it for one main
 * level only: Dash, 0x55b4 = 21 940 steps (91.4 s). Checked against a 2.2
 * playthrough (YouTube g3_XUbK-PP0): its percentage climbs steadily, 48 % at
 * 44 s into the run (0.48 · 21 940 / 240 = 43.9 s), and reads 100 % at the End
 * trigger — where x / length (the port's old rule) stopped at 90.7 %.
 * (`loadLevelSettings` m1 0x1287d0 falls back to a level-settings value for a
 * level without one; no other main level sets it.)
 */
export const LEVEL_TIMESTAMP: ReadonlyMap<number, number> = new Map([[22, 21940]]);

/** the progress percentage: by time when the level has a timestamp, else by x */
export function progressPercent(playerX: number, length: number, steps: number, timestamp = 0): number {
  const p = timestamp > 0 ? (steps / timestamp) * 100 : length > 0 ? (playerX / length) * 100 : 0;
  return Math.min(100, Math.max(0, p));
}
