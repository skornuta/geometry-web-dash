import { defineConfig } from "vite";

// `GD_BASE=./ npm run build` for a GitHub Pages project site that works under any
// repo name (what `scripts/deploy-demo.sh` uses); "/" otherwise.
export default defineConfig({
  base: process.env.GD_BASE ?? "/",
  server: { port: 3222 },
});
