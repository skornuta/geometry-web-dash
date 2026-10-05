// The legacy colour trigger table, read out of the shipping 2.2081 binary.
//
// Evidence (arm64 slice, geode m1 addresses):
//   EffectGameObject::customSetup    0x1572dc — 29->1000, 30->1001, 105->1004,
//                                     744->1003, 900->1009, 915->1002+blending
//   the object factory's id remap    0x4f10cc — 104->915, 221/717/718/743->899,
//                                     then 0x4f2124 writes m_targetColorID
//                                     221->1, 717->2, 718->3, 743->4 and
//                                     104-> blending only
//   EffectGameObject::triggerObject  0x173398 — the one updateColor call, whose
//                                     4th argument is m_blending at +0x5cf, and
//                                     whose id 29 + tint-ground follow-up at
//                                     0x1733f0 targets 1001 with opacity 1.0
//                                     and blending 0 (`mov w3, #0`)
//   EffectGameObject ctor            0x1a2288 — opacity (+0x5b0) defaults to 1.0,
//                                     tint-ground/blending (+0x5cc..+0x5cf) to 0
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Level } from "../src/gd/level.ts";
import { buildTriggers, createRuntime, updateTriggers } from "../src/gd/triggers.ts";

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

/** fire every trigger in `objs` once, and hand back the resulting channels */
function run(objs: { id: number; x: number; props: Record<number, string> }[]) {
  const level = fakeLevel(objs);
  const rt = createRuntime(level);
  updateTriggers(rt, buildTriggers(level), 1e6, 0);
  return rt.colors;
}

const rgb = (r: number, g: number, b: number) => ({ 7: String(r), 8: String(g), 9: String(b) });

test("every legacy colour trigger id drives its sourced channel", () => {
  const targets: [number, number][] = [
    [29, 1000], [30, 1001], [104, 1002], [105, 1004],
    [221, 1], [717, 2], [718, 3], [743, 4],
    [744, 1003], [900, 1009], [915, 1002],
  ];
  for (const [id, ch] of targets) {
    const colors = run([{ id, x: 100, props: rgb(12, 34, 56) }]);
    const c = colors.get(ch);
    assert.ok(c, `id ${id} must write channel ${ch}`);
    assert.deepEqual([c.r, c.g, c.b], [12, 34, 56], `id ${id} -> channel ${ch}`);
  }
});

test("104 and 915 arrive with blending already on; the others do not", () => {
  assert.equal(run([{ id: 104, x: 1, props: rgb(1, 2, 3) }]).get(1002)!.blending, true);
  assert.equal(run([{ id: 915, x: 1, props: rgb(1, 2, 3) }]).get(1002)!.blending, true);
  for (const id of [29, 30, 105, 221, 717, 718, 743, 744, 900]) {
    assert.equal(run([{ id, x: 1, props: rgb(1, 2, 3) }]).get(
      { 29: 1000, 30: 1001, 105: 1004, 221: 1, 717: 2, 718: 3, 743: 4, 744: 1003, 900: 1009 }[id]!,
    )!.blending, false, `id ${id} defaults to no blending`);
  }
});

test("an explicit key 17 overrides the id's default blending", () => {
  assert.equal(run([{ id: 104, x: 1, props: { ...rgb(1, 2, 3), 17: "0" } }]).get(1002)!.blending, false);
  assert.equal(run([{ id: 29, x: 1, props: { ...rgb(1, 2, 3), 17: "1" } }]).get(1000)!.blending, true);
});

test("a trigger with no key 35 sets opacity to 1, it does not inherit the channel's", () => {
  const level = fakeLevel([{ id: 29, x: 100, props: rgb(0, 0, 0) }]);
  const rt = createRuntime(level);
  rt.colors.set(1000, { r: 255, g: 255, b: 255, opacity: 0.25, blending: false });
  updateTriggers(rt, buildTriggers(level), 1e6, 0);
  assert.equal(rt.colors.get(1000)!.opacity, 1);
});

