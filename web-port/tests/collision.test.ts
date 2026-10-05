import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSolid, CollisionWorld, PLAYER_HALF, PLAYER_INNER_HALF, CLIP_INSET, overlaps, touchesRect,
  type Collider,
} from "../src/game/collision.ts";
import type { Level } from "../src/gd/level.ts";

/** a one-block solid sitting on the ground: spans y 0..30, x 0..30 */
const block: Collider = { kind: "solid", x: 15, y: 15, hw: 15, hh: 15, id: 1 };
const TOP = block.y + block.hh; // 30

// Deepest the player may sink below the block's top and still be clipped up.
// The 10-unit inset decides whether the landing branch runs at all; the inner
// box decides whether being there is fatal, so the tolerance is set by the
// inner box: land while centre >= blockTop + 4.5, i.e. embedded <= 10.5.
const MAX_CLIP = PLAYER_HALF - PLAYER_INNER_HALF; // 10.5

test("landing squarely on top snaps the player to the block surface", () => {
  // falling, barely overlapping the top
  const r = resolveSolid(15, TOP + PLAYER_HALF - 1, -100, block);
  assert.equal(r.result, "land");
  assert.equal(r.landY, TOP + PLAYER_HALF); // 45
});

test("catching the top corner clips the player up instead of killing", () => {
  // embedded just inside the tolerance
  const py = TOP + PLAYER_HALF - (MAX_CLIP - 1);
  const r = resolveSolid(15, py, -100, block);
  assert.equal(r.result, "land", "should be clipped up, not killed");
  assert.equal(r.landY, TOP + PLAYER_HALF);
});

test("the clip-up tolerance ends at PLAYER_HALF - PLAYER_INNER_HALF", () => {
  const justInside = resolveSolid(15, TOP + PLAYER_HALF - (MAX_CLIP - 0.1), -100, block);
  const justOutside = resolveSolid(15, TOP + PLAYER_HALF - (MAX_CLIP + 0.1), -100, block);
  assert.equal(justInside.result, "land");
  assert.equal(justOutside.result, "death");
});

test("running into the side of a block at ground level still kills", () => {
  // player standing on the floor (centre y=15) walking into a 1-block step
  const r = resolveSolid(5, 15, 0, block);
  assert.equal(r.result, "death");
});

test("grazing a block with only the outer box does not kill", () => {
  // player centre well to the left: the 30-wide outer box touches the block,
  // but the 9-wide inner box does not reach it
  const px = block.x - block.hw - PLAYER_INNER_HALF - 1;
  const r = resolveSolid(px, 15, 0, block);
  assert.equal(r.result, "none");
});

test("rising into the underside of a block kills the cube", () => {
  // moving up, inner box inside the block
  const r = resolveSolid(15, 15, 400, block);
  assert.equal(r.result, "death");
});

test("flipped gravity mirrors the landing surface", () => {
  const bottom = block.y - block.hh; // 0
  // falling "up" (yVel positive is falling when g = -1), just under the block
  const r = resolveSolid(15, bottom - PLAYER_HALF + 1, 100, block, -1);
  assert.equal(r.result, "land");
  assert.equal(r.landY, bottom - PLAYER_HALF); // -15
});

// --- index spaces -----------------------------------------------------------
// `Collider.index` and `Interactive.obj` both point into `level.objects`, but
// `Interactive.index` points into `CollisionWorld.interactives`. Conflating the
// two is invisible in a code read and broke the already-collected coin art:
// the scene was told to grey out whichever object happened to share the
// interactive's array position.
test("Interactive.obj is the level.objects index, Interactive.index is not", () => {
  const objs = [
    { id: 1, x: 15, y: 15 },     // a block, so the coin is not object 0
    { id: 1, x: 45, y: 15 },
    { id: 142, x: 200, y: 45 },  // secret coin -> interactives[0], objects[2]
    { id: 1, x: 75, y: 15 },
    { id: 142, x: 400, y: 45 },  // secret coin -> interactives[1], objects[4]
  ];
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: objs.map((o) => ({ ...o, props: new Map<number, string>() })),
  } as unknown as Level;
  const world = new CollisionWorld(level, () => ({ w: 30, h: 30 }));

  const coins = world.interactives.filter((i) => i.kind === "coin");
  assert.equal(coins.length, 2);
  assert.deepEqual(coins.map((c) => c.index), [0, 1], "index is the interactives slot");
  assert.deepEqual(coins.map((c) => c.obj), [2, 4], "obj is the level.objects slot");
  // the whole point: the two disagree, so they are not interchangeable
  assert.notDeepEqual(coins.map((c) => c.index), coins.map((c) => c.obj));
  for (const c of coins) assert.equal(level.objects[c.obj].id, 142);
});

