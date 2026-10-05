// A colour spike's detail sprite (`m_colorSprite`) turns with its object. The
// native dump (data/native-geometry.jsonl) has the detail node at the object's
// own position with the same rotation as the object in every row it appears in
// (216 at -90 and 0; 458 at 26, 0 and -180), so the detail child carries no
// rotation of its own. The generator used to write the first instance's
// absolute rotation into the child, and the renderer turns the object as well,
// so a colour spike placed at 0 drew its detail tilted (USER-09).
import { test } from "node:test";
import assert from "node:assert/strict";
import { OBJECT_DEFS } from "../src/gd/objects.ts";

/** effective rotation of the object's detail child, given the object's own rotation */
function detailAngle(id: number, objRot: number): number {
  const kid = OBJECT_DEFS.get(id)!.children!.find((c) => c.color === "detail" && c.frame.includes("_color"));
  assert.ok(kid, `object ${id} has a colour child`);
  return objRot + kid.rot;
}

test("colour spike (216): a spike at rot 0 draws its detail upright", () => {
  assert.equal(detailAngle(216, 0), 0);
});

test("colour spike (458): a spike at rot 0 draws its detail upright, not at the first instance's 26", () => {
  assert.equal(detailAngle(458, 0), 0);
});

test("colour spike (216): a spike at rot -90 turns its detail with it", () => {
  assert.equal(detailAngle(216, -90), -90);
});

test("colour spike (458): a spike at rot -180 turns its detail with it", () => {
  assert.equal(detailAngle(458, -180), -180);
});
