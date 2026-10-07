/**
 * The interactive half of the settings screens: `OptionsLayer` — the main
 * menu's `GJDropDownLayer` — and the toggle popups it and the pause gear open
 * (`MoreOptionsLayer`, `GameOptionsLayer`).
 *
 * Every position comes from `optionsMenu.ts`, which names the binary offset for
 * each constant; this file is the state, the drag handling and the drawing.
 * See `docs/ui-parity/REFERENCE.md` §16.
 */

import type { Renderer } from "../engine/renderer.ts";
import type { SpriteFrame } from "../engine/atlas.ts";
import type { LoadedFont } from "../engine/bmfont.ts";
import { HD } from "../gd/sheets.ts";
import * as save from "../gd/save.ts";
import { MenuHost, MenuItem, UiMenu } from "./controls.ts";
import { VolumeSliders } from "./volumeSliders.ts";
import {
  UiSprites, drawNineSlice, drawUiSprite, type LooseTexture,
} from "./sprites.ts";
import {
  CHAIN_DX, CHAIN_DY, DROP_BACK_SIZE_MULT, DROP_DIM_OPACITY, DROP_DURATION,
  DROP_HEIGHT, GAME_OPTIONS_LABEL_DX, initialDropProgress, GAME_OPTIONS_LABEL_SCALE,
  GAME_OPTIONS_ROW_STEP, GAME_OPTIONS_TOGGLE_SCALE, LABEL_SCALE, LIST_COLOR,
  LIST_OPACITY, MENU_MUSIC_BUTTON_SCALE, MENU_MUSIC_LABEL,
  MENU_MUSIC_LABEL_OFFSET_Y, MENU_MUSIC_LABEL_SCALE, MORE_OPTIONS_PAGES,
  MORE_OPTIONS_ROW_STEP, OPTIONS_BUTTONS, MORE_OPTIONS_ARROW_FRAME, MORE_OPTIONS_ARROW_INSET,
  MORE_OPTIONS_ARROW_SIZE_MULT,
  MORE_OPTIONS_LABEL_MAX_WIDTH, MORE_OPTIONS_CLOSE_SCALE, MORE_OPTIONS_CLOSE_INSET, INFO_ICON_SCALE, INFO_ICON_SIZE_MULT, INFO_ICON_DX, INFO_ICON_DY, OPTIONS_SLIDER_SCALE,
  POPUP_CLOSE_DX, POPUP_CLOSE_FRAME, POPUP_CLOSE_SCALE,
  POPUP_CLOSE_SIZE_MULT, POPUP_DIM_OPACITY, POPUP_H, POPUP_TITLE_INSET, POPUP_TITLE_SCALE, POPUP_W,
  TABLE_BOTTOM_Y, TABLE_SIDE_INSET, TABLE_TOP_Y, TITLE_MAX_WIDTH, TITLE_SCALE,
  VAULT_BADGE_DY, VAULT_COIN_ICON, VAULT_COIN_ICON_DX, VAULT_COIN_ICON_SCALE,
  VAULT_COIN_REQUIREMENT, VAULT_COUNT_DX, VAULT_COUNT_SCALE, VAULT_OPEN_FRAME,
  VAULT_LOCKED_FRAME, drawLabel, drawToggle, dropDownLayout,
  optionsLayout, togglePosition,
  type DropDownLayout, type GameOption, type SliderTextures,
} from "./optionsMenu.ts";

/** the atlas frames the settings screens need; all are in GJ_GameSheet03 but one */
export const OPTIONS_FRAMES = [
  "GJ_table_top_001.png", "GJ_table_bottom_001.png", "GJ_table_side_001.png",
  "chain_01_001.png", "GJ_arrow_03_001.png",
  "GJ_checkOn_001.png", "GJ_checkOff_001.png",
  VAULT_LOCKED_FRAME, VAULT_OPEN_FRAME, VAULT_COIN_ICON, POPUP_CLOSE_FRAME,
] as const;

