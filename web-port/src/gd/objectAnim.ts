/**
 * Object animation: continuous rotation and frame animation for level objects.
 *
 * **SOURCED** from the 2.2081 binary (arm64 slice, geode m1 addresses).
 *
 * ## Rotation
 *
 * `EnhancedGameObject::customSetup` (m1 `0x4fb368`) is the only place a level
 * object is given a spin. It reaches one of four setups, all of which end at
 * `m_rotationDelta` (+0x578) = **signed degrees per second**:
 *
 * - the inline tail at +2868, fed by the saw/gear block at +1032. It stores
 *   `m_rotationAngle` (+0x574) and then `m_rotationDelta = angle * direction`.
 * - `createRotateAction(angle, clockwise)` (m1 `0x4fb2f8`) from +624, +1604 and
 *   +2392, which does exactly the same thing.
 *
 * `EnhancedGameObject::updateRotateAction(dt)` (m1 `0x4fdd54`) accumulates dt
 * into +0x57c and sets the sprite's rotation to `accumulated * m_rotationDelta`
 * — so the rate is **wall-clock game time, not level speed**, and a speed
 * portal does not change it. `PlayLayer::updateVisibility(float dt)` (m1
 * `0xa4b78`, +2108) is the caller, gated on `getHasRotateAction()` (m1
 * `0x1a1f70`, reads `m_hasCustomRotation` +0x56b).
 *
 * **Direction** (`createRotateAction` +40..92, and the same code inlined at
 * +2884..2940): if key **97** (`m_rotationSpeed`, +0x570) is non-zero it is used
 * as the rate with direction +1; otherwise the rate is the table value below and
 * the direction is `rand() < 0.5 ? -1 : +1`. Key **98** (`m_disableRotation`,
 * +0x56c) skips the whole setup.
 *
 * ## Frame animation
 *
 * `GameManager::setupGameAnimations` (m1 `0x203598`) makes 135
 * `addGameAnimation(objectID, frames, frameTime, mainFrame, detailFrame,
 * defaultFrame)` calls (m1 `0x209d90`), which build every frame name with the
 * format string **`"%s_%03d.png"`** (+220) and file the count and time under
 * `GameManager::m_framesForAnimation` / `m_frameTimeForAnimation`.
 * `EnhancedGameObject::setupAnimationVariables` (m1 `0x201dcc`) reads them back
 * into `m_frames` (+0x568) and `m_frameTime` (+0x564), then divides the time by
 * `m_randomFrameTime` (+0x55c) — or by `|key 107|` when key **122** is set
 * (+124..160).
 *
 * `EnhancedGameObject::updateSyncedAnimation(totalTime, -1)` (m1 `0x200828`,
 * +232..316) picks the frame:
 *
 * ```
 *   n   = floor(max(startOffset + totalTime, 0) / frameTime) mod frames
 *   idx = reversed ? frames - n : n + 1          // 1-based, "%s_%03d.png"
 * ```
 *
 * `totalTime` is the level clock (`PlayLayer::updateVisibility` +1936 passes
 * `PlayLayer[0x398]`), so instances of an id run off one clock; what desyncs
 * them is the per-object `startOffset` (+0x548) and `m_randomFrameTime`, both
 * drawn from `rand()` in `customSetup`. `reversed` is key 107 < 0 with key 122
 * set. The gate is `getHasSyncedAnimation()` (m1 `0x1a1f68`,
 * `m_hasCustomAnimation` +0x56a), set by `customSetup` at +112, +412, +1400,
 * +1816, +1940, +2256, +2520 and +3104, and by `EffectGameObject::customSetup`
 * (m1 `0x157578`/`0x1575ec`) for the two coins.
 *
 * ## APPROXIMATIONS (FIDELITY.md §5)
 *
 * - **A22 — `rand()` is replaced by a per-object hash.** The original draws the
 *   spin direction, the animation start offset and the frame-time jitter from
 *   `rand()` at load, so no two runs of the *original* agree either. The port
 *   uses `hash01(objectIndex, salt)` so a replay is reproducible.
 * - **A23 — the 30 % "delayed loop" branch is not modelled.** `customSetup`
 *   +464..508 gives 30 % of animated instances `m_animationStart = -1` instead
 *   of a random start offset; the port gives every instance the random offset.
 * - **A24 — a missing frame holds the previous one.** Four of
 *   `d_animWave_01`'s ten frames (004, 005, 009, 010) are simply not in the
 *   shipped atlas, and the same for `d_animWave_01b`, `smallCoin_01` and
 *   `fireball_02_004`. What the original draws for a frame name the cache does
 *   not have is undecoded, so the port holds the last frame that resolved.
 */
