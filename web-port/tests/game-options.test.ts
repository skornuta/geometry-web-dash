import test from "node:test";
import assert from "node:assert/strict";
import { GAME_OPTIONS } from "../src/ui/optionsMenu.ts";
import { SETTINGS_KEYS } from "../src/gd/save.ts";

// the pause gear's GameOptionsLayer rows, in the game's order and slots
// (docs/ui-parity/reference/native-game-options-*): every row the port can honour has a setting

test("the in-level options carry the rows the game lists, each with its own setting", () => {
  const byLabel = new Map(GAME_OPTIONS.map((o) => [o.label, o]));
  const expect: [string, string][] = [
    ["Auto-Retry", "autoRetry"], ["Auto-Checkpoints", "autoCheckpoints"],
    ["Show Progress Bar", "showProgressBar"], ["Show Percentage", "showPercentage"],
    ["Show Time", "showTime"], ["Show Info Label", "showInfoLabel"],
    ["Disable Checkpoints", "disableCheckpoints"], ["Show Hitboxes", "showHitboxes"],
    ["Hitbox On Death", "hitboxOnDeath"],
  ];
  for (const [label, setting] of expect) {
    assert.equal(byLabel.get(label)?.setting, setting, label);
    assert.ok(SETTINGS_KEYS.includes(setting as never), `${setting} is a Settings key`);
  }
  // the hitbox rows carry the game's info text
  assert.match(byLabel.get("Show Hitboxes")!.info ?? "", /practice mode/);
  assert.match(byLabel.get("Hitbox On Death")!.info ?? "", /death/);
  // the slots follow the game's two-column order
  assert.deepEqual(GAME_OPTIONS.map((o) => o.label).slice(0, 4),
    ["Auto-Retry", "Auto-Checkpoints", "Show Progress Bar", "Show Percentage"]);
});