test("a BG trigger with tint-ground also drives the ground, at full opacity", () => {
  const colors = run([{ id: 29, x: 100, props: { ...rgb(10, 20, 30), 14: "1", 35: "0.5", 17: "1" } }]);
  const bg = colors.get(1000)!, ground = colors.get(1001)!;
  assert.deepEqual([bg.r, bg.g, bg.b], [10, 20, 30]);
  assert.deepEqual([ground.r, ground.g, ground.b], [10, 20, 30]);
  assert.equal(bg.opacity, 0.5);
  // `fmov s1, #1.0` / `mov w3, #0` — the follow-up call hardcodes both
  assert.equal(ground.opacity, 1);
  assert.equal(bg.blending, true);
  assert.equal(ground.blending, false);
});

test("only a BG trigger tints the ground; the flag on any other id is inert", () => {
  const colors = run([{ id: 105, x: 100, props: { ...rgb(10, 20, 30), 14: "1" } }]);
  assert.equal(colors.get(1004)!.r, 10);
  assert.equal(colors.get(1001), undefined);
});

test("tint-ground follows the same tween as the trigger it rides on", () => {
  const level = fakeLevel([{ id: 29, x: 100, props: { ...rgb(0, 0, 100), 10: "2", 14: "1" } }]);
  const rt = createRuntime(level);
  rt.colors.set(1000, { r: 0, g: 0, b: 0, opacity: 1, blending: false });
  rt.colors.set(1001, { r: 0, g: 0, b: 0, opacity: 1, blending: false });
  const list = buildTriggers(level);
  // fires here; an action moves from the step after it fires
  updateTriggers(rt, list, 200, 0);
  updateTriggers(rt, list, 200, 1); // half way
  assert.equal(rt.colors.get(1000)!.b, 50);
  assert.equal(rt.colors.get(1001)!.b, 50);
});

// --- end to end on the shipped levels, so a wiring regression cannot hide ---

test("Electrodynamix really drives its object and line channels as it plays", async () => {
  const { decodeLevelString } = await import("../src/gd/level.ts");
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { buildTriggers, createRuntime, resolveColor, updateTriggers } =
    await import("../src/gd/triggers.ts");
  const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");
  const level = await decodeLevelString(readFileSync(join(assets, "levels", "18.txt"), "utf8"));

  const start = level.colors.get(1004)!;
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  for (let x = 0; x <= 23000; x += 30) updateTriggers(rt, triggers, x, 30 / 311.58);

  // L18 carries 123 id-105 triggers, which target the OBJECT channel
  const obj = resolveColor(rt, 1004);
  assert.notDeepEqual([obj.r, obj.g, obj.b], [start.r, start.g, start.b],
    "the object channel moved off the level's opening colour");

  // and 68 id-104 triggers, which target LINE and arrive with blending on
  assert.equal(resolveColor(rt, 1002).blending, true);
});

test("Geometrical Dominator's copied channel tracks the channel it copies", async () => {
  const { decodeLevelString } = await import("../src/gd/level.ts");
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { createRuntime, resolveColor } = await import("../src/gd/triggers.ts");
  const { transformColor } = await import("../src/gd/color.ts");
  const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");
  const level = await decodeLevelString(readFileSync(join(assets, "levels", "19.txt"), "utf8"));
  const rt = createRuntime(level);

  // `1_255_2_255_3_255_4_-1_6_21_7_1_15_0_9_3_10_0a1a0.7a0a0_8_1`
  const src = resolveColor(rt, 3);
  const want = transformColor(src, level.colors.get(21)!.hsv);
  const got = resolveColor(rt, 21);
  assert.deepEqual([got.r, got.g, got.b], [want.r, want.g, want.b]);
  // and it is genuinely a copy, not the channel's own stored 255,255,255
  assert.notDeepEqual([got.r, got.g, got.b], [255, 255, 255]);
});
