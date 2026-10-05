// The animated monsters' parts, read from the game's own AnimDescs
// (scripts/gen-beasts.mjs -> src/gd/beasts.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BEASTS } from "../src/gd/beasts.ts";

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

test("every monster id has its parts", () => {
  for (const id of [918, 1327, 1328, 1584, 2012]) {
    const b = BEASTS.get(id)!;
    assert.ok(b.frames.length > 0 && b.frames.every((f) => f.length >= 2), `id ${id}`);
  }
});
