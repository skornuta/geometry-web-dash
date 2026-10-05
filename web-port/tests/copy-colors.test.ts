// Copy colour channels. A channel (or a colour trigger) can name another
// channel as its source and a `ccHSVValue` to bend it with; the source keeps
// animating, so the copy has to resolve at draw time, not at load.
//
// Sourced: `updateColor(color&, fadeTime, colorID, blending, opacity,
// copyHSV&, colorIDToCopy, copyOpacity, caller, ...)` (m1 0x111634) — the copy
// source and copy-opacity flag are per-call arguments, so every colour trigger
// sets them, and a trigger without them clears the copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_HSV } from "../src/gd/color.ts";
import { type Level } from "../src/gd/level.ts";
import {
  buildTriggers, createRuntime, resolveColor, updateTriggers, type TriggerRuntime,
} from "../src/gd/triggers.ts";

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

const ch = (rt: TriggerRuntime, id: number, v: Partial<{
  r: number; g: number; b: number; opacity: number; blending: boolean;
  copyChannel: number; copyOpacity: boolean;
}>) => rt.colors.set(id, {
  r: 255, g: 255, b: 255, opacity: 1, blending: false,
  copyChannel: 0, copyHSV: NO_HSV, copyOpacity: false, ...v,
});

const empty = () => createRuntime(fakeLevel([]));

test("a channel with no copy source resolves to itself", () => {
  const rt = empty();
  ch(rt, 5, { r: 10, g: 20, b: 30 });
  const c = resolveColor(rt, 5);
  assert.deepEqual([c.r, c.g, c.b], [10, 20, 30]);
});

test("a copying channel takes its source's colour, not its own", () => {
  const rt = empty();
  ch(rt, 3, { r: 10, g: 20, b: 30 });
  ch(rt, 7, { r: 200, g: 200, b: 200, copyChannel: 3 });
  const c = resolveColor(rt, 7);
  assert.deepEqual([c.r, c.g, c.b], [10, 20, 30]);
});

test("the copy HSV bends the source on the way through", () => {
  const rt = empty();
  ch(rt, 3, { r: 255, g: 0, b: 0 });
  rt.colors.get(3)!.blending = false;
  ch(rt, 7, { copyChannel: 3 });
  rt.colors.get(7)!.copyHSV = { h: 120, s: 1, v: 1, sAbsolute: false, vAbsolute: false };
  const c = resolveColor(rt, 7);
  assert.deepEqual([c.r, c.g, c.b], [0, 255, 0]);
});

test("a copy follows its source as a trigger animates it", () => {
  const level = fakeLevel([{ id: 899, x: 100, props: { 23: "3", 7: "0", 8: "0", 9: "255" } }]);
  const rt = createRuntime(level);
  ch(rt, 3, { r: 255, g: 0, b: 0 });
  ch(rt, 7, { copyChannel: 3 });
  assert.deepEqual([resolveColor(rt, 7).r, resolveColor(rt, 7).b], [255, 0]);
  updateTriggers(rt, buildTriggers(level), 1e6, 0);
  assert.deepEqual([resolveColor(rt, 7).r, resolveColor(rt, 7).b], [0, 255]);
});

test("copy-opacity chooses between the source's opacity and the copier's own", () => {
  const rt = empty();
  ch(rt, 3, { opacity: 0.25 });
  ch(rt, 7, { opacity: 0.8, copyChannel: 3, copyOpacity: false });
  ch(rt, 8, { opacity: 0.8, copyChannel: 3, copyOpacity: true });
  assert.equal(resolveColor(rt, 7).opacity, 0.8);
  assert.equal(resolveColor(rt, 8).opacity, 0.25);
});

test("blending stays the copier's own, never the source's", () => {
  const rt = empty();
  ch(rt, 3, { blending: true });
  ch(rt, 7, { blending: false, copyChannel: 3 });
  assert.equal(resolveColor(rt, 7).blending, false);
});

test("a chain of copies resolves through every link", () => {
  const rt = empty();
  ch(rt, 1, { r: 255, g: 0, b: 0 });
  ch(rt, 2, { copyChannel: 1 });
  ch(rt, 3, { copyChannel: 2 });
  const c = resolveColor(rt, 3);
  assert.deepEqual([c.r, c.g, c.b], [255, 0, 0]);
});

test("a copy cycle terminates instead of hanging", () => {
  const rt = empty();
  ch(rt, 1, { r: 1, g: 2, b: 3, copyChannel: 2 });
  ch(rt, 2, { r: 4, g: 5, b: 6, copyChannel: 1 });
  const c = resolveColor(rt, 1);
  assert.ok(Number.isFinite(c.r) && Number.isFinite(c.g) && Number.isFinite(c.b));
});

test("a colour trigger sets its target's copy source, and a later one clears it", () => {
  const level = fakeLevel([
    { id: 899, x: 100, props: { 23: "7", 7: "9", 8: "9", 9: "9", 50: "3" } },
    { id: 899, x: 200, props: { 23: "7", 7: "9", 8: "9", 9: "9" } },
  ]);
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  ch(rt, 3, { r: 111, g: 122, b: 133 });
  updateTriggers(rt, triggers, 150, 0);
  const copied = resolveColor(rt, 7);
  assert.deepEqual([copied.r, copied.g, copied.b], [111, 122, 133]);
  updateTriggers(rt, triggers, 250, 0);
  const own = resolveColor(rt, 7);
  assert.deepEqual([own.r, own.g, own.b], [9, 9, 9]);
});

test("a level's own colour list carries its copy source and HSV", async () => {
  const { decodeLevelString } = await import("../src/gd/level.ts");
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");
  const level = await decodeLevelString(readFileSync(join(assets, "levels", "19.txt"), "utf8"));
  // `1_255_2_255_3_255_4_-1_6_21_7_1_15_0_9_3_10_0a1a0.7a0a0_8_1`
  const c = level.colors.get(21);
  assert.equal(c?.copyChannel, 3);
  assert.deepEqual(c?.hsv, { h: 0, s: 1, v: 0.7, sAbsolute: false, vAbsolute: false });
  // and it survives into the runtime, so drawing can resolve it
  const rt = createRuntime(level);
  assert.equal(rt.colors.get(21)?.copyChannel, 3);
});

test("a trigger's key 49 becomes the channel's copy HSV", () => {
  const level = fakeLevel([
    { id: 899, x: 100, props: { 23: "7", 7: "9", 8: "9", 9: "9", 50: "3", 49: "120a1a1a0a0" } },
  ]);
  const rt = createRuntime(level);
  ch(rt, 3, { r: 255, g: 0, b: 0 });
  updateTriggers(rt, buildTriggers(level), 150, 0);
  assert.equal(rt.colors.get(7)!.copyHSV.h, 120);
  const c = resolveColor(rt, 7);
  assert.deepEqual([c.r, c.g, c.b], [0, 255, 0]);
});

test("even a neutral (0,1,1) copy HSV loses a unit to truncation", () => {
  // Not a rounding bug of ours: `fcvtzs` in transformColor truncates, so a
  // round trip through HSV can land one below where it started. A copy with no
  // key 49 at all takes the no-transform path and is exact.
  const rt = empty();
  ch(rt, 3, { r: 111, g: 122, b: 133 });
  ch(rt, 7, { copyChannel: 3 });
  assert.deepEqual([resolveColor(rt, 7).r], [111]);
  rt.colors.get(7)!.copyHSV = { h: 0, s: 1, v: 1, sAbsolute: false, vAbsolute: false };
  assert.deepEqual([resolveColor(rt, 7).r], [110]);
});
