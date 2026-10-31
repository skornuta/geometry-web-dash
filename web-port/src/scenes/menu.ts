/**
 * `LevelSelectLayer` + `LevelPage` — the classic level carousel, reproduced
 * from the shipping 2.2081 binary (m1 `0x3a40ac` and `0x3a7568`, with the
 * per-level content from `LevelPage::updateDynamicPage` `0x3a4e60`).
 *
 * Everything below is decoded; the working is in `docs/ui-parity/REFERENCE.md`
 * §10-11. In particular the three things the plan called out as invented are
 * now sourced and gone:
 *
 * - the **page width is the window width**, not an arbitrary 360
 *   (`LevelSelectLayer::init +1812` stores `winSize.width` into `m_width`);
 * - the **page colour** is `colorForPage(page)` — a nine-entry table into the
 *   game's own palette, cross-faded by `getColorValue`'s clamped ramp — not a
 *   hue wheel;
 * - the **click target** is the level panel itself, a `CCMenuItemSpriteExtra`
 *   wrapping a sprite the size of the panel, so the empty background can no
 *   longer start a level.
 *
 * Layout is written in the original's UI space (origin bottom-left of the win
 * size, +Y up) and converted by `fromGdUi`, as in `mainMenu.ts`.
 */

import { SceneFade } from "../engine/transition.ts";
import { Renderer } from "../engine/renderer.ts";
import { createTexture, loadImage, type SpriteFrame } from "../engine/atlas.ts";
import { LoadedFont } from "../engine/bmfont.ts";
import { AudioEngine } from "../engine/audio.ts";
import { MenuMusic } from "../engine/menuMusic.ts";
import { resolveView } from "../gd/camera.ts";
import { HD } from "../gd/sheets.ts";
import { LEVELS, COINS_PER_LEVEL, levelInfo } from "../gd/levels.ts";
import { PLAYER_COLORS } from "../gd/icons.ts";
import { easedValue } from "../gd/easing.ts";
// `CCEaseInOut::update` — the drop-down and The Tower's door both use it
import { easeInOut as easeInOutRate } from "../ui/optionsMenu.ts";
import * as save from "../gd/save.ts";
import {
  UiSprites, drawNineSlice, drawUiSprite, fromGdUi, screenBounds,
  type LooseTexture,
} from "../ui/sprites.ts";
import { MenuHost, MenuItem, UiMenu } from "../ui/controls.ts";
import { AlertLayer, LEVEL_STATS_TITLE, LEVEL_STATS_WIDTH, levelStatsText } from "../ui/alertLayer.ts";
import { ASSET } from "../assetBase.ts";
import { hash01 } from "../gd/objectAnim.ts";

/* ---------------- LevelSelectLayer::init, m1 0x3a40ac ---------------- */

/** background sprite is stretched to `(winSize + 10) / contentSize` and offset -5 */
const BG_OVERSCAN = 10;
/** `setColor({40, 125, 255})` — init +380 */
const BG_BASE_TINT: readonly [number, number, number] = [40, 125, 255];
/** `positionGround(min(winH * 0.5 - 110, 128))` — init +448..488 */
const GROUND_OFFSET = 110;
const GROUND_MAX_Y = 128;
/** the ground takes the page colour times this — scrollLayerMoved +184 */
const GROUND_TINT_FACTOR = 0.8;
/** top bar: anchor (0.5, 1), at `(winW * 0.5, screenTop + 1)` — init +564 */
const TOP_BAR_Y = 1;
/** side art sits 1 unit outside each bottom corner — init +688..704 */
const SIDE_ART_INSET = 1;
/** nav arrows: `screenLeft + 25` / `screenRight - 25`, y = `winH * 0.5` — init +2284, +2416 */
const NAV_ARROW_INSET = 25;
/** `setSizeMult(2.0)` on both nav arrows — init +2264, +2396 */
const NAV_ARROW_SIZE_MULT = 2;
/** back button at `(screenLeft + 25, screenTop - 22)`, `setSizeMult(1.6)` — init +2512, +2588 */
const BACK_INSET_X = 25;
const BACK_INSET_Y = 22;
const BACK_SIZE_MULT = 1.6;
/** page dots at `(winW * 0.5, screenBottom + 15)` — init +1780 */
const DOTS_Y = 15;
/** `updateDots`: 16 apart, centred; unselected grey (125,125,125) — 0x32a430 +376, +388 */
const DOT_SPACING = 16;
const DOT_UNSELECTED = 125 / 255;
/** "Download the soundtrack" at `(winW * 0.5, screenBottom + 35)`, scale 0.5 — init +2056 */
const SOUNDTRACK_Y = 35;

/**
 * `LevelSelectLayer::colorForPage` (m1 `0x3a6a44`). A nine-entry table of
 * `GameManager::colorForIdx` indices — `[5, 7, 8, 9, 10, 11, 1, 3, 4]` read
 * from `0x100723ca0` — indexed by `page % 9`, with a dark grey for any page
 * that is a non-zero multiple of 22. Indices 0-41 of the port's `PLAYER_COLORS`
 * are byte-identical to the binary's table, so no second palette is needed.
 */
const PAGE_COLOR_INDICES = [5, 7, 8, 9, 10, 11, 1, 3, 4] as const;
const PAGE_COLOR_DARK: readonly [number, number, number] = [0x25, 0x2c, 0x34];