export type Loose = LooseTexture & { frame: SpriteFrame };

/** `ButtonSprite::setString` +412..416: the background is 16 wider than the width asked for */
export const BUTTON_SPRITE_PAD = 16;

export interface OptionsTextures {
  /** `GJ_button_01.png`, every `ButtonSprite`'s nine-slice background */
  button: Loose;
  /** `GJ_square01.png` — `MoreOptionsLayer`'s panel */
  square01: Loose;
  /** `GJ_square02.png` — `GameOptionsLayer`'s panel */
  square02: Loose;
  /** a flat white texel, for the colour rects the layers are built on */
  white: Loose;
  slider: SliderTextures;
}

export interface OptionsDeps {
  renderer: Renderer;
  sprites: UiSprites;
  /** `bigFont.fnt` — titles, labels and toggle captions */
  font: LoadedFont;
  /** `goldFont.fnt` — every `ButtonSprite` caption */
  goldFont: LoadedFont;
  textures: OptionsTextures;
  /** applied live as the sliders move, so you hear what you are setting */
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  /** the back arrow and Escape */
  onClose(): void;
}

/**
 * `OptionsLayer`. The caller owns the frame loop: `update(dt)`,
 * `layout(viewW, viewH)`, `draw(viewW, viewH)`, and `dispose()` on close.
 */
export class OptionsOverlay {
  readonly menus: UiMenu[] = [];
  /** the drop-down's slide-in progress, 0..1 */
  t = 0;
  private readonly deps: OptionsDeps;
  private readonly buttons: UiMenu;
  private readonly corner: UiMenu;
  private readonly toggles: UiMenu;
  private readonly sliders: VolumeSliders;
  private host: MenuHost | null = null;
  private popup: TogglePopup | null = null;
  private readonly disposers: (() => void)[] = [];

  constructor(deps: OptionsDeps) {
    this.deps = deps;
    const s = save.settings();
    // Fast Menu (game variable 0168) opens the drop-down settled, with no slide and no dim fade
    this.t = initialDropProgress(s.fastMenu);

    this.buttons = new UiMenu("optionsButtons");
    for (const b of OPTIONS_BUTTONS) {
      // the caption shrinks to fit the *requested* width, never past scale 1
      const labelScale = this.captionScale(b.label, b.width);
      // `ButtonSprite::setString` +364..444: the background is
      // `(width + 16, label.contentSize.height + 4)` — so a "130" button is 146
      // wide, which a native capture confirms (REFERENCE.md §19.7) — and the
      // height uses the label's **unscaled** height, so a caption that had to
      // shrink does not also shrink its button. The ButtonSprite's own content
      // size, and so the menu item's hit rect, is the background's.
      const w = b.width + BUTTON_SPRITE_PAD;
      const h = deps.goldFont.font.lineHeight * HD + 4;
      this.buttons.add(new MenuItem({
        id: b.id,
        content: { w, h },
        x: b.dx, y: b.dy,
        render: (r, x, y, scale) => {
          drawNineSlice(r, deps.textures.button, x, y, w * scale, h * scale);
          // `m_labelOffset` is (0, 2) for a goldFont caption — ButtonSprite::init +116
          drawLabel(r, deps.goldFont, b.label, x, y + 2 * scale, labelScale * scale);
        },
        // The out-of-scope buttons keep their artwork, their layout and their
        // press animation and simply have no destination — the plan's rule for
        // inventoried exceptions.
        onActivate: b.id === "options" ? () => this.openMoreOptions() : undefined,
      }));
    }
    this.menus.push(this.buttons);

    this.toggles = new UiMenu("optionsToggles");
    this.toggles.add(new MenuItem({
      id: "menuMusic",
      frame: deps.sprites.require("GJ_checkOn_001.png"),
      spriteScale: MENU_MUSIC_BUTTON_SCALE,
      onActivate: () => save.setSettings({ menuMusic: !save.settings().menuMusic }),
    }));
    this.menus.push(this.toggles);

    this.corner = new UiMenu("optionsCorner");
    this.corner.add(new MenuItem({
      id: "back", frame: deps.sprites.require("GJ_arrow_03_001.png"),
      sizeMult: DROP_BACK_SIZE_MULT, onActivate: () => deps.onClose(),
    }));
    this.menus.push(this.corner);

    this.sliders = new VolumeSliders({
      canvas: deps.renderer.canvas, textures: deps.textures.slider, scale: OPTIONS_SLIDER_SCALE,
      viewScale: () => this.scale(), enabled: () => !this.popup,
      music: s.musicVolume, sfx: s.sfxVolume,
      onChange: (id, value) => {
        if (id === "music") {
          save.setSettings({ musicVolume: value });
          this.deps.setMusicVolume(value);
        } else {
          save.setSettings({ sfxVolume: value });
          this.deps.setSfxVolume(value);
        }
      },
    });
    this.disposers.push(() => this.sliders.dispose());

    this.rebuildHost();
  }

