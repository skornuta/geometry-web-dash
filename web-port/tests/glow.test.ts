// Tests for the object glow table (src/gd/glow.ts).
//
// The table is `GameObject::addGlow`'s jump table resolved against the
// toolbox frames; these pin its size, a few known entries, and that every
// frame it names actually ships in GJ_GameSheetGlow — a missing frame would
// silently drop a glow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GLOW_IDS, TINTED_GLOW_IDS, CUSTOM_GLOW_HSV, glowFrameFor,
} from "../src/gd/glow.ts";
import { transformColor } from "../src/gd/color.ts";

test("265 ids glow — the addGlow jump table minus id 44, which has no toolbox frame", () => {
  assert.equal(GLOW_IDS.size, 265);
  assert.equal(glowFrameFor(44), null);
  assert.equal(glowFrameFor(1), "square_01_glow_001.png");
  assert.equal(glowFrameFor(8), "spike_01_glow_001.png");
  // the toolbox frame, not the port's own decomposition of the light squares
  assert.equal(glowFrameFor(70), "lightsquare_01_02_glow_001.png");
  // ids outside the table get none
  assert.equal(glowFrameFor(5), null);
  assert.equal(glowFrameFor(914), null);
});

test("every glow frame ships in GJ_GameSheetGlow", () => {
  const plist = readFileSync("public/assets/GJ_GameSheetGlow-hd.plist", "utf8");
  for (const id of GLOW_IDS) {
    const f = glowFrameFor(id)!;
    assert.ok(plist.includes(`<key>${f}</key>`), `${id}: ${f} missing`);
  }
});

test("the tinted glows are glow ids, and the tint is the background lifted", () => {
  for (const id of TINTED_GLOW_IDS) assert.ok(GLOW_IDS.has(id), `${id} has no glow`);
  // s −0.2 and v +0.2, both absolute: a mid blue gets paler and brighter
  const c = transformColor({ r: 40, g: 125, b: 255 }, CUSTOM_GLOW_HSV);
  assert.equal(c.b, 255);
  assert.ok(c.r > 40 && c.g > 125);
});
