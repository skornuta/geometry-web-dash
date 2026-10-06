// Two Camera Statics live at once, one per axis (USER-11). Dash's free-mode
// spider section at x 2025: a y-only static (1914, key 101 = 2) and an x-only
// static (key 101 = 1) both fire on group 119 at x 2025. The runtime used to keep
// only the last one, so the y-hold was lost and the view followed the player up
// and down. Native holds the view at 32.9999 from x 2158 to 2412 (dash-full.txt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSim, simPress, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { DESIGN_H, GD_Y_OFFSET, cameraBottomTarget, stepViewStaticPair } from "../src/gd/camera.ts";
import { groupAnchor, type TriggerRuntime } from "../src/gd/triggers.ts";
import { loadWorld } from "../scripts/headless.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DASH_MACRO = join(root, "..", "macros-main", "Dash.gdr.json");
/** the native window is 571 x 320 (dash-full.txt header), so the view is 571 wide */
const NATIVE_VIEW_W = 571;

/** Dash's macro route through createSim + simStep, with the view built the way the scene builds it */
async function dashRoute(last: number) {
  const macro = JSON.parse(readFileSync(DASH_MACRO, "utf8"));
  const { level, world } = await loadWorld(22);
  const ins = macro.inputs.filter((i: { btn: number; "2p"?: boolean }) => i.btn === 1 && !i["2p"])
    .sort((a: { frame: number }, b: { frame: number }) => a.frame - b.frame);
  const held = new Uint8Array(last + 2), press = new Uint8Array(last + 2);
  let cur = 0, i = 0;
  for (let f = 1; f <= last; f++) {
    while (i < ins.length && ins[i].frame + 1 <= f) {
      if (ins[i].down) { if (!cur) press[f] = 1; cur = 1; } else cur = 0;
      i++;
    }
    held[f] = cur;
  }
  const s = createSim(0, SPEEDS[1], level);
  const out = { x: 0, y: 0 };
  let camY = 0, lastX = 0, lastY = 0;
  const frames: { x: number; y: number; rt: TriggerRuntime; view: number; follow: number }[] = [];
  if (press[1]) simPress(s, world);
  for (let f = 1; f <= last; f++) {
    simStep(s, world, STEP, !!held[f]);
    if (f < last && press[f + 1]) simPress(s, world);
    const p = s.player;
    const rt = s.triggers!.rt;
    // the follow, as the scene's `stepCameraY` keeps it
    const target = cameraBottomTarget(p.mode, p.y, p.gravityFlipped, p.cameraYCenter, camY, DESIGN_H, p.freeMode);
    camY += (target - camY) * STEP * 6;
    const follow = camY + DESIGN_H / 2;
    const vs = rt.viewStatic, vo = rt.viewStaticOther;
    let view = follow;
    if (vs || vo) {
      const tgS = vs ? groupAnchor(s.triggers!.level, rt, vs.group) : null;
      const tgO = vo ? groupAnchor(s.triggers!.level, rt, vo.group) : null;
      if (tgS || tgO) {
        const live = stepViewStaticPair(vo, tgO, vs, tgS, p.x + 75, follow, lastX || p.x + 75, lastY || follow, STEP, false, rt.zoom, NATIVE_VIEW_W, out);
        if (!live.second) rt.viewStatic = null;
        if (!live.first) rt.viewStaticOther = null;
        view = out.y; lastX = out.x; lastY = out.y;
      }
    }
    frames.push({ x: p.x, y: p.y, rt, view, follow });
  }
  return frames;
}

test("the y-only and the x-only static from x 2025 are both live (Dash, group 119)", async () => {
  const frames = await dashRoute(1580);
  const after = frames.filter((v) => v.x >= 2030 && v.x <= 2100);
  assert.ok(after.length > 0, "the route reaches x 2030");
  for (const v of after) {
    assert.equal(v.rt.viewStatic?.axis, 1, `x ${v.x.toFixed(1)}: the x-only static is live`);
    assert.equal(v.rt.viewStaticOther?.axis, 2, `x ${v.x.toFixed(1)}: the y-only static is still held`);
  }
});

test("Dash free spider x 2185–2412: the view holds while the player moves up and down", async () => {
  const frames = await dashRoute(2030);
  const held = frames.filter((v) => v.x >= 2185 && v.x <= 2412);
  assert.ok(held.length > 100, `the section is replayed (${held.length} frames)`);
  const ys = held.map((v) => v.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 100, "the player moves over more than 100 units");
  const views = held.map((v) => v.view);
  const range = Math.max(...views) - Math.min(...views);
  assert.ok(range < 1, `the view moves ${range.toFixed(2)} while the y-hold is live`);
  // the bottom, in game units (the view is 320 tall at zoom 1; native reads 32.9999 here, zoom 0.8333)
  for (const v of held) {
    const bottom = v.view - DESIGN_H / 2 + GD_Y_OFFSET;
    assert.ok(Math.abs(bottom - 33) < 0.5, `x ${v.x.toFixed(1)}: bottom ${bottom.toFixed(2)} is not native 32.9999`);
  }
});
