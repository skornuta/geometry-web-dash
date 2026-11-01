// The Report-a-bug link: visible on menus, hidden in a running level, shown
// while paused, and pointing at a prefilled new-issue page.
import { chromium } from "playwright";
const b = await chromium.launch();
const fail = (m) => { console.error("FAIL —", m); process.exit(1); };
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
const vis = () => p.evaluate(() => {
  const a = document.getElementById("bug-report");
  return !!a && getComputedStyle(a).display !== "none";
});
await p.goto("http://localhost:3222/", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
if (!(await vis())) fail("hidden on the main menu");
const href = await p.getAttribute("#bug-report", "href");
if (!href.startsWith("https://github.com/skornuta/geometry-web-dash-demo/issues/new?")) fail("href " + href);
if (await p.getAttribute("#bug-report", "target") !== "_blank") fail("not a new tab");
for (const path of ["/?levels=1", "/?icons=1"]) {
  await p.goto("http://localhost:3222" + path, { waitUntil: "networkidle" });
  await p.waitForTimeout(500);
  if (!(await vis())) fail("hidden on " + path);
}
await p.goto("http://localhost:3222/?level=1&manual=1", { waitUntil: "networkidle" });
await p.waitForTimeout(800);
if (await vis()) fail("visible during play");
await p.keyboard.press("Escape");
await p.waitForTimeout(300);
if (!(await vis())) fail("hidden while paused");
// clicking it must open a tab and leave the game paused
const [popup] = await Promise.all([p.context().waitForEvent("page", { timeout: 5000 }), p.click("#bug-report")]);
if (!popup.url().includes("github.com") && popup.url() !== "about:blank") fail("popup url " + popup.url());
await popup.close();
await p.keyboard.press("Escape");
await p.waitForTimeout(300);
if (await vis()) fail("still visible after resume");
if (errs.length) fail(errs.join("; "));
console.log("PASS — bug report link: menus, hidden in play, shown on pause, opens GitHub");
await b.close();