test("interactives are sized from RobTop's table, not from their art", async () => {
  // Every portal and every orb differs from its sprite: the art is wider than
  // the box for portals (gravity 34.5 vs 25) and narrower for orbs (30 vs 36),
  // so sizing a trigger volume from the art both over- and under-triggers.
  const { loadWorld } = await import("../scripts/headless.mjs");
  const { world } = await loadWorld(14);
  const at = (id: number, x: number) =>
    world.interactives.find((i) => i.id === id && Math.abs(i.x - x) < 1);

  const orb = at(36, 9445);            // the yellow orb over Clubstep's pit
  assert.ok(orb, "the yellow orb is in the world");
  assert.equal(orb.hw, 18);            // 36 wide, not the sprite's 30
  assert.equal(orb.hh, 18);

  const gravityOrb = at(84, 9565);
  assert.ok(gravityOrb);
  assert.equal(gravityOrb.hw, 18);

  const pad = at(35, 9315);            // pads already agreed with the table
  assert.ok(pad);
  assert.equal(pad.hw, 12.5);
  assert.equal(pad.hh, 2);
});

test("a portal's trigger volume is the table's, which is narrower than its art", async () => {
  const { loadWorld } = await import("../scripts/headless.mjs");
  const { world } = await loadWorld(14);
  const cube = world.interactives.find((i) => i.id === 12 && Math.abs(i.x - 9135) < 1);
  assert.ok(cube, "Clubstep's cube portal is in the world");
  // table 34x86; the sprite would have given 44.5x85.5 and fired 5 units early
  assert.equal(cube.hw, 17);
  assert.equal(cube.hh, 43);
});

test("an interactive's off-centre hitbox turns with it (rotated teleport)", () => {
  // Fingerdash x=6405: teleport 747 (25x90, 12 units off-centre) turned 90
  // degrees. Its box sits 12 below the object; the real cube reaches it f4923.
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [{ id: 747, x: 6405, y: 263, props: new Map<number, string>([[6, "90"]]) }],
  } as unknown as Level;
  const world = new CollisionWorld(level, () => ({ w: 30, h: 30 }));
  const it = world.interactives[0];
  assert.ok(Math.abs(it.x - 6405) < 1e-9 && Math.abs(it.y - 251) < 1e-9, `at (${it.x}, ${it.y})`);
  assert.equal(it.hw, 45);
  assert.equal(it.hh, 12.5);
});

test("a portal turned off the quarter-turns is met by its true rectangle", () => {
  // Deadlocked's teleport at -53 degrees: the enclosing box's empty corner
  // must not fire it.
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [{ id: 747, x: 0, y: 0, props: new Map<number, string>([[6, "-45"]]) }],
  } as unknown as Level;
  const world = new CollisionWorld(level, () => ({ w: 30, h: 30 }));
  const it = world.interactives[0];
  assert.ok(it.obb, "keeps its oriented rectangle");
  // a small box inside the AABB's corner but off the rotated rectangle
  const corner = { x: it.x + it.hw - 2, y: it.y + it.hh - 2, hw: 1, hh: 1 };
  assert.ok(overlaps(corner, it), "the enclosing box would fire");
  assert.equal(touchesRect(corner, it), false, "the true rectangle does not");
  assert.ok(touchesRect({ x: it.x, y: it.y, hw: 1, hh: 1 }, it), "its centre does");
});

