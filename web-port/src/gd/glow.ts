/**
 * Object glow — the white additive halo behind blocks, spikes, pads and orbs.
 *
 * **SOURCED** from the 2.2081 binary:
 *
 * - **Which ids glow.** `GameObject::addGlow` (m1 `0x4e6870`) switches on the
 *   object id through a byte jump table at `0x72b1f2` (ids 1..1911, plus
 *   3004/3005/3027 after it). 266 ids land on the one case that builds a glow;
 *   every other id gets none. That case swaps `_001.png` for `_glow_001.png`
 *   in the object's **toolbox frame** (`ObjectToolbox::intKeyToFrame`, the name
 *   `createWithKey` builds the object from — `data/toolbox-frames.json`), and
 *   the result is in `GJ_GameSheetGlow`. The table below is that lookup done
 *   once: 265 ids resolve to a glow frame that ships; id 44 has no toolbox
 *   frame at all. Note it is *not* the port's `OBJECT_DEFS` frame — for the
 *   light squares (70, 91, 161, ...) the port draws a different decomposition
 *   whose main frame has no glow sibling.
 * - **What turns it off.** `addGlow` returns early when the object's
 *   `[0x289]` (copied from `GameManager[0x29a]` in `commonSetup`) is set, when
 *   `GameManager[0x376]` is set and the object is not an invisible one
 *   (`[0x430]`), or when `[0x50e]` — key **135** in `objectFromVector` — is set.
 *   Key **96** (`DISABLE_GLOW`) goes to `[0x3fc]`, and `GameObject::setVisible`
 *   +228 shows the glow only when it is clear. Both flags are per object.
 * - **Colour, blend, depth.** `createGlow` makes a white sprite at the
 *   object's position at opacity 255; it goes into the level's glow batch
 *   (`GJ_GameSheetGlow`), which `GJBaseGameLayer::setupLayers` makes additive
 *   and places just below each z layer's object batches. Its opacity follows
 *   the object's (`GameObject::setOpacity` +192..252, times `[0x434]`, which
 *   `commonSetup` +144 sets to 1).
 * - **Tinted glows.** `PlayLayer::updateVisibility` (+152..288) computes one
 *   colour per frame: the live background (channel 1000) through
 *   `transformColor(h 0, s −0.2, v +0.2)`, whose float overload (m1
 *   `0x449868`) sets both absolute flags. It passes that to `setGlowColor`
 *   (vtable 0x5d0) for three kinds of object, and every other glow stays
 *   white:
 *   - `[0x431]` objects (+2272..2312): ids 177-179 (`customSetup` +3876),
 *     1701-1703 (+5660), 1619/1620 (`EnhancedGameObject::customSetup` +1712).
 *     With `[0x432]` set they take channel 1007 raw instead; nothing decoded
 *     so far sets `[0x432]`.
 *   - id 143 (+2044..2072).
 *   - the invisible objects, `[0x430]` = ids 144, 145, 205, 459 (`customSetup`
 *     +5136), at +2316..2348 and in `updateInvisibleBlock`, which also fades
 *     them and their glow with screen position and mixes the tint once the
 *     object is over 0.8 opacity. The port draws invisible objects at full
 *     opacity (no fade), so their glow is the plain tint — APPROXIMATION A15.
 *
 * Not reproduced (Phase 3, FIDELITY.md): slope glow, which
 * `setupCustomSprites` builds through `addNewSlope01Glow`/`02Glow` (A16); the
 * invisible objects' screen-position fade (A15).
 */

import type { HSV } from "./color.ts";

/** the glow batch's atlas */
export const GLOW_SHEET = "GJ_GameSheetGlow-hd";

