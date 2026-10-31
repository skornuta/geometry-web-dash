import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLevelString } from "../src/gd/level.ts";
import { CollisionWorld } from "../src/game/collision.ts";
import { createSim, cloneSim, restoreSim, simPress, simStep, STEP } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import { buildTriggers, movableGroups } from "../src/gd/triggers.ts";

async function fixture(body: string) {
  const level = await parseLevelString(`kS38,|;${body}1,1,2,6000,3,-1000;`);
  const world = new CollisionWorld(level, () => ({ w: 40, h: 40 }), movableGroups(buildTriggers(level)));
  return { level, world, s: createSim(0, SPEEDS[1], level) };
}

test("coin events capture resolved moving-group position and deduplicate per attempt", async () => {
  const { s, world } = await fixture("1,901,2,0,3,0,51,7,28,-120,10,0;1,142,2,120,3,15,57,7;");
  const before = cloneSim(s);
  simStep(s, world, STEP, false);
  assert.deepEqual(s.effects, [{ kind: "coin", player: 0, obj: 1, id: 142, index: 0, x: 0, y: 15 }]);
  assert.deepEqual([...s.destroyed], [1]);
  simStep(s, world, STEP, false);
  assert.deepEqual(s.effects, []);
  restoreSim(s, before);
  simStep(s, world, STEP, false);
  assert.equal(s.effects.filter(e => e.kind === "coin").length, 1);
});

test("pickup events are world-space in sideways and reversed gameplay", async () => {
  for (const reversed of [false, true]) {
    const { s, world } = await fixture("1,142,2,100,3,200;");
    Object.assign(s.player, { x: 100, y: 200, sideways: true, reversed, onGround: false });
    simStep(s, world, STEP, false);
    assert.equal(s.effects[0]?.kind, "coin");
    assert.equal(s.effects[0].x, 100);
    assert.equal(s.effects[0].y, 200);
  }
});

test("dual orb events identify player2, including the synchronous simPress spider-orb boundary after restore", async () => {
  const { s, world } = await fixture("1,1704,2,0,3,200;1,3004,2,300,3,200;");
  Object.assign(s.player, { y: 100, onGround: false });
  s.dual = cloneSim(s);
  Object.assign(s.dual.player, { y: 200, onGround: false });
  s.dual.run = s.run;
  s.dual.collected = s.collected;
  s.dual.destroyed = s.destroyed;
  simPress(s, world);
  simStep(s, world, STEP, true);
  simStep(s, world, STEP, true);
  assert.equal(s.effects.find(e => e.id === 1704)?.player, 1);
  assert.equal(s.player.dash, 0);
  assert.equal(s.dual.player.dash, 1);
  const snap = cloneSim(s);
  restoreSim(s, snap);
  s.effects.length = 0;
  s.dual!.player.dash = 0;
  s.dual!.touchedOrb = world.interactives.find(it => it.id === 3004)!;
  simPress(s, world);
  assert.equal(s.effects[0]?.kind, "orb");
  assert.equal(s.effects[0]?.id, 3004);
  assert.equal(s.effects[0]?.player, 1);
  assert.equal(s.effects[0]?.x, 300);
});

test("dual coin collection stays shared across cloning and checkpoint restore", async () => {
  const { s, world } = await fixture("1,142,2,0,3,200;");
  Object.assign(s.player, { y: 200, onGround: false });
  s.dual = cloneSim(s);
  s.dual.collected = s.collected;
  s.dual.destroyed = s.destroyed;
  const snap = cloneSim(s);
  assert.equal(snap.dual!.collected, snap.collected);
  assert.notEqual(snap.collected, s.collected);
  restoreSim(s, snap);
  assert.equal(s.dual!.collected, s.collected);
  simStep(s, world, STEP, false);
  assert.equal(s.effects.filter(e => e.kind === "coin").length, 1);
  assert.equal(s.run.coins, 1);
  assert.equal(s.dual!.collected.size, 1);
});

test("small collectibles emit their own kind, not a secret-coin or orb event", async () => {
  const { s, world } = await fixture("1,1614,2,0,3,15,80,1;");
  simStep(s, world, STEP, false);
  assert.equal(s.effects[0]?.kind, "collect");
  assert.equal(s.run.coins, 0);
});
