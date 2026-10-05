// M5 — triggers: the things that change a level while it is being played.
//
// A trigger fires when the player's x reaches it (the classic rule), unless it
// is touch- or spawn-triggered. Everything a trigger can change lives in
// `TriggerRuntime`, which both the renderer and the collision world read, so a
// moved group moves for gameplay and for drawing from one source.
//
// Scope: colour, move, alpha, toggle, spawn and shake. Pulse, rotate, animate,
// follow and the count triggers are parsed and ignored — see UNIMPLEMENTED below.
import type { Level, LevelObject } from "./level.ts";
import { P, propInt, propFloat, propBool } from "./props.ts";
import { NO_HSV, lightBgColor, parseHSV, transformColor, type HSV } from "./color.ts";
import { easedValue } from "./easing.ts";
import type { ViewStatic } from "./camera.ts";

/** an animated colour channel */
export interface ColorState {
  r: number; g: number; b: number;
  /** 0..1 */
  opacity: number;
  blending: boolean;
  /**
   * Channel this one copies its colour from, 0 for none. The source keeps
   * animating, so a copy is resolved at draw time by `resolveColor`, never
   * baked in here.
   */
  copyChannel: number;
  /** how the copied colour is bent on the way through */
  copyHSV: HSV;
  /** take the source's opacity too, rather than keeping our own */
  copyOpacity: boolean;
}

/** the live transform of a group id */
export interface GroupState {
  dx: number; dy: number;
  /** 0..1, driven by alpha triggers */
  alpha: number;
  /** toggle triggers hide a group entirely — hidden groups also stop colliding */
  enabled: boolean;
  /**
   * Rotate triggers (1346): radians **CCW**, about `(cx, cy)` in world space.
   * Key 68 is degrees CW like key 6, so firing negates it. Everything the 22
   * levels rotate is either a circular hazard — where rotating is exactly
   * "move the centre" — or decoration, bar 12 solids in L22.
   */
  rot: number;
  cx: number; cy: number;
  /** key 70: the objects orbit the centre but keep their own facing */
  lockRot: boolean;
  /**
   * Scale trigger (2067): the group's size factors, about `(scx, scy)` — or,
   * with no centre group, each object about itself (`scaleOwn`).
   */
  sx: number; sy: number;
  scx: number; scy: number;
  scaleOwn: boolean;
}

export interface Trigger {
  id: number;
  /** index into the sorted trigger list — identity for the touched set */
  index: number;
  x: number;
  y: number;
  /** key 11: fires when the player touches it, not when it is passed */
  touch: boolean;
  /** key 87: a touch trigger may fire again on a later touch */
  multi: boolean;
  /** half-width / half-height of the trigger's object rect (30x30 x scale) */
  hw: number;
  hh: number;
  props: Map<number, string>;
  /** only fires from a spawn trigger, never by being passed */
  spawnTriggered: boolean;
  /**
   * Key 170, the trigger's channel (`m_channelValue`). Position triggers fire
   * only while their channel is the active one — see `updateTriggers`.
   */
  channel: number;
  /** groups this trigger belongs to, so a spawn trigger can find it */
  groups: number[];
  /**
   * A rotate trigger's centre of rotation, resolved at build time from the
   * group named by key 71. Static level data, so it never needs recomputing.
   */
  centre?: { x: number; y: number };
  /**
   * A move trigger in "target pos" mode (key 100). `moveTo` is the members of
   * the group named by key 71 — where the move lands — and `moveFrom` the
   * members of key 395's group, the point that is put there. The *members*
   * rather than a baked centre, because a marker usually also belongs to the
   * group being moved, so its position when the trigger fires is its own
   * position plus every one of its groups' offsets.
   */
  moveTo?: GroupPoint[];
  moveFrom?: GroupPoint[];
}

/** one object's static position and the groups whose offsets move it */
export interface GroupPoint {
  x: number; y: number; groups: number[];
}

/** key 30 easing type and key 85 rate, carried by every tween */
interface Eased {
  ease: number;
  rate: number;
  /**
   * Groups of the trigger that started this action, so a stop trigger (1616)
   * can end it — `controlTriggersInGroup` addresses actions by their
   * *trigger's* group, not by the group being moved.
   */
  src?: number[];
  /** has had its first step skipped — see `updateTriggers` */
  started?: boolean;
}

type Tween = Eased & (
  | { kind: "color"; ch: number; from: ColorState; to: ColorState; t: number; dur: number }
  | {
    kind: "move"; group: number;
    fromX: number; fromY: number; toX: number; toY: number; t: number; dur: number;
    /**
     * Keys 58 / 59 — while the move runs, the group additionally tracks the
     * player's displacement since it fired. Every one of the 16 in the 22
     * levels has dx = dy = 0, so they are pure "carry the player" moves;
     * `atX`/`atY` are where the player was when it started.
     */
    lockX: boolean; lockY: boolean; atX: number; atY: number;
    /** eased progress and player position at the last step, so each move can
     * contribute its own *increment* and several can run on one group at once */
    kPrev: number; lastX: number; lastY: number;
  }
  | { kind: "alpha"; group: number; from: number; to: number; t: number; dur: number }
  | {
    kind: "rotate"; group: number; delta: number; t: number; dur: number;
    cx: number; cy: number; lockRot: boolean; kPrev: number;
  }
  | {
    kind: "scale"; group: number; fx: number; fy: number; t: number; dur: number;
    kPrev: number;
  }
  | { kind: "zoom"; group: number; from: number; to: number; t: number; dur: number }
  | { kind: "camOffX" | "camOffY" | "camRot" | "mgOff"; group: number; from: number; to: number; t: number; dur: number }
  | { kind: "shader"; field: ShaderField; group: number; from: number; to: number; t: number; dur: number }
);

/** the eased values behind `ShaderLayer`'s colour pass (see `ShaderState`) */
export type ShaderField = "gray" | "sepia" | "invert" | "invR" | "invG" | "invB" | "hue"
  | "cr" | "cg" | "cb" | "br" | "bg" | "bb"
  | "lensSize" | "lensFade" | "lensStrength" | "lensOffX" | "lensOffY"
  | "chromX" | "chromY"
  | "cgRGB" | "cgStrength" | "cgHeight" | "cgLine" | "cgSeg" | "cgSpeed"
  | "rbSize" | "rbFade" | "bulge" | "bulgeRadius"
  | "slSpeed" | "slThick" | "slStrength" | "slWave" | "slFadeIn" | "slFadeOut" | "slCenter" | "slOffset" | "slMax"
  | "swSpeed" | "swThick" | "swStrength" | "swWave" | "swFadeIn" | "swFadeOut" | "swInner" | "swOuter" | "swMax"
  | "swTimeOff" | "swOffX" | "swOffY";

/**
 * `ShaderLayer`'s colour-pass state (the screen shaders 2919–2923), as the
 * `trigger*` methods (m1 0x351484..0x351838) keep it: each value eases to its
 * target over the trigger's fade time. The GLSL that consumes it is the
 * game's own (embedded in the binary, see renderer.ts `POST_FRAG`).
 */
export interface ShaderState {
  gray: number; grayLum: boolean; grayTint: number;
  sepia: number;
  invert: number; invR: number; invG: number; invB: number; invClamp: boolean;
  hue: number;
  cr: number; cg: number; cb: number; br: number; bg: number; bb: number;
  /**
   * Lens circle (2913, `triggerLensCircle` m1 0x3507f8): a circle of radius
   * `lensSize` (fraction of the screen width) about the target, outside
   * which the view fades over `lensFade` to the tint channel's colour by
   * `lensStrength`. Target −1 is player 1 (key 138), else group key 51.
   */
  lensSize: number; lensFade: number; lensStrength: number; lensOffX: number; lensOffY: number;
  lensTarget: number; lensTint: number;
  /** chromatic (2910, `triggerChromaticX/Y`): red/blue offset in design points */
  chromX: number; chromY: number;
  /**
   * Chromatic glitch (2911, `triggerChromaticGlitch` m1 0x34fda4): its six
   * tweened fields — RGB split (key 180), strength (176), noise height (179),
   * line width (191), 1 / max(key 189, 0.1), clock speed (175) — and the
   * clock itself, advanced at `cgSpeed` a second.
   */
  cgOn: boolean; cgRGB: number; cgStrength: number; cgHeight: number; cgLine: number; cgSeg: number;
  cgSpeed: number; cgTime: number;
  /**
   * Radial blur (2914, `triggerRadialBlur` m1 0x350a98): size (key 179, field
   * 0x10 at +0x33c), fade (key 181, field 0x30 at +0x340), only-empty
   * (+0x76a).
   */
  rbSize: number; rbFade: number; rbEmpty: boolean;
  /** bulge (2916, `triggerBulge` m1 0x351120): strength key 176 (field 0x15), radius key 180 (0x18) */
  bulge: number; bulgeRadius: number;
  /**
   * Shock line (2907, `triggerShockLine` m1 0x34f1c8; keys from
   * `ShaderGameObject::customObjectSetup` m1 0x16018c): speed 175, thickness
   * 180, strength 176, wave width 179, fade in/out 181/182, centre offset 177,
   * screen offset 290, max size 183; flags invert 184, flip 185, rotate (y
   * axis) 186, dual 187. `slT` is its clock, run at `slSpeed` a second.
   */
  slT: number; slSpeed: number; slThick: number; slStrength: number; slWave: number;
  slFadeIn: number; slFadeOut: number; slCenter: number; slOffset: number; slMax: number;
  slAxis: boolean; slFlip: boolean; slDual: boolean; slInvert: boolean;
  /**
   * Shock wave (2905, `triggerShockWave` m1 0x34e520, case 0x10fb08): speed
   * 175, thickness 180, strength 176, wave width 179, fade in/out 181/182,
   * inner (+0x75c) and outer 191 sizes, max size (+0x760), time offset 177,
   * screen offsets 290/291; invert 184; the centre is group key 51's object
   * when key 188 is set. `swT` is its clock.
   */
  swT: number; swSpeed: number; swThick: number; swStrength: number; swWave: number;
  swFadeIn: number; swFadeOut: number; swInner: number; swOuter: number; swMax: number;
  swTimeOff: number; swOffX: number; swOffY: number; swInvert: boolean; swTarget: number;
}
export function freshShaderState(): ShaderState {
  return {
    gray: 0, grayLum: false, grayTint: -1, sepia: 0,
    invert: 0, invR: 1, invG: 1, invB: 1, invClamp: false, hue: 0,
    cr: 0, cg: 0, cb: 0, br: 0, bg: 0, bb: 0,
    lensSize: 0, lensFade: 0, lensStrength: 0, lensOffX: 0, lensOffY: 0, lensTarget: -1, lensTint: 0,
    chromX: 0, chromY: 0,
    cgOn: false, cgRGB: 0, cgStrength: 0, cgHeight: 0, cgLine: 0, cgSeg: 0, cgSpeed: 0, cgTime: 0,
    rbSize: 0, rbFade: 0, rbEmpty: false, bulge: 0, bulgeRadius: 0,
    slT: 0, slSpeed: 0, slThick: 0, slStrength: 0, slWave: 0, slFadeIn: 0, slFadeOut: 0, slCenter: 0,
    slOffset: 0, slMax: 0, slAxis: false, slFlip: false, slDual: false, slInvert: false,
    swT: 0, swSpeed: 0, swThick: 0, swStrength: 0, swWave: 0, swFadeIn: 0, swFadeOut: 0, swInner: 0,
    swOuter: 0, swMax: 0, swTimeOff: 0, swOffX: 0, swOffY: 0, swInvert: false, swTarget: -1,
  };
}

/**
 * A pulse trigger (1006) in flight: a temporary colour laid *over* a channel or
 * a group, which keeps animating underneath.
 *
 * Property keys. 45/46 and 65/66/86 are pinned in `customObjectSetup`; 47, 48,
 * 51 and 52 are pinned by their value domains across the 1,186 pulses in the
 * shipped levels — a key holding 1000 and 109 cannot be a fade time, and key 48
 * appears in exactly the triggers that carry an HSV (49) and no RGB (7/8/9) —
 * cross-checked against the argument list of `runPulseEffect` (m1 0x280244).
 *
 * | key | 45 | 46 | 47 | 48 | 49 | 50 | 51 | 52 | 65 | 66 | 86 |
 * |---|---|---|---|---|---|---|---|---|---|---|---|
 * | | fade in | hold | fade out | HSV mode | HSV | copy channel | target | target is a group | main only | detail only | exclusive |
 */
