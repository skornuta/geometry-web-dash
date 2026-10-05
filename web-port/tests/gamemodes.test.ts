import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRAVITY, JUMP_VELOCITY, SPEEDS, quantizeVelocity, speedConstants,
} from "../src/gd/physics.ts";
import {
  freshPlayer, stepPlayer, setGamemode, ROBOT_HOLD_MAX, type PlayerState,
} from "../src/gd/gamemodes.ts";
import { activateOrb, activatePad, applyPortal } from "../src/gd/interactives.ts";

const DT = 1 / 240;
/** orb launches land on the 0.001-raw grid (0.054 u/s), so compare within half a step */
const ORB_GRID = 0.027;
const SPEED = SPEEDS[1];

/** a player with the button already pressed — `queuedHold`/`justHeld` live */
const playerAt = (mode: PlayerState["mode"], over: Partial<PlayerState> = {}): PlayerState => ({
  ...freshPlayer(0, 15), mode, queuedHold: true, justHeld: true, ...over,
});

// A press is always accompanied by `holding`; what distinguishes a fresh press
// from a stale hold is now the player's own `queuedHold` / `justHeld`.
const HOLD = { holding: true, onOrb: false };
const TAP = { holding: true, onOrb: false };
const IDLE = { holding: false, onOrb: false };

test("ship: holding thrusts against gravity, releasing falls toward it", () => {
  const s = playerAt("ship");
  stepPlayer(s, DT, SPEED, HOLD);
  assert.ok(s.yVel > 0, "holding should accelerate upward");
  const v = s.yVel;
  stepPlayer(s, DT, SPEED, IDLE);
  assert.ok(s.yVel < v, "releasing should accelerate downward");
});

test("ship: velocity clamps to raw 8.0/-6.4 (x54) at normal size", () => {
  const s = playerAt("ship");
  for (let i = 0; i < 240 * 5; i++) stepPlayer(s, DT, SPEED, { holding: true, freshPress: false });
  assert.ok(s.yVel <= 8.0 * 54 + 1e-6, `held climb clamped at ${s.yVel}`);
  assert.ok(s.yVel > 8.0 * 54 - 1, "clamp is reached, not just bounded");
  for (let i = 0; i < 240 * 5; i++) stepPlayer(s, DT, SPEED, IDLE);
  assert.ok(s.yVel >= -6.4 * 54 - 1e-6, `fall clamped at ${s.yVel}`);
  assert.ok(s.yVel < -6.4 * 54 + 1, "clamp is reached, not just bounded");
});

test("ship: flipped gravity mirrors the clamps", () => {
  const s = playerAt("ship", { gravityFlipped: true });
  for (let i = 0; i < 240 * 5; i++) stepPlayer(s, DT, SPEED, { holding: true, freshPress: false });
  // thrust is now downward, clamped at -8.0 raw
  assert.ok(s.yVel >= -8.0 * 54 - 1e-6, `flipped thrust clamped at ${s.yVel}`);
  for (let i = 0; i < 240 * 5; i++) stepPlayer(s, DT, SPEED, IDLE);
  assert.ok(s.yVel <= 6.4 * 54 + 1e-6, `flipped fall clamped at ${s.yVel}`);
});

test("ufo: fresh press applies the raw-7 impulse, only upward", () => {
  const s = playerAt("ufo");
  const consumed = stepPlayer(s, DT, SPEED, TAP);
  assert.ok(consumed);
  // the impulse is followed by same-step gravity (mult 1.2 while rising, halved)
  const want = quantizeVelocity(7 * 54 - GRAVITY * 1.2 * 0.5 * DT);
  assert.ok(Math.abs(s.yVel - want) < 1e-6, `yVel ${s.yVel} vs ${want}`);
  // a second press while already faster than the impulse does nothing
  const s2 = playerAt("ufo", { yVel: 500 });
  const consumed2 = stepPlayer(s2, DT, SPEED, TAP);
  assert.ok(!consumed2, "impulse must not slow the player down");
  assert.ok(s2.yVel <= 500);
  // a stale hold (press already spent) never impulses again
  const s3 = playerAt("ufo", { justHeld: false });
  assert.ok(!stepPlayer(s3, DT, SPEED, HOLD));
  assert.equal(s3.yVel < 0, true, "gravity only");
});

test("ufo: mini impulse is raw 8 * 0.85", () => {
  const s = playerAt("ufo", { mini: true });
  stepPlayer(s, DT, SPEED, TAP);
  const want = quantizeVelocity(8 * 0.85 * 54 - (GRAVITY * 1.2 * 0.5 / 0.85) * DT);
  assert.ok(Math.abs(s.yVel - want) < 1e-6);
});

