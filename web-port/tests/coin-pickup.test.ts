import { test } from "node:test";
import assert from "node:assert/strict";
import { CollisionWorld } from "../src/game/collision.ts";
import { createSim, cloneSim, restoreSim, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import type { Level } from "../src/gd/level.ts";

function coinWorld() {
  // Object and interactive indices deliberately differ.
  const level = {
    colors: new Map(), rawHeader: "",
    objects: [
      { id: 1, x: 1000, y: 15, props: new Map() },
      { id: 142, x: 0, y: 15, props: new Map() },
    ],
  } as unknown as Level;
  return new CollisionWorld(level, (id) => id === 142 ? { w: 40, h: 40 } : { w: 30, h: 30 });
}

test("secret coin pickup hides its object once, not its interactive index", () => {
  const world = coinWorld();
  const s = createSim(0, SPEEDS[1]);
  const coin = world.interactives.find((it) => it.id === 142)!;
  assert.notEqual(coin.obj, coin.index);
  simStep(s, world, STEP, false);
  assert.deepEqual([...s.collected], [coin.index]);
  assert.deepEqual([...s.destroyed], [coin.obj]);
  assert.equal(s.run.coins, 1);
  for (let i = 0; i < 4; i++) simStep(s, world, STEP, false);
  assert.equal(s.run.coins, 1);
  assert.equal(s.destroyed.size, 1);
});

test("coin visibility follows cloned/restored snapshots and fresh attempts", () => {
  const world = coinWorld();
  const s = createSim(0, SPEEDS[1]);
  const before = cloneSim(s);
  simStep(s, world, STEP, false);
  const after = cloneSim(s);
  assert.deepEqual([...after.destroyed], [1]);
  assert.notEqual(after.destroyed, s.destroyed);
  restoreSim(s, before);
  assert.equal(s.destroyed.size, 0);
  assert.equal(s.collected.size, 0);
  assert.equal(s.run.coins, 0);
  simStep(s, world, STEP, false);
  assert.deepEqual([...s.destroyed], [1], "the restored coin can be collected again");
  restoreSim(s, after);
  assert.deepEqual([...s.destroyed], [1]);
  assert.equal(s.run.coins, 1);
  assert.equal(createSim(0, SPEEDS[1]).destroyed.size, 0);
});

// Dynamic import lets the pre-implementation run also exercise the sim regressions.
const model = () => import("../src/gd/coinPickup.ts");
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("2.209 coin pickup uses the decoded cubic flight, with no extra HD scaling", async () => {
  const { createCoinPickup, coinPickupPose } = await model();
  const s = createCoinPickup({ x: 100, y: 200, randomX: 0.6, randomY: 0.5 });
  const initial = coinPickupPose(s);
  assert.equal(initial.x, 100);
  assert.equal(initial.y, 200);
  // Controls (100,294.5), (130,389); endpoint (130,120).
  const mid = coinPickupPose({ ...s, age: 0.375 });
  near(mid.x, 115);
  near(mid.y, 296.3125);
  const end = coinPickupPose({ ...s, age: 0.75 });
  near(end.x, 130);
  near(end.y, 120);
  const left = coinPickupPose({ ...s, randomX: -1, randomY: 0, age: 0.75 });
  near(left.x, 50);
  near(left.y, 120);
});

test("pickup spin is four frames at .05s, independent of the .115s idle clock", async () => {
  const { createCoinPickup, coinPickupPose } = await model();
  const s = createCoinPickup({ x: 0, y: 0, outline: true, randomX: 0, randomY: 0 });
  assert.deepEqual([0, 0.049, 0.05, 0.1, 0.15, 0.2, 0.249].map((age) =>
    coinPickupPose({ ...s, age }).frame), [1, 1, 2, 3, 4, 1, 1]);
  assert.equal(coinPickupPose(s).outline, true);
});

test("pickup holds opacity until .5s, fades for .25s and expires at .75s", async () => {
  const { createCoinPickup, coinPickupPose, stepCoinPickup } = await model();
  const s = createCoinPickup({ x: 0, y: 0, randomX: 0, randomY: 0 });
  for (const age of [0, 0.3, 0.5]) assert.equal(coinPickupPose({ ...s, age }).alpha, 1);
  near(coinPickupPose({ ...s, age: 0.625 }).alpha, 0.5);
  assert.equal(coinPickupPose({ ...s, age: 1 }).alpha, 0);
  assert.equal(stepCoinPickup(s, 0.75), null);
  assert.equal(stepCoinPickup(s, 1), null);
  const next = stepCoinPickup(s, 0.25)!;
  assert.equal(next.age, 0.25);
  assert.equal(s.age, 0, "stepping must not mutate the input");
  let stepped = s;
  for (let i = 0; i < 60; i++) stepped = stepCoinPickup(stepped, STEP)!;
  near(coinPickupPose(stepped).x, coinPickupPose(next).x);
  near(coinPickupPose(stepped).y, coinPickupPose(next).y);
});
