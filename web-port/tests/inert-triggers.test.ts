// Task 4 — the triggers that were parsed and inert until now: items and the
// count / instant count / pickup triggers, collision blocks and their trigger,
// the stop trigger, on death, the toggle orb, and touch-triggered firing.
//
// Each test pins a rule decoded from the 2.2081 binary (FIDELITY.md §4.3), not
// a behaviour invented here.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeLevelString, parseLevelString, type Level, type LevelObject,
} from "../src/gd/level.ts";
import {
  buildTriggers, buildCollisionBlocks, createRuntime, updateTriggers, groupState,
  itemCount, setItemCount, fireOnDeath, handleBlockCollision,
  activateCustomRing, fireTouchTriggers, isTrigger,
} from "../src/gd/triggers.ts";

/** a level with the given objects, through the real level-string parser */
async function levelOf(objs: Record<number, string | number>[]): Promise<Level> {
  const body = objs.map((o) =>
    Object.entries(o).map(([k, v]) => `${k},${v}`).join(",")).join(";");
  return parseLevelString(`kS38,|;${body};`);
}

const obj = (id: number, x: number, y: number, rest: Record<number, string | number> = {}) =>
  ({ 1: id, 2: x, 3: y, ...rest });

test("activate group enables the group and spawns it, deactivate only disables", async () => {
  // 1049 toggle is the *bare* toggleGroup; a count trigger's activate is
  // toggleGroupTriggered, which also spawns
  const level = await levelOf([
    obj(1611, 100, 15, { 80: 7, 77: 1, 51: 5, 56: 1 }),      // count -> activate group 5
    obj(1049, 200, 15, { 51: 6, 56: 1 }),                     // plain toggle on group 6
    obj(901, 300, 15, { 57: 5, 62: 1, 51: 9, 28: 0, 29: 60 }), // spawned by group 5
  ]);
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, list, 250, 1 / 240);
  assert.equal(groupState(rt, 6).enabled, true);
  // the count trigger is armed but has not fired: the item is still 0
  assert.equal(groupState(rt, 9).dy, 0);
  setItemCount(rt, 7, 1);
  updateTriggers(rt, list, 250, 1 / 240);
  assert.equal(groupState(rt, 5).enabled, true);
  assert.equal(groupState(rt, 9).dy, 60, "activating group 5 spawned its move trigger");
});

test("a count listener fires when the item crosses its target, once unless multi", async () => {
  const level = await levelOf([
    obj(1611, 100, 15, { 80: 1, 77: 3, 51: 5, 56: 1 }),
    obj(1611, 100, 15, { 80: 1, 77: 3, 51: 6, 56: 1, 104: 1 }),
  ]);
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, list, 150, 1 / 240);
  assert.equal(rt.counters.length, 2);
  setItemCount(rt, 1, 2);
  assert.equal(rt.counters.length, 2, "2 has not reached 3");
  setItemCount(rt, 1, 4);
  assert.equal(rt.counters.length, 1, "the single-shot one is gone, the multi one stays");
  assert.equal(groupState(rt, 5).enabled, true);
  assert.equal(groupState(rt, 6).enabled, true);
  // crossing back down fires the multi one again
  groupState(rt, 6).enabled = false;
  setItemCount(rt, 1, 0);
  assert.equal(groupState(rt, 6).enabled, true);
});

test("instant count compares now: equal, larger, smaller", async () => {
  // the trigger *deactivates* group 5 (no key 56), so `enabled === false`
  // means it fired — groups start enabled
  const mk = async (mode: number, want: number, have: number) => {
    const level = await levelOf([obj(1811, 100, 15, { 80: 1, 77: want, 88: mode, 51: 5 })]);
    const rt = createRuntime(level);
    setItemCount(rt, 1, have);
    updateTriggers(rt, buildTriggers(level), 150, 1 / 240);
    return groupState(rt, 5).enabled === false;
  };
  assert.equal(await mk(0, 3, 3), true);
  assert.equal(await mk(0, 3, 4), false);
  assert.equal(await mk(1, 3, 4), true);   // larger
  assert.equal(await mk(1, 3, 3), false);
  assert.equal(await mk(2, 3, 2), true);   // smaller
  assert.equal(await mk(2, 3, 3), false);
});

