// Tests for the icon kit tables (src/gd/icons.ts).
//
// These pin the two things that silently produce a blank player if wrong: the
// per-gamemode frame *naming* (each mode spells its prefix differently, and
// robot/spider add a body-part number), and the palette bounds.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_COLORS, ICON_COUNTS, ICON_TABS, iconFrames, playerColor, clampIcon,
  LIMB_MODES, LIMB_COUNT, playerGlow,
} from "../src/gd/icons.ts";

test("the palette is all 107 colours GameManager::colorForIdx returns", () => {
  // Decoded from the jump table at 0x1007223fe; see the comment on
  // PLAYER_COLORS and docs/ui-parity/REFERENCE.md §6.1.
  assert.equal(PLAYER_COLORS.length, 107);
  assert.deepEqual([...PLAYER_COLORS[0]], [125, 255, 0], "index 0 is the default green");
  assert.deepEqual([...PLAYER_COLORS[15]], [0, 0, 0], "index 15 is black");
  assert.deepEqual([...PLAYER_COLORS[106]], [118, 189, 255], "index 106 is the last one");
  for (const c of PLAYER_COLORS) {
    assert.equal(c.length, 3);
    for (const ch of c) assert.ok(ch >= 0 && ch <= 255, `${ch} is a byte`);
  }
});

test("extending the palette did not move any index a save could hold", () => {
  // The table this file used to stop at, verbatim. Every saved col1/col2 is an
  // index into it, so all 42 must still mean exactly what they meant.
  const BEFORE = [
    [125, 255, 0], [0, 255, 0], [0, 255, 125], [0, 255, 255],
    [0, 125, 255], [0, 0, 255], [125, 0, 255], [255, 0, 255],
    [255, 0, 125], [255, 0, 0], [255, 125, 0], [255, 255, 0],
    [255, 255, 255], [185, 0, 255], [255, 185, 0], [0, 0, 0],
    [0, 200, 255], [175, 175, 175], [90, 90, 90], [255, 125, 125],
    [0, 175, 75], [0, 125, 125], [0, 75, 175], [75, 0, 175],
    [125, 0, 125], [175, 0, 75], [175, 75, 0], [125, 125, 0],
    [75, 175, 0], [255, 75, 0], [150, 50, 0], [150, 100, 0],
    [100, 150, 0], [0, 150, 100], [0, 100, 150], [100, 0, 150],
    [150, 0, 100], [150, 0, 0], [0, 150, 0], [0, 0, 150],
    [125, 255, 175], [125, 125, 255],
  ];
  for (const [i, c] of BEFORE.entries()) {
    assert.deepEqual([...PLAYER_COLORS[i]], c, `index ${i} moved`);
  }
});

test("playerColor normalises to 0..1 and clamps out-of-range indices", () => {
  assert.deepEqual(playerColor(1), { r: 0, g: 1, b: 0 });
  assert.deepEqual(playerColor(15), { r: 0, g: 0, b: 0 });
  // a corrupt save must not produce NaN tints
  assert.deepEqual(playerColor(-5), playerColor(0));
  assert.deepEqual(playerColor(9999), playerColor(PLAYER_COLORS.length - 1));
});

test("each gamemode spells its frames its own way", () => {
  assert.equal(iconFrames("cube", 1).main, "player_01_001.png");
  assert.equal(iconFrames("ship", 3).main, "ship_03_001.png");
  assert.equal(iconFrames("ball", 12).main, "player_ball_12_001.png");
  assert.equal(iconFrames("ufo", 7).main, "bird_07_001.png");
  assert.equal(iconFrames("wave", 2).main, "dart_02_001.png");
  assert.equal(iconFrames("swing", 1).main, "swing_01_001.png");
  // the detail layer is always the `_2_` sibling
  assert.equal(iconFrames("cube", 1).detail, "player_01_2_001.png");
  assert.equal(iconFrames("ufo", 7).detail, "bird_07_2_001.png");
});

test("robot and spider are built from four numbered body parts", () => {
  assert.deepEqual([...LIMB_MODES].sort(), ["robot", "spider"]);
  assert.equal(LIMB_COUNT, 4);
  assert.equal(iconFrames("robot", 1, 1).main, "robot_01_01_001.png");
  assert.equal(iconFrames("robot", 1, 4).main, "robot_01_04_001.png");
  assert.equal(iconFrames("spider", 2, 3).main, "spider_02_03_001.png");
  // each body part has its own glow frame
  assert.equal(iconFrames("robot", 1, 1).glow, "robot_01_01_glow_001.png");
});

