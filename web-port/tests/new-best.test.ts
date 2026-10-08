// The "New Best" popup, read out of the shipping 2.2081 binary:
//
//   PlayLayer::destroyPlayer  m1 0xa75d8  (percent = floor(pos/len*100) capped at 99;
//                                          new best = percent > the saved normal best;
//                                          none in practice or test mode)
//   PlayLayer::showNewBest    m1 0xa3050  (node at (winW/2, winH/2 + 20), scale
//                                          0.01 -> 1 in 0.4 s under ElasticOut(0.6), held
//                                          0.7 s, back to 0.01 in 0.2 s under EaseIn(2),
//                                          then removed; GJ_newBest_001 sits on the
//                                          node's origin, anchor (0.5, 0); "N%" in
//                                          bigFont at (0, -4), anchor (0.5, 1), scale 1.1)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NEW_BEST_DURATION, NEW_BEST_FRAME, NEW_BEST_Y, deathPercent, newBestLabel,
  newBestScale, shouldShowNewBest,
} from "../src/gd/newBest.ts";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("a run that beats the saved best shows New Best", () => {
  assert.equal(shouldShowNewBest({ percent: 42, savedBest: 30, practice: false }), true);
  assert.equal(shouldShowNewBest({ percent: 5, savedBest: 0, practice: false }), true);
});

test("a run that does not beat the saved best does not", () => {
  assert.equal(shouldShowNewBest({ percent: 30, savedBest: 30, practice: false }), false);
  assert.equal(shouldShowNewBest({ percent: 12, savedBest: 30, practice: false }), false);
  // the comparison is on whole percents
  assert.equal(shouldShowNewBest({ percent: 30, savedBest: 30.6, practice: false }), false);
  assert.equal(shouldShowNewBest({ percent: 0, savedBest: 0, practice: false }), false);
});

test("practice mode never shows it", () => {
  assert.equal(shouldShowNewBest({ percent: 80, savedBest: 10, practice: true }), false);
});

test("the death percent floors and stops at 99", () => {
  assert.equal(deathPercent(41.9), 41);
  assert.equal(deathPercent(100), 99);
  assert.equal(deathPercent(-3), 0);
  assert.equal(newBestLabel(41), "41%");
});

test("the popup grows with an elastic overshoot, holds, shrinks and ends", () => {
  close(newBestScale(0), 0.01);
  close(newBestScale(0.4), 1);
  assert.ok((newBestScale(0.1) ?? 0) > 1, "elastic out overshoots before settling");
  close(newBestScale(0.4 + 0.35) ?? -1, 1);
  // the shrink is an ease-in of rate 2 over 0.2 s
  close(newBestScale(1.1 + 0.1) ?? -1, 1 - 0.99 * 0.25);
  close(NEW_BEST_DURATION, 1.3);
  assert.equal(newBestScale(NEW_BEST_DURATION), null);
  assert.equal(newBestScale(5), null);
});

test("sprite and position", () => {
  assert.equal(NEW_BEST_FRAME, "GJ_newBest_001.png");
  assert.equal(NEW_BEST_Y, 20);
});
