import type { OutputState } from "../../lib/viz/audience-output";
import { useFocusTrap } from "../../hooks/use-focus-trap";

export function OutputPanel({ state, onOpen, onStop, onBlackout, onClose }: {
  state: OutputState; onOpen: () => void; onStop: () => void; onBlackout: () => void; onClose: () => void;
}) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  const button = "border border-white/25 px-4 py-2 text-sm hover:border-white/70";
  return <div ref={ref} role="dialog" aria-modal="true" aria-label="Audience output" tabIndex={-1}
    className="absolute inset-0 z-20 flex items-center justify-center bg-scope/70 p-4 font-meter text-white"
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Escape") onClose(); }}>
    <div className="w-full max-w-lg border border-white/20 bg-scope p-6">
      <div className="flex items-center justify-between"><h2>Audience output</h2><button onClick={onClose}>close</button></div>
      <p className="mt-4 text-sm text-white/70">Keep this console on your laptop. Move the audience window to the projector, then double-click it or press F for fullscreen.</p>
      <p className="mt-3 text-sm text-white/60">The audience sees the same visual as your preview. Controls, searches, editor windows and errors stay here.</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button className={button} onClick={onOpen}>{state.open ? "Focus audience window" : "Open audience window"}</button>
        {state.open ? <>
          <button className={button} onClick={onBlackout}>{state.blackout ? "Restore picture" : "Blackout output"}</button>
          <button className={button} onClick={onStop}>Close output</button>
        </> : null}
      </div>
      <p role="status" className="mt-4 text-xs text-white/65">{state.open ? state.linked ? `Connected · ${state.size}${state.blackout ? " · BLACKOUT" : ""}` : "Waiting for the visual…" : "Output closed"}</p>
      {state.error ? <p role="alert" className="mt-3 text-sm text-red-300">{state.error}</p> : null}
      <p className="mt-4 text-xs text-white/50">Use extended desktop mode. In OBS, capture the audience window. Keep the console open and visible while performing.</p>
    </div>
  </div>;
}
