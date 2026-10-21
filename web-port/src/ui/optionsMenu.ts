/**
 * The settings screens, reproduced from the shipping 2.2081 binary:
 *
 * - `Slider` / `SliderThumb` (m1 `0x2952d4`, `0x2943f0`, `0x294474`) — the
 *   control both volume rows are built from;
 * - `GJDropDownLayer::init` (`0x5124fc`) and `GJListLayer::init` (`0x4fec74`) —
 *   the panel `OptionsLayer` drops in on;
 * - `OptionsLayer::customSetup` (`0x6a1ba0`) — the main-menu settings screen;
 * - `GameToolbox::createToggleButton` (`0x448c1c`) — every checkbox in the game;
 * - `GJOptionsLayer::init` / `nextPosition` / `addToggleInternal`
 *   (`0x23b7a0`, `0x23c494`, `0x23c000`) and `GameOptionsLayer::init` /
 *   `setupOptions` (`0x24f210`, `0x24f268`) — the pause gear's popup.
 *
 * The working, and the full supported / browser-equivalent / out-of-scope
 * inventory, is `docs/ui-parity/REFERENCE.md` §16.
 *
 * This module is geometry and drawing only; the scenes own the state.
 */

import type { Renderer } from "../engine/renderer.ts";
import type { SpriteFrame } from "../engine/atlas.ts";
import type { LoadedFont } from "../engine/bmfont.ts";
import { HD } from "../gd/sheets.ts";
import type { Settings } from "../gd/save.ts";
import { drawUiSprite, type LooseTexture, type UiFrame } from "./sprites.ts";

/* ================= Slider — m1 0x2952d4 ================= */

/** the four **loose** textures `Slider::init` loads; none of them is an atlas frame */
export const SLIDER_GROOVE = "slidergroove.png";
export const SLIDER_BAR = "sliderBar.png";
export const SLIDER_THUMB = "sliderthumb.png";
export const SLIDER_THUMB_SEL = "sliderthumbsel.png";
/** `m_length = groove.contentSize.width - 4` — Slider::init +196..212 */
export const SLIDER_LENGTH_INSET = 4;
/** `m_height = 8.0`, and the bar's rect is `(0, 0, length, 8)` — +216 */
export const SLIDER_BAR_HEIGHT = 8;
/** the bar sprite is anchored (0,0) at (2, 4) inside the groove — +320..336 */
export const SLIDER_BAR_OFFSET_X = 2;
export const SLIDER_BAR_OFFSET_Y = 4;

/**
 * `SliderThumb::getValue` (m1 `0x2943f0`) is
 * `(pos.x + m_length * scale * 0.5) / (m_length * scale)` and `setValue`
 * (`0x294474`) is its inverse, so the thumb travels **± length*scale/2 about
 * the slider's centre**.
 *
 * The thumb's `m_length` is **not** the slider's: `SliderTouchLogic::init`
 * (m1 `0x294650` +80..200) writes a constant **200** into the new thumb
 * (`+0x190`), while `Slider::init` sizes the *bar* from the groove (206). So a
 * full bar ends 3 units past the thumb's centre — visible in any native
 * capture, and read back off the live node tree (REFERENCE.md §19.8): the pause
 * menu's music thumb sits at x = 10.2578 for a value of 0.564111 at scale 0.8,
 * which is 200, not 206.
 */
export const SLIDER_THUMB_LENGTH = 200;

export function thumbOffset(value: number, length: number, scale: number): number {
  return (Math.min(1, Math.max(0, value)) - 0.5) * length * scale;
}

/** the inverse: a design-space x offset from the slider's centre back to 0..1 */
export function valueFromOffset(offsetX: number, length: number, scale: number): number {
  if (!(length > 0) || !(scale > 0)) return 0;
  return Math.min(1, Math.max(0, offsetX / (length * scale) + 0.5));
}

export interface SliderTextures {
  groove: LooseTexture & { frame: SpriteFrame };
  bar: LooseTexture & { frame: SpriteFrame };
  thumb: LooseTexture & { frame: SpriteFrame };
  thumbSel: LooseTexture & { frame: SpriteFrame };
}

/** `m_length`, in design units, for a groove of this texture width */
export function sliderLength(grooveTexW: number): number {
  return grooveTexW * HD - SLIDER_LENGTH_INSET;
}

