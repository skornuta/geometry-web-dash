import { test } from "node:test";
import assert from "node:assert/strict";
import type { Gamemode } from "../src/gd/gamemodes.ts";
import { readFileSync } from "node:fs";
import { parseAtlas } from "../src/engine/atlas.ts";
const model = () => import("../src/gd/dashArt.ts");
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const player = (over = {}) => ({ x: 100, y: 200, mode: "cube" as Gamemode, mini: false,
  gravityFlipped: false, sideways: false, reversed: false, dash: 1 as 0 | 1 | 2, dashSlope: 0, ...over });

test("native sheets supply all loop/outline/entry frames with nontrivial flame trim", () => {
  const sheet = (name: string) => parseAtlas(readFileSync(
    new URL(`../public/assets/${name}-hd.plist`, import.meta.url), "utf8"));
  const glow = sheet("GJ_GameSheetGlow"), game04 = sheet("GJ_GameSheet04");
  for (let i = 1; i <= 12; i++) {
    const n = String(i).padStart(3, "0");
    assert.ok(glow.has(`playerDash2_${n}.png`));
    assert.ok(glow.has(`playerDash2_outline_${n}.png`));
  }
  for (let i = 1; i <= 9; i++) assert.ok(game04.has(`playerDash2_boom2_${String(i).padStart(3, "0")}.png`));
  const first = glow.get("playerDash2_001.png")!;
  assert.equal(first.sourceW, 287);
  assert.notEqual(first.offsetX, 0, "parent must rotate/scale trim offsets, not centre the cropped width");
});

test("native loop cadence uses total game time, speed multiplier and local flame rotation", async () => {
  const { dashFrameIndex, dashFrameInterval, nativeDashSpeed } = await model();
  near(dashFrameInterval(1, 0), 0.04);
  near(dashFrameInterval(1, 70), 0.024);
  near(dashFrameInterval(1, -70), 0.024);
  near(dashFrameInterval(2, 0), 0.02);
  assert.deepEqual([0, 0.041, 0.081, 0.441, 0.481].map((t) => dashFrameIndex(t, 1, 0)), [1, 2, 3, 12, 1]);
  assert.equal(dashFrameIndex(0.025, 1, 70), 2);
  assert.deepEqual([251.16, 311.58, 387.42, 468, 576].map(nativeDashSpeed), [0.7, 0.9, 1.1, 1.3, 1.6]);
  assert.equal(nativeDashSpeed(999), 0.9);
});

test("all native mode offsets/scales are local node units, and robot/spider use fall_loop", async () => {
  const { dashModeArt, dashLoopPose } = await model();
  const rows: [Gamemode, number, number, number, number][] = [
    ["cube", 0, 0, 0.9, 0.8], ["ship", 0, -2, 1, 0.85], ["ball", 0, 0, 0.9, 0.8],
    ["ufo", 0, 0, 0.95, 0.9], ["wave", 0, 0, 0.9, 0.8], ["robot", 1, 0, 0.9, 0.85],
    ["spider", 1, 0, 0.95, 0.8], ["swing", 0, 0, 0.9, 0.8],
  ];
  for (const [mode, x, y, sx, sy] of rows) {
    const art = dashModeArt(mode);
    assert.deepEqual([art.x, art.y, art.scaleX, art.scaleY], [x, y, sx, sy]);
    const pose = dashLoopPose(player({ mode }), 1, 1, 0.3);
    near(pose.x, 100 + x); near(pose.y, 200 + y);
    near(pose.scaleX, sx * 1.1); near(pose.scaleY, sy * 1.2);
    assert.equal(pose.playerAnimation, mode === "robot" || mode === "spider" ? "fall_loop" : null);
    assert.equal(pose.playerScale, mode === "cube" || mode === "ball" ? 0.9 : 1);
    near(pose.iconSpin, mode === "cube" || mode === "ball" ? 288 : 0);
  }
});

test("mode offsets and sprite handedness compose mini, gravity, sideways and reversal", async () => {
  const { dashLoopPose } = await model();
  const pose = dashLoopPose(player({ mode: "ship", mini: true, gravityFlipped: true,
    sideways: true, reversed: true }), 1, 1, 0.3);
  near(pose.x, 101.2); near(pose.y, 200);
  near(pose.rotation, -Math.PI / 2);
  near(pose.scaleX, 0.66); near(pose.scaleY, -0.612);
  const angled = dashLoopPose(player({ dashSlope: 1, mode: "robot" }), 1, 1, 0.3);
  near(angled.x, 100 + Math.SQRT1_2); near(angled.y, 200 + Math.SQRT1_2);
  near(angled.rotation, Math.PI / 4);
});

