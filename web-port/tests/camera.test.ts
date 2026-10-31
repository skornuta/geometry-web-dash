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

test("a flipped player swaps the margins: 40 above / 70 below the centre (real Dash run, Electroman x 20183)", () => {
  // upside down the camera follows a player more than 40 above the centre ...
  assert.equal(target("cube", 43 + 160 + 40, true, 43), 43);
  assert.equal(target("cube", 43 + 160 + 60, true, 43), 63);
  // ... and holds until it is 70 below
  assert.equal(target("cube", 243 + 160 - 70, true, 243), 243);
  assert.equal(target("cube", 243 + 160 - 80, true, 243), 233);
  // upright is unchanged
  assert.equal(target("cube", 43 + 160 + 60, false, 43), 43);
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

test("a free camera's margin comes from the portal's padding and the zoom", async () => {
  const { cameraBottomTarget, followRate, freeMargin } = await import("../src/gd/camera.ts");
  // Dash's swing portal (x 4641): padding 0.804447, easing 30. At zoom 0.6 the player may go 45 either
  // side of the centre, which the real swing rows fit (x 7560-8100: margins 45 / 45, divisor 30)
  assert.ok(Math.abs(freeMargin(0.804447, 0.6) - 45.05) < 0.01);
  assert.ok(Math.abs(freeMargin(0.804447, 1) - 27.03) < 0.01);
  // a player 40 above the centre of a view whose bottom is 0 (centre 160): inside 45, so the view holds
  assert.equal(cameraBottomTarget("swing", 200, false, 0, 0, 320, true, { padding: 0.804447, zoom: 0.6 }), 0);
  // 60 above the centre: 15 past the margin, so the view's bottom moves up by 15
  assert.ok(Math.abs(cameraBottomTarget("swing", 220, false, 0, 0, 320, true, { padding: 0.804447, zoom: 0.6 }) - 14.95) < 0.01);
  // the same positions with no portal settings use the cube's 70 / 40
  assert.equal(cameraBottomTarget("swing", 220, false, 0, 0, 320, true, null), 0);
  // the divisor is the portal's easing a 60 Hz frame; the cube's is 10
  assert.equal(followRate(false, 30), 6);
  assert.equal(followRate(true, undefined), 6);
  assert.equal(followRate(true, 30), 2);
});

test("a ball portal inside a dual centres the view with the dual's 270 height", async () => {
  const { cameraCenterForDualBall, cameraCenterForPortal } = await import("../src/gd/camera.ts");
  // level 16's portal at GD y 554 (port y 464): the real camera at x 19894 sits at centre 525
  assert.equal(cameraCenterForDualBall(464) + 90, 525);
  // the single player's ball rule floors to the 30 grid: 540
  assert.equal(cameraCenterForPortal("ball", 464)! + 90, 540);
  // low portals keep the 90 floor: 135 + 90 = 225
  assert.equal(cameraCenterForDualBall(50) + 90, 225);
});
