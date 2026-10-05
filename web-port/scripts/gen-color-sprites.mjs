// Reads the gd-ui-capture mod's `sprites` dumps and writes the per-id detail
// (`m_colorSprite`) layout the game really uses.
//
//   node scripts/gen-color-sprites.mjs
//
// The `geometry` dump in data/native-geometry.jsonl also records the colour
// sprite, but it takes the *first* instance of an id in the loaded level, and
// in a `sprites` dump taken at the same moment every Dash pixel-art object
// shows its colour sprite parented to the object at z +100 — where the
// geometry dump has the same sprite loose in the layer at z 0, sitting on the
// object's own position. A `sprites` dump is per-instance and live, so it wins
// wherever it covers an id; the geometry dump fills in the rest.
//
// Output: data/native-color-sprites.json, { id: {x,y,w,h,ax,ay,sx,sy,rot,z} }
// with the position, anchor, scale, rotation and z of the sprite node itself,
// exactly as the game states them. Where instances of one id disagree, the
// value seen most often wins and `mixed` lists the ids that disagreed at all.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VISUAL = path.join(ROOT, "..", "docs", "fidelity", "captures-2026-09-29", "visual");
const OUT = path.join(ROOT, "data", "native-color-sprites.json");

/** `pos=(1,2) size=(3,4) anchor=(0.5,0.5) scale=(1,1) rot=0 z=9 vis=1` */
function parseSprite(line) {
  const nums = (key) => {
    const m = new RegExp(`\\b${key}=\\(([^)]*)\\)`).exec(line);
    return m ? m[1].split(",").map(Number) : null;
  };
  const pos = nums("pos"), size = nums("size"), anchor = nums("anchor");
  const scale = nums("scale");
  if (!pos || !size || !anchor) return null;
  const rot = Number(/\brot=(-?[\d.]+)/.exec(line)?.[1] ?? 0);
  const z = Number(/\bz=(-?[\d.]+)/.exec(line)?.[1] ?? 0);
  const vis = Number(/\bvis=(-?[\d.]+)/.exec(line)?.[1] ?? 1);
  return {
    x: pos[0], y: pos[1], w: size[0], h: size[1],
    ax: anchor[0], ay: anchor[1],
    sx: scale ? scale[0] : 1, sy: scale ? scale[1] : 1, rot, z, vis,
  };
}

if (!fs.existsSync(VISUAL)) {
  process.stderr.write(`no sprites dumps under ${VISUAL}; nothing to do\n`);
  process.exit(0);
}

const seen = new Map(); // id -> Map(signature -> [sprite, count])
for (const name of fs.readdirSync(VISUAL).filter((f) => /^sprites-.*\.txt$/.test(f)).sort()) {
  let id = -1;
  for (const line of fs.readFileSync(path.join(VISUAL, name), "utf8").split("\n")) {
    const m = /^OBJECT id=(\d+)/.exec(line);
    if (m) { id = Number(m[1]); continue; }
    if (!/^ {2}colorSprite /.test(line) || id < 0) continue;
    const s = parseSprite(line);
    if (!s) continue;
    const sig = JSON.stringify([s.x, s.y, s.w, s.h, s.ax, s.ay, s.sx, s.sy, s.rot, s.z]);
    let bySig = seen.get(id);
    if (!bySig) seen.set(id, (bySig = new Map()));
    const hit = bySig.get(sig);
    if (hit) hit[1]++;
    else bySig.set(sig, [s, 1]);
  }
}

const out = {};
const mixed = [];
for (const [id, bySig] of [...seen].sort((a, b) => a[0] - b[0])) {
  const ranked = [...bySig.values()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1) mixed.push(id);
  const { x, y, w, h, ax, ay, sx, sy, rot, z } = ranked[0][0];
  out[id] = { x, y, w, h, ax, ay, sx, sy, rot, z };
}

fs.writeFileSync(OUT, `${JSON.stringify(out, null, 0)}\n`);
process.stderr.write(
  `wrote ${path.relative(ROOT, OUT)}: ${Object.keys(out).length} ids` +
  (mixed.length ? ` (${mixed.length} laid out differently by instance: ${mixed.join(" ")})` : "") + "\n",
);
