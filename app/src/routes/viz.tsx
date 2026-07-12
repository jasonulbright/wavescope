import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AudioEngine } from "../lib/viz/audio-engine";
import { SyncBroadcaster, SyncReceiver, openOnOtherDisplays } from "../lib/viz/sync";
import { MODES, modeById } from "../lib/viz/modes";
import {
  PALETTES,
  customToPalette,
  loadCustomPalettes,
  saveCustomPalettes,
  type CustomPaletteDef,
} from "../lib/viz/palettes";
import {
  RESOLUTIONS,
  type ResolutionId,
  type SourceKind,
  type VizPalette,
} from "../lib/viz/types";
import { VizCanvas } from "../components/ws/VizCanvas";
import { useFocusTrap } from "../hooks/use-focus-trap";
import { WorkerCanvas, workerCanvasSupported } from "../components/ws/WorkerCanvas";
import type { PaletteRef } from "../lib/viz/render-worker";
import { MilkdropCanvas, type MilkdropApi } from "../components/ws/MilkdropCanvas";
import { PresetLab } from "../components/ws/PresetLab";
import { ProjectMCanvas } from "../components/ws/ProjectMCanvas";
import {
  loadMilkdrop,
  loadCustomMilkPresets,
  saveCustomMilkPresets,
  isLegacyJsPreset,
  isLoadablePreset,
  type MilkdropBundle,
} from "../lib/viz/milkdrop";
import {
  loadProjectM,
  fetchMilkText,
  BUNDLED_MILK,
} from "../lib/viz/projectm";
import { WebGPUCanvas } from "../components/ws/WebGPUCanvas";
import { ClipRecorder, downloadClip } from "../lib/viz/record";
import { GPU_MODES, gpuModeById, webgpuSupported } from "../lib/viz/webgpu";
import { attachPcmTap, PcmBroadcaster, PcmLink } from "../lib/viz/pcm";
import { SpotifyPanel } from "../components/ws/SpotifyPanel";
import {
  completeSpotifyAuth,
  spotifyConnected,
  spotifyNowPlaying,
  type NowPlaying,
} from "../lib/spotify";

interface VizSearch {
  mode?: string;
  palette?: string;
  follow?: 1;
  /** Chromeless mode for OBS browser sources / iframes: no deck, no HUD. */
  embed?: 1;
  /** With embed: auto-arm this source on load. Only "demo" needs no gesture. */
  src?: "demo";
}

export const Route = createFileRoute("/viz")({
  validateSearch: (s: Record<string, unknown>): VizSearch => {
    const out: VizSearch = {};
    if (typeof s.mode === "string") out.mode = s.mode;
    if (typeof s.palette === "string") out.palette = s.palette;
    if (s.follow) out.follow = 1;
    if (s.embed) out.embed = 1;
    if (s.src === "demo") out.src = "demo";
    return out;
  },
  head: () => ({
    meta: [
      { title: "WaveScope Console" },
      {
        name: "description",
        content:
          "The WaveScope console: arm a signal, pick a visualizer, go fullscreen on every display.",
      },
    ],
  }),
  component: VizPage,
});

/** Shuffle sentinel: audio-driven VJ mode (drops hard-cut, lulls morph). */
const VJ_SEC = -1;

/** Shuffle timer choices, in seconds; 0 = off. A NEGATIVE value is auto-DJ:
 * the tick hops ENGINE and mode/preset together (interval = abs(sec)).
 * VJ_SEC switches on the signal itself instead of a timer. */
const SHUFFLE_OPTIONS = [
  { sec: 0, label: "off" },
  { sec: 15, label: "15s" },
  { sec: 30, label: "30s" },
  { sec: 60, label: "1m" },
  { sec: 300, label: "5m" },
  { sec: -30, label: "DJ" },
  { sec: VJ_SEC, label: "VJ" },
] as const;

const SOURCE_BUTTONS: Array<{ kind: SourceKind; label: string; hint: string }> = [
  { kind: "system", label: "System audio", hint: "share a tab or screen with audio" },
  { kind: "mic", label: "Microphone", hint: "visualize the room" },
  { kind: "file", label: "Audio file", hint: "plays locally, loops" },
  { kind: "demo", label: "Demo oscillator", hint: "no permissions needed" },
];

