import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PlayerEffects, EFFECT_PLISTS, type EffectName, type PlayerView } from "../src/gd/effects.ts";
import { parsePlist } from "../src/engine/plist.ts";
import { particleConfigFromPlist } from "../src/engine/ccparticles.ts";

const names = [...new Set<string>([...EFFECT_PLISTS, "dashEffect"])];
const lib = new Map(names.map((n) => [n as EffectName, particleConfigFromPlist(parsePlist(
  readFileSync(new URL(`../public/assets/${n}.plist`, import.meta.url), "utf8"),
) as Record<string, unknown>)]));
const player = (over = {}): PlayerView => ({ x: 100, y: 200, mode: "cube", mini: false,
  onGround: false, gravityFlipped: false, yVel: 0, dash: 1, dashSlope: 0,
  sideways: false, reversed: false, ...over });
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("dash plist is loaded and copied for clean installations", () => {
  assert.ok(names.includes("dashEffect"));
  assert.ok((EFFECT_PLISTS as readonly string[]).includes("dashEffect"));
  assert.match(readFileSync(new URL("../scripts/copy-assets.mjs", import.meta.url), "utf8"), /"dashEffect"/);
});

test("persistent dash emitter starts, stops without killing live particles, resumes and resets", () => {
  const fx = new PlayerEffects(lib);
  assert.equal(fx.dash.active, false);
  assert.equal(fx.dash.positionType, "relative");
  assert.equal(fx.dash.emissionRate, 50 / lib.get("dashEffect")!.life,
    "use the shipped float32 lifetime rather than rounding it to .4");
  fx.update(0.05, player(), false, false, 311.58);
  assert.equal(fx.dash.active, true);
  assert.ok(fx.dash.count > 0);
  const n = fx.dash.count;
  fx.update(0, player({ dash: 0 }), false, false, 311.58);
  assert.equal(fx.dash.active, false);
  assert.equal(fx.dash.count, n);
  fx.update(0.01, player({ dash: 2 }), false, false, 311.58);
  assert.equal(fx.dash.active, true);
  fx.stopAll();
  assert.equal(fx.dash.active, false);
  fx.tick(1);
  assert.equal(fx.dash.count, 0);
  fx.update(0.05, player(), false, false, 311.58);
  fx.reset();
  assert.equal(fx.dash.count, 0);
  assert.equal(fx.dash.active, false);
});

test("dash emitter uses world position and transformed relative angle, without double-flipping slope", () => {
  const fx = new PlayerEffects(lib);
  for (const sideways of [false, true]) for (const reversed of [false, true]) {
    fx.update(0, player({ sideways, reversed, dashSlope: 1, gravityFlipped: true, mini: true }), false, false, 311.58);
    assert.equal(fx.dash.x, 100);
    assert.equal(fx.dash.y, 200);
    const dx = sideways ? 1 : reversed ? -1 : 1;
    const dy = sideways ? reversed ? -1 : 1 : 1;
    near(fx.dash.rotation, -Math.atan2(dy, dx) * 180 / Math.PI);
    near(fx.dash.scale, 0.6);
    assert.equal(fx.dash.cfg.angle, 180, "node rotation composes with the relative backwards spray");
  }
});

test("dash colors override both plist endpoints and belong to each player", () => {
  const a = new PlayerEffects(lib), b = new PlayerEffects(lib);
  a.setColors([255, 0, 0], [0, 255, 0]);
  a.setDashColor([0, 0, 100]);
  assert.deepEqual(a.dash.cfg.startColor, [0, 0, 150 / 255, 1]);
  assert.deepEqual(a.dash.cfg.endColor, [0, 0, 150 / 255, 0.5]);
  assert.notDeepEqual(a.dash.cfg.startColor, b.dash.cfg.startColor);
  a.update(0.05, player(), false, false, 311.58);
  assert.equal(b.dash.count, 0);
  const count = a.dash.count, elapsed = a.dash.elapsed;
  a.update(0, player(), false, false, 311.58);
  assert.equal(a.dash.count, count);
  assert.equal(a.dash.elapsed, elapsed);
});

test("relative dash particles actually spray backwards through the sideways frame", () => {
  const fx = new PlayerEffects(lib);
  fx.dash.cfg.posVarY = 0;
  fx.dash.cfg.speedVar = 0;
  fx.dash.cfg.lifeVar = 0;
  fx.update(0.05, player({ sideways: true, dashSlope: 1 }), false, false, 311.58);
  let count = 0;
  fx.dash.forEach((p) => {
    count++;
    near(p.x, 100 - 1.25 * Math.SQRT1_2);
    near(p.y, 200 - 1.25 * Math.SQRT1_2);
  });
  assert.ok(count > 0);
  fx.update(0, player({ dash: 0, x: 900, y: 900 }), false, false, 311.58);
  fx.dash.forEach((p) => assert.ok(p.x < 100 && p.y < 200, "stopped relative particles retain their birth positions"));
});

test("dash suppresses ordinary streak even for flying modes and orb activation", () => {
  const fx = new PlayerEffects(lib);
  fx.activateStreak();
  fx.update(0.02, player({ mode: "ship" }), false, false, 311.58);
  fx.update(0.02, player({ mode: "ship", x: 120 }), false, false, 311.58);
  assert.equal(fx.streak.count, 0);
});
