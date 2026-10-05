// Evidence for Task 4: L22's descending ceiling (group 265) stops where its
// two collision blocks meet.
//
// The section's move triggers send group 265 down 840 units over 4.19 s; the
// collision trigger at x=2835 spawns a stop trigger when block 2 (riding the
// ceiling) reaches block 1, which halts it 122 units down. This steps the real
// sim past the section and prints the group's offset. The player is held at a
// safe height and its death ignored — this measures the *triggers*, not a
// route.
//
//   node scripts/l22-crusher-trace.mjs
import { loadWorld } from "./headless.mjs";
import { createSim, simStep } from "../src/game/sim.ts";
import { groupState } from "../src/gd/triggers.ts";

const { level, world } = await loadWorld(22);
const sim = createSim(2600, 311.58, level);
sim.player.y = 400;
const dt = 1 / 240;
let t = 0, last = -1;
while (sim.player.x < 4200 && t < 12) {
  simStep(sim, world, dt, false);
  // diagnostic: ignore death, keep flying at a safe height
  sim.dead = false; sim.deathCause = undefined; sim.player.y = 400; sim.player.yVel = 0;
  t += dt;
  const g = groupState(sim.triggers.rt, 265);
  if (Math.floor(t * 4) !== last) {
    last = Math.floor(t * 4);
    console.log(`t=${t.toFixed(2)} x=${sim.player.x.toFixed(0)} g265 dy=${g.dy.toFixed(1)} enabled=${g.enabled} dead=${sim.dead}`);
  }
}
console.log("events:", (sim.events ?? []).slice(-8).map((e) => `${e.what}@${e.x.toFixed(0)}`).join(" "));
