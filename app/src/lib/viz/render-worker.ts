/**
 * V2 render worker: the console's canvas, rendered off the main thread.
 *
 * The page transfers an OffscreenCanvas here and posts one analyzed audio
 * frame per animation tick; this worker runs its own draw loop against the
 * mode registry. Heavy drawing (8K field modes) can no longer stall the
 * deck UI, and a busy page can no longer starve the visuals: audio capture
 * lives on the audio thread, analysis on the main thread (microseconds),
 * pixels here. This is the thread-isolation half of the v2 architecture;
 * the WASM engine (ROADMAP-V2.md) plugs into the same message contract.
 */
import { modeById } from "./modes";
import { paletteById, customToPalette, type CustomPaletteDef } from "./palettes";
import type { AudioFrame, VizPalette } from "./types";

export interface PaletteRef {
  builtin?: string;
  custom?: CustomPaletteDef;
}

export type WorkerInMsg =
  | { type: "init"; canvas: OffscreenCanvas }
  | {
      type: "config";
      modeId: string;
      palette: PaletteRef;
      resolutionHeight: number;
      cssW: number;
      cssH: number;
      dpr: number;
      reduceMotion: boolean;
    }
  | {
      type: "frame";
      fft: Uint8Array;
      wave: Uint8Array;
      level: number;
      bass: number;
      mid: number;
      treble: number;
      beat: number;
    }
  | {
      /** Normalized 0..1 canvas coordinates; null on leave. */
      type: "pointer";
      x: number | null;
      y: number | null;
    };

export interface WorkerOutMsg {
  type: "stats";
  fps: number;
  w: number;
  h: number;
}

// Minimal worker-global shape (avoids pulling the webworker lib program-wide,
// which would clash with the DOM lib's typing of `self`). OffscreenCanvas and
// its 2D context come from the DOM lib.
interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerInMsg>) => void) | null;
  postMessage: (msg: WorkerOutMsg) => void;
  requestAnimationFrame?: (cb: () => void) => number;
}

const scope = self as unknown as WorkerScope;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let modeId = "radial-bars";
let palette: VizPalette = paletteById("phosphor");
let resolutionHeight = 0;
let cssW = 1;
let cssH = 1;
let dpr = 1;
let reduceMotion = false;
let state: Record<string, unknown> = {};
let pointerNorm: { x: number; y: number } | null = null;

// Latest analysis snapshot; the local clock advances t/dt so visuals stay
// smooth even if the page tab briefly stops posting frames.
const latest: AudioFrame = {
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
const epoch = performance.now();
let lastT = 0;

let frames = 0;
let fpsWindowStart = 0;
let loopRunning = false;

function size() {
  if (!canvas) return;
  let bh = resolutionHeight > 0 ? resolutionHeight : Math.round(cssH * dpr);
  let bw = Math.round(bh * (cssW / Math.max(1, cssH)));
  if (bw > 7680) {
    bh = Math.round(bh * (7680 / bw));
    bw = 7680;
  }
  bw = Math.max(1, bw);
  bh = Math.max(1, bh);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
    if (ctx) {
      ctx.fillStyle = palette.bg;
      ctx.fillRect(0, 0, bw, bh);
    }
  }
}

function drawOnce() {
  if (!canvas || !ctx) return;
  size();
  const now = (performance.now() - epoch) / 1000;
  latest.t = now;
  latest.dt = Math.min(0.1, Math.max(0.001, now - lastT));
  lastT = now;

  const mode = modeById(modeId);
  const fade = mode.fade ?? 1;
  ctx.globalAlpha = fade >= 1 ? 1 : fade;
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;
  mode.draw({
    // The 2D surface of OffscreenCanvas matches every member the modes use.
    ctx: ctx as unknown as CanvasRenderingContext2D,
    w: canvas.width,
    h: canvas.height,
    f: latest,
    p: palette,
    state,
    pointer: pointerNorm
      ? { x: pointerNorm.x * canvas.width, y: pointerNorm.y * canvas.height }
      : null,
  });

  frames++;
  const nowMs = performance.now();
  if (nowMs - fpsWindowStart >= 1000) {
    scope.postMessage({
      type: "stats",
      fps: frames,
      w: canvas.width,
      h: canvas.height,
    });
    frames = 0;
    fpsWindowStart = nowMs;
  }
}

function loop() {
  if (loopRunning) return;
  loopRunning = true;
  const tick = () => {
    if (reduceMotion) {
      loopRunning = false;
      return; // hold the last composed frame
    }
    drawOnce();
    schedule(tick);
  };
  schedule(tick);
}

// rAF exists in dedicated workers on Chromium/Firefox; timer fallback keeps
// Safari and older engines correct at ~60.
function schedule(fn: () => void) {
  if (scope.requestAnimationFrame) scope.requestAnimationFrame(fn);
  else setTimeout(fn, 16);
}

scope.onmessage = (e: MessageEvent<WorkerInMsg>) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":
      canvas = msg.canvas;
      ctx = canvas.getContext("2d");
      fpsWindowStart = performance.now();
      loop();
      break;
    case "config": {
      if (msg.modeId !== modeId) state = {};
      modeId = msg.modeId;
      palette = msg.palette.custom
        ? customToPalette(msg.palette.custom)
        : paletteById(msg.palette.builtin ?? "phosphor");
      resolutionHeight = msg.resolutionHeight;
      cssW = msg.cssW;
      cssH = msg.cssH;
      dpr = msg.dpr;
      reduceMotion = msg.reduceMotion;
      if (reduceMotion) drawOnce(); // one composed frame, then hold
      else loop();
      break;
    }
    case "frame":
      latest.fft = msg.fft;
      latest.wave = msg.wave;
      latest.level = msg.level;
      latest.bass = msg.bass;
      latest.mid = msg.mid;
      latest.treble = msg.treble;
      latest.beat = msg.beat;
      break;
    case "pointer":
      pointerNorm =
        msg.x === null || msg.y === null ? null : { x: msg.x, y: msg.y };
      break;
  }
};
