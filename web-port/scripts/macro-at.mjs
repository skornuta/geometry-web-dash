// Where was the real run at a given percentage? Prints the macro frame's exact
// x and y, so `shot-at.mjs` can be pointed at the same place the running game
// is showing — including mid-flight, which is the whole point of driving the
// game from the macro rather than from noclip.
//
//   node scripts/macro-at.mjs <level> <pct> [<pct> ...]
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadWorld } from "./headless.mjs";
import { levelLength, lastObjectX } from "../src/gd/levelEnd.ts";

const MACROS = new URL("../../macros-main/", import.meta.url).pathname;
const lvl = Number(process.argv[2]);
const pcts = process.argv.slice(3).map(Number);

const file = readdirSync(MACROS).find((f) =>
  f.endsWith(".json") && JSON.parse(readFileSync(join(MACROS, f), "utf8")).level.id === lvl);
if (!file) { console.error(`no macro for level ${lvl}`); process.exit(2); }
const macro = JSON.parse(readFileSync(join(MACROS, file), "utf8"));
const fixes = macro.frameFixes.filter((f) => f.p1 && "x" in f.p1);

const { level } = await loadWorld(lvl);
const len = levelLength(lastObjectX(level));

for (const pct of pcts) {
  const wantX = (pct / 100) * len;
  let best = fixes[0];
  for (const f of fixes) if (Math.abs(f.p1.x - wantX) < Math.abs(best.p1.x - wantX)) best = f;
  // the macro records the game's y; ours is that minus the 90-unit floor offset
  console.log(`${pct}\t${best.p1.x.toFixed(0)}\t${(best.p1.y - 90).toFixed(0)}\tframe ${best.frame}`);
}
