/**
 * `PauseLayer` — the in-level pause menu — reproduced from the shipping 2.2081
 * binary (`customSetup` m1 `0x355300`, `setupProgressBars` `0x355dd0`).
 * The working is in `docs/ui-parity/REFERENCE.md` §15.
 *
 * What this replaces: a `PAUSED` / `PRACTICE` heading over a stack of grey
 * rectangles. The original is a translucent `square04_001` panel over a dimmed
 * level, the level's name across the top, the **two** progress bars (normal and
 * practice, the same construction `LevelPage` uses), a horizontal row of real
 * icon buttons, a settings gear, and two volume sliders.
 *
 * Layout only. Every action is a callback supplied by the scene, so the
 * existing resume / restart / practice / quit behaviour is untouched.
 */

import type { Renderer } from "../engine/renderer.ts";
import type { LoadedFont } from "../engine/bmfont.ts";
import { HD } from "../gd/sheets.ts";

/* ---------------- sourced constants ---------------- */

/**
 * The layer dims the level with `setColor({0,0,0})` + `setOpacity(75)`
 * (customSetup +44..76), and the panel is the **same black** at opacity 175
 * (+332, the constant at `0x1007232a6`) — not a white or grey plate.
 */
export const DIM_COLOR: readonly [number, number, number] = [0, 0, 0];
export const DIM_OPACITY = 75 / 255;
/** panel: `CCScale9Sprite("square04_001.png", (0,0,80,80))`, `setOpacity(175)`, z -1 */
export const PANEL_OPACITY = 175 / 255;
/** contentSize `(screenRight - 20 - screenLeft, screenTop - 20 - screenBottom)` */
export const PANEL_INSET = 20;
/**
 * The level name sits at `(winW*0.5, winH - 30)` — customSetup +460..500 — and
 * is **never scaled**: `CCLabelBMFont::create(name, "bigFont.fnt")`, positioned,
 * added, and nothing else (+432..556). The port drew it at 0.7 until a native
 * capture showed "Stereo Madness" 1/0.7 wider (REFERENCE.md §19.8).
 */
export const NAME_TOP_INSET = 30;
export const NAME_SCALE = 1;
/** the button row: `alignItemsHorizontallyWithPadding(15)` at `(winW*0.5, winH*0.5 - 30)` */
export const ROW_PADDING = 15;
export const ROW_Y = -30;
/** the normal progress bar sits at `(winW*0.5, winH*0.5 + 80)` — setupProgressBars +380 */
export const BAR_NORMAL_Y = 80;
/**
 * The practice bar sits at `normalBar.position + (0, -50)` — `setupProgressBars
 * +880..932`. (It was -30 until Task 9 re-read the constant; at -30 the sourced
 * "Practice Mode" label, which sits 20 above its bar, lands on the normal bar.)
 */
export const BAR_PRACTICE_DY = -50;
/**
 * Each bar carries its mode's name **20 above it** at scale 0.5, z 4 —
 * `"Normal Mode"` and `"Practice Mode"`, `setupProgressBars +1520..1628`.
 */
export const BAR_LABEL_DY = 20;
export const BAR_LABEL_SCALE = 0.5;
/** bar fill scales, shared with LevelPage — setupProgressBars +440..476 */
export const BAR_FILL_SCALE_X = 0.992;
export const BAR_FILL_SCALE_Y = 0.86;
export const BAR_BG_OPACITY = 125 / 255;
/** settings gear: `GJ_optionsBtn_001.png` at scale 0.6, 26 in from the panel's corner */
export const GEAR_SCALE = 0.6;
export const GEAR_INSET = 26;
/** `GJ_practiceTxt_001.png` at `(winW*0.5 - 190, winH*0.5 - 12)` — customSetup +1344..1364 */
export const PRACTICE_BANNER_X = -190;
export const PRACTICE_BANNER_Y = -12;

/**
 * `GJ_practiceTxt_001` is a **hint for players who have never pressed the
 * practice button**, not a practice-mode marker. `customSetup` +1240..1296
 * adds it only when `GameManager::m_clickedPractice` (`+0x37a`) is clear, the
 * level is not an editor level (`m_levelType != 2`) and not a platformer
 * (`m_levelSettings->m_platformerMode`); `onPracticeMode` sets the flag
 * (+16..24). The port used to draw it *in* practice mode, which is backwards.
 */
export function showPracticeHint(clickedPractice: boolean, platformer = false): boolean {
  return !clickedPractice && !platformer;
}

/**
 * The sliders, `customSetup` +1568..2144: both `Slider::create(this, sel, 0.8)`
 * with the bar visible, **side by side** about `(winW*0.5, winH*0.5 - 105)` —
 * music 100 to the left, SFX 100 to the right — each with its `bigFont` name
 * ("Music" / "SFX") 20 above it at scale 0.5, z 1. (The port once stacked
 * them 30 apart; that was a guess, and wrong.)
 */
export const SLIDER_SCALE = 0.8;
export const SLIDER_Y = -105;
export const SLIDER_DX = 100;
export const SLIDER_LABEL_DY = 20;
export const SLIDER_LABEL_SCALE = 0.5;