test("entrance scale follows the two native .1s targets and settles after .2s", async () => {
  const { dashLoopPose } = await model();
  const p = player({ mode: "ship" });
  const start = dashLoopPose(p, 0, 1, 0), peak = dashLoopPose(p, 0.1, 1, 0.1);
  near(start.scaleX, 0.3); near(start.scaleY, 0.2);
  near(peak.scaleX, 1.1 * 0.9); near(peak.scaleY, 0.85 * 1.2 * 1.2);
  const end = dashLoopPose(p, 0.2, 1, 0.2);
  near(end.scaleX, 1.1); near(end.scaleY, 0.85 * 1.2);
  near(start.kitColorMix, 0); near(peak.kitColorMix, 0); near(end.kitColorMix, 0.5);
  near(dashLoopPose(p, 0.3, 1, 0.3).kitColorMix, 1);
});

test("entry boom is independent, nine frames at .05s, scale1.2 and fade .2+.3", async () => {
  const { createDashArt, stepDashArt, dashArtSprites } = await model();
  let s = stepDashArt(createDashArt(1), 0, player(), 1, { entryPosition: { x: 10, y: 20 } });
  const entry = () => dashArtSprites(s).find((p) => p.kind === "entry")!;
  assert.equal(entry().frame, "playerDash2_boom2_001.png");
  near(entry().scaleX, 1.2); near(entry().x, 10); near(entry().y, 20);
  s = stepDashArt(s, 0.25, player({ x: 400 }), 1);
  assert.equal(entry().frame, "playerDash2_boom2_006.png");
  near(entry().alpha, 5 / 6); near(entry().x, 10);
  s = stepDashArt(s, 0.2, player(), 1);
  assert.equal(s.entries.length, 0, "native animate/remove finishes before the separate .5s fade action");
});

test("stop detaches frame1 flame+outline for .2s, shrinks to20%, moves world-x -20 and fades", async () => {
  const { createDashArt, stepDashArt, dashArtSprites } = await model();
  let s = stepDashArt(createDashArt(), 0, player({ mode: "ship" }), 1);
  s = stepDashArt(s, 0.3, player({ mode: "ship" }), 1);
  const last = s.loop!;
  s = stepDashArt(s, 0, player({ dash: 0 }), 1);
  assert.equal(s.loop, null);
  assert.equal(s.remnants.length, 1);
  s = stepDashArt(s, 0.1, player({ dash: 0, x: 900 }), 1);
  const parts = dashArtSprites(s).filter((p) => p.kind !== "entry");
  assert.equal(parts.length, 2);
  assert.equal(parts[0].frame, "playerDash2_001.png");
  assert.equal(parts[1].frame, "playerDash2_outline_001.png");
  near(parts[0].x, last.x - 10); near(parts[0].y, last.y);
  near(parts[0].scaleX, last.scaleX * 0.6); near(parts[0].alpha, 0.5);
  near(parts[1].alpha, (150 / 255) * 0.5);
  s = stepDashArt(s, 0.1, player({ dash: 0 }), 1);
  assert.equal(s.remnants.length, 0);
});

test("per-player clocks advance while idle, freeze on pause and reset without remnants", async () => {
  const { createDashArt, stepDashArt } = await model();
  const a = stepDashArt(createDashArt(), 0.3, player({ dash: 0 }), 1);
  const b = createDashArt(2);
  const started = stepDashArt(a, 0, player(), 1);
  assert.equal(started.totalTime, 0.3);
  assert.equal(started.loop!.frame, 8, "activation does not restart the native totalTime clock");
  assert.equal(b.totalTime, 2);
  const paused = stepDashArt(started, 1, player({ dash: 0 }), 1, { paused: true });
  assert.equal(paused, started);
  assert.equal(createDashArt().entries.length, 0);
  assert.equal(createDashArt().remnants.length, 0);
  const noFx = stepDashArt(createDashArt(), 0, player(), 1, { effectsEnabled: false });
  assert.equal(noFx.entries.length, 0);
  assert.equal(stepDashArt(noFx, 0, player({ dash: 0 }), 1, { effectsEnabled: false }).remnants.length, 0);
});
