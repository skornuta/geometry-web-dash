// Objects 32 and 33 (48 instances in 13 levels' worth of the trigger range) are
// the ghost-trail triggers, not inert.
//
// Evidence (arm64 slice, geode m1 addresses):
//   object factory jump table  0x4e605c — ids 29/30/32/33 -> EffectGameObject::create
//   EffectGameObject::triggerObject 0x172da4 — id 0x20 (+320..) and 0x21
//                                   (+1680) load `GameManager[0x1f8]` (the
//                                   PlayLayer) and tail-call 0xabc14 with
//                                   w1 = 1 / 0 unless `[obj+0x289]` (the
//                                   GameManager performance flag) is set
//   PlayLayer::toggleGhostEffect 0xabc14 — PlayerObject::toggleGhostEffect on
//                                   player 1 and, when `[0x3f2]` (dual), on 2
//   PlayerObject::toggleGhostEffect 0x388894 — type 1 builds a GhostTrailEffect
//                                   (runWithTarget icon, 0.05, 0.4, 0, 0.6)
//   off again at resetObject 0x387858 +996, playerDestroyed 0x38907c +292,
//   playCompleteEffect 0x1bf7f0 +156; loadFromCheckpoint 0x39107c +1160
//   restores the checkpoint's ghost type
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Level } from "../src/gd/level.ts";
import {
  buildTriggers, cloneRuntime, createRuntime, isTrigger, resetRuntime, restoreRuntime,
  updateTriggers,
} from "../src/gd/triggers.ts";
import { GhostTrail, ghostIcon, GHOST_LIFE } from "../src/gd/ghostTrail.ts";

function fakeLevel(objs: { id: number; x: number }[]): Level {
  return {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: objs.map((o) => ({ id: o.id, x: o.x, y: 300, props: new Map() })),
  } as unknown as Level;
}

test("32 turns the ghost trail on and 33 turns it off, in x order", () => {
  assert.ok(isTrigger(32) && isTrigger(33));
  const level = fakeLevel([{ id: 33, x: 400 }, { id: 32, x: 100 }]);
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  assert.equal(rt.ghost, false);
  updateTriggers(rt, list, 50, 1 / 240);
  assert.equal(rt.ghost, false, "not passed yet");
  updateTriggers(rt, list, 150, 1 / 240);
  assert.equal(rt.ghost, true);
  updateTriggers(rt, list, 450, 1 / 240);
  assert.equal(rt.ghost, false);
});

test("a new attempt starts with the trail off; a checkpoint restores it", () => {
  const level = fakeLevel([{ id: 32, x: 100 }]);
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, list, 150, 1 / 240);
  assert.equal(rt.ghost, true);
  const snap = cloneRuntime(rt);
  assert.equal(snap.ghost, true);
  resetRuntime(rt, level);
  assert.equal(rt.ghost, false, "resetObject turns it off");
  restoreRuntime(rt, snap);
  assert.equal(rt.ghost, true, "loadFromCheckpoint restores the checkpoint's type");
});

const pose = (x: number) => ({ x, y: 100, rot: 0, flipY: false, mode: "cube" as const, mini: false });

test("a copy is taken every 0.05 s and lives 0.4 s", () => {
  const g = new GhostTrail();
  const dt = 1 / 60;
  let t = 0;
  const counts: number[] = [];
  for (let i = 0; i < 120; i++) {
    t += dt;
    g.update(dt, true, [pose(i), null]);
    counts.push(g.snaps.length);
  }
  const born = g.snaps.map((s) => s.born);
  for (let i = 1; i < born.length; i++) {
    assert.ok(Math.abs(born[i] - born[i - 1] - 0.05) < dt + 1e-9, "one every 0.05 s");
  }
  assert.ok(Math.max(...g.snaps.map((s) => g.now - s.born)) <= GHOST_LIFE + 1e-9, "older copies are gone");
  assert.ok(g.snaps.length >= 5 && g.snaps.length <= 9, `about 0.4/0.05 live, got ${g.snaps.length}`);
  assert.ok(counts.some((c) => c > 0));
});

test("a copy fades from 200/255 to nothing while it shrinks toward 0.6", () => {
  const g = new GhostTrail();
  g.update(0.016, true, [pose(0), null]);
  g.update(0.05, true, [pose(10), null]);
  assert.equal(g.snaps.length, 1);
  const a = g.live()[0];
  assert.ok(Math.abs(a.alpha - 200 / 255) < 1e-9);
  assert.equal(a.scale, 1);
  g.update(0.2, false, [pose(20), null]);
  const b = g.live()[0];
  assert.ok(Math.abs(b.alpha - (200 / 255) * 0.5) < 1e-6, "half faded at 0.2 s");
  assert.ok(Math.abs(b.scale - 0.8) < 1e-6, "halfway to 0.6");
  g.update(0.3, false, [pose(20), null]);
  assert.equal(g.live().length, 0, "gone after 0.4 s");
});

test("switching off stops new copies and the next switch-on starts the clock again", () => {
  const g = new GhostTrail();
  g.update(0.016, true, [pose(0), null]);
  g.update(0.04, true, [pose(0), null]);
  g.update(0.04, false, [pose(0), null]);
  assert.equal(g.snaps.length, 0, "off before the interval ran out");
  g.update(0.04, true, [pose(0), null]);
  g.update(0.04, true, [pose(0), null]);
  assert.equal(g.snaps.length, 0, "the interval restarted");
});

test("both players get a copy in a dual", () => {
  const g = new GhostTrail();
  g.update(0.016, true, [pose(0), pose(0)]);
  g.update(0.06, true, [pose(5), pose(7)]);
  assert.deepEqual(g.snaps.map((s) => s.slot).sort(), [0, 1]);
});

test("the copy is the player's icon sprite: the little cube in a ship or UFO", () => {
  assert.deepEqual(ghostIcon("cube"), { mode: "cube", dy: 0, s: 1 });
  assert.deepEqual(ghostIcon("ball"), { mode: "ball", dy: 0, s: 1 });
  assert.deepEqual(ghostIcon("wave"), { mode: "wave", dy: 0, s: 1 });
  assert.deepEqual(ghostIcon("swing"), { mode: "swing", dy: 0, s: 1 });
  assert.deepEqual(ghostIcon("ship"), { mode: "cube", dy: 5, s: 0.55 });
  assert.deepEqual(ghostIcon("ufo"), { mode: "cube", dy: 5, s: 0.55 });
  assert.equal(ghostIcon("robot"), null);
  assert.equal(ghostIcon("spider"), null);
});
