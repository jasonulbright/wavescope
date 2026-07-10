import type { AudioGraphSource } from "./types";

/**
 * Clip recording: captures the visible visualizer canvas (whichever engine
 * drew it — worker-committed placeholder canvases and WebGPU canvases both
 * propagate frames to captureStream) plus, when a graph is live, the analysed
 * audio, into a WebM via MediaRecorder. Client-only.
 */
export class ClipRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private stream: MediaStream | null = null;
  /** The analyser→destination tap, disconnected again on stop. */
  private tap: { analyser: AnalyserNode; dest: MediaStreamAudioDestinationNode } | null =
    null;

  get active(): boolean {
    return this.recorder?.state === "recording";
  }

  /** Throws when the browser cannot capture or encode. */
  start(canvas: HTMLCanvasElement, audio: AudioGraphSource | null) {
    if (this.active) return;
    const stream = canvas.captureStream(60);
    // Mix the analysed audio into the clip via a parallel branch off the
    // analyser — nothing is rerouted to the speakers. Demo stays silent in
    // the file exactly as it is in the room.
    if (audio?.audioContext && audio.analyserNode) {
      try {
        const dest = audio.audioContext.createMediaStreamDestination();
        audio.analyserNode.connect(dest);
        this.tap = { analyser: audio.analyserNode, dest };
        for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      } catch {
        this.tap = null; // video-only clip
      }
    }
    const mime = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
    ].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(
      stream,
      mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined,
    );
    this.chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    rec.start(1000); // chunk every second so long takes never buffer unbounded
    this.recorder = rec;
    this.stream = stream;
  }

  /** Stops and resolves with the finished clip (null if nothing recorded). */
  stop(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        for (const t of this.stream?.getTracks() ?? []) t.stop();
        if (this.tap) {
          try {
            this.tap.analyser.disconnect(this.tap.dest);
          } catch {
            // graph already torn down
          }
          this.tap = null;
        }
        const blob = this.chunks.length
          ? new Blob(this.chunks, { type: rec.mimeType || "video/webm" })
          : null;
        this.recorder = null;
        this.stream = null;
        this.chunks = [];
        resolve(blob);
      };
      try {
        rec.stop();
      } catch {
        resolve(null);
      }
    });
  }
}

/** Hand a finished clip to the browser as a download. */
export function downloadClip(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
