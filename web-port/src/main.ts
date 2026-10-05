import { Renderer } from "./engine/renderer.ts";
import { startLevelView } from "./scenes/levelView.ts";
import { startPlayLevel } from "./scenes/playLevel.ts";
import { startMainMenu } from "./scenes/mainMenu.ts";
import { startMenu } from "./scenes/menu.ts";
import { startGarage } from "./scenes/garage.ts";
import { loadCustomLevel, parseGmd, storeCustomLevel } from "./gd/gmd.ts";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const renderer = new Renderer(canvas);

const params = new URLSearchParams(location.search);

// The front door is the game's own main menu (`MenuLayer`), which is what the
// root URL now serves. The classic level carousel (`LevelSelectLayer`) moved to
// its own explicit `?levels=1` route, reached from the menu's Play button, and
// every debugging entry point — `?level=N`, `?static=1`, `?x=`, `?practice=1`,
// `?manual=1` — is unchanged.
// `?settings=1` is the deep link to `OptionsLayer`, which the original opens
// **over** the running menu rather than as a scene of its own — so it is the
// main menu with the drop-down already in.
// `?custom=1`: play a custom level dropped onto the page (below)
const custom = params.has("custom") ? loadCustomLevel() : null;
const start = custom
  ? () => startPlayLevel(renderer, custom.songLevel ?? 1, custom)
  : params.has("icons")
  ? () => startGarage(renderer)
  : params.has("settings")
  ? () => startMainMenu(renderer)
  : params.has("levels")
  ? () => startMenu(renderer)
  : !params.has("level")
  ? () => startMainMenu(renderer)
  : params.has("static")
    ? () => startLevelView(renderer, parseInt(params.get("level")!, 10))
    : () => startPlayLevel(renderer, parseInt(params.get("level")!, 10));

// Drop a `.gmd` (a level exported from the game) anywhere to play it.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  file.text().then((xml) => {
    storeCustomLevel(parseGmd(xml));
    location.href = "?custom=1";
  }).catch((err) => alert(`Could not load that level: ${err.message}`));
});

start().catch((e) => {
  document.body.innerHTML = `<pre style="color:red">${e.stack}</pre>`;
});
