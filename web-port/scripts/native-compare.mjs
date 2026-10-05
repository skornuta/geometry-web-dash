// Render the port at the exact content resolution of a native capture, so the
// two can be compared pixel-for-pixel. Usage:
//   node scripts/native-compare.mjs <route> <outName> [widthPt heightPt dpr]
// Seeds an isolated save (garage already visited, as on the native account) so
// the capture never touches real browser storage.
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const [route = "", name = "port-main-menu", w = "1768", h = "992", dpr = "2", saveJson, evalJs] = process.argv.slice(2);
// the save to seed: by default only "garage already visited", as on the native account;
// a comparison of a stateful screen passes the native account's matching state here
const seed = saveJson ? JSON.parse(saveJson) : { v: 1, settings: { seenGarage: true } };
const out = new URL(`../../docs/ui-parity/reference/${name}.png`, import.meta.url);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:3222/", { waitUntil: "domcontentloaded" });
await page.evaluate((s) => localStorage.setItem("gd-web-save", JSON.stringify(s)), seed);
await page.goto(`http://localhost:3222/${route}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
// optional setup the route alone cannot express (paging the carousel, opening
// a layer), then let any tween settle before the capture
if (evalJs) { await page.evaluate(evalJs); await page.waitForTimeout(1500); }
await page.screenshot({ path: fileURLToPath(out) });
const info = await page.evaluate(() =>
  (window.__mainMenu ?? window.__menu ?? window.__kit ?? window.__play)?.info ?? null);
if (info) console.log(JSON.stringify(info));
if (errors.length) console.error("page errors:", errors.join(" | "));
await browser.close();
