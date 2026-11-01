// Tests for the particle pool and screen shake (M8).
//
// These are cosmetic systems, so what is worth pinning is not how they *look*
// but that they cannot misbehave during play: the pool must never grow or leak,
// emission must be frame-rate independent, and a shake must always decay back to
// exactly zero rather than leaving the camera permanently off-centre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ParticleSystem } from "../src/engine/particles.ts";
import {
  PlayerEffects, Shake, DEATH_SHAKE, EFFECT_PLISTS, particleColors, strongColor,
  type EffectLibrary, type EffectName, type PlayerView,
} from "../src/gd/effects.ts";
import type { Gamemode } from "../src/gd/gamemodes.ts";
import { readFileSync } from "node:fs";
import { parsePlist } from "../src/engine/plist.ts";
import { particleConfigFromPlist, type ParticleConfig } from "../src/engine/ccparticles.ts";

/** the effect plists as the browser would load them, from public/assets */
function effectLibraryFromDisk(): EffectLibrary {
  const m = new Map<EffectName, ParticleConfig>();
  for (const n of EFFECT_PLISTS) {
    const xml = readFileSync(new URL(`../public/assets/${n}.plist`, import.meta.url), "utf8");
    m.set(n, particleConfigFromPlist(parsePlist(xml) as Record<string, unknown>));
  }
  return m;
}

test("particles die exactly at the end of their life", () => {
  const ps = new ParticleSystem(16);
  ps.spawn(0, 0, {
    life: 1, vx: 0, vy: 0, ax: 0, ay: 0, size0: 4, size1: 0, r: 1, g: 1, b: 1,
    a0: 1, a1: 0, rot: 0, spin: 0, additive: false,
  });
  assert.equal(ps.liveCount, 1);
  ps.update(0.5);
  assert.equal(ps.liveCount, 1, "still alive halfway through");
  ps.update(0.6);
  assert.equal(ps.liveCount, 0, "gone once past its life");
});

test("the pool never exceeds its capacity, however hard it is pushed", () => {
  const ps = new ParticleSystem(32);
  const spec = {
    life: 1, vx: 0, vy: 0, ax: 0, ay: 0, size0: 4, size1: 0, r: 1, g: 1, b: 1,
    a0: 1, a1: 0, rot: 0, spin: 0, additive: false,
  };
  for (let i = 0; i < 500; i++) ps.spawn(0, 0, spec);
  assert.ok(ps.liveCount <= 32, `live ${ps.liveCount} <= capacity 32`);
  assert.equal(ps.capacity, 32, "capacity is fixed — the pool does not grow");
});

test("a particle interpolates size and alpha across its life", () => {
  const ps = new ParticleSystem(4);
  ps.spawn(0, 0, {
    life: 1, vx: 0, vy: 0, ax: 0, ay: 0, size0: 10, size1: 0, r: 1, g: 0, b: 0,
    a0: 1, a1: 0, rot: 0, spin: 0, additive: true,
  });
  ps.update(0.5);
  const seen: { size: number; a: number; additive: boolean }[] = [];
  ps.forEach((d) => seen.push({ size: d.size, a: d.a, additive: d.additive }));
  assert.equal(seen.length, 1);
  assert.ok(Math.abs(seen[0].size - 5) < 1e-6, "size is halfway");
  assert.ok(Math.abs(seen[0].a - 0.5) < 1e-6, "alpha is halfway");
  assert.equal(seen[0].additive, true);
});

test("velocity and acceleration actually move a particle", () => {
  const ps = new ParticleSystem(4);
  ps.spawn(0, 0, {
    life: 10, vx: 100, vy: 0, ax: 0, ay: -100, size0: 1, size1: 1,
    r: 1, g: 1, b: 1, a0: 1, a1: 1, rot: 0, spin: 0, additive: false,
  });
  ps.update(1);
  let pos = { x: 0, y: 0 };
  ps.forEach((d) => { pos = { x: d.x, y: d.y }; });
  assert.ok(Math.abs(pos.x - 100) < 1e-6, "moved by its x velocity");
  assert.ok(pos.y < 0, "pulled down by its acceleration");
});

