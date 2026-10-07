# A4 audio coverage

Checked 2026-10-06 on branch `wave2-A4`. Node check only; no browser run.

## Result

- 26 files requested: 22 level tracks, `menuLoop.mp3` (menus and icon kit), 3 gameplay sfx.
- Present in `web-port/public/assets`, non-empty, same byte size and SHA-256 as `steam-gd/Resources`, valid header: **26 of 26 pass. Missing: 0.**
- Loader: a failed load is silent to the player. See "Loader risk" below.

## Method

Script: `/tmp/a4-audit/check-audio.mjs` (kept outside the repo; run as `node check-audio.mjs <worktree>`). It:

1. Reads the level map from `web-port/src/gd/audio-map.ts` (`N: "Name",` entries). It finds 22.
2. Reads the three `SFX` entries from the same file.
3. Adds `menuLoop.mp3`, which is hard-coded at `scenes/menu.ts:342`, `mainMenu.ts:378`, `garage.ts:326` and `iconKit.ts:91`.
4. For each file, checks that `public/assets/<file>` exists and is a non-empty regular file (`fs.stat` follows the symlink). It compares size and SHA-256 with `steam-gd/Resources/<file>`. It reads the first bytes: `ID3` tag, MPEG frame sync (`0xFF` then `0xE0` mask set; all MP3s here are `0xFB`, MPEG-1 Layer III), or `OggS`.
5. Lists every `.mp3` and `.ogg` in `public/assets` that is not one of the 26 above. It marks each as referenced if the file name, the quoted stem, or `/assets/<stem>` appears in `web-port/src`. This is a text match, so a mention in a comment counts.

`npm run assets` was not run, and `public/assets` was not written. `web-port/` was not changed.

## Track table

Size is in bytes. "Matches" means byte size and SHA-256 both equal the `steam-gd/Resources` copy.

| User | File | Size | Matches steam-gd | Header | Result |
|---|---|---:|---|---|---|
| Level 1 | StereoMadness.mp3 | 1389414 | yes | ID3 | PASS |
| Level 2 | BackOnTrack.mp3 | 1325884 | yes | ID3 | PASS |
| Level 3 | Polargeist.mp3 | 1527758 | yes | ID3 | PASS |
| Level 4 | DryOut.mp3 | 1349707 | yes | ID3 | PASS |
| Level 5 | BaseAfterBase.mp3 | 1366130 | yes | ID3 | PASS |
| Level 6 | CantLetGo.mp3 | 1345527 | yes | ID3 | PASS |
| Level 7 | Jumper.mp3 | 1403323 | yes | ID3 | PASS |
| Level 8 | TimeMachine.mp3 | 1567587 | yes | ID3 | PASS |
| Level 9 | Cycles.mp3 | 1323794 | yes | ID3 | PASS |
| Level 10 | xStep.mp3 | 1368098 | yes | ID3 | PASS |
| Level 11 | Clutterfunk.mp3 | 1550327 | yes | ID3 | PASS |
| Level 12 | TheoryOfEverything.mp3 | 1536253 | yes | ID3 | PASS |
| Level 13 | Electroman.mp3 | 1520652 | yes | ID3 | PASS |
| Level 14 | Clubstep.mp3 | 1395474 | yes | ID3 | PASS |
| Level 15 | Electrodynamix.mp3 | 1324756 | yes | ID3 | PASS |
| Level 16 | HexagonForce.mp3 | 1449182 | yes | ID3 | PASS |
| Level 17 | BlastProcessing.mp3 | 1604126 | yes | MPEG `FF FB` | PASS |
| Level 18 | TheoryOfEverything2.mp3 | 1483754 | yes | MPEG `FF FB` | PASS |
| Level 19 | GeometricalDominator.mp3 | 1654699 | yes | MPEG `FF FB` | PASS |
| Level 20 | Deadlocked.mp3 | 1692733 | yes | MPEG `FF FB` | PASS |
| Level 21 | Fingerdash.mp3 | 2838061 | yes | ID3 | PASS |
| Level 22 | Dash.mp3 | 2257608 | yes | ID3 | PASS |
| Menus, icon kit | menuLoop.mp3 | 480723 | yes | ID3 | PASS |
| Gameplay sfx (death) | explode_11.ogg | 18712 | yes | OggS | PASS |
| Gameplay sfx (complete) | endStart_02.ogg | 41866 | yes | OggS | PASS |
| Gameplay sfx (coin) | secretKey.ogg | 67955 | yes | OggS | PASS |

Level-to-track mapping: this is the port's own table in `audio-map.ts`, not read from the level files. The header key `kA1` is absent from the 22 main levels, according to the comment in that file. That was not re-checked against the binary here.

## Present but not referenced by the port

These are copied into `public/assets` but no code in `web-port/src` names them. The first group belongs to out-of-scope features (vault, shop, tower).

| File | Size | Header | Note |
|---|---:|---|---|
| secretLoop.mp3 | 312352 | ID3 | vault music, out of scope |
| secretLoop02.mp3 | 419701 | ID3 | vault music, out of scope |
| secretLoop03.mp3 | 700151 | ID3 | vault music, out of scope |
| secretShop.mp3 | 354010 | MPEG | shop, out of scope |
| shop.mp3 | 397060 | MPEG | shop, out of scope |
| shop4.mp3 | 518562 | ID3 | shop, out of scope |
| tower01.mp3 | 280102 | ID3 | tower, out of scope |
| PowerTrip.mp3 | 3092061 | MPEG | not referenced |
| StayInsideMe.mp3 | 1681071 | ID3 | not referenced |
| DJRubRub.mp3 | 559299 | ID3 | not referenced |
| dangerLoop.mp3 | 166263 | MPEG | not referenced |
| playSound_01.ogg | 14209 | OggS | copied by `copy-assets.mjs` as "start / retry", but nothing plays it |
| quitSound_01.ogg | 11399 | OggS | copied by `copy-assets.mjs`, but nothing plays it |

The last two are a gap rather than an out-of-scope feature. `copy-assets.mjs` copies them for start and retry, but no `playSfx` call uses them. Only `explode_11`, `endStart_02` and `secretKey` are played (`playLevel.ts:985`, `1085`, `1122`).

## Loader risk

Read from `web-port/src/engine/audio.ts`. Not confirmed in a browser.

- `load(url)` runs `fetch(url).then(r => r.arrayBuffer())`, then `decodeAudioData`. It does not check `r.ok`. A 404 returns an HTML body, which `decodeAudioData` rejects. A network error rejects `fetch`.
- `load`, `playMusic` and `playSfx` have no `try`/`catch`, and nothing in `web-port/src` installs an `unhandledrejection` handler. A failure therefore gives a rejected promise and nothing else. The player hears silence and sees no message. The only trace is an "Uncaught (in promise)" line in the devtools console.
- Callers use `void`: `playLevel.ts:510` (music), `menu.ts:342`, `mainMenu.ts:378`, `garage.ts:326`, `iconKit.ts:91` (menu music), and `playLevel.ts:985`, `1085`, `1122` (sfx). None of them catches the rejection.
- A failed `playMusic` has already called `stopMusic()`, so the previous track is cut off and nothing replaces it. Nothing is cached on failure, so the next call fetches again.

This matches the brief: silent to the player, with a rejected promise. The check that this file set decodes in a real browser is not done here, since that needs a browser run.

## Not done

- No browser run. The check proves that the bytes are present and identical to the source, not that any browser plays them.
- The gates (`npm test`, `npx tsc --noEmit`) were not run. No code changed, and running them from this worktree would write caches into the shared `node_modules` symlink target.
