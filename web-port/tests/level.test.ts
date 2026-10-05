import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeLevelString } from "../src/gd/level.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const levelsDir = join(root, "public", "assets", "levels");

test("decodes Stereo Madness (1.txt)", async () => {
  const p = join(levelsDir, "1.txt");
  if (!existsSync(p)) { console.warn("assets not copied yet, skipping"); return; }
  const level = await decodeLevelString(readFileSync(p, "utf8"));
  assert.equal(level.objects.length, 2291);
  const first = level.objects[0];
  assert.equal(first.id, 29); // color trigger at start (1,29 per raw dump)
  assert.equal(first.x, 135);
  assert.equal(first.y, 135);
  // color channels parsed from kS29.. header; BG (1000) of Stereo Madness = 40,62,255
  assert.ok(level.colors.size > 0);
  const bg = level.colors.get(1000)!;
  assert.equal(bg.r, 40);
  assert.equal(bg.g, 62);
  assert.equal(bg.b, 255);
  // every object has an id and finite coords
  for (const o of level.objects) {
    assert.ok(Number.isFinite(o.id) && o.id > 0);
    assert.ok(Number.isFinite(o.x) && Number.isFinite(o.y));
  }
});

test("decodes all 22 main levels without errors", async () => {
  for (let i = 1; i <= 22; i++) {
    const p = join(levelsDir, `${i}.txt`);
    if (!existsSync(p)) continue;
    const level = await decodeLevelString(readFileSync(p, "utf8"));
    assert.ok(level.objects.length > 1000, `level ${i} too small`);
  }
});

test("the header's background (kA6) and ground (kA7) art are parsed, 0 reading as 01", async () => {
  const want: Record<number, [number, number]> = {
    1: [1, 1], 14: [1, 1], 15: [2, 2], 16: [5, 5], 18: [7, 4], 19: [8, 9],
    20: [11, 8], 21: [14, 12], 22: [25, 17],
  };
  for (const [id, [bg, ground]] of Object.entries(want)) {
    const p = join(levelsDir, `${id}.txt`);
    if (!existsSync(p)) continue;
    const level = await decodeLevelString(readFileSync(p, "utf8"));
    assert.equal(level.bgStyle, bg, `level ${id} background`);
    assert.equal(level.groundStyle, ground, `level ${id} ground`);
    for (const f of [`game_bg_${String(bg).padStart(2, "0")}_001-hd.png`,
      `groundSquare_${String(ground).padStart(2, "0")}_001-hd.png`]) {
      assert.ok(existsSync(join(root, "public", "assets", f)), `level ${id} needs ${f}`);
    }
  }
});