  /** `ButtonSprite::setString` shrinks the caption to the width, never past 1 */
  private captionScale(label: string, width: number): number {
    const w = this.deps.goldFont.measure(label) * HD;
    return w > width ? width / w : 1;
  }

  private rebuildHost() {
    this.host?.dispose();
    this.host = new MenuHost(this.deps.renderer.canvas,
      this.popup ? this.popup.menus : this.menus, () => this.scale());
  }

  private scale(): number {
    const c = this.deps.renderer.canvas;
    return Math.min(c.height / 320, c.width / 480);
  }

  /** Escape closes the popup first, then the drop-down. Returns true if handled. */
  handleKey(code: string): boolean {
    if (code !== "Escape") return false;
    if (this.popup) { this.closePopup(); return true; }
    this.deps.onClose();
    return true;
  }

  /** the `Options` button — `MoreOptionsLayer`, filtered to what this port stores */
  openMoreOptions() {
    this.popup = new TogglePopup({
      renderer: this.deps.renderer,
      sprites: this.deps.sprites,
      font: this.deps.font,
      panel: this.deps.textures.square01,
      white: this.deps.textures.white,
      pages: MORE_OPTIONS_PAGES,
      rowStep: MORE_OPTIONS_ROW_STEP,
      yOffset: 0,
      labelMaxWidth: MORE_OPTIONS_LABEL_MAX_WIDTH,
      infoIcons: true,
      closeScale: MORE_OPTIONS_CLOSE_SCALE,
      closeInset: MORE_OPTIONS_CLOSE_INSET,
      onClose: () => this.closePopup(),
    });
    this.rebuildHost();
  }

  closePopup() {
    this.popup = null;
    this.rebuildHost();
  }

  get popupOpen(): boolean { return this.popup !== null; }

  update(dt: number) {
    this.t = Math.min(1, this.t + dt / DROP_DURATION);
    this.host?.update(dt);
  }

  layout(viewW: number, viewH: number) {
    const L = dropDownLayout(viewW, viewH, DROP_HEIGHT, this.t);
    const O = optionsLayout(viewW, viewH);
    this.buttons.setPosition(O.buttonsX, O.buttonsY + L.slide);
    this.corner.setPosition(0, 0);
    this.corner.items[0].x = L.backX;
    this.corner.items[0].y = L.backY;
    this.toggles.setPosition(0, 0);
    this.toggles.items[0].x = O.menuMusicX;
    this.toggles.items[0].y = O.menuMusicY + L.slide;
    this.sliders.place("music", O.musicLabelX, O.musicSliderY + L.slide);
    this.sliders.place("sfx", O.musicLabelX, O.sfxSliderY + L.slide);
    this.popup?.layout(viewW);
  }

