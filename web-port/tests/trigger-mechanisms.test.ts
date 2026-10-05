// Task 6 — the trigger mechanisms Task 4 deferred: the collectible that feeds
// an item, the move trigger's "target pos" mode, and the collision-block pair
// key. Each test pins a rule decoded from the 2.2081 binary (FIDELITY.md §6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLevelString } from "../src/gd/level.ts";
import {
  buildTriggers, createRuntime, updateTriggers, groupState, itemCount,
  pairA, pairB, pairKey,
} from "../src/gd/triggers.ts";
import { CollisionWorld } from "../src/game/collision.ts";
import { createSim, simPress, simStep } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";

test("a collision-block pair key survives ids past 10000", () => {
  // the old `lo * 10000 + hi` packing gave (1, 20001) and (2, 10001) the same
  // key, so one of the two pairs could never fire
  assert.equal(pairKey(3, 7), pairKey(7, 3));
  assert.equal(pairA(pairKey(3, 7)), 3);
  assert.equal(pairB(pairKey(3, 7)), 7);
  assert.notEqual(pairKey(1, 20001), pairKey(2, 10001));
  for (const [a, b] of [[1, 2], [9999, 10000], [1, 999999], [123456, 654321]]) {
    const k = pairKey(a, b);
    assert.ok(Number.isSafeInteger(k));
    assert.equal(pairA(k), Math.min(a, b));
    assert.equal(pairB(k), Math.max(a, b));
  }
});

test("the collectible is an interactive, not decoration", async () => {
  const lvl = await parseLevelString("kS38,|;1,1614,2,300,3,100,80,1;");
  const world = new CollisionWorld(lvl, () => ({ w: 30, h: 30 }));
  const hits = world.interactives.filter((i) => i.kind === "collect");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 1614);
});

test("a move trigger in target mode puts key 395's centre on key 71's", async () => {
  // getGroupCenter (m1 0x33fa4): a one-object group is that object's position
  const lvl = await parseLevelString(
    "kS38,|;1,901,2,300,3,100,51,10,71,12,395,11,100,1,101,2;"
    + "1,1,2,900,3,274,57,10.11;1,1,2,900,3,152,57,12;");
  const list = buildTriggers(lvl);
  const rt = createRuntime(lvl);
  updateTriggers(rt, list, 400, 0.1);
  const g = groupState(rt, 10);
  // key 101 = 2 keeps y only
  assert.equal(g.dx, 0);
  assert.equal(g.dy, 152 - 274);
});

test("target mode reads the live position, so an earlier move is taken off", async () => {
  const lvl = await parseLevelString(
    "kS38,|;1,901,2,200,3,100,51,10,28,0,29,-100;"
    + "1,901,2,300,3,100,51,10,71,12,395,11,100,1,101,2;"
    + "1,1,2,900,3,274,57,10.11;1,1,2,900,3,152,57,12;");
  const list = buildTriggers(lvl);
  const rt = createRuntime(lvl);
  updateTriggers(rt, list, 400, 0.1);
  // the first move took the group (and its centre marker) down 100, so the
  // target move only has to close the remaining 22
  assert.equal(Math.round(groupState(rt, 10).dy), -122);
});

test("key 101 = 1 keeps x only", async () => {
  const lvl = await parseLevelString(
    "kS38,|;1,901,2,300,3,100,51,10,71,12,395,11,100,1,101,1;"
    + "1,1,2,900,3,274,57,10.11;1,1,2,600,3,152,57,12;");
  const list = buildTriggers(lvl);
  const rt = createRuntime(lvl);
  updateTriggers(rt, list, 400, 0.1);
  const g = groupState(rt, 10);
  assert.equal(g.dx, 600 - 900);
  assert.equal(g.dy, 0);
});

test("a group of several objects centres on its bounding box, not its mean", async () => {
  // three objects at x 0, 0 and 300: the mean is 100, the bbox centre is 150
  const lvl = await parseLevelString(
    "kS38,|;1,901,2,300,3,100,51,10,71,12,395,11,100,1,101,1;"
    + "1,1,2,900,3,100,57,10.11;"
    + "1,1,2,0,3,100,57,12;1,1,2,0,3,100,57,12;1,1,2,300,3,100,57,12;");
  const list = buildTriggers(lvl);
  const rt = createRuntime(lvl);
  updateTriggers(rt, list, 400, 0.1);
  assert.equal(groupState(rt, 10).dx, 150 - 900);
});

