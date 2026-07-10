import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { fileURLToPath } from "node:url";

// The vendored @wavescope/ui components import their glyphs from an
// `@wavescope/icons` package. This app builds on the PUBLIC npm registry, so
// every `@wavescope/icons/*` import is redirected to a Material Symbols shim
// (see src/lib/ui-material-icons.ts). tsconfig.json has the matching `paths`
// entry so type-checking resolves it too.
const UI_ICONS_SHIM = fileURLToPath(
  new URL("./src/lib/ui-material-icons.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [{ find: /^@wavescope\/icons(\/.*)?$/, replacement: UI_ICONS_SHIM }],
  },
  // Bundle all npm deps into the SSR build output. TanStack Start ships a single
  // server bundle (used here only to prerender the static shell), so leaving deps
  // external (h3, react, @tanstack/*, seroval, …) would throw "No such module".
  // (node: builtins stay external — the runtime provides them.)
  ssr: {
    noExternal: true,
  },
  plugins: [
    // Material Symbols SVGs (the app icon set) import as React components via
    // `?react`. `icon: true` sizes them 1em; fill is forced to currentColor so
    // they color like text (the raw SVGs have no fill attribute). Keep the
    // viewBox so CSS sizing scales the glyph.
    svgr({
      svgrOptions: {
        icon: true,
        svgProps: { fill: "currentColor" },
        svgoConfig: {
          plugins: [
            { name: "preset-default", params: { overrides: { removeViewBox: false } } },
          ],
        },
      },
    }),
    // TanStack Start must run before React's plugin. SPA mode: `vite build`
    // prerenders a static index.html shell (plus /docs and /viz via crawlLinks)
    // into dist/client that boots the client router — deployable as plain static
    // files (Vercel, GH Pages, any CDN) with no server to run. Because the shell
    // is prerendered, site code must be SSR-safe: never touch browser-only globals
    // (window, document, localStorage, navigator) during render or at module top
    // level — only inside effects/handlers, or guarded with typeof window checks.
    tanstackStart({
      server: { entry: "server" },
      spa: {
        enabled: true,
        maskPath: "/",
        prerender: {
          outputPath: "/index.html",
          crawlLinks: true,
          retryCount: 2,
        },
      },
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
});
