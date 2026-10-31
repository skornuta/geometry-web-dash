/**
 * `GJGarageLayer` — the icon garage — and the `CharacterColorPage` popup it
 * opens, reproduced from the shipping 2.2081 binary (m1 `0x2f34d8`, its
 * `setupIconSelect` `0x2f55a0` and `setupPage` `0x2f6ed8`, and `0x57c894`).
 *
 * The working is in `docs/ui-parity/REFERENCE.md` §12-13. What this replaced:
 * a custom dark layout with a 10x3 grid, a textual mode/index preview and two
 * compact 21-wide palettes. None of that was the original's; all of the
 * following is:
 *
 * - the icon grid is **12 x 3, 30 units apart**, on a 385x100 `square02_001`
 *   nine-slice at opacity 75 (`ListButtonPage::init` derives the step as
 *   `columnOffset + offset` = 5 + 25);
 * - the tabs are `CCMenuItemToggler`s with real off/on artwork, laid out by
 *   `alignItemsHorizontallyWithPadding(2)` at sprite scale 0.9;
 * - the palette is the game's own **107 colours** in an 18-column staggered
 *   grid driven by `colorForIndex`'s 143-slot table, not a 21x2 block.
 */

import { SceneFade } from "../engine/transition.ts";
import { Renderer } from "../engine/renderer.ts";
import { createTexture, loadImage, type SpriteFrame } from "../engine/atlas.ts";
import { LoadedFont } from "../engine/bmfont.ts";
import { AudioEngine } from "../engine/audio.ts";
import { MenuMusic } from "../engine/menuMusic.ts";
import { resolveView } from "../gd/camera.ts";
import { HD } from "../gd/sheets.ts";
import {
  GARAGE_TABS, gridScale, PLAYER_COLORS, iconFrames, playerColor, clampIcon,
  playerGlow, tabCount, trailIconFrame, deathEffectIconFrame,
  type GarageTab, type IconMode,
} from "../gd/icons.ts";
import { particleColors } from "../gd/effects.ts";
import { IconSheets } from "../gd/iconSheets.ts";
import { BACK_LIMB_TINT, ROBOT_ANIM, SPIDER_ANIM } from "../gd/anim.ts";
import { LEVELS } from "../gd/levels.ts";
import * as save from "../gd/save.ts";
import {
  UiSprites, drawNineSlice, drawUiSprite, fromGdUi, screenBounds,
  type LooseTexture, type UiFrame,
} from "../ui/sprites.ts";
import { MenuHost, MenuItem, UiMenu } from "../ui/controls.ts";
import { ASSET } from "../assetBase.ts";

/* ---------------- GJGarageLayer::init, m1 0x2f34d8 ---------------- */

/** a palette index as rgb bytes, clamped */
const kitColor = (i: number) => PLAYER_COLORS[Math.max(0, Math.min(PLAYER_COLORS.length - 1, i | 0))];

/** background stretch/overscan, as in LevelSelectLayer — init +164..300 */
const BG_OVERSCAN = 10;
/** `setColor({150, 150, 150})` — init +328 */
const BG_TINT: readonly [number, number, number] = [150, 150, 150];
/** the icon stands on `floorLine_001.png` at `(winW*0.5, winH*0.5 + 50)` — init +132, +2072 */
const FLOOR_LINE_Y = 50;
/** preview scale 1.6, sitting `scale * 30 * 0.5 + 1` above the line — init +2384..2480 */
const PREVIEW_SCALE = 1.6;
/** the tab menu: `(winW*0.5, winH*0.5 + 30)`, padding 2, sprites at 0.9 — setupIconSelect +2056..2084 */
const TAB_MENU_Y = 30;
const TAB_PADDING = 2;
const TAB_SPRITE_SCALE = 0.9;
/** selection panel: 385x100 `square02_001` at opacity 75, z -1 — setupIconSelect +128..256 */
const PANEL_W = 385;
const PANEL_H = 100;
const PANEL_OPACITY = 75 / 255;
/** panel centre `(winW*0.5, winH*0.5 - 5 - 72)` — setupIconSelect +68, +220 */
/**
 * `(winW*0.5, winH*0.5 - 5 - 60)` — setupIconSelect +56..68, +212..256. The
 * constant is `0xC2700000`, **-60**; it was read as -72 until a native capture
 * showed the whole grid 12 units low (REFERENCE.md §19.5).
 */
const PANEL_Y = -65;
/**
 * Two out-of-scope pieces of garage furniture, kept for the layout:
 * `GJ_shardsBtn_001` → `onShards` at `(30, winH - 80)` (init +3424..3530), and
 * The Shop's sign, `shopRope_001` → `onShop` at `(winW*0.5 - 135, winH - 25)`
 * (+3228..3410). The sign's button uses `useAnimationType(1)`, a move-down
 * press rather than the usual bounce, so it is drawn static rather than given
 * a press it does not have (REFERENCE.md §19.5).
 */
const SHARDS_X = 30;
const SHARDS_DY = -80;
const SHOP_DX = -135;
const SHOP_DY = -25;
/** the counter column — GJGarageLayer::init +3672..5700 */
const COUNTER_X = -18;
const COUNTER_Y = -12;
const COUNTER_STEP = -15;
const COUNTER_ICON_SCALE = 0.54;
const COUNTER_COIN_SCALE = 0.51;
const COUNTER_LABEL_DX = -12;
const COUNTER_LABEL_DY = 0.5;
const COUNTER_LABEL_SCALE = 0.34;
/** `GJ_unlockTxt_001.png` ("Tap 🔒 for more info!") 12 above the panel's top edge — +260..412 */
const UNLOCK_TXT_DY = 12;
/**
 * The page dots: a menu at `(winW*0.5, 25)` in screen space (setupIconSelect
 * +2696..2764), each dot's sprite scaled 0.9 **before** it is wrapped, aligned
 * with padding **6** (setupPage +872..1168).
 */
