# WaveScope Web — elevation plan

Per post-seam module, what "up to the pre-seam bar" requires. The pre-seam bar
is: tight dispose paths, no duplicated contract logic, unit-tested pure math,
and docs that match reality. Items map to `FINDINGS.md`.

| Module (post-seam) | State | To reach the bar |
|---|---|---|
| `MilkdropCanvas.tsx` | **below bar** | Add the dispose its two sibling canvases already have (WS-L1): disconnect the analyser edge, drop butterchurn refs, force-lose the WebGL context. This is the one real leak. |
| `projectm.ts` feed | **below bar** | Feed only new samples, not the whole sliding window (WS-C1) — the fix the native port already made. |
| `pcm.ts` `PcmLink` | **below bar** | Stop duplicating `AudioEngine.getFrame()`; both call one shared `analyzeFrame()` (WS-C3) so the contract can't drift between console and companion. |
| `vercel.json` | **below bar** | Add the security headers the public deploy shipped without (WS-S1); self-host the two brand fonts (WS-S2). |
| `spotify.ts` | near bar | Add OAuth `state` to match the native sibling (WS-S3). Otherwise solid. |
| `viz.tsx` overlays | near bar | Focus-trap + focus-restore the modals; `aria-live` the HUD (WS-A1/A2). |
| `webgpu.ts` / `WebGPUCanvas` | **at bar** | Reviewed, kept — explicit `destroy()`, error-count fallback, reduced-motion, capability gate. Matches native shader host 1:1. |
| `render-worker.ts` / `WorkerCanvas` | **at bar** | Reviewed, kept — clean worker lifecycle, transfer-based frames, reduced-motion, resize via refs. |
| `sw.js` | **at bar** | Reviewed, kept — the cache-poisoning fix (`1cf3c86`) is correct and unit-tested (`__tests__/sw.test.ts`); content-type guard on caching is exactly right. |
| `record.ts` | **at bar** | Reviewed, kept — MediaRecorder path, analyser tap disconnected on stop, track cleanup. |
| `sync.ts` | **at bar** | Reviewed, kept — BroadcastChannel frames, 2 s liveness, safe defaults. |

## Test rigor to port from the native sibling

The native app unit-tests the FFT recipe, band split at 48 k **and** 44.1 k, beat
charge/decay slope, `bin()` mapping, palette curves, and registry integrity
(`src/tests.cpp`). The web's `__tests__` cover palettes + registries + the service
worker, but **not the analysis contract**. Mirror the native coverage in the web
runner against the SAME constants, so the two implementations can never silently
drift:

- band split by Hz at 48 k and 44.1 k (bass moves, mid/treble don't, for a
  bass-only synthetic frame)
- level = RMS ¼-decimation, smoothed 0.2
- beat: charges past ~0.8 on a bass jump, decays like e^−6dt
- `bin()` log-axis mapping matches `floor(pow(1023, pos*0.92+0.08))`
- one shared `analyzeFrame()` (WS-C3) makes this testable in one place and
  covers `PcmLink` for free.

## Explicitly NOT doing (churn ≠ elevation)

- No rewrite of the worker/WebGPU/projectM hosts — reviewed and kept.
- No new engines or modes — parity with the native sibling is a separate product
  question, not an elevation task.
- `packages/ui` removal (WS-D2) is proposed but gated on owner intent (it may be
  deliberate scaffold retention).
