/**
 * `FLAlertLayer` — the game's standard popup — reproduced for the one place
 * the port needs it: the level-select info button's "Level Stats".
 * Read out of the shipping 2.2081 binary:
 *
 * - `FLAlertLayer::create(delegate, title, desc, btn1, btn2, width)` (m1
 *   `0x3ff604`) forwards to the full `create` with `scroll = false`,
 *   `height = 0`, `textScale = 1`;
 * - `FLAlertLayer::init` (`0x3ff6ec`) builds it;
 * - `FLAlertLayer::show` (`0x400794`) animates it in;
 * - `LevelPage::onInfo` (`0x3a6fa4`) +608..1008 fills it for a level.
 *
 * Layout, non-scrolling path (+828..2108), all relative to the screen centre:
 *
 * | part | source |
 * |---|---|
 * | dim | `CCLayerColor::initWithColor(0, 0, 0, 150)` (+76..88) |
 * | text | `TextArea(desc, "chatFont.fnt", 1.0, width − 60, anchor (0.5, 0.5), lineHeight 20)`, z 3 |
 * | height | `max(text.height · textScale + 120, 140)` (+932..956) |
 * | panel | `CCScale9Sprite("square01_001.png")` sized `(width, height)`, z 1 |
 * | title | `goldFont`, anchor (0.5, 1), at the panel's top − 15, scale 0.9 (+1384..1560) |
 * | text position | panel centre + 5 (+1572..1680) |
 * | button | `ButtonSprite(btn1, 90, 0, 1.0, absolute false, goldFont, GJ_button_01)`, menu at the panel's bottom + 30 (+1716..2108) |
 *
 * `show` scales the layer from 0.1 to 1 over 0.5 s with `CCEaseElasticOut(0.6)`
 * and fades the dim in over 0.14 s (+80..264).
 */

import type { Renderer } from "../engine/renderer.ts";
import type { LoadedFont } from "../engine/bmfont.ts";
import { HD } from "../gd/sheets.ts";
import { easedValue } from "../gd/easing.ts";
import * as save from "../gd/save.ts";
import { drawNineSlice, type LooseTexture } from "./sprites.ts";
import { MenuItem, UiMenu } from "./controls.ts";
import { drawLabel } from "./optionsMenu.ts";

export const ALERT_DIM_OPACITY = 150 / 255;
export const ALERT_PANEL = "square01_001.png";
export const ALERT_TEXT_INSET = 60;
export const ALERT_LINE_HEIGHT = 20;
export const ALERT_EXTRA_H = 120;
export const ALERT_MIN_H = 140;
export const ALERT_TITLE_DY = -15;
export const ALERT_TITLE_SCALE = 0.9;
export const ALERT_TEXT_DY = 5;
export const ALERT_BUTTON_DY = 30;
export const ALERT_BUTTON_WIDTH = 90;
/** `ButtonSprite::setString` +408..424: the background is the caption + 16 wide */
export const BUTTON_PAD_W = 16;
/** ... and the caption's unscaled height + 4 tall (+384..404) */
export const BUTTON_PAD_H = 4;
export const ALERT_POP_FROM = 0.1;
export const ALERT_POP_DURATION = 0.5;
export const ALERT_POP_PERIOD = 0.6;
export const ALERT_FADE_DURATION = 0.14;

/** `LevelPage::onInfo` passes width 300 (+988..992) */
export const LEVEL_STATS_WIDTH = 300;
export const LEVEL_STATS_TITLE = "Level Stats";

/**
 * The description `LevelPage::onInfo` formats (string at `0x1007487ad`):
 * level name, the level's cumulative attempts and jumps (`GJGameLevel +
 * 0x2a8` / `+0x2b4`, seed-obfuscated), `getNormalPercent()` and the practice
 * percent (`+0x304`).
 */
export function levelStatsText(name: string, attempts: number, jumps: number,
  normal: number, practice: number): string {
  return `<cy>${name}</c>\n<cg>Total Attempts</c>: ${attempts}\n`
    + `<cl>Total Jumps</c>: ${jumps}\n<cp>Normal</c>: ${Math.floor(normal)}%\n`
    + `<co>Practice</c>: ${Math.floor(practice)}%`;
}

/**
 * The colour a `<cX>` tag selects. APPROXIMATION: `MultilineBitmapFont`
 * parses the tags (`readColorInfo` `0x3ed558`) but the tag→colour mapping was
 * not found in the time allowed (no packed-RGB immediates for these values
 * anywhere in `__text`); these are the widely published values.
 */
export const TAG_COLORS: Record<string, readonly [number, number, number]> = {
  b: [74, 82, 225], g: [64, 227, 72], l: [96, 171, 239], j: [50, 200, 255],
  y: [255, 255, 0], o: [255, 165, 75], r: [255, 90, 90], p: [255, 0, 255],
  a: [150, 50, 255], d: [255, 150, 255], c: [255, 255, 150], f: [150, 255, 255],
  s: [255, 220, 65],
};

export interface TextRun { text: string; color: readonly [number, number, number] }

/** split one line of GD's tagged text into coloured runs */
export function parseTaggedLine(line: string): TextRun[] {
  const out: TextRun[] = [];
  const white = [255, 255, 255] as const;
  let color: readonly [number, number, number] = white;
  let buf = "";
  for (let i = 0; i < line.length; i++) {
    if (line.startsWith("<c", i) && line[i + 3] === ">") {
      if (buf) out.push({ text: buf, color });
      buf = "";
      color = TAG_COLORS[line[i + 2]] ?? white;
      i += 3;
    } else if (line.startsWith("</c>", i)) {
      if (buf) out.push({ text: buf, color });
      buf = "";
      color = white;
      i += 3;
    } else {
      buf += line[i];
    }
  }
  if (buf) out.push({ text: buf, color });
  return out;
}

