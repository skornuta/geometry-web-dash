import { hash01 } from "./objectAnim.ts";

/**
 * The frame a ground pit shows, picked once when the object is built
 * (`GameObject::customSetup`, installed build 0x1005a9904 / 0x1005a9f14):
 *
 * - id 9 (and 1715): `rand()` scaled to [0, 2), rounded to nearest, plus one —
 *   `pit_01 / pit_02 / pit_03` in the ratio 1 : 2 : 1 the native dumps show
 *   (Stereo Madness 109 / 208 / 106 over 423 pits);
 * - id 135: `rand()` scaled to [0, 3), rounded, plus one, and a pick equal to the
 *   previous `pit_b` built is bumped by one, wrapping 5 -> 1 (a global holds the
 *   last pick) — `pit_b_01..04`, never the same twice running.
 *
 * `hash01` stands in for the load-time `rand()` (A22), so a level always shows
 * the same pits. `index` is the object's place in the level, which is also the
 * order the layer builds them in.
 */
const ROUND = (x: number) => Math.floor(x + 0.5);

/** the pit frames of a level's objects, by object index (only pits have an entry) */
export function pitFrames(objects: { id: number }[]): Map<number, string> {
  const out = new Map<number, string>();
  let lastB = 0;
  objects.forEach((o, i) => {
    if (o.id === 9 || o.id === 1715) {
      const n = ROUND(hash01(i, 11) * 2) + 1;
      out.set(i, `pit_${String(n).padStart(2, "0")}_001.png`);
    } else if (o.id === 135) {
      const pick = ROUND(hash01(i, 12) * 3) + 1;
      let n = pick === lastB ? pick + 1 : pick;
      if (n > 4) n = 1;
      lastB = n;
      out.set(i, `pit_b_${String(n).padStart(2, "0")}_001.png`);
    }
  });
  return out;
}
