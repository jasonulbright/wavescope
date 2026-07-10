# WaveScope engine v2

The v2 architecture, credited to a suggestion from veri: run the visual
engine on threads that can't starve each other, render MilkDrop from the
real C++ engine compiled to WebAssembly instead of a JS reimplementation,
and (eventually) draw through WebGPU. Three phases, each independently
shippable. Phase A is DONE and live; B and C are specced here with concrete
build recipes so they are drop-in, not rewrites.

## The problem v2 solves

In v1 everything shared the main thread: audio analysis polling, all 34
2D-canvas modes, Butterchurn's WebGL, and the React deck UI. At high
resolution they contend, and a busy page can jank the visuals. veri's
framing: "do it with emscripten/dawn and you'd be able to do audio and
video without either fucking each other up." The fix is structural thread
isolation, not micro-optimization.

Target thread layout:

| Thread | Job | Status |
|---|---|---|
| Audio thread (AudioWorklet) | capture + PCM, later the analysis DSP | v1 tap worklet exists (`pcm.ts`); analysis still main-thread |
| Main thread | React deck, input, per-tick analysis snapshot, message routing | done |
| Render worker (OffscreenCanvas) | the 34 built-in modes | **DONE (Phase A)** |
| Engine (WASM) | projectM / MilkDrop, in its own worker | Phase B |
| GPU (WebGPU/WGSL) | the actual draw calls | Phase C |

---

## Phase A — worker-isolated rendering (DONE, shipped)

The console canvas is transferred to a dedicated worker via
`transferControlToOffscreen()`; the worker owns its own draw loop over the
mode registry. The main thread does only what needs the AudioContext
(analysis is microseconds) and posts one compact frame per tick. Heavy 8K
modes can no longer stall the deck, and a busy page can no longer starve
the visuals.

- `app/src/lib/viz/render-worker.ts` — the worker: mode loop, palette
  rebuild, size/DPR/8K clamp, stats back to the page.
- `app/src/components/ws/WorkerCanvas.tsx` — page side: transfers the
  canvas, pumps frames, forwards pointer, reports fps/size.
- `app/src/components/ws/VizCanvas.tsx` — the inline path, still used by the
  34 gallery thumbnails (we never spawn 34 workers) and as the fallback
  when a browser lacks OffscreenCanvas transfer (Safari < 16.4).
- Modes were made worker-safe: `makeScratchCanvas()` in `modes/util.ts`
  returns an `OffscreenCanvas` when `document` is absent.

The console picks the path once per mount via `workerCanvasSupported()`.

The message contract (`WorkerInMsg`/`WorkerOutMsg` in `render-worker.ts`) is
deliberately engine-agnostic: the Phase B WASM engine plugs into the same
init/config/frame/pointer/stats shape.

---

## Phase B — MilkDrop from the real engine, compiled with Emscripten (DONE)

**Built and shipped.** libprojectM is compiled to WASM and runs as a second
MilkDrop engine (the `projectM` button in the console), executing raw `.milk`
presets directly (per-pixel warp, ns-eel expression VM). Butterchurn stays as
the fallback for browsers without WebGL2 and as a separate engine option.

How it was built (reproducible):
- Toolchain: emsdk at `C:\projects\emsdk`, cmake + ninja from VS 2026.
- `C:\projects\projectm` — libprojectM v4 cloned; configured with
  `emcmake cmake -B build-wasm -G Ninja -DBUILD_TESTING=OFF -DENABLE_SDL_UI=OFF
  -DENABLE_SYSTEM_PROJECTM_EVAL=OFF -DENABLE_SYSTEM_GLM=OFF`, built with ninja
  → static archives (`libprojectM-4.a`, `-playlist.a`, `libprojectM_eval.a`,
  `libglad.a`).
- `C:\projects\projectm\web-wrapper\sv_projectm.cpp` — a small C ABI wrapper
  (create WebGL2 context + OES_texture_float, `sv_init/resize/
  load_preset_data/add_pcm_float/render/destroy`). `link.ps1` links it against
  the archives with `-sMODULARIZE -sEXPORT_ES6 -sMIN/MAX_WEBGL_VERSION=2
  -sFULL_ES2/ES3 -sALLOW_MEMORY_GROWTH -fexceptions` →
  `projectm.js` (163 KB) + `projectm.wasm` (1.05 MB).
- Artifacts committed to `app/public/projectm/`; starter `.milk` presets in
  `app/public/presets-milk/`.

In-app: `app/src/lib/viz/projectm.ts` (loader + `ProjectMEngine` adapter),
`app/src/components/ws/ProjectMCanvas.tsx` (render loop, PCM feed from the
`AudioGraphSource`, preset crossfade), wired into the console deck alongside
Butterchurn with raw-`.milk` upload + persistence.

To rebuild the WASM after a projectM update: re-run the emcmake build then
`web-wrapper/link.ps1` from an activated emsdk env, and re-copy the artifacts.

### Original rationale

Replace Butterchurn (a JS reimplementation that needs presets pre-converted
to its own JSON) with **libprojectM compiled to WASM**. projectM is the
maintained C++ descendant of MilkDrop; it executes raw `.milk` presets
(warp + composite shaders, the ns-eel expression VM). Payoff over Butterchurn:
true raw-`.milk` support (the entire 15-year preset archive, drag-and-drop, no
conversion) and the expression/shader hot path running as WASM+WebGL2 rather
than interpreted JS.