test("running over a collectible adds its amount to the item and removes it", async () => {
  // collisionCheckObjects +1516..1628 -> addPickupTrigger: key 80 names the
  // item, key 77 the amount (1 when absent — see FIDELITY §6.2, A27)
  const lvl = await parseLevelString(
    "kS38,|;1,1614,2,120,3,15,80,1;1,1614,2,240,3,15,80,1,77,4;1,1614,2,360,3,15,80,2,78,1,77,3;");
  const world = new CollisionWorld(lvl, () => ({ w: 30, h: 30 }));
  const s = createSim(0, SPEEDS[1], lvl);
  for (let i = 0; i < 240 * 3 && s.player.x < 420; i++) simStep(s, world, 1 / 240, false);
  assert.equal(itemCount(s.triggers!.rt, 1), 5, "1 + 4");
  assert.equal(itemCount(s.triggers!.rt, 2), -3, "key 78 subtracts");
  assert.equal(s.destroyed.size, 3, "all three stop being drawn");
});

test("the sim reports every orb it fires, multi-activate ones included", async () => {
  // A13: the scene used to diff `usedOrbs`, which a key-99 orb never enters
  const lvl = await parseLevelString("kS38,|;1,36,2,150,3,15;1,36,2,400,3,15,99,1;");
  const world = new CollisionWorld(lvl, () => ({ w: 30, h: 30 }));
  const s = createSim(0, SPEEDS[1], lvl);
  const fired: number[] = [];
  for (let i = 0; i < 240 * 3 && s.player.x < 480; i++) {
    simPress(s);
    simStep(s, world, 1 / 240, true);
    for (const e of s.effects) fired.push(Math.round(e.x));
    if (s.dead) break;
  }
  assert.ok(fired.includes(150), `plain orb: ${fired}`);
  assert.ok(fired.includes(400), `key-99 orb: ${fired}`);
});

test("collision pair keys stay exact and distinct for large block ids", () => {
  // `(lo << 16) | hi` would alias at 65536 and go negative from lo = 32768
  const ids = [0, 1, 9999, 10000, 10001, 32767, 32768, 65535, 65536, 999_999, 2 ** 21 - 1];
  const seen = new Map<number, string>();
  for (const a of ids) for (const b of ids) {
    const k = pairKey(a, b);
    assert.ok(k >= 0 && Number.isSafeInteger(k), `key for ${a},${b}`);
    assert.equal(pairA(k), Math.min(a, b));
    assert.equal(pairB(k), Math.max(a, b));
    const pair = `${Math.min(a, b)},${Math.max(a, b)}`;
    assert.equal(seen.get(k) ?? pair, pair, `key ${k} shared by ${seen.get(k)} and ${pair}`);
    seen.set(k, pair);
  }
});

test("Time Warp (1935) scales the clock; a delayed spawn's move starts at once", async () => {
  const { buildTriggers, createRuntime, updateTriggers, groupState } = await import("../src/gd/triggers.ts");
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      { id: 1935, x: 10, y: 0, props: new Map<number, string>([[120, "0.2"]]) },
      // spawn group 7 after 0.1 s; group 7's move lifts group 5 by 30 over 1 s
      { id: 1268, x: 20, y: 0, props: new Map<number, string>([[51, "7"], [63, "0.1"]]) },
      { id: 901, x: 0, y: 0, props: new Map<number, string>([[57, "7"], [62, "1"], [51, "5"], [29, "30"], [10, "1"]]) },
    ],
  } as unknown as Level;
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, list, 30, 0);
  assert.equal(rt.timeWarp, 0.2, "Dash x=4535: the clock runs at 0.2");
  updateTriggers(rt, list, 30, 0.1);  // the spawn comes due...
  assert.ok(groupState(rt, 5).dy > 0, "...and its move has already started this step");
});
