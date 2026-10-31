// Mean RGB and dark-pixel fraction of PNG files, one JSON line each.
//   node scripts/png-mean.mjs a.png b.png
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const files = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
const imgs = files.map((f) => "data:image/png;base64," + readFileSync(f).toString("base64"));
const out = await page.evaluate(async (imgs) => {
  const res = [];
  for (const src of imgs) {
    const im = new Image(); im.src = src; await im.decode();
    const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
    const x = c.getContext("2d"); x.drawImage(im, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let r = 0, g = 0, b = 0, dark = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; if (d[i] + d[i + 1] + d[i + 2] < 12) dark++; }
    res.push({ w: c.width, h: c.height, meanRGB: [r / n, g / n, b / n].map((v) => +v.toFixed(1)), darkFrac: +(dark / n).toFixed(3), data: Array.from(d.slice(0, 0)) });
  }
  return res;
}, imgs);
files.forEach((f, i) => console.log(f.split("/").pop(), JSON.stringify(out[i])));
await browser.close();
