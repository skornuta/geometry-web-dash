import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { OBJECT_DEFS } from "../src/gd/objects.ts";
import { decodeLevelString } from "../src/gd/level.ts";

// First-instance records in data/native-geometry.jsonl. The detached colour
// sprite is at self.x/y with exactly self's rotation AND signed scale. These
// are instance transforms, not intrinsic mirrors of the source artwork.
const deadlockedCaptures = [
  { id: 1187, x: 4485, y: 475, sx: 1, sy: -1, rot: 0 },
  { id: 1188, x: 27405, y: 329, sx: -1, sy: 1, rot: 90 },
  { id: 1189, x: 4485, y: 535, sx: 1, sy: -1, rot: 0 },
  { id: 1190, x: 27405, y: 374, sx: -1, sy: 1, rot: 90 },
];

for (const capture of deadlockedCaptures) {
  test(`Deadlocked slope art ${capture.id}: detail inherits the instance mirror exactly once`, () => {
    const def = OBJECT_DEFS.get(capture.id)!;
    const kids = def.children!.filter(c => c.color === "detail");
    assert.equal(kids.length, 1, "do not stack another overlay on the stale one");
    const child = kids[0];
    assert.equal(child.frame, def.frame.replace("_001.png", "_color_001.png"));
    assert.deepEqual([child.dx, child.dy, child.rot], [0, 0, 0]);
    assert.deepEqual([child.scaleX, child.scaleY], [1, 1]);
    assert.deepEqual([child.flipX, child.flipY], [false, false]);
    assert.deepEqual([child.r, child.g, child.b], [255, 255, 255]);
    // Recompose the captured instance. Previously the negative axis became
    // positive and the black detail border crossed the ramp's empty half.
    assert.deepEqual(
      [capture.sx * child.scaleX, capture.sy * child.scaleY],
      [capture.sx, capture.sy],
    );
  });
}

test("the same detached-scale correction applies to block005b slope art", () => {
  for (const id of [1038, 1040]) {
    const child = OBJECT_DEFS.get(id)!.children!.find(c => c.color === "detail")!;
    assert.deepEqual([child.scaleX, child.scaleY], [1, 1], `slope art ${id}`);
  }
});

test("Deadlocked's wave sections actually use the affected decorative slopes", async () => {
  const level = await decodeLevelString(fs.readFileSync("public/assets/levels/20.txt", "utf8"));
  const early = level.objects.filter(o => o.x >= 4400 && o.x <= 5500);
  const late = level.objects.filter(o => o.x >= 27400 && o.x <= 28500);
  for (const id of [1187, 1189]) assert.ok(early.some(o => o.id === id), `early wave art ${id}`);
  for (const id of [1188, 1190]) assert.ok(late.some(o => o.id === id), `late wave art ${id}`);
  // The fix must not replace collision-size frames with narrow outline strips.
  assert.equal(OBJECT_DEFS.get(665)!.frame, "blockOutline_14_001.png");
  assert.equal(OBJECT_DEFS.get(666)!.frame, "blockOutline_15_001.png");
});
