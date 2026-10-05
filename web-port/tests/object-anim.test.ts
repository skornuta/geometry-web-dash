// Task 5 — object rotation and frame animation.
//
// Each test pins a rule decoded from the 2.2081 binary (FIDELITY.md §5), not a
// behaviour invented here. The addresses are in `src/gd/objectAnim.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLevelString, type LevelObject } from "../src/gd/level.ts";
import {
  OBJECT_ANIMATION, OBJECT_ROTATION, animationFor, frameIndexAt, rotationFor,
} from "../src/gd/objectAnim.ts";
import {
  buildTriggers, createRuntime, updateTriggers,
} from "../src/gd/triggers.ts";

async function objectOf(props: Record<number, string | number>): Promise<LevelObject> {
  const body = Object.entries(props).map(([k, v]) => `${k},${v}`).join(",");
  const lvl = await parseLevelString(`kS38,|;${body};`);
  return lvl.objects[0];
}

test("key 97 replaces the table rate and pins the direction positive", async () => {
  // createRotateAction +40..92: a non-zero m_rotationSpeed is used as-is and
  // skips the random ±1, which is why Deadlocked's 51 flash rings (1019) all
  // turn the same way at 50 deg/s instead of the table's rand()*135 + 45.
  const o = await objectOf({ 1: 1019, 2: 100, 3: 100, 97: 50 });
  assert.equal(rotationFor(o, 0), 50);
  assert.equal(rotationFor(o, 17), 50);
});

test("key 98 stops an object spinning at all", async () => {
  const on = await objectOf({ 1: 88, 2: 100, 3: 100 });
  const off = await objectOf({ 1: 88, 2: 100, 3: 100, 98: 1 });
  assert.equal(Math.abs(rotationFor(on, 3)), 300);
  assert.equal(rotationFor(off, 3), 0);
});

test("a fixed-rate id turns at its table rate in one of the two directions", async () => {
  const o = await objectOf({ 1: 89, 2: 100, 3: 100 });
  for (let i = 0; i < 32; i++) assert.equal(Math.abs(rotationFor(o, i)), 360);
  const signs = new Set<number>();
  for (let i = 0; i < 64; i++) signs.add(Math.sign(rotationFor(o, i)));
  assert.deepEqual([...signs].sort(), [-1, 1]);
});

test("a random-rate id stays inside the range its block computes", async () => {
  // the wheels take rand()*90 + 90 (+1008), the spirals rand()*90 + 270 (+1568)
  const wheel = await objectOf({ 1: 137, 2: 0, 3: 0 });
  const spiral = await objectOf({ 1: 1058, 2: 0, 3: 0 });
  for (let i = 0; i < 200; i++) {
    const w = Math.abs(rotationFor(wheel, i));
    assert.ok(w >= 90 && w < 180, `wheel ${w}`);
    const s = Math.abs(rotationFor(spiral, i));
    assert.ok(s >= 270 && s < 360, `spiral ${s}`);
  }
});

test("an id with no rotation entry never spins", async () => {
  const o = await objectOf({ 1: 1, 2: 0, 3: 0 });
  assert.equal(rotationFor(o, 0), 0);
  assert.equal(OBJECT_ROTATION.has(1), false);
});

test("the rotating balls spin, and 1619/1620 always turn the same way (customSetup, emulated)", async () => {
  // Blast Processing's orb arms (375/376) stood still before the table was
  // rebuilt from the emulated routine (USER-06)
  for (const id of [375, 376, 377, 378]) {
    const r = Math.abs(rotationFor(await objectOf({ 1: id, 2: 0, 3: 0 }), 7));
    const d = OBJECT_ROTATION.get(id)!;
    assert.ok(r >= d.dps && r <= d.dps + d.span!, `${id} spins at ${r}`);
  }
  for (let i = 0; i < 8; i++) {
    assert.equal(rotationFor(await objectOf({ 1: 1619, 2: 0, 3: 0 }), i), -720);
    assert.equal(rotationFor(await objectOf({ 1: 1620, 2: 0, 3: 0 }), i), -1080);
  }
});

test("the frame index is 1-based and wraps at the frame count", async () => {
  const a = { frames: 4, frameTime: 0.1, offset: 0, reversed: false };
  assert.deepEqual([0, 0.05, 0.1, 0.25, 0.31, 0.41, 0.45].map((t) => frameIndexAt(a, t)),
    [1, 1, 2, 3, 4, 1, 1]);
});

test("a negative key 107 with key 122 runs the sequence backwards", async () => {
  // updateSyncedAnimation +308..316: `csinc w8, frames - n, n, ne`
  const fwd = { frames: 4, frameTime: 0.1, offset: 0, reversed: false };
  const rev = { frames: 4, frameTime: 0.1, offset: 0, reversed: true };
  assert.deepEqual([0, 0.11, 0.21, 0.31].map((t) => frameIndexAt(fwd, t)), [1, 2, 3, 4]);
  assert.deepEqual([0, 0.11, 0.21, 0.31].map((t) => frameIndexAt(rev, t)), [4, 3, 2, 1]);
});

test("key 107 only divides the frame time when key 122 is set", async () => {
  const base = OBJECT_ANIMATION.get(2047)!;
  const plain = await objectOf({ 1: 2047, 2: 0, 3: 0, 107: 2 });
  const used = await objectOf({ 1: 2047, 2: 0, 3: 0, 107: 2, 122: 1 });
  assert.equal(animationFor(used, 0)!.frameTime, base.frameTime / 2);
  // without 122 the random jitter (0.8..1.2) decides instead
  const ft = animationFor(plain, 0)!.frameTime;
  assert.ok(ft > base.frameTime / 1.2 && ft < base.frameTime / 0.8, String(ft));
  assert.equal(animationFor(used, 0)!.reversed, false);
  const back = await objectOf({ 1: 2047, 2: 0, 3: 0, 107: -2, 122: 1 });
  assert.equal(animationFor(back, 0)!.reversed, true);
});

test("the fully synced ids get no offset and no jitter, the fire ids get both", async () => {
  // +2256 touches neither m_randomFrameTime nor the start offset; +1400 sets both
  const wave = await objectOf({ 1: 1050, 2: 0, 3: 0 });
  const fire = await objectOf({ 1: 923, 2: 0, 3: 0 });
  const w = animationFor(wave, 7)!;
  assert.equal(w.offset, 0);
  assert.equal(w.frameTime, OBJECT_ANIMATION.get(1050)!.frameTime);
  const f = animationFor(fire, 7)!;
  assert.ok(f.offset > 0 && f.offset < 0.5, String(f.offset));
  assert.notEqual(f.frameTime, OBJECT_ANIMATION.get(923)!.frameTime);
});

test("an unanimated id has no timing", async () => {
  const o = await objectOf({ 1: 88, 2: 0, 3: 0 });
  assert.equal(animationFor(o, 0), null);
});

test("the animate trigger records when its target group was started", async () => {
  // EffectGameObject::triggerObject -> triggerAnimation: the group's objects
  // restart their loop from that instant (m1 0x201c00)
  const lvl = await parseLevelString("kS38,|;1,1585,2,300,3,100,51,44;1,2047,2,900,3,100,57,44,123,1;");
  const list = buildTriggers(lvl);
  const rt = createRuntime(lvl);
  assert.equal(rt.animated.size, 0);
  updateTriggers(rt, list, 200, 0.1);
  assert.equal(rt.animated.size, 0, "not reached yet");
  updateTriggers(rt, list, 400, 0.1);
  assert.equal(rt.animated.get(44), rt.time);
});