test("ball: tap on ground flips gravity and hops at 0.6x jump", () => {
  const s = playerAt("ball");
  // a fresh tap: the jump pays the frame's gravity (a buffered one does not)
  const consumed = stepPlayer(s, DT, SPEED, { ...TAP, pressed: true });
  assert.ok(consumed);
  assert.equal(s.gravityFlipped, true);
  // full jump along the PRE-flip up, halved by the flip, then x0.6 — so it
  // leaves the floor upward; the same step's 0.6x (now upward) gravity adds on
  const want = quantizeVelocity(JUMP_VELOCITY * 0.5 * 0.6 + GRAVITY * 0.6 * DT);
  assert.ok(Math.abs(s.yVel - want) < 1e-6, `yVel ${s.yVel} vs ${want}`);
  assert.ok(!s.onGround);
  // a stale hold is not enough, and mid-air taps do nothing
  const s2 = playerAt("ball", { queuedHold: false });
  assert.ok(!stepPlayer(s2, DT, SPEED, HOLD));
  assert.equal(s2.gravityFlipped, false);
  const s3 = playerAt("ball", { onGround: false, yVel: 100 });
  assert.ok(!stepPlayer(s3, DT, SPEED, TAP));
  assert.equal(s3.gravityFlipped, false);
});

test("ball: gravity multiplier is 0.6", () => {
  const s = playerAt("ball", { onGround: false });
  stepPlayer(s, DT, SPEED, IDLE);
  assert.ok(Math.abs(s.yVel - quantizeVelocity(-0.6 * GRAVITY * DT)) < 1e-9);
});

test("spider: gravity multiplier is 0.6, the same as the ball's", () => {
  // `updateJump` +2236: `s9 = m_isSpider ? 0.6 : (m_isRobot ? 0.9 : 1.0)`, and
  // s9 multiplies the gravity step at +3016. The spider fell under FULL gravity
  // until this test, which flattened every pad and orb arc it makes — measured
  // on Fingerdash, where the arc off the yellow pad at x=13155 undershot the
  // pink orb at (13275, 195) by ~50 units and landed in the floor spikes.
  const s = playerAt("spider", { onGround: false });
  stepPlayer(s, DT, SPEED, IDLE);
  assert.ok(Math.abs(s.yVel - quantizeVelocity(-0.6 * GRAVITY * DT)) < 1e-9,
    `spider gravity step ${s.yVel}, expected ${quantizeVelocity(-0.6 * GRAVITY * DT)}`);

  const ball = playerAt("ball", { onGround: false });
  stepPlayer(ball, DT, SPEED, IDLE);
  assert.ok(Math.abs(s.yVel - ball.yVel) < 1e-9, "spider and ball fall alike");
});

test("spider: a yellow pad arc reaches its intended height", () => {
  // Fingerdash x=13155: a spider leaves the pad at y=135 with 16*54*0.6 = 518.4
  // and must arrive at the pink orb 145 units later at y~195.
  const s = playerAt("spider", { onGround: true, y: 135 });
  activatePad(35, s);
  assert.ok(Math.abs(s.yVel - 16 * 54 * 0.6) < 1e-3, `pad gave ${s.yVel}`);
  let x = 0;
  while (x < 145) { stepPlayer(s, DT, SPEED, IDLE); x += SPEED * DT; }
  assert.ok(s.y > 185 && s.y < 205, `spider is at y=${s.y.toFixed(1)}, wanted ~195`);
});

test("wave: holding climbs at exactly the horizontal speed, release dives", () => {
  const s = playerAt("wave");
  stepPlayer(s, DT, SPEED, { holding: true, freshPress: false });
  assert.equal(s.yVel, SPEED);
  stepPlayer(s, DT, SPEED, IDLE);
  assert.equal(s.yVel, -SPEED);
  // mini is 2x steeper (the real mini wave in Deadlocked moves at 623.16 =
  // 2 * 311.58 from frame 654), and gravity flip mirrors both
  const m = playerAt("wave", { mini: true });
  stepPlayer(m, DT, SPEED, { holding: true, freshPress: false });
  assert.equal(m.yVel, SPEED * 2);
  const f = playerAt("wave", { gravityFlipped: true });
  stepPlayer(f, DT, SPEED, { holding: true, freshPress: false });
  assert.equal(f.yVel, -SPEED);
});

test("orb force table: yellow/red/pink per-mode multipliers of the jump", () => {
  const y = playerAt("cube");
  activateOrb(36, y);
  assert.ok(Math.abs(y.yVel - JUMP_VELOCITY) < ORB_GRID, "yellow = 1.0x");

  const cases: [PlayerState["mode"], boolean, number][] = [
    ["cube", false, 1.38], ["ship", false, 1.0], ["ship", true, 1.4],
    ["ufo", false, 1.02], ["ufo", true, 1.36], ["ball", false, 1.34 * 0.7],
    ["spider", false, 1.34 * 0.7], ["robot", false, 1.28],
  ];
  for (const [mode, mini, mult] of cases) {
    const s = playerAt(mode, { mini });
    activateOrb(1333, s);
    const want = JUMP_VELOCITY * (mini ? 0.8 : 1) * mult;
    assert.ok(Math.abs(s.yVel - want) < ORB_GRID, `red ${mode}${mini ? " mini" : ""}: ${s.yVel} vs ${want}`);
  }

  const pink: [PlayerState["mode"], number][] = [
    ["ship", 0.37], ["ufo", 0.42], ["ball", 0.77 * 0.7], ["cube", 0.72],
  ];
  for (const [mode, mult] of pink) {
    const s = playerAt(mode);
    activateOrb(141, s);
    assert.ok(Math.abs(s.yVel - JUMP_VELOCITY * mult) < ORB_GRID, `pink ${mode}`);
  }
});