export interface Pulse {
  /** colour channel id, or group id when `isGroup` */
  target: number;
  isGroup: boolean;
  fadeIn: number; hold: number; fadeOut: number;
  /** seconds since it started */
  t: number;
  /** HSV mode (key 48): bend the target's own colour rather than replace it */
  hsv: HSV | null;
  r: number; g: number; b: number;
  /** key 50: take the pulse colour from this channel instead, 0 for none */
  copyChannel: number;
  /** for a group target: tint only the base, or only the detail, sprite */
  mainOnly: boolean; detailOnly: boolean;
}

/**
 * A count trigger (1611) waiting on an item.
 *
 * `GJEffectManager::runCountTrigger` (m1 `0x281888`) appends one of these per
 * item, remembering the item's value at registration (`prev`), and
 * `updateCountForItem` (`0x281c48` +976..1196) fires it when the value
 * **crosses** the target from either side, then removes it unless key 104
 * (multi-activate) is set.
 */
export interface CountListener {
  item: number;
  target: number;
  prev: number;
  group: number;
  activate: boolean;
  multi: boolean;
}

/**
 * A collision trigger (1815) armed by being passed or touched —
 * `GJEffectManager::registerCollisionTrigger` (m1 `0x27a014`). `a`/`b` are the
 * two collision blocks' ids (key 80 on each 1816), and
 * `handleObjectCollision` (`0x279cb4`) fires every registration whose pair
 * matches when the blocks start (or, with key 93, stop) overlapping.
 */
export interface CollisionListener {
  a: number;
  b: number;
  onExit: boolean;
  group: number;
  activate: boolean;
}

/**
 * A Rotate Gameplay trigger (2900) activation, for the sim to apply to the
 * player (`PlayerObject::rotateGameplay`). Directions use the trigger's own
 * encoding: 1 up, 2 down, 3 left, 4 right.
 */
export interface RotateRequest {
  /** key 166 — where gravity pulls (the binding calls it `m_moveDirection`) */
  ground: number;
  /** key 167 — the direction of travel (`m_groundDirection` in the binding) */
  move: number;
  /** key 169 `m_editVelocity`: scale the carried velocity by `modY` */
  edit: boolean;
  /** key 584 `m_overrideVelocity`: replace it with `modY` */
  override: boolean;
  /** key 583 `m_velocityModY` (absent: 0 — see `fire`) */
  modY: number;
}

/** a player colour, 0..255 per component */
export interface PlayerRgb { r: number; g: number; b: number }

export interface TriggerRuntime {
  colors: Map<number, ColorState>;
  groups: Map<number, GroupState>;
  /** index of the next unfired position trigger (the list is sorted by x) */
  next: number;
  /** the active trigger channel (key 170); a Rotate Gameplay trigger changes it */
  channel: number;
  /**
   * The player's direction of travel, as a Rotate Gameplay trigger's key 167:
   * 1 up, 2 down, 3 left, 4 right (the level's normal). Position triggers fire
   * once the player has passed them *in this direction*.
   */
  dir: number;
  /** position triggers fired outside the plain rightward x sweep, by index */
  fired: Set<number>;
  /** Rotate Gameplay activations for the sim to apply, oldest first */
  rotations: RotateRequest[];
  /**
   * Time Warp (1935, key 120): the rate the game's clock runs at. Dash's
   * native run at x=4535 (0.2): from the next step the player covers 0.2 of
   * its normal distance, and its fall slows by 0.2 squared.
   */
  timeWarp: number;
  /**
   * Camera Static (1914) on the y axis: the camera eases onto group `group`'s
   * y, and the free-fly band with it (the sim reads this). `from` is filled
   * by the sim with the band centre it started from.
   */
  /** an End trigger (3600) has been passed — the sim ends the level */
  endHit: boolean;
  /**
   * Options trigger (2899, `GameOptionsTrigger`) keys 165/199: player 1's and
   * player 2's controls switched off. `GameOptionsSetting` is On 1, Off −1,
   * 0 leaves it as it is. Dash turns both off over its cutscenes (x 15255 →
   * 15765, and from 21435 to the end).
   */
  controlsOff: [boolean, boolean];
  /**
   * Change BG (3029, key 533 → `GJBaseGameLayer::swapBackground` m1 0xef3c4):
   * the background art in use, `game_bg_NN`; null is the level's own (kA6).
   */
  bgIndex: number | null;
  /**
   * The middle ground's y offset (MG trigger 2999 → `updateMGOffsetY` m1
   * 0x121034: key 29 is the target, eased over key 10 with 30/85).
   */
  mgOffsetY: number;
  /**
   * Camera Edge (2062 → `updateCameraEdge` m1 0x120e5c): per direction (key
   * 164: 1 left, 2 right, 3 bottom, 4 top) the group (key 51) whose object
   * bounds the camera; 0 clears it. `updateCamera` (m1 0x124838) keeps the
   * view inside it.
   */
  camEdges: [number, number, number, number];
  /**
   * Spawn Particle (3608 → `spawnParticleTrigger` m1 0x12b938) requests not
   * yet taken by the scene: copy group `group`'s particle objects (2065) at
   * group `posGroup`'s object, or at the trigger itself when that is 0.
   */
  particleSpawns: { group: number; posGroup: number; x: number; y: number }[];
  /**
   * Area Tint (3010) effects in force: group `target`'s objects within
   * `length` of the centre (player 1 for special target −1, else group
   * `centerGroup`'s object) take channel `tintCh`'s colour — `GJBaseGameLayer::
   * processAreaTintGroupAction` m1 0x116a18 mixes tint and own colour by
   * v·amount + (1 − amount), v from `getAreaObjectValue` m1 0x117708 (radial
   * distance / length, past a deadzone, flipped when inbound). `t0` is when it
   * started; it eases in over `dur`.
   */
  areaTints: { target: number; centerGroup: number; length: number; deadzone: number; tintCh: number;
    amount: number; inbound: boolean; detailOnly: boolean; t0: number; dur: number }[];
  /**
   * Zoom camera trigger (1913, key 371): the view shows 1/zoom of the usual
   * area about the unzoomed view's centre (native Dash x=2300, zoom 0.833:
   * ~685 of 571 units across, framing matching a centre anchor).
   */
  zoom: number;
  /**
   * Camera offset (1916) and rotation (2015), in world units / degrees:
   * `GJBaseGameLayer::updateCameraOffsetX/Y` (m1 0x120cc4/0x120d90) ease
   * [+0x1b0]/[+0x1b4] to the target, and `updateCamera` moves the view by the
   * change each frame (+0x124bf8); `updateScreenRotation` (0x120af4) eases the
   * screen angle [+0x324] toward [+0x328].
   */
  camOffset: { x: number; y: number };
  camAngle: number;
  camAngleTarget: number;
  /**
   * Active gradient triggers (2903) by gradient ID (key 209): the trigger's
   * properties, drawn every frame by the scene (`updateGradientLayers`,
   * m1 0x10e7c0). Key 208 removes one, 508 removes all
   * (`triggerGradientCommand` m1 0x10e12c).
   */
  gradients: Map<number, Map<number, string>>;
  /** screen shader colour state (2919–2923) */
  shader: ShaderState;
  /**
   * The layers the screen shaders take (Shader Setup 2904, keys 196/197 →
   * `ShaderLayer` m1 0x34c140): 1 BG, 2 MG, 3–7 B5–B1, 8 the player's layer,
   * 9–12 T1–T4, 13 the ground, 14 UI, 15 the top. `GJBaseGameLayer::
   * updateShaderLayer` (m1 0x11002c) moves each layer node into the shader
   * layer when its index is in range and back out when not.
   */
  shaderZ: [number, number];
  /**
   * The player's colours 1 and 2 (0..255), which a colour trigger with key
   * 15/16 fades to instead of its own RGB (`ColorAction::m_playerColor`).
   * The scene sets them from the icon kit; the default kit's are the fallback.
   */
  playerColors: readonly [PlayerRgb, PlayerRgb];
  cameraStatic: { group: number; dur: number; type: number; rate: number; t: number; from: number | null } | null;
  /**
   * Camera Static (1914) for the **view**, every axis (key 101: 0 both, 1 x,
   * 2 y): the view centre eases from where it was onto group `group`'s
   * object over `dur` (keys 10/30/85) and stays there; an exit (key 110)
   * eases back to the ordinary follow over its own duration. The scene fills
   * `fromX/fromY` with the centre it started from. Native Dash (vseek camera
   * log 2026-10-03, steps 18400–21957): the view parks on the 2016 guide of
   * group 345 at x 21855 while the player wanders ±650 around it.
   */
  viewStatic: ViewStatic | null;
  tweens: Tween[];
  /** spawn-trigger activations still counting down */
  pending: {
    at: number; group: number; src?: number[]; delayed?: boolean; remap?: ReadonlyMap<number, number>;
    /** an ordered spawn's members go one by one: fire just this trigger (`group` is its source) */
    only?: Trigger; ordered?: boolean;
  }[];
  /** seconds since the attempt began, for spawn delays */
  time: number;
  /**
   * M8: the shake trigger (1520) in flight. `strength` is the trigger's own
   * key-75 value; the scene turns it into a camera offset. Zero when nothing is
   * shaking.
   */
  shake: { strength: number; remaining: number };
  /** pulse triggers still running, oldest first */
  pulses: Pulse[];
  /** item counters (`GJEffectManager::countForItem` / `updateCountForItem`) */
  items: Map<number, number>;
  /** count triggers (1611) that have been armed */
  counters: CountListener[];
  /** collision triggers (1815) that have been armed */
  collisions: CollisionListener[];
  /** collision-block pairs overlapping as of the last check, keyed by `pairKey` */
  collidingPairs: Set<number>;
  /** groups the on-death triggers (1812) armed so far will fire */
  onDeath: { group: number; activate: boolean }[];
  /** touch triggers (key 11) already fired, by index into the trigger list */
  touched: Set<number>;
  /**
   * Animate trigger (1585): group -> the clock reading when it last fired.
   * An object with key **123** (`m_animateOnTrigger`) holds its first frame
   * until one of its groups appears here, and then runs from that instant —
   * `EnhancedGameObject::triggerAnimation` (m1 `0x201c00`) sets
   * `m_animationTriggered` and re-bases the start offset to `-totalTime`.
   * Presentation only: every target measured in FIDELITY §4.2 is decoration.
   */
  animated: Map<number, number>;
}

/**
 * Legacy colour triggers name their target channel through their object id.
 * SOURCED from the shipping 2.2081 binary (arm64 slice, geode m1 addresses) —
 * see ARCHITECTURE-REFERENCE.md §3. Three functions together settle the table:
 *
 * - `EffectGameObject::customSetup` (0x1572dc) writes `m_targetColorID` (+0x400)
 *   for 29 -> 1000, 30 -> 1001, 105 -> 1004, 744 -> 1003, 900 -> 1009 and
 *   915 -> 1002, and sets `m_blending` (+0x5cf) for 915 alone.
 * - the object factory (0x4f10cc) *remaps the id at creation*: 104 becomes a
 *   915 and 221/717/718/743 become an 899, each remembering its original id;
 *   its tail switch (0x4f2124) then writes `m_targetColorID` 1/2/3/4 for
 *   221/717/718/743 and sets `m_blending` for 104.
 * - `EffectGameObject::triggerObject` (0x172da4) reaches its one `updateColor`
 *   call (0x173398) from exactly {29, 30, 105, 744, 899, 900, 915} — the set
 *   that survives that remap — which is what proves the table complete.
 *
 * 743 is sourced but appears in none of the 22 levels.
 */
