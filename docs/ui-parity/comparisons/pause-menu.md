# Pause menu — comparison record

**Status: implemented, NOT visually verified.** No native capture exists; see
[REFERENCE.md §2](../REFERENCE.md).

## Port captures

`pause-normal.png`, `pause-practice.png`, `pause-seeded-stats.png` — regenerate with
`node scripts/practicetest.mjs`.

## What the rewrite replaced, and with what

| was | now | source |
|---|---|---|
| a `PAUSED` / `PRACTICE` heading | the **level's own name** across the top of the panel | `customSetup +460` |
| a stack of grey rectangles | the sourced icon row `[restartFull, practice/normal, resume, quit, restart]`, aligned with padding 15 at `winH/2 - 30` | `customSetup +592..1168` |
| a flat 0.62 black wash | the layer's own `{0,0,0}` at opacity 75 **plus** a `square04_001` nine-slice panel, also black, at opacity 175, inset 20 from every edge | `customSetup +44..344` |
| no progress display | **both** progress bars, normal above practice and **50** below it, each with its `Normal Mode` / `Practice Mode` label 20 above at scale 0.5, built exactly as `LevelPage`'s are | `setupProgressBars +380, +880, +1520..1628` |
| a text "Practice mode: ON" row | `GJ_practiceTxt_001.png` at its sourced position | `customSetup +1296..1364` |
| — | a settings gear at the panel's top-right corner, which **opens `GameOptionsLayer`** (Task 7) | `customSetup +1396..1560` |
| a text "Auto checkpoints: ON" row | removed from the pause menu: it is `Auto-Checkpoints` (game variable `0027`) on the gear's `GameOptionsLayer`, where the original keeps it — and it now persists | `GameOptionsLayer::setupOptions +128` |

## What the harness checks

`scripts/practicetest.mjs`, 15 checks: the row is in the sourced order; the settings gear is a real
control and its popup carries Auto-Checkpoints; the practice button both enters practice mode
**and resumes** (as
`onPracticeMode` does); resuming cannot leak a jump into the run; a practice death rewinds to a
checkpoint; `restartFull` clears the checkpoint stack while `restart` does not; a manual run does
not bank to the save (the documented `?manual=1` invariant); attempts increment on restart.

`scripts/navigationtest.mjs` drives the same controls by their real rects on both mouse-landscape
and touch-portrait @2x. `scripts/pausetest.mjs` still proves the audio context suspends with the
menu, and `scripts/attemptlabeltest.mjs` restarts through the new row.

## Known differences

See [REFERENCE.md §15a](../REFERENCE.md). Task 7 closed two of them (the gear, and the port-only
auto-checkpoints row); what is left is the pause menu's own pair of volume sliders and the two
controls the original itself omits for a main level.
