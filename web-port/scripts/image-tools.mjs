// Small image utilities for the native comparison, done in headless Chromium's
// canvas because the machine has no PIL/ImageMagick.
//
//   node scripts/image-tools.mjs crop  <in> <out> <x> <y> <w> <h>
//   node scripts/image-tools.mjs pair  <a> <b> <out>          side by side
//   node scripts/image-tools.mjs blend <a> <b> <out>          50/50 overlay
//   node scripts/image-tools.mjs diff  <a> <b> <out>          |a-b|, amplified
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const [op, ...args] = process.argv.slice(2);
const dataUrl = async (p) => "data:image/png;base64," + (await readFile(p)).toString("base64");

const browser = await chromium.launch();
const page = await browser.newPage();
const run = (fn, arg) => page.evaluate(fn, arg);

const script = async ({ op, imgs, nums }) => {
  // colorSpaceConversion "none": a native capture is tagged Display P3, but the
  // game wrote plain sRGB bytes into it, so comparisons must read raw bytes
  const load = async (src) => createImageBitmap(await (await fetch(src)).blob(),
    { colorSpaceConversion: "none" });
  const images = await Promise.all(imgs.map(load));
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const [a, b] = images;
  if (op === "crop") {
    const [x, y, w, h] = nums;
    c.width = w; c.height = h;
    g.drawImage(a, x, y, w, h, 0, 0, w, h);
  } else if (op === "pair") {
    c.width = a.width + b.width + 16; c.height = Math.max(a.height, b.height);
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(a, 0, 0); g.drawImage(b, a.width + 16, 0);
  } else if (op === "blend") {
    c.width = a.width; c.height = a.height;
    g.drawImage(a, 0, 0);
    g.globalAlpha = 0.5; g.drawImage(b, 0, 0, a.width, a.height);
  } else if (op === "diff") {
    c.width = a.width; c.height = a.height;
    g.drawImage(a, 0, 0);
    g.globalCompositeOperation = "difference";
    g.drawImage(b, 0, 0, a.width, a.height);
  }
  return c.toDataURL("image/png");
};

let imgs, nums = [], out;
if (op === "crop") { imgs = [await dataUrl(args[0])]; out = args[1]; nums = args.slice(2, 6).map(Number); }
else { imgs = [await dataUrl(args[0]), await dataUrl(args[1])]; out = args[2]; }
const url = await run(script, { op, imgs, nums });
await writeFile(out, Buffer.from(url.split(",")[1], "base64"));
await browser.close();
console.log(`${op} -> ${out}`);
