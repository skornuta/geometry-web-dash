import { test } from "node:test";
import assert from "node:assert/strict";
import { OBJECT_DEFS } from "../src/gd/objects.ts";

// Default z orders from the game itself (data/native-geometry.jsonl, confirmed by the
// running game's sprite dumps) where OpenGD's 2.1 table said 1 or something else.
test("Dash's 2.2 decorations default to the game's z order, not OpenGD's 1", () => {
  const want: [number, number][] = [
    [2597, 10], [2596, 9], [2593, 9], [2538, 9], [2360, 9], [2315, 9], [2316, 9],
    [2550, 9], [2557, 10], [2549, 8], [1936, 2], [2042, 2], [918, 2], [10, 13], [13, 13],
  ];
  for (const [id, z] of want) assert.equal(OBJECT_DEFS.get(id)!.zOrder, z, `id ${id}`);
});

test("the orbs' order stays at OpenGD's value until a running-game check confirms the capture's 12", () => {
  for (const id of [36, 84, 1333]) assert.equal(OBJECT_DEFS.get(id)!.zOrder, 10, `id ${id}`);
});
