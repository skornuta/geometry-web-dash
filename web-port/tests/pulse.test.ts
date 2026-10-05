// Pulse triggers (1006) — 1,186 of them across L19-22, 835 aimed at a colour
// channel and 351 at a group.
//
// Sourced from the shipping 2.2081 binary:
//   PulseEffectAction::valueForDelta 0x273a74 / ::step 0x273a04
//     t < fadeIn            -> t / fadeIn
//     fadeIn + hold >= t    -> 1
//     fadeOut <= 0          -> 0
//     otherwise             -> 1 - (t - fadeIn - hold) / fadeOut
//   GJEffectManager::getMixedColor 0x28475c
//     out = a * ratio + b * (1 - ratio), clamped to 0..255 and TRUNCATED,
//     so the pulse colour is the argument the ratio favours.
//   GJBaseGameLayer::triggerObject 0x1734c4 passes +0x638/+0x63c/+0x640 as the
//     three floats, +0x5b8 as the target, (+0x648 == 1) as target-is-group,
//     +0x64c/+0x65c as the copy HSV and copy channel, and +0x661..+0x663 as
//     mainOnly / detailOnly / exclusive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Level } from "../src/gd/level.ts";
import {
  buildTriggers, cloneRuntime, createRuntime, pulseValue, resetRuntime,
  resolveColor, restoreRuntime, updateTriggers, applyGroupPulses,
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
const base = (rt: ReturnType<typeof createRuntime>, ch: number, r: number, g: number, b: number) =>
  rt.colors.set(ch, {
    r, g, b, opacity: 1, blending: false,
    copyChannel: 0, copyHSV: { h: 0, s: 0, v: 0, sAbsolute: false, vAbsolute: false },
    copyOpacity: false,
  });

test("the pulse curve ramps in, holds at 1, then ramps out", () => {
  const v = (t: number) => pulseValue(t, 0.5, 1, 0.5);
  assert.equal(v(0), 0);
  assert.equal(v(0.25), 0.5);
  assert.equal(v(0.5), 1);
  assert.equal(v(1.5), 1);
  assert.equal(v(1.75), 0.5);
  assert.equal(v(2), 0);
});

test("a zero fade-in starts at full strength instead of dividing by zero", () => {
  assert.equal(pulseValue(0, 0, 0.1, 0.5), 1);
  assert.equal(pulseValue(0.05, 0, 0.1, 0.5), 1);
});

test("a zero fade-out drops straight to zero once the hold ends", () => {
  assert.equal(pulseValue(0.2, 0, 0.1, 0), 0);
});

test("a channel pulse mixes toward its colour and then back", () => {
  // fade in 0, hold 1, fade out 1 -> full pulse for the first second
  const level = fakeLevel([{ id: 1006, x: 100,
    props: { 51: "7", 46: "1", 47: "1", 7: "0", 8: "0", 9: "255" } }]);
  const rt = createRuntime(level);
  base(rt, 7, 255, 0, 0);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 150, 0);
  assert.deepEqual(pick(resolveColor(rt, 7)), [0, 0, 255]);
  updateTriggers(rt, triggers, 150, 1.5); // half way through the fade out
  assert.deepEqual(pick(resolveColor(rt, 7)), [127, 0, 127]);
  updateTriggers(rt, triggers, 150, 1); // finished
  assert.deepEqual(pick(resolveColor(rt, 7)), [255, 0, 0]);
});

const pick = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b];

test("a pulse rides on top of the channel, so a colour trigger under it still shows", () => {
  const level = fakeLevel([
    { id: 1006, x: 100, props: { 51: "7", 46: "10", 7: "255", 8: "255", 9: "255" } },
    { id: 899, x: 200, props: { 23: "7", 7: "0", 8: "255", 9: "0" } },
  ]);
  const rt = createRuntime(level);
  base(rt, 7, 255, 0, 0);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 250, 0);
  // the pulse is at full strength, so white wins on screen ...
  assert.deepEqual(pick(resolveColor(rt, 7)), [255, 255, 255]);
  // ... but the channel underneath took the trigger's green
  assert.deepEqual([rt.colors.get(7)!.r, rt.colors.get(7)!.g], [0, 255]);
  updateTriggers(rt, triggers, 250, 20);
  assert.deepEqual(pick(resolveColor(rt, 7)), [0, 255, 0]);
});

test("HSV mode bends the channel's own colour instead of using an RGB", () => {
  const level = fakeLevel([{ id: 1006, x: 100,
    props: { 51: "7", 46: "10", 48: "1", 49: "120a1a1a0a0" } }]);
  const rt = createRuntime(level);
  base(rt, 7, 255, 0, 0);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  assert.deepEqual(pick(resolveColor(rt, 7)), [0, 255, 0]);
});

test("a pulse can take its colour from another channel", () => {
  const level = fakeLevel([{ id: 1006, x: 100, props: { 51: "7", 46: "10", 50: "3" } }]);
  const rt = createRuntime(level);
  base(rt, 7, 255, 0, 0);
  base(rt, 3, 10, 20, 30);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  assert.deepEqual(pick(resolveColor(rt, 7)), [10, 20, 30]);
});