import { type LevelObject } from "./level.ts";
import { P, propFloat, propInt } from "./props.ts";

/** how an id's rotation rate is chosen when key 97 is absent */
export interface RotationDef {
  /** fixed degrees per second, or the low end of the random range */
  dps: number;
  /** when set, the rate is `rand() * span + dps` */
  span?: number;
  /** the direction is this, not `rand()`'s (1619/1620 always turn −) */
  fixed?: 1 | -1;
}

/**
 * Object id -> rotation rate, in degrees per second — every id
 * `EnhancedGameObject::customSetup` gives a rotate action, read by running the
 * routine under an emulator for ids 1..4599 twice, with `rand()` at 0 and at
 * `RAND_MAX`: the low end is the first run's rate, the span the difference.
 * `fixed` marks the four whose direction does not come from `rand()` (the
 * sign of their rate is the same in both runs while every other id's flips).
 * The earlier hand-traced table had 47 of these 82 and missed, among others,
 * the rotating balls 375–378 (Blast Processing's orb arms stood still, USER-06).
 */
export const OBJECT_ROTATION: ReadonlyMap<number, RotationDef> = new Map([
  [85, { dps: 90, span: 90 }], [86, { dps: 90, span: 90 }], [87, { dps: 90, span: 90 }], [97, { dps: 90, span: 90 }], [137, { dps: 90, span: 90 }], [138, { dps: 90, span: 90 }],
  [139, { dps: 90, span: 90 }], [180, { dps: 90, span: 90 }], [181, { dps: 90, span: 90 }], [182, { dps: 90, span: 90 }], [222, { dps: 90, span: 90 }], [223, { dps: 90, span: 90 }],
  [224, { dps: 90, span: 90 }], [394, { dps: 90, span: 90 }], [395, { dps: 90, span: 90 }], [396, { dps: 90, span: 90 }], [997, { dps: 90, span: 90 }], [998, { dps: 90, span: 90 }],
  [999, { dps: 90, span: 90 }], [1000, { dps: 90, span: 90 }],
  [88, { dps: 300 }], [186, { dps: 300 }], [397, { dps: 300 }], [676, { dps: 300 }], [740, { dps: 300 }], [1705, { dps: 300 }],
  [1708, { dps: 300 }], [1735, { dps: 300 }],
  [89, { dps: 360 }], [98, { dps: 360 }], [183, { dps: 360 }], [184, { dps: 360 }], [185, { dps: 360 }], [187, { dps: 360 }],
  [188, { dps: 360 }], [398, { dps: 360 }], [399, { dps: 360 }], [677, { dps: 360 }], [678, { dps: 360 }], [679, { dps: 360 }],
  [680, { dps: 360 }], [741, { dps: 360 }], [742, { dps: 360 }], [1706, { dps: 360 }], [1707, { dps: 360 }], [1709, { dps: 360 }],
  [1710, { dps: 360 }], [1736, { dps: 360 }],
  [154, { dps: 135, span: 135 }], [155, { dps: 135, span: 135 }], [156, { dps: 135, span: 135 }],
  [375, { dps: 126, span: 126 }], [1521, { dps: 126, span: 126 }], [1525, { dps: 126, span: 126 }],
  [376, { dps: 108, span: 108 }], [1522, { dps: 108, span: 108 }], [1526, { dps: 108, span: 108 }],
  [377, { dps: 90, span: 90 }], [1523, { dps: 90, span: 90 }], [1527, { dps: 90, span: 90 }],
  [378, { dps: 72, span: 72 }], [1524, { dps: 72, span: 72 }], [1528, { dps: 72, span: 72 }],
  [675, { dps: 240 }], [1734, { dps: 240 }],
  [1019, { dps: 45, span: 135 }], [1020, { dps: 45, span: 135 }], [1021, { dps: 45, span: 135 }],
  [1022, { dps: 270 }], [1330, { dps: 270 }],
  [1055, { dps: 270, span: 90 }], [1056, { dps: 270, span: 90 }], [1057, { dps: 270, span: 90 }], [1058, { dps: 270, span: 90 }], [1059, { dps: 270, span: 90 }], [1060, { dps: 270, span: 90 }],
  [1061, { dps: 270, span: 90 }], [1831, { dps: 270, span: 90 }], [1832, { dps: 270, span: 90 }], [1833, { dps: 270, span: 90 }], [1834, { dps: 270, span: 90 }],
  [1582, { dps: 216, span: 108, fixed: 1 }],
  [1619, { dps: 720, fixed: -1 }],
  [1620, { dps: 1080, fixed: -1 }],
  [1752, { dps: 270, span: 90, fixed: 1 }],
]);

