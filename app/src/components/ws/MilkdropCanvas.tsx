import { useEffect, useRef } from "react";
import type { AudioGraphSource } from "../../lib/viz/types";
import {
  loadMilkdrop,
  type ButterchurnVisualizer,
  type MilkdropBundle,
} from "../../lib/viz/milkdrop";

interface MilkdropCanvasProps {
  /** Console AudioEngine or a companion's PcmLink; both expose the graph. */
  audio: AudioGraphSource;
  presetName: string;
  /** User-uploaded presets; looked up before the bundled library. */
  extraPresets?: Record<string, unknown>;
  /** Backing-store height in device pixels; 0 = native (CSS size x DPR). */
  resolutionHeight?: number;
  onFps?: (fps: number) => void;
  onSize?: (s: string) => void;
  className?: string;
}

/**
 * The MilkDrop engine surface: a butterchurn WebGL visualizer connected to
 * the console's analyser node. Mount only when a source is armed (the
 * analyser must exist). Preset changes blend in place without a WebGL
 * rebuild; only resolution changes remount.
 */
export function MilkdropCanvas({
  audio,
  presetName,
  extraPresets,
  resolutionHeight = 0,
  onFps,
  onSize,
  className,
}: MilkdropCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vizRef = useRef<ButterchurnVisualizer | null>(null);
  const bundleRef = useRef<MilkdropBundle | null>(null);
  const presetRef = useRef(presetName);
  const extraRef = useRef(extraPresets);
  extraRef.current = extraPresets;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let raf = 0;
    let frames = 0;
    let fpsWindowStart = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const size = (): [number, number] => {
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
      return [w, h];
    };

    void loadMilkdrop()
      .then((bundle) => {
        if (disposed) return;
        const ctx = audio.audioContext;
        const node = audio.analyserNode;
        if (!ctx || !node) return; // no source armed yet; remounts on arm
        bundleRef.current = bundle;

        const [w, h] = size();
        canvas.width = w;
        canvas.height = h;
        const viz = bundle.butterchurn.createVisualizer(ctx, canvas, {
          width: w,
          height: h,
        });
        viz.connectAudio(node);
        const preset =
          extraRef.current?.[presetRef.current] ??
          bundle.presets[presetRef.current] ??
          bundle.presets[bundle.presetNames[0]];
        viz.loadPreset(preset, 0);
        vizRef.current = viz;
        onSize?.(`${w}x${h}`);

        const ro = new ResizeObserver(() => {
          const [nw, nh] = size();
          if (canvas.width !== nw || canvas.height !== nh) {
            canvas.width = nw;
            canvas.height = nh;
            viz.setRendererSize(nw, nh);
            onSize?.(`${nw}x${nh}`);
          }
        });
        ro.observe(canvas);

        if (reduceMotion) {
          viz.render(); // one composed frame, no loop
          return;
        }

        fpsWindowStart = performance.now();
        const loop = (now: number) => {
          if (disposed) {
            ro.disconnect();
            return;
          }
          raf = requestAnimationFrame(loop);
          viz.render();
          frames++;
          if (now - fpsWindowStart >= 1000) {
            onFps?.(frames);
            frames = 0;
            fpsWindowStart = now;
          }
        };
        raf = requestAnimationFrame(loop);
      })
      .catch(() => {
        // Load failure surfaces through the console's milkdrop error state.
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      vizRef.current = null;
    };
    // onFps/onSize are stable setters from the console.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, resolutionHeight]);

  // Preset switches blend in place, 2.7s crossfade like classic MilkDrop.
  useEffect(() => {
    presetRef.current = presetName;
    const viz = vizRef.current;
    const bundle = bundleRef.current;
    if (viz && bundle) {
      const preset = extraRef.current?.[presetName] ?? bundle.presets[presetName];
      if (preset) viz.loadPreset(preset, 2.7);
    }
  }, [presetName]);

  return <canvas ref={canvasRef} className={className} />;
}