test("interactives count touching edges, as CCRect::intersectsRect does", () => {
  // Stereo Madness f17617: cube right edge 22903 + 15 = portal left edge 22935 - 17
  const player = { x: 22903, y: 140, hw: 15, hh: 15 };
  const portal = { x: 22935, y: 149, hw: 17, hh: 43 };
  assert.equal(overlaps(player, portal), false, "the strict test misses it");
  assert.ok(touchesRect(player, portal), "the interactive test does not");
  assert.equal(touchesRect(player, portal, false), false);
});

test("a rider handed between ramps meets the next ramp's line early, with no floor", async () => {
  // Hexagon Force f5359: from a 2:1 ramp onto a 45° tile spanning x 7800..7830,
  // y 210..240 — the ball is at 7791.83, 223.04 (the 45° line + 15·√2)
  const { slopeRideTarget } = await import("../src/game/collision.ts");
  const tile: Collider = { kind: "solid", x: 7815, y: 225, hw: 15, hh: 15, id: 326,
    slope: { cx: 1, cy: -1 } };
  assert.equal(slopeRideTarget(tile, 7791.83, 15), null, "out of reach from flat ground");
  const t = slopeRideTarget(tile, 7791.83, 15, true)!;
  assert.ok(Math.abs(t - (210 + (7791.83 - 7800) + 15 * Math.SQRT2)) < 1e-9, `target ${t}`);
});

test("a No Touch object (key 121) is drawn but never collides", () => {
  // Dash (1545, 122): a no-touch yellow pad stacked on a live one
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      { id: 35, x: 100, y: 2, props: new Map<number, string>([[121, "1"]]) },
      { id: 1, x: 200, y: 15, props: new Map<number, string>([[121, "1"]]) },
      { id: 35, x: 300, y: 2, props: new Map<number, string>() },
    ],
  } as unknown as Level;
  const world = new CollisionWorld(level, () => ({ w: 30, h: 30 }));
  assert.equal(world.colliders.length, 0, "the no-touch block is not solid");
  assert.equal(world.interactives.length, 1, "only the live pad remains");
  assert.equal(world.interactives[0].x, 300);
});

test("2.2 per-axis scale (keys 128/129) sizes the collider", () => {
  // Dash (645, -33): a block with 128 = 1.98 is 59.4 wide
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      { id: 1, x: 0, y: 0, props: new Map<number, string>([[128, "1.98"]]) },
      { id: 1, x: 100, y: 0, props: new Map<number, string>([[128, "2"], [129, "0.5"], [6, "90"]]) },
    ],
  } as unknown as Level;
  const world = new CollisionWorld(level, () => ({ w: 30, h: 30 }));
  const [a, b] = world.colliders;
  assert.ok(Math.abs(a.hw - 29.7) < 1e-9 && a.hh === 15, `${a.hw} x ${a.hh}`);
  // a quarter turn swaps which world axis each scale lands on
  assert.ok(Math.abs(b.hw - 7.5) < 1e-9 && Math.abs(b.hh - 30) < 1e-9, `${b.hw} x ${b.hh}`);
});

test("kA39 levels meet saws circle-vs-circle (playerCircleCollision m1 0xfbe18)", async () => {
  const { circleVsCircle, hitsHazard } = await import("../src/game/collision.ts");
  const lvl = (h: string) => ({ rawHeader: h } as unknown as import("../src/gd/level.ts").Level);
  assert.equal(circleVsCircle(lvl("kS38,1_40,kA39,1,kA2,0")), true);
  assert.equal(circleVsCircle(lvl("kA2,0,kA3,0")), false);
  // a saw of radius 10 diagonally off a 30-box's corner: the rect test hits,
  // the circle test (distance <= 10 + 15) does not
  const saw = { kind: "hazard", x: 22, y: 22, hw: 10, hh: 10, id: 88, groups: [], index: 0, radius: 10 } as any;
  const player = { x: 0, y: 0, hw: 15, hh: 15 };
  assert.equal(hitsHazard(player, saw), true);
  assert.equal(hitsHazard(player, { ...saw, circle: true }), false);
});
