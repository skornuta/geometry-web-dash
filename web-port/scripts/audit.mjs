// M8 audit: load all 22 levels in the real browser and report what is wrong.
//
// The autopilot sweep answers "can this level be finished". This answers the
// other half: does the level *load and render* cleanly — no console errors, no
// objects the generated table cannot place, no missing music. Those are
// invisible to the sweep, which never touches the renderer at all.
//
// Usage:  node scripts/audit.mjs [--shots DIR] [--levels 1,2,3]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const base = arg("--base") ?? "http://localhost:3222";
const shotDir = arg("--shots");
const only = arg("--levels")?.split(",").map(Number);
const levels = only ?? Array.from({ length: 22 }, (_, i) => i + 1);
if (shotDir) mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const rows = [];

for (const n of levels) {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  const warnings = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
    if (m.type() === "warning" && !/GL Driver|WebGL/.test(m.text())) warnings.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => {
    // a missing asset is silent on screen but fatal to fidelity
    if (!/favicon/.test(r.url())) errors.push(`404? ${r.url().replace(base, "")}`);
  });

  let info = null;
  try {
    // ?manual=1 freezes the sim, so this measures loading, not play
    await page.goto(`${base}/?level=${n}&manual=1`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(900);
    info = await page.evaluate(() => window.__play?.info ?? null);
    if (shotDir) await page.screenshot({ path: `${shotDir}/level-${String(n).padStart(2, "0")}.png` });
  } catch (e) {
    errors.push(`load failed: ${e.message}`);
  }

  rows.push({
    n,
    ok: errors.length === 0 && info !== null,
    objects: info?.objects ?? 0,
    skipped: info?.skipped ?? 0,
    // the split matters: `skipped` counts triggers and editor-only markers the
    // real game does not draw either, so on its own it reads as a much bigger
    // hole than it is. Only `skippedArt` is missing art.
    art: info?.skippedArt ?? 0,
    invisible: info?.skippedInvisible ?? 0,
    unknown: info?.unknownIds ?? [],
    errors,
    warnings: [...new Set(warnings)],
  });
  await page.close();
  process.stdout.write(`  level ${String(n).padStart(2)} done\r`);
}

await browser.close();

console.log("\nM8 audit — all 22 levels, real browser\n");
console.log("  lvl  objects  missing art  invisible  unknown art ids             status");
let bad = 0;
for (const r of rows) {
  const status = r.errors.length ? `ERROR x${r.errors.length}` : r.ok ? "ok" : "no info";
  if (r.errors.length || !r.ok) bad++;
  const unknown = r.unknown.length
    ? r.unknown.slice(0, 6).join(",") + (r.unknown.length > 6 ? `+${r.unknown.length - 6}` : "")
    : "-";
  const pct = r.objects ? ` (${((r.art / r.objects) * 100).toFixed(1)}%)` : "";
  console.log(`  ${String(r.n).padStart(3)}  ${String(r.objects).padStart(7)}  `
    + `${(String(r.art) + pct).padStart(11)}  ${String(r.invisible).padStart(9)}  `
    + `${unknown.padEnd(26)}  ${status}`);
}

const withUnknown = rows.filter((r) => r.unknown.length);
if (withUnknown.length) {
  const all = new Set();
  for (const r of withUnknown) for (const id of r.unknown) all.add(id);
  console.log(`\nobject ids with no art across all levels (${all.size}): `
    + `${[...all].sort((a, b) => a - b).join(", ")}`);
}

for (const r of rows) {
  if (!r.errors.length && !r.warnings.length) continue;
  console.log(`\nlevel ${r.n}:`);
  for (const e of r.errors.slice(0, 5)) console.log(`  ERROR   ${e}`);
  for (const w of r.warnings.slice(0, 3)) console.log(`  warning ${w}`);
}

const totalSkipped = rows.reduce((a, r) => a + r.skipped, 0);
const totalArt = rows.reduce((a, r) => a + r.art, 0);
const totalInvisible = rows.reduce((a, r) => a + r.invisible, 0);
const totalObjects = rows.reduce((a, r) => a + r.objects, 0);
const pct = (n) => ((n / Math.max(1, totalObjects)) * 100).toFixed(2);
console.log(`\n${rows.length - bad}/${rows.length} levels load clean.`);
console.log(`  missing art  ${totalArt} of ${totalObjects} (${pct(totalArt)}%)  <- the real hole`);
console.log(`  invisible    ${totalInvisible} of ${totalObjects} (${pct(totalInvisible)}%)  `
  + `triggers + editor-only ids, not drawn by the original either`);
console.log(`  skipped      ${totalSkipped} total — do not quote this number on its own`);

// the worst offenders are worth naming, since one level usually dominates
const worst = rows.filter((r) => r.art).sort((a, b) => b.art - a.art).slice(0, 3);
if (worst.length) {
  console.log(`\n  worst levels by missing art: `
    + worst.map((r) => `L${r.n} ${r.art} (${((r.art / r.objects) * 100).toFixed(0)}%)`).join(", "));
}
process.exit(bad ? 1 : 0);
