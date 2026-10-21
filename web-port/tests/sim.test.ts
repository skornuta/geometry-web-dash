// Regression tests for the shared step function (src/game/sim.ts).
//
// Each of these pins a bug that made real levels unplayable and that unit tests
// on the physics alone could not have caught — they are all about how the
// player's boxes meet the world.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CollisionWorld, hitsSlopeWall, slopeSurfaceY } from "../src/game/collision.ts";
import {
  advanceFixedSteps, cloneSim, createSim, MAX_FRAME, restoreSim, simPress, simStep, STEP,
} from "../src/game/sim.ts";
import type { Level } from "../src/gd/level.ts";
import { SPEEDS, flipGravity } from "../src/gd/physics.ts";
import { bandFor } from "../src/gd/camera.ts";
import { P } from "../src/gd/props.ts";

/** a level containing exactly the given objects, at their given positions */
function worldOf(objs: { id: number; x: number; y: number; props?: Map<number, string> }[]) {
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: objs.map((o) => ({ ...o, props: o.props ?? new Map<number, string>() })),
  } as unknown as Level;
  // real frame sizes for the ids used below, so the boxes match the game's
  const sizes: Record<number, { w: number; h: number }> = {
    8: { w: 30, h: 30 },    // spike
    9: { w: 30.5, h: 26 },  // floor pit
    11: { w: 34.5, h: 77 }, // inverted-gravity portal
    35: { w: 25, h: 4 },    // yellow pad
    36: { w: 36, h: 36 },   // yellow orb
    67: { w: 25, h: 6 },    // gravity pad
    143: { w: 30, h: 30 },  // breakable brick
    286: { w: 30, h: 30 },  // dual portal
    13: { w: 34, h: 86 },   // ship portal
    84: { w: 36, h: 36 },   // blue (gravity) orb
    483: { w: 30, h: 30 },  // 45-degree slope (blockOutline_14)
    493: { w: 60, h: 30 },  // 2:1 slope (blockOutline_15)
    1: { w: 30, h: 30 },    // block
    2866: { w: 30, h: 30 }, // F block (blockOutline_01, not in the hitbox table)
  };
  return new CollisionWorld(level, (id) => sizes[id] ?? null);
}

/** run `secs` of simulation, holding as told, and report where it ended */
function run(world: CollisionWorld, secs: number, opts: {
  x?: number; y?: number; yVel?: number; flip?: boolean; mode?: "cube" | "ship";
  holding?: boolean;
} = {}) {
  const s = createSim(opts.x ?? 0, SPEEDS[1]);
  if (opts.y !== undefined) s.player.y = opts.y;
  if (opts.yVel !== undefined) { s.player.yVel = opts.yVel; s.player.onGround = false; }
  if (opts.flip) s.player.gravityFlipped = true;
  if (opts.mode) s.player.mode = opts.mode;
  const holding = opts.holding ?? false;
  if (holding) simPress(s);
  for (let i = 0; i < Math.round(secs / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, holding);
  }
  return s;
}

test("the fixed-step accumulator gives the same run at 60 Hz and 120 Hz render rates", () => {
  // `playLevel.ts`'s render loop wakes at whatever rate the display offers
  // and hands `advanceFixedSteps` however many seconds that call covered; the
  // sim itself only ever moves in whole 1/240s steps. A 120 Hz display calls
  // in twice as often with half the frame time per call — the accumulator
  // must still spend the same wall-clock time on physics, or faster hardware
  // would play the level differently from slower hardware (G2). Real
  // `requestAnimationFrame` timing is never perfectly regular, so this drives
  // both rates with jittery per-frame deltas (not an exact 1/60 or 1/120
  // every time) — a build that resets the accumulator each call instead of
  // carrying its remainder (the classic bug this guards against) drifts
  // steps away under jitter even though it happens to line up at exactly
  // regular 60/120 Hz ticks, which divide 240 evenly and would hide it.
  const drive = (renderHz: number, totalSeconds: number) => {
    // a spike and a pad along the way so the run exercises death and a
    // trigger, not just empty free space
    const world = worldOf([{ id: 8, x: 1200, y: 15 }, { id: 35, x: 2400, y: 2 }]);
    const s = createSim(0, SPEEDS[1]);
    simPress(s); // held throughout, so the cube keeps re-jumping off the ground
    let acc = 0;
    const nominal = 1 / renderHz;
    const jitter = [1, 0.85, 1.1, 0.95, 1.05, 0.9]; // a display's frame pacing is never exact
    const frames = Math.round(totalSeconds * renderHz);
    for (let i = 0; i < frames; i++) {
      const frame = nominal * jitter[i % jitter.length];
      acc = advanceFixedSteps(acc, frame, () => {
        if (s.dead) return false;
        simStep(s, world, STEP, true);
        return !s.dead;
      });
    }
    return s;
  };
  const at60 = drive(60, 3);
  const at120 = drive(120, 3);
  assert.ok(Math.abs(at60.steps - at120.steps) <= 1,
    `60 Hz took ${at60.steps} steps, 120 Hz took ${at120.steps} steps — jittery frame pacing must not drift them apart`);
  assert.equal(at60.dead, at120.dead);
  const closeEnough = (a: number, b: number, label: string) =>
    assert.ok(Math.abs(a - b) < 0.5, `${label}: 60 Hz ${a}, 120 Hz ${b}`);
  closeEnough(at60.player.x, at120.player.x, "x");
  closeEnough(at60.player.y, at120.player.y, "y");
});

test("a long stalled frame is clamped by the caller, not by the accumulator itself", () => {
  // `advanceFixedSteps` trusts whatever `frame` it is handed — it is the
  // scene's job to clamp a long stall (a backgrounded tab, a debugger pause)
  // to MAX_FRAME before calling it, or focus returning would demand a burst
  // of hundreds of catch-up steps in one go.
  let unclamped = 0;
  advanceFixedSteps(0, 10 /* a 10 s stall, far past MAX_FRAME */, () => { unclamped++; return true; });
  assert.equal(unclamped, Math.round(10 / STEP), "an unclamped stall runs every step it implies");

  let clamped = 0;
  const frame = Math.min(10, MAX_FRAME); // what playLevel.ts's loop actually passes in
  advanceFixedSteps(0, frame, () => { clamped++; return true; });
  // the exact count a single MAX_FRAME-sized accumulator fits (same float
  // arithmetic as advanceFixedSteps, so this does not hardcode a rounded value)
  let acc = 0, expected = 0;
  acc += MAX_FRAME;
  while (acc >= STEP) { acc -= STEP; expected++; }
  assert.equal(clamped, expected,
    "clamping the frame to MAX_FRAME bounds the catch-up to a fixed number of steps");
  assert.ok(Math.abs(clamped - MAX_FRAME / STEP) <= 1, `expected roughly ${MAX_FRAME / STEP} steps, got ${clamped}`);
  assert.ok(clamped < unclamped, "the clamp must actually reduce the catch-up");
});

test("a ground pad fires while the player runs over it", () => {
  // The pad's box is y = 0..4; a grounded player's centre sits at y = 15, so a
  // centre-point test could never touch one and every ground pad was inert.
  const world = worldOf([{ id: 35, x: 300, y: 2 }]);
  const s = run(world, 1.2);
  assert.equal(s.dead, false);
  assert.ok(s.player.y > 100,
    `expected the pad to launch the player, ended at y=${s.player.y.toFixed(1)}`);
});

test("hazards are tested against the player's FULL box, not the inner one", () => {
  // The two player boxes belong to two different rules: the inner box is only
  // ever consulted for solids (`collidedWithObjectInternal`, which never sees a
  // hazard), while hazards are killed against the plain 30x30 rect. Testing
  // them against the inner box let the player bury three quarters of itself in
  // a spike before dying.
  //
  // What keeps spikes fair is the *spike's* box: 6x12 out of a 30x30 sprite
  // (the real table, src/gd/hitboxes.ts), so the kill zone is the middle third.
  // A triple spike is still a single ordinary jump, just a timed one — the
  // takeoff window is ~14 units wide at normal speed.
  const world = worldOf([
    { id: 8, x: 465, y: 15 }, { id: 8, x: 495, y: 15 }, { id: 8, x: 525, y: 15 },
  ]);
  const s = createSim(0, SPEEDS[1]);
  let cleared = false;
  for (let i = 0; i < Math.round(3 / STEP) && !s.dead; i++) {
    const holding = s.player.x > 425 && s.player.x < 437;
    if (holding && s.player.onGround) simPress(s);
    simStep(s, world, STEP, holding);
    if (s.player.x > 560) { cleared = true; break; }
  }
  assert.equal(s.dead, false, `died at x=${s.player.x.toFixed(0)} on the triple spike`);
  assert.ok(cleared);

  // ...and the other half of the rule: contact with the spike's box now kills
  // while most of the sprite is still ahead of the player, instead of after the
  // player has walked into the middle of it.
  const into = run(worldOf([{ id: 8, x: 400, y: 15 }]), 2);
  assert.equal(into.dead, true);
  const frontEdge = into.player.x + 15;
  assert.ok(frontEdge < 400, `died only after passing the spike's centre: ${frontEdge.toFixed(1)}`);
});

