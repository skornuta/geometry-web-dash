/**
 * `MenuLayer` — the game's actual front door, reproduced from the shipping
 * 2.2081 binary (m1 `0x316688`). Every position, scale, sprite name, z-order,
 * padding and duration below is decoded, not designed; the working is in
 * `docs/ui-parity/REFERENCE.md` §5 and §6, which names the offset each value
 * came from.
 *
 * Layout is expressed in the original's own UI space — origin at the bottom
 * left of the win size, +Y up — and converted once per frame by `fromGdUi`,
 * because that is the only way the formulas stay recognisably the ones in the
 * binary. This is *not* the gameplay `gd_y = our_y + 90` shift; menu positions
 * are not world heights.
 *
 * What is deliberately **not** here, and why, is listed under "scope
 * exceptions" in REFERENCE.md §8: the profile button, the daily chest and the
 * quit button would each need account, currency or process state this port does
 * not have, so they are omitted rather than faked. Creator, achievements,
 * newgrounds, the social row and more-games *are* drawn — removing them would
 * change the layout this file exists to reproduce — but they are inert, because
 * their destinations are outside the locked project scope. Stats opens the
 * offline stats page (`ui/statsLayer.ts`).
 */

import { SceneFade } from "../engine/transition.ts";
import { Renderer } from "../engine/renderer.ts";
import { createTexture, loadAtlas, loadImage, setRepeatWrap, type SpriteFrame } from "../engine/atlas.ts";
import { AudioEngine } from "../engine/audio.ts";
import { LoadedFont } from "../engine/bmfont.ts";
import { resolveView } from "../gd/camera.ts";
import { HD } from "../gd/sheets.ts";
import { GRAVITY, JUMP_VELOCITY, SPEEDS, integrate, snapRotation, type CubeState } from "../gd/physics.ts";
import { ICON_COUNTS, PLAYER_COLORS, iconFrames, playerColor } from "../gd/icons.ts";
import { IconSheets } from "../gd/iconSheets.ts";
import * as save from "../gd/save.ts";
import { downloadSaveFile, openSaveFilePicker } from "../gd/progressFile.ts";
import { UiSprites, drawUiSprite, fromGdUi, screenBounds, type UiFrame } from "../ui/sprites.ts";
import { MenuHost, MenuItem, UiMenu } from "../ui/controls.ts";
import { OPTIONS_FRAMES, OptionsOverlay, type OptionsTextures } from "../ui/optionsOverlay.ts";
import { StatsLayer } from "../ui/statsLayer.ts";
import { SLIDER_BAR, SLIDER_GROOVE, SLIDER_THUMB, SLIDER_THUMB_SEL } from "../ui/optionsMenu.ts";

/* ------------------------------------------------------------------ *
 * Sourced constants. Each names the offset in MenuLayer::init it came
 * from, so a future reader can re-derive it rather than trust the name.
 * ------------------------------------------------------------------ */

/** logo sits this far below `getScreenTop()` — init +228 `fadd s1, s0, -50` */
const LOGO_TOP_INSET = 50;
/** main menu centre offset above the win-size centre — init +376 `fadd s1, s1, 10` */
const MAIN_MENU_Y_OFFSET = 10;
/** garage and creator sit this far either side of the play button — init +492 / +772 */
const SIDE_BUTTON_DX = 110;
/** bottom menu baseline above `getScreenBottom()` — init +976 */
const BOTTOM_MENU_Y = 45;
/** `alignItemsHorizontallyWithPadding(5)` — init +1384 */
const BOTTOM_MENU_PADDING = 5;
/** social menu origin — init +1548 `screenLeft + 50`, +1568 `screenBottom + 30 - 5` */
const SOCIAL_MENU_X = 50;
const SOCIAL_MENU_Y = 25;
/** first social icon — init +2064 `screenLeft + 22`, +2080 `screenBottom + 30 + 25` */
const SOCIAL_FIRST_X = 22;
const SOCIAL_FIRST_Y = 55;
/** social icons step 29 apart, and discord hangs 29 *below* youtube — init +2152.. */
const SOCIAL_STEP = 29;
/** more-games menu — init +2528 `screenRight - 43`, y = `screenBottom + 45` */
const MORE_GAMES_X_INSET = 43;
/** the "you have not opened the garage yet" flag offset — init +492/+636 */
const NEW_FLAG_DX = -50;
const NEW_FLAG_DY = -50;
/** `CCTransitionFade::create(0.5f, ...)` in onPlay / onGarage / onCreator */
const SCENE_FADE = 0.5;

