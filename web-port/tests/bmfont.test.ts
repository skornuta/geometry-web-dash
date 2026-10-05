import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseBMFont } from "../src/engine/bmfont.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("parseBMFont parses real gjFont01-hd.fnt", () => {
  const p = join(root, "public", "assets", "gjFont01-hd.fnt");
  if (!existsSync(p)) { console.warn("assets not copied yet, skipping"); return; }
  const font = parseBMFont(readFileSync(p, "utf8"));
  assert.equal(font.lineHeight, 89);
  assert.equal(font.base, 69);
  assert.equal(font.scaleW, 512);
  assert.ok(font.glyphs.size >= 67);
  const bang = font.glyphs.get(33)!;
  assert.equal(bang.w, 24);
  assert.equal(bang.h, 67);
  assert.equal(bang.xadvance, 16);
  assert.ok(font.kernings.size > 0);
});

test("measure is CCLabelBMFont's content width, last-glyph overhang included", async () => {
  const p = join(root, "public", "assets", "bigFont-hd.fnt");
  if (!existsSync(p)) { console.warn("assets not copied yet, skipping"); return; }
  const { LoadedFont } = await import("../src/engine/bmfont.ts");
  const font = new LoadedFont(parseBMFont(readFileSync(p, "utf8")), null as never);
  // "Stereo Madness": advances + kerning come to 544 px, and the final `s` is
  // 47 px wide on a 38 px advance, so cocos's content width is 544 + 9 = 553 px
  // (276.5 pt). The level page's name scale, `min(1, 250 / width)`, and a
  // native capture both depend on the extra 9 px (REFERENCE.md §19.4).
  assert.equal(font.measure("Stereo Madness"), 553);
  const s = font.font.glyphs.get("s".codePointAt(0)!)!;
  assert.ok(s.w > s.xadvance, "the rule only matters because `s` overhangs");
  // a glyph that does not overhang adds nothing
  const i = font.font.glyphs.get("i".codePointAt(0)!)!;
  if (i.w <= i.xadvance) assert.equal(font.measure("i"), i.xadvance);
});