test("a spike still kills, however forgiving its box is", () => {
  // The spike box is tuned for feel, so it needs a floor: shrink it too far and
  // spikes stop killing at all. Both halves of that are pinned here.
  {
    // running into a ground spike must kill
    const world = worldOf([{ id: 8, x: 400, y: 15 }]);
    const s = run(world, 2);
    assert.equal(s.dead, true, "ran straight through a spike");
    assert.equal(s.deathCause?.reason, "hazard");
  }
  {
    // ...and a spike must still be jumpable, which is the whole point of it
    // being forgiving — take off early enough to clear it
    const world = worldOf([{ id: 8, x: 400, y: 15 }]);
    const s = createSim(0, SPEEDS[1]);
    for (let i = 0; i < Math.round(3 / STEP) && !s.dead; i++) {
      const holding = s.player.x > 330 && s.player.x < 345;
      if (holding && s.player.onGround) simPress(s);
      simStep(s, world, STEP, holding);
      if (s.player.x > 440) break;
    }
    assert.equal(s.dead, false, `died jumping a single spike at x=${s.player.x.toFixed(0)}`);
  }
});

test("a floor spike pit kills a player standing on the ground", () => {
  // The counterpart to the test above: shrinking the hazard box far enough to
  // make the triple jump possible must not make floor pits walkable.
  const world = worldOf([{ id: 9, x: 300, y: 2 }]);
  const s = run(world, 1.5);
  assert.equal(s.dead, true, "walked straight over a spike pit");
  assert.equal(s.deathCause?.reason, "hazard");
});

test("under flipped gravity the floor is a ceiling, not a place to stand", () => {
  // A flipped cube that rested on the floor slid along spike pits unharmed and
  // then coasted over the rest of the level.
  const cube = run(worldOf([]), 0.5, { flip: true, y: 20, yVel: -300 });
  assert.equal(cube.dead, true);
  assert.equal(cube.deathCause?.reason, "ceiling-floor");

  // ship/UFO clamp against it instead of dying, as they do for any ceiling
  const ship = run(worldOf([]), 0.5, { flip: true, y: 20, yVel: -300, mode: "ship" });
  assert.equal(ship.dead, false);
  assert.ok(ship.player.y >= 15, `ship should be clamped at the floor, got ${ship.player.y}`);
});

test("normal gravity still lands and runs along the ground", () => {
  const s = run(worldOf([]), 2);
  assert.equal(s.dead, false);
  assert.equal(s.player.y, 15);
  assert.equal(s.player.onGround, true);
});

test("orbs need a fresh tap — holding through them fires at most one", () => {
  // The original gates `ringJump` on `_queuedHold`, which `pushButton` sets,
  // `releaseButton` clears, and the ring itself consumes. Holding the button
  // through a chain of orbs must therefore trigger only the first.
  // Stay airborne for the whole test: a grounded cube re-jumps every step while
  // held, which would look like an orb firing.
  const world = worldOf([{ id: 36, x: 60, y: 200 }, { id: 36, x: 120, y: 200 }]);
  const s = createSim(0, SPEEDS[1]);
  s.player.y = 200;
  s.player.yVel = 300;
  s.player.onGround = false;
  simPress(s); // one tap, then hold forever
  let fired = 0;
  let lastVel = s.player.yVel;
  for (let i = 0; i < Math.round(0.5 / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, true);
    if (s.player.yVel > lastVel + 100) fired++;
    lastVel = s.player.yVel;
  }
  assert.ok(s.player.onGround === false, "test must stay airborne to be meaningful");
  assert.equal(fired, 1, `one held press should fire one orb, fired ${fired}`);
});

test("a slope is a ramp, not a wall — the player rides its surface", () => {
  // id 483 is a 30x30 slope; unflipped it rises left-to-right, so a player
  // running into it should end up on the diagonal rather than dying on a box.
  const world = worldOf([{ id: 483, x: 300, y: 15 }]);
  const slope = world.colliders.find((c) => c.slope);
  assert.ok(slope, "the slope collider should carry a slope shape");
  assert.ok(slopeSurfaceY(slope, 285) < slopeSurfaceY(slope, 315),
    "this orientation should rise from left to right");

  // track the peak: the player rides up the ramp and then runs off the far end
  // back down to the floor, so the final y is 15 either way
  const st = createSim(0, SPEEDS[1]);
  let peak = 0;
  for (let i = 0; i < Math.round(1.5 / STEP) && !st.dead; i++) {
    simStep(st, world, STEP, false);
    peak = Math.max(peak, st.player.y);
  }
  assert.equal(st.dead, false, `died at x=${st.player.x.toFixed(0)} on a ramp`);
  assert.ok(peak > 35, `should have been carried up the ramp, peak y=${peak}`);
});

test("a wave rides slopes instead of dying on them", () => {
  const world = worldOf([{ id: 483, x: 300, y: 15 }]);
  const s = createSim(0, SPEEDS[1]);
  s.player.mode = "wave";
  s.player.y = 40;
  for (let i = 0; i < Math.round(1.2 / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, true); // climbing
  }
  assert.equal(s.dead, false, "the wave should ride a ramp, not crash into it");
});

test("two gravity pads entered on the SAME step still fire only once", () => {
  // The pads in level 12 sit 22 apart, so their trigger ranges overlap. Rising
  // into that band from below enters both in one step. Guarding with last
  // step's "was I on a pad" flag missed this: both fired, gravity flipped
  // twice, and the pair did nothing unless you clipped the first pad's leading
  // edge on its own. The guard has to update within the step.
  const world = worldOf([{ id: 67, x: 300, y: 73 }, { id: 67, x: 322, y: 73 }]);
  const s = createSim(305, SPEEDS[1]); // already inside BOTH pads horizontally
  s.player.y = 20;                     // below them, rising into the band
  s.player.yVel = 700;
  s.player.onGround = false;
  let flips = 0;
  let was = s.player.gravityFlipped;
  for (let i = 0; i < Math.round(0.6 / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, false);
    if (s.player.gravityFlipped !== was) { flips++; was = s.player.gravityFlipped; }
  }
  assert.equal(flips, 1, `entering both pads at once should flip once, got ${flips}`);
});

test("overlapping gravity pads fire once, not twice", () => {
  // Levels place gravity pads in overlapping pairs (level 12 has two 22 units
  // apart). The original refuses to fire a gravity pad while the player is
  // already on a pad; without that guard both fire, the flips cancel, and the
  // pair does nothing at all.
  const world = worldOf([{ id: 67, x: 300, y: 20 }, { id: 67, x: 322, y: 20 }]);
  const s = createSim(0, SPEEDS[1]);
  let flips = 0;
  let was = s.player.gravityFlipped;
  for (let i = 0; i < Math.round(1.6 / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, false);
    if (s.player.gravityFlipped !== was) { flips++; was = s.player.gravityFlipped; }
  }
  assert.equal(flips, 1, `the pair should flip gravity once, flipped ${flips} times`);
});

test("gravity pads activate only when their facing matches the player's gravity", () => {
  // Clubstep alternates floor pads with ceiling pads encoded both as -180°
  // rotations and Y flips. Each ignores arrivals under the opposite gravity.
  for (const [rotation, flipY, facesDown] of [
    [0, false, false], [-180, false, true], [0, true, true],
    [180, true, false], [90, false, false], [90.9, false, false],
    [91, false, true], [-91, false, true], [270, false, false],
  ] as const) {
    const props = new Map([[P.ROTATION, String(rotation)], [P.FLIP_Y, flipY ? "1" : "0"]]);
    const world = worldOf([{ id: 67, x: 300, y: 300, props }]);
    for (const flipped of [false, true]) {
      const s = createSim(300, 0);
      s.player.y = 300;
      s.player.onGround = false;
      flipGravity(s.player, flipped);
      simStep(s, world, STEP, false);
      assert.equal(s.player.gravityFlipped, facesDown === flipped ? !flipped : flipped,
        `rotation=${rotation} flipY=${flipY} gravity=${flipped}`);
    }
  }
});