export interface AnimationDef {
  /** frame count; names run `<base>_001.png` .. `<base>_<frames>.png` */
  frames: number;
  /** seconds per frame before `m_randomFrameTime` / key 107 scales it */
  frameTime: number;
  /** `customSetup` gives this id a random start offset in [0, 0.5) s */
  randomStart: boolean;
  /** `customSetup` jitters the frame time; `span` is added to 0.8 */
  randomRate: number;
}

/** frames/time straight out of `setupGameAnimations`; `frames <= 1` is omitted */
function anim(frames: number, frameTime: number, randomStart: boolean, randomRate: number): AnimationDef {
  return { frames, frameTime, randomStart, randomRate };
}

/**
 * Object id -> frame animation, for every `addGameAnimation` entry whose id is
 * flagged `m_hasCustomAnimation` by its class's `customSetup`. The last two
 * fields come from the `customSetup` block that flags the id:
 *
 * | block  | `m_randomFrameTime`   | start offset  |
 * |--------|-----------------------|---------------|
 * | +112   | `rand()*0.4 + 0.8`    | `rand()*0.5`  |
 * | +412   | `rand()*0.4 + 0.8`    | `rand()*0.5`  |
 * | +1400  | `rand()*0.4 + 0.8`    | `rand()*0.5`  |
 * | +1816  | `rand()*0.4 + 0.8`    | none          |
 * | +2256  | 1 (untouched)         | none          |
 * | +2520  | `rand()*0.5 + 0.8`    | `rand()*0.5`  |
 *
 * Ids 1516, 1583, 1591 and 1840 have a `setupGameAnimations` entry but are
 * never flagged `m_hasCustomAnimation`, so they stay static — 1591 and 1840
 * are single-frame entries anyway.
 */
