// Visual verification harness: loads the dev server page in headless chromium,
// waits, captures a screenshot + console errors.
// Usage: node scripts/screenshot.mjs [url-path] [outfile] [waitMs]
import { chromium } from "playwright";

const path = process.argv[2] ?? "/";
const out = process.argv[3] ?? "shot.png";
const waitMs = parseInt(process.argv[4] ?? "1500");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`http://localhost:3222${path}`, { waitUntil: "networkidle" });
await page.waitForTimeout(waitMs);
await page.screenshot({ path: out });
const info = await page.evaluate(() => (window).__atlasSizes ?? null);
console.log("screenshot ->", out, "| atlasSizes:", info, "| console errors:", errors.length ? errors : "none");
await browser.close();
process.exit(errors.length ? 1 : 0);
