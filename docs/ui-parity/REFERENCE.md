# UI parity — native reference measurements

Durable evidence for [UI-PARITY-PLAN.md](../../UI-PARITY-PLAN.md). Everything below is read out
of the **installed 2.2081 arm64 binary**, not from a screenshot, a decompile, or memory. Each
section names the function and offset it came from so it can be re-derived.

Nothing here is a guess. Where a value is *not* sourced it says so in bold.

---

## 1. Build identification and tooling

| item | value |
|---|---|
| Binary | `~/Library/Application Support/Steam/steamapps/common/Geometry Dash/Geometry Dash.app/Contents/MacOS/Geometry Dash` |
| Fat header | 2 slices; **arm64 at file offset 11026432, size 9996432** — re-read on 2026-09-09, unchanged from `PHYSICS-FROM-BINARY.md` |
| Address DB | `~/projects/gd-physics-reader/build/_deps/bindings-src/bindings/2.2081/` — `GeometryDash.bro`, `Cocos2d.bro` |
| Confirmation | `MenuLayer::init` m1 `0x316688` disassembles at `<+0>`, so the 2.2081 column still matches this install |

### Recreate the tooling (scratchpad)

```sh
# 1. extract the arm64 slice
python3 - <<'PY'
src="<GD binary>"; dst="gd_arm64"
f=open(src,'rb'); f.seek(11026432); open(dst,'wb').write(f.read(9996432))
PY

# 2. raw disassembly of a geode m1 address
lldb --batch -o "target create --arch arm64 gd_arm64" \
     -o "disassemble --start-address $((0x100000000+ADDR)) --end-address $((0x100000000+ADDR+LEN))"
```

Raw lldb output is nearly unreadable for UI code, because every sprite name is an `adrp`/`add`
pair and every `addChild`/`setPosition` is a vtable call. The session used a small annotator
(`annot.py`) that post-processes the lldb text and adds three things:

1. `bl <addr>` → the geode name for that address (all four `.bro` files merged).
2. `adrp x0, N` + `add x0, x0, #imm` → resolves the pointer and prints the **C string** at it, so
   sprite frame names appear inline.
3. `ldr x8, [x19]` + `ldr x8, [x8, #imm]` → resolves the slot against a **known vtable address**,
   so `addChild` / `setPosition` / `setScale` are named instead of appearing as `blr x8`.

A companion `vtable.py` finds the vtable holding a given virtual (scan `__DATA_CONST.__const` for
the 8-byte pointer) and dumps its slots against the bindings. **MenuLayer's vtable pointer is
`0x1008360b0`** (the pointer to `MenuLayer::init` sits at `0x100836100`, i.e. slot `+0x50`).

Useful slots on that vtable, used throughout this document:

| slot | method |
|---|---|
| `+0xa0` | `CCNode::setScale(float)` |
| `+0xb8` | `CCNode::setPosition(const CCPoint&)` |
| `+0xc0` | `CCNode::getPosition()` |
| `+0x1b8` / `+0x1c0` / `+0x1c8` | `CCNode::addChild(node)` / `(node, z)` / `(node, z, tag)` |
| `+0x420` / `+0x430` | `CCLayer::setKeypadEnabled` / `setKeyboardEnabled` |

---

## 2. Native screen captures — **available since 2026-09-10** (see §19)

> Screen Recording was granted to **Visual Studio Code**, the app that actually hosts this session
> (not Terminal), and `screencapture -l <windowID>` now captures the game window. The text below is
> the original blocker, kept for history. Clicking inside the game still needs the separate
> **Accessibility** permission, which VS Code does not have.

### Original blocker (2026-09-09)

`screencapture -x` fails with `could not create image from display`: this terminal process has no
macOS **Screen Recording** TCC permission, and the permission cannot be granted from inside the
sandbox. Geometry Dash was also not running when checked (`pgrep -lf "Geometry Dash"` empty).

Consequences, recorded so this is not rediscovered:

- Every geometry value in this file is **sourced from the binary**, which is a stronger source than
  a screenshot for positions, scales and z-order. Task 0's decode requirement is met.
- What a native capture would add is **rasterisation and animation verification** only: font
  rendering, exact art tier, and settled-animation appearance.
- Screens implemented from this file are therefore **implemented, not visually verified**, exactly
  as the plan's handoff protocol requires them to be marked.

To unblock visual verification, the repo owner needs to either grant Screen Recording to the
terminal (System Settings → Privacy & Security → Screen Recording) and re-run, or capture the
native main menu manually and drop the PNG in `docs/ui-parity/reference/`. Suggested filename:
`main-menu-settled-<w>x<h>.png`, plus a `main-menu-pressed-play-<w>x<h>.png` for the press state.

---

## 3. Coordinate frame used by every UI layer

`CCDirector::getWinSize()` (m1 `0x3e9668`) returns the **design resolution** size, which is the
same 480×320 / FIXED_HEIGHT-FIXED_WIDTH policy the port already implements in
`src/gd/camera.ts:resolveView`. A 16:9 window therefore reports 569×320.

Four accessors are used constantly by menu code and are trivially small functions:

| function | m1 | body |
|---|---|---|
| `CCDirector::getScreenTop()` | `0x3ea8d0` | `ldr s0, [x0, #0x50]; ret` |
| `CCDirector::getScreenBottom()` | `0x3ea8d8` | `ldr s0, [x0, #0x54]; ret` |
| `CCDirector::getScreenLeft()` | `0x3ea8e0` | `ldr s0, [x0, #0x58]; ret` |
| `CCDirector::getScreenRight()` | `0x3ea8e8` | `ldr s0, [x0, #0x5c]; ret` |

They are written in one place, `CCDirector::updateContentScale`-alike at m1 `0x3e9674 +148`:

```
ldp  s1, s2, [sp, #0x8]     ; the CCSize from getWinSize()
str  s2, [x19, #0x50]       ; screenTop    = winSize.height
str  s1, [x19, #0x5c]       ; screenRight  = winSize.width
stp  wzr, wzr, [x19, #0x54] ; screenBottom = 0 ; screenLeft = 0
```

**So on desktop (no safe-area inset) these are exactly `height`, `0`, `0`, `width`.** They are not
an extra layout concept the port has to model; they are kept in the formulas below only because
that is how the original writes them.

UI origin is the **bottom-left of the win size**, +Y up. The port draws UI with the origin at the
**view centre**, so the conversion for every position in this document is:

```
port_x = gd_x - winW / 2
port_y = gd_y - winH / 2
```

This is a *UI-local* conversion. It has nothing to do with `gd_y = our_y + 90`, which applies to
gameplay world heights only. Do not subtract 90 from a menu position.

---

## 4. `CCMenuItemSpriteExtra` — the button behaviour every screen shares

Sourced from the constructor (m1 `0x49240`), `init` (`0x2190f4`), `selected` (`0x2193d4`),
`unselected` (`0x219620`), and `CCMenu::itemForTouch(CCTouch*, bool)` (`0x69ce24`).

### Field offsets, pinned from the code that uses them

| offset | field | default |
|---|---|---|
| `0x174` | **touch-rect multiplier** (what `setSizeMult` writes) | 0 (unset) |
| `0x190` | press scale multiplier | ctor 1.0, then `init` sets **1.26** |
| `0x194` | base scale | ctor 0.0, then `init` sets **1.0** |
| `0x198` | `m_animationEnabled` | ctor false, `init` sets **true** |
| `0x199` | `m_colorEnabled` | **false** |
| `0x19c` | `m_volume` | 1.0 |
| `0x1a0` / `0x1b8` | `m_activateSound` / `m_selectSound` (24-byte `gd::string`) | empty |
| `0x1d0` | `m_colorDip` | `0x3f48c8c9` = **0.78431** (= 200/255) |
| `0x1d4` | `m_offset` (CCPoint) | (0,0) |
| `0x1dc` | `m_duration` | **0.3** |
| `0x1e0` | `m_unselectedDuration` | **0.4** |
| `0x1e4` | `m_animationType` | **0** (Scale) |
| `0x1e8` | `m_startPosition` | (0,0) |

> **Trap — a geode naming mismatch, verified against the code.** `GeometryDash.bro` lists
> `setSizeMult` (m1 `0x219278`) next to a field it calls `m_scaleMultiplier`, which invites the
> reading that it changes the *press scale*. It does not. `0x219278` is `str s0, [x0, #0x174]; ret`,
> and a whole-`__text` scan for float loads/stores of offset `0x174` finds **exactly one reader**:
> `CCMenu::itemForTouch +420`. `setSizeMult` grows the **click area**, not the animation.
> The press scale multiplier is `0x190`, which nothing but `init` ever writes, so it is 1.26 for
> every button in `MenuLayer`.

### Hit rectangle

`CCMenuItem::rect()` (m1 `0x3406cc`) is four loads and two `fmsub`s:

```
rect.origin = m_obPosition - m_obContentSize * m_obAnchorPoint
rect.size   = m_obContentSize
```

in the **parent menu's** node space, with **no scale applied** — so the animated press scale never
changes where the button can be clicked.

`CCMenuItemSpriteExtra::init +104..+212` sets that content size from the sprite:

```
contentSize = normalImage.getContentSize() * (normalImage.scaleX, normalImage.scaleY)
normalImage.anchorPoint = (0.5, 0.5)
```

A `CCSprite` built from a trimmed atlas frame reports the **untrimmed** `spriteSourceSize` as its
content size, so the hit box is the full original art box, not the packed rect.

`CCMenu::itemForTouch(touch, useSizeMult) +420` then inflates it about its centre:

```
float mult = item->[0x174];
if (mult > 1.0f) {
    rect.origin -= rect.size * (mult - 1) * 0.5;
    rect.size   *= mult;
}
return rect.containsPoint(menu->convertToNodeSpace(touchLocation));
```

Items are walked in the menu's child order and the **first** hit wins.

### Press / release animation — the values Task 0 asked for

```
selected():                              unselected():
  CCMenuItemSprite::selected()             CCMenuItemSprite::unselected()
  play m_selectSound (none here)           if (m_colorEnabled) image.setColor(white)
  if (m_colorEnabled)                      if (m_animationEnabled) switch (m_animationType) {
      image.setColor(gray(m_colorDip))       case 0: stopActionByTag(0);
  if (m_animationEnabled)                            runAction(EaseBounceOut(
    switch (m_animationType) {                          ScaleTo(0.4, m_baseScale)));
      case 0: stopActionByTag(0);                case 1: image.stopActionByTag(0);
        runAction(EaseBounceOut(                         image.runAction(EaseInOut(
          ScaleTo(0.3, base * 1.26)));                     MoveTo(0.4, m_startPosition), 2.0));
        break;                                 }
      case 1: image.stopActionByTag(0);
        image.runAction(EaseInOut(
          MoveTo(0.3, m_startPosition
                      + m_offset), 1.5));
    }
```

So for every `MenuLayer` button (all of which are default type 0, colour disabled):

| event | target scale | duration | easing |
|---|---|---|---|
| press | `1.0 × 1.26` | **0.3 s** | `CCEaseBounceOut` |
| release | `1.0` | **0.4 s** | `CCEaseBounceOut` |

The scale animates the **menu item**, whose base scale is 1.0; the artwork's own scale (e.g. 0.8
for the social icons) lives on the child sprite and multiplies through.

`CCEaseBounceOut::update` (found through the class vtable at `0x100876b90`, slot `+0x28` →
m1 `0x46d698`) is the stock four-parabola bounce: thresholds `4/11`, `8/11`, `10/11`, factor
`7.5625`, offsets `6/11`, `9/11`, `21/22`. That is **bit-for-bit the `bounce()` already in
`src/gd/easing.ts`** (curve id 9, `BounceOut`), which was read from `GameToolbox::getEasedValue`.
Reuse it; do not write a second bounce.

---

## 5. `MenuLayer::init` — m1 `0x316688`, full composition

