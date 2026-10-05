// Camera Static (1914) views: the exit's per-axis release, decoded from
// `exitStaticCamera` (m1 0x12b6b0) and `CameraTriggerGameObject::triggerObject`
// (m1 0x190b48, the 1914 branch at 0x190bcc / 0x190cac). See BUGS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLevelString, type Level } from "../src/gd/level.ts";
import { buildTriggers, createRuntime, groupAnchor, updateTriggers, type TriggerRuntime } from "../src/gd/triggers.ts";
import { stepViewStatic, VIEW_H, type ViewStatic } from "../src/gd/camera.ts";
import { createSim, simPress, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { loadWorld } from "../scripts/headless.mjs";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** one 60 Hz view step, as the scene does once per frame */
function viewFrame(
  vs: ViewStatic, tg: { x: number; y: number }, camX: number, camY: number,
  last: { x: number; y: number }, out: { x: number; y: number },
) {
  stepViewStatic(vs, tg.x, tg.y, camX, camY, last.x, last.y, 1 / 60, false, out);
  vs.t += 1 / 60;
  last.x = out.x; last.y = out.y;
}

test("an x-only exit releases x and leaves y on its group's static target", async () => {
  // group 304's guide at (500, 555); a both-axis follow static at x 100; an
  // x-only exit (key 101 = 1, key 110 = 1) at x 300
  const level: Level = parseLevelString(
    "kS38,|;1,1,2,500,3,555,57,304;" +
    "1,1914,2,100,3,0,71,304,101,0,212,1,213,100;" +
    "1,1914,2,300,3,0,110,1,101,1,10,1;",
  );
  const list = buildTriggers(level);
  const rt: TriggerRuntime = createRuntime(level);
  for (let x = 0; x <= 400; x += 0.5) updateTriggers(rt, list, x, 1 / 240, 0);
  const vs = rt.viewStatic!;
  assert.ok(vs, "the static is still set");
  assert.equal(vs.exitAxis, 1, "key 101 = 1 releases x only");
  assert.equal(vs.exit, true);

  const tg = groupAnchor(level, rt, 304)!;
  const out = { x: 0, y: 0 };
  const last = { x: 0, y: 300 };
  // the player runs on at x 1000, y 800: the released x must reach it, the held y must not
  for (let f = 0; f < 1000; f++) viewFrame(vs, tg, 1000, 800, last, out);
  assert.ok(Math.abs(out.y - tg.y) < 0.5, `y held on the guide (${out.y.toFixed(2)} vs ${tg.y})`);
  assert.ok(Math.abs(out.x - 1000) < 0.5, `x eased back to the player (${out.x.toFixed(2)})`);
});

test("a both-axis exit releases both axes and the view goes home", async () => {
  const level: Level = parseLevelString(
    "kS38,|;1,1,2,500,3,555,57,304;" +
    "1,1914,2,100,3,0,71,304,101,0,10,1;" +
    "1,1914,2,300,3,0,110,1,101,0,10,1;",
  );
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  for (let x = 0; x <= 400; x += 0.5) updateTriggers(rt, list, x, 1 / 240, 0);
  const vs = rt.viewStatic!;
  assert.equal(vs.exitAxis, 3);
  const out = { x: 0, y: 0 };
  const last = { x: 500, y: 555 };
  const tg = groupAnchor(level, rt, 304)!;
  let live = true;
  for (let f = 0; f < 120 && live; f++) {
    live = stepViewStatic(vs, tg.x, tg.y, 1000, 800, last.x, last.y, 1 / 60, false, out);
    vs.t += 1 / 60;
    last.x = out.x; last.y = out.y;
  }
  assert.equal(live, false, "both axes released: the static is done after its 1 s ease");
  assert.ok(Math.abs(out.y - 800) < 0.5 && Math.abs(out.x - 1000) < 0.5);
});

// The native pin (`/tmp/gd-ui-capture/dash-top.txt`: camera bottom 390.927 at
// frames 11029–15472, x 15001–17001). Replays the Dash macro through the sim,
// which is the real route — the channel-10 exit at x 15767 fires on it.
const DASH_MACRO = join(root, "..", "macros-main", "Dash.gdr.json");
type ViewSample = { frame: number; x: number; centreY: number };
let dashViews: ViewSample[] | null = null;

async function dashViewRun(): Promise<ViewSample[]> {
  if (dashViews) return dashViews;
  const macro = JSON.parse(readFileSync(DASH_MACRO, "utf8"));
  const { level, world } = await loadWorld(22);
  const lastFrame = 15472;
  const ins = macro.inputs.filter((i: { btn: number; "2p"?: boolean }) => i.btn === 1 && !i["2p"])
    .sort((a: { frame: number }, b: { frame: number }) => a.frame - b.frame);
  const held = new Uint8Array(lastFrame + 2), press = new Uint8Array(lastFrame + 2);
  let cur = 0, i = 0;
  for (let f = 1; f <= lastFrame; f++) {
    while (i < ins.length && ins[i].frame + 1 <= f) {
      if (ins[i].down) { if (!cur) press[f] = 1; cur = 1; } else cur = 0;
      i++;
    }
    held[f] = cur;
  }
  const s = createSim(0, SPEEDS[1], level);
  const out = { x: 0, y: 0 };
  const last = { x: 0, y: 0 };
  const samples: ViewSample[] = [];
  if (press[1]) simPress(s, world);
  for (let f = 1; f <= lastFrame; f++) {
    simStep(s, world, STEP, !!held[f]);
    if (f < lastFrame && press[f + 1]) simPress(s, world);
    const rt = s.triggers?.rt;
    const vs = rt?.viewStatic;
    if (!rt || !vs || f % 4 !== 0) continue;
    const tg = groupAnchor(level, rt, vs.group);
    if (!tg) continue;
    const camY = s.player.y;
    stepViewStatic(vs, tg.x, tg.y, s.player.x, camY, last.x || s.player.x, last.y || camY, 1 / 60, false, out);
    last.x = out.x; last.y = out.y;
    samples.push({ frame: f, x: s.player.x, centreY: out.y });
  }
  dashViews = samples;
  return samples;
}

test("Dash: after the x-only exit at x 15767 the view stays on group 304's guide", async () => {
  const samples = await dashViewRun();
  const late = samples.filter((v) => v.frame >= 15080 && v.frame <= 15472);
  assert.ok(late.length > 0, "the static is still set after the exit");
  for (const v of late) {
    assert.ok(Math.abs(v.centreY - 555) < 0.5, `frame ${v.frame}: y ${v.centreY.toFixed(2)} is not the guide's 555`);
  }
});

test("Dash: camera bottom is pinned at 390.927 from x 15001 to 17001", { todo: "bottom = guide 555 - VIEW_H/2 = 395.0, 4.07 above native's 390.927; offset not yet decoded" }, async () => {
  const samples = await dashViewRun();
  for (const v of samples.filter((s) => s.frame >= 11029 && s.frame <= 15472)) {
    const bottom = v.centreY - VIEW_H / 2;
    assert.ok(Math.abs(bottom - 390.927) < 0.5, `frame ${v.frame}: bottom ${bottom.toFixed(3)}`);
  }
});