export interface DrawSliderArgs {
  renderer: Renderer;
  textures: SliderTextures;
  /** the slider's centre, in design space */
  cx: number;
  cy: number;
  value: number;
  scale: number;
  /** `sliderthumbsel` replaces `sliderthumb` while the thumb is held */
  held: boolean;
}

/**
 * Groove, filled bar and thumb, composed the way `Slider` composes them: the
 * bar is a **repeat-wrapped** texture whose rect is widened, not a stretched
 * sprite, so its pattern keeps its own pitch however long the fill is.
 */
export function drawSlider(a: DrawSliderArgs) {
  const { renderer, textures: t } = a;
  const grooveW = t.groove.texW * HD * a.scale;
  const grooveH = t.groove.texH * HD * a.scale;
  renderer.draw(t.groove.tex, t.groove.texW, t.groove.texH, t.groove.frame,
    a.cx, a.cy, grooveW, grooveH, 0, 1, 1, 1, 1);

  const length = sliderLength(t.groove.texW);
  const filled = length * a.scale * Math.min(1, Math.max(0, a.value));
  if (filled > 0) {
    // the groove's own bottom-left, plus the sourced (2, 4) inset
    const left = a.cx - grooveW / 2 + SLIDER_BAR_OFFSET_X * a.scale;
    const bottom = a.cy - grooveH / 2 + SLIDER_BAR_OFFSET_Y * a.scale;
    const h = SLIDER_BAR_HEIGHT * a.scale;
    const f = t.bar.frame;
    renderer.draw(t.bar.tex, t.bar.texW, t.bar.texH,
      { ...f, w: filled / (HD * a.scale) },
      left + filled / 2, bottom + h / 2, filled, h, 0, 1, 1, 1, 1);
  }

  const thumb = a.held ? t.thumbSel : t.thumb;
  renderer.draw(thumb.tex, thumb.texW, thumb.texH, thumb.frame,
    a.cx + thumbOffset(a.value, SLIDER_THUMB_LENGTH, a.scale), a.cy,
    thumb.texW * HD * a.scale, thumb.texH * HD * a.scale, 0, 1, 1, 1, 1);
}

/* ============ GJDropDownLayer / GJListLayer — 0x5124fc, 0x4fec74 ============ */

/** `initWithColor({0, 0, 0, 125})` dims the scene behind the panel — init +80..96 */
export const DROP_DIM_OPACITY = 125 / 255;
/** `GJListLayer::create(..., ccColor4B(0,0,0,180), 356, height, 0)` — init +288..316 */
export const LIST_WIDTH = 356;
export const LIST_COLOR: readonly [number, number, number] = [0, 0, 0];
export const LIST_OPACITY = 180 / 255;
/** `GJDropDownLayer::init(title)` passes height 220 — 0x512908 +0 */
export const DROP_HEIGHT = 220;
/** list position `((winW - 356)/2, (winH - height)/2 - 10 + 5)` — init +344..396 */
export const LIST_Y_NUDGE = -5;
/** `GJ_table_bottom_001.png` at `(width/2, -10)`, z 10 — GJListLayer +144..208 */
export const TABLE_BOTTOM_Y = -10;
/** `GJ_table_top_001.png` at `(width/2, height - 5 + 20)`, z 10 — +224..328 */
export const TABLE_TOP_Y = 15;
/** the two `GJ_table_side_001.png` at x -20 and width+20, scaled to the height */
export const TABLE_SIDE_INSET = 20;
/** the title sits at `topSprite.position + (0, 3)`, `limitLabelWidth(280, 0.8, 0)` */
export const TITLE_DY = 3;
export const TITLE_MAX_WIDTH = 280;
export const TITLE_SCALE = 0.8;
/** back arrow `GJ_arrow_03_001.png` at `(screenLeft + 24, screenTop - 23)`, sizeMult 1.6 */
export const DROP_BACK_X = 24;
export const DROP_BACK_Y = 23;
export const DROP_BACK_SIZE_MULT = 1.6;
/** the two `chain_01_001.png`, anchored (0.5, 0) at `winW/2 ± 156`, above the panel */
export const CHAIN_DX = 156;
export const CHAIN_DY = 12;
/** `CCEaseInOut(CCMoveTo(0.5, endPosition), 2.0)`, plus a 0.5 s fade to 125 */
export const DROP_DURATION = 0.5;
export const DROP_EASE_RATE = 2;

