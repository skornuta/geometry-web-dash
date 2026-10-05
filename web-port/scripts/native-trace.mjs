// Turn a native macro into the per-frame path the gd-ui-capture mod's `seek`
// walks, so the real game can be stopped at any x of a real run.
//
//   node scripts/native-trace.mjs <level> [out.txt]
//
// One line per 240 Hz frame: "x y rotation held". The position on line f is
// where player 1 stood *before* frame f (the previous frame's recorded fix), so
// the mod places the player there and lets the game step it; `held` is the
// button state for frame f, delayed one frame exactly as macro-compare.mjs
// does (xdBot stamps an input on the frame the game first answers it).
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MACROS = new URL("../../macros-main/", import.meta.url).pathname;
const level = parseInt(process.argv[2] ?? "", 10);
const out = process.argv[3] ?? `/tmp/gd-ui-capture/trace-${level}.txt`;
const file = readdirSync(MACROS).find((f) => {
  if (!f.endsWith(".json")) return false;
  return JSON.parse(readFileSync(join(MACROS, f), "utf8")).level.id === level;
});
if (!file) throw new Error(`no macro for level ${level}`);
const macro = JSON.parse(readFileSync(join(MACROS, file), "utf8"));

const fixes = new Map(macro.frameFixes.map((f) => [f.frame, f.p1]));
const last = macro.frameFixes[macro.frameFixes.length - 1].frame;
const ins = macro.inputs.filter((i) => i.btn === 1 && !i["2p"]).sort((a, b) => a.frame - b.frame);

const lines = [];
// the level starts with the player standing at the origin on the ground
let prev = { x: 0, y: 105, r: 0 };
let held = 0, i = 0;
for (let f = 1; f <= last; f++) {
  while (i < ins.length && ins[i].frame + 1 <= f) { held = ins[i].down ? 1 : 0; i++; }
  // a decaying rotation reaches float denormals (~1e-39), which the mod's
  // `std::istream >> float` rejects as out of range and stops reading at
  const r = Math.abs(prev.r ?? 0) < 1e-30 ? 0 : (prev.r ?? 0);
  lines.push(`${prev.x} ${prev.y} ${r} ${held}`);
  prev = fixes.get(f) ?? prev;
}
mkdirSync("/tmp/gd-ui-capture", { recursive: true });
writeFileSync(out, lines.join("\n") + "\n");
console.log(`${out}: ${lines.length} frames of ${macro.level.name}`);