/** id -> glow frame stem (`<stem>_glow_001.png`), from the toolbox frame */
const GLOW_STEMS = new Map<number, string>([
  [1, "square_01"], [2, "square_02"], [3, "square_03"], [4, "square_04"], [6, "square_06"],
  [7, "square_07"], [8, "spike_01"], [35, "bump_01"], [36, "ring_01"], [39, "spike_02"],
  [40, "plank_01"], [62, "square_b_01"], [65, "square_b_04"], [66, "square_b_05"],
  [67, "gravbump_01"], [68, "square_b_06"], [69, "blockOutline_01"], [70, "lightsquare_01_02"],
  [71, "blockOutline_03"], [72, "blockOutline_06"], [74, "blockOutline_04"],
  [75, "blockOutline_05"], [76, "lightsquare_04_02"], [77, "lightsquare_04_02"],
  [78, "lightsquare_04_02"], [81, "lightsquare_04_02"], [82, "lightsquare_04_sideLine"],
  [83, "square_08"], [84, "gravring_01"], [90, "blockOutline_01"], [91, "lightsquare_01_02"],
  [92, "blockOutline_03"], [95, "blockOutline_04"], [96, "blockOutline_05"], [103, "spike_03"],
  [116, "square_f_01"], [117, "square_f_02"], [118, "square_f_03"], [119, "blockOutline_06"],
  [121, "square_f_06"], [122, "square_f_07"], [140, "bump_03"], [141, "ring_03"],
  [143, "brick_02"], [144, "invis_spike_01"], [145, "invis_spike_03"], [146, "invis_square_01"],
  [147, "invis_plank_01"], [160, "blockOutline_01"], [161, "lightsquare_01_02"],
  [162, "blockOutline_03"], [163, "blockOutline_06"], [165, "blockOutline_04"],
  [166, "blockOutline_05"], [167, "blockOutline_06"], [168, "blockOutline_01"],
  [169, "blockOutline_01"], [170, "square_h_01"], [171, "square_h_02"], [172, "square_h_03"],
  [173, "square_h_04"], [174, "square_h_05"], [175, "square_h_06"], [176, "square_h_07"],
  [177, "iceSpike_01"], [178, "iceSpike_02"], [179, "iceSpike_03"], [183, "blade_b_01"],
  [184, "blade_b_02"], [185, "blade_b_03"], [186, "blade_01"], [187, "blade_02"],
  [188, "blade_03"], [192, "square_h_08"], [194, "square_h_09"], [195, "square_01_small"],
  [196, "plank_01_small"], [197, "square_h_10"], [200, "boost_01"], [201, "boost_02"],
  [202, "boost_03"], [203, "boost_04"], [204, "invis_plank_01_small"], [205, "invis_spike_02"],
  [206, "invis_square_01_small"], [207, "lightsquare_01_01"], [208, "lightsquare_01_02"],
  [209, "lightsquare_01_03"], [210, "lightsquare_01_04"], [212, "lightsquare_01_06"],
  [213, "lightsquare_01_07"], [215, "colorPlank_01"], [216, "colorSpike_01"],
  [217, "colorSpike_02"], [218, "colorSpike_03"], [219, "colorPlank_01_small"],
  [220, "colorSquare_01_small"], [247, "lightsquare_02_01"], [248, "lightsquare_02_02"],
  [249, "lightsquare_02_03"], [250, "lightsquare_02_04"], [252, "lightsquare_02_06"],
  [253, "lightsquare_02_07"], [254, "lightsquare_02_08"], [255, "lightsquare_03_01"],
  [256, "lightsquare_03_02"], [257, "lightsquare_03_03"], [258, "lightsquare_03_04"],
  [260, "lightsquare_03_06"], [261, "lightsquare_03_07"], [263, "lightsquare_04_02"],
  [264, "lightsquare_04_02"], [265, "lightsquare_04_02"], [267, "lightsquare_04_02"],
  [268, "lightsquare_04_sideLine"], [269, "lightsquare_05_01"], [270, "lightsquare_05_02"],
  [271, "lightsquare_05_03"], [272, "lightsquare_05_04"], [274, "lightsquare_05_06"],
  [275, "lightsquare_05_07"], [289, "blockOutline_14"], [291, "blockOutline_15"],
  [294, "blockOutline_14"], [295, "blockOutline_15"], [296, "triangle_b_square_01"],
  [297, "triangle_b_square_02"], [299, "blockOutline_14"], [301, "blockOutline_15"],
  [305, "blockOutline_16"], [307, "blockOutline_17"], [309, "blockOutline_14"],
  [311, "blockOutline_15"], [315, "blockOutline_14"], [317, "blockOutline_15"],
  [321, "blockOutline_14"], [323, "blockOutline_15"], [326, "triangle_h_01"],
  [327, "triangle_h_02"], [328, "triangle_h_square_01"], [329, "triangle_h_square_02"],
  [331, "blockOutline_14"], [333, "blockOutline_15"], [337, "blockOutline_14"],
  [339, "blockOutline_15"], [343, "blockOutline_14"], [345, "blockOutline_15"],
  [349, "blockOutline_16"], [351, "blockOutline_17"], [353, "blockOutline_14"],
  [355, "blockOutline_15"], [369, "plank_01_02"], [370, "plank_01_03"],
  [373, "plank_01_square_01"], [374, "plank_01_square_02"], [392, "spike_04"],
  [397, "darkblade_01"], [398, "darkblade_02"], [399, "darkblade_03"], [458, "colorSpike_04"],
  [459, "invis_spike_04"], [467, "blockOutline_01"], [468, "blockOutline_02"],
  [469, "blockOutline_03"], [470, "blockOutline_04"], [471, "blockOutline_05"],
  [472, "blockOutline_06"], [473, "blockOutline_07"], [474, "blockOutline_08"],
  [475, "blockOutline_09"], [483, "blockOutline_14"], [484, "blockOutline_15"],
  [492, "blockOutline_14"], [493, "blockOutline_15"], [651, "blockOutline_14"],
  [652, "blockOutline_15"], [661, "blockOutline_10"], [662, "blockOutline_11"],
  [663, "blockOutline_12"], [664, "blockOutline_13"], [665, "blockOutline_14"],
  [666, "blockOutline_15"], [673, "invis_triangle_02"], [674, "invis_triangle_04"],
  [675, "blackCogwheel_01"], [676, "blackCogwheel_02"], [677, "blackCogwheel_03"],
  [678, "lightBlade_01"], [679, "lightBlade_02"], [680, "lightBlade_03"], [709, "blockOutline_14"],
  [710, "blockOutline_15"], [711, "blockOutline_14"], [712, "blockOutline_15"],
  [726, "blockOutline_14"], [727, "blockOutline_15"], [728, "blockOutline_14"],
  [729, "blockOutline_15"], [740, "blade_01"], [741, "blade_02"], [742, "blade_03"],
  [1022, "gravJumpRing_01"], [1154, "smallOutline_01"], [1155, "smallOutline_02"],
  [1156, "smallOutline_03"], [1157, "smallOutline_04"], [1158, "smallOutline_05"],
  [1202, "blockOutlineThick_01"], [1203, "blockOutlineThick_02"], [1204, "blockOutlineThick_03"],
  [1205, "blockOutlineThick_04"], [1206, "blockOutlineThick_05"], [1207, "blockOutlineThick_06"],
  [1208, "blockOutlineThick_07"], [1209, "blockOutlineThick_08"], [1210, "blockOutlineThick_03"],
  [1220, "blockOutlineThickb_01"], [1221, "blockOutlineThickb_02"],
  [1222, "blockOutlineThickb_03"], [1223, "blockOutlineThickb_04"],
  [1224, "blockOutlineThickb_05"], [1225, "blockOutlineThickb_06"],
  [1226, "blockOutlineThickb_08"], [1260, "blockOutline_02"], [1261, "blockOutlineOuter1_01"],
  [1262, "blockOutlineThick_01"], [1263, "blockOutlineOuter2_01"], [1264, "blockOutlineThickb_01"],
  [1265, "blockOutlineOuter3_01"], [1330, "dropRing_01"], [1332, "bump_02"], [1333, "ring_02"],
  [1334, "boost_05"], [1338, "blockOutline_14"], [1339, "blockOutline_15"],
  [1340, "invisibleOutline_01"], [1341, "blockOutline_14"], [1342, "blockOutline_15"],
  [1343, "invisibleOutline_b_01"], [1344, "blockOutline_14"], [1345, "blockOutline_15"],
  [1594, "ring_custom_01"], [1619, "spinBlade01"], [1620, "spinBlade02"], [1701, "bladeTrap01"],
  [1702, "bladeTrap02"], [1703, "bladeTrap03"], [1704, "dashRing_01"], [1708, "darkblade_01"],
  [1709, "darkblade_02"], [1710, "darkblade_03"], [1734, "blackCogwheel_01"],
  [1735, "blackCogwheel_02"], [1736, "blackCogwheel_03"], [1751, "dashRing_02"],
  [1903, "plank_01"], [1904, "plank_01_02"], [1905, "plank_01_03"], [1908, "plank_01_square_01"],
  [1909, "plank_01_square_02"], [1910, "square_01_small"], [1911, "plank_01_small"],
  [3004, "spiderRing"], [3005, "spiderBump"], [3027, "teleportRing"],
]);

