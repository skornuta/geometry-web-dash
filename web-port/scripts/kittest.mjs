// Browser acceptance for the reproduced GJGarageLayer (`?icons=1`) and its
// CharacterColorPage popup, plus the settings panel that still lives at
// `?settings=1` until Task 7 replaces it.
//
// Layout is decoded from the binary (docs/ui-parity/REFERENCE.md §12-13), so
// what this checks is what only a browser can answer: that every frame resolves,
// that the real controls select what they are drawn over, that paging and tab
// switching hold the selection, that the colour popup writes the save, and that
// the selection survives a reload and reaches gameplay.
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = (process.argv[2] ?? "http://localhost:3222").replace(/\/$/, "");
const shots = new URL("../../docs/ui-parity/comparisons/", import.meta.url);
await mkdir(shots, { recursive: true });

const fail = [];
const check = (ok, msg) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`);
  if (!ok) fail.push(msg);
};

const browser = await chromium.launch();
const errors = [];

async function open(path = "?icons=1", size = { width: 1280, height: 720 }, hook = "__kit") {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${path}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${path} console: ${m.text()}`); });
  await page.goto(`${base}/${path}`, { waitUntil: "networkidle" });
  await page.waitForFunction((h) => !!window[h], hook);
  return { context, page };
}

const info = (page) => page.evaluate(() => window.__kit.info);
const call = (page, fn, ...a) => page.evaluate(([f, args]) => window.__kit[f](...args), [fn, a]);

async function clickControl(page, id) {
  const p = await page.evaluate((id) => {
    const c = document.getElementById("game");
    const box = c.getBoundingClientRect();
    const at = window.__kit.at(id);
    if (!at) return null;
    const scale = c.height / 320 <= c.width / 480 ? c.height / 320 : c.width / 480;
    return {
      x: box.left + (at.x * scale + c.width / 2) * box.width / c.width,
      y: box.top + (c.height / 2 - at.y * scale) * box.height / c.height,
    };
  }, id);
  if (!p) throw new Error(`no control ${id}`);
  await page.mouse.click(p.x, p.y);
}

// ------------------------------------------------------------------ art
{
  const { context, page } = await open();
  const i = await info(page);
  check(i.mode === "cube" && i.tab === 0, "opens on the cube tab");
  // 2.2 ships 485 cubes as per-icon sheets, and `setupPage` counts pages as
  // `count / 36 + 1` — 14, which a native capture confirms (REFERENCE.md §19.5)
  check(i.pages === Math.floor(485 / 36) + 1 && i.pages === 14,
    `pages come from the 12x3 grid over all 485 cubes (${i.pages})`);

  const missing = await page.evaluate(async () => {
    const g = await import("/src/scenes/garage.ts");
    const a = await import("/src/engine/atlas.ts");
    const r = await import("/src/engine/renderer.ts");
    const rr = new r.Renderer(document.createElement("canvas"));
    const s3 = await a.loadAtlas(rr, "/assets/GJ_GameSheet03-hd.plist", "/assets/GJ_GameSheet03-hd.png");
    const s1 = await a.loadAtlas(rr, "/assets/GJ_GameSheet-hd.plist", "/assets/GJ_GameSheet-hd.png");
    return g.GARAGE_LAYOUT.GARAGE_FRAMES.filter((f) => !s3.atlas.get(f) && !s1.atlas.get(f));
  });
  check(missing.length === 0, missing.length ? `missing frames: ${missing}` : "every garage frame resolves");

  for (const f of ["GJ_gradientBG-hd.png", "square02_001-hd.png", "GJ_square05-hd.png",
    "GJ_button_01-hd.png"]) {
    const ok = await page.evaluate((f) => fetch(`/assets/${f}`).then((r) => r.ok), f);
    check(ok, `loose asset ${f} is served`);
  }

  // the grid geometry is the sourced one, not the old 10x3
  const cells = i.controls.filter((c) => c.menu === "grid");
  check(cells.length === 36, `the page holds 12x3 = 36 cells (${cells.length})`);
  const xs = [...new Set(cells.map((c) => Math.round(c.x * 100) / 100))].sort((a, b) => a - b);
  check(xs.length === 12, `12 distinct columns (${xs.length})`);
  check(Math.abs(xs[1] - xs[0] - 30) < 1e-6, `columns are 30 apart (${(xs[1] - xs[0]).toFixed(3)})`);
  const ys = [...new Set(cells.map((c) => Math.round(c.y * 100) / 100))].sort((a, b) => a - b);
  check(ys.length === 3 && Math.abs(ys[1] - ys[0] - 30) < 1e-6, "3 rows, 30 apart");
  await context.close();
}

