// Browser acceptance for the reproduced MenuLayer (`/`).
//
// The layout numbers are unit-tested and the sourcing is written up in
// docs/ui-parity/REFERENCE.md §5, so what this harness is for is the things
// only a real browser can answer: that every sprite frame actually resolves in
// the shipped atlases, that clicking the drawn control goes where the original
// goes, that the empty background is inert, that a drag off a button cancels
// it, and that the screen survives four viewport shapes without clipping.
//
// Run with the dev server up:  node scripts/mainmenutest.mjs
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3222";
const shots = new URL("../../docs/ui-parity/comparisons/", import.meta.url);
await mkdir(shots, { recursive: true });

const fail = [];
const check = (ok, msg) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${msg}`);
  if (!ok) fail.push(msg);
};

const browser = await chromium.launch();
const errors = [];

/** an isolated context every time, so nothing here can touch a real save */
async function open(size = { width: 1280, height: 720 }, dpr = 1) {
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: dpr });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${size.width}x${size.height}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${size.width}x${size.height} console: ${m.text()}`);
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__mainMenu);
  return { context, page };
}

const info = (page) => page.evaluate(() => window.__mainMenu.info);

/** design-space point -> CSS pixels, the conversion the scene itself uses */
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

async function clientOf(page, id) {
  const p = await page.evaluate((id) => window.__mainMenu.at(id), id);
  if (!p) throw new Error(`no control ${id}`);
  return toClient(page, p.x, p.y);
}

// ---------------------------------------------------------------- layout
{
  const { context, page } = await open();
  const it = (await info(page)).items;
  const by = Object.fromEntries(it.map((i) => [i.id, i]));

  check(it.length === 14, `every MenuLayer control is present (${it.length})`);
  // MenuLayer::init: garage at playPos + (-110, 0), creator at playPos + (110, 0)
  check(by.garage.x === by.play.x - 110 && by.garage.y === by.play.y,
    "garage sits 110 left of play");
  check(by.creator.x === by.play.x + 110 && by.creator.y === by.play.y,
    "creator sits 110 right of play");
  // the bottom row is aligned with padding 5 and centred on the win size
  const row = ["achievements", "options", "stats", "newgrounds"].map((k) => by[k]);
  for (let i = 1; i < row.length; i++) {
    const gap = (row[i].x - row[i].w / 2) - (row[i - 1].x + row[i - 1].w / 2);
    check(Math.abs(gap - 5) < 1e-6, `bottom row gap ${i} is the sourced padding 5`);
  }
  check(Math.abs(row[0].x + row[3].x) < 1e-6, "the bottom row is centred");
  // discord hangs off youtube, not twitch
  check(by.discord.x === by.youtube.x + 29 && by.discord.y === by.youtube.y - 29,
    "discord hangs off youtube");
  // only in-scope destinations act
  const acting = it.filter((i) => i.acts).map((i) => i.id).sort();
  check(JSON.stringify(acting) === JSON.stringify(["garage", "options", "play", "stats"]),
    `exactly the in-scope controls act (${acting.join(", ")})`);
  await context.close();
}

// ---------------------------------------------------- press animation
{
  const { context, page } = await open();
  const scale = async () => (await info(page)).items.find((i) => i.id === "play").scale;
  check(await scale() === 1, "buttons rest at scale 1");

  const play = await clientOf(page, "play");
  await page.mouse.move(play.x, play.y);
  await page.mouse.down();
  await page.waitForTimeout(320);
  const pressed = await scale();
  check(Math.abs(pressed - 1.26) < 0.01, `press settles at the sourced 1.26 (${pressed.toFixed(3)})`);

  // drag off before releasing: CCMenu::ccTouchMoved deselects, ccTouchEnded
  // then has nothing to activate, so nothing navigates
  await page.mouse.move(play.x, play.y - 400);
  await page.mouse.up();
  await page.waitForTimeout(450);
  const released = await scale();
  check(Math.abs(released - 1) < 0.01, `release returns to 1 (${released.toFixed(3)})`);
  check(page.url().replace(/\/$/, "") === base.replace(/\/$/, ""),
    "dragging off the play button does not navigate");
  await context.close();
}

