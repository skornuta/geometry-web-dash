import { Renderer } from "./engine/renderer.ts";
import { startLevelView } from "./scenes/levelView.ts";
import { mountBugReport } from "./bugReport.ts";
import { startPlayLevel } from "./scenes/playLevel.ts";
import { startMainMenu } from "./scenes/mainMenu.ts";
import { startMenu } from "./scenes/menu.ts";
import { startGarage } from "./scenes/garage.ts";
import { loadCustomLevel, parseGmd, storeCustomLevel } from "./gd/gmd.ts";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const boot = document.getElementById("boot");
/** the page's loading note: shown until the first scene is up, or replaced by what went wrong */
function bootError(message: string, detail?: string) {
  if (!boot) return;
  boot.className = "error";
  boot.textContent = message;
  if (detail) { const d = document.createElement("small"); d.textContent = detail; boot.appendChild(d); }
}
let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  bootError("This game needs a browser with WebGL 2 (current Chrome, Edge, Firefox or Safari).",
    String((e as Error)?.message ?? e));
  throw e;
}

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

// Gameplay hides the link (a stray click mid-run would leave the level); the
// pause menu shows it again.
const inGameplay = !!custom || (params.has("level") && !params.has("static"));
mountBugReport(canvas, !inGameplay);

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

start().then(() => boot?.remove()).catch((e) => {
  console.error(e);
  bootError("Something went wrong while loading the game. Reload the page to try again.",
    String(e?.message ?? e));
});
