// Move triggers that lock to the player (keys 58 and 59).
//
// 11 move triggers across L19-22 set key 58 and 5 set key 59, and every one of
// them has dx = dy = 0 — they are *pure* follow moves. Geometrical Dominator
// depends on one: at x=28592 a spawn-triggered move locks group 96 (a four-block
// platform at y 77..92) to the player's x for 1.18 s, which is what carries the
// ball across the corridor at 28710..28995 where the floor is spiked end to end
// and the ceiling has a 285-unit gap. Without it that group never moves and the
// level is unfinishable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type Level } from "../src/gd/level.ts";
import { buildTriggers, createRuntime, groupState, updateTriggers } from "../src/gd/triggers.ts";

function moveLevel(props: Record<number, string>): Level {
  return {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [{
      id: 901, x: 100, y: 0,
      props: new Map(Object.entries(props).map(([k, v]) => [Number(k), v])),
    }],
  } as unknown as Level;
}

test("key 58 makes the group track the player's x for the move's duration", () => {
  const level = moveLevel({ 51: "5", 28: "0", 29: "0", 10: "2", 58: "1" });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 0);      // fires here, player at x=100
  assert.equal(groupState(rt, 5).dx, 0);
  updateTriggers(rt, triggers, 400, 1, 0);      // player advanced 300
  assert.equal(groupState(rt, 5).dx, 300);
  updateTriggers(rt, triggers, 500, 1, 0);      // and 100 more, ending the move
  assert.equal(groupState(rt, 5).dx, 400);
});

test("the offset the lock built up stays after the move ends", () => {
  const level = moveLevel({ 51: "5", 28: "0", 29: "0", 10: "1", 58: "1" });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 0);
  updateTriggers(rt, triggers, 350, 1, 0);      // move completes here
  assert.equal(groupState(rt, 5).dx, 250);
  updateTriggers(rt, triggers, 900, 1, 0);      // the player runs on; the group does not
  assert.equal(groupState(rt, 5).dx, 250);
});

test("without key 58 the group does not follow the player at all", () => {
  const level = moveLevel({ 51: "5", 28: "0", 29: "0", 10: "2" });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 0);
  updateTriggers(rt, triggers, 400, 1, 0);
  assert.equal(groupState(rt, 5).dx, 0);
});

test("key 59 does the same for y", () => {
  const level = moveLevel({ 51: "5", 28: "0", 29: "0", 10: "2", 59: "1" });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 15);
  updateTriggers(rt, triggers, 100, 1, 215);
  assert.equal(groupState(rt, 5).dy, 200);
  assert.equal(groupState(rt, 5).dx, 0, "x is untouched without key 58");
});

test("a lock rides on top of the trigger's own offset", () => {
  const level = moveLevel({ 51: "5", 28: "60", 29: "0", 10: "2", 58: "1" });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 0);
  updateTriggers(rt, triggers, 400, 1, 0);      // half the move, plus 300 of lock
  assert.equal(groupState(rt, 5).dx, 30 + 300);
});

test("Geometrical Dominator's platform group really is locked to the player", async () => {
  const { decodeLevelString } = await import("../src/gd/level.ts");
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const assets = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");
  const level = await decodeLevelString(readFileSync(join(assets, "levels", "19.txt"), "utf8"));
  const locked = level.objects.filter((o) => o.id === 901 && o.props.get(58) === "1");
  assert.equal(locked.length, 2);
  const platform = locked.find((o) => o.props.get(51) === "96");
  assert.ok(platform, "group 96 is the one carried");
  assert.equal(platform.props.get(28), "0");
  assert.equal(platform.props.get(29), "0");
  assert.ok(Number(platform.props.get(10)) > 1, "and it runs for over a second");
});

// --- two moves on one group must stack, not replace ---

test("two move triggers firing together both apply", () => {
  // Geometrical Dominator spawns exactly this pair on group 96: a short rise
  // and a long lock-to-player. Replacing the first with the second left the
  // platform on the floor, where it is no use to anyone.
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      { id: 901, x: 100, y: 0, props: new Map<number, string>([[51, "5"], [29, "36"], [10, "1"]]) },
      { id: 901, x: 100, y: 0, props: new Map<number, string>([[51, "5"], [28, "0"], [29, "0"], [10, "2"], [58, "1"]]) },
    ],
  } as never;
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 0);
  updateTriggers(rt, triggers, 400, 1, 0);
  const s = groupState(rt, 5);
  assert.equal(s.dy, 36, "the rise completed instead of being cancelled");
  assert.equal(s.dx, 300, "and the lock ran alongside it");
});