const DOTS_BOTTOM_Y = 25;
const DOT_SCALE = 0.9;
const DOT_PADDING = 6;
/**
 * The tab row has **11** togglers (setupIconSelect +460..1740). GD scales each
 * toggler's *sprites* to 0.9 after creating it, so the toggler's content size —
 * which drives both the alignment and the hit rect — stays the full sprite's.
 * The last three (jetpack, trail, death effect) are real tabs: each opens its own
 * grid and writes its own save field (`IconKit.jetpack` / `trail` / `deathEffect`).
 */
/** the grid: 12 columns, 3 rows; `ListButtonBar::create(..., 12, 3, 5, 5, 25, 220, 1)` */
const GRID_COLS = 12;
const GRID_ROWS = 3;
const GRID_COLUMN_OFFSET = 5;
const GRID_ROW_OFFSET = 5;
const GRID_OFFSET = 25;
/** `ListButtonPage::init`: step = columnOffset + offset, and the same for rows */
const GRID_STEP_X = GRID_COLUMN_OFFSET + GRID_OFFSET;
const GRID_STEP_Y = GRID_ROW_OFFSET + GRID_OFFSET;
/**
 * `startX = pos.x - cols*0.5*offset - (cols-1)*0.5*columnOffset + offset*0.5`,
 * which for 12 columns is exactly 165 left of the panel centre.
 */
const GRID_START_DX = -(GRID_COLS * 0.5 * GRID_OFFSET)
  - ((GRID_COLS - 1) * 0.5 * GRID_COLUMN_OFFSET) + GRID_OFFSET * 0.5;
/** top row is `(rows-1)/2` steps above the centre */
const GRID_START_DY = ((GRID_ROWS - 1) / 2) * GRID_STEP_Y;
const PER_PAGE = GRID_COLS * GRID_ROWS;
/** `ListButtonBar::create`'s arrowOffset = 220, arrowType = 1 (§12.1). */
const PAGE_ARROW_OFFSET = 220;
const PAGE_ARROW_FRAME = "GJ_arrow_01_001.png";
/** back arrow `(screenLeft + 24, screenTop - 23)`, sizeMult 1.6 — init +3168..3188 */
const BACK_INSET_X = 24;
const BACK_INSET_Y = 23;
const BACK_SIZE_MULT = 1.6;
/** paint button at `(30, winH - 120)` — init +3604..3628 */
const PAINT_X = 30;
const PAINT_DY = -120;

/**
 * `GJ_select_001.png` at scale 0.85, added to the layer twice at z 1 — one ring
 * over the selected grid cell, one over the selected tab.
 * — setupIconSelect +2120..2236
 */
const SELECT_SCALE = 0.85;
/**
 * `getItems` builds every grid icon with **grey (175,175,175) primary and white
 * secondary**, not the player's own colours — which is why the original's grid
 * reads as monochrome while the preview above it is in colour.
 * — getItems +332..356
 */
const GRID_ICON_COLOR1: readonly [number, number, number] = [175, 175, 175];
const GRID_ICON_COLOR2: readonly [number, number, number] = [255, 255, 255];
/**
 * Per-icon-type grid scale: `getItems`' 15-float table indexed by
 * `unlockType - 1` (see `gridScale`). Ship is 0.6, not 1.0: with 1.0 the 36 ships on
 * a page overflow their 30-unit cells.
 */
const GRID_ICON_SCALE = (tab: GarageTab): number => gridScale(tab);
/**
 * The grid icons are drawn at the sourced per-type scale with no shrink: against
 * the game's own garage screenshot (`docs/ui-parity/reference/native-garage-*`)
 * a cube is 82 px of a 105 px cell pitch, 0.78, which is the table's 0.8 of the
 * 30-unit cell. What made them look too large for their boxes was the white
 * `playerSquare_001` the port drew behind every icon: the game draws none —
 * the icons sit straight on the dark panel (the square only gives the cell its
 * hit area).
 */
const GRID_ICON_FIT = 1;

/** off/on toggler art per supported gamemode — setupIconSelect +464..1352 */
const TAB_FRAMES: Record<GarageTab, [string, string]> = {
  cube: ["gj_iconBtn_off_001.png", "gj_iconBtn_on_001.png"],
  ship: ["gj_shipBtn_off_001.png", "gj_shipBtn_on_001.png"],
  ball: ["gj_ballBtn_off_001.png", "gj_ballBtn_on_001.png"],
  ufo: ["gj_birdBtn_off_001.png", "gj_birdBtn_on_001.png"],
  wave: ["gj_dartBtn_off_001.png", "gj_dartBtn_on_001.png"],
  robot: ["gj_robotBtn_off_001.png", "gj_robotBtn_on_001.png"],
  spider: ["gj_spiderBtn_off_001.png", "gj_spiderBtn_on_001.png"],
  swing: ["gj_swingBtn_off_001.png", "gj_swingBtn_on_001.png"],
  jetpack: ["gj_jetpackBtn_off_001.png", "gj_jetpackBtn_on_001.png"],
  trail: ["gj_streakBtn_off_001.png", "gj_streakBtn_on_001.png"],
  deathEffect: ["gj_explosionBtn_off_001.png", "gj_explosionBtn_on_001.png"],
};

/* ---------------- CharacterColorPage, m1 0x57c894 ---------------- */

