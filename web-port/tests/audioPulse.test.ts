// The music pulse (audio scale) — `AudioEffectsLayer` and
// `FMODAudioEngine::updateMetering`, decoded from the 2.2081 binary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioEffects, AUDIO_SCALE, audioScaleFactor, newPulse, stepPulse } from "../src/gd/audioPulse.ts";
import { AUDIO_STRINGS } from "../src/gd/audioStrings.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test("a beat rises to scale + 0.2·mapped in 0.05 s, then falls to 0.1 over 0.2 s", () => {
  const fx = new AudioEffects("0.10~1.00");
  assert.equal(fx.value, 0.1);            // at rest
  fx.step(0.05);                          // clock 0.05: the pair is not due
  assert.equal(fx.value, 0.1);
  fx.step(0.1);                           // clock 0.15: 1.00 → 4 → min(0.1 + 0.8, 1.1)
  fx.step(0.05);                          // the 0.05 s rise completes
  near(fx.value, 0.9);
  fx.step(0.1);                           // halfway down
  near(fx.value, 0.5);
  fx.step(0.2);
  near(fx.value, 0.1);
});

test("the pulse table maps 0.9 → 3 and 0.8 → 2.5 and caps at 1.1", () => {
  const a = new AudioEffects("0.01~0.80");
  a.step(0.02); a.step(0.05);
  near(a.value, 0.1 + 2.5 * 0.2);
  const b = new AudioEffects("0.01~0.90");
  b.step(0.02); b.step(0.05);
  near(b.value, 0.1 + 3 * 0.2);
  const c = new AudioEffects("0.01~1.00~0.02~1.00");
  c.step(0.015); c.step(0.01); c.step(0.05);
  assert.ok(c.value <= 1.1 + 1e-9);
});

test("one pair per step; practice spends pairs without beating", () => {
  const fx = new AudioEffects("0.01~1.00~0.02~1.00");
  fx.step(1, true);
  assert.equal(fx.value, 0.1);
  fx.step(0.001, true);                   // the second pair, also spent
  fx.step(0.1);
  assert.equal(fx.value, 0.1);
});

test("seek rewinds to rest and skips the pairs already past", () => {
  const fx = new AudioEffects("0.10~1.00~0.50~1.00");
  fx.step(0.2); fx.step(0.02);
  assert.ok(fx.value > 0.1);
  fx.seek(0.3);
  assert.equal(fx.value, 0.1);
  fx.step(0.1);                           // clock 0.4: 0.5 not due yet
  assert.equal(fx.value, 0.1);
  fx.step(0.2); fx.step(0.05);
  near(fx.value, 0.9);
});

test("updateMetering: a new peak starts a beat at 1.1×, otherwise 0.93 decay", () => {
  const s = newPulse();
  stepPulse(s, 0.5); stepPulse(s, 0.5); stepPulse(s, 0.5);   // counter warms up
  stepPulse(s, 0.8);
  near(s.p1, Math.fround(Math.fround(0.8) * Math.fround(1.1)), 1e-6);
  assert.equal(s.n, 1);
  const before = s.p1;
  stepPulse(s, 0);
  near(s.p1, Math.fround(before * Math.fround(0.93)), 1e-6);
});

test("the audio-scale ids and their custom ranges", () => {
  assert.equal(AUDIO_SCALE.size, 29);
  assert.equal(AUDIO_SCALE.get(36), null);                    // yellow orb: the raw pulse
  assert.deepEqual(AUDIO_SCALE.get(132), [0.8, 1.2]);
  near(audioScaleFactor([0.8, 1.2], 0.1), 0.8);
  near(audioScaleFactor([0.8, 1.2], 1.1), 1.2);
  near(audioScaleFactor(null, 0.7), 0.7);
  // orbs (RingObject::setRScale): +0.3, capped at 1.2
  near(audioScaleFactor(null, 0.1, true), 0.4);
  near(audioScaleFactor(null, 1.1, true), 1.2);
});

test("every official song but Dash has an audio string", () => {
  for (let song = 0; song <= 20; song++) assert.ok(AUDIO_STRINGS[song]?.length > 0, `song ${song}`);
  assert.equal(AUDIO_STRINGS[21], undefined);
});
