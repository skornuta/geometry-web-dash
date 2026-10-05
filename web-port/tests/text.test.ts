// The text object (id 914) — the last id the M8 audit reported as missing art.
//
// It has no sprite: both id->texture sources map it to an editor icon, because
// the game draws the base64 string in key 31 with the level font instead. These
// tests pin the decode and the real level data, so a regression shows up as a
// failing assert rather than as four levels quietly losing their captions.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { decodeLevelString } from "../src/gd/level.ts";
import { P, propText, propFloat } from "../src/gd/props.ts";
import { parseBMFont } from "../src/engine/bmfont.ts";

const TEXT_OBJECT_ID = 914;

function level(n: number) {
  return decodeLevelString(fs.readFileSync(`public/assets/levels/${n}.txt`, "utf8"));
}

test("propText decodes url-safe base64, padded or not", () => {
  const p = (v: string) => new Map([[P.TEXT, v]]);
  // "Hold" -> SG9sZA==; the level string ships it unpadded
  assert.equal(propText(p("SG9sZA=="), P.TEXT), "Hold");
  assert.equal(propText(p("SG9sZA"), P.TEXT), "Hold");
  // '-' and '_' stand in for '+' and '/'
  assert.equal(propText(p("Pz8_"), P.TEXT), "???");
  assert.equal(propText(p("Pz8/"), P.TEXT), "???");
});

test("propText returns empty rather than throwing on junk", () => {
  // a malformed text object must never stop a level from loading
  assert.equal(propText(new Map(), P.TEXT), "");
  assert.equal(propText(new Map([[P.TEXT, "!!!not base64!!!"]]), P.TEXT), "");
});

test("propText round-trips non-ASCII as UTF-8, not one byte per char", () => {
  const utf8 = Buffer.from("café", "utf8").toString("base64");
  assert.equal(propText(new Map([[P.TEXT, utf8]]), P.TEXT), "café");
});

test("the classic levels' text objects decode to their real captions", async () => {
  // Read out of the shipping level data, not invented: these are the strings
  // the original shows at these points.
  const expected: Record<number, string[]> = {
    19: ["Go!"],
    21: ["Hold"],
  };
  for (const [n, wanted] of Object.entries(expected)) {
    const lv = await level(Number(n));
    const texts = lv.objects
      .filter((o) => o.id === TEXT_OBJECT_ID)
      .map((o) => propText(o.props, P.TEXT));
    for (const w of wanted) {
      assert.ok(texts.includes(w), `level ${n} should contain the text ${JSON.stringify(w)}, got ${JSON.stringify(texts)}`);
    }
  }
});

test("exactly four levels use text objects, 35 in total", async () => {
  // If this count moves, the audit's "missing art" figure moves with it — the
  // two were reconciled to zero together and should stay that way.
  const counts = new Map<number, number>();
  let total = 0;
  for (let n = 1; n <= 22; n++) {
    const lv = await level(n);
    const c = lv.objects.filter((o) => o.id === TEXT_OBJECT_ID).length;
    if (c) { counts.set(n, c); total += c; }
  }
  assert.deepEqual([...counts.entries()], [[19, 1], [20, 16], [21, 14], [22, 4]]);
  assert.equal(total, 35);
});

/**
 * The one text object in the 22 levels whose key 31 is not valid base64.
 *
 * Level 20 spells "I Like This Part:)" with one text object per letter across
 * x=19853..20146. Sitting among them at x=20001 is a leftover holding the raw
 * plaintext "ILikeThisPar", which is *also* a syntactically valid base64 string,
 * so it decodes to 9 bytes of garbage instead of failing outright.
 *
 * We do not special-case it. gd.docs specifies key 31 as base64, and inventing a
 * "looks like plaintext" fallback would be a guess — the exact class of guess
 * that produced the orb incident. The strict decode yields U+FFFD, bigFont has
 * no glyph for it, and the renderer skips glyphs the font lacks, which is
 * roughly what the original does with the same bytes.
 */
const KNOWN_BAD_TEXT = { level: 20, x: 20001 };

test("exactly one text object in the 22 levels is not valid base64", async () => {
  const bad: string[] = [];
  for (let n = 1; n <= 22; n++) {
    const lv = await level(n);
    for (const o of lv.objects) {
      if (o.id !== TEXT_OBJECT_ID) continue;
      if (propText(o.props, P.TEXT).includes("�")) bad.push(`${n}@${Math.round(o.x)}`);
    }
  }
  assert.deepEqual(bad, [`${KNOWN_BAD_TEXT.level}@${KNOWN_BAD_TEXT.x}`]);
});

test("every glyph the well-formed text objects need exists in bigFont", async () => {
  // The renderer skips a glyph the font has no entry for, so a missing one is
  // an invisible hole rather than an error. Catch it here instead.
  const font = parseBMFont(fs.readFileSync("public/assets/bigFont-hd.fnt", "utf8"));
  const missing = new Set<string>();
  for (const n of [19, 20, 21, 22]) {
    const lv = await level(n);
    for (const o of lv.objects) {
      if (o.id !== TEXT_OBJECT_ID) continue;
      const s = propText(o.props, P.TEXT);
      if (s.includes("�")) continue; // the known artifact above
      for (const ch of s) {
        if (!font.glyphs.has(ch.codePointAt(0)!)) missing.add(ch);
      }
    }
  }
  assert.deepEqual([...missing], [], `bigFont is missing glyphs: ${[...missing].join(" ")}`);
});

test("text objects carry a usable scale", async () => {
  // scale 0 would emit zero-sized quads and read as "the text is not drawing"
  for (const n of [19, 20, 21, 22]) {
    const lv = await level(n);
    for (const o of lv.objects) {
      if (o.id !== TEXT_OBJECT_ID) continue;
      const s = propFloat(o.props, P.SCALE, 1);
      assert.ok(s > 0, `level ${n} text object at x=${o.x} has scale ${s}`);
    }
  }
});
