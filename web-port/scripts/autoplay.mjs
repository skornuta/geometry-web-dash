// Headless autopilot: searches for an input sequence that plays a level from
// start to finish, using the *real* game rules (src/game/sim.ts) with no
// browser in the loop.
//
//   node scripts/autoplay.mjs [level=1] [--beam=64] [--out=file.json] [--quiet]
//
// Why beam search rather than a reactive bot: x advances at a fixed rate, so
// every candidate is at the same point in the level at the same tick. That
// makes a plain beam over (y, yVel, mode) states both correct and cheap — one
// pass down the level, ~200 physics steps per tick, no backtracking.
//
// This is the M4 acceptance test ("is level 1 completable end to end?") and the
// tool M8 needs to play all 22 levels. When it fails it reports the exact x it
// could not get past, which is the useful part.
import { writeFileSync } from "node:fs";
import { loadWorld } from "./headless.mjs";
import { createSim, cloneSim, simPress, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { levelLength } from "../src/gd/levelEnd.ts";
import { prune } from "./beam.mjs";
import { OBJECT_DEFS } from "../src/gd/objects.ts";


const args = process.argv.slice(2);
const levelNum = parseInt(args.find((a) => !a.startsWith("--")) ?? "1", 10);
const flag = (name, dflt) => {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};

/** physics steps per input tick — 60 Hz decisions over the 240 Hz simulation */
// sim steps per input decision: 4 is 60 Hz; a route that needs a press timed to
// one 240 Hz step (Dash x≈8100, the upright ball under the x=8229 trap toggle)
// can be searched finer with --substeps=2 or 1
const SUBSTEPS = Math.max(1, parseInt(flag("substeps", "4"), 10));
// `--fine=X0-X1`: one sim step per decision inside that x window only — the
// width a whole-level single-step search needs is out of reach, but a press
// timed to one 240 Hz step (Dash x≈8100-8330) only matters locally
const FINE = (flag("fine", "") || "").split("-").map(Number);
const substepsAt = (x) => (FINE.length === 2 && x >= FINE[0] && x <= FINE[1] ? 1 : SUBSTEPS);
// 128, not 64: orbs now require a real tap (no holding through them), so the
// search needs more width to find the tap timings. 64 under-reports orb-heavy
// levels badly — level 19 reads 48% at 64 and 90% at 256.
const BEAM = parseInt(flag("beam", "128"), 10);
const outFile = flag("out", null);
const quiet = args.includes("--quiet");
// --probe-x=19600,20500 reports, at each listed x, how the surviving beam is
// made up: altitude spread, and the count per gamemode. This is what diagnosed
// level 19 — the reported death was a straggler wall thousands of units past
// the point where the real route had already gone extinct, and only the
// per-gamemode census made that visible. Reach for it before believing any
// "killed by" line that names an object no human route would ever touch.
// --trace-above=400 follows the furthest candidate that is still *high*, not the
// furthest one overall. When a section is played on a ceiling or in a corridor,
// the furthest-by-x run is usually a straggler that fell to the floor and jogged
// on, and replaying that tells you nothing. This reports where the real route
// actually went extinct.
const traceAbove = parseFloat(flag("trace-above", "NaN"));
const probeXs = flag("probe-x", "").split(",")
  .map(Number).filter((n) => !Number.isNaN(n) && n > 0);
/** deaths since the last probe checkpoint, tallied by cause so a probe that is
 * never reached cannot accumulate a record per dead candidate for a whole run */
const sinceProbe = new Map();

function reportProbe(nodes) {
  const px = probeXs[0];
  const here = nodes.filter((n) => n.sim.player.x >= px);
  if (!here.length) return;
  probeXs.shift();
  const ys = here.map((n) => n.sim.player.y).sort((a, b) => a - b);
  const q = (f) => Math.round(ys[Math.min(ys.length - 1, Math.floor(f * ys.length))]);
  const modes = new Map();
  for (const n of here) {
    const p = n.sim.player;
    const m = `${p.mode}${p.gravityFlipped ? "-flip" : ""}${p.mini ? "-mini" : ""}`;
    modes.set(m, (modes.get(m) ?? 0) + 1);
  }
  const tally = [...sinceProbe];
  sinceProbe.clear();
  console.log(`probe x=${px}: ${here.length}/${nodes.length} candidates`
    + ` y min=${Math.round(ys[0])} med=${q(0.5)} max=${Math.round(ys[ys.length - 1])}`
    + ` | ${[...modes].map(([m, c]) => `${m}:${c}`).join(" ")}`
    + (tally.length ? ` | died: ${tally.map(([k, c]) => `${k}x${c}`).join(", ")}` : ""));
}

/** advance one input tick; returns false if the attempt died */
function tick(s, world, holding, wasHolding) {
  if (holding && !wasHolding) simPress(s, world);
  const n = substepsAt(s.player.x);
  for (let i = 0; i < n; i++) {
    simStep(s, world, STEP, holding);
    if (s.dead) return false;
  }
  return true;
}

const { level, world, maxX } = await loadWorld(levelNum);
// `m_levelLength`, the game's own percentage denominator — the level ends 340
// past its last object, and the search is done when the sim says the ending
// has triggered (src/gd/levelEnd.ts)
const length = levelLength(maxX);

// --- keep the search honest ------------------------------------------------
// The free-fly band (src/gd/camera.ts) is now in the engine and IS the game's
// real roof, so a ship can no longer climb to y=10000. But the band is ~270
// units tall and a level's obstacles rarely fill it, so the search still finds
// unobstructed air near the band ceiling and coasts over sections a human would
// play — on level 1 it skips the whole second cube section. That is the search
// being inhuman, not the physics being wrong, so it stays pruned here.
const CEIL_COL = 120;
const CEIL_MARGIN = 150;
const CEIL_FLOOR = 250;
const ceilProfile = new Map();
const noteCeil = (x, top) => {
  const c = Math.floor(x / CEIL_COL);
  if (!(ceilProfile.get(c) >= top)) ceilProfile.set(c, top);
};
for (const c of world.colliders) noteCeil(c.x, c.y + c.hh);
for (const it of world.interactives) noteCeil(it.x, it.y + it.hh);

// ...but the profile is column-local, and that hid a real route. Level 12 sends
// a **flipped cube up through empty air** to a gravity portal at (16559, 1109)
// with a UFO portal beyond it. There is no geometry at all between y=400 and
// that portal, so the columns on the way up carry the CEIL_FLOOR of 250, the
// climbing player was pruned the instant they passed it, and the sweep reported
// 63.4% with **no death cause at all** — the signature of a route the tool
// forbids rather than one the physics fails.
//
// A portal is not "open air a human would not use": it is a thing the route
// *must* pass through. So open a funnel back from every portal, letting the
// search climb toward it. Plain empty air, with no portal to justify it, stays
// pruned exactly as before — which is what keeps fly-overs out.
const PORTAL_REACH = 900;
for (const it of world.interactives) {
  if (it.kind !== "portal") continue;
  const top = it.y + it.hh;
  for (let x = it.x - PORTAL_REACH; x <= it.x + CEIL_COL; x += CEIL_COL) noteCeil(x, top);
}
function ceilingAt(x) {
  const c = Math.floor(x / CEIL_COL);
  let top = 0;
  for (let i = c - 1; i <= c + 1; i++) top = Math.max(top, ceilProfile.get(i) ?? 0);
  return Math.max(top + CEIL_MARGIN, CEIL_FLOOR);
}

/** every object within a screen's width of `x`, grouped, for the failure report */
function nearbyReport(x) {
  const rows = [];
  for (const o of level.objects) {
    if (o.x < x - 60 || o.x > x + 260) continue;
    const def = OBJECT_DEFS.get(o.id);
    rows.push({ id: o.id, kind: def?.kind ?? "UNKNOWN", type: def?.type ?? -1,
      x: Math.round(o.x), y: Math.round(o.y) });
  }
  rows.sort((a, b) => a.x - b.x || a.y - b.y);
  // collapse runs of identical id at the same x span into one line
  return rows.slice(0, 40).map((r) =>
    `id ${String(r.id).padEnd(5)} ${r.kind.padEnd(9)} type ${String(r.type).padEnd(3)}`
    + ` @ ${r.x},${r.y}`);
}

// nodes form a tree via `parent`, so the winning input sequence is recovered by
// walking back up rather than copying an array per candidate per tick
let beam = [{ sim: createSim(0, SPEEDS[1], level), holding: false, parent: null }];
let best = { x: 0, tick: 0 };
/** furthest candidate that was still above `--trace-above` when it got there */
let bestHigh = { x: -1, tick: 0, node: null };
/** how every candidate died at the furthest point reached, for diagnosis */
let deaths = [];
let win = null;
const t0 = Date.now();

const MAX_TICKS = 60 * 60 * 12; // 12 minutes of level time is far beyond any level
let t = 0;
for (; t < MAX_TICKS && beam.length; t++) {
  const next = [];
  const died = [];
  for (const node of beam) {
    for (const holding of [false, true]) {
      const s = cloneSim(node.sim);
      if (!tick(s, world, holding, node.holding)) {
        died.push(s.deathCause);
        if (probeXs.length) {
          const k = `${s.deathCause?.reason} id=${s.deathCause?.id}`;
          sinceProbe.set(k, (sinceProbe.get(k) ?? 0) + 1);
        }
        continue;
      }
      // inhuman fly-over — a world-y test, so not while gameplay runs vertically
      if (!s.player.sideways && s.player.y > ceilingAt(s.player.x)) continue;
      next.push({ sim: s, holding, parent: node });
    }
  }
  if (!next.length) { deaths = died; break; }
  for (const n of next) {
    // keep the node, not just the number: a failed run is exactly the one worth
    // replaying into the browser, and that needs its inputs
    if (n.sim.player.x > best.x) best = { x: n.sim.player.x, tick: t, node: n };
    if (n.sim.player.y >= traceAbove && n.sim.player.x > bestHigh.x) {
      bestHigh = { x: n.sim.player.x, tick: t, node: n };
    }
  }
  if (probeXs.length && next.some((n) => n.sim.player.x >= probeXs[0])) reportProbe(next);
  const done = next.find((n) => n.sim.ended);
  if (done) { win = done; break; }
  // parents only need their input and a player summary from here on; keeping
  // every ancestor's whole sim alive ran a long search out of memory
  for (const n of beam) if (n.sim) {
    const p = n.sim.player;
    n.sim = { player: { x: p.x, y: p.y, yVel: p.yVel, mode: p.mode, mini: p.mini,
      gravityFlipped: p.gravityFlipped, onGround: p.onGround }, run: { speed: n.sim.run.speed } };
  }
  beam = prune(next, BEAM);
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);

/** press/release edges along the path that reaches `node` */
function edgesTo(node) {
  const inputs = [];
  for (let n = node; n && n.parent; n = n.parent) inputs.push(n.holding);
  inputs.reverse();
  const out = [];
  let prev = false;
  inputs.forEach((h, i) => {
    if (h !== prev) { out.push({ tick: i, holding: h }); prev = h; }
  });
  return { inputs, edges: out };
}

function writeRun(node, note) {
  if (!outFile || !node) return;
  const { inputs, edges } = edgesTo(node);
  writeFileSync(outFile, JSON.stringify({
    level: levelNum, substeps: SUBSTEPS, ticks: inputs.length, edges,
  }));
  console.log(`  wrote ${outFile}${note}`);
}

if (win) {
  // walk the tree back to the root to recover the inputs
  const inputs = [];
  /** (mode, mini, gravity, speed) along the winning path, to prove what it used */
  const path = [];
  for (let n = win; n.parent; n = n.parent) {
    inputs.push(n.holding);
    const p = n.sim.player;
    path.push(`${p.mode}${p.mini ? "-mini" : ""}${p.gravityFlipped ? "-flip" : ""}`
      + `@${SPEEDS.indexOf(n.sim.run.speed) >= 0 ? SPEEDS.indexOf(n.sim.run.speed) : "?"}`);
  }
  inputs.reverse();
  path.reverse();
  const timeline = [];
  path.forEach((m, i) => {
    if (!timeline.length || timeline[timeline.length - 1].m !== m) timeline.push({ m, i });
  });
  // compress to press/release edges, which is what a replay actually needs
  const edges = [];
  let prev = false;
  inputs.forEach((h, i) => {
    if (h !== prev) { edges.push({ tick: i, holding: h }); prev = h; }
  });
  console.log(`level ${levelNum}: COMPLETED`);
  // the ending triggered, so the game banks 100 however far short of the
  // portal the player was locked
  console.log(`  x ${Math.round(win.sim.player.x)} / ${Math.round(length)}  (100.0%)`);
  console.log(`  ${inputs.length} ticks (${(inputs.length / 60).toFixed(1)}s of play),`
    + ` ${edges.length} input edges, coins ${win.sim.run.coins}`);
  console.log(`  modes: ${timeline.map((e) => `${e.m}@${Math.round(e.i / 60)}s`).join(" -> ")}`);
  if (args.includes("--trace")) {
    const nodes = [];
    for (let n = win; n.parent; n = n.parent) nodes.push(n);
    nodes.reverse();
    for (let i = 0; i < nodes.length; i += 15) {
      const p = nodes[i].sim.player;
      console.log(`    t=${(i / 60).toFixed(2)} x=${Math.round(p.x)} y=${Math.round(p.y)}`
        + ` yVel=${Math.round(p.yVel)} ${p.mode}${p.gravityFlipped ? " FLIP" : ""}`);
    }
  }
  console.log(`  search: ${secs}s, beam ${BEAM}`);
  writeRun(win, "");
} else {
  console.log(`level ${levelNum}: FAILED`);
  console.log(`  furthest x ${Math.round(best.x)} / ${Math.round(length)}`
    + `  (${((best.x / length) * 100).toFixed(1)}%) at tick ${best.tick}`);
  // the same reason repeated across the whole beam means one obstacle is
  // unpassable, not that the search was too narrow
  const tally = new Map();
  for (const d of deaths) {
    if (!d) continue;
    const k = `${d.reason} id=${d.id}`;
    const e = tally.get(k) ?? { n: 0, y: [] };
    e.n++;
    e.y.push(Math.round(d.y));
    tally.set(k, e);
  }
  console.log(`  killed by: ${[...tally].map(([k, e]) =>
    `${k} x${e.n} (y ${Math.min(...e.y)}..${Math.max(...e.y)})`).join(", ") || "?"}`);
  console.log(`  nearby objects:`);
  for (const o of nearbyReport(best.x)) console.log(`    ${o}`);
  console.log(`  search: ${secs}s, beam ${BEAM}`);
  if (bestHigh.node) {
    console.log(`  furthest above y=${traceAbove}: x ${Math.round(bestHigh.x)}`
      + ` (${((bestHigh.x / length) * 100).toFixed(1)}%) — this is where the high route ended`);
    const path = [];
    for (let n = bestHigh.node; n && n.parent; n = n.parent) path.push(n);
    path.reverse();
    const from = Math.max(0, path.length - 90);
    for (let i = from; i < path.length; i += 3) {
      const p = path[i].sim.player;
      console.log(`    x=${Math.round(p.x)} y=${Math.round(p.y)} yVel=${Math.round(p.yVel)}`
        + ` ${p.mode}${p.gravityFlipped ? " FLIP" : ""}${p.onGround ? " ground" : ""}`
        + ` held=${path[i].holding ? 1 : 0}`);
    }
  }
  writeRun(Number.isNaN(traceAbove) ? best.node : (bestHigh.node ?? best.node),
    Number.isNaN(traceAbove) ? " (the furthest run — replay it to see what went wrong)"
      : " (the furthest HIGH run)");
  process.exitCode = 1;
}
if (!quiet && !win) {
  console.log(`  hint: re-run with --beam=${BEAM * 4} before assuming it is a physics bug`);
}
