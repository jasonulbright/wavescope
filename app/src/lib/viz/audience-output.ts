export interface OutputState {
  open: boolean;
  linked: boolean;
  blackout: boolean;
  size: string;
  error: string | null;
}
export const EMPTY_OUTPUT: OutputState = {
  open: false, linked: false, blackout: false, size: "", error: null,
};

/** Share only the visual canvas with a same-origin video window. */
export class AudienceOutput {
  private popup: Window | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private stream: MediaStream | null = null;
  private token: string;
  private timer: number;
  private state = { ...EMPTY_OUTPUT };
  private disposed = false;
  private generation = 0;
  constructor(
    private getCanvas: () => HTMLCanvasElement | null,
    private changed: (state: OutputState) => void,
    private host: Window = window,
  ) {
    this.token = this.host.crypto.randomUUID();
    this.host.addEventListener("message", this.onMessage);
    this.timer = this.host.setInterval(() => this.tick(), 500);
  }
  private update(patch: Partial<OutputState>) {
    const next = { ...this.state, ...patch };
    if (JSON.stringify(next) !== JSON.stringify(this.state)) {
      this.state = next;
      if (!this.disposed) this.changed(next);
    }
  }
  private onMessage = (event: MessageEvent) => {
    if (!this.popup || event.origin !== this.host.location.origin ||
        event.source !== this.popup || event.data?.type !== "wavescope-output-ready" ||
        event.data?.token !== this.token) return;
    try {
      const video = this.popup.document.querySelector("video");
      if (!video) throw new Error("Audience video is unavailable.");
      if (this.video !== video) {
        this.stopStream();
        this.video = video;
      }
      this.bind();
    } catch {
      this.update({ linked: false, error: "The audience window could not connect. Close it and open it again." });
    }
  };
  open() {
    if (this.disposed) return;
    if (this.popup && !this.popup.closed) { this.popup.focus(); return; }
    this.popup = this.host.open(`/audience.html#${this.token}`, `wavescope-output-${this.token}`, "popup,width=1280,height=720");
    if (!this.popup) {
      this.update({ error: "The browser blocked the output window. Allow popups for WaveScope and retry." });
      return;
    }
    this.update({ open: true, linked: false, error: null });
  }
  private stopStream() {
    this.generation++;
    if (this.video) this.video.srcObject = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.canvas = null;
    this.update({ linked: false, size: "" });
  }
  private bind() {
    const video = this.video;
    if (!video) return;
    const canvas = this.getCanvas();
    if (!canvas) { this.stopStream(); return; }
    if (this.canvas !== canvas || !this.stream?.active) {
      this.stopStream();
      try {
        this.stream = canvas.captureStream(60);
        this.canvas = canvas;
      } catch {
        this.update({ error: "This browser could not capture the visual. Try Chrome or Edge, or another engine." });
        return;
      }
    }
    video.style.visibility = this.state.blackout ? "hidden" : "visible";
    if (video.srcObject !== this.stream) {
      video.srcObject = this.stream;
      const generation = this.generation;
      void video.play().catch(() => {
        if (!this.disposed && this.video === video && this.generation === generation) {
          this.update({ linked: false, error: "Output playback was blocked. Double-click the audience window to start it." });
        }
      });
    }
    // A fulfilled play promise alone does not prove that a frame was decoded.
    // Polling also detects recovery after a manual play/fullscreen gesture.
    const linked = video.readyState >= 2 && video.videoWidth > 0 && !video.paused;
    this.update({
      linked,
      size: linked ? `${video.videoWidth}×${video.videoHeight}` : "",
      ...(linked ? { error: null } : {}),
    });
  }
  private tick() {
    if (!this.popup) return;
    if (this.popup.closed) {
      this.stopStream(); this.popup = null; this.video = null;
      this.update({ ...EMPTY_OUTPUT }); return;
    }
    try {
      // A reload must handshake again; never attach to an unrelated document.
      if (this.video && this.video.ownerDocument !== this.popup.document) {
        this.stopStream(); this.video = null;
      }
      this.bind();
    } catch {
      this.stopStream(); this.video = null;
      this.update({ error: "The audience window navigated away. Close it and open it again." });
    }
  }
  blackout(value: boolean) { this.update({ blackout: value }); this.bind(); }
  close() {
    this.stopStream();
    this.popup?.close(); this.popup = null; this.video = null;
    this.update({ ...EMPTY_OUTPUT });
  }
  dispose() {
    this.disposed = true;
    this.host.clearInterval(this.timer);
    this.host.removeEventListener("message", this.onMessage);
    this.close();
  }
}
