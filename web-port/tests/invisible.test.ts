// Task 7 — the visible half of the approximation list: the invisible objects
// and the screen-edge fade. Each test pins a rule decoded from the 2.2081
// binary (FIDELITY.md §7.1), not a behaviour invented here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { invisibleFade } from "../src/gd/invisible.ts";

const CAM = 1000, VIEW = 570;
const at = (dx: number) => invisibleFade(CAM + dx, 15, CAM, VIEW);

test("an invisible object sits at 5% opacity across the band around the player", () => {
  // updateInvisibleBlock +240..292: the band runs from camera-75 to camera+35,
  // and inside it `f` is 0, so the opacity is the 0.05 floor
  for (const dx of [-75, -40, 0, 20, 35]) {
    assert.equal(at(dx).opacity.toFixed(3), "0.050", `at ${dx}`);
    assert.equal(at(dx).glowOpacity.toFixed(3), "0.150", `glow at ${dx}`);
  }
});

test("it fades in away from the player and out again at the screen edge", () => {
  // rising through the band's edge...
  assert.ok(at(80).opacity > at(35).opacity);
  assert.ok(at(150).opacity > at(80).opacity);
  assert.equal(at(200).opacity, 1);
  // ...then the edge cap pulls it back down in the last ~50 units
  assert.ok(at(280).opacity < 0.5);
  assert.ok(at(-280).opacity < 0.5);
});

test("the glow always leads the object, because its floor is 0.15 not 0.05", () => {
  for (const dx of [-150, -105, 0, 80, 150]) {
    const f = at(dx);
    assert.ok(f.glowOpacity >= f.opacity, `at ${dx}: ${f.glowOpacity} < ${f.opacity}`);
  }
});

test("the colour only mixes toward the background once it is nearly solid", () => {
  assert.equal(at(0).mix, 0);
  assert.equal(at(150).mix, 0, "0.73 opacity is still under the 0.8 threshold");
  // at full opacity the mix is 0.7 — 70 % of the object's own colour
  assert.equal(at(200).mix.toFixed(2), "0.70");
});

test("the near edge decides the edge fade, so a wider object is capped later", () => {
  // +88..112 nudges the position *toward* the screen centre by the object's own
  // half-width, so a wide object's near edge is still well inside the screen
  const narrow = invisibleFade(CAM + 250, 5, CAM, VIEW);
  const wide = invisibleFade(CAM + 250, 60, CAM, VIEW);
  assert.ok(wide.opacity > narrow.opacity, `${wide.opacity} vs ${narrow.opacity}`);
});