Register map for the walkthrough: `x19` = the layer, `x20` = the main `CCMenu`, `x21` = the bottom
`CCMenu`, `x26` = the RobTop/social `CCMenu`, `x22` (from +2492) = the more-games `CCMenu`.

Non-visual prologue (`+44` … `+128`): `CCLayer::init`, `GameManager::fadeInMenuMusic()`, three
`GameManager` flag writes, `setKeypadEnabled(true)`, `setKeyboardEnabled(true)`.

### 5.1 Layer children

| # | node | frame / class | parent | z | position (GD space) | scale |
|---|---|---|---|---|---|---|
| 1 | menu game layer | `MenuGameLayer::create()` | layer | default 0 | (0,0) | 1 |
| 2 | logo | `GJ_logo_001.png` | layer | **2** | `(winW*0.5, screenTop - 50)` | 1 |
| 3 | main menu | `CCMenu::create()` | layer | default 0 | `(winW*0.5, winH*0.5 + 10)` | 1 |
| 4 | garage "new" flag | `GJ_chrSel_001.png` | layer | default 0 | `mainMenu.toWorld(garagePos) + (-50,-50)` | 1 |
| 5 | editor "new" flag | `GJ_lvlEdit_001.png` | layer | default 0 | `mainMenu.toWorld(creatorPos) + (50,-50)` | 1 |
| 6 | bottom menu | `CCMenu::create()` | layer | default 0 | `(winW*0.5, screenBottom + 45)` | 1 |
| 7 | social menu | `CCMenu::createWithItem(robtop)` | layer | **2** | `(screenLeft + 50, screenBottom + 25)` | 1 |
| 8 | more-games menu | `CCMenu::createWithItem(moreGames)` | layer | **2** | `(screenRight - 43, screenBottom + 45)` | 1 |
| 9 | profile label | `CCLabelBMFont(" ", "goldFont.fnt")` | layer | **2** | `(45,105) + (2,36)` = `(47,141)` | `limitLabelWidth(70, 0.7, 0)` |
| 10 | view-profile text | `GJ_viewProfileTxt_001.png` | layer | **2** | `(45,105) + (76,-1)` = `(121,104)` | 1 |

`GJ_chrSel_001` is added **only when `GameManager+0x377` is false**, and `GJ_lvlEdit_001` only when
`GameManager+0x378` is false — these are the "you have not opened the garage / editor yet" flags.

### 5.2 Main menu items (`x20`, positions are that menu's node space)

| item | frame | sheet | callback (m1) | position | notes |
|---|---|---|---|---|---|
| Play | `GJ_playBtn_001.png` | **GameSheet04** | `onPlay 0x31799c` | `(0, 0)` (never set) | |
| Garage | `GJ_garageBtn_001.png` | GameSheet03 | `onGarage 0x317a14` | `playPos + (-110, 0)` | |
| Creator | `GJ_creatorBtn_001.png` | GameSheet04 | `onCreator 0x317a88` | `playPos + (110, 0)` | |
| Profile | `GJ_profileButton_001.png` | GameSheet03 | `onMyProfile 0x317eec` | `menu.toNode((45, 105))` | added with **z = 2** |

`GJ_playBtn_001` is in `GJ_GameSheet04`, **not** `GJ_playBtn2` — the plan's warning is confirmed.

### 5.3 Bottom menu items (`x21`)

All four are created with an explicit `setScale(1.0)` and no individual position; the menu is
placed at `(winW*0.5, screenBottom + 45)` and then
**`alignItemsHorizontallyWithPadding(5.0)`** (`+1384`) lays them out.

| order | frame | callback |
|---|---|---|
| 1 | `GJ_achBtn_001.png` | `onAchievements 0x317afc` |
| 2 | `GJ_optionsBtn_001.png` | `onOptions 0x317b48` |
| 3 | `GJ_statsBtn_001.png` | `onStats 0x317b94` |
| 4 | `GJ_ngBtn_001.png` | `onNewgrounds 0x317be0` |

A fifth item, the daily-reward chest, is added to this menu **after** the alignment call
(`+4556`), so it keeps its own explicit position:

| frame | callback | position | sizeMult |
|---|---|---|---|
| `GJ_dailyRewardBtn_001.png` | `onDaily 0x31807c` | `menu.toNode((screenRight - 40, winH*0.5 + 20))` | **1.5** |

### 5.4 Social menu (`x26`) — created around the RobTop logo item

| item | frame | scale | sizeMult | callback | position |
|---|---|---|---|---|---|
| RobTop | `robtoplogo_small.png` | **0.8** | **1.1** | `onRobTop 0x317cb8` | `(0,0)` (menu itself is placed) |
| Facebook | `gj_fbIcon_001.png` | 0.8 | **1.5** | `onFacebook 0x317cdc` | `menu.toNode((screenLeft + 22, screenBottom + 55))` |
| Twitter | `gj_twIcon_001.png` | 0.8 | 1.5 | `onTwitter 0x317d00` | `fb + (29, 0)` |
| YouTube | `gj_ytIcon_001.png` | 0.8 | 1.5 | `onYouTube 0x317d24` | `tw + (29, 0)` |
| Twitch | `gj_twitchIcon_001.png` | 0.8 | 1.5 | `onTwitch 0x317d48` | `yt + (29, 0)` |
| Discord | `gj_discordIcon_001.png` | 0.8 | 1.5 | `onDiscord 0x317d6c` | `yt + (29, -29)` |

Discord hangs off **YouTube**, not Twitch — `+2344` re-reads `x27` (YouTube) rather than the
just-positioned Twitch item.

### 5.5 More-games menu (`x22`) — and the quit button that lives inside it

| item | frame | scale | callback | position |
|---|---|---|---|---|
| More games | `GJ_moreGamesBtn_001.png` | **0.9** | `onMoreGames 0x317d90` | `(0,0)` (menu itself is placed) |
| Quit | `GJ_closeBtn_001.png` | **0.7** | `onQuit 0x317e14` | `menu.toNode((18, screenTop - 18))` |

The close/quit button is parented to the more-games menu but positioned at the **top-left** of the
screen. That is the original's structure, not a mistake to tidy up.

### 5.6 Controller-only block — skipped on a mouse/keyboard desktop

`+2736` calls `PlatformToolbox::isControllerConnected()` and `cbz w0, <+4096>` jumps the **entire**
`+2744 … +4092` range. Everything in it — `controllerBtn_Start_001`, `controllerBtn_Y_001`,
`controllerBtn_X_001`, `controllerBtn_DPad_Down_001`, `controllerBtn_LThumb_001`,
`controllerBtn_A_001`, and the `"Mouse"` / `"Click"` `goldFont.fnt` labels — is controller-only and
correctly absent from a browser port.

### 5.7 Tail

`+4364` … `+4880`: profile-label sizing, `updateUserProfileButton()`, the daily button, then two
scheduled `CCSequence(CCDelayTime(0.01), CCCallFunc(...))` actions for `showTOS` and
`firstNetworkTest`. `0x3c23d70a` = **0.00999999** — a one-frame delay, not a visible animation.

### 5.8 Navigation targets (decoded from the callbacks)

| callback | m1 | destination | side effect before leaving |
|---|---|---|---|
| `onPlay` | `0x31799c` | `LevelSelectLayer::scene(**0**)` | `GameManager+0x29c = 8` |
| `onGarage` | `0x317a14` | `GJGarageLayer::scene()` | `GameManager+0x377 = 1` — clears the `GJ_chrSel` "new" flag |
| `onCreator` | `0x317a88` | `CreatorLayer::scene()` | `GameManager+0x378 = 1` — clears the `GJ_lvlEdit` "new" flag |

All three are structurally identical: an early-out on `MenuLayer+0x1a8` (the "TOS popup is showing"
guard set at `init +4692`), a `GooglePlayManager` delegate detach, `GameManager+0x220 = 0`, the
side effect above, then

```
CCDirector::replaceScene(CCTransitionFade::create(0.5f, <scene>))
```

**The main-menu scene transition is a 0.5 s cross-fade**, identical for all three, taken from the
`fmov s0, #0.5` immediately before each `CCTransitionFade::create`.

`onPlay` always opens level select at **page 0** — the "restore the previously selected level" the
plan mentions applies to returning *from a level*, not to entering from the main menu.

---

## 6. `MenuGameLayer` — the animated background (m1 `0x4527f4`)

| step | offset | detail |
|---|---|---|
| background sprite | `+104` | `CCSprite::create(GameManager::getBGTexture(GameManager+0x3a0))` — a **loose file**, not an atlas frame |
| tex params | `+148` | `setTexParameters` with the repeat/wrap struct at `0x10071d3d0` |
| add | `+164` | `addChild(bg, **-100**)` |
| anchor | `+212` | `setAnchorPoint(0, 0)` |
| scale | `+240` | `setScale(AppDelegate::bgScale())` |
| tint | `+288` | `setColor({0, 102, 255})` — the menu blue |
| tiling | `+336` | texture rect width is **doubled** so the sprite wraps while scrolling |
| ground | `+380` | `GJGroundLayer::create(GameManager+0x3a4, 1)`, `addChild(z = **100**)`, position `(0, **90**)` |
| player | `+556` | `PlayerObject::create(1, 1, nullptr, this, false)`, `addChild(z = **60**)`, position `(0, **105**)` |
| colours | `+680`,`+748` | both from `GameManager::colorForIdx((int)(rand01 * 108))` — **the menu icon's colours are random each time, not the player's saved colours** |

`getBGTexture(i)` (m1 `0x30b79c`) clamps `i` to `[1, 59]` and formats **`game_bg_%02d_001.png`**.
`GameManager+0x3a0` / `+0x3a4` are just "the background / ground currently loaded"
(`loadBackground` `0x30af28` and `loadGround` are their only writers).

`GJGroundLayer::createLine(lineType)` (m1 `0x514eec`) formats **`floorLine_%02d_001.png`**, so
`MenuGameLayer`'s `lineType = 1` gives `floorLine_01_001.png`. `createLine` never calls `setColor`,
so the line is the cocos default white.

### 6.1 The colour cycle — `MenuGameLayer::updateColor` (m1 `0x452fa4`)

Scheduled every **5 s** (`init +944`) and called once directly at the end of `init` (`+964`).

```
switch (m_initCount % 8) {           // m_initCount is at +0x1a0; init increments it once
  case 0: c = {0, 102, 255};         // the menu blue, hardcoded at +472
  case 1: c = colorForIdx(7);   case 2: c = colorForIdx(8);
  case 3: c = colorForIdx(9);   case 4: c = colorForIdx(10);
  case 5: c = colorForIdx(11);  case 6: c = colorForIdx(1);
  case 7: c = colorForIdx(3);
}
m_initCount++;
bg->stopAllActions();      bg->runAction(CCTintTo::create(4.0f, c));
ground->stopAllActions();  ground->runAction(CCTintTo::create(4.0f, c * f));
                           //  f = 0.8 with one ground sprite, 0.6 with two
```

`GameManager::colorForIdx` (m1 `0x307b08`) is a 107-entry jump table over 16-bit offsets at
`0x1007223fe`, each case returning a packed `r | g<<8 | b<<16` in `w0` (with `w0` pre-loaded with
`0x0000ff7d` so a case that only sets the high half still gets `r=125, g=255`). Decoding the whole
table and comparing against the port's `PLAYER_COLORS` shows **indices 0-41 match byte for byte** —
the port's palette is the real one, it just stops at 42 where the binary has 107. The seven the
cycle needs are:

| idx | 1 | 3 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|
| rgb | 0,255,0 | 0,255,255 | 255,0,255 | 255,0,125 | 255,0,0 | 255,125,0 | 255,255,0 |

### 6.2 Scrolling — `MenuGameLayer::update` (m1 `0x4537c8`)

```
m_realBackgroundPosition.x += (dt * 60) * 5.770002f * 0.9f;   // = 311.58 units/s
background->setPosition(wrap(m_realBackgroundPosition * -0.1f, bgWidth));
groundLayer->setPosition(wrap(-m_realBackgroundPosition.x,   groundWidth));
if (player.position.x > winSize.width + 100) resetPlayer();
```