const LEGACY_COLOR_TARGET: Record<number, number> = {
  29: 1000, 30: 1001, 104: 1002, 105: 1004,
  221: 1, 717: 2, 718: 3, 743: 4,
  744: 1003, 900: 1009, 915: 1002,
};

/**
 * The two ids whose setup turns blending on before the level's own key 17 is
 * read. Every other trigger starts from the constructor's zeroed +0x5cc..+0x5cf
 * (0x1a2288), which also defaults opacity (+0x5b0) to 1.0.
 */
const LEGACY_COLOR_BLENDING = new Set([104, 915]);

/** parsed and intentionally inert this milestone */
/** parsed and intentionally inert — see FIDELITY.md 4.x for the reason each one has */
const UNIMPLEMENTED = new Set([
  1347, // follow
  1814, // follow-player-Y
  1816, // collision block: it *is* a block, not a trigger (`triggerObject` +516 returns)
]);

const TRIGGER_IDS = new Set<number>([
  ...Object.keys(LEGACY_COLOR_TARGET).map(Number),
  899, 901, 1006, 1007, 1049, 1268, 1346, 1520,
  1585, 1611, 1616, 1811, 1812, 1815, 1817, 1913, 1914, 1916, 1935, 2015, 2067, 2903, 2904, 2910, 2911, 2905, 2907, 2913, 2914, 2916, 2919, 2920, 2921, 2922, 2923, 2900, 2899, 2999, 3029, 2062, 3608, 3010, 3600,
  ...UNIMPLEMENTED,
]);

export function isTrigger(id: number): boolean {
  return TRIGGER_IDS.has(id);
}

/**
 * One key for an unordered pair of collision-block ids.
 *
 * Block ids come from key 80 and nothing bounds them, so the old `lo * 10000 +
 * hi` packing aliased as soon as an id reached 10 000 — two different pairs
 * could share a key and one of them would never fire. 21 bits each keeps the
 * key an exact double (2^42) for any id the editor can produce.
 */
const PAIR_SHIFT = 2 ** 21;
export function pairKey(a: number, b: number): number {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return lo * PAIR_SHIFT + hi;
}
export function pairA(key: number): number { return Math.floor(key / PAIR_SHIFT); }
export function pairB(key: number): number { return key % PAIR_SHIFT; }