test("a rejected gravity pad remains eligible after a co-located portal flips gravity", () => {
  const world = worldOf([
    { id: 67, x: 330, y: 300, props: new Map([[P.FLIP_Y, "1"]]) },
    { id: 11, x: 330, y: 300 },
  ]);
  const s = createSim(330, 0);
  s.player.y = 300;
  s.player.onGround = false;
  simStep(s, world, STEP, false);
  assert.equal(s.player.gravityFlipped, true, "only the portal fires on entry");
  simStep(s, world, STEP, false);
  assert.equal(s.player.gravityFlipped, false, "the ceiling pad can now fire without leaving its box");
  assert.equal(s.player.yVel, -345.6);
});

test("a pad releases the ground, so a held jump cannot weaken its launch", () => {
  // `propellPlayer` does `setIsOnGround(false)`. Without it the player counts as
  // grounded the next step, and the ordinary jump (603) overwrites the yellow
  // pad's launch (864) — the pad appears to barely fire when you hold over it.
  // Land on the pad while holding — holding from the start just bounces the
  // cube over it, which is not the case being tested.
  const world = worldOf([{ id: 35, x: 300, y: 2 }]);
  const drop = (holding: boolean) => {
    const s = createSim(250, SPEEDS[1]);
    s.player.y = 60;
    s.player.onGround = false;
    let peak = 0;
    for (let i = 0; i < Math.round(1.5 / STEP) && !s.dead; i++) {
      simStep(s, world, STEP, holding);
      peak = Math.max(peak, s.player.y);
    }
    return peak;
  };
  // a plain jump peaks near 80; the pad launch is far higher and holding the
  // button through it must not drag it back down to jump height
  assert.ok(drop(false) > 120, `pad launch too weak: ${drop(false).toFixed(0)}`);
  assert.ok(drop(true) > 120,
    `a held jump must not cap the pad launch, peak ${drop(true).toFixed(0)}`);
});

test("a wave slides along the floor instead of dying on it", () => {
  const s = createSim(0, SPEEDS[1]);
  s.player.mode = "wave";
  s.run.cameraYCenter = 150; // band floor at ground level
  s.player.y = 40;
  const world = worldOf([]);
  for (let i = 0; i < Math.round(1.5 / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, false); // diving into the floor
  }
  assert.equal(s.dead, false, "the wave should ride the floor, not crash on it");
  // the wave's own half-size: it rests 10 above the ground (Blast Processing)
  assert.ok(s.player.y >= 10 - 1e-6, `clamped at the floor, got ${s.player.y}`);
});

test("a wave still dies on ground spikes", () => {
  const world = worldOf([{ id: 8, x: 300, y: 15 }]);
  const s = createSim(0, SPEEDS[1]);
  s.player.mode = "wave";
  // the free-fly band is measured from the camera centre; put it low enough
  // that the floor of the band is the actual ground, as a ground-level wave
  // section would be
  s.run.cameraYCenter = 150;
  s.player.y = 40;
  for (let i = 0; i < Math.round(1.5 / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, false);
  }
  assert.equal(s.dead, true, "spikes on the floor must still kill a wave");
  assert.equal(s.deathCause?.reason, "hazard");
});

test("a press buffers: held early, the jump fires the instant you land", () => {
  // GD `_queuedHold` has no time limit. Holding well before touching down must
  // still jump on the very first grounded step — this is the buffered click.
  const world = worldOf([]);
  const s = createSim(0, SPEEDS[1]);
  s.player.y = 300;          // a long way up, far more than any timed buffer
  s.player.onGround = false;
  simPress(s);               // press once, now, and never release
  let landedAt = -1;
  for (let i = 0; i < Math.round(2 / STEP) && !s.dead; i++) {
    const airborne = !s.player.onGround;
    simStep(s, world, STEP, true);
    if (airborne && s.player.onGround) landedAt = i;
    // the frame after landing it must already be rising again
    if (landedAt >= 0 && i === landedAt + 1) {
      assert.ok(s.player.yVel > 0,
        `buffered press should jump on landing, yVel=${s.player.yVel.toFixed(0)}`);
      return;
    }
  }
  assert.fail("never landed");
});

test("a press buffers into an orb held from long before reaching it", () => {
  // The old model expired a press after 0.12s, so pressing early simply lost
  // it. With the real buffer the orb fires on contact however early the press.
  // The player is launched so it meets the orb near the apex of its arc — a
  // test that lets it reach the ground would see ordinary jumps, not the orb.
  const world = worldOf([{ id: 36, x: 90, y: 310 }]);
  const run = (pressAtX: number) => {
    const s = createSim(0, SPEEDS[1]);
    s.player.y = 200;
    s.player.yVel = 800;
    s.player.onGround = false;
    let pressed = false;
    let fired = false;
    let last = s.player.yVel;
    for (let i = 0; i < Math.round(0.5 / STEP) && !s.dead; i++) {
      if (!pressed && s.player.x >= pressAtX) { simPress(s); pressed = true; }
      simStep(s, world, STEP, pressed);
      // only count a boost taken high in the air, never a jump off the floor
      if (s.player.y > 150 && s.player.yVel > last + 100) fired = true;
      last = s.player.yVel;
    }
    return fired;
  };
  assert.ok(run(80), "orb should fire for a press just before it");
  assert.ok(run(0), "orb should fire for a press made well before reaching it");
});

test("releasing drops the buffer, so a stale hold does not fire an orb", () => {
  const world = worldOf([{ id: 36, x: 90, y: 310 }]);
  const s = createSim(0, SPEEDS[1]);
  s.player.y = 200;
  s.player.yVel = 800;
  s.player.onGround = false;
  simPress(s);
  let fired = false;
  let last = s.player.yVel;
  for (let i = 0; i < Math.round(0.5 / STEP) && !s.dead; i++) {
    // hold, but let go briefly before the orb — that discards the buffer
    const holding = !(s.player.x > 20 && s.player.x < 40);
    simStep(s, world, STEP, holding);
    if (s.player.y > 150 && s.player.yVel > last + 100) fired = true;
    last = s.player.yVel;
  }
  assert.equal(fired, false, "a hold whose press was released must not fire the orb");
});

test("free-fly modes are confined to a band around the camera centre", () => {
  // This, not KILL_HEIGHT, is what stops a ship climbing over a whole level:
  // outside cube the camera locks to `cameraYCenter` and the player is clamped
  // to centre ± 135 (ship/ufo), as measured from the native macros.
  const world = worldOf([]);
  const s = createSim(0, SPEEDS[1]);
  s.player.mode = "ship";
  s.player.cameraYCenter = 300; // high enough that the ground plays no part
  s.player.y = 300;
  let peak = 0, low = 1e9;
  for (let i = 0; i < Math.round(4 / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, i % 480 < 240); // thrust up, then fall, repeatedly
    peak = Math.max(peak, s.player.y);
    low = Math.min(low, s.player.y);
  }
  assert.equal(s.dead, false, "hitting the band is a clamp, not a death");
  assert.ok(Math.abs(peak - (300 + 135)) < 1e-6, `ship ceiling: ${peak.toFixed(2)}`);
  assert.ok(Math.abs(low - (300 - 135)) < 1e-6, `ship floor: ${low.toFixed(2)}`);
});

test("the band is symmetric and measured by the player's size, as the native runs show", () => {
  // every value here is a place a real run lies flat against the band
  assert.deepEqual(bandFor("ship", false), { below: 135, above: 135 });
  assert.deepEqual(bandFor("ship", true), { below: 141, above: 141 });   // L14 x=26643
  assert.deepEqual(bandFor("ball", false), { below: 105, above: 105 });  // L9 x=9044 / 9297
  assert.deepEqual(bandFor("ball", true), { below: 111, above: 111 });   // L20 x=13337
  assert.deepEqual(bandFor("wave", false), { below: 140, above: 140 });  // L17 x=15479
  assert.deepEqual(bandFor("wave", true), { below: 144, above: 144 });   // L20 x=27486
  // real robot runs reach 364 above the centre: it is not banded
  assert.equal(bandFor("robot", false), null);
  assert.equal(bandFor("cube", false), null);
});

test("an upside-down ball rolls along the band's ceiling, not one unit into it", () => {
  // L9 (Cycles) x=9297: the flipped ball rests at exactly centre + 105.
  const world = worldOf([]);
  const s = createSim(0, SPEEDS[1]);
  s.player.mode = "ball";
  s.player.gravityFlipped = true;
  s.player.cameraYCenter = 300;
  s.player.y = 380;
  s.player.onGround = false;
  for (let i = 0; i < Math.round(1 / STEP) && !s.dead; i++) simStep(s, world, STEP, false);
  assert.equal(s.dead, false);
  assert.ok(Math.abs(s.player.y - 405) < 1e-6, `flipped ball rests at ${s.player.y.toFixed(2)}`);
  assert.equal(s.player.onGround, true, "the ceiling is ground to a flipped ball");
});

