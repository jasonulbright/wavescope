import { useEffect, useRef, useState } from "react";
import type { VizMode } from "../../lib/viz/types";
import { DEFAULT_PALETTE } from "../../lib/viz/palettes";
import { getDemoEngine } from "../../lib/viz/demo-singleton";
import { VizCanvas } from "./VizCanvas";

/**
 * One gallery screen: the REAL mode running its actual math on the shared
 * demo signal, at thumbnail resolution and 24fps. Offscreen thumbs pause
 * their loop (they stay fully painted; nothing hides at opacity 0).
 */
export function LiveThumb({ mode, index }: { mode: VizMode; index: number }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [paused, setPaused] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true); // engine access is client-only
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setPaused(!entry.isIntersecting),
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <a
      ref={ref}
      href={`/viz?mode=${mode.id}`}
      className="group relative block overflow-hidden border border-ink/15 bg-scope transition-shadow duration-200 hover:shadow-[0_0_0_1px_#3346c9,0_8px_30px_-8px_rgba(51,70,201,0.45)]"
      aria-label={`Open the ${mode.name} visualizer`}
    >
      <div className="aspect-[16/10] w-full">
        {ready ? (
          <VizCanvas
            mode={mode}
            palette={DEFAULT_PALETTE}
            getFrame={() => getDemoEngine().getFrame()}
            fpsCap={24}
            paused={paused}
            className="h-full w-full"
          />
        ) : null}
      </div>
      <div className="flex items-center justify-between border-t border-white/10 px-2.5 py-1.5">
        <span className="readout text-white/55 transition-colors group-hover:text-white/85">
          MODE {String(index + 1).padStart(2, "0")} {mode.name}
        </span>
        <span className="readout text-ultra-soft opacity-0 transition-opacity group-hover:opacity-100">
          RUN
        </span>
      </div>
    </a>
  );
}
