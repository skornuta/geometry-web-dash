// The sweep's result classification. This exists because the sweep once
// reported `0/22` with unknown percentages when every child had *crashed* on a
// module error — indistinguishable, in that table, from 22 levels the search
// genuinely could not solve. A run that never started is not gameplay evidence,
// and it must not read like it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../scripts/sweep.mjs";

const COMPLETED = `level 3: COMPLETED
  x 12345 / 12345  (100.0%)
  1200 ticks (20.0s of play), 30 input edges, coins 1
  search: 2.1s, beam 256`;

const FAILED = `level 14: FAILED
  furthest x 10827 / 26623  (40.7%) at tick 2084
  killed by: solid id=119 x2 (y 15..25)
  search: 1.0s, beam 256`;

test("a completed level reads as complete, with its percent", () => {
  const r = classify(COMPLETED, "", 0);
  assert.equal(r.status, "complete");
  assert.equal(r.pct, "100.0");
});

test("a level the search could not solve reports where and why", () => {
  const r = classify(FAILED, "", 1);
  assert.equal(r.status, "failed");
  assert.equal(r.pct, "40.7");
  assert.equal(r.x, "10827");
  assert.ok(r.killed.includes("solid id=119"));
});

test("a child that crashed is an ERROR, never a 0% search result", () => {
  const err = "SyntaxError: The requested module does not provide an export named 'X'";
  const r = classify("", err, 1);
  assert.equal(r.status, "error");
  assert.ok(r.killed.includes("does not provide an export"),
    "the child's stderr is carried through, not swallowed");
});

test("a child killed without output is an ERROR too", () => {
  const r = classify("", "", 139);
  assert.equal(r.status, "error");
  assert.ok(r.killed.includes("139"), "the exit code is reported");
});

test("partial output with no verdict line is an ERROR, not a silent pass", () => {
  const r = classify("level 9: starting\n", "", 0);
  assert.equal(r.status, "error");
});

test("stderr on an otherwise good run does not turn it into an error", () => {
  // autoplay writes progress notes to stderr; only a missing verdict is fatal
  const r = classify(COMPLETED, "some warning\n", 0);
  assert.equal(r.status, "complete");
});
