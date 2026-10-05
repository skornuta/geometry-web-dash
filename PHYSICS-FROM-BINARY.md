# Physics read straight out of the shipping game binary (session 6)

**This supersedes every "unsourced / approximation / guess" note in PORT-PROGRESS.md for the
items listed below.** The source is not a decompile — it is the machine code of the game the
repo owner has installed.

## The pipeline (reproduce this before trusting anything here)

- Binary: `~/Library/Application Support/Steam/steamapps/common/Geometry Dash/Geometry Dash.app/Contents/MacOS/Geometry Dash`
  Universal Mach-O, `arm64` slice at fat offset **11026432**, `__TEXT` vmaddr `0x100000000`,
  fileoff 0 — so **geode address `A` sits at file offset `A` inside the extracted slice** and at
  vmaddr `0x100000000 + A`.
- **The build is 2.2081, NOT 2.208.** `Info.plist` says `CFBundleShortVersionString = 2.208`, and
  that is a lie for our purposes: the 2.208 geode addresses land mid-function, the **2.2081** ones
  land exactly at function starts. Verified on four independent functions
  (`updateJump`, `ringJump`, `propellPlayer`, `hitGround` — all `<+0>`). Check this first if the
  user ever updates the game.
- Address DB: `~/projects/gd-physics-reader/build/_deps/bindings-src/bindings/2.2081/GeometryDash.bro`
  (geode bindings, already on disk). Use the `m1 0x…` column.
- The binary is **stripped** (581 symbols, all imports) so `nm` is useless. `lldb` still recovers
  function boundaries from `LC_FUNCTION_STARTS`, which is what makes the `<+0>` check possible.
- Scripts live in the session scratchpad; recreate them with the recipe in "Tooling" below.

## Field offsets — pinned from the binary, not from a header

Do **not** trust a computed struct layout. `Geode/binding_arm/PlayerObject.hpp` walked naively
drifts (unknown-size members: `geode::SeedValueRSV`, `gd::map`, `gd::unordered_set`), and it drifts
*differently* in different regions — anchoring on one field gives wrong answers 0x100 later.

Anchors read directly out of tiny functions, all mutually consistent:

| field | offset | how it was pinned |
|---|---|---|
| `m_yVelocity` (double) | **0x950** | `getYVelocity()` is literally `ldr d0, [x0, #0x950]; ret` |
| `m_isShip` | **0x969** | `isInNormalMode()` reads these six then returns `!m_isSpider` |
| `m_isBird` | **0x96a** | ” |
| `m_isBall` | **0x96b** | ” |
| `m_isDart` (wave) | **0x96c** | ” |
| `m_isRobot` | **0x96d** | ” (and `isInBasicMode()` skips exactly this one — basic = cube+robot) |
| `m_isSpider` | **0x96e** | ” |
| `m_isUpsideDown` | **0x96f** | `playerIsFalling(f)` = `m_isUpsideDown ? yVel > -f : yVel < f` |
| `m_isOnGround` | **0x971** | consecutive after `m_isDead` 0x970 |
| `m_isSwing` | **0x974** | `isInNormalMode()` — the 4th test |
| `m_isSideways` | 0x973 | consecutive |
| `m_isOnSlope` / `m_wasOnSlope` | 0x960 / 0x961 | consecutive, used by the slope boost |
| `m_slopeVelocity` (float) | **0x964** | read by the slope boost |
| `m_vehicleSize` (float) | **0x9a0** | compared `!= 1.0` to select every mini multiplier |
| `m_playerSpeed` (float) | **0x9a4** | ” |
| `m_gravityMod` (float) | **0x b1c** | `gravity * m_gravityMod` when `!= 1.0` |
| `m_isDashing` | 0x994 | |

**Note the `1000.0` idiom.** Almost every `m_yVelocity` write is followed by
`fsub / fmul 1000 / frinta / fdiv 1000 / fadd`. That is a **round-to-3-decimals** on the
fractional part, not physics. Ignore it when porting; it is anti-desync quantisation.

## CONFIRMED — the port already had these right

Reading these out was worth it anyway, because it proves the unit conversion in `physics.ts` is
sound rather than a lucky fit.

- **gravity `0.9581990242004395`** as a float32 — exactly the documented 0.958199.
- **mini jump multiplier `0.8`** (`m_vehicleSize != 1.0 ? 0.8 : 1.0`).
- **mini *flying* size `0.85`** — a separate constant from the 0.8, selected only for
  ship / bird / dart / swing.
- **ship velocity clamps `+8.0 / size` and `-6.4 / size`**, exactly as `clampShip` has them.
- **UFO impulse `size * (mini ? 8.0 : 7.0)`**, applied only when it increases upward velocity.
- **terminal velocity ±15.0 raw** (= ±810 world), clamped after the gravity add.
- **ball gravity multiplier 0.6**, **spider gravity multiplier 0.6**.

