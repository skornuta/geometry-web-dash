import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
const files = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage();
for (const f of files) {
  const src = "data:image/png;base64," + (await readFile(f)).toString("base64");
  const r = await p.evaluate(async (src) => {
    const i = await createImageBitmap(await (await fetch(src)).blob(), { colorSpaceConversion: "none" });
    const c = document.createElement("canvas"); c.width = i.width; c.height = i.height;
    const g = c.getContext("2d"); g.drawImage(i, 0, 0);
    const W = 400, H = 400, d = g.getImageData(0, 0, W, H).data;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4, R = d[k], G = d[k+1], B = d[k+2];
      if (R > 200 && B > 180 && G < 170) {       // the arrow's pink fill
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
    }
    return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }, src);
  const s = 6.2;
  console.log(f.split("/").pop().padEnd(36), JSON.stringify(r), `centre = (${(r.cx / s).toFixed(2)}, top - ${(r.cy / s).toFixed(2)}) units`);
}
await b.close();
