# WaveScope Web — forensic review findings

Reviewed on branch `hardening/forensic-pass`: every file in `app/src`
(routes, `components/ws`, `lib`, `lib/viz`), `app/public` (`sw.js`, vendored
butterchurn, projectM WASM glue), and config (`vercel.json`, `vite.config.ts`,
`package.json`, `tsconfig`, `bunfig`). Verified live by building the static
SPA and driving it in a browser (demo armed, all 34 modes enumerated, engines
switched, console watched, MilkDrop leak reproduced). Cross-checked against the
hardened native sibling's unit-tested `analysis.inl` and the brief's appendix.

Severity-ranked; each row has the failure scenario that makes it real.

## Seam analysis (who wrote what, and where quality drops)

**Verdict: the quality seam is between the squashed initial release (strong)
and the v2 engine + PWA layer added in the final four commits (weaker).**

The git history is only 7 commits: the entire strong first half — `audio-engine.ts`,
the 34 modes, `palettes.ts`, `VizCanvas.tsx`, routes — landed squashed into
`fc231b4` "initial public release" (07-09 22:31), so there is no *within-repo*
hash seam for the pre-seam work. The drop is visible in the **code**, in the v2
layer that landed across `f492887 → f545a11 → 25781e1 → 1cf3c86` (23:50 → 00:44):
`webgpu.ts`, `render-worker.ts` + `WorkerCanvas.tsx`, `projectm.ts`, `pcm.ts`,
the butterchurn wiring in `milkdrop.ts`/`MilkdropCanvas.tsx`, `sw.js`, `record.ts`,
and the embed/auto-DJ additions to `viz.tsx`.

Evidence of the gradient:
1. **Copy-paste divergence** — three engine canvases were written to mirror each
   other, but only two (`ProjectMCanvas`, `WebGPUCanvas`) got a dispose path;
   `MilkdropCanvas` has none (WS-L1). Classic late-project tell.
2. **A defect the native review already caught** reappears here: the projectM
   PCM overfeed (WS-C1 = native FINDINGS P1).
3. **Duplicated contract logic** — `getFrame()` is copy-pasted verbatim from
   `AudioEngine` into `PcmLink` (WS-C3), the kind of drift the pre-seam code
   avoided.
4. **Ship-a-bug-then-patch** — `sw.js` landed in `25781e1` with a cache-poisoning
   bug and was patched 7 minutes later in `1cf3c86`.
5. **Deploy work without its safety companions** — the public deploy + PWA arrived
   with no security headers (WS-S1) and the README's architecture section was left
   describing the pre-migration Cloudflare Worker while its deploy section was
   updated to Vercel (WS-D1).

Confidence: high on the *where* (v2 layer); the seam is a code-quality gradient,
not a single commit, because the strong half was squashed.

## Security

| # | Sev | Where | Finding / failure scenario | Status |
|---|-----|-------|----------------------------|--------|
| WS-S1 | HIGH | vercel.json | **No security headers at all** — no CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, or framing policy. The site keeps a Spotify **refresh token in localStorage** (XSS-currency); a CSP is the control that blunts token exfiltration if any XSS ever lands. The intentional `?embed=1` iframe use means framing must stay permissive, but everything else is simply absent. | proposed |
| WS-S2 | MED | __root.tsx:65-79 | Fonts load at **runtime from third-party CDNs** (`api.fontshare.com`, `fonts.googleapis.com`/`gstatic.com`) — contradicting the repo's own "no third-party CDN at runtime / self-hosted" narrative (milkdrop.ts NOTICE, README). Every visitor's IP goes to Google; a CDN outage degrades the brand type; and with no CSP (WS-S1) the origins are unrestricted. | proposed |
| WS-S3 | LOW | spotify.ts:79-98 | The PKCE authorize request sets **no `state` param**, and `completeSpotifyAuth` validates none. PKCE's `code_verifier` binding covers the critical token-exchange CSRF, so this is defense-in-depth, not a hole — but the native sibling validates `state` and the web should match. | proposed |
| WS-S4 | INFO | spotify.ts | Reviewed, good: PKCE S256, verifier in `sessionStorage` (cleared after use), tokens never sent anywhere but Spotify, client ID public-by-design, no secret. URL params (`?mode`/`?embed`/`?src`) are validated in `viz.tsx#validateSearch` and fall back safely — no injection sink. No `dangerouslySetInnerHTML`/`eval` in app code. | kept |

## Crashes / leaks

