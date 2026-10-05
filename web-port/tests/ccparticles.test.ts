// The cocos2d-x particle engine and motion streak (src/engine/ccparticles.ts,
// src/engine/streak.ts), checked against the stock engine's arithmetic and the
// game's own plists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parsePlist } from "../src/engine/plist.ts";
import { CCEmitter, particleConfigFromPlist, type ParticleConfig } from "../src/engine/ccparticles.ts";
import { MotionStreak } from "../src/engine/streak.ts";

const close = (a: number, b: number, eps = 1e-4) =>
  assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

const RES = new URL("../../steam-gd/Resources/", import.meta.url);
const plist = (name: string) =>
  particleConfigFromPlist(parsePlist(readFileSync(new URL(name, RES), "utf8")) as Record<string, unknown>);
const haveRes = existsSync(new URL("dragEffect.plist", RES));

/**
 * One particle at a time: the stock engine waits `1 / emissionRate` before
 * its first emission, so a long-lived single particle would never be born
 * within a test; forcing the rate up makes the first update emit it.
 */
function single(c: ParticleConfig, rand = () => 0.5): CCEmitter {
  const e = new CCEmitter(c, rand);
  e.emissionRate = 1e6;
  return e;
}

function cfg(over: Partial<ParticleConfig> = {}): ParticleConfig {
  return {
    texture: "square.png", mode: "gravity", maxParticles: 10, duration: -1,
    life: 1, lifeVar: 0, angle: 0, angleVar: 0, posVarX: 0, posVarY: 0,
    sourceX: 0, sourceY: 0, startSize: 4, startSizeVar: 0, endSize: 0, endSizeVar: 0,
    startColor: [1, 1, 1, 1], startColorVar: [0, 0, 0, 0],
    endColor: [0, 0, 0, 1], endColorVar: [0, 0, 0, 0],
    startSpin: 0, startSpinVar: 0, endSpin: 0, endSpinVar: 0,
    gravityX: 0, gravityY: 0, speed: 100, speedVar: 0,
    radialAccel: 0, radialAccelVar: 0, tangentialAccel: 0, tangentialAccelVar: 0,
    rotationIsDir: false, startRadius: 0, startRadiusVar: 0, endRadius: 0,
    endRadiusVar: 0, rotatePerSecond: 0, rotatePerSecondVar: 0, additive: true,
    ...over,
  };
}

test("the shipped dragEffect plist reads as the stock engine would", { skip: !haveRes }, () => {
  const c = plist("dragEffect.plist");
  assert.equal(c.mode, "gravity");
  assert.equal(c.maxParticles, 30);
  assert.equal(c.duration, -1);
  close(c.life, 0.3);
  close(c.gravityY, -300);
  close(c.speed, 75);
  assert.equal(c.additive, true);
  assert.equal(c.texture, "square.png");
  // portal particles orbit in (radius mode), 40 → 0
  const p = plist("portalEffect01.plist");
  assert.equal(p.mode, "radius");
  close(p.startRadius, 40);
  close(p.endRadius, 0);
});

test("emission rate is maxParticles / life, and a zero life is a burst", () => {
  const e = new CCEmitter(cfg({ maxParticles: 10, life: 1 }), () => 0.5);
  assert.equal(e.emissionRate, 10);
  e.update(0.35);
  assert.equal(e.count, 3);
  // landEffect / explodeEffect: lifespan 0 → the whole budget on the first update
  const b = new CCEmitter(cfg({ maxParticles: 10, life: 0, lifeVar: 0.6, duration: 0.02 }), () => 1);
  b.update(1 / 60);
  assert.equal(b.count, 10);
  // and the duration then stops it
  b.update(1 / 60);
  assert.equal(b.active, false);
});

test("a gravity-mode particle integrates velocity and gravity per step", () => {
  const e = single(cfg({ maxParticles: 1, life: 10, speed: 100, angle: 90, gravityY: -100 }));
  e.update(0.1);            // born with dir (0, 100) — and integrated once
  e.update(0.1);            // dir += (0, -10); pos += dir * dt
  const pts: number[] = [];
  e.forEach((p) => { pts.push(p.x, p.y); });
  // step 1: dir 100 − 10 = 90, pos 9; step 2: dir 80, pos 9 + 8 = 17
  close(pts[0], 0);
  close(pts[1], 17);
});

test("free particles stay where they were born; grouped ones ride the emitter", () => {
  const mk = (type: "free" | "grouped") => {
    const e = single(cfg({ maxParticles: 1, life: 10, speed: 0 }));
    e.positionType = type;
    e.x = 100;
    e.update(0.2);
    e.x = 300;
    let x = 0;
    e.forEach((p) => { x = p.x; });
    return x;
  };
  close(mk("free"), 100);
  close(mk("grouped"), 300);
});

test("radius mode orbits in from the start radius", () => {
  const e = single(cfg({
    mode: "radius", maxParticles: 1, life: 1, startRadius: 40, endRadius: 0, angle: 0,
  }));
  e.update(0.01);
  let r0 = 0;
  e.forEach((p) => { r0 = Math.hypot(p.x, p.y); });
  e.update(0.5);
  let r1 = 0;
  e.forEach((p) => { r1 = Math.hypot(p.x, p.y); });
  assert.ok(r0 > 38 && r1 < 22, `${r0} → ${r1}`);
});

test("colours run from start to end over the lifetime", () => {
  const e = single(cfg({ maxParticles: 1, life: 1, speed: 0 }));
  e.update(0.2);
  e.update(0.3);
  let r = 0;
  e.forEach((p) => { r = p.r; });
  close(r, 0.5, 0.02);
});

test("stop halts emission, reset kills live particles, resume restarts", () => {
  const e = new CCEmitter(cfg({ maxParticles: 5, life: 1 }), () => 0.5);
  e.update(0.5);
  const n = e.count;
  e.stop();
  e.update(0.3);
  assert.equal(e.count, n);
  e.reset();
  e.update(0.001);
  assert.ok(e.count <= 1);
});

test("a motion streak appends points past minSeg and fades them", () => {
  const s = new MotionStreak(0.3, 5, 10);
  assert.equal(s.maxPoints, 20);
  s.setPosition(0, 0); s.update(1 / 60);
  s.setPosition(2, 0); s.update(1 / 60);   // under minSeg: no point
  assert.equal(s.count, 1);
  s.setPosition(10, 0); s.update(1 / 60);
  s.setPosition(20, 0); s.update(1 / 60);
  assert.equal(s.count, 3);
  // the ribbon is `stroke` wide across the direction of travel
  const pairs: number[] = [];
  s.forEachPair((p) => { pairs.push(Math.abs(p.y0 - p.y1)); });
  close(pairs[2], 10);
  // everything is gone after `fade`
  for (let i = 0; i < 30; i++) s.update(1 / 60);
  assert.equal(s.count, 1);
});
