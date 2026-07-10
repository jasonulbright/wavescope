# WaveScope

A music visualizer built like an instrument. WaveScope turns any audio signal
into a real-time light show through three rendering engines: 34 built-in
mathematical modes, real MilkDrop presets (libprojectM compiled to
WebAssembly, plus Butterchurn), and GPU-native WebGPU shaders. Four input
sources plus Spotify, render targets up to 8K (7680x4320), fullscreen, across
every display you own. Everything runs client-side; audio never leaves the
machine.

The v2 engine architecture (worker isolation, projectM WASM, WebGPU) is
documented in `ROADMAP-V2.md`.

## Product surfaces

| Route | What it is |
|---|---|
| `/` | Landing page. The hero is a live particle instrument running the real engine (demo signal, cursor pressure, optional microphone). The gallery renders all 34 modes as live canvases. |
| `/viz` | The console: the visualizer itself. Arm a source, pick a mode, go fullscreen. `?mode=<id>` deep-links a mode; `?follow=1` starts a companion display window. |
| `/docs` | The manual: signals (incl. Spotify), all three engines, resolution, multi-display, shortcuts, browser support, the math. |

## Architecture

The site is a React 19 + TanStack Start app, server-rendered in a single
Cloudflare Worker. All visualizer code is client-only (canvas + Web Audio) and
mounts inside effects; nothing touches `window` during render.

### The engine (`app/src/lib/viz/`)

- **`audio-engine.ts`** — `AudioEngine`: one `AnalyserNode` (fftSize 2048,
  smoothing 0.8) fed by one of four sources:
  - `demo`: an internal oscillator bank (saw + harmonic sines with LFO detune,
    synthetic kick every 500 ms, chord change every 4 s). Analysis-only, silent.
  - `mic`: `getUserMedia` with echo cancellation / noise suppression / AGC
    disabled, so music is captured faithfully.
  - `system`: `getDisplayMedia` loopback (tab/screen share with the
    "Share audio" box ticked). Only the audio track is analyzed; the video
    track is kept alive but never rendered (stopping it kills the session in
    some browsers).
  - `file`: an `<audio>` element source, audible, looped.

  `getFrame()` produces one `AudioFrame` per rAF: 1024 FFT bins, 2048 waveform
  samples, smoothed RMS level, bass/mid/treble band energies (split at 250 Hz
  and 4 kHz), and a beat envelope (bass energy spiking 1.35x above its own
  moving average charges the envelope; it decays at `e^(-6t)`).

- **`modes/`** — the 34 visualizers in five families (spectrum 9, waveform 6,
  particles 6, geometry 6, field 7). Each mode is
  `draw(v: VizPaint): void` over `{ctx, w, h, f: AudioFrame, p: palette,
  state, pointer}` plus an optional `fade` (translucent background wash per
  frame = phosphor trails). `state` is per-instance scratch (particle pools,
  offscreen canvases, peak arrays). Frequency sampling is logarithmic
  (`util.ts#bin`) to match pitch perception. Heavy full-surface modes
  (plasma, waterfall) render to small offscreen canvases and upscale, so they
  cost the same at 8K as at 1080p.

- **`palettes.ts`** — six trace palettes (ultramarine default, green
  phosphor, amber CRT, paper white, full spectrum, magma). A palette is
  `color(pos, alpha)` over a 0-1 axis.

- **`sync.ts`** — multi-window sync. The console broadcasts each analyzed
  frame over a `BroadcastChannel`; companion windows (`/viz?follow=1`) render
  from received frames with their own mode/palette/resolution.
  `openOnOtherDisplays()` uses the Window Management API
  (`getScreenDetails`) to open one fullscreen-sized companion per additional
  monitor in Chrome/Edge, falling back to a single popup elsewhere.

- **`pcm.ts`** — full engine parity for companions. The console taps its
  analyser with an inline AudioWorklet and broadcasts raw stereo PCM
  (2048-sample Float32 blocks, ~23 msgs/s). On its first user gesture (a
  browser requirement) a companion builds a `PcmLink`: a muted local
  AudioContext whose player worklet replays the stream through a ring
  buffer (~100 ms jitter budget, latency clamped at 250 ms) into its own
  analyser. Both `AudioEngine` and `PcmLink` satisfy the `AudioGraphSource`
  interface, which is what lets MilkDrop and audio-rate analysis run in
  every window, not just the console. Unlinked companions fall back to the
  60 Hz frame broadcast.

- **`demo-singleton.ts`** — one shared demo engine for the landing page so
  35+ live canvases (hero, gallery, meters, footer trace) analyze a single
  signal instead of each owning an AudioContext.

- **`milkdrop.ts`** — Butterchurn engine: lazy-loads Butterchurn (the
  MIT-licensed WebGL port of MilkDrop 2) and its converted classic preset
  library from CDN, keeping ~1 MB of WebGL engine out of the app bundle.
  `MilkdropCanvas.tsx` connects it to the engine's pass-through analyser
  node, so presets follow source switches; preset changes blend in place
  (2.7 s, like classic MilkDrop) without a WebGL rebuild. Butterchurn JSON
  preset uploads persist in `localStorage`.

