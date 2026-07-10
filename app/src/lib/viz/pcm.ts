import type { AudioFrame, AudioGraphSource } from "./types";

/**
 * Raw PCM streaming between windows.
 *
 * The console taps its analyser with an AudioWorklet and broadcasts stereo
 * Float32 blocks (~23 messages/sec at 48 kHz). Companion windows feed the
 * blocks into a player worklet inside their own muted AudioContext, which
 * rebuilds a REAL audio graph there: the built-in modes read it through a
 * local analyser, and butterchurn (MilkDrop) connects to it natively. This
 * is what gives companions full engine parity with the console.
 *
 * Worklet modules are tiny, so they ship inline as Blob URLs (no build
 * wiring, no extra requests). Everything here is client-only.
 */

const PCM_CHANNEL = "wavescope-pcm-v1";

/** Console side: accumulate 2048-sample stereo blocks, post to main thread. */
const TAP_WORKLET = `
class WsTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufL = new Float32Array(2048);
    this.bufR = new Float32Array(2048);
    this.n = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const l = input[0];
    const r = input[1] ?? input[0];
    const room = Math.min(l.length, 2048 - this.n);
    this.bufL.set(l.subarray(0, room), this.n);
    this.bufR.set(r.subarray(0, room), this.n);
    this.n += room;
    if (this.n >= 2048) {
      const msgL = this.bufL.slice();
      const msgR = this.bufR.slice();
      this.port.postMessage({ l: msgL, r: msgR, sr: sampleRate }, [msgL.buffer, msgR.buffer]);
      this.n = 0;
    }
    return true;
  }
}
registerProcessor("ws-tap", WsTap);
`;

/** Companion side: ring buffer replaying received blocks at audio rate. */
const PLAYER_WORKLET = `
class WsPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 65536;
    this.L = new Float32Array(this.size);
    this.R = new Float32Array(this.size);
    this.w = 0;
    this.r = 0;
    this.port.onmessage = (e) => {
      const { l, r } = e.data;
      for (let i = 0; i < l.length; i++) {
        this.L[this.w % this.size] = l[i];
        this.R[this.w % this.size] = r[i];
        this.w++;
      }
      // Bound latency: if the buffer runs past ~250ms, jump to ~100ms behind.
      if (this.w - this.r > 12000) this.r = this.w - 4800;
    };
  }
  process(inputs, outputs) {
    const out = outputs[0];
    const need = out[0].length;
    if (this.w - this.r >= need) {
      for (let i = 0; i < need; i++) {
        out[0][i] = this.L[this.r % this.size];
        if (out[1]) out[1][i] = this.R[this.r % this.size];
        this.r++;
      }
    }
    // Underrun: leave silence; the visualizer just holds still briefly.
    return true;
  }
}
registerProcessor("ws-player", WsPlayer);
`;

function workletUrl(code: string): string {
  return URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
}

interface PcmBlock {
  l: Float32Array;
  r: Float32Array;
  sr: number;
}

/**
 * Console side: attach the tap to an engine's analyser and forward blocks.
 * Returns a cleanup function. The tap survives source switches because every
 * source feeds the same analyser. Output is muted; nothing echoes.
 */
export async function attachPcmTap(
  source: AudioGraphSource,
  onBlock: (block: PcmBlock) => void,
): Promise<() => void> {
  const ctx = source.audioContext;
  const analyser = source.analyserNode;
  if (!ctx || !analyser) throw new Error("no audio graph to tap");
  await ctx.audioWorklet.addModule(workletUrl(TAP_WORKLET));
  const tap = new AudioWorkletNode(ctx, "ws-tap", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  const mute = ctx.createGain();
  mute.gain.value = 0;
  analyser.connect(tap);
  tap.connect(mute);
  mute.connect(ctx.destination);
  tap.port.onmessage = (e: MessageEvent<PcmBlock>) => onBlock(e.data);
  return () => {
    try {
      analyser.disconnect(tap);
      tap.disconnect();
      mute.disconnect();
    } catch {
      // graph already torn down
    }
  };
}

export class PcmBroadcaster {
  private ch: BroadcastChannel | null = null;

  constructor() {
    if (typeof BroadcastChannel !== "undefined") {
      this.ch = new BroadcastChannel(PCM_CHANNEL);
    }
  }

  send(block: PcmBlock) {
    this.ch?.postMessage(block);
  }

  close() {
    this.ch?.close();
    this.ch = null;
  }
}

/** Naive linear resampler for the rare console/companion rate mismatch. */
function resample(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return data;
  const outLen = Math.max(1, Math.round((data.length * to) / from));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const t = (i * (data.length - 1)) / (outLen - 1 || 1);
    const j = Math.floor(t);
    const f = t - j;
    out[i] = data[j] + (data[Math.min(j + 1, data.length - 1)] - data[j]) * f;
  }
  return out;
}

