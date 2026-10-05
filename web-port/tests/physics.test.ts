import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK, SPEEDS, GRAVITY, JUMP_VELOCITY, jumpApex, jumpAirtime, integrate, snapRotation, flipGravity, type CubeState, RAW_VELOCITY, quantizeVelocity, advanceX, advanceY,
} from "../src/gd/physics.ts";

const fresh = (): CubeState => ({
  x: 0, y: 15, yVel: 0, onGround: true, rotation: 0, gravityFlipped: false,
});

test("normal speed matches the documented 311.58 units/second", () => {
  // this is the value that pins the whole 60 Hz unit conversion
  assert.equal(SPEEDS[1], 311.58);
  // and the original's per-frame x velocity reproduces it
  assert.ok(Math.abs(5.770002 * 0.9 * 60 - SPEEDS[1]) < 0.001);
});

test("a cube jump clears a 4-block gap and peaks just over 2 blocks", () => {
  const apexBlocks = jumpApex() / BLOCK;
  const spanBlocks = (jumpAirtime() * SPEEDS[1]) / BLOCK;
  assert.ok(apexBlocks > 2 && apexBlocks < 2.5, `apex was ${apexBlocks.toFixed(2)} blocks`);
  assert.ok(spanBlocks > 4 && spanBlocks < 5, `span was ${spanBlocks.toFixed(2)} blocks`);
});

test("simulating a jump reproduces the closed-form apex", () => {
  const s = fresh();
  const dt = 1 / 240;
  let peak = s.y;
  // hold for the first step only, then release
  integrate(s, dt, SPEEDS[1], true);
  for (let i = 0; i < 240 && s.yVel > 0; i++) {
    integrate(s, dt, SPEEDS[1], false);
    peak = Math.max(peak, s.y);
  }
  const rise = peak - 15;
  assert.ok(Math.abs(rise - jumpApex()) < 2, `rise ${rise.toFixed(2)} vs apex ${jumpApex().toFixed(2)}`);
});

test("holding does nothing while airborne", () => {
  const s = fresh();
  integrate(s, 1 / 240, SPEEDS[1], true);
  const velAfterJump = s.yVel;
  assert.ok(!s.onGround);
  integrate(s, 1 / 240, SPEEDS[1], true);
  // still just falling under gravity, no second impulse
  assert.ok(s.yVel < velAfterJump);
});

test("gravity and jump velocity keep their documented values", () => {
  assert.ok(Math.abs(GRAVITY - 0.958199 * 2916) < 0.5);
  assert.ok(Math.abs(JUMP_VELOCITY - 11.180032 * 54) < 0.5);
});

test("rotation snaps to quarter turns", () => {
  assert.equal(snapRotation(0), 0);
  assert.equal(snapRotation(44), 0);
  assert.equal(snapRotation(46), 90);
  assert.equal(snapRotation(179), 180);
  assert.equal(snapRotation(-100), -90);
});

test("a gravity flip halves the vertical velocity, and only on a real change", () => {
  // `PlayerObject::flipGravity` does `m_dYVel /= 2.f` inside an
  // `if (m_bGravityFlipped != gravity)` guard. Every gravity change in the game
  // goes through it — portals, the blue/green orbs, the gravity pad, the ball.
  // Without the halving a gravity portal carried the player's full speed
  // through and threw it about twice as far as it should go.
  const s = { x: 0, y: 0, yVel: 600, onGround: false, rotation: 0, gravityFlipped: false };
  flipGravity(s, true);
  assert.equal(s.gravityFlipped, true);
  assert.equal(s.yVel, 300);

  // flipping to the state it is already in must not touch the velocity,
  // otherwise re-entering the same portal would keep shaving speed off
  flipGravity(s, true);
  assert.equal(s.yVel, 300);

  flipGravity(s, false);
  assert.equal(s.yVel, 150);
});

test("the velocity snap is round-to-nearest-0.001 raw, ties away from zero", () => {
  // `PlayerObject::updateJump` +0x53c. It is what turns a 0.2155948 gravity
  // step into the 0.216 the recordings actually show.
  const raw = (v: number) => v * RAW_VELOCITY;
  assert.equal(quantizeVelocity(raw(11.1804)), raw(11.18));
  assert.equal(quantizeVelocity(raw(-11.1804)), raw(-11.18));
  assert.ok(Math.abs(quantizeVelocity(raw(0.0005)) - raw(0.001)) < 1e-12);
  assert.ok(Math.abs(quantizeVelocity(raw(-0.0005)) - raw(-0.001)) < 1e-12);
  // one gravity step lands on 0.216 every time, which is the whole point
  const step = quantizeVelocity(-GRAVITY / 240);
  assert.ok(Math.abs(step / RAW_VELOCITY + 0.216) < 1e-12, `${step / RAW_VELOCITY}`);
  assert.ok(Math.abs(step * 240 + 2799.36) < 1e-9);
});

test("positions advance in float32, the way cocos2d stores them", () => {
  // the real run gains on exact arithmetic because of this, ~12 units a level
  let x = 28050.998046875;
  for (let i = 0; i < 10; i++) x = advanceX(x, 311.58 / 240);
  assert.equal(x, Math.fround(x), "still a float32");
  assert.ok(x > 28050.998046875 + 10 * (311.58 / 240), "and running ahead of double");
  // y rounds at the game's magnitude, not ours, and round-trips exactly
  const y = advanceY(300, 0);
  assert.equal(y, 300);
});
