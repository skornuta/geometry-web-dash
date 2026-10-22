// Generates src/gd/objects.ts — the object-id -> sprite-frame table.
//
// Source of the id->texture mapping: OpenGD's Content/Custom/object.json
// (https://github.com/Open-GD/OpenGD, GPL-3.0). That file is NOT vendored into
// this repo — it is downloaded on demand into data/ (gitignored) and only the
// derived table is committed. Re-run with `npm run gen:objects`.
//
// What we take from it per object id: texture name, object_type, which color
// slot tints the main sprite, default color channels, default z layer/order,
// and the child-sprite composition (offsets/flips/rotation/scale/tint).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseAtlas } from "../src/engine/atlas.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_URL = "https://raw.githubusercontent.com/Open-GD/OpenGD/main/Content/Custom/object.json";
const DATA = path.join(ROOT, "data", "opengd-object.json");
/** the game's own id -> frame table, from `npm run gen:toolbox` (optional) */
const TOOLBOX = path.join(ROOT, "data", "toolbox-frames.json");
/** per-id sprite layout dumped from the running game (gd-ui-capture `geometry`) */
const NATIVE = path.join(ROOT, "data", "native-geometry.jsonl");
/** the same for the detail sprite, from the per-instance `sprites` dumps */
const COLOR_SPRITES = path.join(ROOT, "data", "native-color-sprites.json");
const OUT = path.join(ROOT, "src", "gd", "objects.ts");

// sheets we resolve frame names against, in priority order
const SHEETS = [
  ["game", "GJ_GameSheet-hd"],
  ["game02", "GJ_GameSheet02-hd"],
  ["game03", "GJ_GameSheet03-hd"],
  ["game04", "GJ_GameSheet04-hd"],
  ["icons", "GJ_GameSheetIcons-hd"],
  ["fire", "FireSheet_01-hd"],
  ["particle", "GJ_ParticleSheet-hd"],
  // level 22's pixel-art decoration lives here and nowhere else; without it
  // ~7000 of its objects resolve to a frame name that is in no loaded sheet
  ["pixel", "PixelSheet_01-hd"],
];

// sheets the renderer loads that no object frame resolves against: the object
// glow batch (src/gd/glow.ts names its frames itself)
const EXTRA_SHEETS = ["glow"];

// GameObjectType (OpenGD Source/GameObject.h) -> our coarse kind.
// Only the kinds M2 needs to *draw* are distinguished precisely; gameplay
// milestones (M3/M4) refine behaviour off `type`, which we keep verbatim.
const KIND_BY_TYPE = {
  0: "solid", 2: "hazard", 3: "portal", 4: "portal", 5: "portal", 6: "portal",
  7: "deco", 8: "pad", 9: "pad", 10: "pad", 11: "orb", 12: "orb", 13: "orb",
  14: "portal", 15: "portal", 16: "portal", 17: "portal", 18: "portal", 19: "portal",
  20: "speed", 21: "solid", 22: "coin", 23: "portal", 24: "portal", 25: "slope",
  26: "portal", 27: "portal", 28: "portal", 29: "orb", 30: "coin", 31: "coin",
  32: "orb", 33: "portal", 34: "pad", 35: "orb", 36: "orb", 37: "orb", 38: "orb",
  39: "solid", 40: "deco",
  // 2.2 (Geode Enums.hpp `GameObjectType`): 41 SwingPortal, 43 SpiderOrb
  41: "portal", 43: "orb",
};

