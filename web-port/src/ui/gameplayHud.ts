/**
 * The gameplay HUD — progress bar, percentage, pause button and the practice
 * checkpoint controls — reproduced from the shipping 2.2081 binary.
 *
 * Sources, with the working in `docs/ui-parity/REFERENCE.md` §14:
 *
 * - `PlayLayer::setupHasCompleted` (m1 `0x9c840` +1404..1876) builds the bar and
 *   the label;
 * - `PlayLayer::toggleProgressbar` (`0xa70d0`) decides their visibility and
 *   re-anchors the label;
 * - `PlayLayer::updateProgressbar` (`0x9fdbc`) sizes the fill;
 * - `PlayLayer::getCurrentPercent` / `getCurrentPercentInt` (`0xa6e80` /
 *   `0xa7560`) define the value **and its rounding**;
 * - `UILayer::init` (`0x426d68`) places the pause button and the practice pair.
 *
 * Two things this settles that the port had wrong:
 *
 * 1. **The percentage floors, it does not round.** `getCurrentPercentInt` ends
 *    in `fcvtms` — round toward minus infinity — so 99.6 % shows as 99 and
 *    `100%` appears only at exactly 100. The port used `Math.round`, which is
 *    why a manual play showed `100%` before the level ended.
 * 2. **Both the bar and the label read the live position**, not the best
 *    progress: `getCurrentPercent` is `clamp(player.x / levelLength * 100, 0,
 *    100)`. The port drove the text from `best` and the bar from `player.x`.
 *
 * This module is presentation only. It never touches `sim.ts`.
 */

import type { Renderer } from "../engine/renderer.ts";
import type { LoadedFont } from "../engine/bmfont.ts";
import { HD } from "../gd/sheets.ts";
import { drawUiSprite, type LooseTexture, type UiFrame } from "./sprites.ts";

/* ---------------- sourced constants ---------------- */

/** the bar's groove and fill are **loose files**, not atlas frames */
export const GROOVE_TEXTURE = "slidergroove2.png";
export const FILL_TEXTURE = "sliderBar2.png";
/** `m_progressWidth = groove.contentSize.width - 4` — setupHasCompleted +1464 */
export const BAR_WIDTH_INSET = 4;
/** the fill's rect height, `[0x36d4] = 8.0` — setupHasCompleted +1480 */
export const BAR_FILL_HEIGHT = 8;
/** the fill sits at (2, 4) inside the groove, anchored bottom-left — +1628..1660 */
export const BAR_FILL_OFFSET_X = 2;
export const BAR_FILL_OFFSET_Y = 4;
/** groove centre `(winW * 0.5, winH - 8)`, z 10 — +1668..1708 */
export const BAR_TOP_INSET = 8;
/** `updateProgressbar` never lets the fill vanish entirely */
export const BAR_MIN_PERCENT = 0.00999999;
/** the label is `CCLabelBMFont("100%", "bigFont.fnt")` at scale 0.5, z 15 */
export const PERCENT_LABEL_SCALE = 0.5;
/** with the bar shown the label moves 110 right of centre and left-anchors */
export const PERCENT_LABEL_DX = 110;
/** pause button: opacity 75, sizeMult 4, z 16, 15 in from the corner */
export const PAUSE_OPACITY = 75 / 255;
export const PAUSE_SIZE_MULT = 4;
export const PAUSE_INSET = 15;
/** the practice pair: press scale 1.1, sizeMult 1.5, 10 apart */
export const CHECKPOINT_PRESS_SCALE = 1.1;
export const CHECKPOINT_SIZE_MULT = 1.5;
export const CHECKPOINT_GAP = 10;

/**
 * `PlayLayer::getCurrentPercent` (m1 `0xa6e80`) for a classic level:
 * `clamp(player.x / levelLength * 100, 0, 100)`.
 */
export function currentPercent(playerX: number, levelLength: number): number {
  if (!(levelLength > 0)) return 0;
  return Math.min(100, Math.max(0, (playerX / levelLength) * 100));
}

/**
 * `PlayLayer::getCurrentPercentInt` (m1 `0xa7560`) — the same value put through
 * `fcvtms`, i.e. **floored**. This is the number the HUD prints.
 */
export function currentPercentInt(playerX: number, levelLength: number): number {
  return Math.floor(currentPercent(playerX, levelLength));
}

/**
 * The label's text, from `PlayLayer::updateProgressbar` (m1 `0x9fdbc`
 * +212..380): with game variable `"0126"` (`GameManager+0x782`) set it is
 * `CCString::createWithFormat("%.2f%%", percent)`; otherwise
 * `intToString(clamp(fcvtzs(percent), 0, 100)) + "%"` — truncated, which for a
 * percentage that is never negative is the same floor `getCurrentPercentInt`
 * takes.
 */
export function percentLabel(percent: number, decimals = false): string {
  if (decimals) return `${percent.toFixed(2)}%`;
  return `${Math.min(100, Math.max(0, Math.trunc(percent)))}%`;
}

/**
 * `PlayLayer::updateProgressbar` (m1 `0x9fdbc`): the fill's rect width is
 * `progressWidth * max(percent, 0.01) / 100`, never wider than the groove.
 */
