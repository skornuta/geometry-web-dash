// GD level-object property keys (from gd.docs level-object.md — captured 2026-08).
// Use these instead of magic numbers when reading LevelObject.props.
export const P = {
  ID: 1,
  X: 2,
  Y: 3,
  FLIP_X: 4,
  FLIP_Y: 5,
  ROTATION: 6,        // degrees, CW positive, top = 0
  RED: 7,             // trigger color
  GREEN: 8,
  BLUE: 9,
  DURATION: 10,
  TOUCH_TRIGGERED: 11,
  SECRET_COIN_ID: 12,
  SPECIAL_CHECKED: 13, // gamemode/speed/dual portal "checked" state
  TINT_GROUND: 14,
  PLAYER_COLOR_1: 15,
  PLAYER_COLOR_2: 16,
  BLENDING: 17,
  LEGACY_19_CHANNEL: 19,
  EDITOR_LAYER_1: 20,
  MAIN_COLOR: 21,
  SECONDARY_COLOR: 22,
  TARGET_COLOR_ID: 23,
  Z_LAYER: 24,
  Z_ORDER: 25,
  MOVE_OFFSET_X: 28,
  MOVE_OFFSET_Y: 29,
  EASING: 30,
  TEXT: 31,           // base64
  SCALE: 32,
  SINGLE_GROUP_ID: 33,
  GROUP_PARENT: 34,
  OPACITY: 35,
  MAIN_HSV_ENABLED: 41,
  SECONDARY_HSV_ENABLED: 42,
  MAIN_HSV: 43,
  SECONDARY_HSV: 44,
  PULSE_FADE_IN: 45,
  PULSE_HOLD: 46,
  PULSE_FADE_OUT: 47,
  PULSE_MODE: 48,
  COPIED_COLOR_HSV: 49,
  COPIED_COLOR_ID: 50,
  TARGET_GROUP_ID: 51,
  PULSE_TARGET_TYPE: 52,
  TELEPORT_Y_OFFSET: 54,
  TELEPORT_SMOOTH_EASE: 55,
  /** TeleportPortalObject (Geode 2.2081): m_staticForceEnabled / m_staticForce */
  TELEPORT_STATIC_FORCE: 345,
  TELEPORT_FORCE: 346,
  /** m_ignoreX / m_ignoreY: keep the player's own coordinate on that axis */
  TELEPORT_IGNORE_X: 352,
  TELEPORT_IGNORE_Y: 353,
  /** m_gravityMode: 1 normal, 2 flipped, 3 toggle */
  TELEPORT_GRAVITY: 354,
  TELEPORT_FORCE_ADDITIVE: 443,
  ACTIVATE_GROUP: 56,
  GROUP_IDS: 57,      // "." separated
  LOCK_TO_PLAYER_X: 58,
  LOCK_TO_PLAYER_Y: 59,
  COPY_OPACITY: 60,
  EDITOR_LAYER_2: 61,
  SPAWN_TRIGGERED: 62,
  SPAWN_DELAY: 63,
  /** spawn trigger: fire the group's triggers in x order, spaced by distance (`m_spawnOrdered`) */
  SPAWN_ORDERED: 441,
  DONT_FADE: 64,
  PULSE_MAIN_ONLY: 65,
  PULSE_DETAIL_ONLY: 66,
  DONT_ENTER: 67,
  ROTATE_DEGREES: 68,
  ROTATE_TIMES_360: 69,
  LOCK_OBJECT_ROTATION: 70,
  SECONDARY_GROUP_ID: 71,
  /** Scale trigger (2067): factors, and "divide by" (undo) flags */
  SCALE_X_BY: 150,
  SCALE_Y_BY: 151,
  SCALE_DIV_X: 153,
  SCALE_DIV_Y: 154,
  FOLLOW_X_MOD: 72,
  FOLLOW_Y_MOD: 73,
  SHAKE_STRENGTH: 75,
  ANIMATION_ID: 76,
  COUNT: 77,
  SUBTRACT_COUNT: 78,
  PICKUP_MODE: 79,
  ITEM_ID: 80,
  HOLD_MODE: 81,
  TOGGLE_MODE: 82,
  SHAKE_INTERVAL: 84,
  EASING_RATE: 85,
  PULSE_EXCLUSIVE: 86,
  MULTI_TRIGGER: 87,
  INSTANT_COUNT_COMPARISON: 88,
  DUAL_MODE: 89,
  FOLLOW_PLAYER_Y_SPEED: 90,
  FOLLOW_PLAYER_Y_DELAY: 91,
  FOLLOW_PLAYER_Y_OFFSET: 92,
  TRIGGER_ON_EXIT: 93,
  DYNAMIC_BLOCK: 94,
  BLOCK_B_ID: 95,
  DISABLE_GLOW: 96,
  CUSTOM_ROTATION_SPEED: 97,
  DISABLE_ROTATION: 98,
  MULTI_ACTIVATE_ORB: 99,
  /** `m_isNoTouch`: drawn, but the player never collides with it */
  NO_TOUCH: 121,
  /** `m_isPassable` (Geode 2.2081): a solid the player goes through */
  PASSABLE: 134,
  /** Rotate Gameplay (2900), per `RotateGameplayGameObject`'s property notes */
  ROTATE_GROUND_DIR: 166,
  ROTATE_MOVE_DIR: 167,
  ROTATE_EDIT_VELOCITY: 169,
  ROTATE_VELOCITY_MOD_Y: 583,
  ROTATE_OVERRIDE_VELOCITY: 584,
  ROTATE_CHANGE_CHANNEL: 171,
  ROTATE_CHANNEL_ONLY: 172,
  ROTATE_TARGET_CHANNEL: 173,
  /** Time Warp (1935): the clock rate */
  TIME_WARP: 120,
  /** Camera Static (1914): axis (0 both, 1 x, 2 y) and exit */
  CAMERA_AXIS: 101,
  CAMERA_EXIT_STATIC: 110,
  /** spawn trigger's group remap, "from.to.from.to" */
  SPAWN_REMAP: 442,
  /** key 170, a trigger's channel (`m_channelValue`) */
  TRIGGER_CHANNEL: 170,
  /** move trigger: put key 395's group centre on key 71's (`m_useMoveTarget`) */
  MOVE_USE_TARGET: 100,
  /** move trigger: 0 both axes, 1 x only, 2 y only (`m_moveTargetMode`) */
  MOVE_TARGET_MODE: 101,
  /** move trigger: the group whose centre is put on the target (`m_targetModCenterID`) */
  MOVE_TARGET_CENTER: 395,
  SPAWN_EDITOR_DISABLE: 102,
  HIGH_DETAIL: 103,
  MULTI_ACTIVATE_TRIGGER: 104,
  FOLLOW_PLAYER_Y_MAX_SPEED: 105,
  RANDOMIZE_START: 106,
  ANIMATION_SPEED: 107,
  /** animated object: use key 107 as the frame-time divisor (`m_animationShouldUseSpeed`) */
  ANIMATION_USE_SPEED: 122,
  /** animated object: hold the first frame until an animate trigger (1585) fires */
  ANIMATE_ON_TRIGGER: 123,
  LINKED_GROUP_ID: 108,
  /** pickup trigger: replace the item's value instead of adding (`m_isOverride`) */
  PICKUP_OVERRIDE: 139,
  /** pickup trigger: the multiply/divide operand (`m_pickupTriggerMultiplier`) */
  PICKUP_MULTIPLIER: 449,
  /** custom ring: spawn the target group rather than toggling it (`m_isSpawnOnly`) */
  RING_SPAWN_ONLY: 504,
  /** stop trigger: which trigger group it addresses is a control id, not a group */
  STOP_USE_CONTROL_ID: 535,
  /** stop trigger: `GJActionCommand` — 0 stop, 1 pause, 2 resume (`m_customTriggerValue`) */
  STOP_COMMAND: 580,
} as const;

