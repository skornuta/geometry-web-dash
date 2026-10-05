// The visual regression suite: every native batch shot (docs/fidelity/
// captures-2026-10-03/batch, every 10% of the 21 macro levels, mod overlays
// hidden) beside the port rendered at the same x.
//   node scripts/regression-pairs.mjs [out-dir] [filter: "22" or "22-50"]
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const dir = new URL("../../docs/fidelity/captures-2026-10-03/batch/", import.meta.url).pathname;
const out = process.argv[2] ?? "/tmp/regression-pairs";
const filter = process.argv[3];
mkdirSync(out, { recursive: true });
for (const line of readFileSync(join(dir, "index.txt"), "utf8").trim().split("\n")) {
  const [lvl, pct, x] = line.split(" ");
  if (filter && filter !== lvl && filter !== `${lvl}-${pct}`) continue;
  const native = join(dir, `l${lvl}-${pct}.png`);
  if (!existsSync(native)) continue;
  const port = join(out, `port-l${lvl}-${pct}.png`);
  const pair = join(out, `pair-l${lvl}-${pct}.png`);
  if (existsSync(pair) && !process.env.FORCE) continue;
  try {
    execFileSync("node", ["scripts/port-at.mjs", lvl, x, port], { stdio: "ignore" });
    execFileSync("node", ["scripts/image-tools.mjs", "pair", native, port, pair], { stdio: "ignore" });
    console.log(`l${lvl}-${pct}`);
  } catch (e) {
    console.log(`l${lvl}-${pct} FAILED`);
  }
}
