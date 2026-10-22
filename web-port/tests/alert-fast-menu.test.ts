// FLAlertLayer::show (ACTUAL_steamgd/GeometryDash.exe 0x140052c00) branches on m_noElasticity
// (+0x24c), which FLAlertLayer::init sets when game variable "0168" (Fast Menu) is on. Set, show
// skips the whole 0.5 s elastic pop (the main layer's 0.1 scale start) and the 0.14 s dim fade:
// the layer appears settled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { alertShowState, ALERT_DIM_OPACITY } from "../src/ui/alertLayer.ts";

test("F4: with Fast Menu the alert is settled from the first frame", () => {
  const s = alertShowState(0, true);
  assert.equal(s.scale, 1);
  assert.equal(s.dim, ALERT_DIM_OPACITY);
});

test("F4: without Fast Menu the pop and the fade start from the bottom as before", () => {
  const s = alertShowState(0, false);
  assert.ok(s.scale < 0.2);
  assert.equal(s.dim, 0);
  assert.deepEqual(alertShowState(0.2), alertShowState(0.2, false));
});
