import { useEffect, useRef, useState } from "react";
import { presetErrorMessage } from "../../lib/viz/milkdrop";

/**
 * The preset lab: edits the active MilkDrop preset's eel equations in place.
 * Apply hands an edited copy of the preset object to the running visualizer
 * (Butterchurn 3 compiles the eel source to WebAssembly and rejects with the
 * compile error, which lands in the status readout). Save stores the edit as
 * a custom preset under a new name; export downloads it as JSON.
 */

interface PresetLabProps {
  /** Name of the preset the editor is seeded from. */
  presetName: string;
  /** The active preset object (bundled or custom); null while loading. */
  base: unknown;
  /** Compile + show an edited preset now (hard cut). Rejects on eel errors. */
  onApply: (edited: Record<string, unknown>) => Promise<void>;
  /** Persist the edit as a custom preset and switch the picker to it. */
  onSaveAs: (name: string, preset: Record<string, unknown>) => void;
  onClose: () => void;
}

type LabStatus =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "ok"; ms: number }
  | { kind: "err"; message: string };

/** The three eel blocks the editor exposes. */
const EEL_FIELDS = [
  { key: "init_eqs_eel", label: "INIT" },
  { key: "frame_eqs_eel", label: "PER FRAME" },
  { key: "pixel_eqs_eel", label: "PER PIXEL" },
] as const;

function eelField(base: unknown, key: string): string {
  if (!base || typeof base !== "object") return "";
  const v = (base as Record<string, unknown>)[key];
  return typeof v === "string" ? v : "";
}

/** Deep copy of the base with the edited eel fields written in. */
function buildEdited(
  base: unknown,
  eqs: Record<string, string>,
): Record<string, unknown> {
  const copy =
    base && typeof base === "object"
      ? (structuredClone(base) as Record<string, unknown>)
      : {};
  for (const f of EEL_FIELDS) copy[f.key] = eqs[f.key];
  return copy;
}

export function PresetLab({
  presetName,
  base,
  onApply,
  onSaveAs,
  onClose,
}: PresetLabProps) {
  const [eqs, setEqs] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [status, setStatus] = useState<LabStatus>({ kind: "idle" });
  const busyRef = useRef(false);

  // Re-seed the editor whenever the picked preset changes.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of EEL_FIELDS) next[f.key] = eelField(base, f.key);
    setEqs(next);
    setName(`${presetName} (edit)`);
    setStatus({ kind: "idle" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetName]);

  const apply = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus({ kind: "busy" });
    const t0 = performance.now();
    onApply(buildEdited(base, eqs))
      .then(() => setStatus({ kind: "ok", ms: Math.round(performance.now() - t0) }))
      .catch((e) => setStatus({ kind: "err", message: presetErrorMessage(e) }))
      .finally(() => {
        busyRef.current = false;
      });
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(buildEdited(base, eqs), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || presetName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="absolute bottom-24 right-4 top-16 z-10 flex w-[380px] max-w-[85vw] flex-col border border-white/15 bg-scope/95 p-4"
      role="region"
      aria-label="Preset lab"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          apply();
        }
      }}
    >
      <div className="flex items-baseline justify-between">
        <p className="readout text-ultra-soft">PRESET LAB</p>
        <button
          onClick={onClose}
          aria-label="Close the preset lab"
          className="border border-white/15 px-2 py-1 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white"
        >
          close
        </button>
      </div>
      <p className="mt-1 truncate font-meter text-xs text-white/40" title={presetName}>
        {presetName}
      </p>

      <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {EEL_FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="readout text-white/40">{f.label}</span>
            <textarea
              value={eqs[f.key] ?? ""}
              onChange={(e) =>
                setEqs((cur) => ({ ...cur, [f.key]: e.target.value }))
              }
              spellCheck={false}
              rows={f.key === "init_eqs_eel" ? 3 : 7}
              className="resize-y border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs leading-relaxed text-white/85 placeholder:text-white/25"
              placeholder="// eel"
            />
          </label>
        ))}
      </div>

      <div className="mt-3 border-t border-white/10 pt-3">
        <p
          className={`min-h-4 font-meter text-xs ${
            status.kind === "err"
              ? "text-red-300"
              : status.kind === "ok"
                ? "text-ultra-soft"
                : "text-white/40"
          }`}
          role="status"
        >
          {status.kind === "err"
            ? status.message
            : status.kind === "ok"
              ? `compiled in ${status.ms} ms`
              : status.kind === "busy"
                ? "compiling…"
                : "Ctrl+Enter applies"}
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={apply}
            disabled={status.kind === "busy"}
            className="border border-ultra bg-ultra/20 px-3 py-1.5 font-meter text-xs text-ultra-soft hover:bg-ultra/35 active:scale-[0.97] disabled:opacity-50"
          >
            apply
          </button>
          <button
            onClick={exportJson}
            className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
          >
            export
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name for the saved preset"
            className="min-w-0 flex-1 border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/85"
          />
          <button
            onClick={() => name.trim() && onSaveAs(name.trim(), buildEdited(base, eqs))}
            className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
          >
            save
          </button>
        </div>
      </div>
    </div>
  );
}