/**
 * Companion side: a real audio graph rebuilt from the PCM stream.
 * Construction requires a user gesture (browsers gate AudioContext).
 * Satisfies AudioGraphSource, so MilkdropCanvas connects to it directly,
 * and getFrame() feeds the built-in modes with true audio-rate analysis
 * (same math as the console's AudioEngine).
 */
export class PcmLink implements AudioGraphSource {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private ch: BroadcastChannel | null = null;
  private lastBlockAt = 0;

  private fft = new Uint8Array(1024);
  private wave = new Uint8Array(2048);
  private startedAt = 0;
  private lastT = 0;
  private smoothLevel = 0;
  private bassAvg = 0;
  private beatEnv = 0;

  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  /** True when the console has streamed within the last 2 seconds. */
  get live(): boolean {
    return this.ctx !== null && performance.now() - this.lastBlockAt < 2000;
  }

  async start(): Promise<void> {
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(workletUrl(PLAYER_WORKLET));
    const player = new AudioWorkletNode(ctx, "ws-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    const mute = ctx.createGain();
    mute.gain.value = 0;
    player.connect(analyser);
    analyser.connect(mute);
    mute.connect(ctx.destination);
    void ctx.resume();

    this.ch = new BroadcastChannel(PCM_CHANNEL);
    this.ch.onmessage = (e: MessageEvent<PcmBlock>) => {
      const { l, r, sr } = e.data;
      const ll = resample(l, sr, ctx.sampleRate);
      const rr = resample(r, sr, ctx.sampleRate);
      player.port.postMessage({ l: ll, r: rr }, [ll.buffer, rr.buffer]);
      this.lastBlockAt = performance.now();
    };

    this.ctx = ctx;
    this.analyser = analyser;
    this.startedAt = ctx.currentTime;
  }

  /** Same analysis contract as AudioEngine.getFrame(). */
  getFrame(): AudioFrame {
    const now = (this.ctx?.currentTime ?? 0) - this.startedAt;
    const dt = Math.min(0.1, Math.max(0.001, now - this.lastT));
    this.lastT = now;

    if (this.analyser) {
      this.analyser.getByteFrequencyData(this.fft);
      this.analyser.getByteTimeDomainData(this.wave);
    }

    const sampleRate = this.ctx?.sampleRate ?? 48000;
    const hzPerBin = sampleRate / 2 / this.fft.length;
    const band = (lo: number, hi: number) => {
      const a = Math.max(0, Math.floor(lo / hzPerBin));
      const b = Math.min(this.fft.length - 1, Math.ceil(hi / hzPerBin));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += this.fft[i];
      return sum / ((b - a + 1) * 255);
    };

    const bass = band(20, 250);
    const mid = band(250, 4000);
    const treble = band(4000, 16000);

    let rms = 0;
    for (let i = 0; i < this.wave.length; i += 4) {
      const s = (this.wave[i] - 128) / 128;
      rms += s * s;
    }
    rms = Math.sqrt(rms / (this.wave.length / 4));
    this.smoothLevel += (rms - this.smoothLevel) * 0.2;

    this.bassAvg += (bass - this.bassAvg) * 0.04;
    if (bass > this.bassAvg * 1.35 && bass > 0.08) this.beatEnv = 1;
    this.beatEnv *= Math.exp(-dt * 6);

    return {
      fft: this.fft,
      wave: this.wave,
      level: this.smoothLevel,
      bass,
      mid,
      treble,
      beat: this.beatEnv,
      t: now,
      dt,
    };
  }

  dispose() {
    this.ch?.close();
    this.ch = null;
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
  }
}
