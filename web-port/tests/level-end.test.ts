// The level's end, its length, the jump counter and the ending's timeline,
// read out of the shipping 2.2081 binary (src/gd/levelEnd.ts has the
// addresses; docs/fidelity/FIDELITY.md §1 the working).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CollisionWorld } from "../src/game/collision.ts";
import {
  cloneSim, createSim, restoreSim, simPress, simStep, STEP,
} from "../src/game/sim.ts";
import type { Level } from "../src/gd/level.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import {
  CLASSIC_SCREEN_RIGHT, COMPLETE_TEXT_DELAY, END_LAYER_DELAY, PULL_DURATION,
  bannerScale, circleWaveAt, clampCameraLeft, endPortalY, endTimeline,
  endTriggerX, endWallSquares, lastObjectX, levelLength, pullPose,
} from "../src/gd/levelEnd.ts";
import { LEVEL_TIMESTAMP, progressPercent } from "../src/gd/levelEnd.ts";
import { EndSequence } from "../src/gd/endSequence.ts";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

function levelOf(objs: { id: number; x: number; y: number }[]): Level {
  return {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: objs.map((o) => ({ ...o, props: new Map<number, string>() })),
  } as unknown as Level;
}

function worldOf(level: Level) {
  const sizes: Record<number, { w: number; h: number }> = {
    1: { w: 30, h: 30 }, 36: { w: 36, h: 36 }, 35: { w: 25, h: 4 },
  };
  return new CollisionWorld(level, (id) => sizes[id] ?? null);
}

test("the level is 340 longer than its last object, whatever that object is", () => {
  // `createObjectsFromSetupFinished` +228..276, over PlayLayer+0x36a0, which
  // `addObject` raises for every object — a trigger counts as much as a block
  const level = levelOf([{ id: 1, x: 900, y: 15 }, { id: 901, x: 4000, y: 300 }]);
  assert.equal(lastObjectX(level), 4000);
  assert.equal(levelLength(4000), 4340);
  // the screen floor only binds for a level shorter than about half a screen
  close(levelLength(0), CLASSIC_SCREEN_RIGHT + 300);
  assert.equal(levelLength(100, 480), 780);
  // `getSpawnPos`: the player is locked 300 before the portal
  assert.equal(endTriggerX(4340), 4040);
});

test("reaching the portal's spawn x ends the level and locks the player", () => {
  const level = levelOf([{ id: 1, x: 600, y: 300 }]);
  const world = worldOf(level);
  const s = createSim(0, SPEEDS[1], level);
  assert.equal(s.levelLength, 940);
  let steps = 0;
  while (!s.ended && steps < 10000) { simStep(s, world, STEP, false); steps++; }
  assert.ok(s.ended, "the ending triggered");
  assert.ok(s.player.x >= 640 && s.player.x < 645, `locked at ${s.player.x}`);
  // locked: nothing moves it, not even a held button, and it cannot die
  const x = s.player.x, y = s.player.y;
  simPress(s);
  for (let i = 0; i < 480; i++) simStep(s, world, STEP, true);
  assert.equal(s.player.x, x);
  assert.equal(s.player.y, y);
  assert.equal(s.dead, false);
});

test("jumps count ground jumps and orb activations, not pads", () => {
  // a yellow pad at 200, and an orb at 700 that a plain run never touches
  const level = levelOf([
    { id: 35, x: 200, y: 2 }, { id: 36, x: 700, y: 75 }, { id: 1, x: 6000, y: 15 },
  ]);
  const world = worldOf(level);
  const s = createSim(0, SPEEDS[1], level);
  // run over the pad without pressing: it launches, but that is not a jump
  for (let i = 0; i < 240; i++) simStep(s, world, STEP, false);
  assert.equal(s.jumps, 0, "a pad is not a jump");
  // a ground jump counts once
  for (let i = 0; i < 480 && !s.player.onGround; i++) simStep(s, world, STEP, false);
  simPress(s);
  simStep(s, world, STEP, true);
  assert.equal(s.jumps, 1);
  // holding through the landing re-jumps a cube, and each one counts
  for (let i = 0; i < 240; i++) simStep(s, world, STEP, true);
  assert.ok(s.jumps >= 2, `held cube re-jumps are counted (${s.jumps})`);
});

test("an orb that fires counts as a jump", () => {
  const level = levelOf([{ id: 36, x: 300, y: 15 }, { id: 1, x: 6000, y: 15 }]);
  const world = worldOf(level);
  const s = createSim(0, SPEEDS[1], level);
  s.player.onGround = false;
  s.player.y = 15;
  // hold from before the orb: the buffered press fires it
  simPress(s);
  let fired = false;
  for (let i = 0; i < 240; i++) {
    const before = s.jumps;
    simStep(s, world, STEP, true);
    if (s.jumps > before && Math.abs(s.player.x - 300) < 40) fired = true;
  }
  assert.ok(fired, "the orb's activation incremented the counter");
});

test("the jump counter survives a checkpoint restore and is cloned for the search", () => {
  const level = levelOf([{ id: 1, x: 6000, y: 15 }]);
  const world = worldOf(level);
  const s = createSim(0, SPEEDS[1], level);
  const snap = cloneSim(s);
  simPress(s);
  simStep(s, world, STEP, true);
  assert.equal(s.jumps, 1);
  assert.equal(cloneSim(s).jumps, 1);
  // PlayLayer keeps the count, not the player, so a practice rewind keeps it
  restoreSim(s, snap);
  assert.equal(s.jumps, 1);
});