/** `CCEaseInOut::update` with rate 2 — the only easing the drop-down uses */
export function easeInOut(t: number, rate = DROP_EASE_RATE): number {
  const k = Math.min(1, Math.max(0, t)) * 2;
  return k < 1 ? 0.5 * Math.pow(k, rate) : 1 - 0.5 * Math.pow(2 - k, rate);
}

/**
 * The drop-down's starting progress. `GJDropDownLayer::showLayer` runs the
 * 0.5 s slide and fade unless game variable `"0168"` (Fast Menu) is set, in
 * which case it snaps to the settled end (REFERENCE.md §16.1). `1` is the
 * settled, fully dimmed state; `0` is the animation's start.
 */
export function initialDropProgress(fastMenu: boolean): number {
  return fastMenu ? 1 : 0;
}

export interface DropDownLayout {
  /** panel size */
  width: number;
  height: number;
  /** the panel's bottom-left corner, in design space */
  left: number;
  bottom: number;
  /** panel centre, for the nine-slice-free plain colour rect */
  cx: number;
  cy: number;
  /** the title label's anchor */
  titleX: number;
  titleY: number;
  /** back arrow */
  backX: number;
  backY: number;
  /** how far above `bottom` the layer sits while sliding in (0 = settled) */
  slide: number;
}

/**
 * `GJDropDownLayer`'s geometry for a view of this size. `t` is the show
 * animation's progress, 0..1; the layer starts a full screen height above its
 * settled position (`m_startPosition = (0, winH)`) and eases to `(0, 0)`.
 */
export function dropDownLayout(
  viewW: number, viewH: number, height = DROP_HEIGHT, t = 1,
): DropDownLayout {
  const slide = viewH * (1 - easeInOut(t));
  const left = -LIST_WIDTH / 2;
  const bottom = -height / 2 + LIST_Y_NUDGE + slide;
  return {
    width: LIST_WIDTH,
    height,
    left,
    bottom,
    cx: 0,
    cy: bottom + height / 2,
    titleX: 0,
    titleY: bottom + height + TABLE_TOP_Y + TITLE_DY,
    backX: -viewW / 2 + DROP_BACK_X,
    backY: viewH / 2 - DROP_BACK_Y + slide,
    slide,
  };
}

/* ============ GameToolbox::createToggleButton — m1 0x448c1c ============ */

export const TOGGLE_ON_FRAME = "GJ_checkOn_001.png";
export const TOGGLE_OFF_FRAME = "GJ_checkOff_001.png";
/** every toggle in the game is created with `setSizeMult` — 1.5 here, 1.0 in GJOptionsLayer */
export const TOGGLE_SIZE_MULT = 1.5;

export interface ToggleLabelArgs {
  /** the check box's centre */
  x: number;
  y: number;
  /** the box's content size, already scaled */
  boxW: number;
  boxH: number;
  /** `labelOffset` */
  offsetX: number;
  offsetY: number;
  /** `labelTop`: true puts the label above the box, false to its right */
  labelTop: boolean;
}

/**
 * Where `createToggleButton` puts the label, and with which anchor.
 *
 * - `labelTop` (+376..460): anchor (0.5, 0), position
 *   `box + (offset.x, box.height*0.5*scale + offset.y)` — centred **above**;
 * - otherwise (+464..536): anchor (0, 0.5), position
 *   `box + (box.width*0.5*scale + offset.x, offset.y)` — left-anchored to the
 *   **right** of the box.
 *
 * `align` is this port's -1/0/1 convention for `LoadedFont.draw`.
 */
export function toggleLabelPosition(a: ToggleLabelArgs): {
  x: number; y: number; align: -1 | 0 | 1; baseline: "bottom" | "middle";
} {
  return a.labelTop
    ? { x: a.x + a.offsetX, y: a.y + a.boxH / 2 + a.offsetY, align: 0, baseline: "bottom" }
    : { x: a.x + a.boxW / 2 + a.offsetX, y: a.y + a.offsetY, align: -1, baseline: "middle" };
}

/* ============ OptionsLayer::customSetup — m1 0x6a1ba0 ============ */

