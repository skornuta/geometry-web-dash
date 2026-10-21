// F1: the garage's jetpack, trail and death-effect tabs.
// Data: ACTUAL_steamgd/GeometryDash.exe (format strings, GJItemIcon::init 0x14027ab10, the
// getItems scale table 0x14027b710) and steam-gd/Resources (the sheets that ship).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import {
  GARAGE_TABS, EXTRA_COUNTS, gridScale, iconFrames, trailIconFrame,
  deathEffectIconFrame, tabCount, clampIcon,
} from "../src/gd/icons.ts";
import { iconSheetBase } from "../src/gd/iconSheets.ts";
import * as save from "../src/gd/save.ts";
import { parseSaveFile, exportSave } from "../src/gd/progressFile.ts";

const RES = new URL("../../steam-gd/Resources/", import.meta.url).pathname;

test("the garage has the game's 11 tabs, jetpack, trail and death effect last", () => {
  assert.deepEqual([...GARAGE_TABS], [
    "cube", "ship", "ball", "ufo", "wave", "robot", "spider", "swing",
    "jetpack", "trail", "deathEffect",
  ]);
});

test("counts match the sheets and frames that ship", { skip: !existsSync(RES) }, () => {
  const jet = readdirSync(RES + "icons").filter((f) => /^jetpack_\d+-uhd\.plist$/.test(f));
  assert.equal(jet.length, EXTRA_COUNTS.jetpack);
  const sheet3 = readFileSync(RES + "GJ_GameSheet03-uhd.plist", "utf8");
  for (let n = 1; n <= EXTRA_COUNTS.trail; n++) assert.ok(sheet3.includes(`<key>${trailIconFrame(n)}</key>`), trailIconFrame(n));
  assert.ok(!sheet3.includes("<key>player_special_08_001.png</key>"), "no 8th trail");
  for (let n = 1; n <= EXTRA_COUNTS.deathEffect; n++) assert.ok(sheet3.includes(`<key>${deathEffectIconFrame(n)}</key>`), deathEffectIconFrame(n));
  assert.ok(!sheet3.includes("<key>explosionIcon_21_001.png</key>"), "no 21st death effect");
  const jp = readFileSync(RES + "icons/jetpack_03-uhd.plist", "utf8");
  const f = iconFrames("jetpack", 3);
  for (const name of [f.main, f.detail, f.glow]) assert.ok(jp.includes(`<key>${name}</key>`), name);
});

test("frame names follow the exe's format strings", () => {
  const f = iconFrames("jetpack", 3);
  assert.equal(f.main, "jetpack_03_001.png");
  assert.equal(f.detail, "jetpack_03_2_001.png");
  assert.equal(f.extra, "jetpack_03_extra_001.png");
  assert.equal(f.glow, "jetpack_03_glow_001.png");
  assert.equal(f.dome, undefined);
  assert.equal(iconSheetBase("jetpack", 3), "jetpack_03-hd");
  assert.equal(trailIconFrame(3), "player_special_03_001.png");
  assert.equal(deathEffectIconFrame(7), "explosionIcon_07_001.png");
  assert.equal(tabCount("jetpack"), 8);
  assert.equal(clampIcon("trail", 99), 7);
  assert.equal(clampIcon("deathEffect", 0), 1);
});

test("grid scales come from the getItems table at unlockType - 1", () => {
  // exe 0x14027b710 over the unlock types 0x14017c5e0 gives each icon type
  const want = {
    cube: 0.8, ship: 0.6, ball: 0.75, ufo: 0.68, wave: 0.8, robot: 0.65, spider: 0.65,
    swing: 0.7, jetpack: 0.6, trail: 0.8, deathEffect: 0.8,
  };
  for (const [tab, scale] of Object.entries(want)) {
    assert.ok(Math.abs(gridScale(tab as never) - scale) < 1e-6, `${tab} ${gridScale(tab as never)}`);
  }
});
});

test("a fresh save starts every extra on its first choice", () => {
  save.loadFrom(undefined);
  const k = save.icons();
  assert.equal(k.jetpack, 1);
  assert.equal(k.trail, 1);
  assert.equal(k.deathEffect, 1);
});

test("jetpack, trail and death effect survive a reload; bad values fall back", () => {
  save.loadFrom({ v: 1, icons: { jetpack: 8, trail: 7, deathEffect: 20 } });
  assert.deepEqual([save.icons().jetpack, save.icons().trail, save.icons().deathEffect], [8, 7, 20]);
  save.loadFrom(JSON.parse(JSON.stringify({ v: 1, icons: save.icons() })));
  assert.equal(save.icons().deathEffect, 20);
  save.loadFrom({ v: 1, icons: { jetpack: 9, trail: 0, deathEffect: 21 } });
  assert.deepEqual([save.icons().jetpack, save.icons().trail, save.icons().deathEffect], [1, 1, 1]);
  save.loadFrom({ v: 1, icons: { jetpack: "3", trail: 2.5, deathEffect: null } });
  assert.deepEqual([save.icons().jetpack, save.icons().trail, save.icons().deathEffect], [1, 1, 1]);
});

test("the progress file carries and validates the three choices", () => {
  save.loadFrom({ v: 1, icons: { jetpack: 5, trail: 3, deathEffect: 12 } });
  const text = exportSave(save.save());
  const ok = parseSaveFile(text);
  assert.equal(ok.ok, true);
  assert.equal(JSON.parse(text).save.icons.deathEffect, 12);
  for (const [key, bad] of [["jetpack", 9], ["trail", 0], ["deathEffect", 21]] as const) {
    const doc = JSON.parse(text);
    doc.save.icons[key] = bad;
    assert.equal(parseSaveFile(JSON.stringify(doc)).ok, false, `${key} ${bad} is refused`);
  }
});
