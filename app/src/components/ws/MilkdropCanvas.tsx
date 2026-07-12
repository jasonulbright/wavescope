import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { AudioGraphSource } from "../../lib/viz/types";
import {
  isLegacyJsPreset,
  isLoadablePreset,
  loadMilkdrop,
  presetErrorMessage,
  type ButterchurnVisualizer,
  type MilkdropBundle,
} from "../../lib/viz/milkdrop";

/**
 * Imperative surface for deck features (preset lab, morph deck): queue a
 * preset object onto the running visualizer. Loads run in submission order;
 * a rejection carries the eel compile error and the previous preset keeps
 * rendering.
 */
export interface MilkdropApi {
  applyPreset(preset: unknown, blendSec: number): Promise<void>;
}

const LEGACY_PRESET_MESSAGE =
  "This preset carries compiled-JS equations (old converter); the engine runs eel-source presets only.";
const NOT_EEL_MESSAGE =
  "This file has no eel equations; it is not a Butterchurn preset.";

interface MilkdropCanvasProps {
  /** Console AudioEngine or a companion's PcmLink; both expose the graph. */
  audio: AudioGraphSource;
  presetName: string;
  /** User-uploaded presets; looked up before the bundled library. */
  extraPresets?: Record<string, unknown>;
  /** Backing-store height in device pixels; 0 = native (CSS size x DPR). */
  resolutionHeight?: number;
  /** Receives the imperative preset API while the visualizer is live. */
  apiRef?: MutableRefObject<MilkdropApi | null>;
  /** One-shot blend override for the NEXT preset switch (morph deck, VJ
   *  cuts). Consumed and reset to null; unset switches blend the classic
   *  2.7 s. */
  blendSecRef?: MutableRefObject<number | null>;
  /** One-line message when a preset fails to compile or is refused. */
  onPresetError?: (message: string) => void;
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
  apiRef,
  blendSecRef,
  onPresetError,
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
  const onPresetErrorRef = useRef(onPresetError);
  onPresetErrorRef.current = onPresetError;
  // Preset loads compile eel to WASM asynchronously; the queue keeps them in
  // submission order so a slow compile cannot land after a newer pick.
  const loadQueueRef = useRef<Promise<void>>(Promise.resolve());

  const applyPreset = useCallback((preset: unknown, blendSec: number) => {
    // Bind the visualizer at submission time: an entry queued for a
    // torn-down generation drops instead of loading into its successor.
    const viz = vizRef.current;
    const run = loadQueueRef.current.then(() => {
      if (!viz || vizRef.current !== viz) return;
      if (!isLoadablePreset(preset)) {
        throw new Error(
          isLegacyJsPreset(preset) ? LEGACY_PRESET_MESSAGE : NOT_EEL_MESSAGE,
        );
      }
      return viz.loadPreset(preset, blendSec);
    });
    // Keep the queue alive past a failed load; callers see the rejection.
    loadQueueRef.current = run.catch(() => {});
    return run;
  }, []);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { applyPreset };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, applyPreset]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Each visualizer generation owns its queue: a load still in flight on
    // the previous generation must not delay this one's first frame or
    // surface its late rejection here.
    loadQueueRef.current = Promise.resolve();
    let disposed = false;
    let raf = 0;
    let frames = 0;
    let fpsWindowStart = 0;
    // Held so teardown can unwire the audio edge (which otherwise pins the
    // visualizer + its WebGL context to the session-long analyser).
    let connectedNode: AudioNode | null = null;
    // Held so teardown can disconnect it: the observer outlives the render
    // loop (reduced-motion never starts one), and cleanup cancels the rAF
    // tick that would otherwise notice `disposed`. Detaching the canvas fires
    // one final zero-size callback — without the disconnect that call would
    // resize a visualizer whose GL context was just force-lost.
    let ro: ResizeObserver | null = null;
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
      .then(async (bundle) => {
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
          // Never fall back to the Function-constructor path for old JS
          // presets — the site's script policy forbids it; legacy presets
          // are refused with a message instead (isLegacyJsPreset).
          onlyUseWASM: true,
        });
        viz.connectAudio(node);
        connectedNode = node;
        vizRef.current = viz;
        const preset =
          extraRef.current?.[presetRef.current] ??
          bundle.presets[presetRef.current] ??
          bundle.presets[bundle.presetNames[0]];
        try {
          // First frame waits for the WASM compile so it shows the preset.
          await applyPreset(preset, 0);
        } catch (e) {
          if (!disposed) onPresetErrorRef.current?.(presetErrorMessage(e));
        }
        if (disposed) return;
        onSize?.(`${w}x${h}`);

        ro = new ResizeObserver(() => {
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
          if (disposed) return;
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
      .catch((e) => {
        // Engine-load rejections already surface via the console's toggle;
        // init failures (context creation, first compile) surface here.
        if (!disposed) onPresetErrorRef.current?.(presetErrorMessage(e));
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      // Unwire the audio edge and release the WebGL context, so switching
      // engines doesn't accumulate butterchurn contexts until the browser
      // force-loses the oldest (~16) and MilkDrop goes black. ProjectMCanvas
      // and WebGPUCanvas already call destroy(); this is the parity teardown.
      const viz = vizRef.current;
      if (viz && connectedNode && typeof viz.disconnectAudio === "function") {
        try {
          viz.disconnectAudio(connectedNode);
        } catch {
          // butterchurn build without disconnectAudio: the loseContext below
          // still frees the scarce GPU resource.
        }
      }
      // Release only a context the visualizer actually created: on a canvas
      // that never initialized (cleanup can run before the async init lands),
      // getContext would CREATE a context here, and losing it would kill the
      // visualizer the next effect run builds on this same element.
      if (viz) {
        const gl =
          canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        const loseCtx = gl?.getExtension("WEBGL_lose_context");
        loseCtx?.loseContext();
      }
      vizRef.current = null;
      bundleRef.current = null;
      connectedNode = null;
    };
    // onFps/onSize are stable setters from the console.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audio, resolutionHeight]);

  // Preset switches blend in place, 2.7s crossfade like classic MilkDrop.
  useEffect(() => {
    presetRef.current = presetName;
    const bundle = bundleRef.current;
    if (!vizRef.current || !bundle) return;
    const preset = extraRef.current?.[presetName] ?? bundle.presets[presetName];
    if (!preset) return;
    const blend = blendSecRef?.current ?? 2.7;
    if (blendSecRef) blendSecRef.current = null;
    let stale = false;
    applyPreset(preset, blend).catch((e) => {
      if (!stale) onPresetErrorRef.current?.(presetErrorMessage(e));
    });
    return () => {
      stale = true;
    };
    // blendSecRef is a stable ref consumed per switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetName, applyPreset]);

  return <canvas ref={canvasRef} className={className} />;
}
