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
  buildTriggers, cloneRuntime, createRuntime, pulseValue, reindexPulses, resetRuntime,
  resolveColor, restoreRuntime, updateTriggers, applyGroupPulses, type Pulse,
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

// --- the per-target lookups (`pulseIndex` / `groupPulseIndex`) ---

/**
 * An object can sit in two pulsed groups, and the two pulses have to mix in
 * **`rt.pulses` order**, not in group order — the lookups are keyed by target,
 * so the order has to be put back (`Pulse.seq`). The later pulse here sits on
 * the *earlier* group number, which is the case a group-ordered merge gets
 * wrong: it would give (0,0,255), the first pulse alone at full strength.
 */
test("two group pulses on one object mix in pulse order, not group order", () => {
  const level = fakeLevel([
    // fires first (x 100) but names the *later* group 10
    { id: 1006, x: 100, props: { 51: "10", 52: "1", 46: "10", 7: "0", 8: "255", 9: "0" } },
    // fires second (x 200), names group 9, and fades in over 2 s
    { id: 1006, x: 200, props: { 51: "9", 52: "1", 45: "2", 46: "10", 7: "0", 8: "0", 9: "255" } },
  ]);
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0);   // the group-10 pulse starts
  updateTriggers(rt, triggers, 200, 1);   // 1 s on; the group-9 pulse starts
  updateTriggers(rt, triggers, 200, 1);   // both are 1 s old: 1.0 and 0.5 strength
  assert.deepEqual(rt.pulses.map((p) => [p.target, p.seq]), [[10, 1], [9, 2]]);
  const red = { r: 255, g: 0, b: 0 };
  // green at full strength, then blue at half: (0, 127, 127)
  assert.deepEqual(pick(applyGroupPulses(rt, [9, 10], false, red)), [0, 127, 127]);
});

/**
 * The lookups are derived from `pulses`, so anything that replaces the array
 * has to rebuild them — a stale one shows up as a pulse that has expired (or
 * was never fired) still tinting its target after a checkpoint restore.
 */
test("the pulse lookups follow a restore, in both directions", () => {
  const level = fakeLevel([{ id: 1006, x: 100,
    props: { 51: "7", 46: "1", 7: "0", 8: "0", 9: "255" } }]);
  const rt = createRuntime(level);
  base(rt, 7, 255, 0, 0);
  const triggers = buildTriggers(level);

  const before = cloneRuntime(rt);          // nothing has fired yet
  updateTriggers(rt, triggers, 150, 0);
  assert.deepEqual(pick(resolveColor(rt, 7)), [0, 0, 255]);
  // a clone made while the pulse is live resolves it against its own copy
  const withPulse = cloneRuntime(rt);
  assert.deepEqual(pick(resolveColor(withPulse, 7)), [0, 0, 255]);

  // rewinding past the trigger must drop the pulse, not leave it indexed
  restoreRuntime(rt, before);
  assert.equal(rt.pulses.length, 0);
  assert.equal(rt.pulseIndex.size, 0);
  assert.deepEqual(pick(resolveColor(rt, 7)), [255, 0, 0]);

  // and restoring a snapshot that has it brings it back
  restoreRuntime(rt, withPulse);
  assert.deepEqual(pick(resolveColor(rt, 7)), [0, 0, 255]);
});

/**
 * The index is the whole point of G1: `resolveColor` used to walk every live
 * pulse on every call, which on Deadlocked (173 live pulses against ~19,500
 * objects) was 46 % of the frame's CPU. A ratio against the same work with no
 * pulses live, so the assertion does not depend on the machine's speed.
 */
test("resolving a colour does not walk the whole pulse list", () => {
  const rt = createRuntime(fakeLevel([]));
  base(rt, 7, 255, 0, 0);
  const time = (live: number) => {
    rt.pulses.length = 0;
    for (let i = 0; i < live; i++) {
      rt.pulses.push({
        target: 2000 + i, isGroup: false, fadeIn: 0, hold: 100, fadeOut: 0, t: 0, seq: i + 1,
        hsv: null, r: 0, g: 0, b: 0, copyChannel: 0, mainOnly: false, detailOnly: false,
      } as Pulse);
    }
    reindexPulses(rt);
    for (let i = 0; i < 4000; i++) resolveColor(rt, 7);   // let the JIT settle
    const t0 = performance.now();
    for (let i = 0; i < 20000; i++) resolveColor(rt, 7);
    return performance.now() - t0;
  };
  const none = Math.max(time(0), 0.5);
  const many = time(400);
  assert.ok(many < none * 6,
    `400 live pulses cost ${many.toFixed(2)} ms for 20,000 lookups, against ${none.toFixed(2)} ms with none`);
});