test("gravity orbs flip gravity and boost along the new direction", () => {
  // The two gravity orbs are NOT symmetric, and the original's ordering is why:
  //   blue (84) sets its velocity first and flips afterwards, so it keeps the
  //     pre-flip sign and the flip really does halve it -> 0.8 / 2 = 0.4x;
  //   green (1022) flips first, so it takes the post-flip sign and its
  //     assignment overwrites the halving -> full magnitude, opposite sign.
  const s = playerAt("cube");
  activateOrb(84, s);
  assert.equal(s.gravityFlipped, true);
  assert.ok(Math.abs(s.yVel - JUMP_VELOCITY * 0.4) < ORB_GRID,
    `blue orb should leave the floor at 0.8/2 = 0.4x jump, got ${s.yVel}`);

  const g2 = playerAt("ship");
  activateOrb(1022, g2); // green: flip first, ship 0.7, post-flip sign
  assert.equal(g2.gravityFlipped, true);
  assert.ok(Math.abs(g2.yVel + JUMP_VELOCITY * 0.7) < ORB_GRID,
    `green orb takes the post-flip sign, got ${g2.yVel}`);

  // mirrored: flipping back from the ceiling sends it the other way, unhalved
  const g3 = playerAt("cube", { gravityFlipped: true });
  activateOrb(1022, g3);
  assert.equal(g3.gravityFlipped, false);
  assert.ok(Math.abs(g3.yVel - JUMP_VELOCITY) < ORB_GRID,
    `flipping back should launch upward, got ${g3.yVel}`);
});

test("black orb sets an absolute per-mode drop speed", () => {
  const cases: [PlayerState["mode"], number][] = [
    // the drop orb returns before the mini and ball/spider scaling
    ["ufo", 11.2], ["ship", 14], ["wave", 14], ["spider", 16.5], ["cube", 15],
  ];
  for (const [mode, raw] of cases) {
    const s = playerAt(mode);
    activateOrb(1330, s);
    assert.ok(Math.abs(s.yVel - -raw * 54) < 1e-6, `drop ${mode}: ${s.yVel} vs ${-raw * 54}`);
  }
  // under flipped gravity the drop direction mirrors
  const f = playerAt("cube", { gravityFlipped: true });
  activateOrb(1330, f);
  assert.ok(Math.abs(f.yVel - 15 * 54) < 1e-6);
});

test("mini scales every orb impulse by 0.8", () => {
  const s = playerAt("cube", { mini: true });
  activateOrb(36, s);
  assert.ok(Math.abs(s.yVel - JUMP_VELOCITY * 0.8) < ORB_GRID);
});

test("dash orbs hover while held and release cleanly", () => {
  const s = playerAt("cube", { yVel: -300 });
  activateOrb(1704, s);
  assert.equal(s.dash, 1);
  stepPlayer(s, DT, SPEED, { holding: true, freshPress: false });
  assert.equal(s.yVel, 0, "dash pins vertical velocity");
  const y0 = s.y;
  stepPlayer(s, DT, SPEED, { holding: true, freshPress: false });
  assert.equal(s.y, y0);
  stepPlayer(s, DT, SPEED, IDLE); // release ends the dash
  assert.equal(s.dash, 0);
  assert.equal(s.gravityFlipped, false);

  const s2 = playerAt("cube");
  activateOrb(1751, s2);
  stepPlayer(s2, DT, SPEED, IDLE); // released immediately: flip on release
  assert.equal(s2.dash, 0);
  assert.equal(s2.gravityFlipped, true);
});

test("teleport orb (3006) is render-only", () => {
  const s = playerAt("cube", { yVel: 123 });
  assert.equal(activateOrb(3006, s), false);
  assert.equal(s.yVel, 123);
});

test("pads: ball, spider AND swing all take the 0.6 in propellPlayer's tail", () => {
  // `propellPlayer` +136..+208 sends ball, spider and swing alike to +304,
  // which multiplies the launch by the double 0x3fe3333340000000 = 0.6 before
  // calling the animation hook. The port used to apply it to two of the three.
  for (const mode of ["ball", "spider", "swing"] as const) {
    const s = playerAt(mode);
    activatePad(35, s);
    assert.ok(Math.abs(s.yVel - 16 * 54 * 0.6) < 1e-6,
      `${mode} yellow pad should be 0.6x, got ${s.yVel}`);
  }
  for (const mode of ["cube", "robot", "ship", "ufo", "wave"] as const) {
    const s = playerAt(mode);
    activatePad(35, s);
    assert.ok(Math.abs(s.yVel - 16 * 54) < 1e-6, `${mode} is unscaled, got ${s.yVel}`);
  }
});