test("a dual anchors both players on the dual portal's quantised centre, through gamemode portals", () => {
  // L17's dual wave portal sits at y=165 but the corridor is symmetric about
  // 150: the anchor snaps like a flying portal's (GD y < 270 -> 240). And a
  // ship portal crossed inside the dual must not move either player's band —
  // L16's real player 1 flies 390 ± 135 while crossing a portal whose own
  // centre would be 450.
  const world = worldOf([
    { id: 286, x: 300, y: 165 },
    // inside the dual's corridor (150 ± 135): above it a cube dies on the
    // dual's ceiling now, as in the game
    { id: 13, x: 400, y: 225 },
  ]);
  const s = createSim(285, SPEEDS[1]);
  s.player.y = 165;
  s.player.onGround = false;
  for (let i = 0; i < Math.round(0.2 / STEP) && !s.dead && !s.dual; i++) simStep(s, world, STEP, false);
  assert.ok(s.dual, "the partner spawned");
  assert.equal(s.player.cameraYCenter, 150);
  assert.equal(s.dual.player.cameraYCenter, 150);
  // put both players inside the ship portal's box and step through it
  s.player.x = s.dual.player.x = 395;
  s.player.y = s.dual.player.y = 225;
  s.dual.player.x = 395;
  simStep(s, world, STEP, false);
  assert.equal(s.player.mode, "ship", "player 1 took the ship portal");
  assert.equal(s.dead, false);
  assert.equal(s.player.cameraYCenter, 150, "but it did not move player 1's band");
  assert.equal(s.dual.player.cameraYCenter, 150, "nor player 2's");
});

test("a wave dies on a descending ramp's tall side instead of flying through it", () => {
  // A flipped 45-degree tile spanning x 285..315 whose tall end (y=30) faces
  // the player. The wave sliding along the ground (centre 15) meets that wall.
  const flip = new Map([[P.FLIP_X, "1"]]);
  const wall = worldOf([{ id: 483, x: 300, y: 15, props: flip }]);
  for (const holding of [false, true]) {
    // close enough that a climbing wave (45 degrees) is still below the top
    const s = createSim(276, SPEEDS[1]);
    s.player.mode = "wave";
    s.player.y = 15;
    if (holding) simPress(s);
    for (let i = 0; i < Math.round(0.3 / STEP) && !s.dead; i++) simStep(s, wall, STEP, holding);
    assert.equal(s.dead, true, `wave ${holding ? "climbing" : "sliding"} into the wall must die`);
    assert.equal(s.deathCause?.reason, "wave-solid");
    assert.ok(s.player.x < 290, `it died at the wall, x=${s.player.x.toFixed(1)}`);
  }
  // ...but passing clear over the top of the same tile is fine
  const over = createSim(250, SPEEDS[1]);
  over.player.mode = "wave";
  over.player.y = 60;
  over.player.cameraYCenter = 150;
  simPress(over);
  for (let i = 0; i < Math.round(0.25 / STEP) && !over.dead; i++) simStep(over, wall, STEP, true);
  assert.equal(over.dead, false, `a wave above the ramp is untouched: ${over.deathCause?.reason}`);
  assert.ok(over.player.x > 320);
});

test("a ramp's tall side flush against the previous tile is not a wall", () => {
  // A descending staircase: the second tile's tall end (y 0..30) is covered by
  // the first tile's solid at its low end (y -30..30 would be the full box;
  // its surface there is 30). A wave crossing the joint must not die on it.
  const flip = new Map([[P.FLIP_X, "1"]]);
  const stairs = worldOf([
    { id: 1, x: 270, y: 15 },                     // a block whose right side is x=285
    { id: 483, x: 300, y: 15, props: flip },      // ramp whose tall end abuts it
  ]);
  const w = stairs.near({ x: 290, y: 20, hw: 20, hh: 20 });
  const ramp = w.find((c) => c.slope)!;
  assert.ok(ramp, "the ramp is in the world");
  assert.equal(hitsSlopeWall({ x: 285, y: 20, hw: 3.75, hh: 3.75 }, ramp, w), false,
    "the block covers the ramp's tall side");
  assert.equal(hitsSlopeWall({ x: 285, y: 20, hw: 3.75, hh: 3.75 }, ramp, [ramp]), true,
    "without the block it is a wall");
});

test("a cube is not confined by the band, and its camera uses a deadzone", () => {
  const world = worldOf([]);
  const s = createSim(0, SPEEDS[1]);
  s.run.cameraYCenter = 150;
  s.player.y = 600;           // far above any band ceiling
  s.player.onGround = false;
  for (let i = 0; i < Math.round(0.3 / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, false);
  }
  assert.equal(s.dead, false, "a cube above the band must be unaffected by it");
  assert.ok(s.player.y > 400, "and must simply keep falling");
});

test("a ramp launches the player when it ends, more so when steeper", () => {
  // `getModifiedSlopeYVel()` releases the stored climb rate when the ramp ends.
  // The climb rate is speed * gradient, so a 45-degree tile (gradient 1) must
  // throw the player harder than a 2:1 one (gradient 0.5).
  const peakOver = (id: number) => {
    const world = worldOf([{ id, x: 300, y: 15 }]);
    const s = createSim(0, SPEEDS[1]);
    let peak = 0;
    for (let i = 0; i < Math.round(2 / STEP) && !s.dead; i++) {
      simStep(s, world, STEP, false);
      peak = Math.max(peak, s.player.y);
    }
    assert.equal(s.dead, false, `died on ramp id ${id}`);
    return peak;
  };
  const steep = peakOver(483);   // 30x30, gradient 1
  const shallow = peakOver(493); // 60x30, gradient 0.5
  assert.ok(steep > 45, `a 45-degree ramp should launch, peak ${steep.toFixed(0)}`);
  assert.ok(steep > shallow,
    `steeper should launch higher: 45deg ${steep.toFixed(0)} vs 2:1 ${shallow.toFixed(0)}`);
});

test("a teleport portal lands you at an absolute y, measured from the portal", () => {
  // `getPortalTargetPos` returns `object.y + m_teleportYOffset` for id 747, so
  // the landing spot must NOT depend on where in the portal you entered —
  // otherwise you drop out below the pads the level puts at the destination.
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [{
      id: 747, x: 300, y: 197,
      props: new Map<number, string>([[3, "197"], [54, "-151"]]),
    }],
  } as unknown as Level;
  const world = new CollisionWorld(level, () => ({ w: 44, h: 80 }));

  const land = (enterY: number) => {
    const s = createSim(250, SPEEDS[1]);
    s.player.y = enterY;
    s.player.onGround = false;
    for (let i = 0; i < Math.round(0.35 / STEP) && !s.dead; i++) {
      const before = s.player.y;
      simStep(s, world, STEP, false);
      if (Math.abs(s.player.y - before) > 50) return s.player.y; // the jump
    }
    return null;
  };
  // entering high or low in the portal must give the same destination
  assert.equal(land(210), 46, "entering high should land at portal.y + offset");
  assert.equal(land(180), 46, "entering low should land at the same place");
});

test("a pad fires once per attempt unless it is Multi Activate (key 99)", () => {
  // Fingerdash f7978 / Clubstep f7074: coming back to a pad already used this
  // attempt does not launch again. (`touching` is still rebuilt every step —
  // it once latched a pad the player had only grazed; see Deadlocked's
  // teleport onto pads, whose native replay is unchanged by this rule.)
  const run = (multi: boolean) => {
    const props = new Map<number, string>(multi ? [[99, "1"]] : []);
    const world = worldOf([{ id: 35, x: 100, y: 34, props }]);
    const s = createSim(60, SPEEDS[1]);
    s.player.y = 20;            // graze the pad's box on the way past: it fires
    s.player.onGround = false;
    for (let i = 0; i < Math.round(0.6 / STEP) && !s.dead; i++) simStep(s, world, STEP, false);
    assert.ok(s.player.x > 200, "should have travelled well past the pad");
    // come back to it (as a teleport would)
    s.player.x = 100;
    s.player.y = 38;
    s.player.yVel = 0;
    s.player.onGround = false;
    let fired = false;
    const before = s.player.yVel;
    for (let i = 0; i < 4 && !s.dead; i++) {
      simStep(s, world, STEP, false);
      if (s.player.yVel > before + 100) fired = true;
    }
    return fired;
  };
  assert.equal(run(false), false, "a spent pad does not fire again");
  assert.equal(run(true), true, "a Multi Activate pad does");
});

