import { useEffect, useRef } from "react";
import type { AudioFrame, VizMode, VizPalette } from "../../lib/viz/types";

interface VizCanvasProps {
  mode: VizMode;
  palette: VizPalette;
  /** Called once per animation frame to fetch the analyzed audio. */
  getFrame: () => AudioFrame;
  /**
   * Backing-store height in device pixels; 0 = native (CSS size x DPR).
   * Width follows the element's aspect ratio.
   */
  resolutionHeight?: number;
  /** Cap the draw rate (thumbnails run at 30 to keep 30+ canvases cheap). */
  fpsCap?: number;
  /** Track the pointer and hand it to the mode (swarm etc.). */
  trackPointer?: boolean;
  /** Reported once a second; drives the HUD fps readout. */
  onFps?: (fps: number) => void;
  paused?: boolean;
  className?: string;
}

/**
 * The core renderer: one canvas, one rAF loop, one mode.
 * Client-only by construction (everything lives in useEffect).
 */
export function VizCanvas({
  mode,
  palette,
  getFrame,
  resolutionHeight = 0,
  fpsCap,
  trackPointer,
  onFps,
  paused,
  className,
}: VizCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  const paletteRef = useRef(palette);
  const pausedRef = useRef(paused);
  modeRef.current = mode;
  paletteRef.current = palette;
  pausedRef.current = paused;
  const stateRef = useRef<Record<string, unknown>>({});
  const prevModeId = useRef(mode.id);
  if (prevModeId.current !== mode.id) {
    prevModeId.current = mode.id;
    stateRef.current = {};
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let disposed = false;
    let lastDraw = 0;
    let frames = 0;
    let fpsWindowStart = performance.now();
    let pointer: { x: number; y: number } | null = null;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(1, rect.width);
      const cssH = Math.max(1, rect.height);
      let bh = resolutionHeight > 0 ? resolutionHeight : Math.round(cssH * dpr);
      let bw = Math.round(bh * (cssW / cssH));
      // 8K guard: clamp the wide edge to 7680 so ultra-wide monitors at the
      // 4320 setting don't allocate beyond the advertised ceiling.
      if (bw > 7680) {
        bh = Math.round(bh * (7680 / bw));
        bw = 7680;
      }
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
        ctx.fillStyle = paletteRef.current.bg;
        ctx.fillRect(0, 0, bw, bh);
      }
    };

    const onPointer = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    };
    const onLeave = () => {
      pointer = null;
    };
    if (trackPointer) {
      canvas.addEventListener("pointermove", onPointer);
      canvas.addEventListener("pointerleave", onLeave);
    }

    const draw = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(draw);
      if (pausedRef.current) return;
      if (fpsCap && now - lastDraw < 1000 / fpsCap - 1) return;
      lastDraw = now;
      size();
      const f = getFrame();
      const m = modeRef.current;
      const p = paletteRef.current;
      const fade = m.fade ?? 1;
      ctx.globalAlpha = 1;
      if (fade >= 1) {
        ctx.fillStyle = p.bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.fillStyle = p.bg;
        ctx.globalAlpha = fade;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
      }
      m.draw({
        ctx,
        w: canvas.width,
        h: canvas.height,
        f,
        p,
        state: stateRef.current,
        pointer,
      });
      frames++;
      if (now - fpsWindowStart >= 1000) {
        onFps?.(frames);
        frames = 0;
        fpsWindowStart = now;
      }
    };

    size();
    if (reduceMotion) {
      // Reduced motion: paint ONE composed frame and hold it static.
      const f = getFrame();
      ctx.fillStyle = paletteRef.current.bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      modeRef.current.draw({
        ctx,
        w: canvas.width,
        h: canvas.height,
        f,
        p: paletteRef.current,
        state: stateRef.current,
        pointer: null,
      });
    } else {
      raf = requestAnimationFrame(draw);
    }

    const ro = new ResizeObserver(size);
    ro.observe(canvas);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (trackPointer) {
        canvas.removeEventListener("pointermove", onPointer);
        canvas.removeEventListener("pointerleave", onLeave);
      }
    };
    // getFrame is stable per mount for every caller; mode/palette flow through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolutionHeight, fpsCap, trackPointer]);

  return <canvas ref={canvasRef} className={className} />;
}