`5.770002 * 0.9 * 60` is exactly the port's documented normal speed, so the **background parallax
is 0.1 and the ground runs at 1.0**. The level scene's `BG_PARALLAX = 0.2` is a separate,
still-unverified guess for gameplay; do not "unify" them.

`AppDelegate::bgScale()` (m1 `0x57c05c`) tail-calls the `CCDirector` accessor at `0x3ea8b8`, which
is `ldr s0, [x0, #0x44]`. `setDesignResolution` (`0x3e9674 +180..196`) writes that pair as
`min` / `max` of `winW/designW` and `winH/designH`, so **`bgScale()` is the larger axis ratio** —
`getScreenScaleFactorMax()` in the bindings' commented-out list.

### 6.3 The decorative cube — `tryJump` (`0x452d2c`) and `resetPlayer` (`0x453188`)

- `tryJump` is scheduled every **0.25 s** (`init +920`). For a cube it draws `rand01` and pushes the
  jump button when the draw is under **0.4** (`0x3ecccccd`; **0.2** while `m_isDestroyingPlayer`),
  with per-gamemode height guards for ship/ball/spider that a cube never takes.
- `resetPlayer` puts the player back at `x = rand01 * 5 * -100 - 100`, i.e. uniformly in
  **[-600, -100]**, gives it a **random mini** (`rand01 > 0.8`) and **two random colours** from
  `colorForIdx(rand01 * 108)` — the menu icon is *not* the player's saved kit.

**Still not sourced:** which cube icon `PlayerObject::create(1, 1, …)` picks for the menu, and
`GJGroundLayer::scaleGround`'s factor. Anything built on those is marked approximate in the port.

---

## 7. Frame metrics measured from the copied atlases

`textureRect` is HD (2× design units); `spriteSourceSize` is the untrimmed box and therefore the
**content size / hit box** (÷2 for design units).

| frame | sheet | rect (hd) | rotated | offset | source (hd) | design content |
|---|---|---|---|---|---|---|
| `GJ_logo_001.png` | LaunchSheet | 852×98 | no | (3,−3) | 858×104 | 429×52 |
| `GJ_playBtn_001.png` | GameSheet04 | 211×209 | no | (4,−5) | 219×219 | 109.5×109.5 |
| `GJ_garageBtn_001.png` | GameSheet03 | 134×134 | no | (3,−3) | 140×140 | 70×70 |
| `GJ_creatorBtn_001.png` | GameSheet04 | 134×134 | no | (3,−3) | 140×140 | 70×70 |
| `GJ_chrSel_001.png` | GameSheet03 | 167×79 | no | (0,0) | 167×79 | 83.5×39.5 |
| `GJ_lvlEdit_001.png` | GameSheet03 | 116×78 | no | (0,0) | 116×78 | 58×39 |
| `GJ_achBtn_001.png` | GameSheet03 | 100×102 | no | (1,−3) | 102×108 | 51×54 |
| `GJ_optionsBtn_001.png` | GameSheet03 | 99×102 | **yes** | (1,−3) | 101×108 | 50.5×54 |
| `GJ_statsBtn_001.png` | GameSheet03 | 99×102 | **yes** | (1,−3) | 101×108 | 50.5×54 |
| `GJ_ngBtn_001.png` | GameSheet03 | 100×102 | **yes** | (1,−3) | 102×108 | 51×54 |
| `robtoplogo_small.png` | GameSheet03 | 200×56 | no | (0,0) | 200×56 | 100×28 |
| `gj_fbIcon_001.png` | GameSheet03 | 63×63 | no | (0,0) | 63×63 | 31.5×31.5 |
| `gj_twIcon_001.png` | GameSheet03 | 62×61 | **yes** | (1,0) | 64×61 | 32×30.5 |
| `gj_ytIcon_001.png` | GameSheet03 | 63×63 | no | (0,0) | 63×63 | 31.5×31.5 |
| `gj_twitchIcon_001.png` | GameSheet03 | 62×61 | **yes** | (1,0) | 64×61 | 32×30.5 |
| `gj_discordIcon_001.png` | GameSheet03 | 62×61 | **yes** | (1,0) | 64×61 | 32×30.5 |
| `GJ_moreGamesBtn_001.png` | GameSheet04 | 165×134 | no | (0,−3) | 165×140 | 82.5×70 |
| `GJ_closeBtn_001.png` | GameSheet03 | 92×93 | **yes** | (0,−1) | 92×95 | 46×47.5 |
| `GJ_profileButton_001.png` | GameSheet03 | 108×110 | no | (1,−3) | 110×116 | 55×58 |
| `GJ_dailyRewardBtn_001.png` | GameSheet03 | 95×84 | no | (1,−4) | 97×92 | 48.5×46 |

Cross-check: the bottom row is `51 + 50.5 + 50.5 + 51` of art plus `3 × 5` of padding = **218**
design units wide, centred — comfortably inside a 569-wide 16:9 view, and it still fits the
480-wide narrow case.

Six of these frames are **rotated in the atlas** and eight are **trimmed**. Both have to be handled
by the shared sprite helper, and the trim offset must be applied in the sprite's own rotated space.

---

## 8. Scope exceptions for the main menu

Project scope is locked to 22 classic levels, menus, icon kit and settings, so several original
main-menu destinations have no implementation. The plan requires their artwork and layout to be
preserved and the action marked as an explicit functional exception, never rerouted somewhere else
and never backed by fabricated state.

| control | native destination | port |
|---|---|---|
| Creator | `CreatorLayer` (editor, online, gauntlets, daily) | **drawn, inert** — out of locked scope |
| Achievements | `AchievementsLayer` | **drawn, inert** — no achievement system |
| Stats | `StatsLayer` | **drawn, inert** — cumulative stats not modelled |
| Newgrounds | opens a URL | **drawn, inert** — no outbound links |
| RobTop / FB / Twitter / YouTube / Twitch / Discord | open URLs | **drawn, inert** |
| More games | `MoreGamesLayer` | **drawn, inert** |
| Profile + view-profile text + gold label | account system | **not drawn** — would require fabricating an account |
| Daily reward chest | `onDaily`, online chest | **not drawn** — would require fabricating currency |
| Quit | `MenuLayer::onQuit`, ends the process | **not drawn** — a browser tab cannot quit itself |
| `GJ_chrSel_001` / `GJ_lvlEdit_001` "new" flags | gated on `GameManager+0x377/+0x378` | garage flag **kept** and cleared on first garage visit; editor flag **not drawn** (no editor) |
| Controller block | `isControllerConnected()` | **not drawn** — correctly skipped, matches a desktop with no pad |

Everything in the first group is *drawn* because removing it would change the layout the plan is
trying to reproduce; nothing in it displays invented account, currency or achievement state.

---

## 9. Browser-required differences

1. `GameManager::fadeInMenuMusic()` runs at `init`. A browser cannot start audio without a user
   gesture, so menu music starts on the first input instead. Same track, later start.
2. `CCTransitionFade` between scenes is a real cocos transition. The port navigates by URL, so only
   the **out** half of the 0.5 s cross-fade is reproduced in-scene; the incoming half is the
   browser's page load.
3. The original's window is landscape and fixed; a browser window is neither. Every position here is
   therefore recomputed per frame from the live view size instead of being baked in at init.

## 10. `LevelSelectLayer::init` — m1 `0x3a40ac`

Vtable base `0x10084e060` (found by scanning `__DATA_CONST.__const` for the slot whose `+0x1b8`
is `CCNode::addChild`). All 24 pages are built from **three** recycled `LevelPage` instances plus a
level array; `updatePageWithObject` re-binds a page as you scroll.

| element | frame / class | z | position | notes |
|---|---|---|---|---|
| background | `CCSprite::create("GJ_gradientBG.png")` | **-2** | `(-5, -5)`, anchor (0,0) | `scaleX = (winW+10)/w`, `scaleY = (winH+10)/h`; `setColor({40,125,255})` at init, immediately overwritten by the page colour |
| ground | `GJGroundLayer::create(loadedGroundID, 1)` | 0 | `positionGround(min(winH*0.5 - 110, 128))` | tinted page colour × **0.8** |
| top bar | `GJ_topBar_001.png` | 1 | `(winW*0.5, screenTop + 1)`, anchor (0.5, 1) | |
| side art L | `GJ_sideArt_001.png` | 1 | `(screenLeft - 1, screenBottom - 1)`, anchor (0,0) | |
| side art R | `GJ_sideArt_001.png` | 1 | `(screenRight + 1, screenBottom - 1)`, anchor (1,0), `flipX` | |
| scroll layer | `BoomScrollLayer::create(pages, 0, looped=true, levels, this)` | default | — | `m_width = winSize.width` (`+1812`) — **the page width is the window width** |
| page dots | `smallDot.png` batch | — | `setPagesIndicatorPosition((winW*0.5, screenBottom + 15))` | |
| soundtrack | `CCLabelBMFont("Download the soundtrack", "bigFont.fnt")`, scale 0.5, sizeMult 1.1 | default | `(winW*0.5, screenBottom + 35)` | `onDownload` — an outbound link |
| prev arrow | `navArrowBtn_001.png`, **flipX**, sizeMult 2.0 | 5 | `(screenLeft + 25, winH*0.5)` | `onPrev` |
| next arrow | `navArrowBtn_001.png`, sizeMult 2.0 | 5 | `(screenRight - 25, winH*0.5)` | `onNext` |
| back | `GJ_arrow_01_001.png`, sizeMult **1.6** | 1 | `(screenLeft + 25, screenTop - 22)` | `onBack` |

The page list is `getMainLevel(1..22)` plus **two synthetic `GJGameLevel`s** with `m_levelType`
`-2` and `-1` — the Tower / "Coming Soon!" teasers at the end of the classic list.

### 10.1 Page colour — `colorForPage` (`0x3a6a44`) and `getColorValue` (`0x3a67a0`)

```
ccColor3B colorForPage(int page) {
    if (page != 0 && page % 22 == 0) return {0x25, 0x2c, 0x34};   // 37, 44, 52
    while (page >= 9) page -= 9;
    return GameManager::colorForIdx(TABLE[page]);   // TABLE at 0x100723ca0
}
ccColor3B getColorValue(int p1, int p2, float t) {
    float k = clamp(t / 0.6666667f - 0.2f, 0, 1);
    return lerp(colorForPage(p1), colorForPage(p2), k);
}
```

`TABLE` is **`[5, 7, 8, 9, 10, 11, 1, 3, 4]`**, which through `colorForIdx` is
blue, magenta, pink, red, orange, yellow, green, cyan, light blue — the port's `PLAYER_COLORS`
entries of the same indices, byte for byte. **This replaces the port's hue wheel entirely.**

Note the ramp: the colour holds until `t = 2/15`, sweeps, and is finished by `t = 0.8`. The
original's background looks like it snaps between pages precisely because of that clamp.

`scrollLayerMoved(pos)` (`0x3a664c`) drives it: `f = -pos.x / m_width`, wrapped into `[0, 24)`;
`page = floor(f)`; `getColorValue(page % 24, (page + 1) % 24, f - floor(f))` tints the background,
and the ground layer gets the same colour × **0.8**.

### 10.2 Page movement — `BoomScrollLayer::moveToPage` (`0x32ae64`)

```
float v = m_scrollVelocity(+0x1a8);              // 0 when a button starts the move
float d = (v > 0.6f) ? 0.48f : (v <= 0.4f ? 0.96f : 0.72f);
d *= (m_speedMult(+0x214) > 0 ? m_speedMult : 1.0f);
runAction(CCEaseElasticOut(CCMoveTo(d, target), 0.5f));   // tag 0, then moveToPageEnded
```

So an arrow or a keyboard page is **0.96 s of `CCEaseElasticOut` with period 0.5** — the springy
settle. That is `easedValue(t, 6, 0.5)` in the port's already-sourced easing table.

