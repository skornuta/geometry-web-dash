import { test } from "node:test";
import assert from "node:assert/strict";
import { CollisionWorld } from "../src/game/collision.ts";
import { createSim, simStep, cloneSim } from "../src/game/sim.ts";
import { P } from "../src/gd/props.ts";
import type { Level } from "../src/gd/level.ts";

function worldAt(rotation: number, x = 100, id = 8, scale = 1) {
  const level = { objects: [{ id, x, y: 200,
    props: new Map([[P.ROTATION, String(rotation)], [P.SCALE, String(scale)]]) }],
    colors: new Map(), rawHeader: "" } as Level;
  return new CollisionWorld(level, () => ({ w: 30, h: 30 }));
}

function at(x: number, y: number) {
  const s = createSim(x, 311.58);
  s.player.y = y;
  s.player.onGround = false;
  return s;
}

test("a rotated spike kills at its sideways tip using the player's outer box", () => {
  // Id 8 is 6x12, so at 45 degrees its tip extends 6.364 units sideways.
  // The player's left edge is 5 units away, but its inner box is far clear.
  const s = at(120, 200);
  simStep(s, worldAt(45), 0, false);
  assert.equal(s.dead, true);
  assert.equal(s.deathCause?.reason, "hazard");
});

test("empty space beyond a rotated spike corner is safe", () => {
  // The player's closest corner is (2.9, 5.9) relative to the spike.
  // Its projection on the rotated long axis is 6.222 > the half-height 6.
  // The former unrotated 6x12 box wrongly killed here.
  const s = at(117.9, 220.9);
  simStep(s, worldAt(45), 0, false);
  assert.equal(s.dead, false);
});

test("rotated tips are indexed across spatial column boundaries", () => {
  // A 2x spike centred at 49 reaches past x60 after rotation (to 61.728).
  // The unrotated box ended at x55 and omitted the player's column entirely.
  const world = worldAt(45, 49, 8, 2);
  const s = at(76, 200);
  simStep(s, world, 0, false);
  assert.equal(s.dead, true);
});

test("opposite rotations produce opposite safe corners", () => {
  const safe = at(117.9, 220.9), hit = cloneSim(safe);
  simStep(safe, worldAt(45), 0, false);
  simStep(hit, worldAt(-45), 0, false);
  assert.equal(safe.dead, false);
  assert.equal(hit.dead, false); // both outside the long-axis corner
  const side = at(120, 218), opposite = cloneSim(side);
  simStep(side, worldAt(45), 0, false);
  simStep(opposite, worldAt(-45), 0, false);
  assert.equal(side.dead, true);
  assert.equal(opposite.dead, false);
});

test("rotating a round saw preserves its circular collision", () => {
  for (const angle of [0, 26.5, 45, 90, -135]) {
    const hit = at(146, 200), clear = at(148, 200);
    simStep(hit, worldAt(angle, 100, 88), 0, false);
    simStep(clear, worldAt(angle, 100, 88), 0, false);
    assert.equal(hit.dead, true);
    assert.equal(clear.dead, false);
  }
});