  /** every control's design-space rect, for the browser harness */
  controls(): { id: string; x: number; y: number; w: number; h: number }[] {
    if (this.popup) return this.popup.controls();
    const out = this.menus.flatMap((m) => m.items.map((it) => ({
      id: it.id, x: m.x + it.x, y: m.y + it.y, w: it.contentW, h: it.contentH,
    })));
    out.push(...this.sliders.controls());
    return out;
  }

  sliderValue(id: "music" | "sfx"): number {
    return this.sliders.value(id);
  }

  draw(viewW: number, viewH: number) {
    const { renderer, sprites, font, textures } = this.deps;
    const L = dropDownLayout(viewW, viewH, DROP_HEIGHT, this.t);
    const O = optionsLayout(viewW, viewH);
    const slide = L.slide;

    // `CCLayerColor::initWithColor({0,0,0,125})`, faded in over the same 0.5 s
    fill(renderer, textures.white, 0, 0, viewW, viewH,
      0, 0, 0, DROP_DIM_OPACITY * this.t);

    drawDropDownPanel(renderer, sprites, font, textures.white, L, "Settings");

    this.buttons.draw(renderer);
    this.drawVault(O.vaultX, O.vaultY + slide);

    drawLabel(renderer, font, "Music", O.musicLabelX, O.musicLabelY + slide, LABEL_SCALE);
    drawLabel(renderer, font, "SFX", O.musicLabelX, O.sfxLabelY + slide, LABEL_SCALE);
    this.sliders.draw(renderer);

    const item = this.toggles.items[0];
    drawToggle({
      renderer, font,
      on: sprites.require("GJ_checkOn_001.png"),
      off: sprites.require("GJ_checkOff_001.png"),
      value: save.settings().menuMusic,
      x: this.toggles.x + item.x, y: this.toggles.y + item.y, itemScale: item.scale,
      boxScale: MENU_MUSIC_BUTTON_SCALE,
      label: MENU_MUSIC_LABEL, labelScale: MENU_MUSIC_LABEL_SCALE,
      labelTop: true, labelOffsetX: 0, labelOffsetY: MENU_MUSIC_LABEL_OFFSET_Y,
    });

    this.corner.draw(renderer);
    this.popup?.draw(viewW, viewH);
  }

  /**
   * The secret-vault lock. The vault itself is outside the locked scope, so the
   * button is inert — but whether the lock is open follows the player's real
   * secret-coin total, and the badge shows the fixed requirement ("10").
   */
  private drawVault(x: number, y: number) {
    const { renderer, sprites, font } = this.deps;
    const coins = save.totalCoins();
    const open = coins >= VAULT_COIN_REQUIREMENT;
    drawUiSprite(renderer, sprites.require(open ? VAULT_OPEN_FRAME : VAULT_LOCKED_FRAME), x, y);
    if (open) return;
    // both badges hang at `(0, -21)` in the lock's own space — customSetup +1252.
    // The number is the **requirement**, not a count: `+1428` creates the label
    // from the literal string "10". A native capture on an account with fewer
    // coins shows "10" (REFERENCE.md §19.7).
    const by = y + VAULT_BADGE_DY;
    drawUiSprite(renderer, sprites.require(VAULT_COIN_ICON),
      x + VAULT_COIN_ICON_DX, by, { scale: VAULT_COIN_ICON_SCALE });
    drawLabel(renderer, font, `${VAULT_COIN_REQUIREMENT}`, x + VAULT_COUNT_DX, by, VAULT_COUNT_SCALE);
  }

