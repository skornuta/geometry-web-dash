// Diff what the game drew against what the port drew at the same moment.
//
//   node scripts/draw-diff.mjs <level> <native-objects.csv> <port-draws.json> [--verbose]
//
// Native side: the gd-ui-capture mod's `objects` dump (every object near the
// camera, with the colour and opacity it is really drawn with, in GD space).
// Port side: `scripts/port-at.mjs --draws` (every sprite drawn, per level
// object). Objects are matched by level index through id + position.
//
// Reported per object id: drawn natively but not by the port (and the reverse),
// opacity off by more than 8/255, main colour off by more than 12/255 on any
// channel, and the same for the detail (colour) sprite.
import { readFileSync } from "node:fs";
import { loadWorld } from "./headless.mjs";

const [lvl, nativeCsv, portJson] = process.argv.slice(2);
const verbose = process.argv.includes("--verbose");
const { level } = await loadWorld(Number(lvl));

const [head, ...rows] = readFileSync(nativeCsv, "utf8").trim().split("\n");
const keys = head.split(",");
const native = rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [keys[i], v])));

/** level objects by id, for matching a native object to its index */
const byId = new Map();
level.objects.forEach((o, i) => {
  let list = byId.get(o.id);
  if (!list) byId.set(o.id, (list = []));
  list.push({ i, x: o.x, y: o.y });
});
function indexOf(n) {
  const x = +n.x, y = +n.y - 90;
  let best = -1, bd = 2;
  for (const c of byId.get(+n.id) ?? []) {
    const d = Math.abs(c.x - x) + Math.abs(c.y - y);
    if (d < bd) { bd = d; best = c.i; }
  }
  return best;
}

const draws = JSON.parse(readFileSync(portJson, "utf8"));
const port = new Map();
for (const d of draws) {
  let e = port.get(d.obj);
  if (!e) port.set(d.obj, (e = { main: null, detail: null }));
  if (d.glow) continue;
  // the object's own sprite, and its detail (colour) sprite: the child drawn
  // from the detail slot — the game's `m_colorSprite`
  if (d.main) e.main = d;
  else if (d.detail && !e.detail) e.detail = d;
}

const issues = new Map();
const note = (id, kind, text) => {
  const k = `${id} ${kind}`;
  const e = issues.get(k) ?? { id, kind, n: 0, ex: text };
  e.n++; issues.set(k, e);
};
const off = (a, b, tol) => Math.abs(a - b) > tol;
let matched = 0, unmatched = 0;
const seen = new Set();
for (const n of native) {
  const idx = indexOf(n);
  if (idx < 0) { unmatched++; continue; }
  seen.add(idx);
  const nVis = n.vis === "1" && +n.dispOp > 0;
  const p = port.get(idx);
  if (!nVis) {
    if (p?.main && p.main.a > 0.03) note(n.id, "port draws, game hides", `x=${n.x} port a=${p.main.a.toFixed(2)}`);
    continue;
  }
  matched++;
  if (!p?.main) { note(n.id, "game draws, port does not", `x=${n.x} y=${n.y}`); continue; }
  const pa = p.main.a * 255;
  if (off(pa, +n.dispOp, 8)) note(n.id, "opacity", `game ${n.dispOp} port ${pa.toFixed(0)}`);
  const pc = [p.main.r * 255, p.main.g * 255, p.main.b * 255];
  const nc = [+n.dispR, +n.dispG, +n.dispB];
  if (pc.some((v, i) => off(v, nc[i], 12))) note(n.id, "main colour", `game ${nc.join(",")} port ${pc.map(Math.round).join(",")} ch${p.main.ch}`);
  if (n.dvis === "1") {
    const dc = [+n.ddr, +n.ddg, +n.ddb];
    if (!p.detail) note(n.id, "detail sprite missing", `game ${dc.join(",")}`);
    else {
      const pd = [p.detail.r * 255, p.detail.g * 255, p.detail.b * 255];
      if (pd.some((v, i) => off(v, dc[i], 12))) note(n.id, "detail colour", `game ${dc.join(",")} port ${pd.map(Math.round).join(",")} ch${p.detail.ch}`);
    }
  }
}
const list = [...issues.values()].sort((a, b) => b.n - a.n);
console.log(`L${lvl}: ${matched} objects compared (${unmatched} unmatched), ${list.reduce((s, e) => s + e.n, 0)} differences in ${list.length} groups`);
for (const e of verbose ? list : list.slice(0, 25)) console.log(`  id ${String(e.id).padStart(5)}  ${e.kind.padEnd(26)} x${e.n}  e.g. ${e.ex}`);
