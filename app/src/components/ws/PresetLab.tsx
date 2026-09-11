import { useEffect, useRef, useState } from "react";
import { presetErrorMessage } from "../../lib/viz/milkdrop";
import { useFocusTrap } from "../../hooks/use-focus-trap";

/**
 * The preset lab: edits the active MilkDrop preset's eel equations in place.
 * Apply hands an edited copy of the preset object to the running visualizer
 * (Butterchurn 3 compiles the eel source to WebAssembly and rejects with the
 * compile error, which lands in the status readout). Save stores the edit as
 * a custom preset under a new name; export downloads it as JSON.
 */

interface PresetLabProps {
  format?: "eel" | "milk";
  /** Name of the preset the editor is seeded from. */
  presetName: string;
  /** The active preset object (bundled or custom); null while loading. */
  base: unknown;
  /** Compile + show an edited preset now (hard cut). Rejects on eel errors. */
  onApply: (edited: Record<string, unknown>) => Promise<void>;
  /** Persist the edit as a custom preset and switch the picker to it. */
  onSaveAs: (name: string, preset: Record<string, unknown>) => Promise<void>;
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
  format: "eel" | "milk" = "eel",
): Record<string, unknown> {
  if (format === "milk") return { raw: eqs.raw ?? "" };
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
  format = "eel",
}: PresetLabProps) {
  const [eqs, setEqs] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [status, setStatus] = useState<LabStatus>({ kind: "idle" });
  const busyRef = useRef(false);
  const [savedEqs, setSavedEqs] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const dirty = JSON.stringify(eqs) !== savedEqs;
  const fields = format === "milk" ? [{ key: "raw", label: "MILK SOURCE" }] : EEL_FIELDS;
  const requestClose = () => { if (busyRef.current) return; if (dirty) setConfirmClose(true); else onClose(); };
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Re-seed the editor whenever the picked preset changes — by name OR by
  // object identity, so re-importing a file under the open preset's name
  // refreshes the textareas instead of leaving stale eel to overwrite it.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of format === "milk" ? [{ key: "raw" }] : EEL_FIELDS) next[f.key] = eelField(base, f.key);
    setEqs(next);
    setSavedEqs(JSON.stringify(next));
    setName(`${presetName} (edit)`);
    setStatus({ kind: "idle" });
  }, [presetName, base, format]);

  const save = async (closeAfter = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus({ kind: "busy" });
    try {
      await onSaveAs(name.trim(), buildEdited(base, eqs, format));
      setSavedEqs(JSON.stringify(eqs));
      setStatus({ kind: "idle" });
      setConfirmClose(false);
      if (closeAfter) onClose();
    } catch (e) { setStatus({ kind: "err", message: presetErrorMessage(e) }); }
    finally { busyRef.current = false; }
  };

  const apply = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus({ kind: "busy" });
    const t0 = performance.now();
    onApply(buildEdited(base, eqs, format))
      .then(() => setStatus({ kind: "ok", ms: Math.round(performance.now() - t0) }))
      .catch((e) => setStatus({ kind: "err", message: presetErrorMessage(e) }))
      .finally(() => {
        busyRef.current = false;
      });
  };

  const exportJson = () => {
    const blob = new Blob([format === "milk" ? eqs.raw ?? "" : JSON.stringify(buildEdited(base, eqs), null, 2)], {
      type: format === "milk" ? "text/plain" : "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || presetName}.${format === "milk" ? "milk" : "json"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="absolute inset-0 z-20 bg-black/30 text-white">
    <div
      ref={trapRef}
      className={`absolute bottom-8 right-4 top-8 z-10 flex ${format === "milk" ? "w-[680px]" : "w-[420px]"} max-w-[90vw] flex-col border border-white/15 bg-scope/95 p-4`}
      role="dialog"
      aria-modal="true"
      aria-label="Preset lab"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); if (confirmClose) setConfirmClose(false); else requestClose(); }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          apply();
        }
      }}
    >
      <div className="flex items-baseline justify-between">
        <p className="readout text-ultra-soft">PRESET LAB{dirty ? " *" : ""}</p>
        <button
          onClick={requestClose}
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
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className="readout text-white/40">{f.label}</span>
            <textarea
              value={eqs[f.key] ?? ""}
              onChange={(e) =>
                setEqs((cur) => ({ ...cur, [f.key]: e.target.value }))
              }
              spellCheck={false}
              rows={f.key === "raw" ? 24 : f.key === "init_eqs_eel" ? 3 : 7}
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
            onClick={() => void save()}
            disabled={status.kind === "busy"}
            className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
          >
            save as new
          </button>
        </div>
      </div>
      {confirmClose ? <div role="group" aria-label="Unsaved changes" className="mt-4 border border-ultra p-3 font-meter text-xs">
        <p>Save your changes before closing?</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button onClick={() => void save(true)} disabled={status.kind === "busy"}>Save and close</button>
          <button onClick={onClose} disabled={status.kind === "busy"}>Discard changes</button>
          <button onClick={() => setConfirmClose(false)}>Keep editing</button>
        </div>
      </div> : null}
    </div>
    </div>
  );
}