`updateDots` (`0x32a430`) lays the dots **16 apart**, centred on the indicator position, and paints
the unselected ones **(125, 125, 125)**.

## 11. `LevelPage::init` — m1 `0x3a7568`, and `updateDynamicPage` `0x3a4e60`

Vtable base `0x10084dad0`. `m_levelDisplaySize` is **CCSize(340, 95)**, which is also exactly the
width of `GJ_progressBar_001.png` (680 hd px = 340 points).

| element | detail |
|---|---|
| level menu | `CCMenu`, z **-1**, at `(winW*0.5, winH*0.5 + 60)` |
| panel | `CCScale9Sprite::create("square02_001.png", CCRect(0,0,80,80))`, `setOpacity(125)`, `setContentSize(340, 95)`. **Centred on the play button, at `winH*0.5 + 60`.** `+340..376` sets `(winW*0.5, winH*0.5 + 50)`, but that is a dead store: `+380..400` makes the panel a child of the button's blank sprite and `+504..520` re-positions it to `(contentW/2, contentH/2)`. Corrected 2026-09-10 against a native capture (§19.4); the port drew it 10 units low until then. |
| play button | a blank `CCSprite` sized to the panel, wrapped in a `CCMenuItemSpriteExtra` whose press scale (`+0x190`) is set to **1.1** — **the panel is the button** |
| normal bar bg | `GJ_progressBar_001.png`, colour black, opacity 125, scale 1, z **3**, at `(winW*0.5, winH*0.5 - 30)` |
| normal bar fill | same art, `scaleX 0.992`, `scaleY 0.86`, colour **(0,255,0)**, anchor (0, 0.5), inset half the 0.8 % margin |
| practice bar | the same pair 50 lower; fill colour **(0,255,255)** |
| progress labels | `bigFont.fnt` `%i%%`, scale **0.5**, centred on their bar, z 4 |
| mode labels | "Normal Mode" / "Practice Mode", scale 0.5, **20 above** their bar, z 4 |
| name | `bigFont.fnt`, anchor (0, 0.5), child of the panel, `setScale(min(1, 250 / contentWidth))` |
| difficulty | `diffIcon_%02d_btn_001.png` with `clamp(difficulty, 1, 6)`, scale **1.1**, child of the panel |
| stars icon | `GJ_starsIcon_001.png`, scale **0.7**, at `(340 - 15, 95 - 13)` inside the panel |
| stars label | scale 0.5, anchor (1, 0.5), at the icon `+(-12, 0.5)` |
| coins | `GJ_coinsIcon_001.png` / `GJ_coinsIcon_gray_001.png`, scale 1, at `(340 - 16, 16)` plus **-52 / -26 / 0** |

The name-and-face row is centred as a block:

```
total  = diffW * 0.5 + nameW + 5 + 30
diff.x = 340 * 0.5 - total * 0.5 + diffW * 0.5
name.x = diff.x + 30
both.y = 95 * 0.5 + 3
```

> **Frame-family trap.** `updateDynamicPage +3396` formats **`diffIcon_%02d_btn_001.png`**. The port
> had been using `difficulty_NN_btn_001.png`, a different family that also exists in
> `GJ_GameSheet03`. Both resolve, so the mistake was invisible.

> **A 10-unit offset that is the original's, not a bug.** The play button never has its position
> set, so it sits at the menu origin — `winH*0.5 + 60`. **The panel art is centred on it too**
> (see the panel row above): an earlier reading of this section claimed the art sat 10 units
> lower, which a native capture disproved.

## 11a. Implemented level select — remaining differences

**Implemented, not visually verified** (§2 still applies).

| difference | why |
|---|---|
| 22 pages, not 24 | the two trailing pages are the Tower / "Coming Soon!" teasers, outside the locked scope; drawing them would mean inventing content that will never exist |
| no secret coin / secret door on the last page | same reason (`addSecretCoin`, `addSecretDoor`, `onTheTower`) |
| "Download the soundtrack" draws but does nothing | outbound link, outside scope |
| pages are drawn directly rather than through three recycled `LevelPage`s | `BoomScrollLayer`'s recycling is a memory optimisation with no visible effect |
| no swipe-to-scroll yet | `ccTouchMoved`'s drag model is not decoded; arrows, keys and the dots all work |
| the ground uses the level scene's HD tiling, not `GJGroundLayer::scaleGround` | that factor is still undecoded (same note as §9a) |

## 12. `GJGarageLayer` — m1 `0x2f34d8`, `setupIconSelect` `0x2f55a0`, `setupPage` `0x2f6ed8`

Vtable base `0x100831f90`.

| element | detail |
|---|---|
| background | `GJ_gradientBG.png` stretched as in LevelSelectLayer, **`setColor({150,150,150})`** (init +328) |
| side art | `GJ_sideArt_001.png` in **all four** corners — the top pair `setFlipY`, the right pair `setFlipX` (init +492, +760) |
| floor line | `floorLine_001.png` (GJ_GameSheet, **not** `floorLine_01_001`) at `(winW*0.5, winH*0.5 + 50)` |
| preview | `SimplePlayer`, scale **1.6** (1.5 for icon type 8), at `floorLine.pos + (0, scale*30*0.5 + 1)` |
| tabs | `CCMenuItemToggler(off, on)` per type, sprites at scale **0.9**, `alignItemsHorizontallyWithPadding(2)`, menu at `(winW*0.5, winH*0.5 + 30)` |
| selection rings | **two** `GJ_select_001.png` at scale **0.85**, z 1 — one over the chosen cell, one over the chosen tab (setupIconSelect +2120..2236) |
| panel | `CCScale9Sprite("square02_001.png", (0,0,80,80))`, `setOpacity(75)`, contentSize **385x100**, z -1, at `(winW*0.5, winH*0.5 - 77)` |
| back | `GJ_arrow_03_001.png`, sizeMult **1.6**, at `(screenLeft + 24, screenTop - 23)` |
| paint | `GJ_paintBtn_001.png` at `(30, winH - 120)` -> `onPaint` -> `CharacterColorPage` |

### 12.1 The grid — `ListButtonBar` / `ListButtonPage`

`setupPage` calls

```
ListButtonBar::create(items, (winW*0.5, winH*0.5 - 77),
                      columns = 12, rows = 3,
                      columnOffset = 5, rowOffset = 5, offset = 25,
                      arrowOffset = 220, arrowType = 1);
```

and `ListButtonPage::init` (m1 `0x369dc4`) turns that into

```
stepX  = columnOffset + offset = 30
stepY  = rowOffset    + offset = 30
startX = pos.x - cols*0.5*offset - (cols-1)*0.5*columnOffset + offset*0.5   // = pos.x - 165
startY = pos.y + ((rows-1)/2) * stepY                                       // = pos.y + 30
```

So the page is **12 x 3 at a 30-unit pitch**, 36 icons per page — not the port's old 10 x 3.
`playerSquare_001.png` is 60x60 hd = exactly 30x30 points, so the cells tile edge to edge.

`getItems` (m1 `0x2f7b9c` +332..392) builds each cell as

```
GJItemIcon::create(unlockType, id,
                   color1 = {175,175,175}, color2 = {255,255,255},
                   dark = false, unused = true, noLabel = true,
                   unlockColor = {255,255,255});
icon->setScale(SCALE_TABLE[iconType - 1]);   // 15 floats at 0x100722234
```

**The grid icons are grey, not the player's colours** — only the preview above uses the kit. The
scale table is `[0.8, 1.0, 1.0, 0.6, 0.75, 0.68, 0.8, 0.65, 0.65, 0.8, 0.8, 0.8, 0.7, 0.6, 0.8]`,
i.e. cube 0.8, ship 1.0, ball 1.0, UFO 0.6, wave 0.75, robot 0.68, spider 0.8, swing 0.65.

Paging uses `gj_navDotBtn_on_001.png` / `gj_navDotBtn_off_001.png` through `onNavigate`, aligned
horizontally like every other GD dot row.

## 13. `CharacterColorPage` — m1 `0x57c894`

| element | detail |
|---|---|
| panel | `CCScale9Sprite("GJ_square05.png", (0,0,80,80))`, opacity 255, contentSize **450x300**, z -1, centred |
| close | `GJ_closeBtn_001.png` scale **0.8**, sizeMult **1.6**, at the panel's top-left corner `+(10, -10)` |
| Col1 / Col2 / Glow | `ButtonSprite(caption, 40, 0, 0.4, false, "bigFont.fnt", "GJ_button_01.png", 20)`, node scale **0.85**, sizeMult 1.1, at `panelRight - 137*n`, `panelTop - 17` for n = 1, 2, 3 |
| swatches | `ColorChannelSprite` at scale **0.65**, `GJ_select_001.png` ring on the active one |

The swatch grid is **18 columns**, stepping `(+24, -24)` from
`(winW*0.5 - 204 + 6, winH*0.5 - 59 + 96)`, and each slot is nudged by
`offsetForIndex(slot) * 12`:

- x nudge: a 139-entry table at `0x1007365a4`, one per slot from 4 to 142, each 0 or 1;
- y nudge: **-0.8** for slots 54..135 (`(slot - 0x36) < 0x52` unsigned), **+0.8** above 135.

Which colour a slot shows comes from `colorForIndex` (m1 `0x57e188`), a **143-entry** table at
`0x100736368` whose `-1`s are the gaps that shape the block. Both tables are copied verbatim into
`src/scenes/garage.ts`.

### 13.1 The palette itself

`GameManager::colorForIdx` has **107 entries**, all now decoded into `src/gd/icons.ts`. Indices
0-41 are byte-for-byte the table the port already had, so extending it cannot change what any saved
`col1`/`col2` means — `tests/icons.test.ts` pins that explicitly.

## 13a. Implemented garage — remaining differences

**Implemented, not visually verified** (§2 still applies).

| difference | why |
|---|---|
| 8 tabs, not 11 | jetpack, trail (`streak`) and death effect (`explosion`) are icon categories the port has no data or gameplay for; showing them inert would open an empty grid |
| no "special"/shards/shop/vault buttons, no player-name field, no moons/diamonds/orbs counters | account, currency and online systems outside the locked scope |
| every icon is unlocked | the port has no unlock system; `GJ_lockGray_001.png`, `darkenStoreItem` and the unlock popup are unreproduced. **No fabricated lock state is displayed** |
| stars / secret-coin counters read the port's own save | the original reads `GameStatsManager`; the numbers shown are the port's real progress, not invented |
| robot and spider preview/grid use the `idle` pose from `objectDefinitions.plist` | the original builds them with `GJRobotSprite::create(frame)` / `GJSpiderSprite::create(frame)`; which frame it passes is not decoded, so the game's own idle pose is used rather than a gameplay pose picked by convenience |
| no rainbow/shadow unlock effects (`playRainbowEffect`, `playShadowEffect`) | tied to the unlock system |

## 14. The gameplay HUD

Sourced from `PlayLayer::setupHasCompleted` (m1 `0x9c840`), `toggleProgressbar` (`0xa70d0`),
`updateProgressbar` (`0x9fdbc`), `getCurrentPercent` (`0xa6e80`), `getCurrentPercentInt`
(`0xa7560`) and `UILayer::init` (`0x426d68`, vtable base `0x1008679d8`).

### 14.1 The value, and its rounding

```
float getCurrentPercent() {          // classic level
    return clamp(player.position.x / m_levelLength * 100.0f, 0.0f, 100.0f);
}
int getCurrentPercentInt() { ... fcvtms w0, s0; }    // FLOOR, not round
```

**`fcvtms` is round-toward-minus-infinity.** The HUD prints `floor(percent)`, so `100%` appears
only at exactly 100. That settles the plan's percentage edge case: the port's `Math.round` is why a
manual play showed `100%` at x = 26282 of 26384 — the original shows **99**.