// Ids the source table omits but that the 22 main levels need drawn.
// Kept deliberately tiny: each entry is verified (frame exists in the sheet and
// the level data agrees), rather than guessed.
const EXTRA = {
  // 3 objects in Stereo Madness, each carrying prop 12 (SECRET_COIN_ID).
  142: { texture_name: "secretCoin_01_001.png", object_type: 22, color_channel: null,
         default_primary_channel: -1, default_secondary_channel: -1,
         default_z_layer: 5, default_z_order: 7, children: [] },
  // Orbs and the teleport portal are absent from the source table. The frame
  // names below are NOT guesses — 84/141/1333 were guessed once and were wrong,
  // which made every orb but the yellow one behave and look like a different
  // orb. They are pinned by two independent sources that agree:
  //
  //   1. OpenGD `Source/GameObject.cpp` `customSetup()` switches on the id and
  //      names each one, with the particle tint it applies:
  //        36 yellow, 84 BLUE (cyan), 141 PINK (magenta), 1022 green,
  //        1333 RED, and pads 35 yellow / 67 blue / 140 pink / 1332 red.
  //   2. The colour actually painted into the -hd atlas art:
  //        ring_01 #ffeb45 yellow    ring_02 #ff9a0d orange/red
  //        ring_03 #ff45ff magenta   gravring_01 #40ffff cyan
  //        gravJumpRing_01 #5cff2a green
  //
  // Matching them: the blue orb *is* the gravity orb (gravring_01, cyan), pink
  // is the plain magenta ring_03, red is the orange-red ring_02.
  // Re-measure with a canvas crop of the atlas before changing any of these.
  //
  // The *_extra_001 glow overlays are NOT added as children: ChildDef has no
  // additive-blend field, so a glow child would render as an opaque sprite.
  // Deferred until the glow overlays (M2 gap) are wired up.
  36:   { texture_name: "ring_01_001.png",          object_type: 11, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  // blue / gravity orb
  84:   { texture_name: "gravring_01_001.png",      object_type: 13, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  // pink orb
  141:  { texture_name: "ring_03_001.png",          object_type: 12, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  1022: { texture_name: "gravJumpRing_01_001.png",  object_type: 29, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  1330: { texture_name: "dropRing_01_001.png",      object_type: 32, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  // red orb
  1333: { texture_name: "ring_02_001.png",          object_type: 35, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  // 1594 is the **toggle orb** (a `CustomRing`), not a spider pad: the game's
  // own ObjectToolbox gives it `ring_custom_01_001.png`, and
  // `GameObject::customSetup` +10752 sets its type to 0x24 = CustomRing and its
  // box to 36x36. `PlayerObject::ringJump` +632 sends it to
  // `activateCustomRing`, which toggles a group and gives no velocity.
  1594: { texture_name: "ring_custom_01_001.png", object_type: 36, color_channel: "base",
          default_primary_channel: 1004, default_secondary_channel: -1,
          default_z_layer: 3, default_z_order: 1, children: [] },
  1704: { texture_name: "dashRing_01_001.png",      object_type: 36, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  1751: { texture_name: "dashRing_02_001.png",      object_type: 37, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  // NOT added: id 3006. An earlier table had it as a teleport orb
  // (`teleportRing_001.png`); it is not one. The toolbox frame is
  // `edit_eAreaMoveBtn_001.png` — it is the 2.2 **area move** trigger, which is
  // invisible in play, so it belongs in EDITOR_ONLY_IDS (see FIDELITY.md 4).
  // the blue entrance is portal_15 (`TeleportPortalObject`, BUG-20); 18 is the swing portal
  747:  { texture_name: "portal_15_front_001.png",  object_type: 28, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  // 2.2 gameplay objects the toolbox fallback would file as decoration. Their
  // types are Geode's `GameObjectType` (SwingPortal 41, SpiderOrb 43); frames
  // are the toolbox's own. Dash (L22) uses both twice — its native run turns
  // into a swing exactly where 1933's 34-wide box reaches it (f3879).
  1933: { texture_name: "portal_18_front_001.png",  object_type: 41, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
  3004: { texture_name: "spiderRing_001.png",       object_type: 43, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 3, default_z_order: 1, children: [] },
  // The linked teleport portal: a `TeleportPortalObject` whose exit is the
  // object in its key-51 group (`GJBaseGameLayer::getPortalTarget`, m1
  // 0xfa084). Typed as 747 is (28). Dash (15555, 615) / (15765, 1815).
  2902: { texture_name: "portal_15_front_001.png",  object_type: 28, color_channel: null,
          default_primary_channel: -1, default_secondary_channel: -1,
          default_z_layer: 5, default_z_order: 10, children: [] },
};

/**
 * The game's own `ObjectToolbox` table, if `npm run gen:toolbox` has been run
 * on a machine with the game installed. It is used **only as a fallback**: an
 * id OpenGD already covers keeps OpenGD's entry, because that entry carries the
 * type, colour slot, z-order and child sprites this table has no idea about.
 *
 * What it buys is coverage. OpenGD's file is a 2.1-era reimplementation and
 * misses 264 of the ids the 22 levels use — `scripts/audit.mjs` measured the
 * cost at **17080 of 175138 objects never drawn (9.75%)**, 63% of level 22.
 * The toolbox has 4092 ids and agrees with OpenGD on 731 of their 791 shared
 * ids (92.4%), including every id this project pinned by hand.
 *
 * **The `edit_` prefix is the editor's icon for an invisible object** — every
 * trigger resolves to one (29/30 colour, 901 move, 1006 pulse, 1007 alpha,
 * 1268 spawn, 1049 toggle, 22-28 and 55-59 the old enter effects). Those are
 * skipped deliberately and recorded in `EDITOR_ONLY_IDS` so the renderer can
 * tell "invisible on purpose" from "art we are failing to draw" — before this,
 * both looked identical and the audit reported them together.
 *
 * A fallback entry is always **`kind: "deco"`**: the toolbox says nothing about
 * GameObjectType, and deco is the only guess that cannot change gameplay, since
 * the collision world builds no collider for it. These objects are not drawn at
 * all today, so drawing them as decoration is a strict improvement.
 */
/** invisible `EffectGameObject` subclasses the `edit_` prefix rule misses */
const EFFECT_OBJECT_IDS = new Set([3032]);

function loadToolbox() {
  if (!fs.existsSync(TOOLBOX)) {
    process.stderr.write(
      `note: ${path.relative(ROOT, TOOLBOX)} is absent — falling back to OpenGD coverage only.\n`
      + "      Run `npm run gen:toolbox` (needs the game installed) for the full table.\n");
    return new Map();
  }
  return new Map(Object.entries(JSON.parse(fs.readFileSync(TOOLBOX, "utf8")))
    .map(([id, frame]) => [Number(id), frame]));
}

async function ensureSource() {
  if (fs.existsSync(DATA)) return;
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  process.stderr.write(`downloading ${SRC_URL}\n`);
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  fs.writeFileSync(DATA, Buffer.from(await res.arrayBuffer()));
}

function loadFrameIndex() {
  // name -> { sheet, w, h } with w/h in world units (sd px = hd px / 2)
  const index = new Map();
  for (const [key, file] of SHEETS) {
    const xml = fs.readFileSync(path.join(ROOT, "public", "assets", `${file}.plist`), "utf8");
    for (const [name, f] of parseAtlas(xml)) {
      if (!index.has(name)) index.set(name, { sheet: key, w: f.sourceW / 2, h: f.sourceH / 2 });
    }
  }
  return index;
}

function slot(colorChannel) {
  if (colorChannel === "base") return "base";
  if (colorChannel === "detail") return "detail";
  if (colorChannel === "black") return "black";
  return "none";
}

/**
 * Where the game lays out each id's sprites, read out of the running game by
 * the gd-ui-capture mod's `geometry` command: the object's content box and
 * every child sprite node, with its own position, anchor, scale, z and texture
 * rect. First instance per id wins, as in `gen-native-geometry.mjs`.
 */
function loadNative() {
  if (!fs.existsSync(NATIVE)) return new Map();
  const out = new Map();
  for (const line of fs.readFileSync(NATIVE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const g = JSON.parse(line);
    if (!out.has(g.id)) out.set(g.id, g);
  }
  return out;
}

/** native child list in the z order the renderer walks it */
function nativeKids(g) {
  return g.children.filter((c) => c.rw !== undefined)
    .map((c, i) => ({ ...c, i })).sort((a, b) => a.z - b.z || a.i - b.i);
}

/**
 * A node's position locates its **anchor**, not its centre, and the game states
 * it in the parent's bottom-left-origin frame — the same correction
 * `gen-native-geometry.mjs` applies. The four quarters of 1888 all sit at
 * (0,0) with anchor (1,0) and mirror about that corner; treating their
 * positions as centres overlays them into a square.
 */
function nativeOffset(child, self) {
  const ax = (0.5 - child.ax) * child.w * child.sx;
  const ay = (0.5 - child.ay) * child.h * child.sy;
  const a = -child.rot * Math.PI / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return [
    +(child.x - self.w / 2 + ax * cos - ay * sin).toFixed(2),
    +(child.y - self.h / 2 + ax * sin + ay * cos).toFixed(2),
  ];
}

/** two native sprite records describe the same node laid out the same way */
const sameSprite = (a, b) => a.w === b.w && a.h === b.h
  && a.x === b.x && a.y === b.y && a.z === b.z && a.ax === b.ax && a.ay === b.ay
  && a.sx === b.sx && a.sy === b.sy;

/**
 * Slopes whose children OpenGD gives a baked editor tint (cyan 150,255,255 or
 * yellow 255,255,150). The child is coloured by the same channel slot as its
 * parent, so the tint only ever shows when that channel is unset — and then
 * the parent falls back to white while the child turned cyan. Neutral white
 * keeps the pair on one colour.
 */
const UNTINTED_CHILDREN = new Set([1743, 1744, 1746, 1758, 1759]);

function untinted(id, kids) {
  if (!UNTINTED_CHILDREN.has(id)) return kids;
  const clear = (c) => ({ ...c, r: 255, g: 255, b: 255, children: c.children.map(clear) });
  return kids.map(clear);
}

function convertChildren(children, parent, frames, warn, depth = 0) {
  const out = [];
  for (const c of children ?? []) {
    const f = frames.get(c.texture_name);
    if (!f) { warn(`child frame not in any sheet: ${c.texture_name}`); continue; }
    // Child x/y are in the parent's local space, origin at the parent texture's
    // bottom-left (validated: 98.5% of detail overlays land at ~zero offset).
    out.push({
      frame: c.texture_name,
      sheet: f.sheet,
      // a child anchored off its centre (the glow circles 1840/1886–1888: four
      // quadrants at anchor (1, 0), mirrored by their scale signs — native
      // geometry has them meeting on the object's centre) sits that far over
      dx: +(c.x - parent.w / 2 + (0.5 - (c.anchor_x ?? 0.5)) * f.w * (c.scale_x ?? 1)).toFixed(3),
      dy: +(c.y - parent.h / 2 + (0.5 - (c.anchor_y ?? 0.5)) * f.h * (c.scale_y ?? 1)).toFixed(3),
      z: c.z ?? 0,
      color: slot(c.color_channel),
      r: c.r ?? 255, g: c.g ?? 255, b: c.b ?? 255,
      flipX: !!c.flip_x, flipY: !!c.flip_y,
      rot: c.rot ?? 0,
      scaleX: c.scale_x ?? 1, scaleY: c.scale_y ?? 1,
      // nested children are rare (131) and inherit the same rules
      children: depth < 2 ? convertChildren(c.children, f, frames, warn, depth + 1) : [],
    });
  }
  out.sort((a, b) => a.z - b.z);
  return out;
}

async function main() {
  await ensureSource();
  const src = { ...JSON.parse(fs.readFileSync(DATA, "utf8")), ...EXTRA };
  const frames = loadFrameIndex();
  const used = new Set(
    JSON.parse(fs.readFileSync(path.join(ROOT, "scan-report.json"), "utf8")).ids.map((e) => e.id),
  );

  const toolbox = loadToolbox();

  const warnings = new Set();
  const warn = (m) => warnings.add(m);

  const defs = [];
  const editorOnly = [];
  let missingFrame = 0, notInSource = 0, fromToolbox = 0;
  for (const id of [...used].sort((a, b) => a - b)) {
    // `EffectGameObject`s whose editor icon has no `edit_` prefix: the
    // keyframe marker (3032, `KeyframeGameObject`) drew its cyan numbered
    // circle in play — Dash's 51 % room (2.2 playthrough shows none)
    if (EFFECT_OBJECT_IDS.has(id)) { editorOnly.push(id); continue; }
    let o = src[id];
    if (!o) {
      const frame = toolbox.get(id);
      if (!frame) { notInSource++; continue; }
      if (frame.startsWith("edit_")) { editorOnly.push(id); continue; }
      // deco, and defaults matching the game's own: OBJ colour channel, the
      // decoration z layer. See loadToolbox() for why deco specifically.
      o = {
        texture_name: frame, object_type: 7, color_channel: "base",
        default_primary_channel: 1004, default_secondary_channel: -1,
        default_z_layer: 3, default_z_order: 1, children: [],
      };
      fromToolbox++;
    }
    let f = frames.get(o.texture_name);
    if (!f) {
      // OpenGD has an entry for this id, but names a frame that is in no sheet
      // we load. That used to end here and the object was dropped — which is
      // how ids 123-128 and 461-466 went missing: OpenGD calls them
      // `d_thorn2_0N_001.png`, a name that exists in no 2.2 atlas, while the
      // game's own toolbox calls the same ids `d_thorn_0N_001.png`, which is
      // in GJ_GameSheet-hd. Where the two disagree AND OpenGD's name does not
      // resolve, the game's own table wins on the *name only* — OpenGD keeps
      // supplying type/colour/z-order/children, which the toolbox has no idea
      // about. If neither resolves, the object is still dropped and warned.
      const alt = toolbox.get(id);
      if (alt && alt.startsWith("edit_")) {
        // both sources agree it has no world art: invisible on purpose
        editorOnly.push(id);
        continue;
      }
      const altFrame = alt ? frames.get(alt) : null;
      if (altFrame) {
        warn(`id ${id}: OpenGD's "${o.texture_name}" is in no sheet; `
          + `using the game's own "${alt}"`);
        o = { ...o, texture_name: alt };
        f = altFrame;
        fromToolbox++;
      } else {
        missingFrame++;
        warn(`id ${id}: frame not in any sheet: ${o.texture_name}`);
        continue;
      }
    }
    defs.push({
      id,
      frame: o.texture_name,
      sheet: f.sheet,
      type: o.object_type,
      kind: KIND_BY_TYPE[o.object_type] ?? "deco",
      color: slot(o.color_channel),
      primaryCh: o.default_primary_channel ?? -1,
      secondaryCh: o.default_secondary_channel ?? -1,
      zLayer: o.default_z_layer ?? 1,
      zOrder: o.default_z_order ?? 0,
      children: untinted(id, convertChildren(o.children, f, frames, warn)),
    });
  }

  // Default channels read from the game itself where OpenGD's table is wrong:
  // the native object dumps (gd-ui-capture `objects`, 2026-09-27) report the
  // GJBeast (918, Geometrical Dominator 50%) as main 1010 (black) + detail
  // 1011 (white) — OpenGD had one base-coloured frame, a white claw. Its white
  // parts are the matching `_glow` frame, drawn as the detail colour behind.
  const NATIVE_CHANNELS = { 918: { primaryCh: 1010, secondaryCh: 1011, glow: "GJBeast01_01_glow_001.png" } };
  for (const d of defs) {
    const n = NATIVE_CHANNELS[d.id];
    if (!n) continue;
    d.primaryCh = n.primaryCh;
    d.secondaryCh = n.secondaryCh;
    const gf = frames.get(n.glow);
    if (gf && !d.children.some((c) => c.frame === n.glow)) {
      d.children.push({ frame: n.glow, sheet: gf.sheet, dx: 0, dy: 0, z: -1, color: "detail",
        r: 255, g: 255, b: 255, flipX: false, flipY: false, rot: 0, scaleX: 1, scaleY: 1, children: [] });
    }
  }

  // --- the detail (colour) sprite, from the game rather than from OpenGD ---
  //
  // Every `GameObject` has a `m_colorSprite`: the game's second colour surface
  // for that object, which for art that ships a `_color` overlay *is* that
  // overlay. OpenGD models it as an ordinary child with a baked editor tint and
  // sometimes the wrong frame (453's child was `d_link_b_02_color` where the
  // game draws `d_link_c_01_color`), and for the 2.2 pixel art it models it not
  // at all.
  //
  // Two dumps carry the real node, and they are used in that order:
  //
  //  - `data/native-color-sprites.json`, built by `gen-color-sprites.mjs` from
  //    the mod's per-instance `sprites` dumps. Live and exact, but it only
  //    covers the ids near the captured frames.
  //  - `data/native-geometry.jsonl`, the per-id `geometry` dump, for the rest.
  //    Its colour sprite is the same node seen at the first instance of the id,
  //    and in every id the two sources overlap the geometry dump caught it
  //    before the game had parented it: loose in the layer on the object's own
  //    position at z 0, where the live dump has it a child at the object's
  //    centre at z ±100. Same sprite, same size, so it is read as centred with
  //    the z it reports.
  //
  // The frame follows the object's own by name (`<base>_001` -> `<base>_color_001`),
  // which is how the sheets name the pair, and the content size is checked
  // against the dump because a name that matched by accident would silently
  // repaint the object.
  //
  // The 2.2 pixel art also draws in the player's own channels, not the OBJ one:
  // the native `objects` dump reports `m_defaultColorID` 1 and 2 for every one
  // of them (2032, 2888, 3000 and the pixel ids at x=9500). Their detail
  // overlay sits at z +100, measured on 17 of the 18 pixel objects in the
  // x=2301 `sprites` dump; the eighteenth (1936, a flame rather than pixel
  // art) is -100, and the geometry dump already has that one parented. The
  // ids below the pixel family that are *not* in that dump take the measured
  // +100, since the geometry dump caught theirs unparented at z 0.
  const PIXEL_DETAIL_CHANNELS = new Set([
    2032, 2888, 3000, 1936, 2065,
    2255, 2306, 2310, 2312, 2315, 2360, 2361, 2364, 2538, 2540, 2542,
    2546, 2548, 2550, 2551, 2554, 2578, 2598, 2600, 2601, 2602, 2603,
    2629, 2630, 2632, 4318, 4321, 4322,
  ]);
  const PIXEL_DETAIL_Z = 100;

  // The one colour sprite whose art is not named `<base>_color`: the flame
  // (1936). The x=2301 `sprites` dump gives its node exactly — a 12x17 child on
  // the object's centre at z -100, carrying its own 12x17 child on *its* centre
  // at scale 2 and z -1, which is the inner core. Both are
  // `fire_b_01_2_001`, a thirteen-frame sequence beside the main flame's
  // thirteen, so they run in step; the child is the detail colour (channel 57,
  // which the object names in key 21 for both slots) and the grandchild
  // follows it. Sizes confirm the identification: `fire_b_01_NNN` is 49x68 px =
  // 24.5x34 world units, the dump's own 25x34 content box, and
  // `fire_b_01_2_NNN` is 24x34 px = 12x17, the child's.
  const NAMED_OVERRIDES = {
    1936: {
      frame: "fire_b_01_2_001.png", z: -100, dx: 0, dy: 0, color: "detail",
      children: [{
        frame: "fire_b_01_2_001.png", z: -1, dx: 0, dy: 0, color: "detail",
        scaleX: 2, scaleY: 2,
      }],
    },
  };
  const live = fs.existsSync(COLOR_SPRITES)
    ? JSON.parse(fs.readFileSync(COLOR_SPRITES, "utf8")) : {};
  const native = loadNative();
  let colorFixed = 0, colorAdded = 0, colorUnknown = 0, colorLive = 0;
  const offsetClamped = [];
  for (const d of defs) {
    const g = native.get(d.id);
    const geom = g?.colorSprite;
    const liveCs = live[d.id];
    const cs = liveCs ?? geom;
    if (!cs) continue;
    const name = d.frame.replace(/_001\.png$/, "_color_001.png");
    const over = NAMED_OVERRIDES[d.id];
    const f = over ? frames.get(over.frame) : name === d.frame ? undefined : frames.get(name);
    // the game's own content box is the atlas source box in world units
    if (!f || Math.abs(f.w - cs.w) > 0.6 || Math.abs(f.h - cs.h) > 0.6) { colorUnknown++; continue; }
    if (liveCs) colorLive++;
    if (over) {
      const build = (o, kidOf) => {
        const cs2 = frames.get(o.frame);
        return {
          frame: o.frame, sheet: cs2.sheet, dx: o.dx, dy: o.dy, z: o.z, color: o.color,
          r: 255, g: 255, b: 255, flipX: false, flipY: false, rot: 0,
          scaleX: o.scaleX ?? 1, scaleY: o.scaleY ?? 1,
          children: (o.children ?? []).map((c) => build(c)),
        };
      };
      const dupe = d.children.findIndex((c) => c.frame.includes("_color") || c.frame === over.frame);
      const built = build(over);
      if (dupe >= 0) d.children[dupe] = built; else d.children.push(built);
      d.children.sort((a, b) => a.z - b.z);
      colorAdded++;
      if (PIXEL_DETAIL_CHANNELS.has(d.id)) { d.primaryCh = 1; d.secondaryCh = 2; }
      continue;
    }
    // A node's position locates its anchor, not its centre, and a *child* states
    // it in the parent's bottom-left-origin frame — the correction
    // `gen-native-geometry.mjs` applies. A `sprites` dump always reads the node
    // through the object, so it is a child. The geometry dump caught the colour
    // sprite before the game had parented it, loose in the layer on the
    // object's own position, which reads as an offset of nothing.
    const isChild = liveCs !== undefined || nativeKids(g).some((c) => sameSprite(c, cs));
    const loose = !liveCs && cs.x === g.self.x && cs.y === g.self.y;
    let [dx, dy] = isChild ? nativeOffset(cs, g.self)
      : loose ? [0, 0]
        : [+(cs.x - g.self.x).toFixed(2), +(cs.y - g.self.y).toFixed(2)];
    // A colour overlay lies on its own object. An offset bigger than the
    // object is a capture that caught the sprite in world space (4506's
    // "−15549.5, −698" is its level position): the pixel numbers in Dash's
    // 51 % room drew only their grey base, the cyan digit 15,000 units away.
    if (Math.abs(dx) > Math.max(f.w, cs.w, 30) || Math.abs(dy) > Math.max(f.h, cs.h, 30)) {
      offsetClamped.push(`${d.id} ${name} (${dx}, ${dy})`);
      dx = 0; dy = 0;
    }
    const child = {
      frame: name, sheet: f.sheet, dx, dy, z: cs.z, color: "detail",
      // no baked tint: the game draws this sprite in the detail channel alone,
      // and the cyan 150,255,255 of OpenGD's table is the editor's own
      r: 255, g: 255, b: 255,
      // A loose node (on the object's own position) reports its rotation in
      // world space, but the object's rotation is applied to its children, so
      // the child takes the difference. A child node is already relative.
      flipX: !!cs.fx, flipY: !!cs.fy,
      rot: loose ? (cs.rot ?? 0) - (g.self.rot ?? 0) : cs.rot ?? 0,
      scaleX: cs.sx ?? 1, scaleY: cs.sy ?? 1, children: [],
    };
    if (!isChild && PIXEL_DETAIL_CHANNELS.has(d.id)) child.z = PIXEL_DETAIL_Z;
    // where the colour sprite sits among the game's own child nodes decides
    // whether it replaces one of ours or is a child we never had
    const ours = nativeKids(g);
    const at = ours.findIndex((c) => sameSprite(c, cs));
    if (at >= 0 && at < d.children.length) {
      d.children[at] = { ...d.children[at], ...child };
      colorFixed++;
    } else {
      // A child of ours that is already an overlay of *some* colour is
      // OpenGD's model of this same node — 453's was `d_link_b_02_color`
      // where the game draws `d_link_c_01_color` — so replace it rather than
      // stack a second overlay on top.
      const dupe = d.children.findIndex((c) => c.frame.includes("_color"));
      if (dupe >= 0) d.children[dupe] = { ...d.children[dupe], ...child };
      else { d.children.push(child); colorAdded++; }
    }
    d.children.sort((a, b) => a.z - b.z);
    if (PIXEL_DETAIL_CHANNELS.has(d.id)) { d.primaryCh = 1; d.secondaryCh = 2; }
  }

  // --- the scaled copy behind the pixel items (Dash's 51 % room digits) ---
  //
  // The `geometry` dump lists, for 4401 and 4506-4508, one visible child node
  // of the main sprite's own size at scale 1.875 and z -1, beside the 1x colour
  // sprite. A 2.2 playthrough shows the cyan digits about twice the size the
  // port drew (BUGS [OPEN] 51 % room digits): the child is the visible glyph,
  // the main and colour sprites sit inside it. No other id has a child of its
  // own size at a scale above 1.5. The frame is the main sprite's (the sizes
  // match the dump to the unit) and it takes the main colour.
  let bigKids = 0;
  for (const d of defs) {
    const g = native.get(d.id);
    const kid = g && nativeKids(g).find((c) => c.sx > 1.5 && c.sx === c.sy
      && c.z < 0 && Math.abs(c.w - g.self.w) < 0.6 && Math.abs(c.h - g.self.h) < 0.6);
    if (!kid || d.children.some((c) => c.frame === d.frame)) continue;
    d.children.push({
      frame: d.frame, sheet: d.sheet, dx: 0, dy: 0, z: kid.z, color: "base",
      r: 255, g: 255, b: 255, flipX: false, flipY: false, rot: 0,
      scaleX: kid.sx, scaleY: kid.sy, children: [],
    });
    d.children.sort((a, b) => a.z - b.z);
    bigKids++;
  }
  console.log(`scaled copies of the main sprite: ${bigKids}`);

  const lit = (d) => {
    const kids = d.children.length ? `, children: ${JSON.stringify(d.children)}` : "";
    const op = d.opacity !== undefined ? `, opacity: ${d.opacity}` : "";
    return `  [${d.id}, { frame: ${JSON.stringify(d.frame)}, sheet: "${d.sheet}", type: ${d.type}` +
      `, kind: "${d.kind}", color: "${d.color}", primaryCh: ${d.primaryCh}` +
      `, secondaryCh: ${d.secondaryCh}, zLayer: ${d.zLayer}, zOrder: ${d.zOrder}${op}${kids} }],`;
  };

  // Saw 88 is one half-blade (\`sawblade_01\`, trimmed to the left half of a
  // 167x164 px source) and a second copy turned 180° about the object's
  // centre: OpenGD's (1.68, 1.5) child offset left a slit between the halves
  // that showed the cog behind as a light streak once the player-colour cog
  // blended (Theory of Everything 9%); a 1080p 2.2 recording (YouTube
  // y3EFoKZd2js) shows a seamless blade. Turned about the centre, the halves
  // meet exactly.
  // 668 (`d_pixelArt01_001`, Theory of Everything 2's background machinery)
  // draws at opacity 0.4 in a native capture round (BUGS.md BUG-12,
  // 2026-09-27, L9/13/16/18/19/20 at 25/50/75%) with no opacity key, group, or
  // `customSetup` difference from 669, which draws at full opacity in the same
  // dump. Not decoded further (no mechanism found); pinned to the measured
  // value.
  for (const d of defs) {
    if (d.id === 668) d.opacity = 0.4;
  }
  for (const d of defs) {
    if (d.id === 88 && d.children?.[0]?.frame === "sawblade_01_001.png") {
      d.children[0].dx = 0;
      d.children[0].dy = 0;
    }
  }
  // The 2.2 pixel-art class (data/pixel-art-ids.json, from the emulated
  // customSetup): default main channel 1, and detail 2 exactly when the object
  // has a colour sprite — the native dumps' defCh/defDCh for every member they
  // show. The table had 1004 / none for most of them, so a colour sprite fell
  // back to the main colour: Dash's lava platforms (2489–2491, key 22 = 133
  // yellow) drew solid red where the 2.2 playthrough has yellow highlights.
  {
    const pix = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "pixel-art-ids.json"), "utf8")).ids);
    for (const d of defs) {
      if (!pix.has(d.id)) continue;
      d.primaryCh = 1;
      d.secondaryCh = (d.children ?? []).some((c) => c.color === "detail") ? 2 : -1;
    }
  }
  // Default channels the native object dumps show and no rule above gives
  // (captures-2026-09-29 objs-*.csv, defCh/defDCh): the flame and two 2.2
  // animated decorations.
  for (const d of defs) {
    if (d.id === 1936) { d.primaryCh = 1011; d.secondaryCh = 1; }
    if (d.id === 2041 || d.id === 2042) d.primaryCh = 1;
  }
  const out = `// GENERATED by scripts/gen-objects.mjs — do not edit by hand.
// Object-id -> sprite-frame table for the ids used by the 22 classic levels.
// Mapping data derived from OpenGD's Content/Custom/object.json (GPL-3.0);
// frame names/sizes resolved against the original -hd atlases in public/assets.
//
// Coverage: ${defs.length} of ${used.size} ids used by the main levels
// (${fromToolbox} of them from the game's own ObjectToolbox table — see
// scripts/gen-toolbox.mjs), plus ${editorOnly.length} ids that are invisible
// triggers and are listed in EDITOR_ONLY_IDS rather than skipped as unknown.
// Anything still absent is skipped by the renderer with a one-time warning.

/** which atlas a frame lives in */
export type SheetName = ${[...SHEETS.map(([k]) => k), ...EXTRA_SHEETS].map((k) => `"${k}"`).join(" | ")};

/** which colour slot tints a sprite ("none" = untinted white) */
export type ColorSlot = "base" | "detail" | "black" | "none";

export type ObjectKind =
  | "solid" | "hazard" | "deco" | "slope" | "portal"
  | "pad" | "orb" | "speed" | "coin";

export interface ChildDef {
  frame: string;
  sheet: SheetName;
  /** offset from the parent's centre, in world units */
  dx: number;
  dy: number;
  /** draw order within the parent object */
  z: number;
  color: ColorSlot;
  /** baked tint, used when the colour slot resolves to nothing */
  r: number; g: number; b: number;
  flipX: boolean;
  flipY: boolean;
  /** degrees, CW positive (same convention as object property 6) */
  rot: number;
  scaleX: number;
  scaleY: number;
  children: ChildDef[];
}

export interface ObjectDef {
  frame: string;
  sheet: SheetName;
  /** GameObjectType from the original game */
  type: number;
  kind: ObjectKind;
  color: ColorSlot;
  /** default colour channel when property 21 is absent (-1 = none) */
  primaryCh: number;
  /** default colour channel when property 22 is absent (-1 = none) */
  secondaryCh: number;
  zLayer: number;
  zOrder: number;
  /** multiplies the resolved colour's alpha; absent means 1 (no change) */
  opacity?: number;
  children?: ChildDef[];
}

export const OBJECT_DEFS: Map<number, ObjectDef> = new Map([
${defs.map(lit).join("\n")}
]);

/**
 * Ids whose only sprite in the game is an **editor icon** (\`edit_*\` in
 * \`ObjectToolbox\`), i.e. objects invisible during play: every trigger, plus
 * the old enter-effect objects. They are not missing art — skipping them is
 * correct — so the renderer skips them without the "no definition" warning.
 */
export const EDITOR_ONLY_IDS: ReadonlySet<number> = new Set([${editorOnly.join(", ")}]);

/**
 * Gameplay objects that are **invisible in play** although they have art: the
 * 2.2 special blocks D (1755), J (1813), S (1829), H (1859) and 1860, whose
 * \`blockOutline\` sprite is only the editor's lettered square. They still act on
 * the player (see \`SPECIAL_BLOCKS\` in collision.ts); the renderer skips them.
 * Not 1751 — that id is the gravity dash orb, which is drawn.
 */
export const INVISIBLE_GAMEPLAY_BLOCKS: ReadonlySet<number> = new Set([1755, 1813, 1829, 1859, 1860, 2866]);
`;
  fs.writeFileSync(OUT, out);

  process.stderr.write(
    `wrote ${path.relative(ROOT, OUT)}: ${defs.length}/${used.size} ids ` +
    `(${fromToolbox} from ObjectToolbox, ${editorOnly.length} editor-only, ` +
    `${notInSource} not in any source, ${missingFrame} with unresolved frames)\n` +
    `  detail sprite: ${colorFixed} placed where we had one, ${colorAdded} added, ` +
    `${colorLive} of them laid out from the live per-instance dump, ` +
    `${colorUnknown} ids with no matching overlay frame\n`,
  );
  for (const w of [...warnings].slice(0, 15)) process.stderr.write(`  warn: ${w}\n`);
  if (warnings.size > 15) process.stderr.write(`  ... ${warnings.size - 15} more warnings\n`);
}

await main();
