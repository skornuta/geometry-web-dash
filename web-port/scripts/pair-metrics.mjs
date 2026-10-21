// Rank the native-vs-port batch shots by how much they differ, so the worst
// can be looked at first (D1).
//
//   node scripts/pair-metrics.mjs [pairs-dir] [out.json]
//
// `regression-pairs.mjs` leaves `port-l<N>-<pct>.png` beside the pairs; each is
// scaled to the native shot's size (571x320, mod overlays hidden) and compared
// per 16x16 cell. The top strip (the game's percent text against the port's
// progress bar) is left out. Prints per shot: mean absolute error, the share of
// cells off by more than 24/255, the mean colour of the upper (background) and
// lower (ground) bands for both sides, and the worst cell.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { chromium } from "playwright";

const dir = process.argv[2] ?? "/tmp/art-pairs";
const outFile = process.argv[3];
const batch = new URL("../../docs/fidelity/captures-2026-10-03/batch/", import.meta.url).pathname;
const shots = (await readdir(dir)).filter((f) => /^port-l\d+-\d+\.png$/.test(f)).sort((a, b) => {
  const [la, pa] = a.match(/\d+/g).map(Number), [lb, pb] = b.match(/\d+/g).map(Number);
  return la - lb || pa - pb;
});
const dataUrl = async (p) => "data:image/png;base64," + (await readFile(p)).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
const rows = [];
for (const f of shots) {
  const tag = f.slice(5, -4);
  const native = `${batch}${tag}.png`;
  let nUrl;
  try { nUrl = await dataUrl(native); } catch { continue; }
  const m = await page.evaluate(async ({ n, p }) => {
    const load = async (src) => createImageBitmap(await (await fetch(src)).blob(),
      { colorSpaceConversion: "none" });
    const [a, b] = await Promise.all([load(n), load(p)]);
    const W = a.width, H = a.height;
    const px = (img) => {
      const c = document.createElement("canvas"); c.width = W; c.height = H;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0, W, H);
      return g.getImageData(0, 0, W, H).data;
    };
    const A = px(a), B = px(b);
    const CELL = 16, top = 24;
    let sum = 0, cnt = 0, bad = 0, cells = 0, worst = { e: 0, x: 0, y: 0 };
    for (let cy = top; cy + CELL <= H; cy += CELL) {
      for (let cx = 0; cx + CELL <= W; cx += CELL) {
        let e = 0;
        for (let y = cy; y < cy + CELL; y++) for (let x = cx; x < cx + CELL; x++) {
          const i = (y * W + x) * 4;
          e += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        }
        e /= CELL * CELL * 3;
        sum += e; cnt++; cells++;
        if (e > 24) bad++;
        if (e > worst.e) worst = { e, x: cx, y: cy };
      }
    }
    const mean = (D, y0, y1) => {
      const s = [0, 0, 0]; let n = 0;
      for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; s[0] += D[i]; s[1] += D[i + 1]; s[2] += D[i + 2]; n++; }
      return s.map((v) => Math.round(v / n));
    };
    return {
      W, H, mae: sum / cnt, badShare: bad / cells, worst,
      bgN: mean(A, 30, 100), bgP: mean(B, 30, 100), gN: mean(A, H - 40, H - 4), gP: mean(B, H - 40, H - 4),
    };
  }, { n: nUrl, p: await dataUrl(`${dir}/${f}`) });
  rows.push({ shot: tag, ...m });
  console.log(`${tag.padEnd(8)} mae ${m.mae.toFixed(1).padStart(5)}  bad ${(m.badShare * 100).toFixed(0).padStart(3)}%  bg n${m.bgN} p${m.bgP}  gnd n${m.gN} p${m.gP}  worst ${m.worst.e.toFixed(0)}@${m.worst.x},${m.worst.y}`);
}
await browser.close();
if (outFile) await writeFile(outFile, JSON.stringify(rows, null, 1));
