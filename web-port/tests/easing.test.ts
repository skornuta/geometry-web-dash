// Move-trigger easing (key 30 + rate key 85), read out of the shipping 2.2081
// binary rather than taken from the community table:
//   GameToolbox::getEasedValue  m1 0x44f990   bounce helper  m1 0x44f8a8
//
// The function opens `cbz w0 -> return value` (type 0 is linear and skips the
// rate guard entirely), then `rate = rate > 0 ? rate : 2.0`, then a jump table
// over types 1..18; anything outside that range returns the value untouched.
// Decoding the 18-byte jump table at 0x1007287a4 and each case confirms the
// widely-repeated mapping — it is now sourced, not assumed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EASING_NAMES, easedValue } from "../src/gd/easing.ts";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("type 0 and any out-of-range type pass the value straight through", () => {
  for (const type of [0, -1, 19, 999]) {
    close(easedValue(0.37, type, 2), 0.37);
  }
});

test("the rate defaults to 2 when it is zero or negative", () => {
  close(easedValue(0.3, 2, 0), 0.09);
  close(easedValue(0.3, 2, -5), 0.09);
  close(easedValue(0.3, 2, 2), 0.09);
  // and a real rate is used
  close(easedValue(0.3, 2, 3), 0.027);
});

test("the three rate easings are the documented powers", () => {
  close(easedValue(0.3, 2, 2), 0.3 ** 2);        // EaseIn
  close(easedValue(0.25, 3, 2), 0.5);            // EaseOut, t^(1/rate)
  close(easedValue(0.25, 1, 2), 0.125);          // EaseInOut, first half
  close(easedValue(0.5, 1, 2), 0.5);
  close(easedValue(0.75, 1, 2), 0.875);          // second half
});

test("the sine curves are the plain trig ones", () => {
  close(easedValue(0.5, 13, 2), 0.5);            // SineInOut
  close(easedValue(1, 15, 2), 1);                // SineOut
  close(easedValue(0.5, 15, 2), Math.sin(Math.PI / 4));
  close(easedValue(0.5, 14, 2), 1 - Math.cos(Math.PI / 4));
});

test("bounce uses the 4/11, 8/11, 10/11 segments and 7.5625", () => {
  // second segment: t - 6/11, then 7.5625 t^2 + 0.75
  const t = 0.5 - 6 / 11;
  close(easedValue(0.5, 9, 2), 7.5625 * t * t + 0.75);
  close(easedValue(0.2, 9, 2), 7.5625 * 0.04);   // first segment
  close(easedValue(1, 9, 2), 1);
});

test("back overshoots below zero on the way in", () => {
  // 1.70158 is the classic constant; the binary carries 2.70158 / -1.70158
  close(easedValue(0.2, 17, 2), 0.04 * (2.70158 * 0.2 - 1.70158));
  assert.ok(easedValue(0.2, 17, 2) < 0, "BackIn dips below its start");
  assert.ok(easedValue(0.8, 18, 2) > 1, "BackOut overshoots its end");
});

test("every type but ExponentialInOut starts at 0 and ends at 1", () => {
  for (let type = 0; type <= 18; type++) {
    if (type === 10) continue;
    close(easedValue(0, type, 2), 0, 1e-6);
    close(easedValue(1, type, 2), 1, 1e-6);
  }
});

test("ExponentialInOut misses both endpoints, symmetrically", () => {
  // t2 = 0 takes the first branch and gives 0.5 * 2^-10 rather than 0; t2 = 2
  // takes the second and gives 1 - 2^-11 rather than 1. Both are what the
  // binary computes, not a rounding slip of ours — and the reason this type is
  // excluded from the endpoint check above.
  close(easedValue(0, 10, 2), 0.5 * 2 ** -10);
  close(easedValue(1, 10, 2), 1 - 2 ** -11);
});

test("elastic short-circuits its endpoints instead of dividing by the rate", () => {
  close(easedValue(0, 5, 2), 0);
  close(easedValue(1, 5, 2), 1);
  close(easedValue(0, 6, 2), 0);
  close(easedValue(1, 6, 2), 1);
  close(easedValue(0, 4, 2), 0);
  close(easedValue(1, 4, 2), 1);
});