test("an exclusive pulse cancels the ones already on its target", () => {
  const level = fakeLevel([
    { id: 1006, x: 100, props: { 51: "7", 46: "10", 7: "255", 8: "255", 9: "255" } },
    { id: 1006, x: 200, props: { 51: "7", 46: "10", 86: "1", 7: "0", 8: "0", 9: "255" } },
  ]);
  const rt = createRuntime(level);
  base(rt, 7, 255, 0, 0);
  updateTriggers(rt, buildTriggers(level), 250, 0);
  assert.equal(rt.pulses.length, 1);
  assert.deepEqual(pick(resolveColor(rt, 7)), [0, 0, 255]);
});

test("a pulse only touches the channel it names", () => {
  const level = fakeLevel([{ id: 1006, x: 100,
    props: { 51: "7", 46: "10", 7: "0", 8: "0", 9: "255" } }]);
  const rt = createRuntime(level);
  base(rt, 7, 255, 0, 0);
  base(rt, 8, 255, 0, 0);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  assert.deepEqual(pick(resolveColor(rt, 8)), [255, 0, 0]);
});

test("a group-targeted pulse leaves the same-numbered colour channel alone", () => {
  const level = fakeLevel([{ id: 1006, x: 100,
    props: { 51: "7", 52: "1", 46: "10", 7: "0", 8: "0", 9: "255" } }]);
  const rt = createRuntime(level);
  base(rt, 7, 255, 0, 0);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  assert.deepEqual(pick(resolveColor(rt, 7)), [255, 0, 0]);
});

test("pulses survive clone/restore and are cleared by reset", () => {
  const level = fakeLevel([{ id: 1006, x: 100,
    props: { 51: "7", 46: "10", 7: "0", 8: "0", 9: "255" } }]);
  const rt = createRuntime(level);
  base(rt, 7, 255, 0, 0);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  const snap = cloneRuntime(rt);
  updateTriggers(rt, buildTriggers(level), 150, 5);
  snap.pulses[0].t = 99; // the clone must be independent
  assert.notEqual(rt.pulses[0]?.t, 99);
  restoreRuntime(rt, snap);
  assert.equal(rt.pulses[0].t, 99);
  resetRuntime(rt, level);
  assert.equal(rt.pulses.length, 0);
});

// --- group-targeted pulses (351 of the 1,186) ---

test("a group pulse tints only objects in the group it names", () => {
  const level = fakeLevel([{ id: 1006, x: 100,
    props: { 51: "9", 52: "1", 46: "10", 7: "0", 8: "0", 9: "255" } }]);
  const rt = createRuntime(level);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  const red = { r: 255, g: 0, b: 0 };
  assert.deepEqual(pick(applyGroupPulses(rt, [9], false, red)), [0, 0, 255]);
  assert.deepEqual(pick(applyGroupPulses(rt, [8], false, red)), [255, 0, 0]);
  assert.deepEqual(pick(applyGroupPulses(rt, [], false, red)), [255, 0, 0]);
});

test("main-only and detail-only pick which of an object's two colours pulses", () => {
  const level = fakeLevel([
    { id: 1006, x: 100, props: { 51: "9", 52: "1", 46: "10", 65: "1", 7: "0", 8: "255", 9: "0" } },
    { id: 1006, x: 100, props: { 51: "10", 52: "1", 46: "10", 66: "1", 7: "0", 8: "0", 9: "255" } },
  ]);
  const rt = createRuntime(level);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  const red = { r: 255, g: 0, b: 0 };
  assert.deepEqual(pick(applyGroupPulses(rt, [9], false, red)), [0, 255, 0]);
  assert.deepEqual(pick(applyGroupPulses(rt, [9], true, red)), [255, 0, 0]);
  assert.deepEqual(pick(applyGroupPulses(rt, [10], true, red)), [0, 0, 255]);
  assert.deepEqual(pick(applyGroupPulses(rt, [10], false, red)), [255, 0, 0]);
});

test("a group pulse in HSV mode bends the object's own colour", () => {
  const level = fakeLevel([{ id: 1006, x: 100,
    props: { 51: "9", 52: "1", 46: "10", 48: "1", 49: "120a1a1a0a0" } }]);
  const rt = createRuntime(level);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  assert.deepEqual(pick(applyGroupPulses(rt, [9], false, { r: 255, g: 0, b: 0 })), [0, 255, 0]);
});

test("a channel pulse never leaks onto a group with the same number", () => {
  const level = fakeLevel([{ id: 1006, x: 100,
    props: { 51: "9", 46: "10", 7: "0", 8: "0", 9: "255" } }]);
  const rt = createRuntime(level);
  updateTriggers(rt, buildTriggers(level), 150, 0);
  assert.deepEqual(pick(applyGroupPulses(rt, [9], false, { r: 255, g: 0, b: 0 })), [255, 0, 0]);
});