// Level-start header keys (inner-level-string.md): kA1 audio track, kA2 gamemode,
// kA3 mini, kA4 speed, kA6 bg texture, kA7 ground texture, kA8 dual, kA11 flip gravity,
// kA13 song offset, kA17 ground line, kA18 font, kS29-37 legacy colors, kS38 2.x colors.

// helpers
export function propInt(props: Map<number, string>, key: number, def = 0): number {
  const v = props.get(key);
  return v === undefined ? def : parseInt(v, 10);
}
export function propFloat(props: Map<number, string>, key: number, def = 0): number {
  const v = props.get(key);
  return v === undefined ? def : parseFloat(v);
}
export function propBool(props: Map<number, string>, key: number): boolean {
  return props.get(key) === "1";
}

/**
 * Decode a base64 property (only `P.TEXT` today) to a string.
 *
 * The level string is **URL-safe base64** — `-`/`_` for `+`/`/` — because the
 * whole level is transported that way, and padding is often stripped. Both are
 * restored here before decoding. Runs in the browser (`atob`) and in node
 * (`Buffer`), because the object table is exercised by headless tests too.
 *
 * Returns "" for absent or undecodable values: a level must never fail to load
 * over one malformed text object.
 */
export function propText(props: Map<number, string>, key: number): string {
  const raw = props.get(key);
  if (!raw) return "";
  let b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  if (b64.length % 4) b64 += "=".repeat(4 - (b64.length % 4));
  try {
    // atob yields one byte per char; re-read those bytes as UTF-8 so a level
    // with non-ASCII text does not turn into mojibake. Global in browsers and
    // in node since 16, so no node-only branch is needed here.
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}
