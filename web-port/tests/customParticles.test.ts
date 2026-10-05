// Custom particle object 2065: key 145 decoding (`particleStringToStruct`,
// m1 0x44e1b4) and GD's own particle rules (`initParticle` m1 0x6cdaa0,
// `update` m1 0x6ce94c, `updateQuadWithParticle` m1 0x52aa70).
import { test } from "node:test";
import assert from "node:assert/strict";
import { customParticleConfig, parseParticleString, particleTextureName } from "../src/gd/customParticles.ts";
import { CCEmitter } from "../src/engine/ccparticles.ts";

// a real Dash string (x 2329: the green guide arrow)
const DASH = "10a0.51a1a0.3a115a90a0a451a227a70a0a0a0a0a0a0a0a20a7a0a0a1a0a0.933333a0a0a0a1a0a-1a1a0a0a1a0a0a0a0a0a1a0a0a0a0.2a0a0a0a0a0a0a0a0a2a1a1a0a0a34a0a5.28a0.95a0a0";

test("the 63 fields land in ParticleStruct order", () => {
  const s = parseParticleString(DASH)!;
  assert.equal(s.totalParticles, 10);
  assert.equal(s.duration, 0.51);
  assert.equal(s.life, 1);
  assert.equal(s.lifeVar, 0.3);
  assert.equal(s.emissionRate, 115);
  assert.equal(s.angle, 90);
  assert.equal(s.speed, 451);
  assert.equal(s.speedVar, 227);
  assert.equal(s.posVarX, 70);
  assert.equal(s.startSize, 20);
  assert.equal(s.startSizeVar, 7);
  assert.deepEqual(s.start, [1, 0, 0.933333, 0, 0, 0, 1, 0]);
  assert.equal(s.endSize, -1);
  assert.equal(s.fadeOut, 0.2);
  assert.equal(s.positionType, 2);
  assert.equal(s.additive, true);
  assert.equal(s.startSpinEqualToEndSpin, true);
  assert.equal(s.textureIndex, 34);
  assert.equal(s.frictionPos, 5.28);
  assert.equal(s.frictionPosVar, 0.95);
  assert.equal(particleTextureName(s.textureIndex), "particle_34_001.png");
});

test("short strings are refused", () => {
  assert.equal(parseParticleString("10a1a2"), null);
  assert.equal(customParticleConfig(undefined), null);
});

const seq = (v: number) => () => v; // rand() constant: r11() = 2v − 1

test("GD rules: explicit emission rate, life floor, end size without the −1 case", () => {
  const made = customParticleConfig(DASH)!;
  const e = new CCEmitter(made.cfg, seq(0)); // r11 = −1
  assert.equal(e.emissionRate, 115);
  e.update(1 / 100);
  assert.equal(e.count, 1);
  // size 20 − 7 = 13 shrinking to max(0, −1 − 1) = 0 over life 1 − 0.3
  let size = -1;
  e.forEach((q) => { size = q.size; });
  assert.ok(size < 13 && size > 12, `size ${size}`);
});

test("fade in and fade out scale the opacity", () => {
  const { cfg } = customParticleConfig(DASH)!;
  Object.assign(cfg, { life: 1, lifeVar: 0, maxParticles: 1, startColor: [1, 1, 1, 1], startColorVar: [0, 0, 0, 0],
    endColor: [1, 1, 1, 1], endColorVar: [0, 0, 0, 0] });
  cfg.gd = { ...cfg.gd!, emissionRate: 1000, fadeIn: 0.2, fadeInVar: 0, fadeOut: 0.2, fadeOutVar: 0,
    frictionPos: 0, frictionPosVar: 0 };
  const e = new CCEmitter(cfg, seq(0.5));
  const alpha = () => { let a = -1; e.forEach((q) => { a = q.a; }); return a; };
  e.update(0.0011); // born
  e.update(0.1);    // age 0.1 of a 0.2 fade-in
  assert.ok(Math.abs(alpha() - 0.5) < 0.01, `in ${alpha()}`);
  e.update(0.5);    // age 0.6: full
  assert.ok(Math.abs(alpha() - 1) < 1e-6);
  e.update(0.3);    // 0.1 left of a 0.2 fade-out
  assert.ok(Math.abs(alpha() - 0.5) < 0.02, `out ${alpha()}`);
});

test("friction slows the particle by 1 − f·dt a step", () => {
  const { cfg } = customParticleConfig(DASH)!;
  Object.assign(cfg, { life: 10, lifeVar: 0, maxParticles: 1, speed: 100, speedVar: 0, angle: 0, angleVar: 0,
    posVarX: 0, posVarY: 0 });
  cfg.gd = { ...cfg.gd!, emissionRate: 1000, frictionPos: 1, frictionPosVar: 0, fadeIn: 0, fadeOut: 0 };
  const e = new CCEmitter(cfg, seq(0.5));
  e.positionType = "grouped";
  const x = () => { let v = 0; e.forEach((q) => { v = q.x; }); return v; };
  e.update(0.0011);
  const x0 = x();
  e.update(0.1);
  const x1 = x();
  e.update(0.1);
  const x2 = x();
  // speed 100 → 90 after the first step's friction, so the second step is 9
  assert.ok(Math.abs((x1 - x0) - 10) < 0.2, `${x1 - x0}`);
  assert.ok(Math.abs((x2 - x1) - 9) < 0.2, `${x2 - x1}`);
});
