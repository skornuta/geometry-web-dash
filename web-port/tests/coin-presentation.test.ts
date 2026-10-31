import { test } from "node:test";
import assert from "node:assert/strict";
import { LevelScene } from "../src/scenes/levelScene.ts";
import type { Level } from "../src/gd/level.ts";
import type { SpriteFrame } from "../src/engine/atlas.ts";
import { animationFor } from "../src/gd/objectAnim.ts";

function fixture() {
  const scene = new LevelScene();
  const calls: unknown[][] = [];
  const atlas = new Map<string, SpriteFrame>();
  for (const [outline, widths] of [[false, [80, 68, 20, 68]], [true, [79, 67, 19, 67]]] as const) {
    widths.forEach((w, i) => atlas.set(`secretCoin_${outline ? "b_" : ""}01_00${i + 1}.png`, {
      x: i * 100, y: 0, w, h: outline ? 79 : 80, rotated: i === 3,
      // Deliberately distinct trim offsets, to detect frozen first-frame geometry.
      offsetX: i * 2 + (outline ? 1 : 0), offsetY: i * -2,
      sourceW: 80, sourceH: 80,
    }));
  }
  const object = { id: 142, x: 0, y: 100, props: new Map<number, string>() };
  scene.level = { objects: [object], colors: new Map(), rawHeader: "" } as unknown as Level;
  const internal = scene as unknown as {
    renderer: { draw: (...args: unknown[]) => void };
    sheets: Map<string, { atlas: Map<string, SpriteFrame>; tex: object; texW: number; texH: number }>;
    curObj: number;
    curAnim: ReturnType<typeof animationFor>;
    emit: (...args: unknown[]) => void;
  };
  internal.renderer = { draw: (...args: unknown[]) => calls.push(args) };
  internal.sheets.set("game02", { atlas, tex: {}, texW: 1024, texH: 1024 });
  internal.curObj = 0;
  internal.curAnim = animationFor(object, 0);
  internal.emit("game02", "secretCoin_01_001.png", 0, 0, 0, 100, 0, 1,
    1, 1, 0, false, false, { r: 1, g: 1, b: 1, a: 1, blend: "normal", ch: -1 }, 1, 1);
  return { scene, calls, atlas };
}

test("saved coin outline spins on the gold idle clock using its own trimmed frames", () => {
  const { scene, calls, atlas } = fixture();
  scene.collectedCoins = new Set([0]);
  for (const [i, time] of [0, 0.116, 0.231, 0.346, 0.461].entries()) {
    scene.animTime = time;
    scene.drawObjects(0, 600, 0, 100);
    const n = i % 4;
    const frame = atlas.get(`secretCoin_b_01_00${n + 1}.png`)!;
    const call = calls.at(-1)!;
    assert.equal(call[3], frame);
    assert.equal(call[4], frame.offsetX * 0.5);
    assert.equal(call[5], 100 + frame.offsetY * 0.5);
    assert.equal(call[6], frame.w * 0.5);
    assert.equal(call[7], frame.h * 0.5);
  }
});

test("gold idle animation still spins, and destroyed coins draw neither variant", () => {
  const { scene, calls, atlas } = fixture();
  scene.animTime = 0.231;
  scene.drawObjects(0, 600, 0, 100);
  assert.equal(calls.at(-1)![3], atlas.get("secretCoin_01_003.png"));
  scene.destroyed = new Set([0]);
  scene.drawObjects(0, 600, 0, 100);
  scene.collectedCoins = new Set([0]);
  scene.drawObjects(0, 600, 0, 100);
  assert.equal(calls.length, 1);
});

test("pickup draw uses transient world pose, alpha, outline and frame-specific trim", async () => {
  const { createCoinPickup } = await import("../src/gd/coinPickup.ts");
  const { scene, calls, atlas } = fixture();
  // Transient art must remain visible after removing the source object.
  scene.destroyed = new Set([0]);
  const state = { ...createCoinPickup({ x: 10, y: 20, outline: true,
    randomX: 0, randomY: 0, scale: 2 }), age: 0.625 };
  scene.drawCoinPickup(state);
  const frame = atlas.get("secretCoin_b_01_001.png")!;
  const call = calls.at(-1)!;
  assert.equal(call[3], frame);
  assert.equal(call[4], 11, "HD * scale applies to trim, not flight");
  assert.ok(Math.abs((call[5] as number) - 42.4537037037037) < 1e-9);
  assert.equal(call[6], 79);
  assert.equal(call[7], 79);
  assert.equal(call[8], 0, "secret coin flight has no rotation action");
  assert.equal(call[12], 0.5);
  assert.equal(call[13], "normal");
  scene.drawCoinPickup({ ...state, age: 0.75 });
  assert.equal(calls.length, 1, "expired pickups are not drawn");
  scene.drawCoinPickup({ ...state, outline: false, age: 0.15, scale: 1 });
  const goldFrame = atlas.get("secretCoin_01_004.png")!;
  const goldCall = calls.at(-1)!;
  assert.equal(goldCall[3], goldFrame, "later gold frames, including atlas rotation, pass through intact");
  assert.equal(goldCall[6], goldFrame.w * 0.5);
  assert.equal(goldCall[7], goldFrame.h * 0.5);
  assert.equal(goldCall[12], 1);
});
