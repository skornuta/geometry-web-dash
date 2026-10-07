// Tests for the save data rules (src/gd/save.ts).
//
// These pin the parts that are *game rules*, not storage plumbing: practice and
// normal percent are separate stats, neither ever moves backwards, and a coin
// picked up in practice mode does not count. Getting any of those wrong is
// invisible until a player loses progress, so they are worth pinning.
//
// No localStorage in node: every read/write in save.ts is guarded, so it falls
// back to an in-memory copy here. `loadFrom` seeds that copy directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as save from "../src/gd/save.ts";
import { ICON_COUNTS, PLAYER_COLORS } from "../src/gd/icons.ts";

function fresh() {
  save.loadFrom(null);
}

/** the defaults, as a plain value, to compare a repaired load against */
function defaultSave() {
  save.loadFrom(null);
  return structuredClone(save.save());
}

/**
 * Run `body` with a fake `localStorage` whose `getItem` is `getItem`, then
 * remove it again. Returns every write `body` caused, so a test can assert
 * that loading never rewrites storage. Node has no localStorage, so this is the
 * only way to reach the parse path in save.ts (`loadFrom` skips it).
 */
function withStorage(getItem: (key: string) => string | null, body: () => void): string[] {
  const writes: string[] = [];
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = {
    getItem,
    setItem: (key: string, value: string) => { writes.push(`${key}=${value}`); },
  };
  try {
    save.resetCache();
    body();
  } finally {
    delete g.localStorage;
    save.resetCache();
  }
  return writes;
}

test("normal and practice percent are separate stats", () => {
  fresh();
  save.recordProgress(1, 40, false);
  save.recordProgress(1, 90, true);
  const st = save.levelStats(1);
  assert.equal(st.normal, 40);
  assert.equal(st.practice, 90);
  // a big practice run must not make the level look complete
  assert.equal(save.isCompleted(1), false);
});

test("neither percent bar ever moves backwards", () => {
  fresh();
  save.recordProgress(1, 75, false);
  assert.equal(save.recordProgress(1, 30, false), false);
  assert.equal(save.levelStats(1).normal, 75);
  // and a new best does report itself as one
  assert.equal(save.recordProgress(1, 76, false), true);
  assert.equal(save.levelStats(1).normal, 76);
});

test("a level is complete only at a normal-mode 100%", () => {
  fresh();
  save.recordProgress(2, 100, true);
  assert.equal(save.isCompleted(2), false);
  save.recordProgress(2, 100, false);
  assert.equal(save.isCompleted(2), true);
});

test("coins collected in practice mode do not count", () => {
  fresh();
  assert.equal(save.recordCoin(3, 0, true), false);
  assert.deepEqual(save.levelStats(3).coins, []);
  assert.equal(save.recordCoin(3, 0, false), true);
  assert.deepEqual(save.levelStats(3).coins, [0]);
  // and the same coin twice is not two coins
  assert.equal(save.recordCoin(3, 0, false), false);
  assert.deepEqual(save.levelStats(3).coins, [0]);
});

test("attempts accumulate rather than restarting at 1", () => {
  fresh();
  assert.equal(save.recordAttempt(4), 1);
  assert.equal(save.recordAttempt(4), 2);
  assert.equal(save.recordAttempt(4), 3);
  // a different level keeps its own count
  assert.equal(save.recordAttempt(5), 1);
  assert.equal(save.levelStats(4).attempts, 3);
});

test("a corrupt or hostile save is repaired, not trusted", () => {
  save.loadFrom({
    v: 1,
    levels: {
      1: { normal: 999, practice: -5, coins: [0, 0, 7, 2], attempts: -3, jumps: "x" },
      2: "not an object",
    },
    settings: { musicVolume: 42, sfxVolume: 0.5 },
    icons: { glow: "yes" },
  });
  const st = save.levelStats(1);
  assert.equal(st.normal, 100, "percent clamps to 100");
  assert.equal(st.practice, 0, "negative percent clamps to 0");
  assert.deepEqual(st.coins, [0, 2], "coins are deduped and range-checked");
  assert.equal(st.attempts, 0);
  assert.equal(st.jumps, 0);
  assert.equal(save.settings().musicVolume, 1, "volume clamps into 0..1");
  assert.equal(save.settings().sfxVolume, 0.5);
  assert.equal(save.icons().glow, false, "glow is coerced to a real boolean");
  // the unusable level entry is simply absent rather than crashing a read
  assert.equal(save.levelStats(2).normal, 0);
});

test("totalCoins counts every level's coins", () => {
  fresh();
  save.recordCoin(1, 0, false);
  save.recordCoin(1, 1, false);
  save.recordCoin(2, 0, false);
  assert.equal(save.totalCoins(), 3);
});

// ── F5: a missing, corrupt, or older save boots with defaults and never throws ──

