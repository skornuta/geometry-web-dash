// LevelSelectLayer's page colouring and LevelPage's frame naming, both read out
// of the shipping 2.2081 binary:
//
//   LevelSelectLayer::colorForPage   m1 0x3a6a44   (table at 0x100723ca0)
//   LevelSelectLayer::getColorValue  m1 0x3a67a0
//   LevelPage::updateDynamicPage     m1 0x3a4e60 +3396
//
// These replace the port's old hue-wheel page tint and its use of the
// `difficulty_NN_btn` frames, neither of which the original ever uses here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blendPageColor, colorForPage, diffFrame, pageColorRamp } from "../src/scenes/menu.ts";
import { PLAYER_COLORS } from "../src/gd/icons.ts";
import { LEVELS, DIFFICULTY_FRAME } from "../src/gd/levels.ts";

const close = (a: number, b: number, eps = 1e-4) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("page colours cycle through the sourced nine-entry table", () => {
  // [5, 7, 8, 9, 10, 11, 1, 3, 4] into GameManager::colorForIdx
  const expected = [5, 7, 8, 9, 10, 11, 1, 3, 4].map((i) => PLAYER_COLORS[i]);
  for (let page = 0; page < 22; page++) {
    assert.deepEqual(colorForPage(page), expected[page % 9], `page ${page}`);
  }
  // page 0 is blue, and the wheel really does repeat every nine pages
  assert.deepEqual(colorForPage(0), [0, 0, 255]);
  assert.deepEqual(colorForPage(9), colorForPage(0));
  assert.deepEqual(colorForPage(18), colorForPage(0));
});

test("a non-zero multiple of 22 is the dark page, and page 0 is not", () => {
  assert.deepEqual(colorForPage(22), [0x25, 0x2c, 0x34]);
  assert.deepEqual(colorForPage(44), [0x25, 0x2c, 0x34]);
  assert.notDeepEqual(colorForPage(0), [0x25, 0x2c, 0x34]);
});

test("the cross-fade holds, sweeps, then holds — it is not linear in the scroll", () => {
  // clamp(t / 0.6666667 - 0.2, 0, 1): flat until t = 2/15, done by t = 0.8
  close(pageColorRamp(0), 0);
  close(pageColorRamp(0.1), 0);
  close(pageColorRamp(2 / 15), 0);
  close(pageColorRamp(0.8), 1);
  close(pageColorRamp(0.95), 1);
  close(pageColorRamp(1), 1);
  // strictly increasing in between, and past the midpoint by half a page
  assert.ok(pageColorRamp(0.4) > pageColorRamp(0.3));
  assert.ok(pageColorRamp(0.5) > 0.4);
});

test("blending two pages lands exactly on each end colour", () => {
  assert.deepEqual(blendPageColor(0, 1, 0), [...colorForPage(0)]);
  assert.deepEqual(blendPageColor(0, 1, 1), [...colorForPage(1)]);
  const mid = blendPageColor(0, 1, 0.5);
  const a = colorForPage(0), b = colorForPage(1);
  for (let i = 0; i < 3; i++) {
    assert.ok(mid[i] >= Math.min(a[i], b[i]) && mid[i] <= Math.max(a[i], b[i]));
  }
});

test("level pages use diffIcon_NN_btn, not the difficulty_NN_btn family", () => {
  assert.equal(diffFrame("easy"), "diffIcon_01_btn_001.png");
  assert.equal(diffFrame("demon"), "diffIcon_06_btn_001.png");
  // every level in the table maps to one of the six
  const seen = new Set(LEVELS.map((l) => diffFrame(l.difficulty)));
  for (const f of seen) assert.match(f, /^diffIcon_0[1-6]_btn_001\.png$/);
  // and the two families are genuinely different frames
  assert.notEqual(diffFrame("easy"), DIFFICULTY_FRAME.easy);
});

test("an unknown difficulty falls back to the first face rather than a bad frame", () => {
  assert.equal(diffFrame("nonsense"), "diffIcon_01_btn_001.png");
});
