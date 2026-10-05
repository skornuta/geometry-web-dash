import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSnapJump, type SnapState } from "../src/gd/snapjump.ts";
import { SPEEDS } from "../src/gd/physics.ts";

const NORMAL = 1;

function player(x: number, over: Partial<SnapState> = {}): SnapState {
  return {
    x, snapObject: -1, snapObjectX: 0, snapObjectY: 0, snapOffset: 0,
    gravityFlipped: false, mini: false, ...over,
  };
}

test("the first landing only remembers — there is nothing to snap toward yet", () => {
  const p = player(1010);
  assert.equal(checkSnapJump(p, { index: 7, x: 1005, y: 15 }, NORMAL), false);
  assert.equal(p.snapObject, 7);
  assert.equal(p.x, 1010);
  assert.equal(p.snapOffset, 5);
});

test("a block one rhythm unit on lines the player back up, by at most one unit", () => {
  // 1x accepts (120, +30). Landing 5 ahead of where the last block held us
  // pulls back the whole way; landing 9 ahead moves the cap and no further.
  const near = player(1130, { snapObject: 7, snapObjectX: 1005, snapObjectY: 15, snapOffset: 4.5 });
  assert.equal(checkSnapJump(near, { index: 8, x: 1125, y: 45 }, NORMAL), true);
  assert.equal(near.x, 1129.5);

  const far = player(1134, { snapObject: 7, snapObjectX: 1005, snapObjectY: 15, snapOffset: 4.5 });
  assert.equal(checkSnapJump(far, { index: 8, x: 1125, y: 45 }, NORMAL), true);
  assert.equal(far.x, 1133);
  assert.equal(far.snapOffset, 8);
});

test("the rhythm must match in both axes", () => {
  const prev = { snapObject: 7, snapObjectX: 1005, snapObjectY: 15, snapOffset: 4.5 };
  // right dx, wrong dy
  const a = player(1130, prev);
  assert.equal(checkSnapJump(a, { index: 8, x: 1125, y: 15 }, NORMAL), false);
  assert.equal(a.x, 1130);
  // right dy, wrong dx
  const b = player(1130, prev);
  assert.equal(checkSnapJump(b, { index: 8, x: 1095, y: 45 }, NORMAL), false);
  assert.equal(b.x, 1130);
  // the other two rows of the same speed do match
  const c = player(1160, prev);
  assert.equal(checkSnapJump(c, { index: 8, x: 1155, y: -15 }, NORMAL), true);
  const d = player(1100, prev);
  assert.equal(checkSnapJump(d, { index: 8, x: 1095, y: 75 }, NORMAL), true);
});

test("landing again on the same block never snaps", () => {
  const p = player(1130, { snapObject: 8, snapObjectX: 1125, snapObjectY: 45, snapOffset: 4.5 });
  assert.equal(checkSnapJump(p, { index: 8, x: 1125, y: 45 }, NORMAL), false);
});

test("flipped gravity measures dy along the player's own up", () => {
  const prev = { snapObject: 7, snapObjectX: 1005, snapObjectY: 15, snapOffset: 4.5, gravityFlipped: true };
  const up = player(1130, prev);
  assert.equal(checkSnapJump(up, { index: 8, x: 1125, y: -15 }, NORMAL), true);
  const down = player(1130, prev);
  assert.equal(checkSnapJump(down, { index: 8, x: 1125, y: 45 }, NORMAL), false);
});

test("2x has its own rhythm and a two-unit cap; mini only moves the first row", () => {
  const fast = player(1180, { snapObject: 7, snapObjectX: 1005, snapObjectY: 15, snapOffset: 4.5 });
  // 1.1x accepts (150, +30) and will move up to 2
  assert.equal(checkSnapJump(fast, { index: 8, x: 1155, y: 45 }, 2), true);
  assert.equal(fast.x, 1178);

  const mini = player(1100, {
    snapObject: 7, snapObjectX: 1005, snapObjectY: 15, snapOffset: 4.5, mini: true,
  });
  // mini pulls the first row back to 90 at every speed but 1.6
  assert.equal(checkSnapJump(mini, { index: 8, x: 1095, y: 45 }, 2), true);
  assert.equal(SPEEDS.length, 5);
});
