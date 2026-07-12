import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Bundle all npm deps into the SSR build output. TanStack Start ships a single
  // server bundle (used here only to prerender the static shell), so leaving deps
  // external (h3, react, @tanstack/*, seroval, …) would throw "No such module".
  // (node: builtins stay external — the runtime provides them.)
  ssr: {
    noExternal: true,
  },
  plugins: [
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
