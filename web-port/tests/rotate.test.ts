// Rotate triggers (1346). 80 in Fingerdash and 26 in Deadlocked.
//
// These stopped being optional when the move-trigger work re-routed L21: its
// group 220 is a ring of six fireballs that a rotate trigger at x=17595 spins
// two full turns over 5.1 s, and frozen in their authored arc they sit across
// the route at x≈18191. What rotates is almost all *circular* hazards
// (fireballs, radius 4), for which rotation is exactly "move the centre".
//
// Keys, from the shipped data cross-checked against props.ts: 51 target group,
// 71 the group whose position is the centre of rotation, 68 degrees (CW, like
// key 6), 69 extra whole turns, 70 lock the objects' own rotation, 10 duration,
// 30/85 easing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Level } from "../src/gd/level.ts";
import {
  buildTriggers, createRuntime, groupState, movableGroups, updateTriggers,
} from "../src/gd/triggers.ts";

/** a rotate trigger targeting group 5, about a marker object in group 9 */
function rotLevel(props: Record<number, string>, markerAt = { x: 100, y: 100 }): Level {
  return {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      // the centre marker: an ordinary object carrying group 9
      { id: 1, x: markerAt.x, y: markerAt.y, props: new Map<number, string>([[57, "9"]]) },
      {
        id: 1346, x: 50, y: 0,
        props: new Map(Object.entries({ 51: "5", 71: "9", ...props })
          .map(([k, v]) => [Number(k), String(v)])),
      },
    ],
  } as unknown as Level;
}

const DEG = Math.PI / 180;

test("a rotate trigger turns its group, in radians, over the duration", () => {
  const level = rotLevel({ 68: "90", 10: "2" });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 60, 0);
  assert.equal(groupState(rt, 5).rot, 0);
  updateTriggers(rt, triggers, 60, 1);
  // key 68 is degrees CW; the renderer and the world are CCW, so it negates
  assert.ok(Math.abs(groupState(rt, 5).rot - -45 * DEG) < 1e-9,
    `half of -90 degrees, got ${groupState(rt, 5).rot / DEG}`);
  updateTriggers(rt, triggers, 60, 1);
  assert.ok(Math.abs(groupState(rt, 5).rot - -90 * DEG) < 1e-9);
});

test("key 69 adds whole turns on top of the degrees", () => {
  const level = rotLevel({ 68: "0", 69: "2", 10: "1" });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 60, 0);
  updateTriggers(rt, triggers, 60, 1);
  assert.ok(Math.abs(groupState(rt, 5).rot - -720 * DEG) < 1e-9,
    `two full turns, got ${groupState(rt, 5).rot / DEG} degrees`);
});

test("the centre comes from the group named by key 71", () => {
  const level = rotLevel({ 68: "90", 10: "1" }, { x: 375, y: 210 });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 60, 0);
  const s = groupState(rt, 5);
  assert.equal(s.cx, 375);
  assert.equal(s.cy, 210);
});

test("a rotate with no centre group leaves the group alone", () => {
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [{ id: 1346, x: 50, y: 0,
      props: new Map<number, string>([[51, "5"], [68, "90"], [10, "1"]]) }],
  } as unknown as Level;
  const rt = createRuntime(level);
  updateTriggers(rt, buildTriggers(level), 60, 1);
  assert.equal(groupState(rt, 5).rot, 0);
});

test("rotations stack, like moves", () => {
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      { id: 1, x: 0, y: 0, props: new Map<number, string>([[57, "9"]]) },
      { id: 1346, x: 50, y: 0, props: new Map<number, string>([[51, "5"], [71, "9"], [68, "90"], [10, "1"]]) },
      { id: 1346, x: 50, y: 0, props: new Map<number, string>([[51, "5"], [71, "9"], [68, "90"], [10, "1"]]) },
    ],
  } as unknown as Level;
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 60, 0);
  updateTriggers(rt, triggers, 60, 1);
  assert.ok(Math.abs(groupState(rt, 5).rot - -180 * DEG) < 1e-9,
    `both applied, got ${groupState(rt, 5).rot / DEG}`);
});

test("a rotated group's colliders must be dynamic", () => {
  const level = rotLevel({ 68: "90", 10: "1" });
  assert.ok(movableGroups(buildTriggers(level)).has(5),
    "otherwise the collision world bakes them in place");
});