test("clear empties the pool", () => {
  const ps = new ParticleSystem(64);
  for (let i = 0; i < 20; i++) {
    ps.spawn(0, 0, {
      life: 1, vx: 0, vy: 0, ax: 0, ay: 0, size0: 4, size1: 0, r: 1, g: 1, b: 1,
      a0: 1, a1: 0, rot: 0, spin: 0, additive: false,
    });
  }
  assert.ok(ps.liveCount > 0);
  ps.clear();
  assert.equal(ps.liveCount, 0);
});

const lib = effectLibraryFromDisk();

function view(mode: Gamemode, onGround: boolean, over: Partial<PlayerView> = {}): PlayerView {
  return { x: 100, y: 15, mode, onGround, gravityFlipped: false, mini: false, yVel: 0, ...over };
}

test("strongColor lifts a colour with no full channel by up to 1.5", () => {
  // GameToolbox::strongColor (m1 0x44b154)
  assert.deepEqual(strongColor([255, 10, 10]), [255, 10, 10]);
  assert.deepEqual(strongColor([100, 50, 0]), [150, 75, 0]);
  // float arithmetic truncated, as `fcvtzs` does: 200 · (255 / 200) lands just under 255
  assert.deepEqual(strongColor([200, 100, 50]), [254, 127, 63]);
  // a black colour 1 hands the particles colour 2
  assert.deepEqual(particleColors([0, 0, 0], [0, 255, 0]).a, [0, 255, 0]);
});

test("a grounded cube drags, an airborne one stops after 0.06 s", () => {
  const fx = new PlayerEffects(lib);
  fx.update(0.2, view("cube", true), false, false, 311);
  assert.ok(fx.drag.active && fx.drag.count > 0, "a grounded cube drags");
  fx.update(0.05, view("cube", false), false, false, 311);
  assert.ok(fx.drag.active, "still emitting inside the 0.06 s grace");
  fx.update(0.05, view("cube", false), false, false, 311);
  assert.equal(fx.drag.active, false, "and stopped after it");
});

test("the ship flames, and thrusts only while held", () => {
  const fx = new PlayerEffects(lib);
  fx.update(0.1, view("ship", false), false, false, 311);
  assert.ok(fx.flame.active, "the vehicle flame runs in a ship");
  assert.equal(fx.thrust.active, false);
  fx.update(0.1, view("ship", false), true, false, 311);
  assert.ok(fx.thrust.active, "holding thrusts");
  fx.update(0.1, view("cube", true), false, false, 311);
  assert.equal(fx.flame.active, false, "a cube has no flame");
});

test("a landing fires one of the two landing bursts, flipped with gravity", () => {
  const fx = new PlayerEffects(lib);
  fx.update(0.1, view("cube", false), false, false, 311);
  fx.update(1 / 60, view("cube", true), false, false, 311);
  // landEffect's whole budget of 10 fires at once; lifespan 0 ± 0.6 means the
  // ones born with no life die on that same update, as in the stock engine
  assert.ok(fx.land[0].count > 0 && fx.land[0].count <= 10, `a burst (${fx.land[0].count})`);
  fx.update(0.1, view("cube", false, { gravityFlipped: true }), false, false, 311);
  fx.update(1 / 60, view("cube", true, { gravityFlipped: true }), false, false, 311);
  assert.ok(fx.land[1].cfg.angle < 0, "the second burst points the other way");
});

test("the wave trail bends where the wave changes direction", () => {
  const fx = new PlayerEffects(lib);
  fx.update(0.1, view("wave", false, { yVel: 300 }), true, false, 311);
  fx.update(0.1, view("wave", false, { x: 130, y: 45, yVel: 300 }), true, false, 311);
  fx.update(0.1, view("wave", false, { x: 160, y: 75, yVel: -300 }), false, false, 311);
  assert.equal(fx.wave.count, 2, "a start point and one bend");
  let segs = 0;
  fx.wave.forEachSegment(() => { segs++; });
  assert.equal(segs, 2, "each point runs to the next, the last to the head");
});

