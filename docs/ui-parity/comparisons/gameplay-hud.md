# Gameplay HUD — comparison record

**Status: implemented, NOT visually verified.** No native capture exists; see
[REFERENCE.md §2](../REFERENCE.md).

## Port captures

`hud-port-{1280x720,1920x1080,1024x768,narrow-420x900}.png` plus one per settings combination:
`hud-{all-on,no-bar,no-percentage,no-pause-button,pause-on-the-left}.png`. Regenerate with
`node scripts/hudtest.mjs`.

## What the rewrite replaced, and with what

| was | now | source |
|---|---|---|
| a flat white rectangle sized to half the viewport | the game's own `slidergroove2` groove with a `sliderBar2` fill, tinted the player's colour 1 | `setupHasCompleted +1404..1708` |
| percentage from `best`, bar from `player.x` | **both** from the live position, `clamp(x / length * 100, 0, 100)` | `getCurrentPercent` |
| `Math.round` | **floor** (`fcvtms`), so 100% appears only at exactly 100 | `getCurrentPercentInt` |
| percentage at an invented offset | left-anchored 110 right of centre with the bar, centred without it | `toggleProgressbar` |
| no pause button | `GJ_pauseBtn_clean_001` at opacity 75, 15 in from the top-right corner | `UILayer::init` |
| no visibility options | three settings that actually gate the bar, the percentage and the pause button, plus the left-hand mirror | `toggleProgressbar`, `UILayer::init` |

## What the harness checks

`scripts/hudtest.mjs`, 21 checks. The ones worth naming:

- the near-finish case the plan flagged: x = maxX − 2 reads **99**, exactly maxX reads **100**;
- the printed value equals `floor(livePercent)` at an arbitrary mid-level tick;
- rewinding the player drops the HUD back to 0 while the separate best-progress stat does not move
  — proving the HUD is not reading `best`;
- each of the four visibility settings produces a **different rendered top strip** from "all on"
  (a real pixel comparison, because a WebGL canvas without `preserveDrawingBuffer` reads back
  empty and an in-page pixel count would have been a fake assertion);
- the HUD's reported layout is **byte-identical** on Clutterfunk before and after its mirror portal
  (x = 1500, `mirrored = true`), which is what proves the HUD does not ride the world camera.

`tests/gameplay-hud.test.ts` pins the value, the floor, the fill sizing, both label anchorings and
the pause-button corner headlessly.

## Known differences

See [REFERENCE.md §14a](../REFERENCE.md) — four, all undecoded seeds or out-of-scope labels.