Both the bar and the label read the **live player position**, not the best progress. The port drove
the text from `best` and the bar from `player.x`, which could disagree after a practice rewind.

### 14.2 The bar

| part | detail |
|---|---|
| groove | **`slidergroove2.png`** — a loose file, not an atlas frame — added at z **10**, centred at `(winW*0.5, winH - 8)` |
| fill | **`sliderBar2.png`**, child of the groove at z -1, anchor (0,0), position **(2, 4)**, repeat-wrapped, tinted the **player's colour 1** |
| `m_progressWidth` | `groove.contentSize.width - 4` |
| fill height | **8.0** (`[0x36d4]`) |
| sizing | `fill.setTextureRect(0, 0, progressWidth * max(percent, 0.01) / 100, 8)`, clamped to `progressWidth` — so a fresh attempt still shows a sliver |

The plan warned not to pick between `slidergroove-hd.png` and `sliderBar2-hd.png` by appearance.
Gameplay uses **`slidergroove2` + `sliderBar2`**; `slidergroove` and `slidergroove_02` are other
screens' art.

### 14.3 The percentage label

`CCLabelBMFont("100%", "bigFont.fnt")`, `setScale(0.5)`, z **15**, created at
`(winW*0.5 + 110, winH - 8)` with anchor (0, 0.5).

`toggleProgressbar` then re-places it every time the settings change:

```
bar.setVisible(GameManager->m_showProgressBar);        // +0x374
label.setVisible(getGameVariable("0040"));             // "show percentage"
label.setPosition(winW*0.5 + (barShown ? 110 : 0), <unchanged y>);
label.setAnchorPoint(barShown ? 0 : 0.5, 0.5);
```

So with the bar on, the percentage sits left-anchored 110 right of centre; with it off, the
percentage takes the centre.

### 14.4 Pause button and practice controls — `UILayer::init`

| control | detail |
|---|---|
| pause | `GJ_pauseBtn_clean_001.png`, `setOpacity(75)`, `setSizeMult(4)`, its own menu at z **16** |
| position | `(screenRight - 15, screenTop - 15)`, or `(screenLeft + 15, ...)` when game variable **`"0015"`** is set |
| visibility | game variable **`"0024"`** — **this is the sourced pause-button visibility rule** the plan asks for; the earlier "hide it on desktop" preference has no basis in the binary |
| checkpoint | `GJ_checkpointBtn_001.png` -> `onCheck`, press scale **1.1**, sizeMult **1.5** |
| remove checkpoint | `GJ_removeCheckBtn_001.png` -> `onDeleteCheck`, same |
| layout | `GameToolbox::alignItemsHorisontally(items, gap = 10, position, false)` in a menu at z 16 |

**Not decoded:** the `CCPoint` static the practice pair is aligned around (`0x1008b93b0`, written at
runtime), and the factory values of game variables `"0024"`, `"0040"` and `"0015"` — GD seeds those
from a first-launch save this port has no equivalent of. The port therefore reproduces the *rules*
and supplies its own defaults (bar, percentage and pause button all on, pause on the right),
recorded in `Settings` in `src/gd/save.ts`.

## 14a. Implemented HUD — remaining differences

**Corrected in Task 7:** the bar's fill is a **repeat-wrapped** texture (§16.0). `sliderBar2-hd.png`
is 64 px — 32 design units — and the bar is 206, so with the port's default `CLAMP_TO_EDGE` the
last texel column was smeared across the whole bar instead of the pattern tiling. Both the HUD bar
and the settings sliders now apply `setRepeatWrap`.


**Implemented, not visually verified** (§2 still applies).

| difference | why |
|---|---|
| the three visibility settings default to on | their factory values are not decoded (above); the rule is reproduced, the seed is the port's |
| the practice checkpoint pair keeps its existing position | the alignment anchor is a runtime-written static |
| no attempt-time / "Ignore Damage" / two-player guide labels | out of scope or debug-only |
| the fill is cropped by texture rect, tinted colour 1 | matches `setTextureRect` + `setColor`, and now with the same repeat wrap the original sets |

## 15. `PauseLayer::customSetup` — m1 `0x355300`

Vtable base `0x1008469d8`.

| element | detail |
|---|---|
| dim | the `CCBlockLayer` itself: `setColor({0,0,0})` + `setOpacity(75)` (+44..76) |
| panel | `CCScale9Sprite("square04_001.png", (0,0,80,80))`, `setOpacity(175)`, **also `setColor({0,0,0})`** (the constant at `0x1007232a6`), contentSize `(winW - 20, winH - 20)`, z **-1**, centred |
| level name | `CCLabelBMFont(level->m_levelName, "bigFont.fnt")` at `(winW*0.5, winH - 30)` |
| progress bars | `setupProgressBars` (`0x355dd0`) builds the same pair `LevelPage` does — `GJ_progressBar_001.png` background at opacity 125 with a 0.992 x 0.86 fill — the normal one at `(winW*0.5, winH*0.5 + 80)` and the practice one **50 below it** (`+880..932`; the port had -30 until Task 9). Each carries its mode's name — `"Normal Mode"` / `"Practice Mode"` — **20 above** the bar at scale 0.5, z 4 (`+1520..1628`) |
| button row | a `CCMenu`, `alignItemsHorizontallyWithPadding(**15**)` (10 in platformer), moved to `(winW*0.5, winH*0.5 - 30)` |
| practice banner | `GJ_practiceTxt_001.png` at `(winW*0.5 - 190, winH*0.5 - 12)` |
| settings gear | `GJ_optionsBtn_001.png` at scale **0.6**, at the panel's top-right corner inset 26 |
| sliders | two `Slider::create(target, sel, **0.8**)` — music at `(winW*0.5, winH*0.5 - 105)`, SFX below it — with "Music" / "SFX" `bigFont` labels; art is `sliderBar/slidergroove/sliderthumb/sliderthumbsel.png` |

### 15.1 The row, in `addChild` order

`alignItemsHorizontallyWithPadding` lays items out in child order, so this *is* the on-screen order:

| # | frame | callback |
|---|---|---|
| (0) | `GJ_editBtn_001.png` | `onTryEdit` — **added only for an editor level** (`m_levelType == 2`), so a main level never shows it |
| 1 | `GJ_replayFullBtn_001.png` | `onRestartFull` |
| 2 | `GJ_practiceBtn_001.png` / `GJ_normalBtn_001.png` | `onPracticeMode` / `onNormalMode` |
| 3 | `GJ_playBtn2_001.png` | `onResume` |
| 4 | `GJ_menuBtn_001.png` | `tryQuit` |
| 5 | `GJ_replayBtn_001.png` | `onRestart` |

### 15.2 `createToggleButton` (m1 `0x356b8c`) — the toggle construction

`GJ_checkOff_001.png` / `GJ_checkOn_001.png` as a `CCMenuItemToggler`, both sprites at scale **0.6**,
`setSizeMult(1.5)`, with a `bigFont.fnt` label at scale 0.5 anchored (0, 0.5) about 6 units to the
right of the box. This is the shape any GD toggle takes, and is what the port's auto-checkpoints
option now uses.

## 15a. Implemented pause menu — remaining differences

**Implemented, not visually verified** (§2 still applies).

| difference | why |
|---|---|
| no music/SFX sliders in the pause menu | the sourced `Slider` exists now (§16.0); placing the pause menu's own pair is the one piece of §15 still outstanding |
| ~~the settings gear draws but does nothing~~ | **done in Task 7**: it opens `GameOptionsLayer` (§16.4) |
| ~~"Auto checkpoints" is a port-only toggle~~ | **removed in Task 7**: it is `Auto-Checkpoints` (game variable `0027`) on the sourced `GameOptionsLayer`, where the original keeps it |
| no edit button | correct: the original only adds it for an editor level |
| no `onRecordReplays` / `onTime` / `onHelp` | replay recording, platformer timers and the help popup are outside the locked scope |

## 16. The settings screens

Three separate layers, not one: the main menu's gear opens a **drop-down**, the drop-down's
`Options` button opens one popup, and the pause menu's gear opens a *different* popup.

| what | function | m1 |
|---|---|---|
| the drop-down frame | `GJDropDownLayer::init(title, height, noBack)` | `0x5124fc` |
| ... its one-arg form (height **220**) | `GJDropDownLayer::init(title)` | `0x512908` |
| ... its slide-in | `GJDropDownLayer::showLayer(instant)` | `0x512a24` |
| the panel inside it | `GJListLayer::init` | `0x4fec74` |
| the settings screen itself | `OptionsLayer::customSetup` | `0x6a1ba0` |
| ... its constructor | `OptionsLayer::create` | `0x6a1a08` |
| every checkbox in the game | `GameToolbox::createToggleButton` | `0x448c1c` |
| the volume control | `Slider::init` | `0x2952d4` |
| ... its value | `SliderThumb::getValue` / `setValue` | `0x2943f0` / `0x294474` |
| the `Options` popup | `MoreOptionsLayer::init`, `addToggle`, `nextPosition` | `0x6a3090`, `0x6a43e8`, `0x6a53c8` |
| the pause gear's popup | `GJOptionsLayer::init`, `nextPosition`, `addToggleInternal` | `0x23b7a0`, `0x23c494`, `0x23c000` |
| ... and its rows | `GameOptionsLayer::init`, `setupOptions` | `0x24f210`, `0x24f268` |
| the button artwork | `ButtonSprite::create` / `init` / `setString` | `0x83af4`, `0x83c6c`, `0x83ed4` |

`OptionsLayer` vtable base `0x1008a79b8`; `MoreOptionsLayer` vtable base `0x1008a5e18`.

### 16.0 `Slider`, and why it matters twice

`Slider::init` (+196..336) builds three loose textures — `slidergroove.png`, `sliderBar.png`,
`sliderthumb.png` (`sliderthumbsel.png` for the held state) — and then:

- `m_length = groove.contentSize.width - 4` (the shipped `slidergroove-hd.png` is 420 px, so
  **206** design units);
- `m_height = 8.0`, and the bar's rect is `(0, 0, length, 8)`;
- the bar sprite is anchored `(0, 0)` at **(2, 4)** inside the groove and its texture is
  **repeat-wrapped**, so a rect wider than the art tiles rather than stretching.

That is the *same* construction `PlayLayer::setupHasCompleted` uses for the gameplay progress bar
(§14) — which is how the port's HUD bar was found to be smearing `sliderBar2`'s last texel column
across 206 units instead of tiling it. `engine/atlas.ts`'s `setRepeatWrap` is cocos's
`setTexParameters({GL_LINEAR, GL_LINEAR, GL_REPEAT, GL_REPEAT})`; both bars now use it.

`SliderThumb::getValue` is `(pos.x + m_length * scale * 0.5) / (m_length * scale)`, so the thumb
travels **± length·scale/2 about the slider's centre** and `setValue` is its inverse. Touches go
through `SliderThumb`, a `CCMenuItemSpriteExtra` — so the groove is **not** a hit target and
clicking it does nothing.

### 16.1 `GJDropDownLayer` + `GJListLayer`

- `CCLayerColor::initWithColor({0, 0, 0, 125})` dims the scene behind (+80..96).
- `m_endPosition = (0, 0)`, `m_startPosition = (0, winH)`; the layer starts one screen height
  above and `showLayer` runs `CCEaseInOut(CCMoveTo(0.5, end), 2.0)` plus a 0.5 s fade to opacity
  125 — unless game variable `"0168"` (*Fast Menu*) is set, which snaps it (+48..192).
- `GJListLayer::create(nullptr, title, ccColor4B(0, 0, 0, 180), 356, height, 0)` (+288..316), at
  `((winW - 356)/2, (winH - height)/2 - 10 + 5)` (+344..396).
