# WaveScope Web — third-party / vendored inventory

What ships or installs, its version, why, and upgrade posture. Runtime engine
code is self-hosted (no CDN); the only runtime third-party fetches are brand
fonts (WS-S2, flagged for self-hosting).

## Vendored at runtime (self-hosted in `app/public/`)

| Asset | Version | Why | Upgrade posture |
|---|---|---|---|
| `vendor/butterchurn.min.js` | butterchurn **2.6.7** (MIT, Jordan Berg) | The MilkDrop-2 WebGL engine; lazy-loaded only when the milkdrop engine is selected, keeping ~1 MB out of the app bundle. | Pinned via committed file. Watch upstream for WebGL context-handling fixes (relevant to WS-L1). Update = replace the file + bump NOTICE. |
| `vendor/butterchurnPresets.min.js` | butterchurn-presets **2.4.7** (MIT) | The converted classic preset library (~62 presets: Geiss, Flexi, Martin…). | Pinned. Content, not logic. |
| `projectm/projectm.{js,wasm}` | libprojectM **v4** (LGPL-2.1), emscripten build | The real ns-eel MilkDrop engine for raw `.milk`; gated on WebGL2, capped at 1440p (fixed WASM heap). Build recipe in `ROADMAP-V2.md` / `C:\projects\projectm`. | Pinned via committed artifact. LGPL satisfied by the separate WASM module. |
| `.milk` presets (`public/presets-milk/`) | 15 bundled | Starter presets for the projectM engine (same files the native sibling bundles). | Plain text; content. |

## Runtime third-party fetches (flagged — WS-S2)

| Asset | Source | Concern |
|---|---|---|
| Satoshi font | `api.fontshare.com` (runtime CSS) | Contradicts the self-hosted narrative; visitor IP leaks to the CDN; unrestricted with no CSP. Self-host (woff2) like `packages/ui` already does for its fonts. |
| JetBrains Mono | `fonts.googleapis.com` + `fonts.gstatic.com` (runtime) | Same; Google Fonts sees every visitor. |

## Installed but effectively unused

| Package | Note |
|---|---|
| `@wavescope/ui` (`workspace:*` → `packages/ui`) | A full design-system template (100+ components; IBM Plex Mono / Inter / Space Grotesk woff2). The app imports exactly **one erased type** from it (`IconGlyph` in `lib/ui-material-icons.ts`) and none of its runtime code — verified. So it adds **zero shipped bundle weight** but is install/workspace weight and a `vite.config` icon-shim's reason to exist (WS-D2). Remove, or keep deliberately as scaffold and document it. |

## Key runtime dependencies (npm, public registry)

React 19.2, TanStack Router/Start/Query 1.16x, Tailwind 4.2, `@base-ui/react`
1.5. All current majors; no known advisories surfaced in the lockfile at review
time. `overrides` pins `@types/react` to 19.2.15 (type-only). No secrets, tokens,
or personal data in the repo or fixtures.
