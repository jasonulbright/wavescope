import { useEffect, useRef } from "react";
import type { AudioFrame } from "../../lib/viz/types";
import type {
  PaletteRef,
  WorkerInMsg,
  WorkerOutMsg,
} from "../../lib/viz/render-worker";

interface WorkerCanvasProps {
  modeId: string;
  paletteRef: PaletteRef;
  /** Analyzed on the MAIN thread (cheap) and posted to the worker per tick. */
  getFrame: () => AudioFrame;
  resolutionHeight: number;
  trackPointer?: boolean;
  onFps?: (fps: number) => void;
  onSize?: (s: string) => void;
  className?: string;
}

/**
 * The live worker for each transferred canvas. A canvas can be handed to a
 * worker exactly once, but React re-runs effects against the same element
 * (dev re-invokes; trackPointer can change), so the worker outlives any one
 * effect run and is only terminated once its canvas has left the DOM.
 */
const canvasWorkers = new WeakMap<HTMLCanvasElement, Worker>();

/** True when the browser can hand a canvas to a worker. */
export function workerCanvasSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof OffscreenCanvas !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype &&
    typeof Worker !== "undefined"
  );
}

/**
 * The v2 console renderer: the visualizer canvas is drawn inside a dedicated
 * worker via OffscreenCanvas, so heavy modes at high resolution never stall
 * the deck UI. The main thread keeps doing what only it can (analysis, which
 * needs the AudioContext) and posts one compact frame per tick; the worker
 * owns its own draw loop. Console-only: the 34 gallery thumbnails stay on the
 * lightweight inline VizCanvas so we never spawn 34 workers.
 */
export function WorkerCanvas({
  modeId,
  paletteRef,
  getFrame,
  resolutionHeight,
  trackPointer,
  onFps,
  onSize,
  className,
}: WorkerCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const getFrameRef = useRef(getFrame);
  const onFpsRef = useRef(onFps);
  const onSizeRef = useRef(onSize);
  getFrameRef.current = getFrame;
  onFpsRef.current = onFps;
  onSizeRef.current = onSize;

  // Latest config in refs so resize can repost without re-creating the worker.
  const cfgRef = useRef({ modeId, paletteRef, resolutionHeight });
  cfgRef.current = { modeId, paletteRef, resolutionHeight };

  // Worker lifecycle: one worker per canvas, created on the first effect run
  // that sees the element and reused by later runs (each run rebinds its own
  // pump loop, observers, and listeners). Cleanup defers termination until
  // the canvas has actually left the DOM.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let worker = canvasWorkers.get(canvas);
    const post = (msg: WorkerInMsg, transfer?: Transferable[]) =>
      transfer ? worker!.postMessage(msg, transfer) : worker!.postMessage(msg);

    if (!worker) {
      worker = new Worker(
        new URL("../../lib/viz/render-worker.ts", import.meta.url),
        { type: "module" },
      );
      canvasWorkers.set(canvas, worker);
      const offscreen = canvas.transferControlToOffscreen();
      post({ type: "init", canvas: offscreen }, [offscreen]);
    }
    workerRef.current = worker;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const postConfig = () => {
      const rect = canvas.getBoundingClientRect();
      post({
        type: "config",
        modeId: cfgRef.current.modeId,
        palette: cfgRef.current.paletteRef,
        resolutionHeight: cfgRef.current.resolutionHeight,
        cssW: Math.max(1, rect.width),
        cssH: Math.max(1, rect.height),
        dpr: window.devicePixelRatio || 1,
        reduceMotion,
      });
    };
    postConfig();

    worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
      if (e.data.type === "stats") {
        onFpsRef.current?.(e.data.fps);
        onSizeRef.current?.(`${e.data.w}x${e.data.h}`);
      }
    };

    // Main-thread pump: analysis only (microseconds), then hand off pixels.
    let raf = 0;
    let disposed = false;
    const pump = () => {
      if (disposed) return;
      raf = requestAnimationFrame(pump);
      const f = getFrameRef.current();
      // Copy out of the engine's reused buffers, then TRANSFER the copies
      // (they're throwaway) so the frame crosses threads with zero clone.
      const fft = f.fft.slice();
      const wave = f.wave.slice();
      post(
        {
          type: "frame",
          fft,
          wave,
          level: f.level,
          bass: f.bass,
          mid: f.mid,
          treble: f.treble,
          beat: f.beat,
        },
        [fft.buffer, wave.buffer],
      );
    };
    if (!reduceMotion) raf = requestAnimationFrame(pump);

    const ro = new ResizeObserver(postConfig);
    ro.observe(canvas);

    const onPointer = (ev: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      post({
        type: "pointer",
        x: (ev.clientX - rect.left) / Math.max(1, rect.width),
        y: (ev.clientY - rect.top) / Math.max(1, rect.height),
      });
    };
    const onLeave = () => post({ type: "pointer", x: null, y: null });
    if (trackPointer) {
      canvas.addEventListener("pointermove", onPointer);
      canvas.addEventListener("pointerleave", onLeave);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (trackPointer) {
        canvas.removeEventListener("pointermove", onPointer);
        canvas.removeEventListener("pointerleave", onLeave);
      }
      worker.onmessage = null;
      workerRef.current = null;
      // The transferred canvas can never be re-transferred, so the worker
      // must survive effect re-runs against a still-mounted element.
      // Terminate only once the canvas is really gone from the DOM.
      setTimeout(() => {
        if (!canvas.isConnected) {
          canvasWorkers.get(canvas)?.terminate();
          canvasWorkers.delete(canvas);
        }
      }, 0);
    };
    // Worker identity is per canvas element; config/pointer changes flow
    // through refs + the config effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackPointer]);

  // Push mode / palette / resolution changes to the running worker.
  useEffect(() => {
    const worker = workerRef.current;
    const canvas = canvasRef.current;
    if (!worker || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    worker.postMessage({
      type: "config",
      modeId,
      palette: paletteRef,
      resolutionHeight,
      cssW: Math.max(1, rect.width),
      cssH: Math.max(1, rect.height),
      dpr: window.devicePixelRatio || 1,
      reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    } satisfies WorkerInMsg);
  }, [modeId, paletteRef, resolutionHeight]);

  return <canvas ref={canvasRef} className={className} />;
}
