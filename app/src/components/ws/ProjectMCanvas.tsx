import { useEffect, useRef, type MutableRefObject } from "react";
import type { AudioGraphSource } from "../../lib/viz/types";
import { ProjectMEngine } from "../../lib/viz/projectm";
import { presetErrorMessage } from "../../lib/viz/milkdrop";

export interface ProjectMApi {
  applyPreset(text: string, blendSec: number): Promise<void>;
}

interface ProjectMCanvasProps {
  audio: AudioGraphSource;
  /** Raw .milk preset text (parent resolves bundled fetch / upload). */
  presetText: string;
  presetName: string;
  apiRef: MutableRefObject<ProjectMApi | null>;
  blendSec: number;
  onPresetLoaded: (name: string, text: string) => void;
  onPresetError: (message: string) => void;
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
  presetName,
  apiRef,
  blendSec,
  onPresetLoaded,
  onPresetError,
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
  const nameRef = useRef(presetName);
  nameRef.current = presetName;
  const callbacks = useRef({ onPresetLoaded, onPresetError, onError });
  callbacks.current = { onPresetLoaded, onPresetError, onError };
  const loadedText = useRef("");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let raf = 0;
    let frames = 0;
    let fpsWindowStart = 0;
    let engine: ProjectMEngine | null = null;
    // Held so React cleanup can disconnect it: the observer outlives the
    // render loop (reduced-motion never starts one), and cleanup cancels the
    // rAF tick that would otherwise notice `disposed`. Detaching the canvas
    // fires one final zero-size callback — without the disconnect that call
    // would resize a destroyed engine.
    let ro: ResizeObserver | null = null;

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
        apiRef.current = {
          applyPreset: async (text, seconds) => {
            if (disposed || engineRef.current !== eng)
              throw new Error("The engine restarted. Try applying again.");
            eng.loadPresetText(text, seconds);
            loadedText.current = text;
            if (reduceMotion) {
              eng.feed(audio);
              eng.render();
            }
          },
        };
        try {
          if (presetRef.current) {
            eng.loadPresetText(presetRef.current, 0);
            loadedText.current = presetRef.current;
            callbacks.current.onPresetLoaded(nameRef.current, presetRef.current);
          }
        } catch (e) {
          callbacks.current.onPresetError(presetErrorMessage(e));
        }
        onSize?.(`${canvas.width}x${canvas.height}`);

        ro = new ResizeObserver(() => {
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
          if (disposed) return;
          try {
            eng.feed(audio);
            eng.render();
          } catch {
            callbacks.current.onError?.();
            return;
          }
          raf = requestAnimationFrame(loop);
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
      ro?.disconnect();
      engine?.destroy();
      engineRef.current = null;
      apiRef.current = null;
      loadedText.current = "";
    };
    // audio/onError/onFps/onSize are stable per mount; resolution changes remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, resolutionHeight]);

  // Preset switches crossfade in place without a WebGL rebuild.
  useEffect(() => {
    if (!engineRef.current || !presetText) return;
    try {
      if (loadedText.current !== presetText) engineRef.current.loadPresetText(presetText, blendSec);
      loadedText.current = presetText;
      callbacks.current.onPresetLoaded(presetName, presetText);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) engineRef.current.render();
    } catch (e) {
      callbacks.current.onPresetError(presetErrorMessage(e));
    }
  }, [presetText, presetName, blendSec]);

  return <canvas ref={canvasRef} className={className} />;
}
