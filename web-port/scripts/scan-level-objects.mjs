// Scans levels/*.txt, decodes each (urlsafe base64 -> gzip -> GD level string)
// and reports every object ID used, so we know exactly which objects/triggers
// the 22 main levels need. Writes scan-report.json + prints a summary.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "public", "assets", "levels");

export function decodeLevel(raw) {
  const b64 = raw.toString("utf8").trim().replace(/-/g, "+").replace(/_/g, "/");
  const data = gunzipSync(Buffer.from(b64, "base64")).toString("utf8");
  const parts = data.split(";");
  const header = parts[0]; // kS29,... color/level settings
  const objects = [];
  for (let i = 1; i < parts.length; i++) {
    if (!parts[i]) continue;
    const kv = parts[i].split(",");
    const obj = {};
    for (let j = 0; j + 1 < kv.length; j += 2) obj[kv[j]] = kv[j + 1];
    objects.push(obj);
  }
  return { header, objects };
}

const usage = new Map(); // id -> count
let totalObjects = 0;
for (const f of readdirSync(dir).sort((a, b) => parseInt(a) - parseInt(b))) {
  if (!f.endsWith(".txt")) continue;
  const lvl = parseInt(f);
  if (!(lvl >= 1 && lvl <= 22)) continue; // main levels only
  const { objects } = decodeLevel(readFileSync(join(dir, f)));
  totalObjects += objects.length;
  const ids = new Set();
  for (const o of objects) {
    const id = parseInt(o["1"]);
    usage.set(id, (usage.get(id) || 0) + 1);
    ids.add(id);
  }
  console.log(`${f}: ${objects.length} objects, ${ids.size} unique ids`);
}
const sorted = [...usage.entries()].sort((a, b) => a[0] - b[0]);
writeFileSync(
  join(root, "scan-report.json"),
  JSON.stringify({ totalObjects, ids: sorted.map(([id, count]) => ({ id, count })) }, null, 2)
);
console.log(`\ntotal objects: ${totalObjects}, unique ids: ${sorted.length}`);
console.log("ids:", sorted.map(([id]) => id).join(","));
