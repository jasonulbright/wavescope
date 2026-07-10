import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Nav } from "../components/ws/Nav";
import { HeroPanel, LaunchCta } from "../components/ws/HeroPanel";
import { LiveThumb } from "../components/ws/LiveThumb";
import { Meter } from "../components/ws/Meter";
import { VizCanvas } from "../components/ws/VizCanvas";
import { MODES, modeById } from "../lib/viz/modes";
import { DEFAULT_PALETTE } from "../lib/viz/palettes";
import { getDemoEngine } from "../lib/viz/demo-singleton";

export const Route = createFileRoute("/")({
  component: Index,
});

const INPUT_MODULES = [
  {
    n: "01",
    name: "SYSTEM AUDIO",
    caption: "Capture whatever the machine is playing, YouTube Music or Spotify included.",
    icon: "/assets/icons/icon-system.png",
    band: "level" as const,
  },
  {
    n: "02",
    name: "MICROPHONE",
    caption: "Ambient capture: the room itself becomes the signal.",
    icon: "/assets/icons/icon-mic.png",
    band: "bass" as const,
  },
  {
    n: "03",
    name: "AUDIO FILE",
    caption: "Drop in a track from disk; it plays and renders locally.",
    icon: "/assets/icons/icon-file.png",
    band: "mid" as const,
  },
  {
    n: "04",
    name: "DEMO OSCILLATOR",
    caption: "A built-in test signal, no permissions needed.",
    icon: "/assets/icons/icon-sine.png",
    band: "treble" as const,
  },
];

const STEPS = [
  {
    n: "01",
    title: "Open WaveScope",
    caption: "Launch the console. It boots on the demo oscillator.",
  },
  {
    n: "02",
    title: "Choose a signal",
    caption: "System audio, microphone, or a file from disk.",
  },
  {
    n: "03",
    title: "Pick a visualizer",
    caption: "34 built-in modes, MilkDrop presets, or GPU shaders. Space cycles them.",
  },
  {
    n: "04",
    title: "Go fullscreen",
    caption: "Press F. Add more displays from the console.",
  },
];

function Index() {
  return (
    <div className="lab-grid min-h-dvh bg-paper">
      <Nav />
      <HeroPanel />
      <InputsSection />
      <GallerySection />
      <ControlRoomSection />
      <QuickstartSection />
      <FooterBanner />
    </div>
  );
}