/** `GJ_square05.png` nine-slice at 450x300, centred, z -1 — init +156..260 */
const POPUP_W = 450;
const POPUP_H = 300;
/** close button `GJ_closeBtn_001.png` scale 0.8, sizeMult 1.6, panel corner +10/-10 — init +288..424 */
const POPUP_CLOSE_INSET = 10;
const POPUP_CLOSE_SCALE = 0.8;
const POPUP_CLOSE_SIZE_MULT = 1.6;
/** the live preview inside the colour popup: centred above the swatches (units above the popup centre) */
const POPUP_PREVIEW_DY = 78;
const POPUP_PREVIEW_SCALE = 1.4;
/** swatch grid: 18 per row, step (24, -24), base `(winW/2 - 204 + 6, winH/2 - 59 + 96)` */
const SWATCH_COLS = 18;
const SWATCH_STEP_X = 24;
const SWATCH_STEP_Y = -24;
const SWATCH_BASE_DX = -204 + 6;
const SWATCH_BASE_DY = -59 + 96;
/** `ColorChannelSprite::create()` drawn at 0.65 — createColorMenu +424 */
const SWATCH_SCALE = 0.65;
/** `offsetForIndex` returns a {0,1}x{-0.8,0,0.8} stagger, scaled by 12 */
const SWATCH_STAGGER = 12;
/** Col1 / Col2 / Glow run right to left from the panel's right edge — init +1620.. */
const MODE_BUTTON_DX = -137;
/** Gap between neighbouring mode buttons; the sourced -137 pitch pushed Glow under the close button at this panel width. */
const MODE_BUTTON_STEP = -112;
const MODE_BUTTON_DY = -17;
const MODE_BUTTON_SCALE = 0.85;
/** `ButtonSprite::create(caption, 40, 0, 0.4, false, "bigFont.fnt", "GJ_button_01.png", 20)` */
const MODE_BUTTON_W = 40;
const MODE_BUTTON_H = 20;
const MODE_BUTTON_TEXT_SCALE = 0.4;

/**
 * `CharacterColorPage::colorForIndex` (m1 `0x57e188`) — a 143-slot table at
 * `0x100736368` mapping grid slot to palette index, with `-1` for the gaps that
 * shape the block. Decoded verbatim; do not "tidy" the -1s away.
 */
const COLOR_SLOTS: readonly number[] = [
  51, 19, 48, 9, 62, 63, 10, 29, -1, 70, 42, 11, 27, 72, 73, 0, 1, -1,
  37, 53, 54, 55, 26, 59, 60, 61, -1, 71, 14, 31, 45, 105, 28, 32, 20, -1,
  25, 56, 57, 58, 30, 64, 65, 66, -1, 46, 67, 68, 69, 2, 38, 79, 80, -1,
  74, 75, 44, 3, 83, 16, 4, 5, -1, 52, 41, 6, 35, 98, 8, 36, 103, -1,
  40, 76, 77, 78, 22, 39, 84, 50, -1, 47, 23, 92, 93, 7, 13, 24, 104, -1,
  33, 21, 81, 82, 34, 85, 86, 87, -1, 49, 95, 96, 97, 43, 99, 100, 101, -1,
  -1, -1, -1, -1, 106, 88, 89, 90, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
  -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 12, 91, 17, 102, 18, 94, 15,
];

/**
 * `CharacterColorPage::offsetForIndex` (m1 `0x57e3e4`) reads this table of x
 * nudges at `0x1007365a4` — 139 floats, one per slot from 4 to 142, each 0 or 1
 * and multiplied by 12. Copied verbatim rather than re-derived from the pattern
 * it happens to follow. The y nudge is separate: **-0.8 for slots 54..135**
 * (`(index - 0x36) < 0x52` unsigned) and **+0.8 above 135**, same multiplier.
 */
const SWATCH_X_NUDGE: readonly number[] = [
  1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1,
];

function swatchOffset(slot: number): { x: number; y: number } {
  const i = slot - 4;
  const x = i >= 0 && i <= 0x8a ? SWATCH_X_NUDGE[i] : 0;
  const y = slot - 0x36 >= 0 && slot - 0x36 < 0x52 ? -0.8 : slot > 0x87 ? 0.8 : 0;
  return { x: x * SWATCH_STAGGER, y: y * SWATCH_STAGGER };
}

const GARAGE_FRAMES = [
  "GJ_sideArt_001.png", "floorLine_001.png", "playerSquare_001.png",
  "gj_navDotBtn_on_001.png", "gj_navDotBtn_off_001.png",
  "GJ_arrow_03_001.png", PAGE_ARROW_FRAME, "GJ_paintBtn_001.png", "GJ_select_001.png",
  "GJ_closeBtn_001.png", "GJ_starsIcon_001.png", "GJ_coinsIcon_001.png",
  "GJ_unlockTxt_001.png", "GJ_shardsBtn_001.png", "shopRope_001.png",
  ...Object.values(TAB_FRAMES).flat(),
] as const;

type Loose = LooseTexture & { frame: SpriteFrame };

/** a 2x2 opaque white texture — the only way to draw a flat rectangle here */
function whiteTexture(renderer: Renderer): Loose {
  const c = document.createElement("canvas");
  c.width = c.height = 2;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 2, 2);
  return {
    tex: createTexture(renderer.ctx, c), texW: 2, texH: 2,
    frame: { x: 0, y: 0, w: 2, h: 2, rotated: false, offsetX: 0, offsetY: 0, sourceW: 2, sourceH: 2 },
  };
}

async function loadLoose(renderer: Renderer, url: string): Promise<Loose> {
  const img = await loadImage(url);
  return {
    tex: createTexture(renderer.ctx, img), texW: img.width, texH: img.height,
    frame: {
      x: 0, y: 0, w: img.width, h: img.height, rotated: false,
      offsetX: 0, offsetY: 0, sourceW: img.width, sourceH: img.height,
    },
  };
}