- Inside `GJListLayer` (type 0, title present): a flat `(0,0,0,180)` rect, `GJ_table_bottom_001.png`
  at `(w/2, -10)` z 10, `GJ_table_top_001.png` at `(w/2, h - 5 + 20)` anchored centre z 10, and two
  `GJ_table_side_001.png` at `x = -20` and `x = w + 20` scaled to the panel height (the right one
  `setFlipX(true)`), z 9. The title is `CCLabelBMFont(title, "bigFont.fnt")` at
  `topSprite.position + (0, 3)` with `limitLabelWidth(280, 0.8, 0)`, z 11.
- Two `chain_01_001.png`, anchored `(0.5, 0)` at `winW/2 ± 156`, `y = list.y + height + 12`, z -1.
  **`chain_01_001.png` lives in `GJ_GameSheet`, not in any sheet the main menu already loads** —
  the port fetches that atlas the first time the layer opens.
- Back arrow `GJ_arrow_03_001.png`, tag 1304, `setSizeMult(1.6)`, at
  `(screenLeft + 24, screenTop - 23)`, z 10.

### 16.2 `OptionsLayer::customSetup`

The button menu's origin is `(winW*0.5, winH*0.5 + 80)` (+60..108); every button is
`ButtonSprite::create(caption, width, 0, 1.0, absolute = true, "goldFont.fnt", "GJ_button_01.png", 0)`
— **goldFont, not bigFont** (`0x83af4` +4..20).

| caption | width | offset | handler | port |
|---|---|---|---|---|
| `Account` | 130 | (-79, 0) | `onAccount` | inert — online is outside the locked scope, and any account state would be invented |
| `How To Play` | 130 | (+79, 0) | `onHelp` | inert — a separate tutorial layer |
| `Options` | 130 | (-79, -40) | `onOptions` | **opens `MoreOptionsLayer`** |
| `Graphics` | 130 | (+79, -40) | `onVideo` | inert — texture quality, fullscreen and refresh rate belong to the browser here (§16.5) |
| `Rate` | 78 | (-105, -80) | `onRate` | inert — opens the platform store |
| `Songs` | 78 | (0, -80) | `onSoundtracks` | inert — the online soundtrack list |
| `Help` | 78 | (+105, -80) | `onSupport` | inert — opens the support page |

`ButtonSprite::setString` (+92..440): the caption shrinks to `m_width / labelWidth` when it
overflows and is then clamped to `m_scale`; the background's height is the label's **unscaled**
`contentSize.height + 4`, so a shrunken caption does not also shrink its button. The label offset
is `(0, 2)` — `(-1, 2)` only when the font is `bigFont.fnt` (`0x83c6c` +252..392).

The rest of the layer:

- secret-vault lock at `(winW - 20, winH - 18)`, `setSizeMult(1.5)`:
  `GameStatsManager::getStat("12") > 9` picks `GJ_lock_open_001.png`, otherwise
  `GJ_lockGray_001.png` with `GJ_coinsIcon2_001.png` at `(+7.5, -21)` scale 0.5 and the count at
  `(-7.5, -21)` scale 0.4 (+1080..1560). **The vault is out of scope, so the button is inert — but
  the lock state and the number beside it are the player's real secret-coin total, never a
  placeholder.**
- `Music` at `(winW*0.5, winH*0.5 - 34)`, scale **0.6** (+1612..1692);
- music `Slider` at `musicLabel + (0, -20)`, tag 0, seeded from
  `FMODAudioEngine::getBackgroundMusicVolume()` (+1696..1860);
- `SFX` at `musicLabel + (0, -40)`, same scale; its slider 20 below it, tag 1, seeded from
  `getEffectsVolume()` (+1864..2164);
- the `Menu\nMusic` toggle at **`musicLabel + (145, -35)`** — the *music* label, not the SFX one —
  built with `createToggleButton(..., buttonScale 0.6, maxLabelScale 0.35, maxLabelWidth 0,
  labelOffset (0, 2), "bigFont.fnt", labelTop = true, tag 0)` (+2168..2392).

**Game variable `"0122"` is stored inverted**: the checkbox is created with
`toggle(!getGameVariable("0122"))`, so a set variable means menu music *off*. The port stores the
checkbox's sense (`Settings.menuMusic`) and says so in `save.ts`.

### 16.3 `GameToolbox::createToggleButton` — m1 `0x448c1c`

```
createToggleButton(label, selector, state, menu, position, parent, labelParent,
                   buttonScale, maxLabelScale, maxLabelWidth, labelOffset, font,
                   labelTop, labelTag, container)
```

- `GJ_checkOn_001.png` / `GJ_checkOff_001.png`, both `setScale(buttonScale)`, wrapped in a
  `CCMenuItemToggler` with `setSizeMult(1.5)` (+108..288);
- the label is `limitLabelWidth(maxLabelWidth, maxLabelScale, 0)` (+580..596);
- `labelTop` decides the anchor and the position:
  - **true**: anchor `(0.5, 0)`, at `box + (offset.x, box.height*0.5*scale + offset.y)` — centred
    **above** the box (+376..460);
  - **false**: anchor `(0, 0.5)`, at `box + (box.width*0.5*scale + offset.x, offset.y)` — left
    anchored to the **right** of the box (+464..536).

A multi-line caption is one `CCLabelBMFont` block, so an `anchor.y = 0` block stacks **upward**
from its anchor.

### 16.4 The two toggle popups

Both are 400 x 280 nine-slices, centred.

|  | `MoreOptionsLayer` | `GameOptionsLayer` |
|---|---|---|
| opened by | the `Options` button | the pause menu's gear |
| panel | `GJ_square01.png`, rect (0,0,80,80) | `GJ_square0**2**.png` (`background = 2`) |
| title | `Options` at `panelTop - 16` | **none** — neither `GJOptionsLayer::init` nor `setupOptions` creates a label |
| first row | `(winW/2 - 160, winH/2 + 80)` | the same, plus a `+32` page offset |
| row step | **48** | **37** |
| rows per page | paged | 12 |
| close | — | `GJ_closeBtn_001.png` scale 0.8, sizeMult 1.5, at `(-w/2 + 3, +h/2 - 3)` |
| paging | — | `GJ_arrow_01_001.png` at `screenLeft + 20` / `screenRight - 20`, sizeMult 1.5 |

`nextPosition` alternates the two columns and drops one row every second toggle
(`x = count & 1 ? right : left`, `y -= floor(count/2) * step`).

`addToggleInternal` (+284..432) builds each row with `buttonScale 0.8`, `labelOffset (8, 0)`,
`labelTop = false`, `setSizeMult(1.0)`, and `maxLabelScale` from `+0x3c0` — which
`GameOptionsLayer::init` sets to **0.4**. Its companion `maxLabelWidth` (`+0x3c4`) is *read* by
`addToggleInternal` but **never written on this path**, so no width limit is reproduced; flagged
here rather than guessed.

#### `GameOptionsLayer::setupOptions` rows, in order

`+0x3e8 = 32` (page y offset), `+0x3ac = 37` (row step), `+0x3b4 = 12` (per page).

| # | label | variable | port |
|---|---|---|---|
| 1 | `Auto-Retry` | `0026` | — the port always retries on the death animation's own timer |
| 2 | `Auto-Checkpoints` | `0027` | **`Settings.autoCheckpoints`** |
| 3 | `Show Progress Bar` | `GameManager+0x374` | **`Settings.showProgressBar`** |
| 4 | `Show Percentage` | `0040` | **`Settings.showPercentage`** |
| 5 | `Show Time` | `0145` | — no per-attempt clock is tracked |
| 6 | `Audio Visualizer` | `0144` | — needs FMOD's spectrum data |
| 7 | `Show Info Label` | `0109` | — editor / start-position label, out of scope |
| 8 | `Disable Checkpoints` | `0146` | — an anti-cheat rule for online levels |
| 9 | `Show Hitboxes` | `0166` | — the port's hitbox view is a debug route, not a saved option |
| 10 | `Hitbox On Death` | `0179` | — as above |
| 11 | `Practice Music Sync` | unlock item | — an unlockable, out of scope |

#### `MoreOptionsLayer` — the supported subset

`addToggle(label, key, description)` adds ~50 rows across several pages. The two this port can
honour are:

| label | variable | port | info text |
|---|---|---|---|
| `Show Cursor In-Game` | `0024` | **`Settings.showPauseButton`** | "Shows cursor and pause button during gameplay." |
| `Flip Pause Button` | `0015` | **`Settings.pauseButtonOnLeft`** | "Flips the location of the pause button." |

The remaining rows fall into four groups, none of which the port can honour without inventing
behaviour: **editor/online** (`Increase Maximum Levels` `0042`, `Disable Level Saving` `0119`,
`Save Gauntlets` `0127`, `Change Custom Songs Location` `0033`, `Disable Song Alert` `0083`,
`No Song Limit` `0018`, `Show Leaderboard Percentage`, `Hide Playtest Text` `0174`, ...);
**engine/renderer internals** (`Increase Draw Capacity` `0066`, `Enable Low Detail` `0108`,
`Enable Extra LDM` `0136`, `Disable Shader Anti-Aliasing` `0155`, `Reduce Quality` `0142`,
`Audio Fix 01`, `Disable High Object Alert` `0082`, ...); **input modes the web port does not
have** (`Click Between Steps` `0177`, `Click On Steps` `0176`, `Lock Cursor In-Game` `0128`,
`Flip 2-Player Controls` `0010`, `Always Limit Controls` `0011`, `Disable Thumbstick` `0028`,
`Enable Quick Keys` `0163`); and **effects the port does not implement**
(`Disable Portal Guide` `0129`, `Enable Orb Guide` `0130`, `Disable Orb Scale` `0140`,
`Disable Trigger Orb Scale` `0141`, `Disable Shake` `0172`, `Disable Explosion Shake` `0014`,
`Disable Gravity Effect` `0072`, `Default Mini Icon` `0060`, `Switch Spider Teleport Color` `0061`,
`Switch Dash Fire Color` `0062`, `Switch Wave Trail Color` `0096`, `Percentage Decimals`,
`Enable Faster Reset` `0052`, `Hide Attempts` `0135`/`0134`, `Hide Practice Buttons` `0071`,
`Enable Quick Checkpoints` `0068`, `Enable Death Effect` `0100`,
`Enable Normal Music In Editor` `0125`, `Disable Player Hitbox` `0171`).

They are inventoried here rather than drawn: a checkbox whose value nothing reads is exactly the
invented state the plan forbids.

### 16.5 Implemented settings — remaining differences

**Implemented, not visually verified** (§2 still applies).

| difference | why |
|---|---|
| `Account`, `How To Play`, `Graphics`, `Rate`, `Songs`, `Help` draw, animate and press but have no destination | inventoried scope exceptions (§16.2); none of them displays any state |
| the secret-vault lock is inert | vaults are outside the locked scope; the lock state and coin count shown are still the player's real totals |
| the drop-down's `Fast Menu` variable (`0168`) is not implemented | the port has no `MoreOptionsLayer` row for it, so the animation always plays |
| `MoreOptionsLayer` shows 2 rows, `GameOptionsLayer` 3 | only the rows the port actually stores are drawn — see the inventories above |
| neither popup pages | with fewer than 12 supported rows there is exactly one page, so the sourced page arrows would have nothing to do |
| the sliders quantise to nothing, not to 5 % | the previous port screen stepped in 5 % increments; `Slider` is continuous |
| no `FMODAudioEngine` — volumes go to `AudioEngine`'s gain nodes | the browser has no FMOD; the value and its 0..1 range are the same |
| the layer's music keeps playing behind it | correct: `OptionsLayer` is added over the running `MenuLayer`, it is not a scene change |

## 17. `EndLevelLayer::customSetup` — m1 `0x41fe0c`

**Implemented, not visually verified** (§2 still applies). §17.6 lists what was left out.

`EndLevelLayer` is itself a **`GJDropDownLayer`** (`create(PlayLayer*)` m1 `0x41fb38`), so §16.1's
panel, chains and 0.5 s `CCEaseInOut` slide all apply unchanged — the port draws it with the same
`drawDropDownPanel`. `EndLevelLayer::init` (m1 `0x41fbcc`) is
`GJDropDownLayer::init(" ", 230.0, noBack = true)`: an **empty title**, a **230**-tall panel, and
`noBack` — which suppresses only `GameToolbox::addBackButton`, the controller hint, not the
`GJ_arrow_03_001` arrow. `customSetup` then nudges the settled position:
`m_endPosition += (0, 5)` (+720..760).