test("a later move on the same group adds to what the first one did", () => {
  const level = {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      { id: 901, x: 100, y: 0, props: new Map<number, string>([[51, "5"], [28, "100"], [10, "2"]]) },
      { id: 901, x: 200, y: 0, props: new Map<number, string>([[51, "5"], [28, "40"], [10, "2"]]) },
    ],
  } as never;
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 150, 0, 0);   // first fires
  updateTriggers(rt, triggers, 150, 2, 0);   // first completes: +100
  assert.equal(groupState(rt, 5).dx, 100);
  updateTriggers(rt, triggers, 250, 0, 0);   // second fires
  updateTriggers(rt, triggers, 250, 2, 0);   // second completes: +40
  assert.equal(groupState(rt, 5).dx, 140);
});

// --- Dash's guide group 304 (x 15675): lock to the player at 5 %, forever ---
//
// `GroupCommandObject2::runMoveCommand` (m1 0x447558) stores the lock modifiers
// (keys 143 / 144) as given, 0 becoming 1.0 (`fcmeq 0` + `bsl 1.0` at
// 0x4475cc..0x4475dc); `EffectManager::prepareMoveActions` (m1 0x27de38,
// 0x27e1b0..0x27e1fc) adds `mod * player delta` to the command's offset each
// step. `GroupCommandObject2::step` (0x44722c, 0x4472dc..0x4472f0) finishes a
// command when its time reaches the duration, except a duration of exactly -1:
// that one never finishes. The delta is zeroed when the step teleported the
// player (`GJBaseGameLayer::update`, m1 0x1232e8..0x123324). Native Dash
// (dash-full.txt): the camera's guide climbs 0.05 * (741 - 489) = 12.6 by the
// time the stop trigger at x 15645 ends the lock, which is the camera's
// 390.927 pin.

test("keys 143 / 144 scale how far the group follows the player", () => {
  const level = moveLevel({ 51: "5", 28: "0", 29: "0", 10: "2", 58: "1", 59: "1", 143: "0.5", 144: "0.05" });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 15);
  updateTriggers(rt, triggers, 300, 1, 215);
  assert.equal(groupState(rt, 5).dx, 100, "x follows at 50 %");
  assert.ok(Math.abs(groupState(rt, 5).dy - 10) < 1e-9, "y follows at 5 %");
});

test("a modifier of 0 means 1.0, as in the binary", () => {
  const level = moveLevel({ 51: "5", 28: "0", 29: "0", 10: "2", 59: "1", 144: "0" });
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 15);
  updateTriggers(rt, triggers, 100, 1, 215);
  assert.equal(groupState(rt, 5).dy, 200);
});

function lockForeverLevel(): Level {
  return {
    colors: new Map(), bgColorChannel: 0, groundColorChannel: 0,
    lineColorChannel: 0, rawHeader: "",
    objects: [
      // the move trigger is itself in group 7
      { id: 901, x: 100, y: 0, props: new Map<number, string>([[51, "5"], [57, "7"], [28, "0"], [29, "0"], [10, "-1"], [59, "1"], [144, "0.05"]]) },
      // and a stop trigger (1616) addresses that group
      { id: 1616, x: 500, y: 0, props: new Map<number, string>([[51, "7"]]) },
    ],
  } as never;
}

test("a duration of -1 keeps the lock running until a stop trigger ends it", () => {
  const level = lockForeverLevel();
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 0);
  // an hour of play later the lock is still running
  updateTriggers(rt, triggers, 200, 3600, 100);
  assert.ok(Math.abs(groupState(rt, 5).dy - 5) < 1e-9);
  updateTriggers(rt, triggers, 300, 1 / 240, 300);
  assert.ok(Math.abs(groupState(rt, 5).dy - 15) < 1e-9);
  // the stop trigger at x 500
  updateTriggers(rt, triggers, 500, 1 / 240, 300);
  updateTriggers(rt, triggers, 520, 1 / 240, 900);
  assert.ok(Math.abs(groupState(rt, 5).dy - 15) < 1e-9, "stopped: the player's climb no longer counts");
});

test("a step that teleported the player does not count towards the lock", () => {
  const level = lockForeverLevel();
  const rt = createRuntime(level);
  const triggers = buildTriggers(level);
  updateTriggers(rt, triggers, 100, 0, 0);
  updateTriggers(rt, triggers, 110, 1 / 240, 100);
  updateTriggers(rt, triggers, 120, 1 / 240, 1300, true);  // teleported 1200 up
  updateTriggers(rt, triggers, 130, 1 / 240, 1310);
  assert.ok(Math.abs(groupState(rt, 5).dy - 0.05 * 110) < 1e-9);
});
