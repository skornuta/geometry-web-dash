/**
 * M7 — the icon kit: which icons exist, what their sprite layers are called,
 * and the player colour palette.
 *
 * **Sourcing.**
 * - **Frame names and per-gamemode counts are measured** from the 2.2
 *   per-icon sheets in `Resources/icons/` (copied to `public/assets/icons/`,
 *   loaded on demand by `iconSheets.ts`), not guessed.
 * - **The colour palette is all 107 of the game's colours**, decoded from
 *   `GameManager::colorForIdx` (see `PLAYER_COLORS`). An earlier version of
 *   this comment said it stopped at 41; it no longer does.
 *
 * **Layer structure per gamemode**, which is what `iconFrames` encodes:
 * every icon has a `main` layer (tinted with colour 1) and a `_2_` detail layer
 * (tinted with colour 2). On top of that:
 * - **UFO** adds a `_3_` layer — the dome — drawn untinted.
 * - **Robot and spider** are built from **four numbered body parts**.
 * - **Every icon ships a `_glow_001` frame** in its per-icon sheet (e.g.
 *   `player_01_glow_001.png`), not only the robot and spider.
 * - **Spider and swing** add an `_extra_` layer, drawn untinted (white detail).
 */

import type { Gamemode } from "./gamemodes.ts";

/**
 * The player colour palette, as `[r, g, b]` bytes.
 *
 * **SOURCED, all 107 entries.** `GameManager::colorForIdx` (m1 `0x307b08`) is a
 * jump table over 16-bit offsets at `0x1007223fe`; each case returns a packed
 * `r | g<<8 | b<<16` in `w0`, with `w0` pre-loaded with `0x0000ff7d` so a case
 * that only writes the high half still yields `r=125, g=255`. Decoding all 107
 * cases reproduces indices **0-41 byte for byte** against the table this file
 * used to stop at, so extending it cannot change the meaning of any saved
 * colour — it only makes the rest of the garage's palette reachable.
 *
 * Index 0 is the default green the game starts you on; 3 is the default
 * secondary (white-ish cyan).
 */
export const PLAYER_COLORS: readonly (readonly [number, number, number])[] = [
  [125, 255, 0], [0, 255, 0], [0, 255, 125], [0, 255, 255],
  [0, 125, 255], [0, 0, 255], [125, 0, 255], [255, 0, 255],
  [255, 0, 125], [255, 0, 0], [255, 125, 0], [255, 255, 0],
  [255, 255, 255], [185, 0, 255], [255, 185, 0], [0, 0, 0],
  [0, 200, 255], [175, 175, 175], [90, 90, 90], [255, 125, 125],
  [0, 175, 75], [0, 125, 125], [0, 75, 175], [75, 0, 175],
  [125, 0, 125], [175, 0, 75], [175, 75, 0], [125, 125, 0],
  [75, 175, 0], [255, 75, 0], [150, 50, 0], [150, 100, 0],
  [100, 150, 0], [0, 150, 100], [0, 100, 150], [100, 0, 150],
  [150, 0, 100], [150, 0, 0], [0, 150, 0], [0, 0, 150],
  [125, 255, 175], [125, 125, 255], [255, 250, 127], [250, 127, 255],
  [0, 255, 192], [80, 50, 14], [205, 165, 118], [182, 128, 255],
  [255, 58, 58], [77, 77, 143], [0, 10, 76], [253, 212, 206],
  [190, 181, 255], [112, 0, 0], [82, 2, 0], [56, 1, 6],
  [128, 79, 79], [122, 53, 53], [81, 36, 36], [163, 98, 70],
  [117, 73, 54], [86, 53, 40], [255, 185, 114], [255, 160, 64],
  [102, 49, 30], [91, 39, 0], [71, 32, 0], [167, 123, 77],
  [109, 83, 57], [81, 62, 42], [255, 255, 192], [253, 224, 160],
  [192, 255, 160], [177, 255, 109], [192, 255, 224], [148, 255, 228],
  [67, 161, 138], [49, 109, 95], [38, 84, 73], [0, 96, 0],
  [0, 64, 0], [0, 96, 96], [0, 64, 64], [160, 255, 255],
  [1, 7, 112], [0, 73, 109], [0, 50, 76], [0, 38, 56],
  [80, 128, 173], [51, 83, 117], [35, 60, 86], [224, 224, 224],
  [61, 6, 140], [55, 8, 96], [64, 64, 64], [111, 73, 164],
  [84, 54, 127], [66, 42, 99], [252, 181, 255], [175, 87, 175],
  [130, 67, 130], [94, 49, 94], [128, 128, 128], [102, 3, 62],
  [71, 1, 52], [210, 255, 50], [118, 189, 255],
] as const;

/** palette index -> 0..1 rgb, clamped to a real entry */
export function playerColor(idx: number): { r: number; g: number; b: number } {
  const c = PLAYER_COLORS[Math.max(0, Math.min(PLAYER_COLORS.length - 1, idx | 0))];
  return { r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 };
}

