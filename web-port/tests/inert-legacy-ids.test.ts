// Object ids the port deliberately has no handler for because the game does
// nothing with them in the 22 main levels. Each test pins the evidence, so the
// day a level (or a custom .gmd) breaks the premise the test says so.
//
// Evidence (arm64 slice, geode m1 addresses) is per test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isTrigger } from "../src/gd/triggers.ts";
import { OBJECT_DEFS, EDITOR_ONLY_IDS } from "../src/gd/objects.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const levelsDir = join(root, "public", "assets", "levels");

/** every raw object string of a main level, keyed by its id (key 1) */
function rawObjects(level: number): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const p = join(levelsDir, `${level}.txt`);
  if (!existsSync(p)) return out;
  const b64 = readFileSync(p, "utf8").replace(/[\x00-\x1f]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const data = gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
  for (const part of data.split(";").slice(1)) {
    if (!part) continue;
    const id = Number(part.split(",")[1]);
    (out.get(id) ?? out.set(id, []).get(id)!).push(part);
  }
  return out;
}

const key = (raw: string, k: string) => {
  const kv = raw.split(",");
  for (let i = 0; i + 1 < kv.length; i += 2) if (kv[i] === k) return kv[i + 1];
  return undefined;
};

test("31 Start Pos: every one in the main levels is a disabled start pos, which addObject drops", () => {
  // `PlayLayer::addObject` (m1 0xa02e0) +588..604: for id 0x1f it reads the
  // object's level settings (`[obj + 0x730]`) and returns when byte `+0x173`
  // is set — `LevelSettingsObject::m_disableStartPos`, key `kA21`. Only a start
  // pos that gets past that becomes `m_startPosObject` (`[layer + 0x2ff0]`,
  // set through `setStartPosObject` 0xfc3c8), which `resetLevel` +1764 then
  // loads. Dash's ten all carry kA21,1, so a normal attempt starts at 0.
  let seen = 0;
  for (let n = 1; n <= 22; n++) {
    for (const raw of rawObjects(n).get(31) ?? []) {
      seen++;
      assert.equal(key(raw, "kA21"), "1", `level ${n}: start pos ${raw.slice(0, 40)} is not disabled`);
    }
  }
  assert.equal(seen, 10);
  assert.equal(isTrigger(31), false, "no trigger behaviour");
  assert.equal(OBJECT_DEFS.has(31), false, "nothing to draw: StartPosObject is an editor sprite");
  assert.ok(EDITOR_ONLY_IDS.has(31));
});

test("3662 Link Visible: none of the three names a group, so it links nothing", () => {
  // The only reader of a 3662 object's target (`[obj + 0x5b8]`, key 51) is
  // `GJBaseGameLayer::generateVisibilityGroups` (m1 0xf5d58) +216..252, which
  // folds the groups of linked-visible objects into culling sets; `addObject`
  // keeps it out of the sections (`0x4faa04` +4: ids 3613 and 3662) and
  // `EffectGameObject::triggerObject` (0x172da4) has no case for it. With no
  // key 51 the target is group 0, which no object belongs to, so it changes
  // neither what is drawn nor what is hit.
  let seen = 0;
  for (let n = 1; n <= 22; n++) {
    for (const raw of rawObjects(n).get(3662) ?? []) {
      seen++;
      assert.equal(key(raw, "51"), undefined, `level ${n}: ${raw}`);
    }
  }
  assert.equal(seen, 3);
  assert.equal(isTrigger(3662), false);
  assert.ok(EDITOR_ONLY_IDS.has(3662));
});
