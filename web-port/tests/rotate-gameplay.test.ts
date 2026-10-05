// Rotate Gameplay (2900) velocity hand-off and the spawn trigger's group remap,
// both pinned against Dash's native run (scripts/macro-compare.mjs 22 --resync).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Level } from "../src/gd/level.ts";
import { CollisionWorld } from "../src/game/collision.ts";
import { createSim, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { dashSlope } from "../src/gd/interactives.ts";
import {
  buildTriggers, createRuntime, groupState, movableGroups, updateTriggers,
} from "../src/gd/triggers.ts";

type Obj = { id: number; x: number; y: number; props: Record<number, string> };

function levelOf(objs: Obj[]): Level {
  return {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: objs.map((o) => ({
      id: o.id, x: o.x, y: o.y,
      props: new Map(Object.entries(o.props).map(([k, v]) => [Number(k), v])),
    })),
  } as unknown as Level;
}

/** fly a cube past a Rotate Gameplay trigger at x=50 and return its yVel */
function yVelAfter(rotate: Record<number, string>): number {
  const level = levelOf([{ id: 2900, x: 50, y: 0, props: rotate }]);
  const world = new CollisionWorld(level, () => null);
  const s = createSim(0, SPEEDS[1], level);
  s.player.y = 300;
  s.player.onGround = false;
  while (!s.player.sideways && s.player.x < 100) simStep(s, world, STEP, false);
  return s.player.yVel;
}

test("turning sideways hands 0.9 x the travel speed to the gravity axis", () => {
  // `m_yVelocity = m_xVelocity * m_playerSpeed`: raw units per 1/60 s, which
  // is 0.9 of the port's per-second speed (travel is raw * 60, yVel raw * 54).
  // One step of gravity has run by the time the loop sees the flag.
  const v = yVelAfter({ 166: "3", 167: "2" });
  assert.ok(Math.abs(v - 0.9 * SPEEDS[1]) < 12, `about ${0.9 * SPEEDS[1]}, got ${v}`);
});

test("edit velocity (169) scales the hand-off by modY (583)", () => {
  const plain = yVelAfter({ 166: "3", 167: "2" });
  const scaled = yVelAfter({ 166: "3", 167: "2", 169: "1", 583: "-1" });
  // same step of gravity on both; the sign of the hand-off flips
  assert.ok(scaled < 0 && plain > 0);
  assert.ok(Math.abs(Math.abs(scaled) - 0.9 * SPEEDS[1]) < 12);
});

test("override velocity (584) replaces the hand-off with modY raw units", () => {
  const v = yVelAfter({ 166: "3", 167: "2", 169: "1", 584: "1", 583: "2" });
  assert.ok(Math.abs(v - 2 * 54) < 12, `about 108, got ${v}`);
});

test("a spawn remap (442) sends the spawned move to the new group", () => {
  // Dash (7785, 857): spawn group 493 with 100 -> 494; group 493's move
  // targets 100, so group 494 is what moves.
  const level = levelOf([
    { id: 1268, x: 20, y: 0, props: { 51: "493", 442: "100.494.101.495" } },
    { id: 901, x: 0, y: 0, props: { 57: "493", 62: "1", 51: "100", 29: "-12", 10: "0.5" } },
  ]);
  const list = buildTriggers(level);
  assert.ok(movableGroups(list).has(494), "the remapped group's colliders are dynamic");
  const rt = createRuntime(level);
  updateTriggers(rt, list, 30, 0);
  updateTriggers(rt, list, 30, 0.1);
  updateTriggers(rt, list, 30, 1);
  assert.ok(groupState(rt, 494).dy < 0, "group 494 moved down");
  assert.equal(groupState(rt, 100).dy, 0, "group 100 itself did not");
});

test("a dash orb runs along its angle, clamped to 70 degrees", () => {
  // Dash (13333, 675), rotation -45: the native cube climbs one for one
  assert.ok(Math.abs(dashSlope(-45, false, false) - 1) < 1e-6);
  assert.equal(dashSlope(0, false, false), 0);
  assert.ok(Math.abs(dashSlope(-80, false, false) - Math.tan(70 * Math.PI / 180)) < 1e-4);
  // pointing backwards folds into the forward half: 135 up-left runs as 45 up
  assert.ok(Math.abs(dashSlope(-135, false, false) - 1) < 1e-6);
});

test("a y-only Camera Static carries the free-fly band onto its target", () => {
  // Dash (17775, 1275): group 338's marker at y 765, 1.3 s ease
  const level = levelOf([
    { id: 1914, x: 20, y: 0, props: { 71: "7", 101: "2", 10: "0.5" } },
    { id: 1, x: 5000, y: 765, props: { 57: "7" } },
  ]);
  const world = new CollisionWorld(level, () => null);
  const s = createSim(0, SPEEDS[1], level);
  const start = s.player.cameraYCenter;
  for (let i = 0; i < 240; i++) simStep(s, world, STEP, false);
  assert.notEqual(start, 765);
  assert.ok(Math.abs(s.player.cameraYCenter - 765) < 1e-6, `centre ${s.player.cameraYCenter}`);
});
