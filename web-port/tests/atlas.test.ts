import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlist } from "../src/engine/plist.ts";
import { parseAtlas } from "../src/engine/atlas.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "public", "assets");

test("parsePlist handles nested dict/array/scalars", () => {
  const xml = `<?xml version="1.0"?><plist version="1.0"><dict>
    <key>name</key><string>test &amp; co</string>
    <key>n</key><integer>42</integer>
    <key>r</key><real>1.5</real>
    <key>flag</key><true/>
    <key>list</key><array><integer>1</integer><string>a</string></array>
  </dict></plist>`;
  const v = parsePlist(xml) as any;
  assert.equal(v.name, "test & co");
  assert.equal(v.n, 42);
  assert.equal(v.r, 1.5);
  assert.equal(v.flag, true);
  assert.deepEqual(v.list, [1, "a"]);
});

test("parseAtlas parses real GJ_GameSheetIcons-hd.plist", () => {
  const p = join(assets, "GJ_GameSheetIcons-hd.plist");
  if (!existsSync(p)) { console.warn("assets not copied yet, skipping"); return; }
  const atlas = parseAtlas(readFileSync(p, "utf8"));
  assert.ok(atlas.size > 500, `expected many frames, got ${atlas.size}`);
  const player = atlas.get("player_01_001.png");
  assert.ok(player, "player_01_001.png missing");
  assert.ok(player.w > 0 && player.h > 0);
  assert.ok(player.sourceW >= player.w);
  // rotated frames must be normalized so w/h are the displayed size
  for (const [, f] of atlas) {
    assert.ok(f.w > 0 && f.h > 0 && f.sourceW > 0 && f.sourceH > 0);
  }
});