test("pickup adds, subtracts, overrides and multiplies the item", async () => {
  const run = async (keys: Record<number, string | number>, start: number) => {
    const level = await levelOf([obj(1817, 100, 15, { 80: 1, ...keys })]);
    const rt = createRuntime(level);
    setItemCount(rt, 1, start);
    updateTriggers(rt, buildTriggers(level), 150, 1 / 240);
    return itemCount(rt, 1);
  };
  assert.equal(await run({ 77: 2 }, 5), 7);
  assert.equal(await run({ 77: 2, 78: 1 }, 5), 3);
  assert.equal(await run({ 77: 2, 139: 1 }, 5), 2);
  assert.equal(await run({ 88: 1, 449: 3 }, 5), 15);
  assert.equal(await run({ 88: 2, 449: 2 }, 10), 5);
});

test("collision blocks: the trigger fires on enter, and on exit only with key 93", async () => {
  // both registrations *deactivate* their group, so `enabled === false` is "fired"
  const level = await levelOf([
    obj(1815, 50, 15, { 80: 1, 95: 2, 51: 5 }),
    obj(1815, 50, 15, { 80: 1, 95: 2, 51: 6, 93: 1 }),
    obj(1816, 300, 100, { 80: 1 }),
    obj(1816, 300, 200, { 80: 2, 94: 1, 57: 8 }),
  ]);
  const rt = createRuntime(level);
  updateTriggers(rt, buildTriggers(level), 100, 1 / 240);
  assert.equal(rt.collisions.length, 2);
  const blocks = buildCollisionBlocks(level).sort((p, q) => p.block - q.block);
  assert.deepEqual(blocks.map((b) => b.block), [1, 2]);
  assert.equal(blocks[1].dynamic, true);
  handleBlockCollision(rt, 1, 2, false);
  assert.equal(groupState(rt, 5).enabled, false, "the enter registration fired");
  assert.equal(groupState(rt, 6).enabled, true, "the on-exit registration did not");
  handleBlockCollision(rt, 1, 2, true);
  assert.equal(groupState(rt, 6).enabled, false);
});

test("the stop trigger ends the actions its target group's triggers started", async () => {
  const level = await levelOf([
    obj(901, 100, 15, { 57: 20, 51: 5, 28: 0, 29: -300, 10: 4 }),
    obj(1616, 200, 15, { 51: 20 }),
  ]);
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, list, 150, 0);         // the move fires...
  updateTriggers(rt, list, 150, 1);         // ...and runs 1 s
  const moved = groupState(rt, 5).dy;
  assert.ok(moved < 0 && moved > -300);
  assert.equal(rt.tweens.length, 1);
  updateTriggers(rt, list, 250, 1 / 240);   // the stop trigger is passed
  assert.equal(rt.tweens.length, 0, "the move was stopped");
  const held = groupState(rt, 5).dy;
  updateTriggers(rt, list, 250, 1);
  assert.equal(groupState(rt, 5).dy, held, "and the group stays where it stopped");
});

test("on-death triggers fire only once the player dies, and only if armed", async () => {
  const level = await levelOf([
    obj(1812, 100, 15, { 51: 5, 56: 1 }),
    obj(1812, 9000, 15, { 51: 6, 56: 1 }),
  ]);
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  updateTriggers(rt, list, 150, 1 / 240);
  assert.equal(groupState(rt, 5).enabled, true, "groups start enabled");
  groupState(rt, 5).enabled = false;
  fireOnDeath(rt);
  assert.equal(groupState(rt, 5).enabled, true);
  assert.equal(rt.onDeath.length, 1, "the trigger at x=9000 has not been reached");
});

