/**
 * MilkDrop compatibility via Butterchurn (MIT), the WebGL port of MilkDrop 2,
 * plus its library of converted classic .milk presets (Geiss, Flexi, Martin,
 * shifter and friends).
 *
 * Butterchurn 3 compiles each preset's equations — eel source carried in the
 * preset's `*_eqs_eel` fields — to WebAssembly when the preset loads, so
 * preset compilation runs under the site's `'wasm-unsafe-eval'` policy with
 * no JavaScript evaluation. The engine and the 107-preset base pack are
 * pinned npm packages (butterchurn 3.0.0-beta.5, butterchurn-presets
 * 3.0.0-beta.4) that Vite bundles as lazy same-origin chunks: they stay out
 * of the app bundle and load the first time the user switches the console to
 * the MilkDrop engine — no third-party CDN at runtime. Client-only: call
 * from effects or handlers.
 */

export interface ButterchurnVisualizer {
  connectAudio(node: AudioNode): void;
  /** Unwires the audio edge on teardown. */
  disconnectAudio?(node: AudioNode): void;
  /**
   * Butterchurn 3 compiles the preset's eel equations to WASM before the
   * blend starts: resolves once the preset is applied, rejects with the
   * compile error (the previous preset keeps rendering).
   */
  loadPreset(preset: unknown, blendTimeSec: number): Promise<void>;
  setRendererSize(width: number, height: number): void;
  render(): void;
}

interface ButterchurnModule {
  createVisualizer(
    ctx: AudioContext,
    canvas: HTMLCanvasElement,
    opts: { width: number; height: number; onlyUseWASM?: boolean },
  ): ButterchurnVisualizer;
}

export interface MilkdropBundle {
  butterchurn: ButterchurnModule;
  /** Preset name -> preset object, alphabetized. */
  presets: Record<string, unknown>;
  presetNames: string[];
}

/**
 * True for presets converted with the old JS pipeline: `*_eqs_str` fields
 * holding compiled JavaScript. Butterchurn 3 would run those through the
 * Function constructor, which the site's script policy does not allow, so
 * the console refuses them with a message instead. Presets carrying eel
 * source (`*_eqs_eel`) compile to WebAssembly.
 */
export function isLegacyJsPreset(preset: unknown): boolean {
  if (!preset || typeof preset !== "object") return false;
  const p = preset as Record<string, unknown>;
  return "init_eqs_str" in p && !("init_eqs_eel" in p);
}

/** First line of a preset load/compile failure, sized for a readout. */
export function presetErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const line = raw.split("\n")[0]?.trim();
  return line || "The preset failed to compile.";
}

/* ------------------------------------------------------------------ */
/* User-uploaded presets (Butterchurn JSON), persisted in the browser.  */
/* ------------------------------------------------------------------ */

const CUSTOM_MILK_KEY = "wavescope-milk-presets";

/** Client-only: call from effects or handlers, never during render. */
export function loadCustomMilkPresets(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(CUSTOM_MILK_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Returns false when storage rejects the write (quota); the presets then
 *  live for the session only. */
export function saveCustomMilkPresets(map: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(CUSTOM_MILK_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

let bundle: Promise<MilkdropBundle> | null = null;

export function loadMilkdrop(): Promise<MilkdropBundle> {
  if (!bundle) {
    bundle = (async () => {
      const [engineMod, packMod] = await Promise.all([
        import("butterchurn"),
        import("butterchurn-presets"),
      ]);
      const butterchurn = engineMod.default as ButterchurnModule;
      // The preset pack is a UMD build: unwrap the interop default, twice —
      // the factory returns a namespace whose own default is the name→preset
      // map.
      const ns = (packMod as { default?: unknown }).default ?? packMod;
      const presets = ((ns as { default?: unknown }).default ?? ns) as Record<
        string,
        unknown
      >;
      const presetNames = Object.keys(presets).sort((a, b) =>
        a.localeCompare(b),
      );
      if (!presetNames.length) throw new Error("empty preset pack");
      return { butterchurn, presets, presetNames };
    })().catch((e) => {
      bundle = null; // allow a retry after a network hiccup
      throw e;
    });
  }
  return bundle;
}