test("pad forces are per gamemode, from the dispatch at 0x100100540", () => {
  // pink (type 9): 0.65 cube/robot, 0.7 ball & spider, 0.35 ship, 0.4 UFO
  const pink = (mode: PlayerState["mode"]) => {
    const s = playerAt(mode); activatePad(140, s); return s.yVel;
  };
  assert.ok(Math.abs(pink("cube") - 16 * 54 * 0.65) < 1e-6);
  assert.ok(Math.abs(pink("ball") - 16 * 54 * 0.7 * 0.6) < 1e-6, `ball ${pink("ball")}`);
  assert.ok(Math.abs(pink("spider") - 16 * 54 * 0.7 * 0.6) < 1e-6);
  assert.ok(Math.abs(pink("ship") - 16 * 54 * 0.35) < 1e-6, `ship ${pink("ship")}`);
  assert.ok(Math.abs(pink("ufo") - 16 * 54 * 0.4) < 1e-6, `ufo ${pink("ufo")}`);

  // red (type 34): 1.25 by default, ship 0.63 (mini 0.95), UFO 0.6 (mini 0.98)
  const red = (mode: PlayerState["mode"], mini = false) => {
    const s = playerAt(mode, { mini }); activatePad(1332, s); return s.yVel;
  };
  assert.ok(Math.abs(red("cube") - 16 * 54 * 1.25) < 1e-6);
  assert.ok(Math.abs(red("ship") - 16 * 54 * 0.63) < 1e-6, `ship ${red("ship")}`);
  assert.ok(Math.abs(red("ship", true) - 16 * 54 * 0.95 * 0.8) < 1e-6);
  assert.ok(Math.abs(red("ufo") - 16 * 54 * 0.6) < 1e-6, `ufo ${red("ufo")}`);
  assert.ok(Math.abs(red("ufo", true) - 16 * 54 * 0.98 * 0.8) < 1e-6);
});

test("pads boost without any press", () => {
  const s = playerAt("cube");
  activatePad(35, s);
  assert.ok(Math.abs(s.yVel - 16 * 54) < 1e-6, "yellow pad = raw 16");
  const p = playerAt("cube");
  activatePad(140, p);
  assert.ok(Math.abs(p.yVel - 16 * 54 * 0.65) < 1e-6, "pink pad force 0.65");
  // gravity pad: propel at force 0.8 along the pre-flip up, THEN flip, which
  // halves it — an effective 0.4x
  const gv = playerAt("cube");
  activatePad(67, gv);
  assert.equal(gv.gravityFlipped, true);
  assert.ok(Math.abs(gv.yVel - 16 * 54 * 0.4) < 1e-6,
    `gravity pad should end at 0.8/2 = 0.4x, got ${gv.yVel}`);
  const gvf = playerAt("cube", { gravityFlipped: true });
  activatePad(67, gvf);
  assert.equal(gvf.gravityFlipped, false);
  assert.ok(Math.abs(gvf.yVel + 16 * 54 * 0.4) < 1e-6);
  // red pad, force 1.25
  const rp = playerAt("cube");
  activatePad(1332, rp);
  assert.ok(Math.abs(rp.yVel - 16 * 54 * 1.25) < 1e-6, "red pad force 1.25");
  // ball gets the weaker 0.6x pad
  const b = playerAt("ball");
  activatePad(35, b);
  assert.ok(Math.abs(b.yVel - 16 * 54 * 0.6) < 1e-6);
});

// --- the robot, as decoded from the shipping binary (see gamemodes.ts) ---

test("robot: the jump is half the cube's and gravity is 0.9x", () => {
  const r = playerAt("robot");
  stepPlayer(r, DT, SPEED, HOLD);
  // The take-off velocity itself, before the charge window can bend it — but
  // after the snap every velocity write goes through, which is what makes the
  // recorded runs read exactly 301.860 rather than 301.8609.
  const want = quantizeVelocity(JUMP_VELOCITY * 0.5);
  assert.ok(Math.abs(r.yVel - want) < 1e-9, `robot take-off ${r.yVel} should be ${want}`);
  assert.equal(Number(r.yVel.toFixed(3)), 301.86, "measured in macros-main at 1x");

  // released immediately, it falls under 0.9x gravity, not 1.0x
  const v0 = r.yVel;
  stepPlayer(r, DT, SPEED, IDLE);
  assert.ok(Math.abs(r.yVel - quantizeVelocity(v0 - GRAVITY * 0.9 * DT)) < 1e-9,
    `robot gravity step ${v0 - r.yVel} should be ${GRAVITY * 0.9 * DT}`);
});

test("robot: holding cancels gravity exactly, for 15/54 s", () => {
  const r = playerAt("robot");
  stepPlayer(r, DT, SPEED, HOLD);
  const v = r.yVel;
  // inside the window the velocity does not change at all — the binary adds an
  // equal and opposite gravity step rather than a reduced one
  const window = (1.5 / 0.1) / 54;
  const inside = Math.floor(window / DT) - 2;
  for (let i = 0; i < inside; i++) stepPlayer(r, DT, SPEED, { holding: true, onOrb: false });
  assert.ok(Math.abs(r.yVel - v) < 1e-9, `coasting: ${r.yVel} should still be ${v}`);

  // and past it, gravity resumes at the robot's 0.9x
  for (let i = 0; i < 4; i++) stepPlayer(r, DT, SPEED, { holding: true, onOrb: false });
  assert.ok(r.yVel < v - GRAVITY * 0.9 * DT * 0.5, "the window expires");
});