| # | Sev | Where | Finding / failure scenario | Status |
|---|-----|-------|----------------------------|--------|
| WS-L1 | HIGH | MilkdropCanvas.tsx:128-132 | **butterchurn WebGL-context + audio-node leak on engine switch.** The unmount cleanup cancels rAF and nulls refs but never disconnects the visualizer from the console's session-long analyser and never releases its WebGL context. `connectAudio(analyser)` leaves an audio-graph edge that pins the visualizer (and its context) so GC can't reclaim it — unlike `ProjectMCanvas`/`WebGPUCanvas`, which both call `destroy()`. **Reproduced live: 6 milkdrop on/off toggles created 6 WebGL contexts, 0 freed.** After ~16 the browser force-loses the oldest context and MilkDrop renders black for the rest of the session. | proposed |

## Correctness vs. the analysis contract

| # | Sev | Where | Finding / failure scenario | Status |
|---|-----|-------|----------------------------|--------|
| WS-C1 | MED | projectm.ts:113-126 / ProjectMCanvas.tsx:102 | **projectM PCM overfeed** (native FINDINGS P1, appendix #1). `feed()` reads the full 2048-sample analyser window every rAF and pushes `min(2048, maxSamples)` into projectM's *accumulating* PCM buffer — each real sample fed ~30× at 60 fps. projectM's internal beat/bass detection runs hot and wrong vs. real MilkDrop. Fix mirrors native: feed only the newest ≈`sampleRate/fps` samples per frame. | proposed |
| WS-C2 | INFO | audio-engine.ts:225-273 / pcm.ts:232-279 | Reviewed, matching the native unit-tested constants: bands split 250 Hz / 4 kHz by Hz from the real sample rate; RMS ¼-decimation; level smoothing 0.2; beat 1.35× gate / 0.08 floor / e^−6dt. The web reads the browser AnalyserNode (its own Blackman + dB mapping); the native app reimplements it to match. Contract holds. | kept |
| WS-C3 | LOW | pcm.ts:232-279 | `PcmLink.getFrame()` is a **verbatim copy** of `AudioEngine.getFrame()` (~30 lines). A future contract tweak in one silently drifts the companion. Extract one shared `analyzeFrame()` helper. | proposed (elevation) |

## Browser matrix / robustness

| # | Sev | Where | Finding | Status |
|---|-----|-------|---------|--------|
| WS-B1 | INFO | all canvases | Reviewed, good: `prefers-reduced-motion` honored in every renderer (one composed frame, then hold). Worker path gated by `workerCanvasSupported()`, WebGPU on `navigator.gpu`, projectM on WebGL2 — all fall back cleanly on Safari/Firefox. Source-ended + capture-denial paths handled in `audio-engine.ts`/`viz.tsx`. | kept |

## Performance

| # | Sev | Where | Finding | Status |
|---|-----|-------|---------|--------|
| WS-P1 | INFO | index.tsx / LiveThumb.tsx | 34 gallery loops share one demo engine (`demo-singleton`) and pause offscreen via IntersectionObserver — good. Paused thumbs still fire a no-op rAF; negligible. Reviewed, kept. | kept |
| WS-P2 | LOW | WorkerCanvas.tsx:116-130 | Two `Uint8Array.slice()` allocations per frame, but transferred zero-copy to the worker; GC handles the throwaways. Acceptable; noted. | kept |

## Accessibility

| # | Sev | Where | Finding | Status |
|---|-----|-------|---------|--------|
| WS-A1 | MED | viz.tsx overlays | The arm overlay, help, palette panel, and Spotify panel are **not focus-trapped** and don't move focus in or restore it on close. Deck selects/buttons are keyboard-operable and labelled, but modal focus management is absent. | proposed |
| WS-A2 | LOW | viz.tsx:988-998 | HUD readouts aren't `aria-live`; screen readers don't announce source/mode/fps changes. | proposed |

## Docs / product truth

| # | Sev | Where | Finding | Status |
|---|-----|-------|---------|--------|
| WS-D1 | MED | README.md:44-45 vs 191-194 | **Architecture/deploy contradiction**: "server-rendered in a single Cloudflare Worker" vs. "fully static SPA, no server runtime, deploys to Vercel." The Cloudflare line is stale (pre-migration); `vercel.json` confirms static + SPA-rewrite. Fix the architecture section. | proposed |
| WS-D2 | LOW | packages/ui | **Dead workspace**: `packages/ui` is a full design-system template (100+ components, IBM Plex/Inter/Space Grotesk woff2) the app never imports (it uses Satoshi/JetBrains + `components/ws`). Not in the shipped bundle, but it's install weight, a `vite.config` icon shim, and reviewer confusion. Remove, or document as intentional scaffold retention. | proposed |
