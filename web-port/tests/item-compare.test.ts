// Item Compare (3620): `GJBaseGameLayer::activateItemCompareTrigger` (m1 0x11f16c).
// Keys from `ItemTriggerGameObject::customObjectSetup` (m1 0x199df4): 51 TrueID,
// 71 FalseID, 80 item 1, 476 item 1 mode, 479 mod 1, 480 operation, 482 relation,
// 483 compared constant, 484 tolerance.
// Rule (one-item case, item 2 absent): A = op(count, mod1); B = key 483; T = key 484.
//   0 ==: |A-B| <= T     1 >: A+T > B     2 >=: A+T >= B
//   3 <:  A-T < B        4 <=: A-T <= B   5 !=: |A-B| > T
// The table below is the emulator's own answer from the binary (unicorn, the
// same function), not a reading of the code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLevelString } from "../src/gd/level.ts";
import { buildTriggers, createRuntime, groupState, setItemCount, updateTriggers } from "../src/gd/triggers.ts";

/** one compare trigger at x 100; the player passes it; returns which group the outcome toggled off */
function outcome(count: number, relation: number, constant: number, tolerance: number): "true" | "false" | "none" {
  const level = parseLevelString(
    "kS38,|;" +
    `1,3620,2,100,3,0,51,534,71,999,80,1,476,1,479,1,480,3,482,${relation},483,${constant},484,${tolerance};`,
  );
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  setItemCount(rt, 1, count);
  updateTriggers(rt, list, 200, 1 / 240, 0);
  const t = !groupState(rt, 534).enabled, f = !groupState(rt, 999).enabled;
  assert.ok(!(t && f), "one outcome only");
  return t ? "true" : f ? "false" : "none";
}

test("Item Compare on level 22's 3620 (count >= 6 with 483 = 6, 484 absent): TrueID 534 toggled off", () => {
  // relation 2 (>=), constant 6, tolerance 0: the counts 0..8 the emulator gives
  const want = [false, false, false, false, false, false, true, true, true];
  for (let c = 0; c < want.length; c++) {
    assert.equal(outcome(c, 2, 6, 0) === "true", want[c], `count ${c}`);
  }
});

test("the six relations match the binary's sweep (constant 6, tolerance 0)", () => {
  // from the emulator, counts 0..8 (T = TRUE, F = FALSE)
  const table: Record<number, string> = {
    0: "FFFFFFTFF", // ==
    1: "FFFFFFFTT", // >
    2: "FFFFFFTTT", // >=
    3: "TTTTTTFFF", // <
    4: "TTTTTTTFF", // <=
    5: "TTTTTTFTT", // !=
  };
  for (const [rel, row] of Object.entries(table)) {
    const got = [...row].map((_, c) => outcome(c, Number(rel), 6, 0) === "true" ? "T" : "F").join("");
    assert.equal(got, row, `relation ${rel}`);
  }
});

test("tolerance (key 484 = 3) with constant 0: the binary sweep rows", () => {
  // T = key 484 = 3, B = key 483 absent (0): == is |c| <= 3, < is c - 3 < 0, > is c + 3 > 0
  const table: Record<number, string> = {
    0: "TTTTFFFF", // ==
    1: "TTTTTTTT", // >
    2: "TTTTTTTT", // >=
    3: "TTTFFFFF", // <
    4: "TTTTFFFF", // <=
    5: "FFFFTTTT", // !=
  };
  for (const [rel, row] of Object.entries(table)) {
    const got = [...row].map((_, c) => outcome(c, Number(rel), 0, 3) === "true" ? "T" : "F").join("");
    assert.equal(got, row, `relation ${rel}`);
  }
});