export interface AlertLayout { w: number; h: number; titleY: number; textY: number; buttonY: number }

/** every position relative to the screen centre, for `lines` lines of text */
export function alertLayout(width: number, lines: number, textScale = 1): AlertLayout {
  const textH = lines * ALERT_LINE_HEIGHT;
  const h = Math.max(textH * textScale + ALERT_EXTRA_H, ALERT_MIN_H);
  return {
    w: width, h,
    titleY: h / 2 + ALERT_TITLE_DY,
    textY: ALERT_TEXT_DY,
    buttonY: -h / 2 + ALERT_BUTTON_DY,
  };
}

/**
 * The layer's scale and the dim's opacity `t` seconds after `show`. With Fast
 * Menu (game variable `"0168"`) `FLAlertLayer::init` sets `m_noElasticity`, and
 * `show` (exe `0x140052c00`) then runs neither the elastic pop nor the dim fade:
 * the layer is settled from the first frame.
 */
export function alertShowState(t: number, fastMenu = false): { scale: number; dim: number } {
  if (fastMenu) return { scale: 1, dim: ALERT_DIM_OPACITY };
  const k = Math.min(1, Math.max(0, t / ALERT_POP_DURATION));
  const scale = ALERT_POP_FROM + (1 - ALERT_POP_FROM) * easedValue(k, 6, ALERT_POP_PERIOD);
  const dim = ALERT_DIM_OPACITY * Math.min(1, Math.max(0, t / ALERT_FADE_DURATION));
  return { scale, dim };
}

export interface AlertDeps {
  title: string;
  desc: string;
  width: number;
  button: string;
  goldFont: LoadedFont;
  chatFont: LoadedFont;
  panel: LooseTexture;
  buttonBg: LooseTexture;
  white: LooseTexture & { frame: import("../engine/atlas.ts").SpriteFrame };
  onClose(): void;
}

/** a live `FLAlertLayer` with one button */
export class AlertLayer {
  t = 0;
  /** game variable `"0168"`, read in `FLAlertLayer::init` */
  private readonly fastMenu = save.settings().fastMenu;
  readonly menu = new UiMenu("alert");
  readonly layout: AlertLayout;
  private readonly lines: TextRun[][];
  private readonly deps: AlertDeps;
  private readonly button: MenuItem;

  constructor(deps: AlertDeps) {
    this.deps = deps;
    this.lines = deps.desc.split("\n").map(parseTaggedLine);
    this.layout = alertLayout(deps.width, this.lines.length);
    const capW = deps.goldFont.measure(deps.button) * HD;
    // absolute = false, minWidth 0: the caption keeps scale 1 unless it
    // overflows the 90 it was given
    const capScale = capW > ALERT_BUTTON_WIDTH ? ALERT_BUTTON_WIDTH / capW : 1;
    const bw = capW * capScale + BUTTON_PAD_W;
    const bh = deps.goldFont.font.lineHeight * HD + BUTTON_PAD_H;
    this.button = this.menu.add(new MenuItem({
      id: "alertButton",
      content: { w: bw, h: bh },
      x: 0, y: this.layout.buttonY,
      render: (r, x, y, s) => {
        drawNineSlice(r, deps.buttonBg, x, y, bw * s, bh * s);
        // `m_labelOffset` (0, 2) for goldFont — ButtonSprite::init
        drawLabel(r, deps.goldFont, deps.button, x, y + 2 * s, capScale * s);
      },
      onActivate: () => deps.onClose(),
    }));
  }

  update(dt: number) {
    this.t += dt;
  }

  /** the scale the layer is drawn at right now (the pop-in) */
  get scale(): number {
    return alertShowState(this.t, this.fastMenu).scale;
  }

  draw(renderer: Renderer, viewW: number, viewH: number) {
    const d = this.deps;
    const { scale, dim } = alertShowState(this.t, this.fastMenu);
    const w = d.white;
    renderer.draw(w.tex, w.texW, w.texH, w.frame, 0, 0, viewW, viewH, 0, 0, 0, 0, dim);
    const L = this.layout;
    drawNineSlice(renderer, d.panel, 0, 0, L.w * scale, L.h * scale);
    // the title hangs from its top edge (anchor (0.5, 1))
    const titleH = d.goldFont.font.lineHeight * HD * ALERT_TITLE_SCALE;
    drawLabel(renderer, d.goldFont, d.title, 0, (L.titleY - titleH / 2) * scale,
      ALERT_TITLE_SCALE * scale);
    // the text block is centred on its own middle, each line centred
    const n = this.lines.length;
    this.lines.forEach((runs, i) => {
      const y = (L.textY + ((n - 1) / 2 - i) * ALERT_LINE_HEIGHT) * scale;
      const total = runs.reduce((a, r) => a + d.chatFont.measure(r.text) * HD, 0) * scale;
      let x = -total / 2;
      for (const r of runs) {
        const rw = d.chatFont.measure(r.text) * HD * scale;
        const sc = HD * scale;
        const baseline = y - (d.chatFont.font.base - d.chatFont.font.lineHeight / 2) * sc;
        d.chatFont.draw(renderer, r.text, x, baseline, sc,
          r.color[0] / 255, r.color[1] / 255, r.color[2] / 255, 1, -1);
        x += rw;
      }
    });
    // the button follows the layer's scale
    this.menu.setPosition(0, 0);
    this.button.y = L.buttonY * scale;
    this.menu.draw(renderer);
  }
}