test("an orb fires once per touch, however many times you click it", () => {
  // Releasing and re-pressing while still sitting on the same orb must not
  // re-trigger it; only the multi-activate flag (key 99) allows that.
  const world = worldOf([{ id: 36, x: 400, y: 200 }]);
  const s = createSim(360, SPEEDS[1]);
  s.player.y = 200;
  s.player.yVel = 0;
  s.player.onGround = false;
  let fired = 0;
  let last = s.player.yVel;
  for (let i = 0; i < 40; i++) {
    // tap repeatedly: press, release, press, release ...
    const holding = i % 2 === 0;
    if (holding) simPress(s);
    simStep(s, world, STEP, holding);
    if (s.player.yVel > last + 100) fired++;
    last = s.player.yVel;
  }
  assert.equal(fired, 1, `repeated clicks on one orb should fire it once, got ${fired}`);
});

test("an ascending ramp is never a wall, however low you land on it", () => {
  // Whether a slope is ridable or a wall is decided at its *entry* edge, not at
  // the player's current x. An ascending ramp presents its low end first, so
  // landing partway up it — as a ball arcing off the previous ramp does — must
  // roll you up, not kill you.
  const world = worldOf([{ id: 483, x: 300, y: 15 }]);   // rises 0 -> 30
  const s = createSim(300, SPEEDS[1]);
  s.player.y = 12;          // well below the surface at this x (which is 15)
  s.player.yVel = -50;
  s.player.onGround = false;
  simStep(s, world, STEP, false);
  assert.equal(s.dead, false, "landing partway up an ascending ramp must not kill");
  assert.ok(s.player.y > 12, `should be carried up the ramp, y=${s.player.y}`);
});

test("a breakable block breaks instead of killing you, but still holds you up", () => {
  // `GameObjectType::Breakable` (21, only id 143) is bucketed with the solids and
  // behaves as one — you land and stand on it — except at the one point where an
  // ordinary solid calls `destroyPlayer`: there it calls `destroyObject` on
  // itself instead. Making them non-solid is the wrong model and measurably
  // worse: the same blocks are load-bearing platforms elsewhere in level 13.
  {
    // running into a wall of them at ground level must break them, not kill
    const world = worldOf([{ id: 143, x: 400, y: 15 }, { id: 143, x: 400, y: 45 }]);
    const s = createSim(300, SPEEDS[1]);
    for (let i = 0; i < Math.round(0.8 / STEP) && !s.dead; i++) {
      simStep(s, world, STEP, false);
    }
    assert.equal(s.dead, false, "a breakable wall must not kill the player");
    assert.ok(s.player.x > 430, `should pass through the broken wall, x=${s.player.x}`);
    assert.ok(s.destroyed.size > 0, "the block it hit should be recorded as destroyed");
  }
  {
    // ...but landing on one from above still lands, and does NOT break it
    const world = worldOf([{ id: 143, x: 400, y: 15 }]);
    const s = createSim(400, SPEEDS[1]);
    s.player.y = 120;
    s.player.yVel = -200;
    s.player.onGround = false;
    for (let i = 0; i < Math.round(0.3 / STEP) && !s.dead; i++) {
      simStep(s, world, STEP, false);
    }
    assert.equal(s.dead, false, "landing on a breakable must not kill");
    assert.equal(s.destroyed.size, 0, "landing on a breakable must not break it");
    assert.ok(s.player.onGround, "the player should be standing on it");
  }
});

test("you can jump off a descending ramp", () => {
  // The surface-following that stops a descent stuttering must never hold a
  // player who is moving *away* from the surface. A jump lifts the player only
  // ~2.5 units in one 240 Hz step, so an ungated stick band re-lands them and
  // zeroes the jump before it leaves the ground — reported as "I literally
  // cannot jump off the slope, I get glued to it". The original gates the same
  // band on `!m_isJumping` (`collidedWithSlopeInternal`).
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [0, 60, 120, 180].map((dx) => ({
      id: 493, x: 300 + dx, y: 105 - dx / 2,
      props: new Map<number, string>([[4, "1"]]),
    })),
  } as unknown as Level;
  const world = new CollisionWorld(level, () => ({ w: 60, h: 30 }));
  const s = createSim(300, SPEEDS[1]);
  s.player.y = 120;
  s.player.onGround = true;
  let jumped = false, yAtJump = 0, rose = 0;
  for (let i = 0; i < Math.round(0.9 / STEP) && !s.dead; i++) {
    const holding = s.player.x >= 380;
    if (holding && !jumped) { simPress(s); jumped = true; yAtJump = s.player.y; }
    simStep(s, world, STEP, holding);
    if (jumped) rose = Math.max(rose, s.player.y - yAtJump);
  }
  assert.equal(s.dead, false, "jumping off a ramp must not kill");
  // a cube jump clears ~65 units; anything near zero means the ramp ate it
  assert.ok(rose > 40, `jump off a descending ramp only rose ${rose.toFixed(1)} units`);
});

test("a downhill ramp is followed smoothly, not as a staircase", () => {
  // Going downhill the surface falls away faster than the player does, so
  // without surface-following the player leaves the ramp, falls, lands and
  // leaves again — a stutter that reads as the ramp being a flight of steps.
  // id 493 is a 2:1 tile; flipX makes it descend left-to-right.
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [0, 60, 120].map((dx) => ({
      id: 493, x: 300 + dx, y: 105 - dx / 2,
      props: new Map<number, string>([[4, "1"]]),
    })),
  } as unknown as Level;
  const world = new CollisionWorld(level, () => ({ w: 60, h: 30 }));
  const s = createSim(280, SPEEDS[1]);
  s.player.y = 135;
  s.player.onGround = true;
  let flips = 0;
  let was = s.player.onGround;
  for (let i = 0; i < Math.round(0.55 / STEP) && !s.dead; i++) {
    simStep(s, world, STEP, false);
    if (s.player.x < 300 || s.player.x > 420) continue;
    if (s.player.onGround !== was) { flips++; was = s.player.onGround; }
  }
  assert.equal(s.dead, false, "should ride the descent, not die on it");
  assert.ok(flips <= 2,
    `descent should stay glued to the ramp, but left the ground ${flips} times`);
});

test("the dual partner spawns mirrored and receives the same button presses", () => {
  // Two separate bugs are pinned here, both reported as "I can't click orbs in
  // the dual and it just feels wrong":
  //   1. the partner is a MIRROR about the portal's y, not a copy at the same
  //      spot (co-located, it spawns inside the floor);
  //   2. `simPress` must press BOTH players. The partner has its own
  //      `queuedHold`/`justHeld`, and orbs, ball jumps, spider teleports and UFO
  //      flaps all read those — an ordinary cube jump only reads `holding`,
  //      which is why the partner looked half-working: it ran and jumped but
  //      could not use an orb.
  const world = worldOf([{ id: 286, x: 300, y: 200 }]);
  // start just short of the portal: a falling cube drops out of a portal's
  // 30-unit box quickly, so cross it almost immediately
  const s = createSim(285, SPEEDS[1]);
  s.player.y = 190;  // off the portal's own y, so a mirror would show
  s.player.yVel = 0;
  s.player.onGround = false;
  for (let i = 0; i < Math.round(0.2 / STEP) && !s.dead && !s.dual; i++) {
    simStep(s, world, STEP, false);
  }
  assert.ok(s.dual, "crossing a dual portal must spawn the partner");

  const p1 = s.player, p2 = s.dual.player;
  assert.equal(p2.gravityFlipped, !p1.gravityFlipped, "the partner has opposite gravity");
  // On player 1, not mirrored about the portal: every native dual start
  // (Blast Processing f11818, Deadlocked f17088, Hexagon Force f7047...)
  // has p2 at p1's own (x, y). They part at once — gravity pulls them
  // opposite ways — so allow a step's worth of drift.
  assert.ok(Math.abs(p1.y - p2.y) < 0.5, `partner should start on player 1: p1=${p1.y}, p2=${p2.y}`);

  simPress(s);
  assert.equal(s.player.queuedHold, true, "player 1 got the press");
  assert.equal(s.dual.player.queuedHold, true, "the partner must get the press too");
  assert.equal(s.dual.player.justHeld, true, "...including justHeld, which the UFO flap reads");
});

