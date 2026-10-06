// An S block (1829) ends a dash orb's dash and takes the press with it: a button
// held through the block does not re-jump the cube on landing (USER-12). Dash
// (level 22) at x 2715: the dash ends on the S block at 2745's left edge, and the
// cube falls to the floor at frame 2253. The macro releases the button at 2205;
// this test holds it through the landing, and then tries a fresh press.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSim, simPress, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { loadWorld } from "../scripts/headless.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DASH_MACRO = join(root, "..", "macros-main", "Dash.gdr.json");

/** Dash's macro route, with the button forced down over `holdFrom..holdTo` and a fresh press at `pressAt` */
async function replayWithHold(holdFrom: number, holdTo: number, pressAt: number, last: number) {
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
    // the macro up to the S block, then the forced hold
    if (f >= holdFrom && f <= holdTo) held[f] = 1;
  }
  // a fresh press: the button goes down and stays down for the next frame
  if (pressAt > 0) { press[pressAt] = 1; held[pressAt] = 1; held[pressAt + 1] = 1; }
  const s = createSim(0, SPEEDS[1], level);
  const vy: number[] = [];
  const ground: boolean[] = [];
  if (press[1]) simPress(s, world);
  for (let f = 1; f <= last; f++) {
    simStep(s, world, STEP, !!held[f]);
    if (f < last && press[f + 1]) simPress(s, world);
    vy.push(s.player.yVel);
    ground.push(s.player.onGround);
  }
  return { vy, ground };
}

test("a button held through an S block does not re-jump on landing (Dash, x 2715–2790)", async () => {
  // the macro's own route up to frame 2204, then held through the landing at 2253
  const { vy, ground } = await replayWithHold(2205, 2300, 0, 2300);
  const landed = ground.indexOf(true, 2204);
  assert.ok(landed >= 2240 && landed <= 2260, `lands near frame 2253 (got ${landed + 1})`);
  for (let f = landed; f < landed + 40; f++) {
    assert.ok(vy[f] <= 0, `frame ${f + 1}: no jump while held (yVel ${vy[f].toFixed(1)})`);
  }
});

test("a fresh press after an S block still jumps off the floor", async () => {
  // released at 2205, pressed again on frame 2290 once the cube is on the floor
  const { vy, ground } = await replayWithHold(2205, 2220, 2290, 2300);
  const landed = ground.indexOf(true, 2204);
  assert.ok(landed >= 2240 && landed <= 2260, `lands near frame 2253 (got ${landed + 1})`);
  assert.ok(vy[2289] > 100, `the fresh press at 2290 jumps (yVel ${vy[2289].toFixed(1)})`);
});
