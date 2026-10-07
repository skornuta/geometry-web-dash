// F6: the save file (export and import). Pure parts only: the file format,
// the validation that refuses a malformed file, and the apply step that
// touches the save only after the whole file has been accepted.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as save from "../src/gd/save.ts";
import {
  SAVE_FILE_NAME, SAVE_FORMAT, applySaveText, exportSave, parseSaveFile,
} from "../src/gd/progressFile.ts";

/** a file as text, from a plain object */
const file = (o: unknown) => JSON.stringify(o);

/**
 * Run `body` with a fake `localStorage`, as save.test.ts does, and return the
 * writes it caused. Node has no localStorage, so this is how `flush` is seen.
 */
function withStorage(body: () => void): string[] {
  const writes: string[] = [];
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = {
    getItem: () => null,
    setItem: (key: string, value: string) => { writes.push(`${key}=${value}`); },
  };
  try {
    body();
  } finally {
    delete g.localStorage;
  }
  return writes;
}

test("round trip: export then parse gives back the levels, settings and icons", () => {
  save.loadFrom({
    levels: {
      "1": { normal: 40, practice: 10, coins: [0, 2], attempts: 3, jumps: 12 },
      "2": { normal: 100, practice: 0, coins: [], attempts: 1, jumps: 7 },
    },
    icons: { cube: 5, col1: 3 },
    settings: { menuMusic: false },
  });
  const seed = structuredClone(save.save());

  const parsed = parseSaveFile(exportSave(save.save()));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.data.levels, seed.levels);
  assert.deepEqual(parsed.data.settings, seed.settings);
  assert.deepEqual(parsed.data.icons, seed.icons);
});

test("a corrupt or malformed file is refused and the save is not touched", () => {
  save.loadFrom({
    levels: { "1": { normal: 55, practice: 0, coins: [1], attempts: 2, jumps: 9 } },
    icons: { cube: 4 },
  });
  const before = structuredClone(save.save());

  const bad = [
    "[1,2",
    "42",
    file({ version: 1, save: { v: 1, levels: {}, settings: {}, icons: {} } }),
    file({ format: SAVE_FORMAT, version: 1, save: { icons: { cube: "abc" } } }),
  ];
  for (const text of bad) {
    const r = parseSaveFile(text);
    assert.equal(r.ok, false, `accepted: ${text}`);
    if (!r.ok) assert.ok(r.reason.length > 0, "a refusal needs a reason");
  }
  assert.deepEqual(save.save(), before);
});

test("an older file fills the missing fields with defaults and keeps the present ones", () => {
  // no settings.percentageDecimals, no icons.glow, and level 1 has no jumps
  const text = file({
    format: SAVE_FORMAT, version: 1,
    save: {
      v: 1,
      levels: { "1": { normal: 50, practice: 0, coins: [], attempts: 4 } },
      settings: { musicVolume: 0.5, menuMusic: false },
      icons: { cube: 5 },
    },
  });
  const r = parseSaveFile(text);
  assert.equal(r.ok, true);
  if (!r.ok) return;

  save.loadFrom(r.data);
  assert.equal(save.settings().percentageDecimals, false);
  assert.equal(save.icons().glow, false);
  assert.equal(save.levelStats(1).jumps, 0);
  assert.equal(save.levelStats(1).attempts, 4);
  assert.equal(save.levelStats(1).normal, 50);
  assert.equal(save.settings().menuMusic, false);
  assert.equal(save.settings().musicVolume, 0.5);
  assert.equal(save.icons().cube, 5);
});

test("the envelope is checked: JSON object, format tag, version 1, save object", () => {
  const refused: [string, unknown][] = [
    ["top-level array", []],
    ["top-level null", null],
    ["wrong format tag", { format: "other", version: 1, save: {} }],
    ["no format tag", { version: 1, save: {} }],
    ["version 2", { format: SAVE_FORMAT, version: 2, save: {} }],
    ["no version", { format: SAVE_FORMAT, save: {} }],
    ["save missing", { format: SAVE_FORMAT, version: 1 }],
    ["save is a number", { format: SAVE_FORMAT, version: 1, save: 5 }],
    ["save is null", { format: SAVE_FORMAT, version: 1, save: null }],
    ["save is an array", { format: SAVE_FORMAT, version: 1, save: [] }],
  ];
  for (const [what, o] of refused) {
    assert.equal(parseSaveFile(file(o)).ok, false, `accepted: ${what}`);
  }
  assert.equal(parseSaveFile(file({ format: SAVE_FORMAT, version: 1, save: {} })).ok, true);
});

