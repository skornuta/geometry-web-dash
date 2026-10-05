// Capture the current port, not original-game reference images or approved goldens.
// Run from web-port with Vite on port 3222:
//
//   node scripts/ui-baseline.mjs [outDir]
//
// The 2026-09-09 before-set in docs/ui-parity/before/ is the frozen baseline the
// parity work is measured against, so this now writes to
// docs/ui-parity/comparisons/current/ unless a directory is named. Pass
// `../../docs/ui-parity/before/` only to deliberately re-cut the baseline.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const out = new URL(process.argv[2] ?? "../../docs/ui-parity/comparisons/current/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const captures = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  async function open(path, hook) {
    await page.goto(`http://localhost:3222/${path}`, { waitUntil: "networkidle" });
    await page.waitForFunction(key => !!window[key], hook);
  }
  async function shot(name) {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, out)) });
    captures.push({ name, url: page.url(), state: await page.evaluate(() =>
      window.__play?.info ?? window.__kit?.info ?? window.__menu?.info
        ?? window.__mainMenu?.info ?? null) });
  }
  // `/` is now the reproduced MenuLayer; the carousel has its own route.
  await open("", "__mainMenu");
  await shot("main-menu");
  await open("?levels=1", "__menu");
  await shot("level-select");
  await open("?icons=1", "__kit");
  await shot("icon-kit");
  // `?settings=1` is the main menu with `OptionsLayer` dropped in, so wait for
  // the slide to settle before capturing it
  await open("?settings=1", "__mainMenu");
  await page.waitForFunction(() => window.__mainMenu.info.options?.t >= 1);
  await shot("settings");
  await open("?level=1&manual=1", "__play");
  await page.waitForFunction(() => Math.abs(window.__play.info.camY + 90) < 1);
  await shot("attempt-start");
  await page.evaluate(() => { for (let i = 0; i < 40; i++) window.__play.stepTick(false); });
  await shot("gameplay-hud");
  await page.keyboard.press("Escape");
  await shot("pause-normal");
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__play.setPractice(true));
  await page.keyboard.press("Escape");
  await shot("pause-practice");
  await open("?level=1&manual=1", "__play");
  const route = JSON.parse(await readFile(new URL("./manual-routes/stereo-madness.json", import.meta.url), "utf8"));
  await page.evaluate(segments => {
    for (const [ticks, held] of segments) for (let i = 0; i < ticks; i++) {
      if (!window.__play.stepTick(held)) throw new Error("Completion fixture died");
    }
  }, route.segments);
  await page.waitForFunction(() => window.__play.info.completed);
  await shot("completion-normal");
  if (errors.length) throw new Error(errors.join("\n"));
  await writeFile(new URL("manifest.json", out), JSON.stringify({
    capturedAt: new Date().toISOString(), kind: "current-port-before-ui-parity",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    storage: "isolated fresh browser context; does not modify user's save", captures, errors,
  }, null, 2) + "\n");
  console.log(`Captured ${captures.length} current-port screens in ${fileURLToPath(out)}`);
} finally {
  await browser.close();
}
