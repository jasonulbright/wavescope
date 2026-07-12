import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Nav } from "../components/ws/Nav";
import { MODES, FAMILIES } from "../lib/viz/modes";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "WaveScope Manual" },
      {
        name: "description",
        content:
          "The WaveScope manual: signals and Spotify, all three engines (34 built-in modes, MilkDrop presets, WebGPU shaders), resolution, multi-display, shortcuts.",
      },
    ],
  }),
  component: DocsPage,
});

const TOC = [
  { id: "signals", label: "Signals" },
  { id: "visualizers", label: "Visualizers" },
  { id: "resolution", label: "Resolution" },
  { id: "displays", label: "Multi-display" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "support", label: "Browser support" },
  { id: "math", label: "The math" },
  { id: "privacy", label: "Privacy" },
];

const SHORTCUTS: Array<[string, string]> = [
  ["Space or Right arrow", "Next visualizer"],
  ["Left arrow", "Previous visualizer"],
  ["F", "Toggle fullscreen"],
  ["H", "Hide or show the control deck"],
  ["P", "Cycle the trace palette"],
  ["S", "Cycle the shuffle timer (off, 15s–5m, DJ, VJ)"],
  ["C", "Toggle calm mode (photosensitivity-friendly)"],
  ["M", "Open companion windows on other displays"],
  ["L", "Preset lab (MilkDrop engine only)"],
  ["?", "Shortcut overlay"],
  ["Esc", "Show controls, close overlays"],
];

function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-24 border-t border-ink/10 pt-10 font-display text-3xl font-bold tracking-tight text-ink"
    >
      {children}
    </h2>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-8 font-meter text-lg font-bold text-ink">{children}</h3>;
}

function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-[70ch] text-base leading-relaxed text-ink-soft">{children}</p>;
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="frame-hairline bg-paper-raised px-1.5 py-0.5 font-meter text-xs text-ink">
      {children}
    </kbd>
  );
}