export async function startGarage(renderer: Renderer) {
  /** `CCTransitionFade` in and out of this scene */
  const fade = new SceneFade(renderer);
  const sprites = await UiSprites.load(renderer, [
    "GJ_GameSheet03-hd", "GJ_GameSheet-hd", "GJ_GameSheetIcons-hd",
  ]);
  sprites.requireAll(GARAGE_FRAMES);
  // 2.2 keeps each icon in its own sheet; the legacy atlas above has only the
  // older half, so the visible page's icons are fetched as it is shown
  const iconSheets = new IconSheets(renderer, sprites);
  const loadVisibleIcons = () => {
    const first = page * PER_PAGE + 1;
    const want: [IconMode, number][] = [[previewMode, previewSelected()]];
    const m = mode();
    if (isIconTab(m)) {
      want.push([m, selected()]);
      for (let n = first; n < first + PER_PAGE && n <= tabCount(m); n++) want.push([m, n]);
    }
    iconSheets.loadAll(want).catch((e) => console.error("icon sheets failed to load:", e));
  };

  const [gradient, panelTex, popupTex, buttonTex] = await Promise.all([
    loadLoose(renderer, `${ASSET}GJ_gradientBG-hd.png`),
    loadLoose(renderer, `${ASSET}square02_001-hd.png`),
    loadLoose(renderer, `${ASSET}GJ_square05-hd.png`),
    loadLoose(renderer, `${ASSET}GJ_button_01-hd.png`),
  ]);
  const font = await LoadedFont.load(renderer, `${ASSET}bigFont-hd.fnt`, `${ASSET}bigFont-hd.png`);
  const white = whiteTexture(renderer);
  const audio = new AudioEngine(save.settings());
  const menuMusic = new MenuMusic(audio, () => save.settings().menuMusic);

  const kit = save.icons();

  let tab = 0;
  let page = 0;
  /** the colour popup: null when closed, otherwise which channel it edits */
  let popup: "col1" | "col2" | null = null;

  const mode = (): GarageTab => GARAGE_TABS[tab];
  /** the tabs that hold layered player icons; trail and death effect hold single frames */
  const isIconTab = (m: GarageTab): m is IconMode => m !== "trail" && m !== "deathEffect";
  const selected = () => clampIcon(mode(), kit[mode()] ?? 1);
  /**
   * The preview above the tabs shows the last *icon* tab opened (the original shows the
   * last icon type equipped, REFERENCE.md §19.5), so opening Trail or Death Effect
   * leaves the player on the stand.
   */
  let previewMode: IconMode = "cube";
  const previewSelected = () => clampIcon(previewMode, kit[previewMode] ?? 1);
  const openTab = (i: number) => {
    tab = i;
    const m = mode();
    if (isIconTab(m)) previewMode = m;
    syncPage();
  };
  // `setupPage +816..844`: `count / 36 + 1`, integer division — so a count that
  // is an exact multiple of 36 gets one empty trailing page, as in the original
  const pageCount = () => Math.floor(tabCount(mode()) / PER_PAGE) + 1;

  const syncPage = () => { page = Math.floor((selected() - 1) / PER_PAGE); };
  syncPage();

  const startMusic = () => menuMusic.gesture();

  const back = () => {
    if (popup) { popup = null; rebuild(); return; }
    fade.go(() => { audio.leaveMenuMusic(); location.search = ""; });
  };

  const setIcon = (n: number) => {
    const m = mode();
    const v = clampIcon(m, n);
    kit[m] = v;
    save.setIcons({ [m]: v } as Partial<typeof kit>);
    if (isIconTab(m)) previewMode = m;
  };

  const setColor = (which: "col1" | "col2", idx: number) => {
    const v = Math.max(0, Math.min(PLAYER_COLORS.length - 1, idx));
    kit[which] = v;
    save.setIcons({ [which]: v } as Partial<typeof kit>);
  };

  const toggleGlow = () => {
    kit.glow = !kit.glow;
    save.setIcons({ glow: kit.glow });
  };

  /* ---------------- controls ---------------- */

  let menus: UiMenu[] = [];
  let host: MenuHost | null = null;

  /** the whole control set is rebuilt when the tab, page or popup changes */
  function rebuild() {
    host?.dispose();
    loadVisibleIcons();
    const built: UiMenu[] = [];

    if (popup) {
      const swatches = new UiMenu("swatches");
      for (let slot = 0; slot < COLOR_SLOTS.length; slot++) {
        const idx = COLOR_SLOTS[slot];
        if (idx < 0) continue;
        swatches.add(new MenuItem({
          id: `swatch-${idx}`, frame: sprites.require("playerSquare_001.png"),
          spriteScale: SWATCH_SCALE,
          onActivate: () => { setColor(popup!, idx); },
        }));
      }
      built.push(swatches);

      const modeMenu = new UiMenu("popupModes");
      modeMenu.add(new MenuItem({
        id: "col1", frame: sprites.require("playerSquare_001.png"),
        onActivate: () => { popup = "col1"; rebuild(); },
      }));
      modeMenu.add(new MenuItem({
        id: "col2", frame: sprites.require("playerSquare_001.png"),
        onActivate: () => { popup = "col2"; rebuild(); },
      }));
      modeMenu.add(new MenuItem({
        id: "glow", frame: sprites.require("playerSquare_001.png"),
        onActivate: toggleGlow,
      }));
      modeMenu.add(new MenuItem({
        id: "popupClose", frame: sprites.require("GJ_closeBtn_001.png"),
        spriteScale: POPUP_CLOSE_SCALE, sizeMult: POPUP_CLOSE_SIZE_MULT,
        onActivate: () => { popup = null; rebuild(); },
      }));
      built.push(modeMenu);
    } else {
      const tabs = new UiMenu("tabs");
      const tabItem = (id: string, frameName: string, onActivate?: () => void) => {
        const f = sprites.require(frameName);
        return new MenuItem({
          id,
          // the toggler keeps the unscaled sprite's content size...
          content: { w: f.frame.sourceW * HD, h: f.frame.sourceH * HD },
          // ...while its sprite is drawn at 0.9
          render: (r, x, y, scale) => drawUiSprite(r, f, x, y, { scale: TAB_SPRITE_SCALE * scale }),
          onActivate,
        });
      };
      GARAGE_TABS.forEach((m, i) => {
        tabs.add(tabItem(`tab-${m}`, TAB_FRAMES[m][i === tab ? 1 : 0],
          () => { openTab(i); rebuild(); }));
      });
      tabs.alignItemsHorizontallyWithPadding(TAB_PADDING);
      built.push(tabs);

      const grid = new UiMenu("grid");
      const first = page * PER_PAGE + 1;
      for (let i = 0; i < PER_PAGE; i++) {
        const n = first + i;
        if (n > tabCount(mode())) break;
        grid.add(new MenuItem({
          id: `icon-${n}`, frame: sprites.require("playerSquare_001.png"),
          onActivate: () => { setIcon(n); rebuild(); },
        }));
      }
      built.push(grid);

      if (pageCount() > 1) {
        const arrows = new UiMenu("pageArrows");
        const frame = sprites.require(PAGE_ARROW_FRAME);
        for (const [id, direction] of [["prev", -1], ["next", 1]] as const) {
          arrows.add(new MenuItem({
            id, frame,
            render: (r, x, y, scale) => drawUiSprite(r, frame, x, y,
              { scale, flipX: direction > 0 }),
            onActivate: () => {
              page = (page + direction + pageCount()) % pageCount();
              rebuild();
            },
          }));
        }
        built.push(arrows);
      }

      const dots = new UiMenu("dots");
      for (let p = 0; p < pageCount(); p++) {
        dots.add(new MenuItem({
          id: `dot-${p}`,
          frame: sprites.require(p === page ? "gj_navDotBtn_on_001.png" : "gj_navDotBtn_off_001.png"),
          spriteScale: DOT_SCALE,
          onActivate: () => { page = p; rebuild(); },
        }));
      }
      dots.alignItemsHorizontallyWithPadding(DOT_PADDING);
      built.push(dots);

      const corner = new UiMenu("corner");
      corner.add(new MenuItem({
        id: "back", frame: sprites.require("GJ_arrow_03_001.png"),
        sizeMult: BACK_SIZE_MULT, onActivate: back,
      }));
      corner.add(new MenuItem({
        id: "shards", frame: sprites.require("GJ_shardsBtn_001.png"),
      }));
      corner.add(new MenuItem({
        id: "paint", frame: sprites.require("GJ_paintBtn_001.png"),
        onActivate: () => { popup = "col1"; rebuild(); },
      }));
      built.push(corner);
    }

    menus = built;
    host = new MenuHost(renderer.canvas, menus,
      () => resolveView(renderer.canvas.width, renderer.canvas.height).scale, startMusic);
  }
  rebuild();

  addEventListener("keydown", (e) => {
    startMusic();
    if (popup) {
      e.preventDefault();
      if (e.code === "Escape" && !e.repeat) back();
      return;
    }
    switch (e.code) {
      case "Escape": e.preventDefault(); back(); break;
      case "Tab": e.preventDefault(); openTab((tab + 1) % GARAGE_TABS.length); rebuild(); break;
      case "ArrowLeft": e.preventDefault(); setIcon(selected() - 1); syncPage(); rebuild(); break;
      case "ArrowRight": e.preventDefault(); setIcon(selected() + 1); syncPage(); rebuild(); break;
      case "KeyG": e.preventDefault(); toggleGlow(); break;
    }
  });

  /* ---------------- drawing ---------------- */

  let last = performance.now();

  const label = (text: string, x: number, y: number, cocosScale: number, align: -1 | 0 | 1 = 0) => {
    const sc = HD * cocosScale;
    font.draw(renderer, text, x, y - (font.font.base - font.font.lineHeight / 2) * sc,
      sc, 1, 1, 1, 1, align);
  };

  /**
   * Robot and spider are **seven skeletal parts**, not one sprite — the garage
   * builds them through `GJRobotSprite` / `GJSpiderSprite`, which is why the
   * previous grid showed nothing but heads. The pose is the game's own `idle`
   * frame out of `objectDefinitions.plist` (generated into `anim.ts`), so it is
   * animation evidence rather than the gameplay pose picked by convenience.
   */
  function drawLimbedIcon(
    m: "robot" | "spider", idx: number, x: number, y: number, scale: number, a: number,
    c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number },
    glow: ReturnType<typeof playerGlow> | null,
  ): boolean {
    const parts = (m === "robot" ? ROBOT_ANIM : SPIDER_ANIM).idle?.frames[0];
    if (!parts) return false;
    const dark = BACK_LIMB_TINT[m];
    const placed = parts.map((part) => {
      const put = (name: string | undefined, r: number, g: number, b: number) => {
        if (!name || !sprites.has(name)) return;
        drawUiSprite(renderer, sprites.require(name),
          x + part.x * scale, y + part.y * scale,
          { scale: scale * part.sx, rotation: (-part.r * Math.PI) / 180, r, g, b, a });
      };
      return { part, n: iconFrames(m, idx, part.l), put };
    });
    // one glow node behind the whole body (`GJRobotSprite::m_glowSprite`)
    if (glow?.visible) for (const { n, put } of placed) put(n.glow, glow.r, glow.g, glow.b);
    for (const { part, n, put } of placed) {
      const t = part.b ? dark : 1;
      put(n.main, c1.r * t, c1.g * t, c1.b * t);
      put(n.detail, c2.r * t, c2.g * t, c2.b * t);
      put(n.extra, t, t, t);
    }
    return true;
  }

  /** the layered icon; `colors` overrides the player's own, as the grid does */
  function drawIcon(
    m: IconMode, idx: number, x: number, y: number, scale: number, a = 1,
    colors?: readonly [readonly [number, number, number], readonly [number, number, number]],
  ) {
    const n = iconFrames(m, idx);
    const c1 = colors
      ? { r: colors[0][0] / 255, g: colors[0][1] / 255, b: colors[0][2] / 255 }
      : playerColor(kit.col1);
    const c2 = colors
      ? { r: colors[1][0] / 255, g: colors[1][1] / 255, b: colors[1][2] / 255 }
      : playerColor(kit.col2);
    const put = (name: string | undefined, r: number, g: number, b: number) => {
      if (!name || !sprites.has(name)) return;
      const f: UiFrame = sprites.require(name);
      drawUiSprite(renderer, f, x, y, { scale, r, g, b, a });
    };
    // the preview's glow is `SimplePlayer::updateColors`' — the same colour and
    // rule as the player's (`playerGlow`); the grid's grey icons have none
    const glow = colors ? null : playerGlow(kit.glow, kitColor(kit.col1),
      particleColors(kitColor(kit.col1), kitColor(kit.col2)).b);
    if ((m === "robot" || m === "spider") && drawLimbedIcon(m, idx, x, y, scale, a, c1, c2, glow)) return;
    if (glow?.visible) put(n.glow, glow.r, glow.g, glow.b);
    put(n.main, c1.r, c1.g, c1.b);
    put(n.detail, c2.r, c2.g, c2.b);
    put(n.extra, 1, 1, 1);
    put(n.dome, 1, 1, 1);
  }

  function layout(viewW: number, viewH: number) {
    const s = screenBounds(viewW, viewH);
    const gd = (x: number, y: number) => fromGdUi(x, y, viewW, viewH);
    const byId = (menu: string) => menus.find((m) => m.id === menu);

    if (popup) {
      const c = gd(viewW * 0.5, viewH * 0.5);
      const sw = byId("swatches");
      if (sw) {
        sw.setPosition(0, 0);
        let n = 0;
        for (let slot = 0; slot < COLOR_SLOTS.length; slot++) {
          if (COLOR_SLOTS[slot] < 0) continue;
          const col = slot % SWATCH_COLS, row = Math.floor(slot / SWATCH_COLS);
          const off = swatchOffset(slot);
          const item = sw.items[n++];
          item.x = c.x + SWATCH_BASE_DX + col * SWATCH_STEP_X + off.x;
          item.y = c.y + SWATCH_BASE_DY + row * SWATCH_STEP_Y + off.y;
        }
      }
      const mm = byId("popupModes");
      if (mm) {
        mm.setPosition(0, 0);
        const right = c.x + POPUP_W / 2;
        const top = c.y + POPUP_H / 2;
        mm.items[0].x = right + MODE_BUTTON_DX; mm.items[0].y = top + MODE_BUTTON_DY;
        mm.items[1].x = right + MODE_BUTTON_DX + MODE_BUTTON_STEP; mm.items[1].y = top + MODE_BUTTON_DY;
        mm.items[2].x = right + MODE_BUTTON_DX + MODE_BUTTON_STEP * 2; mm.items[2].y = top + MODE_BUTTON_DY;
        mm.items[3].x = c.x - POPUP_W / 2 + POPUP_CLOSE_INSET;
        mm.items[3].y = top - POPUP_CLOSE_INSET;
      }
      return;
    }

    const tabs = byId("tabs");
    if (tabs) {
      const p = gd(viewW * 0.5, viewH * 0.5 + TAB_MENU_Y);
      tabs.setPosition(p.x, p.y);
    }
    const panel = gd(viewW * 0.5, viewH * 0.5 + PANEL_Y);
    const grid = byId("grid");
    if (grid) {
      grid.setPosition(0, 0);
      grid.items.forEach((item, i) => {
        const col = i % GRID_COLS, row = Math.floor(i / GRID_COLS);
        item.x = panel.x + GRID_START_DX + col * GRID_STEP_X;
        item.y = panel.y + GRID_START_DY - row * GRID_STEP_Y;
      });
    }
    const arrows = byId("pageArrows");
    if (arrows) {
      arrows.setPosition(panel.x, panel.y);
      arrows.items[0].x = -PAGE_ARROW_OFFSET;
      arrows.items[1].x = PAGE_ARROW_OFFSET;
    }
    const dots = byId("dots");
    if (dots) {
      const p = gd(viewW * 0.5, DOTS_BOTTOM_Y);
      dots.setPosition(p.x, p.y);
    }
    const corner = byId("corner");
    if (corner) {
      corner.setPosition(0, 0);
      const place = (id: string, p: { x: number; y: number }) => {
        const it = corner.items.find((i) => i.id === id)!;
        it.x = p.x; it.y = p.y;
      };
      place("back", gd(s.left + BACK_INSET_X, s.top - BACK_INSET_Y));
      place("shards", gd(SHARDS_X, viewH + SHARDS_DY));
      place("paint", gd(PAINT_X, viewH + PAINT_DY));
    }
  }

  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;

    renderer.resize();
    const { scale, viewW, viewH } = resolveView(renderer.canvas.width, renderer.canvas.height);
    const s = screenBounds(viewW, viewH);
    const gd = (x: number, y: number) => fromGdUi(x, y, viewW, viewH);

    layout(viewW, viewH);
    host?.update(dt);

    renderer.camera = { x: 0, y: 0, scale };
    renderer.begin();

    // background, tinted the garage grey
    renderer.draw(gradient.tex, gradient.texW, gradient.texH, gradient.frame,
      0, 0, viewW + BG_OVERSCAN, viewH + BG_OVERSCAN, 0,
      BG_TINT[0] / 255, BG_TINT[1] / 255, BG_TINT[2] / 255, 1);

    // the four side-art corners: bottom pair upright, top pair flipped
    const art = sprites.require("GJ_sideArt_001.png");
    const aw = art.frame.w * HD, ah = art.frame.h * HD;
    const corner = (gx: number, gy: number, fx: boolean, fy: boolean) => {
      const p = gd(gx, gy);
      renderer.draw(art.sheet.tex, art.sheet.texW, art.sheet.texH, art.frame,
        p.x + (fx ? -aw / 2 : aw / 2), p.y + (fy ? -ah / 2 : ah / 2),
        aw, ah, 0, 1, 1, 1, 1, "normal", fx, fy);
    };
    corner(s.left - 1, s.bottom - 1, false, false);
    corner(s.right + 1, s.bottom - 1, true, false);
    corner(s.left - 1, s.top + 1, false, true);
    corner(s.right + 1, s.top + 1, true, true);

    // the floor line the preview stands on
    const line = sprites.require("floorLine_001.png");
    const lineP = gd(viewW * 0.5, viewH * 0.5 + FLOOR_LINE_Y);
    drawUiSprite(renderer, line, lineP.x, lineP.y);

    // the live preview
    drawIcon(previewMode, previewSelected(), lineP.x, lineP.y + PREVIEW_SCALE * 15 + 1, PREVIEW_SCALE);

    // tabs
    const tabs = menus.find((m) => m.id === "tabs");
    tabs?.draw(renderer);

    // selection panel and its grid
    const panelC = gd(viewW * 0.5, viewH * 0.5 + PANEL_Y);
    drawNineSlice(renderer, panelTex, panelC.x, panelC.y, PANEL_W, PANEL_H, { a: PANEL_OPACITY });
    drawUiSprite(renderer, sprites.require("GJ_unlockTxt_001.png"),
      panelC.x, panelC.y + PANEL_H / 2 + UNLOCK_TXT_DY);
    const grid = menus.find((m) => m.id === "grid");
    const first = page * PER_PAGE + 1;
    grid?.items.forEach((item, i) => {
      const n = first + i;
      const m = mode();
      const scale = GRID_ICON_SCALE(m) * GRID_ICON_FIT * item.scale;
      if (m === "trail" || m === "deathEffect") {
        // single frames, drawn as they are (`GJItemIcon::init` unlock types 10 and 11)
        const name = m === "trail" ? trailIconFrame(n) : deathEffectIconFrame(n);
        drawUiSprite(renderer, sprites.require(name), item.x, item.y, { scale });
      } else {
        drawIcon(m, n, item.x, item.y, scale, 1, [GRID_ICON_COLOR1, GRID_ICON_COLOR2]);
      }
    });
    // the two selection rings, over the chosen cell and the chosen tab
    const chosenCell = grid?.items[selected() - first];
    if (chosenCell) {
      drawUiSprite(renderer, sprites.require("GJ_select_001.png"),
        chosenCell.x, chosenCell.y, { scale: SELECT_SCALE });
    }
    const tabItem = tabs?.items[tab];
    if (tabs && tabItem) {
      drawUiSprite(renderer, sprites.require("GJ_select_001.png"),
        tabs.x + tabItem.x, tabs.y + tabItem.y, { scale: SELECT_SCALE });
    }

    menus.find((m) => m.id === "pageArrows")?.draw(renderer);
    menus.find((m) => m.id === "dots")?.draw(renderer);
    // The Shop's sign, static (see SHOP_DX)
    const shopP = gd(viewW * 0.5 + SHOP_DX, viewH + SHOP_DY);
    drawUiSprite(renderer, sprites.require("shopRope_001.png"), shopP.x, shopP.y);
    menus.find((m) => m.id === "corner")?.draw(renderer);

    // The counter column: seven fixed slots 15 apart from `(screenRight - 18,
    // screenTop - 12)` — stars, moons, coins, user coins, orbs, diamonds,
    // diamond shards (init +3672..5700). The port tracks only stars and secret
    // coins, so it draws those two **in their own slots** and leaves the
    // currency slots empty: never a placeholder number.
    const slot = (i: number) => gd(s.right + COUNTER_X, s.top + COUNTER_Y + i * COUNTER_STEP);
    const counter = (i: number, frame: string, iconScale: number, value: number) => {
      const p = slot(i);
      drawUiSprite(renderer, sprites.require(frame), p.x, p.y, { scale: iconScale });
      // anchor (1, 0.5) at `icon + (-12, 0.5)`, bigFont at 0.34
      label(`${value}`, p.x + COUNTER_LABEL_DX, p.y + COUNTER_LABEL_DY, COUNTER_LABEL_SCALE, 1);
    };
    const total = save.totalStars((n) => LEVELS.find((l) => l.n === n)?.stars ?? 0,
      LEVELS.map((l) => l.n));
    counter(0, "GJ_starsIcon_001.png", COUNTER_ICON_SCALE, total);
    counter(2, "GJ_coinsIcon_001.png", COUNTER_COIN_SCALE, save.totalCoins());

    if (popup) {
      const c = gd(viewW * 0.5, viewH * 0.5);
      // `FLAlertLayer::init(opacity)` dims the scene behind its panel
      renderer.draw(white.tex, white.texW, white.texH, white.frame,
        0, 0, viewW, viewH, 0, 0, 0, 0, 0.5);
      drawNineSlice(renderer, popupTex, c.x, c.y, POPUP_W, POPUP_H);
      // the live preview inside the popup, in the empty band between the mode
      // buttons and the swatches: the popup covers the garage's own preview, so
      // without this a colour change could not be seen until the popup closed
      const pv = gd(viewW * 0.5, viewH * 0.5 + POPUP_PREVIEW_DY);
      drawIcon(previewMode, previewSelected(), pv.x, pv.y, POPUP_PREVIEW_SCALE);

      const sw = menus.find((m) => m.id === "swatches");
      let n = 0;
      for (let slot = 0; slot < COLOR_SLOTS.length; slot++) {
        const idx = COLOR_SLOTS[slot];
        if (idx < 0) continue;
        const item = sw!.items[n++];
        const col = PLAYER_COLORS[idx];
        drawUiSprite(renderer, sprites.require("playerSquare_001.png"), item.x, item.y,
          { scale: SWATCH_SCALE * item.scale, r: col[0] / 255, g: col[1] / 255, b: col[2] / 255 });
        if (idx === kit[popup]) {
          drawUiSprite(renderer, sprites.require("GJ_select_001.png"), item.x, item.y,
            { scale: SWATCH_SCALE * item.scale });
        }
      }

      const mm = menus.find((m) => m.id === "popupModes")!;
      const captions = ["Col1", "Col2", "Glow"];
      captions.forEach((caption, i) => {
        const item = mm.items[i];
        // ButtonSprite grows past its 40-unit box only when the caption needs it
        const textW = font.measure(caption) * HD * MODE_BUTTON_TEXT_SCALE;
        const w = Math.max(MODE_BUTTON_W, textW + 16) * MODE_BUTTON_SCALE * item.scale;
        const h = MODE_BUTTON_H * MODE_BUTTON_SCALE * item.scale;
        const active = i === 0 ? popup === "col1" : i === 1 ? popup === "col2" : kit.glow;
        drawNineSlice(renderer, buttonTex, item.x, item.y, w, h, { a: active ? 1 : 0.6 });
        label(caption, item.x, item.y, MODE_BUTTON_TEXT_SCALE * MODE_BUTTON_SCALE * item.scale);
      });
      const close = mm.items[3];
      drawUiSprite(renderer, sprites.require("GJ_closeBtn_001.png"), close.x, close.y,
        { scale: POPUP_CLOSE_SCALE * close.scale });
    }

    fade.draw(dt, scale, viewW, viewH);
    renderer.flush();
    requestAnimationFrame(loop);
  };

  loop();

  (window as unknown as Record<string, unknown>).__kit = {
    get info() {
      const { viewW, viewH } = resolveView(renderer.canvas.width, renderer.canvas.height);
      return {
        viewW, viewH,
        panel: "icons" as const,
        mode: mode(), tab, page, pages: pageCount(),
        icon: selected(), col1: kit.col1, col2: kit.col2, glow: kit.glow,
        popup,
        controls: menus.flatMap((m) => m.items.map((it) => ({
          menu: m.id, id: it.id, x: m.x + it.x, y: m.y + it.y,
          w: it.contentW, h: it.contentH, scale: it.scale,
        }))),
      };
    },
    at(id: string) {
      for (const m of menus) {
        for (const it of m.items) if (it.id === id) return { x: m.x + it.x, y: m.y + it.y };
      }
      return null;
    },
    setTab: (i: number) => { openTab(i); rebuild(); },
    setPage: (p: number) => { page = Math.max(0, Math.min(pageCount() - 1, p)); rebuild(); },
    setIcon: (n: number) => { setIcon(n); syncPage(); rebuild(); },
    setColor,
    toggleGlow,
    /** whether an icon frame has resolved — per-icon sheets arrive asynchronously */
    hasFrame: (name: string) => sprites.has(name),
    openPaint: () => { popup = "col1"; rebuild(); },
    back,
  };
}

