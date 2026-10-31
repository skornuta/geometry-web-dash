import test from "node:test";
import assert from "node:assert/strict";
import { smoothBezier, stepViewStatic, type ViewStatic } from "../src/gd/camera.ts";

// `updateCamera`'s smooth-velocity branch: a cubic Bezier from the view's start,
// leaving at the view's own speed (P1 = P0 + v * dur / 3), ending on the guide.

test("the curve starts at the view, ends on the guide and leaves at the view's speed", () => {
  assert.equal(smoothBezier(100, 50, 3, 500, 0, 0), 100);
  assert.equal(smoothBezier(100, 50, 3, 500, 1, 0), 500);
  // the slope at p = 0 is 3 (P1 - P0) = v * dur, so one small step moves v * dt
  const dur = 3, dp = 1e-4;
  const slope = (smoothBezier(100, 50, dur, 500, dp, 0) - 100) / (dp * dur);
  assert.ok(Math.abs(slope - 50) < 0.1, `initial speed ${slope}`);
});

test("from rest with no modifier it is a smoothstep: half way at half time", () => {
  assert.ok(Math.abs(smoothBezier(0, 0, 3, 100, 0.5, 0) - 50) < 1e-9);
  assert.ok(Math.abs(smoothBezier(0, 0, 3, 100, 0.25, 0) - 15.625) < 1e-9);
});

test("a static with key 453 uses the view's speed from the frame it began", () => {
  const vs: ViewStatic = { group: 1, axis: 2, dur: 2, type: 0, rate: 2, t: 0, exit: false, exitAxis: 0,
    fromX: null, fromY: null, follow: 0, smooth: true, velMod: 0 };
  const out = { x: 0, y: 0 };
  stepViewStatic(vs, 0, 400, 0, 100, 0, 100, 0, false, out, 0, 0, 0, 0, 0, 30);
  assert.equal(vs.vy, 30);
  vs.t = 1;
  // a later frame reporting another speed does not move the curve
  stepViewStatic(vs, 0, 400, 0, 100, 0, 100, 0, false, out, 0, 0, 0, 0, 0, 999);
  assert.equal(out.y, smoothBezier(100, 30, 2, 400, 0.5, 0));
  vs.t = 2;
  stepViewStatic(vs, 0, 400, 0, 100, 0, 100, 0, false, out, 0, 0, 0, 0, 0, 999);
  assert.equal(out.y, 400);
});

test("without key 453 the static is the plain from-to ease", () => {
  const vs: ViewStatic = { group: 1, axis: 2, dur: 2, type: 0, rate: 2, t: 1, exit: false, exitAxis: 0,
    fromX: null, fromY: null, follow: 0 };
  const out = { x: 0, y: 0 };
  stepViewStatic(vs, 0, 400, 0, 100, 0, 100, 0, false, out, 0, 0, 0, 0, 0, 30);
  assert.equal(out.y, 250);
});

test("a smooth exit releases the view along the Bezier to the follow camera", () => {
  const vs: ViewStatic = { group: 1, axis: 2, dur: 2, type: 0, rate: 2, t: 1, exit: true, exitAxis: 3,
    fromX: null, fromY: null, follow: 0, smooth: true, velMod: 0 };
  const out = { x: 0, y: 0 };
  // the view was at 100 going up at 30 a second; the follow camera is at 400
  stepViewStatic(vs, 0, 999, 0, 400, 0, 100, 0, false, out, 0, 0, 0, 0, 0, 30);
  assert.equal(out.y, smoothBezier(100, 30, 2, 400, 0.5, 0));
});

test("a plain ease toward a moving target keeps its offset from it and drops it by the progress", async () => {
  const { easeOffset } = await import("../src/gd/camera.ts");
  // started 35 below the target; the target rises 2 a frame: at progress 0.5 the view is 17.5 below it
  assert.equal(easeOffset(-35, 1000, 0), 965);
  assert.equal(easeOffset(-35, 1100, 0.5), 1100 - 17.5);
  assert.equal(easeOffset(-35, 1234, 1), 1234);
});
