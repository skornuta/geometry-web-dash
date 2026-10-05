// Static level viewer (M2): auto-scrolls the camera through a level with no
// gameplay. Kept for visual verification — gameplay lives in playLevel.ts.
import { Renderer } from "../engine/renderer.ts";
import { LevelScene, VIEW_H } from "./levelScene.ts";

export async function startLevelView(renderer: Renderer, levelNum: number) {
  const scene = await LevelScene.load(renderer, levelNum);
  console.log(
    `level ${levelNum}: ${scene.level.objects.length} objects -> ${scene.items.length} sprites, ` +
    `${scene.skipped} skipped (${scene.unknownIds.size} unknown ids), maxX=${scene.maxX.toFixed(0)}`,
  );

  const params = new URLSearchParams(location.search);
  const fixedX = params.has("x") ? parseFloat(params.get("x")!) : null;
  const camY = params.has("y") ? parseFloat(params.get("y")!) : 100;
  const speed = params.has("speed") ? parseFloat(params.get("speed")!) : 311.58;
  const startX = 60;
  const t0 = performance.now();

  const loop = () => {
    renderer.resize();
    const scale = renderer.canvas.height / VIEW_H;
    const viewW = renderer.canvas.width / scale;
    const camX = fixedX ?? startX + ((performance.now() - t0) / 1000) * speed % (scene.maxX + viewW);

    // the viewer has no sim clock, so rotation and frame animation run off
    // wall time here
    scene.animTime = (performance.now() - t0) / 1000;
    renderer.camera = { x: camX, y: camY, scale };
    renderer.begin();
    scene.drawBackground(camX, camY, viewW);
    scene.drawObjects(camX, viewW);
    scene.drawGround(camX, camY, viewW);
    renderer.flush();
    requestAnimationFrame(loop);
  };
  loop();

  (window as unknown as Record<string, unknown>).__levelReady = {
    objects: scene.level.objects.length, sprites: scene.items.length,
    skipped: scene.skipped, maxX: scene.maxX,
  };
}