test("Fingerdash's fireball ring is a real rotate target", async () => {
  const { decodeLevelString } = await import("../src/gd/level.ts");
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");
  const level = await decodeLevelString(readFileSync(join(assets, "levels", "21.txt"), "utf8"));
  const t = level.objects.find((o) => o.id === 1346 && o.props.get(51) === "220");
  assert.ok(t, "the trigger that spins group 220");
  assert.equal(t.props.get(69), "2", "two whole turns");
  assert.equal(t.props.get(71), "181", "about group 181");
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  for (let x = 0; x <= 17700; x += 30) updateTriggers(rt, triggers, x, 30 / 387.42);
  assert.notEqual(groupState(rt, 220).rot, 0, "and it is actually turning by 17700");
});

// --- the collision world has to follow, or the art lies about where death is ---

test("a rotating hazard's collider orbits the centre", async () => {
  const { CollisionWorld } = await import("../src/game/collision.ts");
  // a fireball-like circular hazard at (200, 100), rotated about (100, 100)
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      { id: 1, x: 100, y: 100, props: new Map<number, string>([[57, "9"]]) },
      { id: 1582, x: 200, y: 100, props: new Map<number, string>([[57, "5"]]) },
      { id: 1346, x: 50, y: 0,
        props: new Map<number, string>([[51, "5"], [71, "9"], [68, "180"], [10, "1"]]) },
    ],
  } as unknown as Level;
  const triggers = buildTriggers(level);
  const world = new CollisionWorld(level, () => ({ w: 30, h: 30 }), movableGroups(triggers));
  const rt = createRuntime(level);

  const findAt = (x: number) => world
    .near({ x, y: 100, hw: 40, hh: 40 }, rt)
    .find((c) => c.id === 1582);

  assert.ok(findAt(200), "starts on the right of the centre");
  assert.equal(findAt(0), undefined);

  updateTriggers(rt, triggers, 60, 0);
  updateTriggers(rt, triggers, 60, 1); // half a turn
  const moved = findAt(0);
  assert.ok(moved, "after 180 degrees it is on the left of the centre");
  assert.ok(Math.abs(moved.x - 0) < 1e-6, `x=${moved?.x}`);
  assert.ok(Math.abs(moved.y - 100) < 1e-6, `y=${moved?.y}`);
  assert.equal(findAt(200), undefined, "and no longer where it started");
});

test("a rotating group still honours its move offset", async () => {
  const { CollisionWorld } = await import("../src/game/collision.ts");
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      { id: 1, x: 100, y: 100, props: new Map<number, string>([[57, "9"]]) },
      { id: 1582, x: 200, y: 100, props: new Map<number, string>([[57, "5"]]) },
      { id: 1346, x: 50, y: 0,
        props: new Map<number, string>([[51, "5"], [71, "9"], [68, "180"], [10, "1"]]) },
      { id: 901, x: 50, y: 0,
        props: new Map<number, string>([[51, "5"], [29, "60"], [10, "1"]]) },
    ],
  } as unknown as Level;
  const triggers = buildTriggers(level);
  const world = new CollisionWorld(level, () => ({ w: 30, h: 30 }), movableGroups(triggers));
  const rt = createRuntime(level);
  updateTriggers(rt, triggers, 60, 0);
  updateTriggers(rt, triggers, 60, 1);
  const c = world.near({ x: 0, y: 160, hw: 40, hh: 40 }, rt).find((o) => o.id === 1582);
  assert.ok(c, "rotated to the left, then lifted 60");
  assert.ok(Math.abs(c.y - 160) < 1e-6, `y=${c?.y}`);
});

test("an orb in a moved group is met where the group has moved it", async () => {
  // Geometrical Dominator x=6645: a move trigger lifts group 18's yellow orbs
  // 60 units before the ship flies under them (real run f5266, f5342).
  const { CollisionWorld } = await import("../src/game/collision.ts");
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      { id: 36, x: 200, y: 100, props: new Map<number, string>([[57, "18"]]) },
      { id: 901, x: 50, y: 0,
        props: new Map<number, string>([[51, "18"], [29, "60"], [10, "0.3"]]) },
    ],
  } as unknown as Level;
  const triggers = buildTriggers(level);
  const world = new CollisionWorld(level, () => ({ w: 36, h: 36 }), movableGroups(triggers));
  const rt = createRuntime(level);
  const orbAt = () => world.nearInteractives({ x: 200, y: 100, hw: 15, hh: 15 }, rt)
    .find((it) => it.id === 36);
  assert.equal(orbAt()?.y, 100, "in place before the trigger");
  updateTriggers(rt, triggers, 60, 0);
  updateTriggers(rt, triggers, 60, 1);
  assert.ok(Math.abs(orbAt()!.y - 160) < 1e-6, `lifted to ${orbAt()?.y}`);
});
