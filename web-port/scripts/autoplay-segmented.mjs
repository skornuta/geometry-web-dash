// ---------------------------------------------------------------------------
// EXPERIMENT, NOT THE DEFAULT — kept only so its idea is not lost.
//
// This is the segmented-search autopilot found uncommitted in the working tree
// at the start of session 11. Measured against the same physics at beam 256:
//
//     single-pass search (scripts/autoplay.mjs)  19 / 22 complete
//     this segmented search                      17 / 22 complete
//
// It costs L16 and L20 outright (both COMPLETE -> 48.3% / 38.8%). Its one win
// is level 19, which reaches 89.9% here and 69.0% under the single-pass search,
// because re-seeding a diverse frontier at every segment boundary re-creates
// the UFO class that L19's route needs and the single-pass beam never forms.
// That re-seeding idea is worth rebuilding; this whole-level segmentation is
// not. See "L19: diagnosed" in PORT-PROGRESS.md.
// ---------------------------------------------------------------------------
// Headless autopilot: searches for an input sequence that plays a level from
// start to finish, using the *real* game rules (src/game/sim.ts) with no
// browser in the loop.
//
//   node scripts/autoplay.mjs [level=1] [--beam=64] [--out=file.json] [--quiet]
//                              [--probe-x=1000,2000] [--trace]
//
// Why beam search rather than a reactive bot: x advances at a fixed rate, so
// every candidate is at the same point in the level at the same tick. That
// makes a plain beam over (y, yVel, mode) states both correct and cheap — one
// pass down the level, ~200 physics steps per tick, no backtracking.
//
// This is the M4 acceptance test ("is level 1 completable end to end?") and the
// tool M8 needs to play all 22 levels. When it fails it reports the exact x it
// could not get past, which is the useful part.
//
// The search is SEGMENTED: see "Segmented search" below for why a single pass
// down the harder levels starves its own route.
import { writeFileSync, readFileSync } from "node:fs";
import { loadWorld } from "./headless.mjs";
import { createSim, cloneSim, simPress, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { key, prune, modeClass } from "./beam.mjs";
import { OBJECT_DEFS } from "../src/gd/objects.ts";

/** physics steps per input tick — 60 Hz decisions over the 240 Hz simulation */
const SUBSTEPS = 4;

const args = process.argv.slice(2);
const levelNum = parseInt(args.find((a) => !a.startsWith("--")) ?? "1", 10);
const flag = (name, dflt) => {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
// 128, not 64: orbs now require a real tap (no holding through them), so the
// search needs more width to find the tap timings. 64 under-reports orb-heavy
// levels badly — level 19 reads 48% at 64 and 90% at 256.
const BEAM = parseInt(flag("beam", "128"), 10);
const outFile = flag("out", null);
const quiet = args.includes("--quiet");
// --probe-x=1000,2000 prints the surviving candidates' altitude spread at each
// listed x instead of guessing where a beam funnelled itself into a dead end.
const probeXs = (flag("probe-x", "") ?? "")
  .split(",").map(Number).filter((n) => !Number.isNaN(n) && n > 0);
// --dump-frontier=file.json records every segment boundary's seed set (as
// input histories), and --from-frontier=file.json[:N] restarts the search from
// boundary N's seeds — so a failing segment can be debugged in isolation
// without re-searching everything before it.
const frontierFile = flag("dump-frontier", null);
const fromFile = flag("from-frontier", null);

const { level, world, maxX } = await loadWorld(levelNum);

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

/** advance one input tick; returns false if the attempt died */
function tick(s, world, holding, wasHolding) {
  if (holding && !wasHolding) simPress(s, world);
  for (let i = 0; i < SUBSTEPS; i++) {
    simStep(s, world, STEP, holding);
    if (s.dead) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Segmented search
//
// A single pass down a whole level asks one beam to keep EVERY earlier
// section's diversity alive for ten thousand ticks, and the levels that would
// not complete all failed the same way (diagnosed sessions 10-11 on L14/L19):
// a precision gauntlet early — orb chains, pad ladders, portal stacks —
// squeezes the beam down to a handful of survivors; those few then face the
// next gauntlet with no slack; and the beam degenerates into whatever survives
// passively (ground stragglers that missed a speed portal and can coast for
// thousands of units), reporting a far-later death x that hides where the real
// route was lost. On L19 the honest route was PROVEN passable piecewise by
// local beams while the single-pass beam failed identically at width 1024 —
// the shape of the search was the problem, not its width.
//
// So the level is searched segment by segment (~SEG_LEN units each): when any
// candidate crosses the boundary the segment ends, and EVERY crossing state —
// including ones the running prune had already thrown away — is deduplicated
// and distilled back up to FRONTIER diverse seeds. Each segment starts from
// maximal known diversity instead of inheriting an exhausted beam. A segment
// whose route dies entirely is retried at 4x then 16x width before the level
// is declared failed.
//
// Input histories survive boundaries through a light linked `chain`
// ({ h, next }) per candidate, walked backwards at the end, so --trace and
// replay edges still span the whole run without storing a sim per ancestor.
// ---------------------------------------------------------------------------
const SEG_LEN = 1100;
const FRONTIER = 64;
const MAX_SEGMENT_ATTEMPTS = 3;

const segBounds = [];
for (let x = SEG_LEN; x < maxX - 400; x += SEG_LEN) segBounds.push(x);
segBounds.push(maxX + 60);

/** deaths since the last --probe-x checkpoint (diagnostic only) */
const intervalDeaths = [];

/**
 * Search from `frontier` until some candidate crosses `endX`.
 * Crossing states are frozen AT the boundary (removed from play) so the next
 * segment starts from them fresh rather than from a pruned remnant.
 */
function searchSegment(frontier, endX, width, stats) {
  let beam = frontier.map((f) => ({ sim: f.sim, holding: f.holding, chain: f.chain }));
  const crossed = [];
  const deaths = [];
  const maxTicks = 60 * 120; // two minutes of level time per segment is plenty
  for (let t = 0; t < maxTicks && beam.length; t++) {
    stats.tick++;
    const next = [];
    for (const node of beam) {
      for (const holding of [false, true]) {
        const s = cloneSim(node.sim);
        if (!tick(s, world, holding, node.holding)) {
          deaths.push(s.deathCause);
          intervalDeaths.push(s.deathCause);
          continue;
        }
        if (s.player.y > ceilingAt(s.player.x)) continue; // inhuman fly-over
        if (s.player.x > stats.bestX) stats.bestX = s.player.x;
        const chain = { h: holding, next: node.chain };
        if (s.player.x >= endX) crossed.push({ sim: s, holding, chain });
        else next.push({ sim: s, holding, chain });
      }
    }
    if (crossed.length) return { ok: true, crossed };
    if (!next.length) return { ok: false, deaths };
    if (probeXs.length && next.some((n) => n.sim.player.x >= probeXs[0])) {
      reportProbe(next);
    }
    beam = prune(next, width);
  }
  return { ok: false, deaths };
}

function reportProbe(next) {
  const px = probeXs[0];
  const here = next.filter((n) => n.sim.player.x >= px);
  if (!here.length) return;
  probeXs.shift();
  const ys = here.map((n) => n.sim.player.y).sort((a, b) => a - b);
  const q = (f) => Math.round(ys[Math.min(ys.length - 1, Math.floor(f * ys.length))]);
  const modes = new Map();
  for (const n of here) {
    const m = `${n.sim.player.mode}${n.sim.player.gravityFlipped ? "-flip" : ""}`;
    modes.set(m, (modes.get(m) ?? 0) + 1);
  }
  const dtally = new Map();
  for (const d of intervalDeaths) {
    const k = `${d.reason} id=${d.id}`;
    dtally.set(k, (dtally.get(k) ?? 0) + 1);
  }
  intervalDeaths.length = 0;
  console.log(`probe x=${px}: ${here.length}/${next.length} candidates`
    + ` y min=${ys[0]} p25=${q(0.25)} med=${q(0.5)} p75=${q(0.75)} max=${ys[ys.length - 1]}`
    + ` | ${[...modes].map(([m, c]) => `${m}:${c}`).join(" ")}`
    + (dtally.size ? ` | died: ${[...dtally].map(([k, c]) => `${k}x${c}`).join(", ")}` : ""));
}


// --- boundary seeding, used only by this experiment -------------------------
// NOTE: a session-11 review found this `promote` can UNDER-FILL the frontier
// (85 candidates in 3 classes returned 49 of a requested 64), and that the
// `--from-frontier` resume path below is unsound (it replays against a global
// tick count inflated by failed retries, and drops the pre-resume input chain).
// Both are left as measured — the numbers in the header were taken with this
// exact code. Fix them before trusting a resumed run.
/** mode class plus how the candidate is *moving* — the finer boundary spread */
function velocityClass(n) {
  const p = n.sim.player;
  const d = n.sim.dual?.player;
  const v = Math.abs(p.yVel);
  return `${modeClass(n)}`
    + `|${p.yVel >= 0 ? "+" : "-"}${v < 60 ? 0 : v < 150 ? 1 : v < 350 ? 2 : 3}`
    + `|${Math.round(p.y / 120)}`
    + (d ? `|D${d.yVel >= 0 ? "+" : "-"}${Math.round(d.y / 120)}` : "");
}

/**
 * Distil boundary-crossers into the next segment's seed set.
 *
 * Dedup first, then spread — but the spread must cover VELOCITY, not just
 * altitude. What survives the next segment is decided mostly by how the
 * candidate is MOVING at the boundary: on L19 the whole UFO section hinges on
 * entering it level rather than diving, and a y-spread alone will happily fill
 * every slot with doomed divers that happen to sit at nicely varied heights.
 */
function promote(crossed, width) {
  const uniq = [];
  const seen = new Set();
  for (const n of crossed) {
    const k = key(n.sim);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(n);
  }
  if (uniq.length <= width) return uniq;
  const groups = new Map();
  for (const n of uniq) {
    const c = velocityClass(n);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(n);
  }
  for (const g of groups.values()) g.sort((a, b) => a.sim.player.y - b.sim.player.y);
  // round-robin across groups, y-spread within each, until `width` is filled
  const out = [];
  let progress = true;
  for (let round = 0; out.length < width && progress; round++) {
    progress = false;
    for (const g of groups.values()) {
      if (out.length >= width) break;
      const idx = Math.round((round * (g.length - 1)) / Math.max(1, Math.ceil(width / groups.size) - 1));
      const n = g[Math.min(g.length - 1, idx)];
      if (n && !out.includes(n)) { out.push(n); progress = true; }
    }
  }
  return out;
}

let frontier = [{ sim: createSim(0, SPEEDS[1], level), holding: false, chain: null }];
const stats = { bestX: 0, tick: 0 };
let winNode = null;
/** how the deepest attempt died, for the failure report */
let deaths = [];
const t0 = Date.now();

// resume from a dumped frontier: re-roll each seed's input history forward.
// Dumped edges are relative to their segment's start tick, so a segment can be
// replayed (and edited) in isolation.
let startSeg = 0;
if (fromFile) {
  const [path, segStr] = fromFile.split(":");
  const dump = JSON.parse(readFileSync(path, "utf8"));
  startSeg = segStr !== undefined ? parseInt(segStr, 10) : dump.segs.length - 1;
  const target = dump.segs[startSeg - 1]; // seeds that produced segment startSeg
  if (!target) throw new Error(`frontier dump has no segment ${startSeg}`);
  frontier = target.seeds.map((seed) => {
    const s = createSim(0, SPEEDS[1], level);
    // the seed's holding state carries INTO the segment: the first edge's
    // press depends on it, and replaying with holding=false would fire an
    // extra simPress the original never did — the replay then diverges
    let holding = !!seed.holding;
    let t = 0;
    const applyTo = (end) => {
      while (t < end) {
        for (let k = 0; k < SUBSTEPS; k++) simStep(s, world, STEP, holding);
        t++;
      }
    };
    // edges are absolute tick indices covering the seed's whole history
    for (const e of seed.edges) {
      applyTo(e.tick);
      if (e.holding && !holding) simPress(s);
      holding = e.holding;
    }
    applyTo(target.endTick);
    return { sim: s, holding, chain: null };
  });
  console.log(`resumed frontier of ${frontier.length} seeds at segment ${startSeg}`
    + ` (x=${Math.round(frontier[0].sim.player.x)})`);
}
const dumpedSegs = [];

function chainBits(chain) {
  const bits = [];
  for (let c = chain; c; c = c.next) bits.push(c.h);
  return bits.reverse();
}

/** press/release edges covering a chain's FULL history (the loader re-rolls
 * from tick 0, so every earlier segment's inputs are needed to reproduce the
 * state — stripping them would replay a different trajectory) */
function chainEdges(chain) {
  const edges = [];
  let prev = false;
  chainBits(chain).forEach((h, i) => {
    if (h !== prev) { edges.push({ tick: i, holding: h }); prev = h; }
  });
  return edges;
}

for (let si = startSeg; si < segBounds.length && !winNode; si++) {
  const endX = segBounds[si];
  const isLast = si === segBounds.length - 1;
  const segStartTick = stats.tick;
  let result = null;
  for (let attempt = 0, width = BEAM; attempt < MAX_SEGMENT_ATTEMPTS; attempt++, width *= 4) {
    result = searchSegment(frontier, endX, width, stats);
    if (result.ok) break;
    deaths = result.deaths;
    if (!quiet) {
      console.log(`  seg ${si + 1}/${segBounds.length} (to x=${Math.round(endX)}) died`
        + ` at beam ${width}${attempt < MAX_SEGMENT_ATTEMPTS - 1 ? " — retrying wider" : ""}`);
    }
  }
  if (!result.ok) break;
  if (isLast) {
    winNode = result.crossed.reduce((a, b) => (b.sim.player.x > a.sim.player.x ? b : a));
  } else {
    frontier = promote(result.crossed, FRONTIER);
    if (frontierFile) {
      dumpedSegs.push({
        index: si + 1,
        endX: Math.round(endX),
        startTick: segStartTick,
        endTick: stats.tick,
        seeds: frontier.map((f) => ({
          holding: f.holding,
          edges: chainEdges(f.chain),
          y: Math.round(f.sim.player.y),
          mode: f.sim.player.mode,
        })),
      });
      writeFileSync(frontierFile, JSON.stringify({ level: levelNum, segs: dumpedSegs }, null, 1));
    }
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);

if (winNode) {
  // walk the chain back to recover the full input sequence
  const inputs = [];
  for (let c = winNode.chain; c; c = c.next) inputs.push(c.h);
  inputs.reverse();
  /** (mode, mini, gravity, speed) along the winning path, to prove what it used */
  const path = [];
  {
    const replay = createSim(0, SPEEDS[1], level);
    for (let i = 0; i < inputs.length; i++) {
      const h = inputs[i];
      if (h && !(i > 0 && inputs[i - 1])) simPress(replay);
      for (let k = 0; k < SUBSTEPS; k++) simStep(replay, world, STEP, h);
      if (args.includes("--trace") && i % 15 === 0) {
        const p = replay.player;
        console.log(`    t=${(i / 60).toFixed(2)} x=${Math.round(p.x)} y=${Math.round(p.y)}`
          + ` yVel=${Math.round(p.yVel)} ${p.mode}${p.gravityFlipped ? " FLIP" : ""}`);
      }
      if (i % 30 === 0 || i === inputs.length - 1) {
        const p = replay.player;
        path.push(`${p.mode}${p.mini ? "-mini" : ""}${p.gravityFlipped ? "-flip" : ""}`
          + `@${SPEEDS.indexOf(replay.run.speed)}@${Math.round(i / 60)}s`);
      }
    }
  }
  const timeline = [];
  for (const m of path) {
    const mode = m.slice(0, m.lastIndexOf("@"));
    const at = m.slice(m.lastIndexOf("@") + 1);
    if (!timeline.length || timeline[timeline.length - 1].mode !== mode) {
      timeline.push({ mode, at });
    }
  }
  // compress to press/release edges, which is what a replay actually needs
  const edges = [];
  let prev = false;
  inputs.forEach((h, i) => {
    if (h !== prev) { edges.push({ tick: i, holding: h }); prev = h; }
  });
  console.log(`level ${levelNum}: COMPLETED`);
  console.log(`  x ${Math.round(winNode.sim.player.x)} / ${Math.round(maxX)}`
    + `  (${((winNode.sim.player.x / maxX) * 100).toFixed(1)}%)`);
  console.log(`  ${inputs.length} ticks (${(inputs.length / 60).toFixed(1)}s of play),`
    + ` ${edges.length} input edges, coins ${winNode.sim.run.coins}`);
  console.log(`  modes: ${timeline.map((e) => `${e.mode}@${e.at}`).join(" -> ")}`);
  console.log(`  search: ${secs}s, beam ${BEAM}, segmented (SEG_LEN=${SEG_LEN}, frontier ${FRONTIER})`);
  if (outFile) {
    writeFileSync(outFile, JSON.stringify({
      level: levelNum, substeps: SUBSTEPS, ticks: inputs.length, edges,
    }));
    console.log(`  wrote ${outFile}`);
  }
} else {
  console.log(`level ${levelNum}: FAILED`);
  console.log(`  furthest x ${Math.round(stats.bestX)} / ${Math.round(maxX)}`
    + `  (${((stats.bestX / maxX) * 100).toFixed(1)}%) at tick ${stats.tick}`);
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
  for (const o of nearbyReport(stats.bestX)) console.log(`    ${o}`);
  console.log(`  search: ${secs}s, beam ${BEAM}, segmented (SEG_LEN=${SEG_LEN}, frontier ${FRONTIER})`);
  process.exitCode = 1;
}
if (!quiet && !winNode) {
  console.log(`  hint: failed segments retry at up to beam ${BEAM * 16};`
    + ` try --beam=512 before assuming it is a physics bug`);
}
