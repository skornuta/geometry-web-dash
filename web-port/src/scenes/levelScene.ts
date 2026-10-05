// Loads a level into everything needed to draw it: the flattened sprite list,
// the background/ground textures, and the resolved channel colours.
// Shared by the static viewer (levelView) and gameplay (playLevel).
import { Renderer, type BlendMode } from "../engine/renderer.ts";
import { loadAtlas, loadImage, createTexture, type SpriteFrame } from "../engine/atlas.ts";
import {
  decodeLevelString, type Level, type LevelObject, type ColorChannel,
} from "../gd/level.ts";
import {
  OBJECT_DEFS, EDITOR_ONLY_IDS, INVISIBLE_GAMEPLAY_BLOCKS, type ChildDef, type ColorSlot, type SheetName,
} from "../gd/objects.ts";
import { SHEET_FILES, HD } from "../gd/sheets.ts";
import { P, propInt, propFloat, propBool, propText } from "../gd/props.ts";
import { LoadedFont } from "../engine/bmfont.ts";
import { transformColor } from "../gd/color.ts";
import {
  CUSTOM_GLOW_HSV, INVISIBLE_IDS, TINTED_GLOW_IDS, GLOW_OFF_KEYS, glowFrameFor,
} from "../gd/glow.ts";
import { invisibleFade } from "../gd/invisible.ts";
import { AUDIO_SCALE, KEY_NO_AUDIO_SCALE, audioScaleFactor } from "../gd/audioPulse.ts";
import { CCEmitter } from "../engine/ccparticles.ts";
import { portalBackId } from "../gd/portalBacks.ts";
import { BEASTS } from "../gd/beasts.ts";
import {
  CUSTOM_PARTICLE_ID, KEY_ANIMATE_ON_TRIGGER, KEY_PARTICLE_DATA, KEY_QUICK_START, KEY_UNIFORM_OBJECT_COLOR, KEY_USE_OBJECT_COLOR,
  customParticleConfig, type ParticleStruct,
} from "../gd/customParticles.ts";
import { DEFAULT_CAMERA_Y_CENTER, GD_Y_OFFSET } from "../gd/camera.ts";
import { easedValue } from "../gd/easing.ts";
import { CHILD_OFFSETS, MAIN_SPRITE_FIX } from "../gd/nativeGeometry.ts";
import {
  activeEnterEffects, edgeFade, enterTransform, enterTriggers, NO_ENTER_CODE, CUSTOM_ENTER_CODE, EDGE_FADE_WHEN_BLENDING_IDS, skipsEdgeFade,
  type EnterTrigger,
} from "../gd/enterEffect.ts";
import {
  buildTriggers, groupState, isTrigger, itemCount, parseGroups, positionedGroups, type TriggerRuntime,
  resolveColor as channelColor, applyGroupPulses, groupAnchor } from "../gd/triggers.ts";
import {
  animationFor, frameIndexAt, rotationFor, type AnimTiming,
} from "../gd/objectAnim.ts";

/** hd art is 2x the world unit scale (1 block = 30 world units = 60 hd px) */
export { HD };
/** visible world height, matching the game's 320-unit design height */
export const VIEW_H = 320;
/**
 * The background's on-screen speed as a fraction of the camera's, on both
 * axes. **Read out of the shipping binary** (GD 2.2081 arm64): level setup calls
 * `GJBaseGameLayer::updateBGArtSpeed(0.1f, 0.1f)` (m1 `0xc37d8`), which stores
 * the pair at `+0x314`; `updateCameraBGArt` (m1 `0x12a788`) then shifts the
 * background by `cameraDelta * mod * zoom`. A BG Speed trigger is the only other
 * writer. (The main menu's `m_realBackgroundPosition * -0.1` is the same 0.1.)
 */
const BG_PARALLAX = 0.1;
const DEG = Math.PI / 180;

/**
 * The slope pits (366 at 45°, 367 at 30°): the game lays out a strip plus a
 * child copy of the same strip rotated onto the ramp, centred in the object's
 * box (data/native-geometry.jsonl), and the screen shows only the strip along
 * the ramp — Geometrical Dominator 25% natively has a smooth scalloped edge.
 * Drawing the unrotated main strip as well stuck black rectangles out of every
 * such slope. TO CONFIRM against an on-screen `sprites` dump in the next
 * native session (main hidden, or rotated onto the child — the same pixels).
 */
const RAMP_STRIP_ONLY: ReadonlySet<number> = new Set([366, 367]);

/** key 19 (legacy colour) → channel, as native dumps show it */
/** the x index's bucket width, world units */
const X_BUCKET = 256;
/** how far past the view an indexed sprite is still considered (enter effects slide 100) */
const X_MARGIN = 150;

const LEGACY_OBJECT_COLOR: Record<number, number> = { 1: 1005, 2: 1006, 5: 1007 };

/**
 * World position of the first background tile at or before the view's
 * bottom-left corner, for tiles `t` units square.
 *
 * The background is drawn through the world camera, so to *appear* to move at
 * BG_PARALLAX of the camera's speed its tiling has to follow the camera by the
 * rest. (It used to be anchored at `-camX * 0.2` — moving the other way — which
 * scrolled it at 1.2x the level, faster than the blocks, and left it fixed in
 * the world vertically.) The y anchor is the default camera centre, so the
 * tiling there is exactly what it always was.
 */
export function bgTileStart(
  camX: number, camY: number, left: number, bottom: number, t: number,
): { x0: number; y0: number } {
  const originX = camX * (1 - BG_PARALLAX);
  const originY = (camY - DEFAULT_CAMERA_Y_CENTER) * (1 - BG_PARALLAX);
  return {
    x0: left - (((left - originX) % t) + t) % t,
    y0: bottom - (((bottom - originY) % t) + t) % t,
  };
}

/**
 * The far end of a teleport pair — the orange portal (749's art). The pair
 * is blue → orange: `PlayLayer::addObject` gives 747 the back `portal_15` and
 * 749 `portal_16`, the sheet's blue and orange teleports, and a 2.2
 * playthrough (YouTube g3_XUbK-PP0, Deadlocked 58%) shows a blue entrance
 * with orange exits. The port had OpenGD's yellow 18 / green 19.
 */
const TELEPORT_EXIT_FRAME = "portal_16_front_001.png";

/**
 * The text object. Both id->texture sources give it only an editor icon
 * (OpenGD's LongData.cpp: `edit_eStartPosBtn_001`), because its art is not a
 * sprite at all — it draws the base64 string in key 31 with the level font.
 * Levels 19-22 carry 35 of them ("Go!", "Hold", ...), and before this they were
 * the last ids the audit reported as missing art.
 */
const TEXT_OBJECT_ID = 914;

/**
 * The item-counter label (`LabelGameObject`, m1 `0x178db4`). It prints the live
 * value of the item named by key 80, so unlike a text object it cannot be baked
 * into `items` — the digits are laid out every frame in `drawCounters`.
 * Fingerdash has the only one in the 22 levels; its nine instant-count triggers
 * pulse and move it as the small coins are picked up.
 */
const COUNTER_OBJECT_ID = 1615;

/**
 * World units per bigFont pixel at the object's scale 1.
 *
 * Not sourced from the binary. Picked so a capital letter stands one 30-unit
 * block tall, which is what the in-game text measures against the blocks it sits
 * beside in Clubstep and Deadlocked. Adjust here if it ever reads too large.
 */
const TEXT_SCALE = HD;

type Sheet = Awaited<ReturnType<typeof loadAtlas>>;

interface Tex {
  tex: WebGLTexture;
  texW: number;
  texH: number;
  frame: SpriteFrame;
}

/** one sprite, fully resolved to world space at load time */
interface DrawItem {
  tex: WebGLTexture;
  texW: number;
  texH: number;
  frame: SpriteFrame;
  x: number; y: number; w: number; h: number;
  rot: number;
  r: number; g: number; b: number; a: number;
  blend: BlendMode;
  flipX: boolean; flipY: boolean;
  cull: number;
  /** colour channel that produced r/g/b (M5 re-resolves it per frame), or -1 */
  ch: number;
  /** drawn from the object's detail slot; a pulse's main-only/detail-only reads it */
  detail: boolean;
  /** the object's own sprite, as opposed to a child or its glow (tooling reads it) */
  main?: boolean;
  /**
   * The sprite that decides which of its z layer's two batches this one draws
   * in: the **object's own main sprite**, set by `assignPassChannels`. Native
   * sorts whole objects into the per-layer blending and normal
   * `CCSpriteBatchNode`s, and every object in the Dash x=9500 `objects` dump
   * reports the default `ONE, ONE_MINUS_SRC_ALPHA` sprite blend — the additive
   * state lives on the batch, so a child cannot pick a different one from its
   * parent. Undefined means "this sprite's own colour decides".
   */
  passOwner?: DrawItem;
  /** group ids for trigger move/alpha/toggle; empty for almost everything */
  groups: number[];
  /**
   * Index into `level.objects`, matching `Collider.index`. Lets the scene hide
   * a breakable block the player has smashed — collision drops it from
   * `SimState.destroyed`, and without this it would carry on being drawn.
   */
  obj: number;
  /**
   * The "already collected" art for a secret coin — the game swaps a coin you
   * have picked up before for a white outline on every later attempt. Only set
   * for coin sprites that have a `_b_` counterpart in the atlas.
   */
  outline?: SpriteFrame;
  /**
   * An object's glow (`gd/glow.ts`): `white`, or `bg` for the few ids whose
   * glow `PlayLayer::updateVisibility` tints from the background channel. Pulses leave glows alone —
   * they recolour the object's channel sprites, and a glow is not one.
   */
  glow?: "white" | "bg";
  /**
   * Continuous rotation (`gd/objectAnim.ts`): signed degrees per second, CW
   * positive like the game's own `m_rotationDelta`. Zero for everything that
   * does not spin, which is all but 2,438 of the 175,138 objects.
   */
  spin: number;
  /** the object's centre — children orbit it, they do not spin in place */
  spinCX: number; spinCY: number;
  /** frame animation: the resolved 1-based frame list, shared per art name */
  animFrames?: SpriteFrame[];
  /** this object's own timing into `animFrames` */
  animT?: AnimTiming;
  /**
   * Animated sprites only. The frames of one animation differ in trimmed size
   * and offset (the secret coin's 80x80 narrows to 20x80 edge-on), so w/h and
   * the frame offset cannot stay baked. These are the position *before* the
   * frame offset and the world units per atlas pixel, so the draw loop can lay
   * the current frame out the way `emit` laid out the first one.
   */
  animBaseX?: number; animBaseY?: number; animKX?: number; animKY?: number;
  /** a GJBeast part: re-posed every frame from its animation (`beastPose`) */
  beast?: {
    anim: import("../gd/beasts.ts").BeastAnim; part: string; glow: boolean;
    objX: number; objY: number; rot: number; scale: number; fx: number; fy: number;
  };
  /**
   * Key **123** (`m_animateOnTrigger`): the object holds its first frame until
   * an animate trigger (1585) fires for one of its groups, and then runs from
   * that instant. 15 objects in Deadlocked, none anywhere else.
   */
  animWait?: boolean;
  /**
   * One of the four invisible objects (144, 145, 205, 459). Their opacity and
   * colour are recomputed every frame from where they are on screen — see
   * `gd/invisible.ts`. The value is the object's half-width, which the
   * original's edge fade subtracts.
   */
  invisibleHW?: number;
}

/** one item-counter label (1615); its digits are laid out at draw time */
interface CounterLabel {
  /** key 80 — which item's count to print */
  item: number;
  x: number; y: number;
  /** world units per font pixel */
  scale: number;
  rot: number;
  col: Rgba;
  groups: number[];
  obj: number;
}

