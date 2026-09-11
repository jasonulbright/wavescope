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