export function fillWidth(percent: number, progressWidth: number): number {
  const w = (progressWidth * Math.max(percent, BAR_MIN_PERCENT)) / 100;
  return Math.min(progressWidth, w);
}

export interface HudSettings {
  /** `GameManager+0x374`, the "show progress bar" option */
  showProgressBar: boolean;
  /** game variable `"0040"`, the "show percentage" option */
  showPercentage: boolean;
  /** game variable `"0024"`, the "show pause button" option */
  showPauseButton: boolean;
  /** game variable `"0015"`, which moves the pause button to the left edge */
  pauseButtonOnLeft: boolean;
  /** game variable `"0126"`, MoreOptionsLayer's "Percentage Decimals" */
  percentageDecimals?: boolean;
}

export interface HudGeometry {
  /** groove centre in design space */
  barX: number;
  barY: number;
  /** the groove's drawn size */
  barW: number;
  barH: number;
  /** `m_progressWidth` */
  progressWidth: number;
  /** left edge of the fill, in design space */
  fillLeft: number;
  /** the fill's vertical centre */
  fillY: number;
  /** percentage label anchor */
  labelX: number;
  labelY: number;
  /** -1 left, 0 centre — the label re-anchors when the bar is hidden */
  labelAlign: -1 | 0;
  /** pause button centre */
  pauseX: number;
  pauseY: number;
}

/**
 * Lay the HUD out for one frame. `viewW`/`viewH` are the design-space view; the
 * caller adds its own camera offset, because the HUD is drawn with an
 * unmirrored, unshaken camera.
 */
export function hudGeometry(
  viewW: number, viewH: number, grooveW: number, grooveH: number, s: HudSettings,
): HudGeometry {
  const top = viewH / 2;
  const barY = top - BAR_TOP_INSET;
  const progressWidth = grooveW - BAR_WIDTH_INSET;
  return {
    barX: 0,
    barY,
    barW: grooveW,
    barH: grooveH,
    progressWidth,
    fillLeft: -grooveW / 2 + BAR_FILL_OFFSET_X,
    fillY: barY - grooveH / 2 + BAR_FILL_OFFSET_Y + BAR_FILL_HEIGHT / 2,
    labelX: s.showProgressBar ? PERCENT_LABEL_DX : 0,
    labelY: barY,
    labelAlign: s.showProgressBar ? -1 : 0,
    pauseX: s.pauseButtonOnLeft ? -viewW / 2 + PAUSE_INSET : viewW / 2 - PAUSE_INSET,
    pauseY: top - PAUSE_INSET,
  };
}

export interface HudTextures {
  groove: LooseTexture & { frame: import("../engine/atlas.ts").SpriteFrame };
  fill: LooseTexture & { frame: import("../engine/atlas.ts").SpriteFrame };
}

export interface HudDrawArgs {
  renderer: Renderer;
  font: LoadedFont;
  textures: HudTextures;
  /** design-space offset of the HUD, i.e. the camera centre */
  originX: number;
  originY: number;
  geometry: HudGeometry;
  settings: HudSettings;
  percent: number;
  /** the fill takes the player's first colour, as `setupHasCompleted +1524` does */
  fillColor: { r: number; g: number; b: number };
  pauseFrame?: UiFrame | null;
  pauseScale?: number;
}

/** draw the bar and the percentage, honouring both visibility settings */
export function drawHud(a: HudDrawArgs) {
  const { renderer, font, textures, geometry: g, settings: s } = a;
  const ox = a.originX, oy = a.originY;

  if (s.showProgressBar) {
    renderer.draw(textures.groove.tex, textures.groove.texW, textures.groove.texH,
      textures.groove.frame, ox + g.barX, oy + g.barY, g.barW, g.barH, 0, 1, 1, 1, 1);
    const w = fillWidth(a.percent, g.progressWidth);
    // `setTextureRect(0, 0, w, 8)` on a repeat-wrapped texture: the fill is
    // cropped from the left, not scaled, so its art keeps its own pitch.
    const f = textures.fill.frame;
    const cropped = { ...f, w: Math.max(1, Math.round(w / HD)) };
    renderer.draw(textures.fill.tex, textures.fill.texW, textures.fill.texH, cropped,
      ox + g.fillLeft + w / 2, oy + g.fillY, w, BAR_FILL_HEIGHT, 0,
      a.fillColor.r, a.fillColor.g, a.fillColor.b, 1);
  }

  if (s.showPercentage) {
    const sc = HD * PERCENT_LABEL_SCALE;
    const text = percentLabel(a.percent, s.percentageDecimals);
    font.draw(renderer, text, ox + g.labelX,
      oy + g.labelY - (font.font.base - font.font.lineHeight / 2) * sc,
      sc, 1, 1, 1, 1, g.labelAlign);
  }

  if (s.showPauseButton && a.pauseFrame) {
    drawUiSprite(renderer, a.pauseFrame, ox + g.pauseX, oy + g.pauseY,
      { scale: a.pauseScale ?? 1, a: PAUSE_OPACITY });
  }
}