test("robot: a full hold clears roughly 3.4 blocks, a tap barely 0.6", () => {
  const apex = (holding: boolean) => {
    const r = playerAt("robot");
    stepPlayer(r, DT, SPEED, HOLD);
    let top = r.y;
    for (let i = 0; i < 240; i++) {
      stepPlayer(r, DT, SPEED, { holding, onOrb: false });
      top = Math.max(top, r.y);
    }
    return top - 15;
  };
  const held = apex(true), tapped = apex(false);
  assert.ok(Math.abs(held - 102) < 4, `full-hold apex ${held} should be ~102`);
  assert.ok(Math.abs(tapped - 18) < 3, `tapped apex ${tapped} should be ~18`);
  // and the cube sits between them, which is the robot's whole character
  assert.ok(tapped < 65 && 65 < held, "the cube's 65 is bracketed by the robot's range");
});

test("robot: holding through a landing does not re-jump — it needs a fresh press", () => {
  const r = playerAt("robot");
  stepPlayer(r, DT, SPEED, HOLD);          // consumes the buffered press
  assert.ok(!r.queuedHold, "the jump consumed the press");
  r.onGround = true;                        // pretend the collision pass landed us
  r.yVel = 0;
  stepPlayer(r, DT, SPEED, { holding: true, onOrb: false });
  // no take-off: the step only applied a gravity tick, which the collision
  // pass would zero again next frame
  assert.ok(r.onGround && r.yVel <= 0, `a stale hold cannot jump (yVel ${r.yVel})`);
  r.queuedHold = true;
  stepPlayer(r, DT, SPEED, { holding: true, onOrb: false });
  assert.ok(!r.onGround && r.yVel > 0, "a fresh press can");
});

test("robot: an orb does not start a charge — only its own jump does", () => {
  const r = playerAt("robot");
  r.onGround = false;
  r.jumping = false;
  activateOrb(36, r);                       // yellow orb, mid-air
  const v = r.yVel;
  stepPlayer(r, DT, SPEED, { holding: true, onOrb: false });
  assert.ok(Math.abs(r.yVel - quantizeVelocity(v - GRAVITY * 0.9 * DT)) < 1e-9,
    "gravity still applies after an orb, however hard the button is held");
});

test("robot: crossing a portal in mid-air arrives with the float already spent", () => {
  // toggleRobotMode (m1 0x38d95c) ends `str x8, [x19, #0x7f8]` with x8 the
  // double 1.5 — the exact cap `[0x7f8] < 1.5` is tested against. So a robot
  // entered from the air cannot float until it jumps for itself.
  // `jumping` is written only by the robot's own step, so the way to arrive in
  // this state is to leave a robot section mid-arc and come back: jump as a
  // robot, cross a portal out while still rising, then cross one back in. The
  // flag rides through untouched, and before this fix the unused charge did too.
  const r = playerAt("robot");
  stepPlayer(r, DT, SPEED, HOLD);           // the robot's own jump: arms the charge
  assert.ok(r.jumping && !r.onGround, "airborne off the robot's own jump");
  assert.ok(r.holdTime < ROBOT_HOLD_MAX, "with float still in hand");

  setGamemode(r, "ship");                   // out mid-arc...
  setGamemode(r, "robot");                  // ...and back in
  assert.equal(r.holdTime, ROBOT_HOLD_MAX, "the charge enters spent, not fresh");
  // `jumping` is deliberately NOT cleared: nothing in any mode helper writes
  // 0x9cc. The spent charge is what stops the float on its own.
  assert.ok(r.jumping, "the arc is still flagged as a jump");
  assert.ok(!r.onGround, "and still airborne");

  const v = r.yVel;
  stepPlayer(r, DT, SPEED, HOLD);
  assert.ok(Math.abs(r.yVel - quantizeVelocity(v - GRAVITY * 0.9 * DT)) < 1e-9,
    "gravity applies in full — holding buys nothing on an arc the robot did not launch");
});

test("robot: its own ground jump re-arms the float a portal spent", () => {
  // `updateJump+2668  str xzr, [x19, #0x7f8]` — the ground jump zeroes it.
  const r = playerAt("cube");
  setGamemode(r, "robot");
  assert.equal(r.holdTime, ROBOT_HOLD_MAX, "spent on arrival");

  r.onGround = true;                        // land, then press
  r.queuedHold = true;
  stepPlayer(r, DT, SPEED, HOLD);
  assert.ok(r.holdTime < ROBOT_HOLD_MAX, "the robot's own jump re-arms the charge");

  // and that charge really does cancel gravity now
  const v = r.yVel;
  stepPlayer(r, DT, SPEED, HOLD);
  assert.ok(Math.abs(r.yVel - v) < 1e-9, "holding cancels gravity exactly");
});