/**
 * The seven `ButtonSprite` buttons, in the order `customSetup` adds them, with
 * the width each is created at and its offset from the button menu's origin —
 * which is `(winW*0.5, winH*0.5 + 80)`.
 *
 * `supported` records what this port does with the press. Every one of these is
 * drawn, positioned and animated exactly as the original does it; the ones
 * marked `false` are the plan's explicit out-of-scope exceptions and do
 * nothing. None of them shows invented state.
 */
export interface OptionsButton {
  id: string;
  /** the original's caption, verbatim */
  label: string;
  /** `ButtonSprite::create(text, width, ...)` */
  width: number;
  dx: number;
  dy: number;
  /** the original's handler, for the record */
  handler: string;
  supported: boolean;
  /** why it is inert, when it is */
  note?: string;
}

/** the button menu's origin — customSetup +60..108 */
export const BUTTON_MENU_Y = 80;

export const OPTIONS_BUTTONS: readonly OptionsButton[] = [
  {
    id: "account", label: "Account", width: 130, dx: -79, dy: 0,
    handler: "onAccount", supported: false,
    note: "opens the online account layer; online is outside the locked scope, "
      + "and showing any account state would be inventing it",
  },
  {
    id: "howToPlay", label: "How To Play", width: 130, dx: 79, dy: 0,
    handler: "onHelp", supported: false,
    note: "opens the tutorial layer, a separate screen outside this task's scope",
  },
  {
    id: "options", label: "Options", width: 130, dx: -79, dy: -40,
    handler: "onOptions", supported: true,
    note: "opens MoreOptionsLayer; this port opens the supported subset of it",
  },
  {
    id: "graphics", label: "Graphics", width: 130, dx: 79, dy: -40,
    handler: "onVideo", supported: false,
    note: "texture quality, fullscreen and refresh rate are the browser's and "
      + "the compositor's to decide here — see REFERENCE.md §16.3",
  },
  {
    id: "rate", label: "Rate", width: 78, dx: -105, dy: -80,
    handler: "onRate", supported: false, note: "opens the platform store",
  },
  {
    id: "songs", label: "Songs", width: 78, dx: 0, dy: -80,
    handler: "onSoundtracks", supported: false,
    note: "the online soundtrack list; online is outside the locked scope",
  },
  {
    id: "help", label: "Help", width: 78, dx: 105, dy: -80,
    handler: "onSupport", supported: false, note: "opens the support page",
  },
];

/** `GJ_lockGray_001.png` until `getStat(\"12\") > 9`, then `GJ_lock_open_001.png` */
export const VAULT_LOCKED_FRAME = "GJ_lockGray_001.png";
export const VAULT_OPEN_FRAME = "GJ_lock_open_001.png";
/** the lock's menu sits at `(winW - 20, winH - 18)`, the item at its origin */
export const VAULT_X = -20;
export const VAULT_Y = -18;
/** `setSizeMult(1.5)` — customSetup +1552..1560 */
export const VAULT_SIZE_MULT = 1.5;
/** the coin count the original needs before the lock opens — `cmp w0, #9` + `gt` */
export const VAULT_COIN_REQUIREMENT = 10;
/** while locked, the lock carries a coin icon at (+7.5, y) scale 0.5 and a count */
export const VAULT_COIN_ICON = "GJ_coinsIcon2_001.png";
export const VAULT_COIN_ICON_DX = 7.5;
export const VAULT_COIN_ICON_SCALE = 0.5;
export const VAULT_COUNT_DX = -7.5;
export const VAULT_COUNT_SCALE = 0.4;
/** both hang off `(lock.width*0.5, lock.height*0.5 - 21)` — +1252..1316 */
export const VAULT_BADGE_DY = -21;

/** "Music" at `(winW*0.5, winH*0.5 - 34)`, scale 0.6 — customSetup +1612..1692 */
export const MUSIC_LABEL_Y = -34;
export const LABEL_SCALE = 0.6;
/** every slider hangs 20 below its label — +1772..1800 */
export const SLIDER_LABEL_GAP = -20;
/** the SFX label is 40 below the music label — +1924..1956 */
export const SFX_LABEL_DY = -40;
/** `Slider::create(target, handler)` with no scale argument, i.e. 1.0 */
export const OPTIONS_SLIDER_SCALE = 1;
/** the "Menu\nMusic" toggle at `musicLabel + (145, -35)` — +2244..2280 */
export const MENU_MUSIC_DX = 145;
export const MENU_MUSIC_DY = -35;
/** its `createToggleButton` arguments — +2332..2392 */
export const MENU_MUSIC_BUTTON_SCALE = 0.6;
export const MENU_MUSIC_LABEL_SCALE = 0.35;
export const MENU_MUSIC_LABEL_OFFSET_Y = 2;
export const MENU_MUSIC_LABEL = "Menu\nMusic";
/** the game variable, stored **inverted**: set means menu music is off */
export const MENU_MUSIC_VARIABLE = "0122";