test("the toggle orb toggles or, with key 504, spawns its target group", async () => {
  const level = await levelOf([
    obj(901, 300, 15, { 57: 7, 62: 1, 51: 9, 28: 0, 29: 45 }),
  ]);
  const rt = createRuntime(level);
  const list = buildTriggers(level);
  const props = new Map<number, string>([[51, "5"]]);
  activateCustomRing(rt, props);
  assert.equal(groupState(rt, 5).enabled, false, "no key 56 means deactivate");
  activateCustomRing(rt, new Map([[51, "5"], [56, "1"]]));
  assert.equal(groupState(rt, 5).enabled, true);
  // key 504: spawn only, the group's enabled state is untouched
  groupState(rt, 7).enabled = false;
  activateCustomRing(rt, new Map([[51, "7"], [504, "1"]]));
  assert.equal(groupState(rt, 7).enabled, false);
  updateTriggers(rt, list, 0, 1 / 240);
  assert.equal(groupState(rt, 9).dy, 45, "the spawn still ran the group's triggers");
});

test("a touch trigger fires on overlap, not by being passed", async () => {
  const level = await levelOf([
    obj(1049, 500, 300, { 11: 1, 51: 5, 56: 1 }),
  ]);
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  assert.equal(list[0].touch, true);
  groupState(rt, 5).enabled = false;
  updateTriggers(rt, list, 900, 1 / 240);            // walked straight past it
  assert.equal(groupState(rt, 5).enabled, false);
  fireTouchTriggers(rt, list, { x: 500, y: 15, hw: 15, hh: 15 });  // wrong height
  assert.equal(groupState(rt, 5).enabled, false);
  fireTouchTriggers(rt, list, { x: 500, y: 300, hw: 15, hh: 15 });
  assert.equal(groupState(rt, 5).enabled, true);
});

test("a touch trigger fires once unless it is a multi trigger", async () => {
  const level = await levelOf([
    obj(1817, 500, 300, { 11: 1, 80: 1, 77: 1 }),
    obj(1817, 900, 300, { 11: 1, 87: 1, 80: 2, 77: 1 }),
  ]);
  const list = buildTriggers(level);
  const rt = createRuntime(level);
  const on = (x: number) => fireTouchTriggers(rt, list, { x, y: 300, hw: 15, hh: 15 });
  on(500); on(500); on(2000); on(500);
  assert.equal(itemCount(rt, 1), 1, "single-shot: one pickup however often it is touched");
  on(900); on(2000); on(900);
  assert.equal(itemCount(rt, 2), 2, "multi: it re-arms once the player has left");
});

test("the new trigger ids are trigger ids, and 1816/3006 are not drawn", async () => {
  for (const id of [1611, 1616, 1811, 1812, 1815, 1817]) assert.ok(isTrigger(id), `${id}`);
  const { OBJECT_DEFS, EDITOR_ONLY_IDS } = await import("../src/gd/objects.ts");
  assert.equal(OBJECT_DEFS.has(3006), false, "3006 is the area-move trigger, not an orb");
  assert.ok(EDITOR_ONLY_IDS.has(3006));
  // 1594 is the toggle orb: a CustomRing (type 36), so an interactive
  assert.equal(OBJECT_DEFS.get(1594)?.type, 36);
  assert.equal(OBJECT_DEFS.get(1594)?.kind, "orb");
});

test("L22's descending ceiling stops where its collision blocks meet", async () => {
  // the real level: group 265 falls 840 units over 4.19 s, and block 2 (riding
  // it, at y=285) meeting block 1 (static, y=133) stops it 122 units down
  const { readFileSync } = await import("node:fs");
  const level = await decodeLevelString(readFileSync("public/assets/levels/22.txt", "utf8"));
  const blocks = buildCollisionBlocks(level);
  assert.equal(blocks.length, 2);
  const [a, b] = blocks.sort((p, q) => p.block - q.block);
  assert.equal(Math.abs(a.y - b.y) - (a.hh + b.hh), 122);
});

test("every object id a level references is either drawn, a trigger or editor-only", async () => {
  // 3006 moving out of the object table must not create a hole in the audit
  const { readFileSync } = await import("node:fs");
  const { OBJECT_DEFS, EDITOR_ONLY_IDS } = await import("../src/gd/objects.ts");
  const level = await decodeLevelString(readFileSync("public/assets/levels/22.txt", "utf8"));
  const missing = new Set<number>();
  for (const o of level.objects as LevelObject[]) {
    if (!OBJECT_DEFS.has(o.id) && !EDITOR_ONLY_IDS.has(o.id) && !isTrigger(o.id)) missing.add(o.id);
  }
  assert.deepEqual([...missing], []);
});
