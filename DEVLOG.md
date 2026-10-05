# Devlog 1: I'm porting Geometry Dash to the web

**Total time logged: ~22h 30m**

Been heads down on this for a while and completely forgot to write devlogs, so here's an intro one
covering what this even is and where it's at.

**This is not a wrapper.** No Unity, no Godot, no emulator, none of the love.js stuff I did for my
Balatro port. It's **vanilla TypeScript + WebGL2**, reading the real level files out of my own Steam
install and re-implementing GD's physics, collision, gamemodes, triggers and rendering by hand.

Scope is locked to the **22 classic main levels** + menus + icon kit. No editor, no online, no
platformer mode, or I'd be doing this forever.

## What works so far

- **All 22 levels render** — 0 missing objects out of 175,138
- **All 8 gamemodes** — cube, ship, ball, UFO, wave, robot, spider, swing
- Portals, orbs, pads, breakable blocks, dual mode
- Triggers: color, move, alpha, toggle, spawn, shake
- Practice mode, checkpoints, secret coins, saves
- Level select, icon kit, settings, music, SFX, pause menu
- Particles, screen shake, death explosion

I also built a **beam-search bot that plays the levels headlessly**, which is how I test physics
changes — it currently completes **19 of the 22 levels**. 139 unit tests passing.

## The actual hard part

Rendering it was easy. Making it *feel* right is the whole project, because every number you need —
gravity, jump height, how big a spike's hitbox really is — is compiled into a binary and documented
basically nowhere.

So most of these 22 hours weren't writing code, they were finding out what the correct number is and
then writing three lines. I ended up disassembling the actual game binary to read the physics
directly. My one rule: **never guess a constant.** If I can't source it, it gets marked
`APPROXIMATION` in the code.

## Next up

Finishing the last 3 levels, robot/spider animation, easing on moving platforms, and getting it on a
real domain so people can actually play it.

More devlogs coming, and they'll be way more frequent than this one.

---

Devlog 2: Menus, Triggers, and Proper Animations
Time spent since last devlog: ~10h 10m
Total time logged: ~32h 53m

The levels aren’t finished yet, but the game is finally starting to look and feel like actual Geometry Dash instead of a static test build.

Visuals & Triggers
The levels were way too stiff before. Adding authored trigger behavior makes everything move and pulse like the real game:

Pulse & Color Triggers: Added live HSV shifts and over a thousand pulse triggers so backgrounds, objects, and channels flash to the beat properly.
Movement & Easing: Implemented real easing curves (including overshooting) and move stacking so platforms follow the player smoothly instead of jittering.
Rotate Triggers: Objects and hazards actually spin around pivot points instead of sitting frozen in place.
Mirror Portals: The entire camera flips cleanly now without breaking the screen layout. (no animation for flip yet WILL BE ADDED NEXT)
most of this works OKAY, but there are still lots of changes to be made.
The UI Overhaul
The game now boots into a real main menu. The setting, icon menu, pause menu, and win screen were rebuilt from scratch using original assets and binary-accurate layouts:

Game Feel: Button press animations, proper hitboxes (almost), snappy sliders, and difficulty badges match the real thing (except for dash for some reason).
Icon Menu: Swapped out the old sprite sheet for the individual 2.2 sheets. All 107 palette colors and hundreds of icons are loaded in and selectable. (not formatted well rn)
HUD: Practice mode buttons, pause screens, and attempt counters scroll away naturally instead of cluttering the view.
Next Up
Finishing all levels
bug testing
optimizing everything
more bug testing
More devlogs coming soon
---

# Devlog 2: Physics accuracy grind

Mostly physics this time. I've got recordings of the real game playing every level, so I replay the same inputs in my port and count every spot where the player ends up somewhere different. That number went from **333 → 30**.

No guessing numbers anymore: every fix comes from those recordings or from reading GD's actual machine code.

## Fixed this round

- Force blocks. These turned out to be the "robot falls weirdly slow" mystery
- The 2.2 End trigger. Dash now ends exactly where the real one does
- Rotate Gameplay speed hand-off, teleport gravity, linked teleports
- Dual mode: player 2 spawns and flips gravity correctly now
- Dash orbs, spider orbs, wave hitboxes, saw hitboxes
- Ship/UFO getting pushed around by moving blocks (the last Deadlocked mystery)

The bot beats all 22 levels again, and there are 445 unit tests.

## Next

A few leftover physics edge cases (slopes are still cursed), then camera + visuals.
