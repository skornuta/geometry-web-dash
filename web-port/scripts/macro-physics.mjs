// Measure each gamemode's real constants straight out of the macros.
//
// For every frame of every real run this reconstructs the gamemode (from the
// portals the recorded path crossed) and the button state (from the macro's own
// input events), then takes the second difference of the recorded y — which is
// the frame's acceleration times dt^2. Grouping those by (mode, holding,
// gravity) gives the game's actual acceleration for each case, measured over
// tens of thousands of frames instead of guessed.
//
// Only clean frames count: no portal crossed, no surface contact, and the
// neighbouring frames continuous. Surfaces and impulses would otherwise swamp
// the constant we are after.
//
//   node scripts/macro-physics.mjs           # every mode
//   node scripts/macro-physics.mjs ship      # one mode, with the histogram
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadWorld } from "./headless.mjs";
import { PLAYER_HALF } from "../src/game/collision.ts";
import { applyPortal } from "../src/gd/interactives.ts";
import { MINI_SCALE, SPEEDS, RISE_THRESHOLD, RAW_VELOCITY } from "../src/gd/physics.ts";

const MACROS = new URL("../../macros-main/", import.meta.url).pathname;
const Y_OFFSET = 90;
const only = process.argv[2];

const macros = [];
for (const f of readdirSync(MACROS)) {
  if (!f.endsWith(".json")) continue;
  macros.push(JSON.parse(readFileSync(join(MACROS, f), "utf8")));
}
macros.sort((a, b) => a.level.id - b.level.id);

/** key -> histogram of second differences */
const buckets = new Map();

for (const macro of macros) {
  const { world } = await loadWorld(macro.level.id);
  const player = { x: 0, y: 0, yVel: 0, mode: "cube", mini: false, gravityFlipped: false, cameraYCenter: null };
  const run = { speed: SPEEDS[1], mirrored: false, coins: 0 };
  const used = new Set();
  // held state per frame, from the macro's own events (they are answered on the
  // frame after the event — see macro-compare.mjs)
  const fixes = macro.frameFixes.filter((f) => f.p1 && "y" in f.p1);
  const last = fixes[fixes.length - 1].frame;
  const held = new Uint8Array(last + 2);
  {
    const ins = macro.inputs.filter((i) => i.btn === 1 && !i["2p"]).sort((a, b) => a.frame - b.frame);
    let cur = 0, i = 0;
    for (let f = 1; f <= last; f++) {
      while (i < ins.length && ins[i].frame + 1 <= f) { cur = ins[i].down ? 1 : 0; i++; }
      held[f] = cur;
    }
  }
  const ys = new Map(fixes.map((f) => [f.frame, f.p1.y]));
  const modeAt = new Map();
  for (const fx of fixes) {
    const x = fx.p1.x, y = fx.p1.y - Y_OFFSET;
    player.x = x; player.y = y;
    const probe = { x, y, hw: PLAYER_HALF, hh: PLAYER_HALF };
    let crossed = false;
    for (const it of world.nearInteractives(probe)) {
      if (used.has(it.index)) continue;
      if (Math.abs(it.x - x) > it.hw + probe.hw || Math.abs(it.y - y) > it.hh + probe.hh) continue;
      used.add(it.index);
      crossed = true;                       // portals, pads and orbs all disturb y
      if (it.kind === "portal" || it.kind === "speed") applyPortal(it.id, it.props, player, run);
    }
    modeAt.set(fx.frame, {
      mode: player.mode, mini: player.mini, flip: player.gravityFlipped, crossed,
      speed: SPEEDS.indexOf(run.speed),
      scale: (player.mini ? MINI_SCALE : 1),
    });
  }
  // Long baselines, not single frames. A second difference is one step's
  // velocity change, and the recorded y is float32 — at ~0.02 units per step
  // that is 0.1% of quantisation noise. Summing a whole run of identical steps
  // and dividing by its length drops the noise by the run length.
  let runKey = null, runStart = 0, runEnd = 0;
  const flush = () => {
    const n = runEnd + 1 - runStart;
    if (runKey && n >= 20) {
      const v1 = ys.get(runStart) - ys.get(runStart - 1);
      const v2 = ys.get(runEnd + 1) - ys.get(runEnd);
      const m = buckets.get(runKey) ?? buckets.set(runKey, []).get(runKey);
      m.push(((v2 - v1) / n) * 240);   // world units per second, per step
    }
    runKey = null;
  };
  for (const fx of fixes) {
    const f = fx.frame;
    const a = ys.get(f - 1), b = ys.get(f), c = ys.get(f + 1);
    if (a === undefined || b === undefined || c === undefined) { flush(); continue; }
    const st = modeAt.get(f);
    if (!st || st.crossed || modeAt.get(f - 1)?.crossed || modeAt.get(f + 1)?.crossed) { flush(); continue; }
    const d1 = b - a, d2 = c - b;
    // reject surfaces and impulses: a resting or snapping frame is not free flight
    if (Math.abs(d1) < 1e-6 || Math.abs(d2) < 1e-6) { flush(); continue; }
    const sd = d2 - d1;
    if (Math.abs(sd) > 1) { flush(); continue; }
    const up = st.flip ? -1 : 1;
    // the branch the game picks: yVel < 2 * m_gravity (raw), i.e. the ship and
    // UFO brake a fast *climb* -- see RISE_THRESHOLD in physics.ts
    const fast = d1 * 240 * up >= RISE_THRESHOLD;
    const key = `${st.mode}${st.mini ? "-mini" : ""}|${held[f] ? "hold" : "free"}|${st.flip ? "flip" : "norm"}|${fast ? "fast" : "slow"}|s${st.speed}`;
    if (key !== runKey) { flush(); runKey = key; runStart = f; }
    else if (f !== runEnd + 1) { flush(); runKey = key; runStart = f; }
    runEnd = f;
  }
  flush();
}

const rows = [...buckets].filter(([k]) => !only || k.startsWith(only));
rows.sort((a, b) => b[1].length - a[1].length);
console.log("per-step vertical acceleration, measured from the real runs\n");
console.log(`  ${"mode|input|gravity|branch|speed".padEnd(38)} ${"runs".padStart(5)} ${"a (u/s^2)".padStart(12)} ${"raw dv/step".padStart(12)}  3dp?`);
for (const [key, arr] of rows) {
  if (arr.length < 8) continue;
  arr.sort((x, y) => x - y);
  const med = arr[arr.length >> 1];
  const raw = med / RAW_VELOCITY;                    // per step, raw units
  const snapped = Math.round(raw * 1000) / 1000;
  const ok = Math.abs(raw - snapped) < 5e-6 ? "yes" : `NO (${(raw * 1000).toFixed(4)})`;
  console.log(`  ${key.padEnd(38)} ${String(arr.length).padStart(5)} ${(med * 240).toFixed(2).padStart(12)} ${raw.toFixed(6).padStart(12)}  ${ok}`);
}