function DocsPage() {
  return (
    <div className="min-h-dvh bg-paper">
      <Nav />
      <div className="mx-auto flex max-w-6xl gap-12 px-6 py-16 md:px-8">
        {/* Rail TOC */}
        <aside className="sticky top-16 hidden h-fit w-44 shrink-0 border-l border-ultra/40 pl-4 pt-2 lg:block">
          <p className="readout text-ultra">MANUAL</p>
          <nav className="mt-4 flex flex-col gap-2">
            {TOC.map((t) => (
              <a
                key={t.id}
                href={`#${t.id}`}
                className="font-meter text-sm text-ink-soft transition-colors hover:text-ink"
              >
                {t.label}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 pb-24">
          <h1 className="font-display text-5xl font-bold tracking-tighter text-ink">
            The WaveScope manual
          </h1>
          <P>
            WaveScope is a real-time music visualizer that runs entirely in
            your browser. It analyzes an audio signal 60 times a second and
            draws it through one of three rendering engines: 34 built-in
            mathematical modes, real MilkDrop presets (the projectM engine
            compiled to WebAssembly, plus Butterchurn), and GPU-native WebGPU
            shaders. All of it renders up to 8K, fullscreen, on every display
            you own. No account, no install, no upload.
          </P>

          <div className="mt-8 flex flex-wrap gap-5">
            <Link
              to="/viz"
              className="group relative inline-block overflow-hidden border border-ultra px-6 py-3 font-meter text-sm text-ultra transition-transform active:scale-[0.98]"
            >
              <span className="absolute inset-0 -translate-x-full bg-ultra transition-transform duration-300 ease-out group-hover:translate-x-0" />
              <span className="relative transition-colors duration-300 group-hover:text-paper">
                Launch WaveScope
              </span>
            </Link>
          </div>

          {/* SIGNALS */}
          <div className="mt-16" />
          <H2 id="signals">Signals</H2>
          <P>
            The console reads one signal at a time. Arm it from the deck at the
            bottom of the screen, or from the panel that appears on first
            launch.
          </P>

          <H3>System audio (music playing on this machine)</H3>
          <P>
            Pick <em>system</em> in the deck. The browser opens its screen
            share dialog: choose a tab (for example the tab playing YouTube
            Music) or an entire screen, and tick the <em>Share audio</em>{" "}
            checkbox before confirming. WaveScope uses only the audio track;
            the shared video is never shown or recorded. If the meter stays
            flat, the share was started without the audio checkbox: stop and
            re-share with it ticked.
          </P>

          <H3>Spotify</H3>
          <P>
            The <em>spotify</em> button in the deck gets Spotify playing and
            visualized with the fewest clicks. Quick path: open Spotify,
            press play there, come back and hit <em>capture the sound</em>{" "}
            (tick Share audio in the picker). One-button mode: connect your
            Spotify account (Premium, plus a free developer app whose Client
            ID you paste once; the panel walks you through it) and the play
            button starts playback on your device remotely, with the current
            track shown in the HUD while capturing.
          </P>
          <P>
            WaveScope listens through the system capture rather than
            Spotify's own stream, which is DRM protected. Your Spotify tokens
            stay in this browser; nothing about your account touches a
            server.
          </P>

          <H3>Microphone (ambient capture)</H3>
          <P>
            Pick <em>mic</em> and allow the permission prompt. Echo
            cancellation and noise suppression are disabled on purpose so
            music is captured faithfully rather than filtered as if it were a
            phone call. This is the mode for visualizing a room, a speaker
            system, or an instrument.
          </P>

          <H3>Audio file</H3>
          <P>
            Pick <em>file</em> and choose a track from disk. It plays through
            your speakers, loops, and is analyzed locally. Any format your
            browser can play works (mp3, flac, wav, ogg, m4a in most
            browsers).
          </P>

          <H3>Demo oscillator</H3>
          <P>
            A built-in test signal: a slow synth chord progression with a
            synthetic kick drum. It needs no permissions, produces no sound,
            and exists so you can audition visualizers instantly. The landing
            page runs on it too.
          </P>

          {/* VISUALIZERS */}
          <div className="mt-14" />
          <H2 id="visualizers">Visualizers, all 34</H2>
          <P>
            Modes are grouped into five families. Cycle them with{" "}
            <Kbd>Space</Kbd>, or pick from the deck's mode menu. Each mode is
            pure math over the same analyzed frame: a 1024-bin spectrum, a
            2048-sample waveform, band energies, and a beat envelope.
          </P>
          <P>
            Prefer variety without touching anything? Set the <em>SHUFFLE</em>{" "}
            timer in the deck (or press <Kbd>S</Kbd>) and the console hops to a
            random mode every 15 seconds to 5 minutes. Each window shuffles
            independently, so a multi-display setup drifts through different
            combinations on its own. In the <em>palettes + shuffle</em> panel
            you can also let the shuffle rotate trace palettes, and check
            exactly which palettes it is allowed to pick from. The <em>VJ</em>{" "}
            option switches on the signal instead of a timer: a sustained bass
            rise reads as a drop and hard-cuts to a new preset or mode, and a
            long stretch without one morphs gently instead.
          </P>

          <H3>MilkDrop presets</H3>
          <P>
            The <em>milkdrop</em> button in the deck switches the console to a
            second render engine: Butterchurn, the WebGL port of Winamp's
            MilkDrop 2, bundled with a library of converted classic .milk
            presets (Geiss, Flexi, Martin, shifter and more). Each preset's
            equations compile to WebAssembly the moment it loads. The mode
            menu becomes a preset menu, <Kbd>Space</Kbd> and the arrows cycle
            presets with MilkDrop's classic 2.7 second blend, and the shuffle
            timer hops presets. The engine loads on demand (about 1 MB, one
            time) and needs WebGL.
          </P>
          <P>
            MilkDrop works on every display: in a companion window, click once
            to link audio and the <em>milkdrop</em> button appears there too,
            with its own preset, resolution, and shuffle. Trace palettes and
            calm mode do not apply while MilkDrop is active; presets carry
            their own colors and motion, and many flash hard, so switch back
            to the built-in engine if you need the calm guarantee. Running
            MilkDrop on several monitors at once is real GPU work; step the
            resolution down per window if frames drop.
          </P>

          <H3>The preset lab</H3>
          <P>
            While MilkDrop is active, <em>lab</em> in the deck (<Kbd>L</Kbd>)
            opens an editor on the active preset's equations: the init,
            per-frame, and per-pixel eel blocks, the same language raw .milk
            files use. <em>Apply</em> (<Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>)
            recompiles the edited copy to WebAssembly and cuts the visual to
            it against the live signal; the readout under the editor shows the
            compile time, or the compiler's error if the eel does not parse —
            the previous preset keeps running either way. <em>Save</em> stores
            the edit as one of your presets under a new name, and{" "}
            <em>export</em> downloads it as a Butterchurn JSON file.
          </P>

          <H3>The morph deck</H3>
          <P>
            Next to the lab, the <em>MORPH</em> row holds two preset slots and
            a blend-length slider (0.5–10 seconds). The arrow buttons crossfade
            the console to a slot's preset over that length using MilkDrop's
            own blend — set a long blend for slow scene changes, a short one
            for cuts. The picker and shuffle keep working; morphing just gives
            you a rehearsed transition between two presets you chose.
          </P>

          <H3>projectM: raw .milk presets</H3>
          <P>
            On browsers with WebGL2, a second MilkDrop engine is available: the{" "}
            <em>projectM</em> button in the deck. This is the real MilkDrop
            engine (libprojectM) compiled to WebAssembly, so unlike Butterchurn
            it runs <em>raw .milk preset files directly</em>, per-pixel warp
            shaders and all. Cycle presets with <Kbd>Space</Kbd> and the
            arrows, and the shuffle timer works the same way.
          </P>
          <P>
            It ships with a few starter presets, but the point is your own
            collection: <em>load .milk</em> imports raw .milk files (the entire
            15-year MilkDrop preset archive works, no conversion). Uploaded
            presets persist in your browser and can be removed while selected.
            projectM and Butterchurn are separate engines with separate preset
            lists; pick whichever the deck offers. projectM runs in the main
            console window (companion displays keep Butterchurn or the built-in
            modes).
          </P>

          <H3>GPU shader modes (WebGPU)</H3>
          <P>
            On browsers with WebGPU (Chrome and Edge today), the <em>GPU</em>{" "}
            button adds a set of GPU-native modes: each is a fragment shader
            that runs over every pixel at full resolution, up to 8K, which the
            standard modes compute on the CPU. Plasma field, Warp tunnel, and
            Fractal fold all react to the same bands and beat. Cycle them with{" "}
            <Kbd>Space</Kbd> and the arrows; the shuffle timer works too. If
            your device cannot start WebGPU, the button simply is not shown.
          </P>

          <H3>Your own Butterchurn presets</H3>
          <P>
            While the MilkDrop engine is active, <em>load preset</em> in the
            deck imports your own preset files (several at once is fine). They
            appear at the top of the preset menu under "your presets", join
            the shuffle rotation, persist in your browser, and can be removed
            with the <em>remove</em> button while selected.
          </P>
          <P>
            The Butterchurn engine takes Butterchurn JSON presets, its own
            browser-ready format, with the equations as eel source (the lab's{" "}
            <em>export</em> produces exactly this). Files from the old
            converter that carry compiled-JS equations instead are refused
            with a message — the engine no longer runs converted JavaScript.
            If you have raw .milk files, do not convert them: use the{" "}
            <em>projectM</em> engine instead, which loads them directly (see
            above). Butterchurn is the fallback for browsers without WebGL2,
            or if you already have a JSON collection. Like everything else in
            WaveScope, uploaded presets never leave your machine.
          </P>

          <H3>Calm mode</H3>
          <P>
            The <em>calm</em> toggle in the deck (<Kbd>C</Kbd>) is the
            photosensitivity-friendly setting. It removes the five modes with
            sudden beat-driven bursts (Fountain, Starfield, Tunnel, Shards,
            Pulse rings) from the picker and the shuffle, and softens the beat
            envelope so the remaining modes pulse gently instead of jumping.
            The setting is remembered per window, so a companion display can
            stay calm while the main screen runs everything.
          </P>

          <H3>Custom palettes</H3>
          <P>
            Open <em>palettes + shuffle</em> in the deck to build your own
            trace palettes: pick up to three color stops, name the palette,
            and it joins the trace menu and the shuffle list. Custom palettes
            are stored in your browser (nothing is uploaded) and can be
            deleted from the same panel.
          </P>
          {FAMILIES.map((fam) => (
            <div key={fam.id}>
              <H3>{fam.name}</H3>
              <dl className="mt-3 divide-y divide-ink/8 border-y border-ink/10">
                {MODES.filter((m) => m.family === fam.id).map((m) => (
                  <div
                    key={m.id}
                    className="grid gap-1 py-3 sm:grid-cols-[200px_1fr] sm:gap-6"
                  >
                    <dt className="font-meter text-sm font-bold text-ink">
                      {String(MODES.indexOf(m) + 1).padStart(2, "0")} {m.name}
                    </dt>
                    <dd className="text-sm leading-relaxed text-ink-soft">
                      {m.description}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}

          {/* RESOLUTION */}
          <div className="mt-14" />
          <H2 id="resolution">Resolution and performance</H2>
          <div className="mt-6 flex items-start gap-5">
            <img src="/assets/icons/icon-gauge.png" alt="" className="h-12 w-12 shrink-0" />
            <P>
              The <em>RES</em> menu sets the canvas backing store. <em>Auto</em>{" "}
              renders at your display's native pixel density and is right for
              almost everyone. Fixed targets (Full HD, QHD, 4K, 8K) render at
              that pixel height regardless of the window, then scale to fit:
              use them to drive a high-density output or to lighten the load
              on a weak GPU.
            </P>
          </div>
          <P>
            8K (7680x4320) is roughly 33 million pixels per frame. Particle
            and field modes stay smooth because their cost scales with element
            count, not pixels; full-surface modes like Plasma and Waterfall
            render internally at a fixed resolution and upscale, so they stay
            cheap at any target. If frames drop below 60 on the HUD, step the
            resolution down one notch before blaming the math.
          </P>
          <P>
            On modern browsers the console draws on a separate thread from the
            controls (via an off-screen canvas), so even a heavy 8K mode never
            makes the deck or menus stutter. Browsers without that capability
            fall back to drawing inline, which looks identical and just shares
            one thread.
          </P>

          {/* DISPLAYS */}
          <div className="mt-14" />
          <H2 id="displays">Multi-display setups</H2>
          <div className="mt-6 flex items-start gap-5">
            <img src="/assets/icons/icon-dual.png" alt="" className="h-12 w-12 shrink-0" />
            <P>
              One console window owns the signal. Press <Kbd>M</Kbd> (or the{" "}
              <em>displays</em> button) and WaveScope opens a companion window
              on each additional monitor: same signal, but each window picks
              its own mode, palette, and resolution.
            </P>
          </div>
          <P>
            Click once in each companion to <em>link audio</em>: the console
            streams its raw audio to that window, which rebuilds a full local
            audio graph from it. A linked companion has complete engine
            parity with the console, including audio-rate analysis and the
            MilkDrop engine with its own preset. (The one click is a browser
            requirement; until it happens, the window runs the built-in modes
            from broadcast analysis frames.)
          </P>
          <P>
            In Chrome and Edge, allow the <em>window management</em> permission
            when asked: companions then open positioned on each physical
            display automatically. Without it, one companion opens as a
            regular popup: drag it to the target display and press{" "}
            <Kbd>F</Kbd>. Repeat for as many displays as you have.
          </P>
          <P>
            The console must stay open: it is the analyzer. Closing it freezes
            companions within two seconds (they show a waiting notice until it
            returns).
          </P>

          {/* SHORTCUTS */}
          <div className="mt-14" />
          <H2 id="shortcuts">Keyboard shortcuts</H2>
          <div className="mt-6 flex items-start gap-5">
            <img src="/assets/icons/icon-keyf.png" alt="" className="h-12 w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <dl className="divide-y divide-ink/8 border-y border-ink/10">
                {SHORTCUTS.map(([k, d]) => (
                  <div key={k} className="grid grid-cols-[180px_1fr] gap-4 py-2.5">
                    <dt>
                      <Kbd>{k}</Kbd>
                    </dt>
                    <dd className="text-sm leading-relaxed text-ink-soft">{d}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                The deck also hides itself after three seconds of stillness;
                move the pointer to bring it back.
              </p>
            </div>
          </div>

          {/* SUPPORT */}
          <div className="mt-14" />
          <H2 id="support">Browser support</H2>
          <div className="mt-6 flex items-start gap-5">
            <img src="/assets/icons/icon-fullscreen.png" alt="" className="h-12 w-12 shrink-0" />
            <div className="min-w-0 flex-1">
              <dl className="divide-y divide-ink/8 border-y border-ink/10">
                <div className="grid gap-1 py-3 sm:grid-cols-[200px_1fr] sm:gap-6">
                  <dt className="font-meter text-sm font-bold text-ink">Chrome, Edge</dt>
                  <dd className="text-sm leading-relaxed text-ink-soft">
                    Everything works: tab and screen audio capture, microphone,
                    files, multi-display placement via window management, and
                    all three engines (built-in modes, projectM, and the
                    WebGPU shaders).
                  </dd>
                </div>
                <div className="grid gap-1 py-3 sm:grid-cols-[200px_1fr] sm:gap-6">
                  <dt className="font-meter text-sm font-bold text-ink">Firefox</dt>
                  <dd className="text-sm leading-relaxed text-ink-soft">
                    Microphone, files, and demo work; the built-in modes and
                    the projectM MilkDrop engine run. System audio capture and
                    automatic window placement are not supported; companions
                    open as popups you position yourself. The GPU engine
                    appears only if your build has WebGPU.
                  </dd>
                </div>
                <div className="grid gap-1 py-3 sm:grid-cols-[200px_1fr] sm:gap-6">
                  <dt className="font-meter text-sm font-bold text-ink">Safari</dt>
                  <dd className="text-sm leading-relaxed text-ink-soft">
                    Microphone, files, and demo work; the built-in modes run,
                    and projectM where WebGL2 is available. System audio
                    capture is not supported. The GPU engine appears only on
                    versions with WebGPU.
                  </dd>
                </div>
              </dl>
              <H3>If the canvas sits still</H3>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                Browsers suspend audio engines until you interact with the
                page: click anywhere once. If a system share shows a flat
                meter, the share was made without <em>Share audio</em> ticked.
                If the mic was blocked, re-enable it from the padlock icon in
                the address bar.
              </p>
            </div>
          </div>

          {/* MATH */}
          <div className="mt-14" />
          <H2 id="math">The math, briefly</H2>
          <P>
            The engine runs a 2048-point FFT (Blackman-windowed by the Web
            Audio analyzer) at the device sample rate, typically 48 kHz,
            smoothed at 0.8. Modes sample the 1024 magnitude bins on a
            logarithmic frequency axis, matching pitch perception. Band
            energies split at 250 Hz and 4 kHz. Onsets are detected by
            comparing instantaneous bass energy against its own moving
            average; a detected onset charges a beat envelope that decays
            exponentially, which is what makes rings drop and shards fly.
          </P>
          <P>
            Every mode is a pure function of that frame plus its own scratch
            state, drawn to a 2D canvas. Trails are painted with translucent
            background washes rather than buffers, which is why phosphor-style
            persistence costs nothing extra at 8K.
          </P>

          {/* PRIVACY */}
          <div className="mt-14" />
          <H2 id="privacy">Privacy</H2>
          <P>
            Audio is analyzed in memory, in your browser, and never leaves
            your machine. WaveScope has no accounts, stores nothing, and sends
            nothing. Screen-share capture is used only to read the audio
            track; the video is discarded.
          </P>
          <P>
            One health note: several modes flash with the beat. If you are
            sensitive to flashing imagery, turn on <em>calm mode</em> in the
            console deck (<Kbd>C</Kbd>): it excludes the burst-heavy modes and
            softens beat pulses everywhere else.
          </P>

          <div className="mt-16 border-t border-ink/10 pt-6">
            <Link to="/" className="font-meter text-sm text-ink-soft hover:text-ink">
              Back to the overview
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