## CORRECTIONS — things the port has wrong

### 1. The swing is NOT a ship. (`gamemodes.ts` flew it with ship constants.)

From the `m_isSwing` branch of `updateJump` (+716):

```
if (m_isSwing) {
    if (<queued press flag @0x936> && <button held>) {
        clear the press flag
        float pre = (float) m_yVelocity;      // captured BEFORE the flip
        flipGravity(this, !m_isUpsideDown, true);   // call to 0x37b40c == PlayerObject::flipGravity
        m_yVelocity = pre * 0.8;              // overwrites flipGravity's /2
    }
    // fall/rise: constant gravity toward current down
    float mult = (m_vehicleSize != 1.0) ? 0.6 : 0.4;
    m_yVelocity += mult * (0.958199 * m_gravityMod) * dt * (m_isUpsideDown ? +1 : -1);
}
```

So a swing tap **flips gravity and keeps 0.8 of the entering speed**; between taps it is plain
constant-gravity freefall at **0.4** (normal) / **0.6** (mini) of base gravity. There is no thrust,
no hold, no ship accel curve. The `0.8` assignment lands *after* `flipGravity`, so the usual
halving is overwritten — the same ordering trap already documented for the green orb.

`flipGravity` was identified by address: geode 2.2081 lists
`PlayerObject::flipGravity(bool, bool) = m1 0x37b40c`, and the branch calls `0x10037b40c`.

### 2. NOT a correction — a trap. The `0.5` slope boost in `updateJump` is the UFO's.

Recorded because it looks like a correction and is not. **Do not "fix" `applySlopeBoost` to 0.5.**

`updateJump` contains **exactly one** slope-boost block (+1796) — one `m_wasOnSlope` read, one
`m_slopeVelocity` read, one `1.4`:

```
if (m_wasOnSlope || m_isOnSlope) {
    float sv = m_slopeVelocity;
    if (sv > 0.0) {                            // uphill only  — matches ours
        double threshold = m_yVelocity * 1.4;  // of the base jump — matches ours
        m_yVelocity += sv * 0.5;
        if (m_yVelocity > threshold) m_yVelocity = threshold;
    }
}
```

The `0.5` and the missing time-ramp look like they contradict `gamemodes.ts`
(`0.25` × `clamp(slopeTime*10, 0.4, 1)`) — **but this block is only reachable from the
`m_isBird` flap path** (+664 `b.gt +1744` → +1792 → +1796). It is the UFO's slope boost, not the
cube's. The cube/ball boost is not in `updateJump` at all, so geode's inline
`getModifiedSlopeYVel` remains the right source for it and the existing 0.25 stands.

Confirmed correct either way: the **uphill-only gate** and the **1.4x cap**.

If the UFO's boost is ever modelled separately, 0.5-flat is the number.

## Independent cross-check: boomlings.dev

