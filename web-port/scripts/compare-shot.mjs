// Stitch captures into one image, so a comparison costs one look instead of two.
//
// There is no ImageMagick, PIL or sharp on this machine, but there is a
// headless Chromium — so the montage is laid out in a page and screenshotted.
//
//   node scripts/compare-shot.mjs out.png [--width=1400] [--cols=1] \
//        "caption::path.png" ...
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const args = process.argv.slice(2);
const out = args.shift();
const flag = (n, d) => {
  const a = args.find((s) => s.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : d;
};
const width = Number(flag("width", 1400));
const cols = Number(flag("cols", 1));
const items = args.filter((a) => !a.startsWith("--")).map((a) => {
  const i = a.indexOf("::");
  const caption = i < 0 ? "" : a.slice(0, i);
  const path = i < 0 ? a : a.slice(i + 2);
  const mime = extname(path) === ".jpg" ? "image/jpeg" : "image/png";
  return { caption, src: `data:${mime};base64,${readFileSync(path).toString("base64")}` };
});

const html = `<style>
  body { margin: 0; background: #111; font: 13px ui-monospace, monospace; color: #eee; }
  .grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 2px; }
  figure { margin: 0; }
  figcaption { padding: 3px 6px; background: #1e6; color: #000; font-weight: 700; }
  img { display: block; width: 100%; }
</style><div class="grid">${items.map((it) =>
  `<figure><figcaption>${it.caption}</figcaption><img src="${it.src}"></figure>`).join("")}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height: 600 } });
await page.setContent(html);
await page.waitForLoadState("networkidle");
await page.locator(".grid").screenshot({ path: out });
await browser.close();
console.log(out);