/* --- MenuGameLayer, m1 0x4527f4 --- */

/** `setColor({0, 102, 255})` — init +288, and `updateColor`'s case 0 */
const MENU_BLUE: readonly [number, number, number] = [0, 102, 255];
/**
 * `updateColor`'s cycle: `switch (m_initCount % 8)`, each case a
 * `GameManager::colorForIdx` index, tinted over 4 s. Index 0 is the hardcoded
 * menu blue; the rest are palette entries, and entries 0-41 of the port's
 * `PLAYER_COLORS` are byte-for-byte the binary's `colorForIdx` table.
 */
const BG_COLOR_CYCLE: readonly (readonly [number, number, number])[] = [
  MENU_BLUE,
  PLAYER_COLORS[7], PLAYER_COLORS[8], PLAYER_COLORS[9],
  PLAYER_COLORS[10], PLAYER_COLORS[11], PLAYER_COLORS[1], PLAYER_COLORS[3],
];
/** `schedule(updateColor, 5.0f)` — init +944 */
const BG_COLOR_INTERVAL = 5;
/** `CCTintTo::create(4.0f, ...)` — updateColor +248 */
const BG_TINT_DURATION = 4;
/** ground tint is the background's times this — updateColor +316, single-layer ground */
const GROUND_TINT_FACTOR = 0.8;
/** `m_realBackgroundPosition * -0.1` — update +544 (`0xbdcccccd`) */
const BG_PARALLAX = 0.1;
/**
 * `AppDelegate::bgScale()` (m1 `0x57c05c`) tail-calls `CCDirector`'s accessor at
 * `0x3ea8b8`, which is `ldr s0, [x0, #0x44]` — the **larger** of the two axis
 * ratios written by `setDesignResolution` (`0x3e9674 +196`). With the port's own
 * 480x320 design resolution that is `max(viewW/480, viewH/320)`, which is also
 * what keeps the single background sprite covering a tall window.
 */
function bgScale(viewW: number, viewH: number): number {
  return Math.max(viewW / 480, viewH / 320);
}
/** ground surface height in the original's UI space — GJGroundLayer at y=90, init +416 */
const GROUND_SURFACE_Y = 90;
/** the decorative player's y — init +600 (`105.0`), i.e. a cube standing on the ground */
const PLAYER_Y = 105;
/** `schedule(tryJump, 0.25f)` — init +920 */
const TRY_JUMP_INTERVAL = 0.25;
/** the cube's jump probability per tryJump tick — tryJump `0x3ecccccd` */
const JUMP_CHANCE = 0.4;
/** respawn x is `rand01 * 5 * -100 - 100` — resetPlayer +68..76 */
const RESPAWN_X_MIN = -600;
const RESPAWN_X_MAX = -100;
/** reset once the cube passes this far beyond the right edge — update +452 */
const RESET_X_MARGIN = 100;

/** every frame MenuLayer draws, so a missing one fails loudly at load */
const MENU_FRAMES = [
  "GJ_logo_001.png",
  "GJ_playBtn_001.png",
  "GJ_garageBtn_001.png",
  "GJ_creatorBtn_001.png",
  "GJ_chrSel_001.png",
  "GJ_achBtn_001.png",
  "GJ_optionsBtn_001.png",
  "GJ_statsBtn_001.png",
  "GJ_ngBtn_001.png",
  "robtoplogo_small.png",
  "gj_fbIcon_001.png",
  "gj_twIcon_001.png",
  "gj_ytIcon_001.png",
  "gj_twitchIcon_001.png",
  "gj_discordIcon_001.png",
  "GJ_moreGamesBtn_001.png",
  // GJGroundLayer::createLine formats `floorLine_%02d_001.png` with its lineType
  // argument, and MenuGameLayer passes 1 (init +376)
  "floorLine_01_001.png",
] as const;

