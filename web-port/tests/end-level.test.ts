// `EndLevelLayer`'s geometry and formatting, read out of the shipping 2.2081
// binary:
//
//   EndLevelLayer::customSetup  m1 0x41fe0c
//   EndLevelLayer::init         m1 0x41fbcc   (GJDropDownLayer::init(" ", 230, true))
//   EndLevelLayer::getEndText   m1 0x4218d8
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BANNER_SCALE, BANNER_Y, BUTTON_ROW_Y, COIN_ROW_Y, END_LEVEL_HEIGHT,
  END_LEVEL_Y_NUDGE, END_TEXT_FALLBACK, END_TEXT_TABLE, MENU_X, REPLAY_X,
  RESTART_CHECKPOINT_X, STAT_FIRST_DY, STAT_STEP, coinGap, endLevelLayout,
  endTextFor, formatTime,
} from "../src/ui/endLevelMenu.ts";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const STATS = {
  attempts: 3, jumps: 41, time: 84.7, practice: false, coinCount: 3, coinsHeld: [0, 2],
};

test("the layer is the sourced 230-tall drop-down, settling 5 higher", () => {
  assert.equal(END_LEVEL_HEIGHT, 230);
  assert.equal(END_LEVEL_Y_NUDGE, 5);
});

test("the banner and the statistics step exactly as customSetup lays them out", () => {
  const L = endLevelLayout(STATS, 20);
  close(L.bannerY, BANNER_Y);
  close(BANNER_SCALE, 0.8);
  // first stat 40 below the banner, then -24 each
  close(L.stats[0].y, BANNER_Y + STAT_FIRST_DY);
  close(L.stats[1].y, BANNER_Y + STAT_FIRST_DY + STAT_STEP);
  close(L.stats[2].y, BANNER_Y + STAT_FIRST_DY + 2 * STAT_STEP);
  assert.equal(L.stats[0].label, "Attempts: 3");
  assert.equal(L.stats[1].label, "Jumps: 41");
  assert.equal(L.stats[2].label, "Time: 01:24");
  // only `Time:` is width-limited
  assert.equal(L.stats[0].maxWidth, undefined);
  assert.equal(L.stats[1].maxWidth, undefined);
  assert.equal(L.stats[2].maxWidth, 150);
});

test("the line under the statistics follows customSetup +2464..2920", () => {
  // a level with coins (all 22 main levels) shows its coin row, not an end text
  assert.equal(endLevelLayout(STATS, 20).endLine, null);
  // a coin-less level prints getEndText() at winH/2 - 65
  assert.deepEqual(endLevelLayout({ ...STATS, coinCount: 0 }, 20).endLine,
    { text: "random", y: -65 });
  // practice always shows the "Well done..." hint at winH/2 - 51
  assert.deepEqual(endLevelLayout({ ...STATS, practice: true }, 20).endLine,
    { text: "practice", y: -51 });
});

test("the button row is the sourced pair, with the practice button only in practice", () => {
  const normal = endLevelLayout(STATS, 20);
  close(normal.buttonRowY, BUTTON_ROW_Y);
  close(normal.replayX, REPLAY_X);
  close(normal.menuX, MENU_X);
  assert.equal(normal.restartCheckpointX, null);
  const practice = endLevelLayout({ ...STATS, practice: true }, 20);
  close(practice.restartCheckpointX!, RESTART_CHECKPOINT_X);
  // the row is at winH/2 - 115 - 10 in GD UI space
  close(BUTTON_ROW_Y, -125);
});

test("the coin row centres on the sourced gap, and practice shows none", () => {
  assert.equal(coinGap(3), 20);
  assert.equal(coinGap(4), 15);
  assert.equal(coinGap(5), 13);
  const L = endLevelLayout(STATS, 20);
  close(L.coinRowY, COIN_ROW_Y);
  assert.equal(L.coinXs.length, 3);
  // three 20-wide coins with a 20 gap span 100, centred
  close(L.coinXs[0], -40);
  close(L.coinXs[1], 0);
  close(L.coinXs[2], 40);
  // a practice clear never shows the coin row: the original only builds it for
  // a normal-mode completion, and practice coins do not count
  assert.deepEqual(endLevelLayout({ ...STATS, practice: true }, 20).coinXs, []);
  // a level with no coins has no row either
  assert.deepEqual(endLevelLayout({ ...STATS, coinCount: 0 }, 20).coinXs, []);
});

test("the time format switches to hours above 3599 seconds", () => {
  assert.equal(formatTime(0), "00:00");
  assert.equal(formatTime(9), "00:09");
  assert.equal(formatTime(84.7), "01:24");
  assert.equal(formatTime(599), "09:59");
  assert.equal(formatTime(3599), "59:59");
  // 3600 is the first second past the boundary `t + 3599 > 7198`
  assert.equal(formatTime(3600), "01:00:00");
  assert.equal(formatTime(3661), "01:01:01");
  assert.equal(formatTime(-5), "00:00");
});

test("getEndText is rand() % 18 minus 2, so Awesome! is twice as likely", () => {
  // rolls 0 and 1 fall off the front of the table
  assert.equal(endTextFor(0), END_TEXT_FALLBACK);
  assert.equal(endTextFor(1), END_TEXT_FALLBACK);
  assert.equal(endTextFor(2), END_TEXT_TABLE[0]);
  assert.equal(endTextFor(2), "Good Job!");
  assert.equal(endTextFor(17), END_TEXT_TABLE[15]);
  assert.equal(endTextFor(17), "Y u do dis?");
  // the modulo wraps, so any rand() value is in range
  assert.equal(endTextFor(20), endTextFor(2));
  assert.equal(endTextFor(18 * 1000 + 5), endTextFor(5));
  assert.equal(END_TEXT_TABLE.length, 16);
  const counts = new Map<string, number>();
  for (let r = 0; r < 18; r++) {
    const t = endTextFor(r);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  assert.equal(counts.get(END_TEXT_FALLBACK), 2);
  assert.equal(counts.size, 17);
});