test("wrong types and out-of-range values are refused, not coerced", () => {
  const wrap = (save: unknown) => file({ format: SAVE_FORMAT, version: 1, save });
  const refused: [string, unknown][] = [
    ["volume above 1", { settings: { musicVolume: 1.5 } }],
    ["volume below 0", { settings: { sfxVolume: -0.1 } }],
    ["volume as a string", { settings: { sfxVolume: "0.5" } }],
    ["boolean as a string", { settings: { menuMusic: "yes" } }],
    ["settings is an array", { settings: [] }],
    ["levels is an array", { levels: [] }],
    ["level entry is a number", { levels: { "1": 3 } }],
    ["negative normal", { levels: { "1": { normal: -1 } } }],
    ["string attempts", { levels: { "1": { attempts: "3" } } }],
    ["coin 3", { levels: { "1": { coins: [3] } } }],
    ["coin 0.5", { levels: { "1": { coins: [0.5] } } }],
    ["coins not an array", { levels: { "1": { coins: 1 } } }],
    ["cube 0", { icons: { cube: 0 } }],
    ["cube past the count", { icons: { cube: 486 } }],
    ["cube as a float", { icons: { cube: 1.5 } }],
    ["col1 past the palette", { icons: { col1: 999 } }],
    ["glow as a string", { icons: { glow: "yes" } }],
    ["icons is null", { icons: null }],
  ];
  for (const [what, body] of refused) {
    assert.equal(parseSaveFile(wrap(body)).ok, false, `accepted: ${what}`);
  }
});

test("keys this version does not know are ignored, not a reason to refuse", () => {
  const r = parseSaveFile(file({
    format: SAVE_FORMAT, version: 1, extra: "ignored",
    save: { v: 1, levels: {}, settings: { fastMenu: true }, icons: { cube: 2 }, note: 1 },
  }));
  assert.equal(r.ok, true);
});

test("the file name and format tag are the agreed constants", () => {
  assert.equal(SAVE_FILE_NAME, "geometry-dash-save.json");
  assert.equal(SAVE_FORMAT, "gd-web-save-file");
  const out = JSON.parse(exportSave(save.save()));
  assert.equal(out.format, "gd-web-save-file");
  assert.equal(out.version, 1);
  assert.deepEqual(Object.keys(out.save).sort(), ["icons", "levels", "settings", "v"]);
});

test("applying a refused file leaves the save and storage untouched and does not reload", () => {
  save.loadFrom({ levels: { "1": { normal: 30, practice: 0, coins: [], attempts: 1, jumps: 0 } } });
  const before = structuredClone(save.save());
  let reloads = 0;
  const writes = withStorage(() => {
    const r = applySaveText("[1,2", () => { reloads++; });
    assert.equal(r.ok, false);
  });
  assert.deepEqual(save.save(), before);
  assert.deepEqual(writes, []);
  assert.equal(reloads, 0);
});

test("applying an accepted file writes it, flushes it, and reloads once", () => {
  save.loadFrom(null);
  let reloads = 0;
  const text = file({
    format: SAVE_FORMAT, version: 1,
    save: { levels: { "3": { normal: 100, practice: 0, coins: [2], attempts: 9, jumps: 4 } } },
  });
  const writes = withStorage(() => {
    const r = applySaveText(text, () => { reloads++; });
    assert.equal(r.ok, true);
  });
  assert.equal(save.levelStats(3).normal, 100);
  assert.deepEqual(save.levelStats(3).coins, [2]);
  assert.equal(writes.length, 1);
  assert.match(writes[0], /^gd-web-save=/);
  assert.equal(reloads, 1);
});
