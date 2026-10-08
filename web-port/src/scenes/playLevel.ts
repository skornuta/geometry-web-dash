// M3 + M4: playable level — all 8 gamemodes, portals/orbs/pads, collision,
// death/retry and a progress bar.
import { SceneFade } from "../engine/transition.ts";
import { Renderer } from "../engine/renderer.ts";
import { createTexture, loadAtlas, loadImage, setRepeatWrap, type SpriteFrame } from "../engine/atlas.ts";
import { LevelScene, HD, headerFloat } from "./levelScene.ts";
import { CollisionWorld, slopeSurfaceY, PLAYER_INNER_HALF } from "../game/collision.ts";
import {
  applyPortalsBefore, createSim, resetSim, simPress, simStep, STEP,
  type SimEffect, type SimState,
} from "../game/sim.ts";
import { CheckpointStack } from "../gd/checkpoints.ts";
import * as save from "../gd/save.ts";
import { PendingCoins } from "../gd/pendingCoins.ts";
import { ICON_TABS, iconFrames, playerColor, clampIcon, PLAYER_COLORS, playerGlow } from "../gd/icons.ts";
import { IconSheets } from "../gd/iconSheets.ts";
import type { CCEmitter } from "../engine/ccparticles.ts";
import type { MotionStreak } from "../engine/streak.ts";
import {
  PlayerEffects, EffectPool, loadEffectLibrary, particleColors, deathExplosion, deathVehicleScale,
  DEATH_WAVES, DEATH_FRAME_DELAY, DEATH_FRAME_DELAY_VAR, DEATH_SCALE, DEATH_SCALE_VAR,
  DEATH_ROTATION_VAR, DEATH_LAST_FRAME, GLITTER_MODES, glitterEmitter, objectEmitter, oneShot, orbWaveColor, orbWaveFrom,
  ORB_WAVE_TO, ORB_WAVE_DURATION, speedEffectFor, Shake, DEATH_SHAKE, type WaveTrail,
} from "../gd/effects.ts";
import {
  NEW_BEST_FRAME, NEW_BEST_LABEL_SCALE, NEW_BEST_LABEL_Y, NEW_BEST_Y,
  deathPercent, newBestLabel, newBestScale, shouldShowNewBest,
} from "../gd/newBest.ts";
import { circleWaveAt, LEVEL_TIMESTAMP, progressPercent, type CircleWaveSpec } from "../gd/levelEnd.ts";
import { OBJECT_DEFS } from "../gd/objects.ts";
import { P, propFloat } from "../gd/props.ts";
import { ROBOT_HOLD_MAX } from "../gd/gamemodes.ts";
import { SPEEDS, PLAYER_SIZE, MINI_SCALE, gravitySign } from "../gd/physics.ts";
import { setGamemode, type Gamemode, type PlayerState } from "../gd/gamemodes.ts";
import { movableGroups, resolveColor as channelColor } from "../gd/triggers.ts";

/** a colour channel as plain 0-255 rgb, for the effects that take one */
function channelRgb(
  rt: Parameters<typeof channelColor>[0], ch: number,
): [number, number, number] {
  const c = channelColor(rt, ch);
  return [c.r, c.g, c.b];
}
import { AudioEngine } from "../engine/audio.ts";
import { AudioEffects, newPulse, stepPulse } from "../gd/audioPulse.ts";
import { AUDIO_STRINGS } from "../gd/audioStrings.ts";
import { LoadedFont } from "../engine/bmfont.ts";
import {
  currentPercent, currentPercentInt, drawHud, hudGeometry, type HudSettings,
} from "../ui/gameplayHud.ts";
import { UiSprites, contentSize, drawNineSlice, drawUiSprite, type UiFrame } from "../ui/sprites.ts";
import { MenuHost } from "../ui/controls.ts";
import { TogglePopup } from "../ui/optionsOverlay.ts";
import {
  DROP_DIM_OPACITY, DROP_DURATION, GAME_OPTIONS, GAME_OPTIONS_Y_OFFSET,
  SLIDER_BAR, SLIDER_GROOVE, SLIDER_THUMB, SLIDER_THUMB_SEL, drawLabel, dropDownLayout,
} from "../ui/optionsMenu.ts";
import { VolumeSliders } from "../ui/volumeSliders.ts";
import { drawDropDownPanel } from "../ui/optionsOverlay.ts";
import {
  COIN_BLANK_FRAME, COIN_FILLED_FRAME, COMPLETE_FRAME, END_LEVEL_FRAMES,
  END_LEVEL_HEIGHT, END_LEVEL_Y_NUDGE, MENU_FRAME, PRACTICE_COMPLETE_FRAME,
  RESTART_CHECKPOINT_FRAME, REPLAY_FRAME, drawEndLevel, endLevelLayout,
  randomEndText, type EndLevelStats,
} from "../ui/endLevelMenu.ts";
import {
  DIM_COLOR, DIM_OPACITY, GEAR_SCALE, NAME_SCALE, PANEL_OPACITY, PAUSE_FRAMES,
  PRACTICE_OFF_FRAME, ROW_PADDING, SLIDER_LABEL_DY, SLIDER_LABEL_SCALE, SLIDER_SCALE,
  drawPauseBar, pauseLayout, pauseRow, showPracticeHint,
} from "../ui/pauseMenu.ts";
import { gameplaySfx, musicUrl, SFX } from "../gd/audio-map.ts";
import { COINS_PER_LEVEL, LEVELS } from "../gd/levels.ts";
import { BACK_LIMB_TINT } from "../gd/anim.ts";
import { animFrame, createAnimPlayer, stepAnim, type LimbMode } from "../gd/player-anim.ts";
import {
  CAMERA_LEAD, GD_Y_OFFSET, VIEW_H, cameraBottomTarget, cameraLeftFor, dualCameraBottom, resolveView, setLevelHeightCap,
} from "../gd/camera.ts";
import { toWorld } from "../game/frame.ts";
import {
  CAMERA_SETTLE_DURATION, CAMERA_SETTLE_EASING, CAMERA_SETTLE_RATE, COMPLETE_SHAKE_STRENGTH,
  BANNER_DY, clampCameraLeft, endPortalY,
} from "../gd/levelEnd.ts";
import { EndSequence } from "../gd/endSequence.ts";
import { easedValue } from "../gd/easing.ts";
import { groupAnchor } from "../gd/triggers.ts";
import { scaledBandEdge, stepViewStaticPair } from "../gd/camera.ts";
import type { CustomLevel } from "../gd/gmd.ts";
import {
  createEndViewTextures, drawEndFlash, drawEndGhosts, drawEndPortal, drawEndScreen, drawEndWorld,
  drawWave,
} from "./levelEndView.ts";

/** never simulate more than this much time in one frame (tab was backgrounded) */
const MAX_FRAME = 0.25;
/** how long the cube stays dead before the level restarts */
const RESPAWN_DELAY = 0.8;
/** the view a Camera Static holds this frame, written by `stepViewStatic` (reused, no per-frame allocation) */
const VIEW_OUT = { x: 0, y: 0 };
/** the ball's roll, degrees per world unit travelled (native macros, see the "ball" case) */
const BALL_ROLL_PER_UNIT = 2.5 / (311.58 / 240);