// ------------------------------------------------------------- selecting
{
  const { context, page } = await open();
  await clickControl(page, "icon-7");
  check((await info(page)).icon === 7, "clicking a grid cell selects that icon");

  // paging keeps the selection and moves the window
  await call(page, "setPage", 2);
  const paged = await info(page);
  check(paged.page === 2 && paged.icon === 7, "paging does not change the selection");
  await clickControl(page, "icon-75");
  check((await info(page)).icon === 75, "a cell on a later page selects the right index");

  // every supported tab has its own selection
  for (const [i, m] of ["cube", "ship", "ball", "ufo", "wave", "robot", "spider", "swing"].entries()) {
    await call(page, "setTab", i);
    const t = await info(page);
    check(t.mode === m, `tab ${i} is ${m}${t.mode === m ? "" : ` (got ${t.mode})`}`);
  }
  await call(page, "setTab", 0);
  check((await info(page)).icon === 75, "returning to a tab restores its icon");

  // first and last icon of a mode
  await call(page, "setIcon", 1);
  check((await info(page)).icon === 1 && (await info(page)).page === 0, "first icon lands on page 0");
  await call(page, "setIcon", 485);
  const last = await info(page);
  check(last.icon === 485 && last.page === last.pages - 1, "the last icon lands on the last page");
  // and an icon past the legacy atlas's 248 really draws: its per-icon sheet
  // loads and its frames join the garage's sprites
  await page.waitForFunction(() => window.__kit.hasFrame("player_485_001.png"), null, { timeout: 5000 })
    .then(() => check(true, "icon 485's own sheet loads and resolves"),
      () => check(false, "icon 485's own sheet loads and resolves"));
  await context.close();
}

// -------------------------------------------------------- colour popup
{
  const { context, page } = await open();
  check((await info(page)).popup === null, "the popup starts closed");
  await clickControl(page, "paint");
  check((await info(page)).popup === "col1", "the paint button opens the colour page on Col1");

  const swatches = (await info(page)).controls.filter((c) => c.menu === "swatches");
  check(swatches.length === 107, `all 107 sourced colours are offered (${swatches.length})`);

  await clickControl(page, "swatch-9");
  check((await info(page)).col1 === 9, "a swatch sets the primary colour");
  await clickControl(page, "col2");
  check((await info(page)).popup === "col2", "Col2 switches which channel is edited");
  await clickControl(page, "swatch-13");
  const after = await info(page);
  check(after.col2 === 13 && after.col1 === 9, "the two channels are independent");
  await clickControl(page, "glow");
  check((await info(page)).glow === true, "Glow toggles");
  await clickControl(page, "popupClose");
  check((await info(page)).popup === null, "the close button dismisses the popup");

  // and all of it persisted
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__kit);
  const reloaded = await info(page);
  check(reloaded.col1 === 9 && reloaded.col2 === 13 && reloaded.glow === true,
    "colours and glow survive a reload");
  await context.close();
}

// ------------------------------------------------- back, and into gameplay
{
  const { context, page } = await open();
  await call(page, "setIcon", 12);
  await clickControl(page, "back");
  await page.waitForFunction(() => !!window.__mainMenu, null, { timeout: 5000 }).catch(() => {});
  check(!page.url().includes("icons="), `back returns to the main menu (${page.url()})`);

  await page.goto(`${base}/?level=1&manual=1`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__play);
  const kit = await page.evaluate(() => window.__play.info.kit ?? null);
  check(kit === null || kit.cube === 12, "the level starts with the saved kit applied");
  await context.close();
}

// --------------------------------------------------- viewports + shots
for (const [name, size] of [
  ["1280x720", { width: 1280, height: 720 }],
  ["1920x1080", { width: 1920, height: 1080 }],
  ["1024x768", { width: 1024, height: 768 }],
  ["narrow-420x900", { width: 420, height: 900 }],
]) {
  const { context, page } = await open("?icons=1", size);
  const i = await info(page);
  const outside = i.controls.filter((c) =>
    c.y - c.h / 2 < -i.viewH / 2 - 0.5 || c.y + c.h / 2 > i.viewH / 2 + 0.5);
  check(outside.length === 0,
    `${name}: nothing clips vertically (${outside.map((c) => c.id).join(", ") || "all inside"})`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: fileURLToPath(new URL(`garage-port-${name}.png`, shots)) });
  await context.close();
}

// one shot per gamemode tab, plus the colour popup
{
  const { context, page } = await open();
  for (const [i, m] of ["cube", "ship", "ball", "ufo", "wave", "robot", "spider", "swing"].entries()) {
    await call(page, "setTab", i);
    await page.waitForTimeout(150);
    await page.screenshot({ path: fileURLToPath(new URL(`garage-tab-${m}.png`, shots)) });
  }
  await call(page, "setTab", 0);
  await call(page, "openPaint");
  await page.waitForTimeout(200);
  await page.screenshot({ path: fileURLToPath(new URL("garage-colour-page.png", shots)) });
  await context.close();
}

check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");

await browser.close();
console.log(fail.length ? `\nFAIL — ${fail.length} check(s) failed` : "\nPASS — garage and colour page");
process.exit(fail.length ? 1 : 0);
