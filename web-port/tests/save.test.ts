// Tests for the save data rules (src/gd/save.ts).
//
// These pin the parts that are *game rules*, not storage plumbing: practice and
// normal percent are separate stats, neither ever moves backwards, and a coin
// picked up in practice mode does not count. Getting any of those wrong is
// invisible until a player loses progress, so they are worth pinning.
//
// No localStorage in node: every read/write in save.ts is guarded, so it falls
// back to an in-memory copy here. `loadFrom` seeds that copy directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as save from "../src/gd/save.ts";

function fresh() {
  save.loadFrom(null);
}

test("normal and practice percent are separate stats", () => {
  fresh();
  save.recordProgress(1, 40, false);
  save.recordProgress(1, 90, true);
  const st = save.levelStats(1);
  assert.equal(st.normal, 40);
  assert.equal(st.practice, 90);
  // a big practice run must not make the level look complete
  assert.equal(save.isCompleted(1), false);
});

test("neither percent bar ever moves backwards", () => {
  fresh();
  save.recordProgress(1, 75, false);
  assert.equal(save.recordProgress(1, 30, false), false);
  assert.equal(save.levelStats(1).normal, 75);
  // and a new best does report itself as one
  assert.equal(save.recordProgress(1, 76, false), true);
  assert.equal(save.levelStats(1).normal, 76);
});

test("a level is complete only at a normal-mode 100%", () => {
  fresh();
  save.recordProgress(2, 100, true);
  assert.equal(save.isCompleted(2), false);
  save.recordProgress(2, 100, false);
  assert.equal(save.isCompleted(2), true);
});

test("coins collected in practice mode do not count", () => {
  fresh();
  assert.equal(save.recordCoin(3, 0, true), false);
  assert.deepEqual(save.levelStats(3).coins, []);
  assert.equal(save.recordCoin(3, 0, false), true);
  assert.deepEqual(save.levelStats(3).coins, [0]);
  // and the same coin twice is not two coins
  assert.equal(save.recordCoin(3, 0, false), false);
  assert.deepEqual(save.levelStats(3).coins, [0]);
});

test("attempts accumulate rather than restarting at 1", () => {
  fresh();
  assert.equal(save.recordAttempt(4), 1);
  assert.equal(save.recordAttempt(4), 2);
  assert.equal(save.recordAttempt(4), 3);
  // a different level keeps its own count
  assert.equal(save.recordAttempt(5), 1);
  assert.equal(save.levelStats(4).attempts, 3);
});

test("a corrupt or hostile save is repaired, not trusted", () => {
  save.loadFrom({
    v: 1,
    levels: {
      1: { normal: 999, practice: -5, coins: [0, 0, 7, 2], attempts: -3, jumps: "x" },
      2: "not an object",
    },
    settings: { musicVolume: 42, sfxVolume: 0.5 },
    icons: { glow: "yes" },
  });
  const st = save.levelStats(1);
  assert.equal(st.normal, 100, "percent clamps to 100");
  assert.equal(st.practice, 0, "negative percent clamps to 0");
  assert.deepEqual(st.coins, [0, 2], "coins are deduped and range-checked");
  assert.equal(st.attempts, 0);
  assert.equal(st.jumps, 0);
  assert.equal(save.settings().musicVolume, 1, "volume clamps into 0..1");
  assert.equal(save.settings().sfxVolume, 0.5);
  assert.equal(save.icons().glow, false, "glow is coerced to a real boolean");
  // the unusable level entry is simply absent rather than crashing a read
  assert.equal(save.levelStats(2).normal, 0);
});

test("totalCoins counts every level's coins", () => {
  fresh();
  save.recordCoin(1, 0, false);
  save.recordCoin(1, 1, false);
  save.recordCoin(2, 0, false);
  assert.equal(save.totalCoins(), 3);
});