### The build (one-time, needs a toolchain we don't have in-session)

Done on any machine with emsdk; produces static assets we commit under
`app/public/projectm/`.

```bash
# 1. Emscripten toolchain
git clone https://github.com/emscripten-core/emsdk && cd emsdk
./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh

# 2. projectM (the library, not the desktop app)
git clone --recurse-submodules https://github.com/projectM-visualizer/projectm
cd projectm

# 3. Configure for WASM. projectM ships an Emscripten preset; if the repo's
#    CMakePresets lists one, use it, else configure by hand:
emcmake cmake -B build-wasm \
  -DCMAKE_BUILD_TYPE=Release \
  -DENABLE_EMSCRIPTEN=ON \
  -DBUILD_SHARED_LIBS=OFF \
  -DENABLE_PLAYLIST=ON
cmake --build build-wasm -j

# 4. Output: projectM.js (glue) + projectM.wasm (+ optional .data preset
#    pack). Copy the glue + wasm into the app:
cp build-wasm/src/api/*.js  ../wavescope/app/public/projectm/projectm.js
cp build-wasm/src/api/*.wasm ../wavescope/app/public/projectm/projectm.wasm
```

Notes / gotchas to expect:
- projectM's Emscripten target has shifted across versions; check the repo's
  `emscripten/` or `web/` dir and its CI YAML for the current, working flag
  set before hand-writing the cmake line above.
- It renders through GLES2/WebGL2; the Emscripten build creates its own GL
  context on a canvas handle you pass in. In a worker that canvas is an
  OffscreenCanvas (`GL.createContext`), so the engine runs fully off-thread
  like the mode worker.
- Audio in: projectM wants PCM/waveform samples (`projectm_pcm_add_float`).
  Feed it from the same tap the rest of the app uses.
- **License: libprojectM is LGPL-2.1.** As a WASM blob loaded at runtime and
  not statically linked into proprietary code, the dynamic-use posture is
  clean; keep the projectM source/build recipe referenced (this file) and
  the blob replaceable. Revisit if the app ever goes closed and bundled.

### The seam (in-repo now, so the build just drops in)

`app/src/lib/viz/projectm.ts` defines the adapter interface and a loader that
looks for `/projectm/projectm.js`. Until the artifact is committed it
reports `available: false`, and the console keeps offering Butterchurn. When
the WASM lands, wire a `ProjectMCanvas` (mirror `MilkdropCanvas.tsx`) that:
1. creates an OffscreenCanvas-backed worker,
2. loads the glue/wasm, `projectm_create`,
3. feeds PCM from the `AudioGraphSource`,
4. lists `.milk` files from a `public/presets-milk/` folder + user uploads,
5. reuses the existing preset menu / shuffle / upload UI (they're already
   engine-neutral in `viz.tsx`).

Butterchurn stays as the zero-build default and the fallback where WASM/
WebGL2 is unavailable; projectM becomes the high-fidelity option.

---

## Phase C — WebGPU / WGSL render targets (DONE, first cut)

**Built and shipped.** A WebGPU engine (`app/src/lib/viz/webgpu.ts` +
`WebGPUCanvas.tsx`, the `GPU` button in the console) runs GPU-native per-pixel
modes as WGSL fragment shaders at full resolution (up to 8K) — Plasma field,
Warp tunnel, Fractal fold — driven by an audio uniform buffer (resolution,
time, level, bass, mid, treble, beat). Capability-gated on `navigator.gpu`;
the button only appears where WebGPU is present, and a device-creation failure
falls back to the built-in modes. This is the honest payoff of WebGPU here:
NEW per-pixel effects that are only feasible on the GPU, not a port of the
already-cheap 2D modes.

WebGPU DOM types aren't in the project's TS lib and adding `@webgpu/types`
would need a lockfile change, so the GPU objects are typed loosely and the
render path was verified in a real browser instead.

Future extensions: a spectrum texture for FFT-driven shaders, WGSL siblings of
the field modes, compute-shader particle systems.

### Original plan

Once modes and the engine are worker-isolated, the draw backend is swappable.
WebGPU (via WGSL compute/render pipelines) is the forward target for the
per-pixel field modes (plasma, flow-field, interference) that are currently
CPU-bound in the offscreen path.

- Gate on `navigator.gpu`; keep the 2D-canvas worker as the universal
  fallback (WebGPU is still absent on much of Safari/Firefox-stable).
- Port field modes first — they map to fragment/compute shaders directly and
  gain the most. Line/particle modes stay fine on canvas 2D.
- This is a per-mode `backend: "2d" | "webgpu"` tag plus a WGSL sibling to
  the draw function; the message contract does not change.
- Native note: Google's Dawn is the C++ WebGPU impl. It is **not** adopted
  for a native build (that would re-add a Chromium-subproject dependency the
  SpectraViz desktop app exists to avoid); WebGPU here is strictly the
  browser render path.

---

## Sequencing

A shipped, then B, then C, each behind capability detection with the current
path as fallback, so no phase regresses a browser that can't do it. B is the
biggest single win (fidelity + raw `.milk`) and the next thing to build once
a machine with emsdk is available.
