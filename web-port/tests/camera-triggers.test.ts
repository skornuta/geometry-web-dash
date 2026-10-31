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
import { stepViewStatic, stepViewStaticPair, VIEW_H, GD_Y_OFFSET, type ViewStatic } from "../src/gd/camera.ts";
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

// The native pin: Dash's view bottom settles at 390.927 (zoom 0.6, x 15001–17001;
// docs/fidelity/captures-2026-10-03/dash-full.txt rows 14960–15472). Replays the
// Dash macro through the sim, which is the real route — the channel-10 exit at
// x 15767 fires on it. The bottom is the drawn one — centre - 160/zoom — in the
// game's own y (port + 90); the game's `cam.y` is that visible edge.
const DASH_MACRO = join(root, "..", "macros-main", "Dash.gdr.json");
type ViewSample = { frame: number; x: number; centreY: number; bottomGd: number };
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
    const zoom = rt.zoom;
    stepViewStaticPair(null, null, vs, tg, s.player.x, camY, last.x || s.player.x, last.y || camY, 1 / 60, false, zoom, 571, out);
    last.x = out.x; last.y = out.y;
    samples.push({ frame: f, x: s.player.x, centreY: out.y, bottomGd: out.y - VIEW_H / 2 / zoom + GD_Y_OFFSET });
  }
  dashViews = samples;
  return samples;
}

test("Dash: after the x-only exit at x 15767 the view stays on group 304's guide", async () => {
  const samples = await dashViewRun();
  const late = samples.filter((v) => v.frame >= 15080 && v.frame <= 15472);
  assert.ok(late.length > 0, "the static is still set after the exit");
  // the guide sits at 555 + 12.6 (its lock-to-player climb); the view is centred
  // exactly on it (the drawn bottom is then centre - 160/zoom, see the next test)
  const centre = 555 + 12.6;
  for (const v of late) {
    assert.ok(Math.abs(v.centreY - centre) < 0.5, `frame ${v.frame}: y ${v.centreY.toFixed(2)} is not the guide's ${centre.toFixed(2)}`);
  }
});

test("Dash: camera bottom settles at the native 390.927 once the guide's lock-to-player move has run", async () => {
  const samples = await dashViewRun();
  const native = new Map<number, number>();
  for (const l of readFileSync(join(root, "..", "docs", "fidelity", "captures-2026-10-03", "dash-full.txt"), "utf8").split("\n")) {
    const p = l.split(" ");
    if (p.length > 12) native.set(+p[0], +p[10]);
  }
  const late = samples.filter((v) => v.frame >= 15000 && v.frame <= 15472);
  assert.ok(late.length > 100);
  for (const v of late) {
    assert.ok(Math.abs(v.bottomGd - native.get(v.frame)!) < 0.5,
      `frame ${v.frame}: bottom ${v.bottomGd.toFixed(3)} vs native ${native.get(v.frame)}`);
  }
});
