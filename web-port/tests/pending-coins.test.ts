// Tests for the per-attempt coin buffer (src/gd/pendingCoins.ts).
//
// A secret coin taken during an attempt shows during that attempt, but it is
// written to the save only when the level is completed in normal mode. A death
// drops it. These tests follow the same steps playLevel.ts takes: take on
// pickup, clear on death, and write each ordinal on the complete branch.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as save from "../src/gd/save.ts";
import { PendingCoins } from "../src/gd/pendingCoins.ts";

/** the complete branch in playLevel.ts: write every pending coin, then clear */
function commitOnComplete(pending: PendingCoins, level: number, practice: boolean) {
  if (!practice) {
    for (const ord of pending.ordinals()) save.recordCoin(level, ord, false);
  }
  pending.clear();
}

test("a coin taken then lost to a death is not written to the save", () => {
  save.loadFrom(null);
  const pending = new PendingCoins();
  assert.equal(pending.take(0), true);
  pending.clear(); // the death
  assert.deepEqual(pending.ordinals(), []);
  commitOnComplete(pending, 1, false);
  assert.deepEqual(save.levelStats(1).coins, []);
});

test("a coin taken in a completed normal-mode run is written to the save", () => {
  save.loadFrom(null);
  const pending = new PendingCoins();
  pending.take(1);
  commitOnComplete(pending, 1, false);
  assert.ok(save.levelStats(1).coins.includes(1));
});

test("a coin taken in practice mode is not written even on completion", () => {
  save.loadFrom(null);
  const pending = new PendingCoins();
  pending.take(2);
  commitOnComplete(pending, 1, true);
  assert.deepEqual(save.levelStats(1).coins, []);
});

test("taking the same ordinal twice keeps one entry", () => {
  save.loadFrom(null);
  const pending = new PendingCoins();
  assert.equal(pending.take(0), true);
  assert.equal(pending.take(0), false);
  assert.deepEqual(pending.ordinals(), [0]);
});
