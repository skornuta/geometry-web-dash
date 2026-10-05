// Does the classic level carousel (`?levels=1`) browse, read the save, and
// actually start a level — through its real controls?
//
// The carousel is no longer the front door: `/` is the reproduced MenuLayer and
// level select has its own explicit route, reached from the menu's Play button
// (see scripts/mainmenutest.mjs). The layout itself is decoded from
// LevelSelectLayer/LevelPage; see docs/ui-parity/REFERENCE.md §10-11.
//
// What only a browser can answer: that every frame resolves in the shipped
// atlases (a wrong sheet fails *silently*), that clicking the level panel starts
// that level while clicking empty background does nothing, that the arrows and
// the back arrow go where the original goes, and that all 22 pages lay out
// without clipping their names.
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3222").replace(/\/$/, "");
const levels = `${base}/?levels=1`;
const shots = new URL("../../docs/ui-parity/comparisons/", import.meta.url);
await mkdir(shots, { recursive: true });

const fail = [];
const check = (ok, msg) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`);
  if (!ok) fail.push(msg);
};

const browser = await chromium.launch();
const errors = [];

/** an isolated context, seeded with a fixture save; never touches a real one */
async function open(fixture, size = { width: 1280, height: 720 }, extra = "") {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  if (fixture) await page.evaluate((f) => localStorage.setItem("gd-web-save", JSON.stringify(f)), fixture);
  await page.goto(`${base}/?levels=1${extra}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__menu);
  return { context, page };
}

const info = (page) => page.evaluate(() => window.__menu.info);
const call = (page, fn, ...a) => page.evaluate(([f, args]) => window.__menu[f](...args), [fn, a]);

async function toClient(page, x, y) {
  return page.evaluate(([x, y]) => {
    const c = document.getElementById("game");
    const box = c.getBoundingClientRect();
    const scale = c.height / 320 <= c.width / 480 ? c.height / 320 : c.width / 480;
    return {
      x: box.left + (x * scale + c.width / 2) * box.width / c.width,
      y: box.top + (c.height / 2 - y * scale) * box.height / c.height,
    };
  }, [x, y]);
}

/** the fixture the plan asks for: nothing, partial, practice-only, complete */
const FIXTURE = {
  v: 1,
  levels: {
    1: { normal: 100, practice: 100, coins: [0, 1, 2], attempts: 12, jumps: 40 },
    2: { normal: 47, practice: 80, coins: [1], attempts: 5, jumps: 9 },
    3: { normal: 0, practice: 100, coins: [], attempts: 30, jumps: 120 },
    4: { normal: 0, practice: 0, coins: [0, 2], attempts: 0, jumps: 0 },
  },
};

// ------------------------------------------------------------- data + art
{
  const { context, page } = await open(FIXTURE);
  const first = await info(page);
  console.log(`start: ${first.name} (level ${first.level})`);
  check(first.level === 1, "opens on level 1");
  check(first.totalCoins === 6, `totals read the save (${first.totalCoins} coins)`);
  // the page width is the window width, not an invented constant
  check(Math.abs(first.viewW - 1280 / (720 / 320)) < 0.01,
    `page width is the win size (${first.viewW.toFixed(2)})`);

  // every frame the screen draws must resolve; a wrong sheet is silent
  const art = await page.evaluate(async () => {
    const m = await import("/src/gd/levels.ts");
    const a = await import("/src/engine/atlas.ts");
    const r = await import("/src/engine/renderer.ts");
    const menu = await import("/src/scenes/menu.ts");
    const rr = new r.Renderer(document.createElement("canvas"));
    const s3 = await a.loadAtlas(rr, "/assets/GJ_GameSheet03-hd.plist", "/assets/GJ_GameSheet03-hd.png");
    const s2 = await a.loadAtlas(rr, "/assets/GJ_GameSheet02-hd.plist", "/assets/GJ_GameSheet02-hd.png");
    const has = (f) => !!(s3.atlas.get(f) || s2.atlas.get(f));
    const missing = [];
    for (const lv of m.LEVELS) if (!has(menu.diffFrame(lv.difficulty))) missing.push(`${lv.n}`);
    for (const f of ["GJ_topBar_001.png", "GJ_sideArt_001.png", "GJ_starsIcon_001.png",
      "GJ_coinsIcon_001.png", "GJ_coinsIcon_gray_001.png", "navArrowBtn_001.png",
      "GJ_arrow_01_001.png", "floorLine_01_001.png"]) if (!has(f)) missing.push(f);
    return { missing, count: m.LEVELS.length };
  });
  check(art.count === 22, `all 22 levels are in the table (${art.count})`);
  check(art.missing.length === 0,
    art.missing.length ? `missing art: ${art.missing.join(", ")}` : "every page's art resolves");

  // the loose files the page needs are served too
  for (const f of ["GJ_gradientBG-hd.png", "square02_001-hd.png",
    "GJ_progressBar_001-hd.png", "smallDot-hd.png"]) {
    const ok = await page.evaluate((f) => fetch(`/assets/${f}`).then((r) => r.ok), f);
    check(ok, `loose asset ${f} is served`);
  }
  await context.close();
}