**https://boomlings.dev/reference/player_physics/gamemodes** — a community physics reference no
earlier session found (surfaced via Exa search). Fetch it with `WebFetch`, not Jina Reader (this
network's ASN is blocked anonymously by r.jina.ai).

It agrees with the binary on the things it was checked against, which is real corroboration
because the two sources are completely independent:

- **"Swingcopter Click: multiplies the y-velocity by 0.8 then toggles the gravity"** — the session-6
  swing fix, confirmed. (The binary settles the ordering the prose leaves ambiguous: the
  `m_yVelocity = pre * 0.8` store happens *after* the `flipGravity` call, so the net factor is
  **0.8**, not 0.8-then-halved.)
- **"Ball Click: sets `yvel` to 3.354G then toggles the gravity"** — this is exactly what
  `stepBall` already computes: `11.18 / 2 (the flip's halving) * 0.6 = 3.354`. The ball's
  jump→flip→×0.6 ordering documented in session 3 is **confirmed correct to 4 significant figures**.
- **Cube click `11.18G`** — matches `JUMP_VELOCITY`.
- Ship `8G` hold / `-6.4G` release, cube/ball/robot/spider max `-15G` — all match the binary.

**Treat it as a cross-check, never as a primary source.** It is internally inconsistent: the
gamemode table and the search summary give the cube's jump as `11.18G` and `10.62G` in different
places, and the wave's `5.193G` is `5.770002 × 0.9`, i.e. quoted *after* the `dtSlow` scaling that
the cube's number is quoted *before*. Where it and the binary disagree, the binary wins.

### Lead on the robot (L20's blocker) — NOT implemented, needs the binary to confirm

boomlings lists **"Robot Hold: sets `yvel` to 5.59G"**, with `Ticks Held: 1` and "can click midair:
No". `5.59` is exactly **half** the cube's `11.18`. Our `stepCube(robot=true)` gives the robot a
**full** cube jump plus a guessed reduced-gravity hold window.

If that is right, the robot's model is "half-height initial jump, extended by holding" rather than
"full jump with a soft gravity window" — a different shape, not a different constant, which would
explain why `ROBOT_HOLD_MAX` / `ROBOT_GRAVITY_MULT` never tuned to anything satisfying. **Do not
implement from this alone** — L20 already lost 10 points to one unverified change. Decode the
`m_isRobot` branch of `updateJump` (`+236` and `+3668`) and the robot hold timer first.

### 3. The cube/robot jump lives at `updateJump+5256..+5388`, not where earlier sessions looked

Worth writing down because two dead ends cost real time: the ground jump is **not** in
`pushButton` (that only sets the two input flags) and **not** in `hitGround` (that only zeroes
`m_yVelocity`, sets `m_isOnGround` and picks a landing sound from the fall speed: raw
14 / 8 / 4 / 1 -> 450 / 300 / 150 particles). It is inside `updateJump`.

**`updateJump` is bigger than it first measures.** The first `ret` is at `+4428`, but the function
branches to `+5256`, `+5296` and `+5304` — dump at least 6000 bytes or you will silently truncate
it, which is what made the jump look absent.

The tail, decoded:

```
s1 = <base jump>                       // [this+0x788], see the open question below
if (m_isRobot) s1 *= 0.5;              // +2724
if (!<was on ground>) s1 = 9999.0;     // +2744, the "no ground under you" sentinel
...
w8 = [this+0xad4];                     // a per-jump counter
if (w8 >= 1) s1 *= (1.0 - 0.3 * w8);   // +5288 fmadd — decays with the counter
[this+0xad4] = w8 + 1;                 // +5296
s3 = m_isUpsideDown ? -1.0 : 1.0;
m_yVelocity = s0 * s1 * s3;            // s0 = mini ? 0.8 : 1.0, computed at +356
// then the slope-boost block (m_wasOnSlope || m_isOnSlope, uphill only)
```

### 4. Robot: two constants proved, the charge mechanic still open

Traced by following the cube/robot path through the mode dispatch — it takes
`+236 -> +1716 -> +320 -> +1684 -> +2192`, and critically **`w10` is loaded with `m_isRobot` at
+236 and is not reassigned anywhere on that path** (the `w10` reloads at +584 / +716 are on the
bird and swing branches, which cube/robot never enters). So both `w10` tests below are robot tests:

- **robot gravity multiplier = `0.9`.** `+2236`: `s9 = m_isSpider ? 0.6 : (m_isRobot ? 0.9 : 1.0)`.
  `s9` is the multiplier applied to gravity in the integration at `+3016`. Cube is **1.0**.
- **robot jump velocity = base x `0.5`.** `+2724`: `s1 = m_isRobot ? base * 0.5 : base`.

**Independently corroborated:** boomlings.dev lists *"Robot Hold: sets `yvel` to 5.59G"*, and
`5.59` is exactly `11.18 / 2`. Two unrelated sources, same number.

**DO NOT ship the half-jump on its own.** A robot with half the jump and 0.9 gravity and no charge
is strictly weaker than a full cube jump, and L20 is already blocked on a robot section — that
alone would make it worse. All three pieces ship together or none do.

### ~~Hypothesis: the charge is the `(1.0 - 0.3 * n)` decay~~ — DISPROVED, do not revive

An earlier version of this section proposed that the robot's charge was the `(1.0 - 0.3 * n)`
decay on the counter at `[this+0xad4]` (`+5256..+5300`), on the strength of the arithmetic
coincidence that `1 + 0.7 + 0.4 + 0.1 = 2.2` and `5.59 x 2.2 = 12.3`, just above a cube's `11.18`.

**That is wrong.** The decay is gated at `+2756` by `w8 = w12 & w11`, and `w11` was *reassigned* to
`m_isDashing` back at `+2332`. It is the **dash orb's** repeat-fire decay, not the robot's. The
coincidence was a coincidence. This is recorded rather than deleted because the arithmetic is
seductive enough to be re-derived by the next reader.

### The charge, decoded (`+2860..+2940`)

```c
while (jumping && held && ![0x94c] && [0x7f8] < 1.5) {
  [0x7f8] += dt * 0.1;
  yVel    += s9 * g * dt * sign;      // s9 = the 0.9 robot gravity multiplier
}
// and the ordinary step at +2992:
yVel -= s9 * g * dt * sign;
```

Same magnitude, opposite sign: holding **cancels gravity exactly**, it does not merely reduce it.
The robot coasts at take-off speed until the timer expires. The window is
`1.5 / 0.1 = 15` binary-dt units = `15/54 s` = **0.2778 s**, using the same `54` that converts raw
velocity to world units in `physics.ts`.

Also pinned on this path: `+236` reads `w11 = m_isRobot ? ([0x936] & [0x935]) : [0x935]`, and
`pushButton` writes `strh 0x101` to `0x935` (setting held *and* queued together) while the ground
jump clears `0x936` at `+2660`. So the robot needs a **fresh press per jump** — holding the button
through a landing does not re-jump.

Shipped in `gamemodes.ts` as `ROBOT_JUMP_MULT 0.5`, `ROBOT_GRAVITY_MULT 0.9`,
`ROBOT_HOLD_MAX (1.5 / 0.1) / 54`. Still untraced: `[0x94c]`, which aborts the charge (nothing has
been found writing it), so whether a mid-air re-press resumes the float is unmodelled.

### Where the charge is *armed* — the portal enters it spent (session 8)

`[0x7f8]` has exactly three accesses, and the two in `updateJump` are only two thirds of the story:

| site | instruction | meaning |
|---|---|---|
| `updateJump+2668` | `str xzr, [x19, #0x7f8]` | the robot's **own ground jump** zeroes it — full float |
| `updateJump+2860/+2900` | `ldr d0` / `str d0` | the accumulate, above (note `d0`: it is a **double**) |
| `toggleRobotMode+384/+388` | `mov x8, #0x3ff8000000000000; str x8, [x19, #0x7f8]` | entering robot sets it to **1.5** |

`0x3ff8000000000000` is the double `1.5` — *exactly* the cap the charge is tested against. So a
robot that arrives through a portal fails `[0x7f8] < 1.5` on its first frame and **cannot float
until it jumps for itself**. The charge is armed by the jump, not by the portal.

Finding `toggleRobotMode` at all is worth writing down: `PlayerObject::switchedToMode`
(m1 `0x388338`) is a pure dispatcher that stores nothing itself — it calls one helper per mode.
The robot's is `m1 0x38d95c`, identifiable because it is the one that writes `m_isRobot` at
`0x96d` (`+56  strb w1, [x0, #0x96d]`).

Checked the other way as well: **no mode helper writes `0x9cc`** (the `jumping` flag). Grepping all
eight helpers reached from the dispatcher for `#0x9cc` returns nothing, so `jumping` deliberately
survives a portal and the spent charge is what stops the float on its own. Both halves are modelled
in `setGamemode`, and the asymmetry is the point — do not "tidy" it by clearing `jumping` too.

This was found by chasing a real defect: `holdTime` and `jumping` both rode through a portal
untouched, so a robot that jumped, left its section mid-arc and re-entered later kept whatever
float it had left — or, if it had spent it, arrived unable to float at all. The binary answers
both cases with the same store.

**Open question blocking all of this:** whether `[this+0x788]` is `m_yStart` (the 11.180032 jump
velocity). The naive struct walk says `0x780 = m_yStart`, `0x788 = m_gravity`, but that map is
known to drift and `0x788` is used here as a *jump* magnitude. Pin it the same way the other
offsets were pinned — from a small function that touches only that field — before trusting it.

## STILL NOT DECODED (next session starts here)

`updateJump` spans `0x3766e8 .. 0x377838` (4432 bytes, ~1108 instructions). Decoded so far: the
setup, ship/UFO/swing, terminal clamp, the slope boost. Not yet decoded:

- ~~the robot's charge mechanic~~ — **done.** Gravity 0.9, jump x0.5 and the `+2860..+2940` charge
  are all decoded and shipped; see "The charge, decoded" above. Only `[0x94c]` is still untraced.
- **the dash orbs** (`m_isDashing` @0x994 is read at +2332) — still an approximation.
- **`ringJump`** (m1 `0x38991c`) — orb table, incl. the dash and teleport orbs.
- **`propellPlayer`** (m1 `0x38fcac`) — pads; the pink pad 0.6 is still a guess.
- **`collidedWithSlopeInternal`** — the documented "rising slower than the surface" defect.
- **the substep model** — how many times per frame the player is integrated, and with what dt.

An unidentified `0.9` multiplier sits at +2208 selected by a flag that has not been traced; it may
be the robot's. A `0.05` at +3384 gates clearing `m_isOnGround` against `now - m_lastLandTime`,
which looks like a landing grace window we do not model.

## Tooling (recreate in the scratchpad)

```sh
# extract the arm64 slice once
dd if="<GD binary>" of=gd_arm64 bs=1 skip=11026432 count=9996432

# disassemble a geode m1 address
lldb --batch -o "target create --arch arm64 gd_arm64" \
     -o "disassemble --start-address $((0x100000000+ADDR)) --end-address $((0x100000000+ADDR+LEN))"
```

`<+0>` on the first line means the address matches this build. If it says `<+2808>`, the bindings
version is wrong — try a different `bindings/2.20xx` directory.
