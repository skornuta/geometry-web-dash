import { test } from "node:test";
import assert from "node:assert/strict";
import { ROD_BALL_DY, ROD_BALL_ID_BASE, rodBallFor, rodBallFrame } from "../src/gd/rodBalls.ts";
import { OBJECT_DEFS } from "../src/gd/objects.ts";
import { AUDIO_SCALE } from "../src/gd/audioPulse.ts";

const rod = (id: number, rot = 0, extra: [number, string][] = []) =>
  ({ id, x: 100, y: 50, props: new Map<number, string>([[6, String(rot)], ...extra]) });

test("a rod's ball sits on its tip: +31 (15), +23.25 (16), +16.25 turned with the rod (17)", () => {
  assert.deepEqual([...ROD_BALL_DY], [[15, 31], [16, 23.25], [17, 16.25]]);
  const b15 = rodBallFor(rod(15), 2)!;
  assert.equal(b15.x, 100); assert.equal(b15.y, 50 + 31);
  const b17 = rodBallFor(rod(17, 180), 2)!;
  assert.ok(Math.abs(b17.x - 100) < 1e-9);
  assert.ok(Math.abs(b17.y - (50 - 16.25)) < 1e-9, "a rod turned 180 carries its ball below");
  // a quarter turn clockwise puts the tip to the right
  const b16 = rodBallFor(rod(16, 90), 1)!;
  assert.ok(Math.abs(b16.x - (100 + 23.25)) < 1e-9 && Math.abs(b16.y - 50) < 1e-9);
});

test("the ball carries the rod's groups so a trigger moves it with the rod; other ids have none", () => {
  const b = rodBallFor(rod(15, 0, [[57, "12.34"]]), 3)!;
  assert.equal(b.props.get(57), "12.34");
  assert.equal(rodBallFor(rod(8), 1), null);
});

test("each level draws one of the three frames; the captured session's choice is kept", () => {
  for (const n of [1, 2, 3]) {
    const d = OBJECT_DEFS.get(ROD_BALL_ID_BASE + n)!;
    assert.equal(d.frame, `rod_ball_0${n}_001.png`);
  }
  assert.equal(rodBallFrame(2291), 3, "Stereo Madness"); // the game's dump of that level
  assert.equal(rodBallFrame(1444), 1, "Dry Out");
  for (let k = 0; k < 50; k++) assert.ok([1, 2, 3].includes(rodBallFrame(k * 37)));
  // id 37 is an audio-scale id already; the scene adds the balls' own range
  assert.ok(AUDIO_SCALE.has(37));
});