/**
 * The row, in the order `customSetup` adds the items — which is the order
 * `alignItemsHorizontallyWithPadding` then lays them out in.
 *
 * `GJ_editBtn_001.png` -> `onTryEdit` comes first in the original but is only
 * added when the level is an **editor** level (`m_levelType == 2`), so a main
 * level never shows it. `GJ_replayFullBtn_001.png` -> `onRestartFull` is added
 * only when `m_levelSettings->m_platformerMode` is set (+776..852) — a
 * platformer's restart returns to its checkpoint, so it needs a second,
 * from-the-top restart; a classic level does not. The native capture of
 * Stereo Madness shows four buttons, not five.
 */
export const ROW: readonly { id: string; frame: string; platformerOnly?: boolean }[] = [
  { id: "restartFull", frame: "GJ_replayFullBtn_001.png", platformerOnly: true },
  { id: "practice", frame: "GJ_practiceBtn_001.png" },
  { id: "resume", frame: "GJ_playBtn2_001.png" },
  { id: "quit", frame: "GJ_menuBtn_001.png" },
  { id: "restart", frame: "GJ_replayBtn_001.png" },
];

/** the row a level actually gets; every level this port plays is classic */
export function pauseRow(platformer = false): readonly { id: string; frame: string }[] {
  return ROW.filter((r) => platformer || !r.platformerOnly);
}

/** `GJ_normalBtn_001.png` replaces the practice button while in practice mode */
export const PRACTICE_OFF_FRAME = "GJ_normalBtn_001.png";

/**
 * The atlas frames this screen needs. `GJ_progressBar_001.png` is *not* here:
 * like `LevelPage`'s bars it is a **loose file**, loaded separately, and
 * `GJ_checkOn/Off` come from the toggle construction below.
 */
export const PAUSE_FRAMES = [
  ...ROW.map((r) => r.frame), PRACTICE_OFF_FRAME,
  "GJ_practiceTxt_001.png", "GJ_optionsBtn_001.png",
  "GJ_checkOn_001.png", "GJ_checkOff_001.png",
] as const;

export interface PauseLayout {
  panelW: number;
  panelH: number;
  nameY: number;
  rowY: number;
  barNormalY: number;
  barPracticeY: number;
  gearX: number;
  gearY: number;
  musicSliderX: number;
  sfxSliderX: number;
  sliderY: number;
  practiceBannerX: number;
  practiceBannerY: number;
}

/** every position, in design space with the origin at the view centre */
export function pauseLayout(viewW: number, viewH: number): PauseLayout {
  const panelW = viewW - PANEL_INSET;
  const panelH = viewH - PANEL_INSET;
  return {
    panelW,
    panelH,
    // `(winW*0.5, winH*0.5 + panelH*0.5 - 20)` in GD space -> design space
    nameY: viewH / 2 - NAME_TOP_INSET,
    rowY: ROW_Y,
    barNormalY: BAR_NORMAL_Y,
    barPracticeY: BAR_NORMAL_Y + BAR_PRACTICE_DY,
    gearX: panelW / 2 - GEAR_INSET,
    gearY: panelH / 2 - GEAR_INSET,
    musicSliderX: -SLIDER_DX,
    sfxSliderX: SLIDER_DX,
    sliderY: SLIDER_Y,
    practiceBannerX: PRACTICE_BANNER_X,
    practiceBannerY: PRACTICE_BANNER_Y,
  };
}

export interface PauseBarArgs {
  renderer: Renderer;
  font: LoadedFont;
  /** the loose `GJ_progressBar_001.png` texture */
  bar: { tex: WebGLTexture; texW: number; texH: number; frame: import("../engine/atlas.ts").SpriteFrame };
  cx: number;
  cy: number;
  percent: number;
  color: readonly [number, number, number];
  /** the percentage drawn on the bar */
  label: string;
  /** the mode's name, drawn 20 above it */
  title: string;
}

/**
 * One pause progress bar. Same construction as `LevelPage`'s: a black
 * background at opacity 125 with a 0.992 x 0.86 fill anchored to its left.
 */
export function drawPauseBar(a: PauseBarArgs) {
  const w = a.bar.texW * HD, h = a.bar.texH * HD;
  a.renderer.draw(a.bar.tex, a.bar.texW, a.bar.texH, a.bar.frame,
    a.cx, a.cy, w, h, 0, 0, 0, 0, BAR_BG_OPACITY);
  const innerW = w * BAR_FILL_SCALE_X;
  const innerH = h * BAR_FILL_SCALE_Y;
  const t = Math.max(0, Math.min(100, a.percent)) / 100;
  const filled = innerW * t;
  if (filled > 0) {
    // `fill.setTextureRect(0, 0, w * pct / 100, h)` (setupProgressBars
    // +644..756): the art is **cropped** from the left, not squashed, so a 1%
    // bar still shows the bar's rounded left cap
    a.renderer.draw(a.bar.tex, a.bar.texW, a.bar.texH, { ...a.bar.frame, w: a.bar.frame.w * t },
      a.cx - innerW / 2 + filled / 2, a.cy, filled, innerH, 0,
      a.color[0] / 255, a.color[1] / 255, a.color[2] / 255, 1);
  }
  const sc = HD * 0.5;
  const baseline = (a.font.font.base - a.font.font.lineHeight / 2) * sc;
  a.font.draw(a.renderer, a.label, a.cx, a.cy - baseline, sc, 1, 1, 1, 1, 0);
  const ts = HD * BAR_LABEL_SCALE;
  a.font.draw(a.renderer, a.title, a.cx,
    a.cy + BAR_LABEL_DY - (a.font.font.base - a.font.font.lineHeight / 2) * ts,
    ts, 1, 1, 1, 1, 0);
}