/** the frame `addGlow` builds for `id`, or null when the id has no glow */
export function glowFrameFor(id: number): string | null {
  const s = GLOW_STEMS.get(id);
  return s ? `${s}_glow_001.png` : null;
}

/** every id with a glow — for tests and the audit */
export const GLOW_IDS: ReadonlySet<number> = new Set(GLOW_STEMS.keys());

/**
 * The **invisible objects** — `GameObject::customSetup` +5136 sets `[0x430]`
 * for exactly these four. `PlayLayer::updateVisibility` hands each of them to
 * `updateInvisibleBlock` every frame instead of drawing it at a fixed opacity:
 * they are nearly transparent around the player and fade in toward the screen
 * edges. See `gd/invisible.ts`.
 */
export const INVISIBLE_IDS: ReadonlySet<number> = new Set([144, 145, 205, 459]);

/** ids whose glow `PlayLayer::updateVisibility` tints instead of leaving white */
export const TINTED_GLOW_IDS: ReadonlySet<number> = new Set([
  177, 178, 179, 1619, 1620, 1701, 1702, 1703, // `[0x431]`
  // ...and the saws: `EnhancedGameObject::customSetup` (m1 0x4fb368) sets
  // `[0x431]` on its common path (0x4fbfac) — found by running it for every
  // id under the emulator (2026-09-29); the native Hexagon Force 75% sprite
  // dump shows saw 186's glow at (151, 39, 197), the background tint, where
  // every block's is white (88, 89, 98 and 1705-1707 have the flag too but no
  // glow art)
  183, 184, 185, 186, 187, 188, 397, 398, 399, 675, 676, 677,
  1708, 1709, 1710, 1734, 1735, 1736,
  143,
  ...INVISIBLE_IDS,
]);

/** the transform `updateVisibility` applies to channel 1000 for the tint */
export const CUSTOM_GLOW_HSV: HSV = { h: 0, s: -0.2, v: 0.2, sAbsolute: true, vAbsolute: true };

/** level keys that switch one object's glow off */
/** (key 135 is the object's Hide — `m_isHide` — which also keeps it from being drawn at all; see `emitObject`) */
export const GLOW_OFF_KEYS = { DISABLE_GLOW: 96, NO_GLOW_135: 135 } as const;