test("robot: a second robot portal does not hand back a spent charge", () => {
  // The mirror of the bug above: `holdTime` used to survive the portal in
  // *both* directions, so a robot that had spent its float and left through a
  // portal could re-enter with the float still dead. It is now set on entry
  // either way, and re-armed only by a jump.
  const r = playerAt("robot", { holdTime: ROBOT_HOLD_MAX, onGround: true });
  setGamemode(r, "ship");
  setGamemode(r, "robot");
  assert.equal(r.holdTime, ROBOT_HOLD_MAX, "still spent — a portal never re-arms");
  r.queuedHold = true;
  r.onGround = true;
  stepPlayer(r, DT, SPEED, HOLD);
  assert.ok(r.holdTime < ROBOT_HOLD_MAX, "only the jump re-arms");
});

test("cube take-off: a held button leaves the jump untouched, a fresh press pays gravity", () => {
  // A button that was already down takes off *after* the frame's gravity, so
  // the jump velocity survives whole; a press that lands on this very frame
  // takes off before it and loses one step. See StepInput.pressed.
  const s = playerAt("cube");
  stepPlayer(s, DT, SPEED, HOLD);
  assert.equal(s.yVel, JUMP_VELOCITY);
  assert.ok(!s.onGround);
  // mini cube jumps at 0.8x
  const m = playerAt("cube", { mini: true });
  stepPlayer(m, DT, SPEED, HOLD);
  assert.equal(m.yVel, JUMP_VELOCITY * 0.8);

  const f = playerAt("cube");
  stepPlayer(f, DT, SPEED, { ...HOLD, pressed: true });
  assert.ok(Math.abs(f.yVel - quantizeVelocity(JUMP_VELOCITY - GRAVITY * DT)) < 1e-9);
});

test("the speed setting changes gravity and the jump, not just the scroll rate", () => {
  // `updateSpeedVariables` writes a different m_gravity and jump per speed;
  // 3x and 4x share a row. See SPEED_PHYSICS.
  const at = (i: number) => {
    const p = playerAt("cube");
    stepPlayer(p, DT, SPEEDS[i], { ...HOLD, pressed: true });
    return p.yVel;
  };
  const want = (i: number) => {
    const c = speedConstants(SPEEDS[i]);
    return quantizeVelocity(c.jump - c.gravity * DT);
  };
  for (let i = 0; i < 5; i++) {
    assert.ok(Math.abs(at(i) - want(i)) < 1e-9, `speed ${i}: ${at(i)} vs ${want(i)}`);
  }
  assert.notEqual(want(1), want(2), "2x is not 1x");
  assert.equal(want(3), want(4), "3x and 4x share a row");
  // the robot takes half the cube's jump, so it moves with it: 2x measures
  // 308.34 in the macros, against 301.86 at 1x
  assert.ok(Math.abs(speedConstants(SPEEDS[2]).jump * 0.5 - 308.3408) < 1e-3);
});

test("an upside-down ship's slow/fast branch tests the world velocity against +rise, unmirrored", async () => {
  // Jumper frame 5797, native: flipped ship, button up, world yVel -2.16 u/s ->
  // the game adds +5.563 u/s per step (the 1.2 branch), not +3.726 (0.8).
  const { freshPlayer, stepPlayer } = await import("../src/gd/gamemodes.ts");
  const { SPEEDS } = await import("../src/gd/physics.ts");
  const p = freshPlayer(0, 100);
  p.mode = "ship"; p.onGround = false; p.gravityFlipped = true; p.yVel = -2.161;
  stepPlayer(p, 1 / 240, SPEEDS[1], { holding: false, onOrb: false, pressed: false });
  assert.ok(Math.abs(p.yVel - 3.402) < 0.02, `yVel ${p.yVel}`);
  // and the right way up nothing changes: below +rise is still the 0.8 branch
  const q = freshPlayer(0, 100);
  q.mode = "ship"; q.onGround = false; q.yVel = 6.859;
  stepPlayer(q, 1 / 240, SPEEDS[1], { holding: false, onOrb: false, pressed: false });
  assert.ok(Math.abs(q.yVel - 3.131) < 0.02, `yVel ${q.yVel}`);
});

test("a robot's float is 67 steps from a fresh press and 68 from a held landing", async () => {
  // Geometrical Dominator's real run: six press-started floats of 67 frames,
  // two held-landing floats of 68.
  const { freshPlayer, stepPlayer } = await import("../src/gd/gamemodes.ts");
  const { SPEEDS } = await import("../src/gd/physics.ts");
  const floatSteps = (pressed: boolean) => {
    const p = freshPlayer(0, 15);
    p.mode = "robot"; p.onGround = true; p.queuedHold = true;
    let n = 0, v0 = NaN;
    for (let i = 0; i < 120; i++) {
      stepPlayer(p, 1 / 240, SPEEDS[1], { holding: true, onOrb: false, pressed: pressed && i === 0 });
      p.onGround = false;
      if (i === 0) v0 = p.yVel;
      if (Math.abs(p.yVel - v0) < 1e-9) n++; else break;
    }
    return n;
  };
  assert.equal(floatSteps(true), 67);
  assert.equal(floatSteps(false), 68);
});

