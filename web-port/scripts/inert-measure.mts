// Task 4 measurement: every inert-trigger/object instance in a level, with its
// position, keys, the groups it targets and what those groups contain.
// Usage: node scripts/inert-measure.mts <level> [ids...]
import { readFileSync } from "node:fs";
import { decodeLevelString } from "../src/gd/level.ts";
import { OBJECT_DEFS } from "../src/gd/objects.ts";
import { parseGroups } from "../src/gd/triggers.ts";

const [lvl, ...rest] = process.argv.slice(2);
const ids = new Set((rest.length ? rest : ["1594", "3006", "1611", "1811", "1812", "1815", "1816", "1817", "1585", "1347"]).map(Number));
const level = await decodeLevelString(readFileSync(`public/assets/levels/${lvl}.txt`, "utf8"));

// group -> contents summary
const byGroup = new Map<number, number[]>();
level.objects.forEach((o, i) => { for (const g of parseGroups(o)) (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(i); });
const summarize = (g: number) => {
  const members = byGroup.get(g) ?? [];
  const kinds = new Map<string, number>();
  for (const i of members) {
    const o = level.objects[i];
    const d = OBJECT_DEFS.get(o.id);
    const k = d ? `${d.kind}` : `id${o.id}`;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  const xs = members.map((i) => level.objects[i].x);
  const span = xs.length ? `x ${Math.min(...xs).toFixed(0)}..${Math.max(...xs).toFixed(0)}` : "";
  const ids = [...new Set(members.map((i) => level.objects[i].id))].slice(0, 8).join(",");
  return `g${g}: ${members.length} [${[...kinds].map(([k, n]) => `${k}×${n}`).join(" ")}] ${span} ids{${ids}}`;
};
for (const [i, o] of level.objects.entries()) {
  if (!ids.has(o.id)) continue;
  const keys = [...o.props].filter(([k]) => ![1, 2, 3].includes(k)).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`#${i} id ${o.id} at (${o.x}, ${o.y})  ${keys}`);
  const targets = new Set<number>();
  for (const k of [51, 71, 80, 95]) { const v = parseInt(o.props.get(k) ?? "", 10); if (v > 0) targets.add(v); }
  for (const g of targets) console.log(`    ${summarize(g)}`);
}