/**
 * How many icons each gamemode has: the highest index among the per-icon
 * sheets in the shipped `Resources/icons/` (index 0, where present, is a
 * placeholder, not an icon). **Measured** from the install.
 *
 * These used to be the legacy `GJ_GameSheetIcons` atlas's counts — 248 cubes,
 * 79 ships, one swing — which is only the older half of 2.2's set. A native
 * garage capture showed 14 pages of cubes where the port had 7 (REFERENCE.md
 * §19.5). Icons now load from their own sheets (`iconSheets.ts`).
 */
export const ICON_COUNTS: Record<Gamemode, number> = {
  cube: 485,
  ship: 169,
  ball: 118,
  ufo: 149,
  wave: 96,
  robot: 68,
  spider: 69,
  swing: 43,
};

/** the order the icon kit shows its gamemode tabs in, matching the game */
export const ICON_TABS: Gamemode[] = [
  "cube", "ship", "ball", "ufo", "wave", "robot", "spider", "swing",
];

/** two-digit index as the atlas spells it (`player_01_001.png`) */
const pad = (n: number) => String(n).padStart(2, "0");

/** robot and spider are assembled from four numbered body parts */
export const LIMB_MODES: ReadonlySet<Gamemode> = new Set<Gamemode>(["robot", "spider"]);
export const LIMB_COUNT = 4;

/** the atlas prefix for one icon of a gamemode, e.g. cube 7 -> `player_07` */
function prefixFor(mode: Gamemode, idx: number): string {
  const n = pad(Math.max(1, Math.min(ICON_COUNTS[mode], idx)));
  switch (mode) {
    case "cube": return `player_${n}`;
    case "ship": return `ship_${n}`;
    case "ball": return `player_ball_${n}`;
    case "ufo": return `bird_${n}`;
    case "wave": return `dart_${n}`;
    case "robot": return `robot_${n}`;
    case "spider": return `spider_${n}`;
    case "swing": return `swing_${n}`;
  }
}

export interface IconLayers {
  /** tinted with colour 1 */
  main: string;
  /** tinted with colour 2 */
  detail: string;
  /** untinted white detail, when the icon has one */
  extra?: string;
  /** the UFO's dome, untinted */
  dome?: string;
  /** the icon's own `_glow_001` frame — every icon ships one */
  glow: string;
}

/**
 * Sprite frame names for one icon.
 *
 * `limb` selects the body part for robot/spider (1-4) and is ignored by every
 * other gamemode. Frames are returned by name only — the caller looks them up
 * in the atlas and skips any that are missing, because which optional layers
 * exist varies per icon, not just per gamemode.
 */
export function iconFrames(mode: Gamemode, idx: number, limb = 1): IconLayers {
  const p = prefixFor(mode, idx);
  if (LIMB_MODES.has(mode)) {
    const l = `${p}_${pad(Math.max(1, Math.min(LIMB_COUNT, limb)))}`;
    return {
      main: `${l}_001.png`,
      detail: `${l}_2_001.png`,
      extra: `${l}_extra_001.png`,
      glow: `${l}_glow_001.png`,
    };
  }
  return {
    main: `${p}_001.png`,
    detail: `${p}_2_001.png`,
    extra: `${p}_extra_001.png`,
    dome: mode === "ufo" ? `${p}_3_001.png` : undefined,
    glow: `${p}_glow_001.png`,
  };
}

/**
 * The player glow, as `PlayerObject::updateGlowColor` (m1 `0x38edf0`) sets it.
 *
 * - **Colour** (+892..960): the stored colour at `[0xa25]`, which +28..360
 *   fills with colour 2 — colour 1 when colour 2 is black — through
 *   `strongColor`; that is `particleColors(...).b` in `effects.ts`, passed in
 *   here as `strong`. With both colours black it is white
 *   (`SimplePlayer::updateColors` +140..164 spells that case out). A custom
 *   glow colour (`[0x930]`) replaces it; the port has no custom glow colour.
 * - **Visible** (+120..816): when the kit's glow is on *or* colour 1 is black
 *   (a black icon would otherwise vanish on a dark background).
 * - **Blend and depth** (`PlayerObject::init` +4336): a plain `CCSprite` with
 *   the default blend, at z −1 in the icon's container — behind the icon, not
 *   additive. Robot and spider route the same colour through
 *   `GJRobotSprite::showGlow` / `updateGlowColor`.
 *
 * The garage's `SimplePlayer::updateColors` (m1 `0x2f877c`) applies the same
 * colour and the same rule (`m_hasGlowOutline` or colour 1 black), so the
 * preview goes through here too.
 */
export function playerGlow(
  kitGlow: boolean, col1: readonly [number, number, number],
  strong: readonly [number, number, number],
): { visible: boolean; r: number; g: number; b: number } {
  const isBlack = (c: readonly number[]) => c[0] === 0 && c[1] === 0 && c[2] === 0;
  const c = isBlack(strong) ? [255, 255, 255] : strong;
  return { visible: kitGlow || isBlack(col1), r: c[0] / 255, g: c[1] / 255, b: c[2] / 255 };
}

/** clamp a saved icon index into the range this install actually has */
export function clampIcon(mode: Gamemode, idx: number): number {
  return Math.max(1, Math.min(ICON_COUNTS[mode], Math.floor(idx) || 1));
}