export interface OptionsLayout {
  /** the button menu's origin */
  buttonsX: number;
  buttonsY: number;
  musicLabelX: number;
  musicLabelY: number;
  musicSliderY: number;
  sfxLabelY: number;
  sfxSliderY: number;
  menuMusicX: number;
  menuMusicY: number;
  vaultX: number;
  vaultY: number;
}

/**
 * Every `OptionsLayer` position, in design space with the origin at the view
 * centre. Note these are **screen** positions, not panel-relative ones: the
 * original adds all of this to `m_mainLayer`, which is why they move together
 * with the drop-down animation and why the caller adds `slide` itself.
 */
export function optionsLayout(viewW: number, viewH: number): OptionsLayout {
  return {
    buttonsX: 0,
    buttonsY: BUTTON_MENU_Y,
    musicLabelX: 0,
    musicLabelY: MUSIC_LABEL_Y,
    musicSliderY: MUSIC_LABEL_Y + SLIDER_LABEL_GAP,
    sfxLabelY: MUSIC_LABEL_Y + SFX_LABEL_DY,
    sfxSliderY: MUSIC_LABEL_Y + SFX_LABEL_DY + SLIDER_LABEL_GAP,
    menuMusicX: MENU_MUSIC_DX,
    menuMusicY: MUSIC_LABEL_Y + MENU_MUSIC_DY,
    vaultX: viewW / 2 + VAULT_X,
    vaultY: viewH / 2 + VAULT_Y,
  };
}

/* ====== GJOptionsLayer / GameOptionsLayer — 0x23b7a0, 0x24f210, 0x24f268 ====== */

/** `SetupTriggerPopup::init(nullptr, nullptr, 400, 280, background)` — GJOptionsLayer +36..60 */
export const POPUP_W = 400;
export const POPUP_H = 280;
/** `GJ_square0%i.png` with `background = 2` — GameOptionsLayer::init +40 */
export const POPUP_BACKGROUND = "GJ_square02.png";
/** `FLAlertLayer::init(opacity)` dims the scene behind the popup */
export const POPUP_DIM_OPACITY = 0.5;
/** close button `GJ_closeBtn_001.png` at scale 0.8, sizeMult 1.5 — +164..236 */
export const POPUP_CLOSE_FRAME = "GJ_closeBtn_001.png";
export const POPUP_CLOSE_SCALE = 0.8;
export const POPUP_CLOSE_SIZE_MULT = 1.5;
/** at `(winW/2 - w/2 + 3, winH/2 + h/2 - 3)` — +260..360 */
export const POPUP_CLOSE_DX = 3;
export const POPUP_CLOSE_DY = -3;
/** page arrows `GJ_arrow_01_001.png` at `screenLeft + 20` / `screenRight - 20` */
export const POPUP_ARROW_FRAME = "GJ_arrow_01_001.png";
export const POPUP_ARROW_INSET = 20;
export const POPUP_ARROW_SIZE_MULT = 1.5;

/** `setupOptions` writes these three before adding a single toggle — +44..64 */
export const GAME_OPTIONS_Y_OFFSET = 32;
export const GAME_OPTIONS_ROW_STEP = 37;
export const GAME_OPTIONS_PER_PAGE = 12;
/** `addToggleInternal`: toggle scale 0.8, label offset (8, 0), sizeMult 1 — +284..432 */
export const GAME_OPTIONS_TOGGLE_SCALE = 0.8;
export const GAME_OPTIONS_LABEL_DX = 8;
/**
 * `GameOptionsLayer::init` writes `0.4` into the max-label-scale field
 * (`+0x3c0`, init +24..32). The companion max-label-**width** field (`+0x3c4`)
 * is read by `addToggleInternal` but **never written on this path**, so no
 * width limit is reproduced here. Flagged rather than guessed.
 */
