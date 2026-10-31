import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorld } from "../scripts/headless.mjs";
import { OBJECT_DEFS } from "../src/gd/objects.ts";

// The game's own object dumps give the GJBeast monsters (918, 1327, 1328, 1584)
// type 47 AnimatedHazard and the black sludge (919) type 2 Hazard. The port drew
// them as decoration and built no collider for any of the 854 instances.
const IDS = [918, 919, 1327, 1328, 1584];

test("the monsters and the sludge are hazards in the object table", () => {
  for (const id of IDS) {
    const d = OBJECT_DEFS.get(id)!;
    assert.equal(d.kind, "hazard", `id ${id}`);
  }
  assert.equal(OBJECT_DEFS.get(918)!.type, 47);
  assert.equal(OBJECT_DEFS.get(919)!.type, 2);
});

test("every monster and sludge object gets a collider (Fingerdash, Geometrical Dominator)", async () => {
  for (const L of [19, 21]) {
    const { world, level } = await loadWorld(L);
    for (const id of IDS) {
      const objs = level.objects.filter((o) => o.id === id).length;
      const cols = world.colliders.filter((c: { id: number }) => c.id === id).length;
      assert.equal(cols, objs, `L${L} id ${id}`);
    }
  }
});
