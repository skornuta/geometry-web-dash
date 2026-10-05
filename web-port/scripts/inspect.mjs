// Dumps the collision world around a point, exactly as the sim sees it.
//
//   node scripts/inspect.mjs <level> <x> [span=60]
//
// Prints every collider near that x with its **hitbox** (not its sprite) —
// size, y span, circle radius, slope flag — plus the interactives. Use it
// before theorising about a death: the ?debug=1 overlay shows the same boxes
// in the browser, this gives you the numbers.
import { loadWorld } from "./headless.mjs";
import { OBJECT_DEFS } from "../src/gd/objects.ts";
const [lvl, xs, span = "60"] = process.argv.slice(2);
const { level, world } = await loadWorld(Number(lvl));
const x0 = Number(xs) - Number(span), x1 = Number(xs) + Number(span);
const near = world.colliders.filter((c) => c.x + c.hw > x0 && c.x - c.hw < x1);
near.sort((a, b) => a.x - b.x || a.y - b.y);
for (const c of near) {
  const o = level.objects[c.index];
  const props = [...o.props.entries()].filter(([k]) => [2,3,4,5,6,32,155].includes(k))
    .map(([k, v]) => `${k}=${v}`).join(" ");
  console.log(`${c.kind.padEnd(6)} id${String(c.id).padStart(5)} @${Math.round(c.x)},${Math.round(c.y)}`
    + ` box ${(c.hw * 2).toFixed(1)}x${(c.hh * 2).toFixed(1)}`
    + (c.radius ? ` r=${c.radius}` : "") + (c.slope ? " SLOPE" : "")
    + `  y ${(c.y - c.hh).toFixed(1)}..${(c.y + c.hh).toFixed(1)}   ${props}`);
}
console.log("--- interactives ---");
for (const it of world.interactives.filter((i) => i.x + i.hw > x0 && i.x - i.hw < x1)) {
  console.log(`${it.kind.padEnd(6)} id${String(it.id).padStart(5)} @${Math.round(it.x)},${Math.round(it.y)} ${(it.hw*2).toFixed(0)}x${(it.hh*2).toFixed(0)}`);
}
