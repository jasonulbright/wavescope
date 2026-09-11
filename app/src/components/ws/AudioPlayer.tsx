import { useEffect, useState } from "react";
import type { AudioEngine, FilePlayback } from "../../lib/viz/audio-engine";
import { useFocusTrap } from "../../hooks/use-focus-trap";

const clock = (n: number) => `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
export function AudioPlayer({ engine, onClose, onChoose }: {
  engine: AudioEngine; onClose: () => void; onChoose: () => void;
}) {
  const trap = useFocusTrap<HTMLDivElement>(true);
  const [info, setInfo] = useState<FilePlayback | null>(() => engine.filePlayback);
  const [seek, setSeek] = useState<number | null>(null);
  const refresh = () => setInfo(engine.filePlayback);
  useEffect(() => {
    const timer = setInterval(() => setInfo(engine.filePlayback), 200);
    return () => clearInterval(timer);
  }, [engine]);
  const commitSeek = () => { if (seek !== null) engine.seekFile(seek); setSeek(null); refresh(); };
  return <div ref={trap} role="dialog" aria-modal="true" aria-label="Audio player" tabIndex={-1}
    className="absolute inset-0 z-20 flex items-center justify-center bg-scope/70 p-4 font-meter text-white"
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === "Escape") onClose();
      if ((e.ctrlKey || e.metaKey) && e.code === "Space") { e.preventDefault(); void engine.toggleFilePlayback().then(refresh); }
    }}>
    <div className="w-full max-w-lg border border-white/20 bg-scope p-6">
      <div className="flex items-center justify-between"><h2>Audio player</h2><button onClick={onClose}>close</button></div>
      <p className="mt-5 break-words text-sm">{info?.name ?? "No audio file loaded."}</p>
      {info ? <>
        <p className="mt-3 text-xs text-white/65" aria-label="Playback time">{clock(seek ?? info.position)} / {clock(info.duration)}</p>
        <label className="mt-4 block text-xs text-white/65">Seek position
          <input type="range" min={0} max={info.duration || 1} step={0.1} disabled={!info.seekable}
            value={seek ?? info.position} onChange={(e) => setSeek(Number(e.target.value))}
            onPointerUp={commitSeek} onKeyUp={commitSeek} onBlur={commitSeek}
            className="mt-2 w-full accent-ultra" />
        </label>
        <div className="mt-5 flex items-center gap-5 text-sm">
          <button onClick={() => void engine.toggleFilePlayback().then(refresh)}
            className="border border-ultra px-4 py-2 text-ultra-soft">{info.ended ? "Replay" : info.paused ? "Play" : "Pause"}</button>
          <label><input type="checkbox" checked={info.loop} onChange={(e) => { engine.setFileLoop(e.target.checked); refresh(); }} /> Loop file</label>
        </div>
        {info.error ? <p role="alert" className="mt-4 text-sm text-red-300">{info.error}</p> : null}
      </> : null}
      <button className="mt-5 border border-white/25 px-4 py-2 text-xs" onClick={onChoose}>Choose audio file</button>
      <p className="mt-4 text-xs text-white/50">Ctrl+Space pauses or resumes. Closing this player leaves playback running.</p>
    </div>
  </div>;
}