interface LooseTex { tex: WebGLTexture; texW: number; texH: number; frame: SpriteFrame }

/** a 2x2 opaque white texture, the only way to draw a flat rectangle here */
function whiteTexture(renderer: Renderer): LooseTex {
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

async function loadLooseTexture(
  renderer: Renderer, url: string, repeat = false,
): Promise<LooseTex> {
  const img = await loadImage(url);
  const tex = createTexture(renderer.ctx, img);
  // the slider's bar tiles rather than stretching — see `setRepeatWrap`
  if (repeat) setRepeatWrap(renderer.ctx, tex);
  return {
    tex,
    texW: img.width, texH: img.height,
    frame: {
      x: 0, y: 0, w: img.width, h: img.height, rotated: false,
      offsetX: 0, offsetY: 0, sourceW: img.width, sourceH: img.height,
    },
  };
}

type Rgb = readonly [number, number, number];

const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export async function startMainMenu(renderer: Renderer) {
  const sprites = await UiSprites.load(renderer, [
    // order matters only for duplicate names; GJ_playBtn_001 lives in 04 and
    // GJ_playBtn2_001 in 03, which is exactly the confusion the plan warns about
    "GJ_GameSheet04-hd", "GJ_GameSheet03-hd", "GJ_LaunchSheet-hd", "GJ_GameSheetIcons-hd",
    "GJ_GameSheet02-hd", // floorLine_01_001, the bright line on the ground surface
  ]);
  sprites.requireAll(MENU_FRAMES);
  const iconSheets = new IconSheets(renderer, sprites);

  const [bgTex, groundTex] = await Promise.all([
    loadLooseTexture(renderer, "/assets/game_bg_01_001-hd.png"),
    loadLooseTexture(renderer, "/assets/groundSquare_01_001-hd.png"),
  ]);

  const white = whiteTexture(renderer);

  /* ---------------- settings drop-down assets ---------------- */

  const [buttonTex, square01, square02, groove, bar, thumb, thumbSel] = await Promise.all([
    loadLooseTexture(renderer, "/assets/GJ_button_01-hd.png"),
    loadLooseTexture(renderer, "/assets/GJ_square01-hd.png"),
    loadLooseTexture(renderer, "/assets/GJ_square02-hd.png"),
    loadLooseTexture(renderer, `/assets/${SLIDER_GROOVE.replace(".png", "-hd.png")}`),
    loadLooseTexture(renderer, `/assets/${SLIDER_BAR.replace(".png", "-hd.png")}`, true),
    loadLooseTexture(renderer, `/assets/${SLIDER_THUMB.replace(".png", "-hd.png")}`),
    loadLooseTexture(renderer, `/assets/${SLIDER_THUMB_SEL.replace(".png", "-hd.png")}`),
  ]);
  const optionsTextures: OptionsTextures = {
    button: buttonTex, square01, square02, white,
    slider: { groove, bar, thumb, thumbSel },
  };
  const [font, goldFont] = await Promise.all([
    LoadedFont.load(renderer, "/assets/bigFont-hd.fnt", "/assets/bigFont-hd.png"),
    LoadedFont.load(renderer, "/assets/goldFont-hd.fnt", "/assets/goldFont-hd.png"),
  ]);
  const audio = new AudioEngine(save.settings());
  const kit = save.icons();

  /* ---------------- navigation ---------------- */

  /** `CCTransitionFade` in and out of this scene (see engine/transition.ts) */
  const fade = new SceneFade(renderer);
  const navigate = (go: () => void) => fade.go(go);
  const goPlay = () => navigate(() => { audio.stopMusic(); location.search = "?levels=1"; });
  const goGarage = () => navigate(() => {
    // `onGarage` sets GameManager+0x377, which is what removes the GJ_chrSel flag
    save.setSettings({ seenGarage: true });
    audio.stopMusic();
    location.search = "?icons=1";
  });
  /**
   * `MenuLayer::onOptions` does **not** change scene: it adds an `OptionsLayer`
   * over the running menu and slides it in. The port does the same, which is
   * why the background, the cube and the music all keep going behind it.
   */
  let overlay: OptionsOverlay | null = null;
  /** the Stats page, over the menu like the settings drop-down */
  let stats: StatsLayer | null = null;

  /**
   * `GJDropDownLayer`'s two chains are the one piece of settings art that lives
   * in `GJ_GameSheet`, a 1.6 MB atlas nothing else on this screen needs — so it
   * is fetched the first time the layer opens rather than on every menu load.
   * A missing frame still throws out of `requireAll`, as the plan requires.
   */
  let optionsArtLoaded = false;
  const loadOptionsArt = async () => {
    if (optionsArtLoaded) return;
    const sheet = await loadAtlas(renderer,
      "/assets/GJ_GameSheet-hd.plist", "/assets/GJ_GameSheet-hd.png");
    sprites.add({ name: "GJ_GameSheet-hd", ...sheet });
    sprites.requireAll(OPTIONS_FRAMES);
    optionsArtLoaded = true;
  };

  const goOptions = () => {
    if (overlay) return;
    startMusic();
    // the async half only runs once; afterwards this opens on the same frame
    if (!optionsArtLoaded) { void loadOptionsArt().then(goOptions); return; }
    overlay = new OptionsOverlay({
      renderer, sprites, font, goldFont, textures: optionsTextures,
      setMusicVolume: (v) => audio.setMusicVolume(v),
      setSfxVolume: (v) => audio.setSfxVolume(v),
      onClose: closeOptions,
    });
    // `disableUI()`: the menu underneath stops taking touches while it is up
    host.dispose();
  };
  const closeOptions = () => {
    overlay?.dispose();
    overlay = null;
    host = makeHost();
  };
  /** the Stats button: a page over the menu, like the settings drop-down */
  const goStats = () => {
    if (overlay || stats) return;
    startMusic();
    if (!optionsArtLoaded) { void loadOptionsArt().then(goStats); return; }
    stats = new StatsLayer({
      renderer, sprites, font, white, goldFont, button: optionsTextures.button,
      onClose: closeStats, onExportSave: downloadSaveFile, onImportSave: openSaveFilePicker,
    });
    host.dispose();
  };
  const closeStats = () => {
    stats?.dispose();
    stats = null;
    host = makeHost();
  };

  /* ---------------- menus ---------------- */

  const item = (
    id: string, name: string, opts: Partial<{
      x: number; y: number; spriteScale: number; sizeMult: number; onActivate: () => void;
    }> = {},
  ) => new MenuItem({ id, frame: sprites.require(name), ...opts });

  // 1. the main menu: play, with garage and creator either side
  const mainMenu = new UiMenu("main");
  mainMenu.add(item("play", "GJ_playBtn_001.png", { onActivate: goPlay }));
  const garageBtn = mainMenu.add(item("garage", "GJ_garageBtn_001.png",
    { x: -SIDE_BUTTON_DX, onActivate: goGarage }));
  // Creator opens the editor/online hub, which is outside the locked scope, so
  // it draws and presses exactly as the original does but has no destination.
  mainMenu.add(item("creator", "GJ_creatorBtn_001.png", { x: SIDE_BUTTON_DX }));

  // 2. the bottom row, laid out by the original's own alignment rule
  const bottomMenu = new UiMenu("bottom");
  bottomMenu.add(item("achievements", "GJ_achBtn_001.png"));
  bottomMenu.add(item("options", "GJ_optionsBtn_001.png", { onActivate: goOptions }));
  bottomMenu.add(item("stats", "GJ_statsBtn_001.png", { onActivate: goStats }));
  bottomMenu.add(item("newgrounds", "GJ_ngBtn_001.png"));
  bottomMenu.alignItemsHorizontallyWithPadding(BOTTOM_MENU_PADDING);

  // 3. the RobTop logo and the social row hanging off it
  const socialMenu = new UiMenu("social");
  socialMenu.add(item("robtop", "robtoplogo_small.png", { spriteScale: 0.8, sizeMult: 1.1 }));
  const social = (id: string, name: string) =>
    socialMenu.add(item(id, name, { spriteScale: 0.8, sizeMult: 1.5 }));
  const fbBtn = social("facebook", "gj_fbIcon_001.png");
  const twBtn = social("twitter", "gj_twIcon_001.png");
  const ytBtn = social("youtube", "gj_ytIcon_001.png");
  const twitchBtn = social("twitch", "gj_twitchIcon_001.png");
  const discordBtn = social("discord", "gj_discordIcon_001.png");

  // 4. more games, alone in its own menu exactly as the original has it
  const moreGamesMenu = new UiMenu("moreGames");
  moreGamesMenu.add(item("moreGames", "GJ_moreGamesBtn_001.png", { spriteScale: 0.9 }));

  const menus = [mainMenu, bottomMenu, socialMenu, moreGamesMenu];

  /* ---------------- background state ---------------- */

  /** `m_initCount`: init increments it once, then updateColor runs immediately */
  let colorIndex = 1;
  let colorTimer = 0;
  let tintT = BG_TINT_DURATION;
  let tintFrom: Rgb = MENU_BLUE;
  let tintTo: Rgb = BG_COLOR_CYCLE[colorIndex % BG_COLOR_CYCLE.length];
  let bgScroll = 0;

  const advanceColor = () => {
    tintFrom = lerpRgb(tintFrom, tintTo, Math.min(1, tintT / BG_TINT_DURATION));
    tintTo = BG_COLOR_CYCLE[colorIndex % BG_COLOR_CYCLE.length];
    colorIndex++;
    tintT = 0;
  };
  advanceColor(); // `updateColor` is called once directly at the end of init

  /* ---------------- the decorative cube ---------------- */

  const cube: CubeState = {
    x: RESPAWN_X_MAX, y: 15, yVel: 0, onGround: true, rotation: 0,
    gravityFlipped: false, queuedHold: false, justHeld: false,
    slopeTime: 0, slopeVelocity: 0,
  };
  let cubeIcon = 1;
  let cubeCol1 = kit.col1;
  let cubeCol2 = kit.col2;
  let jumpTimer = 0;
  let holdingJump = false;

  const randomPaletteIndex = () =>
    // The original draws `colorForIdx(rand * 108)`; the port's sourced palette
    // currently stops at 42 (extending it is Task 4's job), so the menu cube
    // picks from what is actually available. Recorded in REFERENCE.md §8.
    Math.floor(Math.random() * PLAYER_COLORS.length);

  const resetCube = () => {
    cube.x = RESPAWN_X_MIN + Math.random() * (RESPAWN_X_MAX - RESPAWN_X_MIN);
    cube.y = 15;
    cube.yVel = 0;
    cube.onGround = true;
    cube.rotation = 0;
    cubeIcon = 1 + Math.floor(Math.random() * ICON_COUNTS.cube);
    // most of 2.2's cubes live in their own sheets; drawCube skips the icon
    // until its sheet has arrived, which is a frame or two
    void iconSheets.load("cube", cubeIcon)
      .catch((e) => console.error("menu cube sheet failed to load:", e));
    cubeCol1 = randomPaletteIndex();
    cubeCol2 = randomPaletteIndex();
  };
  resetCube();

  /* ---------------- audio ---------------- */

  let musicStarted = false;
  const startMusic = () => {
    // `GameManager::fadeInMenuMusic()` runs inside MenuLayer::init; a browser
    // cannot, so the same track starts on the first gesture instead.
    if (musicStarted) return;
    musicStarted = true;
    audio.ensure();
    void audio.playMusic("/assets/menuLoop.mp3", 0);
  };

  /* ---------------- input ---------------- */

  const makeHost = () => new MenuHost(renderer.canvas, menus,
    () => resolveView(renderer.canvas.width, renderer.canvas.height).scale, startMusic);
  let host = makeHost();

  addEventListener("keydown", (e) => {
    startMusic();
    if (overlay && overlay.handleKey(e.code)) { e.preventDefault(); return; }
    if (overlay) return;
    if (stats) { if (stats.handleKey(e.code)) e.preventDefault(); return; }
    switch (e.code) {
      case "Enter": case "Space": e.preventDefault(); goPlay(); break;
      case "KeyI": e.preventDefault(); goGarage(); break;
      case "KeyO": e.preventDefault(); goOptions(); break;
    }
  });

  // `?settings=1` is the port's deep link to the same layer the gear opens
  if (new URLSearchParams(location.search).has("settings")) goOptions();

  /* ---------------- layout + draw ---------------- */

  let last = performance.now();

  /**
   * Re-derive every position from the live view size. The original computes
   * these once because a cocos window does not change size mid-scene; a browser
   * one does, so the formulas run per frame instead of being baked in.
   */
  function layout(viewW: number, viewH: number) {
    const s = screenBounds(viewW, viewH);
    const gd = (x: number, y: number) => fromGdUi(x, y, viewW, viewH);

    const main = gd(viewW * 0.5, viewH * 0.5 + MAIN_MENU_Y_OFFSET);
    mainMenu.setPosition(main.x, main.y);

    const bottom = gd(viewW * 0.5, s.bottom + BOTTOM_MENU_Y);
    bottomMenu.setPosition(bottom.x, bottom.y);

    const socialPos = gd(s.left + SOCIAL_MENU_X, s.bottom + SOCIAL_MENU_Y);
    socialMenu.setPosition(socialPos.x, socialPos.y);
    // The social icons are positioned in world space and converted into the
    // menu's node space, so they do not move with the RobTop logo.
    const first = gd(s.left + SOCIAL_FIRST_X, s.bottom + SOCIAL_FIRST_Y);
    fbBtn.x = first.x - socialMenu.x; fbBtn.y = first.y - socialMenu.y;
    twBtn.x = fbBtn.x + SOCIAL_STEP; twBtn.y = fbBtn.y;
    ytBtn.x = twBtn.x + SOCIAL_STEP; ytBtn.y = twBtn.y;
    twitchBtn.x = ytBtn.x + SOCIAL_STEP; twitchBtn.y = ytBtn.y;
    // discord hangs off *youtube*, not twitch — init +2344 re-reads x27
    discordBtn.x = ytBtn.x + SOCIAL_STEP; discordBtn.y = ytBtn.y - SOCIAL_STEP;

    const more = gd(s.right - MORE_GAMES_X_INSET, s.bottom + BOTTOM_MENU_Y);
    moreGamesMenu.setPosition(more.x, more.y);
  }

  function drawBackground(viewW: number, viewH: number, color: Rgb) {
    // anchor (0,0) at the bottom left, scaled by bgScale — MenuGameLayer::init
    // +212 and +240. The wrap period is the sprite's own scaled width, which is
    // what `[0x1c8] = rect.w * scaleX` records before the rect is doubled.
    const tile = bgTex.frame.w * HD * bgScale(viewW, viewH);
    const [r, g, b] = color;
    const left = -viewW / 2;
    const bottom = -viewH / 2;
    // `m_realBackgroundPosition * -0.1`, wrapped by the texture's own width
    const offset = -((((bgScroll * BG_PARALLAX) % tile) + tile) % tile);
    for (let x = left + offset; x < viewW / 2 + tile; x += tile) {
      renderer.draw(bgTex.tex, bgTex.texW, bgTex.texH, bgTex.frame,
        x + tile / 2, bottom + tile / 2, tile, tile, 0, r / 255, g / 255, b / 255, 1);
    }
  }

  function drawGround(viewW: number, viewH: number, color: Rgb) {
    const tile = groundTex.frame.w * HD;
    const surface = fromGdUi(0, GROUND_SURFACE_Y, viewW, viewH).y;
    const r = (color[0] / 255) * GROUND_TINT_FACTOR;
    const g = (color[1] / 255) * GROUND_TINT_FACTOR;
    const b = (color[2] / 255) * GROUND_TINT_FACTOR;
    // the ground layer moves at full rate: `-m_realBackgroundPosition.x`
    const offset = -(((bgScroll % tile) + tile) % tile);
    for (let x = -viewW / 2 + offset; x < viewW / 2 + tile; x += tile) {
      for (let y = surface; y > -viewH / 2 - tile; y -= tile) {
        renderer.draw(groundTex.tex, groundTex.texW, groundTex.texH, groundTex.frame,
          x + tile / 2, y - tile / 2, tile, tile, 0, r, g, b, 1);
      }
    }
    // `GJGroundLayer::createLine` never tints its sprite, so the line is the
    // cocos default white. Stretched across the view exactly as the level
    // scene does, since the original scales the same sprite to the win size.
    const line = sprites.require("floorLine_01_001.png");
    const lh = line.frame.h * HD;
    renderer.draw(line.sheet.tex, line.sheet.texW, line.sheet.texH, line.frame,
      0, surface + lh / 2, viewW + 8, lh, 0, 1, 1, 1, 1);
  }

  function drawCube(viewW: number, viewH: number) {
    const names = iconFrames("cube", cubeIcon);
    const c1 = playerColor(cubeCol1), c2 = playerColor(cubeCol2);
    const base = fromGdUi(cube.x, PLAYER_Y - 15 + cube.y, viewW, viewH);
    const rot = (-cube.rotation * Math.PI) / 180; // renderer takes CCW radians
    const put = (name: string | undefined, r: number, g: number, b: number) => {
      if (!name || !sprites.has(name)) return;
      const f: UiFrame = sprites.require(name);
      drawUiSprite(renderer, f, base.x, base.y, { r, g, b, rotation: rot });
    };
    put(names.main, c1.r, c1.g, c1.b);
    put(names.detail, c2.r, c2.g, c2.b);
    put(names.extra, 1, 1, 1);
    put(names.dome, 1, 1, 1);
  }

  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;

    renderer.resize();
    const { scale, viewW, viewH } = resolveView(renderer.canvas.width, renderer.canvas.height);

    /* --- background colour cycle --- */
    colorTimer += dt;
    if (colorTimer >= BG_COLOR_INTERVAL) { colorTimer -= BG_COLOR_INTERVAL; advanceColor(); }
    tintT = Math.min(BG_TINT_DURATION, tintT + dt);
    const bgColor = lerpRgb(tintFrom, tintTo, tintT / BG_TINT_DURATION);

    /* --- the decorative cube, and the scroll it drives --- */
    jumpTimer += dt;
    while (jumpTimer >= TRY_JUMP_INTERVAL) {
      jumpTimer -= TRY_JUMP_INTERVAL;
      holdingJump = Math.random() < JUMP_CHANCE;
    }
    const before = cube.x;
    integrate(cube, dt, SPEEDS[1], holdingJump && cube.onGround);
    if (cube.y <= 15 && cube.yVel <= 0) {
      cube.y = 15;
      cube.yVel = 0;
      if (!cube.onGround) cube.rotation = snapRotation(cube.rotation);
      cube.onGround = true;
    }
    bgScroll += cube.x - before;
    if (cube.x > viewW + RESET_X_MARGIN) resetCube();

    if (overlay) {
      overlay.update(dt);
      overlay.layout(viewW, viewH);
    } else if (stats) {
      stats.update(dt);
      stats.layout(viewW, viewH);
    } else {
      host.update(dt);
    }
    layout(viewW, viewH);

    renderer.camera = { x: 0, y: 0, scale };
    renderer.begin();

    drawBackground(viewW, viewH, bgColor);   // z -100
    drawGround(viewW, viewH, bgColor);       // z 100 in the original; nothing overlaps it here
    drawCube(viewW, viewH);                  // z 60

    // logo, z 2
    const logo = fromGdUi(viewW * 0.5, viewH - LOGO_TOP_INSET, viewW, viewH);
    drawUiSprite(renderer, sprites.require("GJ_logo_001.png"), logo.x, logo.y);

    for (const menu of menus) menu.draw(renderer);

    // the "you have not been to the garage yet" flag, gated exactly as the
    // original gates it on GameManager+0x377
    if (!save.settings().seenGarage) {
      const g = mainMenu.toDesign(garageBtn.x, garageBtn.y);
      drawUiSprite(renderer, sprites.require("GJ_chrSel_001.png"),
        g.x + NEW_FLAG_DX, g.y + NEW_FLAG_DY);
    }

    // the drop-down sits over the whole menu, dim included
    overlay?.draw(viewW, viewH);
    stats?.draw(viewW, viewH);

    fade.draw(dt, scale, viewW, viewH);
    renderer.flush();
    requestAnimationFrame(loop);
  };

  loop();

  // Harness surface: the browser checks click real controls, but they also need
  // to read what is on screen and where, without scraping pixels.
  (window as unknown as Record<string, unknown>).__mainMenu = {
    get info() {
      const { viewW, viewH } = resolveView(renderer.canvas.width, renderer.canvas.height);
      return {
        viewW, viewH,
        navigating: fade.leaving,
        cube: { x: cube.x, y: cube.y, icon: cubeIcon, onGround: cube.onGround },
        seenGarage: save.settings().seenGarage,
        stats: stats ? { controls: stats.controls() } : null,
        options: overlay
          ? {
              t: overlay.t, popup: overlay.popupOpen,
              music: overlay.sliderValue("music"), sfx: overlay.sliderValue("sfx"),
              controls: overlay.controls(),
            }
          : null,
        items: menus.flatMap((m) => m.items.map((it) => ({
          menu: m.id, id: it.id,
          x: m.x + it.x, y: m.y + it.y,
          w: it.contentW, h: it.contentH,
          scale: it.scale,
          acts: it.onActivate !== null,
        }))),
      };
    },
    /** design-space centre of a control, for the harnesses to click */
    at(id: string) {
      for (const m of menus) {
        for (const it of m.items) if (it.id === id) return { x: m.x + it.x, y: m.y + it.y };
      }
      return null;
    },
    press(id: string) {
      const p = (this as { at(id: string): { x: number; y: number } | null }).at(id);
      if (!p) throw new Error(`no menu item ${id}`);
      host.touch.began(p.x, p.y);
    },
    release() { return host.touch.ended()?.id ?? null; },
    openOptions: goOptions,
    closeOptions,
    openStats: goStats,
    closeStats,
    /** the drop-down's `Options` button: MoreOptionsLayer */
    openMoreOptions: () => overlay?.openMoreOptions(),
    /** design-space centre of a settings control, drop-down or popup */
    optionAt(id: string) {
      return overlay?.controls().find((c) => c.id === id) ?? null;
    },
  };
}

/** exported for the physics-free tests and for anything that wants the constants */
export const MAIN_MENU_LAYOUT = {
  LOGO_TOP_INSET, MAIN_MENU_Y_OFFSET, SIDE_BUTTON_DX, BOTTOM_MENU_Y, BOTTOM_MENU_PADDING,
  SOCIAL_MENU_X, SOCIAL_MENU_Y, SOCIAL_FIRST_X, SOCIAL_FIRST_Y, SOCIAL_STEP,
  MORE_GAMES_X_INSET, NEW_FLAG_DX, NEW_FLAG_DY, SCENE_FADE,
  MENU_BLUE, BG_COLOR_CYCLE, BG_COLOR_INTERVAL, BG_TINT_DURATION, GROUND_TINT_FACTOR,
  BG_PARALLAX, GROUND_SURFACE_Y, PLAYER_Y, TRY_JUMP_INTERVAL, JUMP_CHANCE,
  RESPAWN_X_MIN, RESPAWN_X_MAX, RESET_X_MARGIN, MENU_FRAMES,
  GRAVITY, JUMP_VELOCITY,
} as const;
