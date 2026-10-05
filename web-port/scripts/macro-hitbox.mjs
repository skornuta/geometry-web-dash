// How big can the player's hazard hitbox be, per gamemode, and still let every
// real run through?
//
// For every frame of every macro, this asks each nearby hazard: what is the
// largest player half-size that still clears it? The smallest answer across a
// whole gamemode is an upper bound on that mode's true hitbox — measured from 21
// real completions rather than guessed.
//
// It is an upper bound only: a successful run never proves a hitbox is not too
// *small*. But the port is currently too big in exactly these modes, so the
// bound is what is needed.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadWorld } from "./headless.mjs";
import { PLAYER_HALF } from "../src/game/collision.ts";
import { applyPortal } from "../src/gd/interactives.ts";
import { MINI_SCALE, SPEEDS } from "../src/gd/physics.ts";

const MACROS = new URL("../../macros-main/", import.meta.url).pathname;
// Dash is recorded in a frame our world cannot read: its Rotate Gameplay
// trigger (2900) turns the play axis 90 degrees and we do not model it, so its
// positions land inside hazards that the real run never touched. `--skip=22`.
const SKIP = new Set((process.argv.find((a) => a.startsWith("--skip=")) ?? "")
  .slice(7).split(",").filter(Boolean).map(Number));
const Y_OFFSET = 90;

/** the biggest half-size that clears this hazard, or Infinity if it never can */
function clearance(px, py, c) {
  if (c.radius !== undefined) {
    // circle: the box clears while its nearest corner stays outside the radius.
    // Solving for a square half-size h is a quadratic; bisect instead, it is
    // exact enough at 1e-4 and this runs a few hundred thousand times.
    let lo = 0, hi = 60;
    const hits = (h) => {
      const dx = Math.max(0, Math.abs(c.x - px) - h);
      const dy = Math.max(0, Math.abs(c.y - py) - h);
      return dx * dx + dy * dy < c.radius * c.radius;
    };
    if (!hits(hi)) return Infinity;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (hits(mid)) hi = mid; else lo = mid;
    }
    return lo;
  }
  // axis-aligned box: clears while |dx| >= c.hw + h or |dy| >= c.hh + h
  const hx = Math.abs(c.x - px) - c.hw;
  const hy = Math.abs(c.y - py) - c.hh;
  const h = Math.max(hx, hy);
  return h < 0 ? -Infinity : h;
}

const macros = [];
for (const f of readdirSync(MACROS)) {
  if (SKIP.has(JSON.parse(readFileSync(join(MACROS, f), "utf8")).level?.id)) continue;
  if (!f.endsWith(".json")) continue;
  macros.push(JSON.parse(readFileSync(join(MACROS, f), "utf8")));
}
macros.sort((a, b) => a.level.id - b.level.id);

/** mode -> tightest clearance seen, with where */
const tight = new Map();
for (const macro of macros) {
  const { world } = await loadWorld(macro.level.id);
  const player = { x: 0, y: 0, yVel: 0, mode: "cube", mini: false, gravityFlipped: false, cameraYCenter: null };
  const run = { speed: SPEEDS[1], mirrored: false, coins: 0 };
  const used = new Set();
  for (const fx of macro.frameFixes) {
    const x = fx.p1.x, y = fx.p1.y - Y_OFFSET;
    player.x = x; player.y = y;
    const probe = { x, y, hw: PLAYER_HALF, hh: PLAYER_HALF };
    for (const it of world.nearInteractives(probe)) {
      if (it.kind !== "portal" && it.kind !== "speed") continue;
      if (used.has(it.index)) continue;
      if (Math.abs(it.x - x) > it.hw + probe.hw || Math.abs(it.y - y) > it.hh + probe.hh) continue;
      used.add(it.index);
      applyPortal(it.id, it.props, player, run);
    }
    const sizeScale = player.mini ? MINI_SCALE : 1;
    for (const c of world.near(probe)) {
      if (c.kind !== "hazard") continue;
      const h = clearance(x, y, c);
      if (!Number.isFinite(h)) continue;
      // report as the scale relative to a full-size 15-unit half, so mini and
      // full-size sections are directly comparable
      const scale = h / (PLAYER_HALF * sizeScale);
      const key = player.mode;
      const cur = tight.get(key);
      if (!cur || scale < cur.scale) {
        tight.set(key, { scale, h, id: c.id, x: c.x, y: c.y, px: x, py: y, level: macro.level.id, frame: fx.frame, mini: player.mini });
      }
    }
  }
}
console.log("tightest clearance per gamemode, over all 21 real runs:\n");
for (const [mode, t] of [...tight].sort((a, b) => a[1].scale - b[1].scale)) {
  console.log(`  ${mode.padEnd(7)} scale <= ${t.scale.toFixed(3)}  (half <= ${t.h.toFixed(2)} u)  `
    + `L${t.level} f${t.frame} id=${t.id}${t.mini ? " mini" : ""} hazard(${t.x.toFixed(0)},${t.y.toFixed(0)}) player(${t.px.toFixed(0)},${t.py.toFixed(0)})`);
}