- **`projectm.ts`** — the real MilkDrop engine: libprojectM v4 compiled to
  WebAssembly (`app/public/projectm/projectm.{js,wasm}`; build recipe in
  `ROADMAP-V2.md`). Runs raw `.milk` presets directly (per-pixel warp, the
  ns-eel expression VM), which Butterchurn cannot. `ProjectMCanvas.tsx`
  drives a render loop feeding PCM from any `AudioGraphSource`; bundled
  starter presets in `app/public/presets-milk/` plus raw `.milk` upload.
  Loaded on demand, gated on WebGL2, capped at 1440p (fixed WASM heap).

- **`webgpu.ts`** — the WebGPU engine (v2 Phase C): GPU-native per-pixel
  modes as WGSL fragment shaders (Plasma field, Warp tunnel, Fractal fold)
  driven by an audio uniform buffer, rendered full-resolution up to 8K.
  `WebGPUCanvas.tsx` drives it; gated on `navigator.gpu`.

- **`spotify.ts`** — Spotify integration (`SpotifyPanel.tsx`): a quick path
  (open Spotify, capture system audio) and a connected path (Authorization
  Code + PKCE, entirely client-side, user's own client ID) where a button
  starts playback on the user's device remotely. Capture is still via system
  loopback (Spotify's stream is DRM-protected); the now-playing track shows
  in the HUD.

### Rendering (`app/src/components/ws/`)

- **`VizCanvas.tsx`** — the inline renderer: one canvas, one rAF loop, one
  mode. Resolution targets set the backing store height (1080 / 1440 / 2160 /
  4320; `auto` = CSS size x devicePixelRatio), width follows the element's
  aspect ratio, clamped to 7680 wide. Honors `prefers-reduced-motion` by
  painting a single composed frame. Used by the 34 gallery thumbnails (capped
  at 24 fps, paused offscreen) and as the console fallback where
  OffscreenCanvas transfer is unavailable.
- **`render-worker.ts` + `WorkerCanvas.tsx`** — the v2 console renderer
  (see `ROADMAP-V2.md`). The console canvas is transferred to a dedicated
  worker with `transferControlToOffscreen()`; the worker runs the mode loop
  off the main thread so 8K modes never stall the deck. The main thread does
  only the per-tick analysis (needs the AudioContext) and transfers one frame
  per rAF. Chosen once per mount via `workerCanvasSupported()`.
- **`MilkdropCanvas.tsx` / `ProjectMCanvas.tsx` / `WebGPUCanvas.tsx`** — the
  three alternate engine surfaces, each mirroring the same shape (a canvas +
  render loop fed from an `AudioGraphSource`). The console swaps to one of
  them when its engine is active and falls back to the built-in modes
  otherwise.
- **`HeroPanel.tsx`** — the landing hero: a particle field (up to 2400
  particles) displaced by the live waveform, with cursor pressure and a
  one-click "arm mic" chip. The generated hero artwork paints as CSS
  background before JS boots, so first paint is always composed.
- **`Meter.tsx`**, **`LiveThumb.tsx`**, **`Nav.tsx`** — deck furniture.

### The console (`app/src/routes/viz.tsx`)

Source arming (four sources + Spotify) with real error states (mic denied,
share without audio, source ended), engine toggles (built-in / projectM /
Butterchurn / GPU, mutually exclusive), mode/preset/palette/resolution menus,
shuffle timer, calm mode, custom palettes, fps + backing-store HUD,
auto-hiding deck (3 s idle), fullscreen, companion-display launcher, and a
shortcut map (Space/arrows cycle, F fullscreen, H hide UI, P palette,
S shuffle, C calm, M displays, ? overlay).

## Design system

See `app/design-brief.md` (the committed design contract). Short version: "the site
is a signal laboratory": mist paper `#F2F4F1`, ink `#121714`, one ultramarine
accent `#3346C9`, instrument-black `#0B0D0C` reserved for product surfaces.
Satoshi for display, JetBrains Mono for readouts. All imagery, icons, and the
monogram live in `app/public/assets/`.

## Development

```bash
cd app
bun install
bun run dev        # local dev
bun run typecheck  # tsc --noEmit
bun run build      # production build → static SPA in app/dist/client
```

## Deployment

WaveScope builds to a fully static SPA (`app/dist/client`) with no server
runtime — the entire engine runs client-side. Any static host works. This repo
deploys to [Vercel](https://vercel.com): `app/vercel.json` sets the output to
`dist/client` with a SPA-fallback rewrite, and pushes to `main` auto-publish to
[wavescope.signalridgelabs.com](https://wavescope.signalridgelabs.com).

## Browser support

Chrome and Edge support everything: system-audio capture, automatic
multi-display placement, the projectM (WebGL2) and WebGPU engines. Firefox
and Safari run the built-in modes and mic/file/demo; system capture, window
placement, and WebGPU are Chromium-only (Butterchurn covers MilkDrop there
where WebGL2 exists). The engine toggles only appear where their platform
feature is present. All analysis is local; no accounts, no storage, no
telemetry.
