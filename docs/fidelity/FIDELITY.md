# Fidelity record — PORT-COMPLETION-PLAN.md

Running record of every value this plan sourced: the address or file, the decoded rule, and which
task used it. Its layout copies `docs/ui-parity/REFERENCE.md`. The **Phase 3 list** at the bottom
collects everything shipped as an APPROXIMATION under the plan's constraint 2 speed rule.

Binary: the installed Steam GD, arm64 slice (fat offset 11026432, size 9996432), geode **2.2081**
bindings; every `m1` address below disassembles at `<+0>`. Tooling recipe: PHYSICS-FROM-BINARY.md
"Tooling" and REFERENCE.md §1. This session's scratchpad annotator also resolved `adrp`+`ldr`
float literals and `mov`/`movk`+`fmov` immediates, and a `fieldref.py` scanner that finds every
`ldr`/`str` of a struct offset (including the `add xN, x0, #3, lsl #12` + `#0x6a0` form).

## 0. Baseline (Task 0, 2026-09-11)

| check | result |
|---|---|
| agent loops (`pgrep -fl loop.sh`) | none running |
| `npm test` | **298/298** |
| `npx tsc --noEmit` | clean |
| `npm run build` | clean (`dist/assets/index-*.js` 400 kB) |
| `npm run sweep` (beam 256, retry wider) | **22/22** (2026-09-27) — L14 needs beam 512; L22 Dash searches single steps over x 7800–8450 (`--fine`, `sweep.mjs` LEVEL_ARGS) for the one-step press under the x=8229 trap toggle |
| `node scripts/parity.mjs` (beam 256) | 18 MATCH, L17/L19 no route at 256 (expected). **L20/L21 "replay crashed"** — not a valid measurement: the run overlapped this session's first Task 1 edits and the dev server hot-reloaded half-written code under it. Re-measured after Task 1 (§1.12) |

## 1. The end of a level (Task 1)

### 1.1 Level length and the end trigger

| rule | source |
|---|---|
| `m_levelLength = max(lastObjectX + 340, screenRight + 300)` | `PlayLayer::createObjectsFromSetupFinished` m1 `0xa4550` +196..276 (stored at `PlayLayer+0x3088` and `+0x364c`) |
| `lastObjectX` = max `getStartPos().x` over **every** object `addObject` receives, triggers included | `PlayLayer::addObject` `0xa02e0` +104..164, field `+0x36a0`; vtable slot `+0x708` is `GameObject::getStartPos` (resolved against the `GameObject` vtable at `0x1007da640`) |
| the end portal is created at `(m_levelLength, 225)` | same function +280..340 (`EndPortalObject::create` `0x3218d8`) |
| percent = `clamp(player.x / m_levelLength · 100, 0, 100)` | `getCurrentPercent` `0xa6e80` (reads `+0x3088`) |
| the ending triggers at `portal.x − 300 / zoom` | `PlayLayer::checkForEnd` `0xa84a0` → `EndPortalObject::getSpawnPos` `0x321d80` |
| no trigger while dead | `EndPortalObject::triggerObject` `0x321d10` +20..36 (`m_isDead` at `+0x970`) |
| the portal's height: camera centre, floor GD 225 (ship: centre as is) | `EndPortalObject::updateEndPos` `0x321f40` +128..256, run by `setVisible(true)` and again by `checkForEnd` |
| camera left edge ≤ `m_levelLength − winW/zoom − offset` | `GJBaseGameLayer::updateCamera` `0x124838` +276..336 |

