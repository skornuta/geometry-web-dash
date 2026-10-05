// GameToolbox::transformColor and its two cocos conversions, read out of the
// shipping 2.2081 binary (arm64 slice, geode m1 addresses):
//   transformColor  0x449884   RGBtoHSV  0x32d930   HSVtoRGB  0x32d9dc
// The identity fast path compares the value against a zero-initialised static
// (BSS at 0x1008b97e0, never written), so an ALL-ZERO ccHSVValue — which is
// also the object's default (ctor 0x1a230c) — means "no transform".
import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_HSV, parseHSV, transformColor } from "../src/gd/color.ts";

const red = { r: 255, g: 0, b: 0 };
const t = (c: typeof red, hsv: Parameters<typeof transformColor>[1]) => {
  const o = transformColor(c, hsv);
  return [o.r, o.g, o.b];
};
const hsv = (h: number, s: number, v: number, sAbs = false, vAbs = false) =>
  ({ h, s, v, sAbsolute: sAbs, vAbsolute: vAbs });

test("an all-zero HSV is the no-transform sentinel, not a black multiplier", () => {
  assert.deepEqual(t(red, NO_HSV), [255, 0, 0]);
  assert.deepEqual(t({ r: 17, g: 200, b: 99 }, NO_HSV), [17, 200, 99]);
});

test("the neutral multiplier (0,1,1) also round-trips a colour", () => {
  assert.deepEqual(t(red, hsv(0, 1, 1)), [255, 0, 0]);
});

test("a hue shift rotates around the 360-degree wheel", () => {
  assert.deepEqual(t(red, hsv(120, 1, 1)), [0, 255, 0]);
  assert.deepEqual(t(red, hsv(240, 1, 1)), [0, 0, 255]);
});

test("a negative hue wraps by adding 360 once", () => {
  // 0 - 50 -> 310 degrees; sector 5 gives (v, p, q) with q = 1 - 1/6
  assert.deepEqual(t(red, hsv(-50, 1, 1)), [255, 0, 212]);
});

test("saturation and brightness multiply by default", () => {
  assert.deepEqual(t(red, hsv(0, 0.5, 1)), [255, 127, 127]);
  assert.deepEqual(t(red, hsv(0, 1, 0.5)), [127, 0, 0]);
});

test("the absolute flags add instead of multiplying", () => {
  assert.deepEqual(t(red, hsv(0, -0.5, 1, true, false)), [255, 127, 127]);
  assert.deepEqual(t(red, hsv(0, 1, -0.5, false, true)), [127, 0, 0]);
});

test("saturation and brightness clamp to [0.0001, 1]", () => {
  // s -> 0.0001, not 0: the result is one short of pure white, not white
  assert.deepEqual(t(red, hsv(0, 0, 1)), [255, 254, 254]);
  assert.deepEqual(t(red, hsv(0, 4, 1)), [255, 0, 0]);
  assert.deepEqual(t(red, hsv(0, 1, 0)), [0, 0, 0]);
});

test("the 0.0001 saturation floor tints even a grey, by a single unit", () => {
  // A grey has saturation 0, but the clamp runs BEFORE HSVtoRGB, so the
  // s <= 0 shortcut inside that function is unreachable from transformColor
  // and a hue shift leaks one unit into two channels.
  assert.deepEqual(t({ r: 128, g: 128, b: 128 }, hsv(90, 1, 1)), [127, 128, 127]);
});

test("truncation, not rounding, converts back to bytes", () => {
  // The value channel lands on exactly 64.0 and survives; the other two are
  // the saturation floor's 64 * (1 - 0.0001) = 63.9936, which `fcvtzs` takes
  // down to 63. Rounding would have given a flat 64.
  assert.deepEqual(t({ r: 128, g: 128, b: 128 }, hsv(0, 1, 0.5)), [64, 63, 63]);
});

test("the copy-HSV string is 'a'-separated h,s,v,sAbsolute,vAbsolute", () => {
  assert.deepEqual(parseHSV("0a1a0.7a0a0"),
    { h: 0, s: 1, v: 0.7, sAbsolute: false, vAbsolute: false });
  assert.deepEqual(parseHSV("-50a1a1a0a0"),
    { h: -50, s: 1, v: 1, sAbsolute: false, vAbsolute: false });
  assert.deepEqual(parseHSV("0a0.6a0.66a0a1"),
    { h: 0, s: 0.6, v: 0.66, sAbsolute: false, vAbsolute: true });
});

test("an unparseable copy-HSV string is the no-transform sentinel", () => {
  assert.deepEqual(parseHSV(""), NO_HSV);
  assert.deepEqual(parseHSV("nonsense"), NO_HSV);
});

test("LBG (1007): a bright BG gives its lightened self, a dark one leans to player colour 1", async () => {
  const { lightBgColor, transformColor } = await import("../src/gd/color.ts");
  const L = transformColor({ r: 164, g: 0, b: 0 }, { h: 0, s: -0.2, v: 0.2, sAbsolute: true, vAbsolute: true });
  assert.deepEqual(lightBgColor({ r: 164, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }), L);
  // black BG: sum 0, so all player colour
  assert.deepEqual(lightBgColor({ r: 0, g: 0, b: 0 }, { r: 125, g: 255, b: 0 }), { r: 125, g: 255, b: 0 });
});
