// Tests for practice-mode checkpoints (src/gd/checkpoints.ts) and the in-place
// snapshot restore they depend on (`restoreSim` in src/game/sim.ts).
//
// The rule that matters most here is that a checkpoint stores the **whole
// world**, not a position: restoring only x/y would resume into a level whose
// breakables were already smashed and whose coins were already taken, which
// plays differently from the first run through the section.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CheckpointStack } from "../src/gd/checkpoints.ts";
import { createSim, restoreSim, cloneSim } from "../src/game/sim.ts";
import { SPEEDS } from "../src/gd/physics.ts";
import type { Gamemode } from "../src/gd/gamemodes.ts";

function simAt(x: number, y: number, mode: Gamemode = "cube", onGround = true) {
  const s = createSim(x, SPEEDS[1]);
  s.player.x = x;
  s.player.y = y;
  s.player.mode = mode;
  s.player.onGround = onGround;
  return s;
}

test("a checkpoint restores the whole world, not just the position", () => {
  const s = simAt(1000, 45);
  s.destroyed.add(7);
  s.collected.add(3);
  s.usedPortals.add(11);
  s.run.coins = 1;

  const cps = new CheckpointStack();
  cps.place(s, 0);

  // play on: move, smash another block, take another coin
  s.player.x = 2000;
  s.player.y = 300;
  s.destroyed.add(8);
  s.collected.add(4);
  s.run.coins = 2;
  s.dead = true;

  const cp = cps.restore(s);
  assert.ok(cp);
  assert.equal(s.player.x, 1000);
  assert.equal(s.player.y, 45);
  assert.equal(s.dead, false);
  assert.deepEqual([...s.destroyed], [7], "the later-smashed block is back");
  assert.deepEqual([...s.collected], [3], "the later coin is uncollected again");
  assert.deepEqual([...s.usedPortals], [11]);
  assert.equal(s.run.coins, 1);
});

test("restoring keeps object identity, so the scene's references stay live", () => {
  const s = simAt(500, 15);
  const player = s.player, run = s.run;
  const cps = new CheckpointStack();
  cps.place(s, 0);
  s.player.x = 900;
  cps.restore(s);
  assert.equal(s.player, player, "player object is mutated, not replaced");
  assert.equal(s.run, run, "run object is mutated, not replaced");
  assert.equal(player.x, 500);
});

test("a checkpoint survives being used, so repeated deaths return to it", () => {
  const s = simAt(1000, 45);
  const cps = new CheckpointStack();
  cps.place(s, 0);

  for (let i = 0; i < 3; i++) {
    s.player.x = 1500 + i;
    s.dead = true;
    assert.ok(cps.restore(s), `death ${i + 1} still finds the checkpoint`);
    assert.equal(s.player.x, 1000);
  }
  assert.equal(cps.length, 1);
});

test("restore reports nothing when no checkpoint has been placed", () => {
  const s = simAt(0, 15);
  const cps = new CheckpointStack();
  assert.equal(cps.restore(s), undefined);
});

test("x removes the most recent checkpoint only", () => {
  const s = simAt(100, 15);
  const cps = new CheckpointStack();
  cps.place(s, 0, true);
  s.player.x = 800;
  cps.place(s, 0, true);
  assert.equal(cps.length, 2);
  assert.equal(cps.last?.x, 800);

  assert.equal(cps.remove(), true);
  assert.equal(cps.length, 1);
  assert.equal(cps.last?.x, 100, "the earlier checkpoint is now live again");

  assert.equal(cps.remove(), true);
  assert.equal(cps.remove(), false, "removing from an empty stack is a no-op");
});

test("a ground mode gets an automatic checkpoint on landing, not mid-air", () => {
  const cps = new CheckpointStack();
  const s = simAt(0, 15, "cube", true);
  cps.update(s, 0);           // first frame, already grounded: no landing edge
  assert.equal(cps.length, 0);

  // jump: leaves the ground, travels, comes back down far enough away
  s.player.onGround = false;
  s.player.x = 300;
  cps.update(s, 0);
  assert.equal(cps.length, 0, "nothing is placed while airborne");

  s.player.x = 600;
  s.player.onGround = true;
  cps.update(s, 0);
  assert.equal(cps.length, 1, "landing far enough along places one");
  assert.equal(cps.last?.x, 600);

  // landing again immediately is too close to count as "a series of movements"
  s.player.onGround = false;
  cps.update(s, 0);
  s.player.x = 700;
  s.player.onGround = true;
  cps.update(s, 0);
  assert.equal(cps.length, 1, "a landing right after the last one is skipped");
});

test("a flying mode gets checkpoints by distance, placed behind the icon", () => {
  const cps = new CheckpointStack();
  const s = simAt(0, 200, "ship", false);
  cps.update(s, 0);
  assert.equal(cps.length, 1, "the first frame places one immediately");

  s.player.x = 100;
  cps.update(s, 0);
  assert.equal(cps.length, 1, "not yet far enough for the next");

  s.player.x = 1000;
  cps.update(s, 0);
  assert.equal(cps.length, 2);
  assert.ok(cps.last!.x < 1000, "a flying checkpoint sits behind the player");
});

test("turning auto off stops automatic placement but keeps manual placement", () => {
  const cps = new CheckpointStack();
  cps.auto = false;
  const s = simAt(0, 200, "ship", false);
  s.player.x = 5000;
  cps.update(s, 0);
  assert.equal(cps.length, 0);

  cps.place(s, 0, true);
  assert.equal(cps.length, 1, "z still works with auto-checkpoints off");
  assert.equal(cps.last?.manual, true);
});

test("clear drops every checkpoint and re-arms auto placement", () => {
  const cps = new CheckpointStack();
  const s = simAt(0, 200, "ship", false);
  cps.update(s, 0);
  assert.equal(cps.length, 1);
  cps.clear();
  assert.equal(cps.length, 0);
  cps.update(s, 0);
  assert.equal(cps.length, 1, "spacing is measured afresh after a clear");
});

test("restoreSim is the exact inverse of cloneSim for the sets it carries", () => {
  const s = simAt(123, 45);
  s.destroyed.add(1);
  s.usedOrbs.add(2);
  s.touching.add(3);
  s.collected.add(4);
  s.usedPortals.add(5);
  s.onOrb = true;
  s.onPad = true;

  const snap = cloneSim(s);
  s.destroyed.clear();
  s.usedOrbs.clear();
  s.touching.clear();
  s.collected.clear();
  s.usedPortals.clear();
  s.onOrb = false;
  s.onPad = false;

  restoreSim(s, snap);
  assert.deepEqual([...s.destroyed], [1]);
  assert.deepEqual([...s.usedOrbs], [2]);
  assert.deepEqual([...s.touching], [3]);
  assert.deepEqual([...s.collected], [4]);
  assert.deepEqual([...s.usedPortals], [5]);
  assert.equal(s.onOrb, true);
  assert.equal(s.onPad, true);
});
