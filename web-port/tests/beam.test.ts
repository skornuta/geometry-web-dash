import { test } from "node:test";
import assert from "node:assert/strict";
// the autopilot's selection policy — the part that decides which candidate
// states survive each tick, and therefore whether the search finds a level's
// real route or reports a straggler's death as the level's wall
import { prune, key } from "../scripts/beam.mjs";

/** a candidate the way the beam holds one; only these fields are read */
function node(mode: string, y: number, opts: Record<string, unknown> = {}) {
  return {
    sim: {
      player: {
        mode, y, yVel: 0, onGround: mode === "cube", mini: false,
        gravityFlipped: false, dash: 0, jumping: false, holdTime: 0, ...opts,
      },
      run: { speed: 311 },
    },
  };
}

test("identical states collapse to one key, different altitudes do not", () => {
  assert.equal(key(node("cube", 15).sim), key(node("cube", 16).sim));
  assert.notEqual(key(node("cube", 15).sim), key(node("cube", 300).sim));
  assert.notEqual(key(node("cube", 15).sim), key(node("ufo", 15).sim));
});

/** ~3000 distinct low-altitude robots, the way a starved beam really looks:
 * they differ in velocity and float budget, not just in height */
function groundRobots(count: number) {
  return Array.from({ length: count }, (_, i) => node("robot", 15 + (i % 35) * 3, {
    yVel: (Math.floor(i / 35) % 17) * 30 - 240,
    holdTime: (Math.floor(i / 595) % 5) * 0.02,
    onGround: false,
    jumping: true,
  }));
}

/** `count` distinct candidates of one mode spread over an altitude band */
function waveBand(count: number, mode: string, y0: number) {
  return Array.from({ length: count }, (_, i) => node(mode, y0 + (i % 40) * 3, {
    yVel: (Math.floor(i / 40) % 15) * 30 - 210,
  }));
}

test("prune keeps a rare gamemode that a populous one outnumbers 75:1", () => {
  // The measured level 19 failure: past x=19555 the beam held thousands of
  // robot stragglers that had missed the ship portal and were coasting along
  // the ground, against a few dozen UFOs actually flying the route. An
  // altitude-only spread gives the UFOs slots in proportion to their COUNT,
  // so the real route got ~4 of 256 and died out within 900 units while the
  // doomed robots survived to x=22130 and were reported as the level's wall.
  const nodes = [
    ...groundRobots(2975),
    ...Array.from({ length: 40 }, (_, i) => node("ufo", 200 + i * 3.75)),
  ];

  const kept = prune(nodes, 256);

  const ufos = kept.filter((n) => n.sim.player.mode === "ufo");
  // an altitude-only spread gives the 40 UFOs ~5 slots; the floor lifts them
  // to width/8 so the route cannot be squeezed out of existence
  assert.ok(ufos.length >= 32, `the UFO route should clear the floor, got ${ufos.length}`);
  assert.ok(kept.length <= 256, "the beam must not exceed its width");
});

test("prune leaves a healthy minority its proportional share, not an equal one", () => {
  // The other half of the trade. Level 17's dual wave corridor runs two classes
  // at roughly 50/50 and needs every slot's worth of altitude resolution; an
  // earlier attempt here split the beam EVENLY between classes, which promotes
  // a minority that was never starving and cost L17 its completion (100% ->
  // 50.9%). Extinction is the thing to prevent — equal billing is not.
  const nodes = [...groundRobots(2975), ...waveBand(600, "ufo", 200)];

  const kept = prune(nodes, 256);

  const ufos = kept.filter((n) => n.sim.player.mode === "ufo");
  const robots = kept.filter((n) => n.sim.player.mode === "robot");
  // 600 of 3575 candidates -> ~43 of 256 slots, comfortably above the floor,
  // so it is left alone rather than lifted to an equal 128
  assert.ok(ufos.length < 60, `a healthy minority should not be promoted, got ${ufos.length}`);
  assert.ok(robots.length >= 190, `the dominant route keeps its slots, got ${robots.length}`);
});

test("prune still spreads altitudes within a single gamemode", () => {
  const nodes = Array.from({ length: 400 }, (_, i) => node("cube", i * 3));
  const kept = prune(nodes, 16);
  const ys = kept.map((n) => n.sim.player.y);
  assert.equal(kept.length, 16);
  assert.equal(ys[0], 0);
  assert.equal(ys[ys.length - 1], 1197);
  // evenly spread, not clustered
  assert.ok(ys.every((y, i) => i === 0 || y - ys[i - 1] > 50));
});

test("prune never exceeds its width, however many gamemodes are live", () => {
  // The floor is a guarantee, and a guarantee it cannot afford is a bug: with
  // enough live classes, lifting each to width/8 costs more slots than the beam
  // has, and every class is already at the floor so nobody can pay for it. The
  // beam then silently runs ~25% wide, which makes --beam=N mean nothing.
  const modes = ["cube", "ship", "ball", "ufo", "wave", "robot", "spider", "swing",
    "cube-mini", "ship-mini"];
  const nodes = modes.flatMap((m) =>
    Array.from({ length: 60 }, (_, i) => node(m, i * 7, { onGround: false })));

  assert.equal(prune(nodes, 256).length, 256);
  assert.ok(prune(nodes, 64).length <= 64);
});

test("prune returns everything when the beam is not full", () => {
  const nodes = [node("cube", 15), node("ufo", 300), node("ship", 400)];
  assert.equal(prune(nodes, 64).length, 3);
});
