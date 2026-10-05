// The gameplay HUD's value, its rounding and its geometry, all read out of the
// shipping 2.2081 binary:
//
//   PlayLayer::getCurrentPercent     m1 0xa6e80
//   PlayLayer::getCurrentPercentInt  m1 0xa7560   (ends in fcvtms — floor)
//   PlayLayer::updateProgressbar     m1 0x9fdbc
//   PlayLayer::toggleProgressbar     m1 0xa70d0
//   PlayLayer::setupHasCompleted     m1 0x9c840 +1404..1876
//   UILayer::init                    m1 0x426d68
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BAR_FILL_HEIGHT, BAR_MIN_PERCENT, BAR_TOP_INSET, BAR_WIDTH_INSET,
  PAUSE_INSET, PERCENT_LABEL_DX,
  currentPercent, currentPercentInt, fillWidth, hudGeometry, percentLabel,
} from "../src/ui/gameplayHud.ts";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const SETTINGS = {
  showProgressBar: true, showPercentage: true,
  showPauseButton: true, pauseButtonOnLeft: false,
};

test("the percentage is the live position over the level length, clamped", () => {
  close(currentPercent(0, 1000), 0);
  close(currentPercent(250, 1000), 25);
  close(currentPercent(1000, 1000), 100);
  // clamped at both ends: a checkpoint rewind or an overshoot cannot leave it
  close(currentPercent(-50, 1000), 0);
  close(currentPercent(1500, 1000), 100);
  // a zero-length level cannot divide by zero
  close(currentPercent(10, 0), 0);
});

test("the printed percentage FLOORS — 100% only at exactly 100", () => {
  // getCurrentPercentInt ends in `fcvtms`, round toward minus infinity. The port
  // used Math.round, which showed 100% while the level was still running.
  assert.equal(currentPercentInt(999, 1000), 99);
  assert.equal(currentPercentInt(999.9, 1000), 99);
  assert.equal(currentPercentInt(26382, 26384), 99);
  assert.equal(currentPercentInt(26384, 26384), 100);
  // and the near-miss the plan flagged: x = 26282 of maxX 26384 is 99, not 100
  assert.equal(currentPercentInt(26282, 26384), 99);
  assert.notEqual(Math.round(currentPercent(26282, 26384)), currentPercentInt(26282, 26384));
});

test("the fill never vanishes and never overruns the groove", () => {
  const w = 200;
  close(fillWidth(0, w), (w * BAR_MIN_PERCENT) / 100);
  assert.ok(fillWidth(0, w) > 0, "a fresh attempt still shows a sliver");
  close(fillWidth(50, w), w / 2);
  close(fillWidth(100, w), w);
  close(fillWidth(150, w), w, 1e-6);
});

test("the bar and label sit where setupHasCompleted puts them", () => {
  const g = hudGeometry(569, 320, 200, 12, SETTINGS);
  // groove centred, 8 below the top of the view
  close(g.barX, 0);
  close(g.barY, 160 - BAR_TOP_INSET);
  // m_progressWidth = contentWidth - 4
  close(g.progressWidth, 200 - BAR_WIDTH_INSET);
  // the fill starts 2 in from the groove's left edge and is 8 tall
  close(g.fillLeft, -100 + 2);
  close(g.fillY, g.barY - 6 + 4 + BAR_FILL_HEIGHT / 2);
});

test("hiding the bar re-centres the percentage, as toggleProgressbar does", () => {
  const shown = hudGeometry(569, 320, 200, 12, SETTINGS);
  close(shown.labelX, PERCENT_LABEL_DX);
  assert.equal(shown.labelAlign, -1, "left-anchored beside the bar");

  const hidden = hudGeometry(569, 320, 200, 12, { ...SETTINGS, showProgressBar: false });
  close(hidden.labelX, 0);
  assert.equal(hidden.labelAlign, 0, "centred when the bar is gone");
  close(hidden.labelY, shown.labelY, 1e-6);
});

test("the pause button sits 15 in from the corner, and mirrors on request", () => {
  const right = hudGeometry(569, 320, 200, 12, SETTINGS);
  close(right.pauseX, 569 / 2 - PAUSE_INSET);
  close(right.pauseY, 160 - PAUSE_INSET);
  const left = hudGeometry(569, 320, 200, 12, { ...SETTINGS, pauseButtonOnLeft: true });
  close(left.pauseX, -569 / 2 + PAUSE_INSET);
  close(left.pauseY, right.pauseY);
});

test("the HUD holds its place when the view changes shape", () => {
  for (const [w, h] of [[569, 320], [480, 360], [720, 320]]) {
    const g = hudGeometry(w, h, 200, 12, SETTINGS);
    close(g.barY, h / 2 - BAR_TOP_INSET);
    close(g.pauseX, w / 2 - PAUSE_INSET);
    close(g.barX, 0);
  }
});

test("the percentage label: whole number, or two decimals with 0126", () => {
  assert.equal(percentLabel(0), "0%");
  assert.equal(percentLabel(99.99), "99%");
  assert.equal(percentLabel(100), "100%");
  assert.equal(percentLabel(0.4123, true), "0.41%");
  assert.equal(percentLabel(12.5, true), "12.50%");
  assert.equal(percentLabel(100, true), "100.00%");
});