test("a spider touching an orb spends its press on the orb, not on a teleport", async () => {
  // The cube already has this rule: an ordinary jump clears `_queuedHold` only
  // when no ring is being touched, so a press over an orb reaches the orb. The
  // spider had no such guard, so its teleport ate every press made on an orb —
  // which is why Fingerdash could never take the pink orb at (13275, 195) into
  // the dash orb at (13359, 221), and stopped at 58.7%.
  const { loadWorld } = await import("../scripts/headless.mjs");
  const { createSim, simStep, simPress } = await import("../src/game/sim.ts");
  const { setGamemode } = await import("../src/gd/gamemodes.ts");
  const { world } = await loadWorld(21);

  const onOrb = createSim(13275, 311.58);
  setGamemode(onOrb.player, "spider");
  onOrb.player.y = 195;          // right on Fingerdash's pink orb
  onOrb.player.onGround = false;
  // one idle step so the collision pass records the ring — the jump it causes
  // runs at the top of the step *after* the touch, as `ringJump` does
  simStep(onOrb, world, 1 / 240, false);
  assert.ok(onOrb.onOrb && onOrb.touchedOrb, "the spider is on the pink orb");
  simPress(onOrb);
  simStep(onOrb, world, 1 / 240, true);
  // a teleport flips gravity and jumps to another surface, tens of units away;
  // the orb just starts it moving up
  assert.equal(onOrb.player.gravityFlipped, false, "no teleport happened");
  assert.ok(onOrb.player.y > 195 && onOrb.player.y - 195 < 2,
    `the orb lifted the spider one step, y=${onOrb.player.y}`);
  // The press reached the orb instead: pink is 0.72 of the jump, spider 0.7 —
  // less this step's gravity, because `ringJump` runs *before* the step moves.
  const pink = 603.72 * 0.72 * 0.7 - (2794.108 * 0.6) / 240;
  assert.ok(Math.abs(onOrb.player.yVel - pink) < 5,
    `the pink orb fired, yVel=${onOrb.player.yVel}, expected ~${pink.toFixed(2)}`);

  // and with no orb under it, the very same press teleports — from the ground
  // (a spider only flips from a surface: Fingerdash f9386)
  const free = createSim(13275, 311.58);
  setGamemode(free.player, "spider");
  free.player.y = 195;
  free.player.onGround = true;
  free.onOrb = false;
  free.touchedOrb = null;
  simPress(free);
  simStep(free, world, 1 / 240, true);
  assert.equal(free.player.gravityFlipped, true, "with no orb the press teleports");
  assert.ok(Math.abs(free.player.y - 195) > 1);

  // in mid-air the press is kept, not spent on a teleport
  const air = createSim(13275, 311.58);
  setGamemode(air.player, "spider");
  air.player.y = 195;
  air.player.onGround = false;
  air.onOrb = false;
  air.touchedOrb = null;
  simPress(air, world);
  assert.equal(air.player.gravityFlipped, false, "no teleport in mid-air");
  assert.equal(air.player.queuedHold, true, "the press stays buffered");
});

test("a grounded spider teleports on the press itself, resting 13.5 from the surface", async () => {
  // Fingerdash f8321: the recorded position shows the flip on the press's own
  // frame; the real spider rests 13.5 (not 15) from floors and ceilings
  const { SPIDER_SIZE } = await import("../src/gd/interactives.ts");
  assert.equal(SPIDER_SIZE, 0.9);
  const world = worldOf([{ id: 1, x: 300, y: 200 }]); // ceiling underside at 185
  const s = createSim(300, SPEEDS[1]);
  s.player.mode = "spider";
  s.player.y = 13.5; s.player.onGround = true;
  simPress(s, world);
  assert.equal(s.player.gravityFlipped, true, "flipped at the press");
  assert.ok(Math.abs(s.player.y - (185 - 13.5)) < 1e-9, `rests at ${s.player.y}`);
});

test("an S block ends a dash the moment the player touches it", () => {
  // Fingerdash's native run: the dash ends on the first frame the player's box
  // reaches the S column at x=2741, and the player falls from rest.
  const run = (withS: boolean) => {
    const world = worldOf(withS ? [{ id: 1829, x: 300, y: 100 }] : []);
    const s = createSim(250, SPEEDS[1]);
    s.player.y = 100; s.player.onGround = false; s.player.dash = 1;
    let stoppedAt = Infinity;
    for (let i = 0; i < Math.round(0.3 / STEP) && !s.dead; i++) {
      simStep(s, world, STEP, true);
      if (s.player.dash === 0 && stoppedAt === Infinity) stoppedAt = s.player.x;
    }
    return { s, stoppedAt };
  };
  const hit = run(true);
  assert.ok(hit.stoppedAt >= 270 && hit.stoppedAt < 273, `stopped at x=${hit.stoppedAt}`);
  assert.ok(hit.s.player.y < 100, "and then falls");
  const clear = run(false);
  assert.equal(clear.s.player.dash, 1, "without the S block a held dash carries on");
});

test("a J block stops a held button re-jumping off the ground; a fresh press still jumps", () => {
  const trial = (withJ: boolean, press: boolean) => {
    const world = worldOf(withJ ? [{ id: 1813, x: 300, y: 15 }] : []);
    const s = createSim(290, SPEEDS[1]);
    // two steps on the J block so the flag is up when the jump is decided
    simStep(s, world, STEP, false);
    simStep(s, world, STEP, false);
    if (press) simPress(s);
    simStep(s, world, STEP, true);
    return s.player.onGround === false && s.player.yVel > 0;
  };
  assert.equal(trial(false, false), true, "holding normally jumps off the ground");
  assert.equal(trial(true, false), false, "a held button does not auto-jump on a J block");
  assert.equal(trial(true, true), true, "a fresh press still jumps there");
});

test("an H block turns a cube's head hit into a bump instead of a death", () => {
  const trial = (withH: boolean) => {
    const objs = [{ id: 1, x: 300, y: 90 }];      // block underside at y=75
    if (withH) objs.push({ id: 1859, x: 300, y: 68 });
    const world = worldOf(objs);
    const s = createSim(295, SPEEDS[1]);
    s.player.y = 50; s.player.yVel = 600; s.player.onGround = false;
    for (let i = 0; i < 20 && !s.dead; i++) simStep(s, world, STEP, false);
    return s;
  };
  const bare = trial(false);
  assert.equal(bare.dead, true, "a cube dies hitting a ceiling with its head");
  const safe = trial(true);
  assert.equal(safe.dead, false, `with an H block it survives: ${safe.deathCause?.reason}`);
  assert.ok(safe.player.y <= 60 + 1e-6, `and is held under the block, y=${safe.player.y}`);
});

test("a D block lets the wave slide along a solid instead of dying on it", () => {
  const trial = (withD: boolean) => {
    const objs = [{ id: 1, x: 300, y: 90 }];      // ceiling block, underside y=75
    if (withD) objs.push({ id: 1755, x: 300, y: 68 });
    const world = worldOf(objs);
    const s = createSim(280, SPEEDS[1]);
    s.player.mode = "wave";
    s.player.y = 55;
    simPress(s);
    for (let i = 0; i < Math.round(0.1 / STEP) && !s.dead; i++) simStep(s, world, STEP, true);
    return s;
  };
  assert.equal(trial(false).dead, true, "a wave dies on a solid");
  const slid = trial(true);
  assert.equal(slid.dead, false, `with a D block it slides: ${slid.deathCause?.reason}`);
  assert.ok(slid.player.x > 300, "past the block");
});

test("solids are resolved before hazards: a landing lifts the player clear of a spike's tip", () => {
  // Can't Let Go frame 2437, native: the cube drops past the spike at
  // (3165, 15) while its right edge overlaps the next block by 0.74 units;
  // the block lifts it to y=45 and the run carries on.
  const world = worldOf([{ id: 8, x: 3165, y: 15 }, { id: 1, x: 3195, y: 15 }]);
  const s = createSim(3164.44, SPEEDS[1]);
  s.player.y = 36.51;
  s.player.yVel = -481;
  s.player.onGround = false;
  simStep(s, world, STEP, false);
  assert.equal(s.dead, false, `died on ${s.deathCause?.reason} ${s.deathCause?.id}`);
  assert.ok(Math.abs(s.player.y - 45) < 1e-6, `landed at y=${s.player.y}`);
});

test("a ring touched while held still fires on the frame the button comes up", () => {
  // Hexagon Force frame 2002: the press was buffered mid-air, the blue orb is
  // first touched in frame 2001's collision pass, and the game fires it on
  // 2002 — the frame the release lands — so the ring jump runs before it.
  const world = worldOf([{ id: 84, x: 300, y: 100 }]);
  const s = createSim(300, SPEEDS[1]);
  s.player.y = 72;          // inside the orb's reach (15 + 18 = 33 below its centre)
  s.player.yVel = 0;
  s.player.onGround = false;
  simPress(s);
  simStep(s, world, STEP, true);   // touch recorded, button still down
  simStep(s, world, STEP, false);  // released this frame
  assert.equal(s.player.gravityFlipped, true, "the blue orb fired");
});