export const GAME_OPTIONS_LABEL_SCALE = 0.4;
/** `nextPosition`: two columns at `winW/2 - 160` and `winW/2 + 32` — +56..128 */
export const GAME_OPTIONS_COL_X: readonly [number, number] = [-160, 32];

/**
 * `MoreOptionsLayer::nextPosition` (m1 `0x6a53c8`) is the same two columns and
 * the same `winH*0.5 + 80` base, but its row step is **48** (`floor(n/2) * 3
 * << 4`, +176..204) and it has no page offset.
 */
export const MORE_OPTIONS_ROW_STEP = 48;
/** `MoreOptionsLayer::init`: the title sits 16 below the panel's top at scale 0.7 — +392..480 */
export const POPUP_TITLE_INSET = 16;
export const POPUP_TITLE_SCALE = 0.7;
/**
 * `MoreOptionsLayer` builds its own close button (init +4164..4312): full
 * size — no `setScale` — sizeMult 1.5, at `(centre - 200 + 5, centre + 140 - 5)`.
 * `GJOptionsLayer`'s is 0.8 at `(-w/2 + 3, h/2 - 3)`.
 */
export const MORE_OPTIONS_CLOSE_SCALE = 1;
export const MORE_OPTIONS_CLOSE_INSET = 5;

/**
 * `nextPosition(page)`: the `n`-th toggle on a page alternates left/right
 * column and steps down one row every two toggles. Shared by
 * `GJOptionsLayer::nextPosition` (m1 `0x23c494`) and `MoreOptionsLayer`'s,
 * which differ only in `step` and `yOffset`.
 */
export function togglePosition(
  index: number, yOffset = GAME_OPTIONS_Y_OFFSET, step = GAME_OPTIONS_ROW_STEP,
): { x: number; y: number } {
  return {
    x: GAME_OPTIONS_COL_X[index % 2],
    y: BUTTON_MENU_Y + yOffset - Math.floor(index / 2) * step,
  };
}

/**
 * The rows `GameOptionsLayer::setupOptions` adds, in order, each with the game
 * variable it is stored under and what this port does with it.
 *
 * Rows this port cannot honour are still listed — that is the inventory the
 * plan asks for — but only the `setting`-carrying ones are drawn, because a
 * checkbox that does nothing would be exactly the invented state the plan
 * forbids. REFERENCE.md §16.2 carries the same table with the reasons.
 */
export interface GameOption {
  label: string;
  gameVariable: string;
  /** the `Settings` key this port stores it under, or null when unsupported */
  setting: keyof Settings | null;
  /** the original's info text, verbatim, where it has one */
  info?: string;
  note?: string;
}

export const GAME_OPTIONS: readonly GameOption[] = [
  {
    label: "Auto-Retry", gameVariable: "0026", setting: null,
    note: "the port always retries on the death animation's own timer",
  },
  {
    label: "Auto-Checkpoints", gameVariable: "0027", setting: "autoCheckpoints",
  },
  { label: "Show Progress Bar", gameVariable: "GameManager+0x374", setting: "showProgressBar" },
  { label: "Show Percentage", gameVariable: "0040", setting: "showPercentage" },
  {
    label: "Show Time", gameVariable: "0145", setting: null,
    note: "the port does not track a per-attempt clock",
  },
  {
    label: "Audio Visualizer", gameVariable: "0144", setting: null,
    note: "needs FMOD's spectrum data; the port streams decoded buffers",
  },
  {
    label: "Show Info Label", gameVariable: "0109", setting: null,
    note: "the editor/start-position label, outside the locked scope",
  },
  {
    label: "Disable Checkpoints", gameVariable: "0146", setting: null,
    note: "an anti-cheat rule for online levels",
  },
  {
    label: "Show Hitboxes", gameVariable: "0166", setting: null,
    info: "Shows hitboxes while in practice mode.",
    note: "the port has its own `?hitboxes=1` debug view, which is not this option",
  },
  {
    label: "Hitbox On Death", gameVariable: "0179", setting: null,
    info: "Shows hitboxes upon death in both normal and practice mode.",
    note: "same as `Show Hitboxes`: the port's hitbox view is a debug route, "
      + "not a saved gameplay option",
  },
];