test("every icon names its own glow frame, and every shipped sheet has it", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  assert.equal(iconFrames("cube", 1).glow, "player_01_glow_001.png");
  assert.equal(iconFrames("ufo", 7).glow, "bird_07_glow_001.png");
  const sheet: Record<string, string> = {
    cube: "player", ship: "ship", ball: "player_ball", ufo: "bird",
    wave: "dart", robot: "robot", spider: "spider", swing: "swing",
  };
  for (const mode of ICON_TABS) {
    for (let i = 1; i <= ICON_COUNTS[mode]; i++) {
      const file = `public/assets/icons/${sheet[mode]}_${String(i).padStart(2, "0")}-hd.plist`;
      if (!existsSync(file)) continue; // the older half lives in GJ_GameSheetIcons
      const f = iconFrames(mode, i);
      assert.ok(readFileSync(file, "utf8").includes(f.glow.replace(".png", "")), `${file} lacks ${f.glow}`);
    }
  }
});

test("the player glow: strong colour 2, visible with the kit's glow or a black colour 1", () => {
  const green: [number, number, number] = [125, 255, 0];
  const cyan: [number, number, number] = [0, 255, 255];
  const off = playerGlow(false, green, cyan);
  assert.equal(off.visible, false);
  assert.deepEqual([off.r, off.g, off.b], [0, 1, 1]);
  assert.equal(playerGlow(true, green, cyan).visible, true);
  // a black icon always glows, so it does not vanish
  assert.equal(playerGlow(false, [0, 0, 0], cyan).visible, true);
  // both colours black: white (`SimplePlayer::updateColors` +140..164)
  const bb = playerGlow(false, [0, 0, 0], [0, 0, 0]);
  assert.deepEqual([bb.r, bb.g, bb.b], [1, 1, 1]);
});

test("only the UFO has a dome layer", () => {
  assert.equal(iconFrames("ufo", 1).dome, "bird_01_3_001.png");
  assert.equal(iconFrames("cube", 1).dome, undefined);
  assert.equal(iconFrames("ship", 1).dome, undefined);
});

test("indices are zero-padded to two digits, as the atlas spells them", () => {
  assert.equal(iconFrames("cube", 9).main, "player_09_001.png");
  assert.equal(iconFrames("cube", 10).main, "player_10_001.png");
  assert.equal(iconFrames("cube", 100).main, "player_100_001.png");
});

test("clampIcon keeps a corrupt or out-of-range save inside the real range", () => {
  assert.equal(clampIcon("cube", 0), 1);
  assert.equal(clampIcon("cube", -3), 1);
  assert.equal(clampIcon("cube", 1e9), ICON_COUNTS.cube);
  assert.equal(clampIcon("swing", 500), ICON_COUNTS.swing);
  assert.equal(clampIcon("swing", 5), 5, "2.2 has 43 swings, not the legacy atlas's one");
  assert.equal(clampIcon("cube", NaN), 1, "NaN must not escape as a frame name");
  // and iconFrames clamps the same way, so it can never name a missing frame
  assert.equal(iconFrames("swing", 99).main, `swing_${ICON_COUNTS.swing}_001.png`);
});

test("every icon count is the highest per-icon sheet actually shipped", async () => {
  const { existsSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { iconSheetBase } = await import("../src/gd/iconSheets.ts");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets", "icons");
  if (!existsSync(dir)) { console.warn("icons not copied yet, skipping"); return; }
  for (const t of ICON_TABS) {
    // the last icon exists, and the one after it does not — so the count is
    // neither short (half the catalogue, as the legacy atlas was) nor long
    const n = ICON_COUNTS[t];
    assert.ok(existsSync(join(dir, `${iconSheetBase(t, n)}.plist`)), `${t} ${n} is shipped`);
    assert.ok(!existsSync(join(dir, `${iconSheetBase(t, n + 1)}.plist`)), `${t} stops at ${n}`);
  }
});

test("every tab has a positive icon count and they cover all 8 gamemodes", () => {
  assert.equal(ICON_TABS.length, 8);
  for (const t of ICON_TABS) {
    assert.ok(ICON_COUNTS[t] >= 1, `${t} has at least one icon`);
  }
  assert.equal(new Set(ICON_TABS).size, 8, "no duplicate tabs");
});
