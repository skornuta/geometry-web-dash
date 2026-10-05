import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseAtlas } from "../src/engine/atlas.ts";
import { decodeLevelString } from "../src/gd/level.ts";
import { OBJECT_DEFS, INVISIBLE_GAMEPLAY_BLOCKS, type ChildDef, type SheetName } from "../src/gd/objects.ts";
// imported, not re-declared: a private copy of this map silently drifted when
// PixelSheet_01 was added and every frame in the new sheet looked "missing"
import { SHEET_FILES } from "../src/gd/sheets.ts";
import { CHILD_OFFSETS } from "../src/gd/nativeGeometry.ts";

test("Dash's circular glow places its mirrored quarters around their corner anchors", () => {
  // Native 1888: four 30x30 children at (0,0), anchor (1,0),
  // with scales (+,+),(-,+),(-,-),(+,-). Their centers must occupy
  // four different quadrants; stacking them creates an opaque square.
  assert.deepEqual(CHILD_OFFSETS.get(1888), [
    [-15, 15], [15, 15], [15, -15], [-15, -15],
  ]);
});

const atlases = new Map<string, Map<string, unknown>>();

test("the detail overlay comes from the game's own dump, not OpenGD's child", () => {
  // The mod's `geometry` dump lists id 453's colour sprite as a node the port
  // never drew: OpenGD's child named it `d_link_b_02_color_001.png`, while the
  // game draws the object's own `d_link_c_01_color_001.png`, centred on it, in
  // the detail channel and with no editor tint.
  const link = OBJECT_DEFS.get(453)!;
  assert.equal(link.frame, "d_link_c_01_001.png");
  const detail = link.children?.find((c) => c.color === "detail");
  assert.equal(detail?.frame, "d_link_c_01_color_001.png");
  assert.deepEqual([detail?.dx, detail?.dy, detail?.z], [0, 0, 0]);
  // OpenGD's baked 150,255,255 is the editor's own tint, not the game's
  assert.deepEqual([detail?.r, detail?.g, detail?.b], [255, 255, 255]);
  // and it replaced the stale child rather than stacking on top of it
  assert.equal(link.children?.length, 1);
});

test("every colour overlay the game records is drawn, in the detail channel", () => {
  // The game gives every GameObject a `m_colorSprite`, and for art that ships a
  // `_color` overlay that overlay is it — but not for every object: the native
  // dump records none at all for 40, 144, 205, 459, 675-677, 1795 and 1903,
  // so the atlas having the frame is not enough. This checks the rule the
  // generator follows: where the dump records one whose content size the atlas
  // frame matches, the object draws it.
  const live = JSON.parse(fs.readFileSync("data/native-color-sprites.json", "utf8")) as
    Record<string, { w: number; h: number }>;
  const geom = new Map<number, { w: number; h: number }>();
  for (const line of fs.readFileSync("data/native-geometry.jsonl", "utf8").split("\n")) {
    if (!line.trim()) continue;
    const g = JSON.parse(line);
    if (g.colorSprite && !geom.has(g.id)) {
      geom.set(g.id, { w: g.colorSprite.w, h: g.colorSprite.h });
    }
  }
  const missing: number[] = [];
  let checked = 0;
  for (const [id, def] of OBJECT_DEFS) {
    const name = def.frame.replace(/_001\.png$/, "_color_001.png");
    if (name === def.frame) continue;
    const f = atlas(def.sheet).get(name) as { sourceW: number; sourceH: number } | undefined;
    if (!f) continue;
    const cs = live[id] ?? geom.get(id);
    if (!cs) continue;                       // the game draws no overlay here
    if (Math.abs(f.sourceW / 2 - cs.w) > 0.6 || Math.abs(f.sourceH / 2 - cs.h) > 0.6) continue;
    checked++;
    const detail = def.children?.find((c) => c.color === "detail" && c.frame === name);
    if (!detail) missing.push(id);
  }
  assert.ok(checked >= 120, `only ${checked} overlay ids were checked`);
  assert.deepEqual(missing, [], `ids whose colour overlay is not drawn: ${missing.join(" ")}`);
});

test("Dash lava blocks retain the native second color layer", () => {
  // Live native sprites at x=2301.897461: 2540 has its color sprite at
  // (8,8) in a 16x16 parent, z=100. 2550 and 2546 use the same layout.
  // objects dump reports default channels 1/2, not OBJ/no-detail.
  for (const [id, frame] of [
    [2540, "pixelart_440_color_001.png"],
    [2546, "pixelart_446_color_001.png"],
    [2550, "pixelart_450_color_001.png"],
    // Remaining pixel pairs in the x=9500 native objects dump; their
    // centered detail geometry is also in data/native-geometry.jsonl.
    [2312, "pixelart_212_color_001.png"],
    [2598, "pixelart_498_color_001.png"],
    [2603, "pixelart_503_color_001.png"],
    [2630, "pixelart_530_color_001.png"],
    [4318, "pixelart_1518_color_001.png"],
    [4321, "pixelart_1521_color_001.png"],
    [4322, "pixelart_1522_color_001.png"],
  ] as const) {
    const def = OBJECT_DEFS.get(id)!;
    const detail = def.children?.find(c => c.color === "detail");
    assert.ok(detail, `id ${id} is missing its lava detail layer`);
    assert.equal(detail.frame, frame);
    assert.equal(detail.sheet, "pixel");
    assert.deepEqual([detail.dx, detail.dy, detail.z], [0, 0, 100]);
    assert.deepEqual([def.primaryCh, def.secondaryCh], [1, 2]);
  }
});
function atlas(sheet: SheetName) {
  const file = SHEET_FILES[sheet];
  if (!atlases.has(file)) {
    atlases.set(file, parseAtlas(fs.readFileSync(`public/assets/${file}.plist`, "utf8")));
  }
  return atlases.get(file)!;
}

