import test from "node:test";
import assert from "node:assert/strict";
import { pitFrames } from "../src/gd/pits.ts";

// `GameObject::customSetup` picks a pit's frame once, with rand():
// id 9 -> 1 + round(2 U) (1 : 2 : 1), id 135 -> 1 + round(3 U), never the previous pick again.

test("ground pits (id 9) show pit_01 / pit_02 / pit_03 in the ratio 1 : 2 : 1", () => {
  const objects = Array.from({ length: 8000 }, () => ({ id: 9 }));
  const frames = pitFrames(objects);
  const count = (n: string) => [...frames.values()].filter((f) => f === `pit_0${n}_001.png`).length;
  const [a, b, c] = [count("1"), count("2"), count("3")];
  assert.equal(a + b + c, 8000);
  assert.ok(Math.abs(a / 8000 - 0.25) < 0.03, `pit_01 ${a}`);
  assert.ok(Math.abs(b / 8000 - 0.5) < 0.03, `pit_02 ${b}`);
  assert.ok(Math.abs(c / 8000 - 0.25) < 0.03, `pit_03 ${c}`);
});

test("pit_b (id 135) uses frames 1-4 and never repeats the previous one", () => {
  const objects = Array.from({ length: 2000 }, () => ({ id: 135 }));
  const frames = [...pitFrames(objects).values()];
  assert.equal(new Set(frames).size, 4);
  for (let i = 1; i < frames.length; i++) assert.notEqual(frames[i], frames[i - 1]);
});

test("only pits get a frame, and the pick is the same on every load", () => {
  const objects = [{ id: 8 }, { id: 9 }, { id: 135 }, { id: 9 }];
  const a = pitFrames(objects), b = pitFrames(objects);
  assert.deepEqual([...a.keys()], [1, 2, 3]);
  assert.deepEqual([...a.entries()], [...b.entries()]);
});