export const OBJECT_ANIMATION: ReadonlyMap<number, AnimationDef> = new Map([
  // +2256 — the wave decorations, fully synced
  [1050, anim(10, 0.05, false, 0)], [1051, anim(10, 0.05, false, 0)],
  [1052, anim(10, 0.05, false, 0)], [1054, anim(7, 0.06, false, 0)],
  [3000, anim(10, 0.05, false, 0)], [3001, anim(10, 0.05, false, 0)],
  [3002, anim(10, 0.05, false, 0)], [1053, anim(6, 0.045, false, 0)],
  [1592, anim(8, 0.045, false, 0)],
  // +1400 — fire, water and the star
  [920, anim(9, 0.08, true, 0.4)], [921, anim(11, 0.08, true, 0.4)],
  [923, anim(9, 0.08, true, 0.4)], [924, anim(9, 0.08, true, 0.4)],
  [1518, anim(6, 0.05, true, 0.4)], [1519, anim(11, 0.06, true, 0.4)],
  [1936, anim(13, 0.07, true, 0.4)], [1937, anim(8, 0.07, true, 0.4)],
  [1938, anim(8, 0.07, true, 0.4)], [1939, anim(8, 0.07, true, 0.4)],
  // +112 — the bubble and the lightning
  [1856, anim(14, 0.07, true, 0.4)], [1857, anim(3, 0.06, true, 0.4)],
  // +412 — the 2.2 animated decoration
  [2024, anim(5, 0.05, true, 0.4)], [2027, anim(9, 0.05, true, 0.4)],
  [2031, anim(6, 0.05, true, 0.4)], [2032, anim(8, 0.05, true, 0.4)],
  [2041, anim(12, 0.05, true, 0.4)], [2042, anim(7, 0.05, true, 0.4)],
  [2043, anim(9, 0.05, true, 0.4)], [2044, anim(5, 0.05, true, 0.4)],
  [2047, anim(11, 0.04, true, 0.4)], [2864, anim(8, 0.06, true, 0.4)],
  [2865, anim(8, 0.06, true, 0.4)], [2887, anim(5, 0.06, true, 0.4)],
  [2888, anim(6, 0.06, true, 0.4)], [2893, anim(4, 0.05, true, 0.4)],
  // +1816 — the pixel-art creatures (2694 skips the frame-time jitter)
  [2629, anim(8, 0.1, false, 0.4)], [2630, anim(4, 0.1, false, 0.4)],
  [2694, anim(5, 0.16, false, 0)], [4300, anim(4, 0.08, false, 0.4)],
  // +2520 — the zigzag
  [1697, anim(3, 0.06, true, 0.5)],
  // EffectGameObject::customSetup — the coins
  [142, anim(4, 0.115, false, 0)], [1614, anim(4, 0.12, false, 0)],
]);

/**
 * A deterministic stand-in for the original's load-time `rand()` (A22).
 * Returns a value in [0, 1) from an object index and a salt, so the same level
 * always animates the same way and a replay is reproducible.
 */
export function hash01(index: number, salt: number): number {
  let h = (index * 0x9e3779b1 + salt * 0x85ebca6b) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Signed degrees per second for one object, or 0 when it does not spin.
 * `index` is the object's index in the level, used only as the hash seed.
 */
export function rotationFor(o: LevelObject, index: number): number {
  const def = OBJECT_ROTATION.get(o.id);
  if (!def) return 0;
  if (propInt(o.props, P.DISABLE_ROTATION, 0) !== 0) return 0;
  const custom = propFloat(o.props, P.CUSTOM_ROTATION_SPEED, 0);
  // key 97 set: that rate, direction +1 (createRotateAction +44..92)
  if (custom !== 0) return custom;
  const rate = def.dps + (def.span ? hash01(index, 1) * def.span : 0);
  if (def.fixed) return def.fixed * rate;
  return hash01(index, 2) < 0.5 ? -rate : rate;
}

/** one object's resolved animation timing, or null when it does not animate */
export interface AnimTiming {
  frames: number;
  /** seconds per frame after key 107 / `m_randomFrameTime` */
  frameTime: number;
  /** seconds added to the level clock before the frame is picked */
  offset: number;
  reversed: boolean;
}

export function animationFor(o: LevelObject, index: number): AnimTiming | null {
  const def = OBJECT_ANIMATION.get(o.id);
  if (!def || def.frames <= 1) return null;
  const useSpeed = propInt(o.props, P.ANIMATION_USE_SPEED, 0) !== 0;
  const speed = propFloat(o.props, P.ANIMATION_SPEED, 0);
  // setupAnimationVariables +124..160: key 107 wins over the random jitter
  const divisor = useSpeed && speed !== 0
    ? Math.abs(speed)
    : (def.randomRate ? 0.8 + hash01(index, 3) * def.randomRate : 1);
  const frameTime = def.frameTime / divisor;
  if (!(frameTime > 0)) return null;
  return {
    frames: def.frames,
    frameTime,
    offset: def.randomStart ? hash01(index, 4) * 0.5 : 0,
    reversed: useSpeed && speed < 0,
  };
}

/** 1-based frame index at time `t`, exactly `updateSyncedAnimation` +232..316 */
export function frameIndexAt(a: AnimTiming, t: number): number {
  const n = Math.floor(Math.max(a.offset + t, 0) / a.frameTime) % a.frames;
  return a.reversed ? a.frames - n : n + 1;
}