test("a ship bumps a ceiling on the first frame its top crosses it", () => {
  // Theory of Everything frame 2046: the real ship clamps to y=165 under a
  // block whose underside is at 180 the moment its top passes 180.
  const world = worldOf([{ id: 1, x: 2655, y: 195 }]);
  const s = createSim(2654.95, SPEEDS[1]);
  s.player.mode = "ship";
  s.player.cameraYCenter = 150;
  s.player.y = 163.858;
  s.player.yVel = 432;
  s.player.onGround = false;
  simStep(s, world, STEP, true);
  assert.equal(s.dead, false);
  assert.ok(Math.abs(s.player.y - 165) < 1e-6, `clamped to y=${s.player.y}`);
});

test("a cube rides a ramp 15 perpendicular to it and starts climbing before it", () => {
  // Geometrical Dominator f206-251: on a 2:1 ramp the real cube rides
  // 15 * sqrt(1.25) = 16.77 above the surface under its centre, so it leaves
  // the ground 3.54 units before the ramp begins.
  const world = worldOf([{ id: 493, x: 300, y: 15 }]); // 2:1 ramp, 270..330
  const s = createSim(250, SPEEDS[1]);
  let early = Infinity;
  for (let i = 0; i < 60 && !s.dead; i++) {
    simStep(s, world, STEP, false);
    if (s.player.y > 15 + 1e-6 && early === Infinity) early = s.player.x;
    const x = s.player.x;
    if (x > 280 && x < 320) {
      const want = 0.5 * (x - 270) + 15 * Math.sqrt(1.25);
      assert.ok(Math.abs(s.player.y - want) < 0.05, `x=${x.toFixed(2)} y=${s.player.y.toFixed(3)} want ${want.toFixed(3)}`);
    }
  }
  assert.ok(early > 265.5 && early < 268, `climb started at x=${early}`);
});

test("a ramp's launch velocity is the game's m_slopeVelocity", async () => {
  const { slopeLaunchVelocity } = await import("../src/game/collision.ts");
  const ramp = (hw: number, hh: number) => ({ hw, hh } as never);
  // native: 215.94 off a 2:1 at 1x (GD f254), 399.89 off a 45 (GD f506),
  // and x0.75 for a non-cube mode at 2x: 372.92 (Hexagon Force f4564)
  assert.ok(Math.abs(slopeLaunchVelocity(ramp(30, 15), 311.58, "cube") - 215.94) < 0.1);
  assert.ok(Math.abs(slopeLaunchVelocity(ramp(15, 15), 311.58, "cube") - 399.89) < 0.1);
  assert.ok(Math.abs(slopeLaunchVelocity(ramp(15, 15), 387.42, "ball") - 372.92) < 0.2);
});

test("a pad reached on the landing frame launches without a landing snap", () => {
  // Electrodynamix frame 1134: the real cube meets a yellow pad as it reaches
  // the platform and launches from 0.74 inside it, never snapped on top.
  const world = worldOf([{ id: 1, x: 1470, y: 45 }, { id: 35, x: 1472, y: 62 }]);
  const s = createSim(1470.92, SPEEDS[1]);
  s.player.y = 74.904;
  s.player.yVel = -142.776;
  s.player.onGround = false;
  simStep(s, world, STEP, false);
  assert.ok(Math.abs(s.player.y - 74.2605) < 0.01, `y=${s.player.y}`);
  assert.ok(s.player.yVel > 800, `launched: ${s.player.yVel}`);
});

test("the wave meets portals with its own small box", () => {
  // Deadlocked frame 654: the real wave shrinks at the mini portal (101 at
  // x=867, hitbox half-width 15.5) only when its 3.75 box reaches it.
  const world = worldOf([{ id: 101, x: 867, y: 149 }]);
  const s = createSim(840, SPEEDS[1]); // full box would already overlap (855 > 851.5)
  s.player.mode = "wave";
  s.player.y = 149;
  s.player.onGround = false;
  simStep(s, world, STEP, false);
  assert.equal(s.player.mini, false, "not yet: the wave box is still 10 units short");
  for (let i = 0; i < 10 && s.player.x < 849.1; i++) simStep(s, world, STEP, false);
  assert.equal(s.player.mini, true, `mini by x=${s.player.x.toFixed(2)}`);
});

test("landing on breakable bricks never triggers the rhythm snap", () => {
  // Electroman Adventures frame 2121: the real cube lands from the brick at
  // (2685, 105) onto the one at (2775, 165) — a snapping offset — and keeps
  // its x. (143 is the breakable brick.)
  const world = worldOf([{ id: 143, x: 2685, y: 105 }, { id: 143, x: 2775, y: 165 }]);
  const s = createSim(2665.87, SPEEDS[1]);
  s.player.y = 135;
  s.player.snapObject = -1;
  simStep(s, world, STEP, false);            // standing on the first brick
  s.player.x = 2754.162; s.player.y = 195.3432; s.player.yVel = -177.768; s.player.onGround = false;
  const before = s.player.x;
  simStep(s, world, STEP, false);            // lands on the second
  assert.ok(Math.abs(s.player.x - (before + 311.58 * STEP)) < 1e-3, `x moved to ${s.player.x}`);
});

test("an uphill rider barely faster than the ramp stays on it", async () => {
  // Theory of Everything 2 f3006-3010: a held ship riding a 45 at 2x keeps
  // exactly the ramp's rate though its thrust carries it a hair off the line.
  const { resolveSlope, slopeRideTarget } = await import("../src/game/collision.ts");
  const world = worldOf([{ id: 483, x: 300, y: 15 }]);
  const ramp = world.near({ x: 300, y: 15, hw: 5, hh: 5 }).find((c) => c.slope)!;
  const px = 300;
  const line = slopeRideTarget(ramp, px, 15)!;
  const r = resolveSlope(px, line + 0.02, 387.42 + 5.5, ramp, 1, 1, true, true, 387.42);
  assert.equal(r.result, "land");
  assert.ok(Math.abs(r.landY - line) < 1e-9);
  // a real jump off the ramp is not held back
  const j = resolveSlope(px, line + 2, 387.42 + 300, ramp, 1, 1, true, true, 387.42);
  assert.equal(j.result, "none");
});

test("the wave slides along the ground 10 above it, not 15", () => {
  // Blast Processing frame 4255 on: the real wave rides the floor at y=10.
  const s = createSim(100, SPEEDS[1]);
  s.player.mode = "wave";
  s.player.y = 20;
  s.player.onGround = false;
  for (let i = 0; i < 30; i++) simStep(s, worldOf([]), STEP, false);
  assert.equal(s.dead, false);
  assert.ok(Math.abs(s.player.y - 10) < 1e-9, `rests at y=${s.player.y}`);
});

test("a ramp that takes the player beats a ledge reaching only under its box edge", () => {
  // Hexagon Force f5887: thin ledge 468 (30x1.5) ends at x=140 where downhill
  // ramp 484 (2:1, flipped) starts; a cube landing 4 past the ledge's end rides
  // the ramp's line, not the ledge's top at 224.95.
  const world = worldOf([
    { id: 468, x: 125, y: 209.2 },
    { id: 484, x: 170, y: 195, props: new Map([[P.FLIP_X, "1"]]) },
  ]);
  const s = createSim(144, SPEEDS[1]);
  s.player.y = 226; s.player.yVel = -600; s.player.onGround = false;
  simStep(s, world, STEP, false);
  const px = s.player.x;
  const line = 210 - (px - 140) * 0.5 + 15 * Math.sqrt(1.25);
  assert.equal(s.dead, false);
  assert.ok(s.player.onGround, "landed");
  // (the native routine works in float32, as the game does)
  assert.ok(Math.abs(s.player.y - line) < 1e-4, `y=${s.player.y}, ramp line ${line}`);
});

test("on a staircase of ramps the tile being left cannot snap the rider back down", () => {
  // Hexagon Force f6383: 45° tiles at (135,135) and (165,165) as at x=9435/9465;
  // crossing the joint the next tile's line lifts the cube above 165, and the
  // first tile's ledge snap (to 165) must not pull it back.
  // the next tile listed first, as the level does, so it resolves first
  const world = worldOf([{ id: 483, x: 165, y: 165 }, { id: 483, x: 135, y: 135 }]);
  // the real frame before, shifted by -9300 (2x speed, 1.614 per step)
  const s = createSim(143.212891, SPEEDS[2]);
  const p = s.player;
  p.y = 164.426094; p.yVel = 329.346; p.onGround = true; p.slopeTime = 0.05;
  simStep(s, world, STEP, false);
  assert.equal(s.dead, false);
  assert.ok(p.y > 165 + 1e-6, `rode on up the next tile: y=${p.y}`);
});

