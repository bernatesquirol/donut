import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * GitHub Pages serves no history fallback: a request for /creator has no
 * matching file and 404s. Pages does serve 404.html for unknown paths, so an
 * identical copy of index.html boots the router and it resolves the path
 * itself. Vite's dev server already falls back to index.html, so this is only
 * needed for the built site.
 */
function pagesSpaFallback(): Plugin {
  let outDir = "dist";
  return {
    name: "pages-spa-fallback",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const index = resolve(outDir, "index.html");
      if (existsSync(index)) copyFileSync(index, resolve(outDir, "404.html"));
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command }) => ({
  // The project page lives at <user>.github.io/blank-game/. Rename this to
  // the new repository when you fork the starter, or every asset 404s on
  // Pages. Dev keeps the root so local URLs stay short.
  base: command === "build" ? "/blank-game/" : "/",
  plugins: [pagesSpaFallback()],
  server: {
    port: 8080,
    open: true,
  },
}));
