// The Level Stats popup (the info button on a level page, `LevelPage::onInfo`).
//
// These pin the text the popup shows (`levelStatsText` in src/ui/alertLayer.ts)
// and the save values it is fed from (src/gd/save.ts). The popup, its button and
// its geometry already exist; these tests keep the native format from drifting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { levelStatsText, LEVEL_STATS_TITLE, LEVEL_STATS_WIDTH } from "../src/ui/alertLayer.ts";
import * as save from "../src/gd/save.ts";

test("the popup is titled Level Stats and is 300 wide", () => {
  assert.equal(LEVEL_STATS_TITLE, "Level Stats");
  assert.equal(LEVEL_STATS_WIDTH, 300);
});

test("levelStatsText matches the native format exactly", () => {
  assert.equal(
    levelStatsText("Stereo Madness", 12, 340, 100, 45),
    "<cy>Stereo Madness</c>\n<cg>Total Attempts</c>: 12\n<cl>Total Jumps</c>: 340\n"
      + "<cp>Normal</c>: 100%\n<co>Practice</c>: 45%",
  );
});

test("percents floor, as %i does", () => {
  assert.equal(levelStatsText("X", 0, 0, 99.9, 0.5), "<cy>X</c>\n<cg>Total Attempts</c>: 0\n"
    + "<cl>Total Jumps</c>: 0\n<cp>Normal</c>: 99%\n<co>Practice</c>: 0%");
});

test("a new level reads 0 in every field", () => {
  save.loadFrom(null);
  const st = save.levelStats(1);
  assert.deepEqual(
    [st.attempts, st.jumps, st.normal, st.practice],
    [0, 0, 0, 0],
  );
  assert.equal(
    levelStatsText("Level", st.attempts, st.jumps, st.normal, st.practice),
    "<cy>Level</c>\n<cg>Total Attempts</c>: 0\n<cl>Total Jumps</c>: 0\n"
      + "<cp>Normal</c>: 0%\n<co>Practice</c>: 0%",
  );
});

test("attempts and jumps from the save reach the text", () => {
  save.loadFrom({ levels: { "1": { normal: 0, practice: 0, coins: [], attempts: 2, jumps: 7 } } });
  const st = save.levelStats(1);
  assert.equal(st.attempts, 2);
  assert.equal(st.jumps, 7);
  assert.equal(
    levelStatsText("Stereo Madness", st.attempts, st.jumps, st.normal, st.practice),
    "<cy>Stereo Madness</c>\n<cg>Total Attempts</c>: 2\n<cl>Total Jumps</c>: 7\n"
      + "<cp>Normal</c>: 0%\n<co>Practice</c>: 0%",
  );
  save.loadFrom(null);
});