test("every frame referenced by the object table exists in its sheet", () => {
  const missing: string[] = [];
  const checkChildren = (kids: ChildDef[] | undefined, id: number) => {
    for (const c of kids ?? []) {
      if (!atlas(c.sheet).has(c.frame)) missing.push(`id ${id} child ${c.frame} (${c.sheet})`);
      checkChildren(c.children, id);
    }
  };
  for (const [id, def] of OBJECT_DEFS) {
    if (!atlas(def.sheet).has(def.frame)) missing.push(`id ${id} ${def.frame} (${def.sheet})`);
    checkChildren(def.children, id);
  }
  assert.deepEqual(missing, [], `unresolved frames:\n${missing.join("\n")}`);
});

test("known object ids map to the frames the original game uses", () => {
  // spot checks that caught bad guesses before: 9 is a pit (not a spike),
  // 15-17 are rods (not slopes), 12/13 are the 3rd/4th portal fronts.
  const expected: Record<number, string> = {
    1: "square_01_001.png",
    5: "square_05_001.png",
    8: "spike_01_001.png",
    9: "pit_02_001.png",
    12: "portal_03_front_001.png",
    13: "portal_04_front_001.png",
    15: "rod_01_001.png",
    17: "rod_03_001.png",
    18: "d_spikes_01_001.png",
    39: "spike_02_001.png",
    40: "colorPlank_01_001.png",
    103: "spike_03_001.png",
    142: "secretCoin_01_001.png",
  };
  for (const [id, frame] of Object.entries(expected)) {
    assert.equal(OBJECT_DEFS.get(Number(id))?.frame, frame, `object id ${id}`);
  }
});

test("Stereo Madness is fully covered apart from its triggers", async () => {
  const level = await decodeLevelString(fs.readFileSync("public/assets/levels/1.txt", "utf8"));
  const unknown = new Set<number>();
  let covered = 0;
  for (const o of level.objects) {
    if (OBJECT_DEFS.has(o.id)) covered++;
    else unknown.add(o.id);
  }
  // 22/23/27 and the 29/30 colour triggers are invisible, so they need no frame
  assert.deepEqual([...unknown].sort((a, b) => a - b), [22, 23, 27, 29, 30]);
  assert.ok(covered / level.objects.length > 0.99, `only ${covered}/${level.objects.length} covered`);
});

test("orb and pad ids map to the art whose colour matches their name", () => {
  // These were guessed once and were wrong: the blue orb drew the orange ring,
  // the pink orb drew the cyan gravity ring, and the red orb drew the magenta
  // one — so every orb but the yellow behaved and looked like a different orb.
  //
  // Pinned by OpenGD's `GameObject.cpp` id switch (which names each orb and the
  // particle tint it applies) cross-checked against the colour painted into the
  // -hd atlas art, measured by cropping each frame:
  //   ring_01 #ffeb45 yellow      ring_02 #ff9a0d orange/red
  //   ring_03 #ff45ff magenta     gravring_01 #40ffff cyan
  //   gravJumpRing_01 #5cff2a     bump_01 yellow / bump_02 orange
  //   bump_03 magenta             gravbump_01 cyan
  const expected: Record<number, string> = {
    36: "ring_01_001.png",          // yellow orb
    84: "gravring_01_001.png",      // blue / gravity orb
    141: "ring_03_001.png",         // pink orb
    1022: "gravJumpRing_01_001.png",// green orb
    1330: "dropRing_01_001.png",    // black / drop orb
    1333: "ring_02_001.png",        // red orb
    35: "bump_01_001.png",          // yellow pad
    140: "bump_03_001.png",         // pink pad
    67: "gravbump_01_001.png",      // blue / gravity pad
    1332: "bump_02_001.png",        // red pad
  };
  for (const [id, frame] of Object.entries(expected)) {
    const def = OBJECT_DEFS.get(Number(id));
    assert.ok(def, `id ${id} missing from the object table`);
    assert.equal(def.frame, frame, `id ${id} should draw ${frame}`);
  }
});

test("slope children carry no baked editor tint, so they follow their channel like the parent", () => {
  for (const id of [1743, 1744, 1746, 1758, 1759]) {
    const def = OBJECT_DEFS.get(id)!;
    assert.ok(def.children?.length, `${id} has children`);
    for (const c of def.children!) {
      assert.deepEqual([c.r, c.g, c.b], [255, 255, 255], `${id} child ${c.frame}`);
      assert.notEqual(c.color, "none", `${id} child ${c.frame} is channel-coloured`);
    }
  }
});

test("the 2.2 special blocks are invisible in play, and the gravity dash orb is not", () => {
  for (const id of [1755, 1813, 1829, 1859]) assert.ok(INVISIBLE_GAMEPLAY_BLOCKS.has(id), `${id}`);
  assert.equal(INVISIBLE_GAMEPLAY_BLOCKS.has(1751), false, "1751 is the gravity dash orb");
  assert.equal(OBJECT_DEFS.get(1751)?.kind, "orb");
});
