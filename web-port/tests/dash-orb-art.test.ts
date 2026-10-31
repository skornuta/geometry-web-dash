import { test } from "node:test";
import assert from "node:assert/strict";
import { OBJECT_DEFS } from "../src/gd/objects.ts";
import { orbWaveColor } from "../src/gd/effects.ts";

// Native GameObjectType: custom ring = 36, dash = 37, gravity dash = 38.
// ringJump's activation waves are green for dash, magenta for gravity dash.
for (const { id, type, frame, color } of [
  { id: 1704, type: 37, frame: "dashRing_01_001.png", color: [0, 255, 0] },
  { id: 1751, type: 38, frame: "dashRing_02_001.png", color: [255, 0, 255] },
]) {
  test(`dash orb ${id}: native type ${type} selects the correct activation colour`, () => {
    const def = OBJECT_DEFS.get(id)!;
    assert.ok(def, `orb ${id} has a generated definition`);
    assert.equal(def.type, type);
    assert.equal(def.kind, "orb");
    assert.equal(def.frame, frame);
    assert.deepEqual(orbWaveColor(def.type), color);
  });
}

test("the toggle orb keeps custom-ring type 36, distinct from both dash orbs", () => {
  assert.equal(OBJECT_DEFS.get(1594)!.type, 36);
});
