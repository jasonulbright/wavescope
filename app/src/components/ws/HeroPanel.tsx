import { useEffect, useRef, useState } from "react";
import { getDemoEngine } from "../../lib/viz/demo-singleton";
import type { AudioEngine } from "../../lib/viz/audio-engine";

/**
 * The Tier-1 mechanic (catalog C2, canvas/pixel family): the hero IS a
 * running WaveScope instrument. A particle waveform field idles on the demo
 * signal, bends toward the visitor's cursor, and can be re-armed to the
 * visitor's microphone with one click: the visitor becomes the signal.
 *
 * Screenshot safety: the generated hero artwork paints as the panel's CSS
 * background before any JS runs, and the first canvas frame composes the full
 * field immediately. Reduced motion: artwork + static readouts, no loop.
 */

interface Particle {
  x: number; // 0-1 across the panel
  base: number; // resting vertical position, 0-1
  y: number; // current y in px
  vy: number;
  jitter: number;
  size: number;
}

export function HeroPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [micState, setMicState] = useState<"idle" | "live" | "denied">("idle");
  const [readout, setReadout] = useState({ db: "-60.0", hz: "0", src: "DEMO" });
  const engineRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return; // artwork + static chrome only

    const engine = getDemoEngine();
    engineRef.current = engine;

    let raf = 0;
    let disposed = false;
    let pointer: { x: number; y: number } | null = null;
    let particles: Particle[] = [];
    let readoutClock = 0;

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        const isCoarse = window.matchMedia("(pointer: coarse)").matches;
        const count = Math.min(isCoarse ? 1200 : 2400, Math.floor((w * h) / 700));
        particles = Array.from({ length: count }, (_, i) => {
          const x = (i / count + Math.random() * 0.002) % 1;
          return {
            x,
            base: 0.5 + (Math.random() - 0.5) * 0.22 * Math.sin(x * Math.PI),
            y: 0,
            vy: 0,
            jitter: Math.random(),
            size: 0.6 + Math.random() * 1.6,
          };
        });
      }
    };

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      pointer = { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
    };
    const onLeave = () => (pointer = null);
    canvas.addEventListener("pointermove", onPointer);
    canvas.addEventListener("pointerleave", onLeave);

    const draw = () => {
      if (disposed) return;
      raf = requestAnimationFrame(draw);
      size();
      const f = engine.getFrame();
      const w = canvas.width;
      const h = canvas.height;

      // Translucent wash for short phosphor trails over the artwork.
      ctx.fillStyle = "rgba(11, 13, 12, 0.32)";
      ctx.fillRect(0, 0, w, h);

      const wave = f.wave;
      const amp = h * (0.1 + f.level * 0.9);
      for (const p of particles) {
        const wi = Math.floor(p.x * (wave.length - 1));
        const s = (wave[wi] - 128) / 128;
        const bell = Math.sin(p.x * Math.PI) ** 1.5;
        let target = p.base * h + s * amp * bell + Math.sin(f.t * 0.7 + p.jitter * 9) * h * 0.02;
        if (pointer) {
          const dx = p.x * w - pointer.x;
          const dy = target - pointer.y;
          const d2 = dx * dx + dy * dy;
          const R = (w * 0.09) ** 2;
          if (d2 < R) {
            // Cursor pressure: the field parts around the visitor.
            target += (dy / Math.sqrt(d2 + 1)) * (1 - d2 / R) * h * 0.12;
          }
        }
        p.vy += (target - p.y) * 0.12;
        p.vy *= 0.72;
        p.y += p.vy;
        const e = f.fft[Math.floor(p.x * 300)] / 255;
        ctx.fillStyle = `hsla(232, 66%, ${55 + e * 30}%, ${0.25 + e * 0.6 + f.beat * 0.15})`;
        const sz = p.size * (1 + f.beat * 0.7) * (w / 1600);
        ctx.fillRect(p.x * w, p.y, Math.max(1, sz), Math.max(1, sz));
      }

      // Live readouts twice a second.
      readoutClock += f.dt;
      if (readoutClock > 0.5) {
        readoutClock = 0;
        const db = f.level > 0.0005 ? (20 * Math.log10(f.level)).toFixed(1) : "-60.0";
        let peak = 0;
        let peakIdx = 0;
        for (let i = 2; i < 512; i++) {
          if (f.fft[i] > peak) {
            peak = f.fft[i];
            peakIdx = i;
          }
        }
        const hz = Math.round((peakIdx * 24000) / 1024).toString();
        setReadout({
          db,
          hz,
          src: engine.source?.kind === "mic" ? "MIC" : "DEMO",
        });
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointermove", onPointer);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const armMic = async () => {
    try {
      const engine = engineRef.current ?? getDemoEngine();
      await engine.startMic();
      setMicState("live");
    } catch {
      setMicState("denied");
    }
  };

  return (
    <div className="relative overflow-hidden bg-scope">
      {/* Generated hero artwork: visible before JS, under the live field after. */}
      <img
        src="/assets/hero-field.webp"
        alt="Particle waveform rendered by WaveScope"
        className="absolute inset-0 h-full w-full object-cover opacity-70"
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {/* Panel chrome: live instrument readouts. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-4 border-b border-white/10 px-4 py-2 md:px-6">
        <span className="readout text-white/60">CH-01 INPUT LEVEL {readout.db} dB</span>
        <span className="readout hidden text-white/60 md:inline">
          CH-02 PEAK {readout.hz} Hz
        </span>
        <span className="readout hidden text-white/60 lg:inline">TIME BASE 16.7 ms/div</span>
        <span className="readout text-ultra-soft">SRC {readout.src}</span>
      </div>

      {/* The mic arm chip: the visitor becomes the signal. */}
      <div className="absolute right-4 top-12 md:right-6">
        {micState !== "live" ? (
          <button
            onClick={armMic}
            className="pointer-events-auto border border-white/25 bg-scope/60 px-3 py-2 font-meter text-xs text-white/85 backdrop-blur transition-colors hover:border-ultra-soft hover:text-white active:scale-[0.98]"
          >
            {micState === "denied" ? "mic blocked, check permissions" : "visualize my room: arm mic"}
          </button>
        ) : (
          <span className="readout border border-ultra/60 bg-scope/60 px-3 py-2 text-ultra-soft">
            MIC LIVE
          </span>
        )}
      </div>

      {/* Hero copy: max 4 text elements, bottom-left over the panel. */}
      <div className="relative flex min-h-[72dvh] flex-col justify-end p-6 pt-40 md:p-12">
        <h1 className="build-rise max-w-3xl font-display text-5xl font-bold leading-none tracking-tighter text-paper md:text-7xl">
          Sound, drawn live.
        </h1>
        <p className="build-rise-2 mt-4 max-w-[48ch] text-base leading-relaxed text-white/70">
          Turn any audio into an instrument-grade light show, at up to 8K, on
          every display you own.
        </p>
        <div className="build-rise-3 mt-7 flex flex-wrap items-center gap-6">
          <LaunchCta />
          <ManualLink />
        </div>
      </div>

      {/* Bottom rail. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden items-center justify-between border-t border-white/10 px-6 py-2 md:flex">
        <span className="readout text-white/45">CH-03 FFT 2048 pt</span>
        <span className="readout text-white/45">CH-04 OUTPUT 60 fps</span>
        <span className="readout text-white/45">SYSTEM 48.0 kHz</span>
      </div>
    </div>
  );
}

/**
 * Primary CTA: framed block; on hover an ultramarine trace sweeps the fill.
 * Its own component with its own interaction identity (bespoke chrome).
 */
export function LaunchCta() {
  return (
    <a
      href="/viz"
      className="group pointer-events-auto relative inline-block overflow-hidden border border-ultra px-7 py-3.5 font-meter text-sm text-ultra-soft transition-transform active:scale-[0.98]"
    >
      <span className="absolute inset-0 -translate-x-full bg-ultra transition-transform duration-300 ease-out group-hover:translate-x-0" />
      <span className="relative transition-colors duration-300 group-hover:text-paper">
        Launch WaveScope
      </span>
    </a>
  );
}

/**
 * Secondary CTA: inline mono link whose underline draws like a sweep.
 */
export function ManualLink({ dark = true }: { dark?: boolean }) {
  return (
    <a
      href="/docs"
      className={`group pointer-events-auto relative font-meter text-sm ${
        dark ? "text-white/75 hover:text-white" : "text-ink-soft hover:text-ink"
      } transition-colors`}
    >
      Manual
      <span className="ml-2 inline-block transition-transform group-hover:translate-x-1">
        &rarr;
      </span>
      <span
        className={`absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 ${
          dark ? "bg-ultra-soft" : "bg-ultra"
        } transition-transform duration-300 ease-out group-hover:scale-x-100`}
      />
    </a>
  );
}
