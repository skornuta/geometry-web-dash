// A spider portal installs a camera centre from its height, as a ship's does
// (USER-13). Fingerdash (level 21) has a non-free spider portal at x 10695, y 225:
// the spider locks the view to that centre, so the view bottom settles at 140 in
// game units. Before the fix the spider inherited the old centre and the view sat
// at 80. No native capture exists for level 21, so this follows the binary's
// camera-target function (m1 0xfd210) and the portal's data, not a measurement.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cameraBottomTarget, cameraCenterForPortal, DESIGN_H, GD_Y_OFFSET } from "../src/gd/camera.ts";
import { createSim, simPress, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { loadWorld } from "../scripts/headless.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const FINGERDASH_MACRO = join(root, "..", "macros-main", "Fingerdash.gdr.json");

test("a spider portal's centre follows its height like a ship's (game y 315 → 300, port 210)", () => {
  assert.equal(cameraCenterForPortal("spider", 225), 210);
  assert.equal(cameraCenterForPortal("spider", 285), 270, "level 3001's spider portal");
  // Dash's first spider (y 105) lands in the 240 band, where it was already 150
  assert.equal(cameraCenterForPortal("spider", 105), 150);
  assert.equal(cameraCenterForPortal("cube", 225), null, "cube still inherits");
});

test("Fingerdash spider x 10663–: the non-free spider locks the view at the portal's centre", async () => {
  const macro = JSON.parse(readFileSync(FINGERDASH_MACRO, "utf8"));
  const { level, world } = await loadWorld(21);
  const LAST = 8700;
  const ins = macro.inputs.filter((i: { btn: number; "2p"?: boolean }) => i.btn === 1 && !i["2p"])
    .sort((a: { frame: number }, b: { frame: number }) => a.frame - b.frame);
  const held = new Uint8Array(LAST + 2), press = new Uint8Array(LAST + 2);
  let cur = 0, k = 0;
  for (let f = 1; f <= LAST; f++) {
    while (k < ins.length && ins[k].frame + 1 <= f) {
      if (ins[k].down) { if (!cur) press[f] = 1; cur = 1; } else cur = 0;
      k++;
    }
    held[f] = cur;
  }
  const s = createSim(0, SPEEDS[1], level);
  let camY = 0;
  if (press[1]) simPress(s, world);
  const settled: { f: number; mode: string; free: boolean; bottom: number }[] = [];
  for (let f = 1; f <= LAST; f++) {
    simStep(s, world, STEP, !!held[f]);
    if (f < LAST && press[f + 1]) simPress(s, world);
    const p = s.player;
    const target = cameraBottomTarget(p.mode, p.y, p.gravityFlipped, p.cameraYCenter, camY, DESIGN_H, p.freeMode);
    camY += (target - camY) * STEP * 6;
    if (f >= 8500) settled.push({ f, mode: p.mode, free: !!p.freeMode, bottom: camY + GD_Y_OFFSET });
  }
  const spider = settled.filter((v) => v.mode === "spider" && !v.free);
  assert.ok(spider.length > 100, `the spider section is replayed (${spider.length} frames)`);
  for (const v of spider) {
    assert.ok(Math.abs(v.bottom - 140) < 1, `frame ${v.f}: view bottom ${v.bottom.toFixed(2)} is not the portal's 140`);
  }
});