/* Section 2: asymmetric split, top-left lead + module rack. */
function InputsSection() {
  return (
    <section className="mx-auto grid max-w-6xl gap-12 px-6 py-24 md:grid-cols-[5fr_6fr] md:gap-16 md:px-8 md:py-32">
      <div>
        <p className="readout text-ultra">AUDIO INPUT SOURCES</p>
        <h2 className="mt-4 font-display text-4xl font-bold tracking-tighter text-ink md:text-6xl">
          Feed it any signal
        </h2>
        <p className="mt-6 max-w-[52ch] font-meter text-sm leading-relaxed text-ink-soft">
          WaveScope accepts audio from any source you have: system output, a
          microphone, files on disk, or a built-in oscillator. Every input is
          analyzed at 48 kHz and visualized in real time, entirely in your
          browser. Nothing is uploaded anywhere.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {INPUT_MODULES.map((m) => (
          <div
            key={m.n}
            className="frame-hairline grid grid-cols-[auto_1fr_auto] items-center gap-5 bg-paper-raised p-5"
          >
            <img src={m.icon} alt="" className="h-10 w-10" />
            <div>
              <p className="font-meter text-sm font-bold tracking-wide text-ink">
                <span className="mr-3 text-ultra">{m.n}</span>
                {m.name}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{m.caption}</p>
            </div>
            <div className="w-24 md:w-32">
              <p className="readout mb-1.5 text-ink-soft">LEVEL</p>
              <Meter band={m.band} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* Section 3: the gallery wall. Every screen is the real mode, live. */
function GallerySection() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24 md:px-8 md:py-32">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="font-display text-4xl font-bold tracking-tighter text-ink md:text-6xl">
          34 ways to see a song
        </h2>
        <p className="mt-5 text-base leading-relaxed text-ink-soft">
          Every screen below is live: the actual math, running on a demo
          signal. Click one to open it in the console. And these built-in
          modes are only one of three engines.
        </p>
      </div>
      <div className="mt-14 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {MODES.map((m, i) => (
          <LiveThumb key={m.id} mode={m} index={i} />
        ))}
      </div>
      <dl className="mx-auto mt-16 grid max-w-4xl grid-cols-1 divide-y divide-ink/10 border-y border-ink/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[
          { big: "34 modes", small: "Built-in math, rendered off-thread up to 8K" },
          { big: "MilkDrop", small: "Real .milk presets via the projectM WASM engine" },
          { big: "GPU shaders", small: "Per-pixel WebGPU modes at full resolution" },
        ].map((e) => (
          <div key={e.big} className="px-6 py-7 text-center">
            <dt className="font-display text-2xl font-bold tracking-tight text-ink">
              {e.big}
            </dt>
            <dd className="mt-2 text-sm leading-relaxed text-ink-soft">{e.small}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* Section 4: the single material switch. Full-bleed instrument black. */
function ControlRoomSection() {
  return (
    <section
      className="relative bg-scope bg-cover bg-bottom py-24 md:py-32"
      style={{ backgroundImage: "url(/assets/plate-dark.webp)" }}
    >
      <div className="mx-auto max-w-6xl px-6 md:px-8">
        <div className="grid items-end gap-8 md:grid-cols-[3fr_2fr]">
          <h2 className="font-display text-4xl font-bold leading-none tracking-tighter text-paper md:text-7xl">
            Every display you own
          </h2>
          <p className="max-w-[40ch] font-meter text-sm leading-relaxed text-white/60">
            One console window carries the signal. Open a synced companion on
            each display: same audio, its own mode, its own resolution.
          </p>
        </div>
        <img
          src="/assets/control-room.webp"
          alt="A studio desk with three displays running WaveScope"
          className="mt-14 w-full border border-white/10"
        />
        <dl className="mt-14 grid grid-cols-1 divide-y divide-white/10 border-y border-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            { big: "8K", small: "7680x4320 render target" },
            { big: "60", small: "frames per second" },
            { big: "MULTI", small: "one window per display" },
          ].map((m) => (
            <div key={m.big} className="px-6 py-8 text-center">
              <dt className="sr-only">{m.small}</dt>
              <dd className="font-meter text-5xl font-bold text-ultra-soft md:text-6xl">
                {m.big}
              </dd>
              <dd className="readout mt-3 text-white/50">{m.small}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* Section 5: calibration procedure along a hairline rail, off-grid offsets. */
function QuickstartSection() {
  return (
    <section
      className="bg-repeat py-24 md:py-32"
      style={{ backgroundImage: "url(/assets/plate-paper.webp)" }}
    >
      <div className="mx-auto max-w-5xl px-6 md:px-8">
        <p className="readout text-ultra">QUICKSTART</p>
        <h2 className="mt-4 font-meter text-3xl font-bold tracking-tight text-ink md:text-5xl">
          From signal to spectrum<span className="text-ultra">.</span>
        </h2>
        <div className="relative mt-16 border-l border-ultra/50 pl-0">
          {STEPS.map((s, i) => (
            <div
              key={s.n}
              className={`relative flex gap-6 pb-14 last:pb-0 ${
                i % 2 ? "md:ml-[22%]" : "md:ml-[6%]"
              } ml-6`}
            >
              <span className="absolute -left-6 top-2 h-px w-5 bg-ultra/50 md:w-4" />
              <span className="frame-hairline h-fit border-ultra/60 px-2 py-1 font-meter text-xs text-ultra">
                {s.n}
              </span>
              <div>
                <h3 className="font-meter text-xl font-bold text-ink md:text-2xl">
                  {s.title}
                </h3>
                <p className="mt-1.5 max-w-[44ch] text-sm leading-relaxed text-ink-soft">
                  {s.caption}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* Section 6: framed banner with a live trace behind the headline. */
function FooterBanner() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <section className="mx-auto max-w-6xl px-6 pb-16 pt-24 md:px-8 md:pt-32">
      <div className="relative overflow-hidden border border-ultra/40 px-6 py-20 text-center md:py-24">
        {ready ? (
          <div className="pointer-events-none absolute inset-0 opacity-[0.16]">
            <VizCanvas
              mode={modeById("scope")}
              palette={DEFAULT_PALETTE}
              getFrame={() => getDemoEngine().getFrame()}
              fpsCap={30}
              className="h-full w-full"
            />
          </div>
        ) : null}
        <h2 className="relative font-display text-4xl font-bold tracking-tighter text-ink md:text-6xl">
          Put your music on screen
        </h2>
        <div className="relative mt-9 flex justify-center">
          <LaunchCta />
        </div>
      </div>
      <footer className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-ink/10 pt-6 sm:flex-row">
        <img src="/assets/monogram.webp" alt="WaveScope monogram" className="h-6 w-6" />
        <div className="flex gap-6">
          <Link to="/viz" className="font-meter text-xs text-ink-soft hover:text-ink">
            Visualizer
          </Link>
          <Link to="/docs" className="font-meter text-xs text-ink-soft hover:text-ink">
            Manual
          </Link>
        </div>
        <p className="font-meter text-xs text-ink-soft">Precision tools for seeing sound.</p>
      </footer>
    </section>
  );
}
