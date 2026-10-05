import { test } from "node:test";
import assert from "node:assert/strict";
import { bgTileStart } from "../src/scenes/levelScene.ts";
import { DEFAULT_CAMERA_Y_CENTER } from "../src/gd/camera.ts";

/** a screen shift, folded into one tile's width — the tiling repeats */
const wrap = (d: number, t = 512) => ((d % t) + t) % t;

/** where the tiling sits on screen, relative to the view's corner */
function screenPhase(camX: number, camY: number, t = 512) {
  const left = camX - 240, bottom = camY - 160;
  const { x0, y0 } = bgTileStart(camX, camY, left, bottom, t);
  return { x: x0 - left, y: y0 - bottom };
}

test("the level background scrolls at a tenth of the camera's speed on both axes", () => {
  // GJBaseGameLayer::updateBGArtSpeed(0.1f, 0.1f) at level setup (m1 0xc37d8)
  const a = screenPhase(1000, DEFAULT_CAMERA_Y_CENTER);
  const b = screenPhase(1300, DEFAULT_CAMERA_Y_CENTER);
  assert.ok(Math.abs(wrap(b.x - a.x) - wrap(-30)) < 1e-9, `moved ${b.x - a.x} on screen for +300 of camera`);
  const c = screenPhase(1000, DEFAULT_CAMERA_Y_CENTER + 200);
  assert.ok(Math.abs(wrap(c.y - a.y) - wrap(-20)) < 1e-9, `moved ${c.y - a.y} vertically for +200`);
});

test("the background tiling at the default camera centre is unchanged", () => {
  // tile rows on world multiples of the tile size, as before the parallax fix
  const { y0 } = bgTileStart(0, DEFAULT_CAMERA_Y_CENTER, -240, DEFAULT_CAMERA_Y_CENTER - 160, 512);
  assert.equal(((y0 % 512) + 512) % 512, 0);
});
