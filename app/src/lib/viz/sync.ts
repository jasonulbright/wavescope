import type { AudioFrame } from "./types";

/**
 * Multi-window audio sync over BroadcastChannel.
 *
 * The window that owns the audio source (the "console") analyzes audio and
 * broadcasts one compact frame per animation frame. Secondary windows (opened
 * on other displays) render from received frames: each window keeps its own
 * visualizer mode, palette, and resolution, but they all move to the same
 * signal, sample-synced enough for eyes.
 */

const CHANNEL = "wavescope-audio-v1";

interface WireFrame {
  fft: Uint8Array;
  wave: Uint8Array;
  level: number;
  bass: number;
  mid: number;
  treble: number;
  beat: number;
  t: number;
}

export class SyncBroadcaster {
  private ch: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel !== "undefined") {
      this.ch = new BroadcastChannel(CHANNEL);
    }
  }

  send(f: AudioFrame) {
    if (!this.ch) return;
    const msg: WireFrame = {
      // Copies: the engine reuses its arrays every frame.
      fft: f.fft.slice(),
      wave: f.wave.slice(),
      level: f.level,
      bass: f.bass,
      mid: f.mid,
      treble: f.treble,
      beat: f.beat,
      t: f.t,
    };
    this.ch.postMessage(msg);
  }

  close() {
    this.ch?.close();
    this.ch = null;
  }
}

export class SyncReceiver {
  private ch: BroadcastChannel | null = null;
  private latest: WireFrame | null = null;
  private lastArrival = 0;
  private lastT = 0;

  constructor() {
    if (typeof BroadcastChannel !== "undefined") {
      this.ch = new BroadcastChannel(CHANNEL);
      this.ch.onmessage = (e: MessageEvent<WireFrame>) => {
        this.latest = e.data;
        this.lastArrival = performance.now();
      };
    }
  }

  /** True when a console window has broadcast within the last 2 seconds. */
  get live(): boolean {
    return this.latest !== null && performance.now() - this.lastArrival < 2000;
  }

  getFrame(): AudioFrame {
    const nowSec = performance.now() / 1000;
    const dt = Math.min(0.1, Math.max(0.001, nowSec - this.lastT));
    this.lastT = nowSec;
    const f = this.latest;
    if (!f || !this.live) {
      return {
        fft: new Uint8Array(1024),
        wave: new Uint8Array(2048).fill(128),
        level: 0,
        bass: 0,
        mid: 0,
        treble: 0,
        beat: 0,
        t: nowSec,
        dt,
      };
    }
    return { ...f, t: nowSec, dt };
  }

  close() {
    this.ch?.close();
    this.ch = null;
  }
}

/**
 * Open one WaveScope window per additional display.
 *
 * Uses the Window Management API where available (Chrome/Edge, requires the
 * window-management permission); falls back to a single plain popup the user
 * drags to another display. Returns the number of windows opened.
 */
export async function openOnOtherDisplays(basePath: string): Promise<number> {
  const w = window as Window & {
    getScreenDetails?: () => Promise<{
      screens: Array<{
        isPrimary: boolean;
        availLeft: number;
        availTop: number;
        availWidth: number;
        availHeight: number;
        left: number;
        top: number;
      }>;
      currentScreen: { left: number; top: number };
    }>;
  };

  const url = `${basePath}?follow=1`;

  if (typeof w.getScreenDetails === "function") {
    try {
      const details = await w.getScreenDetails();
      const cur = details.currentScreen;
      const others = details.screens.filter(
        (s) => !(s.left === cur.left && s.top === cur.top),
      );
      let opened = 0;
      for (const s of others) {
        const win = window.open(
          url,
          `wavescope-${s.left}x${s.top}`,
          `left=${s.availLeft},top=${s.availTop},width=${s.availWidth},height=${s.availHeight}`,
        );
        if (win) opened++;
      }
      if (opened > 0) return opened;
    } catch {
      // Permission denied: fall through to the plain popup.
    }
  }

  const win = window.open(url, "_blank", "width=1280,height=720");
  return win ? 1 : 0;
}
