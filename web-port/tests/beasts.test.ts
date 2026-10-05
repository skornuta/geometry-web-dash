// The animated monsters' parts, read from the game's own AnimDescs
// (scripts/gen-beasts.mjs -> src/gd/beasts.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BEASTS, beastFrameIndex } from "../src/gd/beasts.ts";

test("GJBeast01 (918) bites with two jaws, 16 frames at 0.025 s, looped", () => {
  const b = BEASTS.get(918)!;
  assert.equal(b.anim, "bite");
  assert.equal(b.frames.length, 16);
  assert.equal(b.delay, 0.025);
  assert.equal(b.looped, true);
  assert.deepEqual(b.frames[0].map((p) => p.frame), ["GJBeast01_02_001.png", "GJBeast01_01_001.png"]);
  // the head sits above the lower jaw
  assert.ok(b.frames[0][1].y > b.frames[0][0].y);
});

test("the bite cycle shows frame 0 at the start and frame 5 at 5 x 0.025 s, then wraps", () => {
  const b = BEASTS.get(918)!;
  assert.equal(beastFrameIndex(b, 0), 0);
  assert.equal(beastFrameIndex(b, 5 * 0.025 - 1e-6), 4);
  assert.equal(beastFrameIndex(b, 5 * 0.025 + 1e-6), 5);
  // 16 frames x 0.025 s = 0.4 s per cycle: the next cycle starts over at frame 0
  assert.equal(beastFrameIndex(b, 16 * 0.025), 0);
  assert.equal(beastFrameIndex(b, 21 * 0.025 + 1e-6), 5);
  // the jaw's transform at the two times: frame 0 is upright, frame 5 is open
  const head0 = b.frames[beastFrameIndex(b, 0)].find((p) => p.frame === "GJBeast01_02_001.png")!;
  const head5 = b.frames[beastFrameIndex(b, 5 * 0.025)].find((p) => p.frame === "GJBeast01_02_001.png")!;
  assert.ok(Math.abs(head0.rot) < 0.01 && Math.abs(head0.y - -10.45) < 0.01);
  assert.ok(Math.abs(head5.rot - -23.78) < 0.01 && Math.abs(head5.y - -19.8) < 0.01);
});

test("the head's additive glow rides with the head at every frame", () => {
  const b = BEASTS.get(918)!;
  for (const frame of b.frames) {
    const head = frame.find((p) => p.frame === "GJBeast01_02_001.png")!;
    assert.equal(head.glow, "GJBeast01_02_glow_001.png");
  }
});

test("a non-looped animation holds its last frame", () => {
  const fake = { name: "x", anim: "x", delay: 0.1, looped: false, frames: [[], [], []] };
  assert.equal(beastFrameIndex(fake, 0.15), 1);
  assert.equal(beastFrameIndex(fake, 99), 2);
});

test("every monster id has its parts", () => {
  for (const id of [918, 1327, 1328, 1584, 2012]) {
    const b = BEASTS.get(id)!;
    assert.ok(b.frames.length > 0 && b.frames.every((f) => f.length >= 2), `id ${id}`);
  }
});