### 17.1 Banner and statistics

- `GJ_levelComplete_001.png`, or `GJ_practiceComplete_001.png` when the practice flag
  (`GJBaseGameLayer + 0x3058`) is set: `setScale(0.8)`, z **15**, at `(winW*0.5, winH*0.5 + 75)`
  (+520..664). Game variable `"0095"` flips it horizontally — an anniversary joke, not a setting.
- `m_buttonMenu` is hidden (`setVisible(false)`) until the entrance animation finishes (+700..716).
- The statistics are `CCLabelBMFont`s in **`goldFont.fnt`**, z 3, `setScale(0.8)`, starting at
  `banner.position + (0, -40)` and stepping **-24** each (+764..1804):

  | label | source | notes |
  |---|---|---|
  | `Attempts: %i` | `PlayLayer + 0x2f1c` | |
  | `Jumps: %i` | `PlayLayer + 0x3728` | the **run's** count, not the cumulative save stat |
  | `Time: %s` | `PlayLayer + 0x3a8` (a double, seconds) | `limitLabelWidth(150, 0.8, 0)` |
  | `Points: %s` | platformer only | out of scope |

- Time formatting (+1180..1480): with `t` whole seconds, `%02d:%02d` (m:s) while
  `t + 3599 <= 7198`, i.e. `t <= 3599`, and `%02d:%02d:%02d` (h:m:s) above that. The platformer
  path adds milliseconds as `%s.%03d` and drops to a bare `%i` under a minute.
- `Jumps` and `Time` are skipped and the layout shifts by -12 on the platformer path (`w26`).

### 17.2 The end text

`getEndText()` (m1 `0x4218d8`) is `rand() % 18`, then **minus 2**: results 0..15 index a 16-entry
table at `0x100866740`, and the two that fall through (`rand() % 18` of 0 or 1) return
`"Awesome!"` — so `Awesome!` is twice as likely as any other line.

```
Good Job!   Well Done!   Impressive!   Amazing!   Incredible!   Skillful!
Brilliant!  You are... The One!   How is this possible!?   You beat me...
Challenge Breaker!   I am speechless...   Reflex Master!   Not bad!
Warp Speed!   Y u do dis?
```

(Game variable `"0095"` swaps in a 100-entry joke table at `0x1008667c0` and `"DROP THE BEAT"`;
out of scope.) The line is a `TextArea::create(text, "bigFont.fnt", scale 1.0, width 620,
anchor (0.5, 1.0), lineHeight 20, disableColor false)` (+1848..1900).

### 17.3 Buttons

All in `m_menu` (`+0x270`), added to `m_mainLayer` at z 1, on one row at
**`y = winH*0.5 - 115 - 10`** (+3256..3288):

| art | handler | x | shown when |
|---|---|---|---|
| `GJ_replayBtn_001.png` | `onReplay` | -100 | always |
| `GJ_menuBtn_001.png` | `onMenu` | +100 | always |
| `GJ_editBtn_001.png` | `onEdit` | 0 | editor levels only (`GameManager + 0x404 == 2`) |
| `GJ_restartCheckBtn_001.png` | `onRestartCheckpoint` | -180 | practice only |
| `GJ_levelLeaderboardBtn_001.png` | `onLevelLeaderboard` | `(winW*0.5 + 178, winH*0.5 + 115)` | online levels only |
| `hideBtn_001.png` | `onHideLayer` | its own menu on the **layer**, z 100, near the bottom-right, faded to opacity 125 over 1 s | always |

### 17.4 Secret coins

Only for a **non-practice** clear of a level that has coins (`GJGameLevel + 0x350 >= 1`), and never
for an editor level (+4380..4456):

- one `secretCoin_b_01_001.png` (or `secretCoin_2_b_01_001.png` for a user level) per coin, z 8,
  `GameToolbox::alignItemsHorisontally(items, gap, position, false)` at
  **`(winW*0.5, winH*0.5 - 64)`**, gap **20**, or 15 at exactly 4 coins and 13 above that
  (+4460..4772);
- each coin the player actually has gets a filled `secretCoinUI_001.png` (`secretCoinUI2_001.png`
  for a user level) laid over it, tested with `GameStatsManager::hasSecretCoin(level->getCoinKey(n))`
  (+4776..5020).

### 17.5 Out of scope for this port

Everyplay, the level leaderboard, `onEdit`, the verification messages
(`"Level and Coins Verified!"`, `"You cannot verify a level after using Ignore Damage."`,
`"You cannot verify a level if it has a start pos."`,
`"Complete the level in normal mode to verify it!"`, `"Level Verified!"`), `Points:` and the
platformer timer, the `"0095"` joke variants, and the currency/diamond/star effects
(`playStarEffect`, `playCurrencyEffect`, `playDiamondEffect`) — the port awards no currency and
must not display any.

### 17.6 Implemented results screen — remaining differences

| difference | why |
|---|---|
| **no `Jumps: %i` row** | the original reads the run's jump count out of `PlayLayer + 0x3728`, which `PlayerObject`'s jump paths and `ringJump` increment. This port does not count jumps, and the only honest ways to add it are a gameplay-file change (which a UI task must not make) or an inference from a button press that may not have produced a jump. The row is left out rather than filled with a number that would be wrong. **One line in `sim.ts`/`gamemodes.ts` at the jump sites would close this.** |
| no drop-down back arrow | `GJDropDownLayer::init` creates one (tag 1304 -> `exitLayer`); on the results screen its behaviour was not decoded, so it is absent rather than wired to a guess |
| no `hideBtn_001` | `onHideLayer` collapses the panel to peek at the finished level; its exact corner position (`screenRight - 17`, and a `CCFadeTo(1.0, 125)`) is only partly decoded |
| no entrance effects | `playEndEffect`, `playCoinEffect` and `starEnterFinished` animate the coins and banner in; the port draws the settled state after the slide |
| the practice-completion hint is not shown | `"Well done... Now try to complete it without any checkpoints!"` is in scope but sits in the verification/message block that was not decoded in full |
| the run's time is counted in fixed sim steps | deterministic, so a `?manual=1` replay prints the same number every time; the original reads a wall-clock timer |

---

## 18. Viewport policy and the acceptance pass

Recorded for Task 9, so every screen's harness is read against the same policy.

- **Original resolution policy.** Design resolution 480x320, `kResolutionFixedHeight` when the
  window is wider than 3:2 and `FixedWidth` when it is narrower — `gd/camera.ts`'s `resolveView`.
  `winSize` is therefore 320 tall on every landscape window, and the UI-local formulas in §3 run
  against the live `viewW`/`viewH` every frame rather than being baked once.
- **HD art.** Every atlas and loose texture is the `-hd` tier, drawn at `HD = 0.5` design units per
  pixel. A 1:1 native comparison has to use the same tier.