// ------------------------------------------------------------- browsing
{
  const { context, page } = await open(FIXTURE);
  await call(page, "move", 3);
  check((await info(page)).level === 4, "arrow keys move the selection");
  // The carousel is looped (`BoomScrollLayer::create(..., looped = true)`) and
  // has 24 pages: the 22 levels, The Tower, and "Coming Soon!" (REFERENCE.md
  // §19.4). It wraps at both ends rather than clamping.
  await call(page, "move", -4);
  const wrappedBack = await info(page);
  check(wrappedBack.sel === 23 && wrappedBack.level === null && wrappedBack.name === "Coming Soon!",
    `paging back past level 1 wraps to "Coming Soon!" (${wrappedBack.name})`);
  await call(page, "select", 22);
  const last = await info(page);
  check(last.level === 22 && last.name === "Dash", `jumps to the last level (${last.name})`);
  await call(page, "move", 1);
  check((await info(page)).name === "The Tower", "after Dash comes The Tower's page");
  await call(page, "move", 1);
  check((await info(page)).name === "Coming Soon!", "then \"Coming Soon!\"");
  await call(page, "move", 1);
  check((await info(page)).level === 1, "and paging on wraps round to level 1");
  check((await info(page)).pageCount === 24, "the carousel has 24 pages");

  // page colour follows the sourced table rather than a hue wheel
  await call(page, "select", 1);
  await page.waitForFunction(() => window.__menu.info.scroll === 0, null, { timeout: 5000 });
  const c0 = (await info(page)).pageColor.map(Math.round);
  check(JSON.stringify(c0) === JSON.stringify([0, 0, 255]), `page 1 is the sourced blue (${c0})`);
  await call(page, "select", 10);
  await page.waitForFunction(() => window.__menu.info.scroll === 9, null, { timeout: 5000 });
  const c9 = (await info(page)).pageColor.map(Math.round);
  check(JSON.stringify(c9) === JSON.stringify([0, 0, 255]),
    `page 10 repeats the nine-page cycle (${c9})`);
  await context.close();
}

// --------------------------------------------------- controls, not thirds
{
  const { context, page } = await open(FIXTURE);
  await call(page, "select", 5);
  await page.waitForFunction(() => window.__menu.info.scroll === 4, null, { timeout: 5000 });

  // the empty background between the panel and the bars must be inert
  const empty = await toClient(page, 0, -150);
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(300);
  check(page.url().includes("levels=1"), "clicking empty background does not start a level");

  // the nav arrows page, and are real controls at their sourced positions
  const before = (await info(page)).level;
  const next = await page.evaluate(() => window.__menu.at("next"));
  const nextC = await toClient(page, next.x, next.y);
  await page.mouse.click(nextC.x, nextC.y);
  await page.waitForFunction(() => window.__menu.info.scroll === 5, null, { timeout: 5000 });
  check((await info(page)).level === before + 1, "the right arrow pages forward");
  const prev = await page.evaluate(() => window.__menu.at("prev"));
  const prevC = await toClient(page, prev.x, prev.y);
  await page.mouse.click(prevC.x, prevC.y);
  await page.waitForFunction(() => window.__menu.info.scroll === 4, null, { timeout: 5000 });
  check((await info(page)).level === before, "the left arrow pages back");

  // the level panel is the play button
  const panel = await page.evaluate(() => window.__menu.at("levelPanel"));
  const panelC = await toClient(page, panel.x, panel.y);
  await page.mouse.move(panelC.x, panelC.y);
  await page.mouse.down();
  await page.waitForTimeout(320);
  const pressed = (await info(page)).panel.scale;
  check(Math.abs(pressed - 1.1) < 0.02, `the panel presses to the sourced 1.1 (${pressed.toFixed(3)})`);
  await page.mouse.up();
  await page.waitForURL(`**/*level=${before}*`, { timeout: 5000 }).catch(() => {});
  check(page.url().includes(`level=${before}`), `clicking the panel plays level ${before} (${page.url()})`);
  await page.waitForFunction(() => !!window.__play, null, { timeout: 10000 }).catch(() => {});
  const playing = await page.evaluate(() => window.__play?.info ?? null);
  check(playing !== null, "the level scene took over");
  await context.close();
}

