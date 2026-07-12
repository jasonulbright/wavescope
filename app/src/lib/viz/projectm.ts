import type { AudioGraphSource } from "./types";

/**
 * MilkDrop rendered by libprojectM compiled to WebAssembly (v2 Phase B, per
 * ROADMAP-V2.md). Unlike Butterchurn (a JS reimplementation needing presets
 * pre-converted to its own JSON), this is the real C++ engine: it runs raw
 * `.milk` presets directly, including their per-pixel warp and the ns-eel
 * expression VM.
 *
 * The WASM artifact (`app/public/projectm/projectm.{js,wasm}`) is produced by
 * the emsdk build in `C:\projects\projectm\web-wrapper`. This module loads it
 * on demand and adapts the C ABI (`sv_*` exports) to a small engine object.
 *
 * Client-only. Any failure resolves to `available:false` so the console can
 * fall back to Butterchurn cleanly.
 */

/** Bundled starter presets (raw .milk). Real value is user .milk uploads. */
export const BUNDLED_MILK: Array<{ name: string; url: string }> = [
  { name: "WaveScope Tunnel", url: "/presets-milk/wavescope-tunnel.milk" },
  { name: "WaveScope Bloom", url: "/presets-milk/wavescope-bloom.milk" },
  { name: "WaveScope Spiral", url: "/presets-milk/wavescope-spiral.milk" },
  { name: "WaveScope Nebula", url: "/presets-milk/wavescope-nebula.milk" },
  { name: "WaveScope Pulse", url: "/presets-milk/wavescope-pulse.milk" },
  { name: "WaveScope Lattice", url: "/presets-milk/wavescope-lattice.milk" },
  { name: "WaveScope Ember", url: "/presets-milk/wavescope-ember.milk" },
  { name: "WaveScope Kaleido", url: "/presets-milk/wavescope-kaleido.milk" },
  { name: "WaveScope Vortex", url: "/presets-milk/wavescope-vortex.milk" },
  { name: "WaveScope Tide", url: "/presets-milk/wavescope-tide.milk" },
  { name: "WaveScope Prism", url: "/presets-milk/wavescope-prism.milk" },
  { name: "WaveScope Comet", url: "/presets-milk/wavescope-comet.milk" },
  { name: "WaveScope Ripple", url: "/presets-milk/wavescope-ripple.milk" },
  { name: "Test: per-frame color", url: "/presets-milk/102-per_frame3.milk" },
  { name: "Test: per-frame init", url: "/presets-milk/105-per_frame_init.milk" },
];

/** The Emscripten module surface we rely on (subset). */
interface EmscriptenModule {
  cwrap: (
    name: string,
    ret: string | null,
    args: (string | null)[],
  ) => (...a: unknown[]) => unknown;
  _malloc: (bytes: number) => number;
  _free: (ptr: number) => void;
  HEAPF32: Float32Array;
}

type ProjectMFactory = (opts: {
  canvas: HTMLCanvasElement;
  locateFile?: (path: string, prefix: string) => string;
}) => Promise<EmscriptenModule>;

const GLUE_URL = "/projectm/projectm.js";

/** A live projectM instance bound to one canvas. */
export class ProjectMEngine {
  private m: EmscriptenModule;
  private fns: {
    init: (w: number, h: number, mx: number, my: number) => number;
    resize: (w: number, h: number) => void;
    loadData: (data: string, smooth: number) => void;
    addPcm: (ptr: number, count: number, channels: number) => void;
    render: () => void;
    destroy: () => void;
    maxSamples: () => number;
  };
  private pcmPtr = 0;
  private pcmCap = 0;
  private lastFeed = 0;

  private constructor(m: EmscriptenModule) {
    this.m = m;
    const w = m.cwrap.bind(m);
    this.fns = {
      init: w("sv_init", "number", ["number", "number", "number", "number"]) as never,
      resize: w("sv_resize", null, ["number", "number"]) as never,
      loadData: w("sv_load_preset_data", null, ["string", "number"]) as never,
      addPcm: w("sv_add_pcm_float", null, ["number", "number", "number"]) as never,
      render: w("sv_render", null, []) as never,
      destroy: w("sv_destroy", null, []) as never,
      maxSamples: w("sv_max_samples", "number", []) as never,
    };
  }

  static async create(
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
  ): Promise<ProjectMEngine | null> {
    const load = await loadProjectM();
    if (!load.available || !load.factory) return null;
    // Emscripten targets the canvas whose id is "canvas".
    canvas.id = "canvas";
    const m = await load.factory({
      canvas,
      locateFile: (path) => `/projectm/${path}`,
    });
    const engine = new ProjectMEngine(m);
    const rc = engine.fns.init(Math.max(1, width), Math.max(1, height), 48, 32);
    if (rc !== 0) return null;
    return engine;
  }

