/**
 * Where the game's art and audio are served from. Vite's `base` is "/" in
 * development and the repository's sub-path on GitHub Pages, so every asset URL
 * goes through here instead of starting with a bare `/assets/`. (Node scripts
 * that import `src/` have no `import.meta.env`; they get "/".)
 */
export const BASE: string = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? "/";
export const ASSET = `${BASE}assets/`;
