import { useEffect, useRef } from "react";
import { getDemoEngine } from "../../lib/viz/demo-singleton";
import type { AudioFrame } from "../../lib/viz/types";

/**
 * A segmented level meter fed by the live demo signal. Each input module on
 * the landing page listens to a different slice of the signal so the rack
 * reads as four independent channels.
 */
export function Meter({ band }: { band: "level" | "bass" | "mid" | "treble" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const SEGS = 22;
    let raf = 0;
    let disposed = false;
    let last = 0;

    const paint = (value: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const segW = canvas.width / SEGS;
      const lit = Math.round(value * SEGS);
      for (let i = 0; i < SEGS; i++) {
        ctx.fillStyle =
          i < lit ? `hsla(232, 64%, ${45 + (i / SEGS) * 25}%, 1)` : "rgba(18, 23, 20, 0.12)";
        ctx.fillRect(i * segW + 1, 0, segW - 2, canvas.height);
      }
    };

    if (reduceMotion) {
      paint(0.55); // composed static state
      return;
    }

    const loop = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(loop);
      if (now - last < 66) return; // ~15fps is plenty for a meter
      last = now;
      const f: AudioFrame = getDemoEngine().getFrame();
      const v =
        band === "level" ? f.level * 1.6 : band === "bass" ? f.bass : band === "mid" ? f.mid : f.treble;
      paint(Math.min(1, v * 1.4));
    };
    raf = requestAnimationFrame(loop);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, [band]);

  return <canvas ref={canvasRef} className="h-3 w-full" aria-hidden="true" />;
}