export const GARAGE_LAYOUT = {
  BG_TINT, BG_OVERSCAN, FLOOR_LINE_Y, PREVIEW_SCALE, TAB_MENU_Y, TAB_PADDING,
  TAB_SPRITE_SCALE, PANEL_W, PANEL_H, PANEL_OPACITY, PANEL_Y,
  GRID_COLS, GRID_ROWS, GRID_STEP_X, GRID_STEP_Y, GRID_START_DX, GRID_START_DY, PER_PAGE,
  SELECT_SCALE, GRID_ICON_COLOR1, GRID_ICON_COLOR2, GRID_ICON_SCALE,
  BACK_INSET_X, BACK_INSET_Y, BACK_SIZE_MULT, PAINT_X, PAINT_DY,
  POPUP_W, POPUP_H, POPUP_CLOSE_INSET, POPUP_CLOSE_SCALE, POPUP_CLOSE_SIZE_MULT,
  SWATCH_COLS, SWATCH_STEP_X, SWATCH_STEP_Y, SWATCH_BASE_DX, SWATCH_BASE_DY,
  SWATCH_SCALE, SWATCH_STAGGER, MODE_BUTTON_DX, MODE_BUTTON_DY, MODE_BUTTON_SCALE,
  MODE_BUTTON_W, MODE_BUTTON_H, MODE_BUTTON_TEXT_SCALE,
  COLOR_SLOTS, TAB_FRAMES, GARAGE_FRAMES,
} as const;

export { swatchOffset };