function whiteTexture(renderer: Renderer) {
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

/**
 * `repeat` matters for the progress bar's fill: `sliderBar2` is 32 design units
 * wide and the bar is 206, so without cocos's own repeat wrap the last texel
 * column smears across the whole bar instead of the pattern tiling.
 */
async function loadHudTexture(renderer: Renderer, url: string, repeat = false) {
  const img = await loadImage(url);
  const tex = createTexture(renderer.ctx, img);
  if (repeat) setRepeatWrap(renderer.ctx, tex);
  return {
    tex, texW: img.width, texH: img.height,
    frame: {
      x: 0, y: 0, w: img.width, h: img.height, rotated: false,
      offsetX: 0, offsetY: 0, sourceW: img.width, sourceH: img.height,
    },
  };
}

export async function startPlayLevel(renderer: Renderer, levelNum: number, custom?: CustomLevel) {
  /** `CCTransitionFade` in and out of the level */
  const fade = new SceneFade(renderer);
  const scene = await LevelScene.load(renderer, levelNum, custom?.data);
  const params = new URLSearchParams(location.search);
  const startSpeed0 = SPEEDS[Math.min(4, Math.max(0, parseInt(params.get("speed") ?? "1", 10)))];
  const startX0 = parseFloat(params.get("x") ?? "0");
  // triggers must exist before the world, so movable groups become dynamic colliders
  const sim: SimState = createSim(startX0, startSpeed0, scene.level);
  const world = new CollisionWorld(
    scene.level, (id) => scene.frameSize(id),
    movableGroups(sim.triggers?.list ?? []));
  scene.setTriggerRuntime(sim.triggers?.rt);
  // `?x=` skips every portal behind it, so fast-forward them or the player
  // arrives as a cube in (say) a wave corridor and dies for no visible reason
  applyPortalsBefore(sim, world, startX0);
  const white = whiteTexture(renderer);
  const endTex = createEndViewTextures(renderer, white);
  // bigFont is the one the game uses for the attempt/percent HUD
  const font = await LoadedFont.load(
    renderer, "/assets/bigFont-hd.fnt", "/assets/bigFont-hd.png").catch(() => null);
  // The HUD's bar is two **loose** textures (`slidergroove2` / `sliderBar2`),
  // which is what `PlayLayer::setupHasCompleted` loads — not an atlas frame.
  const hudTex = {
    groove: await loadHudTexture(renderer, "/assets/slidergroove2-hd.png"),
    fill: await loadHudTexture(renderer, "/assets/sliderBar2-hd.png", true),
  };
  // the pause button lives in GJ_GameSheet03 with the rest of the menu art;
  // GJ_GameSheet02 is here for the results screen's blank coin and its chains
  const hudSheet = await UiSprites.load(renderer,
    ["GJ_GameSheet03-hd", "GJ_GameSheet02-hd"]).catch(() => null);
  // `EndLevelLayer`'s drop-down panel hangs two `chain_01_001` sprites, and
  // those live in `GJ_GameSheet` — which `LevelScene` has already loaded for
  // the level's own object art, so this reuses it rather than fetching 1.6 MB
  // a second time.
  const gameSheet = scene.sheet("game");
  /** `GravityEffectSprite`'s line art (a standalone 1 x 76 texture) */
  const gravLine = await loadHudTexture(renderer, "/assets/gravityLine_001.png").catch(() => null);
  /**
   * `PlayLayer::playGravityEffect(flip)` (m1 0xa6b00): on a gravity flip a
   * `GravityEffectSprite` sweeps the screen in 0.4 s (`CCMoveTo`, linear),
   * from 95 below the view to 95 above in yellow when the player turns upside
   * down, from above to below, flipped, in cyan when it turns back; turned 90°
   * in sideways play. `GravityEffectSprite::init` (m1 0xac4b8) builds it from
   * 22 lines of `gravityLine_001` in an additive batch, one per 1/22 of the
   * view width (x = -w/2 + 30 + (i + rand)·(w - 60)/22, y ±10), 2-6 × 480/w
   * wide, 2-3 tall, opacity 50-180. The "audio-visualizer beams" of the
   * native captures (ToE 2 25%, a ball flipping gravity) are these.
   */
  interface GravLine { x: number; y: number; sx: number; sy: number; a: number }
  const gravFx: { t: number; flip: boolean; lines: GravLine[] }[] = [];
  let lastFlipped: boolean | null = null;
  const newGravLines = (w: number): GravLine[] => {
    const lines: GravLine[] = [];
    const step = (w - 60) / 22;
    for (let i = 0; i < 22; i++) {
      lines.push({
        x: -w / 2 + 30 + i * step + Math.random() * step,
        y: (Math.random() * 2 - 1) * 10,
        sx: (480 / w) * (Math.random() * 4 + 2),
        sy: Math.random() + 2,
        a: (50 + Math.floor(Math.random() * 130)) / 255,
      });
    }
    return lines;
  };
  if (hudSheet && gameSheet) hudSheet.add({ name: "GJ_GameSheet-hd", ...gameSheet });
  // a missing results frame must fail here, not vanish at the moment of victory
  hudSheet?.requireAll([...END_LEVEL_FRAMES, "chain_01_001.png"]);
  // `EndLevelLayer` writes its statistics in goldFont, as every ButtonSprite does
  const goldFont = await LoadedFont.load(
    renderer, "/assets/goldFont-hd.fnt", "/assets/goldFont-hd.png").catch(() => null);
  // the pause menu's panel and its bar are loose textures, as in the original
  const pauseTex = {
    panel: await loadHudTexture(renderer, "/assets/square04_001-hd.png"),
    bar: await loadHudTexture(renderer, "/assets/GJ_progressBar_001-hd.png"),
    // `GameOptionsLayer`'s own panel, which the pause gear opens over the level
    options: await loadHudTexture(renderer, "/assets/GJ_square02-hd.png"),
  };
  // the pause menu's own `Slider` pair — the same loose art `OptionsLayer` uses
  const sliderTex = {
    groove: await loadHudTexture(renderer, `/assets/${SLIDER_GROOVE.replace(".png", "-hd.png")}`),
    bar: await loadHudTexture(renderer, `/assets/${SLIDER_BAR.replace(".png", "-hd.png")}`, true),
    thumb: await loadHudTexture(renderer, `/assets/${SLIDER_THUMB.replace(".png", "-hd.png")}`),
    thumbSel: await loadHudTexture(renderer,
      `/assets/${SLIDER_THUMB_SEL.replace(".png", "-hd.png")}`),
  };
  // every level this port plays is classic, so the row never has the
  // platformer-only full restart (see `pauseRow`)
  const PAUSE_ROW = pauseRow(false);
  // every pause frame must resolve; a missing one is a bug, not a blank
  if (hudSheet) {
    const missing = PAUSE_FRAMES.filter((f) => !hudSheet.has(f));
    if (missing.length) throw new Error(`pause menu frames missing: ${missing.join(", ")}`);
  }
  const pauseFrame: UiFrame | null = hudSheet?.has("GJ_pauseBtn_clean_001.png")
    ? hudSheet.require("GJ_pauseBtn_clean_001.png")
    : null;

  const icons = scene.sheet("icons");
  // the practice checkpoint gem — the game's own art, layered base + glow
  const gems = scene.sheet("game02");
  const gemBase = gems?.atlas.get("checkpoint_01_001.png") ?? null;
  const gemGlow = gems?.atlas.get("checkpoint_01_glow_001.png") ?? null;
  // The death explosion is a 12-frame sprite *animation*, not a particle config —
  // `PlayerExplosion_NN-hd.plist` are frame atlases. 01 is the classic one.
  const boom = await loadAtlas(renderer,
    "/assets/PlayerExplosion_01-hd.plist", "/assets/PlayerExplosion_01-hd.png")
    .catch(() => null);
  const boomFrames = boom
    ? Array.from({ length: 12 }, (_, i) =>
        boom.atlas.get(`playerExplosion_01_${String(i + 1).padStart(3, "0")}.png`) ?? null)
      .filter((f): f is SpriteFrame => f !== null)
    : [];
  // --- the shipped particle plists and their loose textures (gd/effects.ts) ---
  const fxLib = await loadEffectLibrary().catch((e) => {
    console.error("effect plists failed to load:", e);
    return null;
  });
  const fxTex = {
    square: await loadHudTexture(renderer, "/assets/square.png"),
    circle: await loadHudTexture(renderer, "/assets/circle.png"),
    streak: await loadHudTexture(renderer, "/assets/streak_01_001.png", true),
  };
  // --- the icon kit (M7) ---
  // Which icon each gamemode wears, and the two player colours, now come from
  // the save rather than being hardcoded to icon 1 / green.
  const kit = save.icons();
  const P1 = playerColor(kit.col1);
  const P2 = playerColor(kit.col2);
  /** the flying modes' glitter (`gd/effects.ts` `glitterEmitter`), player colour 1 */
  const glitter = fxLib ? glitterEmitter(fxLib) : null;
  if (glitter) glitter.cfg.startColor = [P1.r, P1.g, P1.b, 1];
  /**
   * The player glow's colour and visibility, `PlayerObject::updateGlowColor`
   * (see `playerGlow`): the strong form of colour 2 (colour 1 when colour 2 is
   * black), shown when the kit's glow is on or colour 1 is black.
   */
  const kitColor = (i: number) => PLAYER_COLORS[Math.max(0, Math.min(PLAYER_COLORS.length - 1, i | 0))];
  // colour triggers with "Player Color 1/2" fade to these
  if (sim.triggers) {
    const [c1, c2] = [kitColor(kit.col1), kitColor(kit.col2)];
    sim.triggers.rt.playerColors = [{ r: c1[0], g: c1[1], b: c1[2] }, { r: c2[0], g: c2[1], b: c2[2] }];
  }
  const GLOW = playerGlow(kit.glow, kitColor(kit.col1),
    particleColors(kitColor(kit.col1), kitColor(kit.col2)).b);

  const iconIndex = (mode: Gamemode) => clampIcon(mode, kit[mode] ?? 1);
  /**
   * The player's art: the legacy `GJ_GameSheetIcons` atlas the level already
   * loaded, plus the kit's own per-icon sheets — 2.2 ships each icon in its own
   * small atlas, and the legacy one holds only the older half (iconSheets.ts).
   * Each frame carries its sheet, so layers from different atlases draw right.
   */
  const iconSprites = new UiSprites();
  if (icons) iconSprites.add({ name: "GJ_GameSheetIcons-hd", ...icons });
  await new IconSheets(renderer, iconSprites)
    .loadAll(ICON_TABS.map((m) => [m, iconIndex(m)] as const))
    .catch((e) => console.error("icon sheets failed to load:", e));
  const look = (name: string | undefined): UiFrame | null =>
    name && iconSprites.has(name) ? iconSprites.require(name) : null;
  /**
   * Resolve one gamemode's sprite layers. Optional layers (the UFO's dome, the
   * spider/swing `extra`) come back null when that icon does not have them —
   * which varies per icon, not just per gamemode. Every per-icon sheet has a
   * `glow` frame; it is null only if the icon's sheet failed to load.
   */
  const iconFrame = (mode: Gamemode, limb = 1) => {
    const n = iconFrames(mode, iconIndex(mode), limb);
    return {
      main: look(n.main) ?? look(iconFrames("cube", 1).main),
      detail: look(n.detail),
      extra: look(n.extra),
      dome: look(n.dome),
      glow: look(n.glow),
    };
  };

  /** replay mode: time does not advance the sim, __play.stepTick() does */
  const manual = params.get("manual") === "1";
  /** `?debug=1` draws every collider on top of the art, to catch misplacement */
  const debug = params.get("debug") === "1";
  const startSpeed = startSpeed0, startX = startX0;

  const half0 = PLAYER_SIZE / 2;
  const player = sim.player;
  const run = sim.run;
  /**
   * `?x=` and `?manual=1` are debugging entry points and deliberately do not
   * touch the save.
   */
  // (a custom level never touches the main levels' save)
  const scored = startX0 === 0 && !params.has("manual") && !custom;
  /**
   * The attempt number on screen and on the results is **this session's**:
   * `PlayLayer + 0x2f1c`, zeroed by `PlayLayer::init` and `fullReset`, bumped
   * by `updateAttempts` (m1 `0xaba48`) on every reset. The cumulative count is
   * the level's own stat (the save's `attempts`, which Level Stats shows). An
   * earlier version showed the cumulative number here, which the binary
   * contradicts.
   */
  let attempts = 1;
  if (scored) save.recordAttempt(levelNum);
  /**
   * `PlayLayer + 0x3728`: jumps this session, printed by the results screen.
   * Zeroed only by `init` and `fullReset` — a death does not reset it.
   * `sim.jumps` is the per-attempt count the sim keeps; `jumpsSeen` is how
   * much of it has been banked.
   */
  let sessionJumps = 0;
  let jumpsSeen = 0;
  let deadFor = 0;
  // Presentation only. Two clocks because the dual partner animates on its own
  // legs — it is a second player in every respect.
  const limbAnim = { p1: createAnimPlayer(), p2: createAnimPlayer() };
  /**
   * The ending, once `sim.ended` has triggered it — the pull into the portal,
   * the effects and the drop of the results layer, all presentation.
   */
  let endSeq: EndSequence | null = null;
  /** the camera's bottom edge when the ending began, for its vertical settle */
  let endCamY0 = 0;
  /**
   * The end portal's height — `updateEndPos` latches it when the portal comes
   * into view and again at the trigger. Null until then.
   */
  let portalY: number | null = null;
  /** set once `EndLevelLayer` has dropped; the run is over */
  let completed = false;
  /**
   * The run's elapsed seconds — `PlayLayer + 0x3a8`, which the results screen
   * prints. Counted in fixed sim steps rather than wall time so a `?manual=1`
   * replay produces the same number every time.
   */
  let runSteps = 0;
  /** `getEndText()` rolls once per completion, not once per frame */
  let endText = randomEndText();
  /** the results layer's slide-in progress, 0..1 */
  let endT = 0;
  let best = 0;
  /** view *bottom* edge, matching the original's `m_obCamPos.y` */
  let camY = 0;
  /** sideways play: the camera centre along the player's ground axis (see `travel`) */
  let offC: number | null = null;
  /** tooling: the last rendered view centre, world units */
  let lastView = { x: 0, y: 0 };
  /**
   * One 240 Hz step of the camera's vertical follow. Native Stereo Madness,
   * frame by frame (x 1650-1950, 3850-4500; docs/fidelity/traces): every step
   * the camera moves exactly 0.025 of the way (dt x 6) to where the deadzone
   * wants it, in both directions (312 of 313 frames). Stepping it here rather
   * than once per drawn frame keeps it identical at 60, 120 or 240 fps.
   */
  const stepCameraY = () => {
    const { viewH: vh } = resolveView(renderer.canvas.width, renderer.canvas.height);
    const partner = sim.dual?.player;
    const target = partner
      ? dualCameraBottom((player.cameraYCenter + partner.cameraYCenter) / 2, vh)
      : cameraBottomTarget(player.mode, player.y,
        player.gravityFlipped, player.cameraYCenter, camY, vh, player.freeMode);
    camY += (target - camY) * STEP * 6;
  };
  /** World-space label: placed once at the start of each attempt. */
  let attemptLabel: { x: number; y: number } | undefined;
  let retryLabel = false;
  /** visual-only angles: lerped ship tilt, accumulated ball roll (deg CW) */
  /**
   * Per-player icon animation — the ship/UFO/swing tilt and the ball's roll.
   * One state each for player 1 and the dual partner: sharing one (as the
   * port did) eased the tilt toward each player in turn and rolled both balls
   * together at twice the rate (USER-08).
   */
  const iconAnim = [{ tilt: 0, roll: 0 }, { tilt: 0, roll: 0 }];
  /** coins already chimed this attempt, so the sfx fires once each */
  const coinsSeen = new Set<number>();
  /** coins taken this attempt; written to the save only on a normal-mode completion */
  const pending = new PendingCoins();
  let deathPlayed = false;
  /** the "New Best" popup (`PlayLayer::showNewBest`): seconds since it appeared */
  let newBest: { t: number; percent: number } | null = null;
  /** practice mode is toggled from the pause menu, or started with `?practice=1` */
  let practice = params.get("practice") === "1";
  /** green-diamond checkpoints; only live while `practice` is on */
  const checkpoints = new CheckpointStack();
  // `Auto-Checkpoints` is game variable "0027", which the original reads from
  // the save rather than defaulting per level — so the pause gear's toggle
  // survives a reload here too.
  checkpoints.auto = save.settings().autoCheckpoints;

  // --- particles, streaks, screen shake (gd/effects.ts) ---
  const kitCol1 = kitColor(kit.col1);
  const kitCol2 = kitColor(kit.col2);
  const makePlayerFx = () => {
    if (!fxLib) return null;
    const fx = new PlayerEffects(fxLib);
    fx.setColors(kitCol1, kitCol2);
    return fx;
  };
  const pfx1 = makePlayerFx();
  /** the dual partner's effects, built when a partner first appears */
  let pfx2: PlayerEffects | null = null;
  /** auto-removing emitters: deaths, pickups, speed streaks, the ending's bursts */
  const oneShots = new EffectPool();
  /** the portals', orbs' and pads' own emitters, by interactive index, while in view */
  const objFx = new Map<number, CCEmitter>();
  /** circle waves outside the ending: the death's two, each orb's activation */
  const waves: { spec: CircleWaveSpec; x: number; y: number; t: number;
    color: readonly [number, number, number]; alpha: number }[] = [];
  /** what the scene saw last frame, to find pad activations and flips */
  const seenPads = new Set<number>();
  /** the sim's effect events for this frame, collected inside the step loop */
  const stepEffects: SimEffect[] = [];
  let seenFlip = false;
  let seenSpeed: number = startSpeed0;
  const shake = new Shake();
  /**
   * `EndPortalObject::init` +112..400: `endEffectPortal.plist`, a radius-mode
   * emitter with `setStartRadius(winH / 2)`, offset (−15, 0), tinted the
   * player's particle colour.
   */
  let endPortalFx: CCEmitter | null = null;
  const strongCol1 = particleColors(kitCol1, kitCol2).a;
  /** the death explosion sprite (`playDeathEffect` death effect 1), or null */
  let explode: { t: number; first: number; delay: number; scale: number; rot: number } | null = null;
  const resetFx = () => {
    endPortalFx = null;
    pfx1?.reset();
    pfx2?.reset();
    oneShots.clear();
    objFx.clear();
    glitter?.clear();
    scene.resetParticles();
    waves.length = 0;
    stepEffects.length = 0;
    seenPads.clear();
    seenFlip = false;
    seenSpeed = sim.run.speed;
    explode = null;
  };

  /**
   * Collider index -> which of the level's three secret coins it is. The save
   * has to name a coin stably across runs, and the collider index is an
   * artefact of build order, so coins are numbered left to right instead.
   */
  const coinOrdinal = new Map<number, number>();
  /** ordinal -> the coin's index in `level.objects`, which is what the scene draws by */
  const coinObject = new Map<number, number>();
  world.interactives
    .filter((it) => it.kind === "coin")
    .sort((a, b) => a.x - b.x)
    .forEach((it, i) => {
      // two different index spaces on purpose — see `Interactive.obj`
      coinOrdinal.set(it.index, i);
      coinObject.set(i, it.obj);
    });

  /**
   * Coins already in the save draw as white outlines. Recomputed on restart
   * rather than at load, so a coin picked up this session turns into its
   * outline on the next attempt — which is what the original does.
   */
  const refreshCoinArt = () => {
    const marked = new Set<number>();
    for (const ord of save.levelStats(levelNum).coins) {
      const obj = coinObject.get(ord);
      if (obj !== undefined) marked.add(obj);
    }
    scene.collectedCoins = marked;
  };
  refreshCoinArt();

  // --- audio ---
  // The engine needs a user gesture before it will make a sound, so the music
  // starts on the first input rather than on load.
  const audio = new AudioEngine(save.settings());
  const music = custom ? (custom.songLevel ? musicUrl(custom.songLevel) : null) : musicUrl(levelNum);
  const songOffset = headerFloat(scene.level, "kA13", 0);
  // Dynamic Level Height (kA37): the camera's height cap follows the level
  setLevelHeightCap(/(?:^|,)kA37,1(?:,|$)/.test(scene.level.rawHeader)
    ? Math.max(...scene.level.objects.map((o) => o.y)) + GD_Y_OFFSET + VIEW_H : 1140);
  let musicStarted = false;
  const startMusic = () => {
    if (!music) return;
    musicStarted = true;
    // Sample after decoding: this clock also rewinds with practice checkpoints.
    void audio.playMusic(music, () => songOffset + (sim.triggers?.rt.time ?? 0));
  };
  const restartMusic = () => { if (musicStarted) startMusic(); };
  // The music pulse the orbs and pulsing balls beat with (`gd/audioPulse.ts`):
  // an official song's audio string drives `AudioEffectsLayer`; a song without
  // one (Dash) pulses from the music's own peak level (`updateMetering`).
  const songId = custom ? (custom.songLevel ? custom.songLevel - 1 : -1) : levelNum - 1;
  const audioString = AUDIO_STRINGS[songId];
  const audioFx = audioString ? new AudioEffects(audioString) : null;
  const meterPulse = newPulse();

  let dualWarned = false;
  const warnDual = () => {
    if (dualWarned) return;
    dualWarned = true;
    console.warn("dual portal: dual mode is not implemented yet (M4) — continuing single player");
  };

  /**
   * `m_levelLength`: every percentage's denominator, 340 past the last object
   * (`gd/levelEnd.ts`). The sim owns it because it also places the trigger.
   */
  const L = sim.levelLength;
  /** best percent reached this attempt, written to the save when the attempt ends */
  const percentNow = () => Math.min(100, (best / L) * 100);
  /**
   * The x the percentage reads: the player's own, or — for a level with a
   * timestamp (Dash) — the elapsed level time's share of it, put on the same
   * scale (`progressPercent`), so the bar, label, best and save all follow it.
   * The steps are the sim's (`m_currentProgress`), which checkpoints restore
   * along with the rest of the game state.
   */
  const timestamp = custom ? 0 : (LEVEL_TIMESTAMP.get(levelNum) ?? 0);
  const progX = (x: number) => timestamp > 0
    ? (progressPercent(x, L, sim.steps, timestamp) / 100) * L
    : x;
  /** bank this attempt's new jumps into the session count and the level's stat */
  const bankJumps = () => {
    if (sim.jumps <= jumpsSeen) return;
    const d = sim.jumps - jumpsSeen;
    jumpsSeen = sim.jumps;
    sessionJumps += d;
    if (scored) save.recordJump(levelNum, d);
  };
  /**
   * Bank this attempt's progress. Practice and normal are separate stats and
   * neither ever moves backwards, so this is safe to call on every death.
   */
  const bankProgress = () => {
    if (scored) save.recordProgress(levelNum, percentNow(), practice);
  };

  const reset = () => {
    bankProgress();
    bankJumps();
    resetSim(sim, startX, startSpeed);
    jumpsSeen = 0;
    endSeq = null;
    portalY = null;
    applyPortalsBefore(sim, world, startX);
    checkpoints.clear();
    refreshCoinArt();
    resetFx();
    shake.reset();
    deadFor = 0;
    completed = false;
    runSteps = 0;
    endT = 0;
    attempts++;
    if (scored) save.recordAttempt(levelNum);
    best = 0;
    coinsSeen.clear();
    pending.clear();
    restartMusic();
    camY = 0;
    attemptLabel = undefined;
    retryLabel = true;
    for (const a of iconAnim) { a.tilt = 0; a.roll = 0; }
  };

  /**
   * Death in practice mode rewinds to the last green diamond instead of
   * restarting the level. Falls back to a full reset when none has been placed
   * yet — which is what the original does at the start of a level too.
   */
  const respawnAtCheckpoint = () => {
    bankProgress();
    bankJumps();
    const cp = checkpoints.restore(sim);
    if (!cp) { reset(); return; }
    deadFor = 0;
    completed = false;
    endSeq = null;
    portalY = null;
    resetFx();
    shake.reset();
    camY = cp.camY;
    for (const a of iconAnim) { a.tilt = 0; a.roll = 0; }
    // the checkpoint's snapshot may pre-date coins picked up after it, so the
    // chime set has to follow the same rewind or they re-collect in silence
    coinsSeen.clear();
    for (const idx of sim.collected) coinsSeen.add(idx);
    pending.clear();
    restartMusic();
  };

  // --- debug readout (DOM, so the text stays crisp at any zoom) ---
  const hud = debug ? document.createElement("div") : null;
  if (hud) {
    hud.style.cssText = "position:fixed;top:8px;left:8px;z-index:10;font:12px/1.45 "
      + "ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;background:rgba(0,0,0,.62);"
      + "padding:7px 10px;border-radius:6px;white-space:pre;pointer-events:none;"
      + "text-shadow:0 1px 2px #000";
    document.body.appendChild(hud);
  }

  // --- input ---
  /** Escape opens the pause menu; it also freezes the run for inspection */
  let paused = false;
  /** which pause-menu entry is highlighted */
  let menuIndex = 0;
  /**
   * The auto-checkpoint toggle only exists while practice mode is on, which is
   * where the original puts it too — so the menu is built per open, not fixed.
   */
  /**
   * While paused the entries are the sourced `PauseLayer` row; once complete
   * they are `EndLevelLayer`'s, in the order `customSetup` adds them.
   *
   * There is deliberately **no "Next level"**: the original's results screen
   * offers replay, menu, and — in practice — restart-from-checkpoint, and the
   * level carousel is where the next level is chosen. REFERENCE.md §17.3.
   */
  const menuEntries = (): string[] => completed
    ? [...(practice ? ["restartCheckpoint"] : []), "replay", "quit"]
    : PAUSE_ROW.map((r) => r.id);
  // Screen-centred design coordinates shared by drawing and pointer picking.
  let uiButtons: {
    id: string; x: number; y: number; w: number; h: number; action: () => void;
  }[] = [];

  /**
   * `PauseLayer::onSettings` opens `GameOptionsLayer` over the pause menu — the
   * popup that owns the progress-bar and percentage options the HUD reads. It
   * has its own `CCMenu`, so it gets its own host and the level's pointer and
   * keyboard handling stands down while it is up (`FLAlertLayer` swallows both).
   */
  let gameOptions: TogglePopup | null = null;
  let gameOptionsHost: MenuHost | null = null;
  const closeGameOptions = () => {
    gameOptionsHost?.dispose();
    gameOptionsHost = null;
    gameOptions = null;
  };
  const openGameOptions = () => {
    if (gameOptions || !hudSheet || !font) return;
    gameOptions = new TogglePopup({
      renderer, sprites: hudSheet, font,
      panel: pauseTex.options, white,
      // `GameOptionsLayer` has no title label and one page — see `TogglePopupDeps.pages`
      pages: [{ options: GAME_OPTIONS }],
      yOffset: GAME_OPTIONS_Y_OFFSET,
      onChange: (key, value) => {
        if (key === "autoCheckpoints") checkpoints.auto = value;
      },
      onClose: closeGameOptions,
    });
    // a single page draws no arrows, so the view width is not needed yet
    gameOptions.layout();
    gameOptionsHost = new MenuHost(renderer.canvas, gameOptions.menus,
      () => resolveView(renderer.canvas.width, renderer.canvas.height).scale);
  };
  // `PauseLayer`'s music / SFX sliders. Live only while the pause menu itself
  // has the screen — not under the gear's popup, not on the results screen.
  const volume = new VolumeSliders({
    canvas: renderer.canvas, textures: sliderTex, scale: SLIDER_SCALE,
    viewScale: () => resolveView(renderer.canvas.width, renderer.canvas.height).scale,
    enabled: () => paused && !completed && !gameOptions,
    music: save.settings().musicVolume, sfx: save.settings().sfxVolume,
    onChange: (id, v) => {
      // `musicSliderChanged` / `sfxSliderChanged` write straight to the engine
      if (id === "music") { save.setSettings({ musicVolume: v }); audio.setMusicVolume(v); }
      else { save.setSettings({ sfxVolume: v }); audio.setSfxVolume(v); }
    },
  });
  let holding = false;
  /**
   * A press no step has seen yet. The frame loop runs its 240 Hz steps only
   * when the next frame is drawn, so a quick tap — down and up inside one
   * frame — used to arrive as "not holding" and was thrown away (USER-01:
   * "hard to micro click"). A release that comes before any step has seen the
   * press is held back until one has.
   */
  let pressUnseen = false;
  let releaseAfterStep = false;
  const press = () => {
    // `EndPortalObject::triggerObject` disables the UI menu and
    // `lockPlayer` stops the player, so input does nothing from the trigger on
    if (paused || completed || sim.ended) return;
    audio.ensure();
    if (!musicStarted) startMusic();
    holding = true;
    releaseAfterStep = false;
    pressUnseen = true;
    simPress(sim, world);
  };
  const release = () => {
    if (pressUnseen && !paused) { releaseAfterStep = true; return; }
    holding = false;
  };
  const isJumpKey = (e: KeyboardEvent) =>
    e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW";
  /**
   * Pausing must freeze the music too, not just the sim — otherwise the track
   * runs on under the menu and is out of sync with the level when you resume.
   * Everything that changes `paused` goes through here so no path can forget.
   */
  const setPaused = (v: boolean) => {
    // `PlayLayer::canPauseGame` refuses once the end animation has started
    // (`+0x3360`), until the results layer takes over
    if (v && sim.ended && !completed) return;
    paused = v;
    if (v) release();
    void audio.setSuspended(v);
  };

  const chooseMenu = () => {
    const pick = menuEntries()[menuIndex];
    release();
    // --- the sourced pause row ---
    if (pick === "resume") { setPaused(false); return; }
    if (pick === "restart") { setPaused(false); reset(); return; }
    if (pick === "restartFull") {
      // `onRestartFull` restarts from the very beginning, dropping every
      // practice checkpoint rather than resuming from the last one
      bankProgress();
      checkpoints.list.length = 0;
      setPaused(false);
      // `PlayLayer::fullReset` zeroes the session's attempts and jumps before
      // it resets (`+80`/`+84`), so the restart reads "Attempt 1" again
      bankJumps();
      attempts = 0;
      sessionJumps = 0;
      reset();
      return;
    }
    if (pick === "practice") {
      // `onPracticeMode` records that the player has found the button, which
      // retires the pause menu's practice hint for good (`onNormalMode` does not)
      if (!practice) save.setSettings({ clickedPractice: true });
      // Bank what this run reached *under the mode it was played in* before
      // flipping, then zero it so `reset`'s own bank cannot re-file the same
      // progress against the other stat.
      bankProgress();
      best = 0;
      practice = !practice;
      setPaused(false);
      reset();
      return;
    }
    if (pick === "quit") {
      bankProgress();
      fade.go(() => { audio.stopMusic(); location.href = custom ? "/" : `?levels=1&sel=${levelNum}`; });
      return;
    }
    // --- the sourced results row ---
    if (pick === "replay") { setPaused(false); reset(); return; }
    if (pick === "restartCheckpoint") {
      // `onRestartCheckpoint` resumes from the last green diamond rather than
      // restarting the level, which is why it is practice-only
      setPaused(false);
      respawnAtCheckpoint();
      return;
    }
    setPaused(false);
  };

  addEventListener("keydown", (e) => {
    if (gameOptions) {
      if (e.code === "Escape") { e.preventDefault(); closeGameOptions(); }
      return;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      if (e.repeat) return;
      if (sim.ended && !completed) return;
      if (completed) {
        menuIndex = menuEntries().indexOf("quit");
        chooseMenu();
        return;
      }
      setPaused(!paused);
      // the cursor starts on Resume, which is the middle of the sourced row
      menuIndex = PAUSE_ROW.findIndex((r) => r.id === "resume");
      return;
    }
    if (paused || completed) {
      // menu navigation while frozen
      const n = menuEntries().length;
      // The pause row is horizontal, so left/right move along it; up/down and
      // the completion menu's vertical list keep working too.
      if (e.code === "ArrowUp" || e.code === "KeyW" || e.code === "ArrowLeft" || e.code === "KeyA") {
        e.preventDefault();
        menuIndex = (menuIndex + n - 1) % n;
      } else if (e.code === "ArrowDown" || e.code === "KeyS"
        || e.code === "ArrowRight" || e.code === "KeyD") {
        e.preventDefault();
        menuIndex = (menuIndex + 1) % n;
      } else if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) chooseMenu();
      }
      return;
    }
    // Z places a checkpoint and X removes the last one — the original's Steam
    // keybinds. Both are practice-only and do nothing while dead.
    if (practice && !sim.dead && (e.code === "KeyZ" || e.code === "KeyX")) {
      e.preventDefault();
      if (e.repeat) return;
      if (e.code === "KeyZ") checkpoints.place(sim, camY, true);
      else checkpoints.remove();
      return;
    }
    if (!isJumpKey(e)) return;
    e.preventDefault();
    if (!e.repeat) press(); else holding = true;
  });
  addEventListener("keyup", (e) => { if (isJumpKey(e)) release(); });
  renderer.canvas.style.touchAction = "none";
  addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    // the popup's MenuHost is on the canvas and runs first; the level must not
    // also treat that same press as a jump
    if (gameOptions) return;
    e.preventDefault();
    const canvas = renderer.canvas;
    const rect = canvas.getBoundingClientRect();
    const { scale } = resolveView(canvas.width, canvas.height);
    const x = ((e.clientX - rect.left) * canvas.width / rect.width - canvas.width / 2) / scale;
    const y = (canvas.height / 2 - (e.clientY - rect.top) * canvas.height / rect.height) / scale;
    const button = uiButtons.find(b => Math.abs(x - b.x) <= b.w / 2 && Math.abs(y - b.y) <= b.h / 2);
    if (button) {
      uiButtons = [];
      release();
      button.action();
      return;
    }
    press();
  });
  addEventListener("pointerup", release);
  addEventListener("pointercancel", release);
  addEventListener("blur", () => setPaused(true));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) setPaused(true);
  });

  /** one emitter's particles, with its plist's texture and blend */
  const drawEmitter = (e: CCEmitter) => {
    const t = e.cfg.texture === "circle.png" ? fxTex.circle : fxTex.square;
    const blend = e.cfg.additive ? "additive" : "normal";
    e.forEach((q) => {
      renderer.draw(t.tex, t.texW, t.texH, t.frame, q.x, q.y, q.size, q.size, q.rot,
        q.r, q.g, q.b, q.a, blend);
    });
  };
  /**
   * A `CCMotionStreak` ribbon: one quad per segment, the texture across the
   * width and along the length, each point's opacity its fade state.
   * APPROXIMATION: additive — `updateStreakBlend` was not decoded.
   */
  const drawStreak = (st: MotionStreak, col: readonly [number, number, number]) => {
    if (st.count < 2) return;
    let px0 = 0, py0 = 0, px1 = 0, py1 = 0, pa = 0, pv = 0;
    const t = fxTex.streak;
    st.forEachPair((q, i) => {
      if (i > 0) {
        // A10, sourced: `PlayerObject::updateStreakBlend` (m1 `0x375668`) sets
        // (GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA) — ordinary alpha — and only
        // swaps in (GL_SRC_ALPHA, GL_ONE) when the layer's streak-blend flag
        // (`[0x32c]`) is on. That flag is zero-initialised and the only thing
        // that sets it is a 2.2 options trigger, which none of the 22 levels
        // carries, so the classic levels draw the trail with plain alpha.
        renderer.drawQuadRaw(t.tex, "normal",
          px0, py0, 0, pv, pa, q.x0, q.y0, 0, q.v, q.alpha,
          q.x1, q.y1, 1, q.v, q.alpha, px1, py1, 1, pv, pa,
          col[0] / 255, col[1] / 255, col[2] / 255);
      }
      px0 = q.x0; py0 = q.y0; px1 = q.x1; py1 = q.y1; pa = q.alpha; pv = q.v;
    });
  };
  /** `HardStreak`: the wave trail, a wide pass and a narrow core (see `WaveTrail`) */
  const drawWaveTrail = (w: WaveTrail) => {
    if (!w.active) return;
    w.clearBehind(player.x - resolveView(renderer.canvas.width, renderer.canvas.height).viewW);
    const c = w.color;
    for (const [half, a, r, g, b] of [
      [6 * w.size, 1, c[0] / 255, c[1] / 255, c[2] / 255],
      [2 * w.size, 0.65, 1, 1, 1],
    ] as const) {
      w.forEachSegment((x0, y0, x1, y1) => {
        const l = Math.hypot(x1 - x0, y1 - y0) || 1;
        const ox = (-(y1 - y0) / l) * half, oy = ((x1 - x0) / l) * half;
        renderer.drawQuadRaw(white.tex, "normal",
          x0 + ox, y0 + oy, 0, 0, a, x1 + ox, y1 + oy, 1, 0, a,
          x1 - ox, y1 - oy, 1, 1, a, x0 - ox, y0 - oy, 0, 1, a, r, g, b);
      });
    }
  };

  let last = performance.now();
  /** tooling: the last 120 loop times, ms (`info.loopMs`) */
  const loopMs = new Float64Array(120);
  let loopI = 0;
  /**
   * The mirror portal's screen flip (`GJBaseGameLayer::toggleFlipped` m1
   * 0x100308): `m_cameraFlip` eases to 1 (mirrored) or 0 over 0.4 s, easing 1
   * at rate 1.2, and while it runs every object is drawn at
   * `lerp(x, mirror(x), k)` about the view centre (`update` +0x123eb4,
   * `screenFlipObject` 0xa67b8) — a horizontal squash through zero, not a snap.
   */
  let flipK = 0, flipFrom = 0, flipTo = 0, flipT = 1, flipLastX = 0;
  /** the HUD's layout from the most recent frame, for the browser harnesses */
  let lastHudGeometry: ReturnType<typeof hudGeometry> | null = null;
  let acc = 0;

  const loop = () => {
    const now = performance.now();
    let frame = (now - last) / 1000;
    last = now;
    if (frame > MAX_FRAME) frame = MAX_FRAME;
    {
      const target = sim.run.mirrored ? 1 : 0;
      // a restart (or checkpoint load) resets it with `noEffects`: no ease
      const jumpedBack = sim.player.x < flipLastX - 60;
      flipLastX = sim.player.x;
      if (jumpedBack) { flipK = flipFrom = flipTo = target; flipT = 1; }
      if (target !== flipTo) { flipFrom = flipK; flipTo = target; flipT = 0; }
      if (flipT < 1) {
        flipT = Math.min(1, flipT + (paused || completed ? 0 : frame / 0.4));
        flipK = flipFrom + (flipTo - flipFrom) * easedValue(flipT, 1, 1.2);
      } else flipK = flipTo;
    }

    if (paused || completed) {
      // frozen: keep rendering so the overlay and the banner stay visible
    } else if (manual) {
      // `?manual=1`: the simulation is driven by __play.stepTick() instead of
      // wall-clock time, so a recorded run replays here exactly as it did in
      // the headless search. Rendering still runs every frame.
    } else if (sim.dead) {
      deadFor += frame;
      if (deadFor >= RESPAWN_DELAY) {
        if (practice && checkpoints.length) respawnAtCheckpoint();
        else reset();
      }
    } else {
      acc += frame;
      while (acc >= STEP) {
        acc -= STEP;
        simStep(sim, world, STEP, holding, warnDual);
        stepCameraY();
        pressUnseen = false;
        if (releaseAfterStep) { releaseAfterStep = false; holding = false; }
        // drained per step: `sim.effects` only ever holds the last one's
        for (const e of sim.effects) stepEffects.push(e);
        if (!sim.ended) runSteps++;
        if (sim.dead) break;
      }
      if (progX(player.x) > best) best = progX(player.x);
    }

    bankJumps();
    // practice checkpoints drop as you go, once per frame (see checkpoints.ts)
    if (practice && !paused && !sim.ended) checkpoints.update(sim, camY);
    for (const idx of sim.collected) {
      if (coinsSeen.has(idx)) continue;
      coinsSeen.add(idx);
      const coinSfx = gameplaySfx("coin");
      if (coinSfx) void audio.playSfx(coinSfx);
      // `GameObject::spawnDefaultPickupParticle`: coinPickupEffect at the coin
      const coin = world.interactives[idx];
      if (fxLib && coin && !paused) oneShots.add(oneShot(fxLib, "coinPickupEffect", coin.x, coin.y));
      // Held for this attempt only. The save is written on a normal-mode
      // completion (see the `complete` branch); a death drops it.
      const ord = coinOrdinal.get(idx);
      if (scored && ord !== undefined) pending.take(ord);
    }
    // --- particles and streaks ---
    // Driven off frame time rather than the physics step: these are cosmetic,
    // and the engine integrates on the frame like cocos's own update.
    if (!paused) {
      // activations the original announces from inside the rules — an orb
      // fired, a pad launched, gravity flipped, the speed changed — read off
      // the sim's state rather than added to it
      // A13: every orb the sim fired this frame, multi-activate ones included.
      // The scene used to diff `sim.usedOrbs`, which a key-99 orb never enters.
      for (const e of stepEffects) {
        const type = OBJECT_DEFS.get(e.id)?.type ?? 11;
        pfx1?.activateStreak();
        // `orbWaveColor` returns null for the drop ring: its wave takes colour
        // channel 1007, which only the runtime knows
        const col = orbWaveColor(type)
          ?? (sim.triggers ? channelRgb(sim.triggers.rt, 1007) : [255, 255, 255]);
        waves.push({
          spec: { from: orbWaveFrom(type), to: ORB_WAVE_TO, duration: ORB_WAVE_DURATION,
            fadeIn: true, outline: false, lineWidth: 4 },
          x: e.x, y: e.y, t: 0, color: col, alpha: 1,
        });
      }
      stepEffects.length = 0;
      for (const idx of sim.touching) {
        if (seenPads.has(idx) || world.interactives[idx]?.kind !== "pad") continue;
        pfx1?.activateStreak();
      }
      seenPads.clear();
      for (const idx of sim.touching) seenPads.add(idx);
      if (player.gravityFlipped !== seenFlip) pfx1?.activateStreak();
      seenFlip = player.gravityFlipped;
      if (run.speed !== seenSpeed && fxLib) {
        // `GJBaseGameLayer::playSpeedParticle`: screen space, just off the right edge
        const k = (SPEEDS as readonly number[]).indexOf(run.speed);
        if (k >= 0) oneShots.add(oneShot(fxLib, speedEffectFor(k), 0, 0), true, true);
      }
      seenSpeed = run.speed;

      const charging = (p: PlayerState) => p.mode === "robot" && p.jumping && holding
        && !p.onGround && p.holdTime < ROBOT_HOLD_MAX;
      if (pfx1) {
        if (!sim.dead && !sim.ended) pfx1.update(frame, player, holding, charging(player), run.speed);
        else pfx1.tick(frame);
      }
      if (sim.dual && !pfx2) pfx2 = makePlayerFx();
      if (pfx2) {
        if (sim.dual && !sim.dead && !sim.ended) {
          pfx2.update(frame, sim.dual.player, holding, charging(sim.dual.player), run.speed);
        } else pfx2.tick(frame);
      }
      oneShots.update(frame);
      for (let i = waves.length - 1; i >= 0; i--) {
        waves[i].t += frame;
        if (waves[i].t > waves[i].spec.duration) waves.splice(i, 1);
      }
      // `showCompleteEffect`'s `shakeCamera(1.755, 3, 0)`, held like a trigger's
      if (endSeq?.shaking()) shake.add(COMPLETE_SHAKE_STRENGTH);
      // a shake trigger (1520) in flight drives the same camera shake as a death
      const rtShake = sim.triggers?.rt.shake;
      if (rtShake && rtShake.remaining > 0 && rtShake.strength > 0) {
        shake.add(rtShake.strength);
      }
      shake.update(frame);
      if (explode) explode.t += frame;
    }

    if (sim.dead && !deathPlayed) {
      deathPlayed = true;
      // `destroyPlayer`: a normal-mode death above the saved best shows the popup.
      // The save is only written at the next reset, so it still holds the old best.
      if (scored && shouldShowNewBest({
        percent: percentNow(), savedBest: save.levelStats(levelNum).normal, practice,
      })) {
        newBest = { t: 0, percent: deathPercent(percentNow()) };
      }
      // `playDeathEffect`, death effect 1: the sprite, the particles, two waves
      const dead = sim.dual?.dead ? sim.dual.player : player;
      const size = dead.mini ? MINI_SCALE : 1;
      const s8 = deathVehicleScale(size);
      explode = {
        t: 0,
        first: Math.random() > 0.5 ? 1 : 0,
        delay: DEATH_FRAME_DELAY + Math.random() * DEATH_FRAME_DELAY_VAR,
        scale: s8 * (DEATH_SCALE + (2 * Math.random() - 1) * DEATH_SCALE_VAR),
        rot: (2 * Math.random() - 1) * DEATH_ROTATION_VAR,
      };
      if (fxLib) oneShots.add(deathExplosion(fxLib, dead.x, dead.y, size));
      for (const w of DEATH_WAVES) {
        waves.push({
          spec: { from: w.from * s8, to: w.to * s8, duration: w.duration, fadeIn: false,
            outline: false, lineWidth: 4 },
          x: dead.x, y: dead.y, t: 0, color: w.color, alpha: w.opacity,
        });
      }
      pfx1?.stopAll();
      pfx2?.stopAll();
      shake.add(DEATH_SHAKE);
      audio.stopMusic();
      void audio.playSfx(SFX.death);
    }
    if (!sim.dead) deathPlayed = false;

    renderer.resize();
    // GD switches between fixed-height and fixed-width by aspect ratio, so the
    // visible world height is not always 320 — a narrow window shows more of it
    const { scale, viewW, viewH } = resolveView(renderer.canvas.width, renderer.canvas.height);

    // --- the ending (presentation; `sim.ended` is the rule) ---
    if (sim.ended && !endSeq) {
      // `checkForEnd` re-reads the portal's height before triggering it
      // An End trigger (3600) ends the level where the player stands: no
      // pull and no camera settle — APPROXIMATION of its default presentation
      portalY = sim.endByTrigger ? camY + viewH / 2 : endPortalY(camY + viewH / 2, player.mode === "ship");
      endSeq = new EndSequence({
        practice,
        start: { x: player.x, y: player.y },
        startP2: sim.dual ? { x: sim.dual.player.x, y: sim.dual.player.y } : undefined,
        portal: sim.endByTrigger ? { x: player.x, y: player.y } : { x: L, y: portalY },
        viewW, viewH,
      });
      endCamY0 = camY;
      release();
      // the level is complete the moment the ending triggers: the game banks
      // 100 however far short of the portal the player was locked
      best = L;
    }
    if (endSeq && !paused) {
      for (const ev of endSeq.update(frame)) {
        if (ev === "complete") {
          // `levelComplete`: the save, and — outside practice — the sfx from
          // `showCompleteEffect`. The music is not stopped: the original only
          // sets its loop count to 0 (`FMOD::Channel::setLoopCount(0)`), and
          // fades it out only for a level whose settings ask (kA16, unset in
          // all 22), so the song plays on under the results.
          bankProgress();
          // `recordCoin` refuses practice pickups itself; the guard keeps the
          // pending buffer from being written at all outside normal mode
          if (!practice) {
            for (const ord of pending.ordinals()) save.recordCoin(levelNum, ord, false);
          }
          pending.clear();
          if (!practice) void audio.playSfx(SFX.complete);
        } else if (ev === "text" && fxLib) {
          // `showCompleteText` +432..792: two levelComplete01 bursts at the
          // banner, the first tinted the player's colour
          const b1 = oneShot(fxLib, "levelComplete01", 0, 35, strongCol1);
          oneShots.add(b1, true);
          oneShots.add(oneShot(fxLib, "levelComplete01", 0, 35), true);
        } else if (ev === "endLayer") {
          completed = true;
          endText = randomEndText();
          endT = 0;
          menuIndex = 0;
        }
      }
    }
    /** where player 1 is drawn: the pull's pose once the ending has begun */
    const pose1 = endSeq?.pose(1);
    const drawX = pose1 ? pose1.x : player.x;
    // the player rides `winW / 2 - 75` in from the left edge (`cameraLeftFor`),
    // clamped so the left edge never passes `levelLength - winW`: the end
    // portal comes to rest on the right edge and the camera stops
    // Rotate Gameplay (Dash): travel may run along y or leftward.
    // `updateCamera` (m1 0x124b80..0x124bdc) takes the lead from the gameplay
    // offsets — `[0x2a4]` (x) and `[0x2ac]` (y), both 75 by default
    // (`restoreDefaultGameplayOffsetX/Y`, m1 0x120ffc/0x121018) — and puts it
    // on the travel axis: y when sideways, x otherwise, negated when going
    // left (`[0x972]`). So the 75-unit lead along the direction of travel is
    // the game's, divided by the camera zoom (`[0x1a8]` = `m_gameState
    // .m_cameraZoom`, written by the zoom update at m1 0x120a90) unless the
    // offset's flag (`[0x2a8]`/`[0x2b0]`) is set: a zoomed-out view leads by
    // 75 / zoom world units. APPROXIMATION (FIDELITY A-list): the off-axis
    // follow in turned play is still the port's own.
    const leadZoom = sim.triggers?.rt?.zoom ?? 1;
    const lead = CAMERA_LEAD / (leadZoom > 0 ? leadZoom : 1);
    const turned = player.sideways || player.reversed;
    const travel = turned ? toWorld(player, 1, 0) : null;
    // Sideways play (native Dash steps 5100–5800, gd-ui-capture `vseek` with
    // the camera, 2026-10-03, docs/fidelity/captures-2026-10-03/dash-side.txt):
    // along the travel the view leads by 75 / zoom, as everywhere; across it
    // the camera holds still while the player stays within 40 / zoom of the
    // centre on its ground side and 70 / zoom on the other — the cube
    // deadzone turned with the gravity axis (steps 5450–5650: centre fixed at
    // x 6845 while the player bounces between 6779 and its ground at 6891).
    const sideways = !!travel && player.sideways;
    const down = sideways ? toWorld(player, 0, -1) : null;
    if (!down) offC = null;
    else if (offC === null) offC = drawX * down.x + player.y * down.y;
    const camLeft = travel
      ? (down ? down.x * offC! + travel.x * (drawX * travel.x + player.y * travel.y + lead)
        : drawX + travel.x * lead) - viewW / 2
      : clampCameraLeft(cameraLeftFor(drawX, viewW) + (lead - CAMERA_LEAD), L, viewW);
    const camX = camLeft + viewW / 2;
    // In a **dual the camera frames both players**, not player 1. Following one
    // of them puts the partner off-screen (or hard against an edge) and is the
    // single thing that makes a dual section feel wrong to play: you cannot see
    // what the other half of your input is doing. So the camera tracks the
    // midpoint — of the two positions in cube mode, and of the two
    // `cameraYCenter` anchors outside it. Those anchors are equal in practice:
    // a dual keeps the dual portal's centre through gamemode portals (see
    // `stepOne` in sim.ts), so the midpoint is that centre.
    const camPartner = sim.dual?.player;
    const camTrackY = camPartner ? (player.y + camPartner.y) / 2 : player.y;
    const camAnchor = camPartner
      ? (player.cameraYCenter + camPartner.cameraYCenter) / 2
      : player.cameraYCenter;
    // camY here is the view's bottom edge, as in the original; the renderer
    // wants the centre, so VIEW_H/2 is added when the camera is handed over.
    // A dual is centred on the pair rather than run through either single-player
    // rule — see `dualCameraBottom`.
    const targetBottom = camPartner
      ? dualCameraBottom(camAnchor, viewH)
      : cameraBottomTarget(
        player.mode, camTrackY, player.gravityFlipped, camAnchor, camY, viewH, player.freeMode);
    if (!attemptLabel) {
      // PlayLayer init (m1 0x9d1d4) places the label at the starting camera
      // centre +85 Y; updateAttempts (0xabb14) adds +50 X on retries.
      // It is a child of the world layer (0x9cbe0), not a fixed HUD element.
      attemptLabel = {
        x: cameraLeftFor(startX, viewW) + viewW / 2 + (retryLabel ? 50 : 0),
        y: targetBottom + viewH / 2 + 85,
      };
    }
    if (endSeq && portalY !== null) {
      // `updateStaticCameraPos(portal, staticY, 1.2 s, EaseInOut 1.8)`
      const k = Math.min(1, endSeq.t / CAMERA_SETTLE_DURATION);
      const target = portalY - viewH / 2;
      camY = endCamY0 + (target - endCamY0)
        * easedValue(k, CAMERA_SETTLE_EASING, CAMERA_SETTLE_RATE);
    } else if (travel) {
      const k = Math.min(1, frame * 6);
      if (down && offC !== null) {
        const z = leadZoom > 0 ? leadZoom : 1;
        const u = drawX * down.x + player.y * down.y;
        // (`down` is the local −y, which points away from the ground here)
        const t = u > offC + 70 / z ? u - 70 / z : u < offC - 40 / z ? u + 40 / z : offC;
        offC += (t - offC) * k;
        // the travel axis is not eased — like x in ordinary play
        camY = down.y * offC + travel.y * (drawX * travel.x + player.y * travel.y + lead) - viewH / 2;
      } else {
        // reversed (leftward) play: APPROXIMATION A43, the off-axis follow there
        // is still the port's own
        const want = player.y + travel.y * lead - viewH / 2;
        camY += (want - camY) * k;
      }
    } else if (paused || completed || sim.dead || manual) {
      // no steps ran this frame (or the tooling steps it): hold still
    }
    const camCentreY = camY + viewH / 2;
    // `EndPortalObject::setVisible(true)` → `updateEndPos`: the portal takes its
    // height the first time it comes into view
    if (portalY === null && L - camLeft <= viewW + 60) {
      portalY = endPortalY(camCentreY, player.mode === "ship");
    }

    // Zoom camera (1913): the world is drawn at scale × zoom about the same
    // centre, so it covers view / zoom world units; the camera logic above and
    // the HUD below stay in unzoomed units, as the game's do.
    const rtc = sim.triggers?.rt;
    const zoom = rtc?.zoom ?? 1;
    // Camera offset (1916) moves the view in world units; camera rotate (2015)
    // turns the screen about its centre, so a turned view must draw the
    // bounding box of the rotated rectangle
    const offX = rtc?.camOffset.x ?? 0, offY = rtc?.camOffset.y ?? 0;
    const angle = rtc?.camAngle ?? 0;
    const ca = Math.abs(Math.cos((angle * Math.PI) / 180)), sa = Math.abs(Math.sin((angle * Math.PI) / 180));
    const zvW0 = viewW / zoom, zvH0 = viewH / zoom;
    // Mid-flip the squashed screen spans more world, but only the background
    // and ground fill it: the objects that flip are the active ones, the
    // unsquashed view's (`screenFlipObject` m1 0xa67b8 runs from
    // `updateVisibility` on the active sections only). Drawing the objects of
    // the wider span too packed a whole stretch of Time Machine (29%) into
    // the screen as thin slivers; a 2.2 playthrough (YouTube g3_XUbK-PP0)
    // shows nothing of the kind.
    const squash = 1 / Math.max(0.2, Math.abs(1 - 2 * flipK));
    const zvWObj = zvW0 * ca + zvH0 * sa;
    const zvW = zvWObj * squash, zvH = zvW0 * sa + zvH0 * ca;
    // Camera Static (1914) moves the whole view (see `TriggerRuntime.viewStatic`)
    let sX = camX, sY = camCentreY;
    // Two statics can be live at once, one per axis (`viewStaticOther`); each
    // axis takes its owner's value (`stepViewStaticPair`, gd/camera.ts)
    const vs = rtc?.viewStatic ?? null, vo = rtc?.viewStaticOther ?? null;
    if ((vs || vo) && sim.triggers) {
      const tgS = vs ? groupAnchor(sim.triggers.level, rtc, vs.group) : null;
      const tgO = vo ? groupAnchor(sim.triggers.level, rtc, vo.group) : null;
      if (tgS || tgO) {
        // an exit releases only its own axes, inside `stepViewStatic`
        const live = stepViewStaticPair(vo, tgO, vs, tgS, camX, camCentreY, lastView.x, lastView.y,
          frame, paused, zoom, viewW, VIEW_OUT);
        if (!live.second) rtc!.viewStatic = null;
        if (!live.first) rtc!.viewStaticOther = null;
        sX = VIEW_OUT.x; sY = VIEW_OUT.y;
      }
    }
    // Camera Edge (2062): the left/right edge groups bound the view
    // (`updateCamera` m1 0x124838: left ≥ the edge object's x, right ≤ it).
    // Dash's right edge at x 21571 (group 433): the native camera's right side
    // holds at 21557–21561 from f18200 while the player runs on (dash-full.txt).
    // The top/bottom edges are not modelled — Dash's is a group the 2.2
    // area/keyframe system moves (BUGS [OPEN]).
    if (rtc && sim.triggers) {
      const [le, re] = rtc.camEdges;
      const L = le > 0 ? groupAnchor(sim.triggers.level, rtc, le) : null;
      const R = re > 0 ? groupAnchor(sim.triggers.level, rtc, re) : null;
      if (R) sX = Math.min(sX, R.x - zvW0 / 2);
      if (L) sX = Math.max(sX, L.x + zvW0 / 2);
    }
    lastView = { x: sX, y: sY };
    const vX = sX + offX, vY = sY + offY;
    renderer.camera = { x: vX + shake.x, y: vY + shake.y, scale: scale * zoom,
      mirrorX: run.mirrored, flipScale: 1 - 2 * flipK, rotation: angle };
    // the screen shaders (2919–2923) post-process the world, not the HUD
    const sh = rtc?.shader;
    // the glitch stays live while any of its RGB, strength or line fields is
    // non-zero (`preChromaticGlitchShader` m1 0x34ff24)
    const glitchOn = !!sh && sh.cgOn && (sh.cgRGB !== 0 || sh.cgStrength !== 0 || sh.cgLine !== 0);
    const shaderOn = !!sh && (sh.gray > 0 || sh.sepia > 0 || sh.invert > 0 || sh.hue !== 0 || sh.cr > 0 || sh.lensStrength > 0 || sh.chromX !== 0 || sh.chromY !== 0 || glitchOn || sh.rbSize !== 0 || sh.bulge > 0 || sh.slStrength > 0 || sh.swStrength > 0);
    // The shaders take only the layers in Shader Setup's range (`rt.shaderZ`):
    // the frame goes down in the game's layer order — 1 background, 3–7
    // B5–B1, 8 the player's layer, 9–12 T1–T4, 13 the ground — and the
    // offscreen target opens at the range's first layer and is composited
    // after its last. Dash x 975: invert on layer 8 alone turns the player
    // white and leaves the level as it is (2.2 playthrough, 3–5 %).
    const [shMin, shMax] = rtc?.shaderZ ?? [1, 15];
    let postOpen = shaderOn && shMin <= 1;
    renderer.begin(postOpen);
    const layerOpen = (idx: number) => {
      if (shaderOn && !postOpen && idx === shMin) { renderer.beginPostLayer(); postOpen = true; }
    };
    const layerClose = (idx: number) => {
      if (postOpen && idx === shMax) { applyShader(); postOpen = false; }
    };
    // shader layer index → the objects' z values (B5 −5 … B1 3, the portal
    // backs' 4, T1 5 … T4 11)
    const Z_RANGE: Record<number, [number, number]> = {
      3: [-Infinity, -5], 4: [-4, -3], 5: [-2, -1], 6: [0, 1], 7: [2, 3],
      8: [4, 4], 9: [5, 5], 10: [6, 7], 11: [8, 9], 12: [10, Infinity],
    };
    const drawLayers = (from: number, to: number) => {
      for (let idx = from; idx <= to; idx++) {
        layerOpen(idx);
        scene.drawObjects(vX, zvWObj, drawX, vY, zvH, Z_RANGE[idx][0], Z_RANGE[idx][1]);
        if (idx !== 8) layerClose(idx);
      }
    };

    function applyShader() {
      if (!sh || !rtc) return;
      const tint: [number, number, number] = sh.grayTint >= 0
        ? (() => { const c = channelColor(rtc, sh.grayTint); return [c.r / 255, c.g / 255, c.b / 255]; })()
        : [1, 1, 1];
      const inv = (v: number) => (sh.invClamp ? Math.min(1, sh.invert * v) : sh.invert * v);
      renderer.applyPost({
        gray: sh.gray, grayTint: tint, grayLum: sh.grayLum, sepia: sh.sepia,
        invert: [inv(sh.invR), inv(sh.invG), inv(sh.invB), sh.invert],
        hueDeg: sh.hue, changeC: [sh.cr, sh.cg, sh.cb], changeB: [sh.br, sh.bg, sh.bb],
        // design points over the texture's size (`preChromaticShader`)
        chromatic: [sh.chromX / viewW, sh.chromY / viewH],
        // the uniforms `preChromaticGlitchShader` derives (m1 0x34fffc..):
        // split 0.01·key 180 (1e-4 when 0), strength 0.02·key 176, noise
        // height 1 / key 189, lines at max(1 − 0.2·key 179, 0.001) of
        // strength 0.05·key 191 (none when key 191 is 0). The scale
        // factors at +0x474/+0x47c and the texture scale are taken as 1, and
        // the y offset as the camera's height in screens — APPROXIMATION A58.
        glitch: glitchOn ? {
          rgb: sh.cgRGB === 0 ? 1e-4 : sh.cgRGB * 0.01, yOff: vY / zvH, time: sh.cgTime,
          strength: sh.cgStrength * 0.02, height: sh.cgSeg,
          line: sh.cgLine === 0 ? 0 : Math.max(1 - 0.2 * sh.cgHeight, 0.001), lineStrength: sh.cgLine * 0.05,
        } : undefined,
        // radial blur (2914): `preRadialBlurShader` m1 0x350b9c — value
        // size/45, fade clamp(0.2·fade, 0, 0.2); the centre is taken as the
        // screen's — APPROXIMATION A60 (target/offset centring not decoded)
        // bulge (2916): the common shader setup (m1 0x34e238..0x34e4fc) —
        // value max(2·bulge, 0.001), value2 |v| / tan(|v|·value) with |v| =
        // √0.5, radius key 180; the per-frame scale (+0x474) and the global at
        // 0x1008b8660 are taken as 1 and the origin as the screen centre (A61)
        // shock line (2907): `preShockLineShader` m1 0x34f3b8 — band width
        // 0.2·thickness, its fades in those widths, the front at the clock plus
        // 0.1·screen offset, 22 / wave width waves, strength 0.01·key 176; the
        // centre with no target is the screen's middle moved by 0.5·key 177
        // (m1 0x34d8d4). Scale factors taken as 1 and the off-screen cull and
        // target/follow centring left out — APPROXIMATION A62.
        // shock wave (2905): `preShockWaveShader` m1 0x34ee64 — the ring's
        // radius is (clock + 0.1·time offset)² (linear when inverted), band
        // edges as the shock line's, strength 0.1·key 176, min/max size
        // 0.5·inner / outer; centred on the target group's object (key 188 +
        // 51) or the screen. Scale factors taken as 1 — APPROXIMATION A62.
        shockWave: sh.swStrength > 0 ? (() => {
          const th = sh.swThick > 0.001 ? sh.swThick * 0.2 : 0.0002;
          const fin = sh.swFadeIn * th, fout = sh.swFadeOut * th;
          const front = sh.swTimeOff * 0.1 + sh.swT;
          const r = front * (sh.swInvert ? 1 : front) - fin;
          const inner = r - th;
          const waves = 22 / Math.max(sh.swWave, 0.001);
          let cx = 0.5 + 0.5 * sh.swOffX, cy = 0.5 + 0.5 * sh.swOffY;
          const tg = sh.swTarget > 0 && sim.triggers ? groupAnchor(sim.triggers.level, rtc, sh.swTarget) : null;
          if (tg) { cx = (tg.x - vX) / zvW + 0.5 + 0.5 * sh.swOffX; cy = (tg.y - vY) / zvH + 0.5 + 0.5 * sh.swOffY; }
          return {
            time: front * waves, waves, strength: sh.swStrength * 0.1,
            maxDist: sh.swMax === 0 ? 0 : 1 / (sh.swMax * 0.5),
            edges: [r + fin + 0.001, r, inner + 0.001, inner - fout] as [number, number, number, number],
            center: [cx, cy] as [number, number], minSize: sh.swInner * 0.5, maxSize: sh.swOuter, invert: sh.swInvert,
          };
        })() : undefined,
        shockLine: sh.slStrength > 0 ? (() => {
          const th = sh.slThick > 0.001 ? sh.slThick * 0.2 : 0.0002;
          const fin = sh.slFadeIn * th, fout = sh.slFadeOut * th;
          let front = sh.slT + sh.slOffset * 0.1;
          if (sh.slInvert) front -= (sh.slDual ? 0.5 : 1) * (th + fin + fout);
          const back = front - fin;
          const waves = 22 / Math.max(sh.slWave, 0.001);
          return {
            time: front * waves, waves, strength: sh.slStrength * 0.01,
            maxDist: sh.slMax === 0 ? 0 : 1 / (sh.slMax * 0.5),
            edges: [front + 0.001, back, back - th + 0.001, back - th - fout] as [number, number, number, number],
            center: 0.5 + 0.5 * sh.slCenter, axis: sh.slAxis, dual: sh.slDual, flip: sh.slFlip,
          };
        })() : undefined,
        bulge: sh.bulge > 0 ? (() => {
          const value = Math.max(2 * sh.bulge, 0.001), v = Math.SQRT1_2;
          return { value, value2: v / Math.tan(v * value), radius: sh.bulgeRadius, origin: [0.5, 0.5] as [number, number] };
        })() : undefined,
        radialBlur: sh.rbSize !== 0 ? {
          value: sh.rbSize / 45, fade: Math.min(0.2, Math.max(0, sh.rbFade * 0.2)),
          center: [0.5, 0.5], onlyEmpty: sh.rbEmpty,
        } : undefined,
        lens: sh.lensStrength > 0 ? (() => {
          // the target on screen (design units), in screen-width units; a
          // group target or none is taken as the view centre — APPROXIMATION A45
          const sx = sh.lensTarget === -1 ? (player.x - vX) * zoom + viewW / 2 : viewW / 2;
          const sy = sh.lensTarget === -1 ? (player.y - vY) * zoom + viewH / 2 : viewH / 2;
          const ox = sx + sh.lensOffX * 0.5, oy = sy + sh.lensOffY * 0.5;
          const t = sh.lensTint > 0 ? channelColor(rtc, sh.lensTint) : { r: 0, g: 0, b: 0 };
          return {
            strength: sh.lensStrength,
            start: Math.max(0, sh.lensSize - Math.max(0, sh.lensFade)), end: Math.max(0, sh.lensSize),
            origin: [ox / viewW, oy / viewW] as [number, number],
            tint: [t.r / 255, t.g / 255, t.b / 255] as [number, number, number], additive: false,
          };
        })() : undefined,
      });
    }
    scene.drawBackground(vX, vY, zvW, zvH);
    layerClose(1);
    layerOpen(2);
    scene.drawMiddleground(vX, vY, zvW, zvH, zoom);
    layerClose(2);
    // breakable blocks the player has smashed stop being drawn as well as
    // colliding; the set is per-attempt and cleared by resetSim
    scene.destroyed = sim.destroyed;
    // the pulse runs on level time; in practice the game holds it at 0.5
    // (`updateVisibility` m1 0xa4dd4 — APPROXIMATION A51: the +0x3059 case,
    // practice with the music synced, is not identified and not modelled)
    if (!paused && !completed) {
      const lt = songOffset + (sim.triggers?.rt.time ?? 0);
      if (audioFx) {
        if (lt < audioFx.clock - 1e-6) audioFx.seek(lt);
        else audioFx.step(lt - audioFx.clock, practice);
      } else stepPulse(meterPulse, audio.musicPeak());
    }
    scene.audioPulse = practice ? 0.5 : audioFx ? audioFx.value : meterPulse.p1;
    // custom particle objects (2065) run on the render frame, like the other
    // object emitters, and hold still while paused
    if (!paused) scene.stepParticles(frame, vX - zvWObj / 2, vX + zvWObj / 2);
    scene.playerY = player.y;
    drawLayers(3, 8);
    if (portalY !== null && L - camLeft <= viewW + 60) {
      drawEndPortal(renderer, gameSheet, { x: L, y: portalY }, viewH);
      if (fxLib) {
        if (!endPortalFx) {
          endPortalFx = oneShot(fxLib, "endEffectPortal", L - 15, portalY, strongCol1);
          endPortalFx.cfg.startRadius = viewH / 2;
        }
        endPortalFx.x = L - 15;
        endPortalFx.y = portalY;
        if (!paused) endPortalFx.update(frame);
        drawEmitter(endPortalFx);
      }
    }
    // the ending's fireworks each drop a `firework.plist` burst (`0xa2dcc` +372..488)
    if (endSeq && fxLib) {
      for (const fw of endSeq.fireworks) {
        if (fw.spawned || endSeq.t < fw.at) continue;
        fw.spawned = true;
        oneShots.add(oneShot(fxLib, "firework", fw.x, fw.y, strongCol1), true);
      }
    }

    // --- practice checkpoints ---
    // Drawn under the player so the icon is never hidden by a gem it is
    // standing on. The most recent one — the one a death returns to — pulses,
    // because with several on screen it is otherwise not clear which is live.
    if (practice && gems && gemBase) {
      const t = performance.now() / 1000;
      const lastCp = checkpoints.last;
      for (const cp of checkpoints.list) {
        if (Math.abs(cp.x - camX) > zvW) continue;
        const live = cp === lastCp;
        const w = gemBase.sourceW * HD, h = gemBase.sourceH * HD;
        const pulse = live ? 1 + Math.sin(t * 4) * 0.06 : 1;
        if (gemGlow && live) {
          renderer.draw(gems.tex, gems.texW, gems.texH, gemGlow,
            cp.x, cp.y, gemGlow.sourceW * HD * pulse, gemGlow.sourceH * HD * pulse,
            0, 0.4, 1, 0.5, 0.5, "additive");
        }
        renderer.draw(gems.tex, gems.texW, gems.texH, gemBase,
          cp.x, cp.y, w * pulse, h * pulse, 0,
          0.35, 1, 0.45, live ? 1 : 0.5);
      }
    }

    // --- the player icon for the current gamemode ---
    // Takes the player as an argument so the **dual partner** is drawn by the
    // same code: it is a second player in every respect, just mirrored.
    /**
     * Draw one icon sprite about `cx, cy`.
     *
     * A trimmed frame's `offsetX/offsetY` is the gap between the packed image
     * and its original canvas, and it has to be applied in the sprite's **own
     * rotated frame** — exactly as `levelScene.emit` does it. The detail and
     * glow layers are trimmed harder than the main one (`spider_01_01_2` is
     * off by 12,3 alone), so skipping this slides them off the icon.
     */
    const drawIconSprite = (
      uf: UiFrame, cx: number, cy: number, rot: number, k: number,
      sx: number, sy: number, flipX: boolean, flipY: boolean,
      r: number, g: number, b: number, a: number,
      blend: "normal" | "additive" = "normal",
    ) => {
      const f = uf.frame;
      const tox = f.offsetX * k * sx * (flipX ? -1 : 1);
      const toy = f.offsetY * k * sy * (flipY ? -1 : 1);
      const c = Math.cos(rot), sn = Math.sin(rot);
      renderer.draw(uf.sheet.tex, uf.sheet.texW, uf.sheet.texH, f,
        cx + tox * c - toy * sn, cy + tox * sn + toy * c,
        f.w * k * sx, f.h * k * sy, rot, r, g, b, a, blend, flipX, flipY);
    };

    const drawPlayerIcon = (
      player: PlayerState, spinDeg = 0,
      anim = player === sim.player ? limbAnim.p1 : limbAnim.p2,
      // which player's animation clock; the ending passes copies, so it says
      slot: 0 | 1 = player === sim.player ? 0 : 1,
    ) => {
      if (!icons) return;
      const ia = iconAnim[slot];
      const vehicle = iconFrame(player.mode);
      const sizeScale = player.mini ? MINI_SCALE : 1;
      const g = gravitySign(player);
      const speed = run.speed;

      // visual angle in degrees CCW (renderer convention); CW-positive state
      // angles (cube rotation, ball roll) are negated
      let angle = 0;
      let flipY = false;
      switch (player.mode) {
        case "cube":
          angle = -player.rotation;
          break;
        case "robot":
          // the robot never spins — it runs and jumps through its own
          // animation, upright (Geometrical Dominator 50%: airborne at
          // y 365, the native robot is level; USER-01)
          angle = 0;
          break;
        case "ship":
        case "ufo":
        case "swing": {
          // The tilt is the *actual* direction of travel and needs no gravity
          // sign: `flipY` already mirrors the art for an upside-down ship, so
          // negating the angle as well double-applied the flip and pointed the
          // nose the wrong way whenever gravity was inverted.
          const target = (Math.atan2(player.yVel, speed) * 180) / Math.PI;
          // the native angle chases the path by 0.04 of the gap every 240 Hz
          // step (Stereo Madness's ship, macro rotations: 0.64° mean error)
          if (!paused) ia.tilt += (target - ia.tilt) * (1 - Math.pow(0.96, frame * 240));
          angle = ia.tilt;
          flipY = player.gravityFlipped;
          break;
        }
        case "ball":
          // The native roll, measured from every rolling ball in the macros
          // (2026-10-03): 1.9257° per unit travelled at every speed (2.5° a
          // 240 Hz step at 1x, 3.109 at 2x, 3.755 at 3x), 1.25 times that for
          // a mini ball (Clutterfunk's 3.125), turning with gravity.
          if (!paused) ia.roll += speed * frame * BALL_ROLL_PER_UNIT * (player.mini ? 1.25 : 1) * g;
          angle = -ia.roll;
          break;
        case "wave":
          angle = (Math.atan2(player.yVel, speed) * 180) / Math.PI;
          break;
        case "spider":
          flipY = player.gravityFlipped;
          break;
      }

      // the ending's `CCRotateBy` turns the whole player node, clockwise
      const rot = ((angle - spinDeg) * Math.PI) / 180;

      // --- robot and spider: seven (six) skeletal parts, not one sprite ---
      if (player.mode === "robot" || player.mode === "spider") {
        const mode: LimbMode = player.mode;
        const parts = animFrame(mode, anim);
        if (parts) {
          const k = HD * sizeScale;
          const cos = Math.cos(rot), sin = Math.sin(rot);
          const my = flipY ? -1 : 1;
          const dark = BACK_LIMB_TINT[mode];
          const placed = parts.flatMap((part) => {
            const n = iconFrame(mode, part.l);
            if (!n.main) return [];
            // the part offset rides in the player's rotated frame, and mirrors
            // with the icon when gravity is flipped
            const lx = part.x * sizeScale, ly = part.y * sizeScale * my;
            const px = player.x + lx * cos - ly * sin;
            const py = player.y + lx * sin + ly * cos;
            // key `r` is degrees CW; the renderer takes CCW radians
            const pr = rot + (-part.r * my * Math.PI) / 180;
            const put = (f: UiFrame, r: number, g: number, b: number) =>
              drawIconSprite(f, px, py, pr, k, part.sx, part.sy,
                part.fx === 1, (part.fy === 1) !== flipY, r, g, b, 1);
            return [{ part, n, put }];
          });
          // Every part's glow lives in the one `m_glowSprite` node that
          // `GJRobotSprite::showGlow` toggles, behind the body — so all of
          // them go down first, default blend.
          if (GLOW.visible) {
            for (const { n, put } of placed) if (n.glow) put(n.glow, GLOW.r, GLOW.g, GLOW.b);
          }
          for (const { part, n, put } of placed) {
            const t = part.b ? dark : 1;
            put(n.main!, P1.r * t, P1.g * t, P1.b * t);
            if (n.detail) put(n.detail, P2.r * t, P2.g * t, P2.b * t);
            if (n.extra) put(n.extra, t, t, t);
          }
          return;
        }
      }

      // `toggleGameMode` keeps the *cube* sprite visible inside the ship and the
      // UFO — scale 0.55 at y +5, with the vehicle itself at y -5 (ship) or -7
      // (UFO). The ball has no cube. Drawing only the vehicle is why the ship
      // and UFO looked empty.
      const cubeIn = player.mode === "ship" || player.mode === "ufo";
      // Upside down, the whole stack mirrors: the vehicle sits *above* and the
      // cube below. Mirroring the sprite without mirroring these offsets put the
      // cube on the wrong side of the ship.
      const stack = flipY ? -1 : 1;
      type Layer = {
        v: ReturnType<typeof iconFrame>;
        dy: number;
        s: number;
      };
      // the vehicle sits at y −5 (ship, `toggleFlyMode` m1 0x38b7a8) or −7
      // (UFO, `toggleBirdMode` m1 0x38c1b0) under the cube at +5 — the UFO at 0
      // put its little cube 7 units low in the dome (USER-06)
      const layers: Layer[] = [
        { v: vehicle, dy: (player.mode === "ship" ? -5 : player.mode === "ufo" ? -7 : 0) * stack, s: 1 },
      ];
      if (cubeIn) layers.push({ v: iconFrame("cube"), dy: 5 * stack, s: 0.55 });

      const layerPut = (l: Layer) => {
        // the offset rides in the sprite's rotated frame
        const oy = l.dy * sizeScale;
        const px = player.x - oy * Math.sin(rot);
        const py = player.y + oy * Math.cos(rot);
        const k = HD * sizeScale * l.s;
        return (f: UiFrame, r: number, g: number, b: number) =>
          drawIconSprite(f, px, py, rot, k, 1, 1, false, flipY, r, g, b, 1);
      };
      // Every icon's own `_glow_001` frame, default blend, behind the icon
      // (`PlayerObject::init` +4336 puts it at z −1 in the icon's container).
      // All glows go down before any icon layer, so the cube's glow inside the
      // ship does not paint over the ship.
      if (GLOW.visible) {
        for (const l of layers) {
          if (l.v.main && l.v.glow) layerPut(l)(l.v.glow, GLOW.r, GLOW.g, GLOW.b);
        }
      }
      for (const l of layers) {
        const { main: mf, detail: df, extra: xf, dome: domef } = l.v;
        if (!mf) continue;
        const put = layerPut(l);
        put(mf, P1.r, P1.g, P1.b);
        if (df) put(df, P2.r, P2.g, P2.b);
        // `extra` and the UFO's dome are untinted white detail
        if (xf) put(xf, 1, 1, 1);
        if (domef) put(domef, 1, 1, 1);
      }
    };

    // --- particles and trails, under the player ---
    const camLeftX = camX - zvWObj / 2;
    // the objects' own emitters, kept only while their object is near the view
    if (fxLib) {
      const lo = camLeftX - 90, hi = camLeftX + zvWObj + 90;
      for (const it of world.interactives) {
        if (it.kind !== "portal" && it.kind !== "orb" && it.kind !== "pad" && it.kind !== "speed") continue;
        const inView = it.x >= lo && it.x <= hi;
        const have = objFx.get(it.index);
        if (!inView) { if (have) objFx.delete(it.index); continue; }
        let e = have;
        if (!e) {
          const type = OBJECT_DEFS.get(it.id)?.type;
          const made = type === undefined ? null : objectEmitter(fxLib, type, it.id);
          if (!made) continue;
          e = made;
          objFx.set(it.index, e);
        }
        e.x = it.x;
        e.y = it.y;
        e.rotation = propFloat(it.props, P.ROTATION);
        if (!paused) e.update(frame);
      }
    }
    // the glitter rides the camera's centre and covers the (zoomed) view
    if (glitter) {
      const flying = GLITTER_MODES.has(player.mode);
      if (flying && !glitter.active) glitter.resume();
      else if (!flying && glitter.active) glitter.stop();
      glitter.x = camX;
      glitter.y = camCentreY;
      glitter.cfg.posVarX = zvW0 / 1.8;
      glitter.cfg.posVarY = zvH0 / 2;
      if (!paused) glitter.update(frame);
      drawEmitter(glitter);
    }
    for (const e of objFx.values()) drawEmitter(e);
    for (const fx of [pfx1, pfx2]) {
      if (!fx) continue;
      drawWaveTrail(fx.wave);
      drawStreak(fx.streak, fx.colorB);
      for (const e of fx.emitters()) drawEmitter(e);
    }
    for (const o of oneShots.live) if (!o.screen) drawEmitter(o.e);
    for (const w of waves) {
      const st = circleWaveAt(w.spec, w.t);
      if (st) {
        drawWave(renderer, endTex, w.x, w.y, st.radius, w.spec.lineWidth, w.spec.outline,
          { r: w.color[0] / 255, g: w.color[1] / 255, b: w.color[2] / 255 }, st.opacity * w.alpha);
      }
    }

    if (!sim.dead) {
      // Advance the limb clocks on the render frame, not the physics step: this
      // is presentation, and `sim.ts` stays the only place with rules.
      const tick = (p: PlayerState, a: typeof limbAnim.p1) => {
        if (p.mode !== "robot" && p.mode !== "spider") return;
        stepAnim(a, p.mode, p.onGround, p.yVel * gravitySign(p) > 0, frame);
      };
      tick(player, limbAnim.p1);
      if (sim.dual) tick(sim.dual.player, limbAnim.p2);
      if (endSeq) {
        // the ghost trail sits under the icons it copies
        const vehicle = iconFrame(player.mode).main;
        drawEndGhosts(endSeq, (g, alpha, k) => {
          if (!vehicle) return;
          const who = g.player === 2 && sim.dual ? sim.dual.player : player;
          const sz = HD * (who.mini ? MINI_SCALE : 1) * k;
          drawIconSprite(vehicle, g.x, g.y, (-g.spin * Math.PI) / 180, sz, 1, 1,
            false, who.gravityFlipped && who.mode !== "cube" && who.mode !== "robot",
            P1.r, P1.g, P1.b, alpha, "additive");
        });
        drawPlayerIcon({ ...player, x: pose1!.x, y: pose1!.y }, pose1!.spin, limbAnim.p1, 0);
        if (sim.dual) {
          const p2 = endSeq.pose(2);
          drawPlayerIcon({ ...sim.dual.player, x: p2.x, y: p2.y }, p2.spin, limbAnim.p2, 1);
        }
        drawEndWorld(renderer, endSeq, endTex, { p1: P1, p2: P2 }, viewW, viewH);
      } else {
        drawPlayerIcon(player);
        if (sim.dual) drawPlayerIcon(sim.dual.player);
      }
    } else if (boom && boomFrames.length && explode) {
      // `playDeathEffect` +280..740: frames (1 or 2)..11 at `delay` each, the
      // sprite untinted and not additive, fading out over the second half
      const e = explode;
      const i = e.first + Math.floor(e.t / e.delay);
      if (i < DEATH_LAST_FRAME && i < boomFrames.length) {
        const f = boomFrames[i];
        const k = HD * e.scale;
        const fadeFrom = 6 * e.delay;
        const a = e.t < fadeFrom ? 1 : Math.max(0, 1 - (e.t - fadeFrom) / fadeFrom);
        const dead = sim.dual?.dead ? sim.dual.player : player;
        renderer.draw(boom.tex, boom.texW, boom.texH, f,
          dead.x, dead.y, f.w * k, f.h * k, (-e.rot * Math.PI) / 180, 1, 1, 1, a);
      }
    }

    layerClose(8);
    // T1–T4 go over the player
    drawLayers(9, 12);
    layerOpen(13);

    // The grounds follow the band: in the flying modes they sit 150 either side
    // of the camera centre (a ball 120), and in a dual `updateDualGround`'s
    // edge; otherwise the ground is the level floor and there is no ceiling.
    {
      const flying = (m: string) => m === "ship" || m === "ufo" || m === "wave" || m === "swing";
      const edge = player.freeMode ? 0 : sim.dual && player.dualEdge ? player.dualEdge
        : flying(player.mode) ? scaledBandEdge(150, zoom) : player.mode === "ball" ? scaledBandEdge(120, zoom) : 0;
      const centre = sim.dual
        ? (player.cameraYCenter + sim.dual.player.cameraYCenter) / 2
        : player.cameraYCenter;
      if (edge > 0) scene.drawGround(vX, vY, zvW, zvH, Math.max(0, centre - edge), centre + edge);
      else scene.drawGround(vX, vY, zvW, zvH);
    }
    layerClose(13);

    // --- collider overlay (?debug=1) ---
    // Sprites and collision boxes are computed from different things (art frame
    // vs table size), so drawing them together is the fastest way to see which
    // one is wrong. Green = solid, red = hazard, cyan = slope surface,
    // yellow = interactive, white = the player's box (the one hazards test),
    // magenta = the player's inner box (the one solids kill with).
    if (debug) {
      const box = (x: number, y: number, hw: number, hh: number,
                   r: number, gg: number, bb: number, rotation = 0) => {
        const t = 1.2;
        const cos = Math.cos(rotation), sin = Math.sin(rotation);
        const edge = (dx: number, dy: number, w: number, h: number) =>
          renderer.draw(white.tex, 2, 2, white.frame,
            x + dx * cos - dy * sin, y + dx * sin + dy * cos,
            w, h, rotation, r, gg, bb, 0.9);
        edge(0, hh, hw * 2, t);
        edge(0, -hh, hw * 2, t);
        edge(-hw, 0, t, hh * 2);
        edge(hw, 0, t, hh * 2);
      };
      // saws collide as circles (`m_objectRadius`), so drawing their box would
      // misreport where they kill
      const circle = (x: number, y: number, rad: number,
                      r: number, gg: number, bb: number) => {
        const steps = 20;
        for (let i = 0; i < steps; i++) {
          const a0 = (i / steps) * Math.PI * 2, a1 = ((i + 1) / steps) * Math.PI * 2;
          const x0 = x + Math.cos(a0) * rad, y0 = y + Math.sin(a0) * rad;
          const x1 = x + Math.cos(a1) * rad, y1 = y + Math.sin(a1) * rad;
          renderer.draw(white.tex, 2, 2, white.frame, (x0 + x1) / 2, (y0 + y1) / 2,
            Math.hypot(x1 - x0, y1 - y0), 1.2, Math.atan2(y1 - y0, x1 - x0), r, gg, bb, 0.9);
        }
      };
      const view = { x: camX, y: camCentreY, hw: zvW / 2, hh: zvH / 2 };
      for (const c of world.near(view, sim.triggers?.rt)) {
        // a smashed breakable is gone from collision — drawing its box anyway
        // makes the overlay lie, and this overlay exists to be trusted
        if (sim.destroyed.has(c.index)) continue;
        if (c.slope) {
          // draw the ridable surface itself, not just the bounding box
          const steps = 8;
          for (let i = 0; i < steps; i++) {
            const x0 = c.x - c.hw + (2 * c.hw * i) / steps;
            const x1 = c.x - c.hw + (2 * c.hw * (i + 1)) / steps;
            const y0 = slopeSurfaceY(c, x0), y1 = slopeSurfaceY(c, x1);
            renderer.draw(white.tex, 2, 2, white.frame,
              (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, 1.6, 0, 0.2, 1, 1, 0.95);
          }
          // deliberately no bounding box for slopes: drawing one alongside the
          // surface reads as "the hitbox is a box", which is exactly the thing
          // the overlay exists to disprove
        } else if (c.kind === "hazard") {
          if (c.radius !== undefined) circle(c.x, c.y, c.radius, 1, 0.2, 0.2);
          else if (c.obb) box(c.x, c.y, c.obb.hw, c.obb.hh, 1, 0.2, 0.2,
            Math.atan2(c.obb.sin, c.obb.cos));
          else box(c.x, c.y, c.hw, c.hh, 1, 0.2, 0.2);
        }
        else box(c.x, c.y, c.hw, c.hh, 0.2, 1, 0.3);
      }
      for (const it of world.nearInteractives(view)) box(it.x, it.y, it.hw, it.hh, 1, 0.9, 0.2);
      // Both player boxes, because the whole two-hitbox rule is invisible
      // otherwise: the white one is what a hazard kills you with, the magenta
      // one is what a solid block kills you with (a block you only touch with
      // the white box pushes you up instead).
      const ph = half0 * (player.mini ? MINI_SCALE : 1);
      box(player.x, player.y, ph, ph, 1, 1, 1);
      const ih = PLAYER_INNER_HALF * (player.mini ? MINI_SCALE : 1);
      box(player.x, player.y, ih, ih, 1, 0.3, 1);
    }

    // `Hide Attempts` (game variable 0135) hides the counter in normal mode;
    // practice mode has its own variable (0134), which the port does not expose
    if (font && !practice && !paused && !completed && !save.settings().hideAttempts) {
      font.draw(renderer, `Attempt ${attempts}`, attemptLabel.x, attemptLabel.y,
        0.32, 1, 1, 1, 0.85, 0);
    }

    // a range reaching past the ground (14 UI, 15 the top) ends here, under the HUD
    if (postOpen) { applyShader(); postOpen = false; }
    // UI stays fixed on screen even while the world camera shakes.
    renderer.camera = { x: camX, y: camCentreY, scale };
    // the gravity-flip sweep (see `gravFx`): a real flip of player 1 — not the
    // reset of a new attempt, which also changes the flag
    {
      const flipped = player.gravityFlipped;
      if (lastFlipped !== null && flipped !== lastFlipped && !sim.dead && (player.flipAge ?? 1) < 0.05 && gravLine) {
        gravFx.push({ t: 0, flip: flipped, lines: newGravLines(viewW) });
      }
      lastFlipped = flipped;
      for (let k = gravFx.length - 1; k >= 0; k--) {
        const fx = gravFx[k];
        if (!paused) fx.t += frame;
        if (fx.t >= 0.4 || !gravLine) { gravFx.splice(k, 1); continue; }
        const u = fx.t / 0.4;
        const from = -viewH / 2 - 95, to = viewH / 2 + 95;
        const cy = camCentreY + (fx.flip ? from + (to - from) * u : to + (from - to) * u);
        const [cr, cg, cb] = fx.flip ? [1, 1, 0] : [0, 1, 1];
        for (const l of fx.lines) {
          const h = gravLine.frame.h * l.sy;
          renderer.draw(gravLine.tex, gravLine.texW, gravLine.texH, gravLine.frame,
            camX + l.x, cy + l.y, gravLine.frame.w * l.sx, fx.flip ? h : -h, 0, cr, cg, cb, l.a, "additive");
        }
      }
    }
    uiButtons = [];

    // --- the sourced HUD: progress bar, percentage and pause button ---
    //
    // Hidden once the level is complete: `EndLevelLayer` takes the screen, and
    // leaving a live pause button under it would let a click reach a control
    // the original has already removed.
    if (font && !completed) {
      const st = save.settings();
      const hudSettings: HudSettings = {
        showProgressBar: st.showProgressBar,
        showPercentage: st.showPercentage,
        showPauseButton: st.showPauseButton,
        pauseButtonOnLeft: st.pauseButtonOnLeft,
        percentageDecimals: st.percentageDecimals,
      };
      const geometry = hudGeometry(viewW, viewH,
        hudTex.groove.texW * HD, hudTex.groove.texH * HD, hudSettings);
      lastHudGeometry = geometry;
      drawHud({
        renderer, font, textures: hudTex,
        originX: camX, originY: camCentreY,
        geometry, settings: hudSettings,
        // both the bar and the label read the *live* position, as
        // `getCurrentPercent` does — not the best progress
        percent: currentPercent(progX(drawX), L),
        fillColor: P1,
        pauseFrame, pauseScale: 1,
      });
      // The original shows **no** "Practice Mode" text during play — the mode is
      // read off the checkpoint buttons and the pause menu's `GJ_practiceTxt`.
      // The label that used to sit here was the port's own development hint.
    }

    // --- screen-space particles: speed streaks, the ending's bursts ---
    if (oneShots.live.some((o) => o.screen)) {
      renderer.flush();
      renderer.camera = { x: 0, y: 0, scale };
      for (const o of oneShots.live) {
        if (!o.screen) continue;
        // the speed streaks sit at `(screenRight + 10, winH / 2)`
        if (o.anchorRight) o.e.x = viewW / 2 + 10;
        drawEmitter(o.e);
      }
      renderer.camera = { x: camX, y: camCentreY, scale };
    }

    // --- the ending's screen-space half: fireworks, the banner ---
    if (endSeq && hudSheet) {
      renderer.flush();
      renderer.camera = { x: 0, y: 0, scale };
      const bannerFrame = hudSheet.require(practice ? PRACTICE_COMPLETE_FRAME : COMPLETE_FRAME);
      drawEndScreen(renderer, endSeq, endTex, { p1: P1, p2: P2 },
        (s) => drawUiSprite(renderer, bannerFrame, 0, BANNER_DY, { scale: s }));
      renderer.camera = { x: camX, y: camCentreY, scale };
    }

    // --- `showNewBest`: a node at screen centre + 20, popped in with an elastic scale ---
    if (newBest) {
      if (!paused) newBest.t += frame;
      const k = newBestScale(newBest.t);
      const nbFrame = hudSheet?.has(NEW_BEST_FRAME) ? hudSheet.require(NEW_BEST_FRAME) : null;
      if (k === null) newBest = null;
      else if (font && nbFrame) {
        const cy = camCentreY + NEW_BEST_Y;
        // the sprite's anchor is (0.5, 0): its bottom edge rides on the node's origin
        drawUiSprite(renderer, nbFrame, camX, cy + (contentSize(nbFrame.frame).h * k) / 2,
          { scale: k });
        // the label hangs from (0, -4) with anchor (0.5, 1)
        const ls = HD * NEW_BEST_LABEL_SCALE * k;
        font.draw(renderer, newBestLabel(newBest.percent), camX,
          cy + NEW_BEST_LABEL_Y * k - font.font.base * ls, ls, 1, 1, 1, 1, 0);
      }
    }

    // --- the reproduced PauseLayer ---
    if (paused && !completed && font && hudSheet) {
      const L = pauseLayout(viewW, viewH);
      // the layer's own setOpacity(75) dims the level behind the panel
      renderer.draw(white.tex, 2, 2, white.frame, camX, camCentreY, viewW, viewH, 0,
        DIM_COLOR[0], DIM_COLOR[1], DIM_COLOR[2], DIM_OPACITY);
      drawNineSlice(renderer, pauseTex.panel, camX, camCentreY, L.panelW, L.panelH,
        { r: DIM_COLOR[0], g: DIM_COLOR[1], b: DIM_COLOR[2], a: PANEL_OPACITY });

      // the level's own name across the top, as CCLabelBMFont(m_levelName)
      const nameScale = HD * NAME_SCALE;
      font.draw(renderer, custom?.name ?? LEVELS[levelNum - 1]?.name ?? `Level ${levelNum}`,
        camX, camCentreY + L.nameY - (font.font.base - font.font.lineHeight / 2) * nameScale,
        nameScale, 1, 1, 1, 1, 0);

      // both progress bars, normal above practice, as setupProgressBars builds them
      const st = save.levelStats(levelNum);
      drawPauseBar({
        renderer, font, bar: pauseTex.bar, cx: camX, cy: camCentreY + L.barNormalY,
        percent: st.normal, color: [0, 255, 0], label: `${Math.floor(st.normal)}%`,
        title: "Normal Mode",
      });
      drawPauseBar({
        renderer, font, bar: pauseTex.bar, cx: camX, cy: camCentreY + L.barPracticeY,
        percent: st.practice, color: [0, 255, 255], label: `${Math.floor(st.practice)}%`,
        title: "Practice Mode",
      });

      // the icon row, laid out by the original's own alignment rule
      const widths = PAUSE_ROW.map((r) => {
        const f = hudSheet.require(r.id === "practice" && practice ? PRACTICE_OFF_FRAME : r.frame);
        return f.frame.sourceW * HD;
      });
      const total = widths.reduce((a, b) => a + b, 0) + (PAUSE_ROW.length - 1) * ROW_PADDING;
      let cursor = -total / 2;
      PAUSE_ROW.forEach((entry, i) => {
        const w = widths[i];
        const x = cursor + w / 2;
        cursor += w + ROW_PADDING;
        const frame = hudSheet.require(
          entry.id === "practice" && practice ? PRACTICE_OFF_FRAME : entry.frame);
        const h = frame.frame.sourceH * HD;
        const on = i === menuIndex;
        drawUiSprite(renderer, frame, camX + x, camCentreY + L.rowY,
          { scale: on ? 1.1 : 1 });
        uiButtons.push({
          id: entry.id, x, y: L.rowY, w, h,
          action: () => { menuIndex = i; chooseMenu(); },
        });
      });

      // the practice hint (for a player who has never pressed practice) and the gear
      if (showPracticeHint(save.settings().clickedPractice)) {
        drawUiSprite(renderer, hudSheet.require("GJ_practiceTxt_001.png"),
          camX + L.practiceBannerX, camCentreY + L.practiceBannerY);
      }
      const gear = hudSheet.require("GJ_optionsBtn_001.png");
      drawUiSprite(renderer, gear, camX + L.gearX, camCentreY + L.gearY, { scale: GEAR_SCALE });

      // the two sliders side by side, each named 20 above at 0.5
      volume.place("music", L.musicSliderX, L.sliderY);
      volume.place("sfx", L.sfxSliderX, L.sliderY);
      volume.draw(renderer, camX, camCentreY);
      drawLabel(renderer, font, "Music", camX + L.musicSliderX,
        camCentreY + L.sliderY + SLIDER_LABEL_DY, SLIDER_LABEL_SCALE);
      drawLabel(renderer, font, "SFX", camX + L.sfxSliderX,
        camCentreY + L.sliderY + SLIDER_LABEL_DY, SLIDER_LABEL_SCALE);
      uiButtons.push({
        id: "settings", x: L.gearX, y: L.gearY,
        w: gear.frame.sourceW * HD * GEAR_SCALE,
        h: gear.frame.sourceH * HD * GEAR_SCALE,
        action: openGameOptions,
      });
    }

    // --- the reproduced EndLevelLayer ---
    if (completed && font && goldFont && hudSheet) {
      // `EndLevelLayer::init` is `GJDropDownLayer::init(" ", 230, true)`, and
      // `customSetup` nudges the settled position 5 up. Drawn in plain screen
      // space, like the pause gear's popup.
      renderer.flush();
      renderer.camera = { x: 0, y: 0, scale };
      endT = Math.min(1, endT + frame / DROP_DURATION);
      const L = dropDownLayout(viewW, viewH, END_LEVEL_HEIGHT, endT);
      const slide = L.slide + END_LEVEL_Y_NUDGE;

      renderer.draw(white.tex, white.texW, white.texH, white.frame,
        0, 0, viewW, viewH, 0, 0, 0, 0, DROP_DIM_OPACITY * endT);
      drawDropDownPanel(renderer, hudSheet, font, white,
        { ...L, bottom: L.bottom + END_LEVEL_Y_NUDGE, cy: L.cy + END_LEVEL_Y_NUDGE,
          titleY: L.titleY + END_LEVEL_Y_NUDGE }, " ");

      const st = save.levelStats(levelNum);
      const stats: EndLevelStats = {
        attempts, jumps: sessionJumps, time: runSteps * STEP, practice,
        // the coin row is the level's own coin count, and the ordinals shown
        // filled are the ones the save actually holds — never a placeholder
        coinCount: COINS_PER_LEVEL,
        coinsHeld: st.coins,
      };
      const coinBlank = hudSheet.require(COIN_BLANK_FRAME);
      const endLayout = endLevelLayout(stats, coinBlank.frame.sourceW * HD);
      drawEndLevel({
        renderer, goldFont, bigFont: font,
        banner: hudSheet.require(practice ? PRACTICE_COMPLETE_FRAME : COMPLETE_FRAME),
        coinBlank, coinFilled: hudSheet.require(COIN_FILLED_FRAME),
        layout: endLayout, stats, endText, slide,
      });

      // the button row: Replay and Menu always, plus Restart-from-checkpoint
      // in practice. `menuIndex` still drives keyboard selection.
      const buttons: { id: string; frame: string; x: number }[] = [
        { id: "replay", frame: REPLAY_FRAME, x: endLayout.replayX },
        { id: "quit", frame: MENU_FRAME, x: endLayout.menuX },
      ];
      if (endLayout.restartCheckpointX !== null) {
        buttons.unshift({
          id: "restartCheckpoint", frame: RESTART_CHECKPOINT_FRAME,
          x: endLayout.restartCheckpointX,
        });
      }
      buttons.forEach((b, i) => {
        const f = hudSheet.require(b.frame);
        const y = endLayout.buttonRowY + slide;
        drawUiSprite(renderer, f, b.x, y, { scale: i === menuIndex ? 1.1 : 1 });
        uiButtons.push({
          id: b.id, x: b.x, y,
          w: f.frame.sourceW * HD, h: f.frame.sourceH * HD,
          action: () => { menuIndex = i; chooseMenu(); },
        });
      });
    }

    // `fadeAndRemove`'s white layer sits on the scene, over the results too
    if (endSeq) {
      renderer.flush();
      renderer.camera = { x: 0, y: 0, scale };
      drawEndFlash(renderer, endSeq, endTex, viewW, viewH);
    }

    // `GameOptionsLayer` is a popup over everything, in plain screen space
    if (gameOptions) {
      gameOptionsHost?.update(frame);
      gameOptions.layout(viewW);
      renderer.flush();
      renderer.camera = { x: 0, y: 0, scale };
      gameOptions.draw(viewW, viewH);
    }

    if (hud) {
      const pct = ((player.x / L) * 100).toFixed(1);
      hud.textContent =
        `x ${player.x.toFixed(1)}   y ${player.y.toFixed(1)}\n`
        + `yVel ${player.yVel.toFixed(0)}   ${pct}%\n`
        + `${player.mode}${player.mini ? " mini" : ""}`
        + `${player.gravityFlipped ? " flipped" : ""}${player.onGround ? " ground" : ""}\n`
        + `speed ${run.speed.toFixed(0)}   attempt ${attempts}\n`
        + (paused ? "PAUSED" : "esc to pause")
        + (practice ? `  [practice ${checkpoints.length}cp${checkpoints.auto ? " auto" : ""}]` : "")
        + (sim.events?.length
          ? "\n\nrecent:\n" + sim.events.map((e) =>
              `  ${e.what} @${e.x.toFixed(0)},${e.y.toFixed(0)} v${e.yVel.toFixed(0)}`).join("\n")
          : "");
    }

    fade.draw(frame, scale, viewW, viewH);
    renderer.flush();
    // tooling: the loop's own JS time (sim steps, scene build-up, draw calls)
    loopMs[loopI++ % loopMs.length] = performance.now() - now;
    requestAnimationFrame(loop);
  };
  loop();

  (window as unknown as Record<string, unknown>).__play = {
    state: player,
    // tooling only: the robot/spider limb clocks, so a headless check can hold
    // a chosen pose instead of catching whatever frame the animation is on
    limbAnim,
    // tooling only: the live trigger runtime and its trigger list. `?x=` skips
    // every portal behind the start but not the triggers, so a visual check of
    // a mid-level colour/move state has to advance these itself.
    triggers: sim.triggers,
    // tooling only: the drawing scene, so a capture harness can hold the
    // object-animation clock still (`scripts/animcapture.mjs`)
    scene,
    get info() {
      return {
        attempts, dead: sim.dead, x: player.x, y: player.y,
        view: lastView,
        loopMs: (() => { const a = [...loopMs].filter((v) => v > 0).sort((x, y) => x - y);
          return a.length ? { p50: a[a.length >> 1], p95: a[Math.floor(a.length * 0.95)], max: a[a.length - 1] } : null; })(),
        percent: (best / L) * 100, maxX: scene.maxX, levelLength: L,
        // what the HUD actually prints: the live position, floored, as
        // `PlayLayer::getCurrentPercentInt` does
        hudPercent: currentPercentInt(progX(endSeq ? endSeq.pose(1).x : player.x), L),
        // the level's end has triggered (the sim's rule), and how far the
        // presentation has got through the ending
        ended: sim.ended,
        ending: endSeq
          ? { t: endSeq.t, drawX: endSeq.pose(1).x, portalY, banner: endSeq.bannerScale(),
              flash: endSeq.flashOpacity(), complete: endSeq.complete }
          : null,
        jumps: sessionJumps,
        // tooling only: the live pause/completion controls and their design-space
        // rects, so a harness can click the real button instead of a guessed spot
        controls: uiButtons.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h })),
        endLevel: completed
          ? { t: endT, endText, time: runSteps * STEP, attempts, jumps: sessionJumps, practice }
          : null,
        gameOptions: gameOptions
          ? { controls: gameOptions.controls() }
          : null,
        // tooling only: the pause sliders' thumbs and values
        volume: paused
          ? { controls: volume.controls(), music: volume.value("music"), sfx: volume.value("sfx") }
          : null,
        livePercent: currentPercent(player.x, L),
        // tooling only: where the HUD actually laid itself out this frame, so a
        // headless check can prove it does not follow world shake or mirroring
        hud: lastHudGeometry,
        mode: player.mode, mini: player.mini, coins: run.coins,
        speed: run.speed, mirrored: run.mirrored,
        paused,
        // tooling only: lets a headless check confirm the pause menu really
        // freezes the music rather than just the simulation
        audioState: audio.state,
        // tooling only: camera bottom edge + the partner's y, so a headless
        // check can prove the dual camera is static and centred instead of
        // eyeballing screenshots
        camY,
        dualY: sim.dual?.player.y ?? null,
        // tooling only: practice mode and the checkpoint stack, so a headless
        // check can prove a death rewound to a diamond instead of to x=0
        practice,
        checkpoints: checkpoints.list.map((c) => ({ x: c.x, y: c.y, manual: c.manual })),
        autoCheckpoints: checkpoints.auto,
        completed,
        saved: save.levelStats(levelNum),
        // tooling only: how much of the level the object table could not place,
        // which is the M8 audit's main signal. `skipped` is the raw total and
        // reads far worse than reality — most of it is triggers and editor-only
        // ids the real game does not draw either. `skippedArt` is the number
        // that means something: objects that should have been on screen.
        skipped: scene.skipped,
        skippedArt: scene.skippedArt,
        skippedInvisible: scene.skippedInvisible,
        unknownIds: [...scene.unknownIds],
        objects: scene.level.objects.length,
        particles: (pfx1?.emitters().reduce((n, e) => n + e.count, 0) ?? 0)
          + oneShots.live.reduce((n, o) => n + o.e.count, 0)
          + [...objFx.values()].reduce((n, e) => n + e.count, 0),
        emitters: { objects: objFx.size, oneShots: oneShots.live.length,
          streak: pfx1?.streak.count ?? 0, wave: pfx1?.wave.count ?? 0 },
        // tooling only: the live camera shake and the trigger driving it, so a
        // headless check can prove trigger 1520 actually moves the camera
        // rather than only passing its unit test
        shake: shake.strength,
        shakeOffset: { x: shake.x, y: shake.y },
        triggerShake: sim.triggers?.rt.shake.remaining ?? 0,
      };
    },
    /** tooling only: drive the pause menu without synthesising key events */
    setPractice: (on: boolean) => {
      if (practice === on) return;
      bankProgress();
      best = 0;
      practice = on;
      reset();
    },
    placeCheckpoint: () => checkpoints.place(sim, camY, true),
    removeCheckpoint: () => checkpoints.remove(),
    kill: () => { sim.dead = true; },
    jump: () => { holding = true; simPress(sim, world); },
    endJump: () => { holding = false; },
    /**
     * Advance exactly one 60 Hz input tick (used with `?manual=1` to replay a
     * recorded run deterministically). `held` is the input state for the tick;
     * a false->true transition counts as a fresh press, as a real tap would.
     */
    stepTick: (held: boolean) => {
      // the same gate `press` has: nothing reaches a locked player
      if (held && !holding && !sim.ended) simPress(sim, world);
      holding = held;
      for (let i = 0; i < 4 && !sim.dead; i++) {
        simStep(sim, world, STEP, holding, warnDual);
        if (!sim.ended) runSteps++;
      }
      if (progX(player.x) > best) best = progX(player.x);
      return !sim.dead;
    },
    setMode: (mode: Gamemode) => setGamemode(player, mode),
    /**
     * Tooling only (`scripts/port-at.mjs`): walk a real run's recorded path,
     * one 240 Hz step per frame, placing player 1 on the recorded position
     * before each step — the same thing the gd-ui-capture mod does inside the
     * game. Triggers, pulses and speed portals then run on the real clock, so
     * a capture matches the native frame at the same x. Flat `[x, y, held]`
     * triples in port space; deaths are ignored.
     */
    followTrace: (flat: number[]) => {
      for (let i = 0; i + 2 < flat.length; i += 3) {
        const held = flat[i + 2] !== 0;
        if (held && !holding) simPress(sim, world);
        holding = held;
        const ny = flat[i + 1];
        player.yVel = (ny - player.y) / STEP;
        player.x = flat[i];
        player.y = ny;
        sim.dead = false;
        simStep(sim, world, STEP, holding, warnDual);
        // The game moves its camera every step, and the cube deadzone depends
        // on where the camera already is — so ease it here too, with the render
        // loop's own rule, or a capture lands with the camera wherever it
        // started (Geometrical Dominator 50% was 100 units off that way).
        const { viewH: vh } = resolveView(renderer.canvas.width, renderer.canvas.height);
        const partner = sim.dual?.player;
        const target = partner
          ? dualCameraBottom((player.cameraYCenter + partner.cameraYCenter) / 2, vh)
          : cameraBottomTarget(player.mode, player.y, player.gravityFlipped,
            player.cameraYCenter, camY, vh, player.freeMode);
        camY += (target - camY) * Math.min(1, STEP * 6);
      }
      sim.dead = false;
      best = player.x;
      // camY: the view's bottom edge in game units (native `m_cameraPosition.y`)
      return { x: player.x, y: player.y, mode: player.mode, camY: camY + GD_Y_OFFSET };
    },
  };
}
