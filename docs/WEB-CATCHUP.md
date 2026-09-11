# Web catch-up

Implementation sequence agreed on 2026-09-10. Preserve the existing site design.

1. Validate the existing test-restoration commit (`7cc3da8`).
2. Spotify: explicit client configuration, strict callbacks, serialized refresh,
   disconnect/configuration invalidation, actionable errors.
3. Input and editor reliability: isolate modal/deck shortcuts, protect unsaved
   work, hold automation while editing, preserve failed saves.
4. Preset search, favorites, and filtered automatic selection.
5. Saved pinned controls and keyboard access that survives auto-hide.
6. Audio-file transport: pause, seek, replay, loop, errors, source-switch races.
7. Engine parity: raw `.milk` editor and explicit projectM cut/morph behavior,
   with checked engine rejection and additional review.
8. Operator/audience separation: one laptop controlling one projector for a
   performing band. The operator sees the actual output and persistent controls;
   the projector receives only the rendered visual. Source setup, searches,
   editing, errors, and mouse movement must never appear in the audience feed.
   Preserve independent audio-follow companions as a separate workflow.

Each numbered implementation item gets one or more focused commits. Run the
relevant regressions and production build, then exercise the browser paths.
The engine/output changes also receive a dedicated review and correction pass.

## Baseline

- Native reference: `d70cfe0` (v1.2.1).
- Web published branch: `521da6f`; local starting point: `7cc3da8`.
- Baseline restored suite: 19 tests pass; production build and prerender pass.
- Real Spotify account authorization and physical projector operation require
  a user session; local checks must identify their coverage separately.

## Validation log

- Spotify: 13 regression cases plus production build. Strict PKCE callbacks,
  expiry/replay rejection, invalid responses, refresh concurrency and late
  disconnect/configuration responses. Setup requires an explicit Client ID.
- Input/editor: reproduced the published Spotify Right-arrow leak and verified
  it no longer changes the local visual. Escape closes the correct dialog.
  Edited a real Butterchurn preset; Escape offers save/discard/keep editing,
  cancellation preserves the draft, and duplicate Save As preserves the draft
  with an actionable error. Persistence regressions cover storage failure.
- Search/favorites: searched for Nebula, selected it without changing Radial
  Bars, saved it as a favorite, then explicitly played it. Empty searches
  disable actions. Unit coverage checks engine separation and empty pools.
- Audio transport: four lifecycle regressions cover pause/seek/replay, a late
  file rejection, superseded capture cleanup, and stale playback errors.
  Loaded an eight-second generated silent WAV in the real browser; verified
  pause, seek while paused, disabling loop, EOF Replay and continued playback
  after closing. Production build passes with 40 tests.
- Engine parity: rebuilt ABI 2 from the tracked wrapper against projectM
  `149bfc43963e54e397ccdb42f27019d22b659098`. The wrapper owns failure callbacks,
  context activation and explicit blend duration. Queried asset URLs prevent
  an old service-worker entry from pairing ABI 1 with the new adapter.
  In the real WASM engine, `per_frame_1=zoom = ( ;` reports a line/column syntax
  error while WaveScope Tunnel continues rendering. Verified discard and a
  named ten-second morph to Bloom. The build passes with 41 tests.
- Audience output: seven lifecycle regressions cover the handshake, stale
  playback promises, renderer replacement, blackout, closed windows, navigation,
  blocked popups and capture/playback errors. Live local output reports decoded
  1920×1080 frames, including after a projectM/Butterchurn switch. The operator
  layout keeps its 16:9 preview, performance controls and setup deck separate.
  Production build passes with 48 tests. See `VENUE-WORKFLOW.md`.
- Dedicated review corrections: audience HTML cannot replace the offline
  console shell or fall back to console UI; cache v3 purges the old entries.
  Spotify storage failures invalidate the current tab and reject late refresh.
  Preset queues reject work from a retired engine, including a load already
  compiling at teardown. projectM transition duration travels with the resolved
  preset, so a cancelled morph cannot alter a later pick. Busy editor fields
  cannot receive changes that an in-flight save would overwrite.
- Final local production verification used the built static files with the
  repository's Vercel security headers. All four engines supplied decoded
  audience frames. Verified 1080p Auto, a live Butterchurn change to 1440p,
  blackout through an engine switch, restoration, and output close/reopen.
  F5 from a focused deck button opened the player without reloading.
  A fresh console restored pinned controls and an engine-scoped favorite.
  H hid the deck; Tab revealed it and focused its first control.
  Final build, typecheck, prerender and all 54 tests pass.

## Delivered commits

| Item | Commits |
|---|---|
| Restored tests and deploy-build gate | `7cc3da8` (existing starting commit) |
| Spotify lifecycle and configuration | `3ca0b21`, `b3f44e6` |
| Input isolation and unsaved editor work | `f6e105f`, `75c2068` |
| Search, favorites and filtered automation | `22ba26e` |
| Saved controls and keyboard access | `6d561d9` |
| File transport and source races | `74736f4`, `68fe6d6` |
| Checked projectM, raw lab, morph parity and review fixes | `b406737`, `75c2068`, `68fe6d6` |
| Audience output, performance layout and offline isolation | `dbe5ab2`, `9e32faa` |

The manual and README accompany the implementation. The existing landing-page
design is preserved. No production deployment or GitHub push is part of this
session. Real Spotify authorization/playback and physical projector/OBS
operation remain environment-specific acceptance checks; they were not claimed
by the local test run.
