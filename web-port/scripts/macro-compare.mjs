// Replay a **real Geometry Dash run** through the port's sim and diff it against
// the game's own per-frame position trace.
//
// The macros in `macros-main/` are xdBot `.gdr.json` recordings of complete runs
// of the classic levels. Two things make them the best fidelity evidence this
// project has:
//
//   * `framerate` is **240**, exactly the sim's fixed step, so one macro frame
//     is one `simStep` — no resampling, no drift from a timing mismatch.
//   * `frameFixes` carries the real game's `(x, y)` for **every frame**. That is
//     the native per-tick trace the plan's Task 12 wanted, already recorded.
//
// So: feed the real inputs in, and the first frame where our position leaves the
// game's is the exact point the port stops being Geometry Dash. A death on our
// side that the real run did not have is a hitbox or a block-placement fault at
// a known x; a slow drift is a physics constant.
//
// Coordinates: the macro is in GD space, the port is y-up with the ground at 0
// (`gd_y = our_y + 90`, ARCHITECTURE-REFERENCE §1). x needs no conversion — the
// macro's first frame is 1.29825, which is 311.58/240, the port's own speed 1.
//
//   node scripts/macro-compare.mjs                 # every macro, summary table
//   node scripts/macro-compare.mjs 14              # one level, with detail
//   node scripts/macro-compare.mjs 14 --tol=1      # divergence threshold
//   node scripts/macro-compare.mjs 14 --csv=out.csv
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorld } from "./headless.mjs";
import { createSim, simPress, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { toLocal } from "../src/game/frame.ts";

const MACROS = new URL("../../macros-main/", import.meta.url).pathname;
/** the port's y plus this is the game's y */
const Y_OFFSET = 90;

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const only = args.find((a) => !a.startsWith("--"));
const TOL = parseFloat(flag("tol", "1"));
/**
 * x gets its own, looser tolerance. The game nudges x forward by exactly 1.0 on
 * some cube landings (11 times in Stereo Madness, always with `onGround` set on
 * that frame) — an effect the port does not reproduce and which is not decoded.
 * It accumulates a few units of x over a level without changing the shape of
 * anything, so it must not drown out the y faults that matter.
 */
const TOLX = parseFloat(flag("tolx", "8"));
/**
 * Frames to delay the macro's inputs by. xdBot records the button state when it
 * polls, and the game acts on it on the *next* physics frame, so an event
 * stamped frame F is a press the game first answers on F+1.
 */
const SHIFT = parseInt(flag("shift", "1"), 10);
const csvOut = flag("csv", null);
/** `--probe=F`: after step F, print the colliders around the player as the sim sees them */
const PROBE = parseInt(flag("probe", "-1"), 10);
/**
 * Re-sync mode. Because the macro's inputs are open loop, the *first* error in a
 * level hides every later one — the run is off the rails from then on. With
 * `--resync` the sim is snapped back onto the recorded position (and its
 * velocity, read from the trace) whenever it drifts past the tolerance, so one
 * pass reports every independent fault in the level instead of just the first.
 */
const RESYNC = args.includes("--resync");
/** `--watch-shader`: log each frame the screen shader state changes (which shaders fire on the real inputs) */
const WATCH_SHADER = args.includes("--watch-shader");

/** level id -> macro path */
function macroIndex() {
  const out = new Map();
  for (const f of readdirSync(MACROS)) {
    if (!f.endsWith(".json")) continue;
    const m = JSON.parse(readFileSync(join(MACROS, f), "utf8"));
    out.set(m.level.id, { file: f, macro: m });
  }
  return out;
}

/** per-frame held/pressed arrays from the macro's input events */
function inputTimeline(macro, lastFrame, shift = 0) {
  const held = new Uint8Array(lastFrame + 2);
  const press = new Uint8Array(lastFrame + 2);
  const ins = macro.inputs
    .filter((i) => i.btn === 1 && !i["2p"])
    .sort((a, b) => a.frame - b.frame);
  let cur = 0, i = 0;
  for (let f = 1; f <= lastFrame; f++) {
    while (i < ins.length && ins[i].frame + shift <= f) {
      if (ins[i].down) { if (!cur) press[f] = 1; cur = 1; } else cur = 0;
      i++;
    }
    held[f] = cur;
  }
  return { held, press };
}

export async function compare(levelId, macro, { csv = null, shift = SHIFT } = {}) {
  const { level, world } = await loadWorld(levelId);
  const fixes = macro.frameFixes;
  const lastFrame = fixes[fixes.length - 1].frame;
  const { held, press } = inputTimeline(macro, lastFrame, shift);
  const byFrame = new Map(fixes.map((f) => [f.frame, f.p1]));
  /** player 2 — the dual partner (`s.dual`) */
  const byFrame2 = new Map(fixes.filter((f) => f.p2).map((f) => [f.frame, f.p2]));
  const s = createSim(0, SPEEDS[1], level);

  let firstDiverge = null;
  let maxDx = 0, maxDy = 0;
  /** independent faults found this run, when re-syncing */
  const faults = [];
  /** frames still to coast before a fault can be recorded again */
  let settle = 0;
  const rows = csv ? ["frame,p2,x,y,gx,gy,dx,dy,mode,vy,onGround,camY,frameFlags"] : null;
  let deadAt = null;

  // The ending is presentation: once the sim locks the player, the scene pulls
  // it into the portal (`pullPose`, gd/levelEnd.ts — pinned against Back On
  // Track's real pull in tests/level-end.test.ts). The pull itself starts 3-6
  // frames after the lock, on the action scheduler's next tick, so positions
  // are not compared past the lock. What *is* checked is the lock frame: the
  // real run's last frame of normal running must be the sim's lock frame.
  let endFrame = null;
  const fixes2 = macro.frameFixes;
  let realLock = null;
  for (let i = fixes2.length - 1; i > 2; i--) {
    const d1 = fixes2[i].p1.x - fixes2[i - 1].p1.x, d0 = fixes2[i - 1].p1.x - fixes2[i - 2].p1.x;
    if (d1 > 0.5 && Math.abs(d1 - d0) < 1e-3) { realLock = fixes2[i].frame; break; }
  }

  // A press stamped for step f is handled *between* steps f-1 and f, so it is
  // applied right after step f-1 — before that frame is compared, because a
  // spider's teleport happens inside the press itself (see `simPress`).
  if (press[1]) simPress(s, world);
  for (let f = 1; f <= lastFrame; f++) {
    simStep(s, world, STEP, !!held[f]);
    if (f < lastFrame && press[f + 1]) simPress(s, world);
    if (WATCH_SHADER && s.triggers) {
      const sh = s.triggers.rt.shader;
      const on = Object.entries(sh).filter(([k, v]) => typeof v === "number" && v !== 0 && !["invR", "invG", "invB", "grayTint", "lensTarget"].includes(k))
        .map(([k]) => k).join(" ");
      const key = on + " z" + s.triggers.rt.shaderZ.join("-") + " zoom" + s.triggers.rt.zoom.toFixed(1) + " ch" + s.triggers.rt.channel;
      const ev = s.events?.[s.events.length - 1];
      if (ev && ev !== compare.lastEv) { compare.lastEv = ev; if (/toggle|spawn/.test(ev.what)) console.log(`f${f} event ${ev.what} at x=${ev.x.toFixed(0)} y=${ev.y.toFixed(0)}`); }
      if (key !== compare.lastShader) { console.log(`f${f} x=${s.player.x.toFixed(0)} ${key}`); compare.lastShader = key; }
    }
    const g = byFrame.get(f);
    if (f === PROBE) {
      const p = s.player, rt = s.triggers?.rt;
      console.log(`probe f${f}: p2=${s.dual ? s.dual.player.x.toFixed(2) + "," + s.dual.player.y.toFixed(2) + (s.dual.player.gravityFlipped ? "F" : "") + " v" + s.dual.player.yVel.toFixed(1) : "-"} p1F=${s.player.gravityFlipped} player (${p.x.toFixed(2)}, ${p.y.toFixed(2)}) ${p.mode} vy=${p.yVel.toFixed(2)} ground=${p.onGround} orb=${s.touchedOrb?.id} queued=${p.queuedHold} dead=${s.dead}:${s.deathCause?.reason}:${s.deathCause?.id} ended=${s.ended} used=${[...s.usedPortals].slice(-4)} sideways=${s.player.sideways} rot=${((s.player.shipRot ?? 0) * 57.3).toFixed(1)} mini=${s.player.mini} slopeT=${s.player.slopeTime?.toFixed?.(3)}`);
      for (const c of world.near({ x: p.x, y: p.y, hw: 60, hh: 60 }, rt)) {
        if (Math.abs(c.y - p.y) > 90) continue;
        console.log(`  ${c.kind} id=${c.id} (${c.x.toFixed(2)}, ${c.y.toFixed(2)}) ${c.hw}x${c.hh}${c.slope ? " slope " + JSON.stringify(c.slope) : ""} groups=${c.groups}`);
      }
    }
    if (s.ended && endFrame === null) {
      endFrame = f;
      if (realLock !== null && realLock !== f) {
        if (!firstDiverge) firstDiverge = { frame: f, x: s.player.x, gx: g?.x ?? 0, y: 0, gy: 0, dx: 0, dy: 0, mode: `end@${realLock}` };
        if (RESYNC) faults.push({ frame: f, x: s.player.x, kind: `END lock f${f}, real f${realLock}`, mode: s.player.mode, dy: 0 });
      }
    }
    if (endFrame !== null) continue;
    const p = s.player;
    if (s.dead) {
      const cause = s.deathCause ? `${s.deathCause.reason} id=${s.deathCause.id ?? "?"}` : "?";
      if (!deadAt) deadAt = { frame: f, x: p.x, gx: g?.x ?? null, cause, mode: p.mode };
      if (!RESYNC) break;
      faults.push({ frame: f, x: g?.x ?? p.x, kind: `DEATH ${cause}`, mode: p.mode, dy: 0 });
      resync(s, byFrame, f, Y_OFFSET);
      if (s.dual) resync(s.dual, byFrame2, f, Y_OFFSET);
      settle = 8;
      continue;
    }
    if (!g) continue;
    const dx = p.x - g.x, dy = (p.y + Y_OFFSET) - g.y;
    if (Math.abs(dx) > maxDx) maxDx = Math.abs(dx);
    if (Math.abs(dy) > maxDy) maxDy = Math.abs(dy);
    // tolerances follow the player's frame: while sideways, x is the gravity
    // axis and gets the tight one (Dash's sideways ball drifted 2.77 in x
    // unseen, f6539-6873)
    const [tx, ty] = p.sideways ? [TOL, TOLX] : [TOLX, TOL];
    const off = Math.abs(dx) > tx || Math.abs(dy) > ty;
    if (!firstDiverge && off) {
      firstDiverge = { frame: f, x: p.x, gx: g.x, y: p.y + Y_OFFSET, gy: g.y, dx, dy, mode: p.mode };
    }
    // the dual partner is compared too: its drift otherwise surfaces much
    // later as a death (Hexagon Force f9573, "P2 hazard")
    const g2 = s.dual && byFrame2.get(f);
    const d2 = g2 ? { dx: s.dual.player.x - g2.x, dy: s.dual.player.y + Y_OFFSET - g2.y } : null;
    if (RESYNC) {
      if (settle > 0) settle--;
      else if (off) {
        faults.push({ frame: f, x: g.x, kind: "drift", mode: p.mode, dy, dx });
        resync(s, byFrame, f, Y_OFFSET);
        if (s.dual) resync(s.dual, byFrame2, f, Y_OFFSET);
        settle = 8;
      } else if (d2 && (Math.abs(d2.dx) > TOLX || Math.abs(d2.dy) > TOL)) {
        faults.push({ frame: f, x: g.x, kind: "P2 drift", mode: s.dual.player.mode, dy: d2.dy, dx: d2.dx });
        resync(s.dual, byFrame2, f, Y_OFFSET);
        settle = 8;
      }
    }
    if (rows) rows.push(`${f},${s.dual ? (s.dual.player.y + Y_OFFSET).toFixed(3) + "|" + (byFrame2.get(f)?.y.toFixed(3) ?? "-") + "|" + s.dual.player.yVel.toFixed(2) : ""},${p.x.toFixed(6)},${(p.y + Y_OFFSET).toFixed(6)},${g.x.toFixed(6)},${g.y.toFixed(6)},${dx.toFixed(6)},${dy.toFixed(6)},${p.mode},${p.yVel.toFixed(4)},${p.onGround ? 1 : 0},${p.cameraYCenter?.toFixed(2)},${p.sideways ? "S" : ""}${p.reversed ? "R" : ""}${p.gravityFlipped ? "F" : ""}`);
  }
  if (rows) writeFileSync(csv, rows.join("\n"));
  return { levelId, lastFrame, firstDiverge, deadAt, maxDx, maxDy, finalX: s.player.x, ended: s.ended, faults };
}

/** put the sim back on the real run's rails, velocity included */
function resync(s, byFrame, f, yOffset) {
  const here = byFrame.get(f), prev = byFrame.get(f - 1), next = byFrame.get(f + 1);
  if (!here) return;
  s.dead = false;
  s.deathCause = undefined;
  s.player.x = here.x;
  s.player.y = here.y - yOffset;
  // The velocity *entering* the next step is the one that produced this frame's
  // position: the game integrates `v += a; y += v * dt`, so `y[f] - y[f-1]` is
  // the post-acceleration velocity of step f, which is exactly what our step
  // f+1 starts from. Seeding from `y[f+1] - y[f]` instead put the player one
  // whole acceleration ahead, which read as a constant dy drift of `a / 240`
  // per frame in every high-acceleration mode.
  //
  // Both are measured on the player's *gravity* axis: world x while a Rotate
  // Gameplay trigger has it sideways (src/game/frame.ts).
  const lat = (q) => toLocal(s.player, q.x, q.y).y;
  if (prev) s.player.yVel = (lat(here) - lat(prev)) * 240;
  // a frame that does not move along gravity is the game resting on a surface
  if (next) s.player.onGround = Math.abs(lat(next) - lat(here)) < 1e-4;
}

const index = macroIndex();
const ids = only ? [parseInt(only, 10)] : [...index.keys()].sort((a, b) => a - b);
const results = [];
for (const id of ids) {
  const entry = index.get(id);
  if (!entry) { console.log(`L${id}: no macro`); continue; }
  const r = await compare(id, entry.macro, { csv: only && csvOut ? csvOut : null });
  results.push({ ...r, name: entry.macro.level.name });
  const d = r.deadAt;
  const fd = r.firstDiverge;
  const first = fd ? `drift f${fd.frame} x=${fd.gx.toFixed(0)} dx=${fd.dx.toFixed(1)} dy=${fd.dy.toFixed(1)} ${fd.mode}` : "frame-exact";
  const status = d ? `DIED f${d.frame} x=${d.x.toFixed(0)} ${d.cause} ${d.mode}` : `ran to f${r.lastFrame}`;
  if (RESYNC) {
    // cluster faults that sit within 200 units of each other: one bug usually
    // trips several frames running even after the settle window
    const clusters = [];
    for (const ft of r.faults) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(ft.x - last.end) < 200 && last.mode === ft.mode) { last.n++; last.end = ft.x; last.endFrame = ft.frame; continue; }
      clusters.push({ ...ft, n: 1, end: ft.x, endFrame: ft.frame });
    }
    console.log(`L${String(id).padStart(2)} ${entry.macro.level.name.padEnd(24)} ${String(clusters.length).padStart(3)} faults`);
    for (const c of clusters) {
      console.log(`      x=${String(Math.round(c.x)).padStart(6)} ${c.mode.padEnd(7)} ${c.kind}${c.kind.endsWith("drift") ? ` dy=${c.dy.toFixed(1)} dx=${c.dx.toFixed(1)}` : ""}${c.n > 1 ? ` (x${c.n}, f${c.frame}-${c.endFrame} to x=${Math.round(c.end)})` : ` f${c.frame}`}`);
    }
  } else {
    console.log(
      `L${String(id).padStart(2)} ${entry.macro.level.name.padEnd(24)} ${first.padEnd(46)} ${status}`);
  }
}
if (!only) {
  const died = results.filter((r) => r.deadAt);
  const clean = results.filter((r) => !r.deadAt && !r.firstDiverge);
  console.log(`\n${clean.length}/${results.length} frame-exact, ${died.length} die on a real run's inputs`);
}