/**
 * `MoreOptionsLayer` is paged. `init` adds its rows in one long run and rounds
 * the running count up to the next multiple of 10 between groups (+840..884,
 * repeated five times), so every group starts a page and a page holds at most
 * ten rows, `nextPosition` laying them out two per line. `goToPage` titles
 * each page from a seven-entry table (m1 `0x1008a8798`):
 */
export const MORE_OPTIONS_PAGE_TITLES = [
  "Gameplay", "Visual", "Visual", "Practice", "Performance", "Audio", "Other",
] as const;

export interface MoreOptionsPage {
  /** the page's index in the original — and so its title */
  page: number;
  title: string;
  /** the page's rows in `init`'s order: each row's index is its slot */
  options: readonly GameOption[];
}

/**
 * The pages this port shows: the two that carry a row it can honour, each with
 * its original title and every row in its original slot. The other five pages
 * hold only rows the port has nothing behind (REFERENCE.md §16.4); paging
 * through them would show five empty panels, so the arrows step between these
 * two instead — the one place the port's popup visibly departs from the
 * original's page count.
 */
export const MORE_OPTIONS_PAGES: readonly MoreOptionsPage[] = [
  {
    // the start of the first "Visual" page, `init` +892..988
    page: 1, title: MORE_OPTIONS_PAGE_TITLES[1],
    options: [
      {
        label: "Show Cursor In-Game", gameVariable: "0024", setting: "showPauseButton",
        info: "Shows cursor and pause button during gameplay.",
      },
      {
        label: "Hide Attempts", gameVariable: "0135", setting: "hideAttempts",
        info: "Hides the attempt counter when playing levels.",
      },
      {
        label: "Flip Pause Button", gameVariable: "0015", setting: "pauseButtonOnLeft",
        info: "Flips the location of the pause button.",
      },
    ],
  },
  {
    // the "Other" page, `init` +2268..2456
    page: 6, title: MORE_OPTIONS_PAGE_TITLES[6],
    options: [
      {
        label: "More Comments", gameVariable: "0094", setting: null,
        info: "Shows more comments per page. Why not?", note: "online comments, out of scope",
      },
      {
        label: "Load Comments", gameVariable: "0090", setting: null,
        info: "Loads comments automatically.", note: "online comments, out of scope",
      },
      {
        label: "New Completed Filter", gameVariable: "0073", setting: null,
        note: "an online level-search filter, out of scope",
      },
      {
        label: "Increase Local Levels\nPer Page", gameVariable: "0093", setting: null,
        note: "the editor's level list, out of scope",
      },
      {
        label: "Manual Level Order", gameVariable: "0084", setting: null,
        note: "the editor's saved-level list, out of scope",
      },
      {
        label: "Percentage Decimals", gameVariable: "0126", setting: "percentageDecimals",
        info: "Shows decimals in level progress.",
      },
      // Slots 6..8, from `init`'s addToggle order (exe 0x140373740, page = count / 10)
      {
        label: "Show Leaderboard\nPercentage", gameVariable: "0099", setting: null,
        note: "an online leaderboard option, out of scope",
      },
      {
        label: "Do Not...", gameVariable: "0095", setting: null,
        note: "the original's own description says it does nothing useful",
      },
      {
        label: "Confirm Exit", gameVariable: "0167", setting: null,
        note: "the port's pause menu exits without a confirmation window; not wired",
      },
      {
        // the tenth and last toggle of the page: `addToggle("Fast\nMenu", "0168", ...)` at exe
        // 0x14037415f, the count then being 69 (page 6, slot 9)
        label: "Fast\nMenu", gameVariable: "0168", setting: "fastMenu",
        info: "Makes transitions between menu pages faster.",
      },
    ],
  },
];

/** every MoreOptions row this port inventories, across its pages */
export const MORE_OPTIONS: readonly GameOption[] = MORE_OPTIONS_PAGES.flatMap((p) => p.options);

/**
 * The page arrows (`init` +4328..4640): `GJ_arrow_01_001` at full size, sizeMult
 * 1.5, at `(screenLeft + 20, winH/2)`, and a `setFlipX` copy at
 * `(screenRight - 20, winH/2)`. `goToPage` wraps both ways (`page < 0` → last,
 * `page > last` → 0, +28..44) and leaves both arrows visible (+912..948).
 */
