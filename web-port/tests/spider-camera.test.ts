// Spider camera (USER-10): without free mode the spider locks the view to its
// inherited centre; with free mode (key 111) it follows like the cube. Dash's
// first spider section (portal 1331 at x 975, no key 111) is replayed from the
// real route (macros-main/Dash.gdr.json through createSim + simStep).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cameraBottomTarget, DESIGN_H, GD_Y_OFFSET } from "../src/gd/camera.ts";
import { createSim, simPress, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { loadWorld } from "../scripts/headless.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DASH_MACRO = join(root, "..", "macros-main", "Dash.gdr.json");

test("free spider follows like the cube (key 111 maps the spider to cube)", () => {
  const cube = cameraBottomTarget("cube", 300 - GD_Y_OFFSET, false, 150, 100 - GD_Y_OFFSET, DESIGN_H, true);
  const spider = cameraBottomTarget("spider", 300 - GD_Y_OFFSET, false, 150, 100 - GD_Y_OFFSET, DESIGN_H, true);
  assert.equal(spider, cube);
  assert.notEqual(spider, cameraBottomTarget("spider", 300 - GD_Y_OFFSET, false, 150, 100 - GD_Y_OFFSET, DESIGN_H, false));
});

test("Dash spider x 992–1480 (no free mode): the view stays near native's 79", async () => {
  const macro = JSON.parse(readFileSync(DASH_MACRO, "utf8"));
  const { level, world } = await loadWorld(22);
  const LAST = 1200; // x 1544 is at frame ~1189
  const ins = macro.inputs.filter((i: { btn: number; "2p"?: boolean }) => i.btn === 1 && !i["2p"])
    .sort((a: { frame: number }, b: { frame: number }) => a.frame - b.frame);
  const held = new Uint8Array(LAST + 2), press = new Uint8Array(LAST + 2);
  let cur = 0, i = 0;
  for (let f = 1; f <= LAST; f++) {
    while (i < ins.length && ins[i].frame + 1 <= f) {
      if (ins[i].down) { if (!cur) press[f] = 1; cur = 1; } else cur = 0;
      i++;
    }
    held[f] = cur;
  }
  const s = createSim(0, SPEEDS[1], level);
  let camY = 0; // the port's bottom edge, as the scene keeps it
  if (press[1]) simPress(s, world);
  const seen: { x: number; mode: string; free: boolean; gdCam: number }[] = [];
  for (let f = 1; f <= LAST; f++) {
    simStep(s, world, STEP, !!held[f]);
    if (f < LAST && press[f + 1]) simPress(s, world);
    const p = s.player;
    const target = cameraBottomTarget(p.mode, p.y, p.gravityFlipped, p.cameraYCenter, camY, DESIGN_H, p.freeMode);
    camY += (target - camY) * STEP * 6;
    seen.push({ x: p.x, mode: p.mode, free: !!p.freeMode, gdCam: camY + GD_Y_OFFSET });
  }
  const spider = seen.filter((v) => v.mode === "spider" && !v.free && v.x >= 992 && v.x <= 1480);
  assert.ok(spider.length > 300, `the spider section is replayed (${spider.length} frames)`);
  for (const v of spider) {
    assert.ok(Math.abs(v.gdCam - 79) <= 3, `x ${v.x.toFixed(1)}: view bottom ${v.gdCam.toFixed(2)} is not near 79`);
  }
});
