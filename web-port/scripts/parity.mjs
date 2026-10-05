// Browser/headless parity across every level, in one table.
//
//   node scripts/parity.mjs [--beam=256] [--levels=1,2,3] [--jobs=4] [--keep=DIR]
//
// For each level this searches a completing run with `autoplay.mjs` (the
// headless rules in `sim.ts`), then drives that exact input sequence through the
// real browser build with `?manual=1`, where `__play.stepTick()` advances the
// simulation instead of the clock. If the two disagree, `playLevel.ts` has grown
// a rule `sim.ts` does not have — the one divergence this architecture allows,
// and the reason `playLevel.ts` must never own a rule.
//
// This is the acceptance test to reach for after a physics change lands: the
// sweep proves a route exists, and this proves the browser plays it too.
//
// Levels the search cannot solve at the given beam are reported as `no route`
// and are not a parity failure — widen the beam or fix the physics first.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((s) => s.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const beam = flag("beam", "256");
// Two by default: each job holds a Chromium *and* a search, and four of them
// on the big levels (L15/16/18) ran the machine out of room and crashed the
// replays — which read as divergences and are not.
const jobs = Math.max(1, parseInt(flag("jobs", "2"), 10));
const keep = flag("keep", null);
const levels = flag("levels", null)
  ? flag("levels", "").split(",").map((s) => parseInt(s, 10))
  : Array.from({ length: 22 }, (_, i) => i + 1);

const dir = keep ?? mkdtempSync(join(tmpdir(), "gd-parity-"));

/** the most useful line of a crashed child's output, not the Node version banner */
function why(err, out) {
  const lines = `${err}\n${out}`.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /Error|error:|failed|Timeout/i.test(l))
    ?? lines.filter((l) => !/^Node\.js v/.test(l)).slice(-1)[0]
    ?? "no output";
}

function sh(cmd, argv) {
  return new Promise((resolve) => {
    const p = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", (e) => { err += `${e.message}\n`; });
    p.on("close", (code) => resolve({ out, err, code }));
  });
}

// autoplay prints `(100.0%)`; replay prints `percent=100.0%`
const pct = (s) =>
  s.match(/percent=([\d.]+)%/)?.[1] ?? s.match(/\(([\d.]+)%\)/)?.[1] ?? null;

async function one(level) {
  const run = join(dir, `run${level}.json`);
  const search = await sh(process.execPath,
    [join(here, "autoplay.mjs"), String(level), `--beam=${beam}`, `--out=${run}`]);
  if (!/COMPLETED/.test(search.out)) {
    const why = /FAILED/.test(search.out)
      ? `no route at beam ${beam} (${pct(search.out) ?? "?"}%)`
      : `search ERRORED: ${why(search.err, search.out)}`;
    return { level, status: "skip", note: why };
  }
  // One retry, run alone: a replay that died because the machine was busy is
  // not a divergence, and silently reporting it as one would be worse than slow.
  let replay = await sh(process.execPath, [join(here, "replay.mjs"), run, dir]);
  let browser = pct(replay.out);
  if (replay.code !== 0 || browser === null) {
    replay = await sh(process.execPath, [join(here, "replay.mjs"), run, dir]);
    browser = pct(replay.out);
  }
  if (replay.code !== 0 || browser === null) {
    return { level, status: "fail", note: `browser replay crashed: ${why(replay.err, replay.out)}` };
  }
  // The recorded run completes by construction, so anything short of 100 in the
  // browser is a divergence, not a worse route.
  const ok = Number(browser) >= 99.9;
  return {
    level, status: ok ? "ok" : "fail",
    note: ok ? `browser ${browser}%` : `browser stopped at ${browser}% — DIVERGENCE`,
  };
}

const results = [];
const queue = [...levels];
await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
  while (queue.length) {
    const r = await one(queue.shift());
    results.push(r);
    process.stderr.write(`  level ${r.level}: ${r.status} — ${r.note}\n`);
  }
}));

results.sort((a, b) => a.level - b.level);
console.log(`\nbrowser/headless parity at beam ${beam}`);
for (const r of results) {
  const label = { ok: "MATCH   ", fail: "DIVERGE ", skip: "no route" }[r.status];
  console.log(`  L${String(r.level).padStart(2)}  ${label}  ${r.note}`);
}
const bad = results.filter((r) => r.status === "fail");
const ok = results.filter((r) => r.status === "ok").length;
const skipped = results.filter((r) => r.status === "skip").length;
console.log(`\n${ok} match, ${bad.length} diverge, ${skipped} without a route at beam ${beam}`);
if (!keep) rmSync(dir, { recursive: true, force: true });
if (bad.length) process.exitCode = 1;