export const MORE_OPTIONS_ARROW_FRAME = "GJ_arrow_01_001.png";
export const MORE_OPTIONS_ARROW_INSET = 20;
export const MORE_OPTIONS_ARROW_SIZE_MULT = 1.5;

/**
 * `MoreOptionsLayer::addToggle` (m1 `0x6a43e8`) passes its own label limits to
 * `createToggleButton`: max scale 0.4, max width **130** (+512..540); and when
 * the row has a description it adds `GJ_infoIcon_001` at scale 0.5, sizeMult
 * 2, at `toggle + (-18, 16)` (+988..1168).
 */
export const MORE_OPTIONS_LABEL_MAX_WIDTH = 130;
export const INFO_ICON_SCALE = 0.5;
export const INFO_ICON_SIZE_MULT = 2;
export const INFO_ICON_DX = -18;
export const INFO_ICON_DY = 16;

/* ================= shared drawing helpers ================= */

/** a `CCLabelBMFont` drawn at a cocos scale, with this port's align convention */
export function drawLabel(
  renderer: Renderer, font: LoadedFont, text: string,
  x: number, y: number, cocosScale: number, align: -1 | 0 | 1 = 0,
  baseline: "middle" | "bottom" = "middle", a = 1,
) {
  // `LoadedFont.draw` takes the glyph **baseline**. A cocos label anchored at
  // y = 0.5 has its line box's middle at the anchor; at y = 0 the line box's
  // *bottom* is there, and the baseline sits `lineHeight - base` above it —
  // 4.9 units for bigFont at 0.35, which is the gap a native capture shows
  // under the "Menu Music" caption (REFERENCE.md §19.7).
  const sc = HD * cocosScale;
  const baselineY = baseline === "middle"
    ? y - (font.font.base - font.font.lineHeight / 2) * sc
    : y + (font.font.lineHeight - font.font.base) * sc;
  font.draw(renderer, text, x, baselineY, sc, 1, 1, 1, a, align);
}

export interface DrawToggleArgs {
  renderer: Renderer;
  font: LoadedFont;
  on: UiFrame;
  off: UiFrame;
  value: boolean;
  x: number;
  y: number;
  /** the item's animated scale, from `MenuItem` */
  itemScale?: number;
  boxScale: number;
  label: string;
  labelScale: number;
  /** `limitLabelWidth`'s width; the label shrinks below `labelScale` to fit it */
  labelMaxWidth?: number;
  labelTop: boolean;
  labelOffsetX: number;
  labelOffsetY: number;
}

/** one checkbox plus its label, exactly as `createToggleButton` composes them */
export function drawToggle(a: DrawToggleArgs) {
  const frame = a.value ? a.on : a.off;
  const scale = a.boxScale * (a.itemScale ?? 1);
  drawUiSprite(a.renderer, frame, a.x, a.y, { scale });
  const pos = toggleLabelPosition({
    x: a.x, y: a.y,
    boxW: frame.frame.sourceW * HD * a.boxScale,
    boxH: frame.frame.sourceH * HD * a.boxScale,
    offsetX: a.labelOffsetX, offsetY: a.labelOffsetY, labelTop: a.labelTop,
  });
  // A `CCLabelBMFont` lays its lines out as one block and the anchor applies to
  // the block, so a two-line caption anchored at its bottom stacks **upward**
  // from `pos.y` — drawing the first line there and the rest below would put
  // the second line straight through the check box.
  const lines = a.label.split("\n");
  // `CCLabelBMFont::limitLabelWidth(width, scale, 0)`: shrink to fit the
  // widest line when a width is given, never grow past `labelScale`
  let labelScale = a.labelScale;
  if (a.labelMaxWidth && a.labelMaxWidth > 0) {
    const natural = Math.max(...lines.map((l) => a.font.measure(l))) * HD;
    if (natural * labelScale > a.labelMaxWidth) labelScale = a.labelMaxWidth / natural;
  }
  const step = labelScale * HD * a.font.font.lineHeight;
  lines.forEach((line, i) => {
    const dy = pos.baseline === "bottom"
      ? (lines.length - 1 - i) * step
      : ((lines.length - 1) / 2 - i) * step;
    drawLabel(a.renderer, a.font, line, pos.x, pos.y + dy,
      labelScale, pos.align, pos.baseline);
  });
}
