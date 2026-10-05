// Loads a level into a CollisionWorld with no browser and no WebGL.
//
// The atlases are parsed only for their frame *sizes* — that is all the
// collision world needs — so nothing here touches a GL context.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAtlas } from "../src/engine/atlas.ts";
import { decodeLevelString } from "../src/gd/level.ts";
import { OBJECT_DEFS } from "../src/gd/objects.ts";
import { SHEET_FILES, HD } from "../src/gd/sheets.ts";
import { CollisionWorld } from "../src/game/collision.ts";
import { buildTriggers, movableGroups } from "../src/gd/triggers.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "public", "assets");

const atlasCache = new Map();
function atlasFor(sheet) {
  let a = atlasCache.get(sheet);
  if (!a) {
    a = parseAtlas(readFileSync(join(assets, `${SHEET_FILES[sheet]}.plist`), "utf8"));
    atlasCache.set(sheet, a);
  }
  return a;
}

/** same rule as LevelScene.frameSize: untrimmed source size in world units */
export function frameSize(id) {
  const def = OBJECT_DEFS.get(id);
  if (!def) return null;
  const f = atlasFor(def.sheet).get(def.frame);
  return f ? { w: f.sourceW * HD, h: f.sourceH * HD } : null;
}

/** decode level `n` and build its collision world */
export async function loadWorld(n) {
  const level = await decodeLevelString(readFileSync(join(assets, "levels", `${n}.txt`), "utf8"));
  const world = new CollisionWorld(level, frameSize, movableGroups(buildTriggers(level)));
  const maxX = level.objects.reduce((m, o) => Math.max(m, o.x), 0);
  return { level, world, maxX };
}