test("F5 case 1: a missing save key boots with defaults", () => {
  const expected = defaultSave();
  const keys: string[] = [];
  const writes = withStorage((key) => { keys.push(key); return null; }, () => {
    assert.deepEqual(structuredClone(save.save()), expected);
  });
  assert.deepEqual(keys, ["gd-web-save"], "reads the storage key the game has always used");
  assert.deepEqual(writes, [], "loading never rewrites storage");
});

test("F5 case 2: corrupt JSON text boots with defaults and does not throw", () => {
  const expected = defaultSave();
  const writes = withStorage(() => "[1,2", () => {
    assert.deepEqual(structuredClone(save.save()), expected);
  });
  assert.deepEqual(writes, []);
});

test("F5 case 3: a throwing getItem (storage disabled) boots with defaults", () => {
  const expected = defaultSave();
  const writes = withStorage(() => { throw new Error("storage disabled"); }, () => {
    assert.deepEqual(structuredClone(save.save()), expected);
  });
  assert.deepEqual(writes, []);
});

test("F5 case 4: a non-object top level boots with defaults", () => {
  const expected = defaultSave();
  for (const text of ["42", '"x"', "null", "[]"]) {
    withStorage(() => text, () => {
      assert.deepEqual(structuredClone(save.save()), expected, `top level ${text}`);
    });
  }
});

test("F5 case 5: an older save fills missing fields with defaults and keeps the present ones", () => {
  const expected = defaultSave();
  // no `v`, no `icons`, and a `settings` block from before percentageDecimals and clickedPractice
  const older = {
    levels: { "1": { normal: 60, practice: 10, coins: [1], attempts: 4, jumps: 90 } },
    settings: { musicVolume: 0.25, sfxVolume: 0.5 },
  };
  withStorage(() => JSON.stringify(older), () => {
    const s = save.save();
    assert.equal(s.v, expected.v);
    assert.deepEqual(s.levels["1"], { normal: 60, practice: 10, coins: [1], attempts: 4, jumps: 90 });
    assert.equal(s.settings.musicVolume, 0.25, "present field kept");
    assert.equal(s.settings.sfxVolume, 0.5, "present field kept");
    assert.equal(s.settings.percentageDecimals, expected.settings.percentageDecimals, "added later: default");
    assert.equal(s.settings.clickedPractice, expected.settings.clickedPractice, "added later: default");
    assert.deepEqual(s.icons, expected.icons, "missing icons block: default kit");
  });
});

test("F5 case 6: infinite attempts and jumps are repaired to 0 in memory", () => {
  const writes = withStorage(() => '{"levels":{"1":{"attempts":1e999,"jumps":1e999}}}', () => {
    const st = save.levelStats(1);
    assert.equal(st.attempts, 0, "attempts: Infinity becomes 0");
    assert.equal(st.jumps, 0, "jumps: Infinity becomes 0");
    // the repaired count keeps counting from 0, not from Infinity
    assert.equal(save.recordAttempt(1), 1);
  });
  // the load itself wrote nothing; only the explicit recordAttempt flushed
  assert.equal(writes.length, 1);
  assert.match(writes[0], /"attempts":1,/);
});

test("F5 case 7: an icon that is not a valid index falls back to its default, field by field", () => {
  save.loadFrom({
    icons: {
      cube: "abc",
      ship: null,
      ball: ICON_COUNTS.ball + 1,
      ufo: 3,
      wave: 0,
      robot: 2.5,
      spider: ICON_COUNTS.spider,
      swing: -1,
      col1: PLAYER_COLORS.length,
      col2: 5,
      glow: true,
    },
  });
  const k = save.icons();
  const d = defaultSave().icons;
  assert.equal(k.cube, d.cube, "non-number falls back");
  assert.equal(k.ship, d.ship, "null falls back");
  assert.equal(k.ball, d.ball, "past the last ball icon falls back");
  assert.equal(k.ufo, 3, "a valid index is kept");
  assert.equal(k.wave, d.wave, "0 is below the first icon");
  assert.equal(k.robot, d.robot, "a non-whole index falls back");
  assert.equal(k.spider, ICON_COUNTS.spider, "the last spider icon is still valid");
  assert.equal(k.swing, d.swing, "a negative index falls back");
  assert.equal(k.col1, d.col1, "past the palette falls back");
  assert.equal(k.col2, 5, "a valid palette index is kept");
  assert.equal(k.glow, true);
});

test("F4: Fast Menu is off on a fresh save", () => {
  fresh();
  assert.equal(save.settings().fastMenu, false);
});

test("F4: a saved fastMenu true survives a reload, and a non-boolean falls back to off", () => {
  save.loadFrom({ v: 1, settings: { fastMenu: true } });
  assert.equal(save.settings().fastMenu, true);
  save.loadFrom(JSON.parse(JSON.stringify({ v: 1, settings: { fastMenu: true } })));
  assert.equal(save.settings().fastMenu, true, "survives a JSON round trip");
  save.loadFrom({ v: 1, settings: { fastMenu: "yes" } });
  assert.equal(save.settings().fastMenu, false, "a non-boolean is not trusted");
});