function colorForPage(page: number): readonly [number, number, number] {
  if (page !== 0 && page % 22 === 0) return PAGE_COLOR_DARK;
  return PLAYER_COLORS[PAGE_COLOR_INDICES[((page % 9) + 9) % 9]];
}

/**
 * `LevelSelectLayer::getColorValue` (m1 `0x3a67a0`): the cross-fade between two
 * pages is **not** linear in the scroll position. It is
 * `clamp(t / 0.6666667 - 0.2, 0, 1)`, so the colour holds for the first eighth
 * of a page, sweeps, then holds again — which is why the original's background
 * looks like it snaps rather than smears.
 */
function pageColorRamp(t: number): number {
  return Math.min(1, Math.max(0, t / 0.6666667 - 0.2));
}

function blendPageColor(p1: number, p2: number, t: number): [number, number, number] {
  const a = colorForPage(p1), b = colorForPage(p2), k = pageColorRamp(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

/* ---------------- LevelPage::init, m1 0x3a7568 ---------------- */

/** `m_levelDisplaySize` = CCSize(340, 95) — init +88..120 */
const PANEL_W = 340;
const PANEL_H = 95;
/**
 * The panel's centre is the play button's: `winH*0.5 + 60`.
 *
 * `init +340..376` does set the panel to `(winW*0.5, winH*0.5 + 50)`, but that
 * is a **dead store**: `+380..400` adds the panel to the blank button sprite and
 * `+504..520` re-positions it to `(contentW/2, contentH/2)` — the centre of its
 * parent — which is the menu item at the menu origin. A native capture
 * (REFERENCE.md §19.4) shows the art there, 10 units above where the port used
 * to draw it.
 */
const PANEL_Y = 60;
/** the level menu, whose one item is the whole panel: `winH*0.5 + 60` — init +200 */
const PANEL_MENU_Y = 60;
/** `CCScale9Sprite::create("square02_001.png", ...)` then `setOpacity(125)` — init +296 */
const PANEL_OPACITY = 125 / 255;
/** pressing the panel scales it by this — init +556 writes 1.1 straight into +0x190 */
const PANEL_PRESS_SCALE = 1.1;
/** normal progress bar centre: `winH*0.5 - 30`; practice is 50 below it — init +716, +1116 */
const BAR_NORMAL_Y = -30;
const BAR_PRACTICE_DY = -50;
/** both bar backgrounds: black at opacity 125 — init +596..656 */
const BAR_BG_OPACITY = 125 / 255;
/** the fill is scaled 0.992 x 0.86 inside the bar art — init +784..824 */
const BAR_FILL_SCALE_X = 0.992;
const BAR_FILL_SCALE_Y = 0.86;
/** fill colours: green normal, cyan practice — init +848 (0x100723c60) and +1240 */
const BAR_NORMAL_COLOR: readonly [number, number, number] = [0, 255, 0];
const BAR_PRACTICE_COLOR: readonly [number, number, number] = [0, 255, 255];
/** every label on the page draws at half size — init +1476, +1588, +1732, +1880, +2356 */
const LABEL_SCALE = 0.5;
/** "Normal Mode" / "Practice Mode" sit 20 above their bar — init +1680, +1828 */
const MODE_LABEL_DY = 20;
/** stars icon at `(340 - 15, 95 - 13)` inside the panel, scale 0.7 — init +2108..2148 */
const STARS_X = PANEL_W - 15;
const STARS_Y = PANEL_H - 13;
const STARS_SCALE = 0.7;
/** the stars count hangs 12 left of the icon, right-aligned — init +2296 */
const STARS_LABEL_DX = -12;
const STARS_LABEL_DY = 0.5;
/** coin row: base `(340 - 16, 16)`, then -52 / -26 / 0 — init +2388..2740 */
const COIN_BASE_X = PANEL_W - 16;
const COIN_Y = 16;
const COIN_DX = [-52, -26, 0] as const;
/** difficulty scale 1.1, and the name+face block is centred with these gaps — init +2040, +3512 */
const DIFF_SCALE = 1.1;
const NAME_GAP = 5;
const NAME_OFFSET = 30;
/** `setScale(min(1, 250 / contentWidth))` on the name — init +3268 */
const NAME_MAX_WIDTH = 250;
/** the name/difficulty row sits at `95 * 0.5 + 3` inside the panel — init +3572 */
const PANEL_ROW_Y = PANEL_H / 2 + 3;

/**
 * `LevelPage::updateDynamicPage +3396` formats **`diffIcon_%02d_btn_001.png`**,
 * not the `difficulty_NN_btn_001.png` family the port had been using. Both
 * exist in GJ_GameSheet03; this is the one the level pages actually draw.
 */
const DIFF_ORDER = ["easy", "normal", "hard", "harder", "insane", "demon"] as const;
function diffFrame(difficulty: string): string {
  const i = Math.max(0, DIFF_ORDER.indexOf(difficulty as (typeof DIFF_ORDER)[number]));
  return `diffIcon_${String(i + 1).padStart(2, "0")}_btn_001.png`;
}

/**
 * `BoomScrollLayer::moveToPage` (m1 `0x32ae64`): a page move is a `CCMoveTo`
 * wrapped in **`CCEaseElasticOut` with period 0.5**, and its duration comes off
 * the swipe velocity still in `+0x1a8`:
 *
 *     v > 0.6  -> 0.48    v <= 0.4 -> 0.96    otherwise -> 0.72
 *
 * A button or arrow press leaves that velocity at 0, so **0.96 s** is the
 * duration for every move this port can make. The elastic overshoot is the
 * springy settle the original's carousel has; the old exponential chase both
 * looked wrong and never actually arrived.
 */
const MOVE_DURATION = 0.96;
const MOVE_ELASTIC_PERIOD = 0.5;

/** frames this screen needs; a missing one throws at load rather than vanishing */
/**
 * The carousel has **24** pages, not 22. `LevelSelectLayer::init +1596..1708`
 * appends two synthetic levels after the 22 main ones — id **-2** (The Tower's
 * entrance) and id **-1** ("Coming Soon!") — and `BoomScrollLayer::create`
 * is called with `looped = true` (+1720..1732), so paging wraps round.
 * A native capture showed both the two extra dots and the wrap (REFERENCE.md
 * §19.4).
 */
const TOWER_PAGE = 22;
const COMING_SOON_PAGE = 23;
const PAGE_COUNT = 24;
/** `updateDynamicPage` for id -2: the door button at `(winW*0.5, winH*0.5 - 5)` — +812..928 */
const TOWER_DOOR_Y = -5;
/** the label is the door's child at `(door.w * 0.5, door.h + 23)` — +944..1060 */
const TOWER_LABEL_DY = 23;
/** the door bobs: `RepeatForever(EaseInOut(MoveBy(2.5, (0, 5)), 1.8), EaseInOut(MoveBy(2.5, (0, -5)), 1.8))` */
const TOWER_BOB = 5;
const TOWER_BOB_DURATION = 2.5;
const TOWER_BOB_RATE = 1.8;
/** id -1: `CCLabelBMFont("Coming Soon!", "bigFont.fnt")` at `(winW*0.5, winH*0.5 + 50)` — +5240..5336 */
const COMING_SOON_Y = 50;

/** a page index in `[0, PAGE_COUNT)`, whatever the unwrapped scroll position */
const wrapPage = (i: number) => ((i % PAGE_COUNT) + PAGE_COUNT) % PAGE_COUNT;

/**
 * `GJ_infoIcon_001.png` → `onInfo`, `setSizeMult(2.0)`, in its own menu at
 * `(screenRight - 20, screenTop - 20)` — init +2664..2788. On a level page it
 * opens "Level Stats" (`LevelPage::onInfo` m1 `0x3a6fa4`; `ui/alertLayer.ts`).
 * The Tower's and the "Coming Soon" page's popups are outside the locked
 * scope, so there the button stays inert.
 */
const INFO_INSET = 20;
const INFO_SIZE_MULT = 2;

const PAGE_FRAMES = [
  "GJ_infoIcon_001.png",
  "theTowerDoor_001.png", "theTowerLabel_001.png",
  "GJ_topBar_001.png", "GJ_sideArt_001.png",
  "GJ_starsIcon_001.png", "GJ_coinsIcon_001.png", "GJ_coinsIcon_gray_001.png",
  "navArrowBtn_001.png", "GJ_arrow_01_001.png",
  ...DIFF_ORDER.map((d) => diffFrame(d)),
] as const;

async function loadLoose(renderer: Renderer, url: string): Promise<LooseTexture & { frame: SpriteFrame }> {
  const img = await loadImage(url);
  return {
    tex: createTexture(renderer.ctx, img), texW: img.width, texH: img.height,
    frame: {
      x: 0, y: 0, w: img.width, h: img.height, rotated: false,
      offsetX: 0, offsetY: 0, sourceW: img.width, sourceH: img.height,
    },
  };
}

export async function startMenu(renderer: Renderer) {
  /** `CCTransitionFade` in and out of this scene */
  const fade = new SceneFade(renderer);
  // GJ_GameSheet04 holds The Tower's door and label
  const sprites = await UiSprites.load(renderer,
    ["GJ_GameSheet03-hd", "GJ_GameSheet02-hd", "GJ_GameSheet04-hd"]);
  sprites.requireAll(PAGE_FRAMES);

  const [gradient, ground, barTex, panelTex, dotTex, squareTex] = await Promise.all([
    loadLoose(renderer, `${ASSET}GJ_gradientBG-hd.png`),
    loadLoose(renderer, `${ASSET}groundSquare_01_001-hd.png`),
    loadLoose(renderer, `${ASSET}GJ_progressBar_001-hd.png`),
    loadLoose(renderer, `${ASSET}square02_001-hd.png`),
    loadLoose(renderer, `${ASSET}smallDot-hd.png`),
    loadLoose(renderer, `${ASSET}square.png`),
  ]);
  const font = await LoadedFont.load(renderer, `${ASSET}bigFont-hd.fnt`, `${ASSET}bigFont-hd.png`);
  const audio = new AudioEngine(save.settings());
  const menuMusic = new MenuMusic(audio, () => save.settings().menuMusic);
  // `FLAlertLayer`'s own art: goldFont title and button caption, chatFont text,
  // the `square01_001` panel and `GJ_button_01` behind the button
  const [goldFont, chatFont, alertPanel, buttonBg] = await Promise.all([
    LoadedFont.load(renderer, `${ASSET}goldFont-hd.fnt`, `${ASSET}goldFont-hd.png`),
    LoadedFont.load(renderer, `${ASSET}chatFont-hd.fnt`, `${ASSET}chatFont-hd.png`),
    loadLoose(renderer, `${ASSET}square01_001-hd.png`),
    loadLoose(renderer, `${ASSET}GJ_button_01-hd.png`),
  ]);
  const whiteCanvas = document.createElement("canvas");
  whiteCanvas.width = whiteCanvas.height = 2;
  const wg = whiteCanvas.getContext("2d")!;
  wg.fillStyle = "#fff";
  wg.fillRect(0, 0, 2, 2);
  const white = {
    tex: createTexture(renderer.ctx, whiteCanvas), texW: 2, texH: 2,
    frame: { x: 0, y: 0, w: 2, h: 2, rotated: false, offsetX: 0, offsetY: 0, sourceW: 2, sourceH: 2 },
  };

  /** design-space width of a string at a cocos node scale */
  const textWidth = (s: string, cocosScale: number) => font.measure(s) * HD * cocosScale;

  /**
   * Draw a `CCLabelBMFont` the way cocos places one: `bigFont.fnt` at a node
   * scale, anchored in the middle of its line box, so `(x, y)` is the label's
   * centre rather than its baseline.
   */
  const label = (
    text: string, x: number, y: number, cocosScale: number,
    align: -1 | 0 | 1 = 0, a = 1, r = 1, g = 1, b = 1,
  ) => {
    const sc = HD * cocosScale;
    const baseline = y - (font.font.base - font.font.lineHeight / 2) * sc;
    font.draw(renderer, text, x, baseline, sc, r, g, b, a, align);
  };

  /** the bar art is 340 points wide, exactly the panel width */
  const barW = barTex.texW * HD;
  const barH = barTex.texH * HD;

  /**
   * Which level is selected, 0-based into LEVELS. Returning here from a level
   * carries `?levels=1&sel=N` so the carousel comes back where you left it,
   * which is what the original's `LevelSelectLayer::scene(page)` argument does.
   */
  const wanted = parseInt(new URLSearchParams(location.search).get("sel") ?? "", 10);
  let sel = Number.isFinite(wanted)
    ? Math.max(0, LEVELS.findIndex((l) => l.n === wanted))
    : 0;
  /** eased scroll position, in pages, and the tween driving it */
  let scroll = sel;
  let scrollFrom = sel;
  let scrollTo = sel;
  let scrollT = 1;

  /**
   * `scroll` is unwrapped — it can run past either end — and `sel` is always
   * the wrapped page, so stepping off page 24 slides forward onto page 1
   * instead of rewinding through all 23, exactly as a looped BoomScrollLayer
   * does.
   */
  const scrollBy = (d: number) => {
    if (d === 0) return;
    scrollFrom = scroll;
    scrollTo = scrollTo + d;
    scrollT = 0;
    sel = wrapPage(scrollTo);
  };
  /** go to an absolute page by the shorter way round */
  const moveToPage = (target: number) => {
    const t = wrapPage(target);
    let d = t - sel;
    if (d > PAGE_COUNT / 2) d -= PAGE_COUNT;
    if (d < -PAGE_COUNT / 2) d += PAGE_COUNT;
    scrollBy(d);
  };

  const startMusic = () => menuMusic.gesture();

  const play = () => {
    // only the 22 level pages play; The Tower and "Coming Soon!" do not
    if (sel >= LEVELS.length) return;
    const n = LEVELS[sel].n;
    fade.go(() => { audio.leaveMenuMusic(false); location.search = `?level=${n}`; });
  };

  /** the original's back destination from LevelSelectLayer is MenuLayer */
  const back = () => {
    fade.go(() => { audio.leaveMenuMusic(); location.search = ""; });
  };

  const move = (d: number) => scrollBy(d);

  /* ---------------- controls ---------------- */

  const navMenu = new UiMenu("nav");
  const prevBtn = navMenu.add(new MenuItem({
    id: "prev", frame: sprites.require("navArrowBtn_001.png"),
    sizeMult: NAV_ARROW_SIZE_MULT, onActivate: () => move(-1),
  }));
  const nextBtn = navMenu.add(new MenuItem({
    id: "next", frame: sprites.require("navArrowBtn_001.png"),
    sizeMult: NAV_ARROW_SIZE_MULT, onActivate: () => move(1),
  }));
  const backMenu = new UiMenu("back");
  const backBtn = backMenu.add(new MenuItem({
    id: "back", frame: sprites.require("GJ_arrow_01_001.png"),
    sizeMult: BACK_SIZE_MULT, onActivate: back,
  }));
  /**
   * The page itself is the play button, as in `LevelPage::init`: an invisible
   * sprite the size of the level panel wrapped in a `CCMenuItemSpriteExtra`.
   * Only the *selected* page's item is live, which is what stops a click on a
   * half-scrolled neighbour launching the wrong level.
   */
  const pageMenu = new UiMenu("page");
  const panelBtn = pageMenu.add(new MenuItem({
    id: "levelPanel",
    frame: { name: "panel", sheet: panelTex as never, frame: panelTex.frame },
    onActivate: play,
  }));
  // `LevelPage::init +556` writes 1.1 straight into the press-scale field
  // instead of leaving `init`'s 1.26 default.
  panelBtn.pressScale = PANEL_PRESS_SCALE;
  // the panel's hit box is its content size, which is the panel size, not the
  // texture's own 80x80 — so drive it from the sourced constants directly
  Object.defineProperty(panelBtn, "contentW", { get: () => PANEL_W });
  Object.defineProperty(panelBtn, "contentH", { get: () => PANEL_H });

  /** the open "Level Stats" popup, which swallows every touch and key */
  let alert: AlertLayer | null = null;
  let alertHost: MenuHost | null = null;
  const viewScale = () => resolveView(renderer.canvas.width, renderer.canvas.height).scale;

  const infoMenu = new UiMenu("info");
  const infoBtn = infoMenu.add(new MenuItem({
    id: "info", frame: sprites.require("GJ_infoIcon_001.png"), sizeMult: INFO_SIZE_MULT,
    onActivate: () => openLevelStats(),
  }));

  const menus = [pageMenu, navMenu, backMenu, infoMenu];
  let host = new MenuHost(renderer.canvas, menus, viewScale, startMusic);

  const closeAlert = () => {
    alertHost?.dispose();
    alertHost = null;
    alert = null;
    host = new MenuHost(renderer.canvas, menus, viewScale, startMusic);
  };
  /**
   * `LevelPage::onInfo` +608..1008 on a level page: the level's own name and
   * cumulative stats, in an `FLAlertLayer` 300 wide with one "OK".
   */
  function openLevelStats() {
    if (alert || sel >= LEVELS.length) return;
    const lv = LEVELS[sel];
    const st = save.levelStats(lv.n);
    alert = new AlertLayer({
      title: LEVEL_STATS_TITLE,
      desc: levelStatsText(lv.name, st.attempts, st.jumps, st.normal, st.practice),
      width: LEVEL_STATS_WIDTH, button: "OK",
      goldFont, chatFont, panel: alertPanel, buttonBg, white,
      onClose: closeAlert,
    });
    // `FLAlertLayer` registers with force priority: the carousel beneath it
    // gets nothing until it closes
    host.dispose();
    alertHost = new MenuHost(renderer.canvas, [alert.menu], viewScale);
  }

  addEventListener("keydown", (e) => {
    startMusic();
    if (alert) {
      // `keyBackClicked` and the button's own activation both close it
      if (e.code === "Escape" || e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        closeAlert();
      }
      return;
    }
    switch (e.code) {
      case "ArrowLeft": case "KeyA": e.preventDefault(); move(-1); break;
      case "ArrowRight": case "KeyD": e.preventDefault(); move(1); break;
      case "Enter": case "Space": e.preventDefault(); play(); break;
      case "Home": e.preventDefault(); moveToPage(0); break;
      case "End": e.preventDefault(); moveToPage(PAGE_COUNT - 1); break;
      case "Escape": e.preventDefault(); back(); break;
      case "KeyI": e.preventDefault(); fade.go(() => { audio.leaveMenuMusic(); location.search = "?icons=1"; }); break;
      case "KeyO": e.preventDefault(); fade.go(() => { audio.leaveMenuMusic(); location.search = "?settings=1"; }); break;
    }
  });

  /* ---------------- drawing ---------------- */

  let last = performance.now();

  function drawBackground(viewW: number, viewH: number, color: [number, number, number]) {
    // `setScaleX((winW + 10) / contentSize.width)` etc, anchored (0,0) at (-5,-5),
    // which lands the stretched gradient dead centre. `init` tints it
    // BG_BASE_TINT, but `scrollLayerMoved` immediately overwrites that with the
    // page colour, so the page colour is what is ever actually seen.
    const w = viewW + BG_OVERSCAN, h = viewH + BG_OVERSCAN;
    const [r, g, b] = color;
    renderer.draw(gradient.tex, gradient.texW, gradient.texH, gradient.frame,
      0, 0, w, h, 0, r / 255, g / 255, b / 255, 1);
  }

  function drawGround(viewW: number, viewH: number, color: [number, number, number]) {
    const surfaceGd = Math.min(viewH * 0.5 - GROUND_OFFSET, GROUND_MAX_Y);
    const surface = fromGdUi(0, surfaceGd, viewW, viewH).y;
    const tile = ground.texW * HD;
    const r = (color[0] / 255) * GROUND_TINT_FACTOR;
    const g = (color[1] / 255) * GROUND_TINT_FACTOR;
    const b = (color[2] / 255) * GROUND_TINT_FACTOR;
    for (let x = -viewW / 2; x < viewW / 2 + tile; x += tile) {
      for (let y = surface; y > -viewH / 2 - tile; y -= tile) {
        renderer.draw(ground.tex, ground.texW, ground.texH, ground.frame,
          x + tile / 2, y - tile / 2, tile, tile, 0, r, g, b, 1);
      }
    }
    const line = sprites.require("floorLine_01_001.png");
    // the sprite at 1.5x both ways, as the in-level ground (levelScene `line`)
    const sc = Math.max(1.5, (viewW + 8) / (line.frame.w * HD));
    const lh = line.frame.h * HD * sc;
    renderer.draw(line.sheet.tex, line.sheet.texW, line.sheet.texH, line.frame,
      0, surface + lh / 2, line.frame.w * HD * sc, lh, 0, 1, 1, 1, 1);
    return surface;
  }

  /** one progress bar: black background, coloured fill, and its percentage */
  function drawBar(cx: number, cy: number, pct: number, fill: readonly [number, number, number]) {
    renderer.draw(barTex.tex, barTex.texW, barTex.texH, barTex.frame,
      cx, cy, barW, barH, 0, 0, 0, 0, BAR_BG_OPACITY);
    const innerW = barW * BAR_FILL_SCALE_X;
    const innerH = barH * BAR_FILL_SCALE_Y;
    const left = cx - innerW / 2;
    const t = Math.max(0, Math.min(100, pct)) / 100;
    const w = innerW * t;
    if (w > 0) {
      // the fill is anchored left-middle inside the bar, so it grows rightwards;
      // `setTextureRect(0, 0, w * pct / 100, h)` crops the art rather than
      // squashing it, so a low percentage keeps the bar's rounded left cap
      renderer.draw(barTex.tex, barTex.texW, barTex.texH, { ...barTex.frame, w: barTex.frame.w * t },
        left + w / 2, cy, w, innerH, 0, fill[0] / 255, fill[1] / 255, fill[2] / 255, 1);
    }
    // `%i%%` — updateDynamicPage +572
    label(`${Math.floor(pct)}%`, cx, cy, LABEL_SCALE);
  }

  let towerT = 0;

  /**
   * The Tower's page: the whole level panel is hidden and replaced by the
   * door, which is a button in the original (`onTheTower`) and inert here — The
   * Tower is outside the locked scope. Its three particle systems are not
   * reproduced (REFERENCE.md §19.4).
   */
  function drawTowerPage(offX: number, viewW: number, viewH: number) {
    const door = sprites.require("theTowerDoor_001.png");
    const label = sprites.require("theTowerLabel_001.png");
    // one full bob is up 5 over 2.5 s, then down 5 over 2.5 s, each eased
    const phase = (towerT % (2 * TOWER_BOB_DURATION)) / TOWER_BOB_DURATION;
    const bob = phase < 1
      ? TOWER_BOB * easeInOutRate(phase, TOWER_BOB_RATE)
      : TOWER_BOB * (1 - easeInOutRate(phase - 1, TOWER_BOB_RATE));
    const c = fromGdUi(viewW * 0.5 + offX, viewH * 0.5 + TOWER_DOOR_Y, viewW, viewH);
    drawUiSprite(renderer, door, c.x, c.y + bob);
    const doorH = door.frame.sourceH * HD;
    drawUiSprite(renderer, label, c.x, c.y + bob + doorH / 2 + TOWER_LABEL_DY);
    // The door's floating blue sparkles (native-level-select-page22: small blue
    // squares drifting up in and around the portal). APPROXIMATION: the game's
    // three emitters are not decoded (REFERENCE.md §19.4), so this is a seeded
    // field of squares that fade in and out while they rise.
    const SPARKLES = 28;
    for (let k = 0; k < SPARKLES; k++) {
      const period = 2.4 + (k % 5) * 0.5;
      const u = ((towerT + hash01(k, 21) * period) % period) / period;
      const cycle = Math.floor((towerT + hash01(k, 21) * period) / period);
      const px = (hash01(k + cycle * 31, 22) - 0.5) * 100;
      const py = (hash01(k + cycle * 31, 23) - 0.5) * 100 + u * 16;
      const size = 2.2 + hash01(k, 24) * 2.6;
      const a = Math.sin(Math.PI * u) * 0.9;
      const cyan = hash01(k, 25) < 0.35;
      renderer.draw(squareTex.tex, squareTex.texW, squareTex.texH, squareTex.frame,
        c.x + px, c.y + bob + 8 + py, size, size, (hash01(k, 26) - 0.5) * 1.2,
        cyan ? 0.3 : 0.15, cyan ? 0.8 : 0.45, 1, a);
    }
  }

  function drawComingSoonPage(offX: number, viewW: number, viewH: number) {
    const c = fromGdUi(viewW * 0.5 + offX, viewH * 0.5 + COMING_SOON_Y, viewW, viewH);
    label("Coming Soon!", c.x, c.y, 1);
  }

  function drawPage(i: number, offX: number, viewW: number, viewH: number, alpha: number, press = 1) {
    if (i === TOWER_PAGE) return drawTowerPage(offX, viewW, viewH);
    if (i === COMING_SOON_PAGE) return drawComingSoonPage(offX, viewW, viewH);
    const info = LEVELS[i];
    const st = save.levelStats(info.n);
    const panelC = fromGdUi(viewW * 0.5 + offX, viewH * 0.5 + PANEL_Y, viewW, viewH);

    drawNineSlice(renderer, panelTex, panelC.x, panelC.y, PANEL_W * press, PANEL_H * press,
      { a: PANEL_OPACITY * alpha });

    // panel-local -> design space: the panel's content box origin is bottom-left
    const px = (x: number) => panelC.x - PANEL_W / 2 + x;
    const py = (y: number) => panelC.y - PANEL_H / 2 + y;

    // difficulty face + name, centred as a block across the panel
    const diff = sprites.require(diffFrame(info.difficulty));
    const diffW = diff.frame.sourceW * HD * DIFF_SCALE;
    const nameScale = Math.min(1, NAME_MAX_WIDTH / Math.max(1, textWidth(info.name, 1)));
    const nameW = textWidth(info.name, nameScale);
    const total = diffW * 0.5 + nameW + NAME_GAP + NAME_OFFSET;
    const diffX = PANEL_W / 2 - total / 2 + diffW / 2;
    drawUiSprite(renderer, diff, px(diffX), py(PANEL_ROW_Y),
      { scale: DIFF_SCALE, a: alpha });
    label(info.name, px(diffX + NAME_OFFSET), py(PANEL_ROW_Y), nameScale, -1, alpha);

    // stars: icon top-right, count right-aligned to its left
    const star = sprites.require("GJ_starsIcon_001.png");
    drawUiSprite(renderer, star, px(STARS_X), py(STARS_Y), { scale: STARS_SCALE, a: alpha });
    label(`${info.stars}`, px(STARS_X + STARS_LABEL_DX), py(STARS_Y + STARS_LABEL_DY),
      LABEL_SCALE, 1, alpha);

    // the three secret coins, gold when collected and grey when not
    for (let c = 0; c < COINS_PER_LEVEL; c++) {
      const got = st.coins.includes(c);
      const f = sprites.require(got ? "GJ_coinsIcon_001.png" : "GJ_coinsIcon_gray_001.png");
      drawUiSprite(renderer, f, px(COIN_BASE_X + COIN_DX[c]), py(COIN_Y), { a: alpha });
    }

    // the two progress bars and their mode labels
    const normalY = fromGdUi(0, viewH * 0.5 + BAR_NORMAL_Y, viewW, viewH).y;
    const practiceY = normalY + BAR_PRACTICE_DY;
    const cx = panelC.x;
    drawBar(cx, normalY, st.normal, BAR_NORMAL_COLOR);
    drawBar(cx, practiceY, st.practice, BAR_PRACTICE_COLOR);
    label("Normal Mode", cx, normalY + MODE_LABEL_DY, LABEL_SCALE, 0, alpha);
    label("Practice Mode", cx, practiceY + MODE_LABEL_DY, LABEL_SCALE, 0, alpha);
  }

  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (scrollT < 1) {
      scrollT = Math.min(1, scrollT + dt / MOVE_DURATION);
      scroll = scrollFrom + (scrollTo - scrollFrom) * easedValue(scrollT, 6, MOVE_ELASTIC_PERIOD);
    } else {
      // settled: re-base the unwrapped position into [0, PAGE_COUNT) so a long
      // run of wraps never grows it, and "page N" always reads as N
      scrollTo = scrollFrom = scroll = wrapPage(scrollTo);
    }

    renderer.resize();
    const { scale, viewW, viewH } = resolveView(renderer.canvas.width, renderer.canvas.height);
    const s = screenBounds(viewW, viewH);

    // page colour, exactly as scrollLayerMoved computes it
    const p1 = Math.floor(scroll);
    const t = scroll - p1;
    const color = blendPageColor(wrapPage(p1), wrapPage(p1 + 1), t);

    /* --- control layout --- */
    const navY = fromGdUi(0, viewH * 0.5, viewW, viewH).y;
    navMenu.setPosition(0, 0);
    const prevP = fromGdUi(s.left + NAV_ARROW_INSET, viewH * 0.5, viewW, viewH);
    prevBtn.x = prevP.x; prevBtn.y = navY;
    const nextP = fromGdUi(s.right - NAV_ARROW_INSET, viewH * 0.5, viewW, viewH);
    nextBtn.x = nextP.x; nextBtn.y = navY;
    const backP = fromGdUi(s.left + BACK_INSET_X, s.top - BACK_INSET_Y, viewW, viewH);
    backMenu.setPosition(0, 0);
    backBtn.x = backP.x; backBtn.y = backP.y;
    const infoP = fromGdUi(s.right - INFO_INSET, s.top - INFO_INSET, viewW, viewH);
    infoMenu.setPosition(0, 0);
    infoBtn.x = infoP.x; infoBtn.y = infoP.y;
    // only the settled page is clickable, and only where the panel is drawn:
    // the hit rect is the menu item's, at the menu origin (winH/2 + 60), and
    // the panel art is centred on that same item
    const hit = fromGdUi(viewW * 0.5 + (sel - scroll) * viewW, viewH * 0.5 + PANEL_MENU_Y, viewW, viewH);
    pageMenu.setPosition(0, 0);
    panelBtn.x = hit.x; panelBtn.y = hit.y;

    host.update(dt);
    alertHost?.update(dt);
    alert?.update(dt);

    renderer.camera = { x: 0, y: 0, scale };
    renderer.begin();

    drawBackground(viewW, viewH, color);
    drawGround(viewW, viewH, color);

    // top bar, anchored by its top edge to the top of the screen
    const bar = sprites.require("GJ_topBar_001.png");
    const barTop = fromGdUi(viewW * 0.5, s.top + TOP_BAR_Y, viewW, viewH);
    drawUiSprite(renderer, bar, barTop.x, barTop.y - (bar.frame.sourceH * HD) / 2);

    // the two bottom-corner decorations
    const art = sprites.require("GJ_sideArt_001.png");
    const artW = art.frame.sourceW * HD, artH = art.frame.sourceH * HD;
    const artL = fromGdUi(s.left - SIDE_ART_INSET, s.bottom - SIDE_ART_INSET, viewW, viewH);
    drawUiSprite(renderer, art, artL.x + artW / 2, artL.y + artH / 2);
    const artR = fromGdUi(s.right + SIDE_ART_INSET, s.bottom - SIDE_ART_INSET, viewW, viewH);
    renderer.draw(art.sheet.tex, art.sheet.texW, art.sheet.texH, art.frame,
      artR.x - artW / 2, artR.y + artH / 2, art.frame.w * HD, art.frame.h * HD, 0,
      1, 1, 1, 1, "normal", true);

    // pages either side of the selected one, so a scroll shows its neighbours
    towerT += dt;
    for (let k = Math.floor(scroll) - 1; k <= Math.floor(scroll) + 2; k++) {
      const off = (k - scroll) * viewW;
      if (Math.abs(off) > viewW) continue;
      const i = wrapPage(k);
      drawPage(i, off, viewW, viewH, 1, i === sel ? panelBtn.scale : 1);
    }

    // nav arrows: the prev one is the same art flipped, as the original does
    const arrow = sprites.require("navArrowBtn_001.png");
    // both arrows, always: the carousel is looped, so neither end is a wall.
    // Prev is the same frame with `setFlipX(true)` — init +2192..2200 — which
    // keeps the frame's (0, -5) trim offset's y, so it must not be a raw draw.
    drawUiSprite(renderer, arrow, prevBtn.x, prevBtn.y, { scale: prevBtn.scale, flipX: true });
    drawUiSprite(renderer, arrow, nextBtn.x, nextBtn.y, { scale: nextBtn.scale });

    // back arrow and the info button
    drawUiSprite(renderer, sprites.require("GJ_arrow_01_001.png"),
      backBtn.x, backBtn.y, { scale: backBtn.scale });
    infoMenu.draw(renderer);

    // page dots
    const dots = fromGdUi(viewW * 0.5, s.bottom + DOTS_Y, viewW, viewH);
    const dotW = dotTex.texW * HD;
    for (let i = 0; i < PAGE_COUNT; i++) {
      const x = dots.x + ((PAGE_COUNT - 1) * -0.5 + i) * DOT_SPACING;
      const on = i === sel;
      const c = on ? 1 : DOT_UNSELECTED;
      renderer.draw(dotTex.tex, dotTex.texW, dotTex.texH, dotTex.frame,
        x, dots.y, dotW, dotW, 0, c, c, c, 1);
    }

    // "Download the soundtrack" is an outbound link, outside the locked scope:
    // drawn because removing it would change the layout, but inert.
    const sound = fromGdUi(viewW * 0.5, s.bottom + SOUNDTRACK_Y, viewW, viewH);
    label("Download the soundtrack", sound.x, sound.y, LABEL_SCALE);

    alert?.draw(renderer, viewW, viewH);

    fade.draw(dt, scale, viewW, viewH);
    renderer.flush();
    requestAnimationFrame(loop);
  };

  loop();

  (window as unknown as Record<string, unknown>).__menu = {
    get info() {
      const { viewW, viewH } = resolveView(renderer.canvas.width, renderer.canvas.height);
      return {
        sel, pageCount: PAGE_COUNT,
        level: LEVELS[sel]?.n ?? null,
        name: LEVELS[sel]?.name ?? (sel === TOWER_PAGE ? "The Tower" : "Coming Soon!"),
        totalCoins: save.totalCoins(),
        viewW, viewH, scroll,
        pageColor: blendPageColor(wrapPage(Math.floor(scroll)), wrapPage(Math.floor(scroll) + 1),
          scroll - Math.floor(scroll)),
        panel: { x: panelBtn.x, y: panelBtn.y, w: PANEL_W, h: PANEL_H, scale: panelBtn.scale },
        alert: alert
          ? {
              t: alert.t, w: alert.layout.w, h: alert.layout.h, scale: alert.scale,
              controls: alert.menu.items.map((it) => ({
                id: it.id, x: alert!.menu.x + it.x, y: alert!.menu.y + it.y,
                w: it.contentW, h: it.contentH,
              })),
            }
          : null,
        controls: menus.flatMap((m) => m.items.map((it) => ({
          menu: m.id, id: it.id, x: m.x + it.x, y: m.y + it.y,
          w: it.contentW, h: it.contentH, scale: it.scale,
        }))),
      };
    },
    move,
    select: (n: number) => moveToPage(LEVELS.findIndex((l) => l.n === n)),
    play,
    back,
    /** design-space centre of a control, for the browser harnesses */
    at(id: string) {
      for (const m of menus) {
        for (const it of m.items) if (it.id === id) return { x: m.x + it.x, y: m.y + it.y };
      }
      return null;
    },
  };
}

export { levelInfo, colorForPage, pageColorRamp, blendPageColor, diffFrame };
export const LEVEL_SELECT_LAYOUT = {
  PANEL_W, PANEL_H, PANEL_Y, PANEL_MENU_Y, PANEL_OPACITY, PANEL_PRESS_SCALE,
  PAGE_COUNT, TOWER_PAGE, COMING_SOON_PAGE, TOWER_DOOR_Y, TOWER_LABEL_DY, COMING_SOON_Y,
  BAR_NORMAL_Y, BAR_PRACTICE_DY, BAR_FILL_SCALE_X, BAR_FILL_SCALE_Y,
  BAR_NORMAL_COLOR, BAR_PRACTICE_COLOR, LABEL_SCALE, MODE_LABEL_DY,
  STARS_X, STARS_Y, STARS_SCALE, COIN_BASE_X, COIN_Y, COIN_DX,
  DIFF_SCALE, NAME_GAP, NAME_OFFSET, NAME_MAX_WIDTH, PANEL_ROW_Y,
  NAV_ARROW_INSET, NAV_ARROW_SIZE_MULT, BACK_INSET_X, BACK_INSET_Y, BACK_SIZE_MULT,
  DOTS_Y, DOT_SPACING, DOT_UNSELECTED, SOUNDTRACK_Y, GROUND_OFFSET, GROUND_MAX_Y,
  GROUND_TINT_FACTOR, TOP_BAR_Y, SIDE_ART_INSET, BG_OVERSCAN, BG_BASE_TINT,
  PAGE_COLOR_INDICES, PAGE_COLOR_DARK, PAGE_FRAMES, BAR_BG_OPACITY,
  MOVE_DURATION, MOVE_ELASTIC_PERIOD,
} as const;