test("orb jumps use the current speed's jump, as ground jumps do", async () => {
  // Electrodynamix frame 2253 at 2x: the real yellow ring gives 616.68 u/s
  // (11.420032 * 54), not the 1x 603.72.
  const { freshPlayer } = await import("../src/gd/gamemodes.ts");
  const { activateOrb } = await import("../src/gd/interactives.ts");
  const { SPEEDS } = await import("../src/gd/physics.ts");
  const p = freshPlayer(0, 100);
  p.onGround = false;
  activateOrb(36, p, SPEEDS[2]);
  assert.ok(Math.abs(p.yVel - 616.68) < 0.01, `yVel ${p.yVel}`);
  const q = freshPlayer(0, 100);
  q.onGround = false;
  activateOrb(36, q, SPEEDS[1]);
  assert.ok(Math.abs(q.yVel - 603.72) < 0.01, `yVel ${q.yVel}`);
});

test("leaving the wave halves its raw velocity: 0.45 x speed, whatever the wave's rate", () => {
  // Blast Processing f14076 (normal wave) and Deadlocked f867 (mini wave, 623
  // u/s) both leave at 140.21; into a ship it is halved again (70.10).
  for (const mini of [false, true]) {
    const p = playerAt("wave", { mini, yVel: mini ? -623.16 : -311.58 });
    setGamemode(p, "cube", SPEED);
    assert.ok(Math.abs(p.yVel + 140.211) < 0.01, `cube ${p.yVel}`);
  }
  const s = playerAt("wave", { yVel: -311.58 });
  setGamemode(s, "ship", SPEED);
  assert.ok(Math.abs(s.yVel + 70.106) < 0.01, `ship ${s.yVel}`);
});

test("leaving a ship halves the velocity, as entering one does", () => {
  // Clubstep frame 7010: a ship at 272.27 u/s leaves as a cube at 136.13.
  for (const from of ["ship", "ufo"] as const) {
    const p = playerAt(from, { yVel: 272.268 });
    setGamemode(p, "cube", SPEED);
    assert.ok(Math.abs(p.yVel - 136.134) < 0.01, `${from}: yVel ${p.yVel}`);
  }
  // the ball keeps its speed
  const b = playerAt("ball", { yVel: 272.268 });
  setGamemode(b, "cube", SPEED);
  assert.equal(b.yVel, 272.268);
});

test("a jump off a ramp spends the ramp's stored velocity (no ride-end launch after it)", () => {
  // Hexagon Force f4326: a ball tapped on a 2:1 ramp at 2x leaves at ~200 u/s;
  // the ride-end launch must not fire afterwards and overwrite it.
  const p = playerAt("ball", { onGround: true, yVel: 193.71, slopeTime: 0.01, slopeVelocity: 201.37 });
  stepPlayer(p, DT, SPEEDS[2], { holding: true, onOrb: false, pressed: true });
  assert.equal(p.slopeTime, 0);
  assert.equal(p.slopeVelocity, 0);
  assert.ok(Math.abs(p.yVel - 207.1) < 0.2, `yVel ${p.yVel}`);
});

test("a ball jump from a buffered press skips that frame's gravity; a fresh press does not", () => {
  // Hexagon Force at 2x: buffered (f4689 -> jump f4700) leaves at 200.10,
  // fresh (f4326) at 207.09 — one ball gravity step apart.
  const jumpV = (pressed: boolean) => {
    const p = playerAt("ball", { onGround: true, yVel: 0 });
    stepPlayer(p, DT, SPEEDS[2], { holding: true, onOrb: false, pressed });
    return p.yVel;
  };
  const step = speedConstants(SPEEDS[2]).gravity * 0.6 * DT;
  // (velocities are quantised, so allow the rounding)
  assert.ok(Math.abs(jumpV(true) - jumpV(false) - step) < 0.05,
    `fresh ${jumpV(true)} vs buffered ${jumpV(false)}`);
});

test("a grounded mini player grows upward off the floor; shrinking does not move it", () => {
  // Theory of Everything f3285: a mini ship resting at 9 above the floor is at
  // 15 on the very frame it crosses the normal-size portal (Electrodynamix f7032
  // the same). The game does not drop a grounded player when it shrinks.
  const run = { speed: SPEED, mirrored: false, coins: 0 };
  const grow = playerAt("ship", { mini: true, onGround: true, y: 9 });
  applyPortal(99, new Map(), grow, run);
  assert.equal(grow.mini, false);
  assert.ok(Math.abs(grow.y - 15) < 1e-9, `grew to ${grow.y}`);
  const shrink = playerAt("ship", { onGround: true, y: 15 });
  applyPortal(101, new Map(), shrink, run);
  assert.equal(shrink.mini, true);
  assert.equal(shrink.y, 15);
});

test("entering a UFO halves the velocity, as entering a ship does", () => {
  // Theory of Everything f5325: a cube falling at 528.61 enters the UFO at 264.30.
  const p = playerAt("cube", { onGround: false, yVel: -528.606 });
  setGamemode(p, "ufo", SPEED);
  assert.ok(Math.abs(p.yVel + 264.303) < 1e-9, `entered at ${p.yVel}`);
});

