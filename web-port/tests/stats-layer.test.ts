// F2: the Stats page's rows. Every value is computed from the save, and a row
// the save cannot back is left out rather than shown as 0.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as save from "../src/gd/save.ts";
import { statsRows } from "../src/ui/statsLayer.ts";

const row = (rows: ReturnType<typeof statsRows>, label: string) => {
  const r = rows.find((x) => x.label === label);
  assert.ok(r, `no row labelled ${label}`);
  return r;
};

test("the rows are computed from the save: attempts, jumps, completed, stars, coins", () => {
  save.loadFrom({
    levels: {
      // Stereo Madness: 100% in normal mode, 1 star
      "1": { normal: 100, practice: 0, coins: [], attempts: 3, jumps: 10 },
      // Back On Track: not completed, two coins
      "2": { normal: 40, practice: 0, coins: [0, 2], attempts: 4, jumps: 5 },
    },
  });
  const rows = statsRows(save.save());

  assert.equal(row(rows, "Attempts").value, 7);
  assert.equal(row(rows, "Jumps").value, 15);
  assert.equal(row(rows, "Completed").value, 1);
  assert.equal(row(rows, "Completed").of, 22);
  assert.equal(row(rows, "Stars").value, 1);
  assert.equal(row(rows, "Secret Coins").value, 2);
  assert.equal(row(rows, "Secret Coins").of, 66);
});

test("a fresh save gives all zeros, with no NaN", () => {
  save.loadFrom(null);
  const rows = statsRows(save.save());
  for (const r of rows) {
    assert.equal(Number.isFinite(r.value), true, `${r.label} is ${r.value}`);
    assert.equal(r.value, 0, `${r.label} should be 0`);
  }
  assert.equal(row(rows, "Secret Coins").of, 66);
});

test("a practice-only run does not count as completed or as stars", () => {
  save.loadFrom({
    levels: { "3": { normal: 0, practice: 100, coins: [], attempts: 1, jumps: 0 } },
  });
  const rows = statsRows(save.save());
  assert.equal(row(rows, "Completed").value, 0);
  assert.equal(row(rows, "Stars").value, 0);
});

test("no row the save cannot back is shown", () => {
  save.loadFrom(null);
  const labels = statsRows(save.save()).map((r) => r.label);
  for (const absent of ["Orbs", "Diamonds", "Moons", "Demons", "User Coins"]) {
    assert.ok(!labels.includes(absent), `${absent} must not be a row`);
  }
});