- **Browser scale.** The canvas backing store follows `devicePixelRatio`; harnesses run at DPR 1
  (desktop shapes) and DPR 2 with touch (`navigationtest.mjs`'s portrait case). Hit testing goes
  through `toDesignSpace`, which divides out both.
- **Shapes checked per screen.** 1280x720, 1920x1080, 1024x768 and 420x900, in `mainmenutest`,
  `menutest`, `kittest`, `hudtest`, `settingstest` and `endleveltest`; each asserts its controls
  stay inside the view and that the hit areas line up with what was drawn.
- **Development text removed.** The completion screen's `click or tap to choose` footer and the
  in-level `Practice Mode` label were the port's own hints; neither string is drawn by the original
  there (all four references to `"Practice Mode"` in the binary are progress-bar labels —
  `LevelPage::init`, `PauseLayer::setupProgressBars`, `LevelInfoLayer::setupProgressBars` and
  `WorldLevelPage::init` — none of them in `PlayLayer` or `UILayer`). Both are gone. The `?debug=1` DOM readout stays, since it is off-canvas
  and opt-in.
- **Native comparison.** Still blocked by §2. Until it lands, every screen is *implemented, not
  visually verified*; Task 9's pixel/geometry comparison items stay open.

## 19. Native comparison

### 19.1 How the capture is taken, and three traps

1. **Which app needs Screen Recording.** The session runs inside VS Code's integrated terminal, so
   the permission belongs to *Visual Studio Code*. Granting it to Terminal does nothing.
2. **The window and its content area.** `CGWindowListCopyWindowInfo` finds the game's window ID,
   and `screencapture -x -o -l <id>` captures it without the shadow. The 1768x1024 pt window has a
   **32 pt title bar**, so the game's content area is **1768x992 pt (3536x1984 px at 2x)** — just
   about 16:9. With FIXED_HEIGHT that is `winSize = 570.32 x 320` at **6.2 px per design unit**.
   The port is rendered at the same 1768x992 @2x by `scripts/native-compare.mjs`.
3. **Colour management.** The capture is tagged **Display P3** (this Mac has a Liquid Retina XDR
   display), but the game is not colour-managed: it writes plain sRGB bytes. Loading the PNG
   normally converts P3 to sRGB and makes the game look far more saturated than the port
   (`(102,255,0)` against `(146,252,60)`). Read with `colorSpaceConversion: "none"`, the native bytes
   are **identical** to the port's at the sampled logo pixels (`(146,252,60)`, `(199,253,89)`), and
   both match `GJ_LaunchSheet-hd.png` itself. `scripts/image-tools.mjs` and
   `scripts/native-match.mjs` always decode raw. **On this display the native game really does
   look more saturated than the port**, because macOS shows its untagged sRGB as P3; the port's
   colours are the art's own.

### 19.2 What is on the native screen that is not vanilla

The installed game runs **Geode** with `eclipse.eclipse-menu`, `geode.node-ids`,
`geode.custom-keybinds`, `fleym.nongd`, `hjfod.gdshare`, `hjfod.gmd-api` and the user's own
`com.stas.gdphysicsreader`. On the main menu that means:

- a **fifth bottom-row button** (Geode's), which `alignItemsHorizontallyWithPadding` re-centres
  the whole row around — so every vanilla bottom-row item appears ~28.5 units left of where vanilla
  would put it;
- an **`FPS: 111`** readout in the top-left corner (an overlay, not the menu's).

The user's save has **`texQuality = 1` (Low)**, so the game draws the **SD** art tier (confirmed by
eye: the native logo is visibly softer than the port's HD render at the same 6.2 px/unit). Positions
still compare, but sprite sizes and trim offsets round to whole units at SD and to half units at HD,
which is the likely source of the 1-4 px residuals below.

### 19.3 Main menu — geometry against the native capture

`scripts/native-match.mjs` template-matches each element of the port render against the native
capture (Pearson correlation on greyscale, so the colour cycle cannot pass for a position error;
coarse at 1/4 resolution, refined at full resolution). Offsets are native minus port.

| element | offset (design units) | offset (px @ 6.2/unit) |
|---|---|---|
| Play | 0, 0 | 0, 0 |
| RobTop | 0, 0 | 0, 0 |
| Garage / Creator | ∓0.16, 0.16 | ∓1, -1 |
| More Games | -0.16, 0 | -1, 0 |
| Facebook / Twitter / YouTube / Twitch / Discord | +0.16 → +0.65, 0.16 | +1 → +4, -1 |
| Achievements / Options / Stats / Newgrounds | -28.87 … -28.06, 0 | -179 … -174, 0 |

- **Everything the port draws is within 0.65 design units of the native game** (≤ 4 px at 2x
  retina, ≤ 2 pt on screen), and the logo, the play row, RobTop and More Games are within 1 px.
- The bottom row's uniform shift is fully explained by Geode's fifth button: with four vanilla items
  the port's centres are `-83.5, -27.75, 27.75, 83.5`, and adding a fifth equal-width item predicts
  the `-112 … 112` spread the capture shows. The extra 1-3 px per step matches SD rounding of the
  half-unit HD widths (e.g. a 101 px HD button is 50.5 units, its SD counterpart 51).
- The social row drifts by exactly +1 px per icon. That pattern is **not explained yet**: these
  icons are placed at explicit offsets (§5), not aligned, so content-size rounding should not
  produce a steady drift. A capture at the **Medium (HD)** tier would settle whether it is SD trim
  rounding or a real 0.16-unit step error.
- Present natively and correctly absent in the port: Quit, the profile block and the daily chest
  (§8 exceptions), plus the Geode button and the FPS readout (§19.2).
- Not compared: the decorative player (random icon and gamemode in both), the background colour
  (the cycle phase differs), animation timing.

**Status: static layout and colour verified against native; rasterization differs by art tier;
animation not compared.** Captures: `docs/ui-parity/reference/native-main-menu-1768x992@2x.png`,
`port-main-menu-1768x992@2x.png`, `compare-main-menu-pair.png`, `compare-main-menu-blend.png`.

### 19.4 Level select — against the native capture

Native pages captured through the in-game `gd-ui-capture` mod (§19.6): page 1 (Stereo Madness,
with the account's real 100 % / 1 % / 3 coins), page 23 and page 24. The port was rendered with a
save seeded to the same state.

**Four real errors found and fixed:**

| error | cause | fix |
|---|---|---|
| the level panel and everything in it drew **10 units low** | `LevelPage::init +340` sets `winH/2 + 50`, but it is a dead store (§11) | panel centred on the play button at `winH/2 + 60` |
| **2 pages and 2 dots missing** (22 vs 24) | `LevelSelectLayer::init +1596..1708` appends synthetic levels **-2** (The Tower) and **-1** ("Coming Soon!") | both pages added: the Tower door (`theTowerDoor_001` at `(winW/2, winH/2 − 5)`, bobbing ±5 over 2.5 s with `CCEaseInOut` rate 1.8) with `theTowerLabel_001` 23 above it, and `"Coming Soon!"` in bigFont at `winH/2 + 50` |
| the carousel **clamped** at both ends; the prev arrow was hidden on page 1 | `BoomScrollLayer::create(pages, 0, looped = true, …)` | paging wraps both ways, both arrows always drawn |
| the **info button** was missing | `GJ_infoIcon_001` → `onInfo`, sizeMult 2, at `(screenRight − 20, screenTop − 20)` (+2664..2788) | drawn at its sourced position, inert (see below) |

**Two shared-code errors found through this screen and fixed everywhere:**

- `LoadedFont.measure` summed advances only. cocos2d-x 2.2's `CCLabelBMFont::createFontChars`
  extends the content width by the last glyph's overhang (`rect.width − xAdvance`); bigFont's `s`
  overhangs by 9 px, so "Stereo Madness" measured 272 pt instead of 276.5, the level name took a
  2 % larger `min(1, 250/width)` scale, and every centred label sat half an overhang right. Name
  width against native: 2.6 % → 0.9 % (the rest is the SD font's own rounding, 278 pt).
- Mirrored sprites were drawn with a raw `renderer.draw`, which drops the trim offset. cocos's
  `setFlipX/Y` keeps it, negating only the flipped axis (`setTextureRect`, issue #732).
  `navArrowBtn_001`'s (0, −5) offset put the prev arrow 2.5 units high; `GJ_table_side_001`'s
  (+5, 0) offset and 48-of-60 px trim had the settings and results panels' side rails stretched
  25 % wide. `drawUiSprite` now takes `flipX`/`flipY`/`scaleY`.

**Result after the fixes** (native-match, native minus port):

| element | offset (px @ 6.2/unit) |
|---|---|
| back arrow, info button | 0, 0 |
| next arrow, prev arrow | −1, −1 |
| level panel (with its contents) | −4, −2 |
| bars, their labels, "Download the soundtrack", top bar, corners, 24 dots | aligned in the overlay |

**Remaining, explained:**

- `50/50` + `currencyOrbIcon_001` on the level panel is **not drawn**: it is the level's orb
  currency (`updateDynamicPage +4800..4888`), which the port does not model and must not fake.
- The Tower's three particle systems (`updateDynamicPage +1180..1760`, GD particle strings) are not
  reproduced; the door, label and bob are.
- `onInfo`'s popups — "Level Stats" (attempts, jumps, normal %, practice %), "The Tower" and
  "It's a secret..." — are not reproduced yet; the button is inert. "Level Stats" needs a jump
  count the port does not keep (the same gap as §17.6).
- `addSecretDoor()` on the Coming Soon page: nothing visible on this account; vaults are out of
  scope.

### 19.5 Garage — against the native capture

Captured with the account's real kit (cube 31, ship 72, colours 15/12, no glow); the port was
rendered with the same kit seeded.

**Errors found and fixed:**

| error | cause | fix |
|---|---|---|
| the icon panel and grid drew **12 units low** | `setupIconSelect +220` adds `0xC2700000`, which is **−60**; Task 4 read it as −72 | `PANEL_Y = −5 − 60 = −65` |
| tabs packed too tight (pitch ~30 vs 34 units) | each toggler's *sprites* are scaled 0.9 **after** creation (`+1776..1936`), so its content size — the alignment width and hit rect — stays the full sprite | tabs laid out at full sprite width, drawn at 0.9 |
| 8 tabs instead of **11** | jetpack, trail (`streak`) and death effect (`explosion`) tabs (`+1412..1740`) | added, inert — outside the locked scope |
| **"Tap 🔒 for more info!" missing** | it is an image, `GJ_unlockTxt_001.png`, 12 above the panel's top (`+260..412`) | drawn |
| page dots at the wrong height and pitch | the dot menu sits at `(winW/2, 25)` (`+2696..2764`); each dot's sprite is scaled 0.9 *before* wrapping and aligned with padding **6** (`setupPage +872..1168`) | both corrected |
| **half the icon catalogue missing** (7 pages of cubes vs 14) | the port counted icons in the legacy `GJ_GameSheetIcons` atlas (248 cubes, 79 ships, **1** swing); 2.2 ships every icon as its own sheet in `Resources/icons/` — 485 / 169 / 118 / 149 / 96 / 68 / 69 / 43 | `ICON_COUNTS` measured from those sheets; the sheets are copied to `public/assets/icons/` (11 MB) and loaded on demand (`gd/iconSheets.ts`) by the garage (visible page + preview), gameplay (the kit's 8, at level start) and the main menu's random cube. The page count is the original's `count / 36 + 1`. |
| star/coin counters at invented positions | the column is seven fixed slots 15 apart from `(screenRight − 18, screenTop − 12)`: stars, moons, coins, user coins, orbs, diamonds, shards; icons at 0.54 (coins 0.51), numbers right-aligned 12 left at 0.34 (`init +3672..5700`) | stars in slot 1 and secret coins in slot 3, the currency slots left empty |
| Shards button and Shop sign missing | `GJ_shardsBtn_001` at `(30, winH − 80)`; `shopRope_001` at `(winW/2 − 135, winH − 25)` (`+3228..3530`) | both drawn, inert; the sign's `useAnimationType(1)` move-down press is not reproduced, so it is drawn static rather than given a bounce it does not have |

**Result:** tabs, the unlock text, the grid panel and every grid icon, the arrows, the 14 page dots,
the back arrow, the Shards and paint buttons, the Shop sign, the counter icons, the corners and the
floor line all overlay without doubling.

**Remaining, explained:**

- The **preview** shows the last *icon type* equipped (`playerIconType`, here the ship), not the open
  tab's icon; the port previews the open tab. A small behavioural difference, not yet reproduced.
- The username field (`GJ_nameTxt_001`, "Player"/Thonburi, and its lock), and the moons, user coins,
  orbs, diamonds and shards counters: account and currency state the port does not have (§8's rule).
- The grid colouring of the newer icons (249+) has not been compared against a native capture of
  a later page.

### 19.6 How the non-main-menu captures were taken

Clicking inside the game needs macOS **Accessibility**, which this session does not have. Instead a
small Geode mod, **`gd-ui-capture`** (`~/projects/gd-ui-capture/`, built with the same SDK 5.8.2
toolchain as the user's `gd-physics-reader`), polls `/tmp/gd-ui-capture/cmd` once a frame and opens
the requested screen the way the game's own buttons do, but instantly: `menu`, `levels N`, `garage`,
`options`, `moreoptions`, `play N`, `freeze`, `pause`, `practice on|off`, `gameoptions`, `endlevel`.
It acknowledges each command in `/tmp/gd-ui-capture/ack` and does nothing when no command file
exists. **It never calls `PlayLayer::levelComplete`**: the results screen is built directly with
`EndLevelLayer::create`, so no completion, stars or orbs are written. The account's save files were
backed up first to `~/projects/gd-ui-capture/save-backup-2026-09-10/` (hashes matched the
originals). The mod is one file in the game's `geode/mods/` folder; removing it restores the install.

## 9a. Implemented main menu — remaining differences

Written down so nothing on this list is mistaken for parity later. The screen is **implemented**,
not **visually verified**, because §2's native capture is unavailable.

| difference | why | evidence |
|---|---|---|
| Menu cube icon is drawn from the port's cube physics, not `PlayerObject` | the original runs the full player object with particles and streaks; the port reuses its own sourced cube integration and no trail (`MenuGameLayer` calls `stopStreak2`/`deactivateStreak`, so no trail is correct) | §6.3 |
| Menu cube's random colours come from the port's 42-entry palette, not 108 | the port's palette is byte-identical for 0-41 and simply stops there; extending it belongs to Task 4 | §6.1 |
| Which cube icon the menu shows is random per respawn | the original's choice is not yet decoded | §6.3 |
| Ground uses the level scene's HD tiling, not `GJGroundLayer::scaleGround` | that factor is not yet decoded | §6 |
| The background is one horizontally-wrapping row, not GD's doubled-rect sprite | visually identical; the doubling exists only to make one sprite wrap | §6.2 |
| Background/ground index is fixed at 1 | the original shows "whatever `GameManager` last loaded", which the port has no equivalent of | §6 |
| No profile button, view-profile text, daily chest or quit button | account / currency / process state the port does not have | §8 |
| Creator, achievements, stats, newgrounds, RobTop, the five social icons and more-games draw and press but do nothing | destinations outside the locked project scope | §8 |

---

## 10. Session log for this file

**2026-09-09.** Built the annotator/vtable tooling, confirmed the 2.2081 address column
still lands at `<+0>`, and decoded `MenuLayer::init` end to end (4880 bytes), plus
`CCMenuItemSpriteExtra` init/selected/unselected, `CCMenuItem::rect`, `CCMenu::itemForTouch`,
`CCEaseBounceOut::update`, `CCDirector`'s screen-bounds accessors, and `MenuGameLayer::init`.
Recorded the `setSizeMult` naming trap. Native screen capture is blocked by a missing TCC
permission; recorded as a limitation rather than a reason to stop.

**2026-09-09 (Task 7).** Decoded the whole settings stack: `GJDropDownLayer` +
`GJListLayer` (the panel and its 0.5 s `CCEaseInOut` slide), `OptionsLayer::customSetup` (all seven
`ButtonSprite` buttons with their widths and offsets, the vault lock and its coin badge, both
volume rows and the inverted `"0122"` menu-music toggle), `Slider`/`SliderThumb`,
`GameToolbox::createToggleButton`, `ButtonSprite::create/init/setString`, and both toggle popups
(`MoreOptionsLayer` and `GJOptionsLayer`/`GameOptionsLayer`, including the full ~50-row inventory
and which of them this port can honour). Recorded two traps: the pause gear's popup has **no title
label**, and `GJ_square0N`'s companion `maxLabelWidth` field is read but never written. Finding
`Slider`'s repeat-wrapped bar also caught the same bug in Task 6's gameplay progress bar.
