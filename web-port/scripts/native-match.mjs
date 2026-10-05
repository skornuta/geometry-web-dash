// Template-match elements of a port render against a native capture of the same
// content resolution, and report each element's offset in design units.
//
//   node scripts/native-match.mjs <native.png> <port.png> <viewW> <viewH> <elements.json>
//
// elements.json: [{ "id": "...", "x": designX, "y": designY, "w": designW, "h": designH,
//                   "search": radiusInDesignUnits }]
// Design space has its origin at the view centre, +y up — the port's own. The
// match runs on 4x-downsampled greyscale for speed, then refines at full
// resolution in a +/-4 px window, so offsets are good to about a pixel.
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const [nativePath, portPath, viewW, viewH, elementsPath] = process.argv.slice(2);
const elements = JSON.parse(await readFile(elementsPath, "utf8"));
const url = async (p) => "data:image/png;base64," + (await readFile(p)).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
const out = await page.evaluate(async ({ a, b, viewW, viewH, elements }) => {
  // raw bytes, no colour management: see image-tools.mjs
  const load = async (s) => createImageBitmap(await (await fetch(s)).blob(),
    { colorSpaceConversion: "none" });
  const [na, po] = await Promise.all([load(a), load(b)]);
  const W = na.width, H = na.height;
  const grey = (img, f) => {
    const c = document.createElement("canvas");
    c.width = Math.round(W / f); c.height = Math.round(H / f);
    const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const o = new Float32Array(c.width * c.height);
    for (let i = 0; i < o.length; i++) o[i] = 0.3 * d[i*4] + 0.59 * d[i*4+1] + 0.11 * d[i*4+2];
    return { w: c.width, h: c.height, px: o };
  };
  const scale = H / +viewH;               // pixels per design unit
  const toPx = (x, y) => ({ x: (x + +viewW / 2) * scale, y: (+viewH / 2 - y) * scale });
  const levels = [4, 1].map((f) => ({ f, n: grey(na, f), p: grey(po, f) }));
  // Pearson correlation, so a global tint or brightness change (the background
  // colour cycle, a pressed state) does not masquerade as a position error
  const score = (L, tx, ty, tw, th, dx, dy) => {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const px = tx + x, py = ty + y, qx = px + dx, qy = py + dy;
      if (qx < 0 || qy < 0 || qx >= L.n.w || qy >= L.n.h || px >= L.p.w || py >= L.p.h) continue;
      const va = L.p.px[py * L.p.w + px], vb = L.n.px[qy * L.n.w + qx];
      sa += va; sb += vb; saa += va*va; sbb += vb*vb; sab += va*vb; n++;
    }
    const cov = sab - sa*sb/n, va = saa - sa*sa/n, vb = sbb - sb*sb/n;
    return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
  };
  const results = [];
  for (const e of elements) {
    const c = toPx(e.x, e.y);
    const hw = e.w * scale / 2, hh = e.h * scale / 2;
    let best = { s: -2, dx: 0, dy: 0 };
    // coarse
    { const L = levels[0], f = L.f;
      const tx = Math.round((c.x - hw) / f), ty = Math.round((c.y - hh) / f);
      const tw = Math.round(2 * hw / f), th = Math.round(2 * hh / f);
      const R = Math.round((e.search ?? 12) * scale / f);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const s = score(L, tx, ty, tw, th, dx, dy);
        if (s > best.s) best = { s, dx: dx * f, dy: dy * f };
      } }
    // fine
    { const L = levels[1];
      const tx = Math.round(c.x - hw), ty = Math.round(c.y - hh);
      const tw = Math.round(2 * hw), th = Math.round(2 * hh);
      const step = Math.max(1, Math.round(Math.max(tw, th) / 240)); // subsample only very big templates
      const sc = (dx, dy) => {
        let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
        for (let y = 0; y < th; y += step) for (let x = 0; x < tw; x += step) {
          const px = tx + x, py = ty + y, qx = px + dx, qy = py + dy;
          if (qx < 0 || qy < 0 || qx >= L.n.w || qy >= L.n.h) continue;
          const va = L.p.px[py * L.p.w + px], vb = L.n.px[qy * L.n.w + qx];
          sa += va; sb += vb; saa += va*va; sbb += vb*vb; sab += va*vb; n++;
        }
        const cov = sab - sa*sb/n, v1 = saa - sa*sa/n, v2 = sbb - sb*sb/n;
        return v1 > 0 && v2 > 0 ? cov / Math.sqrt(v1 * v2) : -1;
      };
      // the coarse score came from downsampled images and is not comparable,
      // so the refinement starts from scratch around the coarse answer
      const cx0 = best.dx, cy0 = best.dy;
      best = { s: -2, dx: cx0, dy: cy0 };
      for (let dy = cy0 - 6; dy <= cy0 + 6; dy++) for (let dx = cx0 - 6; dx <= cx0 + 6; dx++) {
        const s = sc(dx, dy);
        if (s > best.s) best = { s, dx, dy };
      } }
    results.push({
      id: e.id, corr: +best.s.toFixed(3),
      dxDesign: +(best.dx / scale).toFixed(2), dyDesign: +(-best.dy / scale).toFixed(2),
      dxPx: best.dx, dyPx: best.dy,
    });
  }
  return { scale, results };
}, { a: await url(nativePath), b: await url(portPath), viewW, viewH, elements });
console.log(`scale ${out.scale.toFixed(3)} px/unit`);
for (const r of out.results) {
  console.log(`${r.id.padEnd(16)} corr ${String(r.corr).padEnd(6)} offset (${r.dxDesign}, ${r.dyDesign}) design  = (${r.dxPx}, ${r.dyPx}) px`);
}
await browser.close();
