// M5 trigger runtime. Colour triggers appear in every level, so these guard the
// path that all 22 levels depend on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeLevelString, type Level } from "../src/gd/level.ts";
import {
  buildTriggers, cloneRuntime, createRuntime, groupState, movableGroups, parseGroups,
  resetRuntime, resolveColor, restoreRuntime,
  updateTriggers,
} from "../src/gd/triggers.ts";

const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");
const loadLevel = (n: number) =>
  decodeLevelString(readFileSync(join(assets, "levels", `${n}.txt`), "utf8"));

/** a level containing just the given trigger objects */
function fakeLevel(objs: { id: number; x: number; props: Record<number, string> }[]): Level {
  return {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: objs.map((o) => ({
      id: o.id, x: o.x, y: 0,
      props: new Map(Object.entries(o.props).map(([k, v]) => [Number(k), v])),
    })),
  } as unknown as Level;
}

test("group ids parse from the '.'-separated key 57", () => {
  const o = { id: 1, x: 0, y: 0, props: new Map([[57, "3.17.2"]]) };
  assert.deepEqual(parseGroups(o as never), [3, 17, 2]);
  assert.deepEqual(parseGroups({ id: 1, x: 0, y: 0, props: new Map() } as never), []);
});

test("a colour trigger tweens its channel over the duration", () => {
  // id 29 targets channel 1000 (BG) — the one mapping OpenGD states outright
  const level = fakeLevel([{ id: 29, x: 100, props: { 7: "0", 8: "0", 9: "255", 10: "2" } }]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  rt.colors.set(1000, { r: 255, g: 0, b: 0, opacity: 1, blending: false });

  // not reached yet: nothing happens
  updateTriggers(rt, triggers, 50, 0.5);
  assert.equal(rt.colors.get(1000)!.b, 0);

  // reached: halfway through the 2s tween the channel is halfway to blue
  // fires here; an action moves from the step after it fires
  updateTriggers(rt, triggers, 120, 0);
  updateTriggers(rt, triggers, 120, 1);
  const mid = rt.colors.get(1000)!;
  assert.ok(Math.abs(mid.r - 127.5) < 1, `r ${mid.r}`);
  assert.ok(Math.abs(mid.b - 127.5) < 1, `b ${mid.b}`);

  updateTriggers(rt, triggers, 120, 1.1);
  const end = rt.colors.get(1000)!;
  assert.equal(end.r, 0);
  assert.equal(end.b, 255);
});

test("a move trigger offsets its target group and settles exactly", () => {
  const level = fakeLevel([
    { id: 901, x: 100, props: { 51: "7", 28: "60", 29: "-30", 10: "1" } },
  ]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);

  // fires here; an action moves from the step after it fires
  updateTriggers(rt, triggers, 120, 0);
  updateTriggers(rt, triggers, 120, 0.5);
  const half = groupState(rt, 7);
  assert.ok(Math.abs(half.dx - 30) < 1, `dx ${half.dx}`);
  assert.ok(Math.abs(half.dy + 15) < 1, `dy ${half.dy}`);

  updateTriggers(rt, triggers, 120, 0.6);
  const done = groupState(rt, 7);
  assert.equal(done.dx, 60);
  assert.equal(done.dy, -30);
});

test("toggle disables a group; alpha fades it", () => {
  const level = fakeLevel([
    { id: 1049, x: 10, props: { 51: "4", 56: "0" } },
    { id: 1007, x: 20, props: { 51: "5", 35: "0", 10: "1" } },
  ]);
  const rt = createRuntime(level);
  const list = buildTriggers(level);
  // fires here; an action moves from the step after it fires
  updateTriggers(rt, list, 30, 0);
  updateTriggers(rt, list, 30, 1);
  assert.equal(groupState(rt, 4).enabled, false);
  assert.equal(groupState(rt, 5).alpha, 0);
});

test("triggers only fire once, and only once the player reaches them", () => {
  const level = fakeLevel([{ id: 901, x: 500, props: { 51: "1", 28: "10", 10: "0" } }]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, triggers, 499, 0.1);
  assert.equal(groupState(rt, 1).dx, 0);
  updateTriggers(rt, triggers, 501, 0.1);
  assert.equal(groupState(rt, 1).dx, 10);
  // passing it again must not re-apply the offset
  updateTriggers(rt, triggers, 900, 0.1);
  assert.equal(groupState(rt, 1).dx, 10);
});

test("Stereo Madness' colour triggers are found and drive the background", async () => {
  const level = await loadLevel(1);
  const triggers = buildTriggers(level);
  assert.ok(triggers.length >= 14, `found ${triggers.length} triggers`);
  const rt = createRuntime(level);
  const before = { ...rt.colors.get(1000)! };
  // run past the first BG trigger (x=135) and let its 10s tween finish
  for (let i = 0; i < 800; i++) updateTriggers(rt, triggers, 200, 1 / 60);
  const after = rt.colors.get(1000)!;
  assert.notDeepEqual(
    { r: after.r, g: after.g, b: after.b },
    { r: before.r, g: before.g, b: before.b },
    "the background channel should have changed");
});

test("movableGroups lists only groups a move/alpha/toggle trigger targets", () => {
  const level = fakeLevel([
    { id: 901, x: 0, props: { 51: "2" } },
    { id: 1049, x: 0, props: { 51: "9" } },
    { id: 29, x: 0, props: { 7: "1", 8: "2", 9: "3" } },
  ]);
  assert.deepEqual([...movableGroups(buildTriggers(level))].sort(), [2, 9]);
});

// --- shake trigger (1520) ---
// M8 shipped this without a test and it was never seen firing in a real level;
// these pin both the property mapping (key 75 strength, key 10 duration) and
// the fact that it survives the clone/restore that checkpoints rely on.

test("the shake trigger arms strength for its duration, then clears", () => {
  const level = fakeLevel([{ id: 1520, x: 100, props: { 75: "8", 10: "0.5" } }]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);

  // not reached yet
  updateTriggers(rt, triggers, 50, 1 / 60);
  assert.equal(rt.shake.strength, 0);

  updateTriggers(rt, triggers, 100, 1 / 60);
  assert.equal(rt.shake.strength, 8);
  assert.ok(rt.shake.remaining > 0.48, `remaining ${rt.shake.remaining}`);

  // run past the end: strength must return to exactly zero, not a residue
  for (let i = 0; i < 60; i++) updateTriggers(rt, triggers, 100, 1 / 60);
  assert.equal(rt.shake.remaining, 0);
  assert.equal(rt.shake.strength, 0);
});

test("a zero-duration shake still lasts long enough to be sampled", () => {
  const level = fakeLevel([{ id: 1520, x: 0, props: { 75: "4" } }]);
  const rt = createRuntime(level);
  updateTriggers(rt, buildTriggers(level), 0, 1 / 60);
  assert.equal(rt.shake.strength, 4);
  assert.ok(rt.shake.remaining > 1 / 60,
    "a shake that expires before the next frame can read it is invisible");
});

test("a shake in flight survives clone/restore and is cleared by reset", () => {
  const level = fakeLevel([{ id: 1520, x: 0, props: { 75: "6", 10: "2" } }]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, triggers, 0, 1 / 60);

  const snap = cloneRuntime(rt);
  for (let i = 0; i < 30; i++) updateTriggers(rt, triggers, 0, 1 / 60);
  assert.ok(rt.shake.remaining < snap.shake.remaining, "the live one should have run down");

  restoreRuntime(rt, snap);
  assert.equal(rt.shake.strength, 6);
  assert.equal(rt.shake.remaining, snap.shake.remaining);

  resetRuntime(rt, level);
  assert.equal(rt.shake.strength, 0);
  assert.equal(rt.shake.remaining, 0);
});

test("Deadlocked's first shake trigger fires with the strength the level asks for", async () => {
  const level = await loadLevel(21);
  const shakes = level.objects.filter((o) => o.id === 1520);
  assert.equal(shakes.length, 30, "level 21 should carry 30 shake triggers");

  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  // the first one sits at x=2685 asking for strength 5 over 0.3s
  updateTriggers(rt, triggers, 2685, 1 / 60);
  assert.equal(rt.shake.strength, 5);
  assert.ok(rt.shake.remaining > 0.28 && rt.shake.remaining <= 0.3,
    `remaining ${rt.shake.remaining}`);
});

test("an instant colour trigger stops a fade still running on its channel", () => {
  // Fingerdash x=13521: a snap to red lands while an 8 s fade is in flight
  const level = fakeLevel([
    { id: 29, x: 100, props: { 7: "0", 8: "0", 9: "255", 10: "8" } },
    { id: 29, x: 200, props: { 7: "255", 8: "0", 9: "0", 10: "0" } },
  ]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, triggers, 120, 0);
  updateTriggers(rt, triggers, 120, 1);
  updateTriggers(rt, triggers, 220, 0);
  updateTriggers(rt, triggers, 220, 1);
  const c = rt.colors.get(1000)!;
  assert.deepEqual([c.r, c.g, c.b], [255, 0, 0]);
});

test("a colour trigger with Player Color 1/2 fades to the player's colour", () => {
  // Electrodynamix x=8223: RGB says red, key 15 says player colour 1
  const level = fakeLevel([
    { id: 29, x: 100, props: { 7: "255", 8: "0", 9: "10", 10: "0", 15: "1" } },
    { id: 899, x: 100, props: { 7: "255", 8: "0", 9: "10", 10: "0", 16: "1", 23: "5" } },
  ]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  rt.playerColors = [{ r: 128, g: 128, b: 128 }, { r: 1, g: 2, b: 3 }];
  updateTriggers(rt, triggers, 120, 0);
  const bg = rt.colors.get(1000)!, ch5 = rt.colors.get(5)!;
  assert.deepEqual([bg.r, bg.g, bg.b], [128, 128, 128]);
  assert.deepEqual([ch5.r, ch5.g, ch5.b], [1, 2, 3]);
});

test("a scale trigger (2067) eases a group's size about its centre group, and 'divide by' undoes it", () => {
  const level = fakeLevel([
    { id: 1, x: 200, y: 0, props: { 57: "5" } },          // the centre (group 5)
    { id: 2067, x: 100, props: { 51: "4", 71: "5", 150: "2", 151: "3", 10: "1" } },
    { id: 2067, x: 300, props: { 51: "4", 71: "5", 150: "2", 151: "3", 153: "1", 154: "1", 10: "0" } },
  ]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, triggers, 120, 0);
  updateTriggers(rt, triggers, 120, 0.5);
  let g = groupState(rt, 4);
  assert.ok(Math.abs(g.sx - 1.5) < 1e-9 && Math.abs(g.sy - 2) < 1e-9, `halfway ${g.sx},${g.sy}`);
  updateTriggers(rt, triggers, 120, 0.5);
  g = groupState(rt, 4);
  assert.ok(Math.abs(g.sx - 2) < 1e-9 && Math.abs(g.sy - 3) < 1e-9);
  assert.equal(g.scx, 200);
  updateTriggers(rt, triggers, 320, 0);
  g = groupState(rt, 4);
  assert.ok(Math.abs(g.sx - 1) < 1e-9 && Math.abs(g.sy - 1) < 1e-9, "divided back to 1");
});

test("a trigger in a toggled-off group does not fire when passed", () => {
  // group 84 is switched off at x=100; the toggle at x=200 (a member of 84)
  // would switch group 85 off — it must stay on (Deadlocked x=14925)
  const level = fakeLevel([
    { id: 1049, x: 100, props: { 51: "84" } },
    { id: 1049, x: 200, props: { 51: "85", 57: "84" } },
  ]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, triggers, 150, 0);
  assert.equal(groupState(rt, 84).enabled, false);
  updateTriggers(rt, triggers, 250, 0);
  assert.equal(groupState(rt, 85).enabled, true);
});

test("a zoom camera trigger (1913) eases the zoom to key 371 over its duration", () => {
  const level = fakeLevel([{ id: 1913, x: 100, props: { 371: "0.5", 10: "1" } }]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  assert.equal(rt.zoom, 1);
  updateTriggers(rt, triggers, 120, 0);
  updateTriggers(rt, triggers, 120, 0.5);
  assert.ok(Math.abs(rt.zoom - 0.75) < 1e-9, `halfway ${rt.zoom}`);
  updateTriggers(rt, triggers, 120, 0.5);
  assert.equal(rt.zoom, 0.5);
});

test("1005/1006 are the player's colours, also through a copy", () => {
  const rt = createRuntime(fakeLevel([]));
  rt.playerColors = [{ r: 125, g: 255, b: 0 }, { r: 255, g: 0, b: 255 }];
  const p2 = resolveColor(rt, 1006);
  assert.deepEqual([p2.r, p2.g, p2.b], [255, 0, 255]);
  const p1 = resolveColor(rt, 1005);
  assert.deepEqual([p1.r, p1.g, p1.b], [125, 255, 0]);
  // and they blend (additive) unless something sets them
  assert.equal(p1.blending, true);
  assert.equal(p2.blending, true);
  assert.equal(resolveColor(rt, 1).blending, false);
  rt.colors.set(7, { r: 0, g: 0, b: 0, opacity: 1, blending: false, copyChannel: 1006, copyHSV: { h: 0, s: 0, v: 0, sAbsolute: false, vAbsolute: false } } as never);
  const c = resolveColor(rt, 7);
  assert.deepEqual([c.r, c.g, c.b], [255, 0, 255]);
});

test("Spawn Ordered (key 441) fires the group's triggers in x order, (x − first x) / 311.58 s apart", () => {
  // Dash x 13305: a toggle orb spawns a sepia flash and, 150 units on, the
  // trigger that ends it — fired together the end cancelled the flash
  const level = fakeLevel([
    { id: 1268, x: 0, props: { 51: "7", 441: "1" } },
    { id: 2920, x: 1000, props: { 57: "7", 62: "1", 176: "1" } },
    { id: 2920, x: 1150, props: { 57: "7", 62: "1" } },
  ]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, triggers, 10, 1 / 240);      // passes the spawn trigger
  for (let i = 0; i < 4; i++) updateTriggers(rt, triggers, 10, 1 / 240);
  assert.equal(rt.shader.sepia, 1, "the first fires at once");
  let t = 0;
  while (rt.shader.sepia === 1 && t < 2) { updateTriggers(rt, triggers, 10, 1 / 240); t += 1 / 240; }
  assert.ok(Math.abs(t - 150 / 311.58) < 0.02, `the second is ${t.toFixed(3)} s later`);
});

test("Shader Setup (2904) sets the shaded layer range: unset is 1..15, keys 196/197 narrow it", () => {
  const level = fakeLevel([
    { id: 2904, x: 100, props: { 196: "8", 197: "8" } },
    { id: 2904, x: 200, props: { 197: "12" } },
  ]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  assert.deepEqual(rt.shaderZ, [1, 15]);
  updateTriggers(rt, triggers, 150, 1 / 240);
  assert.deepEqual(rt.shaderZ, [8, 8], "Dash x 945: the player's layer alone");
  updateTriggers(rt, triggers, 250, 1 / 240);
  assert.deepEqual(rt.shaderZ, [1, 12]);
});

test("Options (2899) keys 165/199 switch the players' controls off (1) and back on (−1); 0 leaves them", () => {
  const level = fakeLevel([
    { id: 2899, x: 100, props: { 165: "1", 199: "1" } },
    { id: 2899, x: 200, props: { 165: "-1" } },
  ]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, triggers, 150, 1 / 240);
  assert.deepEqual(rt.controlsOff, [true, true]);
  updateTriggers(rt, triggers, 250, 1 / 240);
  assert.deepEqual(rt.controlsOff, [false, true]);
  resetRuntime(rt, level);
  assert.deepEqual(rt.controlsOff, [false, false]);
});

test("Spawn Particle (3608) queues a copy of group 51's particles at group 71's object (or itself)", () => {
  const level = fakeLevel([
    { id: 3608, x: 100, props: { 51: "7", 71: "9" } },
    { id: 3608, x: 200, props: { 51: "8" } },
  ]);
  const triggers = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, triggers, 250, 1 / 240);
  assert.deepEqual(rt.particleSpawns.map((q) => [q.group, q.posGroup, q.x]), [[7, 9, 100], [8, 0, 200]]);
});