// ------------------------------------------------------- inert background
{
  const { context, page } = await open();
  // a point well clear of every control: just under the logo, above the buttons
  const empty = await toClient(page, 0, 110);
  await page.mouse.click(empty.x, empty.y);
  await page.waitForTimeout(400);
  check(page.url().replace(/\/$/, "") === base.replace(/\/$/, ""),
    "clicking the empty background does nothing");
  const anyPressed = (await info(page)).items.some((i) => Math.abs(i.scale - 1) > 0.01);
  check(!anyPressed, "no control reacts to a background click");
  await context.close();
}

// ------------------------------------------------------------- routing
for (const [id, expect] of [["play", "levels=1"], ["garage", "icons=1"]]) {
  const { context, page } = await open();
  const p = await clientOf(page, id);
  await page.mouse.click(p.x, p.y);
  await page.waitForURL(`**/*${expect}*`, { timeout: 5000 }).catch(() => {});
  check(page.url().includes(expect), `${id} goes to ?${expect} (${page.url()})`);
  await context.close();
}

// `MenuLayer::onOptions` is not a scene change: it drops `OptionsLayer` over the
// running menu, which is why the URL must NOT move and the cube keeps walking.
{
  const { context, page } = await open();
  const p = await clientOf(page, "options");
  await page.mouse.click(p.x, p.y);
  await page.waitForFunction(() => window.__mainMenu.info.options !== null, null, { timeout: 5000 });
  check(page.url().replace(/\/$/, "") === base.replace(/\/$/, ""),
    `the options gear opens the layer in place (${page.url()})`);
  const before = (await info(page)).cube.x;
  await page.waitForTimeout(250);
  check((await info(page)).cube.x !== before, "the menu keeps running behind it");
  await context.close();
}

// -------------------------------------------------- garage clears the flag
{
  const { context, page } = await open();
  check((await info(page)).seenGarage === false, "a fresh save shows the character-select flag");
  const g = await clientOf(page, "garage");
  await page.mouse.click(g.x, g.y);
  await page.waitForURL("**/*icons=1*", { timeout: 5000 });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__mainMenu);
  check((await info(page)).seenGarage === true,
    "visiting the garage clears it, as MenuLayer::onGarage does");
  await context.close();
}

// ------------------------------------------------------- back navigation
{
  const { context, page } = await open();
  const p = await clientOf(page, "play");
  await page.mouse.click(p.x, p.y);
  await page.waitForURL("**/*levels=1*", { timeout: 5000 });
  await page.waitForFunction(() => !!window.__menu);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !!window.__mainMenu, null, { timeout: 5000 });
  check(!page.url().includes("levels="), "level select goes back to the main menu");
  await context.close();
}

// ------------------------------------------------ viewport shapes + shots
for (const [name, size, dpr] of [
  ["1280x720", { width: 1280, height: 720 }, 1],
  ["1920x1080", { width: 1920, height: 1080 }, 1],
  ["1024x768", { width: 1024, height: 768 }, 1],
  ["narrow-420x900", { width: 420, height: 900 }, 2],
]) {
  const { context, page } = await open(size, dpr);
  const i = await info(page);
  // Nothing may be laid out beyond the visible design extent, at any shape.
  const outside = i.items.filter((c) =>
    c.x - c.w / 2 < -i.viewW / 2 - 0.5 || c.x + c.w / 2 > i.viewW / 2 + 0.5 ||
    c.y - c.h / 2 < -i.viewH / 2 - 0.5 || c.y + c.h / 2 > i.viewH / 2 + 0.5);
  check(outside.length === 0,
    `${name}: nothing clips (${outside.map((c) => c.id).join(", ") || "all inside"})`);

  // and a press still lands on the control it is drawn on. Release well away
  // from it so this probe cannot navigate and spoil the screenshot below.
  const p = await clientOf(page, "options");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(120);
  const hit = (await info(page)).items.find((c) => c.id === "options").scale > 1.01;
  await page.mouse.move(p.x, p.y - 400);
  await page.mouse.up();
  check(hit, `${name}: hit areas follow the drawn control`);

  await page.waitForTimeout(500);
  check(!page.url().includes("settings"), `${name}: the hit probe did not navigate`);
  await page.screenshot({ path: fileURLToPath(new URL(`main-menu-port-${name}.png`, shots)) });
  await context.close();
}

check(errors.length === 0, errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");

await browser.close();
console.log(fail.length ? `\nFAIL — ${fail.length} check(s) failed` : "\nPASS — main menu");
process.exit(fail.length ? 1 : 0);
