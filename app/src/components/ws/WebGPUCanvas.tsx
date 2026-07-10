import { useEffect, useRef } from "react";
import type { AudioFrame } from "../../lib/viz/types";
import { WebGPURenderer, gpuModeById } from "../../lib/viz/webgpu";

interface WebGPUCanvasProps {
  modeId: string;
  getFrame: () => AudioFrame;
  resolutionHeight: number;
  onFps?: (fps: number) => void;
  onSize?: (s: string) => void;
  /** Called if WebGPU cannot start, so the console can fall back. */
  onError?: () => void;
  className?: string;
}

/**
 * Renders the GPU-native WGSL modes: a fragment shader runs over every pixel
 * at full resolution (up to 8K) each frame, driven by the live audio frame.
 * Mirrors VizCanvas/ProjectMCanvas so the console can pick this engine.
 */
export function WebGPUCanvas({
  modeId,
  getFrame,
  resolutionHeight,
  onFps,
  onSize,
  onError,
  className,
}: WebGPUCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(modeId);
  modeRef.current = modeId;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let raf = 0;
    let frames = 0;
    let fpsWindowStart = 0;
    let renderer: WebGPURenderer | null = null;

    const size = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(1, rect.width);
      const cssH = Math.max(1, rect.height);
      let h = resolutionHeight > 0 ? resolutionHeight : Math.round(cssH * dpr);
      let w = Math.round(h * (cssW / cssH));
      if (w > 7680) {
        h = Math.round(h * (7680 / w));
        w = 7680;
      }
      w = Math.max(1, w);
      h = Math.max(1, h);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        onSize?.(`${w}x${h}`);
      }
    };

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    void WebGPURenderer.create(canvas)
      .then((r) => {
        if (disposed) {
          r?.destroy();
          return;
        }
        if (!r) {
          onError?.();
          return;
        }
        renderer = r;
        size();

        let errCount = 0;
        const loop = (now: number) => {
          if (disposed) return;
          raf = requestAnimationFrame(loop);
          size();
          try {
            r.render(gpuModeById(modeRef.current), getFrame());
            errCount = 0;
          } catch {
            // Context loss or driver hiccup: tolerate a few, then fall back.
            if (++errCount > 30) {
              cancelAnimationFrame(raf);
              onError?.();
              return;
            }
          }
          frames++;
          if (now - fpsWindowStart >= 1000) {
            onFps?.(frames);
            frames = 0;
            fpsWindowStart = now;
          }
        };
        if (reduceMotion) {
          size();
          r.render(gpuModeById(modeRef.current), getFrame());
        } else {
          fpsWindowStart = performance.now();
          raf = requestAnimationFrame(loop);
        }
      })
      .catch(() => {
        if (!disposed) onError?.();
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      renderer?.destroy();
    };
    // getFrame/callbacks stable per mount; resolution change remounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolutionHeight]);

  return <canvas ref={canvasRef} className={className} />;
}
