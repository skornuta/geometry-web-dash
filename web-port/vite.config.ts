import { defineConfig } from "vite";

// `GD_BASE=/repo-name/ npm run build` for a GitHub Pages project site; "/" otherwise.
export default defineConfig({
  base: process.env.GD_BASE ?? "/",
  server: { port: 3222 },
});
