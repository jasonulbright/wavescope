/**
 * MilkDrop compatibility via Butterchurn (MIT), the WebGL port of MilkDrop 2,
 * plus its library of converted classic .milk presets (Geiss, Flexi, Martin,
 * shifter and friends).
 *
 * The engine is ~800 kB of WebGL code, so it is NOT in the app bundle: it
 * loads from the CDN the first time the user switches the console to the
 * MilkDrop engine. Client-only: call from effects or handlers.
 */

export interface ButterchurnVisualizer {
  connectAudio(node: AudioNode): void;
  loadPreset(preset: unknown, blendTimeSec: number): void;
  setRendererSize(width: number, height: number): void;
  render(): void;
}

interface ButterchurnModule {
  createVisualizer(
    ctx: AudioContext,
    canvas: HTMLCanvasElement,
    opts: { width: number; height: number },
  ): ButterchurnVisualizer;
}

export interface MilkdropBundle {
  butterchurn: ButterchurnModule;
  /** Preset name -> preset object, alphabetized. */
  presets: Record<string, unknown>;
  presetNames: string[];
}

const BUTTERCHURN_SRC =
  "https://cdn.jsdelivr.net/npm/butterchurn@2.6.7/lib/butterchurn.min.js";
const PRESETS_SRC =
  "https://cdn.jsdelivr.net/npm/butterchurn-presets@2.4.7/lib/butterchurnPresets.min.js";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
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
      await Promise.all([loadScript(BUTTERCHURN_SRC), loadScript(PRESETS_SRC)]);
      const w = window as unknown as {
        butterchurn: ButterchurnModule & { default?: ButterchurnModule };
        butterchurnPresets: {
          getPresets(): Record<string, unknown>;
          default?: { getPresets(): Record<string, unknown> };
        };
      };
      const butterchurn = w.butterchurn.default ?? w.butterchurn;
      const packs = w.butterchurnPresets.default ?? w.butterchurnPresets;
      const presets = packs.getPresets();
      return {
        butterchurn,
        presets,
        presetNames: Object.keys(presets).sort((a, b) => a.localeCompare(b)),
      };
    })().catch((e) => {
      bundle = null; // allow a retry after a network hiccup
      throw e;
    });
  }
  return bundle;
}
