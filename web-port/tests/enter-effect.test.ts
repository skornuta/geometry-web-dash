import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeEnterCode, activeEnterEffects, edgeFade, enterTransform, enterTriggers, DEFAULT_ENTER_CODE, FADE_WIDTH, skipsEdgeFade,
} from "../src/gd/enterEffect.ts";

// Native GD, Theory of Everything x=2326 (trigger 27 active), view 2115.97..2686.97
const LEFT = 2115.97, RIGHT = 2686.97;

test("the edge fade matches the native opacities at ToE 9%", () => {
  // object x -> the opacity the game drew it with
  const native: [number, number][] = [[2625, 225], [2655, 116], [2685, 7], [2145, 105], [2175, 215], [2400, 255]];
  for (const [x, op] of native) {
    const { t } = edgeFade(x, LEFT, RIGHT);
    assert.ok(Math.abs(t * 255 - op) <= 1.5, `x=${x}: ${(t * 255).toFixed(1)} vs ${op}`);
  }
  assert.equal(FADE_WIDTH, 70);
});

test("trigger 27 scales objects in by the fade factor, as the native scales show", () => {
  const code = activeEnterCode(enterTriggers([{ id: 27, x: 2235 }]), 2326);
  assert.equal(code, -3);
  const { t } = edgeFade(2625, LEFT, RIGHT);
  const e = enterTransform(code, t, false);
  assert.ok(Math.abs(e.scale - 0.885268) < 0.002, `scale ${e.scale}`);
  assert.equal(e.dx, 0);
});

test("before any trigger objects only fade, and later triggers replace earlier ones", () => {
  const trigs = enterTriggers([{ id: 25, x: 500 }, { id: 23, x: 100 }, { id: 1, x: 50 }]);
  assert.equal(activeEnterCode(trigs, 50), DEFAULT_ENTER_CODE);
  assert.equal(activeEnterCode(trigs, 200), -6);
  assert.equal(activeEnterCode(trigs, 600), -7);
  assert.deepEqual(enterTransform(DEFAULT_ENTER_CODE, 0.5, false), { dx: 0, dy: 0, scale: 1 });
});

test("the move effects start 100 units out and arrive at the fade band's inner edge", () => {
  assert.deepEqual(enterTransform(-6, 0, false), { dx: 0, dy: -100, scale: 1 });  // from below
  assert.deepEqual(enterTransform(-5, 0.5, false), { dx: 0, dy: 50, scale: 1 });  // from above
  assert.deepEqual(enterTransform(-7, 1, false), { dx: -0, dy: 0, scale: 1 });
  assert.equal(enterTransform(-4, 0, false).scale, 1.75);
  const v = enterTransform(-12, 0, true); // vertical, object above centre -> from above
  assert.ok(Math.abs(v.dx) < 1e-9 && Math.abs(v.dy - 100) < 1e-9, JSON.stringify(v));
});

test("the camera keeps the player winW/2 - 75 from the view's left edge, as the game does", async () => {
  const { cameraLeftFor } = await import("../src/gd/camera.ts");
  // native GD, Theory of Everything: player x=2326.47, 571-unit view, and the
  // edge fade puts the view's left edge at 2115.97
  assert.ok(Math.abs(cameraLeftFor(2326.47, 571) - 2115.97) < 0.01);
});

test("outline blocks keep full opacity at the edge under the default effect (customSetup [0x409])", () => {
  // outline block, its slope and a light triangle: never fade under fade-only
  for (const id of [90, 309, 687]) assert.equal(skipsEdgeFade(id, DEFAULT_ENTER_CODE, false), true);
  // a plain block, and the sawblade, fade as usual
  for (const id of [1, 88]) assert.equal(skipsEdgeFade(id, DEFAULT_ENTER_CODE, false), false);
  // any other effect in force: the exemption is off
  assert.equal(skipsEdgeFade(90, -3, false), false);
  // [0x40c] ids fade after all while their main sprite is blending; the rest don't care
  assert.equal(skipsEdgeFade(207, DEFAULT_ENTER_CODE, true), false);
  assert.equal(skipsEdgeFade(207, DEFAULT_ENTER_CODE, false), true);
  assert.equal(skipsEdgeFade(90, DEFAULT_ENTER_CODE, true), true);
});

test("enter triggers only change their own channel (key 344 → the object's key 343); 1915 is 'no effect'", () => {
  const P = (o: Record<number, string>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  const trigs = enterTriggers([
    { id: 58, x: 100, props: P({}) },
    { id: 1915, x: 50, props: P({ 344: "3" }) },
  ]);
  assert.equal(activeEnterCode(trigs, 200, 0), -12, "channel 0 takes the 58");
  assert.equal(activeEnterCode(trigs, 200, 3), -14, "channel 3 is held still");
  assert.equal(activeEnterCode(trigs, 200, 4), DEFAULT_ENTER_CODE, "an untouched channel stays fade-only");
});

test("2.2 custom enter effects (3020/3021) join their channel's list on the sides key 217 picks", () => {
  const P = (o: Record<number, string>) => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]));
  // Dash x 16485: a both-sides fade and an enter-only tint on channel 4
  const trigs = enterTriggers([
    { id: 3020, x: 100, props: P({ 344: "4", 222: "60", 220: "-150", 242: "1", 243: "2" }) },
    { id: 3021, x: 100, props: P({ 344: "4", 217: "1", 222: "300", 260: "143", 265: "1" }) },
  ]);
  const right = activeEnterEffects(trigs, 200, 4, true), left = activeEnterEffects(trigs, 200, 4, false);
  assert.equal(right.code, -15);
  assert.deepEqual(right.customs.map((c) => c.id), [3020, 3021]);
  assert.deepEqual(left.customs.map((c) => c.id), [3020], "the tint is enter-side only");
  assert.equal(activeEnterEffects(trigs, 200, 0, true).code, -2, "other channels are untouched");
});
