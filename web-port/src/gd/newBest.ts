/**
 * The "New Best" popup shown on a death that beats the saved best percent.
 *
 * Sourced from the 2.2081 binary:
 *  - `PlayLayer::destroyPlayer` (m1 0xa75d8): the percent is
 *    `floor(position / length * 100)` capped at 99. It is a new best when it is
 *    above the saved normal best, and never in practice or test mode.
 *  - `PlayLayer::showNewBest` (m1 0xa3050): a node at (winW / 2, winH / 2 + 20)
 *    (+10 more when the run also earned orbs or diamonds, which offline play
 *    never does), z 100, starting at scale 0.01. It runs
 *    ScaleTo(0.4, 1) under ElasticOut(period 0.6), a 0.7 s delay (1.3 s with
 *    rewards), ScaleTo(0.2, 0.01) under EaseIn(rate 2), then removes itself.
 *    `GJ_newBest_001.png` is added at the node's origin with anchor (0.5, 0);
 *    "N%" in bigFont is added at (0, -4), anchor (0.5, 1), scale 1.1.
 */
import { easedValue } from "./easing.ts";

export const NEW_BEST_FRAME = "GJ_newBest_001.png";
/** the node's height above the screen centre, in points */
export const NEW_BEST_Y = 20;
export const NEW_BEST_LABEL_Y = -4;
export const NEW_BEST_LABEL_SCALE = 1.1;

const START_SCALE = 0.01;
const GROW = 0.4;
const ELASTIC_PERIOD = 0.6;
const HOLD = 0.7;
const SHRINK = 0.2;
export const NEW_BEST_DURATION = GROW + HOLD + SHRINK;

/** the percent the game records for a death at `rawPercent` */
export function deathPercent(rawPercent: number): number {
  return Math.min(99, Math.max(0, Math.floor(rawPercent)));
}

export function shouldShowNewBest(a: {
  percent: number; savedBest: number; practice: boolean;
}): boolean {
  if (a.practice) return false;
  return deathPercent(a.percent) > Math.floor(a.savedBest);
}

export const newBestLabel = (percent: number) => `${percent}%`;

/** the popup's scale `t` seconds after it appears, or null once it is gone */
export function newBestScale(t: number): number | null {
  if (t >= NEW_BEST_DURATION) return null;
  if (t < GROW) {
    return START_SCALE + (1 - START_SCALE) * easedValue(t / GROW, 6, ELASTIC_PERIOD);
  }
  if (t < GROW + HOLD) return 1;
  const k = (t - GROW - HOLD) / SHRINK;
  return 1 + (START_SCALE - 1) * k * k;
}