function VizPage() {
  const search = Route.useSearch();
  const follow = Boolean(search.follow);
  // Chromeless embed (OBS overlays): all UI stays hidden, nothing to arm.
  const embed = Boolean(search.embed) && !follow;

  const [ready, setReady] = useState(false);
  const [modeId, setModeId] = useState(() => modeById(search.mode).id);
  const [paletteId, setPaletteId] = useState<string>(
    () => PALETTES.find((p) => p.id === search.palette)?.id ?? PALETTES[0].id,
  );
  const [resId, setResId] = useState<ResolutionId>("auto");
  const [shuffleSec, setShuffleSec] = useState(0);
  const [calm, setCalm] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const [shufflePalettes, setShufflePalettes] = useState(false);
  /** Palette ids included in the shuffle; null means "all of them". */
  const [shuffleInclude, setShuffleInclude] = useState<string[] | null>(null);
  const [customDefs, setCustomDefs] = useState<CustomPaletteDef[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [milk, setMilk] = useState(false);
  const [milkPreset, setMilkPreset] = useState("");
  const [milkNames, setMilkNames] = useState<string[]>([]);
  const [milkLoading, setMilkLoading] = useState(false);
  const [customMilk, setCustomMilk] = useState<Record<string, unknown>>({});
  const milkFileRef = useRef<HTMLInputElement>(null);
  // Imperative preset surface of the live MilkdropCanvas (lab + morph deck).
  const milkApiRef = useRef<MilkdropApi | null>(null);
  // Loaded engine bundle: the lab reads preset objects from it by name.
  const milkBundleRef = useRef<MilkdropBundle | null>(null);
  const [labOpen, setLabOpen] = useState(false);
  // One-shot blend override consumed by the canvas on the next preset switch.
  const milkBlendRef = useRef<number | null>(null);
  // Morph deck: two preset slots and the blend length between them.
  const [morphA, setMorphA] = useState("");
  const [morphB, setMorphB] = useState("");
  const [morphSec, setMorphSec] = useState(2.7);
  // projectM (WASM MilkDrop): a separate engine that runs raw .milk presets.
  const [pm, setPm] = useState(false);
  const [pmAvailable, setPmAvailable] = useState<boolean | null>(null);
  const [pmPreset, setPmPreset] = useState(BUNDLED_MILK[0]?.name ?? "");
  const [pmText, setPmText] = useState("");
  const [pmCustom, setPmCustom] = useState<Record<string, string>>({});
  const pmFileRef = useRef<HTMLInputElement>(null);
  // WebGPU engine (GPU-native per-pixel shader modes).
  const [gpu, setGpu] = useState(false);
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null);
  const [gpuMode, setGpuMode] = useState(GPU_MODES[0]?.id ?? "");
  const [linked, setLinked] = useState(false);
  const [pcmLive, setPcmLive] = useState(false);
  const linkRef = useRef<PcmLink | null>(null);
  const pcmStopRef = useRef<(() => void) | null>(null);
  const [spotifyOpen, setSpotifyOpen] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying | null>(null);
  const calmRef = useRef(false);
  const settingsLoaded = useRef(false);
  const [source, setSource] = useState<SourceKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uiVisible, setUiVisible] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fps, setFps] = useState(0);
  const [canvasSize, setCanvasSize] = useState("");
  const [receiverLive, setReceiverLive] = useState(false);
  const [displayCount, setDisplayCount] = useState(0);

  const engineRef = useRef<AudioEngine | null>(null);
  const broadcasterRef = useRef<SyncBroadcaster | null>(null);
  const receiverRef = useRef<SyncReceiver | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const mode = modeById(modeId);
  const allPalettes = useMemo(
    () => [...PALETTES, ...customDefs.map(customToPalette)],
    [customDefs],
  );
  const palette = allPalettes.find((p) => p.id === paletteId) ?? allPalettes[0];
  // Serializable palette handle for the render worker (functions can't cross
  // the thread boundary): a built-in id, or the full custom definition.
  const customDef = customDefs.find((d) => d.id === paletteId);
  const paletteRef = useMemo(
    () => (customDef ? { custom: customDef } : { builtin: palette.id }),
    [customDef, palette.id],
  );
  const availableModes = useMemo(
    () => (calm ? MODES.filter((m) => !m.flash) : MODES),
    [calm],
  );
  const resolution = RESOLUTIONS.find((r) => r.id === resId) ?? RESOLUTIONS[0];

  // Restore persisted preferences (client-only), then keep them saved.
  useEffect(() => {
    try {
      setCustomDefs(loadCustomPalettes());
      setCustomMilk(loadCustomMilkPresets());
      const raw = localStorage.getItem("wavescope-settings");
      if (raw) {
        const s = JSON.parse(raw) as {
          calm?: boolean;
          shufflePalettes?: boolean;
          shuffleInclude?: string[] | null;
        };
        if (s.calm) setCalm(true);
        if (s.shufflePalettes) setShufflePalettes(true);
        if (Array.isArray(s.shuffleInclude)) setShuffleInclude(s.shuffleInclude);
      }
    } catch {
      // Corrupt settings: start from defaults.
    }
    settingsLoaded.current = true;
  }, []);

  // Probe for the WebGPU engine (client-only; avoids a hydration mismatch).
  useEffect(() => {
    if (!follow) setGpuAvailable(webgpuSupported());
  }, [follow]);

  // Probe for the projectM WASM engine + restore uploaded .milk presets.
  useEffect(() => {
    if (follow) return;
    void loadProjectM().then((r) => setPmAvailable(r.available));
    try {
      const raw = localStorage.getItem("wavescope-pm-milk");
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (parsed && typeof parsed === "object") setPmCustom(parsed);
      }
    } catch {
      // no stored presets
    }
  }, [follow]);

  const pmNames = useMemo(
    () => [...BUNDLED_MILK.map((b) => b.name), ...Object.keys(pmCustom)],
    [pmCustom],
  );

  // Resolve the current projectM preset to its raw .milk text.
  useEffect(() => {
    if (!pm) return;
    let cancelled = false;
    const bundled = BUNDLED_MILK.find((b) => b.name === pmPreset);
    if (bundled) {
      void fetchMilkText(bundled.url).then((t) => {
        if (!cancelled) setPmText(t);
      });
    } else if (pmCustom[pmPreset] !== undefined) {
      setPmText(pmCustom[pmPreset]);
    }
    return () => {
      cancelled = true;
    };
  }, [pm, pmPreset, pmCustom]);

  useEffect(() => {
    calmRef.current = calm;
    if (!settingsLoaded.current) return;
    try {
      localStorage.setItem(
        "wavescope-settings",
        JSON.stringify({ calm, shufflePalettes, shuffleInclude }),
      );
    } catch {
      // Storage blocked: settings stay session-only.
    }
  }, [calm, shufflePalettes, shuffleInclude]);

  // Calm mode never leaves a flashing mode on screen.
  useEffect(() => {
    if (calm) {
      setModeId((cur) => (modeById(cur).flash ? availableModes[0].id : cur));
    }
  }, [calm, availableModes]);

  // Client boot: engine or receiver, never during render (SSR).
  useEffect(() => {
    setReady(true);
    if (follow) {
      receiverRef.current = new SyncReceiver();
      const poll = setInterval(() => {
        setReceiverLive(receiverRef.current?.live ?? false);
        setPcmLive(linkRef.current?.live ?? false);
      }, 500);
      return () => {
        clearInterval(poll);
        receiverRef.current?.close();
        linkRef.current?.dispose();
        linkRef.current = null;
      };
    }
    engineRef.current = new AudioEngine();
    broadcasterRef.current = new SyncBroadcaster();
    engineRef.current.onSourceEnded = () => {
      setSource(null);
      setError("The shared source ended. Arm a new signal.");
    };
    return () => {
      engineRef.current?.dispose();
      broadcasterRef.current?.close();
    };
  }, [follow]);

  // Returning from Spotify's consent page: finish the token exchange, then
  // clean the code out of the URL and reopen the panel.
  useEffect(() => {
    if (follow) return;
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (!code) return;
    void completeSpotifyAuth(code, params.get("state")).then(() => {
      history.replaceState(null, "", "/viz");
      setSpotifyOpen(true);
    });
  }, [follow]);

  // Track readout while capturing with a connected Spotify account.
  useEffect(() => {
    if (follow || source !== "system" || !spotifyConnected()) {
      setNowPlaying(null);
      return;
    }
    let disposed = false;
    const poll = () =>
      void spotifyNowPlaying().then((np) => {
        if (!disposed) setNowPlaying(np);
      });
    poll();
    const iv = setInterval(poll, 5000);
    return () => {
      disposed = true;
      clearInterval(iv);
    };
  }, [follow, source]);

  // Companions: rebuild a real audio graph on the first user gesture
  // (browsers gate AudioContext behind interaction). Once linked, the
  // window has full engine parity: audio-rate analysis AND MilkDrop.
  useEffect(() => {
    if (!follow) return;
    const onGesture = () => {
      if (linkRef.current) return;
      const link = new PcmLink();
      linkRef.current = link;
      void link
        .start()
        .then(() => setLinked(true))
        .catch(() => {
          link.dispose();
          linkRef.current = null;
        });
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [follow]);

  // Console: once a source is armed, tap the analyser and broadcast raw PCM
  // so companion windows can rebuild the audio graph locally.
  useEffect(() => {
    if (follow || !source || pcmStopRef.current) return;
    const engine = engineRef.current;
    if (!engine) return;
    const bc = new PcmBroadcaster();
    let cancelled = false;
    void attachPcmTap(engine, (block) => bc.send(block))
      .then((stop) => {
        if (cancelled) {
          stop();
          bc.close();
          return;
        }
        pcmStopRef.current = () => {
          stop();
          bc.close();
        };
      })
      .catch(() => bc.close()); // no worklet support: companions use frames
    return () => {
      cancelled = true;
    };
  }, [follow, source]);

  useEffect(
    () => () => {
      pcmStopRef.current?.();
      pcmStopRef.current = null;
    },
    [],
  );

  const getFrame = useCallback(() => {
    // Calm mode softens the beat envelope, taming pulse-driven motion in
    // every mode, not just the excluded flashing ones.
    const soften = (f: ReturnType<AudioEngine["getFrame"]>) =>
      calmRef.current ? { ...f, beat: f.beat * 0.2 } : f;
    if (receiverRef.current) {
      // Prefer the local audio graph when the PCM link is flowing; fall
      // back to broadcast frames (older consoles, or before the link click).
      const link = linkRef.current;
      if (link?.live) return soften(link.getFrame());
      return soften(receiverRef.current.getFrame());
    }
    const engine = engineRef.current;
    if (!engine) {
      // Silent frame for the instant before the engine boots.
      return {
        fft: new Uint8Array(1024),
        wave: new Uint8Array(2048).fill(128),
        level: 0,
        bass: 0,
        mid: 0,
        treble: 0,
        beat: 0,
        t: 0,
        dt: 0.016,
      };
    }
    const f = engine.getFrame();
    // Companions receive the raw frame and apply their own calm setting.
    if (engine.active) broadcasterRef.current?.send(f);
    return soften(f);
  }, []);

  const arm = useCallback(async (kind: SourceKind, file?: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    setError(null);
    try {
      if (kind === "file" && !file) {
        fileInputRef.current?.click();
        return;
      }
      await engine.start(kind, file);
      setSource(kind);
    } catch (e) {
      setError(
        e instanceof Error && e.message.includes("Share audio")
          ? e.message
          : kind === "mic"
            ? "Microphone permission was declined. Check the browser's site permissions."
            : kind === "system"
              ? "Screen share was declined. Pick a tab or screen and tick 'Share audio'."
              : "That source could not start. Try another one.",
      );
    }
  }, []);

  /** Uploaded presets first, then the bundled library. */
  const milkAll = useMemo(
    () => [...Object.keys(customMilk).sort((a, b) => a.localeCompare(b)), ...milkNames],
    [customMilk, milkNames],
  );

  const cycleMode = useCallback(
    (dir: 1 | -1) => {
      if (gpu) {
        setGpuMode((cur) => {
          const i = GPU_MODES.findIndex((m) => m.id === cur);
          return GPU_MODES[(i + dir + GPU_MODES.length) % GPU_MODES.length].id;
        });
        return;
      }
      if (pm && pmNames.length) {
        setPmPreset((cur) => {
          const i = pmNames.indexOf(cur);
          return pmNames[(i + dir + pmNames.length) % pmNames.length];
        });
        return;
      }
      if (milk && milkAll.length) {
        setMilkPreset((cur) => {
          const i = milkAll.indexOf(cur);
          return milkAll[(i + dir + milkAll.length) % milkAll.length];
        });
        return;
      }
      setModeId((cur) => {
        const list = availableModes;
        const i = list.findIndex((m) => m.id === cur);
        return list[(i + dir + list.length) % list.length].id;
      });
    },
    [availableModes, milk, milkAll, pm, pmNames, gpu],
  );

  /** Switch between the built-in math engine and the MilkDrop engine. */
  const toggleMilk = useCallback(async () => {
    if (milk) {
      setMilk(false);
      return;
    }
    setMilkLoading(true);
    setError(null);
    try {
      const bundle = await loadMilkdrop();
      milkBundleRef.current = bundle;
      setMilkNames(bundle.presetNames);
      // Seed the morph slots once the pack is known.
      setMorphA((cur) => cur || bundle.presetNames[0]);
      setMorphB(
        (cur) =>
          cur ||
          bundle.presetNames[Math.floor(Math.random() * bundle.presetNames.length)],
      );
      setMilkPreset(
        (cur) =>
          cur ||
          bundle.presetNames[Math.floor(Math.random() * bundle.presetNames.length)],
      );
      setPm(false); // engines are mutually exclusive
      setGpu(false);
      setMilk(true);
    } catch {
      setError("The MilkDrop engine failed to load. Check the connection and try again.");
    } finally {
      setMilkLoading(false);
    }
  }, [milk]);

  /** Toggle the projectM (WASM) engine: runs raw .milk presets natively. */
  const togglePm = useCallback(() => {
    if (pm) {
      setPm(false);
      return;
    }
    setError(null);
    setMilk(false);
    setGpu(false);
    setPmPreset((cur) => cur || BUNDLED_MILK[0]?.name || "");
    setPm(true);
  }, [pm]);

  /** Toggle the WebGPU engine (GPU-native per-pixel shader modes). */
  const toggleGpu = useCallback(() => {
    if (gpu) {
      setGpu(false);
      return;
    }
    setError(null);
    setMilk(false);
    setPm(false);
    setGpu(true);
  }, [gpu]);

  /** Return to WaveScope's built-in visualizers (turn off every alternate engine). */
  const selectBuiltin = useCallback(() => {
    setError(null);
    setGpu(false);
    setPm(false);
    setMilk(false);
  }, []);

  /** Import user .milk presets (raw text) for the projectM engine. */
  const onPmFiles = useCallback(
    async (files: FileList) => {
      const next = { ...pmCustom };
      const failed: string[] = [];
      let lastAdded = "";
      for (const file of Array.from(files)) {
        if (!/\.milk$/i.test(file.name)) {
          failed.push(`${file.name} (projectM needs raw .milk files)`);
          continue;
        }
        try {
          const text = await file.text();
          if (!text.includes("per_frame") && !text.includes("[preset")) {
            throw new Error("not a preset");
          }
          const name = file.name.replace(/\.milk$/i, "");
          next[name] = text;
          lastAdded = name;
        } catch {
          failed.push(file.name);
        }
      }
      setPmCustom(next);
      try {
        localStorage.setItem("wavescope-pm-milk", JSON.stringify(next));
      } catch {
        // storage full: session-only
      }
      if (lastAdded) setPmPreset(lastAdded);
      if (failed.length) setError(`Could not load: ${failed.join("; ")}`);
    },
    [pmCustom],
  );

  const deletePmPreset = useCallback(() => {
    setPmCustom((cur) => {
      const next = { ...cur };
      delete next[pmPreset];
      try {
        localStorage.setItem("wavescope-pm-milk", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
    setPmPreset(BUNDLED_MILK[0]?.name ?? "");
  }, [pmPreset]);

  /** Import user presets (Butterchurn JSON files) into the preset list. */
  const onMilkFiles = useCallback(
    async (files: FileList) => {
      const next = { ...customMilk };
      const failed: string[] = [];
      let lastAdded = "";
      for (const file of Array.from(files)) {
        if (/\.milk$/i.test(file.name)) {
          failed.push(`${file.name} (this is the Butterchurn engine; use the projectM engine to load raw .milk)`);
          continue;
        }
        try {
          const parsed: unknown = JSON.parse(await file.text());
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("not a preset");
          }
          if (!isLoadablePreset(parsed)) {
            failed.push(
              isLegacyJsPreset(parsed)
                ? `${file.name} (carries compiled-JS equations from the old converter; the engine runs eel-source presets only)`
                : `${file.name} (no eel equations; not a Butterchurn preset)`,
            );
            continue;
          }
          const name = file.name.replace(/\.json$/i, "");
          next[name] = parsed;
          lastAdded = name;
        } catch {
          failed.push(file.name);
        }
      }
      setCustomMilk(next);
      const persisted = saveCustomMilkPresets(next);
      if (lastAdded) setMilkPreset(lastAdded);
      if (failed.length) {
        setError(`Could not load: ${failed.join("; ")}`);
      } else if (!persisted) {
        setError("Preset loaded for this session, but browser storage is full so it will not persist.");
      }
    },
    [customMilk],
  );

  /** Morph deck: blend to a slot's preset over the chosen length. The blend
   * override is only armed when a switch actually happens, so it cannot leak
   * onto a later unrelated preset change; a slot naming a preset that no
   * longer exists is a no-op. */
  const morphTo = useCallback(
    (slot: "A" | "B") => {
      const target = slot === "A" ? morphA : morphB;
      if (!target || target === milkPreset || !milkAll.includes(target)) return;
      milkBlendRef.current = morphSec;
      setMilkPreset(target);
    },
    [morphA, morphB, morphSec, milkPreset, milkAll],
  );

  const deleteMilkPreset = useCallback(() => {
    setCustomMilk((cur) => {
      const next = { ...cur };
      delete next[milkPreset];
      saveCustomMilkPresets(next);
      return next;
    });
    // Point every reference to the deleted name somewhere real: the picker
    // and the morph slots would otherwise hold a value their option lists
    // no longer contain.
    setMorphA((cur) => (cur === milkPreset ? (milkNames[0] ?? "") : cur));
    setMorphB((cur) => (cur === milkPreset ? (milkNames[0] ?? "") : cur));
    setMilkPreset(milkNames[0] ?? "");
  }, [milkPreset, milkNames]);

  /** Auto-DJ: hop to a random engine that is ready to go, then a random
   * mode/preset inside it. milkdrop joins the pool once its bundle has been
   * loaded at least once (loading it from a timer would jank the show). */
  const djHop = useCallback(() => {
    const hops: Array<() => void> = [
      () => {
        setMilk(false);
        setPm(false);
        setGpu(false);
        setModeId((cur) => {
          const others = availableModes.filter((m) => m.id !== cur);
          return others.length
            ? others[Math.floor(Math.random() * others.length)].id
            : cur;
        });
      },
    ];
    if (gpuAvailable) {
      hops.push(() => {
        setMilk(false);
        setPm(false);
        setGpu(true);
        setGpuMode(GPU_MODES[Math.floor(Math.random() * GPU_MODES.length)].id);
      });
    }
    if (pmAvailable && pmNames.length) {
      hops.push(() => {
        setMilk(false);
        setGpu(false);
        setPmPreset(pmNames[Math.floor(Math.random() * pmNames.length)]);
        setPm(true);
      });
    }
    if (milkNames.length && milkAll.length) {
      hops.push(() => {
        setPm(false);
        setGpu(false);
        setMilkPreset(milkAll[Math.floor(Math.random() * milkAll.length)]);
        setMilk(true);
      });
    }
    hops[Math.floor(Math.random() * hops.length)]();
  }, [availableModes, gpuAvailable, pmAvailable, pmNames, milkNames, milkAll]);

  // Shuffle: hop to a random OTHER mode every shuffleSec seconds, and
  // optionally to a random palette from the user's include list. Negative
  // interval = auto-DJ (engines hop too). VJ mode has its own effect below.
  useEffect(() => {
    if (!shuffleSec || shuffleSec === VJ_SEC) return;
    const iv = setInterval(() => {
      if (shuffleSec < 0) {
        djHop();
        return;
      }
      if (gpu) {
        setGpuMode((cur) => {
          const others = GPU_MODES.filter((m) => m.id !== cur);
          return others.length
            ? others[Math.floor(Math.random() * others.length)].id
            : cur;
        });
        return;
      }
      if (pm && pmNames.length) {
        setPmPreset((cur) => {
          const others = pmNames.filter((n) => n !== cur);
          return others.length
            ? others[Math.floor(Math.random() * others.length)]
            : cur;
        });
        return;
      }
      if (milk && milkAll.length) {
        // MilkDrop engine: shuffle hops presets; palettes are the preset's own.
        setMilkPreset((cur) => {
          const others = milkAll.filter((n) => n !== cur);
          return others.length
            ? others[Math.floor(Math.random() * others.length)]
            : cur;
        });
        return;
      }
      setModeId((cur) => {
        const others = availableModes.filter((m) => m.id !== cur);
        return others.length
          ? others[Math.floor(Math.random() * others.length)].id
          : cur;
      });
      if (shufflePalettes) {
        setPaletteId((cur) => {
          const pool = allPalettes.filter(
            (p) => !shuffleInclude || shuffleInclude.includes(p.id),
          );
          const others = pool.filter((p) => p.id !== cur);
          if (!others.length) return cur;
          return others[Math.floor(Math.random() * others.length)].id;
        });
      }
    }, Math.abs(shuffleSec) * 1000);
    return () => clearInterval(iv);
  }, [shuffleSec, availableModes, shufflePalettes, shuffleInclude, allPalettes, milk, milkAll, pm, pmNames, gpu, djHop]);

  // Auto-VJ: audio-driven switching instead of a timer. Bass energy feeds a
  // fast and a slow envelope; the fast one spiking over the slow one is a
  // drop → hard cut to another preset/mode. A long stretch without a drop
  // morphs gently instead (MilkDrop blends 5 s; other engines just switch).
  useEffect(() => {
    if (shuffleSec !== VJ_SEC) return;
    let slow = 0;
    let fast = 0;
    let seeded = false;
    let lastSwitch = performance.now();
    const HOLD_MS = 8000; // minimum time between switches
    const LULL_MS = 45000; // no drop for this long → gentle morph
    const hop = (blendSec: number) => {
      lastSwitch = performance.now();
      if (milk && milkAll.length) {
        setMilkPreset((cur) => {
          const others = milkAll.filter((n) => n !== cur);
          if (!others.length) return cur;
          // Arm the one-shot blend only when a switch really happens.
          milkBlendRef.current = blendSec;
          return others[Math.floor(Math.random() * others.length)];
        });
        return;
      }
      if (gpu) {
        setGpuMode((cur) => {
          const others = GPU_MODES.filter((m) => m.id !== cur);
          return others.length
            ? others[Math.floor(Math.random() * others.length)].id
            : cur;
        });
        return;
      }
      if (pm && pmNames.length) {
        setPmPreset((cur) => {
          const others = pmNames.filter((n) => n !== cur);
          return others.length
            ? others[Math.floor(Math.random() * others.length)]
            : cur;
        });
        return;
      }
      setModeId((cur) => {
        const others = availableModes.filter((m) => m.id !== cur);
        return others.length
          ? others[Math.floor(Math.random() * others.length)].id
          : cur;
      });
    };
    const iv = setInterval(() => {
      const f = getFrame();
      // Seed both envelopes at the current level on the first tick: the
      // ratio starts at 1 and only diverges on a real transient. Without
      // this, steady bass reads as a "drop" the moment the hold expires,
      // because the slow envelope converges slower than the hold time.
      if (!seeded) {
        slow = f.bass;
        fast = f.bass;
        seeded = true;
        return;
      }
      slow = slow * 0.985 + f.bass * 0.015; // ~10 s memory at this tick rate
      fast = fast * 0.6 + f.bass * 0.4; // ~0.5 s
      const held = performance.now() - lastSwitch;
      if (held < HOLD_MS) return;
      // The slow floor keeps the detector quiet until the envelope has
      // actually integrated some signal (silence or a fresh arm).
      if (slow > 0.04 && fast > slow * 1.5 && fast > 0.18) {
        hop(0); // drop: hard cut
        return;
      }
      if (held > LULL_MS) hop(5); // lull: slow morph
    }, 150);
    return () => clearInterval(iv);
  }, [shuffleSec, milk, milkAll, pm, pmNames, gpu, availableModes, getFrame]);

  const cycleShuffle = useCallback(() => {
    setShuffleSec((cur) => {
      const i = SHUFFLE_OPTIONS.findIndex((o) => o.sec === cur);
      return SHUFFLE_OPTIONS[(i + 1) % SHUFFLE_OPTIONS.length].sec;
    });
  }, []);

  const cyclePalette = useCallback(() => {
    setPaletteId((cur) => {
      const i = PALETTES.findIndex((p) => p.id === cur);
      return PALETTES[(i + 1) % PALETTES.length].id;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen();
  }, []);

  const openDisplays = useCallback(async () => {
    const n = await openOnOtherDisplays("/viz");
    setDisplayCount((c) => c + n);
  }, []);

  /** Record the live canvas (any engine) to a WebM download. */
  const toggleRecord = useCallback(async () => {
    if (!recorderRef.current) recorderRef.current = new ClipRecorder();
    const rec = recorderRef.current;
    if (rec.active) {
      const blob = await rec.stop();
      setRecording(false);
      if (blob) {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
        downloadClip(blob, `wavescope-${stamp}.webm`);
      }
      return;
    }
    const canvas = rootRef.current?.querySelector("canvas");
    if (!canvas) {
      setError("Nothing to record yet — arm a source first.");
      return;
    }
    try {
      // Console records its engine; a linked companion records its PcmLink.
      rec.start(canvas, follow ? linkRef.current : engineRef.current);
      setRecording(true);
    } catch {
      setError("Recording is not supported in this browser.");
    }
  }, [follow]);

  // Never leak capture tracks on unmount.
  useEffect(() => {
    return () => {
      void recorderRef.current?.stop();
    };
  }, []);

  // Embed autostart: arm the demo signal once, without any UI. (OBS runs
  // browser sources with autoplay allowed, so no gesture is needed there.)
  const embedArmed = useRef(false);
  useEffect(() => {
    if (!embed || search.src !== "demo" || !ready || source || embedArmed.current) return;
    embedArmed.current = true;
    void arm("demo");
  }, [embed, search.src, ready, source, arm]);

  // Keyboard map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      switch (e.key) {
        case " ":
        case "ArrowRight":
          e.preventDefault();
          cycleMode(1);
          break;
        case "ArrowLeft":
          cycleMode(-1);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "h":
        case "H":
          if (!embed) setUiVisible((v) => !v);
          break;
        case "r":
        case "R":
          void toggleRecord();
          break;
        case "p":
        case "P":
          cyclePalette();
          break;
        case "s":
        case "S":
          cycleShuffle();
          break;
        case "c":
        case "C":
          setCalm((v) => !v);
          break;
        case "m":
        case "M":
          if (!follow) void openDisplays();
          break;
        case "l":
        case "L":
          if (!embed && milk) setLabOpen((v) => !v);
          break;
        case "?":
          setHelpOpen((v) => !v);
          break;
        case "Escape":
          if (!embed) setUiVisible(true);
          setHelpOpen(false);
          setLabOpen(false);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cycleMode, cyclePalette, cycleShuffle, toggleFullscreen, openDisplays, follow, embed, milk, toggleRecord]);

  // Auto-hide the deck after 3s of stillness once a source is live.
  useEffect(() => {
    if (embed) {
      // Chromeless embed: the UI never shows at all.
      setUiVisible(false);
      return;
    }
    const onMove = () => {
      setUiVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => {
        if (source || follow) setUiVisible(false);
      }, 3000);
    };
    window.addEventListener("pointermove", onMove);
    onMove();
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [source, follow, embed]);

  const needsArming = ready && !follow && !source && !embed;

  const hud = useMemo(
    () =>
      [
        `SRC ${
          follow
            ? pcmLive
              ? "CONSOLE AUDIO"
              : linked
                ? "LINKED, WAITING"
                : receiverLive
                  ? "FRAMES, CLICK TO LINK AUDIO"
                  : "NO LINK"
            : (source ?? "standby").toUpperCase()
        }`,
        gpu
          ? `GPU ${gpuModeById(gpuMode).name.toUpperCase()}`
          : pm
            ? `PROJECTM ${pmPreset.slice(0, 32).toUpperCase()}`
            : milk
              ? `MILKDROP ${milkPreset.slice(0, 34).toUpperCase()}`
              : `MODE ${mode.name.toUpperCase()}`,
        canvasSize ? `RES ${canvasSize}` : null,
        shuffleSec
          ? `SHUFFLE ${SHUFFLE_OPTIONS.find((o) => o.sec === shuffleSec)?.label}${shufflePalettes && !milk && !pm && !gpu ? " +PAL" : ""}`
          : null,
        calm && !milk && !pm && !gpu ? "CALM ON" : null,
        recording ? "● REC" : null,
        nowPlaying
          ? `PLAYING ${`${nowPlaying.title} / ${nowPlaying.artist}`.slice(0, 42).toUpperCase()}`
          : null,
        `FPS ${fps}`,
      ].filter(Boolean),
    [follow, receiverLive, linked, pcmLive, source, mode.name, canvasSize, shuffleSec, shufflePalettes, calm, recording, fps, milk, milkPreset, pm, pmPreset, gpu, gpuMode, nowPlaying],
  );

  const milkAudio = follow ? linkRef.current : engineRef.current;
  const audioReady = follow ? linked : source !== null;
  const milkReady = milk && milkAudio !== null && audioReady;
  const pmReady = pm && milkAudio !== null && audioReady && pmText !== "";
  const gpuReady = gpu && audioReady;

  return (
    <div
      ref={rootRef}
      className={`relative h-dvh w-full overflow-hidden bg-scope ${
        uiVisible ? "" : "cursor-none"
      }`}
    >
      {ready && gpuReady ? (
        <WebGPUCanvas
          key={follow ? "gpu-follow" : "gpu-console"}
          modeId={gpuMode}
          getFrame={getFrame}
          resolutionHeight={resolution.height}
          onFps={setFps}
          onSize={setCanvasSize}
          onError={() => {
            setGpu(false);
            setError("WebGPU could not start on this device. Switched off.");
          }}
          className="absolute inset-0 h-full w-full"
        />
      ) : ready && pmReady && milkAudio ? (
        <ProjectMCanvas
          audio={milkAudio}
          presetText={pmText}
          resolutionHeight={resolution.height}
          onFps={setFps}
          onSize={setCanvasSize}
          onError={() => {
            setPm(false);
            setError("The projectM engine could not start on this GPU. Switched off.");
          }}
          className="absolute inset-0 h-full w-full"
        />
      ) : ready && milkReady && milkAudio ? (
        <MilkdropCanvas
          audio={milkAudio}
          presetName={milkPreset}
          extraPresets={customMilk}
          resolutionHeight={resolution.height}
          apiRef={milkApiRef}
          blendSecRef={milkBlendRef}
          onPresetError={setError}
          onFps={setFps}
          onSize={setCanvasSize}
          className="absolute inset-0 h-full w-full"
        />
      ) : ready ? (
        <VizCanvasWithSize
          key={follow ? "follow" : "console"}
          modeId={modeId}
          palette={palette}
          paletteRef={paletteRef}
          resolutionHeight={resolution.height}
          getFrame={getFrame}
          onFps={setFps}
          onSize={setCanvasSize}
        />
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void arm("file", file);
          e.target.value = "";
        }}
      />

      {/* HUD (top-left). aria-live so screen readers announce source/mode/fps. */}
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none absolute left-4 top-4 flex flex-col gap-1 transition-opacity duration-300 ${
          uiVisible ? "opacity-100" : "opacity-0"
        }`}
      >
        {hud.map((line) => (
          <span key={line} className="readout w-fit bg-scope/70 px-2 py-1 text-white/70">
            {line}
          </span>
        ))}
      </div>

      {/* Home link (top-right). */}
      <Link
        to="/"
        className={`absolute right-4 top-4 border border-white/20 bg-scope/70 px-3 py-1.5 font-meter text-xs text-white/70 transition-opacity duration-300 hover:text-white ${
          uiVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        WaveScope home
      </Link>

      {/* Arm-a-source overlay: first run. */}
      {needsArming ? (
        <div className="absolute inset-0 flex items-center justify-center bg-scope/80 p-6">
          <div className="w-full max-w-lg border border-white/15 bg-scope p-8">
            <p className="readout text-ultra-soft">WAVESCOPE CONSOLE</p>
            <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-paper">
              Arm a signal
            </h1>
            <div className="mt-6 flex flex-col gap-3">
              {SOURCE_BUTTONS.map((s) => (
                <button
                  key={s.kind}
                  onClick={() => void arm(s.kind)}
                  className="group flex items-baseline justify-between gap-4 border border-white/15 px-5 py-4 text-left transition-colors hover:border-ultra-soft active:scale-[0.99]"
                >
                  <span className="font-meter text-sm font-bold text-white/90 group-hover:text-white">
                    {s.label}
                  </span>
                  <span className="font-meter text-xs text-white/45">{s.hint}</span>
                </button>
              ))}
            </div>
            {error ? (
              <p className="mt-4 border border-red-400/40 bg-red-950/40 px-3 py-2 font-meter text-xs text-red-200">
                {error}
              </p>
            ) : (
              <p className="mt-4 font-meter text-xs text-white/40">
                Audio never leaves this machine. Press ? for shortcuts.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* Follow-window banner. */}
      {follow && !receiverLive && !pcmLive ? (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-6">
          <p className="border border-white/15 bg-scope/80 px-5 py-4 text-center font-meter text-sm text-white/70">
            Companion display, waiting for the console signal. Keep the main
            WaveScope window open and armed.
          </p>
        </div>
      ) : null}

      {/* One-time link hint: a click gives this window its own audio graph. */}
      {follow && receiverLive && !linked ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center px-6">
          <p className="border border-ultra/50 bg-scope/85 px-4 py-2.5 text-center font-meter text-xs text-ultra-soft">
            Click anywhere to link audio: full quality analysis plus MilkDrop
            on this display.
          </p>
        </div>
      ) : null}

      {/* Error toast when a live session loses its source. */}
      {!needsArming && error ? (
        <div className="absolute inset-x-0 top-16 flex justify-center px-6">
          <p className="border border-red-400/40 bg-red-950/60 px-4 py-2 font-meter text-xs text-red-200">
            {error}
          </p>
        </div>
      ) : null}

      {/* Control deck (bottom). */}
      <div
        className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${
          uiVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-white/10 bg-scope/85 px-4 py-3 backdrop-blur md:px-6">
          {!follow ? (
            <div className="flex items-center gap-1.5">
              <span className="readout mr-1 text-white/40">SRC</span>
              {SOURCE_BUTTONS.map((s) => (
                <button
                  key={s.kind}
                  onClick={() => void arm(s.kind)}
                  className={`border px-2.5 py-1.5 font-meter text-xs transition-colors active:scale-[0.97] ${
                    source === s.kind
                      ? "border-ultra bg-ultra/20 text-ultra-soft"
                      : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
                  }`}
                >
                  {s.kind === "system"
                    ? "system"
                    : s.kind === "mic"
                      ? "mic"
                      : s.kind === "file"
                        ? "file"
                        : "demo"}
                </button>
              ))}
              <button
                onClick={() => setSpotifyOpen(true)}
                title="Start Spotify and visualize it"
                className="border border-white/15 px-2.5 py-1.5 font-meter text-xs text-white/60 transition-colors hover:border-white/40 hover:text-white active:scale-[0.97]"
              >
                spotify
              </button>
            </div>
          ) : (
            <span className="readout text-white/40">COMPANION DISPLAY</span>
          )}

          <div className="flex items-center gap-1.5">
            <span className="readout mr-1 text-white/40">{milk || pm ? "PRESET" : "MODE"}</span>
            <button
              onClick={() => cycleMode(-1)}
              aria-label={milk || pm ? "Previous preset" : "Previous visualizer"}
              className="border border-white/15 px-2 py-1.5 font-meter text-xs text-white/60 hover:text-white active:scale-[0.97]"
            >
              &larr;
            </button>
            {gpu ? (
              <select
                value={gpuMode}
                onChange={(e) => setGpuMode(e.target.value)}
                className="max-w-48 border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/80"
                aria-label="GPU shader mode"
              >
                {GPU_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : pm ? (
              <select
                value={pmPreset}
                onChange={(e) => setPmPreset(e.target.value)}
                className="max-w-48 border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/80"
                aria-label="projectM preset"
              >
                {Object.keys(pmCustom).length ? (
                  <optgroup label="your .milk">
                    {Object.keys(pmCustom)
                      .sort((a, b) => a.localeCompare(b))
                      .map((n) => (
                        <option key={`pm-${n}`} value={n}>
                          {n}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                <optgroup label="bundled">
                  {BUNDLED_MILK.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            ) : milk ? (
              <select
                value={milkPreset}
                onChange={(e) => setMilkPreset(e.target.value)}
                className="max-w-48 border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/80"
                aria-label="MilkDrop preset"
              >
                {Object.keys(customMilk).length ? (
                  <optgroup label="your presets">
                    {Object.keys(customMilk)
                      .sort((a, b) => a.localeCompare(b))
                      .map((n) => (
                        <option key={`c-${n}`} value={n}>
                          {n}
                        </option>
                      ))}
                  </optgroup>
                ) : null}
                <optgroup label="library">
                  {milkNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              </select>
            ) : (
              <select
                value={modeId}
                onChange={(e) => setModeId(e.target.value)}
                className="max-w-40 border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/80"
                aria-label="Visualizer mode"
              >
                {availableModes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {String(MODES.indexOf(m) + 1).padStart(2, "0")} {m.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => cycleMode(1)}
              aria-label={milk || pm ? "Next preset" : "Next visualizer"}
              className="border border-white/15 px-2 py-1.5 font-meter text-xs text-white/60 hover:text-white active:scale-[0.97]"
            >
              &rarr;
            </button>
          </div>

          {!follow || linked ? (
            <button
              onClick={selectBuiltin}
              title="WaveScope: the built-in mathematical visualizers (34 modes)"
              className={`border px-3 py-1.5 font-meter text-xs transition-colors active:scale-[0.97] ${
                !gpu && !pm && !milk
                  ? "border-ultra bg-ultra/20 text-ultra-soft"
                  : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
              }`}
            >
              WaveScope
            </button>
          ) : null}

          {(!follow || linked) && gpuAvailable ? (
            <button
              onClick={toggleGpu}
              title="WebGPU engine: GPU-native per-pixel shader modes at full resolution"
              className={`border px-3 py-1.5 font-meter text-xs transition-colors active:scale-[0.97] ${
                gpu
                  ? "border-ultra bg-ultra/20 text-ultra-soft"
                  : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
              }`}
            >
              GPU
            </button>
          ) : null}

          {(!follow || linked) && pmAvailable ? (
            <button
              onClick={togglePm}
              title="projectM engine: runs raw .milk presets natively via WebAssembly"
              className={`border px-3 py-1.5 font-meter text-xs transition-colors active:scale-[0.97] ${
                pm
                  ? "border-ultra bg-ultra/20 text-ultra-soft"
                  : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
              }`}
            >
              projectM
            </button>
          ) : null}

          {!follow || linked ? (
            <button
              onClick={() => void toggleMilk()}
              disabled={milkLoading}
              title="MilkDrop via the Butterchurn engine (Butterchurn JSON presets)"
              className={`border px-3 py-1.5 font-meter text-xs transition-colors active:scale-[0.97] ${
                milk
                  ? "border-ultra bg-ultra/20 text-ultra-soft"
                  : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
              }`}
            >
              {milkLoading ? "loading milkdrop" : "milkdrop"}
            </button>
          ) : null}

          {pm ? (
            <>
              <input
                ref={pmFileRef}
                type="file"
                accept=".milk"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void onPmFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => pmFileRef.current?.click()}
                title="Import raw .milk preset files"
                className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
              >
                load .milk
              </button>
              {pmCustom[pmPreset] !== undefined ? (
                <button
                  onClick={deletePmPreset}
                  title="Remove this uploaded preset"
                  className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/40 hover:border-red-400/50 hover:text-red-300 active:scale-[0.97]"
                >
                  remove
                </button>
              ) : null}
            </>
          ) : null}

          {milk ? (
            <>
              <input
                ref={milkFileRef}
                type="file"
                accept=".json,.milk"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void onMilkFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => milkFileRef.current?.click()}
                title="Import Butterchurn JSON preset files"
                className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
              >
                load preset
              </button>
              {customMilk[milkPreset] !== undefined ? (
                <button
                  onClick={deleteMilkPreset}
                  title="Remove this uploaded preset"
                  className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/40 hover:border-red-400/50 hover:text-red-300 active:scale-[0.97]"
                >
                  remove
                </button>
              ) : null}
              {!embed ? (
                <button
                  onClick={() => setLabOpen((v) => !v)}
                  title="Edit this preset's eel equations live (L)"
                  className={`border px-3 py-1.5 font-meter text-xs transition-colors active:scale-[0.97] ${
                    labOpen
                      ? "border-ultra bg-ultra/20 text-ultra-soft"
                      : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
                  }`}
                >
                  lab (L)
                </button>
              ) : null}
              <div className="flex items-center gap-1.5">
                <span className="readout mr-1 text-white/40">MORPH</span>
                <select
                  value={morphA}
                  onChange={(e) => setMorphA(e.target.value)}
                  aria-label="Morph slot A"
                  className="max-w-36 border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/80"
                >
                  {milkAll.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => morphTo("A")}
                  title="Blend to slot A over the morph length"
                  aria-label="Blend to slot A over the morph length"
                  className="border border-white/15 px-2 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
                >
                  ←A
                </button>
                <input
                  type="range"
                  min={0.5}
                  max={10}
                  step={0.5}
                  value={morphSec}
                  onChange={(e) => setMorphSec(Number(e.target.value))}
                  aria-label="Morph blend length in seconds"
                  className="w-20 accent-ultra"
                />
                <span className="w-8 font-meter text-xs text-white/40">{morphSec}s</span>
                <button
                  onClick={() => morphTo("B")}
                  title="Blend to slot B over the morph length"
                  aria-label="Blend to slot B over the morph length"
                  className="border border-white/15 px-2 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
                >
                  B→
                </button>
                <select
                  value={morphB}
                  onChange={(e) => setMorphB(e.target.value)}
                  aria-label="Morph slot B"
                  className="max-w-36 border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/80"
                >
                  {milkAll.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : null}

          <div className={`flex items-center gap-1.5 ${milk || pm || gpu ? "hidden" : ""}`}>
            <span className="readout mr-1 text-white/40">TRACE</span>
            <select
              value={paletteId}
              onChange={(e) => setPaletteId(e.target.value)}
              className="border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/80"
              aria-label="Trace palette"
            >
              {allPalettes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="readout mr-1 text-white/40">SHUFFLE</span>
            <select
              value={shuffleSec}
              onChange={(e) => setShuffleSec(Number(e.target.value))}
              className="border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/80"
              aria-label="Shuffle timer"
            >
              {SHUFFLE_OPTIONS.map((o) => (
                <option key={o.sec} value={o.sec}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="readout mr-1 text-white/40">RES</span>
            <select
              value={resId}
              onChange={(e) => setResId(e.target.value as ResolutionId)}
              className="border border-white/15 bg-scope px-2 py-1.5 font-meter text-xs text-white/80"
              aria-label="Render resolution"
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {!milk && !pm && !gpu ? (
              <button
                onClick={() => setCalm((v) => !v)}
                title="Photosensitivity-friendly: exclude burst modes and soften beat pulses"
                className={`border px-3 py-1.5 font-meter text-xs transition-colors active:scale-[0.97] ${
                  calm
                    ? "border-ultra bg-ultra/20 text-ultra-soft"
                    : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
                }`}
              >
                calm (C)
              </button>
            ) : null}
            {!milk && !pm && !gpu ? (
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
              >
                palettes + shuffle
              </button>
            ) : null}
            {!follow ? (
              <button
                onClick={() => void openDisplays()}
                className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
              >
                displays{displayCount ? ` +${displayCount}` : ""}
              </button>
            ) : null}
            <button
              onClick={() => void toggleRecord()}
              title="Record the canvas (with the analysed audio) to a WebM clip"
              className={`border px-3 py-1.5 font-meter text-xs transition-colors active:scale-[0.97] ${
                recording
                  ? "border-ultra bg-ultra/20 text-ultra-soft"
                  : "border-white/15 text-white/60 hover:border-white/40 hover:text-white"
              }`}
            >
              {recording ? "stop rec (R)" : "rec (R)"}
            </button>
            <button
              onClick={toggleFullscreen}
              className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
            >
              fullscreen (F)
            </button>
            <button
              onClick={() => setHelpOpen((v) => !v)}
              aria-label="Keyboard shortcuts"
              className="border border-white/15 px-3 py-1.5 font-meter text-xs text-white/60 hover:border-white/40 hover:text-white active:scale-[0.97]"
            >
              ?
            </button>
          </div>
        </div>
      </div>

      {/* Preset lab: live eel editing for the active MilkDrop preset. */}
      {labOpen && milk && !embed ? (
        <PresetLab
          presetName={milkPreset}
          base={customMilk[milkPreset] ?? milkBundleRef.current?.presets[milkPreset] ?? null}
          onApply={(edited) =>
            milkApiRef.current
              ? milkApiRef.current.applyPreset(edited, 0)
              : Promise.reject(new Error("The engine is not running; arm a source first."))
          }
          onSaveAs={(name, preset) => {
            setCustomMilk((cur) => {
              const next = { ...cur, [name]: preset };
              saveCustomMilkPresets(next);
              return next;
            });
            setMilkPreset(name);
          }}
          onClose={() => setLabOpen(false)}
        />
      ) : null}

      {/* Spotify overlay. */}
      {spotifyOpen ? (
        <SpotifyPanel
          onCapture={() => void arm("system")}
          onClose={() => setSpotifyOpen(false)}
        />
      ) : null}

      {/* Palettes + shuffle settings overlay. */}
      {settingsOpen ? (
        <SettingsPanel
          allPalettes={allPalettes}
          customDefs={customDefs}
          shufflePalettes={shufflePalettes}
          shuffleInclude={shuffleInclude}
          onShufflePalettes={setShufflePalettes}
          onShuffleInclude={setShuffleInclude}
          onCustomDefs={(defs) => {
            setCustomDefs(defs);
            saveCustomPalettes(defs);
            if (!defs.some((d) => d.id === paletteId) && paletteId.startsWith("custom-")) {
              setPaletteId(PALETTES[0].id);
            }
          }}
          onPickPalette={setPaletteId}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      {/* Shortcuts overlay. */}
      {helpOpen ? (
        <HelpOverlay onClose={() => setHelpOpen(false)}>
          <div
            className="w-full max-w-md border border-white/15 bg-scope p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="readout text-ultra-soft">SHORTCUTS</p>
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 font-meter text-sm">
              {[
                ["Space / →", "next visualizer"],
                ["←", "previous visualizer"],
                ["R", "record a clip"],
                ["F", "fullscreen"],
                ["H", "hide or show controls"],
                ["P", "cycle trace palette"],
                ["S", "cycle shuffle timer"],
                ["C", "toggle calm mode"],
                ["M", "open companion displays"],
                ["L", "preset lab (MilkDrop engine)"],
                ["?", "this overlay"],
                ["Esc", "show controls"],
              ].map(([k, d]) => (
                <div key={k} className="contents">
                  <dt className="text-ultra-soft">{k}</dt>
                  <dd className="text-white/70">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
        </HelpOverlay>
      ) : null}
    </div>
  );
}

/** The shortcuts overlay wrapper: a focus-trapped, escapable modal dialog. */
function HelpOverlay({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useFocusTrap<HTMLDivElement>(true);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      tabIndex={-1}
      className="absolute inset-0 flex items-center justify-center bg-scope/80 p-6"
      onClick={onClose}
    >
      {children}
    </div>
  );
}

/**
 * The console render surface. When the browser supports OffscreenCanvas
 * transfer, drawing runs in a worker (WorkerCanvas) so 8K modes never stall
 * the deck; otherwise it falls back to the inline VizCanvas. Both report the
 * live backing-store size to the HUD.
 */
function VizCanvasWithSize(props: {
  modeId: string;
  palette: VizPalette;
  paletteRef: PaletteRef;
  resolutionHeight: number;
  getFrame: () => ReturnType<AudioEngine["getFrame"]>;
  onFps: (n: number) => void;
  onSize: (s: string) => void;
}) {
  // Decided once per mount: whether we can render off-thread.
  const useWorker = useRef(workerCanvasSupported()).current;
  const wrapRef = useRef<HTMLDivElement>(null);

  // Inline path reports size by polling the canvas element; the worker path
  // reports it through the worker's stats message (canvas is transferred).
  useEffect(() => {
    if (useWorker) return;
    const el = wrapRef.current?.querySelector("canvas");
    if (!el) return;
    const report = () => props.onSize(`${el.width}x${el.height}`);
    const iv = setInterval(report, 1000);
    report();
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useWorker, props.resolutionHeight, props.modeId]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      {useWorker ? (
        <WorkerCanvas
          modeId={props.modeId}
          paletteRef={props.paletteRef}
          getFrame={props.getFrame}
          resolutionHeight={props.resolutionHeight}
          trackPointer
          onFps={props.onFps}
          onSize={props.onSize}
          className="h-full w-full"
        />
      ) : (
        <VizCanvas
          mode={modeById(props.modeId)}
          palette={props.palette}
          getFrame={props.getFrame}
          resolutionHeight={props.resolutionHeight}
          trackPointer
          onFps={props.onFps}
          className="h-full w-full"
        />
      )}
    </div>
  );
}

/**
 * The palettes + shuffle panel: choose which palettes join the shuffle,
 * toggle palette shuffling, and build custom palettes from color stops.
 */
function SettingsPanel({
  allPalettes,
  customDefs,
  shufflePalettes,
  shuffleInclude,
  onShufflePalettes,
  onShuffleInclude,
  onCustomDefs,
  onPickPalette,
  onClose,
}: {
  allPalettes: VizPalette[];
  customDefs: CustomPaletteDef[];
  shufflePalettes: boolean;
  shuffleInclude: string[] | null;
  onShufflePalettes: (v: boolean) => void;
  onShuffleInclude: (v: string[] | null) => void;
  onCustomDefs: (defs: CustomPaletteDef[]) => void;
  onPickPalette: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [stops, setStops] = useState<string[]>(["#3346c9", "#7ae0c3", "#f2f4f1"]);
  const trapRef = useFocusTrap<HTMLDivElement>(true);

  const included = (id: string) => !shuffleInclude || shuffleInclude.includes(id);
  const toggleInclude = (id: string) => {
    const current = shuffleInclude ?? allPalettes.map((p) => p.id);
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id];
    onShuffleInclude(next);
  };

  const addPalette = () => {
    const label = name.trim() || `Custom ${customDefs.length + 1}`;
    const id = `custom-${Date.now().toString(36)}`;
    const def: CustomPaletteDef = { id, name: label, stops };
    onCustomDefs([...customDefs, def]);
    if (shuffleInclude) onShuffleInclude([...shuffleInclude, id]);
    onPickPalette(id);
    setName("");
  };

  return (
    <div
      ref={trapRef}
      role="dialog"
      aria-modal="true"
      aria-label="Palettes and shuffle settings"
      tabIndex={-1}
      className="absolute inset-0 flex items-center justify-center bg-scope/80 p-6"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto border border-white/15 bg-scope p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <p className="readout text-ultra-soft">PALETTES + SHUFFLE</p>
          <button
            onClick={onClose}
            className="font-meter text-xs text-white/50 hover:text-white"
          >
            close
          </button>
        </div>

        <label className="mt-6 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={shufflePalettes}
            onChange={(e) => onShufflePalettes(e.target.checked)}
            className="h-4 w-4 accent-[#3346c9]"
          />
          <span className="font-meter text-sm text-white/85">
            Shuffle palettes too
          </span>
        </label>
        <p className="mt-1.5 pl-7 font-meter text-xs text-white/45">
          Each shuffle tick also picks a random trace palette from the checked
          list below.
        </p>

        <div className="mt-5 flex flex-col gap-2">
          {allPalettes.map((p) => (
            <div key={p.id} className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={included(p.id)}
                onChange={() => toggleInclude(p.id)}
                aria-label={`Include ${p.name} in the shuffle`}
                className="h-4 w-4 accent-[#3346c9]"
              />
              <button
                onClick={() => onPickPalette(p.id)}
                title="Use this palette now"
                className="flex flex-1 items-center gap-3 text-left"
              >
                <span
                  className="h-4 flex-1 border border-white/15"
                  style={{
                    background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1]
                      .map((t) => p.color(t))
                      .join(", ")})`,
                  }}
                />
                <span className="w-32 font-meter text-xs text-white/70">{p.name}</span>
              </button>
              {p.id.startsWith("custom-") ? (
                <button
                  onClick={() =>
                    onCustomDefs(customDefs.filter((d) => d.id !== p.id))
                  }
                  aria-label={`Delete ${p.name}`}
                  className="font-meter text-xs text-white/40 hover:text-red-300"
                >
                  delete
                </button>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-7 border-t border-white/10 pt-5">
          <p className="font-meter text-sm font-bold text-white/85">New palette</p>
          <p className="mt-1 font-meter text-xs text-white/45">
            Three color stops, blended dark to bright across each visualizer.
          </p>
          <div className="mt-3 flex items-center gap-3">
            {stops.map((s, i) => (
              <input
                key={i}
                type="color"
                value={s}
                onChange={(e) =>
                  setStops(stops.map((x, j) => (j === i ? e.target.value : x)))
                }
                aria-label={`Color stop ${i + 1}`}
                className="h-9 w-12 cursor-pointer border border-white/15 bg-scope"
              />
            ))}
            <span
              className="h-4 flex-1 border border-white/15"
              style={{
                background: `linear-gradient(90deg, ${stops.join(", ")})`,
              }}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Palette name"
              className="min-w-0 flex-1 border border-white/15 bg-scope px-3 py-2 font-meter text-xs text-white/85 placeholder:text-white/30"
            />
            <button
              onClick={addPalette}
              className="border border-ultra bg-ultra/20 px-4 py-2 font-meter text-xs text-ultra-soft hover:bg-ultra/35 active:scale-[0.98]"
            >
              add palette
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
