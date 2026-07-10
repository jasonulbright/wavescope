import type { AudioFrame, SourceInfo, SourceKind } from "./types";

/**
 * AudioEngine: one AnalyserNode fed by one of four sources.
 *
 *  - demo:   an internal test-signal generator (oscillator bank), silent.
 *  - mic:    getUserMedia microphone / line-in.
 *  - system: getDisplayMedia loopback (share a tab/screen WITH audio), so the
 *            visualizer can follow whatever the machine is playing.
 *  - file:   a local audio file, played audibly through an <audio> element.
 *
 * Everything is lazy and browser-only: construct on demand inside effects or
 * event handlers, never during render (routes are server-rendered).
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private sourceNode: AudioNode | null = null;
  private stream: MediaStream | null = null;
  private mediaEl: HTMLAudioElement | null = null;
  private demoNodes: { stop: () => void } | null = null;

  private fft = new Uint8Array(1024);
  private wave = new Uint8Array(2048);
  private startedAt = 0;
  private lastT = 0;
  private smoothLevel = 0;
  private bassAvg = 0;
  private beatEnv = 0;

  source: SourceInfo | null = null;
  onSourceEnded: (() => void) | null = null;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;
      this.startedAt = this.ctx.currentTime;
    }
    void this.ctx.resume();
    return this.ctx;
  }

  private attach(node: AudioNode, info: SourceInfo) {
    this.detach();
    node.connect(this.analyser!);
    this.sourceNode = node;
    this.source = info;
  }

  private detach() {
    if (this.sourceNode && this.analyser) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.sourceNode = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.mediaEl) {
      this.mediaEl.pause();
      this.mediaEl.src = "";
      this.mediaEl = null;
    }
    if (this.demoNodes) {
      this.demoNodes.stop();
      this.demoNodes = null;
    }
    this.source = null;
  }

  /** Internal test signal: a slow chord progression with a synthetic kick. */
  startDemo() {
    const ctx = this.ensureContext();
    const bus = ctx.createGain();
    bus.gain.value = 0.9;

    const roots = [110, 130.81, 98, 146.83]; // A2 C3 G2 D3
    const oscs: OscillatorNode[] = [];
    for (const ratio of [1, 1.5, 2, 3, 4.02]) {
      const o = ctx.createOscillator();
      o.type = ratio < 2 ? "sawtooth" : "sine";
      const g = ctx.createGain();
      g.gain.value = 0.18 / ratio;
      o.connect(g).connect(bus);
      o.start();
      oscs.push(o);
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.05 + ratio * 0.07;
      lfoGain.gain.value = 2 * ratio;
      lfo.connect(lfoGain).connect(o.detune);
      lfo.start();
      oscs.push(lfo);
    }

    // Kick: a decaying sine thump every 500ms, retuned per bar.
    const kick = ctx.createOscillator();
    kick.type = "sine";
    const kickGain = ctx.createGain();
    kickGain.gain.value = 0;
    kick.connect(kickGain).connect(bus);
    kick.start();
    let bar = 0;
    const interval = setInterval(() => {
      const t = ctx.currentTime;
      kick.frequency.setValueAtTime(120, t);
      kick.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      kickGain.gain.setValueAtTime(0.9, t);
      kickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      if (++bar % 8 === 0) {
        const root = roots[(bar / 8) % roots.length];
        oscs[0].frequency.setValueAtTime(root, t);
        oscs[2].frequency.setValueAtTime(root * 1.5, t);
      }
    }, 500);

    // Demo is analysis-only (never routed to speakers): it is a test signal.
    this.attach(bus, { kind: "demo", label: "Demo oscillator" });
    this.demoNodes = {
      stop: () => {
        clearInterval(interval);
        for (const o of oscs) o.stop();
        kick.stop();
      },
    };
  }

  async startMic(): Promise<void> {
    const ctx = this.ensureContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const node = ctx.createMediaStreamSource(stream);
    this.attach(node, { kind: "mic", label: "Microphone" });
    this.stream = stream;
  }

  /**
   * System audio via screen-share loopback. The browser requires a video
   * surface in the picker; we keep the video track alive but never render it
   * (stopping it ends the capture session in some browsers).
   */
  async startSystem(): Promise<void> {
    const ctx = this.ensureContext();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    if (stream.getAudioTracks().length === 0) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error(
        "No audio in the shared source. Pick a tab or screen and enable 'Share audio' in the picker.",
      );
    }
    // Analyze only the audio tracks.
    const audioOnly = new MediaStream(stream.getAudioTracks());
    const node = ctx.createMediaStreamSource(audioOnly);
    this.attach(node, { kind: "system", label: "System audio" });
    this.stream = stream;
    stream.getAudioTracks()[0].addEventListener("ended", () => {
      if (this.source?.kind === "system") {
        this.detach();
        this.onSourceEnded?.();
      }
    });
  }

  async startFile(file: File): Promise<void> {
    const ctx = this.ensureContext();
    const el = new Audio();
    el.src = URL.createObjectURL(file);
    el.loop = true;
    const node = ctx.createMediaElementSource(el);
    // Files are audible: analyser AND speakers.
    node.connect(ctx.destination);
    this.attach(node, { kind: "file", label: file.name });
    this.mediaEl = el;
    await el.play();
  }

  async start(kind: SourceKind, file?: File): Promise<void> {
    if (kind === "demo") this.startDemo();
    else if (kind === "mic") await this.startMic();
    else if (kind === "system") await this.startSystem();
    else if (kind === "file" && file) await this.startFile(file);
  }

  stop() {
    this.detach();
  }

  dispose() {
    this.detach();
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
  }

  get active(): boolean {
    return this.source !== null;
  }

  /** The audio context, for renderers that need the Web Audio graph (MilkDrop). */
  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  /**
   * The analyser node all sources feed. It passes audio through unchanged,
   * so external renderers (butterchurn) can tap the current source here and
   * keep working across source switches.
   */
  get analyserNode(): AnalyserNode | null {
    return this.analyser;
  }

  /** Analyze the current moment. Call once per animation frame. */
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

    // Onset detection: bass energy spiking above its own moving average.
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
}