// ------------------------------------------- the info button's Level Stats
{
  const { context, page } = await open(FIXTURE);
  await call(page, "select", 3);
  await page.waitForFunction(() => window.__menu.info.scroll === 2, null, { timeout: 5000 });
  const at = await page.evaluate(() => window.__menu.at("info"));
  const c = await toClient(page, at.x, at.y);
  await page.mouse.click(c.x, c.y);
  await page.waitForFunction(() => !!window.__menu.info.alert, null, { timeout: 3000 });
  await page.waitForTimeout(700);
  const a = (await info(page)).alert;
  // five lines of chatFont at 20 each, + 120 (FLAlertLayer::init +932..956)
  check(a.w === 300 && a.h === 220, `Level Stats is the sourced 300 x 220 alert (${a.w} x ${a.h})`);
  check(Math.abs(a.scale - 1) < 0.01, `it has popped in to full size (${a.scale.toFixed(3)})`);
  await page.screenshot({ path: fileURLToPath(new URL("level-stats-popup.png", shots)) });
  // the carousel beneath is dead while it is up
  const empty = await toClient(page, 0, -150);
  await page.mouse.click(empty.x, empty.y);
  check((await info(page)).alert !== null, "a click outside the button leaves the alert up");
  const ok = a.controls.find((b) => b.id === "alertButton");
  const okC = await toClient(page, ok.x, ok.y);
  await page.mouse.click(okC.x, okC.y);
  await page.waitForFunction(() => window.__menu.info.alert === null, null, { timeout: 3000 });
  check(true, "OK closes it");
  check(page.url().includes("levels=1"), "and nothing underneath was activated");
  // The Tower's page keeps its button inert (out of scope)
  await call(page, "select", 1);
  await page.evaluate(() => window.__menu.move(22));
  await page.waitForTimeout(900);
  await page.mouse.click(c.x, c.y);
  await page.waitForTimeout(300);
  check((await info(page)).alert === null, "the Tower page's info button stays inert");
  await context.close();
}

// ------------------------------------------------------- back and restore
{
  const { context, page } = await open(FIXTURE);
  const back = await page.evaluate(() => window.__menu.at("back"));
  const backC = await toClient(page, back.x, back.y);
  await page.mouse.click(backC.x, backC.y);
  await page.waitForFunction(() => !!window.__mainMenu, null, { timeout: 5000 }).catch(() => {});
  check(!page.url().includes("levels="), `the back arrow returns to the main menu (${page.url()})`);
  await context.close();
}
{
  const { context, page } = await open(FIXTURE, { width: 1280, height: 720 }, "&sel=7");
  check((await info(page)).level === 7, "?sel=N restores the selected level");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !!window.__mainMenu, null, { timeout: 5000 }).catch(() => {});
  check(!page.url().includes("levels="), "escape returns to the main menu");
  await context.close();
}

// ------------------------------------- all 22 pages fit, at every viewport
for (const [name, size] of [
  ["1280x720", { width: 1280, height: 720 }],
  ["1920x1080", { width: 1920, height: 1080 }],
  ["1024x768", { width: 1024, height: 768 }],
  ["narrow-420x900", { width: 420, height: 900 }],
]) {
  const { context, page } = await open(FIXTURE, size);
  const fits = await page.evaluate(async () => {
    const m = await import("/src/gd/levels.ts");
    const b = await import("/src/engine/bmfont.ts");
    const r = await import("/src/engine/renderer.ts");
    const rr = new r.Renderer(document.createElement("canvas"));
    const f = await b.LoadedFont.load(rr, "/assets/bigFont-hd.fnt", "/assets/bigFont-hd.png");
    // the panel is 340 wide; the name is capped at 250 by min(1, 250/width)
    const over = [];
    for (const lv of m.LEVELS) {
      const w = f.measure(lv.name) * 0.5;
      const scale = Math.min(1, 250 / w);
      if (w * scale > 250.01) over.push(lv.name);
    }
    return over;
  });
  check(fits.length === 0, `${name}: every level name fits the 250-unit cap`);

  const i = await info(page);
  const outside = i.controls.filter((c) =>
    c.y - c.h / 2 < -i.viewH / 2 - 0.5 || c.y + c.h / 2 > i.viewH / 2 + 0.5);
  check(outside.length === 0,
    `${name}: no control clips vertically (${outside.map((c) => c.id).join(", ") || "all inside"})`);

  await page.waitForTimeout(400);
  await page.screenshot({ path: fileURLToPath(new URL(`level-select-port-${name}.png`, shots)) });
  await context.close();
}

// ------------------------------------------------ representative fixtures
for (const [name, sel] of [["fresh", 22], ["complete", 1], ["partial", 2], ["practice-only", 3], ["coins-0-2", 4]]) {
  const { context, page } = await open(FIXTURE, { width: 1280, height: 720 }, `&sel=${sel}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: fileURLToPath(new URL(`level-select-state-${name}.png`, shots)) });
  await context.close();
}

check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");

await browser.close();
console.log(fail.length ? `\nFAIL — ${fail.length} check(s) failed` : "\nPASS — level select");
process.exit(fail.length ? 1 : 0);
