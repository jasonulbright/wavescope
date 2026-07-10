# WaveScope Web — 5-minute demo checklist

A browser walkthrough of the live app. Each step lists the expected result;
anything else is a bug worth filing. Before starting: `cd app && bun install`,
then `bun run typecheck`, `bun test src/lib` (29 pass), `bun run build`. Drive
either the deployed site or a local static serve of `app/dist/client`.

> Note: `bun run dev` (the SSR dev server) currently crashes under the bun
> package linker in some sandboxes (`ReferenceError: module is not defined` from
> React's CJS entry during SSR). The app ships as a **static SPA**, so verify
> against the built `dist/client` (any static host with an index.html fallback);
> that is exactly what deploys.

## 1. Sources (60 s)

- [ ] Open `/viz`. → The "Arm a signal" overlay shows four sources; the HUD
      top-left reads `SRC STANDBY`.
- [ ] Click **Demo oscillator**. → The overlay closes, the radial-bars mode
      moves on the synthetic chord + kick, HUD shows `SRC DEMO`, `FPS` healthy.
- [ ] Click **mic** in the deck and allow the prompt. → Visuals follow the room.
      Deny it instead → a clear error toast, no crash.
- [ ] Click **file**, pick an MP3/FLAC. → It plays audibly and drives the
      visuals; pick a different file → the track switches.
- [ ] Click **system**, share a tab/screen with "Share audio" ticked. → Follows
      the machine's audio. (Without the audio tick → a helpful error, no crash.)

## 2. Engines (60 s)

- [ ] Press `SPACE` / `→` a few times. → Modes advance; HUD `MODE` name changes.
      The `←`/`→` deck arrows and the mode dropdown do the same.
- [ ] Click **GPU** (if the badge is present). → WebGPU shaders; Spectrum bars
      and Scope lines clearly track the FFT/waveform. Absent on browsers without
      `navigator.gpu` — that's the capability gate, not a bug.
- [ ] Click **projectM**. → Real MilkDrop preset (opens on WaveScope Tunnel),
      reacting to the beat. `SPACE` cycles presets. It should react *musically*,
      not frantically (the PCM-overfeed fix).
- [ ] Click **milkdrop**. → Butterchurn engine with the classic library.
- [ ] **Switch engines back and forth ~20 times** (WaveScope ⇄ milkdrop ⇄
      projectM). → No progressive slowdown, and MilkDrop never goes permanently
      black. (Open DevTools console: no "Too many active WebGL contexts"
      warning — the WS-L1 leak fix.)

## 3. Palettes, shuffle, calm (45 s)

- [ ] Press `P` twice → trace palette changes. Use the **TRACE** dropdown too.
- [ ] Click **palettes + shuffle** → the panel opens. Tab through it: focus
      stays inside the dialog and returns to the button on `Esc`/close (a11y).
      Build a 3-stop custom palette, name it, add it → it becomes active.
- [ ] Press `S` until the **SHUFFLE** readout shows `DJ`. → Within 30 s the app
      hops ENGINE + visual on its own. Set it back to `off`.
- [ ] Press `C` (calm). → Burst modes (Fountain, Tunnel, Shards…) leave the
      rotation and the beat softens; HUD notes it. Press `C` again.

## 4. Record + companion (45 s)

- [ ] Press `R` (or **rec (R)**), let it run ~10 s, press `R` again. → A
      `wavescope-<timestamp>.webm` downloads; it plays with the visuals + the
      analysed audio.
- [ ] Click **displays**. → On Chrome/Edge with the Window Management permission,
      a companion opens per extra monitor (`?follow=1`); elsewhere one popup you
      drag over. Click it once → it links its own audio graph and runs any engine
      in sync with the console.

## 5. Spotify (30 s, needs a Spotify account)

- [ ] Click **spotify** → the panel opens (focus-trapped). "Connect Spotify"
      runs OAuth PKCE with a `state` param; after approving, it returns to `/viz`
      and (Premium) can start playback, captured via system loopback. The HUD
      shows `PLAYING track — artist`.
- [ ] A tampered return (wrong `state`) is rejected — the token exchange doesn't
      run.

## 6. Accessibility + reduced motion (30 s)

- [ ] Enable OS "reduce motion" and reload. → Each engine paints one composed
      frame and holds it (no animation loop).
- [ ] Keyboard-only: `Tab` reaches every deck control; open any overlay and
      confirm focus is trapped and restored on close; a screen reader announces
      the HUD (`role=status aria-live`).

## 7. Security headers (30 s, against a deploy / preview)

- [ ] `curl -sI https://<preview-or-prod>/viz | grep -i content-security-policy`
      → a CSP is present; `connect-src` is limited to self + Spotify.
- [ ] `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a
      `Permissions-Policy` scoping microphone/display-capture are all present.
