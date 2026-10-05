// The robot/spider animation state machine. The frame data itself is generated
// from the game's own objectDefinitions/AnimDesc plists; this covers only the
// choice of animation and the position within it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ROBOT_ANIM, SPIDER_ANIM } from "../src/gd/anim.ts";
import { animFrame, createAnimPlayer, stepAnim } from "../src/gd/player-anim.ts";

const run = (mode: "robot" | "spider", steps: [boolean, boolean, number][]) => {
  const a = createAnimPlayer();
  for (const [onGround, rising, dt] of steps) stepAnim(a, mode, onGround, rising, dt);
  return a;
};

test("a robot on the ground runs", () => {
  assert.equal(run("robot", [[true, false, 0.01]]).name, "run");
});

test("leaving the ground upward starts the jump, then falls into its loop", () => {
  const a = createAnimPlayer();
  stepAnim(a, "robot", false, true, 0.01);
  assert.equal(a.name, "jump_start");
  // jump_start is 5 frames at 0.02 s and is not looped
  stepAnim(a, "robot", false, true, 0.1);
  assert.equal(a.name, "jump_loop");
});

test("falling runs fall_start into fall_loop", () => {
  const a = createAnimPlayer();
  stepAnim(a, "robot", false, false, 0.01);
  assert.equal(a.name, "fall_start");
  stepAnim(a, "robot", false, false, 0.15); // 7 frames at 0.02
  assert.equal(a.name, "fall_loop");
});

test("landing goes back to running, from the start of the run", () => {
  const a = createAnimPlayer();
  stepAnim(a, "robot", false, false, 0.5);
  stepAnim(a, "robot", true, false, 0.01);
  assert.equal(a.name, "run");
  assert.equal(a.t, 0.01);
});

test("staying airborne does not restart the loop every step", () => {
  const a = createAnimPlayer();
  stepAnim(a, "robot", false, true, 0.3);
  assert.equal(a.name, "jump_loop");
  const before = a.t;
  stepAnim(a, "robot", false, true, 0.05);
  assert.equal(a.name, "jump_loop");
  assert.ok(a.t > before, "the loop keeps advancing rather than resetting");
});

test("a looped animation wraps; a one-shot holds its last frame", () => {
  const a = createAnimPlayer();
  a.name = "run"; a.t = 0.0275 * 16 + 0.0275 / 2; // one full cycle plus half a frame
  assert.equal(animFrame("robot", a), ROBOT_ANIM.run.frames[0]);
  const b = createAnimPlayer();
  b.name = "fall_start"; b.t = 99;
  assert.equal(animFrame("robot", b), ROBOT_ANIM.fall_start.frames[6]);
});

test("the spider runs on a surface and uses its fall loop off one", () => {
  assert.equal(run("spider", [[true, false, 0.01]]).name, "run");
  assert.equal(run("spider", [[false, false, 0.01]]).name, "fall_loop");
  assert.equal(run("spider", [[false, true, 0.01]]).name, "fall_loop");
});

test("every generated frame names a real body part and a real animation", () => {
  for (const [mode, table] of [["robot", ROBOT_ANIM], ["spider", SPIDER_ANIM]] as const) {
    for (const [name, anim] of Object.entries(table)) {
      assert.equal(anim.frames.length > 0, true, `${mode} ${name} has frames`);
      for (const f of anim.frames) {
        assert.ok(f.length >= 6, `${mode} ${name} frame has every part`);
        for (const p of f) {
          assert.ok(p.l >= 1 && p.l <= 4, `${mode} ${name} limb ${p.l} is 1-4`);
          assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
          assert.ok(Number.isFinite(p.r));
        }
      }
    }
  }
});

test("an unknown animation yields no frame rather than throwing", () => {
  const a = createAnimPlayer();
  a.name = "nonsense";
  assert.equal(animFrame("robot", a), null);
});

// --- geometry: the one thing a wrong unit conversion would silently break ---

test("the idle poses stand exactly one block tall, centred on the player", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { parseAtlas } = await import("../src/engine/atlas.ts");
  const { HD } = await import("../src/gd/sheets.ts");
  const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");
  const atlas = parseAtlas(readFileSync(join(assets, "GJ_GameSheetIcons-hd.plist"), "utf8"));

  for (const [mode, table] of [["robot", ROBOT_ANIM], ["spider", SPIDER_ANIM]] as const) {
    let top = -Infinity, bottom = Infinity;
    for (const p of table.idle.frames[0]) {
      const f = atlas.get(`${mode}_01_0${p.l}_001.png`);
      assert.ok(f, `${mode} limb ${p.l} art exists`);
      // an unrotated half-extent is enough: idle limb rotations are small and
      // the check is about scale, not about the exact silhouette
      const hh = (f.h * HD * p.sy) / 2;
      top = Math.max(top, p.y + hh);
      bottom = Math.min(bottom, p.y - hh);
    }
    const height = top - bottom, centre = (top + bottom) / 2;
    // 1 cocos point = 1 world unit. Treating the positions as HD pixels instead
    // would halve this to ~15 and put the feet in the floor.
    assert.ok(height > 28 && height < 34,
      `${mode} idle stands ~30 units tall, got ${height.toFixed(1)}`);
    assert.ok(Math.abs(centre) < 3,
      `${mode} idle is centred on the player, got ${centre.toFixed(1)}`);
  }
});