  dispose() {
    this.host?.dispose();
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}

/** a flat colour rect */
function fill(
  renderer: Renderer, white: Loose, cx: number, cy: number, w: number, h: number,
  r: number, g: number, b: number, a: number,
) {
  renderer.draw(white.tex, white.texW, white.texH, white.frame, cx, cy, w, h, 0, r, g, b, a);
}

/**
 * `GJListLayer`: a flat `ccColor4B(0,0,0,180)` rect with the table art around
 * it, two chains above, and the title over the top piece.
 *
 * Exported because `EndLevelLayer` is a `GJDropDownLayer` too (REFERENCE.md
 * §17), so the results screen draws the identical panel — with `" "` for its
 * title, which is what `EndLevelLayer::init` passes.
 */
export function drawDropDownPanel(
  renderer: Renderer, sprites: UiSprites, font: LoadedFont, white: Loose,
  L: DropDownLayout, title: string,
) {
  const top = sprites.require("GJ_table_top_001.png");
  const bottom = sprites.require("GJ_table_bottom_001.png");
  const side = sprites.require("GJ_table_side_001.png");
  const chain = sprites.require("chain_01_001.png");

  // the chains are added at z -1, anchored (0.5, 0) just above the panel
  const chainH = chain.frame.sourceH * HD;
  const chainBottom = L.bottom + L.height + CHAIN_DY;
  for (const dx of [-CHAIN_DX, CHAIN_DX]) {
    drawUiSprite(renderer, chain, dx, chainBottom + chainH / 2);
  }

  fill(renderer, white, L.cx, L.cy, L.width, L.height,
    LIST_COLOR[0] / 255, LIST_COLOR[1] / 255, LIST_COLOR[2] / 255, LIST_OPACITY);

  // The sides are anchored (0,0) / (1,0), scaled to the panel height, and the
  // right one is `setFlipX(true)`. Their frame is trimmed (48 of 60 px wide,
  // offset +5), so they go through `drawUiSprite` — a raw draw stretched the
  // trimmed art to the full 60 px box and dropped the offset.
  const sideW = side.frame.sourceW * HD;
  const sideH = side.frame.sourceH * HD;
  for (const [x, flip] of [
    [L.left - TABLE_SIDE_INSET, false],
    [L.left + L.width + TABLE_SIDE_INSET, true],
  ] as [number, boolean][]) {
    drawUiSprite(renderer, side, x + (flip ? -sideW / 2 : sideW / 2), L.bottom + L.height / 2,
      { scaleY: L.height / sideH, flipX: flip });
  }

  drawUiSprite(renderer, bottom, L.cx, L.bottom + TABLE_BOTTOM_Y);
  drawUiSprite(renderer, top, L.cx, L.bottom + L.height + TABLE_TOP_Y);

  // `limitLabelWidth(280, 0.8, 0)`
  const natural = font.measure(title) * HD;
  const scale = natural * TITLE_SCALE > TITLE_MAX_WIDTH
    ? TITLE_MAX_WIDTH / natural : TITLE_SCALE;
  drawLabel(renderer, font, title, L.titleX, L.titleY, scale);
}

export interface TogglePopupDeps {
  renderer: Renderer;
  sprites: UiSprites;
  font: LoadedFont;
  /** the panel texture: `GJ_square01` for MoreOptions, `GJ_square02` for GameOptions */
  panel: Loose;
  white: Loose;
  /**
   * The popup's pages. Each page's rows are **in the original's order**: a
   * row's index is its slot in `nextPosition`, so a row the port cannot honour
   * leaves its slot empty instead of pulling the next row up into it.
   *
   * `MoreOptionsLayer` titles each page 16 below the panel's top (`goToPage`,
   * +992..1092); `GJOptionsLayer` / `GameOptionsLayer` create **no title label
   * at all**, so the pause gear's popup passes a single untitled page. With
   * more than one page the popup draws `MoreOptionsLayer`'s page arrows.
   */
  pages: readonly PopupPage[];
  /** row step: `MoreOptionsLayer` 48, `GJOptionsLayer` 37 */
  rowStep?: number;
  /** `GameOptionsLayer` shifts its rows down by 32; `MoreOptionsLayer` does not */
  yOffset?: number;
  /** `limitLabelWidth`'s width: 130 for MoreOptionsLayer, none for GJOptionsLayer */
  labelMaxWidth?: number;
  /** MoreOptionsLayer adds an info button to every row that has a description */
  infoIcons?: boolean;
  /** the close button's scale and inset from the panel corner (see MORE_OPTIONS_CLOSE_*) */
  closeScale?: number;
  closeInset?: number;
  /** `didToggleGV`: the scene may hold live state mirroring a setting */
  onChange?(key: keyof save.Settings, value: boolean): void;
  onClose(): void;
}

export interface PopupPage { title?: string; options: readonly GameOption[] }

interface PopupRow { option: GameOption; slot: number; item: MenuItem; info: MenuItem | null }

/**
 * The shape `MoreOptionsLayer` and `GameOptionsLayer` share: a 400x280
 * `GJ_square0N` nine-slice, a title, and toggles in two columns.
 *
 * Only rows this port actually stores are built. A row it cannot honour is
 * inventoried in REFERENCE.md instead of drawn — a checkbox whose value nothing
 * reads is invented state — but it keeps its slot.
 */
export class TogglePopup {
  readonly menus: UiMenu[] = [];
  private readonly deps: TogglePopupDeps;
  private readonly menu: UiMenu;
  /** every page's rows, built once; only the current page's are in `menu` */
  private readonly pageRows: PopupRow[][];
  private readonly close: MenuItem;
  private readonly arrows: [MenuItem, MenuItem] | null;
  private pageIndex = 0;

