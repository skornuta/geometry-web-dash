// The vertical follow, against the native camera logs in
// docs/fidelity/traces (gd-ui-capture `seek`, `m_cameraPosition.y`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraBottomTarget, GD_Y_OFFSET } from "../src/gd/camera.ts";

/** cameraBottomTarget in game units (the port's y is the game's minus 90) */
const target = (mode: Parameters<typeof cameraBottomTarget>[0], y: number, flipped: boolean, cam: number, free = false) =>
  cameraBottomTarget(mode, y - GD_Y_OFFSET, flipped, 150, cam - GD_Y_OFFSET, 320, free) + GD_Y_OFFSET;

test("the deadzone is 70 above and 40 below the view centre", () => {
  assert.equal(target("cube", 43 + 160 + 70, false, 43), 43);
  assert.equal(target("cube", 43 + 160 + 80, false, 43), 53);
  assert.equal(target("cube", 243 + 160 - 40, false, 243), 243);
  assert.equal(target("cube", 243 + 160 - 50, false, 243), 233);
});

test("a flipped player keeps the upright margins (native Dash f634, x 1007-1250)", () => {
  // blue orb at x 855: the cube flips and rises to ~60 above the centre with
  // the camera still at 43.0 (native x 849)
  assert.equal(target("cube", 43 + 160 + 60, true, 43), 43);
});

test("the spider locks to its inherited centre, whatever the player does (native Dash x 975–1544)", () => {
  // the view's centre is 150 (default) so the bottom is 150 - 160 = -10 in port
  // units, i.e. 80 in game units; native holds 79.0 there (dash-full.txt)
  assert.equal(target("spider", 57.5 + 160 + 70, true, 57.5), 80);
  assert.equal(target("spider", 163.5, false, 79), 80);
  assert.equal(target("spider", 292.5, false, 79), 80);
});

test("free mode follows like the cube in every mode (native Dash ball/swing)", () => {
  assert.equal(target("swing", 215.8 + 160 + 55, false, 215.8, true), 215.8);
  assert.ok(Math.abs(target("ball", 72.6 + 160 + 80, false, 72.6, true) - 82.6) < 1e-9);
});

test("the view's bottom never goes below the floor", () => {
  assert.equal(target("cube", 105, false, 0), 0);
});
