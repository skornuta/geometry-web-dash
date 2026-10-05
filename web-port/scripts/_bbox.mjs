import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
// usage: _bbox.mjs x0 y0 x1 y1 rMin rMax gMin gMax bMin bMax files...
const a = process.argv.slice(2); const [x0,y0,x1,y1,r0,r1,g0,g1,b0,b1] = a.slice(0,10).map(Number); const files = a.slice(10);
const b = await chromium.launch(); const p = await b.newPage();
for (const f of files) {
  const src = "data:image/png;base64," + (await readFile(f)).toString("base64");
  const r = await p.evaluate(async ({ src, x0,y0,x1,y1,r0,r1,g0,g1,b0,b1 }) => {
    const i = await createImageBitmap(await (await fetch(src)).blob(), { colorSpaceConversion: "none" });
    const c = document.createElement("canvas"); c.width = i.width; c.height = i.height;
    const g = c.getContext("2d"); g.drawImage(i, 0, 0);
    const W = x1-x0, H = y1-y0, d = g.getImageData(x0, y0, W, H).data;
    let minX=1e9,maxX=-1,minY=1e9,maxY=-1;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) { const k=(y*W+x)*4;
      if (d[k]>=r0&&d[k]<=r1&&d[k+1]>=g0&&d[k+1]<=g1&&d[k+2]>=b0&&d[k+2]<=b1){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);} }
    return { x: x0+minX, y: y0+minY, w: maxX-minX+1, h: maxY-minY+1 };
  }, { src, x0,y0,x1,y1,r0,r1,g0,g1,b0,b1 });
  console.log(f.split("/").pop().padEnd(34), JSON.stringify(r), `= ${(r.w/6.2).toFixed(1)} x ${(r.h/6.2).toFixed(1)} units, centre (${((r.x+r.w/2)/6.2-285.16).toFixed(1)}, ${(160-(r.y+r.h/2)/6.2).toFixed(1)})`);
}
await b.close();