test("a player still in its ground grace can jump; an airborne one without it cannot", () => {
  // Electroman f15577: a flipped mini cube one step off its ceiling jumps at
  // 0.8 x 603.72 (the sim grants the grace only in flipped gravity).
  const graced = playerAt("cube", {
    mini: true, gravityFlipped: true, onGround: false, yVel: 11.664, groundGrace: 7,
  });
  stepPlayer(graced, DT, SPEED, { holding: true, onOrb: false, pressed: true });
  assert.ok(graced.yVel < -400, `jumped away from the ceiling at ${graced.yVel}`);
  assert.equal(graced.groundGrace, 0, "the jump spends the grace");
  const falling = playerAt("cube", { onGround: false, yVel: -11.664 });
  stepPlayer(falling, DT, SPEED, { holding: true, onOrb: false, pressed: true });
  assert.ok(falling.yVel < 0, "no jump without ground or grace");
});

test("robot: releasing mid-float spends the float; pressing again does not re-float", () => {
  // Geometrical Dominator f4317-4342
  const p = playerAt("robot", { onGround: false, jumping: true, holdTime: 44 * DT, yVel: 301.86 });
  stepPlayer(p, DT, SPEED, IDLE);
  assert.equal(p.holdTime, ROBOT_HOLD_MAX);
  p.yVel = 434.7;
  stepPlayer(p, DT, SPEED, { holding: true, onOrb: false, pressed: false });
  assert.ok(p.yVel < 434.7, `fell under gravity: ${p.yVel}`);
});

test("a falling mini ship tops out on the 0.001-raw grid", () => {
  // Electrodynamix f6188: 7.529 raw (406.566 u/s), not 6.4 / 0.85 = 7.529412
  const p = playerAt("ship", { mini: true, onGround: false, yVel: -500 });
  stepPlayer(p, DT, SPEEDS[3], IDLE);
  assert.ok(Math.abs(p.yVel + 7.529 * 54) < 1e-9, `clamped at ${p.yVel}`);
});

test("ship gravity is the base constant at every speed (mini ship at 3x)", () => {
  // Electrodynamix f12733-12742: held below the threshold +0.127 raw per step,
  // above it +0.101 — the 3x row would give +0.102
  const fast = playerAt("ship", { mini: true, onGround: false, yVel: 109.728 });
  stepPlayer(fast, DT, SPEEDS[3], HOLD);
  assert.ok(Math.abs(fast.yVel - 109.728 - 0.101 * 54) < 1e-6, `fast step ${fast.yVel - 109.728}`);
  const slow = playerAt("ship", { mini: true, onGround: false, yVel: 82.296 });
  stepPlayer(slow, DT, SPEEDS[3], HOLD);
  assert.ok(Math.abs(slow.yVel - 82.296 - 0.127 * 54) < 1e-6, `slow step ${slow.yVel - 82.296}`);
});

test("swing: entering halves the velocity; it is clamped at 8.0 raw both ways", () => {
  // Dash f3879 (entry, -42.4 -> -21.4) and f4375 (rises at exactly 432)
  const p = playerAt("cube", { onGround: false, yVel: -200 });
  setGamemode(p, "swing", SPEED);
  assert.equal(p.yVel, -100);
  const fast = playerAt("swing", { onGround: false, yVel: 500, gravityFlipped: true });
  stepPlayer(fast, DT, SPEED, IDLE);
  assert.ok(Math.abs(fast.yVel - 432) < 1e-9, `clamped to ${fast.yVel}`);
});

test("the swing portal (1933) and spider orb (3004) are gameplay objects", async () => {
  const { OBJECT_DEFS } = await import("../src/gd/objects.ts");
  const { HITBOXES } = await import("../src/gd/hitboxes.ts");
  assert.equal(OBJECT_DEFS.get(1933)?.kind, "portal");
  assert.equal(OBJECT_DEFS.get(3004)?.kind, "orb");
  assert.deepEqual(HITBOXES.get(1933), { w: 33.5, h: 86 });
  const s = playerAt("cube");
  applyPortal(1933, new Map(), s, { speed: SPEED, mirrored: false, coins: 0 });
  assert.equal(s.mode, "swing");
});

test("a grounded player keeps its underside on the ground through a gamemode portal", () => {
  // Dash f1167: a spider (27 box) resting at 13.5 becomes a cube at 15 on the
  // portal's own frame
  const p = playerAt("spider", { onGround: true, y: 13.5 });
  applyPortal(12, new Map(), p, { speed: SPEED, mirrored: false, coins: 0 });
  assert.equal(p.mode, "cube");
  assert.ok(Math.abs(p.y - 15) < 1e-9, `y ${p.y}`);
});

test("Fix Robot Jump (kA34): a pad ends a robot's jump charge; classic levels keep it", async () => {
  const { activatePad } = await import("../src/gd/interactives.ts");
  const { freshPlayer } = await import("../src/gd/gamemodes.ts");
  for (const fix of [false, true]) {
    const p = { ...freshPlayer(0, 15), mode: "robot" as const, jumping: true, onGround: false, fixRobotJump: fix };
    activatePad(35, p);
    assert.equal(p.jumping, !fix, fix ? "fixed levels stop the charge" : "classic levels keep floating");
  }
});