test("an orb, a pad or a flip starts the streak; landing ends it", () => {
  const fx = new PlayerEffects(lib);
  fx.activateStreak();
  fx.update(0.02, view("cube", false, { x: 0 }), false, false, 311);
  fx.update(0.02, view("cube", false, { x: 20 }), false, false, 311);
  assert.ok(fx.streak.count >= 2, "the streak records points in the air");
  fx.update(0.02, view("cube", true, { x: 40 }), false, false, 311);
  const n = fx.streak.count;
  fx.update(0.02, view("cube", true, { x: 60 }), false, false, 311);
  assert.ok(fx.streak.count <= n, "and stops growing once the cube lands");
});

test("shake decays to exactly zero and leaves the camera centred", () => {
  const s = new Shake();
  s.add(DEATH_SHAKE);
  assert.ok(s.strength > 0);
  for (let i = 0; i < 200; i++) s.update(1 / 60);
  assert.equal(s.strength, 0, "strength lands on exactly zero");
  assert.equal(s.x, 0, "and the offset with it");
  assert.equal(s.y, 0);
});

test("two shakes at once take the stronger rather than summing", () => {
  const s = new Shake();
  s.add(5);
  s.add(9);
  assert.equal(s.strength, 9);
  s.add(3);
  assert.equal(s.strength, 9, "a weaker shake does not reduce a stronger one");
});

test("shake offsets stay within the current strength", () => {
  const s = new Shake();
  s.add(10);
  for (let i = 0; i < 40; i++) {
    s.update(1 / 60);
    assert.ok(Math.abs(s.x) <= 10 + 1e-9, `x within strength (${s.x})`);
    assert.ok(Math.abs(s.y) <= 10 + 1e-9, `y within strength (${s.y})`);
  }
});

test("reset clears a shake immediately", () => {
  const s = new Shake();
  s.add(DEATH_SHAKE);
  s.update(1 / 60);
  s.reset();
  assert.equal(s.strength, 0);
  assert.equal(s.x, 0);
  assert.equal(s.y, 0);
});

test("swingBurstEffect is loaded and fires alternating bursts on direction flip in swing mode", () => {
  const fx = new PlayerEffects(lib);
  assert.ok(fx.swingBurst, "swingBurst emitters created");
  assert.equal(fx.swingBurst.length, 2);
  assert.equal(fx.swingBurst[0].active, false);
  assert.equal(fx.swingBurst[1].active, false);

  // entering swing mode
  fx.update(0.02, view("swing", false, { x: 100, y: 150, gravityFlipped: false }), false, false, 311);
  assert.equal(fx.swingBurst[0].active, false);
  assert.equal(fx.swingBurst[1].active, false);

  // flipping gravity in swing mode fires first burst at the rear
  fx.update(0.02, view("swing", false, { x: 120, y: 160, gravityFlipped: true }), false, false, 311);
  assert.equal(fx.swingBurst[0].active, true);
  assert.equal(fx.swingBurst[0].x, 110, "placed at x - 10 * size");
  assert.equal(fx.swingBurst[1].active, false);

  // flipping back fires second alternating burst
  fx.update(0.02, view("swing", false, { x: 140, y: 155, gravityFlipped: false }), false, false, 311);
  assert.equal(fx.swingBurst[1].active, true);
  assert.equal(fx.swingBurst[1].x, 130);

  // constant gravity does not fire a new burst
  fx.tick(0.1);
  assert.equal(fx.swingBurst[0].active, false);
  assert.equal(fx.swingBurst[1].active, false);
  fx.update(0.02, view("swing", false, { x: 160, y: 150, gravityFlipped: false }), false, false, 311);
  assert.equal(fx.swingBurst[0].active, false);
  assert.equal(fx.swingBurst[1].active, false);

  // reset clears all
  fx.reset();
  assert.equal(fx.swingBurst[0].active, false);
  assert.equal(fx.swingBurst[1].active, false);
});