/** "1.2.3" -> [1,2,3] */
export function parseGroups(o: LevelObject): number[] {
  const raw = o.props.get(P.GROUP_IDS);
  if (!raw) return [];
  const out: number[] = [];
  for (const part of raw.split(".")) {
    const n = parseInt(part, 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * The centre of a group, or null when nothing carries it.
 *
 * SOURCED: `GJBaseGameLayer::getGroupCenter` (m1 `0x33fa4`). One object returns
 * **that object's position** (+60..104); more than one returns the centre of
 * their **bounding box** (+164.., which accumulates min/max against +-1e6
 * sentinels), not their mean. A rotate trigger names one of these as its centre
 * (key 71) and a move trigger in target mode names two.
 */
function groupMembers(level: Level, group: number): GroupPoint[] {
  const out: GroupPoint[] = [];
  for (const o of level.objects) {
    const gs = parseGroups(o);
    if (gs.includes(group)) out.push({ x: o.x, y: o.y, groups: gs });
  }
  return out;
}

/**
 * Where a linked teleport portal (2902) sends the player: the first object in
 * `group`, at its current place. `GJBaseGameLayer::getPortalTarget` (m1
 * 0xfa084) looks the exit up by the portal's key 51.
 */
export function groupAnchor(
  level: Level, rt: TriggerRuntime | undefined, group: number,
): { x: number; y: number } | null {
  if (!(group > 0)) return null;
  let byGroup = anchorCache.get(level);
  if (!byGroup) anchorCache.set(level, byGroup = new Map());
  let first = byGroup.get(group);
  if (first === undefined) byGroup.set(group, first = groupMembers(level, group)[0] ?? null);
  return first ? centreOfPoints([first], rt) : null;
}
/** a level's first member per group — the sim asks every step under a static camera */
const anchorCache = new WeakMap<Level, Map<number, GroupPoint | null>>();

/**
 * The centre of a set of group members, with each member moved to where its
 * groups have put it. `rt` omitted gives the static centre.
 */
function centreOfPoints(
  pts: GroupPoint[], rt?: TriggerRuntime,
): { x: number; y: number } | null {
  if (!pts.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    let x = p.x, y = p.y;
    if (rt) {
      for (const g of p.groups) { const gs = groupState(rt, g); x += gs.dx; y += gs.dy; }
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // one object is its own position; more than one is the bounding-box centre
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function groupCentre(level: Level, group: number): { x: number; y: number } | null {
  return centreOfPoints(groupMembers(level, group));
}

/** every trigger in the level, sorted by x so firing is a single moving index */
export function buildTriggers(level: Level): Trigger[] {
  const out: Trigger[] = [];
  const centres = new Map<number, { x: number; y: number } | null>();
  const members = new Map<number, GroupPoint[]>();
  for (const o of level.objects) {
    if (!isTrigger(o.id)) continue;
    let centre: { x: number; y: number } | undefined;
    const membersOf = (g: number) => {
      if (!(g > 0)) return undefined;
      if (!members.has(g)) members.set(g, groupMembers(level, g));
      const m = members.get(g)!;
      return m.length ? m : undefined;
    };
    if (o.id === 1346 || o.id === 2067) {
      const g = propInt(o.props, P.SECONDARY_GROUP_ID, -1);
      if (g > 0) {
        if (!centres.has(g)) centres.set(g, groupCentre(level, g));
        centre = centres.get(g) ?? undefined;
      }
    }
    let moveTo: GroupPoint[] | undefined;
    let moveFrom: GroupPoint[] | undefined;
    if (o.id === 901 && propBool(o.props, P.MOVE_USE_TARGET)) {
      moveTo = membersOf(propInt(o.props, P.SECONDARY_GROUP_ID, -1));
      moveFrom = membersOf(propInt(o.props, P.MOVE_TARGET_CENTER, -1));
    }
    // the object rect a touch trigger is hit against: the editor sprite is one
    // 30x30 block, scaled by key 32 and (2.2) the per-axis keys 128/129
    const scale = propFloat(o.props, P.SCALE, 1);
    const sx = o.props.has(128) ? propFloat(o.props, 128, 1) : scale;
    const sy = o.props.has(129) ? propFloat(o.props, 129, 1) : scale;
    out.push({
      id: o.id, index: 0, x: o.x, y: o.y, props: o.props,
      touch: propBool(o.props, P.TOUCH_TRIGGERED),
      multi: propBool(o.props, P.MULTI_TRIGGER),
      hw: 15 * sx, hh: 15 * sy,
      spawnTriggered: propBool(o.props, P.SPAWN_TRIGGERED),
      channel: propInt(o.props, P.TRIGGER_CHANNEL, 0),
      groups: parseGroups(o),
      centre, moveTo, moveFrom,
    });
  }
  out.sort((a, b) => a.x - b.x);
  out.forEach((t, i) => { t.index = i; });
  return out;
}

/**
 * The collision blocks (1816) of a level, in x order. Each carries the block
 * id a collision trigger names (key 80), whether it moves with its groups
 * (key 94), and its rect.
 */
export interface CollisionBlock {
  block: number;
  x: number;
  y: number;
  hw: number;
  hh: number;
  dynamic: boolean;
  groups: number[];
}

export function buildCollisionBlocks(level: Level): CollisionBlock[] {
  const out: CollisionBlock[] = [];
  for (const o of level.objects) {
    if (o.id !== 1816) continue;
    const scale = propFloat(o.props, P.SCALE, 1);
    const sx = o.props.has(128) ? propFloat(o.props, 128, 1) : scale;
    const sy = o.props.has(129) ? propFloat(o.props, 129, 1) : scale;
    out.push({
      block: propInt(o.props, P.ITEM_ID, 0),
      x: o.x, y: o.y, hw: 15 * sx, hh: 15 * sy,
      dynamic: propBool(o.props, P.DYNAMIC_BLOCK),
      groups: parseGroups(o),
    });
  }
  return out;
}

/** groups any move/alpha/toggle/rotate trigger can affect — these colliders must be dynamic */
export function movableGroups(triggers: Trigger[]): Set<number> {
  const s = new Set<number>();
  for (const t of triggers) {
    if (t.id === 901 || t.id === 1007 || t.id === 1049 || t.id === 1346 || t.id === 2067) {
      const g = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (g >= 0) s.add(g);
    }
  }
  // a spawn remap hands a mover's target to another group
  for (const t of triggers) {
    const remap = t.id === 1268 ? spawnRemap(t.props) : undefined;
    if (remap) for (const [from, to] of remap) if (s.has(from)) s.add(to);
  }
  return s;
}

/**
 * Groups whose **positions** a trigger can change — move (901), rotate (1346)
 * and scale (2067), followed through spawn remaps. Unlike `movableGroups`
 * (collision), alpha and toggle do not count: they never move a sprite. The
 * scene indexes every sprite outside these by x.
 */
export function positionedGroups(triggers: Trigger[]): Set<number> {
  const s = new Set<number>();
  for (const t of triggers) {
    if (t.id === 901 || t.id === 1346 || t.id === 2067) {
      const g = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (g >= 0) s.add(g);
    }
  }
  for (const t of triggers) {
    const remap = t.id === 1268 ? spawnRemap(t.props) : undefined;
    if (remap) for (const [from, to] of remap) if (s.has(from)) s.add(to);
  }
  return s;
}

export function createRuntime(level: Level): TriggerRuntime {
  const rt: TriggerRuntime = {
    colors: new Map(), groups: new Map(), next: 0, tweens: [], pending: [], time: 0,
    channel: 0, dir: 4, fired: new Set(), rotations: [], timeWarp: 1, cameraStatic: null, viewStatic: null, endHit: false, controlsOff: [false, false], bgIndex: null, mgOffsetY: 0, camEdges: [0, 0, 0, 0], particleSpawns: [], areaTints: [], zoom: 1, camOffset: { x: 0, y: 0 }, camAngle: 0, camAngleTarget: 0, gradients: new Map(), shader: freshShaderState(), shaderZ: [1, 15],
    playerColors: [{ r: 125, g: 255, b: 0 }, { r: 0, g: 255, b: 255 }],
    shake: { strength: 0, remaining: 0 }, pulses: [],
    items: new Map(), counters: [], collisions: [], collidingPairs: new Set(),
    onDeath: [], touched: new Set(), animated: new Map(),
  };
  resetRuntime(rt, level);
  return rt;
}

/** back to the level's start-of-attempt state */
export function resetRuntime(rt: TriggerRuntime, level: Level) {
  rt.colors.clear();
  rt.groups.clear();
  rt.tweens.length = 0;
  rt.pending.length = 0;
  rt.next = 0;
  rt.channel = 0;
  rt.dir = 4;
  rt.fired.clear();
  rt.rotations.length = 0;
  rt.timeWarp = 1;
  rt.cameraStatic = null;
  rt.viewStatic = null;
  rt.zoom = 1;
  rt.camOffset = { x: 0, y: 0 }; rt.camAngle = 0; rt.camAngleTarget = 0;
  rt.gradients = new Map();
  rt.shader = freshShaderState();
  rt.shaderZ = [1, 15];
  rt.endHit = false;
  rt.controlsOff = [false, false];
  rt.bgIndex = null;
  rt.mgOffsetY = 0;
  rt.camEdges = [0, 0, 0, 0];
  rt.particleSpawns = [];
  rt.areaTints = [];
  rt.time = 0;
  rt.shake.strength = 0;
  rt.shake.remaining = 0;
  rt.pulses.length = 0;
  rt.items.clear();
  rt.counters.length = 0;
  rt.collisions.length = 0;
  rt.collidingPairs.clear();
  rt.onDeath.length = 0;
  rt.touched.clear();
  rt.animated.clear();
  for (const [ch, c] of level.colors) {
    rt.colors.set(ch, {
      r: c.r, g: c.g, b: c.b, opacity: c.opacity, blending: c.blending,
      copyChannel: c.copyChannel, copyHSV: c.hsv, copyOpacity: c.copyOpacity,
    });
  }
}

/**
 * Overwrite `rt` with a copy of `snap`, in place.
 *
 * For practice checkpoints: the renderer and the collision world both hold this
 * exact runtime object, so a checkpoint restore cannot swap in a new one. The
 * contents are re-copied (not aliased) so the same snapshot can be restored any
 * number of times.
 */
export function restoreRuntime(rt: TriggerRuntime, snap: TriggerRuntime) {
  rt.colors.clear();
  for (const [k, v] of snap.colors) rt.colors.set(k, { ...v });
  rt.groups.clear();
  for (const [k, v] of snap.groups) rt.groups.set(k, { ...v });
  rt.tweens.length = 0;
  for (const w of snap.tweens) {
    rt.tweens.push(w.kind === "color"
      ? { ...w, from: { ...w.from }, to: { ...w.to } } : { ...w });
  }
  rt.pending.length = 0;
  for (const p of snap.pending) rt.pending.push({ ...p });
  rt.next = snap.next;
  rt.channel = snap.channel;
  rt.dir = snap.dir;
  rt.fired.clear();
  for (const i of snap.fired) rt.fired.add(i);
  rt.rotations.length = 0;
  for (const r of snap.rotations) rt.rotations.push({ ...r });
  rt.timeWarp = snap.timeWarp;
  rt.cameraStatic = snap.cameraStatic && { ...snap.cameraStatic };
  rt.viewStatic = snap.viewStatic && { ...snap.viewStatic };
  rt.zoom = snap.zoom;
  rt.camOffset = { ...snap.camOffset }; rt.camAngle = snap.camAngle; rt.camAngleTarget = snap.camAngleTarget;
  rt.gradients = new Map(snap.gradients);
  rt.shader = { ...snap.shader };
  rt.shaderZ = [...snap.shaderZ];
  rt.endHit = snap.endHit;
  rt.controlsOff = [...snap.controlsOff];
  rt.bgIndex = snap.bgIndex;
  rt.mgOffsetY = snap.mgOffsetY;
  rt.camEdges = [...snap.camEdges];
  rt.particleSpawns = [];
  rt.areaTints = snap.areaTints.map((a) => ({ ...a }));
  rt.time = snap.time;
  rt.shake.strength = snap.shake.strength;
  rt.shake.remaining = snap.shake.remaining;
  rt.pulses.length = 0;
  for (const p of snap.pulses) rt.pulses.push({ ...p });
  rt.items.clear();
  for (const [k, v] of snap.items) rt.items.set(k, v);
  rt.counters.length = 0;
  for (const c of snap.counters) rt.counters.push({ ...c });
  rt.collisions.length = 0;
  for (const c of snap.collisions) rt.collisions.push({ ...c });
  rt.collidingPairs.clear();
  for (const k of snap.collidingPairs) rt.collidingPairs.add(k);
  rt.onDeath.length = 0;
  for (const d of snap.onDeath) rt.onDeath.push({ ...d });
  rt.touched.clear();
  for (const i of snap.touched) rt.touched.add(i);
  rt.animated.clear();
  for (const [k, v] of snap.animated) rt.animated.set(k, v);
}

/** deep copy so an autopilot branch cannot write into its parent's state */
export function cloneRuntime(rt: TriggerRuntime): TriggerRuntime {
  const colors = new Map<number, ColorState>();
  for (const [k, v] of rt.colors) colors.set(k, { ...v });
  const groups = new Map<number, GroupState>();
  for (const [k, v] of rt.groups) groups.set(k, { ...v });
  return {
    colors, groups, next: rt.next, time: rt.time,
    channel: rt.channel, dir: rt.dir, fired: new Set(rt.fired),
    rotations: rt.rotations.map((r) => ({ ...r })), timeWarp: rt.timeWarp,
    cameraStatic: rt.cameraStatic && { ...rt.cameraStatic }, viewStatic: rt.viewStatic && { ...rt.viewStatic }, endHit: rt.endHit, controlsOff: [...rt.controlsOff], bgIndex: rt.bgIndex, mgOffsetY: rt.mgOffsetY, camEdges: [...rt.camEdges], particleSpawns: [], areaTints: rt.areaTints.map((a) => ({ ...a })), zoom: rt.zoom,
    camOffset: { ...rt.camOffset }, camAngle: rt.camAngle, camAngleTarget: rt.camAngleTarget,
    gradients: new Map(rt.gradients),
    shader: { ...rt.shader },
    shaderZ: [...rt.shaderZ],
    playerColors: rt.playerColors,
    shake: { ...rt.shake },
    tweens: rt.tweens.map((w) => (w.kind === "color"
      ? { ...w, from: { ...w.from }, to: { ...w.to } } : { ...w })),
    pending: rt.pending.map((p) => ({ ...p })),
    pulses: rt.pulses.map((p) => ({ ...p })),
    items: new Map(rt.items),
    counters: rt.counters.map((c) => ({ ...c })),
    collisions: rt.collisions.map((c) => ({ ...c })),
    collidingPairs: new Set(rt.collidingPairs),
    onDeath: rt.onDeath.map((d) => ({ ...d })),
    touched: new Set(rt.touched),
    animated: new Map(rt.animated),
  };
}

export function groupState(rt: TriggerRuntime, group: number): GroupState {
  let s = rt.groups.get(group);
  if (!s) {
    rt.groups.set(group, (s = {
      dx: 0, dy: 0, alpha: 1, enabled: true, rot: 0, cx: 0, cy: 0, lockRot: false,
      sx: 1, sy: 1, scx: 0, scy: 0, scaleOwn: false,
    }));
  }
  return s;
}

function colorState(rt: TriggerRuntime, ch: number): ColorState {
  let c = rt.colors.get(ch);
  if (!c) {
    rt.colors.set(ch, (c = {
      // the player colours blend by default (see `playerChannel`)
      r: 255, g: 255, b: 255, opacity: 1, blending: ch === 1005 || ch === 1006,
      copyChannel: 0, copyHSV: NO_HSV, copyOpacity: false,
    }));
  }
  return c;
}

/**
 * `PulseEffectAction::valueForDelta` (m1 0x273a74) — 0..1, and strictly linear.
 * The `t < fadeIn` test is a strict compare, so a zero fade-in starts at full
 * strength rather than dividing zero by zero.
 */
export function pulseValue(t: number, fadeIn: number, hold: number, fadeOut: number): number {
  if (t < fadeIn) return t / fadeIn;
  if (fadeIn + hold >= t) return 1;
  if (fadeOut <= 0) return 0;
  return 1 - (t - fadeIn - hold) / fadeOut;
}

export function pulseDuration(p: Pulse): number {
  return p.fadeIn + p.hold + p.fadeOut;
}

/**
 * `GJEffectManager::getMixedColor` (m1 0x28475c) — `a * ratio + b * (1 - ratio)`,
 * clamped to 0..255 and **truncated**, so `a` is the colour the ratio favours.
 */
function mixChannel(a: number, b: number, ratio: number): number {
  return Math.trunc(Math.max(0, Math.min(255, a * ratio + b * (1 - ratio))));
}

/** a copy chain longer than this is a cycle; stop and use what we have */
const MAX_COPY_DEPTH = 8;

/**
 * The colour to actually draw a channel with, following its copy source.
 *
 * `activeColorForIndex` (m1 0x278138) resolves 0 and 1011 to white and 1010 to
 * black before it looks a channel up at all, so those three are answered here
 * too. Everything else follows `copyChannel` — live, because the source is
 * still being animated by its own triggers.
 */
export function resolveColor(rt: TriggerRuntime, ch: number): ColorState {
  const base = resolveChannel(rt, ch);
  if (!rt.pulses.length) return base;
  let out = base;
  for (const p of rt.pulses) {
    if (p.isGroup || p.target !== ch) continue;
    const v = pulseValue(p.t, p.fadeIn, p.hold, p.fadeOut);
    if (v <= 0) continue;
    const to = pulseColor(rt, p, out);
    out = {
      ...out,
      r: mixChannel(to.r, out.r, v),
      g: mixChannel(to.g, out.g, v),
      b: mixChannel(to.b, out.b, v),
    };
  }
  return out;
}

/**
 * The colour a pulse lays over `under`: an HSV-mode pulse bends what is already
 * there, a copy pulse takes another channel's colour, and otherwise it is the
 * trigger's own RGB.
 */
export function pulseColor(
  rt: TriggerRuntime, p: Pulse, under: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  if (p.copyChannel) {
    const src = resolveChannel(rt, p.copyChannel);
    return p.hsv ? transformColor(src, p.hsv) : { r: src.r, g: src.g, b: src.b };
  }
  if (p.hsv) return transformColor(under, p.hsv);
  return { r: p.r, g: p.g, b: p.b };
}

/**
 * Every live group pulse laid over a colour, in 0..255.
 *
 * `mainOnly` (key 65) and `detailOnly` (key 66) choose which of an object's two
 * sprites a pulse reaches, so the caller says which one it is drawing. A pulse
 * aimed at a *colour channel* never applies here even when the numbers match:
 * groups and channels are separate id spaces.
 */
export function applyGroupPulses(
  rt: TriggerRuntime, groups: number[], detail: boolean,
  c: { r: number; g: number; b: number },
): { r: number; g: number; b: number } {
  if (!rt.pulses.length || !groups.length) return c;
  let out = c;
  for (const p of rt.pulses) {
    if (!p.isGroup || !groups.includes(p.target)) continue;
    if (p.mainOnly && detail) continue;
    if (p.detailOnly && !detail) continue;
    const v = pulseValue(p.t, p.fadeIn, p.hold, p.fadeOut);
    if (v <= 0) continue;
    const to = pulseColor(rt, p, out);
    out = {
      r: mixChannel(to.r, out.r, v),
      g: mixChannel(to.g, out.g, v),
      b: mixChannel(to.b, out.b, v),
    };
  }
  return out;
}

/**
 * 1005 and 1006 are the player's own colours 1 and 2
 * (`GJEffectManager::activeColorForIndex`, m1 0x278138, answers them from the
 * game manager's icon colours, not the colour table): Theory of Everything's
 * floor half-wheels and orb rings default to 1006 and are magenta in a 2.2
 * playthrough whose colour 2 is magenta, white in the 2026-09-29 native
 * capture whose colour 2 was white — and white here, while the port left 1006
 * to the table, whatever the kit said.
 */
function playerChannel(rt: TriggerRuntime, ch: number): ColorState {
  const self = colorState(rt, ch);
  if (ch !== 1005 && ch !== 1006) return self;
  const pc = rt.playerColors[ch - 1005];
  // …and they **blend** (additive batch) by default:
  // Hexagon Force 45% in a 4K 2.2 recording (YouTube 2htgtTtviZw, the same
  // green/cyan kit as the port's default) has the 1005 pillar stripes (451)
  // at (106–123, 252, 180) over a (0, 80, 180) background — background +
  // (125, 255, 0) clamped, i.e. added, not laid over (which gives the lime the
  // port drew).
  // (`colorState` starts 1005/1006 blending; a trigger that sets them wins)
  return { ...self, r: pc.r, g: pc.g, b: pc.b };
}

/** the channel's own colour, following its copy source but ignoring pulses */
function resolveChannel(rt: TriggerRuntime, ch: number): ColorState {
  // LBG is recomputed from BG and player colour 1 every frame (`lightBgColor`)
  if (ch === 1007) {
    const self = colorState(rt, ch);
    return { ...self, ...lightBgColor(resolveChannel(rt, 1000), rt.playerColors[0]) };
  }
  const self = playerChannel(rt, ch);
  let src = self;
  const seen = new Set<number>([ch]);
  for (let i = 0; i < MAX_COPY_DEPTH && src.copyChannel; i++) {
    if (seen.has(src.copyChannel)) break;
    seen.add(src.copyChannel);
    src = playerChannel(rt, src.copyChannel);
  }
  if (src === self) return self;
  const t = transformColor(src, self.copyHSV);
  return {
    r: t.r, g: t.g, b: t.b,
    // `copyOpacity` is its own argument to updateColor, separate from the
    // colour, so it is the only thing a copy takes beyond the RGB
    opacity: self.copyOpacity ? src.opacity : self.opacity,
    blending: self.blending,
    copyChannel: self.copyChannel, copyHSV: self.copyHSV, copyOpacity: self.copyOpacity,
  };
}

/** set a channel now, or tween it over `dur`, replacing any tween in flight */
function applyColor(
  rt: TriggerRuntime, ch: number, to: ColorState, dur: number, ease: Eased,
) {
  const cur = colorState(rt, ch);
  // a later trigger on the same channel replaces the one in flight — an
  // instant one too: Fingerdash x=13521 snaps the background red while the
  // 8 s fade from x=11055 is still running, and the old fade must not go on
  // writing over it (the native 50% frame is red, the port's was purple)
  rt.tweens = rt.tweens.filter((w) => !(w.kind === "color" && w.ch === ch));
  if (dur <= 0) {
    Object.assign(cur, to);
    return;
  }
  // APPROXIMATION: the copy *routing* is not a colour, so it takes effect at
  // once rather than at the end of the fade. Of the 17 copy-setting triggers in
  // the 22 levels, 13 have no duration at all and the rest are under 0.5 s.
  cur.copyChannel = to.copyChannel;
  cur.copyHSV = to.copyHSV;
  cur.copyOpacity = to.copyOpacity;
  rt.tweens.push({ kind: "color", ch, from: { ...cur }, to, t: 0, dur, ...ease });
}

/** key 30 / key 85 off a trigger; the rate guard lives in `easedValue` */
function easing(t: Trigger): Eased {
  return {
    ease: propInt(t.props, P.EASING, 0),
    rate: propFloat(t.props, P.EASING_RATE, 0),
    src: t.groups.length ? t.groups : undefined,
  };
}

/**
 * `GJBaseGameLayer::toggleGroupTriggered` (m1 `0x11179c`): enable or disable
 * the group, and — only when enabling — spawn it as well (+48..104 tail-calls
 * `spawnGroup`). Every trigger whose editor has an "activate group" checkbox
 * goes through this: count, instant count, collision, on death, and the
 * custom ring. The plain toggle trigger (1049) does **not** — `triggerObject`
 * +1820 tail-calls the bare `toggleGroup`.
 */
function toggleGroupTriggered(rt: TriggerRuntime, group: number, activate: boolean) {
  if (group <= 0) return;
  groupState(rt, group).enabled = activate;
  if (activate) rt.pending.push({ at: rt.time, group });
}

/** `GJEffectManager::countForItem` (m1 `0x281adc`) */
export function itemCount(rt: TriggerRuntime, item: number): number {
  return rt.items.get(item) ?? 0;
}

/**
 * `GJEffectManager::updateCountForItem` (m1 `0x281c48`): store the value, then
 * fire every count listener on that item whose target the value has just
 * crossed (+976..1008 — `prev < target <= now`, or the same downwards), and
 * drop the ones that are not multi-activate (+1036..1192).
 */
export function setItemCount(rt: TriggerRuntime, item: number, count: number) {
  rt.items.set(item, count);
  const fired: CountListener[] = [];
  rt.counters = rt.counters.filter((c) => {
    if (c.item !== item) return true;
    const prev = c.prev;
    c.prev = count;
    const crossed = (prev < c.target && c.target <= count)
      || (prev > c.target && c.target >= count);
    if (!crossed) return true;
    fired.push(c);
    return c.multi;
  });
  for (const c of fired) toggleGroupTriggered(rt, c.group, c.activate);
}

/** `GJEffectManager::addCountToItem` (m1 `0x281bd4`) */
export function addItemCount(rt: TriggerRuntime, item: number, delta: number) {
  setItemCount(rt, item, itemCount(rt, item) + delta);
}

/**
 * The player died: every on-death trigger armed so far fires
 * (`EffectGameObject::triggerObject` +388 for id 1812 is the ordinary
 * activate-group path; arming is what passing the trigger does).
 */
export function fireOnDeath(rt: TriggerRuntime) {
  for (const d of rt.onDeath) toggleGroupTriggered(rt, d.group, d.activate);
}

/**
 * `GJBaseGameLayer::activateCustomRing` (m1 `0x10b030`), reached from
 * `PlayerObject::ringJump` +632 for a `CustomRing` (type 36, id 1594): with
 * key 504 it only spawns the target group, otherwise it toggles-and-spawns it.
 * The ring gives the player no velocity at all.
 */
export function activateCustomRing(rt: TriggerRuntime, props: Map<number, string>) {
  const group = propInt(props, P.TARGET_GROUP_ID, -1);
  if (group < 0) return;
  if (propBool(props, P.RING_SPAWN_ONLY)) rt.pending.push({ at: rt.time, group });
  else toggleGroupTriggered(rt, group, propBool(props, P.ACTIVATE_GROUP));
}

/**
 * Collision blocks A and B are overlapping (or, with key 93, have stopped):
 * fire every matching registration. `GJEffectManager::handleObjectCollision`
 * (m1 `0x279cb4`) walks the registered triggers and calls the delegate's
 * `toggleGroupTriggered` for each whose pair and exit flag match.
 */
export function handleBlockCollision(
  rt: TriggerRuntime, a: number, b: number, onExit: boolean,
) {
  for (const c of rt.collisions) {
    if (c.onExit !== onExit) continue;
    if ((c.a === a && c.b === b) || (c.a === b && c.b === a)) {
      toggleGroupTriggered(rt, c.group, c.activate);
    }
  }
}

/**
 * `TriggerControlGameObject::triggerObject` (m1 `0x19eb18`) with command 0:
 * stop everything the triggers of `group` started —
 * `GJBaseGameLayer::controlTriggersInGroup` (`0x10b0e4`) walks that group and
 * calls `GJEffectManager::controlActionsForTrigger` on each. In this port a
 * tween or a pending spawn remembers the groups of the trigger that made it,
 * which is the same relation.
 */
function stopTriggerGroup(rt: TriggerRuntime, group: number) {
  rt.tweens = rt.tweens.filter((w) => !w.src?.includes(group));
  rt.pending = rt.pending.filter((p) => !p.src?.includes(group));
}

/** run one trigger now */
function fire(rt: TriggerRuntime, t: Trigger, playerX: number, playerY: number) {
  const dur = propFloat(t.props, P.DURATION, 0);
  const ease = easing(t);

  if (UNIMPLEMENTED.has(t.id)) return;

  // Animate (1585). `EffectGameObject::triggerObject` walks the target group and
  // calls `triggerAnimation` on each member; an `AnimatedGameObject` plays the
  // animation key **76** names, an `EnhancedGameObject` with key 123 simply
  // starts its synced loop from now. The port has the second kind only — every
  // key-76 target in the 22 levels is id 918/1584 (`AnimatedGameObject`), which
  // the port draws as one static sprite (FIDELITY §5.4).
  if (t.id === 1585) {
    const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
    if (group >= 0) rt.animated.set(group, rt.time);
    return;
  }

  // Rotate Gameplay (2900): queued for the sim, which owns the player
  // (`GJBaseGameLayer::rotateGameplay` -> `PlayerObject::rotateGameplay`).
  // Key 171 changes the active channel to key 173's; key 172 ("channel only")
  // does that without turning anything.
  if (t.id === 1935) {
    rt.timeWarp = propFloat(t.props, P.TIME_WARP, 1);
    return;
  }
  // 2.2's End trigger: passing it ends the level where it stands (Dash
  // (21853, 2707): the real player locks at x 21853.89, 2230 short of the
  // level's last object). APPROXIMATION: its options (keys like "no effects",
  // "instant") are not read; the scene plays the usual ending.
  if (t.id === 3600) { rt.endHit = true; return; }
  if (t.id === 1914) {
    const dur = Math.max(0, propFloat(t.props, P.DURATION, 0));
    const ease = { type: propInt(t.props, P.EASING, 0), rate: propFloat(t.props, P.EASING_RATE, 2) };
    if (propBool(t.props, P.CAMERA_EXIT_STATIC)) {
      // `exitStaticCamera` (m1 0x12b6b0): the exit releases only the axes its
      // key 101 names — exitX = axis != 2, exitY = axis != 1 — and an axis
      // that has no static keeps none. The other axis's static stays in place.
      const axis = propInt(t.props, P.CAMERA_AXIS, 0);
      const mask = (axis !== 2 ? 1 : 0) | (axis !== 1 ? 2 : 0);
      // the physics band (`cameraStatic`) is released by any exit: keeping it
      // after an x-only exit faults Dash's replay at f15767 (macro-compare)
      rt.cameraStatic = null;
      if (rt.viewStatic) {
        // key 465 is `m_exitInstant` (Geode bindings, CameraTriggerGameObject); 453 is `m_smoothVelocity`
        const instant = propBool(t.props, 465);
        rt.viewStatic = { ...rt.viewStatic, ...ease, dur: instant ? 0 : dur, t: 0, exit: true,
          exitAxis: rt.viewStatic.exitAxis | mask, fromX: null, fromY: null };
      }
      return;
    }
    const vGroup = propInt(t.props, P.SECONDARY_GROUP_ID, -1);
    if (vGroup > 0) {
      rt.viewStatic = { group: vGroup, axis: propInt(t.props, P.CAMERA_AXIS, 0), dur, ...ease, t: 0,
        exit: false, exitAxis: 0, fromX: null, fromY: null,
        follow: propBool(t.props, 212) ? Math.max(1, propFloat(t.props, 213, 1)) : 0 };
    }
    const group = propInt(t.props, P.SECONDARY_GROUP_ID, -1);
    if (group <= 0 || propInt(t.props, P.CAMERA_AXIS, 0) !== 2) return;
    rt.cameraStatic = {
      group, dur: Math.max(0, propFloat(t.props, P.DURATION, 0)),
      type: propInt(t.props, P.EASING, 0), rate: propFloat(t.props, P.EASING_RATE, 2),
      t: 0, from: null,
    };
    return;
  }
  if (t.id === 2900) {
    if (!propBool(t.props, P.ROTATE_CHANNEL_ONLY)) {
      const ground = propInt(t.props, P.ROTATE_GROUND_DIR, 2);
      const move = propInt(t.props, P.ROTATE_MOVE_DIR, 4);
      rt.rotations.push({
        ground, move,
        edit: propBool(t.props, P.ROTATE_EDIT_VELOCITY),
        override: propBool(t.props, P.ROTATE_OVERRIDE_VELOCITY),
        // absent reads as 0, not the constructor's 1.0: Dash (6735, 309) has
        // key 169 and no 583, and the native cube starts its new gravity axis
        // from rest (f5222: +11.45, one step of gravity). Levels do write 1
        // out explicitly (582 = 1 on every other edit trigger).
        modY: propFloat(t.props, P.ROTATE_VELOCITY_MOD_Y, 0),
      });
      rt.dir = move;
    }
    if (propBool(t.props, P.ROTATE_CHANGE_CHANNEL)) {
      rt.channel = propInt(t.props, P.ROTATE_TARGET_CHANNEL, 0);
    }
    return;
  }

  // --- Task 4: items, collisions, on death, stop ---
  switch (t.id) {
    case 1611: { // count: arm a listener on the item (`runCountTrigger`)
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      const item = propInt(t.props, P.ITEM_ID, 0);
      rt.counters.push({
        item,
        target: propInt(t.props, P.COUNT, 0),
        prev: itemCount(rt, item),
        group,
        activate: propBool(t.props, P.ACTIVATE_GROUP),
        multi: propBool(t.props, P.MULTI_ACTIVATE_TRIGGER),
      });
      return;
    }
    case 1811: { // instant count: compare now (`testInstantCountTrigger`)
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      const have = itemCount(rt, propInt(t.props, P.ITEM_ID, 0));
      const want = propInt(t.props, P.COUNT, 0);
      // +64..164: mode 0 equal, 1 "larger" (have > want), 2 "smaller"
      const mode = propInt(t.props, P.INSTANT_COUNT_COMPARISON, 0);
      const hit = mode === 1 ? have > want : mode === 2 ? have < want : have === want;
      if (hit) toggleGroupTriggered(rt, group, propBool(t.props, P.ACTIVATE_GROUP));
      return;
    }
    case 1817: { // pickup: change the item (`GJBaseGameLayer::addPickupTrigger`)
      const item = propInt(t.props, P.ITEM_ID, 0);
      if (!item) return;
      const mode = propInt(t.props, P.INSTANT_COUNT_COMPARISON, 0);
      const mult = propFloat(t.props, P.PICKUP_MULTIPLIER, 0);
      const count = propInt(t.props, P.COUNT, 0);
      if (mode === 1) setItemCount(rt, item, Math.round(itemCount(rt, item) * mult));
      else if (mode === 2) {
        if (mult !== 0) setItemCount(rt, item, Math.round(itemCount(rt, item) / mult));
      } else if (propBool(t.props, P.PICKUP_OVERRIDE)) setItemCount(rt, item, count);
      else addItemCount(rt, item, propBool(t.props, P.SUBTRACT_COUNT) ? -count : count);
      return;
    }
    case 1812: { // on death: arm it; the sim fires it when the player dies
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      rt.onDeath.push({ group, activate: propBool(t.props, P.ACTIVATE_GROUP) });
      return;
    }
    case 1815: { // collision: register the block pair (`registerCollisionTrigger`)
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      rt.collisions.push({
        a: propInt(t.props, P.ITEM_ID, 0),
        b: propInt(t.props, P.BLOCK_B_ID, 0),
        onExit: propBool(t.props, P.TRIGGER_ON_EXIT),
        group,
        activate: propBool(t.props, P.ACTIVATE_GROUP),
      });
      return;
    }
    case 1616: { // stop (`TriggerControlGameObject::triggerObject`)
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      // key 535 addresses a *control id* instead of a group; no level uses it,
      // and key 580 (pause/resume) is absent everywhere too, so this is Stop.
      if (propBool(t.props, P.STOP_USE_CONTROL_ID)) return;
      if (propInt(t.props, P.STOP_COMMAND, 0) !== 0) return;
      stopTriggerGroup(rt, group);
      return;
    }
  }

  // --- shake (M8) ---
  // Key 75 is the strength, key 10 the duration. A trigger with no duration is
  // a one-shot bump, so it gets a short fixed window rather than zero (which
  // would expire before the next frame could ever sample it).
  if (t.id === 1520) {
    const strength = propFloat(t.props, P.SHAKE_STRENGTH, 0);
    rt.shake.strength = strength;
    rt.shake.remaining = dur > 0 ? dur : 0.3;
    return;
  }

  // --- colour ---
  const legacy = LEGACY_COLOR_TARGET[t.id];
  if (legacy !== undefined || t.id === 899) {
    const ch = legacy ?? propInt(t.props, P.TARGET_COLOR_ID, 1);
    // "Player Color 1/2" (keys 15/16) fade to the player's own colour, not the
    // trigger's RGB: Electrodynamix x=8223 turns the background to colour 1
    // (grey in the native capture) though its RGB says red
    const pc = propBool(t.props, P.PLAYER_COLOR_1) ? rt.playerColors[0]
      : propBool(t.props, P.PLAYER_COLOR_2) ? rt.playerColors[1] : null;
    const to: ColorState = {
      r: pc ? pc.r : propInt(t.props, P.RED, 255),
      g: pc ? pc.g : propInt(t.props, P.GREEN, 255),
      b: pc ? pc.b : propInt(t.props, P.BLUE, 255),
      // the trigger carries its own fields; an absent key is the object's
      // default, not whatever the channel happens to hold right now
      opacity: propFloat(t.props, P.OPACITY, 1),
      blending: t.props.has(P.BLENDING)
        ? propBool(t.props, P.BLENDING)
        : LEGACY_COLOR_BLENDING.has(t.id),
      // updateColor takes the copy source, its HSV and the copy-opacity flag
      // as arguments, so every colour trigger sets all three — one without
      // them clears whatever copy the channel had
      copyChannel: propInt(t.props, P.COPIED_COLOR_ID, 0),
      copyHSV: t.props.has(P.COPIED_COLOR_HSV) ? parseHSV(t.props.get(P.COPIED_COLOR_HSV)!) : NO_HSV,
      copyOpacity: propBool(t.props, P.COPY_OPACITY),
    };
    applyColor(rt, ch, to, dur, ease);
    // A background trigger with tint-ground makes a second updateColor call
    // (0x1733f0) for the ground channel with `fmov s1, #1.0` / `mov w3, #0`:
    // same colour and fade, but opacity 1 and blending off, always.
    if (t.id === 29 && propBool(t.props, P.TINT_GROUND)) {
      applyColor(rt, 1001, { ...to, opacity: 1, blending: false }, dur, ease);
    }
    return;
  }

  if (t.id === 1006) { // pulse
    const p: Pulse = {
      target: propInt(t.props, P.TARGET_GROUP_ID, 0),
      isGroup: propBool(t.props, P.PULSE_TARGET_TYPE),
      fadeIn: propFloat(t.props, P.PULSE_FADE_IN, 0),
      hold: propFloat(t.props, P.PULSE_HOLD, 0),
      fadeOut: propFloat(t.props, P.PULSE_FADE_OUT, 0),
      t: 0,
      hsv: propBool(t.props, P.PULSE_MODE)
        ? parseHSV(t.props.get(P.COPIED_COLOR_HSV) ?? "")
        : null,
      r: propInt(t.props, P.RED, 255),
      g: propInt(t.props, P.GREEN, 255),
      b: propInt(t.props, P.BLUE, 255),
      copyChannel: propInt(t.props, P.COPIED_COLOR_ID, 0),
      mainOnly: propBool(t.props, P.PULSE_MAIN_ONLY),
      detailOnly: propBool(t.props, P.PULSE_DETAIL_ONLY),
    };
    if (!p.target) return;
    // key 86: an exclusive pulse replaces whatever is already on this target
    if (propBool(t.props, P.PULSE_EXCLUSIVE)) {
      rt.pulses = rt.pulses.filter((o) => o.isGroup !== p.isGroup || o.target !== p.target);
    }
    rt.pulses.push(p);
    return;
  }

  switch (t.id) {
    case 901: { // move
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      const s = groupState(rt, group);
      let dx = propFloat(t.props, P.MOVE_OFFSET_X, 0);
      let dy = propFloat(t.props, P.MOVE_OFFSET_Y, 0);
      // "Move to target" (key 100): instead of an offset, put key 395's group
      // centre on key 71's. Both groups may already have been moved, so the
      // offset is the *live* difference at the moment the trigger fires.
      if (propBool(t.props, P.MOVE_USE_TARGET)) {
        // Without key 395 there is no point to measure from, and what the
        // original does then is not decoded — no move trigger in the 22 levels
        // omits it, so the port leaves such a trigger inert rather than guess.
        if (!t.moveTo || !t.moveFrom) return;
        const to = centreOfPoints(t.moveTo, rt);
        const from = centreOfPoints(t.moveFrom, rt);
        if (!to || !from) return;
        dx = to.x - from.x;
        dy = to.y - from.y;
        // key 101 (`m_moveTargetMode`): 1 keeps x only, 2 keeps y only
        const mode = propInt(t.props, P.MOVE_TARGET_MODE, 0);
        if (mode === 1) dy = 0;
        else if (mode === 2) dx = 0;
      }
      if (dur <= 0) {
        s.dx += dx; s.dy += dy;
      } else {
        // no filtering: moves stack (see the increment in `updateTriggers`)
        rt.tweens.push({
          kind: "move", group, fromX: 0, fromY: 0,
          toX: dx, toY: dy, t: 0, dur, ...ease,
          lockX: propBool(t.props, P.LOCK_TO_PLAYER_X),
          lockY: propBool(t.props, P.LOCK_TO_PLAYER_Y),
          atX: playerX, atY: playerY,
          kPrev: 0, lastX: playerX, lastY: playerY,
        });
      }
      return;
    }
    case 1346: { // rotate
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      // Without a centre there is nothing to rotate about, and guessing one
      // (the group's own bounding box, say) would move the objects somewhere
      // the level never asked for.
      if (group < 0 || !t.centre) return;
      const deg = propFloat(t.props, P.ROTATE_DEGREES, 0)
        + propFloat(t.props, P.ROTATE_TIMES_360, 0) * 360;
      // key 68 is degrees CW, like key 6; the world and the renderer are CCW
      const delta = (-deg * Math.PI) / 180;
      const lockRot = propBool(t.props, P.LOCK_OBJECT_ROTATION);
      const s = groupState(rt, group);
      s.cx = t.centre.x;
      s.cy = t.centre.y;
      s.lockRot = lockRot;
      if (dur <= 0) {
        s.rot += delta;
        return;
      }
      // rotations stack, exactly like moves
      rt.tweens.push({
        kind: "rotate", group, delta, t: 0, dur, ...ease,
        cx: t.centre.x, cy: t.centre.y, lockRot, kPrev: 0,
      });
      return;
    }
    case 1913: { // zoom camera
      const to = propFloat(t.props, 371, 1);
      if (!(to > 0)) return;
      rt.tweens = rt.tweens.filter((w) => w.kind !== "zoom");
      if (dur <= 0) { rt.zoom = to; return; }
      rt.tweens.push({ kind: "zoom", group: -1, from: rt.zoom, to, t: 0, dur, ...ease });
      return;
    }
    case 3010: { // area tint (keys from `EnterEffectObject`: 222 length, 282 deadzone, 260/265 tint, 276 inbound, 66 detail only, 538/71 centre)
      const target = propInt(t.props, P.TARGET_GROUP_ID, 0);
      if (target <= 0) return;
      rt.areaTints = rt.areaTints.filter((a) => a.target !== target);
      rt.areaTints.push({
        target, centerGroup: propInt(t.props, 538, 0) === -1 ? -1 : propInt(t.props, P.SECONDARY_GROUP_ID, 0),
        length: Math.max(1, propFloat(t.props, 222, 0)), deadzone: propFloat(t.props, 282, 0),
        tintCh: propInt(t.props, 260, 0), amount: propFloat(t.props, 265, 0),
        inbound: propBool(t.props, 276), detailOnly: propBool(t.props, 66), t0: rt.time, dur: Math.max(0, dur),
      });
      return;
    }
    case 3608: { // spawn particle (no offset/rotation/scale keys in the 22 levels)
      const group = propInt(t.props, P.TARGET_GROUP_ID, 0);
      if (group > 0) rt.particleSpawns.push({ group, posGroup: propInt(t.props, P.SECONDARY_GROUP_ID, 0), x: t.x, y: t.y });
      return;
    }
    case 2062: { // camera edge
      const dir = propInt(t.props, 164, 0);
      if (dir >= 1 && dir <= 4) rt.camEdges[dir - 1] = Math.max(0, propInt(t.props, P.TARGET_GROUP_ID, 0));
      return;
    }
    case 2999: { // MG: ease the middle ground's y offset to key 29
      const to = propFloat(t.props, 29, 0);
      rt.tweens = rt.tweens.filter((w) => w.kind !== "mgOff");
      if (dur <= 0) rt.mgOffsetY = to;
      else rt.tweens.push({ kind: "mgOff", group: -1, from: rt.mgOffsetY, to, t: 0, dur, ...ease });
      return;
    }
    case 3029: { // change BG
      const bg = propInt(t.props, 533, 0);
      if (bg > 0) rt.bgIndex = bg;
      return;
    }
    case 2899: { // options: only the two control switches are modelled
      const set = (k: number, i: 0 | 1) => {
        const v = propInt(t.props, k, 0);
        if (v !== 0) rt.controlsOff[i] = v === 1;
      };
      set(165, 0); set(199, 1);
      return;
    }
    case 2904: { // shader setup: key 192 resets every screen shader
      // the layer range first (0 or unset → 1 and 15), then the reset
      const zMin = propInt(t.props, 196, 0), zMax = propInt(t.props, 197, 0);
      rt.shaderZ = [Math.max(1, zMin), zMax < 1 ? 15 : zMax];
      if (propBool(t.props, 192)) {
        rt.tweens = rt.tweens.filter((w) => w.kind !== "shader");
        rt.shader = freshShaderState();
      }
      return;
    }
    case 2910: case 2911: case 2905: case 2907: case 2913: case 2914: case 2916: case 2919: case 2920: case 2921: case 2922: case 2923: { // screen shaders
      // (field keys per `triggerShaderCommand` m1 0x10f8e4: 176 strength,
      // 191 outer, 175 speed, 179 wave width, 180/189 target x/y, 188/190/194
      // the use-x/use-y/snap-grid flags, 51 the target id)
      const sh = rt.shader;
      const ease2 = (field: ShaderField, to: number) => {
        rt.tweens = rt.tweens.filter((w) => !(w.kind === "shader" && w.field === field));
        if (dur <= 0) { sh[field] = to; return; }
        rt.tweens.push({ kind: "shader", field, group: -1, from: sh[field], to, t: 0, dur, ...ease });
      };
      const f = (k: number) => propFloat(t.props, k, 0);
      if (t.id === 2910) {
        // key 188 sets x (key 180), key 190 sets y (key 189)
        if (propBool(t.props, 188)) ease2("chromX", f(180));
        if (propBool(t.props, 190)) ease2("chromY", f(189));
      } else if (t.id === 2911) {
        // (case at m1 0x10fb84: enable is key 192 clear; every field defaults
        // to 0 in `ShaderGameObject`, so an "off" twin eases them all down)
        sh.cgOn = !propBool(t.props, 192);
        ease2("cgSpeed", f(175)); ease2("cgSeg", 1 / Math.max(f(189), 0.1));
        ease2("cgStrength", f(176)); ease2("cgHeight", f(179));
        ease2("cgLine", f(191)); ease2("cgRGB", f(180));
      } else if (t.id === 2905) {
        const animate = propBool(t.props, 513);
        if (!animate) {
          sh.swT = 0;
          sh.swInvert = propBool(t.props, 184);
          sh.swTarget = propBool(t.props, 188) ? propInt(t.props, 51, -1) : -1;
        }
        const set = (field: ShaderField, v: number) => {
          if (animate) ease2(field, v);
          else { rt.tweens = rt.tweens.filter((w) => !(w.kind === "shader" && w.field === field)); sh[field] = v; }
        };
        set("swSpeed", f(175)); set("swThick", f(180)); set("swStrength", f(176)); set("swWave", f(179));
        set("swFadeIn", f(181)); set("swFadeOut", f(182)); set("swInner", 0); set("swOuter", f(191));
        set("swMax", 0); set("swTimeOff", f(177)); set("swOffX", f(290)); set("swOffY", f(291));
      } else if (t.id === 2907) {
        // a non-animated (key 513) trigger restarts the line and sets its
        // fields at once; an animated one keeps the clock and eases them
        const animate = propBool(t.props, 513);
        if (!animate) {
          sh.slT = 0;
          sh.slAxis = propBool(t.props, 186); sh.slFlip = propBool(t.props, 185);
          sh.slDual = propBool(t.props, 187); sh.slInvert = propBool(t.props, 184);
        }
        const set = (field: ShaderField, v: number) => {
          if (animate) ease2(field, v);
          else { rt.tweens = rt.tweens.filter((w) => !(w.kind === "shader" && w.field === field)); sh[field] = v; }
        };
        set("slSpeed", f(175)); set("slThick", f(180)); set("slStrength", f(176)); set("slWave", f(179));
        set("slFadeIn", f(181)); set("slFadeOut", f(182)); set("slCenter", f(177)); set("slOffset", f(290));
        set("slMax", f(183));
      } else if (t.id === 2916) {
        ease2("bulge", f(176)); ease2("bulgeRadius", f(180));
      } else if (t.id === 2914) {
        sh.rbEmpty = propBool(t.props, 515);   // only-empty (+0x76a)
        ease2("rbSize", f(179)); ease2("rbFade", f(181));
      } else if (t.id === 2913) {
        rt.shader.lensTarget = propBool(t.props, 138) ? -1 : propInt(t.props, 51, 0);
        rt.shader.lensTint = propInt(t.props, 71, 0);
        ease2("lensStrength", f(176)); ease2("lensFade", f(181)); ease2("lensSize", f(179));
        ease2("lensOffX", f(290)); ease2("lensOffY", f(291));
      } else if (t.id === 2919) {
        sh.grayLum = propBool(t.props, 188);
        const tint = propBool(t.props, 190) ? propInt(t.props, 51, -1) : -1;
        if (tint >= 0) sh.grayTint = tint;
        ease2("gray", f(176));
      } else if (t.id === 2920) {
        ease2("sepia", f(176));
      } else if (t.id === 2921) {
        if (propBool(t.props, 188)) {
          sh.invClamp = propBool(t.props, 194);
          if (propBool(t.props, 190)) { ease2("invR", f(179)); ease2("invG", f(180)); ease2("invB", f(189)); }
          else { sh.invR = f(179); sh.invG = f(180); sh.invB = f(189); }
        }
        ease2("invert", f(176));
      } else if (t.id === 2922) {
        ease2("hue", f(176));
      } else {
        ease2("cr", f(176)); ease2("cg", f(191)); ease2("cb", f(175));
        ease2("br", f(179)); ease2("bg", f(180)); ease2("bb", f(189));
      }
      return;
    }
    case 2903: { // gradient
      if (propBool(t.props, 508)) { rt.gradients.clear(); return; }
      const id = propInt(t.props, 209, 0);
      if (propBool(t.props, 208)) { rt.gradients.delete(id); return; }
      rt.gradients.set(id, t.props);
      return;
    }
    case 1916: { // camera offset: key 101 is the axis (0 both, 1 x only, 2 y only)
      const axis = propInt(t.props, 101, 0);
      const set = (kind: "camOffX" | "camOffY", to: number) => {
        rt.tweens = rt.tweens.filter((w) => w.kind !== kind);
        const k = kind === "camOffX" ? "x" : "y";
        if (dur <= 0) { rt.camOffset[k] = to; return; }
        rt.tweens.push({ kind, group: -1, from: rt.camOffset[k], to, t: 0, dur, ...ease });
      };
      if (axis !== 2) set("camOffX", propFloat(t.props, 28, 0));
      if (axis !== 1) set("camOffY", propFloat(t.props, 29, 0));
      return;
    }
    case 2015: { // camera rotate: key 68 degrees, 70 add, 394 "convert" (wrap to ±180)
      const deg = propFloat(t.props, 68, 0);
      let target = propBool(t.props, 70) ? rt.camAngleTarget + deg : deg;
      rt.camAngleTarget = target;
      if (propBool(t.props, 394)) {
        const wrap = (v: number) => {
          const n = Math.ceil(Math.floor(Math.abs(v) / 180) * 0.5);
          return v < -180 ? v + 360 * n : v > 180 ? v - 360 * n : v;
        };
        rt.camAngle = wrap(rt.camAngle);
        target = rt.camAngleTarget = wrap(target);
      }
      rt.tweens = rt.tweens.filter((w) => w.kind !== "camRot");
      // an instant rotation takes the argument itself, not the added target
      // (`str s10, [x19, #0x324]` at +0x1b0 — s10 is still the argument)
      if (dur <= 0) { rt.camAngle = deg; return; }
      rt.tweens.push({ kind: "camRot", group: -1, from: rt.camAngle, to: target, t: 0, dur, ...ease });
      return;
    }
    case 2067: { // scale
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      let fx = propFloat(t.props, P.SCALE_X_BY, 1);
      let fy = propFloat(t.props, P.SCALE_Y_BY, 1);
      if (!(fx > 0) || !(fy > 0)) return;
      // "divide by" undoes an earlier scale by the same factor
      if (propBool(t.props, P.SCALE_DIV_X)) fx = 1 / fx;
      if (propBool(t.props, P.SCALE_DIV_Y)) fy = 1 / fy;
      const s = groupState(rt, group);
      if (t.centre) { s.scx = t.centre.x; s.scy = t.centre.y; s.scaleOwn = false; } else s.scaleOwn = true;
      if (dur <= 0) { s.sx *= fx; s.sy *= fy; return; }
      rt.tweens.push({ kind: "scale", group, fx, fy, t: 0, dur, ...ease, kPrev: 0 });
      return;
    }
    case 1007: { // alpha
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      const s = groupState(rt, group);
      const to = propFloat(t.props, P.OPACITY, 1);
      if (dur <= 0) {
        s.alpha = to;
      } else {
        rt.tweens = rt.tweens.filter((w) => !(w.kind === "alpha" && w.group === group));
        rt.tweens.push({ kind: "alpha", group, from: s.alpha, to, t: 0, dur, ...ease });
      }
      return;
    }
    case 1049: { // toggle
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      groupState(rt, group).enabled = propBool(t.props, P.ACTIVATE_GROUP);
      return;
    }
    case 1268: { // spawn: activate the target group's spawn-triggered triggers
      const group = propInt(t.props, P.TARGET_GROUP_ID, -1);
      if (group < 0) return;
      const delay = propFloat(t.props, P.SPAWN_DELAY, 0);
      rt.pending.push({
        at: rt.time + delay, group,
        src: t.groups.length ? t.groups : undefined,
        delayed: delay > 0 || undefined,
        remap: spawnRemap(t.props),
        ordered: propBool(t.props, P.SPAWN_ORDERED) || undefined,
      });
      return;
    }
  }
}

/**
 * A spawn trigger's **group remap** (key 442, "from.to.from.to"): the
 * triggers it spawns act on `to` wherever they name `from`. Dash reuses one
 * spawned move/pulse pair (targets 100 and 101) for every platform: the spawn
 * at (7785, 857) remaps 100 -> 494 and 101 -> 495, and the native run at f6250
 * rides group 494 down the move's -12 ease-out — without the remap the platform
 * never moves and the player is left on air.
 */
function spawnRemap(props: Map<number, string>): ReadonlyMap<number, number> | undefined {
  const raw = props.get(P.SPAWN_REMAP);
  if (!raw) return undefined;
  const v = raw.split(".").map((n) => parseInt(n, 10));
  const m = new Map<number, number>();
  for (let i = 0; i + 1 < v.length; i += 2) if (!isNaN(v[i]) && !isNaN(v[i + 1])) m.set(v[i], v[i + 1]);
  return m.size ? m : undefined;
}

/** `t` with its target groups passed through a spawn remap */
function remapped(t: Trigger, remap: ReadonlyMap<number, number>): Trigger {
  let props: Map<number, string> | null = null;
  for (const key of [P.TARGET_GROUP_ID, P.SECONDARY_GROUP_ID]) {
    const g = propInt(t.props, key, -1);
    const to = remap.get(g);
    if (to === undefined) continue;
    props ??= new Map(t.props);
    props.set(key, String(to));
  }
  return props ? { ...t, props } : t;
}

/**
 * Fire every touch trigger (key 11) the player's box is inside.
 *
 * `GJBaseGameLayer::playerTouchedTrigger` (m1 `0x1009c8`) is reached from
 * `collisionCheckObjects` +1508 when the player's rect overlaps a trigger
 * object whose `m_isTouchTriggered` is set, and it keeps a (player, object)
 * pair list so one touch fires it once.
 *
 * APPROXIMATION: the re-arm. This port re-arms a **multi trigger** (key 87)
 * when the player leaves it and never re-arms any other; the original's
 * `canBeActivatedByPlayer` (`0x1000cc`) keeps a std::map keyed by that pair
 * with a stored value that was not decoded.
 */
export function fireTouchTriggers(
  rt: TriggerRuntime, triggers: Trigger[],
  box: { x: number; y: number; hw: number; hh: number },
) {
  // Only the touch triggers, in x order, so this step costs a binary search
  // and a couple of comparisons rather than a scan of every trigger — it runs
  // 240x a second per autopilot clone.
  const list = touchList(triggers);
  if (!list.length) return;
  let lo = 0, hi = list.length;
  const left = box.x - box.hw - TOUCH_MAX_HW;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].x < left) lo = mid + 1; else hi = mid;
  }
  for (let i = lo; i < list.length; i++) {
    const t = list[i];
    if (t.x - t.hw > box.x + box.hw) break; // sorted by x
    if (t.x + t.hw < box.x - box.hw) continue;
    if (Math.abs(t.y - box.y) > t.hh + box.hh) continue;
    if (rt.touched.has(t.index)) continue;
    rt.touched.add(t.index);
    fire(rt, t, box.x, box.y);
  }
  // a multi trigger re-arms once the player is off it; the set is tiny, so
  // this is cheaper than widening the scan
  for (const i of rt.touched) {
    const t = triggers[i];
    if (!t?.multi) continue;
    const on = Math.abs(t.x - box.x) <= t.hw + box.hw
      && Math.abs(t.y - box.y) <= t.hh + box.hh;
    if (!on) rt.touched.delete(i);
  }
}

/** the widest trigger box in any of the 22 levels is one block */
const TOUCH_MAX_HW = 60;
/** the touch triggers of a list, cached on the list itself */
const touchLists = new WeakMap<Trigger[], Trigger[]>();
function touchList(triggers: Trigger[]): Trigger[] {
  let l = touchLists.get(triggers);
  if (!l) touchLists.set(triggers, (l = triggers.filter((t) => t.touch)));
  return l;
}

/**
 * Advance the runtime. `triggers` must be the sorted list from
 * `buildTriggers`; everything at or behind `playerX` that has not fired yet
 * fires now.
 */
/** has the player passed (x, y) in the direction of travel `dir`? */
function passed(dir: number, x: number, y: number, px: number, py: number): boolean {
  switch (dir) {
    case 1: return y <= py;
    case 2: return y >= py;
    case 3: return x >= px;
    default: return x <= px;
  }
}

/** position triggers per channel, in x order, built once per trigger list */
const byChannel = new WeakMap<Trigger[], Map<number, Trigger[]>>();
function channelList(triggers: Trigger[], channel: number): Trigger[] {
  let m = byChannel.get(triggers);
  if (!m) {
    m = new Map();
    for (const t of triggers) {
      if (t.spawnTriggered || t.touch) continue;
      let l = m.get(t.channel);
      if (!l) m.set(t.channel, (l = []));
      l.push(t);
    }
    byChannel.set(triggers, m);
  }
  return m.get(channel) ?? [];
}

/**
 * Fire the position triggers the player has passed.
 *
 * **Only the active channel's triggers fire, and "passed" follows the direction
 * of travel** — Dash, native: the Rotate Gameplay trigger at (2265, 226) turns
 * the player downward and makes channel 1 active; channel 0's triggers then
 * wait, and the one channel-1 trigger at (2143.5, 135) fires the frame the
 * descending player's y reaches 135 (f1816, 134.32) — 89 units from it in y,
 * so neither an x test nor a touch could have fired it.
 *
 * The plain case (channel 0, travelling right) keeps the x-sorted sweep; any
 * other is a scan of the active channel's unfired triggers.
 */
/**
 * A trigger in a toggled-off group is disabled like any other object in it and
 * does not fire as the player passes (the sweep moves on, so it stays unfired).
 * Deadlocked: the toggle at x=14925 that removes group 85's slab sits in group
 * 84, switched off at x=6465 and back on only by a touch trigger the real run
 * never touches — natively the slab is still there at x=15705 (f10608).
 */
function inDisabledGroup(rt: TriggerRuntime, t: Trigger): boolean {
  for (const g of t.groups) if (!groupState(rt, g).enabled) return true;
  return false;
}

function firePassed(rt: TriggerRuntime, triggers: Trigger[], playerX: number, playerY: number) {
  if (rt.channel === 0 && rt.dir === 4) {
    while (rt.next < triggers.length && triggers[rt.next].x <= playerX) {
      const t = triggers[rt.next++];
      // A touch trigger is not fired by being passed — `playerTouchedTrigger`
      // (m1 `0x1009c8`) fires it from the collision pass instead, which the sim
      // drives through `fireTouchTriggers`.
      if (t.spawnTriggered || t.touch || t.channel !== 0 || rt.fired.has(t.index)) continue;
      if (inDisabledGroup(rt, t)) continue;
      fire(rt, t, playerX, playerY);
      // a Rotate Gameplay trigger may have turned the player: stop sweeping
      if (rt.channel !== 0 || rt.dir !== 4) break;
    }
    return;
  }
  for (const t of channelList(triggers, rt.channel)) {
    if (rt.fired.has(t.index)) continue;
    // channel 0's sweep already fired everything before its cursor
    if (t.channel === 0 && t.index < rt.next) continue;
    if (!passed(rt.dir, t.x, t.y, playerX, playerY)) continue;
    rt.fired.add(t.index);
    if (inDisabledGroup(rt, t)) continue;
    const ch = rt.channel, dir = rt.dir;
    fire(rt, t, playerX, playerY);
    if (rt.channel !== ch || rt.dir !== dir) break;
  }
}

export function updateTriggers(
  rt: TriggerRuntime, triggers: Trigger[], playerX: number, dt: number, playerY = 0,
) {
  rt.time += dt;
  // the chromatic glitch's own clock (`preChromaticGlitchShader` m1 0x34ff24, kept under 1000)
  if (rt.shader.cgOn && rt.shader.cgSpeed !== 0) rt.shader.cgTime = (rt.shader.cgTime + dt * rt.shader.cgSpeed) % 1000;
  // the shock line's clock (`preShockLineShader` m1 0x34f3b8)
  if (rt.shader.slStrength > 0) rt.shader.slT += dt * rt.shader.slSpeed;
  // the shock wave's (`preShockWaveShader` m1 0x34ee64)
  if (rt.shader.swStrength > 0) rt.shader.swT += dt * rt.shader.swSpeed;
  if (rt.cameraStatic) rt.cameraStatic.t += dt;
  if (rt.viewStatic) rt.viewStatic.t += dt;

  // pulses in flight age; a finished one stops overlaying its target
  if (rt.pulses.length) {
    for (const p of rt.pulses) p.t += dt;
    rt.pulses = rt.pulses.filter((p) => p.t <= pulseDuration(p));
  }

  // a shake in flight runs down; the scene reads `strength` while it lasts
  if (rt.shake.remaining > 0) {
    rt.shake.remaining -= dt;
    if (rt.shake.remaining <= 0) {
      rt.shake.remaining = 0;
      rt.shake.strength = 0;
    }
  }

  firePassed(rt, triggers, playerX, playerY);

  // spawn-trigger payloads that have come due
  for (let i = rt.pending.length - 1; i >= 0; i--) {
    if (rt.pending[i].at > rt.time) continue;
    const { group, delayed, remap, only, ordered, src } = rt.pending[i];
    rt.pending.splice(i, 1);
    const before = rt.tweens.length;
    if (only) {
      fire(rt, remap ? remapped(only, remap) : only, playerX, playerY);
    } else if (ordered) {
      // **Spawn Ordered** (key 441, `spawnObjectsInOrder` m1 0x104c54): the
      // group's triggers in x order — the first now, each later one
      // (x − first x) / 311.58 s after it (the constant is the 1x speed in
      // units a second, whatever the level's speed). Dash x 13305: the toggle
      // orb's sepia flash and the trigger 150 units on that ends it, 0.48 s
      // apart in the 2.2 playthrough (45 %); fired together, the end cancelled it.
      const members = triggers.filter((t) => t.spawnTriggered && t.groups.includes(group))
        .sort((a, b) => a.x - b.x);
      const x0 = members.length ? members[0].x : 0;
      for (const t of members) {
        const wait = (t.x - x0) / 311.58;
        if (wait > 0) rt.pending.push({ at: rt.time + wait, group, src, delayed: true, remap, only: t });
        else fire(rt, remap ? remapped(t, remap) : t, playerX, playerY);
      }
    } else {
      for (const t of triggers) {
        if (t.spawnTriggered && t.groups.includes(group)) fire(rt, remap ? remapped(t, remap) : t, playerX, playerY);
      }
    }
    // **A spawn that waited out a delay starts its actions at once**, unlike
    // everything else (see the `started` note below): Dash f3062, group 233's
    // descent — spawned 0.211 s after its rise — moves on the very frame it is
    // due in the native run, while the rise (a zero-delay spawn from a touch
    // trigger) moves a step late, like every position-triggered move.
    if (delayed) for (let k = before; k < rt.tweens.length; k++) rt.tweens[k].started = true;
  }

  for (let i = rt.tweens.length - 1; i >= 0; i--) {
    const w = rt.tweens[i];
    // **An action starts moving on the step after the one that fired it**:
    // Geometrical Dominator f5813, a ship lands on a platform that group 11's
    // move is lowering and is carried down exactly one step behind where the
    // port's same-step start had it (the carry is `carryOnGround` in sim.ts).
    // With the carry in, this took resync faults 84 -> 83; without it the
    // lag alone looked a fault worse, which is why it was once rejected.
    if (!w.started) { w.started = true; continue; }
    w.t += dt;
    // Completion is decided by TIME, and the last step uses k = 1 exactly.
    //
    // Testing the *eased* value instead is wrong in both directions: elastic
    // and back curves cross above 1 partway through — that overshoot is the
    // whole point of them — and would end the move early, frozen mid-overshoot;
    // while ExponentialInOut tops out at 1 - 2^-11 and so would never end at
    // all, leaving the group 0.05% short and the tween running forever.
    const done = w.t >= w.dur;
    const k = done ? 1 : easedValue(w.t / w.dur, w.ease, w.rate);
    if (w.kind === "color") {
      const c = colorState(rt, w.ch);
      c.r = w.from.r + (w.to.r - w.from.r) * k;
      c.g = w.from.g + (w.to.g - w.from.g) * k;
      c.b = w.from.b + (w.to.b - w.from.b) * k;
      c.opacity = w.from.opacity + (w.to.opacity - w.from.opacity) * k;
      if (done) c.blending = w.to.blending;
    } else if (w.kind === "move") {
      const s = groupState(rt, w.group);
      // Each move contributes an *increment*, so two running on one group both
      // apply — the original stacks its move actions, and Geometrical Dominator
      // spawns exactly such a pair (a rise plus a lock-to-player) on group 96.
      // Whatever a lock accumulated stays put once the move ends.
      s.dx += (k - w.kPrev) * (w.toX - w.fromX) + (w.lockX ? playerX - w.lastX : 0);
      s.dy += (k - w.kPrev) * (w.toY - w.fromY) + (w.lockY ? playerY - w.lastY : 0);
      w.kPrev = k;
      w.lastX = playerX;
      w.lastY = playerY;
    } else if (w.kind === "zoom") {
      rt.zoom = w.from + (w.to - w.from) * k;
    } else if (w.kind === "shader") {
      rt.shader[w.field] = w.from + (w.to - w.from) * k;
    } else if (w.kind === "mgOff") {
      rt.mgOffsetY = w.from + (w.to - w.from) * k;
    } else if (w.kind === "camOffX") {
      rt.camOffset.x = w.from + (w.to - w.from) * k;
    } else if (w.kind === "camOffY") {
      rt.camOffset.y = w.from + (w.to - w.from) * k;
    } else if (w.kind === "camRot") {
      rt.camAngle = w.from + (w.to - w.from) * k;
    } else if (w.kind === "scale") {
      // factors compound: the group is at 1 + (f-1)·k of its start
      const s = groupState(rt, w.group);
      const m = (f: number, q: number) => 1 + (f - 1) * q;
      s.sx *= m(w.fx, k) / m(w.fx, w.kPrev);
      s.sy *= m(w.fy, k) / m(w.fy, w.kPrev);
      w.kPrev = k;
    } else if (w.kind === "rotate") {
      const s = groupState(rt, w.group);
      s.rot += (k - w.kPrev) * w.delta;
      s.cx = w.cx;
      s.cy = w.cy;
      s.lockRot = w.lockRot;
      w.kPrev = k;
    } else {
      groupState(rt, w.group).alpha = w.from + (w.to - w.from) * k;
    }
    if (done) rt.tweens.splice(i, 1);
  }
}
