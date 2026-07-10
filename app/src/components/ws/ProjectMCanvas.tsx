import { useEffect, useRef } from "react";
import type { AudioGraphSource } from "../../lib/viz/types";
import { ProjectMEngine } from "../../lib/viz/projectm";

interface ProjectMCanvasProps {
  audio: AudioGraphSource;
  /** Raw .milk preset text (parent resolves bundled fetch / upload). */
  presetText: string;
  resolutionHeight: number;
  onFps?: (fps: number) => void;
  onSize?: (s: string) => void;
  /** Called if the engine cannot start, so the console can fall back. */
  onError?: () => void;
  className?: string;
}

/**
 * Renders MilkDrop presets with the real libprojectM engine (WASM). The
 * engine owns a WebGL2 context on this canvas; we drive a render loop that
 * feeds it PCM from the audio graph and renders one frame per tick. Preset
 * changes crossfade in place (projectM's own soft-cut). Mirrors
 * MilkdropCanvas so the console can pick either engine.
 */
export function ProjectMCanvas({
  audio,
  presetText,
  resolutionHeight,
  onFps,
  onSize,
  onError,
  className,
}: ProjectMCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ProjectMEngine | null>(null);
  const presetRef = useRef(presetText);
  presetRef.current = presetText;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let raf = 0;
    let frames = 0;
    let fpsWindowStart = 0;
    let engine: ProjectMEngine | null = null;

    const backingSize = (): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(1, rect.width);
      const cssH = Math.max(1, rect.height);
      let h = resolutionHeight > 0 ? resolutionHeight : Math.round(cssH * dpr);
      // projectM runs on a fixed WASM heap, so cap its backing store at 1440p
      // (MilkDrop warp looks great there; the built-in modes still reach 8K).
      if (h > 1440) h = 1440;
      let w = Math.round(h * (cssW / cssH));
      if (w > 2560) {
        h = Math.round(h * (2560 / w));
        w = 2560;
      }
      return [Math.max(1, w), Math.max(1, h)];
    };

    const [w0, h0] = backingSize();
    canvas.width = w0;
    canvas.height = h0;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    void ProjectMEngine.create(canvas, w0, h0)
      .then((eng) => {
        if (disposed) {
          eng?.destroy();
          return;
        }
        if (!eng) {
          onError?.();
          return;
        }
        engine = eng;
        engineRef.current = eng;
        if (presetRef.current) eng.loadPresetText(presetRef.current, false);
        onSize?.(`${canvas.width}x${canvas.height}`);

        const ro = new ResizeObserver(() => {
          const [w, h] = backingSize();
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
            eng.resize(w, h);
            onSize?.(`${w}x${h}`);
          }
        });
        ro.observe(canvas);

        const loop = (now: number) => {
          if (disposed) {
            ro.disconnect();
            return;
          }
          raf = requestAnimationFrame(loop);
          eng.feed(audio);
          eng.render();
          frames++;
          if (now - fpsWindowStart >= 1000) {
            onFps?.(frames);
            frames = 0;
            fpsWindowStart = now;
          }
        };
        if (reduceMotion) {
          eng.feed(audio);
          eng.render(); // one composed frame
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
      engine?.destroy();
      engineRef.current = null;
    };
    // audio/onError/onFps/onSize are stable per mount; resolution changes remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolutionHeight]);

  // Preset switches crossfade in place without a WebGL rebuild.
  useEffect(() => {
    if (engineRef.current && presetText) {
      engineRef.current.loadPresetText(presetText, true);
    }
  }, [presetText]);

  return <canvas ref={canvasRef} className={className} />;
}