interface Rgba {
  r: number; g: number; b: number; a: number; blend: BlendMode; ch: number;
  /** came from the object's *detail* slot — a pulse's key 65/66 select on this */
  detail?: boolean;
}

const WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1, blend: "normal", ch: -1 };
/** `createGlow`'s sprite: white, opacity 255, in an additive batch */
const GLOW_WHITE: Rgba = { r: 1, g: 1, b: 1, a: 1, blend: "additive", ch: -1 };

function toRgba(c: ColorChannel, ch: number): Rgba {
  return {
    r: c.r / 255, g: c.g / 255, b: c.b / 255,
    a: c.opacity, blend: c.blending ? "additive" : "normal", ch,
  };
}

async function loadLooseTexture(renderer: Renderer, url: string): Promise<Tex> {
  const img = await loadImage(url);
  return {
    tex: createTexture(renderer.ctx, img),
    texW: img.width, texH: img.height,
    frame: {
      x: 0, y: 0, w: img.width, h: img.height, rotated: false,
      offsetX: 0, offsetY: 0, sourceW: img.width, sourceH: img.height,
    },
  };
}

/** numeric header value, e.g. kA13 song offset in seconds */
export function headerFloat(level: Level, key: string, def = 0): number {
  const kv = level.rawHeader.split(",");
  const i = kv.indexOf(key);
  if (i < 0 || i + 1 >= kv.length) return def;
  const n = parseFloat(kv[i + 1]);
  return Number.isFinite(n) ? n : def;
}

export class LevelScene {
  level!: Level;
  /**
   * Tooling only: when set, `drawObjects` appends every sprite it draws (with
   * its final colour and opacity), for diffing against the game's own
   * `objects` dump (`scripts/port-at.mjs`).
   */
  captureDraws?: {
    obj: number; id: number; main: boolean; detail: boolean; glow: string;
    x: number; y: number; w: number; h: number;
    r: number; g: number; b: number; a: number; blend: string; ch: number;
  }[];
  /** set while the object's own sprite is being emitted (see DrawItem.main) */
  private curMain = false;
  /** the level's enter-effect triggers, in x order (built on first draw) */
  private enterTrigs?: EnterTrigger[];
  maxX = 0;
  items: DrawItem[] = [];
  /** where each z-layer run of `items` starts (glows first), for gradients */
  private layerStarts: { z: number; index: number }[] = [];
  /**
   * Per z-layer run, where its sprites are: sprites no trigger can move
   * (`positionedGroups`) are bucketed by x (`X_BUCKET` units, over their whole cull reach — a spinning
   * one over its orbit), the rest (any group) are checked every frame. Dash
   * walked every one of its sprites each frame — 11 ms of a 120 fps frame's
   * 8.3 ms (USER-07).
   */
  private xIndex: { buckets: Map<number, number[]>; dynamic: number[] }[] | null = null;
  private seenStamp: Int32Array | null = null;
  private stampNo = 0;
  /** level objects by group id, for gradient edge objects (built lazily) */
  private groupObjects: Map<number, number[]> | null = null;
  /** a white texel for untextured quads (gradients) */
  private whiteTex: WebGLTexture | null = null;
  /** source object index for whatever is being emitted right now */
  private curObj = -1;
  /** objects the player has destroyed this attempt (breakable blocks) */
  destroyed?: Set<number>;
  /**
   * Object indices of secret coins already collected **in a previous session**
   * (from the save). Those draw as white outlines, as the game does. Coins
   * picked up during the current attempt keep their gold art until the level is
   * restarted, again matching the original.
   */
  collectedCoins?: Set<number>;
  skipped = 0;
  /**
   * Of `skipped`, the objects that are *supposed* to be invisible: triggers and
   * editor-only ids, which the real game does not draw either. Counting these
   * as "unplaced" made the M8 audit read 9.75% missing when nearly all of it is
   * working as intended — see `skippedArt` for the number that matters.
   */
  skippedInvisible = 0;
  /**
   * Of `skipped`, the objects that should have been drawn and were not: a real
   * hole in the object table. This is the audit's actionable figure.
   */
  skippedArt = 0;
  unknownIds = new Set<number>();
  /** item-counter labels (1615), drawn live rather than baked — see `drawCounters` */
  private counters: CounterLabel[] = [];
  private sheets = new Map<SheetName, Sheet>();
  /** the level font, loaded only when the level contains a text object */
  private font: LoadedFont | null = null;
  private bgTex!: Tex;
  /** every background this level can switch to (Change BG, 3029), loaded up front */
  private bgTexes = new Map<number, Tex>();
  /** player 1's y, for effects centred on the player (area tint's special target −1) */
  playerY = 0;
  /** the middle ground's two layers (`fg_NN_001`, `fg_NN_2_001`), when the level has one (kA25) */
  private mgTex: [Tex, Tex | null] | null = null;
  private groundTex!: Tex;
  /** the ground's second layer (`groundSquare_NN_2_001`, channel 1009), for the grounds that have one */
  private ground2Tex: Tex | null = null;
  private bg: Rgba = WHITE;
  private ground: Rgba = WHITE;
  private lineCol: Rgba = WHITE;
  private lineSheet: Sheet | undefined;
  private lineFrame: SpriteFrame | null = null;
  private renderer!: Renderer;
  /** M5: when set, channel colours and group transforms come from here */
  private rt?: TriggerRuntime;

  /** point the scene at the live trigger state (gameplay); omit for the viewer */
  setTriggerRuntime(rt: TriggerRuntime | undefined) {
    this.rt = rt;
  }

  /**
   * Current colour of a channel: the trigger runtime's value if triggers are
   * running, else the level header's. Returns null when the channel is unset so
   * callers keep their baked fallback.
   */
  private liveRgba(ch: number, fallback: Rgba): Rgba {
    if (ch < 0) return fallback;
    // 1007 (LBG) is always derived, whether or not a trigger ever touched it
    // (1007 is derived and 1005/1006 are the player's colours — always live)
    if (!this.rt || (!this.rt.colors.has(ch) && ch !== 1007 && ch !== 1005 && ch !== 1006)) return fallback;
    // resolveColor, not a raw lookup: a channel may copy another one, and the
    // source is still being animated by its own triggers
    const c = channelColor(this.rt, ch);
    return {
      r: c.r / 255, g: c.g / 255, b: c.b / 255, a: c.opacity,
      blend: c.blending ? "additive" : "normal", ch,
    };
  }

  /** whether an object's main sprite draws in the blending layer (`[0x458]`) */
  private mainBlending(o: LevelObject): boolean {
    if (!EDGE_FADE_WHEN_BLENDING_IDS.has(o.id)) return false;
    const ch = propInt(o.props, P.MAIN_COLOR, OBJECT_DEFS.get(o.id)?.primaryCh ?? 1004);
    const c = this.liveRgba(ch, this.channelRgba(ch) ?? WHITE);
    return c.blend === "additive";
  }

  private channelRgba(ch: number): Rgba | null {
    if (ch < 0) return null;
    const c = this.level.colors.get(ch);
    return c ? toRgba(c, ch) : null;
  }

  /**
   * A sprite's colour **bound to its channel**, even when the header never
   * sets that channel. `GJEffectManager::activeColorForIndex` (m1 0x278138)
   * answers 1010 with black and every other channel from the live colour
   * table, whose entries start white — so a channel a level only sets by
   * trigger, or never sets at all, is white until something colours it. The
   * object table's baked tints (OpenGD's cyan/yellow editor colours) are never
   * what the game shows for a channel-coloured sprite: they were the cyan gear
   * rings and portal arrows of Electroman, Electrodynamix and Hexagon Force.
   * Channel 0 means "the object's default" and resolves to nothing here.
   */
  private boundChannel(ch: number): Rgba | null {
    if (ch <= 0) return null;
    if (ch === 1010) return this.channelRgba(ch) ?? { r: 0, g: 0, b: 0, a: 1, blend: "normal", ch };
    return this.channelRgba(ch) ?? { ...WHITE, ch };
  }

  /**
   * `base` uses property 21, `detail` property 22, each falling back to the
   * object's default channel; `black` is the level's black channel (or literal
   * black); `none` leaves the art untinted. `baked` is the editor-default tint
   * from the object table, used when no channel resolves.
   */
  private resolveColor(
    props: Map<number, string>, slot: ColorSlot,
    primaryCh: number, secondaryCh: number, baked?: { r: number; g: number; b: number },
  ): Rgba {
    // The pre-2.0 colour key 19 picks a channel for objects that set neither
    // 21 nor 22: on the detail colour when the object has one, else the main.
    // Native dumps (ToE 2, Geometrical Dominator…): 1 → P1 1005, 2 → P2 1006,
    // 5 → LBG 1007 (the only values the captures show).
    const legacy = LEGACY_OBJECT_COLOR[propInt(props, 19, 0)];
    if (legacy !== undefined && !props.has(P.MAIN_COLOR) && !props.has(P.SECONDARY_COLOR)) {
      if (secondaryCh >= 0) secondaryCh = legacy; else primaryCh = legacy;
    }
    const fallback: Rgba = baked
      ? { r: baked.r / 255, g: baked.g / 255, b: baked.b / 255, a: 1, blend: "normal" as BlendMode, ch: -1 }
      : WHITE;
    switch (slot) {
      case "black":
        return this.channelRgba(1010) ?? { r: 0, g: 0, b: 0, a: 1, blend: "normal", ch: 1010 };
      case "base":
        return this.boundChannel(propInt(props, P.MAIN_COLOR, primaryCh)) ?? fallback;
      case "detail": {
        // A single-colour object whose one colour is detail-typed still keeps
        // it in key 21, the editor's "Main": Deadlocked's acid (1052/1228,
        // 21=71) is green natively and was drawn in its default 1007 here.
        const ch = secondaryCh >= 0
          ? propInt(props, P.SECONDARY_COLOR, secondaryCh)
          : propInt(props, P.MAIN_COLOR, propInt(props, P.SECONDARY_COLOR, primaryCh));
        const c = this.boundChannel(ch) ?? fallback;
        return { ...c, detail: true };
      }
      default:
        return fallback;
    }
  }

  /** untrimmed world size of an object's main frame, for collision boxes */
  frameSize(id: number): { w: number; h: number } | null {
    const def = OBJECT_DEFS.get(id);
    if (!def) return null;
    const f = this.sheets.get(def.sheet)?.atlas.get(def.frame);
    return f ? { w: f.sourceW * HD, h: f.sourceH * HD } : null;
  }

