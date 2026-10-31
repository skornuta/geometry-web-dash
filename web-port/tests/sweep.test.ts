// The sweep's result classification. This exists because the sweep once
// reported `0/22` with unknown percentages when every child had *crashed* on a
// module error — indistinguishable, in that table, from 22 levels the search
// genuinely could not solve. A run that never started is not gameplay evidence,
// and it must not read like it is.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../scripts/sweep.mjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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

// Exercise the real CLI with a deterministic child instead of an expensive
// search. A FAILED result is valid search output, but must fail the gate.
function runSweep(output: string, code: number) {
  const dir = mkdtempSync(join(tmpdir(), "gd-sweep-gate-"));
  try {
    writeFileSync(join(dir, "sweep.mjs"),
      readFileSync(new URL("../scripts/sweep.mjs", import.meta.url)));
    writeFileSync(join(dir, "autoplay.mjs"),
      `console.log(${JSON.stringify(output)}); process.exitCode = ${code};`);
    return spawnSync(process.execPath,
      [join(dir, "sweep.mjs"), "--levels=1", "--retry=0"],
      { encoding: "utf8", timeout: 10000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the sweep CLI exits nonzero when a search cannot complete a level", () => {
  const r = runSweep(FAILED, 1);
  assert.ifError(r.error);
  assert.match(r.stdout, /0 \/ 1 complete/);
  assert.equal(r.status, 1);
});

test("the sweep CLI exits zero when every requested level completes", () => {
  const r = runSweep(COMPLETED, 0);
  assert.ifError(r.error);
  assert.match(r.stdout, /1 \/ 1 complete/);
  assert.equal(r.status, 0);
});

test("the sweep CLI still exits nonzero when a child crashes", () => {
  const r = runSweep("", 1);
  assert.ifError(r.error);
  assert.match(r.stdout, /1 level\(s\) ERRORED/);
  assert.equal(r.status, 1);
});