**Effect on the port.** The port completed at `x ≥ lastObjectX`. It now ends at `levelLength − 300`,
40 units past the last object, and every percentage uses `levelLength` (340 past the last object) as
its denominator. `scene.maxX` survives only as "the last object"; `SimState.levelLength` owns the
denominator. The screen-width term cannot bind for any of the 22 levels (shortest: L22, last object
23 745), so the sim fixes it at the 16:9 width to keep headless and browser identical.
`scripts/manual-routes/stereo-madness.json` stopped at x=26391, short of the new trigger at 26424;
its final released segment was extended by 8 ticks of plain running over empty ground (recorded in
the file's `runout` field).

### 1.2 The pull into the portal — `PlayLayer::playEndAnimationToPos` `0xa3bf4`

- guarded by `+0x3360` (set here; also read by `canPauseGame`/`pauseGame` — **no pausing once it starts**);
- `updateCameraOffsetX/Y(offset, 0 s)`, then `updateStaticCameraPos(portal, staticX false,
  staticY true, false, 1.2 s, easing 1 = EaseInOut, rate 1.8)` (+160..320);
- player: `lockPlayer`, `playingEndEffect` (spider tweens to `fall_loop` over 0.4 s),
  `toggleGhostEffect(1)` (+324..356);
- `CCBezierTo(1.0, {p1 = start, p2 = (start.x + 40·dir, portal.y + 150), end = (portal.x + 50·dir,
  portal.y − 20)})` in `CCEaseIn(1.2)`, then `CCCallFunc(levelComplete)`; in parallel
  `CCRotateBy(1.0, 360)` in `CCEaseIn(1.5)` (+416..700). `dir` is −1 for a flipped portal
  (`+0x550`). The dual partner gets the same pull without the callback (+704..1040).

### 1.3 `PlayLayer::levelComplete` `0xa14ac` (classic)

- saves (`savePercentage`, `saveNewScore`, …); the port banks 100 here;
- `spawnCircle` ×5 at 0, 0.05, 0.1, 0.15, 0.2 s (+2232..2528); one `CCCircleWave(10 → 250, 0.5 s)`,
  line width 4, on the portal (+2532..2668);
- **normal**: `showCompleteEffect` at once; **practice**: `showCompleteText` after 0.1 s (+2672..2756).

### 1.4 `PlayLayer::showCompleteEffect` `0xa211c`

- `FMODAudioEngine::playEffect("endStart_02.ogg")` (+96..140) — **normal mode only**;
- `CCLightFlash::playEffect` on the portal in colour 1 with: startWidth 1, endWidth 30 ± 20,
  endHeight `√(w² + (h/2)²) + 10`, strip duration 0.09 ± 0.02, interval 0.0975, start delay
  0.02 ± 0.02, rotation 0 ± 180 with `circleRotation`, opacity 155 ± 100, 16 strips, delay 0.4
  (+392..584; parameter names from the binding, order checked against the call);
- `shakeCamera(0.5·(16+2)·0.195 = 1.755 s, 3, 0)` (+588..628);
- `showCompleteText` after the same 1.755 s (+664..740);
- the music: `getActiveMusicChannel(0)->setLoopCount(0)` — **not stopped**; `fadeOutMusic(2.0)` only
  when the level asks (settings `+0x15d`, i.e. kA16 fade-out, 0 in all 22) (+744..816). The port
  used to stop the music at completion; it now plays on under the results.

`CCLightFlash::playEffect` `0x45b718`: with `circleRotation` the strip angles are spread evenly over
the range and dealt out at random; each `CCLightStrip(width, toWidth, toHeight, duration, delay)`
(`init` `0x45bf2c`) tweens width and height with `CCEaseOut(2)` after its delay and is drawn as an
additive trapezoid whose base is `start + (width − start)·0.25` (`draw` `0x45c044`).
`fadeAndRemove` `0x45bb5c`, `delay` after the last strip: a white additive `CCLayerColor` fades in
over 0.3 s (`CCEaseIn(2)`), the strips are removed (`removeLights` `0x45bdd8`), 0.5 s later it fades
out over 1.5 s (`CCEaseInOut(2)`).

### 1.5 `PlayLayer::showCompleteText` `0xa24cc`

- banner `GJ_levelComplete_001` / `GJ_practiceComplete_001` at `(winW/2, winH/2 + 35)`, z 15, scale
  0.01 → 1.1 (practice 1.0) over 0.66 s `CCEaseElasticOut(0.6)`, hold 0.88 s, → 0.01 over 0.22 s
  `CCEaseIn(2)`, hide (+72..400);
- two `levelComplete01.plist` particles at the banner, z 13, the first tinted colour 1 (+432..792)
  — **Task 2**;
- normal mode only: `CCCircleWave(10 → screenRight, 0.8 s)` on the portal and `(10 → 250, 0.8 s)`
  on the banner, five more `spawnCircle`s, and ten fireworks (`0xa2dcc`) at
  `base + (2·rand − 1)·0.08` for base 0, 0.15 … 1.35 (+808..2184);
- `showEndLayer` after **1.5 s** (+2188..2240).

Firework `0xa2dcc`: a random point ≥ 50 from each screen edge; a filled, fading-in
`CCCircleWave(10 → 35 + 15·rand, 0.5 s)` in colour 2 at z 10, plus a `firework.plist` particle in
colour 1 at z 13 (particle — **Task 2**).

`CCCircleWave` (`init` `0x13e714`, `draw` `0x13ec74`): additive (`SRC_ALPHA, ONE`); `fadeIn` →
opacity 0→255→0 over two halves and a linear radius; otherwise opacity 255→0 and both tweens in
`CCEaseOut(2)` (the 4-argument `create` `0x13e638` passes `easeOut = true`); `m_circleMode ≠ 0` draws
a ring of `m_lineWidth`, segment count 10/15/20/30/50 by radius (<10/<20/<40/<200/else), else a
filled disc. `spawnCircle` `0xa2048`: fading-in ring, width 4, `10 → screenRight` over 0.5 s.

**Timeline, from the trigger:** pull 0–1.0 s → `levelComplete` 1.0 s → text 2.755 s (practice
1.1 s) → `EndLevelLayer` 4.255 s (practice 2.6 s). The browser check measured 4.27 s.

### 1.6 The ghost trail — `PlayerObject::toggleGhostEffect` `0x388894`

`GhostTrailEffect::runWithTarget(icon, snapshot 0.05, fade 0.4, duration 0, ghostScale 0.6,
scaleTwice false)`, additive in colour 1, opacity 200 (+64..260). Each snapshot fades 200→0 and
scales toward 0.6 over 0.4 s (`trailSnapshot` `0x5227b0`).

### 1.7 The end portal — `EndPortalObject::init` `0x321974`

- `endEffectPortal.plist` particle, offset (−15, 0), tinted colour 1 — **Task 2**;
- additive `gradientBar.png`, scaled to `1.5·winH` tall, at `portal.x − 15/zoom − 14`
  (`setPosition` `0x321de4`);
- `round(1.5·winH / 30)` `square_02_001.png` children rotated −90, at `(0, (n/2)·30 − i·30)` in the
  30×30 content box.

### 1.8 Jumps, attempts, and the stats they feed

| rule | source |
|---|---|
| a jump is counted by the ground jump of cube/robot/**ball** | `updateJump` +5724 → `PlayerObject::incrementJumps` `0x37b3d0` (the ball branch follows the call) |
| and by every orb that fires | `ringJump` +1604 → `PlayLayer::incrementJumps` `0xabd0c` (the common tail every orb branch reaches; a spent orb returns at +1616 first) |
| not by pads, UFO flaps, swing flips, spider teleports | the two call sites above are the only callers |
| `PlayLayer::incrementJumps`: `+0x3730` (attempt) and `+0x3728` (session) ++, and the level's cumulative `m_jumps` | `0xabd0c` +24..104 — no practice check |
| `+0x3728` (the results' `Jumps: %i`) is reset only by `PlayLayer::init` and `fullReset` | fieldref over `0x3728`; `commitJumps` `0xa2014` banks `+0x3730` into GameStats and zeroes it on death/complete |
| the "Attempt N" label is `+0x2f1c`, the **session's** count: zeroed by `init`/`fullReset`, bumped by `updateAttempts` `0xaba48` | fieldref over `0x2f1c`; `updateAttempts` +32..40 and `"Attempt %i"` at +124..164 |

**Port:** `SimState.jumps` counts per attempt (partner jumps count into player 1's state; cloned;
**not** rewound by `restoreSim`, since the original keeps the counter on `PlayLayer`). The scene
banks new jumps into the session count and `save.recordJump` each frame. The attempt label and the
results now show the session's attempts; the save keeps the cumulative count for Level Stats. (An
earlier comment claimed the cumulative count on screen was "as in the original"; the binary says
otherwise.)

### 1.9 The results layer — corrections

`EndLevelLayer::customSetup` `0x41fe0c`:

- the three classic rows are `Attempts` / `Jumps` / `Time`, 24 apart from banner − 40 (§17.1);
- **the end text**: +2464..2920. Practice → a `TextArea` (`bigFont`, width 620, anchor (0.5, 1),
  scale 0.55) reading *"Well done... Now try to complete it without any checkpoints!"* at
  `winH/2 − 51`. Normal → `getEndText()` in a `bigFont` label, `limitLabelWidth(260, 0.9)`, at
  `winH/2 − 65` — **only when the level has no coins** (`GJGameLevel+0x350 ≤ 0`); otherwise the coin
  row. All 22 main levels have coins, so a normal clear shows no end text. The port printed one on
  every clear, under the statistics, at a guessed position.

### 1.10 Level Stats — `LevelPage::onInfo` `0x3a6fa4`, `FLAlertLayer`

- `FLAlertLayer::create(nullptr, "Level Stats", desc, "OK", nullptr, 300)` with desc
  `<cy>%s</c>\n<cg>Total Attempts</c>: %i\n<cl>Total Jumps</c>: %i\n<cp>Normal</c>: %i%%\n<co>Practice</c>: %i%%`
  (string at `0x1007487ad`), filled from `GJGameLevel` `+0x2a8/0x2ac` (attempts), `+0x2b4/0x2b8`
  (jumps), `getNormalPercent()`, `+0x304` (practice) (+608..1008);
- `FLAlertLayer::init` `0x3ff6ec`: dim `(0,0,0,150)`; `TextArea(desc, chatFont, 1.0, width − 60,
  (0.5, 0.5), lineHeight 20)` at centre + 5; height `max(textH + 120, 140)`; `square01_001.png`
  nine-slice; goldFont title anchor (0.5, 1) at top − 15, scale 0.9; `ButtonSprite("OK", 90, 0, 1.0,
  absolute false, goldFont, GJ_button_01)` in a menu at bottom + 30;
- `ButtonSprite::setString` `0x83ed4`, non-absolute: background `max(minWidth, labelW·scale) + 16`
  wide, `labelH + 4` tall;
- `FLAlertLayer::show` `0x400794`: layer scale 0.1 → 1 over 0.5 s `CCEaseElasticOut(0.6)`, dim fades
  in over 0.14 s (skipped when game variable `"0168"` is set);
- The Tower's / "Coming Soon" pages' popups stay out of scope; their info button is inert.

### 1.11 Task 1 checks

| check | result |
|---|---|
| `npm test` | 312/312 (13 new in `tests/level-end.test.ts`, 1 new + 1 updated in `end-level.test.ts`) |
| `npx tsc --noEmit` | clean |
| `endleveltest.mjs` | PASS — incl. the new ending block: trigger 300 before the portal, input and pause inert, HUD 98 → 100 through the pull, results at 4.27 s, Jumps 82 on L1's route |
| `menutest.mjs` | PASS — Level Stats 300 × 220, pops in, swallows clicks, OK closes; Tower page inert |
| `hudtest`, `navigationtest`, `attemptlabeltest`, `pausetest`, `audiosynctest`, `mirrorplaytest`, `manual-replay` | PASS |
| `practicetest.mjs` | PASS after correcting a **pre-existing stale expectation** unrelated to Task 1: it expected the platformer-only `restartFull` in the classic pause row, which the code (and the native capture: four buttons) correctly omits |
| sweep / parity | §1.12 |

### 1.12 Gate after Task 1 (gameplay touched: the end trigger)

| check | before (§0) | after |
|---|---|---|
| sweep, beam 256 | 20/22 — L17 50.9 % at x=15600, L19 69.0 % at x=22131 | **20/22** — L17 **50.3 %** at x=15600, L19 **68.3 %** at x=22131. Same stopping points; only the denominator moved (`levelLength` = last object + 340) |
| parity, beam 256 | not measurable (overlapped edits) | 18 MATCH in the parallel run; L20 and L21 "replay crashed" with two Chromium+search jobs sharing the machine, and both **replay to 100 % with no console errors when run alone** (`replay.mjs`, 6080 and 5089 ticks). L17/L19: no route at 256 (expected). So: **20/20 routable levels MATCH** |

The parity harness's parallel crash of the two longest replays is a tooling limit (its own comment
warns about memory with several jobs), not a divergence; `--jobs=1` or a standalone `replay.mjs`
settles it.

Captures: `docs/fidelity/captures/end-level-{flash,banner,normal,practice}.png`,
`level-stats-popup.png`.

## 2. Particles and trails (Task 2)

### 2.1 The engine

`src/engine/ccparticles.ts` reproduces cocos2d-x 2.x `CCParticleSystem`: every key of the Particle
Designer plists the game ships, `emissionRate = maxParticles / particleLifespan` (a lifespan of 0 is
a burst of the whole budget — `landEffect`, `explodeEffect`, `levelComplete01`, `firework`),
gravity and radius emitter modes, per-channel colour variance, size/spin variance, `duration`,
free/relative vs grouped position types, and the stock `stopSystem` / `resetSystem` plus GD's
`resumeSystem`. `src/engine/streak.ts` reproduces `CCMotionStreak` (`fade`, `minSeg`, `stroke`,
fast-mode `ccVertexLineToPolygon`). Particle plists and textures are copied by `copy-assets.mjs`
(SD-only files; a particle quad is stretched to its own size).

The engine's vtable map (`CCParticleSystemQuad`, address point `0x100854520`) that made the game's
overrides readable: `+0x3b0` setPosVar, `+0x3c0/0x3d0` life/var, `+0x3e0/0x3f0` angle/var,
`+0x408` setGravity, `+0x418/0x428` speed/var, `+0x488` setStartRadius, `+0x500/0x510` start size/var,
`+0x540` setStartColor, `+0x560` setEndColor, `+0x5f0` setBlendFunc, `+0x610` setPositionType,
`+0x620` setAutoRemoveOnFinish.

### 2.2 The player's emitters — `PlayerObject::init` (m1 `0x37...`, +2560..3888)

| field | plist | position type | overrides in `init` | when it emits |
|---|---|---|---|---|
| `[0x868]` | dragEffect | relative | — (start colour set by `updateGlowColor`) | on the ground in cube/ball/robot/spider (`update` +3784..3852); stops **0.06 s** after leaving it (`CCDelayTime(0.06)` + callback, +1940..2052) |
| `[0x870]` | dragEffect | relative | speed and speedVar ×0.2, posVar (0, 2), start `(1, 0.392, 0, 1)`, end `(1, 0, 0, 1)` (`0x1007237a0`, `0x10071d990`) | ship and UFO (`toggleFlyMode` / `toggleBirdMode`) |
| `[0x878]` | dragEffect | relative | speed, speedVar and angleVar ×2, startSize and startSizeVar ×1.5, posVar (0, 2), start `(1, 0.745, 0, 1)` (`0x1007237b0`), end red | ship while held (`update` +1776..2076) |
| `[0x880]` | shipDragEffect | grouped | — | a vehicle on a surface (`update` +3692..3748) |
| `[0x888]`/`[0x890]` | burstEffect / burstEffect2 | relative | — | `[0x890]`: the robot's boost (`update` +2308..2664) |
| `[0x898]` | dashEffect | relative | colours from `updateGlowColor` | dash orbs (Task 10) — not wired |
| `[0x8a0]`/`[0x8a8]` | swingBurstEffect ×2 | grouped | start `(1, 0.392, 0)`, end red | swing — not wired (APPROXIMATION, A12) |
| `[0x8b8]`/`[0x8c0]` | landEffect ×2 | grouped | `[0x8c8]` angle, `[0x8cc]` gravity y saved | `hitGround` +484..940: alternately, only if that emitter has ≤ 2 particles left; angle and gravity y negated under flipped gravity; at `(0, ∓15·size)` from the player; `resetSystem` (a burst) |

`PlayerObject::setPosition` (`0x38e200` +88..252) places `[0x870]` and its companions at the player
plus `(−12·size, −4)` (swing `(−10·size, 0)`, ship `(−10·size, −18)`, UFO `(0, −3)`).

**Colours** — `updateGlowColor` (`0x38edf0`): particle colour **A** is colour 1 (colour 2 if colour
1 is black), **B** colour 2 (colour 1 if colour 2 is black), both through `GameToolbox::strongColor`
(`0x44b154`: no channel at 255 → scale by `min(255/max, 1.5)`, truncated). A is the start colour of
the drag, both landing emitters and the burst; B colours the streak.

**Death** — `playDeathEffect` (`0x1b7e94`), death effect 1: the icon fades out over 0.05 s;
`playerExplosion_01_001` at z 10000, scale `s·(1.5 ± 0.2)` (`s = size < 1 ? size : 0.9·size`),
rotation ±45°, frames 1 (or 2) to 11 at `0.05 + 0.01·rand` s, `CCDelayTime(6d)` then `CCFadeOut(6d)`,
**untinted and not additive** (the port drew it additive in the player colour; the art itself is
yellow flame into olive smoke); `explodeEffect.plist` grouped, start `(1, 1, 0, 1)` → end
`(1, 0, 0, 1)`, no colour variance, speed ×0.8, node scale `s`; circle waves yellow `10s → 110s`
over 0.6 s at opacity 0.6 and orange `(255, 150, 0)` `10s → 115s` over 0.4 s.

### 2.3 Streaks

- **Motion streak** — `setupStreak` (`0x375058`): streak 1 (the default kit) is
  `CCMotionStreak::create(fade 0.3, minSeg 5, stroke 10, white, "streak_01_001.png")`, `[0x1c8] = 50`,
  z −2 in the player's layer. On: `activateStreak` from `ringJump` (+2016, +2632), `propellPlayer`
  (+448), `flipGravity` (+492) and each flying mode's toggle; off: `deactivateStreak` from `hitGround`
  (+1588), `startDashing`, reset. Colour B.
- **Ship fire** — `setupStreak` +480..: only when the kit's ship-fire choice is ≥ 2; the default is 1,
  so none (the port has no ship-fire choice).
- **Wave trail** — `HardStreak` (`updateStroke` `0x8da3c`): quads between the recorded points and the
  head, two passes (wide/opaque, then narrow at 0.65), `clearBehindXPos` as the camera passes.

### 2.4 Objects' own particles — `GameObject::customSetup` (`0x4e866c`)

`createAndAddParticle(type, plist, tag, grouped)` per `GameObjectType`, the start/end colours read
after each local call site (`gd/effects.ts` `OBJECT_PARTICLES`): gravity portals 01/02, ship 04,
cube 03, mirror 02/01, ball 02, size 08/09, UFO 02, dual/solo 09, wave/robot/spider/swing 02 with
colours; pads `bumpEffect`; yellow/pink/gravity/red rings `ringEffect` with colours. Sites that share
their tail with other cases could not be attributed a colour (A9).

**Orb activation** — `ringJump` +2160..2360: `CCCircleWave(35 → 5, 0.35 s, fadeIn)` (red ring
42 → 5), filled, following the orb, coloured per type (yellow `(255,200,0)`, pink `(255,0,255)`,
gravity `(0,255,255)`, green/dash `(0,255,0)`, red `(255,100,0)`, gravity dash `(255,0,255)`, spider
`(255,50,255)`, drop ring colour channel 1007).

**Speed portals** — `GJBaseGameLayer::playSpeedParticle` (`0x12bb74`): `speedEffect_{slow,normal,
fast,vfast,vvfast}` for 0.7/0.9/1.1/1.3/1.6, grouped, auto-remove, screen space at
`(screenRight + 10, winH/2)`.

**Coins** — `spawnDefaultPickupParticle` loads `coinPickupEffect.plist`.

**The ending** — `EndPortalObject::init`: `endEffectPortal.plist` (radius mode) with
`setStartRadius(winH/2)`, offset (−15, 0), tinted; `showCompleteText`: two `levelComplete01`
bursts at the banner (the first tinted); each firework a `firework.plist` burst tinted colour 1.

### 2.5 Task 2 checks

| check | result |
|---|---|
| `npm test` | 322/322 (8 new in `ccparticles.test.ts`; `effects.test.ts` rewritten for the plist emitters) |
| tsc | clean |
| frame time (`scripts/perfprobe.mjs 22 18000,21000,6600`, headless software GL) | p50 20.7 / 15.4 / 18.3 ms. The slowest point (x=18000, 1 260 objects) has **0 particles**, the busiest particle point (x=21000, 111 particles) is the fastest — the level geometry, not the effects, sets the frame time |
| allocation | particles are struct-of-arrays in fixed typed arrays; object emitters are created on entering the view (not per frame); `renderer.drawQuadRaw`'s closure is the one per-call allocation |
| captures | `captures/fx-drag-l1.png`, `fx-drag-jump-l1.png`, `fx-wave-orb-pad-portal-l20.png`, `fx-ship-flame-streak-portals-l20.png`, `fx-death-a/b.png`, `end-level-banner.png`, `end-level-flash.png` |

## 3. Glow (Task 3)

Both halves shipped sourced; presentation only, no gameplay file touched.

### 3.1 Player glow — `PlayerObject::init` (m1 `0x37...` +4336), `updateGlowColor` `0x38edf0`

| fact | source |
|---|---|
| the glow is the icon's own `<icon>_glow_001.png`, which **every** per-icon sheet ships (486 cube, 169 ship, 119 ball, 149 UFO, 96 wave, 43 swing sheets checked by `tests/icons.test.ts`) | `init` +4336 loads `player_NN_glow_001`; `updatePlayerFrame` swaps it per mode |
| plain `CCSprite`, default blend (not additive), at z −1 in the icon's container `[0x760]`, under `[0x550]` | `init` +4336..4380 — no `setBlendFunc` on it |
| colour = `[0xa25]`, which +28..360 fills with colour 2 (colour 1 if colour 2 is black) through `GameToolbox::strongColor`; a custom glow colour `[0x930]` overrides (the port has none) | `updateGlowColor` +336..360, +892..960 |
| both colours black → white | `SimplePlayer::updateColors` `0x2f877c` +140..164 |
| visible when the kit's glow is on **or** colour 1 is black | `updateGlowColor` +120..148 (colour-1-black flag `w21`), +760..816 |
| robot/spider: one `m_glowSprite` node behind all parts, shown by `GJRobotSprite::showGlow` `0x5080c0`, coloured by `updateGlowColor` `0x5083a0` with the same colour | `updateGlowColor` +964..1096 |
| the garage preview (`SimplePlayer::updateColors`) uses the same colour and rule (`m_hasGlowOutline` or colour 1 black) | `0x2f877c` +196..468 |

Implemented as `playerGlow()` in `gd/icons.ts`, used by `playLevel.ts` and `garage.ts`. The old enlarged-additive main-layer glow is gone.

### 3.2 Object glow — `GameObject::addGlow` `0x4e6870`

| fact | source |
|---|---|
| **which ids:** a byte jump table at `0x72b1f2` over ids 1..1911 (+3004/3005/3027); 266 ids reach the case that builds a glow, all others none | `addGlow` +76..112 |
| **which frame:** `_001.png` → `_glow_001.png` on the frame the object was created from — the toolbox frame (`ObjectToolbox::intKeyToFrame`, `data/toolbox-frames.json`), not the port's `OBJECT_DEFS` frame. 265 resolve to a frame in `GJ_GameSheetGlow`; id 44 has no toolbox frame | `addGlow` +116..196; table in `gd/glow.ts`, pinned by `tests/glow.test.ts` |
| **off switches:** `[0x289]` (= `GameManager[0x29a]`, `commonSetup` +20..28); `GameManager[0x376]` limits glow to invisible objects; `[0x50e]` = key **135** (`objectFromVector` +3012; also suppresses portal guide art in `PlayLayer::addObject` +1304) | `addGlow` +24..72 |
| key **96** → `[0x3fc]`; `GameObject::setVisible` +228 shows the glow only when it is clear | `objectFromVector` +3904..3948 |
| **colour and blend:** `createGlow` makes a white sprite at the object's position, opacity 255, in the level's glow batch, which `setupLayers` makes additive | `createGlow`, `GJBaseGameLayer::setupLayers` |
| **depth:** each z layer's glow batch sits just below that layer's object batches | `setupLayers` |
| **opacity:** follows the object's `setOpacity` × `[0x434]` (1.0 from `commonSetup` +140..144; 0.8 only for 914/1615, which have no glow) | `GameObject::setOpacity` +192..252 |
| **tinted glows:** `PlayLayer::updateVisibility` +152..288 builds `transformColor(BG 1000, h 0, s −0.2, v +0.2)` — the float overload `0x449868` sets both absolute flags — and passes it to `setGlowColor` (vtable 0x5d0, `0x4f84e4`) for `[0x431]` objects (177-179 from `customSetup` +3876, 1701-1703 from +5660, 1619/1620 from `EnhancedGameObject::customSetup` +1712), id 143 (+2044..2072) and the invisible objects `[0x430]` = 144, 145, 205, 459 (`customSetup` +5136; +2316..2348 and `updateInvisibleBlock`). `[0x432]` switches the first group to channel 1007, raw; nothing decoded sets it | `updateVisibility`, jump table `0x72db44` |

Implemented in `levelScene.build()`: objects are grouped into runs of one z layer; each run emits its glows (`emitGlow`) and then its objects, so the existing `DrawItem` path gives culling, group move/rotate/alpha/toggle and the smashed-block hide for free. Tinted glows re-resolve channel 1000 every frame. Pulses skip glows (they recolour channel sprites).

### 3.3 Task 3 checks

| check | result |
|---|---|
| `npm test` | 327/327 (`glow.test.ts` +3; `icons.test.ts` +2) |
| tsc | clean |
| `scripts/audit.mjs` | 22/22 load clean, missing art 0 of 175 138 |
| harnesses | `kittest`, `renderpasstest`, `hudtest`, `endleveltest`, `menutest`, `playtest` PASS |
| glow share | glow items per level: L1 973, L13 2 005, L14 2 597, L21 2 614, L22 452 (key 135 turns off 2 330 in L22) |
| frame time (`perfprobe`, headless software GL) | L22 18000/21000/6600: p50 16.9 / 12.2 / 14.5 ms (Task 2: 20.7 / 15.4 / 18.3 — noise, no regression). L21 24000 (the densest glow section, 151 glow objects in 600 units): p50 30.2 ms |
| captures | `captures/glow-l1-x1050.png` (spike glow), `glow-l14-x21600-tinted.png` (the background-tinted glow on 177-179), `glow-l21-x24000.png`; player: `glow-player-cube-on.png`, `glow-player-cube-black.png` (black colour 1 forces the glow), `glow-player-ship-on.png`, `glow-player-robot-on.png`, `glow-garage-preview.png` |

## 4. Inert objects in Fingerdash (L21) and Dash (L22) (Task 4)

### 4.1 Two of the ten ids were misidentified

| id | the plan / the port said | what it is | source |
|---|---|---|---|
| 1594 | "spider pad ×10, no collider" | the **toggle orb** — a `CustomRing`. `GameObject::customSetup` +10752 sets type `0x24` (= `GameObjectType::CustomRing`) and the 36x36 box the port already had; `ObjectToolbox` gives `ring_custom_01_001.png`; `PlayerObject::ringJump` +616..652 routes it to `activateCustomRing` | `0x4e866c` +10752, `0x38991c` +616 |
| 3006 | "teleport orb (render-only)", drawn as `teleportRing_001.png` | the 2.2 **area move** trigger, invisible in play — its toolbox frame is `edit_eAreaMoveBtn_001.png` | `ObjectToolbox` (`data/toolbox-frames.json`) |

The port was drawing three teleport rings in L22 that the original does not
draw at all. 3006 now lives in `EDITOR_ONLY_IDS`, and 1594 is an orb.

### 4.2 Measured — every instance, its keys and what its groups hold

`scripts/inert-measure.mts <level>` prints this; the summary:

**L21 Fingerdash**

| id | n | what they address |
|---|---|---|
| 1585 animate | 15 | groups holding one `GJBeast01`/`GJBeast04` decoration each (ids 918, 1584). No hazard, solid or interactive is in any of them |
| 1611 count | 1 | item **0**, target 10, group 1 (1 390 objects). Item 0 is never written by anything in the level |
| 1811 instant count | 9 | item 1, targets 1-10, groups 225/226/222 — all spawn/move/pulse triggers on the counter text at x≈19 100 (objects 1615 + 914) |
| 1812 on death | 2 | group 79 (4 decorations at x≈0) and group 229 (a move + a toggle that reveal the "Hold"/"Dash" hint text at x≈2 550) |
| — | — | item 1 is fed by 10 `1614` small coins (key 80 = 1), which the port draws as decoration and does not collect |

**L22 Dash** — the x≈2 775-3 700 "crusher" is one machine:

| piece | what it does |
|---|---|
| two move triggers at x=2775 (group 543) | group **265** (222 objects: 20 solids, 35 hazards, 166 decorations) descends 360 + 480 units over 4.19 s, EaseIn |
| collision block 1 (1816, key 80 = 1) at (3585, 133), collision block 2 (key 80 = 2, key 94 dynamic) at (3585, 285) in group 265 | block 2 rides the ceiling down |
| collision trigger (1815) at (2835, 1005), blocks 1 and 2, activate group 545 | when the blocks meet, activate-and-spawn group 545 |
| stop trigger (1616) in group 545 | stops the actions of group 543 — the ceiling halts, **122 units** down (152 gap − the 30-unit blocks) |
| 6 touch-triggered spawn triggers at y=195 (groups 140/150/155/158/161/164) | each spawns group 544: a +30 move on group 265 (the ceiling lifts) and a pickup (1817) adding 1 to item 2 |
| count triggers (1611) at x=2835 on item 2 | at 4 → group 558 (a pulse and an alpha on decoration); at 5 → group 553 (two pulses and a **move that lifts a secret coin 180 units**) |
| 3 more touch-triggered spawns at x≈3195-3537 (group 540) | a "move to target" (key 100/71/395) on group 265 plus another stop of group 543 |
| 8 toggle orbs (1594) at y=75, x=3255-3675 | each toggles one spike's group (22-28) — 4 of them with "activate group", 4 without |
| 1594 at (13335, 675) | key 504 (spawn only): spawns group 369, a spawn trigger that runs L22's shader/camera burst at x≈13 300 |
| 3006 area move ×3 | groups 330 (121 objects, 15 solids), 387 (1 191, 47 solids / 42 hazards) and 391 (1 274) |
| 1347 follow ×1 | group 521 — one `2065` custom-particle object — follows group 514 (3 decorations) |
| 1585 animate ×25 | decoration only (ids 2031, 2047, 2065, 2315, 503/504, 2601/2602, 2887) |
| 1817 pickup ×3, 1611 count ×2, 1811 —, 1815 ×1, 1816 ×2 | the machine above, plus one pickup at (15285, 2145) on item 1 feeding a `3620` item-compare trigger |

### 4.3 The rules, decoded

| rule | source |
|---|---|
| **activate group** = `toggleGroup(group, activate)` **and**, when activating, `spawnGroup(group)` — one call, `toggleGroupTriggered` | m1 `0x11179c` +44..104. The plain toggle trigger (1049) instead tail-calls the bare `toggleGroup` (`EffectGameObject::triggerObject` +1820), so it does not spawn |
| **items** live in `GJEffectManager`; `countForItem` reads, `updateCountForItem` writes | `0x281adc`, `0x281c48` |
| **count (1611)** registers a listener (item, target, activate, key 104 multi) remembering the item's value at registration | `CountTriggerGameObject::triggerObject` `0x18b0e0` +52..156 → `GJEffectManager::runCountTrigger` `0x281888` |
| a listener fires when the value **crosses** its target — `prev < target <= now`, or `prev > target >= now` — and is removed unless multi | `updateCountForItem` +976..1008 (fire), +1036..1192 (erase) |
| **instant count (1811)** compares once, now: mode 0 equal, 1 `have > want`, 2 `have < want` | `testInstantCountTrigger` `0x11e350` +56..164 |
| **pickup (1817)**: mode 1 multiplies the item by key 449, mode 2 divides, key 139 overrides, otherwise adds key 77 (key 78 subtracts) | `GJBaseGameLayer::addPickupTrigger` `0x11e7fc` |
| **collision trigger (1815)** registers (block A = key 80, block B = key 95, key 93 on-exit, activate = key 56) | `registerCollisionTrigger` `0x27a014`, called from `EffectGameObject::triggerObject` +2952 |
| collision blocks are compared as plain AABBs of their object rects, once per step | `GJBaseGameLayer::updateCollisionBlocks` `0x102f6c`, `checkCollisionBlocks` `0x103718` +212..280 |
| **stop trigger (1616)** stops every action started by the triggers of the target group (key 580 = command, 0 = stop; key 535 switches to a control id) | `TriggerControlGameObject::triggerObject` `0x19eb18`, `controlTriggersInGroup` `0x10b0e4` → `controlActionsForTrigger` `0x27c534`; keys from `customObjectSetup` `0x19e8c0` +96..148 |
| **toggle orb (1594)**: with key 504 it spawns the target group, otherwise activate-group; **no velocity**, and it does not consume the press (the flag at `[0x7a8]` is skipped for a custom ring) | `activateCustomRing` `0x10b030`, `ringJump` +312..652 |
| one toggle orb per press — `[0x93c]` is set on use and `pushButton` +508..520 zeroes the ring flags on every press | `0x38991c` +372..568, `PlayerObject::pushButton` |
| **touch triggers (key 11)** fire from the collision pass when the player's rect overlaps the trigger's, not when their x is passed | `collisionCheckObjects` +1496..1512 → `playerTouchedTrigger` `0x1009c8` +76..212 |
| **on death (1812)** is the ordinary activate-group path, fired when the player dies | `EffectGameObject::triggerObject` +388 (the 1812 case of the jump table at `0x71e1c0`) |

### 4.4 What shipped, and what did not

Shipped, all through the shared `TriggerRuntime` so clone / restore / checkpoints
carry it: items and the count (1611), instant count (1811) and pickup (1817)
triggers; collision blocks (1816) + collision trigger (1815); the stop trigger
(1616, which the plan did not list but the machine needs); on death (1812); the
toggle orb (1594); and **touch-triggered firing for every trigger with key 11**
(L1 ×2, L12 ×16, L19 ×3, L20 ×6, L21 ×13, L22 ×146 — the port used to fire them
all by x, which is why stacked route-dependent colour triggers all fired at
once).

Not implemented, each with the measured reason:

| id | why not |
|---|---|
| 3006 area move ×3 (L22) | a full 2.2 area-effect: per-object offsets from the distance to a centre group, with ~20 keys (218-288) none of which is decoded. It moves solids and hazards, so it is a **gameplay** rule and constraint 2 forbids guessing it. The objects are now invisible, which is what the original draws |
| 1585 animate (L21 ×15, L22 ×25) | every target group holds decoration only (measured, 4.2) — no hazard, solid or interactive animates in these two levels. Presentation, Phase 3 |
| 1347 follow ×1 (L22) | its target group holds a single `2065` custom-particle object, which the port does not draw at all. Nothing to move |
| move "target pos" mode (keys 100/71/395/101) | two of L22's crusher moves use it; A21 |
| 1614 small coins / 1615 counter (L21) | the collectible that feeds item 1 and the counter label that displays it are both decoration in the port; the 9 instant-count triggers they drive only pulse and move that label |
| 1811 in L21, 1611 in L21 | implemented, but their items (0 and 1) are never written, so they stay quiet — matching the original only if the collectibles above stay uncollected. Recorded as APPROXIMATION A20 |

### 4.5 Task 4 checks

| check | result |
|---|---|
| `npm test` | 340/340 (`inert-triggers.test.ts`, 13 new) |
| tsc | clean |
| sweep at beam 256 | **20/22, identical to the baseline** — L17 50.3 % at x=15600, L19 68.3 % at x=22131, every other level complete. Run twice: once with the first cut of the machinery, once after the pickup and touch-index fixes |
| parity | **20 MATCH, 0 diverge**, L17/L19 no route at beam 256 (as at baseline) — every routable level replays identically in the browser |
| harnesses | playtest, practicetest, pausetest, navigationtest, mirrorplaytest, attemptlabeltest, audiosynctest, manual-replay, endleveltest — all PASS, no page errors |
| `scripts/audit.mjs` | 22/22 load clean, missing art 0 of 175 138 (the three 3006s moved from "drawn" to "invisible", so the invisible count went 6 231 → 6 234) |
| L22's crusher | headless trace (`web-port/scripts/l22-crusher-trace.mjs`, output in `traces/l22-crusher.txt`): group 265 descends and **stops at dy = −122.1** where the two collision blocks meet, instead of running to −840. Browser replay at x=3005/3301/3605 with `DEBUG_OVERLAY=1` shows the player threading the stopped ceiling |
| captures | `captures/task4-l22-crusher.png` (the section drawn, with the toggle orbs and no teleport rings), `captures/task4-l22-crusher-replay.png` (the same section mid-run with `DEBUG_OVERLAY=1`, the ceiling stopped), `captures/task4-l21-counter.png` (L21's collectible counter area) |

## 5. Object animation and continuous rotation (Task 5)

Everything here is decoded from the 2.2081 arm64 slice; the port's table is
`web-port/src/gd/objectAnim.ts`, which carries the same addresses inline.

### 5.1 Inventory — what actually moves in the 22 levels

Counted by decoding all 22 levels with `src/gd/level.ts` and intersecting with
the id sets recovered from the binary (method in §5.2/§5.3).

| group | rate | ids x instances | total |
|---|---|---|---|
| saw/gear tail, fixed | 300 deg/s | 88x198, 1705x0 | 198 |
| | 360 deg/s | 89x150, 98x124, 399x1 | 275 |
| | 300 deg/s | 397x57 | 57 |
| | 360 deg/s | 398x15, 677x1 | 16 |
| | 240 deg/s | 675x78 | 78 |
| | 300 deg/s | 676x67 | 67 |
| `createRotateAction` A | 300 / 360 deg/s | 740x13, 741x8 | 21 |
| wheels, random | rand()*90 + 90 | 137x431, 138x316, 139x59, 180x111, 181x52, 182x10 | 979 |
| spirals/rings, random | rand()*90 + 270 | 1058x89, 1059x7, 1060x90, 1055x24, 1056x70, 1057x14 | 294 |
| flash rings, random | rand()*135 + 45 | 1019x77, 1020x176 | 253 |
| **rotating, total** | | | **2 238** |
| frame-animated | see §5.3 | 1050x769, 1591x681(static), 1052x302, 3000x230, 1519x175, 921x121, 1697x116, 1054x109, 1516x103(not flagged), 142x66, 2032x74, 2888x70, 1856x67, 923x47, 924x47, 1583x41(not flagged), 2630x31, 920x26, 1518x25, 1936x20, 2042x16, 2694x16, 2629x14, 2041x13, 1614x11, 1840x10(static), + 14 more | **3 187** |

Per level, the rotating ids appear in L11-L22 and the animated ones almost
entirely in L19-L22. Nothing in L1-L10 rotates; their only animated object is
the secret coin (142, 3 per level).

In the built scene this comes out as **6 432 spinning sprites and 3 204
animated sprites** of 268 571 (a sprite is an object's main art, each child and
its glow; a saw is 3-4 sprites). Counted in the browser over all 22 levels.

### 5.2 Rotation, sourced

`EnhancedGameObject::customSetup` (m1 `0x4fb368`) is the only place a level
object is given a spin, and 207 of the 1 055 ids in the 22 levels are
`EnhancedGameObject`s at all — the class is chosen by a byte table at
`0x72a040` read by `GameObject::createWithKey` (`0x4e605c` +72), indexed by
`id - 10`.

Four setups reach the same field, `m_rotationDelta` (+0x578), in **signed
degrees per second**:

- the **inline tail at +2868**, fed by the saw/gear block at +1032 whose
  defaults are `s1 = 300`, `s2 = 32.3`, `s8 = 360`; each id's case picks which
  it keeps. That is the whole saw family: 88/89/98/397/398/399, 675/676/677,
  1705-1710, 1734-1736.
- **`createRotateAction(angle, clockwise)`** (m1 `0x4fb2f8`) from +624 (740-742),
  +1604 (1058-1061, 1831-1834) and +2392 (1019-1021), plus the two feeders at
  +1008 (137-139, 180-182) and +864 (1055-1057) that compute the angle first.

The id -> block map was recovered by interpreting `customSetup`'s control flow
for every id 1..4699 (the switch is a byte jump table at `0x731dfa` plus a
comparison tree; the interpreter is in the session scratchpad, the result is the
table in `objectAnim.ts`).

**Rate and direction.** `createRotateAction` +40..92, and the same code inlined
at +2884..2940: if key **97** (`m_rotationSpeed`, +0x570) is non-zero it is the
rate and the direction is +1; otherwise the rate is the table value and the
direction is `rand() < 0.5 ? -1 : +1`. Key **98** (`m_disableRotation`, +0x56c)
skips the setup entirely. In the 22 levels key 97 appears **51 times, always
`50`, always on id 1019**; key 98 never appears.

**Clock.** `EnhancedGameObject::updateRotateAction(dt)` (m1 `0x4fdd54`)
accumulates dt into +0x57c and sets the rotation to `accumulated *
m_rotationDelta`. Its caller is `PlayLayer::updateVisibility(float dt)` (m1
`0xa4b78` +2108), gated on `getHasRotateAction()` (`0x1a1f70`). So **the rate is
wall-clock game time, not level speed** — a speed portal does not change it.

### 5.3 Frame animation, sourced

`GameManager::setupGameAnimations` (m1 `0x203598`) makes **135**
`addGameAnimation(objectID, frames, frameTime, mainFrame, detailFrame,
defaultFrame)` calls (m1 `0x209d90`). That function builds every frame name with
the format string **`"%s_%03d.png"`** (+220) and files the count and the time
under `GameManager::m_framesForAnimation` / `m_frameTimeForAnimation`. The 135
calls were read straight out of the disassembly; **40 of the ids are used by the
22 levels**, and `defaultFrame` is 1 in every one of them.

`EnhancedGameObject::setupAnimationVariables` (m1 `0x201dcc`) reads them into
`m_frames` (+0x568) and `m_frameTime` (+0x564), then divides the time by
`m_randomFrameTime` (+0x55c) — or by `|key 107|` when key **122** is set
(+124..160).

`EnhancedGameObject::updateSyncedAnimation(totalTime, -1)` (m1 `0x200828`
+232..316) picks the frame:

```
n   = floor(max(startOffset + totalTime, 0) / frameTime) mod frames
idx = reversed ? frames - n : n + 1        // 1-based, "<base>_%03d.png"
```

`totalTime` is the level clock (`PlayLayer::updateVisibility` +1936 passes
`PlayLayer[0x398]`), so instances of one id share a clock. What desyncs them is
the per-object `startOffset` (+0x548) and `m_randomFrameTime`, both drawn from
`rand()` in `customSetup`:

| `customSetup` block | `m_randomFrameTime` | start offset | ids used by the 22 levels |
|---|---|---|---|
| +112 | `rand()*0.4 + 0.8` | `rand()*0.5` | 1856, 1857 |
| +412 | `rand()*0.4 + 0.8` | `rand()*0.5` | 2024, 2027, 2031, 2032, 2041-2044, 2047, 2864, 2865, 2887, 2888, 2893 |
| +1400 | `rand()*0.4 + 0.8` | `rand()*0.5` | 920, 921, 923, 924, 1518, 1519, 1936, 1937, 1939 |
| +1816 | `rand()*0.4 + 0.8` (not 2694) | none | 2629, 2630, 2694, 4300 |
| +2256 | 1 (untouched) | none | 1050, 1052, 1054, 3000 |
| +2520 | `rand()*0.5 + 0.8` | `rand()*0.5` | 1697 |
| +3104 | — | — | 1591 (1 frame: static) |
| `EffectGameObject::customSetup` `0x157578` | — | none | 142, 1614 |

The gate is `getHasSyncedAnimation()` (`0x1a1f68`, `m_hasCustomAnimation`
+0x56a). **Ids 1516 (waterfall, x103) and 1583 (fireball, x41) have a
`setupGameAnimations` entry but are never flagged**, so they stay static in the
port too; 1591 (x681) and 1840 (x10) are single-frame entries.

In the 22 levels: key **106** on 441 objects, key **107** on 365, key **122** on
215, key **123** on 35, key **126** on 2, key **127** on 9. Keys 462, 592 and
214 never appear.

### 5.4 The animate trigger (1585)

`EffectGameObject::triggerObject` walks the target group and calls
`triggerAnimation` on each member. Two kinds of member exist:

- an **`AnimatedGameObject`** plays the animation key **76** names
  (`AnimatedGameObject::animationForID` `0x1724f0`: for id 918, type 0 is
  `idle01`, type 1 `idle02`, ...). Only six ids in the whole game are
  `AnimatedGameObject`s — 918, 919, 1327, 1328, 1584, 2012 — and the 22 levels
  hold **790** of them (919 x650 alone, mostly in Fingerdash). The port draws
  each as one static sprite: their animation is the `*_AnimDesc.plist` +
  `CCAnimatedSprite` + `CCSpritePart` stack, the same machinery as the robot and
  the spider, and wiring it is **not** in Task 5. Recorded as A25.
- an **`EnhancedGameObject` with key 123** (`m_animateOnTrigger`, +0x589) holds
  its first frame until then. `waitForAnimationTrigger` (`0x201aa4`) clears
  `m_animationTriggered` (+0x591) and zeroes the start offset;
  `triggerAnimation` (`0x201c00`) sets it, forces `[0x598] = -1` and re-bases
  the offset so the loop runs from that instant; `updateSyncedAnimation` +40..80
  returns early while the flag is clear.

**All 15 of Fingerdash's animate triggers target id 918** (and one 1584), so
they have nothing to drive in the port. **Deadlocked's 25** split: 13 target
groups holding 2047 / 2031 / 2887 with key 123 — implemented — and the rest
target 2065 (the custom-particle object the port does not draw, Task 6/7) or
918. Key 123 appears on 35 objects, all in Deadlocked: 2047x9, 2031x3, 2065x20,
2887x2, 2024x1.

### 5.5 Art must not desync from collision

Checked per id before animating it:

- **The saws and gears** (88, 89, 98, 397-399, 675-677, 1705-1710, 1734-1736,
  740-742) are circles in the collision world — `stepCollision` reads a radius,
  not a box — so spinning the sprite cannot move the hitbox. The same
  `customSetup` blocks that set the rotation also set that radius (+0x384:
  32.3 for 88, `scale * 0.36` for 89, 28.9 for 397, 32.0 for 675, ...), which is
  why they are circles in the first place.
- **Everything else that rotates** (137-139, 180-182, 1019-1021, 1055-1061,
  1831-1834) is `GameObjectType 7` decoration with no collider at all.
- **Every frame-animated id** is decoration or a coin (142/1614, which the port
  collects by object index, not by sprite). No solid or hazard animates.
- The rotation is applied in the draw loop about the **object's** centre, so a
  child sprite orbits the parent exactly as the group-rotate path already does.

### 5.6 Task 5 checks

| check | result |
|---|---|
| `npm test` | 351/351 (`tests/object-anim.test.ts`, 11 new) |
| tsc | clean |
| `scripts/audit.mjs` | 22/22 load clean, missing art 0 of 175 138 |
| harnesses | endleveltest, hudtest, practicetest, menutest, kittest, settingstest, navigationtest, audiosynctest, attemptlabeltest, mirrorplaytest, manual-replay — all PASS |
| **sweep at beam 256** | **20/22, identical to the baseline** — L17 50.3 % at x=15600, L19 68.3 % at x=22131 |
| **parity** | every level that has a route replays identically in the browser; L17/L19 skip at beam 256 as at baseline. The run was killed by the machine running out of memory after level 19 and L20-22 were re-run on their own |
| perfprobe A/B | the same page measured with rotation+animation live and then with `spin`/`animFrames` stripped out of every item: L21 x=9000 12.9 vs 12.6 ms p50, L21 x=1500 21.0 vs 20.9, L22 x=3000 19.0 vs 18.9, L20 x=7800 16.8 vs 16.7 — **within 0.3 ms** on headless software GL, so nothing was hoisted |
| scene inventory | 6 432 spinning and 3 204 animated sprites over the 22 levels (`scripts/animinventory.mjs`) |
| captures | `captures/task5-*` — pairs 0.16-0.4 s apart at one spot with the trigger state held still (`web-port/scripts/animcapture.mjs`), plus the amplified difference |
| **native still** | **BLOCKED** — `gd-ui-capture` is installed but the game is not running, and this session cannot launch it (`open` returns 0, no process appears; AppleScript is blocked by the Automation permission). *Human step: start Geometry Dash from Steam and leave it on the main menu; the mod then takes `play 12` + `freeze` through `/tmp/gd-ui-capture/cmd`.* |

## 6. The trigger mechanisms Task 4 deferred (Task 6)

### 6.1 The collision-block pair key

`stepCollisionBlocks` packed a pair of block ids as `lo * 10000 + hi`. Block ids
come from key 80 and nothing bounds them, so `(1, 20001)` and `(2, 10001)`
collided on one key and one of the two pairs could never fire. Replaced with a
2^21 shift, which stays an exact double for any id the editor can produce.
No level in the 22 has a block id over 2, so this fixes a latent fault rather
than an observed one.

### 6.2 The collectible (1614) and the counter label (1615)

**Sourced.** `GJBaseGameLayer::collisionCheckObjects` (m1 `0xff074`) has a
collectible branch at +1516..1628: it skips the object when
`GJEffectManager::hasBeenTriggered(objUid, playerUid)` (`0x2812a0`) is already
set, otherwise calls `storeTriggeredID` (`0x2810dc`), runs the object's own
`triggerObject` (vtable +0x500) and, unless the object is a unique coin
(`GJBaseGameLayer::hasUniqueCoin` `0x100d0c`), records it in
`pickupItem` (`0x100e40` — a dictionary of picked-up object ids, not a counter).
The count itself is `GJBaseGameLayer::addPickupTrigger` (`0x11e7fc`), the same
function the pickup trigger (1817) already used: mode key 79/88 at +0x730,
multiplier key 449 at +0x738, override key 139 at +0x735, amount key 77 at
+0x72c.

**The one value that is not sourced** is the amount a collectible with no key 77
adds. `m_pickupCount` (+0x72c) is zero-initialised and Fingerdash's eleven
collectibles carry no key 77, yet its nine instant-count triggers compare item 1
against 1, 2, 3, 4, 6, 8 and 10 — so each collectible must add exactly **1**.
The port uses key 77 when present and 1 otherwise; the default is inferred from
the level's own ladder, not read out of the binary. **A20 is closed for the
mechanism and re-recorded as A27 for that one number.** This is presentation:
group 225 — everything the nine triggers address — holds a single spawn trigger
that pulses the counter text (measured, §4.2), and item 1 is read by nothing
else.

`1615` is a `LabelGameObject` (`0x178db4`). It prints the live value of key 80's
item, so it cannot be baked into the scene's sprite list the way a text object
(914) is; `LevelScene.drawCounters` lays its digits out every frame with the
level font, centred on the object's position exactly as `emitText` centres a
string. There is one in the 22 levels (Fingerdash, x=19102). The audit's
"invisible" count drops by one because 1615 is now drawn.

### 6.3 The move trigger's "target pos" mode

**Sourced** (key names from the 2.2081 geode bindings, `EffectGameObject`):

| key | field | meaning |
|---|---|---|
| 100 | `m_useMoveTarget` | use target mode instead of the key 28/29 offset |
| 71 | `m_centerGroupID` | the group to move **to** |
| 395 | `m_targetModCenterID` | the group whose centre is put there |
| 101 | `m_moveTargetMode` | 0 both axes, 1 x only, 2 y only |

A group's centre is `GJBaseGameLayer::getGroupCenter` (m1 `0x33fa4`): a group of
**one** object is that object's position (+60..104); a larger group is the
centre of its **bounding box** (+164.., min/max against ±1e6 sentinels) — not
the mean, which is what `groupCentre` used to compute. Corrected, which also
changes the rotate trigger's centre for any group of more than one object.

Both groups may already have been moved when the trigger fires, so the port
resolves each centre from its **member objects' live positions** — a marker
usually belongs to the group being moved as well, so its offset is the sum of
*all* its groups', not just the one the trigger names. (Getting that wrong is
the bug the tests caught: the first draft applied only the named group's offset
and moved Dash's crusher twice.) What is
**not** decoded: whether the original recomputes the offset while the tween runs
(`m_isDynamicMode`, key 397 — absent from every move trigger in the 22 levels)
and the exact call that builds the command (`GJBaseGameLayer::triggerMoveCommand`
`0x10cca4` reaches `createMoveCommand` `0x27a1ac`, but the branch that turns the
two centres into a point was not isolated).

**Cross-check.** Dash's only target-mode move (x=3225, group 540) puts group
541's marker at y=274 onto group 542's at y=152, y only: **−122**. Task 4
measured the same crusher stopping at **−122.1** by an entirely different route
— the collision blocks meeting and the stop trigger halting the descent. Two
independent paths to the same number, which is also why shipping this changes
Dash by **0.1 units**: `scripts/l22-crusher-trace.mjs` still reports the ceiling
resting at −122.1, and the target move only trims the remainder when the route
touches the spawn triggers that fire it.

### 6.4 Touch-trigger re-arm (A19) — the approximation was the rule

`GJBaseGameLayer::playerTouchedTrigger` (m1 `0x1009c8`), decoded end to end:

1. return unless `m_isTouchTriggered` (+0x5c0, key 11);
2. the record is keyed by `(object uid, player uid)`, or by `(object uid, 0)`
   when +0x6cc is set;
3. **only when key 87** (`m_multiTrigger`, +0x680) is set does it touch the
   contact map at `[0x498]`: an entry that already exists is re-stamped with the
   layer's step counter `[0x3b0]`; an entry that does **not** exist first calls
   `GJEffectManager::removeTriggeredID` (`0x2811a8`) — that is the re-arm — and
   is then inserted;
4. either way, fire only if `hasBeenTriggered` is clear, and set it.

So a touch trigger fires once, and re-arms only if it is a multi trigger *and*
contact was lost — which is exactly what the port already did. A19 was an
approximation in name only; **closed, not changed**.

`canBeActivatedByPlayer` (`0x1000cc`), which the plan named as the source,
writes the same map and returns
`object->canMultiActivate(player.isSecondPlayer) || !object->hasBeenActivatedByPlayer(player)`,
with `canMultiActivate` (`0x4fadd0`) reading key **444** for player 2 and key
**99** for player 1. That is the *orb* re-use rule the port already implements
(`P.MULTI_ACTIVATE_ORB`), not the touch-trigger one.

### 6.5 Area move (3006) — still recorded, with better names

Not implemented; it moves solids and hazards, so constraint 2 forbids guessing
it. What Task 6 added is that the keys are no longer anonymous — the geode
bindings name every one of them on `EnterEffectObject`:

| key | field | key | field |
|---|---|---|---|
| 217 | `m_enterType` | 242/243 | `m_easingInType` / `Rate` |
| 218/219 | `m_moveDistance` / `Variance` | 248/249 | `m_easingOutType` / `Rate` |
| 220/221 | `m_offset` / `Variance` | 252/253 | `m_offsetY` / `Variance` |
| 222/223 | `m_length` / `Variance` | 260 | `m_tintChannelID` |
| 231/232 | `m_moveAngle` / `Variance` | 262 | `m_directionType` |
| 233-236 | `m_areaScaleX/Y` + variances | 263/264 | `m_modFront` / `m_modBack` |
| 237-240 | `m_moveX/Y` + variances | 287/288 | `m_relative` / `m_relativeFade` |

Dash's three instances use 222 (length), 218 (distance), 232, 242/243, 248/249,
261, 262, 263/264, 287, 276, 282, 283 and 51/71. What is still undecoded is the
**geometry**: how `m_length`, `m_offset` and the distance from the centre group
turn into a per-object offset, which lives in `EnterEffectInstance::loadValues‑
FromObject` (`0x4ff4ac`, a 30-field bulk copy) and `loadTransitions`
(`0x4ff57c`), fed by `GJBaseGameLayer::addAreaEffect` (`0x114378`). Recorded as
A28; the objects stay where the level put them, which is what the port drew
before.

### 6.6 Follow (1347) — nothing to follow

Unchanged from §4.4: its target group holds one `2065` custom-particle object,
which the port does not draw at all. Drawing 2065 is particle work, not trigger
work. Recorded.

### 6.7 Animate (1585)

Implemented in Task 5 — see §5.4.

### 6.8 Task 6 checks

| check | result |
|---|---|
| `npm test` | 358/358 (`tests/trigger-mechanisms.test.ts`, 7 new) |
| tsc | clean |
| `scripts/audit.mjs` | 22/22 load clean, missing art 0 of 175 138; **invisible 6 234 -> 6 233**, the one counter label that is now drawn |
| captures | `captures/task6-l21-counter-0.png` and `-7.png` — Fingerdash's panel reading "0 / 10" and, with item 1 set to 7, "7 / 10" |
| L22 crusher | `scripts/l22-crusher-trace.mjs` unchanged: the ceiling descends and rests at −122.1 |
| sweep / parity | see the session log |

## 7. The visible half of the approximation list (Task 7)

### 7.1 A15 / A18 — the invisible objects and the screen-edge fade

**Sourced.** `PlayLayer::updateVisibility` (m1 `0xa4b78`) hands every `[0x430]`
object — ids **144, 145, 205, 459**, 368 of them across L14-L20 — to
`PlayLayer::updateInvisibleBlock` (m1 `0xa5820`) once a frame, having computed
four bounds at +664..720 from the window width `W` and a second screen measure
`R`:

```
leftFadeBound = W/2 - 75     rightFadeBound = W/2 + 35
leftFadeWidth = W/2 - 105    rightFadeWidth = R - (W/2 + 35) - 90
```

`updateInvisibleBlock` turns them into two opacities (+240..400):

```
d = objX > camLeft + rightFadeBound ? objX - (camLeft + rightFadeBound)
                                    : (camLeft + leftFadeBound) - objX
f = clamp(d / max(width, 1), 0, 1)
setOpacity    ((f * 0.95 + 0.05) * 255, capped)      // vtable +0x380
setGlowOpacity((f * 0.85 + 0.15) * 255, capped)      // m1 0x4edc70
```

so an invisible block sits at **5 % opacity around the player** and fades in
toward both screen edges. The cap is the **screen-edge fade** (+84..236, and the
same ramp standalone at `0xa6a48`): the object's x is first pulled toward the
screen centre by its own half-width, then

```
cap = clamp(coef * (halfW - |x - centre|), 0, 1),   coef = 0.02 right, 0.0143 left
```

which is 1 everywhere except the last ~50 (right) / ~70 (left) units before the
edge. Above 0.8 opacity the object's colour is mixed toward the background
(+420..580, `GJEffectManager::getMixedColor` `0x28475c`) with
`ratio = ((opacity - 0.8) / -0.2 + 1) * 0.3 + 0.7`.

The port implements all of it in `src/gd/invisible.ts` and applies it in
`LevelScene.drawObjects`. **A30** records the one gap: the layer fields
`[0x4b4]`, `[0x30d0]`, `[0x30cc]` and the cocos getter at `0x3ea8e8` are read as
the camera's left edge, half the visible width, the screen centre and the
visible width. Every use seen is consistent with that, but the native capture
that would confirm it is blocked.

**A18 for objects that are not invisible blocks** stays open: `updateVisibility`
+2524 fades ordinary objects at the screen edge through a call that was not
decoded. Re-recorded as A18.

### 7.2 A10 — the motion streak's blend

**Sourced and fixed.** `PlayerObject::updateStreakBlend(bool)` (m1 `0x375668`)
selects the blend pair from a packed constant: `blend` picks
`(GL_SRC_ALPHA, GL_ONE)` — additive — and clear picks
`(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)` — ordinary alpha. The flag lives on the
layer at `[0x32c]`; the only three writers are
`GJBaseGameLayer::togglePlayerStreakBlend` (`0x111b98`), a 2.2 options trigger
(`0x1119cc`, a tri-state at the object's `[0x72c]`: 0 leave, 1 on, 2 off) and a
reset path at `0x1290c4`. It is zero-initialised, and **no trigger in the 22
levels sets it**, so the classic levels draw the trail with plain alpha. The
port drew it additive; changed to `"normal"`. **A10 closed.**

### 7.3 A13 — orb activation waves

**Fixed.** The scene used to find orb activations by diffing `SimState.usedOrbs`
between frames, which a **key-99 multi-activate orb never enters** — so those
orbs showed no wave at all. `SimState` now carries a small `effects` queue (one
entry per orb the sim fired, cleared at the top of every `simStep`, copied by
`cloneSim`/`restoreSim`), and the scene draws from that. This adds no rule to
the sim: it only reports *that* an orb fired, which the scene was previously
guessing.

The drop ring's wave also took white instead of **colour channel 1007**
(`orbWaveColor` returns null for type 32 precisely to say "ask the runtime"),
and now resolves the live channel. **A13 closed.**

### 7.4 A9 — per-type portal and pad particle colours

**Resolved.** Task 2 could not attribute colours to the `createAndAddParticle`
(m1 `0x4eb5ec`) sites that "share their tail with other cases". Interpreting
`GameObject::customSetup`'s switch for every id 1..4699 attributes all **31** of
its call sites to exact ids; the `ccColor4F` vectors loaded right after each call
give the colours. The full table is in `src/gd/effects.ts` above
`OBJECT_PARTICLES`.

Every colour Task 2 had already matches the binary. **Two were missing** and are
added: the inverse-mirror portal (type 14, id 45) `(255,150,0)` and the ball
portal (type 16, id 47) `(255,100,0)`. Sixteen sites set **no** colour at all —
the gamemode portals (10-13, 46), the yellow pad (35), the size portals
(99, 101), the solo portal (287) and the rest — so the plists' own colours,
which the port already uses, are correct rather than approximate.

Three more sites live in `EnhancedGameObject::customSetup` (`0x4fc180` type 29
and `0x4fc460` type 32, both `ringEffect`; `0x4fc574` `fireballEffect`) and two
outside it (`0x4f27b4` `coinEffect`, `0x3219fc`). **A9 closed for the 31
`GameObject` sites**; what remains is A12.

### 7.5 A16 / A17 — slope glow, recorded

**Decoded but not shipped.** `GameObject::addNewSlope01Glow` (m1 `0x4fa674`) and
`addNewSlope02Glow` (`0x4fa8c0`) build a sprite from
**`blockOutline_14new_001.png`** at **−45°** and **`blockOutline_15new_001.png`**
at **−26.5°**, and add it to the object's glow parent `[0x2f0]` unless `[0x289]`
(the no-glow flag) is set. `setupCustomSprites` calls them straight after
`addNewSlope01`/`02`, which build the *same* frame at the *same* angle for the
ordinary batch.

That is the blocker: the port's slope art is a different decomposition — its
`OBJECT_DEFS` frame is `blockOutline_14_001.png` un-rotated, not
`blockOutline_14new` at −45° — so dropping the glow sprite in as described would
sit at an angle the port's slope does not use. Aligning the two needs a native
still of a slope, which is blocked. Both frames ship in `GJ_GameSheet-hd`.
Re-recorded as **A16**.

A17 (whether channel opacity reaches the glow batch) was not re-examined and
stays as recorded.

### 7.6 Task 7 checks

| check | result |
|---|---|
| `npm test` | 364/364 (`tests/invisible.test.ts` 5 new, plus the orb-queue test in `trigger-mechanisms.test.ts`) |
| tsc | clean |
| `scripts/audit.mjs` | 22/22 load clean, missing art 0 of 175 138 |
| harnesses | all eleven PASS |
| perfprobe | L21 x=9000 p50 **12.8 ms** (12.9 before Task 7); L15's invisible-object cluster x=9900/10500 14.4 / 15.2 ms |
| **sweep at beam 256** | **20/22, identical to the baseline** — L17 50.3 % at x=15600, L19 68.3 % at x=22131 |
| **parity** | **20 MATCH, 0 diverge**, L17/L19 without a route at beam 256 as at baseline (run in two halves for memory) |
| captures | `captures/task7-l15-invisible-{before,after,diff}.png` — Electroman Adventures' invisible spikes, drawn solid before and fading now, with the amplified difference. `scripts/invisiblecapture.mjs` takes the pair |

### 7.7 A11 / A12 — re-recorded with what was looked at

`HardStreak::updateStroke` (m1 `0x8da3c`) is a 1 712-byte routine that builds the
wave trail's stroke from `atan2f`/`__sincosf_stret`/`asinhf`/`tanhf` on the
point list — the *shape*, not the colours, which are set through virtual calls
whose arguments were not traced. The port's two passes (half-widths 6 and 2 ×
size, the second white at 0.65) stay as they are. **A11** re-recorded.

`burstEffect` and the swing bursts (**A12**): `PlayerObject::init` +2568..2772
creates all three of them and keeps them on the player —
`burstEffect.plist` at `[0x888]`, `burstEffect2.plist` at `[0x890]` and
`dashEffect.plist` at `[0x898]`, each `setPositionType(1)` and added to the
player's effect node `[0x688]`. What is still undecoded is what *fires* them,
which lives wherever those three fields are read. The swing appears only in Dash
and the dash orb belongs to Task 13, so this is re-recorded rather than chased.

## 8. Physics, measured against 21 real runs

The 21 `.gdr.json` recordings in `macros-main/` are xdBot captures of the real
game at 240 fps: every button event, and a `frameFixes` entry per frame holding
the real `PlayerObject`'s x and y. That is a per-frame ground truth for the
whole game, and four scripts read it:

| script | what it answers |
|---|---|
| `scripts/macro-compare.mjs` | replays the recorded *inputs* through our sim and diffs position per frame (`--resync` re-seeds at each divergence so one fault does not cascade) |
| `scripts/macro-geometry.mjs` | pushes the recorded *positions* through our collision world, with no port physics at all — isolates block placement from movement |
| `scripts/macro-physics.mjs` | second differences of the recorded y, bucketed by mode/input/gravity/branch, over long constant-acceleration runs |
| `scripts/macro-hitbox.mjs` | bisects the largest player half-size that still clears each hazard the real run clears |

Splitting geometry from physics settled the first question immediately: the
recorded paths pass through our collision world cleanly on 18 of 21 levels, so
block placement was not the problem and every fault below is movement.

Divergence events (`--resync --tol=2`, all 21 runs) went **660 → 313** across
this section, deaths on a recorded run's own inputs from 17 sites to 3, and the
beam sweep from 20/22 levels to **22/22**.

### 8.1 `m_yVelocity` is rounded to three decimals every step

`PlayerObject::updateJump` snaps the velocity after every acceleration
(`fcvtzs`/`frinta` block, 2.2081 arm64 `+0x53c` and again in the UFO and swing
branches): `trunc(v) + frinta(frac(v) * 1000) / 1000`, i.e. round to the nearest
multiple of 0.001 raw, ties away from zero. `quantizeVelocity` in `gd/physics.ts`.

**This is not a rounding detail, it is where the constants come from.** Because
the velocity is always a multiple of 0.001, a gravity step of
`0.958199 * 0.225 = 0.2155948` lands on 0.216 *every single time* — so the cube's
real acceleration is `0.216 * 12960 = 2799.36 u/s²`, not `0.958199 * 2916 =
2794.11`. A long-baseline fit over 44,281 free-fall arcs in the macros gives
−2799.360 (p25 −2799.365, p75 −2799.357), which pins it to six figures.

Every gamemode's multiplier goes through the same snap, and each lands somewhere
its unrounded value does not. Measured against the recordings, per step, raw:

| mode | measured | unrounded | mode | measured | unrounded |
|---|---|---|---|---|---|
| cube | 0.216 | 0.215595 | ship free slow | 0.069 | 0.068990 |
| ship free fast | 0.103 | 0.103486 | ship hold slow | 0.108 | 0.107797 |
| ship hold fast | 0.086 | 0.086238 | ship mini free fast | 0.122 | 0.121748 |
| UFO slow | 0.086 | 0.086238 | UFO fast | 0.129 | 0.129357 |
| UFO mini slow | 0.101 | 0.101456 | UFO mini fast | 0.152 | 0.152185 |
| ball | 0.129 | 0.129357 | robot | 0.194 | 0.194025 |

So the integrator takes the **unrounded** `RAW_GRAVITY` and lets the snap produce
the number you measure. Pre-rounding the constant gets the cube right and every
other gamemode wrong.

### 8.2 The speed setting changes gravity and the jump, not just the scroll rate

`PlayerObject::updateSpeedVariables` (`m1 0x374e30`) branches on `m_playerSpeed`
and writes **three** doubles — `m_xVelocity` (+0x780), the jump velocity (+0x788)
and `m_gravity` (+0x790). 3x and 4x share a row.

| speed | `m_playerSpeed` | xVel | gravity | jump | world speed |
|---|---|---|---|---|---|
| 0.5x | 0.7 | 5.980002 | 0.940199 | 10.620032 | 251.16 |
| 1x | 0.9 | 5.770002 | 0.958199 | 11.180032 | 311.58 |
| 2x | 1.1 | 5.870002 | 0.957199 | 11.420032 | 387.42 |
| 3x | 1.3 | 6.000002 | 0.961199 | 11.230032 | 468.00 |
| 4x | 1.6 | 6.000002 | 0.961199 | 11.230032 | 576.00 |

`xVel * m_playerSpeed * 60` reproduces `SPEEDS` exactly for all five rows, which
is the cross-check that the row order is right. Shipped as `SPEED_PHYSICS` and
`speedConstants()`; every gamemode step now reads its gravity and jump from the
run's current speed.

Both halves of the table are confirmed against the recordings. The cube's
measured per-step acceleration, snapped, reads 0.212 at 0.5x, 0.216 at 1x,
0.215 at 2x and 0.216 at 3x — the four distinct gravity rows, each exactly what
`round3(gravity * 0.225)` predicts, and the reason a single gravity constant
could never fit all four.

The jump half is measurable too. The robot's take-off is half the cube's
jump, and 21 recorded robot take-offs at 2x read **308.342** against our constant
301.860 — which is `0.5 * 11.420032 * 54`, snapped, exactly. 3x reads 303.208,
which is `0.5 * 11.230032 * 54` snapped. Both fell out of the table with nothing
tuned.

### 8.3 The ship and UFO brake a *fast climb* — they do not test for falling

Both read

```
slow = m_isUpsideDown ? m_yVelocity > -2 * m_gravity
                      : m_yVelocity <  2 * m_gravity
```

(`updateJump` +0x40c for the ship, +0xf2c for the UFO), which in our sign
convention is `yVel * gravitySign < RISE_THRESHOLD`. A ship dropping at 500 u/s
and one climbing at 50 u/s take the **same** branch; only a climb past
`2 * m_gravity * 54 = 103.4855 u/s` takes the other. The macros bracket the real
threshold to [103.4656, 103.5169), which contains it.

Reading it as `yVel * g <= 0` was the port's largest single physics fault: it
gave a rising ship 1.2x gravity from the first frame after release instead of
0.8x, and cost a held ship its 0.5 thrust the moment it started to climb. Ship
faults 131 → 72, UFO 58 → 26.

The four multipliers themselves were already right: free is `0.4 * gravity`
times 0.8 or 1.2; hold is `gravity` times 0.5 (slow) or 0.4 (fast); both divided
by `m_vehicleSize`, which is 0.85 for a mini ship/UFO — read at +0x9a0 in the
same block, alongside the ±8.0/−6.4 velocity clamps.

### 8.4 The position is a float, and the error does not average out

`PlayerObject` is a cocos2d node, so `setPosition` stores **float32**. At
x ≈ 28000 one ulp is 0.00195, and a step of 1.29825 lands on 0.001953125 × 665
over and over — so the real run runs measurably *ahead* of exact arithmetic
(311.5975 u/s measured over 101 long baselines, against the true 311.58).
Accumulating in double left us ~12 units behind by the end of a long level,
which moved every trigger, portal and ledge exit after it.

`advanceX`/`advanceY` in `gd/physics.ts` do the rounding (the y form adds the
game's 90-unit floor offset back first, so the rounding happens at the magnitude
the game rounds at). With this in, a ship's flight matches the recording to
**zero** in both axes, frame after frame.

### 8.5 `checkSnapJumpToObject` — the cube's landing snap

`m1 0x382fbc`, called from `collidedWithObjectInternal` (+0x2a8 and +0x4ac)
straight after the landing `setPosition`, and **only for the cube**: the call is
guarded by `!isShip && !isBall && !isBird && !isDart && !isSwing && !isRobot &&
!isSpider` (the flags at +0x969..+0x96e).

When you land on a block that sits one "rhythm unit" from the block you landed
on last, the game slides you up to one unit (two at 2x and 3x) toward the x you
held on the previous block:

```
target = object.x + m_snapDifference            // +0x800
if (|target - player.x| > max) target = player.x ± max
setPosition(target, player.y)
m_lastGroundObject = object                     // +0x838
m_snapDifference   = player.x - object.x
```

The rhythm is per speed — `dx` paired with `dy` measured along the player's own
up, tolerance `max`:

| `m_playerSpeed` | (dx, dy) accepted | mini dx₁ | max |
|---|---|---|---|
| 0.7 | (90, +30) (120, −30) (60, +60) | 90 | 1 |
| 0.9 | (120, +30) (150, −30) (90, +60) | 90 | 1 |
| 1.1 | (150, +30) (195, −30) (120, +60) | 90 | 2 |
| 1.3 | (180, +30) (225, −30) (135, +60) | 90 | 2 |
| 1.6 | (120, +30) (150, −30) (90, +60) | 120 | 1 |

Shipped as `gd/snapjump.ts`. Without it every landing in a jump chain drifted a
unit, and by the sixth we were a full 6 units behind the real run — which then
moved every trigger and ledge exit after it. Cube faults 290 → 164.

Two details that cost a lot before they were right:

* The snap reads the **object's** position, not the hitbox's. 15 of the 435
  hitbox entries sit off-centre, and reading the hitbox centre turned a (150, 30)
  rhythm into (150, 38) and silently dropped the snap. `Collider.ox`/`oy` keep
  the offset so the object position can be recovered.
* `CCRect::intersectsRect` counts exact touching, so a player that lands
  straddling a seam collides with **both** blocks and the snap runs twice; our
  resolver stops at the first, because once it has lifted the player onto the
  surface the second only touches. The sim now runs the snap over every block
  under the resolved player.

One choice here is measured rather than read: the order those blocks are visited
in. The original's section iteration is not the level's object order, and over
the 21 runs reverse order costs 378 divergences against 440 for forward order
and 398 for right-to-left. Revisit if the section build order gets decoded.

### 8.6 The robot's float is 68 frames, not 67

`[0x7f8] < 1.5` accumulating `dt * 0.1` is 67 steps read literally, but the
charge block (`updateJump` +0xb14) is skipped when `[0x94c]` — the flag the jump
raises — is set, so the budget only starts running on the frame *after* the
take-off. The jump frame needs no cancellation anyway, since the jump overwrites
the velocity.

It is one frame, and it is the difference between the 2x robot run in level 19
being flyable and not: one step short leaves the arc 10.5 u/s slow by the time
the float gives out. Recorded floats read 67 frames nine times and 68 twice —
the cap sits within a frame of the boundary either way — but 68 is what the
`[0x94c]` guard says and it is what puts the section back through.

### 8.7 `ringJump` runs at the top of the step, not from the collision pass

The orb the player is standing on is not the orb that fires. `checkCollisions`
only records it — `_touchedRingObject` — and `ringJump` runs from `updateJump`
at the top of the **next** step, before the player moves.

Firing it from the collision pass instead, at the end of the step that touched
the ring, costs a frame, because a press that arrives for frame F is not visible
until the top of F + 1: the ring then fired at the end of F + 1 and the velocity
only reached a position on F + 2. In level 18 the real run presses at frame 1573,
the game's blue orb flips at 1574 and ours flipped at 1575 — 2.5 units of a
600 u/s flip, which was enough to clip a solid the real run passes.

`SimState.touchedOrb` is the recorded ring and `fireTouchedOrb` is the jump. It
is cleared at the top of every collision pass, like `nowTouching`: without that
a press made long after leaving a ring still fires it from across the level, and
the run gets *worse*, not better (672 divergences against 387). Cube faults
164 → 107, ball 66 → 53, and level 19 stopped needing a wider beam.

### 8.8 The snap is search state

`scripts/beam.mjs` keys candidates so near-identical ones collapse. The landing
snap breaks that assumption twice over: it slides x, so two candidates at the
same frame are no longer at the same x, and `m_lastGroundObject` decides whether
the *next* landing snaps at all. `snapKey()` puts both in the key. Without it the
beam collapsed a snapped candidate into an unsnapped one and kept whichever came
first — levels 11, 19 and 21 each lost a whole section to it, and the sweep read
18/22 with physics that was strictly better than the 20/22 it replaced.

### 8.9 The inner box is a rect, on both axes

The one place the original tests the player's inner box
(`getObjectRect(0.3, 0.3)`, at the tail of `collidedWithObjectInternal`)
intersects it as a rect. The port tested only the *vertical* overlap inside the
landing branch, on the reading that the landing check aligns the inner box to
the block's x — and that turned a deep landing on a block's near edge into a
death. In Polargeist the real run drops onto the block at (15053, 45) with its
underside 11 units past the top and 0.7 units of horizontal overlap, and the
game lifts it onto the block; we killed it, because 11 units is just past where
a vertical-only test starts matching.

Running into a block's side is still fatal, and for the original's reason: the
landing branch needs the player's underside to have reached the block's *top*,
which a player level with a wall never satisfies, so it falls through to the
two-axis test and dies once it has penetrated far enough. Death sites on the
recorded inputs went from seven to three.

### 8.10 The wave's hitbox is measured now, not asserted

`macro-hitbox.mjs` asks, for every frame of all 21 runs, how large the player's
hazard box could be and still clear every hazard that run cleared. Seven modes
come back at or above 1.0 — cube 1.004, ball 1.100, spider 1.748 — which is the
cross-check that a full-size box is right for them and that the ship/UFO/swing
0.7 factors were correctly deleted.

The wave comes back at **0.340**: a full-size wave sits deep inside `id 61` in
level 18 at frame 11847, a hazard the real run flies straight past. The port
shipped 0.35, which is *above* its own evidence. It now ships 0.25, and the gap
between 0.25 and the 0.340 bound is the part that is still a workaround —
level 17's dual wave corridor is impassable at 0.34 (50.3 %), gets a little
further at 0.30 (51.0 %) and goes through at 0.25, because our slope handling
makes that corridor narrower than it is. The target is still 1.0 with a correct
slope model; 0.340 is the number to justify against until then.

### 8.11 A wider beam is not a better beam

`prune` spreads survivors across the live gamemodes and then across the sorted
frontier, so widening the beam changes *which* near-identical candidates survive,
not just how many. Measured on this tree: 256 completes 21 levels and misses 19;
512 completes 21 and misses 21 instead. Neither number says anything about the
physics — a level that goes through at any width has a route.

`sweep.mjs` therefore retries a short level at double the width before calling
it short, and reports the width it needed (`--retry=0` turns that off). That is
what makes "22 / 22 complete" a statement about the game rather than about the
search budget.

### 8.12 Where it stands, and what is left

* **22 / 22 complete in the sweep**, up from 20/22. Level 17 had been short
  since before any of this work; level 19 needs beam 512 and says so.
* 313 divergence events over the 21 runs, down from 660. Level 1 is down to 2
  faults, level 2 to 2, levels 4 and 8 to 3; the long, many-gamemode levels
  (15, 16, 18-21) still carry most of the rest.
* Three death sites left when a whole recorded run is replayed with no re-sync,
  down from seven: level 6 (`id 8`, a spike, after an arc that has already
  drifted 20+ units), level 13 (`id 187`, a round hazard our position matches
  to zero — so it is the hitbox, not the movement) and level 20 (`id 421`, in a
  ship section, and the reported position is nowhere near any `id 421` in the
  level, so the death itself needs instrumenting).
* Not chased here: Rotate Gameplay (id 2900, which Dash needs and which makes
  level 22's recording unreadable to our tooling), whether key-135 (`m_isHide`)
  objects collide, and the slope model behind level 17's wave workaround.

## 9. Against the running game

The 2.2081 build itself, driven from this session: Geode with the Eclipse menu,
**Noclip** and **Show Hitboxes** on, screenshots taken with `screencapture` and
input posted as CoreGraphics events (`scratchpad/click.py` — System Events'
`click at` moves the cursor but its clicks never reach the GL view, which is why
the ImGui menu would highlight a row and not toggle it).

Tooling: `scripts/compare-shot.mjs` stitches captures into one sheet in headless
Chromium, because this machine has no ImageMagick, PIL or sharp. `?debug=1`
draws our colliders, so ours and theirs can be read side by side.

### 9.1 What it confirms

* **The tick rate.** Eclipse's Physics Bypass reads **240.00 TPS** — the rate
  `sim.ts` steps at.
* **The player's two boxes.** The real game draws the outer box and an inner one
  at **0.32 of its width** — the 0.3 `getObjectRect(0.3, 0.3)` inner rect that
  `PLAYER_INNER_HALF` encodes, measured off the screen rather than inferred.
* **Spike hitboxes.** Normalised against the player box as a 30-unit ruler, a
  ground spike's box is **8.9 units wide in the real game against 8.7 in ours**,
  one per 30-unit cell in both, at the same offsets.
* **Geometry and colour.** Level 1 compared at its opening, 26 %, 46 %, 56 %,
  66 % and 76 %: block layout, platform heights, spike rows, the hanging blocks,
  and the blue → purple → pink → red colour progression all line up.

### 9.2 Playing the macros back **in the real game**

Eclipse's bot reads the same `.gdr.json` files in `macros-main/`. Dropped into
`geode/mods/eclipse.eclipse-menu/replays/`, all 21 appear in its Replays list
and play back frame for frame — "Replay Stereo Madness.gdr loaded with N
inputs". That removes the blind spot below entirely: the real player now flies
the ship sections instead of sliding along the floor under noclip, so its camera
and ours are looking at the same thing and every gamemode can be compared.

Two things about driving the menu are worth recording, because neither is
obvious and both cost an hour:

* System Events' `click at` moves the cursor and the ImGui row even highlights,
  but the click never reaches the GL view. Real CoreGraphics events do.
* ImGui's **modal dialogs** drop a 60 ms press outright. The button has to be
  hovered for ~0.45 s and held down for ~0.35 s — several frames each — or
  "Yes" simply never fires. `scratchpad/click.py` does this by default now.

The level select always opens on level 1, and its arrow buttons need ~0.75 s
between clicks or GD's scroll animation swallows them; clicking faster silently
lands you on the wrong level, which invalidated a whole first pass.

### 9.3 What this method cannot compare, and why

**Ship sections, under noclip only.** Noclip pins the real player to the floor,
so its camera sits at ground level for the whole run while ours uses the
gamemode's camera band. Past level 1's 85.8 % ship portal the two frames stop
resembling each other entirely — not because the level differs but because the
cameras are looking at different heights. Every section that read as a mismatch
was a ship section; every cube section matched. **§9.2 is the fix**: with the
macro played back instead, the real ship flies its real path and the comparison
holds everywhere.

**Particles.** `shot-at.mjs` teleports the player and draws one frame, so it has
no accumulated trail. The white specks trailing the real player are its live
ground drag; their absence in a static render says nothing.

**Percentages past a ship portal.** The percentage label is the only position
index the running game offers, and it is reliable exactly where the cameras
agree. At the level opening it pins our length to 26,712 against the computed
26,724 — a 0.04 % check on `levelLength`.

### 9.4 What it found

**Four object ids in the 22 levels have no definition at all.** Neither OpenGD's
`object.json` nor the toolbox frame dump maps them, so `OBJECT_DEFS` has no
entry and the port draws nothing:

| id | instances | levels | where |
|---|---|---|---|
| 221 | 181 | 15, 16, 17, 18 | y 315..573 |
| 104 | 102 | 11, 12, 15, 17, 18 | y 405..525 |
| 717 | 13 | 17 | y 435..539 |
| 718 | 5 | 17, 18 | y 345..435 |

301 instances in all. Every one sits at y 315..573 — eleven to nineteen blocks
up, above the play area — so they are decoration and nothing about them touches
collision. They are missing art all the same, and the asset audit does not catch
them because the audit checks that every *mapped* frame exists, not that every
id in a level is mapped. Decoding them means reading `GameObject::createWithKey`
for those four cases out of the binary.

**Dash's gradient decoration draws opaque.** At 7.5 % the port puts large solid
blue discs (`d_ball_01_001.png`, id 50, x7) and white rectangles
(`d_gradient_c_02_001.png`, the four mirrored children of id 1888, x7) across
the screen; the real frame at the same place has neither — they read there as
soft tint over the background, if they read at all. Whatever the cause (channel
resolution or blend mode), these are being drawn as opaque bright shapes and
should not be. It is the most visible rendering difference this pass found, and
it is confined to decoration.

**Rotate Gameplay is still the one that changes play.** Level 22's first pair of
id-2900 triggers is at 8.9 %/9.4 %, and the real game keeps rendering upright
through them — the trigger turns the *gameplay axis*, not the picture. Before
9 % our frame and the game's show the same section; after it they have nothing
in common. See §8.12.

**Level 13's death site is drift, not a hitbox error.** Playing the Electroman
Adventures macro back in the real game and lining it up frame for frame at
76.84 % — where §8.12 had our replay dying on `id 187`, a round hazard — puts
the saw's drawn hitbox at the same fraction of its sprite as ours (0.68 of the
star's width in both). Pushing all 21 runs' recorded positions through our
collision world confirms it: **zero** hazard hits in every level but Dash, under
the existing player-rect-against-hazard-circle rule. So the death comes from our
replay being a unit or two off by that frame, not from the rule. Testing a
circle-against-circle rule does make the death go away — and that is exactly why
it was not adopted: it would have hidden the drift behind a more forgiving
hitbox.

### 9.5 The independent length check

The macros settle what the screenshots cannot. Level 1's recording is 20,571
frames — 85.71 s at 240 fps — ending at x = 26,774, and walking our own speed
table forward with no input reaches the end trigger at 84.81 s. The level's
length, the speed portals and the tick rate therefore agree with a real run to
better than a second over a minute and a half.

## Phase 3 list — shipped as APPROXIMATION under constraint 2

| # | where | what | why / where the search stopped |
|---|---|---|---|
| A1 | `scenes/levelEndView.ts` | circle-wave ring thickness drawn as 4 HD px (2 units) | cocos `glLineWidth(4)` is framebuffer pixels, so the original's thickness is display-dependent |
| A2 | `gd/endSequence.ts` | light-strip angles: evenly spread and shuffled, no extra jitter | `playEffect` +692..784 adds a small random term per pick that was not decoded |
| A3 | `ui/endLevelMenu.ts` | the practice hint's line spacing is bigFont's own line height | `TextArea` internals (`MultilineBitmapFont`) not decoded |
| A4 | `ui/alertLayer.ts` | `<cX>` tag colours are the widely published values | `readColorInfo` `0x3ed558` parses the tags; the tag→colour table was not found (no packed-RGB immediates for these values in `__text`) |
| A5 | `ui/alertLayer.ts` | alert text lines centred, 20 apart, runs laid end to end | `TextArea`/`MultilineBitmapFont` layout not decoded beyond `lineHeight 20` |
| A6 | `scenes/levelEndView.ts` | the ghost trail copies the vehicle's main sprite only | `GhostTrailEffect` snapshots `m_iconSprite`; which layers that includes per mode was not checked |
| A7 | `scenes/playLevel.ts` | the pull's camera settle starts from the port's lerped camera | the original's camera has no lerp; the settle's start point differs by whatever lag the lerp carried |
| A8 | `gd/effects.ts` | emitter offsets applied in world space, mirrored with gravity | `setPosition` converts through the `[0x550]` node, whose transform (rotation with the icon?) was not decoded |
| A9 | ~~`gd/effects.ts`~~ | **CLOSED, Task 7 §7.4.** All 31 `createAndAddParticle` sites in `GameObject::customSetup` are attributed to exact ids; sixteen set no colour at all (so the plists' own colours were already right) and the two that were missing are added |
| A10 | ~~`scenes/playLevel.ts`~~ | **CLOSED, Task 7 §7.2.** `updateStreakBlend` (`0x375668`) decoded: the trail is ordinary alpha unless the layer's `[0x32c]` flag is set, and nothing in the 22 levels sets it |
| A11 | `gd/effects.ts` `WaveTrail` | wave trail pass widths read as half-widths 6 and 2, colour 1 then white; no music pulse | `HardStreak::updateStroke` colours per pass and `m_pulseSize` not decoded |
| A12 | `gd/effects.ts` | swing bursts, `dashEffect`, `burstEffect` not wired | their emission conditions were not decoded; the swing is only in L22 and the dash orb is Task 10 |
| A13 | ~~`scenes/playLevel.ts`~~ | **CLOSED, Task 7 §7.3.** `SimState.effects` reports every orb the sim fires, and the drop ring's wave resolves channel 1007. The 22 levels hold 23 drop rings and no key-99 orb, so the visible half is the colour |
| A14 | `gd/effects.ts` | the ground drag's angle/gravity are mirrored under flipped gravity | the original's `[0x550]` node flip (not decoded) presumably does this |
| A15 | ~~`scenes/levelScene.ts`~~ | **CLOSED, Task 7 §7.1.** `updateInvisibleBlock` (`0xa5820`) decoded and shipped in `gd/invisible.ts` — the fade, the glow's separate ramp, the screen-edge cap and the colour mix. What is left is A30 |
| A16 | `gd/glow.ts` | slopes have no glow | `setupCustomSprites` builds it through `addNewSlope01Glow`/`02Glow`, not decoded |
| A17 | `scenes/levelScene.ts` | a glow follows its object's group alpha and toggle (the `DrawItem` path); channel opacity does not touch it | the binary routes `setOpacity` (edge fade) to the glow and group × channel opacity into the colour record `[0x448]+8` (`updateMainOpacity` `0x4f9b5c`); whether that record also reaches the glow batch was not checked |
| A18 | `scenes/levelScene.ts` | no screen-edge fade for objects **other than** the four invisible ones — those now fade (§7.1) | `PlayLayer::updateVisibility`'s fade call for ordinary objects (+2524) is still not decoded |
| A19 | ~~`gd/triggers.ts`~~ | **CLOSED, Task 6 §6.4.** `playerTouchedTrigger` (`0x1009c8`) decodes to exactly the rule the port already had: re-arm only for a multi trigger (key 87) whose contact record has gone. It was an approximation in name only |
| A20 | ~~`gd/triggers.ts`~~ | **CLOSED, Task 6 §6.2.** The collectibles are collected, the item is fed and the counter label is drawn. One number remains unsourced — see A27 |
| A21 | ~~`gd/triggers.ts`~~ | **CLOSED, Task 6 §6.3.** Target mode is implemented from the `EffectGameObject` key names and `getGroupCenter` (`0x33fa4`); what stays undecoded is dynamic mode (key 397, absent from all 22 levels) |
| A22 | `gd/objectAnim.ts` | the spin direction, the animation start offset and the frame-time jitter come from `hash01(objectIndex, salt)`, not `rand()` | the original draws them at load, so two runs of the *original* do not agree either; a deterministic hash is what makes a port replay reproducible |
| A23 | `gd/objectAnim.ts` | the 30 % "delayed loop" branch is not modelled — every animated instance gets the random start offset | `customSetup` +464..508 gives 30 % of them `m_animationStart = -1` and `[0x558] = 1` instead; what `updateSyncedAnimation` then does with `[0x560]`/`[0x54c]` was not decoded |
| A24 | `scenes/levelScene.ts` | a frame name the atlas does not have holds the previous frame | four of `d_animWave_01`'s ten frames (004, 005, 009, 010) are simply not in the shipped sheet, and the same for `d_animWave_01b`, `smallCoin_01` and `fireball_02_004`. `addGameAnimation` stores the name regardless, and what `setDisplayFrame` does with a cache miss was not decoded |
| A25 | `scenes/levelScene.ts` | the six `AnimatedGameObject` ids (918, 919, 1327, 1328, 1584, 2012 — 790 instances) draw as one static sprite, so Fingerdash's 15 animate triggers have nothing to drive | their animation is the `*_AnimDesc.plist` + `CCAnimatedSprite` + `CCSpritePart` stack; building it is a task of its own, not Task 5 |
| A26 | `scenes/levelScene.ts` | an object waiting on an animate trigger holds frame 1 and stays visible | `waitForAnimationTrigger` +24..36 also calls vtable +0x380 with 0, which was not identified (plausibly `setVisible(false)`) |
| A27 | `game/sim.ts` | a collectible with no key 77 adds **1** | `m_pickupCount` (+0x72c) is zero-initialised and Fingerdash's eleven collectibles carry no key 77, yet its instant-count triggers compare item 1 against 1, 2, 3, 4, 6, 8 and 10 — the default is inferred from the level's own ladder, not read out of the binary. Presentation: item 1 is read by nothing but the counter panel (§4.2) |
| A28 | `gd/triggers.ts` | the area move (3006, L22 ×3) still does nothing | the keys are now named (`EnterEffectObject`, §6.5) but the geometry — how length, offset and the distance to the centre group become a per-object offset — lives in `EnterEffectInstance::loadTransitions` (`0x4ff57c`) and is not decoded. It moves solids and hazards, so constraint 2 forbids guessing it |
| A29 | `scenes/levelScene.ts` | the counter label (1615) draws after every sprite rather than inside its own z layer | one label in the 22 levels, on a decoration panel with nothing in front of it |
| A30 | `gd/invisible.ts` | three layer fields and one cocos getter are read as the camera's left edge (`[0x4b4]`), half the visible width (`[0x30d0]`), the screen centre (`[0x30cc]`) and the visible width (`0x3ea8e8`) | every use seen is consistent with that reading, but the native capture that would confirm it is blocked (§5.6) |
| A31 | `scenes/playLevel.ts` | in Rotate Gameplay (Dash) the camera keeps the normal 75-unit lead along the direction of travel and follows the player on both axes | `updateCamera` (m1 0x124838) switches its offset fields on `m_isSideways`/`m_isGoingLeft` (+0x298..0x3a4, fields `[0x2a4]`/`[0x2ac]`); that path is not decoded. Physics in rotated gameplay is sourced (ROADMAP §2.4) — this is the camera only |
| A32 | `game/sim.ts` `killHeightFor` | the player dies a screen (320) above the level's tallest object, never below 1290 | no height constant in 2.2 `checkCollisions` (m1 0xfe188); Dash's native run is alive at y 2807, so the 2.1-era fixed 1290 was wrong |
| A33 | `scripts/gen-hitboxes.mjs` | linked teleport 2902 uses 747's 25×90 box | same `TeleportPortalObject` class; the hitbox table has no row for 2902 |
| A34 | `gd/interactives.ts` `teleportExit`, `dashSlope` | the +180 both add when an unidentified virtual (vtable 0x580) on the object returns true is never applied | Dash's only static-force portal and angled dash orb both match native without it |
| A35 | `game/sim.ts` `rotateGameplay` | leaving a sideways section turns the free-fly band off until the next gamemode portal | inferred from Dash f6873; `GJBaseGameLayer::rotateGameplay` does not touch the bounds |
| A36 | `game/sim.ts` `followStaticCamera` | a y-only Camera Static (1914, key 101 = 2) eases the free-fly band centre onto its target group over the trigger's duration/easing; zoom (1913) and offset (1916) do not touch the band | 2.2 `checkCollisions` (m1 0xfe36c) takes the bounds from the camera view (centre ± half height / zoom, floor ≥ 90) when a camera mode is active; the selecting flag and zoom term are not decoded. Fits Dash's only out-of-band native stretch; both-axis statics were tried and clamp the ball where native is free |
| A37 | `scenes/playLevel.ts`, `game/sim.ts` | a 2.2 End trigger (3600) ends the level in place (no portal pull, no camera settle), and the progress bar still divides by the last object's x (Dash reads ~91% at its End trigger) | the lock frame is sourced (Dash f21714) and the real player stays still after it; the End trigger's options and whether `m_levelLength` uses its x are not decoded |
| A38 | `game/sim.ts` `forceBlocksOf`, `gd/gamemodes.ts` `addForce` | force blocks push along world up only, never rotated or relative, and not at all for ship/UFO/wave/swing | the 13 in the main levels (all Dash) are unrotated and absolute; the cube and robot numbers are matched to the native run, the other modes have no evidence |
| A39 | `game/sim.ts` `easeShipRotation` | the ship's sprite-angle easing uses dt = 1 frame per 240 Hz substep while the wave's uses the substep's 0.25 (each matches its native runs; together they contradict one decoded formula), and the turned box is only used against tilted objects | the formula is decoded (m1 0x382970/0x37a590); which dt the caller passes, and whether untilted hazards use the turned box, are not — the substep dt is too slow for Hexagon Force f20740 |
| A40 | `game/sim.ts` dual ground/ceiling, `scenes/playLevel.ts` ground bars | the grounds jump straight to the band edges when a dual or a flying mode starts | `updateDualGround`/`changeGameMode` tween them over a duration (`instant`, `duration` args); the tween itself is not decoded |
| A41 | `gd/camera.ts` `setLevelHeightCap` | with Dynamic Level Height (kA37) the camera's height cap is the highest object + one view | the setting is read (`LevelSettingsObject` +0x1c5, editor text "the same way as max length"); how the game grows the cap is not decoded |
| A42 | `game/nativeSlope.ts` slope-routine inputs | `m_isBoosted` (+0x9cc) is taken as "airborne and rising ≥ 2×gravity"; moving slopes are treated as static (`m_lastPosition` = position); rotated (sideways) gameplay keeps the old `resolveSlope` | set by jump/pad/ring/`boostPlayer`, cleared in `updateJump` once the rise drops (m1 0x3777cc) — the exact clear is not decoded; the sideways path (`handleRotatedCollisionInternal`) is not transcribed |
| A43 | `scenes/playLevel.ts` camera rotate (2015) | positive degrees turn the drawn world clockwise about the view centre, and the background turns with it | `updateScreenRotation` (m1 0x120af4) is decoded (target/add key 70/convert key 394, eased); how `updateCamera` applies [+0x324] to the layers is not — needs a native Dash capture |
| A44 | `scenes/levelScene.ts` gradient layers (2903) | blending 2/3 (multiply/invert, key 174) drawn as normal; vertex mode (key 207) drawn as edge mode; screen-space layers (BG/MG/G/UI/Max) use the world view rect; the trigger's HSV (keys 43/44) and the P layer's exact slot (between B1 and T1) not modelled | `updateGradientLayers` (m1 0x10e7c0) and `triggerGradientCommand` (0x10e12c) are decoded; the renderer has only normal/additive blending, and Dash uses 207/43/44 nowhere |
| A45 | `engine/renderer.ts` screen shaders | the colour pass (2919–2923) covers the whole world view; the shader setup trigger's z-layer range (2904 keys 196/197) is not applied, and the lens circle's origin is player 1 (key 138) or else the view centre (a group target is not followed), unrotated, and its additive flag is off; chromatic (2910) converts design points to UV by the view size (the game's own factors [+0x478]/[+0x200] are not identified); the distortion shaders (shock wave/line, glitch, chromatic glitch, pixelate, radial/motion blur, bulge, pinch, split screen) are inert | the colour pass GLSL and the key → value mapping are from the binary (`ShaderLayer` fragment source, `triggerShaderCommand` m1 0x10f8e4, `pre*Shader`); the layer-range render targets are not decoded |
| A46 | `game/sim.ts` covered block faces | every slope is offered to `collidedWithSlope` before any block is resolved, so a block's potential-slope scan sees slopes the game would only reach after that block in `m_uniqueID` order; the grown rect (`getObjectRect(1.2, 1.1)`) is taken as scaled about the slope's centre | the scan itself is transcribed (m1 0x37fd98–0x37ff88, `slopeCoveredFaces`); the port's slope and block passes are separate, not interleaved |
| A47 | `game/sim.ts` `testedBefore` | the collision pass's y-sections are taken as on for every level and bucketed by level-file y; the game sizes them only when a level-settings flag (+0x155/+0x1c5, read by m1 0xe17ac) is set, and which key that is has not been mapped | section sizes (0.01 both ways) and the walk order from m1 0xeb400, 0x128800, 0xfea44; replay-neutral outside Dash |
| A48 | *(retired 2026-09-28 by BUGS PHY-96: decoded — portals act before every block of the pass)* | | |
| A49 | `gd/interactives.ts` size portal 99 | a grounded mini UFO or robot whose block the collision pass reaches before the portal is lifted to its new size on the next pass; mini cube/ship are lifted on the portal frame regardless | fitted to five native crossings (ToE f3285, f11491, f16051; Electrodynamix f7032; Geometrical Dominator f21705); `togglePlayerScale` (m1 0x3884b0) does not move the player, and the source of the cube/ship lift is not found |
| A50 | `game/sim.ts` tilted speed portals | a tilted speed portal (200–203, 1334) is met by the player's rect taken in the portal's own frame (as if turned with it); every other tilted interactive keeps the oriented test | fitted to Deadlocked f8959 (portal 201 at 53°: native touches two steps after the oriented test); applying it to all tilted interactives costs Hexagon Force f8023 and Deadlocked f1745/f7240 |
| A51 | `engine/audio.ts` `musicPeak`, `scenes/playLevel.ts` pulse | the metered pulse (songs without an audio string: Dash) reads the music alone, down-mixed, over the last ~21 ms, before its volume; FMOD meters the whole output (sound effects too), averages the two channels' peaks and is read once per engine update; the pulse is stepped once per rendered frame; in practice the pulse is held at 0.5 without the `[PlayLayer+0x3059]` exception | the state machine, the audio-string layer, the id table and the scale rules are decoded (m1 0x35dd20, 0x4119a8, 0x411a64, 0xa4d8c–0xa5454, 0x16e5dc; `customSetup` emulated) |
| A52 | `game/sim.ts` interactive pass box | after a wave turns into another mode mid-pass, the rest of the pass meets gamemode/size portals, pads and orbs with the new mode's 30 × scale box but speed portals with the pass's starting (wave) box | two native captures (ToE 2 f20491, Geometrical Dominator f19315) and two replays (Deadlocked f4292, f18785); the speed-portal exception is fitted, not decoded |
| A53 | `game/sim.ts` stick to ground | the post-collision stick uses the 5·dt tolerance only (not 10·dt when [0xb08] is set or 20·dt for [0x514] objects), treats "last ground was a moving block" as the [0x650] gate for the moving-block fallback, and is skipped in sideways play | the stick and `testForMoving` are decoded (m1 0x37cea4–0x37d0f8, 0x37dde4); the flags' meanings are not |
| A54 | `gd/camera.ts` vertical follow | the 70/40 deadzone never swaps with gravity, in any mode | native Dash (425 samples, incl. a flipped cube f634 and a ceiling spider x 1007–1250) and Stereo Madness are matched to the unit with no swap; `updateCamera` (m1 0x124d58) exchanges the pair by `m_isUpsideDown` (+0x96f) on its `isInBasicMode` path, so some state not yet decoded undoes it |
| A55 | `scenes/levelScene.ts` custom particles (2065) | a system exists while its object is within 90 units of the view; finite-duration systems without animate-on-trigger (8 in Dash, keys 107 or none) stay stopped — the 20 with key 123 burst on their Animate trigger (`updateSyncedAnimation` m1 0x16d1bc → `resetSystem`); a free/relative system's emission angle is turned by the object's rotation directly; group rotation/scale, channel HSV and `dynamicRotationIsDir`/respawn (7 and 2 in Dash) are ignored; drawn after their z layer's objects | the string, the engine rules, quick start and the colour/blend rules are decoded (m1 0x44e1b4, 0x44f0d8, 0x6cdaa0, 0x6ce94c, 0x52aa70, 0x16c244, 0x16c6e0) |
| A56 | `scenes/levelScene.ts` animated monsters (GJBeast01–05) | the default animation runs on level time from the attempt's start (the game starts it when the object activates); the eye (`_03`) rides on the head part; glows additive in the detail colour | the parts, their per-frame transforms and the default animations are the game's (`objectDefinitions.plist`, `GJBeast0N_AnimDesc.plist`) |
| A57 | `scenes/playLevel.ts` camera through a Rotate Gameplay turn | during the ~0.5 s screen rotation the port switches the camera rule at once; reversed (leftward) play keeps the port's own off-axis follow | the sideways rule is native (BUGS BUG-29, `captures-2026-10-03/dash-side.txt`); the same log shows the native x tweening with the rotation (gap 105 → 56 over steps 5700–5800, accelerating), not yet modelled; the full-run log (`dash-full.txt`) puts the remaining error in the turns and the spinning, reversing ball stretch (steps 6400–7400, up to 100 units) |
| A58 | `scenes/playLevel.ts` chromatic glitch (2911) uniforms | the per-frame scale factors (`ShaderLayer` +0x474, +0x47c) and the texture scale (+0x200/+0x204) are taken as 1; `_cGYOffset` is the camera's height in screens | every formula is from `preChromaticGlitchShader` (m1 0x34fffc..0x350218) and the GLSL is the game's own; the 2.2 playthrough (Dash 40 %) shows a wider RGB split than the port's (~2–3×), consistent with one of those factors being above 1 |
| A59 | `scenes/levelScene.ts` middle ground x phase | the MG layer's x scrolls at the MG speed 0.3 from an origin following the background's convention | scale, y placement, base offsets and speeds are decoded (`updateCameraBGArt` m1 0x12a93c..0x12ab58, `defaultYOffsetForBG2`, `updateMGArtSpeed`); the incremental x update and its `scaleGround` width correction are not reproduced exactly |
| A60 | `scenes/playLevel.ts` radial blur (2914) centre and only-empty | the blur centres on the screen and the only-empty flag stays off | value and fade are decoded (`preRadialBlurShader` m1 0x350b9c); the centre comes from the trigger's target/screen offset (+0x344/+0x348, fields 0x11/0x12) through the common shader setup, not yet decoded, and the level key for +0x76a is not identified |
| A61 | `scenes/playLevel.ts` bulge (2916) | the per-frame scale (+0x474) and the global float at 0x1008b8660 are taken as 1 (so |v| = √0.5) and the origin as the screen centre | the formulas are the common shader setup's (m1 0x34e238..0x34e4fc); the global's runtime value and the target/offset centring are not read |
| A62 | `scenes/playLevel.ts` shock line (2907) | scale factors (+0x474, texture scale) taken as 1; the off-screen cull and target/follow centring left out | the clock, edges, waves, strength and the no-target centre (m1 0x34d8d4) are decoded |
| A63 | `scenes/levelScene.ts` custom enter effects (3020/3021) | the distance is measured into the view from its right (enter side) or left edge | m1 0xa5aa0 takes the enter side's edge from a global (0x1008bb30c) and the exit side's from the layer (+0x4b4); Dash's −150 offset then leaves its channel-4 objects unfaded to the edge, which the 2.2 playthrough (70 %) shows |
| A64 | `scenes/levelScene.ts` area tint (3010) | the area value is used linearly (no `getEasedAreaValue` easing) and the tint eases in over the trigger's duration | the mix, deadzone, inbound flip and centre rules are decoded (m1 0x116a18, 0x117708, 0x114e94) |