  constructor(deps: TogglePopupDeps) {
    this.deps = deps;
    this.menu = new UiMenu("popup");
    this.pageRows = deps.pages.map((page) => {
      const rows: PopupRow[] = [];
      page.options.forEach((option, slot) => {
        if (option.setting === null) return;
        const key = option.setting;
        const item = new MenuItem({
          id: String(key),
          frame: deps.sprites.require("GJ_checkOn_001.png"),
          spriteScale: GAME_OPTIONS_TOGGLE_SCALE,
          onActivate: () => {
            const cur = save.settings()[key];
            if (typeof cur !== "boolean") return;
            save.setSettings({ [key]: !cur } as Partial<save.Settings>);
            deps.onChange?.(key, !cur);
          },
        });
        // The info button opens an FLAlertLayer with the row's description in the
        // original; that popup is not reproduced yet, so the button is inert.
        const info = deps.infoIcons && option.info
          ? new MenuItem({
              id: `info-${String(key)}`, frame: deps.sprites.require("GJ_infoIcon_001.png"),
              spriteScale: INFO_ICON_SCALE, sizeMult: INFO_ICON_SIZE_MULT,
            })
          : null;
        rows.push({ option, slot, item, info });
      });
      return rows;
    });
    this.close = new MenuItem({
      id: "close", frame: deps.sprites.require(POPUP_CLOSE_FRAME),
      spriteScale: deps.closeScale ?? POPUP_CLOSE_SCALE, sizeMult: POPUP_CLOSE_SIZE_MULT,
      onActivate: deps.onClose,
    });
    const arrow = deps.pages.length > 1 ? deps.sprites.require(MORE_OPTIONS_ARROW_FRAME) : null;
    this.arrows = arrow
      ? [
          new MenuItem({
            id: "prev-page", frame: arrow, sizeMult: MORE_OPTIONS_ARROW_SIZE_MULT,
            onActivate: () => this.goToPage(this.pageIndex - 1),
          }),
          new MenuItem({
            id: "next-page", frame: arrow, sizeMult: MORE_OPTIONS_ARROW_SIZE_MULT,
            onActivate: () => this.goToPage(this.pageIndex + 1),
          }),
        ]
      : null;
    this.menus.push(this.menu);
    this.goToPage(0);
  }

  get page(): number { return this.pageIndex; }

  /** `MoreOptionsLayer::goToPage`: wraps both ways, swaps the rows and the title */
  goToPage(page: number) {
    const last = this.deps.pages.length - 1;
    this.pageIndex = page < 0 ? last : page > last ? 0 : page;
    const items = this.menu.items;
    items.length = 0;
    for (const row of this.pageRows[this.pageIndex]) {
      items.push(row.item);
      if (row.info) items.push(row.info);
    }
    items.push(this.close);
    if (this.arrows) items.push(...this.arrows);
  }

