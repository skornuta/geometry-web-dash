// Read actual WebGL pixels: camera changes must split batches, and mirror
// portals must reflect the world without reflecting the HUD drawn afterwards.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route("**/render-pass-test", route => route.fulfill({
    contentType: "text/html", body: '<canvas id="test" width="200" height="100"></canvas>',
  }));
  await page.goto("http://localhost:3222/render-pass-test");
  const pixels = await page.evaluate(async () => {
    const { Renderer } = await import("/src/engine/renderer.ts");
    const canvas = document.querySelector("canvas");
    const r = new Renderer(canvas), gl = r.ctx;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const f = { x: 0, y: 0, w: 1, h: 1, rotated: false,
      offsetX: 0, offsetY: 0, sourceW: 1, sourceH: 1 };
    const draw = (x, y, red, green, blue) =>
      r.draw(tex, 1, 1, f, x, y, 10, 10, 0, red, green, blue, 1);
    const read = (x, y) => {
      const out = new Uint8Array(4);
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
      return [...out];
    };
    r.camera = { x: 10, y: 0, scale: 1, mirrorX: true };
    r.begin();
    draw(40, 0, 1, 0, 0); // world: reflected from screen x130 to x70
    r.camera = { x: 0, y: 0, scale: 1 };
    draw(40, 25, 0, 1, 0); // HUD: remains at x140, unaffected by world camera
    r.flush();
    const mirrored = { world: read(70, 50), hud: read(140, 75), empty: read(130, 50) };
    r.camera = { x: 0, y: 0, scale: 1 };
    r.begin();
    draw(40, 0, 0, 0, 1);
    r.flush();
    return { mirrored, restored: read(140, 50), oldPosition: read(70, 50) };
  });
  assert.deepEqual(pixels.mirrored.world, [255, 0, 0, 255], "world reflects about the camera");
  assert.deepEqual(pixels.mirrored.hud, [0, 255, 0, 255], "HUD uses its own unmirrored camera");
  assert.deepEqual(pixels.mirrored.empty, [0, 0, 0, 255]);
  assert.deepEqual(pixels.restored, [0, 0, 255, 255], "normal view restores on the next frame");
  assert.deepEqual(pixels.oldPosition, [0, 0, 0, 255]);
  console.log("PASS — real WebGL world/HUD cameras and mirror restoration");
} finally {
  await browser.close();
}