test("a grounded player rides a platform a move trigger is lowering", async () => {
  // Geometrical Dominator f5813: the ship lands on group 11's block while a
  // move lowers it, and is carried down with it instead of falling off.
  const { buildTriggers, movableGroups } = await import("../src/gd/triggers.ts");
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      // a platform long enough to stand on for the whole second
      ...Array.from({ length: 16 }, (_, i) =>
        ({ id: 1, x: 150 + 30 * i, y: 90, props: new Map([[57, "11"]]) })),
      { id: 901, x: 10, y: 0, props: new Map([[51, "11"], [29, "-20"], [10, "2"]]) },
    ],
  } as unknown as Level;
  const world = new CollisionWorld(level, () => ({ w: 30, h: 30 }),
    movableGroups(buildTriggers(level)));
  // a ship, whose first falling steps are tiny — a cube falls faster than
  // this platform and would land on it again every step regardless
  const s = createSim(140, SPEEDS[1], level);
  s.player.mode = "ship";
  s.player.y = 120; s.player.onGround = true; s.player.yVel = 0;
  simStep(s, world, STEP, false); // lands
  let off = 0;
  for (let i = 0; i < 240; i++) {
    simStep(s, world, STEP, false);
    if (!s.player.onGround) off++;
  }
  assert.equal(s.dead, false);
  assert.equal(off, 0, "carried every step, never falling free");
  const blockTop = 90 + 15 + (s.triggers!.rt.groups.get(11)?.dy ?? 0);
  assert.ok(s.triggers!.rt.groups.get(11)!.dy < -5, "the platform has moved down");
  assert.ok(Math.abs(s.player.y - (blockTop + 15)) < 1e-6, `y=${s.player.y}, top ${blockTop}`);
});

test("inside an F block a head hit flips gravity instead of killing the cube", () => {
  // Dash f3012: `didHitHead` with `m_stateFlipGravity` set flips gravity and
  // sets the velocity to 2.0 raw toward the new ground
  const world = worldOf([
    { id: 1, x: 300, y: 260 },        // ceiling, underside at 245
    { id: 2866, x: 300, y: 220 },     // F block around the player
  ]);
  const s = createSim(300, SPEEDS[1]);
  s.player.y = 225; s.player.yVel = 500; s.player.onGround = false;
  for (let i = 0; i < 4 && !s.player.gravityFlipped; i++) simStep(s, world, STEP, false);
  assert.equal(s.dead, false, "the head hit did not kill");
  assert.equal(s.player.gravityFlipped, true, "gravity flipped");
  const without = worldOf([{ id: 1, x: 300, y: 260 }]);
  const d = createSim(300, SPEEDS[1]);
  d.player.y = 225; d.player.yVel = 500; d.player.onGround = false;
  for (let i = 0; i < 30 && !d.dead; i++) simStep(d, without, STEP, false);
  assert.equal(d.dead, true, "without the F block the same hit kills");
});

test("the wave rides a ramp 10·√2 above it, not 15·√2", () => {
  // Geometrical Dominator f7053: the real wave descends past 15·√2
  const world = worldOf([{ id: 483, x: 165, y: 45 }]); // 45° ramp, x 150..180, y 30..60
  const s = createSim(157.67, SPEEDS[1]);
  s.player.mode = "wave";
  const line = 30 + (157.67 - 150);
  s.player.y = line + 15 * Math.SQRT2 + 0.5; s.player.yVel = -311.58; s.player.onGround = false;
  simStep(s, world, STEP, false);
  assert.ok(!s.player.onGround, "still descending past the cube's ride line");
});

test("a mini player's landing tolerance shrinks with it (Clubstep f9604)", () => {
  // a mini ball 9.33 inside a block's top, just over its edge, is lifted on
  const world = worldOf([{ id: 1, x: 195, y: 225 }]); // top at 240
  const s = createSim(170.3, SPEEDS[1]);
  s.player.mode = "ball"; s.player.mini = true;
  s.player.y = 240.67; s.player.yVel = -156.168; s.player.onGround = false;
  simStep(s, world, STEP, false);
  assert.equal(s.dead, false);
  assert.ok(Math.abs(s.player.y - 249) < 1e-9, `landed at ${s.player.y}`);
});

test("a ship heading into a wedge's underside snaps onto its ride line from 1 short", async () => {
  // Theory of Everything 2 f8815: 2:1 ceiling wedge, ship thrusting up at 398
  const { resolveSlope, slopeRideTarget } = await import("../src/game/collision.ts");
  const wedge = { kind: "solid", x: 100, y: 60, hw: 30, hh: 15, id: 674, groups: [],
    slope: { cx: -1 as const, cy: 1 as const } };
  const target = slopeRideTarget(wedge as never, 95, 15)!;
  const r = resolveSlope(95, target - 0.58, 398, wedge as never, 1, 1, true);
  assert.equal(r.result, "bump");
  assert.ok(Math.abs(r.landY - target) < 1e-9);
  const far = resolveSlope(95, target - 1.5, 398, wedge as never, 1, 1, true);
  assert.equal(far.result, "none", "not yet within reach");
});

test("objects listed after a teleport are met at its exit in the same pass", () => {
  // Deadlocked f11480: teleport, then (later in the list) a yellow pad and a
  // normal-gravity portal at the exit — the flipped cube leaves falling
  const make = (padFirst: boolean) => {
    const tele = { id: 747, x: 100, y: 300, props: new Map<number, string>([[54, "-200"]]) };
    const pad = { id: 35, x: 100, y: 100 };
    const portal = { id: 10, x: 100, y: 100 };
    return worldOf(padFirst ? [pad, portal, tele] : [tele, pad, portal]);
  };
  const run = (world: CollisionWorld) => {
    const s = createSim(95, SPEEDS[1]);
    s.player.y = 300;
    s.player.gravityFlipped = true;
    s.player.yVel = 600;
    simStep(s, world, STEP, false);
    return s.player;
  };
  const after = run(make(false));
  assert.equal(after.gravityFlipped, false, "the gravity portal after the teleport flips on the same step");
  assert.ok(after.yVel < 0, `the pad (fired flipped) sends it down: ${after.yVel}`);
  const before = run(make(true));
  assert.equal(before.gravityFlipped, true, "objects listed before the teleport wait a frame");
});

test("a force block pushes after the clamp, scaled by the mode's gravity", () => {
  // Dash f21517-21521: 4.2 force, the flipped cube caps at 810 + 51.03
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0, lineColorChannel: 0, rawHeader: "",
    objects: [{ id: 2069, x: 100, y: 400, props: new Map<number, string>([[149, "4.2"], [128, "10"], [129, "10"]]) }],
  } as unknown as Level;
  const world = new CollisionWorld(level, () => null);
  const s = createSim(100, SPEEDS[1], level);
  s.player.y = 400;
  s.player.gravityFlipped = true;
  s.player.yVel = 810;
  s.player.onGround = false;
  for (let i = 0; i < 3; i++) simStep(s, world, STEP, false);
  assert.ok(Math.abs(s.player.yVel - (810 + 4.2 * 0.9 * 54 / 4)) < 0.01, `861.03, got ${s.player.yVel}`);
});

test("a dual has a ground and a ceiling for every mode (updateDualGround / destroyFromHitHead)", () => {
  // centre 150, two cubes: the grounds sit 135 either side
  const world = worldOf([{ id: 286, x: 300, y: 165 }]);
  const s = createSim(285, SPEEDS[1]);
  s.player.y = 165;
  s.player.onGround = false;
  for (let i = 0; i < Math.round(0.2 / STEP) && !s.dead && !s.dual; i++) simStep(s, world, STEP, false);
  assert.ok(s.dual);
  // a flipped cube rising into the ceiling lands on it
  s.player.gravityFlipped = true;
  s.player.y = 269.5; s.player.yVel = 300; s.player.onGround = false;
  simStep(s, world, STEP, false);
  assert.equal(s.dead, false);
  assert.ok(Math.abs(s.player.y - 270) < 1e-9, `flipped cube rests at 150 + 135 - 15, got ${s.player.y}`);
  // an upright cube jumping head-first into it dies
  const t = createSim(285, SPEEDS[1]);
  t.player.y = 165; t.player.onGround = false;
  for (let i = 0; i < Math.round(0.2 / STEP) && !t.dead && !t.dual; i++) simStep(t, world, STEP, false);
  t.player.y = 269.5; t.player.yVel = 500; t.player.flipAge = undefined;
  simStep(t, world, STEP, false);
  assert.equal(t.dead, true);
});


test("the sim counts its steps (m_currentProgress), and a checkpoint rewinds them", () => {
  const world = worldOf([]);
  const s = createSim(0, SPEEDS[1]);
  for (let i = 0; i < 100; i++) simStep(s, world, STEP, false);
  assert.equal(s.steps, 100);
  const snap = cloneSim(s);
  for (let i = 0; i < 50; i++) simStep(s, world, STEP, false);
  assert.equal(s.steps, 150);
  restoreSim(s, snap);
  assert.equal(s.steps, 100);
});