  resize(width: number, height: number) {
    this.fns.resize(Math.max(1, width), Math.max(1, height));
  }

  loadPresetText(text: string, smooth: boolean) {
    this.fns.loadData(text, smooth ? 1 : 0);
  }

  /**
   * Pull the latest waveform from the audio graph and feed projectM. Only the
   * samples that newly arrived since the last frame are pushed — projectM's
   * pcm_add_float ACCUMULATES, so re-sending the full 2048-sample analyser
   * window every frame (each sample fed ~30x at 60fps) drove its internal
   * beat/bass detection hot and wrong. The web analyser has no history, so we
   * take the tail of the current window sized to the elapsed wall-clock time
   * (matches the native port's new-samples-only feed, FINDINGS WS-C1 / native P1).
   */
  feed(audio: AudioGraphSource) {
    const analyser = audio.analyserNode;
    if (!analyser) return;
    const sampleRate = audio.audioContext?.sampleRate ?? 48000;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const dt = this.lastFeed ? (now - this.lastFeed) / 1000 : 1 / 60;
    this.lastFeed = now;

    const window = analyser.fftSize;
    const maxSamples = this.fns.maxSamples() || 512;
    // New audio since the last frame, clamped to what the window actually holds
    // and to projectM's per-call max. A floor of 1 keeps the engine fed if a
    // frame lands impossibly fast.
    const fresh = Math.max(
      1,
      Math.min(window, maxSamples, Math.round(sampleRate * dt)),
    );
    if (this.pcmCap < fresh) {
      if (this.pcmPtr) this.m._free(this.pcmPtr);
      this.pcmPtr = this.m._malloc(fresh * 4);
      this.pcmCap = fresh;
    }
    const buf = new Float32Array(window);
    analyser.getFloatTimeDomainData(buf);
    // Take the freshest `fresh` samples (the tail of the window).
    this.m.HEAPF32.set(buf.subarray(window - fresh), this.pcmPtr >> 2);
    this.fns.addPcm(this.pcmPtr, fresh, 1);
  }

  render() {
    this.fns.render();
  }

  destroy() {
    try {
      if (this.pcmPtr) this.m._free(this.pcmPtr);
      this.fns.destroy();
    } catch {
      // context already torn down
    }
  }
}

export interface ProjectMLoad {
  available: boolean;
  factory?: ProjectMFactory;
  reason?: string;
}

let cached: Promise<ProjectMLoad> | null = null;

/** Load the WASM engine factory if the artifact is present and WebGL2 works. */
export function loadProjectM(): Promise<ProjectMLoad> {
  if (!cached) {
    cached = (async (): Promise<ProjectMLoad> => {
      if (typeof window === "undefined") return { available: false, reason: "server" };
      // projectM needs WebGL2.
      try {
        const probe = document.createElement("canvas");
        if (!probe.getContext("webgl2")) {
          return { available: false, reason: "WebGL2 unavailable in this browser" };
        }
      } catch {
        return { available: false, reason: "WebGL2 unavailable" };
      }
      try {
        const res = await fetch(GLUE_URL, { method: "HEAD" });
        if (!res.ok) {
          return { available: false, reason: "projectM engine not deployed" };
        }
      } catch {
        return { available: false, reason: "projectM engine not reachable" };
      }
      try {
        // Vite's dev server refuses to serve /public files through the module
        // pipeline, so dev imports the glue through a blob URL. The build
        // imports the static file directly (copied as-is into dist). The
        // locateFile passed in create() resolves the .wasm path either way.
        let url = GLUE_URL;
        if (import.meta.env.DEV) {
          const glue = await (await fetch(GLUE_URL)).text();
          url = URL.createObjectURL(
            new Blob([glue], { type: "text/javascript" }),
          );
        }
        try {
          const mod = (await import(/* @vite-ignore */ url)) as {
            default: ProjectMFactory;
          };
          return { available: true, factory: mod.default };
        } finally {
          if (url !== GLUE_URL) URL.revokeObjectURL(url);
        }
      } catch {
        cached = null;
        return { available: false, reason: "projectM glue failed to load" };
      }
    })();
  }
  return cached;
}

/** Fetch a bundled .milk preset's raw text. */
export async function fetchMilkText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`preset ${url} (${res.status})`);
  return res.text();
}