test("every curve stays monotone in time for the nine types the levels use", () => {
  // ease/sine/exp are monotone; elastic, bounce and back deliberately are not,
  // so only the smooth families are checked
  for (const type of [1, 2, 3, 10, 11, 12, 13, 14, 15]) {
    let prev = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const v = easedValue(i / 40, type, 2);
      assert.ok(v >= prev - 1e-9, `type ${type} went backwards at t=${i / 40}`);
      prev = v;
    }
  }
});

test("the names line up with the jump table", () => {
  assert.equal(EASING_NAMES[0], "None");
  assert.equal(EASING_NAMES[1], "EaseInOut");
  assert.equal(EASING_NAMES[9], "BounceOut");
  assert.equal(EASING_NAMES[18], "BackOut");
  assert.equal(EASING_NAMES.length, 19);
});

// --- the runtime actually applies it ---

test("a move trigger's key 30 bends where its group is part-way through", async () => {
  const { buildTriggers, createRuntime, groupState, updateTriggers } =
    await import("../src/gd/triggers.ts");
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [{
      id: 901, x: 100, y: 0,
      // move group 5 by 100 over 4 s, EaseIn at rate 2
      props: new Map<number, string>([[51, "5"], [28, "100"], [10, "4"], [30, "2"], [85, "2"]]),
    }],
  } as never;
  const rt = createRuntime(level);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  updateTriggers(rt, buildTriggers(level), 150, 0); // does not re-fire
  updateTriggers(rt, buildTriggers(level), 150, 2); // half the duration
  // linear would be 50; EaseIn rate 2 is 0.5^2 = 0.25 of the way
  close(groupState(rt, 5).dx, 25, 1e-4);
});

test("a move trigger with no key 30 still lands exactly where it should", async () => {
  const { buildTriggers, createRuntime, groupState, updateTriggers } =
    await import("../src/gd/triggers.ts");
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [{
      id: 901, x: 100, y: 0,
      props: new Map<number, string>([[51, "5"], [28, "100"], [10, "4"]]),
    }],
  } as never;
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 150, 0);
  updateTriggers(rt, triggers, 150, 2);
  close(groupState(rt, 5).dx, 50, 1e-4);
  updateTriggers(rt, triggers, 150, 2);
  close(groupState(rt, 5).dx, 100, 1e-4);
});

// --- completion is decided by TIME, never by the eased value ---

test("an overshooting curve does not cut its own move short", async () => {
  const { buildTriggers, createRuntime, groupState, updateTriggers } =
    await import("../src/gd/triggers.ts");
  // ElasticOut (6) crosses above 1 well before the end; testing `k >= 1` for
  // completion removed the tween there and froze the group mid-overshoot.
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [{
      id: 901, x: 100, y: 0,
      props: new Map<number, string>([[51, "5"], [28, "100"], [10, "1"], [30, "6"], [85, "2"]]),
    }],
  } as never;
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 150, 0);
  for (let i = 0; i < 60; i++) updateTriggers(rt, triggers, 150, 1 / 60);
  close(groupState(rt, 5).dx, 100, 1e-6);
  assert.equal(rt.tweens.length, 0, "and it finished rather than leaking");
});

test("a curve that never reaches 1 still lands exactly, and still ends", async () => {
  const { buildTriggers, createRuntime, groupState, updateTriggers } =
    await import("../src/gd/triggers.ts");
  // ExponentialInOut (10) tops out at 1 - 2^-11, so `k >= 1` was never true:
  // the move fell 0.05% short and its tween lived forever.
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [{
      id: 901, x: 100, y: 0,
      props: new Map<number, string>([[51, "5"], [28, "100"], [10, "1"], [30, "10"]]),
    }],
  } as never;
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 150, 0);
  for (let i = 0; i < 70; i++) updateTriggers(rt, triggers, 150, 1 / 60);
  close(groupState(rt, 5).dx, 100, 1e-6);
  assert.equal(rt.tweens.length, 0);
});
