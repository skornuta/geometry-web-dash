// Does the **real game's own path** fit through the port's level geometry?
//
// `macro-compare.mjs` answers "is our physics right". This answers the other,
// independent question: "is our level data right". It takes the `(x, y)` the
// real game recorded for every frame and tests that box against the port's
// collision world — no port physics involved at all.
//
// A hazard hit here means the port put a spike where the game has none, gave one
// the wrong hitbox, or placed a block at the wrong height. That is a
// level-data/hitbox fault and it shows up at an exact x with an exact object id.
//
// Solids are reported separately and more loosely: the recorded position is the
// player's centre *after* the game resolved its own collision, so resting on a
// floor legitimately overlaps a solid by the clip inset. Only a deep overlap —
// more than the port's own inset allows — is a real fault.
//
//   node scripts/macro-geometry.mjs            # all levels
//   node scripts/macro-geometry.mjs 19         # one level, every hit listed
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadWorld } from "./headless.mjs";
import { hitsHazard, PLAYER_HALF, CLIP_INSET } from "../src/game/collision.ts";
import { OBJECT_DEFS } from "../src/gd/objects.ts";
import { applyPortal } from "../src/gd/interactives.ts";
import {
  buildTriggers, createRuntime, updateTriggers, fireTouchTriggers,
} from "../src/gd/triggers.ts";
import { MINI_SCALE, SPEEDS, hitboxScale } from "../src/gd/physics.ts";

const MACROS = new URL("../../macros-main/", import.meta.url).pathname;
const Y_OFFSET = 90;
const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith("--"));
/** how deep into a solid the recorded centre must sit before it counts */
const SOLID_TOL = parseFloat(
  (args.find((a) => a.startsWith("--solid=")) ?? "--solid=6").slice(8));

const macros = [];
for (const f of readdirSync(MACROS)) {
  if (!f.endsWith(".json")) continue;
  const m = JSON.parse(readFileSync(join(MACROS, f), "utf8"));
  macros.push(m);
}
macros.sort((a, b) => a.level.id - b.level.id);

for (const macro of macros) {
  const id = macro.level.id;
  if (only && id !== parseInt(only, 10)) continue;
  const { level, world } = await loadWorld(id);
  // The level's own triggers, advanced along the recorded path: without them a
  // block the level toggles off still reads as a wall, and a moved block reads
  // at the wrong place.
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  let prevX = 0;
  // Reconstruct the gamemode/size timeline from the portals the *recorded* path
  // actually crossed. Without it every mini and every wave section reads as a
  // pile of false hazard hits, because the box would be the full 30x30.
  const player = { x: 0, y: 0, yVel: 0, mode: "cube", mini: false, gravityFlipped: false, cameraYCenter: null };
  const run = { speed: SPEEDS[1], mirrored: false, coins: 0 };
  const usedPortals = new Set();
  /** hazard hits and deep solid overlaps, keyed by object so a run of frames is one report */
  const hazards = new Map();
  const solids = new Map();
  for (const fx of macro.frameFixes) {
    const x = fx.p1.x, y = fx.p1.y - Y_OFFSET;
    player.x = x; player.y = y;
    updateTriggers(rt, triggers, x, Math.max(0, (x - prevX) / run.speed), y);
    prevX = x;
    // portals first: the box this frame is the one the mode *after* them gives
    const probe = { x, y, hw: PLAYER_HALF, hh: PLAYER_HALF };
    for (const it of world.nearInteractives(probe)) {
      if (it.kind !== "portal" && it.kind !== "speed") continue;
      if (usedPortals.has(it.index)) continue;
      if (Math.abs(it.x - x) > it.hw + probe.hw || Math.abs(it.y - y) > it.hh + probe.hh) continue;
      usedPortals.add(it.index);
      applyPortal(it.id, it.props, player, run);
    }
    const scale = (player.mini ? MINI_SCALE : 1) * hitboxScale(player.mode);
    const half = PLAYER_HALF * scale;
    const box = { x, y, hw: half, hh: half };
    fireTouchTriggers(rt, triggers, { x, y, hw: half, hh: half });
    for (const c of world.near(box, rt)) {
      if (c.kind === "hazard") {
        if (!hitsHazard(box, c)) continue;
        const e = hazards.get(c.index) ?? { id: c.id, x: c.x, y: c.y, n: 0, firstFrame: fx.frame, mode: player.mode, mini: player.mini, obj: c.index, groups: c.groups, px: x, py: y };
        e.n++; hazards.set(c.index, e);
      } else if (c.kind === "solid" && !c.breakable && !c.slope && !c.groups?.length) {
        // slopes are colliders of kind "solid" carrying a triangle: riding one
        // legitimately puts the centre inside its bounding box. Blocks that a
        // group trigger moves are skipped too — this test is static, so a block
        // the level has moved out of the way would read as a wall.
        const solidHalf = PLAYER_HALF * (player.mini ? MINI_SCALE : 1);
        const ox = (c.hw + solidHalf) - Math.abs(c.x - box.x);
        const oy = (c.hh + solidHalf) - Math.abs(c.y - box.y);
        const depth = Math.min(ox, oy);
        if (ox <= 0 || oy <= 0 || depth <= CLIP_INSET + SOLID_TOL) continue;
        const e = solids.get(c.index) ?? { id: c.id, x: c.x, y: c.y, n: 0, depth: 0, firstFrame: fx.frame };
        e.n++; e.depth = Math.max(e.depth, depth); solids.set(c.index, e);
      }
    }
  }
  const hz = [...hazards.values()].sort((a, b) => a.x - b.x);
  const sd = [...solids.values()].sort((a, b) => a.x - b.x);
  console.log(`L${String(id).padStart(2)} ${macro.level.name.padEnd(24)} hazard hits: ${String(hz.length).padStart(3)}   deep solid overlaps: ${String(sd.length).padStart(3)}`);
  if (only) {
    for (const h of hz) {
      console.log(`   HAZARD id=${h.id} (${OBJECT_DEFS.get(h.id)?.frame ?? "?"}) collider(${h.x.toFixed(1)}, ${h.y.toFixed(1)}) player(${h.px.toFixed(0)},${h.py.toFixed(0)}) obj#${h.obj} groups[${h.groups}] ${h.mode}${h.mini ? " mini" : ""} for ${h.n} frames from f${h.firstFrame}`);
    }
    for (const s of sd) {
      console.log(`   SOLID  id=${s.id} (${OBJECT_DEFS.get(s.id)?.frame ?? "?"}) at (${s.x.toFixed(0)}, ${s.y.toFixed(0)}) depth ${s.depth.toFixed(1)} for ${s.n} frames from f${s.firstFrame}`);
    }
  }
}
