# Results screen — comparison record

**Status: implemented, NOT visually verified.** No native capture exists; see
[REFERENCE.md §2](../REFERENCE.md).

## Port captures

`end-level-normal.png`, `end-level-practice.png`, `end-level-coins.png`, and
`end-level-{1280x720,1920x1080,1024x768,narrow-420x900}.png` — regenerate with
`node scripts/endleveltest.mjs`. `current/completion.png` comes from `scripts/ui-baseline.mjs`.

## What the rewrite replaced, and with what

The old completion screen was a `LEVEL COMPLETE` heading over a 0.62 black wash, an
`N attempts / M coins` line, and a vertical list of grey rectangles reading
`Next level` / `Replay` / `Level select`, with a `click or tap to choose` footer.

| was | now | source |
|---|---|---|
| a flat black wash | `EndLevelLayer` **is a `GJDropDownLayer`** — the same 356-wide table panel, chains and 0.5 s `CCEaseInOut` slide as the settings screen, 230 tall, settling 5 higher | `EndLevelLayer::init` = `GJDropDownLayer::init(" ", 230, true)` |
| a `LEVEL COMPLETE` text heading | `GJ_levelComplete_001.png`, or `GJ_practiceComplete_001.png` in practice, at scale 0.8, z 15, `winH*0.5 + 75` | `customSetup +520..664` |
| `N attempts  M coins` in bigFont | `Attempts: %i` and `Time: %s` in **goldFont** at scale 0.8, from `banner + (0, -40)` stepping -24, with `Time` width-limited to 150 | `customSetup +764..1572` |
| — | the original's random congratulation line, `rand() % 18` minus 2 over a 16-entry table with `Awesome!` twice as likely | `getEndText` m1 `0x4218d8` |
| a coin count in text | the level's three coin slots as `secretCoin_b_01_001` outlines at `winH*0.5 - 64`, gap 20, with `secretCoinUI_001` over the ones the **save actually holds** — and no row at all after a practice clear | `customSetup +4380..5020` |
| `Next level` / `Replay` / `Level select` rectangles | `GJ_replayBtn_001` at -100 and `GJ_menuBtn_001` at +100 on one row at `winH*0.5 - 125`, plus `GJ_restartCheckBtn_001` at -180 in practice | `customSetup +3256..4004` |
| a `Next level` button | **removed** — the original's results screen has no such control; `onMenu` returns to the carousel, which is where the next level is chosen | `customSetup +3464..3584` |
| a `click or tap to choose` footer | gone — development hint text the original does not have | plan, Task 9 |
| the HUD stayed live underneath | hidden once complete, so no click can reach a pause button the original has already removed | — |

## What the harness checks

`scripts/endleveltest.mjs`, 25 checks: every results frame resolves across the three sheets; there
is no layer mid-run and it really slides in on completion; attempts and time come from the **run**
(84.7 s for the recorded Stereo Madness route) rather than the save; the end text is one of the
sourced 17 and is re-rolled per completion; the row is Replay + Menu, with restart-from-checkpoint
added and leftmost in practice; Replay restarts in place, counts the attempt, does not leave the
level paused and does not leak a jump; Menu returns to `?levels=1&sel=1`; the coin row reads the
save's real coins; the gameplay pause button is gone; and four viewport shapes.

`scripts/navigationtest.mjs` drives the same buttons by their real rects on mouse-landscape and
touch-portrait @2x, and pins that the **last** level's row is the same pair as every other level's.
`tests/end-level.test.ts` covers the geometry, the time format's one-hour boundary and
`getEndText`'s off-by-two headlessly (6 tests).

## Known differences

See [REFERENCE.md §17.6](../REFERENCE.md) — six. The one worth acting on is the missing
`Jumps: %i` row: the port does not count jumps, and filling the row would mean either a
gameplay-file change this UI task must not make or a number that would be wrong.