  static async load(renderer: Renderer, levelNum: number, customData?: string): Promise<LevelScene> {
    const s = new LevelScene();
    s.renderer = renderer;
    // a custom level (.gmd, `?custom=1`) brings its own encoded string
    const text: string = customData !== undefined ? customData
      : await fetch(`/assets/levels/${levelNum}.txt`).then((r) => {
        if (!r.ok) throw new Error(`level ${levelNum} not found (${r.status})`);
        return r.text();
      });
    s.level = await decodeLevelString(text);

    // only load the atlases this level actually references
    const needed = new Set<SheetName>();
    const collect = (kids: ChildDef[] | undefined) => {
      for (const c of kids ?? []) { needed.add(c.sheet); collect(c.children); }
    };
    for (const o of s.level.objects) {
      const def = OBJECT_DEFS.get(o.id);
      if (def) { needed.add(def.sheet); collect(def.children); }
      if (glowFrameFor(o.id)) needed.add("glow");
    }
    needed.add("icons"); // the player sprite
    if (s.level.objects.some((o) => o.id === CUSTOM_PARTICLE_ID)) needed.add("particle");

    const bgId = s.level.bgStyle || 1;
    const groundId = s.level.groundStyle || 1;
    const pad2 = (n: number) => String(n).padStart(2, "0");

    const names = [...needed];
    // The text object (914) draws with the game's own bigFont, the same one the
    // HUD uses. Only loaded when the level actually has one — 18 of the 22 do
    // not. `kA18` selects the font in 2.2, but every classic level leaves it 0.
    const wantsFont = s.level.objects.some(
      (o) => o.id === TEXT_OBJECT_ID || o.id === COUNTER_OBJECT_ID);
    const [loaded, bgTex, groundTex, font] = await Promise.all([
      Promise.all(names.map((n) =>
        loadAtlas(renderer, `/assets/${SHEET_FILES[n]}.plist`, `/assets/${SHEET_FILES[n]}.png`))),
      loadLooseTexture(renderer, `/assets/game_bg_${pad2(bgId)}_001-hd.png`),
      loadLooseTexture(renderer, `/assets/groundSquare_${pad2(groundId)}_001-hd.png`),
      wantsFont
        ? LoadedFont.load(renderer, "/assets/bigFont-hd.fnt", "/assets/bigFont-hd.png")
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    s.font = font;
    names.forEach((n, i) => s.sheets.set(n, loaded[i]));
    s.bgTex = bgTex;
    s.bgTexes.set(bgId, bgTex);
    s.ground2Tex = await loadLooseTexture(renderer, `/assets/groundSquare_${pad2(groundId)}_2_001-hd.png`)
      .catch(() => null);
    if (s.level.mgStyle > 0) {
      const n = pad2(s.level.mgStyle);
      try {
        const [a, b] = await Promise.all([
          loadLooseTexture(renderer, `/assets/fg_${n}_001-hd.png`),
          loadLooseTexture(renderer, `/assets/fg_${n}_2_001-hd.png`).catch(() => null),
        ]);
        s.mgTex = [a, b];
      } catch { /* no art: no middle ground */ }
    }
    // the backgrounds a Change BG trigger (3029, key 533) swaps in, loaded now
    // so the swap is not a frame of nothing
    const swaps = new Set(s.level.objects.filter((o) => o.id === 3029)
      .map((o) => propInt(o.props, 533, 0)).filter((n) => n > 0 && n !== bgId));
    await Promise.all([...swaps].map(async (n) => {
      try { s.bgTexes.set(n, await loadLooseTexture(renderer, `/assets/game_bg_${pad2(n)}_001-hd.png`)); }
      catch { /* missing art: keep the level's own */ }
    }));
    s.groundTex = groundTex;

    s.bg = s.channelRgba(1000) ?? WHITE;
    s.ground = s.channelRgba(1001) ?? WHITE;
    s.lineCol = s.channelRgba(1002) ?? WHITE;
    s.lineSheet = s.sheets.get("game02");
    s.lineFrame = s.lineSheet?.atlas.get("floorLine_01_001.png") ?? null;

    s.build();
    return s;
  }

  sheet(name: SheetName): Sheet | undefined {
    return this.sheets.get(name);
  }

  /** spin/animation for the object being emitted right now (see `emitObject`) */
  /**
   * The object's 2.2 per-axis scale (keys 128/129) relative to its uniform
   * key-32 scale, applied in the object's own frame to every sprite it emits.
   * Dash's pixel art is scaled this way (e.g. 128 = 129 = 3.592); drawing it
   * at the uniform scale left most of it tiny.
   */
  /**
   * The music pulse (`FMODAudioEngine`'s `m_pulse1`) the audio-scale objects
   * beat with this frame — set by the play loop; `null` draws them unscaled
   * (menus, previews). See `gd/audioPulse.ts`.
   */
  audioPulse: number | null = null;
  /** level object index -> its audio-scale range (null: the plain pulse) and whether it is a ring (orb) */
  private audioObjs = new Map<number, { range: readonly [number, number] | null; ring: boolean }>();
  /**
   * The custom particle objects (2065), one `CCParticleSystemQuad` each while
   * their object is in view — see `gd/customParticles.ts` and `stepParticles`.
   */
  private particles: CustomParticle[] = [];
  private curSX = 1;
  private curSY = 1;
  private curSpin = 0;
  private curAnim: AnimTiming | null = null;
  private curAnimWait = false;
  private curInvisibleHW: number | undefined;
  /** `sheet|base|frames` -> the resolved frame list, shared by every instance */
  private animLists = new Map<string, SpriteFrame[] | null>();
  /**
   * The `<base>_001.png` .. `<base>_<n>.png` run for one sprite, or undefined
   * when this art is not animated (a child that is not part of the animation,
   * such as id 1050's static `_base` sprite).
   *
   * A name the atlas does not have holds the previous frame — see A24.
   */
  private animFrameList(
    sheetName: SheetName, sheet: Sheet, frameName: string, frames: number,
  ): SpriteFrame[] | undefined {
    const m = /^(.*)_(\d+)\.png$/.exec(frameName);
    if (!m) return undefined;
    const base = m[1], pad = m[2].length;
    const key = `${sheetName}|${base}|${frames}`;
    const hit = this.animLists.get(key);
    if (hit !== undefined) return hit ?? undefined;
    const out: SpriteFrame[] = [];
    let last: SpriteFrame | null = null;
    let found = 0;
    for (let i = 1; i <= frames; i++) {
      const f = sheet.atlas.get(`${base}_${String(i).padStart(pad, "0")}.png`);
      if (f) { last = f; found++; }
      out.push((last ?? sheet.atlas.get(frameName))!);
    }
    // fill the leading holes with the first frame that did resolve
    for (let i = 0; i < out.length && !out[i]; i++) out[i] = out.find((x) => !!x)!;
    const list = found > 1 ? out : null;
    this.animLists.set(key, list);
    return list ?? undefined;
  }

  /** see `curSX` */
  private setAxisScale(o: LevelObject, scale: number) {
    const k = scale === 0 ? 1 : scale;
    this.curSX = o.props.has(128) ? propFloat(o.props, 128, 1) / k : 1;
    this.curSY = o.props.has(129) ? propFloat(o.props, 129, 1) / k : 1;
  }

  private emit(
    sheetName: SheetName, frameName: string, ox: number, oy: number,
    objX: number, objY: number, objRotCCW: number, scale: number,
    fx: number, fy: number, spriteRotCCW: number,
    flipX: boolean, flipY: boolean, col: Rgba, scaleX: number, scaleY: number,
    groups: number[] = [],
  ) {
    const sheet = this.sheets.get(sheetName);
    const frame = sheet?.atlas.get(frameName);
    if (!sheet || !frame) return;

    const lx = ox * fx * scale * this.curSX, ly = oy * fy * scale * this.curSY;
    const cos = Math.cos(objRotCCW), sin = Math.sin(objRotCCW);
    let x = objX + lx * cos - ly * sin;
    let y = objY + lx * sin + ly * cos;

    const kx = HD * scale * scaleX * this.curSX, ky = HD * scale * scaleY * this.curSY;
    const w = frame.w * kx;
    const h = frame.h * ky;
    const baseX = x, baseY = y;
    const tox = frame.offsetX * kx * (flipX ? -1 : 1);
    const toy = frame.offsetY * ky * (flipY ? -1 : 1);
    const sc = Math.cos(spriteRotCCW), ss = Math.sin(spriteRotCCW);
    x += tox * sc - toy * ss;
    y += tox * ss + toy * sc;

    // `secretCoin_01_001` -> `secretCoin_b_01_001`: the outline the game shows
    // once you have already collected that coin. Looked up here, at build time,
    // so the draw loop stays a straight swap.
    const outline = frameName.startsWith("secretCoin_")
      ? sheet.atlas.get(frameName.replace(/^secretCoin_/, "secretCoin_b_"))
      : undefined;

    const animFrames = this.curAnim
      ? this.animFrameList(sheetName, sheet, frameName, this.curAnim.frames)
      : undefined;
    this.items.push({
      tex: sheet.tex, texW: sheet.texW, texH: sheet.texH, frame,
      x, y, w, h, rot: spriteRotCCW,
      r: col.r, g: col.g, b: col.b, a: col.a, blend: col.blend,
      flipX, flipY,
      cull: Math.max(Math.abs(w), Math.abs(h)) * 0.75 + 30,
      ch: col.ch, detail: col.detail === true, main: this.curMain || undefined,
      groups, obj: this.curObj, outline,
      spin: this.curSpin, spinCX: objX, spinCY: objY,
      invisibleHW: this.curInvisibleHW,
      animFrames, animT: animFrames ? this.curAnim! : undefined,
      animWait: animFrames && this.curAnimWait ? true : undefined,
      animBaseX: animFrames ? baseX : undefined,
      animBaseY: animFrames ? baseY : undefined,
      animKX: animFrames ? kx : undefined,
      animKY: animFrames ? ky : undefined,
    });
  }

  /**
   * Emit one `DrawItem` per glyph of a text object (id 914).
   *
   * Glyphs go through the ordinary item list rather than a separate text pass so
   * they inherit everything sprites already get: z-ordering against the level
   * art, camera culling, colour-channel tinting, and group move/alpha/toggle.
   * The whole string shares one `obj` index and one group list, so a move
   * trigger slides the words as a unit.
   *
   * Returns false if the font failed to load, so the caller can still count the
   * object as missing art rather than silently dropping it.
   */
  private emitText(o: LevelObject, index: number): boolean {
    const font = this.font;
    if (!font) return false;
    const s = propText(o.props, P.TEXT);
    if (!s) return true; // an empty text object is legitimately invisible

    /*
     * Draw only text that actually decoded.
     *
     * Level 20 spells "I Like This Part:)" one text object per letter, and among
     * them at x=20001 sits a leftover whose key 31 is the raw plaintext
     * "ILikeThisPar". That happens to be syntactically valid base64, so a strict
     * decode does not fail — it yields 9 bytes of garbage, and rendering those
     * put a visible "Y8B" on screen underneath the caption. A string that did
     * not decode as text is not text, so it draws nothing.
     *
     * UNVERIFIED against the real game: whether the original shows garbage here
     * too has not been checked (it would need a capture of Clutterfunk at
     * x=20001). If it turns out RobTop's loader accepts plaintext key 31, the
     * fix is to fall back to the raw value here rather than to drop it.
     */
    if (s.includes("�")) return true;

    const sheet = { texW: font.font.scaleW, texH: font.font.scaleH };
    const scale = propFloat(o.props, P.SCALE, 1) * TEXT_SCALE;
    const rot = -propFloat(o.props, P.ROTATION, 0) * DEG;
    const col = this.resolveColor(o.props, "base", propInt(o.props, P.MAIN_COLOR, 1004), -1);
    const groups = parseGroups(o);
    const cos = Math.cos(rot), sin = Math.sin(rot);

    // the game centres a text object on its position, both axes
    const width = font.measure(s) * scale;
    const lineH = font.font.lineHeight * scale;
    let penX = -width / 2;
    const baseY = -lineH / 2;
    let prev = -1;

    for (const ch of s) {
      const id = ch.codePointAt(0)!;
      const gl = font.font.glyphs.get(id);
      if (!gl) { prev = id; continue; }
      if (prev >= 0) penX += (font.font.kernings.get(`${prev},${id}`) ?? 0) * scale;
      if (gl.w > 0 && gl.h > 0) {
        const w = gl.w * scale, h = gl.h * scale;
        // glyph centre in the text's own unrotated frame, then rotated onto it
        const lx = penX + gl.xoffset * scale + w / 2;
        const ly = baseY + (font.font.base - gl.yoffset - gl.h) * scale + h / 2;
        this.items.push({
          tex: font.tex, texW: sheet.texW, texH: sheet.texH,
          frame: {
            x: gl.x, y: gl.y, w: gl.w, h: gl.h,
            rotated: false, offsetX: 0, offsetY: 0, sourceW: gl.w, sourceH: gl.h,
          },
          x: o.x + lx * cos - ly * sin,
          y: o.y + lx * sin + ly * cos,
          w, h, rot,
          r: col.r, g: col.g, b: col.b, a: col.a, blend: col.blend,
          flipX: false, flipY: false,
          cull: Math.max(w, h) * 0.75 + 30,
          ch: col.ch, detail: col.detail === true, groups, obj: index,
          spin: 0, spinCX: o.x, spinCY: o.y,
        });
      }
      penX += gl.xadvance * scale;
      prev = id;
    }
    return true;
  }

  private emitChildren(
    kids: ChildDef[] | undefined, props: Map<number, string>,
    primaryCh: number, secondaryCh: number,
    objX: number, objY: number, objRotCCW: number, scale: number,
    fx: number, fy: number, objFlipX: boolean, objFlipY: boolean,
    groups: number[] = [],
    nativeOffset?: ReadonlyMap<ChildDef, readonly [number, number]>,
  ) {
    for (const c of kids ?? []) {
      const mirrored = fx * fy < 0;
      const spriteRot = objRotCCW + (mirrored ? c.rot : -c.rot) * DEG;
      const col = this.resolveColor(props, c.color, primaryCh, secondaryCh, c);
      const [cdx, cdy] = nativeOffset?.get(c) ?? [c.dx, c.dy];
      this.emit(c.sheet, c.frame, cdx, cdy, objX, objY, objRotCCW, scale, fx, fy,
        spriteRot, objFlipX !== c.flipX, objFlipY !== c.flipY, col, c.scaleX, c.scaleY, groups);
      this.emitChildren(c.children, props, primaryCh, secondaryCh, objX, objY, objRotCCW,
        scale, fx, fy, objFlipX !== c.flipX, objFlipY !== c.flipY, groups);
    }
  }

  private build() {
    // A z layer or z order of 0 means "the object's default":
    // `GameObject::getObjectZLayer` (m1 0x4e8278) returns `[0x464]` unless it
    // is 0, then the default `[0x45c]`; `getObjectZOrder` (m1 0x4ef420) the
    // same with `[0x468]`/`[0x418]`. Dash x 2300 (native dump 2026-09-29): its
    // lava-rock pixel art carries key 24 = 0 and sits at its default layer,
    // above the level's layer-1 blocks — read literally, it went under them.
    const layerOf = (o: LevelObject) =>
      propInt(o.props, P.Z_LAYER, 0) || (OBJECT_DEFS.get(o.id)?.zLayer ?? 1);
    const orderOf = (o: LevelObject) =>
      propInt(o.props, P.Z_ORDER, 0) || (OBJECT_DEFS.get(o.id)?.zOrder ?? 0);
    // each portal's back sprite (`gd/portalBacks.ts`): a second object of
    // its own in layer 4, z order the front's − 100, drawn as part of the
    // front's object (same index — it fades, moves and turns with it)
    const backs: { o: LevelObject; i: number }[] = [];
    this.level.objects.forEach((o, i) => {
      const id = portalBackId(o.id);
      if (id === null || propBool(o.props, GLOW_OFF_KEYS.NO_GLOW_135)) return;
      const props = new Map(o.props);
      props.delete(P.Z_LAYER);
      props.set(P.Z_ORDER, String(orderOf(o) - 100));
      backs.push({ o: { ...o, id, props }, i });
      // a teleport's exit (749's art, drawn by `emitObject`) has its own back
      const dy = o.id === 747 ? propFloat(o.props, P.TELEPORT_Y_OFFSET, 0) : 0;
      if (dy !== 0) {
        const ep = new Map(props);
        ep.set(P.FLIP_Y, propBool(o.props, P.FLIP_Y) ? "0" : "1");
        backs.push({ o: { ...o, id: portalBackId(749)!, y: o.y + dy, props: ep }, i });
      }
    });
    const ordered = this.level.objects
      .map((o, i) => ({ o, i }))
      .concat(backs)
      .sort((a, b) => {
        const la = layerOf(a.o), lb = layerOf(b.o);
        if (la !== lb) return la - lb;
        const oa = orderOf(a.o), ob = orderOf(b.o);
        if (oa !== ob) return oa - ob;
        return a.i - b.i;
      });

    // Each z layer's glow batch sits just below that layer's objects
    // (`GJBaseGameLayer::setupLayers`), so the glows of a run of same-layer
    // objects go down before the objects themselves, in the same order.
    for (let k = 0; k < ordered.length;) {
      const layer = layerOf(ordered[k].o);
      let end = k;
      while (end < ordered.length && layerOf(ordered[end].o) === layer) end++;
      this.layerStarts.push({ z: layer, index: this.items.length });
      for (let j = k; j < end; j++) this.emitGlow(ordered[j].o, ordered[j].i);
      for (let j = k; j < end; j++) this.emitObject(ordered[j].o, ordered[j].i);
      k = end;
    }
    this.assignPassChannels();
    this.collectParticles(layerOf);

    this.maxX = this.level.objects.reduce((m, o) => Math.max(m, o.x), 0);
    this.audioObjs.clear();
    this.level.objects.forEach((o, i) => {
      if (AUDIO_SCALE.has(o.id) && !propBool(o.props, KEY_NO_AUDIO_SCALE)) {
        this.audioObjs.set(i, { range: AUDIO_SCALE.get(o.id)!, ring: OBJECT_DEFS.get(o.id)?.kind === "orb" });
      }
    });
  }

  /**
   * Point every sprite of an object at the channel that decides its z layer's
   * batch, which is the object's own main sprite (`DrawItem.main`). Native puts
   * a whole `GameObject` — main sprite, colour sprite, ordinary children and
   * all — into one `CCSpriteBatchNode`, chosen by the object's blending state;
   * the children keep their own z only *within* that batch. Reading each
   * sprite's own channel instead split Dash's object 2032 (main channel 148,
   * blending, under its `gj22_anim_13_color` child on the normal channel 149)
   * across the two passes and painted the normal child over the additive one.
   * An object with no main sprite (a slope's ramp strip) falls back to its
   * first non-glow child, and glows are left alone: they are additive by
   * construction and `drawObjects` gives them the first pass.
   */
  private assignPassChannels() {
    const owner = new Map<number, { main?: DrawItem; first?: DrawItem }>();
    for (const it of this.items) {
      if (it.glow) continue;
      const e = owner.get(it.obj);
      if (!e) owner.set(it.obj, { main: it.main ? it : undefined, first: it });
      else if (it.main) e.main = it;
    }
    for (const it of this.items) {
      if (it.glow) continue;
      const e = owner.get(it.obj);
      const pick = e?.main ?? e?.first;
      if (pick && pick !== it) it.passOwner = pick;
    }
  }

  /**
   * The object's glow, if it has one and its level data leaves it on — see
   * `gd/glow.ts` for where every rule here comes from. Same position, rotation,
   * scale, flip, groups and object index as the object, so a move, alpha or
   * toggle trigger carries the glow with it.
   */
  private emitGlow(o: LevelObject, i: number) {
    const frame = glowFrameFor(o.id);
    if (!frame) return;
    if (propBool(o.props, GLOW_OFF_KEYS.DISABLE_GLOW) || propBool(o.props, GLOW_OFF_KEYS.NO_GLOW_135)) return;
    this.curObj = i;
    // a saw's glow turns with the saw; the glow art has no frame sequence
    this.curSpin = rotationFor(o, i);
    this.curAnim = null;
    this.curInvisibleHW = this.invisibleHalfWidth(o);
    const objRotCCW = -propFloat(o.props, P.ROTATION, 0) * DEG;
    const scale = propFloat(o.props, P.SCALE, 1);
    this.setAxisScale(o, scale);
    const flipX = propBool(o.props, P.FLIP_X), flipY = propBool(o.props, P.FLIP_Y);
    const before = this.items.length;
    const groups = parseGroups(o);
    this.emit("glow", frame, 0, 0, o.x, o.y, objRotCCW, scale, flipX ? -1 : 1, flipY ? -1 : 1,
      objRotCCW, flipX, flipY, GLOW_WHITE, 1, 1, groups);
    // A quarter-art object (saws, spike wheels: the main frame plus three
    // mirrored copies of it as children) has a quarter glow too, and the glow
    // is mirrored the same way — one glow per mirrored copy, or the saw glows
    // on one quadrant only (Hexagon Force 75%).
    const def = OBJECT_DEFS.get(o.id);
    for (const c of def?.children ?? []) {
      if (c.frame !== def!.frame) continue;
      const fx = flipX !== c.flipX, fy = flipY !== c.flipY;
      this.emit("glow", frame, 0, 0, o.x, o.y, objRotCCW, scale, fx ? -1 : 1, fy ? -1 : 1,
        objRotCCW, fx, fy, GLOW_WHITE, 1, 1, groups);
    }
    for (let k = before; k < this.items.length; k++) {
      this.items[k].glow = TINTED_GLOW_IDS.has(o.id) ? "bg" : "white";
    }
    this.curSpin = 0;
    this.curInvisibleHW = undefined;
    this.curSX = this.curSY = 1;
  }

  /**
   * The half-width `updateInvisibleBlock` subtracts, or undefined when the id
   * is not one of the four invisible objects. The original reads the object's
   * own `[0x34c]`; the port uses the art's, which is the same 30-unit block.
   */
  private invisibleHalfWidth(o: LevelObject): number | undefined {
    if (!INVISIBLE_IDS.has(o.id)) return undefined;
    return 15 * propFloat(o.props, P.SCALE, 1);
  }

  private emitObject(o: LevelObject, i: number) {
    // Key 135 is the editor's **Hide** (`objectFromVector` m1 0x4f1bdc →
    // `m_isHide`, +0x50e): the object is not drawn in play (it still collides)
    // — native Dash x 2300 (dump 2026-09-29): the id-1 blocks under the rock
    // art have `m_isHide` and are invisible; the port drew them over the art.
    if (propBool(o.props, GLOW_OFF_KEYS.NO_GLOW_135)) return;
    if (o.id === COUNTER_OBJECT_ID) {
      this.curObj = i;
      if (this.font) {
        this.counters.push({
          item: propInt(o.props, P.ITEM_ID, 0),
          x: o.x, y: o.y,
          scale: propFloat(o.props, P.SCALE, 1) * TEXT_SCALE,
          rot: -propFloat(o.props, P.ROTATION, 0) * DEG,
          col: this.resolveColor(o.props, "base", propInt(o.props, P.MAIN_COLOR, 1004), -1),
          groups: parseGroups(o),
          obj: i,
        });
        return;
      }
      // no font: fall through to the ordinary "invisible id" bookkeeping
    }
    if (o.id === TEXT_OBJECT_ID) {
      this.curObj = i;
      this.curSpin = 0;
      this.curAnim = null;
      if (this.emitText(o, i)) return;
      // the font failed to load: this is genuinely missing art, not an
      // invisible-on-purpose id, so it must not be filed under EDITOR_ONLY.
      this.skipped++;
      this.skippedArt++;
      if (!this.unknownIds.has(o.id)) {
        this.unknownIds.add(o.id);
        console.warn(`text object ${o.id}: level font unavailable — skipping`);
      }
      return;
    }
    // invisible on purpose: art exists, but only for the editor
    if (INVISIBLE_GAMEPLAY_BLOCKS.has(o.id)) {
      this.skipped++;
      this.skippedInvisible++;
      return;
    }
    const def = OBJECT_DEFS.get(o.id);
    if (!def) {
      this.skipped++;
      // `isTrigger` only knows the triggers the runtime implements.
      // `EDITOR_ONLY_IDS` is every id whose only art in the game is an editor
      // icon — generated from the game's own ObjectToolbox, so an unimplemented
      // trigger no longer looks like missing art. What is left in the warning
      // is a real hole.
      if (isTrigger(o.id) || EDITOR_ONLY_IDS.has(o.id)) {
        this.skippedInvisible++;
      } else {
        this.skippedArt++;
        if (!this.unknownIds.has(o.id)) {
          this.unknownIds.add(o.id);
          console.warn(`no definition for object id ${o.id} — skipping`);
        }
      }
      return;
    }
    this.curObj = i;
    this.curSpin = rotationFor(o, i);
    this.curAnim = animationFor(o, i);
    this.curAnimWait = propBool(o.props, P.ANIMATE_ON_TRIGGER);
    this.curInvisibleHW = this.invisibleHalfWidth(o);
    const objRotCCW = -propFloat(o.props, P.ROTATION, 0) * DEG;
    const scale = propFloat(o.props, P.SCALE, 1);
    this.setAxisScale(o, scale);
    const flipX = propBool(o.props, P.FLIP_X), flipY = propBool(o.props, P.FLIP_Y);
    const fx = flipX ? -1 : 1, fy = flipY ? -1 : 1;
    const col = this.resolveColor(o.props, def.color, def.primaryCh, def.secondaryCh);

    const groups = parseGroups(o);
    // Where the game itself lays these sprites out (gd/nativeGeometry.ts) —
    // measured from the running game, so it wins over the table's offsets.
    const kids = def.children ?? [];
    const nativeKids = CHILD_OFFSETS.get(o.id);
    const kidOffset = nativeKids
      ? new Map(kids.map((c, k) => [c, nativeKids[k]] as const)) : undefined;
    const [mx, my] = MAIN_SPRITE_FIX.get(o.id) ?? [0, 0];
    // An animated monster (GJBeast01–05) is drawn as its parts, placed by
    // its AnimDesc (`gd/beasts.ts`): the first frame of its default
    // animation, each part's glow behind it in the detail colour.
    // The parts are re-posed every frame in `drawObjects` (`beastPose`).
    const beast = BEASTS.get(o.id);
    if (beast) {
      const parts = beast.frames[0];
      const glowCol = this.resolveColor(o.props, "detail", def.primaryCh, def.secondaryCh);
      const part = (frame: string, q: typeof parts[number], c: Rgba) => {
        const n = this.items.length;
        this.emit("fire", frame, q.x, q.y, o.x, o.y, objRotCCW, scale, fx, fy,
          objRotCCW - q.rot * DEG * fx * fy, flipX !== q.flipX, flipY !== q.flipY, c, q.sx, q.sy, groups);
        if (this.items.length > n) {
          this.items[n].beast = { anim: beast, part: q.frame, glow: frame !== q.frame,
            objX: o.x, objY: o.y, rot: objRotCCW, scale, fx, fy };
        }
      };
      // glows go in the additive glow batch
      const glowAdd: Rgba = { ...glowCol, blend: "additive" };
      for (const q of parts) if (q.glow) part(q.glow, q, glowAdd);
      parts.forEach((q, k) => {
        this.curMain = k === parts.length - 1;
        part(q.frame, q, col);
      });
      this.curMain = false;
      // the eye (\`<name>_03\`) is not an AnimDesc part: it rides on the head
      // (the part that comes first in the texture list), in the detail colour
      const head = parts.find((q) => q.frame.endsWith("_01_001.png"));
      if (head) part(`${beast.name}_03_001.png`, head, glowCol);
      this.curMain = false;
      this.curSpin = 0;
      this.curAnim = null;
      this.curInvisibleHW = undefined;
      this.curSX = this.curSY = 1;
      return;
    }
    const behind = kids.filter((c) => c.z < 0);
    const front = kids.filter((c) => c.z >= 0);
    this.emitChildren(behind, o.props, def.primaryCh, def.secondaryCh,
      o.x, o.y, objRotCCW, scale, fx, fy, flipX, flipY, groups, kidOffset);
    if (!RAMP_STRIP_ONLY.has(o.id)) {
      this.curMain = true;
      this.emit(def.sheet, def.frame, mx, my, o.x, o.y, objRotCCW, scale, fx, fy,
        objRotCCW, flipX, flipY, col, 1, 1, groups);
      this.curMain = false;
    }
    this.emitChildren(front, o.props, def.primaryCh, def.secondaryCh,
      o.x, o.y, objRotCCW, scale, fx, fy, flipX, flipY, groups, kidOffset);

    // A teleport portal is a *pair*: the game builds the exit portal itself
    // (`TeleportPortalObject::m_orangePortal`), so the level data holds only
    // one object. Draw the partner at the destination, otherwise the exit is
    // completely invisible — you get teleported into thin air.
    if (o.id === 747) {
      const dy = propFloat(o.props, P.TELEPORT_Y_OFFSET, 0);
      if (dy !== 0) {
        // The pair is two *different* colours — `TeleportPortalObject` tracks
        // which end you are looking at with `m_isYellowPortal`, and the sheet
        // ships both: portal_18 (the entrance, our table's frame for 747) and
        // portal_19 (the exit). Drawing 18 twice made the pair look identical.
        this.emit(def.sheet, TELEPORT_EXIT_FRAME, 0, 0, o.x, o.y + dy, objRotCCW,
          scale, fx, -fy, objRotCCW, flipX, !flipY, col, 1, 1, groups);
      }
    }
    this.curSpin = 0;
    this.curAnim = null;
    this.curInvisibleHW = undefined;
    this.curSX = this.curSY = 1;
  }

  drawBackground(camX: number, camY: number, viewW: number, viewH = VIEW_H) {
    const r = this.renderer;
    const bgTex = (this.rt?.bgIndex != null ? this.bgTexes.get(this.rt.bgIndex) : undefined) ?? this.bgTex;
    const t = bgTex.frame.w * HD;
    const left = camX - viewW / 2, right = camX + viewW / 2;
    const top = camY + viewH / 2, bottom = camY - viewH / 2;
    const { x0, y0 } = bgTileStart(camX, camY, left, bottom, t);
    for (let x = x0; x < right + t; x += t) {
      for (let y = y0; y < top + t; y += t) {
        // (never additive, like the ground — see `drawGround`)
        const c = { ...this.liveRgba(1000, this.bg), blend: "normal" as BlendMode };
        r.draw(bgTex.tex, bgTex.texW, bgTex.texH, bgTex.frame,
          x + t / 2, y + t / 2, t, t, 0, c.r, c.g, c.b, c.a, c.blend);
      }
    }
  }

  /**
   * The middle ground (`GJMGLayer`), drawn in the screen's own points as
   * `GJBaseGameLayer::updateCameraBGArt` places it (m1 0x12a93c..0x12ab58):
   * scale 1.2·(1 − 0.3·(1 − zoom)) (`scaleGround`), bottom edge at
   * (base + MG offset)·(0.5 + 0.5·zoom) − 0.5·camera bottom, where base is
   * `defaultYOffsetForBG2` (m1 0x515b44: 25 for MG 1, 30 for 2 and 3) and the
   * offset is the MG trigger's (2999); x scrolls at the MG speed 0.3 (the
   * fallback pair (0.3, 0.5) of `updateMGArtSpeed`, m1 0x12944c). Layer 1
   * takes channel 1013, the `_2` layer over it 1014. APPROXIMATION A59: the x
   * phase follows the background's convention, not a decoded origin.
   */
  drawMiddleground(camX: number, camY: number, viewW: number, viewH: number, zoom: number) {
    if (!this.mgTex) return;
    const base = this.level.mgStyle === 1 ? 25 : this.level.mgStyle <= 3 ? 30 : 0;
    const scale = 1.2 * (1 - 0.3 * (1 - Math.abs(zoom)));
    const off = this.rt?.mgOffsetY ?? 0;
    const bottom = camY - viewH / 2;
    // the native camera's bottom is the port's plus the 90-unit floor offset
    const screenY = (base + off) * (0.5 + 0.5 * zoom) - 0.5 * (bottom + GD_Y_OFFSET);
    const y0 = bottom + screenY / zoom;
    const left = camX - viewW / 2, right = camX + viewW / 2;
    const r = this.renderer;
    this.mgTex.forEach((tex, i) => {
      if (!tex) return;
      const w = (tex.frame.w * HD * scale) / zoom, h = (tex.frame.h * HD * scale) / zoom;
      const originX = camX * (1 - 0.3);
      const x0 = left - (((left - originX) % w) + w) % w;
      const c = this.liveRgba(i === 0 ? 1013 : 1014, WHITE);
      for (let x = x0; x < right + w; x += w) {
        r.draw(tex.tex, tex.texW, tex.texH, tex.frame, x + w / 2, y0 + h / 2, w, h, 0,
          c.r, c.g, c.b, c.a, c.blend);
      }
    });
  }

  /**
   * Seconds since the attempt began, driving rotation and frame animation.
   * Gameplay leaves it alone and lets the trigger runtime's clock win; the
   * static viewer sets it directly.
   */
  animTime = 0;

  /**
   * 2065s, by z layer. A custom particle object draws its system in its own z
   * layer (`ParticleGameObject::claimParticle`, m1 0x16c0ec: the layer's
   * `claimCustomParticle(key, struct, getObjectZLayer, getObjectZOrder)`); its
   * default layer is 7 (T2), as the native object dump reports it. Hidden
   * (key 135) ones are dropped like every other hidden object.
   */
  private collectParticles(layerOf: (o: LevelObject) => number) {
    this.particles = [];
    this.level.objects.forEach((o, i) => {
      if (o.id !== CUSTOM_PARTICLE_ID || propBool(o.props, GLOW_OFF_KEYS.NO_GLOW_135)) return;
      const made = customParticleConfig(o.props.get(KEY_PARTICLE_DATA));
      if (!made) return;
      this.particles.push({
        obj: i, z: propInt(o.props, P.Z_LAYER, 0) || 7, struct: made.struct, cfg: made.cfg,
        grouped: made.grouped, groups: parseGroups(o),
        quick: propBool(o.props, KEY_QUICK_START),
        animate: propBool(o.props, KEY_ANIMATE_ON_TRIGGER),
        seen: -Infinity, pending: false,
        useColor: propBool(o.props, KEY_USE_OBJECT_COLOR),
        uniform: propBool(o.props, KEY_UNIFORM_OBJECT_COLOR),
        mainCh: propInt(o.props, P.MAIN_COLOR, 0) || 1004,
        secCh: propInt(o.props, P.SECONDARY_COLOR, 0) || 1011,
        e: null,
      });
    });
    this.particles.sort((a, b) => a.z - b.z);
  }

  /** a new attempt: every custom particle system starts over */
  resetParticles() {
    this.particles = this.particles.filter((p) => !p.oneShot);
    for (const p of this.particles) { p.e = null; p.seen = -Infinity; p.pending = false; }
  }

  /**
   * Run the custom particle systems for `dt` seconds. A system exists while
   * its object is within 90 units of the view — the window the port uses for
   * the other object emitters (APPROXIMATION A55: the game claims and
   * unclaims on its section visibility). On activation:
   * - a finite duration (≥ 0) leaves it stopped (`claimParticle` calls
   *   `stopSystem`); with key 123 an Animate trigger restarts it (below) —
   *   every such string in Dash has duration 0 and emission rate −1, a burst
   *   of its whole budget; without key 123 it stays idle here (A55);
   * - quick start (key 211) runs `update(min(life / 10, 0.2))` ten times
   *   (`particleWasActivated`, m1 0x16c6e0).
   * `applyParticleSettings` (m1 0x16c244): a grouped system takes the
   * object's rotation and scale, a free/relative one neither (its emission
   * angle turns with the object instead — A55); key 146 takes the start/end
   * RGB from the object's main/secondary colours, key 147 makes them the
   * uniform colours; the system is additive when its string says so or the
   * object's main channel blends.
   */
  stepParticles(dt: number, left: number, right: number) {
    const rt = this.rt;
    // Spawn Particle (3608): a copy of each particle object in the group, at
    // the position group's object or the trigger (m1 0x12b938), drawn in the
    // source's z layer
    if (rt && rt.particleSpawns.length) {
      for (const req of rt.particleSpawns.splice(0)) {
        const at = req.posGroup > 0 ? groupAnchor(this.level, rt, req.posGroup) : { x: req.x, y: req.y };
        if (!at) continue;
        for (const src of this.particles.filter((q) => !q.oneShot && q.groups.includes(req.group))) {
          const e = new CCEmitter({ ...src.cfg });
          e.positionType = "relative";
          e.x = at.x; e.y = at.y;
          const copy: CustomParticle = { ...src, e, oneShot: { x: at.x, y: at.y }, animate: false, pending: false };
          // keep the list in z order for `drawParticlesUpTo`
          let k = this.particles.findIndex((q) => q.z > copy.z);
          if (k < 0) k = this.particles.length;
          this.particles.splice(k, 0, copy);
        }
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (!p.oneShot) continue;
      const e = p.e!;
      this.colorParticles(p, e);
      e.update(dt);
      if (!e.active && e.count === 0) this.particles.splice(i, 1);
    }
    for (const p of this.particles) {
      if (p.oneShot) continue;
      const o = this.level.objects[p.obj];
      // Animate (1585) on one of its groups: `updateSyncedAnimation` (m1
      // 0x16d1bc) restarts an animate-on-trigger system (`resetSystem`) the
      // next time it runs — a pending fire waits until the system exists
      if (p.animate && rt) {
        let last = -Infinity;
        for (const g of p.groups) { const t = rt.animated.get(g); if (t !== undefined && t > last) last = t; }
        if (last > p.seen) { p.seen = last; p.pending = true; }
      }
      let dx = 0, dy = 0;
      if (rt) for (const g of p.groups) { const gs = groupState(rt, g); dx += gs.dx; dy += gs.dy; }
      const x = o.x + dx;
      if (x < left - 90 || x > right + 90) { p.e = null; continue; }
      let e = p.e;
      if (!e) {
        e = p.e = new CCEmitter(p.cfg);
        const rot = propFloat(o.props, P.ROTATION, 0);
        if (p.grouped) {
          e.positionType = "grouped";
          e.rotation = rot;
          e.scale = propFloat(o.props, P.SCALE, 1);
        } else {
          e.positionType = "relative";
          e.cfg.angle = p.cfg.angle - rot;
        }
        e.x = x; e.y = o.y + dy;
        if (p.cfg.duration >= 0) e.stop();
        else if (p.quick) {
          const step = Math.min(p.cfg.life / 10, 0.2);
          for (let k = 0; k < 10; k++) e.update(step);
        }
      }
      e.x = x; e.y = o.y + dy;
      if (p.pending && p.animate) { e.reset(); p.pending = false; }
      this.colorParticles(p, e);
      e.update(dt);
    }
  }

  private colorParticles(p: CustomParticle, e: CCEmitter) {
    const main = this.liveRgba(p.mainCh, this.boundChannel(p.mainCh) ?? WHITE);
    e.cfg.additive = p.struct.additive || main.blend === "additive";
    if (!p.useColor && !p.uniform) return;
    const sec = this.liveRgba(p.secCh, this.boundChannel(p.secCh) ?? WHITE);
    if (p.useColor) {
      e.cfg.startColor = [main.r, main.g, main.b, p.cfg.startColor[3]];
      e.cfg.endColor = [sec.r, sec.g, sec.b, p.cfg.endColor[3]];
    } else if (e.cfg.gd) {
      e.cfg.gd = { ...e.cfg.gd, uniformColor: { start: [main.r, main.g, main.b], end: [sec.r, sec.g, sec.b] } };
    }
  }

  /** draw the custom particle systems of every z layer up to `z` not yet drawn */
  private drawParticlesUpTo(z: number, from: number): number {
    const sheet = this.sheets.get("particle");
    let k = from;
    for (; k < this.particles.length && this.particles[k].z <= z; k++) {
      const p = this.particles[k];
      const e = p.e;
      if (!e || !e.count || !sheet) continue;
      const frame = sheet.atlas.get(p.cfg.texture);
      if (!frame) continue;
      let alpha = 1;
      if (this.rt) {
        let hidden = false;
        for (const g of p.groups) {
          const gs = groupState(this.rt, g);
          alpha *= gs.alpha;
          if (!gs.enabled) hidden = true;
        }
        if (hidden) continue;
      }
      const blend: BlendMode = e.cfg.additive ? "additive" : "normal";
      e.forEach((q) => {
        this.renderer.draw(sheet.tex, sheet.texW, sheet.texH, frame, q.x, q.y, q.size, q.size, q.rot,
          q.r, q.g, q.b, q.a * alpha, blend);
      });
    }
    return k;
  }

  private buildXIndex(runs: { z: number; index: number }[]) {
    const out: { buckets: Map<number, number[]>; dynamic: number[] }[] = [];
    const moving = positionedGroups(buildTriggers(this.level));
    for (let run = 0; run < runs.length; run++) {
      const end = run + 1 < runs.length ? runs[run + 1].index : this.items.length;
      const buckets = new Map<number, number[]>();
      const dynamic: number[] = [];
      for (let ii = runs[run].index; ii < end; ii++) {
        const it = this.items[ii];
        if (it.groups.some((g) => moving.has(g))) { dynamic.push(ii); continue; }
        // a spinning sprite orbits its object's centre
        const reach = it.cull * 1.25 + (it.spin ? Math.hypot(it.x - it.spinCX, it.y - it.spinCY) : 0);
        const cx = it.spin ? it.spinCX : it.x;
        const b0 = Math.floor((cx - reach) / X_BUCKET), b1 = Math.floor((cx + reach) / X_BUCKET);
        for (let b = b0; b <= b1; b++) {
          let list = buckets.get(b);
          if (!list) buckets.set(b, list = []);
          list.push(ii);
        }
      }
      out.push({ buckets, dynamic });
    }
    this.seenStamp = new Int32Array(this.items.length);
    return out;
  }

  /** this run's sprites that can be in `[lo, hi]`, in draw order */
  private runCandidates(run: number, lo: number, hi: number): number[] {
    const ix = this.xIndex![run];
    const stamp = ++this.stampNo;
    const seen = this.seenStamp!;
    const out: number[] = [];
    for (const ii of ix.dynamic) { seen[ii] = stamp; out.push(ii); }
    const b0 = Math.floor(lo / X_BUCKET), b1 = Math.floor(hi / X_BUCKET);
    for (let b = b0; b <= b1; b++) {
      const list = ix.buckets.get(b);
      if (!list) continue;
      for (const ii of list) if (seen[ii] !== stamp) { seen[ii] = stamp; out.push(ii); }
    }
    return out.sort((a, b) => a - b);
  }

  /**
   * Draw the object layers `zLo..zHi` (native z values: B5 −5 … B1 3, the
   * portal backs' 4, T1 5 … T4 11). The scene draws B5–B1 and 4, then the
   * player, then T1–T4, as the game's layer nodes stack; a screen shader
   * (`ShaderLayer`) takes a sub-range of them (see `shaderZRange`).
   */
  drawObjects(camX: number, viewW: number, playerX = camX, camY = 0, viewH = 320,
    zLo = -Infinity, zHi = Infinity) {
    const r = this.renderer;
    // gradient layers (2903) go in below the first layer run at or above
    // their own z; the rest after every object
    const grads = this.rt ? this.gradientsToDraw(this.rt) : [];
    let gi = 0;
    // an earlier range call drew what lies below this one
    while (gi < grads.length && grads[gi].z < zLo) gi++;
    const drawGradsBelow = (z: number) => {
      while (gi < grads.length && grads[gi].z <= z) this.drawGradient(grads[gi++].props, camX, camY, viewW, viewH);
    };
    const left = camX - viewW / 2, right = camX + viewW / 2;
    const rt = this.rt;
    // the enter effect in force (legacy triggers 22-28/55-59 fire as the
    // player passes them) — see gd/enterEffect.ts
    this.enterTrigs ??= enterTriggers(this.level.objects);
    // the effects in force per enter channel (key 343 on the object) and side
    const enterCache = new Map<number, ReturnType<typeof activeEnterEffects>>();
    const enterFor = (ch: number, enterSide: boolean) => {
      const key = ch * 2 + (enterSide ? 1 : 0);
      let c = enterCache.get(key);
      if (c === undefined) enterCache.set(key, c = activeEnterEffects(this.enterTrigs!, playerX, ch, enterSide));
      return c;
    };
    // `updateRotateAction` and `updateSyncedAnimation` both run off game time,
    // which is what `TriggerRuntime.time` already is.
    const t = rt ? rt.time : this.animTime;
    // Each z layer draws as two batches: the **blending** one (the objects whose
    // main colour channel blends additively) below the normal one — native
    // Geometrical Dominator 25%: the additive water wave 1050 sits in the B2
    // blending batch (z −340) under the B2 fills 976/1043 (z −320), so the
    // ramp's fill covers it. The split is per *object*, since that is what
    // goes into a `CCSpriteBatchNode` — see `assignPassChannels`. Glows go with
    // the first pass, as before.
    const runs = this.layerStarts.length ? this.layerStarts : [{ z: 0, index: 0 }];
    this.xIndex ??= this.buildXIndex(runs);
    let pi = 0;
    while (pi < this.particles.length && this.particles[pi].z < zLo) pi++;
    for (let run = 0; run < runs.length; run++) {
    if (runs[run].z < zLo || runs[run].z > zHi) continue;
    drawGradsBelow(runs[run].z);
    // a layer with particles but no objects of its own still goes in its place
    pi = this.drawParticlesUpTo(runs[run].z - 1, pi);
    const visible = this.runCandidates(run, left - X_MARGIN, right + X_MARGIN);
    for (let pass = 0; pass < 2; pass++) {
    for (const ii of visible) {
      const it = this.items[ii];
      {
        // (a glow is additive: first pass only — `pass === 0` here drew every
        // glow in both passes, twice as bright)
        const own = it.passOwner ?? it;
        const additive = it.glow ? true
          : (own.ch >= 0 ? this.liveRgba(own.ch, own).blend : own.blend) === "additive";
        if (additive !== (pass === 0)) continue;
      }
      // a smashed breakable block stops being drawn as well as colliding
      if (this.destroyed?.has(it.obj)) continue;
      // group transform first: a moved sprite has to be culled where it is now
      let dx = 0, dy = 0, alpha = 1;
      let rot = 0, cx = 0, cy = 0, lockRot = false;
      let gsx = 1, gsy = 1, scx = 0, scy = 0, scaleOwn = true;
      if (rt && it.groups.length) {
        let hidden = false;
        for (const g of it.groups) {
          const gs = groupState(rt, g);
          dx += gs.dx; dy += gs.dy; alpha *= gs.alpha;
          if (gs.rot) { rot += gs.rot; cx = gs.cx; cy = gs.cy; lockRot = gs.lockRot; }
          if (gs.sx !== 1 || gs.sy !== 1) {
            gsx *= gs.sx; gsy *= gs.sy;
            if (!gs.scaleOwn) { scx = gs.scx; scy = gs.scy; scaleOwn = false; }
          }
          if (!gs.enabled) hidden = true;
        }
        if (hidden || alpha <= 0.001) continue;
      }
      // A rotate trigger orbits the sprite about its group's centre — and the
      // collision world does exactly the same in `near`, so the art cannot end
      // up somewhere the hitbox is not.
      // an already-collected secret coin draws as its white outline instead
      const already = it.outline && this.collectedCoins?.has(it.obj);
      let frame = already ? it.outline! : it.frame;
      let iw = it.w, ih = it.h, ix = it.x, iy = it.y;
      let irot = it.rot;
      if (it.beast) {
        const bp = beastPose(it.beast, it.frame, t);
        if (bp) { ix = bp.x; iy = bp.y; iw = bp.w; ih = bp.h; irot = bp.rot; }
      }
      if (it.animFrames && !already) {
        // key 123 holds frame 1 until an animate trigger starts the loop
        let at = t;
        if (it.animWait) {
          let started = -1;
          if (rt) for (const g of it.groups) {
            const s0 = rt.animated.get(g);
            if (s0 !== undefined && s0 > started) started = s0;
          }
          // an untriggered key-123 object is hidden: the reset routine
          // (m1 0x201aa4) clears its trigger flag, sets +0x306 and hides it,
          // and only the Animate trigger shows it again (Dash x 15555's flash
          // drew a white dot the 2.2 playthrough does not have)
          if (started < 0) continue;
          at = t - started - it.animT!.offset;
        }
        frame = it.animFrames[frameIndexAt(it.animT!, at) - 1];
        const kx = it.animKX!, ky = it.animKY!;
        iw = frame.w * kx;
        ih = frame.h * ky;
        const tox = frame.offsetX * kx * (it.flipX ? -1 : 1);
        const toy = frame.offsetY * ky * (it.flipY ? -1 : 1);
        const sc = Math.cos(irot), ss = Math.sin(irot);
        ix = it.animBaseX! + tox * sc - toy * ss;
        iy = it.animBaseY! + tox * ss + toy * sc;
      }
      // Continuous rotation (`gd/objectAnim.ts`). The game turns the whole
      // object, so a child sprite orbits the object's centre rather than
      // spinning about its own — the same transform the rotate trigger uses.
      // Saws are circles in the collision world, so nothing here can put the
      // art somewhere the hitbox is not.
      if (it.spin) {
        const a = -it.spin * DEG * t;
        const ca = Math.cos(a), sa = Math.sin(a);
        const px = ix - it.spinCX, py = iy - it.spinCY;
        ix = it.spinCX + px * ca - py * sa;
        iy = it.spinCY + px * sa + py * ca;
        irot += a;
      }
      // the music pulse scales the object about its own spot (`setRScale`)
      if (this.audioPulse !== null && this.audioObjs.has(it.obj)) {
        const a = this.audioObjs.get(it.obj)!;
        const k = audioScaleFactor(a.range, this.audioPulse, a.ring);
        gsx *= k; gsy *= k;
      }
      // Scale trigger (2067): about the centre group, or the object's own spot
      if (gsx !== 1 || gsy !== 1) {
        const ob = this.level.objects[it.obj];
        const ax = scaleOwn ? (ob?.x ?? ix) : scx, ay = scaleOwn ? (ob?.y ?? iy) : scy;
        ix = ax + (ix - ax) * gsx;
        iy = ay + (iy - ay) * gsy;
        iw *= gsx; ih *= gsy;
      }
      if (rot) {
        const ca = Math.cos(rot), sa = Math.sin(rot);
        const px = ix - cx, py = iy - cy;
        ix = cx + px * ca - py * sa;
        iy = cy + px * sa + py * ca;
        if (!lockRot) irot += rot;
      }
      let x = ix + dx;
      const cull = it.cull * Math.max(1, Math.abs(gsx), Math.abs(gsy));
      if (x + cull < left || x - cull > right) continue;
      // Edge fade and enter effect (`PlayLayer::updateVisibility`): measured
      // from the *object's* position, and applied about it, so every sprite of
      // one object — children and glow included — moves as one.
      let edgeA = 1, ey = iy + dy, ew = iw, eh = ih;
      // a custom enter tint (3021): toward channel `tintCh` by `tintK`
      let tintK = 0, tintCh = 0;
      const o = this.level.objects[it.obj];
      // invisible blocks fade through their own rule (`updateInvisibleBlock`)
      if (o && it.invisibleHW === undefined) {
        const ox = o.x + dx;
        const fade = edgeFade(ox, left, right);
        const eff = enterFor(propInt(o.props, 343, 0), fade.right);
        const enterCode = eff.code;
        if (enterCode === CUSTOM_ENTER_CODE) {
          const dIn = fade.right ? right - ox : ox - left;
          for (const c of eff.customs) {
            const v = Math.min(1, Math.max(0, (dIn - c.offset) / c.length));
            const e = easedValue(v, c.easing, c.rate);
            if (c.id === 3020) edgeA *= e;
            else if (c.id === 3021 && c.tintCh > 0) { tintK = Math.min(1, (1 - e) * c.tint); tintCh = c.tintCh; }
          }
        } else if (fade.t < 1 && enterCode !== NO_ENTER_CODE) {
          if (!propBool(o.props, P.DONT_FADE) && !skipsEdgeFade(o.id, enterCode, this.mainBlending(o))) edgeA = fade.t;
          if (!propBool(o.props, P.DONT_ENTER)) {
            const oy = o.y + dy;
            const e = enterTransform(enterCode, fade.t, oy > camY,
              ((it.obj * 2654435761) % 360) - 180);
            x = ox + (x - ox) * e.scale + e.dx;
            ey = oy + (ey - oy) * e.scale + e.dy;
            ew *= e.scale; eh *= e.scale;
          }
        }
      }
      let col = it.ch >= 0
        ? this.liveRgba(it.ch, it as unknown as Rgba)
        : (it as unknown as Rgba);
      // Area Tint (3010): toward the tint channel by (1 − v)·amount
      if (rt && rt.areaTints.length && o) {
        for (const a of rt.areaTints) {
          if (!it.groups.includes(a.target) || (a.detailOnly && !it.detail)) continue;
          const c = a.centerGroup === -1 ? { x: playerX, y: this.playerY }
            : a.centerGroup > 0 ? groupAnchor(this.level, rt, a.centerGroup) : null;
          if (!c) continue;
          let v = Math.hypot(o.x + dx - c.x, o.y + dy - c.y) / a.length;
          if (a.deadzone > 0) v = (v - a.deadzone) / (1 - a.deadzone);
          v = Math.min(1, Math.max(0, v));
          if (a.inbound) v = 1 - v;
          const ramp = a.dur > 0 ? Math.min(1, (rt.time - a.t0) / a.dur) : 1;
          const k = (1 - v) * a.amount * ramp;
          if (k > tintK) { tintK = Math.min(1, k); tintCh = a.tintCh; }
        }
      }
      if (tintK > 0) {
        const tc = this.liveRgba(tintCh, WHITE);
        col = { ...col, r: col.r + (tc.r - col.r) * tintK, g: col.g + (tc.g - col.g) * tintK, b: col.b + (tc.b - col.b) * tintK };
      }
      if (it.glow === "bg") col = this.customGlowRgba();
      // The invisible objects are drawn through `updateInvisibleBlock`: nearly
      // transparent around the player, fading in toward the screen edges and
      // mixing toward the background colour once they are nearly solid.
      let invisibleA = 1;
      if (it.invisibleHW !== undefined) {
        const f = invisibleFade(x, it.invisibleHW, camX, viewW);
        invisibleA = it.glow ? f.glowOpacity : f.opacity;
        if (f.mix > 0 && !it.glow) {
          const bg = this.liveRgba(1000, this.bg);
          col = {
            ...col,
            r: col.r * f.mix + bg.r * (1 - f.mix),
            g: col.g * f.mix + bg.g * (1 - f.mix),
            b: col.b * f.mix + bg.b * (1 - f.mix),
          };
        }
      }
      // a pulse aimed at one of this object's groups lays over the channel
      if (rt && rt.pulses.length && it.groups.length && !it.glow) {
        const p = applyGroupPulses(rt, it.groups, it.detail,
          { r: col.r * 255, g: col.g * 255, b: col.b * 255 });
        col = { ...col, r: p.r / 255, g: p.g / 255, b: p.b / 255 };
      }
      if (edgeA <= 0 || ew === 0) continue;
      this.captureDraws?.push({
        obj: it.obj, id: o?.id ?? -1, main: it.main === true, detail: it.detail, glow: it.glow ?? "",
        x, y: ey, w: ew, h: eh,
        r: col.r, g: col.g, b: col.b, a: col.a * alpha * invisibleA * edgeA, blend: col.blend, ch: it.ch,
      });
      r.draw(it.tex, it.texW, it.texH, frame, x, ey, ew, eh, irot,
        col.r, col.g, col.b, col.a * alpha * invisibleA * edgeA, col.blend, it.flipX, it.flipY);
    }
    }
    pi = this.drawParticlesUpTo(runs[run].z, pi);
    }
    this.drawParticlesUpTo(zHi, pi);
    drawGradsBelow(zHi);
    this.drawCounters(left, right);
  }

  /**
   * The z each gradient layer (key 202) sits under. `triggerGradientCommand`
   * (m1 0x10e12c) parents layer 3..12 (B5, B4, B3, B2, B1, P, T1..T4) into the
   * object layer just below that layer's batch; 1/2 (BG, MG) are behind every
   * object, 13..15 (G, UI, Max) in front of them all.
   */
  private static readonly GRADIENT_Z: Record<number, number> = {
    1: -Infinity, 2: -Infinity, 3: -5, 4: -3, 5: -1, 6: 1, 7: 3, 8: 4, 9: 5, 10: 7, 11: 9, 12: 11,
    13: Infinity, 14: Infinity, 15: Infinity,
  };

  private gradientsToDraw(rt: TriggerRuntime): { z: number; props: Map<number, string> }[] {
    const out: { z: number; props: Map<number, string> }[] = [];
    for (const props of rt.gradients.values()) {
      out.push({ z: LevelScene.GRADIENT_Z[propInt(props, 202, 1)] ?? -Infinity, props });
    }
    return out.sort((a, b) => a.z - b.z);
  }

  /** the one object of a group at its current (trigger-moved) place, or null */
  private groupAnchor(group: number): { x: number; y: number } | null {
    if (group <= 0) return null;
    if (!this.groupObjects) {
      this.groupObjects = new Map();
      this.level.objects.forEach((o, i) => {
        for (const g of parseGroups(o)) {
          const l = this.groupObjects!.get(g);
          if (l) l.push(i); else this.groupObjects!.set(g, [i]);
        }
      });
    }
    const list = this.groupObjects.get(group);
    // `updateGradientLayers` only uses a group holding exactly one object
    if (!list || list.length !== 1) return null;
    const o = this.level.objects[list[0]];
    let x = o.x, y = o.y;
    if (this.rt) for (const g of parseGroups(o)) { const gs = groupState(this.rt, g); x += gs.dx; y += gs.dy; }
    return { x, y };
  }

  /**
   * One gradient layer (`updateGradientLayers` m1 0x10e7c0), edge mode: a
   * rect whose left/right/bottom/top come from the single objects of groups
   * 205/206/204/203, each side the view edge ±20 when unset; coloured as a
   * cocos `CCLayerGradient` (compressed interpolation) from the base channel
   * (key 21) to the detail channel (key 22) along (cos −θ, sin −θ), θ the
   * trigger's rotation. Blending (key 174): 1 additive; 0 normal; 2/3
   * (multiply/invert) are drawn normal — APPROXIMATION A44.
   */
  private drawGradient(props: Map<number, string>, camX: number, camY: number, viewW: number, viewH: number) {
    const r = this.renderer;
    const tone = (ch: number, baseAlpha: number) => {
      const c = this.liveRgba(ch, this.boundChannel(ch) ?? WHITE);
      return { r: c.r, g: c.g, b: c.b, a: c.a * baseAlpha };
    };
    let alpha = 1;
    if (this.rt) for (const g of parseGroups({ id: 2903, x: 0, y: 0, props })) alpha *= groupState(this.rt, g).alpha;
    const S = tone(propInt(props, P.MAIN_COLOR, 0), alpha);
    const E = tone(propInt(props, P.SECONDARY_COLOR, 0), alpha);
    if (S.a <= 0 && E.a <= 0) return;
    let x0 = camX - viewW / 2 - 20, x1 = camX + viewW / 2 + 20;
    let y0 = camY - viewH / 2 - 20, y1 = camY + viewH / 2 + 20;
    const up = this.groupAnchor(propInt(props, 203, 0));
    const down = this.groupAnchor(propInt(props, 204, 0));
    const l = this.groupAnchor(propInt(props, 205, 0));
    const rr = this.groupAnchor(propInt(props, 206, 0));
    if (down) y0 = down.y;
    if (up) y1 = up.y;
    if (l) x0 = l.x;
    if (rr) x1 = rr.x;
    if (x1 <= x0 || y1 <= y0) return;
    const th = (-propFloat(props, P.ROTATION, 0) * Math.PI) / 180;
    let ux = Math.cos(th), uy = Math.sin(th);
    const c = Math.SQRT2, h2 = 1 / (Math.abs(ux) + Math.abs(uy));
    ux *= h2 * c; uy *= h2 * c;
    const mix = (k: number) => ({
      r: E.r + (S.r - E.r) * k, g: E.g + (S.g - E.g) * k, b: E.b + (S.b - E.b) * k, a: E.a + (S.a - E.a) * k,
    });
    const bl = mix((c + ux + uy) / (2 * c)), br = mix((c - ux + uy) / (2 * c));
    const tl = mix((c + ux - uy) / (2 * c)), tr = mix((c - ux - uy) / (2 * c));
    if (!this.whiteTex) {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 2;
      const g = cv.getContext("2d")!;
      g.fillStyle = "#fff"; g.fillRect(0, 0, 2, 2);
      this.whiteTex = createTexture(r.ctx, cv);
    }
    const blend: BlendMode = propInt(props, 174, 0) === 1 ? "additive" : "normal";
    r.drawColorQuad(this.whiteTex, 0.5, 0.5, blend, [
      { x: x0, y: y1, ...tl }, { x: x1, y: y1, ...tr }, { x: x1, y: y0, ...br }, { x: x0, y: y0, ...bl },
    ]);
  }

  /**
   * The item-counter labels (1615). Laid out with the same centred-on-position
   * rule as a text object, but from the live item count, so the digits change
   * and the string re-centres as the count grows.
   *
   * APPROXIMATION: drawn after every sprite rather than inside the object's own
   * z layer. There is one label in the 22 levels and it sits on a decoration
   * panel with nothing in front of it, so the order is not observable here.
   */
  private drawCounters(left: number, right: number) {
    const font = this.font;
    if (!font || !this.counters.length) return;
    const r = this.renderer;
    const rt = this.rt;
    for (const c of this.counters) {
      if (this.destroyed?.has(c.obj)) continue;
      let dx = 0, dy = 0, alpha = 1;
      if (rt && c.groups.length) {
        let hidden = false;
        for (const g of c.groups) {
          const gs = groupState(rt, g);
          dx += gs.dx; dy += gs.dy; alpha *= gs.alpha;
          if (!gs.enabled) hidden = true;
        }
        if (hidden || alpha <= 0.001) continue;
      }
      const cx = c.x + dx;
      if (cx + 120 < left || cx - 120 > right) continue;
      const text = String(rt ? itemCount(rt, c.item) : 0);
      const col = c.col.ch >= 0 ? this.liveRgba(c.col.ch, c.col) : c.col;
      const cos = Math.cos(c.rot), sin = Math.sin(c.rot);
      const width = font.measure(text) * c.scale;
      const lineH = font.font.lineHeight * c.scale;
      let penX = -width / 2;
      const baseY = -lineH / 2;
      let prev = -1;
      for (const ch of text) {
        const id = ch.codePointAt(0)!;
        const gl = font.font.glyphs.get(id);
        if (!gl) { prev = id; continue; }
        if (prev >= 0) penX += (font.font.kernings.get(`${prev},${id}`) ?? 0) * c.scale;
        if (gl.w > 0 && gl.h > 0) {
          const w = gl.w * c.scale, h = gl.h * c.scale;
          const lx = penX + gl.xoffset * c.scale + w / 2;
          const ly = baseY + (font.font.base - gl.yoffset - gl.h) * c.scale + h / 2;
          r.draw(font.tex, font.font.scaleW, font.font.scaleH,
            { x: gl.x, y: gl.y, w: gl.w, h: gl.h, rotated: false,
              offsetX: 0, offsetY: 0, sourceW: gl.w, sourceH: gl.h },
            cx + lx * cos - ly * sin, c.y + dy + lx * sin + ly * cos,
            w, h, c.rot, col.r, col.g, col.b, col.a * alpha, col.blend, false, false);
        }
        penX += gl.xadvance * c.scale;
        prev = id;
      }
    }
  }

  /**
   * The tinted glow colour (`gd/glow.ts`): the live background colour through
   * `CUSTOM_GLOW_HSV`, still additive.
   */
  private customGlowRgba(): Rgba {
    const bg = this.liveRgba(1000, this.bg);
    const c = transformColor({ r: bg.r * 255, g: bg.g * 255, b: bg.b * 255 }, CUSTOM_GLOW_HSV);
    return { r: c.r / 255, g: c.g / 255, b: c.b / 255, a: 1, blend: "additive", ch: -1 };
  }

  /**
   * The ground, and in the flying modes and duals the ceiling too. `floor` is
   * the world y of the ground's top edge (0 for the level floor); `ceiling`,
   * when given, is where the mirrored top ground hangs from — the band edges
   * `changeGameMode` / `updateDualGround` move the two ground layers to.
   */
  drawGround(camX: number, camY: number, viewW: number, viewH = VIEW_H, floor = 0, ceiling?: number) {
    const r = this.renderer;
    const t = this.groundTex.frame.w * HD;
    // `GJGroundLayer::loadGroundSprites` (m1 0x51508c): ground 1's tiles hang
    // from y −(128 − h) (init m1 0x514c94: 128 less the art's height), so art
    // shorter than 128 points is bottom-aligned 128 below the floor; ground 2
    // (`_2`, channel 1009) hangs from the floor itself, over ground 1. The port
    // drew every ground as a square tile, stretching grounds 8/9/12 (L20/19/21),
    // and never drew ground 2 (Dash's orange lava at 1 %, 2.2 playthrough).
    const h1 = this.groundTex.frame.h * HD;
    const drop1 = Math.max(0, 128 - h1);
    const g2 = this.ground2Tex;
    const g2c = g2 ? { ...this.liveRgba(1009, this.ground), blend: "normal" as BlendMode } : null;
    const left = camX - viewW / 2, right = camX + viewW / 2;
    const bottom = camY - viewH / 2, top = camY + viewH / 2;
    // The ground is never drawn additively: a channel's blending flag only
    // picks an object batch, and the ground sprites are not in one. Hexagon
    // Force 21% (4K 2.2 recording, YouTube 2htgtTtviZw): its colour trigger
    // leaves 1001 dark purple *with* blending, and the ball band's floor and
    // ceiling are solid dark strips — added onto the orange they vanished.
    const gc = { ...this.liveRgba(1001, this.ground), blend: "normal" as BlendMode };
    const x0 = left - (((left % t) + t) % t);
    const lc = this.liveRgba(1002, this.lineCol);
    const line = (y: number, flip: boolean) => {
      if (!this.lineFrame || !this.lineSheet) return;
      const h = this.lineFrame.h * HD;
      r.draw(this.lineSheet.tex, this.lineSheet.texW, this.lineSheet.texH, this.lineFrame,
        camX, flip ? y - h / 2 : y + h / 2, viewW + 8, h, 0,
        lc.r, lc.g, lc.b, lc.a, lc.blend, false, flip);
    };
    if (floor > bottom - h1 - drop1) {
      for (let x = x0; x < right + t; x += t) {
        for (let y = floor - drop1; y > bottom - h1; y -= h1) {
          r.draw(this.groundTex.tex, this.groundTex.texW, this.groundTex.texH, this.groundTex.frame,
            x + t / 2, y - h1 / 2, t, h1, 0, gc.r, gc.g, gc.b, gc.a, gc.blend);
        }
        if (g2 && g2c) {
          const h2 = g2.frame.h * HD;
          r.draw(g2.tex, g2.texW, g2.texH, g2.frame, x + t / 2, floor - h2 / 2, t, h2, 0,
            g2c.r, g2c.g, g2c.b, g2c.a, g2c.blend);
        }
      }
      line(floor, false);
    }
    if (ceiling !== undefined && ceiling < top + h1 + drop1) {
      for (let x = x0; x < right + t; x += t) {
        for (let y = ceiling + drop1; y < top + h1; y += h1) {
          r.draw(this.groundTex.tex, this.groundTex.texW, this.groundTex.texH, this.groundTex.frame,
            x + t / 2, y + h1 / 2, t, h1, 0, gc.r, gc.g, gc.b, gc.a, gc.blend, false, true);
        }
        if (g2 && g2c) {
          const h2 = g2.frame.h * HD;
          r.draw(g2.tex, g2.texW, g2.texH, g2.frame, x + t / 2, ceiling + h2 / 2, t, h2, 0,
            g2c.r, g2c.g, g2c.b, g2c.a, g2c.blend, false, true);
        }
      }
      line(ceiling, true);
    }
  }
}

/** one custom particle object (2065) and, while in view, its system */
interface CustomParticle {
  obj: number;
  z: number;
  struct: ParticleStruct;
  cfg: import("../engine/ccparticles.ts").ParticleConfig;
  grouped: boolean;
  groups: number[];
  quick: boolean;
  /** key 123: an Animate trigger restarts the system */
  animate: boolean;
  /** a copy a Spawn Particle trigger (3608) made: fixed in place, dropped when spent */
  oneShot?: { x: number; y: number };
  /** the latest Animate fire on its groups already taken, and one not yet run */
  seen: number;
  pending: boolean;
  useColor: boolean;
  uniform: boolean;
  mainCh: number;
  secCh: number;
  e: CCEmitter | null;
}

/**
 * Where a GJBeast part sits at level time `t`: the default animation loops at
 * its own delay (\`objectDefinitions.plist\`), and the part — matched by its
 * texture; the eye follows the head — takes that frame's AnimDesc transform,
 * placed the same way \`emit\` places it.
 */
function beastPose(
  b: NonNullable<DrawItem["beast"]>, frame: SpriteFrame, t: number,
): { x: number; y: number; w: number; h: number; rot: number } | null {
  const a = b.anim;
  const n = a.frames.length;
  let k = Math.floor(Math.max(0, t) / a.delay);
  k = a.looped ? k % n : Math.min(k, n - 1);
  const q = a.frames[k].find((p) => p.frame === b.part);
  if (!q) return null;
  const lx = q.x * b.fx * b.scale, ly = q.y * b.fy * b.scale;
  const cos = Math.cos(b.rot), sin = Math.sin(b.rot);
  let x = b.objX + lx * cos - ly * sin;
  let y = b.objY + lx * sin + ly * cos;
  const kx = HD * b.scale * q.sx, ky = HD * b.scale * q.sy;
  const rot = b.rot - q.rot * DEG * b.fx * b.fy;
  const fxs = (b.fx < 0) !== q.flipX ? -1 : 1, fys = (b.fy < 0) !== q.flipY ? -1 : 1;
  const tox = frame.offsetX * kx * fxs, toy = frame.offsetY * ky * fys;
  const sc = Math.cos(rot), ss = Math.sin(rot);
  x += tox * sc - toy * ss;
  y += tox * ss + toy * sc;
  return { x, y, w: frame.w * kx, h: frame.h * ky, rot };
}
