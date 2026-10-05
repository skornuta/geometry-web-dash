// Runs the autopilot over every level and prints one table.
//
//   node scripts/sweep.mjs [--beam=256] [--levels=1,2,3] [--jobs=6]
//
// This is the acceptance test for any change to the physics or the hitboxes:
// a percentage per level plus what killed the search where it stopped. Levels
// run in parallel child processes because each one is a single-threaded search.
//
// **Read the beam-width warning in ARCHITECTURE-REFERENCE.md before calling
// anything a regression** — a level that reads low at 128 is often solved at 256+.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

/**
 * Turn one child's output into a row.
 *
 * The distinction that matters is **error vs failure**. This script used to
 * discard the child's stderr and ignore its exit code, so a run where every
 * child crashed on a module error printed `0/22` with unknown percentages —
 * which reads exactly like 22 levels the search could not solve, and is not
 * gameplay evidence at all. A child that produced neither COMPLETED nor FAILED
 * did not play the level, whatever its exit code says.
 */
export function classify(out, err, code) {
  const pct = out.match(/\(([\d.]+)%\)/)?.[1] ?? "?";
  const x = out.match(/furthest x (\d+)/)?.[1] ?? out.match(/x (\d+) \//)?.[1] ?? "?";
  if (/COMPLETED/.test(out)) return { status: "complete", pct, x, killed: "" };
  if (/FAILED/.test(out)) {
    const killed = out.match(/killed by:?\s*(.*)/)?.[1]?.trim()
      ?? out.split("\n").find((l) => /died|killed/.test(l))?.trim() ?? "";
    return { status: "failed", pct, x, killed };
  }
  const why = err.trim().split("\n").filter(Boolean).slice(-3).join(" | ")
    || `no output, exit code ${code}`;
  return { status: "error", pct: "?", x: "?", killed: why };
}

const here = dirname(fileURLToPath(import.meta.url));

// Everything below is the command line. `classify` above is imported by
// `tests/sweep.test.ts`, and without this guard that import would launch 22
// searches as a side effect.
const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const beam = flag("beam", "256");
// A wider beam is not strictly better: `prune` spreads the survivors across the
// live gamemodes and then across the sorted frontier, so widening it changes
// *which* near-identical candidates survive, not just how many. Measured on
// this tree, 256 completes 21 levels and misses 19; 512 completes 21 and misses
// 21 instead. Neither number is a statement about the physics — a level that
// goes through at any width has a route.
//
// So a level that falls short is retried wider before it is called short, and
// the width it needed is reported. `--retry=0` turns that off.
const maxBeam = parseInt(flag("retry", "2048"), 10);
const jobs = parseInt(flag("jobs", "6"), 10);
const levels = flag("levels", null)
  ? flag("levels", "").split(",").map((s) => parseInt(s, 10))
  : Array.from({ length: 22 }, (_, i) => i + 1);

/**
 * Per-level search settings. Dash needs a press timed to one 240 Hz step under
 * the x=8229 trap toggle (the upright ball, x≈8100-8330): a 4-step search
 * never finds it, a single-step window around it completes the level.
 */
const LEVEL_ARGS = { 22: ["--fine=7800-8450"] };

function runAt(level, width) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(here, "autoplay.mjs"), String(level), `--beam=${width}`, ...(LEVEL_ARGS[level] ?? [])],
      { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { err += `${e.message}\n`; });
    p.on("close", (code) => resolve({ level, beam: width, ...classify(out, err, code) }));
  });
}

async function run(level) {
  let best = await runAt(level, Number(beam));
  for (let w = Number(beam) * 2; best.status === "failed" && w <= maxBeam; w *= 2) {
    const wider = await runAt(level, w);
    // keep whichever got further, so a wider run that does *worse* is not
    // reported as the answer
    if (wider.status === "complete" || wider.pct > best.pct) best = wider;
    if (best.status === "complete") break;
  }
  return best;
}

const results = [];
const queue = [...levels];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) {
    const lvl = queue.shift();
    const r = await run(lvl);
    results.push(r);
    const note = r.status === "complete"
      ? (r.beam === Number(beam) ? "OK" : `OK at beam ${r.beam}`)
      : r.status === "error" ? `ERROR — ${r.killed}` : `${r.pct}%`;
    process.stderr.write(`  level ${r.level}: ${note}\n`);
  }
}));

results.sort((a, b) => a.level - b.level);
console.log(`\nsweep at beam ${beam}`);
for (const r of results) {
  const label = r.status === "complete" ? "COMPLETE"
    : r.status === "error" ? "ERROR   " : "        ";
  console.log(`  L${String(r.level).padStart(2)}  ${label}`
    + `  ${String(r.pct).padStart(6)}%  `
    + (r.status === "complete" && r.beam !== Number(beam) ? `(beam ${r.beam}) ` : "")
    + `${r.status === "complete" ? "" : `${r.status === "failed" ? `x=${r.x}  ` : ""}${r.killed}`}`);
}
const done = results.filter((r) => r.status === "complete").length;
const errors = results.filter((r) => r.status === "error");
console.log(`\n${done} / ${results.length} complete`);
if (errors.length) {
  // Loudly, and with a non-zero exit: a sweep where children crashed says
  // nothing about the physics, and must not be quoted as if it did.
  console.log(`${errors.length} level(s) ERRORED and did not play at all — `
    + `this sweep is not evidence about gameplay: ${errors.map((r) => r.level).join(", ")}`);
  process.exitCode = 1;
}

}
