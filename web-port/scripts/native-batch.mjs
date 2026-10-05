// Native-vs-port frame pairs for a set of levels and percentages — the visual
// bug test. Needs native GD running with the gd-ui-capture mod (see
// scripts/native-cmd.mjs) and the dev server for the port captures.
//
//   node scripts/native-batch.mjs [--levels=1,2,12] [--pcts=25,50,75] [--out=DIR]
//
// For each level: open it in the game, walk the real run (macros-main) to each
// percentage and snapshot it; then shoot the port at the same x and height, and
// stitch the pairs into DIR/l<N>.png. Native frames are taken first for every
// level, so the game can be closed before the port captures start.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const levels = flag("levels", "1,2,3,4,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21").split(",").map(Number);
const pcts = flag("pcts", "25,50,75").split(",").map(Number);
const out = flag("out", "/tmp/gd-ui-capture/batch");
const phase = flag("phase", "all"); // native | port | all
mkdirSync(out, { recursive: true });

const node = (script, ...a) => execFileSync("node", [join(here, script), ...a.map(String)], { encoding: "utf8" }).trim();

/** "pct x y frame N" rows from the real run */
function spots(level) {
  return node("macro-at.mjs", level, ...pcts).split("\n")
    .map((l) => l.split(/\s+/)).filter((c) => c.length >= 3 && !Number.isNaN(+c[1]))
    .map(([pct, x, y]) => ({ pct: +pct, x: +x, y: +y }));
}

const plan = levels.map((level) => ({ level, spots: spots(level) }));

if (phase !== "port") {
  for (const { level, spots: s } of plan) {
    node("native-trace.mjs", level);
    node("native-cmd.mjs", "play", level);
    await new Promise((r) => setTimeout(r, 3000));
    node("native-cmd.mjs", "trace", `/tmp/gd-ui-capture/trace-${level}.txt`);
    const meta = [];
    for (const { pct, x } of s) {
      // "frame N at x=.. y=.. cam=cx,cy win=WxH speed=.." — the game's camera
      meta.push({ pct, seek: node("native-cmd.mjs", "seek", x) });
      node("native-cmd.mjs", "objects", join(out, `native-l${level}-${pct}.csv`));
      node("native-cmd.mjs", "shot", join(out, `native-l${level}-${pct}.png`));
    }
    writeFileSync(join(out, `native-l${level}.json`), JSON.stringify(meta));
    console.log(`native L${level}: ${s.map((p) => p.pct).join(",")}%`);
  }
  node("native-cmd.mjs", "menu");
}
if (phase !== "native") {
  for (const { level, spots: s } of plan) {
    const panels = [];
    for (const { pct, x, y } of s) {
      const p = join(out, `port-l${level}-${pct}.png`);
      const draws = join(out, `port-l${level}-${pct}.json`);
      // reached along the real run on the real clock, like the native frame
      node("port-at.mjs", level, x, p, `--draws=${draws}`);
      try {
        const diff = node("draw-diff.mjs", level, join(out, `native-l${level}-${pct}.csv`), draws);
        writeFileSync(join(out, `diff-l${level}-${pct}.txt`), diff + "\n");
      } catch { /* no native dump for this spot */ }
      panels.push(`L${level} ${pct}% NATIVE::${join(out, `native-l${level}-${pct}.png`)}`, `L${level} ${pct}% PORT::${p}`);
    }
    node("compare-shot.mjs", join(out, `l${level}.png`), "--cols=2", "--width=1400", ...panels);
    console.log(`pairs L${level} -> ${join(out, `l${level}.png`)}`);
  }
}
