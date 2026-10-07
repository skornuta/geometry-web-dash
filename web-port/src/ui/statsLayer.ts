/**
 * The main menu's Stats button: `StatsLayer`, a cumulative, offline stats page.
 *
 * What is decoded: the label text. The exe (`ACTUAL_steamgd/GeometryDash.exe`)
 * has the class name `StatsLayer` and these strings: Stats, Jumps, Attempts,
 * Stars, Moons, Orbs, Diamonds, Demons, User Coins, Secret Coins, Completed,
 * Normal Mode. The binary is stripped, so its layout is NOT decoded.
 *
 * APPROXIMATION: the panel's position, size and row spacing are not from the
 * binary. The page reuses the settings drop-down's table art (`drawDropDownPanel`)
 * and a back arrow, because those are the nearest sourced pieces. Only the
 * rows and their values are from the save.
 *
 * Rows rule (the same as the garage counter's): a row is shown only if the save
 * backs it. Moons, Orbs, Diamonds, Demons, User Coins and Normal Mode have no
 * save field in this port, so they are left out, not shown as 0.
 */

import type { Renderer } from "../engine/renderer.ts";
import type { LoadedFont } from "../engine/bmfont.ts";
import { COINS_PER_LEVEL, LEVELS } from "../gd/levels.ts";
import * as save from "../gd/save.ts";
import type { UiSprites } from "./sprites.ts";
import { MenuHost, MenuItem, UiMenu } from "./controls.ts";
import {
  DROP_BACK_SIZE_MULT, DROP_DIM_OPACITY, LABEL_SCALE, dropDownLayout, drawLabel,
} from "./optionsMenu.ts";
import { drawDropDownPanel, type Loose } from "./optionsOverlay.ts";

/** APPROXIMATION: panel height. The binary's layout is not decoded. */
export const STATS_HEIGHT = 220;
/** APPROXIMATION: first row's distance below the panel's top edge, design units */
const ROW_FIRST_DY = 34;
/** APPROXIMATION: row spacing, design units */
const ROW_STEP = 30;
/** APPROXIMATION: inset of the label and value from the panel's sides */
const ROW_INSET = 40;

export interface StatRow {
  /** the native label text, as the exe has it */
  label: string;
  value: number;
  /** the most this row can reach, shown after the value when present */
  of?: number;
}

/**
 * The page's rows, from the save. Pure: it reads only the data it is given, so
 * a test can pass a save of its own.
 *
 * The completion rule is `save.isCompleted`'s (normal-mode 100%), and the star
 * sum is `save.totalStars`'s. Both are restricted to the 22 main levels, so a
 * stray key in the save cannot inflate a row.
 */
export function statsRows(data: save.SaveData = save.save()): StatRow[] {
  const levels = LEVELS.map((l) => ({ info: l, stats: data.levels[String(l.n)] }));
  const attempts = levels.reduce((n, l) => n + (l.stats?.attempts ?? 0), 0);
  const jumps = levels.reduce((n, l) => n + (l.stats?.jumps ?? 0), 0);
  const completed = levels.filter((l) => (l.stats?.normal ?? 0) >= 100);
  const stars = completed.reduce((n, l) => n + l.info.stars, 0);
  const coins = levels.reduce((n, l) => n + (l.stats?.coins.length ?? 0), 0);
  return [
    { label: "Attempts", value: attempts },
    { label: "Jumps", value: jumps },
    { label: "Completed", value: completed.length, of: LEVELS.length },
    { label: "Stars", value: stars },
    { label: "Secret Coins", value: coins, of: LEVELS.length * COINS_PER_LEVEL },
  ];
}

export interface StatsDeps {
  renderer: Renderer;
  sprites: UiSprites;
  /** `bigFont.fnt` */
  font: LoadedFont;
  /** `GJ_table*` and the dim are drawn with this flat white texel */
  white: Loose;
  /** the back arrow and Escape */
  onClose(): void;
}

/**
 * The Stats overlay. The caller owns the frame loop: `update(dt)`,
 * `layout(viewW, viewH)`, `draw(viewW, viewH)`, and `dispose()` on close.
 * Later packets add their buttons to `menu`.
 */
export class StatsLayer {
  /** the layer's own controls; F6 adds its buttons here */
  readonly menu: UiMenu;
  private readonly deps: StatsDeps;
  private readonly host: MenuHost;

  constructor(deps: StatsDeps) {
    this.deps = deps;
    this.menu = new UiMenu("stats");
    this.menu.add(new MenuItem({
      id: "back", frame: deps.sprites.require("GJ_arrow_03_001.png"),
      sizeMult: DROP_BACK_SIZE_MULT, onActivate: () => deps.onClose(),
    }));
    this.host = new MenuHost(deps.renderer.canvas, [this.menu], () => this.scale());
  }

  private scale(): number {
    const c = this.deps.renderer.canvas;
    return Math.min(c.height / 320, c.width / 480);
  }

  /** Escape closes the page. Returns true if handled. */
  handleKey(code: string): boolean {
    if (code !== "Escape") return false;
    this.deps.onClose();
    return true;
  }

  update(dt: number) {
    this.host.update(dt);
  }

  layout(viewW: number, viewH: number) {
    const L = dropDownLayout(viewW, viewH, STATS_HEIGHT, 1);
    const back = this.menu.items[0];
    this.menu.setPosition(0, 0);
    back.x = L.backX;
    back.y = L.backY;
  }

  /** every control's design-space rect, for the browser harness */
  controls(): { id: string; x: number; y: number; w: number; h: number }[] {
    return this.menu.items.map((it) => ({
      id: it.id, x: this.menu.x + it.x, y: this.menu.y + it.y, w: it.contentW, h: it.contentH,
    }));
  }

  draw(viewW: number, viewH: number, data: save.SaveData = save.save()) {
    const { renderer, sprites, font, white } = this.deps;
    const L = dropDownLayout(viewW, viewH, STATS_HEIGHT, 1);

    // `CCLayerColor` dim behind the page, as the settings drop-down has
    renderer.draw(white.tex, white.texW, white.texH, white.frame,
      0, 0, viewW, viewH, 0, 0, 0, 0, DROP_DIM_OPACITY);

    drawDropDownPanel(renderer, sprites, font, white, L, "Stats");

    const top = L.bottom + L.height;
    statsRows(data).forEach((r, i) => {
      const y = top - ROW_FIRST_DY - i * ROW_STEP;
      drawLabel(renderer, font, r.label, L.left + ROW_INSET, y, LABEL_SCALE, -1);
      const text = r.of === undefined ? `${r.value}` : `${r.value} / ${r.of}`;
      drawLabel(renderer, font, text, L.left + L.width - ROW_INSET, y, LABEL_SCALE, 1);
    });

    this.menu.draw(renderer);
  }

  dispose() {
    this.host.dispose();
  }
}