test("the camera stops with the portal on the right edge", () => {
  // updateCamera +276..336: left edge <= levelLength - winW
  assert.equal(clampCameraLeft(1000, 5000, 569), 1000);
  close(clampCameraLeft(4600, 5000, 569), 5000 - 569);
});

test("the portal stands at the camera centre, never below GD y 225", () => {
  assert.equal(endPortalY(70, false), 135);
  assert.equal(endPortalY(300, false), 300);
  // a ship takes the camera centre as it is
  assert.equal(endPortalY(70, true), 70);
});

test("the pull is a 1 s eased bezier that ends 50 past and 20 under the portal", () => {
  const start = { x: 1000, y: 15 }, portal = { x: 1300, y: 135 };
  const a = pullPose(start, portal, 0);
  close(a.x, 1000);
  close(a.y, 15);
  close(a.spin, 0);
  const b = pullPose(start, portal, PULL_DURATION);
  close(b.x, 1350);
  close(b.y, 115);
  close(b.spin, 360);
  // CCEaseIn: slow to leave
  assert.ok(pullPose(start, portal, 0.5).x - 1000 < 175);
});

test("the timeline: levelComplete at 1 s, the text 1.755 s later, results 1.5 s after", () => {
  const n = endTimeline(false);
  close(n.complete, 1);
  close(COMPLETE_TEXT_DELAY, 1.755);
  close(n.text, 2.755);
  close(n.endLayer, 2.755 + END_LAYER_DELAY);
  // practice skips the flash: the text follows after 0.1 s
  const p = endTimeline(true);
  close(p.text, 1.1);
  close(p.endLayer, 2.6);
});

test("the sequence fires its events once each, in order", () => {
  const seq = new EndSequence({
    practice: false, start: { x: 0, y: 15 }, portal: { x: 340, y: 135 },
    viewW: 569, viewH: 320, rand: () => 0.5,
  });
  const seen: string[] = [];
  for (let i = 0; i < 400; i++) seen.push(...seq.update(1 / 60));
  assert.deepEqual(seen, ["complete", "text", "endLayer"]);
  assert.ok(seq.resultsShown);
  // the flash: sixteen strips, then the white layer
  assert.equal(seq.strips.length, 16);
  assert.ok(seq.flashLayer);
  // ten fireworks and the waves are queued
  assert.ok(seq.waves.length >= 10 + 5 + 5 + 2);
});

test("the banner pops elastically, holds and shrinks away", () => {
  assert.equal(bannerScale(-0.1, false), 0);
  close(bannerScale(0, false), 0.01);
  close(bannerScale(0.66, false), 1.1);
  close(bannerScale(1.2, false), 1.1);
  close(bannerScale(0.66, true), 1.0);
  assert.equal(bannerScale(0.66 + 0.88 + 0.23, false), 0);
});

test("a fading-in circle wave peaks halfway, a plain one fades from full", () => {
  const w = { from: 10, to: 250, duration: 0.5, fadeIn: true, outline: true, lineWidth: 4 };
  close(circleWaveAt(w, 0.25)!.opacity, 1);
  close(circleWaveAt(w, 0.25)!.radius, 130);
  assert.equal(circleWaveAt(w, 0.6), null);
  const f = { ...w, fadeIn: false };
  close(circleWaveAt(f, 0)!.opacity, 1);
  close(circleWaveAt(f, 0.5)!.radius, 250);
});

test("the end wall is one square per 30 units of 1.5 screen heights", () => {
  const ys = endWallSquares(320);
  assert.equal(ys.length, 16);
  assert.equal(ys[0], 240 - 15);
  assert.equal(ys[15], 240 - 15 - 15 * 30);
});

test("the end pull follows Back On Track's real pull frame for frame", async () => {
  const { pullPose } = await import("../src/gd/levelEnd.ts");
  // real run, GD coordinates: pull from f19271 at (25045.13, 251.99) into the
  // portal at (25345, 225); samples every 32 frames, x, y and spin
  const start = { x: 25045.130859, y: 251.992767 };
  const portal = { x: 25345, y: 225 };
  const real: [number, number, number, number][] = [
    [19303, 25046.25, 254.63, 17.5], [19335, 25052.13, 263.89, 49.6],
    [19367, 25066.93, 277.55, 91.1], [19399, 25095.59, 290.34, 140.2],
    [19431, 25143.88, 294.80, 196.0], [19463, 25218.32, 281.69, 257.6],
    [19495, 25326.13, 240.18, 324.6], [19511, 25395.00, 205.00, 360.0],
  ];
  for (const [f, x, y, spin] of real) {
    const p = pullPose(start, portal, (f - 19271) / 240);
    assert.ok(Math.abs(p.x - x) < 0.02 && Math.abs(p.y - y) < 0.02, `f${f}: (${p.x}, ${p.y}) vs (${x}, ${y})`);
    assert.ok(Math.abs(p.spin - spin) < 0.1, `f${f}: spin ${p.spin} vs ${spin}`);
  }
});

test("a timestamped level measures progress by steps (Dash: 21940)", () => {
  assert.equal(LEVEL_TIMESTAMP.get(22), 21940);
  assert.equal(LEVEL_TIMESTAMP.get(1), undefined);
  // 2.2 playthrough: 48 % at 43.9 s into the run
  assert.equal(Math.floor(progressPercent(0, 24085, Math.round(43.9 * 240) + 2, 21940)), 48);
  assert.equal(progressPercent(0, 24085, 30000, 21940), 100);
  // no timestamp: x over the length, as before
  assert.equal(progressPercent(12042.5, 24085, 0), 50);
});
