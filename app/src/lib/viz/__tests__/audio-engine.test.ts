import { afterEach, expect, test } from "bun:test";
import { AudioEngine } from "../audio-engine";

const originals = new Map<string, PropertyDescriptor | undefined>();
function global(name: string, value: unknown) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});
class NodeMock {
  connect() { return this; }
  disconnect() {}
}
class AudioMock {
  static instances: AudioMock[] = [];
  src = ""; loop = true; paused = true; ended = false; currentTime = 0; duration = 10;
  seekable = { length: 1 }; onerror: (() => void) | null = null;
  pending: Promise<void> | null = null;
  constructor() { AudioMock.instances.push(this); }
  async play() { await this.pending; this.paused = false; this.ended = false; }
  pause() { this.paused = true; }
}
function setup() {
  AudioMock.instances = [];
  global("Audio", AudioMock);
  global("AudioContext", class {
    currentTime = 0; sampleRate = 48000; destination = new NodeMock();
    resume = async () => {}; close = async () => {};
    createAnalyser() { return new NodeMock(); }
    createMediaElementSource() { return new NodeMock(); }
    createMediaStreamSource() { return new NodeMock(); }
  });
  return new AudioEngine();
}
const file = (name: string) => new File(["fixture"], name);

test("file transport pauses, seeks without resuming, clamps, loops, and replays", async () => {
  const engine = setup();
  await engine.startFile(file("track.wav"));
  const el = AudioMock.instances[0];
  await engine.toggleFilePlayback();
  expect(engine.filePlayback?.paused).toBe(true);
  engine.seekFile(7); expect(el.currentTime).toBe(7); expect(el.paused).toBe(true);
  engine.seekFile(50); expect(el.currentTime).toBe(10);
  engine.setFileLoop(false); expect(el.loop).toBe(false);
  el.ended = true;
  await engine.toggleFilePlayback();
  expect(el.currentTime).toBe(0); expect(el.paused).toBe(false);
  engine.dispose();
});
test("an old file's rejected play cannot detach a newer file", async () => {
  const engine = setup();
  let reject!: (error: Error) => void;
  const original = AudioMock.prototype.play;
  AudioMock.prototype.play = function () {
    if (AudioMock.instances.length === 1) return new Promise<void>((_, r) => { reject = r; });
    return original.call(this);
  };
  try {
    const old = engine.startFile(file("old.wav"));
    await engine.startFile(file("new.wav"));
    reject(new Error("old decoder failure"));
    await expect(old).rejects.toThrow("superseded");
    expect(engine.source?.label).toBe("new.wav");
    expect(engine.filePlayback?.name).toBe("new.wav");
  } finally { AudioMock.prototype.play = original; engine.dispose(); }
});
test("late capture selection is stopped after source replacement", async () => {
  const engine = setup();
  let resolve!: (stream: unknown) => void, stopped = 0;
  global("navigator", { mediaDevices: { getUserMedia: () => new Promise((r) => { resolve = r; }) } });
  const capture = engine.startMic();
  await engine.startFile(file("current.wav"));
  resolve({ getTracks: () => [{ stop: () => { stopped++; } }] });
  await expect(capture).rejects.toThrow("superseded");
  expect(stopped).toBe(1); expect(engine.source?.label).toBe("current.wav");
  engine.dispose();
});
test("unseekable files ignore seek and playback errors belong to the current file", async () => {
  const engine = setup(); await engine.startFile(file("first.wav"));
  const el = AudioMock.instances[0], oldError = el.onerror;
  el.seekable.length = 0; engine.seekFile(4); expect(el.currentTime).toBe(0);
  el.onerror?.(); expect(engine.filePlayback?.error).toContain("decoded");
  await engine.startFile(file("second.wav"));
  oldError?.(); expect(engine.filePlayback?.error).toBeNull();
  engine.dispose(); expect(engine.filePlayback).toBeNull();
});