  private get rows(): readonly PopupRow[] { return this.pageRows[this.pageIndex]; }

  /** `viewW` places the page arrows, which hang off the screen's edges, not the panel's */
  layout(viewW = 0) {
    const step = this.deps.rowStep ?? GAME_OPTIONS_ROW_STEP;
    const yOffset = this.deps.yOffset ?? 0;
    this.menu.setPosition(0, 0);
    for (const rows of this.pageRows) {
      for (const row of rows) {
        const p = togglePosition(row.slot, yOffset, step);
        row.item.x = p.x;
        row.item.y = p.y;
        if (row.info) { row.info.x = p.x + INFO_ICON_DX; row.info.y = p.y + INFO_ICON_DY; }
      }
    }
    const inset = this.deps.closeInset ?? POPUP_CLOSE_DX;
    this.close.x = -POPUP_W / 2 + inset;
    this.close.y = POPUP_H / 2 - inset;
    if (this.arrows) {
      this.arrows[0].x = -viewW / 2 + MORE_OPTIONS_ARROW_INSET;
      this.arrows[1].x = viewW / 2 - MORE_OPTIONS_ARROW_INSET;
      this.arrows[0].y = this.arrows[1].y = 0;
    }
  }

  controls(): { id: string; x: number; y: number; w: number; h: number }[] {
    return this.menu.items.map((it) => ({
      id: it.id, x: this.menu.x + it.x, y: this.menu.y + it.y,
      w: it.contentW, h: it.contentH,
    }));
  }

  draw(viewW: number, viewH: number) {
    const { renderer, sprites, font } = this.deps;
    // `FLAlertLayer::init(opacity)` dims whatever is behind the popup
    fill(renderer, this.deps.white, 0, 0, viewW, viewH, 0, 0, 0, POPUP_DIM_OPACITY);
    drawNineSlice(renderer, this.deps.panel, 0, 0, POPUP_W, POPUP_H);
    const title = this.deps.pages[this.pageIndex].title;
    if (title) drawLabel(renderer, font, title, 0, POPUP_H / 2 - POPUP_TITLE_INSET, POPUP_TITLE_SCALE);

    const settings = save.settings();
    for (const row of this.rows) {
      drawToggle({
        renderer, font,
        on: sprites.require("GJ_checkOn_001.png"),
        off: sprites.require("GJ_checkOff_001.png"),
        value: settings[row.option.setting!] === true,
        x: this.menu.x + row.item.x, y: this.menu.y + row.item.y, itemScale: row.item.scale,
        boxScale: GAME_OPTIONS_TOGGLE_SCALE,
        label: row.option.label, labelScale: GAME_OPTIONS_LABEL_SCALE,
        labelMaxWidth: this.deps.labelMaxWidth,
        labelTop: false, labelOffsetX: GAME_OPTIONS_LABEL_DX, labelOffsetY: 0,
      });
      if (row.info) row.info.draw(renderer, this.menu.x, this.menu.y);
    }
    drawUiSprite(renderer, sprites.require(POPUP_CLOSE_FRAME),
      this.menu.x + this.close.x, this.menu.y + this.close.y,
      { scale: (this.deps.closeScale ?? POPUP_CLOSE_SCALE) * this.close.scale });
    if (this.arrows) {
      const [prev, next] = this.arrows;
      const frame = sprites.require(MORE_OPTIONS_ARROW_FRAME);
      drawUiSprite(renderer, frame, this.menu.x + prev.x, this.menu.y + prev.y, { scale: prev.scale });
      drawUiSprite(renderer, frame, this.menu.x + next.x, this.menu.y + next.y,
        { scale: next.scale, flipX: true });
    }
  }
}
